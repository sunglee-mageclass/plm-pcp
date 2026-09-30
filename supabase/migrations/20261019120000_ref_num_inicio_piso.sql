-- Contas certas, bloco B, item 9 (kanban #16, P-162 A): o "Comecar em" (ref_config.num_inicio) da Config da Loja era
-- IGNORADO - as REFs novas seguiam o contador a partir de 10000000.
-- Causa (conferida): os 3 embrulhos _modelo_ref_next_num / _produto_acabado_ref_next / _produto_importado_ref_next estao
-- com o piso FIXO `_ref_next_global(_tenant, 10000000)` na copia E no dump de producao de 23/set, embora o repo
-- (20260916200000:21-31) use `_ref_num_inicio(_tenant)`. Hipoteses (RG1): a fase 2 nao chegou a producao, foi revertida,
-- ou a fase 1 (texto fixo) foi reaplicada depois. A guarda aceita as 3 variantes (fixo, fase 2 do repo, depois).
-- Correcao: os 3 embrulhos passam o piso da loja: `_ref_next_global(_tenant, public._ref_num_inicio(_tenant))`
-- (marcador [contas-certas 9] no corpo, para distinguir do texto da fase 2). _ref_next_global ja faz GREATEST(ultimo+1, piso):
--   loja sem config -> piso 10000000 (igual a hoje); num_inicio <= ultimo -> nada muda; num_inicio > ultimo -> salta.
--   Pool UNICO por loja (as 3 familias): o salto vale para interno, acabado e importado.
-- P-162 A: REFs EXISTENTES nao mudam (ref gravada nunca e regerada; o numero da ref_auto e fixo na chegada ao Dev, #11).
-- 9b (plano, recomendado): RPC NOVA so leitura `ref_proximo_numero(_num_inicio bigint DEFAULT NULL)` para as previas
-- (Config da Loja > Formato da REF e "+ Novo produto" do Produto Acabado): max(ultimo+1, piso) SEM consumir a sequencia.
-- DEFINER + loja do usuario; o parametro opcional e o "Comecar em" ainda nao salvo (previa do rascunho).
-- ACL (RB1): REVOKE de PUBLIC e anon + GRANT authenticated (o default ACL do schema da EXECUTE a anon/authenticated).
-- Passo 0 (producao, 30/set 11:22): os 3 embrulhos estao com o piso FIXO (igual a copia). So a Ave Rara muda de numero:
-- ultimo 10000305, "Comecar em" 100000000 (9 digitos) -> a proxima REF sai com 100000000. As outras 5 lojas nao mudam.
-- Numeracao ja emitida: a VOLTA nao devolve (REFs >= num_inicio ficam; ref_sequencia.ultimo fica acima do piso antigo).
-- Dependencias lidas (nao trocadas; md5 conferido): _ref_num_inicio(uuid), _ref_next_global(uuid,bigint).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._modelo_ref_next_num(uuid)
--     ANTES  7aaad893cc962b4d05e0fe3f77f5cf10  (texto FIXO 10000000 = copia local 30/set = PRODUCAO (Passo 0 30/set 11:22) = fase 1 20260916180000)
--     ANTES  316efe55852b3fb20df4f0673885d9cb  (texto do REPO = fase 2 20260916200000 (_ref_num_inicio); aceito por RG1)
--     PRODUCAO = 7aaad893cc962b4d05e0fe3f77f5cf10 (piso FIXO, igual a copia; texto em passo0-ref-funcoes-2026-09-30-112215.sql)  (Passo 0 somente leitura, 30/set 11:22 - passo0-funcoes-2026-09-30-112215.csv)
--     DEPOIS 0752dc9de192a431b7a241e10d00d58a  (este arquivo; reaplicar = no-op)
--   public._produto_acabado_ref_next(uuid)
--     ANTES  46abd8a2c306961c4789218235fcde64  (texto FIXO 10000000 = copia local 30/set = PRODUCAO (Passo 0 30/set 11:22) = fase 1 20260916180000)
--     ANTES  60a58b18ad41ba1f6a5d8d17e603536b  (texto do REPO = fase 2 20260916200000 (_ref_num_inicio); aceito por RG1)
--     PRODUCAO = 46abd8a2c306961c4789218235fcde64 (piso FIXO, igual a copia; texto em passo0-ref-funcoes-2026-09-30-112215.sql)  (Passo 0 somente leitura, 30/set 11:22 - passo0-funcoes-2026-09-30-112215.csv)
--     DEPOIS 83041c58e76389cab40f3f12ff5a81d0  (este arquivo; reaplicar = no-op)
--   public._produto_importado_ref_next(uuid)
--     ANTES  f79493ba5d989dc85ce21b21e02dfca2  (texto FIXO 10000000 = copia local 30/set = PRODUCAO (Passo 0 30/set 11:22) = fase 1 20260916180000)
--     ANTES  6a7581ed44b8055070a80c6db4bd0386  (texto do REPO = fase 2 20260916200000 (_ref_num_inicio); aceito por RG1)
--     PRODUCAO = f79493ba5d989dc85ce21b21e02dfca2 (piso FIXO, igual a copia; texto em passo0-ref-funcoes-2026-09-30-112215.sql)  (Passo 0 somente leitura, 30/set 11:22 - passo0-funcoes-2026-09-30-112215.csv)
--     DEPOIS 5549319a6bc74b76e7cb05c0ac37588b  (este arquivo; reaplicar = no-op)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
--   Dependencias (so conferidas, nao trocadas):
--     public._ref_num_inicio(uuid)  8bb3e4247d8db14eb0379eb4e28033b4  (copia 30/set = PRODUCAO, Passo 0 30/set 11:22)
--     public._ref_next_global(uuid,bigint)  ec89901135f6f52d24d2a764d5e72a56  (copia 30/set = PRODUCAO, Passo 0 30/set 11:22)
-- Volta: supabase/rollback/20261019120000_ref_num_inicio_piso_down.sql - recoloca o texto EXATO que estava vivo (guardado por esta
-- migration em public._bkp_funcoes_contas_certas; vale mesmo se producao != copia). Ordem de volta = LIFO da APLICACAO.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

-- ACCEPTED-MD5 (a lista unica usada pela guarda e pela pos-condicao)
CREATE TEMP TABLE _cc_md5_aceitos (assinatura text, md5 text, papel text) ON COMMIT DROP;
INSERT INTO _cc_md5_aceitos VALUES
  ('public._modelo_ref_next_num(uuid)', '7aaad893cc962b4d05e0fe3f77f5cf10', 'antes'),   -- texto FIXO 10000000 = copia local 30/set = PRODUCAO (Passo 0 30/set 11:22) = fase 1 20260916180000
  ('public._modelo_ref_next_num(uuid)', '316efe55852b3fb20df4f0673885d9cb', 'antes'),   -- texto do REPO = fase 2 20260916200000 (_ref_num_inicio); aceito por RG1
  ('public._modelo_ref_next_num(uuid)', '0752dc9de192a431b7a241e10d00d58a', 'depois'),
  ('public._produto_acabado_ref_next(uuid)', '46abd8a2c306961c4789218235fcde64', 'antes'),   -- texto FIXO 10000000 = copia local 30/set = PRODUCAO (Passo 0 30/set 11:22) = fase 1 20260916180000
  ('public._produto_acabado_ref_next(uuid)', '60a58b18ad41ba1f6a5d8d17e603536b', 'antes'),   -- texto do REPO = fase 2 20260916200000 (_ref_num_inicio); aceito por RG1
  ('public._produto_acabado_ref_next(uuid)', '83041c58e76389cab40f3f12ff5a81d0', 'depois'),
  ('public._produto_importado_ref_next(uuid)', 'f79493ba5d989dc85ce21b21e02dfca2', 'antes'),   -- texto FIXO 10000000 = copia local 30/set = PRODUCAO (Passo 0 30/set 11:22) = fase 1 20260916180000
  ('public._produto_importado_ref_next(uuid)', '6a7581ed44b8055070a80c6db4bd0386', 'antes'),   -- texto do REPO = fase 2 20260916200000 (_ref_num_inicio); aceito por RG1
  ('public._produto_importado_ref_next(uuid)', '5549319a6bc74b76e7cb05c0ac37588b', 'depois'),
  ('public._ref_num_inicio(uuid)', '8bb3e4247d8db14eb0379eb4e28033b4', 'dep'),   -- dependencia lida, nao trocada (copia 30/set = producao, Passo 0 30/set 11:22)
  ('public._ref_next_global(uuid,bigint)', 'ec89901135f6f52d24d2a764d5e72a56', 'dep')   -- dependencia lida, nao trocada (copia 30/set = producao, Passo 0 30/set 11:22)
;

-- Copia do texto vivo de cada funcao trocada (para a volta; vale mesmo se producao != copia).
-- RLS ligada SEM policy + REVOKE ALL: so o dono (postgres) le.
CREATE TABLE IF NOT EXISTS public._bkp_funcoes_contas_certas (
  migracao    text        NOT NULL,
  assinatura  text        NOT NULL,
  md5         text        NOT NULL,
  definicao   text        NOT NULL,
  guardado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (migracao, assinatura)
);
ALTER TABLE public._bkp_funcoes_contas_certas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_funcoes_contas_certas FROM PUBLIC, anon, authenticated;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
  v_papel text;
BEGIN
  FOR r IN SELECT DISTINCT assinatura FROM _cc_md5_aceitos LOOP
    IF to_regprocedure(r.assinatura) IS NULL THEN
      RAISE EXCEPTION 'contas_certas_9: % nao existe neste banco', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.assinatura)));
    SELECT a.papel INTO v_papel FROM _cc_md5_aceitos a WHERE a.assinatura = r.assinatura AND a.md5 = v_md5 LIMIT 1;
    IF v_papel IS NULL THEN
      RAISE EXCEPTION 'contas_certas_9: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.assinatura, v_md5
        USING ERRCODE = 'P0001';
    END IF;
    IF v_papel = 'antes' THEN
      INSERT INTO public._bkp_funcoes_contas_certas (migracao, assinatura, md5, definicao)
      VALUES ('20261019120000', r.assinatura, v_md5, pg_get_functiondef(to_regprocedure(r.assinatura)))
      ON CONFLICT (migracao, assinatura) DO NOTHING;
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public._modelo_ref_next_num(_tenant uuid)
 RETURNS bigint LANGUAGE sql
