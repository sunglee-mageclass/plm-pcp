-- INVERSO de supabase/migrations/20261024200000_integracao_sku_sublinhas_voltar.sql (achados MEDIOS R14: sku #3, #10, #12).
-- Devolve o texto de ANTES das 4 funcoes: _integracao_retrato_core (sem a falta "SKU desatualizado"), integracao_listar
-- (o "i" so compara a linha do produto), integracao_voltar e integracao_desfazer (sem recalcular o preco).
-- Guarda: so roda se as 4 estao EXATAMENTE com o texto da ida (md5 de depois) e as dependencias seguem com o texto
-- conferido; outro -> P0001 e nada muda. Nada gravado muda (precos ja recalculados por um voltar ficam).
-- Site: o rotulo 'sublinhas' (src/lib/integracao/produtos.ts) e tolerante - sem a chave, nada aparece; pode ir antes/depois.
-- LIFO: este inverso roda ANTES de volta-release6.sh (20261018100000_down confere o retrato 1cfaed33 que esta volta
-- devolve) e antes da volta de emergencia da Integracao (20261013100000_down confere integracao_listar 33e492d1).
-- Travas: so CREATE OR REPLACE FUNCTION. Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_retrato_core(uuid,text[],jsonb)', 'bfcd6aba0a2f0ebd1a5908888f9c0568'),
      ('public.integracao_listar(text,jsonb,integer,integer)', 'd2d3c9c55b3a6ce8b42d1842cab415f6'),
      ('public.integracao_voltar(uuid[])', '5e05bfc2b98e49b0bfd109bf0d344fff'),
      ('public.integracao_desfazer(uuid,text)', '5f6769022205743e27de52ceaca5b5bf'),
      ('public._skus_calc_ref_tipo(uuid,text,text)', 'ff2e575909f83fc0355fe20a049fd906'),
      ('public._pa_recomputar_precos_modelo(uuid)', '3782da3cce51571bad01df87974c48ab'),
      ('public._imp_recomputar_precos_modelo(uuid)', 'bbda77c40c515686a4307a563749b3dc'),
      ('public._integracao_campo_travado(uuid,text)', '798bcba30f1f75be96ae55079bc19767')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'medios_r14 (volta): % nao existe', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r14 (volta): % nao esta com o texto esperado da 20261024200000 (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

-- ACL de antes da volta (a pos-condicao exige a MESMA depois).
CREATE TEMP TABLE _r14iv_acl_antes ON COMMIT DROP AS
  SELECT v.s AS assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v.s)) AS acl
    FROM (VALUES ('public._integracao_retrato_core(uuid,text[],jsonb)'), ('public.integracao_listar(text,jsonb,integer,integer)'), ('public.integracao_voltar(uuid[])'), ('public.integracao_desfazer(uuid,text)')) v(s);

