-- Release I3c — CORREÇÃO ÚNICA do kit (P-217 A + P-220 A, dono 02/out): depois da I3b (20261030110000), (1) toda config da
-- Integração passa a ter os 3 campos NÃO obrigatórios marcados e (2) os produtos INTEGRÁVEIS ganham os 3 valores no retrato.
-- Plano .superpowers/sdd/2026-10-02-integracao-3-campos/plan.md §2 I3c. GERADA por
-- .superpowers/sdd/2026-10-02-integracao-3-campos/mig/gerar.mjs (md5 da I3b embutidos).
--   (1) P-217 A: integracao_config sem alguma das 3 chaves → campos = união ordenada pelo layout, rev + 1, 1 registro 'campos'
--       no Log por loja (detalhe {antes, depois}; quem "Sistema (campos informativos)").
--   (2) P-220 A: integracao_produtos estado = 'integravel' sem alguma das 3 chaves → campos + as que faltam; retrato v = 3 com os
--       valores de _integracao_extras (a MESMA fonte do retrato novo) na linha do produto E em cada sublinha — o resto do
--       retrato byte a byte igual (P-127 B); assinatura = _integracao_assinar(retrato); rev + 1; as 3 colunas de
--       integracao_linhas (ROW_COUNT = nº de linhas do retrato); 1 registro 'editar' no Log por produto (detalhe {reprocesso:
--       'campos_informativos', valores, assinatura_antes, assinatura_depois}; quem "Sistema (campos informativos)").
--   Backup: public._bkp_i3c_reprocesso (modelo_id, tenant_id, campos_antes, retrato_antes, assinatura_antes, rev_antes,
--   assinatura_depois) — RLS sem policy + REVOKE ALL (só o dono lê). INTEGRADOS INTOCADOS (foto md5 antes/depois de tudo o que
--   não é reprocessado — integracao_produtos e integracao_linhas).
-- Pós: 0 integráveis/configs sem as 3; toda assinatura (integrável/integrado) = HMAC(retrato); linhas da API = retrato nas 3
-- colunas; reaplicar = 0 (idempotente). Teto: > 1000 integráveis a reprocessar = PARA (o kit divide).
-- Trava: LOCK EXCLUSIVE em integracao_config/produtos/linhas (SELECT segue; marcar/voltar/confirmar/salvar config esperam o
-- COMMIT). Uma leitura da API em andamento não confirma o produto reprocessado (assinatura nova) — ele sai na próxima consulta.
-- Volta: supabase/rollback/20261030120000_integracao_3_campos_reprocesso_down.sql (LIFO: ANTES do inverso da I3b).
-- Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
  v_n integer;
BEGIN
  IF to_regclass('public.integracao_config') IS NULL OR to_regclass('public.integracao_produtos') IS NULL
     OR to_regclass('public.integracao_linhas') IS NULL OR to_regclass('public.integracao_log') IS NULL
     OR NOT (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.integracao_linhas') AND a.attname = 'colecao' AND NOT a.attisdropped) AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.integracao_linhas') AND a.attname = 'categoria_tecido' AND NOT a.attisdropped) AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.integracao_linhas') AND a.attname = 'linha' AND NOT a.attisdropped)) THEN
    RAISE EXCEPTION 'i3c: exige a I3b (20261030110000) aplicada' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_retrato_core(uuid,text[],jsonb)', '8a5275cf8c145f88e23c5158c22fdfc6'),
      ('public._integracao_layout()', '480106c786ff534affe98e2374c8ce49'),
      ('public._integracao_opcionais()', 'd70ec700a5689dc2d76cf71ce30f5a12'),
      ('public._integracao_extras(uuid)', '2de51abd64e618d40454daf45bd5135a'),
      ('public._integracao_assinar(jsonb)', 'bbe03c7d24dc3a470387c0164073146b'),
      ('public._integracao_logar(uuid,text,uuid,jsonb,text)', '52b347ee02742906c19765c46e8cfec4')
    ) AS x(f, md5) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'i3c: % com texto inesperado (md5 %) - exige a I3b (20261030110000) aplicada', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado = 'integravel' AND NOT (p.campos @> ARRAY['colecao', 'categoria_tecido', 'linha']::text[]);
  IF v_n > 1000 THEN
    RAISE EXCEPTION 'i3c: % integraveis a reprocessar (teto 1000) - dividir a janela', v_n USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

LOCK TABLE public.integracao_config, public.integracao_produtos, public.integracao_linhas IN EXCLUSIVE MODE;

-- G-MIGRATION L2: o teto é reconferido DEPOIS do LOCK (a contagem da guarda é só pré-checagem)
DO $teto$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado = 'integravel' AND NOT (p.campos @> ARRAY['colecao', 'categoria_tecido', 'linha']::text[]);
  IF v_n > 1000 THEN
    RAISE EXCEPTION 'i3c: % integraveis a reprocessar sob o LOCK (teto 1000) - dividir a janela', v_n USING ERRCODE = 'P0001';
  END IF;
