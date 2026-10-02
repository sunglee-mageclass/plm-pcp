-- Inverso de supabase/migrations/20261030120000_integracao_3_campos_reprocesso.sql (correção única I3c) — GERADO por .superpowers/sdd/2026-10-02-integracao-3-campos/mig/gerar.mjs. Ordem:
--   1. guarda: tabelas + backup existem; _integracao_assinar/_integracao_logar com o md5 esperado.
--   2. LOCK (o mesmo da ida). Produtos: para cada modelo do backup (a linha MAIS NOVA cuja assinatura_depois = a assinatura
--      atual), SÓ quem segue 'integravel' com essa assinatura volta ao campos/retrato/assinatura de antes (a assinatura de antes
--      é reconferida = HMAC(retrato de antes), senão RAISE), rev + 1, as 3 colunas de integracao_linhas que a ida preencheu
--      voltam a NULL, 1 'editar' no Log ("Sistema (volta campos informativos)"). Integrado DEPOIS da ida (ou voltado/remarcado)
--      FICA e é RELATADO (NOTICE com a contagem).
--   3. Configs: onde a diferença é EXATAMENTE a da ida (há um 'campos' da ida "Sistema (campos informativos)" cujo depois = o
--      campos atual), volta ao antes daquele registro, rev + 1, Log "Sistema (volta campos informativos)". Config mudada por
--      alguém depois da ida FICA (NOTICE).
-- O backup _bkp_i3c_reprocesso FICA (histórico). LIFO: rode este ANTES do inverso da I3b (supabase/rollback/20261030110000_integracao_3_campos_down.sql, que recusa enquanto houver
-- integrável reprocessado). Sem DROP. Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  IF to_regclass('public._bkp_i3c_reprocesso') IS NULL OR to_regclass('public.integracao_produtos') IS NULL
     OR NOT (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.integracao_linhas') AND a.attname = 'colecao' AND NOT a.attisdropped) AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.integracao_linhas') AND a.attname = 'categoria_tecido' AND NOT a.attisdropped) AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = to_regclass('public.integracao_linhas') AND a.attname = 'linha' AND NOT a.attisdropped)) THEN
    RAISE EXCEPTION 'i3c_volta: backup ou colunas ausentes - a I3c nunca rodou aqui' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_assinar(jsonb)', 'bbe03c7d24dc3a470387c0164073146b'),
      ('public._integracao_logar(uuid,text,uuid,jsonb,text)', '52b347ee02742906c19765c46e8cfec4')
    ) AS x(f, md5) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'i3c_volta: % com texto inesperado (md5 %)', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

LOCK TABLE public.integracao_config, public.integracao_produtos, public.integracao_linhas IN EXCLUSIVE MODE;

DO $restaura$
DECLARE
  b record;
  p record;
  cfg record;
  g record;
  v_upd integer;
  v_n integer := 0;
  v_relatados integer := 0;
  v_cfg integer := 0;
  v_cfg_ficam integer := 0;
