-- Inverso NEUTRO de supabase/migrations/20261103192000_urg_r9_peca_teste_base.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-c.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md (Task 1 / R9a; Rulings 1-6, 10, 15, 29, 31) + spec-r9.md.
-- NEUTRO: as 2 funcoes de gatilho viram texto neutro (RETURN NEW na trava; RETURN NULL na regressao; ACL/DEFINER iguais) e o
-- trg_kanban_fila_upd volta ao WHEN de ANTES (35a23318; so reescreve se ainda nao estiver ANTES). Coluna, tabela, gatilhos e
-- dados FICAM (inertes com o site voltado). Idempotente (2a vez = no-op). Remover de fato = _down_drop (opcional, depois).
-- Trava (MEDIDA, mesma receita): com o gatilho em DEPOIS, ShareRowExclusive SO em categorias_terceirizado (CREATE OR REPLACE
-- TRIGGER; ~3 ms - ESCRITA no Cadastro de servicos espera os ms); 2a vez (ja voltado) = so catalogo, nenhuma trava de tabela.
-- As 2 funcoes = CREATE OR REPLACE (so catalogo). NENHUMA trava em auth/storage/realtime. Qualquer hora.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_peca_teste_regredir() (NOVA)
--     ANTES  ausente
--     DEPOIS 9f8ff2ef6d9a31827798470dc73d392b
--     NEUTRO 9060f2c49f9ebfb7c5e76d393302fd7c (_down)
--   public.fn_peca_teste_trava_fornecedor() (NOVA)
--     ANTES  ausente
--     DEPOIS eda05ebed95f51f554afe210a5f28c89
--     NEUTRO 4b41dd70f4751bd076f6468f2c001c23 (_down)
--   gatilho trg_kanban_fila_upd ON public.categorias_terceirizado (md5 do pg_get_triggerdef)
--     ANTES  35a23318e5e44ce6af558686b275115e
--     DEPOIS da0bdd092856df54079eeb3b3dbab171
--   gatilho trg_colab_rev ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS fb2990d55e0ab7d2d7d5016c2db6267c
--   gatilho audit_modelo_peca_teste_tentativas ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS e9bd9ead4f5b4da3afd42be8a7949b16
--   gatilho trg_empresa_tenant ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS ea84155f0d24d817a41bfb65127cb888
--   gatilho trg_peca_teste_fila_ins ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS 8e14d2be9570c201b6a75cd301a50414
--   gatilho trg_peca_teste_fila_upd ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS dc8fe559e89f950f5b000840fcf7448f
--   gatilho trg_peca_teste_fila_del ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS feb9c988298b2d2b4febb46f03e7f311
--   gatilho trg_peca_teste_regredir ON public.modelo_peca_teste_tentativas (NOVO)  DEPOIS e11d48b36b01b420616c78df17b05c04
--   gatilho trg_peca_teste_trava_fornecedor ON public.modelo_servico_mo (NOVO)  DEPOIS 1a6977ae9829a7725c3c53ed2467dbfa
--   tabela public.modelo_peca_teste_tentativas (NOVA): colunas 2f8ac5920d24485af979ee9a988837c7  constraints dab2afbd30384894aa1d25706796f803  indices 01174a02aade17acf2501dbc7e661815
--   dependencias FIXADAS (nao redefinidas):
--     public.enforce_servico_mo_aprovacao() 1643b69db26e2034905866356b80232e
--     public._salvar_modelo_servico_mo_core(uuid,jsonb) 1a4c045651694a64c3a99de522b7be53
--     public.fn_kanban_fila_por_modelo() 83b837afaaab012d00afc37cea9b3572
--     public.fn_kanban_fila_categoria() d3c2830087a8e42e72c1fc5eb9d59944
--     public._kanban_regredir_modelo(uuid) 77298f6a39fbd9de8954db7b961d83c9
--     public.fn_colab_touch_rev() 292f1a1077df1e08fdca7f21eb0d856c
--     public.fn_audit() 63e5855f24d17914aef609e35ffc499b
--     public.enforce_empresa_tenant() 85c056ec2f65fb0bc3bdab8d6cd7d713
-- ====================================================================================
-- Volta (LIFO): este arquivo DEPOIS dos _down da 196000..193000 e ANTES do 20261103191000_down. DROP: supabase/rollback/20261103192000_urg_r9_peca_teste_base_down_drop.sql (opcional).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  v := (SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
       WHERE t.tgrelid = to_regclass('public.categorias_terceirizado') AND t.tgname = 'trg_kanban_fila_upd' AND NOT t.tgisinternal);
  IF v IS NULL OR v NOT IN ('35a23318e5e44ce6af558686b275115e', 'da0bdd092856df54079eeb3b3dbab171') THEN
    RAISE EXCEPTION 'urg_r9a_down: gatilho trg_kanban_fila_upd com texto inesperado (md5 %) - outra frente mexeu', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_peca_teste_regredir()', '9f8ff2ef6d9a31827798470dc73d392b', '9060f2c49f9ebfb7c5e76d393302fd7c'),
      ('public.fn_peca_teste_trava_fornecedor()', 'eda05ebed95f51f554afe210a5f28c89', '4b41dd70f4751bd076f6468f2c001c23')
    ) AS x(f, d, n) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL THEN
      RAISE EXCEPTION 'urg_r9a_down: % ausente - a 20261103192000 nao foi aplicada aqui (ou o _down_drop ja rodou)', r.f USING ERRCODE = 'P0001';
    END IF;
    IF v NOT IN (r.d, r.n) THEN
      RAISE EXCEPTION 'urg_r9a_down: % com texto inesperado (md5 %) - outra frente mexeu', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- as 2 funcoes de gatilho no texto NEUTRO (os gatilhos ficam, inertes; ACL/DEFINER/search_path preservados)
