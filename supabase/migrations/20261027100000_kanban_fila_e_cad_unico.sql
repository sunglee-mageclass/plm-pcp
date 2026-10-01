-- Achados LEVES, release L3 (Kanban, REF e SKU; banco antes do site) - parte 1: kanban #10, kanban #11 + mensagem do reprovado.
--   fn_kanban_processar_fila        kanban #10: o DELETE ... RETURNING da fila fica DENTRO do bloco protegido (padrao R1 da fila
--                                   de custo): erro no recalculo desfaz o DELETE e as linhas FICAM na fila. Lote falhou -> card a
--                                   card. [fix round 1, M1] UMA passada por loja por comando (marca na GUC de transacao
--                                   app.kanban_fila_feita - os N eventos adiados do mesmo COMMIT nao refazem o lote); orcamento
--                                   de 3 s (statement_timestamp()) conferido antes do lote e de cada card; FOR UPDATE SKIP LOCKED
--                                   na fila; pega query_canceled (57014) tambem - o COMMIT de quem gravou nunca cai (R15a).
--   _kanban_enfileirar(_tenant)     [fix round 1, B5] ON CONFLICT DO UPDATE SET criado_at (so linha de transacao ANTERIOR, xmin):
--                                   card que sobrou na fila volta a ser processado quando ELE MESMO e editado.
--   trg_kanban_processar_fila_upd   [fix round 1, B5] gatilho NOVO (CONSTRAINT, adiado) AFTER UPDATE OF criado_at na fila -> a
--                                   mesma fn_kanban_processar_fila. CREATE TRIGGER (sem DROP; nao trava auth/storage - precedente
--                                   da release 9); pega ShareRowExclusive so em kanban_recalculo_fila (lock_timeout 500ms).
--   _avaliar_condicoes_kanban_core  kanban #11: 'cq_liberado' por bool_or(...) (2 CADs - legado - nao derrubam o lote).
--   _enviar_modelo_para_cad_core    kanban #11: pg_advisory_xact_lock na MESMA chave do enforce_unique_fk de cad.modelo_id; + R14
--                                   msg reprovado: 'reprovado_explosao: Card reprovado nao vai a Explosao' (P0001, ASCII com
--                                   prefixo; PT em src/lib/erro-mensagem.ts). [fix round 1, A1 / P-213 A] reprovado = Dev OU
--                                   Planejamento: reprovado no PLANEJAMENTO e recusado com a mesma mensagem (qualquer chave).
-- Nada gravado muda.
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
-- Nenhuma foi alterada pelos MEDIOS (R12-R16): "antes" = texto de producao.
--   public.fn_kanban_processar_fila()
--     ANTES  f14d567a9c20f961b8be9cc497d21238  -- CONFIRMADO: Passo 0-CD Rodada #2 em producao (01/out 08:22) - conferir no Passo 0 dos LEVES
--     DEPOIS 4051368d03f06d4a8e0e118dbc6614d5
--   public._kanban_enfileirar(uuid[])
--     ANTES  83b3076206747102812487a0814ab809  -- PROVISORIO (copia 54422)
--     DEPOIS d763171ea7e617ba6c791a6a204f0a21
--   public._kanban_enfileirar_tenant(uuid)
--     ANTES  38a64cd1bdbe0f14bd0f9a0bd041723a  -- PROVISORIO (copia 54422)
--     DEPOIS d27c6401de3659f1b352eb18e867c7ef
--   public._avaliar_condicoes_kanban_core(uuid,uuid[])
--     ANTES  437b115a792c44f62bb94042cdbaeebe  -- PROVISORIO (copia 54422)
--     DEPOIS e6f3fceae7e6eb6f4589d4858e01d1d6
--   public._enviar_modelo_para_cad_core(uuid,text,text)
--     ANTES  3e49be237f86d1acdec0fefc43496008  -- PROVISORIO (copia 54422)
--     DEPOIS 14179bce7709643ea068edfed128ca43
--   Sem mudanca (so guarda): _kanban_status_gate 635c7bba ("depois" da R14) OU e269b20351a1f7fa1d1ece3df122e704 ("depois" da 20261027140000, que
--   e aplicada depois desta - reaplicar esta com a 140000 viva = no-op); _kanban_norm 74606b6e (PROVISORIO).
--   Gatilho trg_kanban_processar_fila_upd: ausente (antes) ou com a definicao deste arquivo (reaplicar = no-op).
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- ACL: CREATE OR REPLACE mantem a de hoje; a pos-condicao confere que ficou IDENTICA; internos sem EXECUTE para
-- PUBLIC/anon/authenticated (inv. #9); fn_kanban_processar_fila (RETURNS trigger) mantem a ACL de producao.
-- Volta: supabase/rollback/20261027100000_kanban_fila_e_cad_unico_down.sql (devolve os 5 textos; o gatilho _upd FICA, inerte:
-- o _kanban_enfileirar de antes nunca faz UPDATE na fila) e, opcional/horario calmo, ..._down_drop.sql (DROP TRIGGER).
-- LIFO: os inversos da L3 rodam ANTES dos inversos da R14 (20261024*) e de qualquer anterior; o desta e o ULTIMO da L3 (depois
-- do 20261027140000_down). A IDA da release 8 (20261019300000:95 e o kit pre-release8 DEPS_OK) guarda fn_kanban_processar_fila
-- f14d567a: REAPLICAR a ida da release 8 exige desfazer ANTES esta migration.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _l3k_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _l3k_md5_aceitos VALUES
  ('public.fn_kanban_processar_fila()', 'f14d567a9c20f961b8be9cc497d21238', 'antes'),  -- CONFIRMADO: Passo 0-CD Rodada #2 (01/out 08:22)
  ('public.fn_kanban_processar_fila()', '4051368d03f06d4a8e0e118dbc6614d5', 'depois'),
  ('public._kanban_enfileirar(uuid[])', '83b3076206747102812487a0814ab809', 'antes'),  -- PROVISORIO (copia 54422)
  ('public._kanban_enfileirar(uuid[])', 'd763171ea7e617ba6c791a6a204f0a21', 'depois'),
  ('public._kanban_enfileirar_tenant(uuid)', '38a64cd1bdbe0f14bd0f9a0bd041723a', 'antes'),  -- PROVISORIO (copia 54422)
  ('public._kanban_enfileirar_tenant(uuid)', 'd27c6401de3659f1b352eb18e867c7ef', 'depois'),
  ('public._avaliar_condicoes_kanban_core(uuid,uuid[])', '437b115a792c44f62bb94042cdbaeebe', 'antes'),  -- PROVISORIO (copia 54422)
  ('public._avaliar_condicoes_kanban_core(uuid,uuid[])', 'e6f3fceae7e6eb6f4589d4858e01d1d6', 'depois'),
  ('public._enviar_modelo_para_cad_core(uuid,text,text)', '3e49be237f86d1acdec0fefc43496008', 'antes'),  -- PROVISORIO (copia 54422)
  ('public._enviar_modelo_para_cad_core(uuid,text,text)', '14179bce7709643ea068edfed128ca43', 'depois'),
  ('public._kanban_status_gate(uuid,uuid,text)', '635c7bbad3a3db2779f68fd1c5c8a954', 'dep'),  -- "depois" da R14
  ('public._kanban_status_gate(uuid,uuid,text)', 'e269b20351a1f7fa1d1ece3df122e704', 'dep'),  -- "depois" da 20261027140000
  ('public._kanban_norm(text)', '74606b6e06de34fa23fd0642d1ebafbb', 'dep');  -- PROVISORIO (copia 54422)

CREATE TEMP TABLE _l3k_acl_antes ON COMMIT DROP AS
  SELECT DISTINCT a.assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(a.assinatura)) AS acl
    FROM _l3k_md5_aceitos a;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
  v_def text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _l3k_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'leves_l3: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _l3k_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5) THEN
      RAISE EXCEPTION 'leves_l3: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regprocedure('public.enforce_unique_fk()') IS NULL OR to_regclass('public.kanban_recalculo_fila') IS NULL THEN
    RAISE EXCEPTION 'leves_l3: enforce_unique_fk()/kanban_recalculo_fila ausente' USING ERRCODE = 'P0001';
  END IF;
  SELECT pg_get_triggerdef(t.oid) INTO v_def FROM pg_trigger t
   WHERE t.tgrelid = 'public.kanban_recalculo_fila'::regclass AND t.tgname = 'trg_kanban_processar_fila_upd';
  IF v_def IS NOT NULL AND v_def IS DISTINCT FROM 'CREATE CONSTRAINT TRIGGER trg_kanban_processar_fila_upd AFTER UPDATE OF criado_at ON public.kanban_recalculo_fila DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_kanban_processar_fila()' THEN
    RAISE EXCEPTION 'leves_l3: trg_kanban_processar_fila_upd com outra definicao (%)', v_def USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public.fn_kanban_processar_fila()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
