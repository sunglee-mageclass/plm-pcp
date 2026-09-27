-- Integração + API — 3/6: ESTADOS e LOG (spec §4, §5, §9). Só funções.
-- integracao_marcar: recalcula o retrato com trava de linha (advisory lock sku_modelo:<id> IGUAL aos gravadores de SKU
-- + modelos FOR NO KEY UPDATE + integracao_produtos FOR UPDATE, ordem estável), compara a
-- assinatura HMAC do resumo (diferente = P0409 integracao_mudou, ASCII), exige completo e não reprovado (D9), P-75 A
-- (Preço de custo marcado ⇒ só quem vê custos), grava estado + retrato + ESPELHO + log 'integrar', atômico. NÃO compara
-- modelos.rev (D10). integracao_voltar: só de integrável (P-63 A), individual ou em massa, atômico, apaga o espelho.
-- integracao_desfazer: SÓ super admin, só integrado (D27), motivo obrigatório, log com o retrato antigo inteiro.
-- integracao_log_listar: Log por papel (N11) + custo mascarado no retrato do log (inv. #12).
-- Revisão T3 #1 (Important #1): marcar serializa com os gravadores de SKU (_aplicar_skus_modelo_core/
-- _gerar_skus_modelo_core/_salvar_sku_manual_core) via o MESMO pg_advisory_xact_lock('sku_modelo:'||id), tomado ANTES
-- do lock de linha em modelos — senão um Regerar/Salvar concorrente grava SKUs novos sem que marcar perceba (a trava
-- de modelos é só FOR NO KEY UPDATE, que não conflita com o KEY SHARE que os gravadores tomam via FK).
-- Contagens: +6 funções | +0 gatilhos. Inverso: supabase/rollback/20261007120000_integracao_3_estados_down.sql.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
BEGIN
  IF to_regprocedure('public._integracao_retrato_core(uuid,text[],jsonb)') IS NULL THEN
    RAISE EXCEPTION 'integracao_3: aplique a migration 2 antes' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._integracao_quem()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(nullif(btrim(u.nome::text), ''), u.email::text, 'usuário')
         || CASE WHEN public.is_super_admin() THEN ' (super admin)' ELSE '' END
    FROM public.users u
   WHERE u.id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public._integracao_logar(_tenant uuid, _acao text, _modelo_id uuid, _detalhe jsonb, _quem text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO public.integracao_log (tenant_id, acao, usuario_id, quem, modelo_id, modelo_nome, detalhe)
  VALUES (_tenant, _acao, auth.uid(), coalesce(_quem, public._integracao_quem(), 'sistema'), _modelo_id,
          (SELECT m.nome::text FROM public.modelos m WHERE m.id = _modelo_id), coalesce(_detalhe, '{}'::jsonb))
$function$;

CREATE OR REPLACE FUNCTION public.integracao_marcar(_itens jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(true);
  v_cfg public.integracao_config;
  v_ids uuid[];
  v_id uuid;
  v_custos jsonb;
  v_loja text;
  v_ret jsonb;
  v_ass text;
  v_chaves uuid[];
  v_n integer := 0;
  r record;
BEGIN
  IF jsonb_typeof(_itens) IS DISTINCT FROM 'array' OR jsonb_array_length(_itens) = 0 OR jsonb_array_length(_itens) > 200 THEN
    RAISE EXCEPTION 'Envie de 1 a 200 produtos para integrar.' USING ERRCODE = 'P0001';
  END IF;
  -- Revisão T3 #3 (Minor #3): modelo_id duplicado no payload tornaria o DISTINCT ON abaixo não-determinístico
  -- (2 assinaturas diferentes pro mesmo produto — qual vale?); recusa cedo, ANTES de qualquer trava.
  -- resíduos T7 #6 (T3 C, ruling do controlador): (a) item SEM modelo_id é recusado com mensagem PRÓPRIA, ANTES do
  -- check de duplicata (senão 2 itens sem modelo_id caem no check de baixo com count(DISTINCT NULL)=0, que NUNCA
  -- bate com count(*), e o usuário veria "Produto repetido" para um erro que não é sobre repetição); (b) a
  -- comparação de duplicata agora casta pra uuid ANTES do DISTINCT — um mesmo UUID em caixa alta/baixa
  -- (ex.: 'ABC...' vs 'abc...') tem representação TEXTUAL diferente mas é o MESMO produto; sem o cast, count(DISTINCT
  -- text) contaria os 2 como produtos diferentes e o duplicado passaria batido.
  -- ruling do controlador, revisão T7 #11 (fix round 1, Minor 3): o mesmo check agora recusa também um modelo_id
  -- que NÃO é string (número, objeto, array, jsonb null) e uma string que não tem cara de uuid — ANTES do cast
  -- ::uuid mais abaixo, que doutra forma estouraria 22P02 cru (sem tradução PT). Comportamento ESCOLHIDO (documentado
  -- aqui, não é acidental): o formato aceito é o MESMO que o cast ::uuid do Postgres aceita de fato — 32 hex, com OU
  -- sem os hifens 8-4-4-4-12, opcionalmente entre chaves ('{...}') — não só a grafia canônica com hifens. Uma string
  -- MAIS RESTRITIVA (só a forma com hifens) rejeitaria como "sem modelo_id" um id que o ::uuid abaixo aceitaria de
  -- bom grado, recusando por engano uma requisição válida só por causa da formatação. O count(DISTINCT ...::uuid) e
  -- os JOINs abaixo continuam castando a MESMA string (agora garantidamente aceita pelo cast) — nada muda ali.
  IF (SELECT count(*) FILTER (WHERE jsonb_typeof(e.x -> 'modelo_id') IS DISTINCT FROM 'string'
                                  OR NOT (e.x ->> 'modelo_id' ~* '^\{?([0-9a-f]{8})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{4})-?([0-9a-f]{12})\}?$'))
        FROM jsonb_array_elements(_itens) AS e(x)) > 0 THEN
    RAISE EXCEPTION 'Envie o modelo_id de cada produto.' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(_itens) AS e(x)) <>
     (SELECT count(DISTINCT (e.x ->> 'modelo_id')::uuid) FROM jsonb_array_elements(_itens) AS e(x)) THEN
    RAISE EXCEPTION 'Produto repetido na lista — envie cada produto uma vez só.' USING ERRCODE = 'P0001';
  END IF;
  v_cfg := public._integracao_cfg(v_tenant);
  -- P-75 A: com "Preço de custo" marcado, só integra quem pode VER custos
  IF 'preco_custo' = ANY(v_cfg.campos) AND NOT public._pode_ver_custos() THEN
    RAISE EXCEPTION 'integracao_sem_custo: preco de custo marcado exige ver custos' USING ERRCODE = '42501';
  END IF;
  v_ids := ARRAY(SELECT DISTINCT (e.x ->> 'modelo_id')::uuid FROM jsonb_array_elements(_itens) AS e(x) ORDER BY 1);
  IF (SELECT count(*) FROM public.modelos m WHERE m.id = ANY(v_ids) AND m.tenant_id = v_tenant) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'Produto não encontrado nesta loja.' USING ERRCODE = 'P0001';
  END IF;
  -- Revisão T3 #1 (Important #1, plan-mandated): serializa com os gravadores de SKU ANTES do lock de linha em
  -- modelos — mesma chave ('sku_modelo:'||id), MESMO hashtextextended, loop FOREACH (não PERFORM…FROM unnest: o
  -- planner pode avaliar a função volátil do target-list antes do ORDER BY). v_ids já vem ordenado (linha acima),
  -- então 2 marcar em massa concorrentes pedem as travas na MESMA ordem — sem deadlock com eles mesmos nem com os
  -- gravadores de SKU (que travam 1 modelo por vez).
  FOREACH v_id IN ARRAY v_ids LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended('sku_modelo:' || v_id::text, 0));
  END LOOP;
  -- trava em ordem estável (2 integrações em massa não se travam mutuamente) e serializa com a edição do card (§9)
  -- N3 (G-plano do plano): FOR NO KEY UPDATE basta (não bloqueia FKs que apontam para modelos)
  PERFORM 1 FROM public.modelos m WHERE m.id = ANY(v_ids) ORDER BY m.id FOR NO KEY UPDATE;
  PERFORM 1 FROM public.integracao_produtos ip WHERE ip.modelo_id = ANY(v_ids) ORDER BY ip.modelo_id FOR UPDATE;
  v_custos := coalesce(public._custo_unitario_modelos_core(v_ids), '{}'::jsonb);
  SELECT t.nome INTO v_loja FROM public.tenants t WHERE t.id = v_tenant;
  FOR r IN
    SELECT DISTINCT ON (m.id) m.id AS modelo_id, e.x ->> 'assinatura' AS assinatura, m.nome AS nome,
           coalesce(ip.estado, 'nao_integravel') AS estado, ip.id AS ip_id,
           (coalesce(m.status_planejamento, '') = 'reprovado'
            OR lower(btrim(coalesce(m.status_desenvolvimento, ''))) = 'reprovado') AS reprovado
      FROM jsonb_array_elements(_itens) AS e(x)
      JOIN public.modelos m ON m.id = (e.x ->> 'modelo_id')::uuid
      LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = m.id
     ORDER BY m.id
  LOOP
    IF r.estado <> 'nao_integravel' THEN
      RAISE EXCEPTION 'integracao_mudou: produto % ja esta %', r.modelo_id, r.estado USING ERRCODE = 'P0409';
    END IF;
    IF r.reprovado THEN
      RAISE EXCEPTION 'O produto "%" está reprovado e não pode ser integrado.', r.nome USING ERRCODE = 'P0001';
    END IF;
    v_ret := public._integracao_retrato_core(r.modelo_id, v_cfg.campos, v_custos -> r.modelo_id::text);
    v_ass := public._integracao_assinar(v_ret -> 'retrato');
    IF v_ass IS DISTINCT FROM r.assinatura THEN
      RAISE EXCEPTION 'integracao_mudou: produto % mudou desde o resumo', r.modelo_id USING ERRCODE = 'P0409';
    END IF;
    IF NOT (v_ret ->> 'completo')::boolean THEN
      RAISE EXCEPTION 'O produto "%" está incompleto — faltam: %.', r.nome,
        (SELECT string_agg(f.x ->> 'texto', ', ') FROM jsonb_array_elements(v_ret -> 'faltas') AS f(x))
        USING ERRCODE = 'P0001';
    END IF;
    v_chaves := CASE WHEN jsonb_typeof(v_ret -> 'variantes_chaves') = 'array'
                     THEN ARRAY(SELECT k.x::uuid FROM jsonb_array_elements_text(v_ret -> 'variantes_chaves') AS k(x)) END;
    IF r.ip_id IS NULL THEN
      INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, retrato, assinatura, variantes_chaves,
                                              marcado_por, marcado_em)
      VALUES (v_tenant, r.modelo_id, 'integravel', v_cfg.campos, v_ret -> 'retrato', v_ass, v_chaves, auth.uid(), now());
    ELSE
      UPDATE public.integracao_produtos
         SET estado = 'integravel', campos = v_cfg.campos, retrato = v_ret -> 'retrato', assinatura = v_ass,
             variantes_chaves = v_chaves, marcado_por = auth.uid(), marcado_em = now(), integrado_em = NULL,
             integrado_chave_id = NULL, rev = rev + 1, atualizado_em = now()
       WHERE id = r.ip_id;
    END IF;
    DELETE FROM public.integracao_linhas WHERE modelo_id = r.modelo_id;
    INSERT INTO public.integracao_linhas (tenant_id, loja_nome, modelo_id, tipo, ordem, nome, ref_sku, preco_anterior,
      preco_venda, peso, ncm, preco_custo, cor_base, cor_apelido, tamanho, titulo, descricao, keywords, metatag,
      comprimento, largura, altura, fotos)
    SELECT v_tenant, coalesce(v_loja, ''), r.modelo_id, l.x ->> 'tipo', (l.x ->> 'ordem')::integer,
           l.x -> 'valores' ->> 'nome', l.x -> 'valores' ->> 'ref_sku', l.x -> 'valores' ->> 'preco_anterior',
           l.x -> 'valores' ->> 'preco_venda', l.x -> 'valores' ->> 'peso', l.x -> 'valores' ->> 'ncm',
           l.x -> 'valores' ->> 'preco_custo', l.x -> 'valores' ->> 'cor_base', l.x -> 'valores' ->> 'cor_apelido',
           l.x -> 'valores' ->> 'tamanho', l.x -> 'valores' ->> 'titulo', l.x -> 'valores' ->> 'descricao',
           l.x -> 'valores' ->> 'keywords', l.x -> 'valores' ->> 'metatag', l.x -> 'valores' ->> 'comprimento',
           l.x -> 'valores' ->> 'largura', l.x -> 'valores' ->> 'altura',
           ARRAY(SELECT fo.x FROM jsonb_array_elements_text(coalesce(l.x -> 'fotos', '[]'::jsonb)) AS fo(x))
      FROM jsonb_array_elements(v_ret -> 'retrato' -> 'linhas') AS l(x);
    PERFORM public._integracao_logar(v_tenant, 'integrar', r.modelo_id,
      jsonb_build_object('campos', cardinality(v_cfg.campos),
                         'sublinhas', jsonb_array_length(v_ret -> 'retrato' -> 'linhas') - 1), NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('marcados', v_n);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_voltar(_modelo_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(true);
  v_ids uuid[];
  v_n integer := 0;
  r record;
BEGIN
  IF coalesce(cardinality(_modelo_ids), 0) = 0 OR cardinality(_modelo_ids) > 200 THEN
    RAISE EXCEPTION 'Selecione de 1 a 200 produtos.' USING ERRCODE = 'P0001';
  END IF;
  v_ids := ARRAY(SELECT DISTINCT u.x FROM unnest(_modelo_ids) AS u(x) ORDER BY 1);
  -- FOR UPDATE: corrida voltar × entregar (§9) — quem trava primeiro vence; o outro relê o estado
  PERFORM 1 FROM public.integracao_produtos ip
   WHERE ip.modelo_id = ANY(v_ids) AND ip.tenant_id = v_tenant ORDER BY ip.modelo_id FOR UPDATE;
  FOR r IN
    SELECT u.x AS modelo_id, ip.id AS ip_id, coalesce(ip.estado, 'nao_integravel') AS estado
      FROM unnest(v_ids) AS u(x)
      LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = u.x AND ip.tenant_id = v_tenant
     ORDER BY u.x
  LOOP
    IF r.estado <> 'integravel' THEN
      -- P-63 A: o toggle só volta ANTES de a API levar; integrado = só super admin desfaz
      RAISE EXCEPTION 'integracao_mudou: produto % esta %', r.modelo_id, r.estado USING ERRCODE = 'P0409';
    END IF;
    UPDATE public.integracao_produtos
       SET estado = 'nao_integravel', retrato = NULL, assinatura = NULL, variantes_chaves = NULL,
           rev = rev + 1, atualizado_em = now()
     WHERE id = r.ip_id;
    DELETE FROM public.integracao_linhas WHERE modelo_id = r.modelo_id;
    PERFORM public._integracao_logar(v_tenant, 'voltar', r.modelo_id, '{}'::jsonb, NULL);
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('voltaram', v_n);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_desfazer(_modelo_id uuid, _motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige_super();
  v_motivo text := btrim(coalesce(_motivo, ''));
  v_ip public.integracao_produtos%ROWTYPE;
BEGIN
  IF length(v_motivo) < 3 THEN
    RAISE EXCEPTION 'Informe o motivo (obrigatório).' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_ip FROM public.integracao_produtos x WHERE x.modelo_id = _modelo_id AND x.tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND OR v_ip.estado <> 'integrado' THEN
    RAISE EXCEPTION 'Só um produto integrado pode ter a integração desfeita (integrável volta pelo botão Integrável).'
      USING ERRCODE = 'P0001';
  END IF;
  PERFORM public._integracao_logar(v_tenant, 'desfazer', _modelo_id,
    jsonb_build_object('motivo', v_motivo, 'integrado_em', v_ip.integrado_em, 'retrato', v_ip.retrato), NULL);
  UPDATE public.integracao_produtos
     SET estado = 'nao_integravel', retrato = NULL, assinatura = NULL, variantes_chaves = NULL, integrado_em = NULL,
         integrado_chave_id = NULL, desfeito_por = auth.uid(), desfeito_em = now(), desfeito_motivo = v_motivo,
         rev = rev + 1, atualizado_em = now()
   WHERE id = v_ip.id;
  DELETE FROM public.integracao_linhas WHERE modelo_id = _modelo_id;
  RETURN jsonb_build_object('ok', true);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_log_listar(_pagina integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);
  v_super boolean := public.is_super_admin();
  v_ver boolean := public._pode_ver_custos();
  v_pag integer := greatest(coalesce(_pagina, 1), 1);
  v_total integer;
  v_linhas jsonb;
BEGIN
  -- N11: admin da loja / permissão veem só ações de PRODUTO; campos/chaves/config = só super admin
  SELECT count(*) INTO v_total FROM public.integracao_log l
   WHERE l.tenant_id = v_tenant AND (v_super OR l.acao IN ('editar', 'integrar', 'voltar', 'desfazer', 'integrado'));
  -- Revisão T3 #4 (Minor #1): `? 'retrato'` também é true com o VALOR json null (desfazer grava exatamente isso se
  -- `integracao_produtos.retrato` já era NULL) — `_integracao_mascarar('null')` faz `jsonb_set` num escalar e
  -- RAISE. Guarda por `jsonb_typeof(...) = 'object'`: só mascara quando de fato é um objeto; json null passa direto
  -- (mesmo v_ver ou não — não há custo pra mascarar num retrato ausente).
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', l.id, 'acao', l.acao, 'quem', l.quem, 'quando', l.criado_em, 'modelo_id', l.modelo_id,
           'modelo_nome', l.modelo_nome,
           'detalhe', CASE WHEN v_ver OR jsonb_typeof(l.detalhe -> 'retrato') IS DISTINCT FROM 'object' THEN l.detalhe
                           ELSE jsonb_set(l.detalhe, '{retrato}',
                                          coalesce(public._integracao_mascarar(l.detalhe -> 'retrato'), 'null'::jsonb)) END)
           ORDER BY l.criado_em DESC, l.id), '[]'::jsonb)
    INTO v_linhas
    FROM (SELECT x.* FROM public.integracao_log x
           WHERE x.tenant_id = v_tenant AND (v_super OR x.acao IN ('editar', 'integrar', 'voltar', 'desfazer', 'integrado'))
           ORDER BY x.criado_em DESC, x.id OFFSET (v_pag - 1) * 50 LIMIT 50) l;
  RETURN jsonb_build_object('pagina', v_pag, 'por_pagina', 50, 'total', v_total, 'super', v_super, 'linhas', v_linhas);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._integracao_quem() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._integracao_logar(uuid, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.integracao_marcar(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_voltar(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_desfazer(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.integracao_log_listar(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_marcar(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_voltar(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_desfazer(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.integracao_log_listar(integer) TO authenticated;

DO $pos$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['public._integracao_quem()', 'public._integracao_logar(uuid,text,uuid,jsonb,text)'] LOOP
    IF has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('public', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_3: % executavel por PUBLIC/anon/authenticated (inv. 9)', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.integracao_marcar(jsonb)', 'public.integracao_voltar(uuid[])',
                            'public.integracao_desfazer(uuid,text)', 'public.integracao_log_listar(integer)'] LOOP
    IF NOT has_function_privilege('authenticated', f, 'EXECUTE') OR has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'integracao_3: ACL errada em %', f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