BEGIN
  FOR b IN
    SELECT DISTINCT ON (k.modelo_id) k.*
      FROM public._bkp_i3c_reprocesso k
      JOIN public.integracao_produtos x ON x.modelo_id = k.modelo_id AND x.tenant_id = k.tenant_id AND x.assinatura = k.assinatura_depois
     ORDER BY k.modelo_id, k.criado_em DESC, k.id
  LOOP
    SELECT ip.id, ip.estado, ip.assinatura INTO p FROM public.integracao_produtos ip
     WHERE ip.modelo_id = b.modelo_id AND ip.tenant_id = b.tenant_id FOR UPDATE;
    IF p.estado IS DISTINCT FROM 'integravel' OR p.assinatura IS DISTINCT FROM b.assinatura_depois THEN
      v_relatados := v_relatados + 1;
      RAISE NOTICE 'i3c_volta: modelo % ficou como esta (estado %) - integrado/mudado depois da ida', b.modelo_id, p.estado;
      CONTINUE;
    END IF;
    IF b.retrato_antes IS NULL OR public._integracao_assinar(b.retrato_antes) IS DISTINCT FROM b.assinatura_antes THEN
      RAISE EXCEPTION 'i3c_volta: assinatura de antes nao confere com o retrato do backup (modelo %)', b.modelo_id USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.integracao_produtos
       SET campos = b.campos_antes, retrato = b.retrato_antes, assinatura = b.assinatura_antes, rev = rev + 1, atualizado_em = now()
     WHERE id = p.id;
    UPDATE public.integracao_linhas il
       SET colecao = CASE WHEN 'colecao' = ANY(b.campos_antes) THEN il.colecao END,
           categoria_tecido = CASE WHEN 'categoria_tecido' = ANY(b.campos_antes) THEN il.categoria_tecido END,
           linha = CASE WHEN 'linha' = ANY(b.campos_antes) THEN il.linha END
     WHERE il.modelo_id = b.modelo_id;
    GET DIAGNOSTICS v_upd = ROW_COUNT;
    IF v_upd <> jsonb_array_length(b.retrato_antes -> 'linhas') THEN
      RAISE EXCEPTION 'i3c_volta: linhas da API (%) diferentes do retrato (modelo %)', v_upd, b.modelo_id USING ERRCODE = 'P0001';
    END IF;
    PERFORM public._integracao_logar(b.tenant_id, 'editar', b.modelo_id,
      jsonb_build_object('reprocesso', 'campos_informativos_volta', 'assinatura_antes', b.assinatura_depois,
                         'assinatura_depois', b.assinatura_antes),
      'Sistema (volta campos informativos)');
    v_n := v_n + 1;
  END LOOP;
  -- reprocessados que já não batem com o backup (integrados/voltados/remarcados depois da ida): relatados
  SELECT v_relatados + count(DISTINCT k.modelo_id) INTO v_relatados
    FROM public._bkp_i3c_reprocesso k
   WHERE NOT EXISTS (SELECT 1 FROM public._bkp_i3c_reprocesso k2
                       JOIN public.integracao_produtos x2 ON x2.modelo_id = k2.modelo_id AND x2.tenant_id = k2.tenant_id
                                                       AND x2.assinatura IN (k2.assinatura_depois, k2.assinatura_antes)
                      WHERE k2.modelo_id = k.modelo_id);

  FOR cfg IN SELECT c.tenant_id, c.campos FROM public.integracao_config c
              WHERE c.campos @> ARRAY['colecao', 'categoria_tecido', 'linha']::text[]
              ORDER BY c.tenant_id
                FOR UPDATE
  LOOP
    SELECT lg.detalhe INTO g FROM public.integracao_log lg
     WHERE lg.tenant_id = cfg.tenant_id AND lg.acao = 'campos' AND lg.modelo_id IS NULL
       AND lg.quem = 'Sistema (campos informativos)' AND lg.detalhe -> 'depois' = to_jsonb(cfg.campos)
     ORDER BY lg.criado_em DESC, lg.id
     LIMIT 1;
    IF NOT FOUND THEN
      v_cfg_ficam := v_cfg_ficam + 1;
      CONTINUE;
    END IF;
    UPDATE public.integracao_config
       SET campos = ARRAY(SELECT jsonb_array_elements_text(g.detalhe -> 'antes')), rev = rev + 1, atualizado_em = now()
     WHERE tenant_id = cfg.tenant_id;
    PERFORM public._integracao_logar(cfg.tenant_id, 'campos', NULL,
      jsonb_build_object('antes', to_jsonb(cfg.campos), 'depois', g.detalhe -> 'antes'), 'Sistema (volta campos informativos)');
    v_cfg := v_cfg + 1;
  END LOOP;
  RAISE NOTICE 'i3c_volta: % integravel(is) devolvido(s); % relatado(s) (ficam); % config(s) devolvida(s); % config(s) com os 3 mudadas por alguem (ficam)',
    v_n, v_relatados, v_cfg, v_cfg_ficam;
END
$restaura$;

DO $pos$
DECLARE
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public._bkp_i3c_reprocesso b
    JOIN public.integracao_produtos p ON p.modelo_id = b.modelo_id AND p.tenant_id = b.tenant_id
   WHERE p.estado = 'integravel' AND p.assinatura = b.assinatura_depois;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'i3c_volta: % integravel(is) ainda reprocessado(s)', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado IN ('integravel', 'integrado') AND p.retrato IS NOT NULL
     AND p.assinatura IS DISTINCT FROM public._integracao_assinar(p.retrato);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'i3c_volta: % assinatura(s) nao conferem com o retrato', v_n USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
