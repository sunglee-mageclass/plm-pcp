-- Kanban automático — F1 · migration 3/4: MOTOR (histórico c/ janela, fila adiada, aplicar,
-- enfileiradores, gatilho da Config c/ snapshot, guard, gates por posição)
-- ============================================================================
-- Plano: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md (Tasks 10–14, §3).
-- Inverso pareado: supabase/rollback/20260930140000_kanban_auto_3_motor_down.sql.
--
-- CHAVE DESLIGADA (tenant_config.kanban_automatico=false, default) = comportamento IDÊNTICO ao
-- de hoje: `_kanban_enfileirar` não insere nada (JOIN na chave), o guard e o gatilho da Config
-- saem cedo, `_kanban_status_gate` devolve o status gravado e `_kanban_regredir_modelo` roda o
-- legado inteiro. A única diferença observável é o histórico ganhar `origem='manual'` + created_at
-- preciso (clock_timestamp) nas linhas novas.
--
-- GUC transação-local `app.kanban_sistema` ('' | auto | config | manual | restauracao) +
-- `app.kanban_lote` (uuid|''): marca quem está escrevendo o status. Enfileiradores NÃO
-- enfileiram com GUC não vazio (trava de recursão); guard deixa passar; o histórico grava a origem.
-- Quem seta o GUC SEMPRE restaura o valor anterior antes de sair.
-- GUARDA DE ORDEM (Task 18, runbook v2): exige a migration 1 (fila `kanban_recalculo_fila`) e a 2
-- (`_kanban_ligado`/`_kanban_status_gate`); faltando, RECUSA antes de tocar em qualquer coisa (a txn
-- aborta; nada é aplicado). Reaplicar com tudo presente passa (idempotente).

BEGIN;

DO $do$
BEGIN
  IF to_regclass('public.kanban_recalculo_fila') IS NULL THEN
    RAISE EXCEPTION 'Rode antes a migration 1 (20260930120000_kanban_auto_1_schema.sql): falta a tabela kanban_recalculo_fila.';
  END IF;
  IF to_regprocedure('public._kanban_ligado(uuid)') IS NULL
     OR to_regprocedure('public._kanban_status_gate(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'Rode antes a migration 2 (20260930130000_kanban_auto_2_derivacao.sql): faltam _kanban_ligado/_kanban_status_gate.';
  END IF;
END
$do$;

-- ────────────────────────────────────────────────────────────────────────────
-- A) Histórico: origem + lote + colapso por JANELA de 10 s (só escritas 'auto')
--    Redefine fn_kanban_historico (snapshot funcoes.sql:11976-11995). `created_at` passa a ser
--    clock_timestamp() (desempate dentro da MESMA txn, onde now() é constante).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sis    text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_s text := coalesce(current_setting('app.kanban_lote', true), '');
  v_origem text;
  v_lote   uuid;
  v_ult_id uuid;
  v_ult_or text;
  v_ult_em timestamptz;
  v_ult_st text;
  v_pen    text;
BEGIN
  v_origem := CASE WHEN v_sis IN ('auto', 'config', 'manual', 'restauracao') THEN v_sis ELSE 'manual' END;
  v_lote := CASE WHEN v_lote_s ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 THEN v_lote_s::uuid END;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status_desenvolvimento IS NOT NULL THEN
      INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at, created_at, origem, lote_id)
      VALUES (NEW.tenant_id, NEW.id, NEW.status_desenvolvimento, COALESCE(NEW.created_at, now()),
              clock_timestamp(), v_origem, v_lote);
    END IF;
  ELSIF NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento
        AND NEW.status_desenvolvimento IS NOT NULL THEN
    IF v_origem IN ('auto', 'restauracao') THEN
      SELECT h.id, h.origem, h.entrou_at, h.status INTO v_ult_id, v_ult_or, v_ult_em, v_ult_st
        FROM public.modelo_kanban_historico h
       WHERE h.modelo_id = NEW.id
       ORDER BY h.entrou_at DESC, h.created_at DESC
       LIMIT 1;
    END IF;
    -- D14 (dono, 23/set): a restauração não repete a coluna que a última linha RESTANTE já tem
    -- (kanban_restaurar apaga antes as linhas auto/config do lote) — sem amostra extra no Leadtime.
    IF v_origem = 'restauracao' AND v_ult_id IS NOT NULL
       AND v_ult_st IS NOT DISTINCT FROM NEW.status_desenvolvimento THEN
      RETURN NEW;
    END IF;
    IF v_origem = 'auto' THEN
      IF v_ult_id IS NOT NULL AND v_ult_or = 'auto' AND v_ult_em > now() - interval '10 seconds' THEN
        SELECT h.status INTO v_pen
          FROM public.modelo_kanban_historico h
         WHERE h.modelo_id = NEW.id AND h.id <> v_ult_id
         ORDER BY h.entrou_at DESC, h.created_at DESC
         LIMIT 1;
        IF v_pen IS NOT DISTINCT FROM NEW.status_desenvolvimento THEN
          -- voltou à penúltima dentro da janela: o recuo/avanço transitório nunca existiu
          DELETE FROM public.modelo_kanban_historico WHERE id = v_ult_id;
        ELSE
          UPDATE public.modelo_kanban_historico
             SET status = NEW.status_desenvolvimento, entrou_at = now(),
                 created_at = clock_timestamp(), lote_id = v_lote
           WHERE id = v_ult_id;
        END IF;
        RETURN NEW;
      END IF;
    END IF;
    INSERT INTO public.modelo_kanban_historico(tenant_id, modelo_id, status, entrou_at, created_at, origem, lote_id)
    VALUES (NEW.tenant_id, NEW.id, NEW.status_desenvolvimento, now(), clock_timestamp(), v_origem, v_lote);
  END IF;
  RETURN NEW;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- B) Enfileirar (interno). Só entra na fila modelo DERIVÁVEL de loja com a CHAVE LIGADA, e só
