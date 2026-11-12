-- Kanban PL configuravel - Onda 2: MOTOR da fila do board PL (Tasks 2, 4 e 3, nesta ordem).
-- ADITIVA e idempotente (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, DROP/CREATE TRIGGER). SO BANCO;
-- nenhuma tela usa ainda (etapas_pl_automatico default false - a frente so liga na Onda 3). Espelha o motor do Dev
-- (20260930120000 tabela, 20261027100000 enfileiradores/processador, 20260930140000 gatilhos-fonte/historico,
-- 20261027140000 aplicador) para o board PL, com NOMES PROPRIOS etapas_pl_* e GUCs app.etapas_pl_*.
--
-- Diferencas do Dev (board PL):
--   - fila enfileira modelo de loja com etapas_pl_automatico E status_etapa_pl IS NOT NULL (esta no PL),
--     NAO "ordem_criacao_enviada AND NOT lancado".
--   - gatilhos-fonte so nas tabelas das condicoes PL: modelos (por linha), cad/producao_terceirizados/
--     controle_qualidade (statement-level via cad_id), modelo_servico_mo/modelo_peca_teste_tentativas (via modelo_id),
--     categorias_terceirizado (loja inteira).
--   - aplicador grava SO status_etapa_pl (PL nao revela REF - sem a clausula ref/ref_auto do Dev).
--   - historico escreve em modelo_etapa_pl_historico (ja existe, 20261126100000).
--   - guarda de recursao: GUC app.etapas_pl_sistema (nao app.kanban_sistema).
--
-- REUSA as puras do Dev via _etapas_pl_derivar_lote (Task 1, 20261127100000). Ordem interna: T2 (fila) -> T4
-- (aplicador+historico, pois o processador o chama) -> T3 (processador + CONSTRAINT TRIGGER).
--
-- RAISE 5xx so ASCII. Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261127110000_etapas_pl_fila.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Trava: so catalogo + tabela nova + gatilhos em tabelas de
-- NEGOCIO (nao auth/storage), ms.
-- Volta: supabase/rollback/20261127110000_etapas_pl_fila_down.sql (DROP triggers+funcoes+tabela - tudo NOVO, seguro).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '60s';

-- ════════════════════════════════════════════════════════════════════════════
-- TASK 2 - Fila + enfileiradores + gatilhos-fonte das condicoes PL
-- ════════════════════════════════════════════════════════════════════════════