AS $function$ SELECT public._ref_next_global(_tenant, public._ref_num_inicio(_tenant)); /* [contas-certas 9] piso = "Comecar em" da loja */ $function$;

CREATE OR REPLACE FUNCTION public._produto_acabado_ref_next(_tenant uuid)
 RETURNS bigint LANGUAGE sql
AS $function$ SELECT public._ref_next_global(_tenant, public._ref_num_inicio(_tenant)); /* [contas-certas 9] piso = "Comecar em" da loja */ $function$;

CREATE OR REPLACE FUNCTION public._produto_importado_ref_next(_tenant uuid)
 RETURNS bigint LANGUAGE sql
AS $function$ SELECT public._ref_next_global(_tenant, public._ref_num_inicio(_tenant)); /* [contas-certas 9] piso = "Comecar em" da loja */ $function$;

-- Invariante #9: os 3 embrulhos seguem so para os gatilhos DEFINER (REVOKE dos TRES reafirmado).
REVOKE EXECUTE ON FUNCTION public._modelo_ref_next_num(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._produto_acabado_ref_next(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._produto_importado_ref_next(uuid) FROM PUBLIC, anon, authenticated;

-- 9b: previa do proximo numero (RPC nova, so leitura).
CREATE OR REPLACE FUNCTION public.ref_proximo_numero(_num_inicio bigint DEFAULT NULL::bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [contas-certas 9b] Previa SO LEITURA do proximo numero de REF da loja do usuario: max(ultimo + 1, piso), a MESMA
-- conta de _ref_next_global, SEM consumir a sequencia (nao grava, nao trava). Piso = "Comecar em" salvo da loja
-- (_ref_num_inicio) ou, quando a tela manda, o valor ainda nao salvo que a pessoa esta digitando (_num_inicio).
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_ultimo bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT rs.ultimo INTO v_ultimo FROM public.ref_sequencia rs WHERE rs.tenant_id = v_tenant;
  RETURN GREATEST(COALESCE(v_ultimo, 0) + 1, COALESCE(_num_inicio, public._ref_num_inicio(v_tenant)));
END
$function$;

REVOKE EXECUTE ON FUNCTION public.ref_proximo_numero(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ref_proximo_numero(bigint) TO authenticated;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT assinatura, md5 FROM _cc_md5_aceitos WHERE papel = 'depois' LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.assinatura))) IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'contas_certas_9: pos-condicao falhou - % nao ficou com o texto deste arquivo', r.assinatura USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public._bkp_funcoes_contas_certas b WHERE b.migracao = '20261019120000' AND b.assinatura = r.assinatura) THEN
      RAISE EXCEPTION 'contas_certas_9: copia do texto de antes de % nao foi guardada (a volta nao teria o que restaurar)', r.assinatura
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF md5(pg_get_functiondef('public.ref_proximo_numero(bigint)'::regprocedure)) IS DISTINCT FROM '2aa82c7778515a91f9d33bf33bbb9f6e' THEN
    RAISE EXCEPTION 'contas_certas_9: ref_proximo_numero nao ficou com o texto deste arquivo' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.ref_proximo_numero(bigint)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ref_proximo_numero(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'contas_certas_9: ACL de ref_proximo_numero errada (anon nao pode; authenticated pode)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT unnest(ARRAY['public._modelo_ref_next_num(uuid)', 'public._produto_acabado_ref_next(uuid)',
                               'public._produto_importado_ref_next(uuid)']) AS s LOOP
    IF has_function_privilege('anon', r.s, 'EXECUTE') OR has_function_privilege('authenticated', r.s, 'EXECUTE') THEN
      RAISE EXCEPTION 'contas_certas_9: % ficou executavel por anon/authenticated', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