CREATE OR REPLACE FUNCTION public.fn_peca_teste_regredir()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9a] NEUTRA (_down da 20261103192000): nada a regredir; o gatilho fica, inerte.
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.fn_peca_teste_trava_fornecedor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r9a] NEUTRA (_down da 20261103192000): o fornecedor nao trava; o gatilho fica, inerte.
  RETURN NEW;
END $function$;

-- trg_kanban_fila_upd de volta ao WHEN de ANTES (so reescreve se ainda nao estiver ANTES: a 2a volta nao pega trava nenhuma)
DO $gatilho$
BEGIN
  IF (SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
       WHERE t.tgrelid = to_regclass('public.categorias_terceirizado') AND t.tgname = 'trg_kanban_fila_upd' AND NOT t.tgisinternal) IS DISTINCT FROM '35a23318e5e44ce6af558686b275115e' THEN
    EXECUTE $ddl$CREATE OR REPLACE TRIGGER trg_kanban_fila_upd AFTER UPDATE ON public.categorias_terceirizado FOR EACH ROW WHEN (((old.etapa IS DISTINCT FROM new.etapa) OR ((old.nome)::text IS DISTINCT FROM (new.nome)::text) OR (old.ativo IS DISTINCT FROM new.ativo))) EXECUTE FUNCTION public.fn_kanban_fila_categoria()$ddl$;
  END IF;
END
$gatilho$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  IF (SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
       WHERE t.tgrelid = to_regclass('public.categorias_terceirizado') AND t.tgname = 'trg_kanban_fila_upd' AND NOT t.tgisinternal) IS DISTINCT FROM '35a23318e5e44ce6af558686b275115e' THEN
    RAISE EXCEPTION 'urg_r9a_down: pos-condicao falhou no gatilho trg_kanban_fila_upd (nao voltou a ANTES)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_peca_teste_regredir()', '9f8ff2ef6d9a31827798470dc73d392b', '9060f2c49f9ebfb7c5e76d393302fd7c'),
      ('public.fn_peca_teste_trava_fornecedor()', 'eda05ebed95f51f554afe210a5f28c89', '4b41dd70f4751bd076f6468f2c001c23')
    ) AS x(f, d, n) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 'urg_r9a_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.n USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r9a_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