--    com GUC vazio (escrita do próprio motor/RPCs não re-enfileira — trava de recursão).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._kanban_enfileirar(_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN RETURN; END IF;
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN; END IF;
  INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
    JOIN public.tenant_config tc ON tc.tenant_id = m.tenant_id AND tc.kanban_automatico
   WHERE m.id = ANY (_ids)
     AND coalesce(m.ordem_criacao_enviada, false)
     AND NOT coalesce(m.lancado, false)
   ORDER BY m.id
  ON CONFLICT (modelo_id) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public._kanban_enfileirar_tenant(_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _tenant IS NULL THEN RETURN; END IF;
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN; END IF;
  IF NOT public._kanban_ligado(_tenant) THEN RETURN; END IF;
  INSERT INTO public.kanban_recalculo_fila (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
   WHERE m.tenant_id = _tenant
     AND coalesce(m.ordem_criacao_enviada, false)
     AND NOT coalesce(m.lancado, false)
   ORDER BY m.id
  ON CONFLICT (modelo_id) DO NOTHING;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._kanban_enfileirar(uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._kanban_enfileirar_tenant(uuid) FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- C) Aplicar: deriva o lote e grava SÓ onde muda (UPDATE explícito), com GUC transação-local.
--    #Erro (revisao_pendente.kanban): NÃO é escrito aqui (decisão 14 do dono, 23/set) — com a
--    chave ligada, recuo automático só devolve o card à coluna a que ele pertence; um #Erro
--    legado (de quando a chave estava desligada) fica até o kanban_mover (D20).
--    REF: card FIXADO cuja posição derivada atinge ref_exibir_status tem a REF revelada aqui
--    (o status dele não muda, então fn_modelo_ref_auto não veria).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._kanban_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sis_ant  text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.kanban_lote', true), '');
  v_cfg      jsonb;
  v_n        integer := 0;
BEGIN
  IF _origem IS NULL OR _origem NOT IN ('auto', 'config') THEN
    RAISE EXCEPTION '_kanban_aplicar: origem inválida (%).', _origem USING ERRCODE = 'P0001';
  END IF;
  IF _tenant IS NULL OR NOT public._kanban_ligado(_tenant) THEN
    RETURN 0;
  END IF;

  v_cfg := public._kanban_cfg(_tenant);

  PERFORM set_config('app.kanban_sistema', _origem, true);
  PERFORM set_config('app.kanban_lote', coalesce(_lote::text, ''), true);

  WITH d AS (
    SELECT x.* FROM public._kanban_derivar_lote(_tenant, _ids, v_cfg) x WHERE x.derivavel
  ), calc AS (
    SELECT d.modelo_id AS mid,
           d.resultado,
           (d.resultado IS DISTINCT FROM d.status_atual) AS muda,
           (d.fixado AND public._ref_exibir_gate(_tenant, d.alvo)) AS revela_ref
      FROM d
  ), upd AS (
    UPDATE public.modelos m
       SET status_desenvolvimento = CASE WHEN c.muda THEN c.resultado ELSE m.status_desenvolvimento END,
           ref = CASE WHEN c.revela_ref AND coalesce(m.ref, '') = '' AND coalesce(m.ref_auto, '') <> ''
                      THEN m.ref_auto ELSE m.ref END
      FROM calc c
     WHERE m.id = c.mid
       AND m.tenant_id = _tenant
       AND (c.muda OR (c.revela_ref AND coalesce(m.ref, '') = '' AND coalesce(m.ref_auto, '') <> ''))
    RETURNING c.muda
  )
  SELECT count(*) FILTER (WHERE upd.muda) INTO v_n FROM upd;

  PERFORM set_config('app.kanban_sistema', v_sis_ant, true);
  PERFORM set_config('app.kanban_lote', v_lote_ant, true);
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._kanban_aplicar(uuid, uuid[], text, uuid) FROM PUBLIC, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- D) Fila → processada no COMMIT (CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED).
--    O 1º evento da loja drena TODAS as linhas dela (1 chamada ao core por lote); os demais
--    eventos acham a fila vazia e saem. O DELETE fica FORA do bloco de exceção (a fila esvazia
--    mesmo se a derivação falhar); a falha vira WARNING e NUNCA derruba o COMMIT do usuário.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_processar_fila()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  WITH d AS (
    DELETE FROM public.kanban_recalculo_fila f WHERE f.tenant_id = NEW.tenant_id RETURNING f.modelo_id
  )
  SELECT array_agg(d.modelo_id) INTO v_ids FROM d;
  IF v_ids IS NULL THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public._kanban_aplicar(NEW.tenant_id, v_ids, 'auto', NULL);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Kanban automático: recálculo ignorado (loja %, % card(s)): % [%]',
      NEW.tenant_id, cardinality(v_ids), SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_processar_fila ON public.kanban_recalculo_fila;
CREATE CONSTRAINT TRIGGER trg_kanban_processar_fila
  AFTER INSERT ON public.kanban_recalculo_fila
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_processar_fila();

-- ────────────────────────────────────────────────────────────────────────────
-- E) Enfileiradores nas tabelas-FONTE das condições (G-inicial #4/#8/#10).
--    modelos: POR LINHA, só quando muda coluna lida pelo core (26) ou `origem` (define o fluxo).
--    Sem status/rev/revisao_pendente no WHEN: o Sheet do Dev manda ~40 colunas por save.
--    Tabelas-filhas: 3 gatilhos STATEMENT-LEVEL por tabela (INSERT/UPDATE/DELETE) com
--    transition tables — no PG 17.6 transition table não aceita multi-evento nem lista de colunas.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_fila_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._kanban_enfileirar(ARRAY[NEW.id]);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_fila_upd ON public.modelos;
CREATE TRIGGER trg_kanban_fila_upd
  AFTER UPDATE ON public.modelos
  FOR EACH ROW
  WHEN (OLD.categoria_principal_id IS DISTINCT FROM NEW.categoria_principal_id
     OR OLD.subcategoria1_id IS DISTINCT FROM NEW.subcategoria1_id
     OR OLD.subcategoria2_id IS DISTINCT FROM NEW.subcategoria2_id
     OR OLD.estilista_id IS DISTINCT FROM NEW.estilista_id
     OR OLD.linha_id IS DISTINCT FROM NEW.linha_id
     OR OLD.colecao IS DISTINCT FROM NEW.colecao
     OR OLD.tecidos_planejados IS DISTINCT FROM NEW.tecidos_planejados
     OR OLD.ordem_criacao_enviada IS DISTINCT FROM NEW.ordem_criacao_enviada
     OR OLD.preco_venda IS DISTINCT FROM NEW.preco_venda
     OR OLD.data_lancamento IS DISTINCT FROM NEW.data_lancamento
     OR OLD.lancado IS DISTINCT FROM NEW.lancado
     OR OLD.modelista_id IS DISTINCT FROM NEW.modelista_id
     OR OLD.piloteiro1_id IS DISTINCT FROM NEW.piloteiro1_id
     OR OLD.piloteiro2_id IS DISTINCT FROM NEW.piloteiro2_id
     OR OLD.piloteiro3_id IS DISTINCT FROM NEW.piloteiro3_id
     OR OLD.data_desenho_tecnico IS DISTINCT FROM NEW.data_desenho_tecnico
     OR OLD.data_piloto1 IS DISTINCT FROM NEW.data_piloto1
     OR OLD.data_piloto2 IS DISTINCT FROM NEW.data_piloto2
     OR OLD.data_piloto3 IS DISTINCT FROM NEW.data_piloto3
     OR OLD.data_aprovacao IS DISTINCT FROM NEW.data_aprovacao
     OR OLD.croqui_url IS DISTINCT FROM NEW.croqui_url
     OR OLD.desenho_tecnico_url IS DISTINCT FROM NEW.desenho_tecnico_url
     OR OLD.fotos_modelo IS DISTINCT FROM NEW.fotos_modelo
     OR OLD.ficha_medida_url IS DISTINCT FROM NEW.ficha_medida_url
     OR OLD.enviado_cad IS DISTINCT FROM NEW.enviado_cad
     OR OLD.custo_terceirizados_aprovado IS DISTINCT FROM NEW.custo_terceirizados_aprovado
     OR OLD.origem IS DISTINCT FROM NEW.origem)
  EXECUTE FUNCTION public.fn_kanban_fila_modelo();

DROP TRIGGER IF EXISTS trg_kanban_fila_ins ON public.modelos;
CREATE TRIGGER trg_kanban_fila_ins
  AFTER INSERT ON public.modelos
  FOR EACH ROW
  WHEN (NEW.ordem_criacao_enviada)
  EXECUTE FUNCTION public.fn_kanban_fila_modelo();

-- Tabelas com coluna modelo_id: modelo_tecidos, modelo_grades, modelo_aviamentos, modelo_servico_mo, cad
CREATE OR REPLACE FUNCTION public.fn_kanban_fila_por_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.modelo_id) INTO v_ids FROM novas n WHERE n.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.modelo_id) INTO v_ids FROM antigas o WHERE o.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT u.modelo_id) INTO v_ids
      FROM (SELECT n.modelo_id FROM novas n UNION SELECT o.modelo_id FROM antigas o) u
     WHERE u.modelo_id IS NOT NULL;
  END IF;
  PERFORM public._kanban_enfileirar(v_ids);
  RETURN NULL;