AS $function$
-- [leves L3 kanban #10 + fix round 1 M1] roda no COMMIT (CONSTRAINT TRIGGER adiado, um evento por linha enfileirada/rearmada).
-- Nunca perde recalculo e nunca derruba o COMMIT de quem disparou:
--   R1  o DELETE ... RETURNING fica DENTRO do bloco protegido (erro = as linhas voltam a fila); lote falhou -> card a card, cada
--       um no seu sub-bloco; o card que falha FICA na fila (WARNING ASCII) e e refeito quando ele mesmo ou outro card da loja for
--       enfileirado de novo (B5: _kanban_enfileirar rearma a linha que sobrou -> UPDATE OF criado_at -> novo evento).
--   M1  UMA passada por loja por comando: a marca 'loja@statement_timestamp()' na GUC de transacao app.kanban_fila_feita (setada
--       FORA do sub-bloco, o abort nao a desfaz) faz os outros N-1 eventos do mesmo COMMIT sairem na hora; orcamento de 3 s
--       contados de statement_timestamp() conferido ANTES do lote e de cada card; linhas travadas por outra transacao sao
--       puladas (FOR UPDATE SKIP LOCKED - a outra as processa); o lock_timeout de 2 s limita a espera da linha do modelo; o
--       bloco pega tambem query_canceled (57014, statement_timeout - o WHEN OTHERS nao pega) e para na hora (mesma abordagem
--       da R15a). Pior caso: 3 s + 2 s de uma espera + o trabalho de 1 lote, abaixo dos 8 s do authenticated.
DECLARE
  c_orcamento CONSTANT interval := interval '3 seconds';
  v_prazo timestamptz := statement_timestamp() + c_orcamento;
  v_marca text := NEW.tenant_id::text || '@' || statement_timestamp()::text;
  v_feitas text := coalesce(current_setting('app.kanban_fila_feita', true), '');
  v_ids uuid[];
  v_fila uuid[];
  v_id uuid;
  v_estado text;
BEGIN
  IF position(v_marca IN v_feitas) > 0 THEN
    RETURN NULL;  -- esta loja ja teve a sua passada neste comando
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.kanban_recalculo_fila f WHERE f.modelo_id = NEW.modelo_id) THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('app.kanban_fila_feita', v_feitas || ';' || v_marca, true);
  IF clock_timestamp() >= v_prazo THEN
    RAISE WARNING 'kanban_auto: orcamento de tempo do COMMIT esgotado antes da fila (loja %) - os cards ficam na fila', NEW.tenant_id;
    RETURN NULL;
  END IF;
  BEGIN
    WITH alvo AS (
      SELECT f.modelo_id FROM public.kanban_recalculo_fila f
       WHERE f.tenant_id = NEW.tenant_id
       ORDER BY f.modelo_id
       FOR UPDATE SKIP LOCKED
    ), d AS (
      DELETE FROM public.kanban_recalculo_fila f USING alvo WHERE f.modelo_id = alvo.modelo_id RETURNING f.modelo_id
    )
    SELECT array_agg(d.modelo_id ORDER BY d.modelo_id) INTO v_ids FROM d;
    IF v_ids IS NOT NULL THEN
      PERFORM public._kanban_aplicar(NEW.tenant_id, v_ids, 'auto', NULL);
    END IF;
    RETURN NULL;
  EXCEPTION WHEN query_canceled OR OTHERS THEN
    v_estado := SQLSTATE;
    RAISE WARNING 'kanban_auto: recalculo do lote falhou (loja %, % card(s)): % [%] - os cards voltam a fila; tentando card a card',
      NEW.tenant_id, coalesce(cardinality(v_ids), 0), SQLERRM, SQLSTATE;
  END;
  -- statement_timeout: para ja. Lote de 1 card que falhou: nao refaz o mesmo agora (fica na fila).
  IF v_estado = '57014' OR coalesce(cardinality(v_ids), 0) = 1 THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(f.modelo_id ORDER BY f.modelo_id) INTO v_fila
    FROM public.kanban_recalculo_fila f
   WHERE f.tenant_id = NEW.tenant_id;
  FOREACH v_id IN ARRAY coalesce(v_fila, ARRAY[]::uuid[]) LOOP
    IF clock_timestamp() >= v_prazo THEN
      RAISE WARNING 'kanban_auto: orcamento de tempo do COMMIT esgotado no card a card (loja %) - o resto fica na fila', NEW.tenant_id;
      RETURN NULL;
    END IF;
    BEGIN
      DELETE FROM public.kanban_recalculo_fila f
       WHERE f.modelo_id = (SELECT q.modelo_id FROM public.kanban_recalculo_fila q
                             WHERE q.modelo_id = v_id FOR UPDATE SKIP LOCKED);
      IF FOUND THEN
        PERFORM public._kanban_aplicar(NEW.tenant_id, ARRAY[v_id], 'auto', NULL);
      END IF;
    EXCEPTION WHEN query_canceled OR OTHERS THEN
      v_estado := SQLSTATE;
      RAISE WARNING 'kanban_auto: card % continua na fila (loja %): % [%]', v_id, NEW.tenant_id, SQLERRM, SQLSTATE;
      IF v_estado = '57014' THEN
        RETURN NULL;
      END IF;
    END;
  END LOOP;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public._kanban_enfileirar(_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN RETURN; END IF;
  IF coalesce(current_setting('app.kanban_sistema', true), '') <> '' THEN RETURN; END IF;
  INSERT INTO public.kanban_recalculo_fila AS f (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
    JOIN public.tenant_config tc ON tc.tenant_id = m.tenant_id AND tc.kanban_automatico
   WHERE m.id = ANY (_ids)
     AND coalesce(m.ordem_criacao_enviada, false)
     AND NOT coalesce(m.lancado, false)
   ORDER BY m.id
  -- [leves L3 fix round 1, B5] linha que SOBROU de transacao anterior (o recalculo dela falhou) e REARMADA: o UPDATE OF
  -- criado_at dispara de novo o gatilho adiado (trg_kanban_processar_fila_upd) - editar o proprio card o reprocessa. Linha ja
  -- escrita por ESTA transacao: nada (sem disparo repetido; criterio xmin, mesmo de _custo_enfileirar).
  ON CONFLICT (modelo_id) DO UPDATE SET criado_at = clock_timestamp()
   WHERE f.xmin <> pg_current_xact_id()::xid;
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
  INSERT INTO public.kanban_recalculo_fila AS f (modelo_id, tenant_id)
  SELECT m.id, m.tenant_id
    FROM public.modelos m
   WHERE m.tenant_id = _tenant
     AND coalesce(m.ordem_criacao_enviada, false)
     AND NOT coalesce(m.lancado, false)
   ORDER BY m.id
  -- [leves L3 fix round 1, B5] rearma a linha que sobrou de transacao anterior (ver _kanban_enfileirar).
  ON CONFLICT (modelo_id) DO UPDATE SET criado_at = clock_timestamp()
   WHERE f.xmin <> pg_current_xact_id()::xid;
END;
$function$;

CREATE OR REPLACE FUNCTION public._avaliar_condicoes_kanban_core(_tenant uuid, _ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    -- Planejamento
    'categoria_definida', m.categoria_principal_id is not null,
    'subcategoria1_definida', m.subcategoria1_id is not null,
    'subcategoria2_definida', m.subcategoria2_id is not null,
    'estilista_definido', m.estilista_id is not null,
    'linha_definida', m.linha_id is not null,
    'colecao_preenchida', coalesce(btrim(m.colecao),'') <> '',
    'tecido_planejado', coalesce(array_length(m.tecidos_planejados, 1), 0) > 0,
    'ordem_criacao_enviada', coalesce(m.ordem_criacao_enviada, false),
    'preco_venda_preenchido', coalesce(m.preco_venda, 0) > 0,
    'data_lancamento_preenchida', m.data_lancamento is not null,
    'lancado', coalesce(m.lancado, false),
    -- Desenvolvimento
    'modelista_definido', m.modelista_id is not null,
    'piloteiro_definido', (m.piloteiro1_id is not null or m.piloteiro2_id is not null or m.piloteiro3_id is not null),
    'data_desenho_tecnico', m.data_desenho_tecnico is not null,
    'data_piloto1', m.data_piloto1 is not null,
    'data_piloto2', m.data_piloto2 is not null,
    'data_piloto3', m.data_piloto3 is not null,
    'data_aprovacao', m.data_aprovacao is not null,
    'grade_preenchida', coalesce((select sum(g.grade_total) from modelo_grades g where g.modelo_id = m.id), 0) > 0,
    'grade_todas_variantes', (
      with vc as (
        select count(*) as n
        from modelo_tecidos mt
        join modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt.id
        where mt.modelo_id = m.id and mt.tipo = 'tecido' and mt.numero = 1
          and mtv.variante_tecido_id is not null
      )
      select vc.n > 0 and vc.n = (
        select count(distinct g.variante_numero)
        from modelo_grades g
        where g.modelo_id = m.id and coalesce(g.grade_total,0) > 0
          and g.variante_numero between 1 and vc.n
      )
      from vc),
    'tecido_com_variante', exists (
      select 1 from modelo_tecidos mt
      join modelo_tecido_variantes mtv on mtv.modelo_tecido_id = mt.id
      where mt.modelo_id = m.id and mt.tipo = 'tecido'),
    'aviamento_definido', exists (select 1 from modelo_aviamentos ma where ma.modelo_id = m.id and ma.aviamento_id is not null),
    'anexo_croqui', coalesce(m.croqui_url, '') <> '',
    'desenho_tecnico_anexado', coalesce(m.desenho_tecnico_url, '') <> '',
    'anexo_modelo', coalesce(array_length(m.fotos_modelo, 1), 0) > 0,
    'ficha_medida_anexada', coalesce(m.ficha_medida_url, '') <> '',
    'enviado_cad', coalesce(m.enviado_cad, false),
    -- CAD
    'cad_preenchido', exists (
      select 1
      from cad c
      join cad_tecidos ct on ct.cad_id = c.id
      join cad_tecido_variantes ctv on ctv.cad_tecido_id = ct.id
      where c.modelo_id = m.id
        and (coalesce(ct.tamanho_folha, 0) > 0
             or coalesce(ctv.quantidade_folhas, 0) > 0
             or coalesce(ctv.metragem_planejada, 0) > 0)
    ),
    -- Enviado para PCP = saiu da Explosão (cad.enviado_corte). Revenda satisfaz ao Enviar para PCP.
    'enviado_para_pcp', exists (select 1 from cad c where c.modelo_id = m.id and coalesce(c.enviado_corte, false)),
    -- Separar/Enviar preenchido: metragem (tecido) OU qtd a separar (aviamento) OU qtd a enviar
    -- (etiqueta/insumo) > 0 na Explosão. Revenda tem etiqueta (cad_etiquetas) → satisfaz por ela.
    'separar_enviar_preenchido', (
      exists (
        select 1 from cad c
        join cad_tecidos ct on ct.cad_id = c.id
        join cad_tecido_variantes ctv on ctv.cad_tecido_id = ct.id
        where c.modelo_id = m.id and coalesce(ctv.metragem_enviada, 0) > 0)
      or exists (
        select 1 from cad c
        join cad_aviamentos ca on ca.cad_id = c.id
        where c.modelo_id = m.id and coalesce(ca.quantidade_separar, 0) > 0)
      or exists (
        select 1 from cad c
        join cad_etiquetas ce on ce.cad_id = c.id
        where c.modelo_id = m.id and coalesce(ce.quantidade_enviar, 0) > 0)
    ),
    -- Produção / Serviços
    'servico_aprovado', coalesce(m.custo_terceirizados_aprovado, false),
    -- Variantes de gatilho de "Aprovação de custo" (Fase 3B): olham DIRETO modelo_servico_mo.
    -- DECIDIDO: nenhuma linha pendente (aprovado IS NULL). Vacuosamente true sem linhas
    -- (paridade com servico_aprovado). PREENCHIDO: ≥1 linha com valor > 0 (false sem linhas).
    'servico_mo_decidido', not exists (
      select 1 from modelo_servico_mo mm where mm.modelo_id = m.id and mm.aprovado is null),
    'servico_mo_preenchido', exists (
      select 1 from modelo_servico_mo mm where mm.modelo_id = m.id and coalesce(mm.valor, 0) > 0),
    'servico_finalizado', (
      select count(*) filter (where coalesce(pt.ativo, true)) > 0
         and count(*) filter (where coalesce(pt.ativo, true) and not (
              pt.data_entregue is not null and coalesce(pt.quantidade_enviada, 0) > 0
              and (coalesce(pt.quantidade_recebida, 0) > 0 or coalesce(pt.quantidade_defeito, 0) > 0)
            )) = 0
      from producao_terceirizados pt join cad c on c.id = pt.cad_id
      where c.modelo_id = m.id),
    'grade_cortada_lancada', exists (
      select 1
      from cad c
      join producao_terceirizados pt on pt.id = public._resolver_fonte_confeccao(c.id)
      join lateral jsonb_path_query(coalesce(pt.grade_detalhe, '{}'::jsonb), '$.*.*') cell on true
      where c.modelo_id = m.id
        and coalesce((cell->>'cortada')::numeric, 0) > 0
    ),
    'direcionamento_feito', exists (select 1 from cad c where c.modelo_id = m.id and c.direcionamento_confirmado_at is not null),
    -- CQ
    'cq_confirmado', exists (select 1 from cad c join controle_qualidade cq on cq.cad_id = c.id where c.modelo_id = m.id and cq.status = 'confirmado'),
    'cq_pos_confirmado', exists (select 1 from cad c join controle_qualidade cq on cq.cad_id = c.id where c.modelo_id = m.id and cq.status_pos = 'confirmado'),
    -- leves L3 kanban #11: bool_or (agregado) - modelo com 2+ CADs (legado) nao derruba mais o lote inteiro.
    'cq_liberado', coalesce((select bool_or(public._cq_liberado(c.id)) from cad c where c.modelo_id = m.id), false)
  )), '{}'::jsonb)
  from modelos m
  where m.tenant_id = _tenant and m.id = any(_ids);