CREATE OR REPLACE FUNCTION public._integracao_retrato_core(_modelo_id uuid, _campos text[], _custo jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  m public.modelos%ROWTYPE;
  v_campos text[];
  v_rot jsonb := public._integracao_rotulos();
  v_kw text;
  v_loja_nome text;
  v_tipo text;
  v_custo numeric;
  v_titulo_auto text;
  v_preco_venda_efetivo numeric;
  v_preco_anterior_auto numeric;
  c text;
  v_val jsonb;
  v_prod jsonb := '{}'::jsonb;
  v_fotos text[] := '{}'::text[];
  v_linhas jsonb := '[]'::jsonb;
  v_meta jsonb := '[]'::jsonb;
  v_faltas jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_sem_sku integer := 0;
  v_ex_sku text;
  v_sem_cor integer := 0;
  v_sem_tam integer := 0;
  v_tam text;
  v_linha jsonb;
  v_chaves uuid[];
  s record;
  v_skucfg jsonb;
  v_modo text;
BEGIN
  SELECT * INTO m FROM public.modelos WHERE id = _modelo_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  -- só chaves conhecidas, na ORDEM FIXA do layout (P-60 B)
  v_campos := ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                     WHERE u.x = ANY(coalesce(_campos, '{}'::text[])) ORDER BY u.n);
  SELECT tc.keywords, tc.sku_config INTO v_kw, v_skucfg FROM public.tenant_config tc WHERE tc.tenant_id = m.tenant_id;
  -- Cor no nome da sublinha (P-126): Cor base | Apelido da loja (a escolha do Formato do SKU, senão derivada das partes)
  v_modo := public._integracao_cor_no_nome(v_skucfg);
  v_tipo := coalesce(m.tamanho_tipo, 'letra');
  v_custo := CASE WHEN coalesce((_custo ->> 'confirmado')::boolean, false) THEN (_custo ->> 'real')::numeric
                  ELSE (_custo ->> 'previsto')::numeric END;
  -- ruling do controlador, G-migration fix 1 #G1 (A-I1 + B-I-1): titulo_pagina/preco_anterior NULL = automatico
  -- (contrato da coluna, 20261005100000:760/:766) — o retrato NUNCA le cru (senão TODO produto nasce com falta,
  -- 272/272 na copia). [preco-versao v1] Titulo e Preco anterior automaticos = _modelo_automaticos (abaixo): v2+ = da
  -- VERSAO ANTERIOR (titulo herdado, recursivo; preco de venda GRAVADO > 0 da anterior, senao vazio = falta); v1/orfa =
  -- titulo calculado do nome + loja e o proprio preco_venda. v_loja_nome/v_preco_venda_efetivo ficaram sem uso (diff minimo).
  SELECT t.nome INTO v_loja_nome FROM public.tenants t WHERE t.id = m.tenant_id;
  -- [preco-versao v1] P-146/P-155 B/P-158: automáticos pela VERSÃO ANTERIOR (_modelo_automaticos)
  SELECT a.titulo_auto, a.preco_auto INTO v_titulo_auto, v_preco_anterior_auto FROM public._modelo_automaticos(m.id) a;
  -- [preco-versao v1] sem uso desde a 20261018100000 (o Preco anterior automatico vem de _modelo_automaticos acima).
  v_preco_venda_efetivo := m.preco_venda;

  -- linha do PRODUTO
  FOREACH c IN ARRAY v_campos LOOP
    CONTINUE WHEN c = 'foto';
    IF c IN ('cor_base', 'cor_apelido', 'tamanho') THEN
      v_prod := v_prod || jsonb_build_object(c, NULL::text);  -- "só variante": vazia na linha do produto
      CONTINUE;
    END IF;
    v_val := CASE c
      WHEN 'nome' THEN to_jsonb(nullif(btrim(m.nome), ''))
      WHEN 'ref_sku' THEN to_jsonb(nullif(btrim(coalesce(m.ref, '')), ''))
      WHEN 'preco_anterior' THEN to_jsonb(public._integracao_num(coalesce(m.preco_anterior, v_preco_anterior_auto), 2))
      WHEN 'preco_venda' THEN to_jsonb(public._integracao_num(m.preco_venda, 2))
      WHEN 'peso' THEN to_jsonb(public._integracao_num(m.peso_kg, 3))
      WHEN 'ncm' THEN to_jsonb(nullif(btrim(coalesce(m.ncm, '')), ''))
      WHEN 'preco_custo' THEN to_jsonb(public._integracao_num(v_custo, 2))
      WHEN 'titulo' THEN to_jsonb(coalesce(nullif(btrim(coalesce(m.titulo_pagina, '')), ''), v_titulo_auto))
      WHEN 'descricao' THEN to_jsonb(nullif(btrim(coalesce(m.descricao_produto, '')), ''))
      WHEN 'keywords' THEN to_jsonb(nullif(btrim(coalesce(v_kw, '')), ''))
      WHEN 'metatag' THEN to_jsonb(nullif(btrim(coalesce(m.descricao_produto, '')), ''))
      WHEN 'comprimento' THEN to_jsonb(public._integracao_num(m.comprimento_cm, NULL))
      WHEN 'largura' THEN to_jsonb(public._integracao_num(m.largura_cm, NULL))
      WHEN 'altura' THEN to_jsonb(public._integracao_num(m.altura_cm, NULL))
    END;
    v_prod := v_prod || jsonb_build_object(c, coalesce(v_val, 'null'::jsonb));
    IF v_val IS NULL THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', c, 'texto',
        CASE c WHEN 'ref_sku' THEN 'REF' WHEN 'preco_custo' THEN 'Preço de custo (o estimado não conta)'
               ELSE v_rot ->> c END));
    END IF;
  END LOOP;

  -- SUBLINHAS: variante × tamanho com grade > 0 (mesma matriz do SKU) + o SKU GRAVADO (D7)
  FOR s IN
    SELECT k.variante_key, k.variante_ordem, k.cor_nome, k.apelido_nome, k.tamanho_key, k.tamanho_ordem,
           sk.id AS sku_id, sk.sku AS sku, sk.rev AS sku_rev, sk.manual AS manual
      FROM public._skus_calc_ref_tipo(m.id, m.ref, v_tipo) k
      LEFT JOIN public.modelo_skus sk
        ON sk.modelo_id = m.id AND sk.variante_key = k.variante_key AND sk.tamanho_key = k.tamanho_key
     ORDER BY k.variante_ordem NULLS LAST, k.tamanho_ordem NULLS LAST, k.tamanho_key, k.variante_key
  LOOP
    v_n := v_n + 1;
    v_tam := nullif(coalesce(public._sku_tamanho_lado(s.tamanho_key, v_tipo), s.tamanho_key), '');
    v_linha := '{}'::jsonb;
    FOREACH c IN ARRAY v_campos LOOP
      CONTINUE WHEN c = 'foto';
      v_linha := v_linha || jsonb_build_object(c, CASE c
        WHEN 'nome' THEN coalesce(to_jsonb(public._integracao_nome_sublinha(m.nome, s.cor_nome, s.apelido_nome, v_tam, v_modo)), 'null'::jsonb)
        WHEN 'ref_sku' THEN coalesce(to_jsonb(nullif(btrim(coalesce(s.sku, '')), '')), 'null'::jsonb)
        WHEN 'cor_base' THEN coalesce(to_jsonb(s.cor_nome), 'null'::jsonb)
        WHEN 'cor_apelido' THEN coalesce(to_jsonb(s.apelido_nome), 'null'::jsonb)
        WHEN 'tamanho' THEN coalesce(to_jsonb(v_tam), 'null'::jsonb)
        ELSE coalesce(v_prod -> c, 'null'::jsonb)
      END);
    END LOOP;
    IF 'ref_sku' = ANY(v_campos) AND nullif(btrim(coalesce(s.sku, '')), '') IS NULL THEN
      v_sem_sku := v_sem_sku + 1;
      IF v_ex_sku IS NULL THEN
        v_ex_sku := coalesce(s.cor_nome, 'sem cor') || ', tam. ' || coalesce(v_tam, s.tamanho_key);
      END IF;
    END IF;
    IF 'cor_base' = ANY(v_campos) AND s.cor_nome IS NULL THEN
      v_sem_cor := v_sem_cor + 1;
    END IF;
    IF 'tamanho' = ANY(v_campos) AND v_tam IS NULL THEN
      v_sem_tam := v_sem_tam + 1;
    END IF;
    v_linhas := v_linhas || jsonb_build_array(jsonb_build_object(
      'tipo', 'variante', 'ordem', v_n, 'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key,
      'valores', v_linha, 'fotos', '[]'::jsonb));
    v_meta := v_meta || jsonb_build_array(jsonb_build_object(
      'variante_key', s.variante_key, 'tamanho_key', s.tamanho_key, 'variante_ordem', s.variante_ordem,
      'tamanho_ordem', s.tamanho_ordem, 'cor_nome', s.cor_nome, 'apelido_nome', s.apelido_nome, 'tamanho', v_tam,
      'sku_id', s.sku_id, 'sku', s.sku, 'sku_rev', s.sku_rev, 'manual', coalesce(s.manual, false)));
  END LOOP;

  IF v_n = 0 AND v_campos && ARRAY['ref_sku', 'cor_base', 'cor_apelido', 'tamanho']::text[] THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'variantes', 'texto', 'variantes cor × tamanho'));
  END IF;
  IF v_sem_sku = 1 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku', 'texto', '1 variante sem SKU (' || v_ex_sku || ')'));
  ELSIF v_sem_sku > 1 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku', 'texto',
      v_sem_sku || ' variantes sem SKU (ex.: ' || v_ex_sku || ')'));
  END IF;
  IF v_sem_cor > 0 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'cor_base', 'texto', v_sem_cor || ' variante(s) sem cor base'));
  END IF;
  IF v_sem_tam > 0 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'tamanho', 'texto', v_sem_tam || ' variante(s) sem tamanho'));
  END IF;
  -- ruling do controlador, revisão T2 Minor #5: "Tamanho em" NULL nunca é assumido como letra em silêncio — vira
  -- falta sempre que tamanho/ref_sku estiver marcado (mesmo v_tipo continuando 'letra' só para montar a matriz acima).
  IF m.tamanho_tipo IS NULL AND v_campos && ARRAY['tamanho', 'ref_sku']::text[] THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'tamanho_tipo', 'texto', 'Tamanho em'));
  END IF;

  -- FOTOS (só se "Foto do Modelo" marcado): modelos.fotos_modelo nas 3 origens (B1b)
  IF 'foto' = ANY(v_campos) THEN
    v_fotos := coalesce(m.fotos_modelo, '{}'::text[]);
    IF cardinality(v_fotos) = 0 THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'foto', 'texto', 'Foto do Modelo'));
    -- Minor #6: além do prefixo <tenant>/, falha fechado em qualquer segmento '..'/'.'/vazio (rejeita '//','/./','/../')
    ELSIF EXISTS (SELECT 1 FROM unnest(v_fotos) AS p(x)
                   WHERE p.x IS NULL OR NOT starts_with(p.x, m.tenant_id::text || '/')
                      OR EXISTS (SELECT 1 FROM unnest(string_to_array(p.x, '/')) AS seg(s) WHERE seg.s IN ('', '.', '..'))) THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'foto', 'texto', 'foto de outra loja'));
    END IF;
  END IF;

  -- conjunto de cores do ESPELHO do comprado (trava das variantes — D11)
  IF m.origem = 'revenda' THEN
    v_chaves := ARRAY(SELECT DISTINCT public._sku_variante_key(pv.cor_id, pv.cor_apelido_id)
                        FROM public.produtos_acabados pa
                        JOIN public.produto_acabado_variantes pv ON pv.produto_acabado_id = pa.id
                       WHERE pa.modelo_id = m.id ORDER BY 1);
  ELSIF m.origem = 'importado' THEN
    v_chaves := ARRAY(SELECT DISTINCT public._sku_variante_key(iv.cor_id, iv.cor_apelido_id)
                        FROM public.produtos_importados pi
                        JOIN public.produto_importado_variantes iv ON iv.produto_importado_id = pi.id
                       WHERE pi.modelo_id = m.id ORDER BY 1);
  END IF;

  -- ruling do controlador, revisão T4 #1 (Important #1, opção b) + re-review A (Important, residual do #1):
  -- 'nome' marcado em produto revenda/importado vira falta quando o nome do card (modelos.nome) diverge do
  -- nome do PRODUTO ESPELHO. O card do Produto Acabado (_salvar_produto_acabado_core) sempre copia
  -- produtos_acabados.nome -> modelos.nome a cada save — se o usuário renomeou só o card no Sheet do
  -- Planejamento, todo save do PA volta a travar com integracao_travado: nome mesmo sem editar nada de fato.
  -- A falta avisa ANTES do marcar (o retrato fica incompleto e marcar recusa) em vez de deixar o produto
  -- travado destravável só por voltar/desfazer. _salvar_produto_importado_core NÃO grava nome/ref em modelos
  -- (confirmado lendo 20260904180000_produto_importado_fixes_review.sql) — mas a checagem entra igual para o
  -- importado por SIMETRIA/robustez a uma mudança futura desse core (o teste cobre só o caso revenda, que é
  -- o alcançável hoje). Re-review A: a comparação tem que ser EXATA como o save do espelho grava e como a
  -- trava (fn_integracao_trava_modelos, NEW.nome IS DISTINCT FROM OLD.nome) compara — SEM btrim. O
  -- _salvar_produto_acabado_core grava `v_nome := nullif(_dados->>'nome','')` (raw, sem trim) direto em
  -- modelos.nome; comparar com btrim aqui deixava passar uma diferença SÓ de espaço ('Blusa ' × 'Blusa'),
  -- que a trava recusaria do mesmo jeito (ela também não faz trim) — o mesmo beco sem saída que a falta foi
  -- criada pra evitar. Fix: `nullif(x,'') IS DISTINCT FROM nullif(y,'')` dos dois lados (raw, não btrim) —
  -- '' e NULL contam como iguais (o mesmo `nullif` que o _core usa), mas qualquer outra diferença, inclusive
  -- só de espaço, vira falta.
  IF 'nome' = ANY(v_campos) THEN
    IF m.origem = 'revenda' THEN
      IF EXISTS (SELECT 1 FROM public.produtos_acabados pa
                  WHERE pa.modelo_id = m.id
                    AND nullif(pa.nome::text, '') IS DISTINCT FROM nullif(m.nome::text, '')) THEN
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'nome',
          'texto', 'Nome diferente do Produto Acabado'));
      END IF;
    ELSIF m.origem = 'importado' THEN
      IF EXISTS (SELECT 1 FROM public.produtos_importados pi
                  WHERE pi.modelo_id = m.id
                    AND nullif(pi.nome::text, '') IS DISTINCT FROM nullif(m.nome::text, '')) THEN
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'nome',
          'texto', 'Nome diferente do Produto Importado'));
      END IF;
    END IF;
  END IF;

  -- ruling do controlador, revisão T5 #2 (Important #1 parte 2, plan-mandated): mesmo padrão da falta de nome
  -- acima, agora para REF — 'ref_sku' marcado e a REF do card diferente da REF do espelho vira falta ANTES do
  -- marcar (o usuário vê e resolve igualando as REFs, em vez de a mão dupla da migration 5 sobrescrever uma REF
  -- em silêncio). Comparação EXATA (nullif dos dois lados, sem btrim) — mesmo estilo da falta de nome. A
  -- reconciliação ÚNICA dos 34 pares já divergentes na cópia (achado da revisão) fica PENDENTE de decisão do
  -- dono — nenhum backfill é feito aqui, só o check daqui pra frente.
  IF 'ref_sku' = ANY(v_campos) THEN
    IF m.origem = 'revenda' THEN
      IF EXISTS (SELECT 1 FROM public.produtos_acabados pa
                  WHERE pa.modelo_id = m.id
                    AND nullif(pa.ref::text, '') IS DISTINCT FROM nullif(m.ref::text, '')) THEN
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku',
          'texto', 'REF diferente do Produto Acabado'));
      END IF;
    ELSIF m.origem = 'importado' THEN
      IF EXISTS (SELECT 1 FROM public.produtos_importados pi
                  WHERE pi.modelo_id = m.id
                    AND nullif(pi.ref::text, '') IS DISTINCT FROM nullif(m.ref::text, '')) THEN
        v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku',
          'texto', 'REF diferente do Produto Importado'));
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'retrato', jsonb_build_object('v', 2, 'campos', to_jsonb(v_campos),
      'linhas', jsonb_build_array(jsonb_build_object('tipo', 'produto', 'ordem', 0, 'valores', v_prod,
                                                      'fotos', to_jsonb(v_fotos))) || v_linhas),
    'faltas', v_faltas,
    'completo', jsonb_array_length(v_faltas) = 0,
    'variantes_chaves', to_jsonb(v_chaves),
    'meta', v_meta);