END;
$function$;

-- Tabelas com coluna cad_id: cad_tecidos, cad_aviamentos, cad_etiquetas, controle_qualidade, producao_terceirizados
CREATE OR REPLACE FUNCTION public.fn_kanban_fila_por_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM novas n JOIN public.cad c ON c.id = n.cad_id WHERE c.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM antigas o JOIN public.cad c ON c.id = o.cad_id WHERE c.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM (SELECT n.cad_id FROM novas n UNION SELECT o.cad_id FROM antigas o) u
      JOIN public.cad c ON c.id = u.cad_id
     WHERE c.modelo_id IS NOT NULL;
  END IF;
  PERFORM public._kanban_enfileirar(v_ids);
  RETURN NULL;
END;
$function$;

-- modelo_tecido_variantes → modelo_tecidos.modelo_id
CREATE OR REPLACE FUNCTION public.fn_kanban_fila_por_modelo_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT mt.modelo_id) INTO v_ids
      FROM novas n JOIN public.modelo_tecidos mt ON mt.id = n.modelo_tecido_id WHERE mt.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT mt.modelo_id) INTO v_ids
      FROM antigas o JOIN public.modelo_tecidos mt ON mt.id = o.modelo_tecido_id WHERE mt.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT mt.modelo_id) INTO v_ids
      FROM (SELECT n.modelo_tecido_id FROM novas n UNION SELECT o.modelo_tecido_id FROM antigas o) u
      JOIN public.modelo_tecidos mt ON mt.id = u.modelo_tecido_id
     WHERE mt.modelo_id IS NOT NULL;
  END IF;
  PERFORM public._kanban_enfileirar(v_ids);
  RETURN NULL;