$function$;

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
  v_status text;
  v_status_plan text;
  v_status_gate text;
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

  -- leves L3 kanban #11: serializa envios do MESMO card. Mesma chave do enforce_unique_fk de cad.modelo_id (o INSERT abaixo
  -- pede de novo a mesma trava - reentrante na mesma transacao): o 2o envio simultaneo espera o 1o e, depois do COMMIT dele,
  -- acha o CAD e segue o caminho idempotente (antes: unique_violation "Ja existe registro em cad...").
  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));

  -- Gate de etapa (configurável por loja, tenant_config.explosao_envio_status): o modelo
  -- só é enviado à Explosão A PARTIR da etapa configurada (ou de qualquer etapa POSTERIOR
  -- na ordem do board). Ausente ⇒ 'aprovado'. Órfã ⇒ fallback 'aprovado'.
  -- ERRCODE P0001 (NÃO 23514 — senão erro-mensagem.ts engole a mensagem PT).
  SELECT status_desenvolvimento, status_planejamento INTO v_status, v_status_plan FROM public.modelos WHERE id = _modelo_id;
  v_status_gate := public._kanban_status_gate(v_tenant, _modelo_id, v_status);
  -- leves L3 (R14 msg reprovado, P-190 A): com a chave ligada, card em 'reprovado' nao tem posicao (gate NULL) - o motivo e o
  -- reprovado, nao a etapa. ASCII com prefixo (a tela traduz: src/lib/erro-mensagem.ts).
  -- [fix round 1, A1 / P-213 A] reprovado = Dev OU Planejamento; reprovado no PLANEJAMENTO nunca vai a Explosao (qualquer
  -- chave - o _kanban_status_gate da 20261027140000 tambem o tira da regua; aqui fica independente dela).
  IF public._kanban_norm(v_status_plan) = 'reprovado'
     OR (v_status_gate IS NULL AND public._kanban_norm(v_status) = 'reprovado') THEN
    RAISE EXCEPTION 'reprovado_explosao: Card reprovado nao vai a Explosao' USING ERRCODE = 'P0001';
  END IF;
  SELECT g.ok, g.req_label INTO v_gate_ok, v_gate_label
    FROM public._explosao_envio_gate(v_tenant, v_status_gate) AS g;
  IF NOT COALESCE(v_gate_ok, false) THEN
    RAISE EXCEPTION 'O modelo precisa estar na etapa "%" (ou posterior) para ser enviado à Explosão.', v_gate_label
      USING ERRCODE = 'P0001';
  END IF;

  -- IDEMPOTENTE: se o CAD já existe (o save do card cria/sincroniza), NÃO recria.
  -- Só atualiza observações/ficha (se informadas) e marca o modelo como enviado à Explosão.
  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = _modelo_id ORDER BY id LIMIT 1;
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
$function$;