END
$function$;

CREATE OR REPLACE FUNCTION public.integracao_listar(_situacao text, _filtros jsonb, _pagina integer, _limite integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);
  v_cfg public.integracao_config;
  v_ver boolean := public._pode_ver_custos();
  v_sit text := coalesce(nullif(btrim(coalesce(_situacao, '')), ''), 'nao_integrados');
  v_f jsonb := coalesce(_filtros, '{}'::jsonb);
  v_busca text := nullif(btrim(coalesce(_filtros ->> 'busca', '')), '');
  v_pag integer := greatest(coalesce(_pagina, 1), 1);
  v_lim integer := coalesce(_limite, 50);  -- P-130 A: produtos por página (1..500; sem o parâmetro = 50, como antes)
  v_total integer;
  v_cont jsonb;
  v_pagina jsonb;
  v_colecoes jsonb;
  v_ids uuid[];
  v_custos jsonb := '{}'::jsonb;
  v_prod jsonb := '[]'::jsonb;
  v_ret jsonb;
  v_gravado jsonb;
  v_difere jsonb;
  v_kw text;
  v_etapas jsonb;
  r record;
BEGIN
  IF v_sit NOT IN ('nao_integrados', 'integrados', 'todos') THEN
    RAISE EXCEPTION 'Situação inválida.' USING ERRCODE = 'P0001';
  END IF;
  IF v_lim < 1 OR v_lim > 500 THEN
    RAISE EXCEPTION 'Limite de produtos por página inválido (use de 1 a 500).' USING ERRCODE = 'P0001';
  END IF;
  v_cfg := public._integracao_cfg(v_tenant);

  WITH b AS (SELECT * FROM public._integracao_base(v_tenant)),
       f AS (
         SELECT b.* FROM b
          WHERE (v_sit = 'todos' OR (v_sit = 'integrados' AND b.estado = 'integrado')
                 OR (v_sit = 'nao_integrados' AND b.estado <> 'integrado'))
            AND (v_f ->> 'colecao' IS NULL OR b.colecao = v_f ->> 'colecao')
            AND (v_f ->> 'etapa' IS NULL OR b.etapa = v_f ->> 'etapa')
            AND (v_f ->> 'origem' IS NULL OR b.origem = v_f ->> 'origem')
            AND (v_f ->> 'estado' IS NULL OR b.estado = v_f ->> 'estado')
            AND (v_busca IS NULL OR b.nome ILIKE '%' || v_busca || '%' OR coalesce(b.ref, '') ILIKE '%' || v_busca || '%'))
  SELECT jsonb_build_object(
           'nao_integrados', (SELECT count(*) FROM b WHERE b.estado <> 'integrado'),
           'integrados', (SELECT count(*) FROM b WHERE b.estado = 'integrado'),
           'todos', (SELECT count(*) FROM b)),
         (SELECT count(*) FROM f),
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'colecao', p.colecao, 'etapa', p.etapa, 'estado', p.estado,
                                                        'marcado_em', p.marcado_em, 'integrado_em', p.integrado_em)
                                    ORDER BY p.nome, p.id)
                     FROM (SELECT f.* FROM f ORDER BY f.nome, f.id OFFSET (v_pag - 1) * v_lim LIMIT v_lim) p), '[]'::jsonb),
         coalesce((SELECT jsonb_agg(DISTINCT b.colecao ORDER BY b.colecao) FROM b WHERE b.colecao IS NOT NULL), '[]'::jsonb)
    INTO v_cont, v_total, v_pagina, v_colecoes;

  v_ids := ARRAY(SELECT (x.p ->> 'id')::uuid FROM jsonb_array_elements(v_pagina) AS x(p));
  IF cardinality(v_ids) > 0 THEN
    v_custos := coalesce(public._custo_unitario_modelos_core(v_ids), '{}'::jsonb);
  END IF;
  FOR r IN
    SELECT m.*, e.p ->> 'colecao' AS b_colecao, e.p ->> 'etapa' AS b_etapa, e.p ->> 'estado' AS b_estado,
           e.p -> 'marcado_em' AS b_marcado, e.p -> 'integrado_em' AS b_integrado, ip.retrato AS ip_retrato, e.n AS b_n
      FROM jsonb_array_elements(v_pagina) WITH ORDINALITY AS e(p, n)
      JOIN public.modelos m ON m.id = (e.p ->> 'id')::uuid
      LEFT JOIN public.integracao_produtos ip ON ip.modelo_id = m.id
     ORDER BY e.n
  LOOP
    v_ret := public._integracao_retrato_core(r.id, v_cfg.campos, v_custos -> r.id::text);
    v_gravado := CASE WHEN r.ip_retrato IS NULL THEN NULL WHEN v_ver THEN r.ip_retrato
                      ELSE public._integracao_mascarar(r.ip_retrato) END;
    -- N10: linha integrável/integrada mostra o RETRATO; o "i" avisa quais campos do produto mudaram depois dele
    v_difere := CASE WHEN r.ip_retrato IS NULL THEN '[]'::jsonb ELSE coalesce((
      SELECT jsonb_agg(k.k ORDER BY k.k)
        FROM jsonb_object_keys(r.ip_retrato -> 'linhas' -> 0 -> 'valores') AS k(k)
       WHERE (v_ver OR k.k <> 'preco_custo')
         AND (r.ip_retrato -> 'linhas' -> 0 -> 'valores' -> k.k)
             IS DISTINCT FROM (v_ret -> 'retrato' -> 'linhas' -> 0 -> 'valores' -> k.k)), '[]'::jsonb) END;
    v_prod := v_prod || jsonb_build_array(jsonb_build_object(
      'modelo_id', r.id, 'origem', coalesce(r.origem, 'interno'), 'colecao', r.b_colecao, 'etapa', r.b_etapa,
      'estado', r.b_estado, 'marcado_em', r.b_marcado, 'integrado_em', r.b_integrado, 'rev', r.rev,
      'raw', jsonb_build_object(
        'nome', r.nome, 'ref', r.ref, 'preco_anterior', r.preco_anterior, 'preco_venda', r.preco_venda,
        'peso_kg', r.peso_kg, 'ncm', r.ncm, 'titulo_pagina', r.titulo_pagina, 'descricao_produto', r.descricao_produto,
        'comprimento_cm', r.comprimento_cm, 'largura_cm', r.largura_cm, 'altura_cm', r.altura_cm,
        'fotos_modelo', to_jsonb(coalesce(r.fotos_modelo, '{}'::text[])), 'tamanho_tipo', r.tamanho_tipo),
      'vivo', CASE WHEN v_ver THEN v_ret -> 'retrato' ELSE public._integracao_mascarar(v_ret -> 'retrato') END,
      'faltas', v_ret -> 'faltas', 'completo', (v_ret ->> 'completo')::boolean, 'sublinhas', v_ret -> 'meta',
      'retrato', v_gravado, 'retrato_difere', v_difere, 'gates', public._integracao_gates(r.id),
      -- ruling do controlador, G-migration fix 3 #J4: selo "Reprovado — não vai para a API" (T12a) precisa do
      -- boolean por produto na LISTA (integracao_listar), não só na prévia (integracao_previa já mandava). MESMA
      -- definição do D9 (_integracao_base): status_planejamento='reprovado' OU status_desenvolvimento='reprovado'.
      'reprovado', (coalesce(r.status_planejamento, '') = 'reprovado'
                    OR lower(btrim(coalesce(r.status_desenvolvimento, ''))) = 'reprovado')));
  END LOOP;

  SELECT tc.keywords INTO v_kw FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant;
  v_etapas := jsonb_build_array(jsonb_build_object('key', 'planejamento', 'label', 'Planejamento'))
    || coalesce((SELECT jsonb_agg(jsonb_build_object('key', s.key, 'label', s.lbl) ORDER BY s.ord)
                   FROM public._kanban_status_rows(v_tenant) s), '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('key', 'lancado', 'label', 'Lançado'));
  RETURN jsonb_build_object(
    'pagina', v_pag, 'por_pagina', v_lim, 'total', v_total, 'contagens', v_cont,
    'campos', to_jsonb(v_cfg.campos), 'rotulos', public._integracao_rotulos(),
    'opcoes', jsonb_build_object('colecoes', v_colecoes, 'etapas', v_etapas),
    'pode', jsonb_build_object('editar', public._integracao_pode(true), 'ver_custos', v_ver,
                               'super', public.is_super_admin(), 'keywords', public.is_tenant_admin() OR public.is_super_admin()),
    'keywords', v_kw,
    'produtos', v_prod);
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

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_retrato_core(uuid,text[],jsonb)', '1cfaed33c1b166e433ca20a42e5905c5'),
      ('public.integracao_listar(text,jsonb,integer,integer)', '33e492d18333905ef3862aa3dc93f8aa'),
      ('public.integracao_voltar(uuid[])', 'c83cc187597f07f5d76c2e9d1b0bd1be'),
      ('public.integracao_desfazer(uuid,text)', 'ceb8777ec905da86685a65fd0b23e740')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r14 (volta): pos-condicao falhou - % nao voltou ao texto de antes (md5 %)', r.s,
        md5(pg_get_functiondef(to_regprocedure(r.s))) USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- ACL identica a de antes (CREATE OR REPLACE nao mexe; conferido).
  FOR r IN SELECT assinatura, acl FROM _r14iv_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'medios_r14 (volta): pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: os internos seguem sem EXECUTE para PUBLIC/anon/authenticated.
  FOR r IN SELECT * FROM (VALUES ('public._integracao_retrato_core(uuid,text[],jsonb)'), ('public._skus_calc_ref_tipo(uuid,text,text)'), ('public._pa_recomputar_precos_modelo(uuid)'), ('public._imp_recomputar_precos_modelo(uuid)'), ('public._integracao_campo_travado(uuid,text)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r14 (volta): % ficou executavel por anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r14 (volta): % ficou executavel por PUBLIC (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- RPCs publicas da tela Integracao: authenticated SIM; anon e PUBLIC NAO (como hoje).
  FOR r IN SELECT * FROM (VALUES ('public.integracao_listar(text,jsonb,integer,integer)'), ('public.integracao_voltar(uuid[])'), ('public.integracao_desfazer(uuid,text)')) v(s) LOOP
    IF NOT has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'medios_r14 (volta): ACL de % fora do esperado (authenticated sim; anon/PUBLIC nao)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