END;
$function$;

-- cad_tecido_variantes → cad_tecidos.cad_id → cad.modelo_id
CREATE OR REPLACE FUNCTION public.fn_kanban_fila_por_cad_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM novas n
      JOIN public.cad_tecidos ct ON ct.id = n.cad_tecido_id
      JOIN public.cad c ON c.id = ct.cad_id
     WHERE c.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM antigas o
      JOIN public.cad_tecidos ct ON ct.id = o.cad_tecido_id
      JOIN public.cad c ON c.id = ct.cad_id
     WHERE c.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT c.modelo_id) INTO v_ids
      FROM (SELECT n.cad_tecido_id FROM novas n UNION SELECT o.cad_tecido_id FROM antigas o) u
      JOIN public.cad_tecidos ct ON ct.id = u.cad_tecido_id
      JOIN public.cad c ON c.id = ct.cad_id
     WHERE c.modelo_id IS NOT NULL;
  END IF;
  PERFORM public._kanban_enfileirar(v_ids);
  RETURN NULL;
END;
$function$;

-- categorias_terceirizado (etapa/nome/ativo → _cq_liberado/_resolver_fonte_confeccao): a LOJA inteira.
CREATE OR REPLACE FUNCTION public.fn_kanban_fila_categoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._kanban_enfileirar_tenant(coalesce(NEW.tenant_id, OLD.tenant_id));
  RETURN NULL;
END;
$function$;

-- 3 gatilhos statement-level por tabela-filha (nomes iguais em todas: trg_kanban_fila_{ins,upd,del}).
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('modelo_tecidos',          'fn_kanban_fila_por_modelo'),
      ('modelo_grades',           'fn_kanban_fila_por_modelo'),
      ('modelo_aviamentos',       'fn_kanban_fila_por_modelo'),
      ('modelo_servico_mo',       'fn_kanban_fila_por_modelo'),
      ('cad',                     'fn_kanban_fila_por_modelo'),
      ('modelo_tecido_variantes', 'fn_kanban_fila_por_modelo_tecido'),
      ('cad_tecidos',             'fn_kanban_fila_por_cad'),
      ('cad_aviamentos',          'fn_kanban_fila_por_cad'),
      ('cad_etiquetas',           'fn_kanban_fila_por_cad'),
      ('controle_qualidade',      'fn_kanban_fila_por_cad'),
      ('producao_terceirizados',  'fn_kanban_fila_por_cad'),
      ('cad_tecido_variantes',    'fn_kanban_fila_por_cad_tecido')
    ) AS t(tabela, fn)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kanban_fila_ins ON public.%I', r.tabela);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kanban_fila_upd ON public.%I', r.tabela);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_kanban_fila_del ON public.%I', r.tabela);
    EXECUTE format('CREATE TRIGGER trg_kanban_fila_ins AFTER INSERT ON public.%I '
                   || 'REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', r.tabela, r.fn);
    EXECUTE format('CREATE TRIGGER trg_kanban_fila_upd AFTER UPDATE ON public.%I '
                   || 'REFERENCING OLD TABLE AS antigas NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', r.tabela, r.fn);
    EXECUTE format('CREATE TRIGGER trg_kanban_fila_del AFTER DELETE ON public.%I '
                   || 'REFERENCING OLD TABLE AS antigas FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', r.tabela, r.fn);
  END LOOP;
END
$do$;

DROP TRIGGER IF EXISTS trg_kanban_fila_upd ON public.categorias_terceirizado;
CREATE TRIGGER trg_kanban_fila_upd
  AFTER UPDATE ON public.categorias_terceirizado
  FOR EACH ROW
  WHEN (OLD.etapa IS DISTINCT FROM NEW.etapa
     OR OLD.nome IS DISTINCT FROM NEW.nome
     OR OLD.ativo IS DISTINCT FROM NEW.ativo)
  EXECUTE FUNCTION public.fn_kanban_fila_categoria();

DROP TRIGGER IF EXISTS trg_kanban_fila_del ON public.categorias_terceirizado;
CREATE TRIGGER trg_kanban_fila_del
  AFTER DELETE ON public.categorias_terceirizado
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_kanban_fila_categoria();

-- ────────────────────────────────────────────────────────────────────────────
-- F.1) Trava da chave (decisão 16 do dono, 23/set; G-plano R3). `kanban_automatico` só muda pela
--      RPC `kanban_definir_automatico` (migration 4), que seta `app.kanban_chave='rpc'` (transação-
--      local) e restaura depois. Sem esse GUC: UPDATE mantém o valor antigo — a Config faz upsert da
--      linha INTEIRA, e uma aba aberta antes de alguém ligar/desligar regravaria o valor velho
--      (ligaria a loja SEM prévia ou desligaria calada) — e INSERT nasce DESLIGADO. BEFORE INSERT
--      OR UPDATE sem WHEN (gatilho que também é de INSERT não pode citar OLD no WHEN); ordena depois
--      de set_tenant_id_trg. O snapshot/recálculo ao ligar continua no AFTER trg_kanban_config.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_chave_protegida()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.kanban_chave', true), '') = 'rpc' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.kanban_automatico := false;
  ELSE
    NEW.kanban_automatico := OLD.kanban_automatico;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_chave_protegida ON public.tenant_config;