-- [fix round 1, B5] gatilho do rearme (sem DROP; cria so se falta - a guarda ja garantiu que, se existe, e o deste arquivo).
DO $gatilho$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.kanban_recalculo_fila'::regclass
                    AND t.tgname = 'trg_kanban_processar_fila_upd') THEN
    CREATE CONSTRAINT TRIGGER trg_kanban_processar_fila_upd
      AFTER UPDATE OF criado_at ON public.kanban_recalculo_fila
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.fn_kanban_processar_fila();
  END IF;
END $gatilho$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
  v_erros text := '';
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _l3k_md5_aceitos LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    IF NOT EXISTS (SELECT 1 FROM _l3k_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5 AND a.papel IN ('depois', 'dep')) THEN
      v_erros := v_erros || format(' [%s md5 %s]', r.assinatura, v_md5);
    END IF;
  END LOOP;
  IF v_erros <> '' THEN
    RAISE EXCEPTION 'leves_l3: pos-condicao falhou - texto inesperado:%', v_erros USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT assinatura, acl FROM _l3k_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'leves_l3: pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES ('public._avaliar_condicoes_kanban_core(uuid,uuid[])'), ('public._enviar_modelo_para_cad_core(uuid,text,text)'),
                                 ('public._kanban_enfileirar(uuid[])'), ('public._kanban_enfileirar_tenant(uuid)'),
                                 ('public._kanban_status_gate(uuid,uuid,text)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l3: % ficou executavel por PUBLIC/anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF (SELECT p.prorettype FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_kanban_processar_fila()')) <> 'trigger'::regtype THEN
    RAISE EXCEPTION 'leves_l3: fn_kanban_processar_fila deixou de ser funcao de gatilho' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgrelid = 'public.kanban_recalculo_fila'::regclass
         AND t.tgname IN ('trg_kanban_processar_fila', 'trg_kanban_processar_fila_upd') AND t.tgenabled = 'O') <> 2 THEN
    RAISE EXCEPTION 'leves_l3: os 2 gatilhos da fila (INSERT e UPDATE OF criado_at) deviam estar ligados' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