END
$teto$;

CREATE TABLE IF NOT EXISTS public._bkp_i3c_reprocesso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  campos_antes text[] NOT NULL,
  retrato_antes jsonb,
  assinatura_antes text,
  rev_antes integer NOT NULL,
  assinatura_depois text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public._bkp_i3c_reprocesso IS
  'Backup da correcao unica I3c (20261030120000): integraveis reprocessados (antes/depois). So o inverso le. Nao apagar.';
ALTER TABLE public._bkp_i3c_reprocesso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_i3c_reprocesso FROM PUBLIC, anon, authenticated, service_role;

DO $reprocessa$
DECLARE
  v_opc text[] := ARRAY['colecao', 'categoria_tecido', 'linha']::text[];
  v_layout text[] := public._integracao_layout();
  cfg record;
  ip record;
  l jsonb;
  v_novos text[];
  v_add text[];
  v_ret_campos text[];
  v_ex jsonb;
  v_add_obj jsonb;
  v_linhas jsonb;
  v_ret jsonb;
  v_ass text;
  v_upd integer;
  v_ids uuid[];
  v_mids uuid[];
  v_intocados_antes text;
  v_intocados_depois text;
  v_n_cfg integer := 0;
  v_n_prod integer := 0;
BEGIN
  -- (1) P-217 A: configs
  FOR cfg IN SELECT c.tenant_id, c.campos FROM public.integracao_config c
              WHERE NOT (c.campos @> v_opc)
              ORDER BY c.tenant_id
                FOR UPDATE
  LOOP
    v_novos := ARRAY(SELECT u.x FROM unnest(v_layout) WITH ORDINALITY AS u(x, n)
                      WHERE u.x = ANY(cfg.campos || v_opc) ORDER BY u.n);
    UPDATE public.integracao_config SET campos = v_novos, rev = rev + 1, atualizado_em = now() WHERE tenant_id = cfg.tenant_id;
    PERFORM public._integracao_logar(cfg.tenant_id, 'campos', NULL,
      jsonb_build_object('antes', to_jsonb(cfg.campos), 'depois', to_jsonb(v_novos)), 'Sistema (campos informativos)');
    v_n_cfg := v_n_cfg + 1;
  END LOOP;

  -- (2) P-220 A: integráveis
  v_ids := ARRAY(SELECT p.id FROM public.integracao_produtos p
                  WHERE p.estado = 'integravel' AND NOT (p.campos @> v_opc) ORDER BY p.modelo_id);
  v_mids := ARRAY(SELECT p.modelo_id FROM public.integracao_produtos p WHERE p.id = ANY(v_ids));
  SELECT md5(coalesce((SELECT string_agg(p::text, '|' ORDER BY p.id) FROM public.integracao_produtos p WHERE p.id <> ALL(v_ids)), '')
          || '#' || coalesce((SELECT string_agg(il::text, '|' ORDER BY il.id) FROM public.integracao_linhas il
                               WHERE il.modelo_id <> ALL(v_mids)), ''))
    INTO v_intocados_antes;
  FOR ip IN
    SELECT p.id, p.tenant_id, p.modelo_id, p.campos, p.retrato, p.assinatura, p.rev
      FROM public.integracao_produtos p
     WHERE p.id = ANY(v_ids)
     ORDER BY p.modelo_id
       FOR UPDATE
  LOOP
    IF ip.retrato IS NULL OR jsonb_typeof(ip.retrato -> 'linhas') IS DISTINCT FROM 'array'
       OR jsonb_typeof(ip.retrato -> 'campos') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'i3c: integravel sem retrato valido (modelo %)', ip.modelo_id USING ERRCODE = 'P0001';
    END IF;
    v_add := ARRAY(SELECT u.x FROM unnest(v_opc) WITH ORDINALITY AS u(x, n) WHERE NOT (u.x = ANY(ip.campos)) ORDER BY u.n);
    v_novos := ARRAY(SELECT u.x FROM unnest(v_layout) WITH ORDINALITY AS u(x, n)
                      WHERE u.x = ANY(ip.campos || v_add) ORDER BY u.n);
    v_ret_campos := ARRAY(SELECT u.x FROM unnest(v_layout) WITH ORDINALITY AS u(x, n)
                           WHERE u.x = ANY(ARRAY(SELECT jsonb_array_elements_text(ip.retrato -> 'campos')) || v_add) ORDER BY u.n);
    v_ex := coalesce(public._integracao_extras(ip.modelo_id), '{}'::jsonb);
    v_add_obj := (SELECT coalesce(jsonb_object_agg(k.x, coalesce(v_ex -> k.x, 'null'::jsonb)), '{}'::jsonb) FROM unnest(v_add) AS k(x));
    v_linhas := '[]'::jsonb;
    FOR l IN SELECT e.x FROM jsonb_array_elements(ip.retrato -> 'linhas') WITH ORDINALITY AS e(x, n) ORDER BY e.n LOOP
      v_linhas := v_linhas || jsonb_build_array(jsonb_set(l, '{valores}', coalesce(l -> 'valores', '{}'::jsonb) || v_add_obj));
    END LOOP;
    v_ret := jsonb_set(jsonb_set(jsonb_set(ip.retrato, '{linhas}', v_linhas), '{campos}', to_jsonb(v_ret_campos)), '{v}', '3'::jsonb);
    v_ass := public._integracao_assinar(v_ret);
    INSERT INTO public._bkp_i3c_reprocesso (modelo_id, tenant_id, campos_antes, retrato_antes, assinatura_antes, rev_antes, assinatura_depois)
    VALUES (ip.modelo_id, ip.tenant_id, ip.campos, ip.retrato, ip.assinatura, ip.rev, v_ass);
    UPDATE public.integracao_produtos
       SET campos = v_novos, retrato = v_ret, assinatura = v_ass, rev = rev + 1, atualizado_em = now()
     WHERE id = ip.id;
    UPDATE public.integracao_linhas il
       SET colecao = CASE WHEN 'colecao' = ANY(v_add) THEN v_ex ->> 'colecao' ELSE il.colecao END,
           categoria_tecido = CASE WHEN 'categoria_tecido' = ANY(v_add) THEN v_ex ->> 'categoria_tecido' ELSE il.categoria_tecido END,
           linha = CASE WHEN 'linha' = ANY(v_add) THEN v_ex ->> 'linha' ELSE il.linha END
     WHERE il.modelo_id = ip.modelo_id;
    GET DIAGNOSTICS v_upd = ROW_COUNT;
    IF v_upd <> jsonb_array_length(v_linhas) THEN
      RAISE EXCEPTION 'i3c: linhas da API (%) diferentes do retrato (%) (modelo %)', v_upd, jsonb_array_length(v_linhas), ip.modelo_id
        USING ERRCODE = 'P0001';
    END IF;
    PERFORM public._integracao_logar(ip.tenant_id, 'editar', ip.modelo_id,
      jsonb_build_object('reprocesso', 'campos_informativos', 'valores', v_add_obj,
                         'assinatura_antes', ip.assinatura, 'assinatura_depois', v_ass),
      'Sistema (campos informativos)');
    v_n_prod := v_n_prod + 1;
  END LOOP;
  SELECT md5(coalesce((SELECT string_agg(p::text, '|' ORDER BY p.id) FROM public.integracao_produtos p WHERE p.id <> ALL(v_ids)), '')
          || '#' || coalesce((SELECT string_agg(il::text, '|' ORDER BY il.id) FROM public.integracao_linhas il
                               WHERE il.modelo_id <> ALL(v_mids)), ''))
    INTO v_intocados_depois;
  IF v_intocados_depois IS DISTINCT FROM v_intocados_antes THEN
    RAISE EXCEPTION 'i3c: integrados/outros produtos mudaram no reprocesso' USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'i3c: % config(s) com os 3 campos marcados; % integravel(is) reprocessado(s) (% registro(s) no Log)',
    v_n_cfg, v_n_prod, v_n_prod;