CREATE TRIGGER trg_kanban_chave_protegida
  BEFORE INSERT OR UPDATE ON public.tenant_config
  FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_chave_protegida();

-- ────────────────────────────────────────────────────────────────────────────
-- F) Config da Loja: snapshot NO SERVIDOR + recálculo, na MESMA txn do save (G-fase R2).
--    WHEN com IS DISTINCT FROM (a Config faz upsert da linha INTEIRA — G-inicial #4): só as 5
--    colunas de kanban + a chave + confeccao_prioridade disparam. Desligar não grava nada. A chave
--    em si só chega aqui mudada pela RPC kanban_definir_automatico (trava F.1).
--    Snapshot: ao LIGAR (motivo 'ligar') e a cada mudança de board/requisitos/exceções/fluxo de
--    revenda com a chave ligada (motivo 'config'); `confeccao_prioridade` só recalcula.
--    Erro aqui PROPAGA (o admin vê a mensagem e nada muda) — não é engolido como na fila.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_config()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ligou     boolean := coalesce(NEW.kanban_automatico, false) AND NOT coalesce(OLD.kanban_automatico, false);
  v_cfg_mudou boolean;
  v_lote      uuid;
  v_agora     timestamptz := clock_timestamp();  -- relógio (não now()): separa, na MESMA txn, o antes/depois do lote
BEGIN
  IF NEW.tenant_id IS NULL OR NOT coalesce(NEW.kanban_automatico, false) THEN
    RETURN NULL;
  END IF;
  v_cfg_mudou := OLD.status_kanban IS DISTINCT FROM NEW.status_kanban
    OR OLD.kanban_requisitos IS DISTINCT FROM NEW.kanban_requisitos
    OR OLD.kanban_requisitos_excecoes IS DISTINCT FROM NEW.kanban_requisitos_excecoes
    OR OLD.revenda_kanban_colunas IS DISTINCT FROM NEW.revenda_kanban_colunas
    OR OLD.revenda_kanban_requisitos IS DISTINCT FROM NEW.revenda_kanban_requisitos;
  IF v_ligou OR v_cfg_mudou THEN
    v_lote := gen_random_uuid();
    INSERT INTO public.kanban_snapshot (lote_id, tenant_id, modelo_id, status_anterior, motivo, criado_at)
    SELECT v_lote, NEW.tenant_id, m.id, m.status_desenvolvimento,
           CASE WHEN v_ligou THEN 'ligar' ELSE 'config' END, v_agora
      FROM public.modelos m
     WHERE m.tenant_id = NEW.tenant_id
       AND coalesce(m.ordem_criacao_enviada, false)
       AND NOT coalesce(m.lancado, false);
  END IF;
  PERFORM public._kanban_aplicar(NEW.tenant_id, NULL, 'config', v_lote);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_config ON public.tenant_config;
CREATE TRIGGER trg_kanban_config
  AFTER UPDATE ON public.tenant_config
  FOR EACH ROW
  WHEN (OLD.kanban_automatico IS DISTINCT FROM NEW.kanban_automatico
     OR OLD.status_kanban IS DISTINCT FROM NEW.status_kanban
     OR OLD.kanban_requisitos IS DISTINCT FROM NEW.kanban_requisitos
     OR OLD.kanban_requisitos_excecoes IS DISTINCT FROM NEW.kanban_requisitos_excecoes
     OR OLD.revenda_kanban_colunas IS DISTINCT FROM NEW.revenda_kanban_colunas
     OR OLD.revenda_kanban_requisitos IS DISTINCT FROM NEW.revenda_kanban_requisitos
     OR OLD.confeccao_prioridade IS DISTINCT FROM NEW.confeccao_prioridade)
  EXECUTE FUNCTION public.fn_kanban_config();

-- ────────────────────────────────────────────────────────────────────────────
-- G) Guard do status (BEFORE UPDATE OF status_desenvolvimento). Dispara em ordem alfabética
--    entre trg_colab_rev e trg_modelo_markup_congela (ANTES de trg_modelo_ref_auto).
--    Passa: chave desligada, GUC não vazio, card não derivável, status igual.
--    Senão (e sempre re-enfileira — o COMMIT re-deriva com o estado final):
--      ''/NULL → mantém o atual · fora do fluxo → P0001 · entrada ou manual → passa (fixa) ·
--      AUTOMÁTICA de fora do motor → estava FIXADO: vai p/ a posição DERIVADA ("tirar de manual
--      solta"); senão mantém o atual (draft velho do Sheet do Dev é ignorado).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_kanban_status_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cfg      jsonb;
  v_comprado boolean;
  v_fluxo    text[];
  v_reqs     jsonb;
  v_exc      jsonb;
  v_para     text;
  v_atual    text;
  v_cond     jsonb;
BEGIN
  IF NEW.status_desenvolvimento IS NOT DISTINCT FROM OLD.status_desenvolvimento THEN RETURN NEW; END IF;
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN NEW; END IF;
  IF NOT public._kanban_ligado(NEW.tenant_id) THEN RETURN NEW; END IF;
  IF NOT (coalesce(NEW.ordem_criacao_enviada, false) AND NOT coalesce(NEW.lancado, false)) THEN RETURN NEW; END IF;

  v_cfg      := coalesce(public._kanban_cfg(NEW.tenant_id), '{}'::jsonb);
  v_comprado := coalesce(NEW.origem, 'interno') IN ('revenda', 'importado');
  v_fluxo    := public._kanban_fluxo(v_cfg, v_comprado);
  IF cardinality(v_fluxo) = 0 THEN RETURN NEW; END IF;
  v_reqs := CASE WHEN v_comprado THEN v_cfg -> 'revenda_kanban_requisitos' ELSE v_cfg -> 'kanban_requisitos' END;
  v_exc  := CASE WHEN v_comprado THEN '{}'::jsonb ELSE v_cfg -> 'kanban_requisitos_excecoes' END;

  PERFORM public._kanban_enfileirar(ARRAY[NEW.id]);

  v_para := public._kanban_norm(NEW.status_desenvolvimento);
  IF v_para = '' THEN
    NEW.status_desenvolvimento := OLD.status_desenvolvimento;
    RETURN NEW;
  END IF;
  IF NOT (v_para = ANY (v_fluxo)) THEN
    RAISE EXCEPTION 'A etapa "%" não faz parte do fluxo deste modelo.', NEW.status_desenvolvimento
      USING ERRCODE = 'P0001';
  END IF;
  IF v_para = v_fluxo[1] OR public._kanban_coluna_manual(v_para, v_reqs) THEN
    RETURN NEW;
  END IF;

  v_atual := public._kanban_norm(OLD.status_desenvolvimento);
  IF v_atual <> '' AND v_atual = ANY (v_fluxo) AND v_atual <> v_fluxo[1]
     AND public._kanban_coluna_manual(v_atual, v_reqs) THEN
    v_cond := coalesce(public._avaliar_condicoes_kanban_core(NEW.tenant_id, ARRAY[NEW.id]) -> NEW.id::text, '{}'::jsonb);
    NEW.status_desenvolvimento :=
      public._kanban_derivar_puro(v_fluxo, v_reqs, v_exc, v_cond, OLD.status_desenvolvimento, true) ->> 'alvo';
  ELSE
    NEW.status_desenvolvimento := OLD.status_desenvolvimento;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_kanban_status_guard ON public.modelos;
CREATE TRIGGER trg_kanban_status_guard
  BEFORE UPDATE OF status_desenvolvimento ON public.modelos
  FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_status_guard();

-- ────────────────────────────────────────────────────────────────────────────
-- H) Funções REDEFINIDAS — texto BYTE-A-BYTE do snapshot
--    (/Users/sunglee/PLM + Criação/savepoints/2026-09-22-pre-unificacao/funcoes.sql) com UMA linha
--    trocada/acrescentada em cada (diff mínimo; o teste compara com o snapshot + a troca):
--    · _kanban_regredir_modelo (funcoes.sql:3322-3403): +1 linha após a :3348 — retorno antecipado
--      com a chave ligada (legado intacto com a chave desligada).
--    · fn_modelo_ref_auto (funcoes.sql:12141-12195): linha :12161 — o gate de REF recebe a posição
--      de `_kanban_status_gate` (decisão 10).
--    · _enviar_modelo_para_cad_core (funcoes.sql:2150-2267): linha :2186 — o gate de Explosão
--      recebe a posição de `_kanban_status_gate` (decisão 10).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._kanban_regredir_modelo(_modelo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_origem text;
  v_status text;
  v_lancado boolean;
  v_cur_idx int;
  v_reqs jsonb;      -- tenant_config.kanban_requisitos
  v_exc jsonb;       -- tenant_config.kanban_requisitos_excecoes
  v_cond jsonb;      -- mapa condição→bool do modelo
  v_col record;
  v_acc text[] := '{}';   -- requisitos efetivos acumulados (cascata) até a coluna corrente
  v_k text;
  v_exc_col text[];
  v_alvo_idx int := null;
  v_alvo_key text := null;
  v_falhou boolean;
BEGIN
  SELECT m.tenant_id, coalesce(m.origem,'interno'), m.status_desenvolvimento, coalesce(m.lancado,false)
    INTO v_tenant, v_origem, v_status, v_lancado
    FROM public.modelos m WHERE m.id = _modelo_id;
  IF v_tenant IS NULL THEN RETURN; END IF;                 -- modelo sumiu (cascade delete)
  IF public._kanban_ligado(v_tenant) THEN RETURN; END IF;  -- Kanban automático LIGADO: o motor (fila) recalcula
  IF v_origem IS DISTINCT FROM 'interno' THEN RETURN; END IF;  -- comprado: fluxo próprio, sem cascata
  IF v_lancado THEN RETURN; END IF;                        -- lançado: sai do fluxo; rebaixa é via CQ

  -- Config de requisitos por coluna (própria de cada etapa) + exceções.
  SELECT coalesce(kanban_requisitos, '{}'::jsonb), coalesce(kanban_requisitos_excecoes, '{}'::jsonb)
    INTO v_reqs, v_exc
    FROM public.tenant_config WHERE tenant_id = v_tenant;
  IF v_reqs IS NULL OR v_reqs = '{}'::jsonb THEN RETURN; END IF;  -- loja sem requisitos: nada a regredir

  -- Índice da coluna ATUAL do card na ordem do board (null → não está no board conhecido → sai).
  SELECT r.ord INTO v_cur_idx
    FROM public._kanban_status_rows(v_tenant) r
    WHERE r.key = lower(btrim(coalesce(v_status,''))) ORDER BY r.ord LIMIT 1;
  IF v_cur_idx IS NULL THEN RETURN; END IF;

  -- Mapa de condições do modelo (mesma fonte da RPC de avaliação).
  v_cond := coalesce(public._avaliar_condicoes_kanban_core(v_tenant, ARRAY[_modelo_id]) -> _modelo_id::text, '{}'::jsonb);

  -- Caminha as colunas na ORDEM do board; acumula os requisitos efetivos (cascata) e acha a
  -- PRIMEIRA coluna cujos requisitos efetivos incluem alguma condição NÃO satisfeita.
  FOR v_col IN SELECT r.ord, r.key FROM public._kanban_status_rows(v_tenant) r ORDER BY r.ord LOOP
    -- soma os requisitos PRÓPRIOS desta coluna
    FOR v_k IN SELECT jsonb_array_elements_text(coalesce(v_reqs -> v_col.key, '[]'::jsonb)) LOOP
      IF NOT (v_k = ANY(v_acc)) THEN v_acc := array_append(v_acc, v_k); END IF;
    END LOOP;
    -- subtrai as EXCEÇÕES desta coluna (herdados que o admin desligou aqui) — igual ao TS:
    -- só remove o que NÃO é próprio desta coluna.
    SELECT array_agg(x) INTO v_exc_col
      FROM jsonb_array_elements_text(coalesce(v_exc -> v_col.key, '[]'::jsonb)) x
      WHERE NOT (x IN (SELECT jsonb_array_elements_text(coalesce(v_reqs -> v_col.key, '[]'::jsonb))));
    IF v_exc_col IS NOT NULL THEN
      v_acc := ARRAY(SELECT a FROM unnest(v_acc) a WHERE NOT (a = ANY(v_exc_col)));
    END IF;

    -- esta coluna falha se algum requisito efetivo NÃO está satisfeito no mapa de condições
    v_falhou := EXISTS (
      SELECT 1 FROM unnest(v_acc) req
      WHERE coalesce((v_cond ->> req)::boolean, false) = false
    );
    IF v_falhou THEN
      v_alvo_idx := v_col.ord;
      v_alvo_key := v_col.key;
      EXIT;  -- a PRIMEIRA que falha é o alvo (a mais atrás)
    END IF;
  END LOOP;

  -- Move só se: existe coluna que falha E o card está À FRENTE dela.
  IF v_alvo_idx IS NOT NULL AND v_cur_idx > v_alvo_idx THEN
    UPDATE public.modelos
      SET status_desenvolvimento = v_alvo_key,
          revisao_pendente = coalesce(revisao_pendente, '{}'::jsonb) || '{"kanban": true}'::jsonb
      WHERE id = _modelo_id;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_modelo_ref_auto()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sigla text; v_grupo text; v_cat text; v_sub text; v_num bigint;
  v_revelar boolean; v_relevante boolean; v_grupo_id uuid;
BEGIN
  IF NOT coalesce(NEW.ordem_criacao_enviada, false) THEN RETURN NEW; END IF;

  v_relevante := (TG_OP = 'INSERT')
    OR (NEW.ordem_criacao_enviada IS DISTINCT FROM OLD.ordem_criacao_enviada)
    OR (NEW.categoria_principal_id IS DISTINCT FROM OLD.categoria_principal_id)
    OR (NEW.subcategoria1_id IS DISTINCT FROM OLD.subcategoria1_id)
    OR (NEW.status_desenvolvimento IS DISTINCT FROM OLD.status_desenvolvimento)
    OR (coalesce(NEW.ref_auto,'') = '');
  IF NOT v_relevante THEN RETURN NEW; END IF;

  v_revelar := public._ref_exibir_gate(NEW.tenant_id, public._kanban_status_gate(NEW.tenant_id, NEW.id, NEW.status_desenvolvimento));

  SELECT c.nome, gp.nome, c.grupo_id INTO v_cat, v_grupo, v_grupo_id
    FROM public.categorias_produto c
    LEFT JOIN public.grupos_produto gp ON gp.id = c.grupo_id
    WHERE c.id = NEW.categoria_principal_id;
  SELECT s.nome INTO v_sub FROM public.subcategorias1_produto s WHERE s.id = NEW.subcategoria1_id;

  v_sigla := public._ref_montar_sigla(NEW.tenant_id, 'interno', v_grupo_id, NEW.categoria_principal_id, NEW.subcategoria1_id, NULL);
  IF v_sigla IS NULL THEN
    v_sigla := public._modelo_ref_sigla(v_grupo, v_cat, v_sub);
  END IF;

  IF NOT v_revelar THEN
    IF v_sigla <> '' THEN
      -- Número fixo na chegada: extrai o bloco final de dígitos do ref_auto atual, senão gera.
      IF coalesce(NEW.ref_auto,'') ~ '[0-9]+$' THEN
        v_num := substring(NEW.ref_auto from '([0-9]+)$')::bigint;
      ELSE
        v_num := public._modelo_ref_next_num(NEW.tenant_id);
      END IF;
      NEW.ref_auto := public._ref_juntar(NEW.tenant_id, v_sigla, public._ref_num_fmt(NEW.tenant_id, v_num));
    END IF;
  ELSE
    IF coalesce(NEW.ref_auto,'') = '' AND v_sigla <> '' THEN
      v_num := public._modelo_ref_next_num(NEW.tenant_id);
      NEW.ref_auto := public._ref_juntar(NEW.tenant_id, v_sigla, public._ref_num_fmt(NEW.tenant_id, v_num));
    END IF;
    IF coalesce(NEW.ref,'') = '' AND coalesce(NEW.ref_auto,'') <> '' THEN
      NEW.ref := NEW.ref_auto;
    END IF;
  END IF;

  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public._enviar_modelo_para_cad_core(_modelo_id uuid, _observacoes_tecnicas text DEFAULT NULL::text, _ficha_medida_url text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_user uuid := auth.uid();
  v_cad_id uuid;
  v_new_tid uuid;
  v_grade_total numeric;
  rt record;
  rg record;
  ra record;
  v_idx int := 0;
  v_gate_ok boolean;
  v_gate_label text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.modelos WHERE id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Modelo não encontrado';
  END IF;
  IF v_tenant <> public.get_user_tenant_id() AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Sem permissão para este modelo';
  END IF;

  -- Gate de etapa (configurável por loja, tenant_config.explosao_envio_status): o modelo
  -- só é enviado à Explosão A PARTIR da etapa configurada (ou de qualquer etapa POSTERIOR
  -- na ordem do board). Ausente ⇒ 'aprovado'. Órfã ⇒ fallback 'aprovado'.
  -- ERRCODE P0001 (NÃO 23514 — senão erro-mensagem.ts engole a mensagem PT).
  SELECT g.ok, g.req_label INTO v_gate_ok, v_gate_label
    FROM public._explosao_envio_gate(v_tenant, public._kanban_status_gate(v_tenant, _modelo_id, (SELECT status_desenvolvimento FROM public.modelos WHERE id = _modelo_id))) AS g;
  IF NOT COALESCE(v_gate_ok, false) THEN
    RAISE EXCEPTION 'O modelo precisa estar na etapa "%" (ou posterior) para ser enviado à Explosão.', v_gate_label
      USING ERRCODE = 'P0001';
  END IF;

  -- IDEMPOTENTE: se o CAD já existe (o save do card cria/sincroniza), NÃO recria.
  -- Só atualiza observações/ficha (se informadas) e marca o modelo como enviado à Explosão.
  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = _modelo_id;
  IF v_cad_id IS NOT NULL THEN
    UPDATE public.cad
       SET observacoes_tecnicas = COALESCE(_observacoes_tecnicas, observacoes_tecnicas),
           ficha_medida_url     = COALESCE(_ficha_medida_url, ficha_medida_url)
     WHERE id = v_cad_id;
    UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;
    RETURN v_cad_id;
  END IF;

  INSERT INTO public.cad (modelo_id, observacoes_tecnicas, ficha_medida_url, status_corte)
  VALUES (_modelo_id, _observacoes_tecnicas, _ficha_medida_url, 'pendente')
  RETURNING id INTO v_cad_id;

  -- Copia tecidos + variantes (preserva ordem e multiplicador).
  FOR rt IN
    SELECT id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto
    FROM public.modelo_tecidos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    INSERT INTO public.cad_tecidos
      (cad_id, artigo_id, numero, tipo, consumo_cad, loss_percent_cad, custo_cad, tamanho_folha)
    VALUES
      (v_cad_id, rt.artigo_id, rt.numero, rt.tipo,
       COALESCE(rt.consumo, 0), COALESCE(rt.loss_percent, 0), COALESCE(rt.custo_previsto, 0), 0)
    RETURNING id INTO v_new_tid;

    INSERT INTO public.cad_tecido_variantes
      (cad_tecido_id, variante_tecido_id, ordem, multiplicador,
       quantidade_folhas, metragem_planejada, metragem_enviada, complementa_variante_ids)
    SELECT v_new_tid, mtv.variante_tecido_id, mtv.ordem,
           COALESCE(mtv.multiplicador, 1), 0, 0, 0, mtv.complementa_variante_ids
    FROM public.modelo_tecido_variantes mtv
    WHERE mtv.modelo_tecido_id = rt.id;
  END LOOP;

  -- Copia grade planejada -> cad_grades (planejada = real).
  v_grade_total := 0;
  FOR rg IN
    SELECT variante_numero, grades, grade_total
    FROM public.modelo_grades WHERE modelo_id = _modelo_id
  LOOP
    INSERT INTO public.cad_grades
      (cad_id, variante_numero, grades_planejadas, grades_reais,
       grade_total_planejada, grade_total_real)
    VALUES
      (v_cad_id, rg.variante_numero,
       COALESCE(rg.grades, '{}'::jsonb), COALESCE(rg.grades, '{}'::jsonb),
       COALESCE(rg.grade_total, 0), COALESCE(rg.grade_total, 0));
    v_grade_total := v_grade_total + COALESCE(rg.grade_total, 0);
  END LOOP;

  -- Copia aviamentos (qtd = consumo * grade total geral; numero sequencial).
  -- [NOVO] leva a variante_aviamento_id do BOM p/ o CAD → cad_aviamentos vira
  -- POR aviamento×variante (base da "a separar" editável por variante na Explosão).
  FOR ra IN
    SELECT aviamento_id, consumo, variante_aviamento_id
    FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id ORDER BY numero
  LOOP
    v_idx := v_idx + 1;
    INSERT INTO public.cad_aviamentos
      (cad_id, aviamento_id, numero, consumo, quantidade_enviar, quantidade_separar, variante_aviamento_id)
    VALUES
      (v_cad_id, ra.aviamento_id, v_idx,
       COALESCE(ra.consumo, 0),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ROUND(COALESCE(ra.consumo, 0) * v_grade_total, 4),
       ra.variante_aviamento_id);
  END LOOP;

  UPDATE public.modelos SET enviado_cad = true WHERE id = _modelo_id;

  RETURN v_cad_id;
END;
$function$
;

-- @@FIM_H

COMMIT;

select pg_notify('pgrst', 'reload schema');