-- Fila do recalculo adiado do PL (espelho de kanban_recalculo_fila, 20260930120000:40).
CREATE TABLE IF NOT EXISTS public.etapas_pl_recalculo_fila (
  modelo_id uuid PRIMARY KEY REFERENCES public.modelos(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  criado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_etapas_pl_fila_tenant ON public.etapas_pl_recalculo_fila (tenant_id);
ALTER TABLE public.etapas_pl_recalculo_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.etapas_pl_recalculo_fila FROM PUBLIC, anon, authenticated;

-- Enfileirar por ids (espelho de _kanban_enfileirar, 20261027100000:192). So entra modelo de loja com a CHAVE
-- LIGADA e no PL (status_etapa_pl IS NOT NULL), e so com GUC vazio (escrita do motor nao re-enfileira - recursao).
CREATE OR REPLACE FUNCTION public._etapas_pl_enfileirar(_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN RETURN; END IF;
  IF coalesce(current_setting('app.etapas_pl_sistema', true), '') <> '' THEN RETURN; END IF;
  INSERT INTO public.etapas_pl_recalculo_fila AS f (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
    JOIN public.tenant_config tc ON tc.tenant_id = m.tenant_id AND tc.etapas_pl_automatico
   WHERE m.id = ANY (_ids)
     AND m.status_etapa_pl IS NOT NULL
   ORDER BY m.id
  -- linha que SOBROU de transacao anterior REARMADA: o UPDATE OF criado_at redispara o gatilho adiado. Linha ja
  -- escrita por ESTA transacao: nada (criterio xmin, igual ao Dev).
  ON CONFLICT (modelo_id) DO UPDATE SET criado_at = clock_timestamp()
   WHERE f.xmin <> pg_current_xact_id()::xid;
END;
$function$;

-- Enfileirar a loja inteira (espelho de _kanban_enfileirar_tenant, 20261027100000:222).
CREATE OR REPLACE FUNCTION public._etapas_pl_enfileirar_tenant(_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _tenant IS NULL THEN RETURN; END IF;
  IF coalesce(current_setting('app.etapas_pl_sistema', true), '') <> '' THEN RETURN; END IF;
  IF NOT public._etapas_pl_ligado(_tenant) THEN RETURN; END IF;
  INSERT INTO public.etapas_pl_recalculo_fila AS f (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
   WHERE m.tenant_id = _tenant
     AND m.status_etapa_pl IS NOT NULL
   ORDER BY m.id
  ON CONFLICT (modelo_id) DO UPDATE SET criado_at = clock_timestamp()
   WHERE f.xmin <> pg_current_xact_id()::xid;
END;
$function$;

-- ── gatilhos-fonte (espelho de 20260930140000:264-491 com nomes PL, so as tabelas das condicoes PL) ──

-- modelos: POR LINHA, so quando muda coluna lida pelo core PL (lancado/status_etapa_pl/origem). O Sheet do Dev
-- manda ~40 colunas por save; limitamos ao que o avaliador PL usa + status_etapa_pl (entrou/saiu do PL).
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_fila_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._etapas_pl_enfileirar(ARRAY[NEW.id]);
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_etapas_pl_fila_upd ON public.modelos;
CREATE TRIGGER trg_etapas_pl_fila_upd
  AFTER UPDATE ON public.modelos
  FOR EACH ROW
  WHEN (OLD.status_etapa_pl IS DISTINCT FROM NEW.status_etapa_pl
     OR OLD.lancado IS DISTINCT FROM NEW.lancado
     OR OLD.origem IS DISTINCT FROM NEW.origem)
  EXECUTE FUNCTION public.fn_etapas_pl_fila_modelo();

DROP TRIGGER IF EXISTS trg_etapas_pl_fila_ins ON public.modelos;
CREATE TRIGGER trg_etapas_pl_fila_ins
  AFTER INSERT ON public.modelos
  FOR EACH ROW
  WHEN (NEW.status_etapa_pl IS NOT NULL)
  EXECUTE FUNCTION public.fn_etapas_pl_fila_modelo();

-- Tabelas com coluna modelo_id: modelo_servico_mo, modelo_peca_teste_tentativas (condicoes peca_teste_aprovada).
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_fila_por_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.etapas_pl_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.modelo_id) INTO v_ids FROM novas n WHERE n.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.modelo_id) INTO v_ids FROM antigas o WHERE o.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT u.modelo_id) INTO v_ids
      FROM (SELECT n.modelo_id FROM novas n UNION SELECT o.modelo_id FROM antigas o) u
     WHERE u.modelo_id IS NOT NULL;
  END IF;
  PERFORM public._etapas_pl_enfileirar(v_ids);
  RETURN NULL;
END;
$function$;

-- Tabelas com coluna cad_id: controle_qualidade, producao_terceirizados (condicoes materiais/grade/oficina/cq).
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_fila_por_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.etapas_pl_sistema', true), '') <> '' THEN RETURN NULL; END IF;
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
  PERFORM public._etapas_pl_enfileirar(v_ids);
  RETURN NULL;
END;
$function$;

-- cad: POR LINHA (enviado_corte muda a condicao enviado_a_servicos; cad e o pai das filhas por cad_id).
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_fila_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(current_setting('app.etapas_pl_sistema', true), '') <> '' THEN RETURN NULL; END IF;
  PERFORM public._etapas_pl_enfileirar(ARRAY[coalesce(NEW.modelo_id, OLD.modelo_id)]);
  RETURN NULL;
END;
$function$;

-- categorias_terceirizado (exige_peca_teste/etapa/ativo -> peca_teste/cq de muitos modelos): a LOJA inteira.
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_fila_categoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._etapas_pl_enfileirar_tenant(coalesce(NEW.tenant_id, OLD.tenant_id));
  RETURN NULL;
END;
$function$;

-- 3 gatilhos statement-level por tabela-filha com modelo_id/cad_id (nomes iguais: trg_etapas_pl_fila_{ins,upd,del}).
DO $do$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('modelo_servico_mo',            'fn_etapas_pl_fila_por_modelo'),
      ('modelo_peca_teste_tentativas', 'fn_etapas_pl_fila_por_modelo'),
      ('controle_qualidade',           'fn_etapas_pl_fila_por_cad'),
      ('producao_terceirizados',       'fn_etapas_pl_fila_por_cad')
    ) AS t(tabela, fn)
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_etapas_pl_fila_ins ON public.%I', r.tabela);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_etapas_pl_fila_upd ON public.%I', r.tabela);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_etapas_pl_fila_del ON public.%I', r.tabela);
    EXECUTE format('CREATE TRIGGER trg_etapas_pl_fila_ins AFTER INSERT ON public.%I '
                   || 'REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', r.tabela, r.fn);
    EXECUTE format('CREATE TRIGGER trg_etapas_pl_fila_upd AFTER UPDATE ON public.%I '
                   || 'REFERENCING OLD TABLE AS antigas NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', r.tabela, r.fn);
    EXECUTE format('CREATE TRIGGER trg_etapas_pl_fila_del AFTER DELETE ON public.%I '
                   || 'REFERENCING OLD TABLE AS antigas FOR EACH STATEMENT EXECUTE FUNCTION public.%I()', r.tabela, r.fn);
  END LOOP;
END
$do$;

-- cad: por linha (INS/UPD/DEL).
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cad_ins ON public.cad;
CREATE TRIGGER trg_etapas_pl_fila_cad_ins
  AFTER INSERT ON public.cad FOR EACH ROW EXECUTE FUNCTION public.fn_etapas_pl_fila_cad();
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cad_upd ON public.cad;
CREATE TRIGGER trg_etapas_pl_fila_cad_upd
  AFTER UPDATE ON public.cad FOR EACH ROW
  WHEN (OLD.enviado_corte IS DISTINCT FROM NEW.enviado_corte OR OLD.modelo_id IS DISTINCT FROM NEW.modelo_id)
  EXECUTE FUNCTION public.fn_etapas_pl_fila_cad();
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cad_del ON public.cad;
CREATE TRIGGER trg_etapas_pl_fila_cad_del
  AFTER DELETE ON public.cad FOR EACH ROW EXECUTE FUNCTION public.fn_etapas_pl_fila_cad();

-- categorias_terceirizado: loja inteira em UPD (campos lidos) e DEL.
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cat_upd ON public.categorias_terceirizado;
CREATE TRIGGER trg_etapas_pl_fila_cat_upd
  AFTER UPDATE ON public.categorias_terceirizado FOR EACH ROW
  WHEN (OLD.etapa IS DISTINCT FROM NEW.etapa
     OR OLD.nome IS DISTINCT FROM NEW.nome
     OR OLD.ativo IS DISTINCT FROM NEW.ativo
     OR OLD.exige_peca_teste IS DISTINCT FROM NEW.exige_peca_teste)
  EXECUTE FUNCTION public.fn_etapas_pl_fila_categoria();
DROP TRIGGER IF EXISTS trg_etapas_pl_fila_cat_del ON public.categorias_terceirizado;
CREATE TRIGGER trg_etapas_pl_fila_cat_del
  AFTER DELETE ON public.categorias_terceirizado FOR EACH ROW
  EXECUTE FUNCTION public.fn_etapas_pl_fila_categoria();

-- ════════════════════════════════════════════════════════════════════════════
-- TASK 4 - aplicador (_etapas_pl_aplicar) + historico (fn_etapas_pl_historico/trigger)
--   (vem ANTES da Task 3: o processador da fila CHAMA _etapas_pl_aplicar)
-- ════════════════════════════════════════════════════════════════════════════

-- Aplicador (espelho de _kanban_aplicar, 20261027140000:121). Deriva via _etapas_pl_derivar_lote e grava SO
-- status_etapa_pl onde muda. PL NAO revela REF -> SEM a clausula ref/ref_auto do Dev. Seta app.etapas_pl_sistema
-- (recursao: as enfileiradoras saem cedo quando a GUC <> '') e app.etapas_pl_lote em volta, RESTAURANDO ao valor
-- anterior no fim (sem try/finally em SQL: a restauracao vem antes do RETURN; erro -> a txn reverte a GUC local).
CREATE OR REPLACE FUNCTION public._etapas_pl_aplicar(_tenant uuid, _ids uuid[], _origem text, _lote uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sis_ant  text := coalesce(current_setting('app.etapas_pl_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.etapas_pl_lote', true), '');
  v_cfg      jsonb;
  v_n        integer := 0;
BEGIN
  IF _origem IS NULL OR _origem NOT IN ('auto', 'config') THEN
    RAISE EXCEPTION '_etapas_pl_aplicar: origem invalida (%).', _origem USING ERRCODE = 'P0001';
  END IF;
  IF _tenant IS NULL OR NOT public._etapas_pl_ligado(_tenant) THEN
    RETURN 0;
  END IF;

  v_cfg := public._etapas_pl_cfg(_tenant);

  PERFORM set_config('app.etapas_pl_sistema', _origem, true);
  PERFORM set_config('app.etapas_pl_lote', coalesce(_lote::text, ''), true);

  WITH d AS (
    SELECT x.* FROM public._etapas_pl_derivar_lote(_tenant, _ids, v_cfg) x WHERE x.derivavel
  ), calc AS (
    SELECT d.modelo_id AS mid,
           d.resultado,
           (d.resultado IS DISTINCT FROM d.status_atual) AS muda
      FROM d
  ), upd AS (
    UPDATE public.modelos m
       SET status_etapa_pl = c.resultado
      FROM calc c
     WHERE m.id = c.mid
       AND m.tenant_id = _tenant
       AND c.muda
    RETURNING c.muda
  )
  SELECT count(*) INTO v_n FROM upd;

  PERFORM set_config('app.etapas_pl_sistema', v_sis_ant, true);
  PERFORM set_config('app.etapas_pl_lote', v_lote_ant, true);
  RETURN v_n;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public._etapas_pl_aplicar(uuid, uuid[], text, uuid) FROM PUBLIC, anon, authenticated;

-- Historico (espelho de fn_kanban_historico, 20260930140000:40) escrevendo em modelo_etapa_pl_historico.
-- Colapso de 10s para origem 'auto'/'restauracao' (le app.etapas_pl_sistema/_lote). AFTER INSERT OR UPDATE OF
-- status_etapa_pl em modelos.
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_historico()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sis    text := coalesce(current_setting('app.etapas_pl_sistema', true), '');
  v_lote_s text := coalesce(current_setting('app.etapas_pl_lote', true), '');
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
    IF NEW.status_etapa_pl IS NOT NULL THEN
      INSERT INTO public.modelo_etapa_pl_historico(tenant_id, modelo_id, status, entrou_at, created_at, origem, lote_id)
      VALUES (NEW.tenant_id, NEW.id, NEW.status_etapa_pl, COALESCE(NEW.created_at, now()),
              clock_timestamp(), v_origem, v_lote);
    END IF;
  ELSIF NEW.status_etapa_pl IS DISTINCT FROM OLD.status_etapa_pl
        AND NEW.status_etapa_pl IS NOT NULL THEN
    IF v_origem IN ('auto', 'restauracao') THEN
      SELECT h.id, h.origem, h.entrou_at, h.status INTO v_ult_id, v_ult_or, v_ult_em, v_ult_st
        FROM public.modelo_etapa_pl_historico h
       WHERE h.modelo_id = NEW.id
       ORDER BY h.entrou_at DESC, h.created_at DESC
       LIMIT 1;
    END IF;
    -- restauracao nao repete a coluna que a ultima linha RESTANTE ja tem.
    IF v_origem = 'restauracao' AND v_ult_id IS NOT NULL
       AND v_ult_st IS NOT DISTINCT FROM NEW.status_etapa_pl THEN
      RETURN NEW;
    END IF;
    IF v_origem = 'auto' THEN
      IF v_ult_id IS NOT NULL AND v_ult_or = 'auto' AND v_ult_em > now() - interval '10 seconds' THEN
        SELECT h.status INTO v_pen
          FROM public.modelo_etapa_pl_historico h
         WHERE h.modelo_id = NEW.id AND h.id <> v_ult_id
         ORDER BY h.entrou_at DESC, h.created_at DESC
         LIMIT 1;
        IF v_pen IS NOT DISTINCT FROM NEW.status_etapa_pl THEN
          -- voltou a penultima dentro da janela: o recuo/avanco transitorio nunca existiu
          DELETE FROM public.modelo_etapa_pl_historico WHERE id = v_ult_id;
        ELSE
          UPDATE public.modelo_etapa_pl_historico
             SET status = NEW.status_etapa_pl, entrou_at = now(),
                 created_at = clock_timestamp(), lote_id = v_lote
           WHERE id = v_ult_id;
        END IF;
        RETURN NEW;
      END IF;
    END IF;
    INSERT INTO public.modelo_etapa_pl_historico(tenant_id, modelo_id, status, entrou_at, created_at, origem, lote_id)
    VALUES (NEW.tenant_id, NEW.id, NEW.status_etapa_pl, now(), clock_timestamp(), v_origem, v_lote);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_etapas_pl_historico ON public.modelos;
CREATE TRIGGER trg_etapas_pl_historico
  AFTER INSERT OR UPDATE OF status_etapa_pl ON public.modelos
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_etapas_pl_historico();

COMMIT;

select pg_notify('pgrst', 'reload schema');