END
$reprocessa$;

DO $pos$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.integracao_config c WHERE NOT (c.campos @> ARRAY['colecao', 'categoria_tecido', 'linha']::text[]);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'i3c: % config(s) ainda sem os 3 campos', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado = 'integravel' AND NOT (p.campos @> ARRAY['colecao', 'categoria_tecido', 'linha']::text[]);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'i3c: % integravel(is) ainda sem os 3 campos', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado IN ('integravel', 'integrado') AND p.retrato IS NOT NULL
     AND p.assinatura IS DISTINCT FROM public._integracao_assinar(p.retrato);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'i3c: % assinatura(s) nao conferem com o retrato', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado = 'integravel' AND p.retrato IS NOT NULL
     AND ((SELECT count(*) FROM public.integracao_linhas il WHERE il.modelo_id = p.modelo_id) <> jsonb_array_length(p.retrato -> 'linhas')
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(p.retrato -> 'linhas') AS e(x)
                       LEFT JOIN public.integracao_linhas il ON il.modelo_id = p.modelo_id AND il.ordem = (e.x ->> 'ordem')::integer
                      WHERE il.id IS NULL
                         OR il.colecao IS DISTINCT FROM e.x -> 'valores' ->> 'colecao'
                         OR il.categoria_tecido IS DISTINCT FROM e.x -> 'valores' ->> 'categoria_tecido'
                         OR il.linha IS DISTINCT FROM e.x -> 'valores' ->> 'linha'));
  IF v_n > 0 THEN
    RAISE EXCEPTION 'i3c: % integravel(is) com linhas da API diferentes do retrato', v_n USING ERRCODE = 'P0001';
  END IF;
  IF has_table_privilege('anon', 'public._bkp_i3c_reprocesso', 'SELECT')
     OR has_table_privilege('authenticated', 'public._bkp_i3c_reprocesso', 'SELECT') THEN
    RAISE EXCEPTION 'i3c: backup legivel por anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
