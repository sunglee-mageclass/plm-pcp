-- Urgentes R8a - titulo da sublinha da Integracao/API = titulo do produto + cor (retrato v=4). GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-b.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-b.md (Task 4 / R8a; Rulings 16, 17, 23).
-- O que muda (R8, P-301 B / P-302 A; Rulings 16, 17, 23):
--   1) funcao NOVA _integracao_titulo_sublinha(titulo, cor_base, apelido, modo) (sql IMMUTABLE, SEM security definer, igual a
--      _integracao_nome_sublinha; REVOKE dos 3 -> ACL {postgres=X,service_role=X}): titulo efetivo do produto + cor antes do
--      ULTIMO ' | ' (sem ' | ' = cor no fim; sem cor = igual; titulo NULL = NULL). Espelho TS tituloSublinha + anti-drift.
--   2) _integracao_retrato_core: cada SUBLINHA ganha titulo PROPRIO (calculado do titulo efetivo do produto - digitado,
--      automatico v1 ou HERDADO v2+ - com a cor da variante e o modo da loja, _integracao_cor_no_nome); nao editavel na
--      filha. titulo nao marcado = sublinha sem a chave (como hoje). O marcador do retrato sobe para v=4 (unico leitor de
--      'v' = integracao_listar). O nome da sublinha NAO muda (Ruling 23).
--   3) integracao_listar: o aviso 'sublinhas' do retrato_difere passa a comparar o titulo da sublinha SO quando o retrato
--      GRAVADO e v>=4 (integrado/integravel com retrato v<=3 herdava o titulo do produto e nao acende aviso falso; Ruling 17).
--   4) _integracao_exemplo (modo teste da API): sublinha = titulo do exemplo + ' Cor Exemplo'; o produto de exemplo NAO muda
--      (Ruling 16).
-- Integraveis/integrados JA gravados NAO mudam aqui (o retrato deles e congelado): o reprocesso unico dos integraveis e a
-- 20261103191000 (r8b), que pega o LOCK e reprocessa tudo que ficou v<>4 (fecha a corrida com integracao_marcar).
-- Dependencias FIXADAS (md5 conferido na guarda, nao redefinidas): _integracao_cor_no_nome, _integracao_nome_sublinha,
-- _integracao_assinar, integracao_marcar, _integracao_valores.
-- ACL, SECURITY e search_path das 3 ficam iguais (CREATE OR REPLACE preserva; pos-condicao confere).
-- Trava: SO catalogo (CREATE FUNCTION + 3 CREATE OR REPLACE; nenhuma trava de tabela, nada em auth/storage/realtime).
-- lock_timeout 1500ms; 55P03 = nada mudou, rodar o arquivo de novo. Idempotente. Banco ANTES do site; site velho + banco
-- novo = ok (a tela le o valor do servidor).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._integracao_retrato_core(uuid,text[],jsonb)
--     ANTES  8a5275cf8c145f88e23c5158c22fdfc6
--     DEPOIS 2635e1833654111858a301f7ef06ccf1
--   public.integracao_listar(text,jsonb,integer,integer)
--     ANTES  d2d3c9c55b3a6ce8b42d1842cab415f6
--     DEPOIS 5fd15e4b95fc5555e055935a67af62e8
--   public._integracao_exemplo(text[],integer)
--     ANTES  8882ce651fe5f13a44c60751692da40e
--     DEPOIS d57b40f96cc4a4fdbb2f9dc0ddc6c8d7
--   public._integracao_titulo_sublinha(text,text,text,text) (NOVA)
--     ANTES  ausente
--     DEPOIS a847a61f50f4b72608aa10edaa7ac0c9
-- ====================================================================================
-- Volta (LIFO, banco DEPOIS do site): supabase/rollback/20261103190000_urg_r8_titulo_sublinha_down.sql - DEPOIS do 20261103191000_down (r8b, reprocesso) e ANTES do
-- 20261103185000_down (r5; pela ordem do kit). OBRIGATORIO antes dos inversos da Integracao que guardam estas funcoes
-- por md5 (RECUSAM com a 190000 viva): I3b 20261030110000_down (_integracao_retrato_core 8a5275cf, _integracao_exemplo
-- 8882ce65) e R14 20261024200000_down (integracao_listar d2d3c9c5). ATENCAO: o I3a 20261030100000_down tem guarda NEGATIVA
-- (so recusa se o retrato = 8a5275cf) e NAO recusa com a 190000 viva - seguir a LIFO (190000_down -> I3c -> I3b -> I3a).
-- Reaplicar a ida da I3c (20261030120000) com a 190000 viva RECUSA (exige o retrato 8a5275cf) - voltar a 190000 antes.
-- A volta de EMERGENCIA da Integracao (.superpowers/integracao/mig/volta-producao.sh) tem de comecar por
-- 20261103191000_down e 20261103190000_down (nesta ordem), antes de qualquer inverso dela.
-- DROP do helper: supabase/rollback/20261103190000_urg_r8_titulo_sublinha_down_drop.sql (opcional, depois; so catalogo).
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
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_retrato_core(uuid,text[],jsonb)', '8a5275cf8c145f88e23c5158c22fdfc6', '2635e1833654111858a301f7ef06ccf1'),
      ('public.integracao_listar(text,jsonb,integer,integer)', 'd2d3c9c55b3a6ce8b42d1842cab415f6', '5fd15e4b95fc5555e055935a67af62e8'),
      ('public._integracao_exemplo(text[],integer)', '8882ce651fe5f13a44c60751692da40e', 'd57b40f96cc4a4fdbb2f9dc0ddc6c8d7')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'urg_r8a: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_cor_no_nome(jsonb)', '5180d729efa5e6d4b019f4d426ccdc04'),
      ('public._integracao_nome_sublinha(text,text,text,text,text)', '9fdfb0472cce4118f17bbda459122ecc'),
      ('public._integracao_assinar(jsonb)', 'bbe03c7d24dc3a470387c0164073146b'),
      ('public.integracao_marcar(jsonb)', 'b4400251395251b80a458eb11524d172'),
      ('public._integracao_valores(integracao_linhas,text[],text[])', '7d094ada6982728a4dfdc96077d51367')
    ) AS x(f, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.f))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r8a: dependencia % com texto inesperado - gere de novo', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- funcoes NOVAS deste bloco: ausentes ou ja com o texto de DEPOIS
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_titulo_sublinha(text,text,text,text)', 'a847a61f50f4b72608aa10edaa7ac0c9')
    ) AS x(f, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.d THEN
      RAISE EXCEPTION 'urg_r8a: % (nova) com texto inesperado (md5 %) - gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- [urg r8] sem DDL de tabela: so catalogo (1 funcao nova + 3 CREATE OR REPLACE). Nenhum dado gravado muda aqui.

CREATE OR REPLACE FUNCTION public._integracao_titulo_sublinha(_titulo text, _cor_base text, _apelido text, _modo text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Titulo da sublinha (variante x tamanho) da Integracao/API (R8, P-301 B / P-302 A): o titulo EFETIVO do produto com a COR
  -- inserida antes do ULTIMO ' | ' ("Vestido Suelen | Ave Rara" -> "Vestido Suelen Preto | Ave Rara"); sem ' | ' = cor no fim;
  -- sem cor = igual ao do produto; titulo NULL = NULL. Sem tamanho. Cor = a mesma escolha do nome da sublinha
  -- (_integracao_cor_no_nome: apelido no modo 'cor_apelido', vazio -> cor base). btrim so tira ESPACO.
  -- Espelho TS: tituloSublinha (src/lib/integracao/titulo-sublinha.ts); anti-drift tests/fixtures/titulo-sublinha-casos.ts.
  WITH k AS (
    SELECT CASE WHEN _modo = 'cor_apelido' THEN coalesce(nullif(btrim(_apelido), ''), nullif(btrim(_cor_base), ''))
                ELSE nullif(btrim(_cor_base), '') END AS cor,
           strpos(reverse(_titulo), ' | ') AS r
  )
  SELECT CASE
           WHEN _titulo IS NULL OR btrim(_titulo) = '' OR k.cor IS NULL THEN _titulo
           WHEN k.r = 0 THEN _titulo || ' ' || k.cor
           ELSE left(_titulo, length(_titulo) - k.r - 2) || ' ' || k.cor || right(_titulo, k.r + 2)
         END
    FROM k
$function$;
REVOKE EXECUTE ON FUNCTION public._integracao_titulo_sublinha(text,text,text,text) FROM PUBLIC, anon, authenticated;

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
  v_sku_desat integer := 0;  -- medios R14 sku #3: SKU gravado (nao manual) diferente do previsto
  v_ex_desat text;
  v_sem_cor integer := 0;
  v_sem_tam integer := 0;
  v_tam text;
  v_linha jsonb;
  v_chaves uuid[];
  s record;
  v_skucfg jsonb;
  v_modo text;
  v_extras jsonb;  -- [i3 v1] Coleção / Categoria do Tecido Principal / Linha
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
  -- [i3 v1] Release I3: os 3 NÃO obrigatórios vêm de UMA leitura (_integracao_extras — a mesma fonte do reprocesso da
  -- 20261030120000), só quando algum deles está marcado.
  IF v_campos && public._integracao_opcionais() THEN
    v_extras := public._integracao_extras(m.id);
  END IF;
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
      WHEN 'colecao' THEN to_jsonb(v_extras ->> 'colecao')  -- [i3 v1]
      WHEN 'categoria_tecido' THEN to_jsonb(v_extras ->> 'categoria_tecido')  -- [i3 v1]
      WHEN 'linha' THEN to_jsonb(v_extras ->> 'linha')  -- [i3 v1]
    END;
    v_prod := v_prod || jsonb_build_object(c, coalesce(v_val, 'null'::jsonb));
    -- [i3 v1] os NÃO obrigatórios (Coleção / Categoria do Tecido Principal / Linha) vazios NÃO são falta (P-219 A); as
    -- sublinhas herdam o valor do produto (ELSE v_prod -> c, abaixo).
    IF v_val IS NULL AND NOT (c = ANY(public._integracao_opcionais())) THEN
      v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', c, 'texto',
        CASE c WHEN 'ref_sku' THEN 'REF' WHEN 'preco_custo' THEN 'Preço de custo (o estimado não conta)'
               ELSE v_rot ->> c END));
    END IF;
  END LOOP;

  -- SUBLINHAS: variante × tamanho com grade > 0 (mesma matriz do SKU) + o SKU GRAVADO (D7)
  FOR s IN
    SELECT k.variante_key, k.variante_ordem, k.cor_nome, k.apelido_nome, k.tamanho_key, k.tamanho_ordem,
           sk.id AS sku_id, sk.sku AS sku, sk.rev AS sku_rev, sk.manual AS manual, k.sku AS sku_previsto
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
        -- [urg r8] titulo da sublinha = titulo efetivo do produto + cor antes do ultimo ' | ' (calculado; nao editavel na filha)
        WHEN 'titulo' THEN coalesce(to_jsonb(public._integracao_titulo_sublinha(v_prod ->> 'titulo', s.cor_nome, s.apelido_nome, v_modo)), 'null'::jsonb)
        ELSE coalesce(v_prod -> c, 'null'::jsonb)
      END);
    END LOOP;
    IF 'ref_sku' = ANY(v_campos) AND nullif(btrim(coalesce(s.sku, '')), '') IS NULL THEN
      v_sem_sku := v_sem_sku + 1;
      IF v_ex_sku IS NULL THEN
        v_ex_sku := coalesce(s.cor_nome, 'sem cor') || ', tam. ' || coalesce(v_tam, s.tamanho_key);
      END IF;
    END IF;
    -- medios R14 sku #3: SKU gravado automatico (nao manual) diferente do PREVISTO (_skus_calc_ref_tipo.sku = o que o
    -- Regerar gravaria; mesma regra do 'muda' do _skus_plano) = falta "SKU desatualizado - Regerar". So conta com o
    -- previsto calculavel (sem falta de sigla/REF) e o gravado preenchido; manual nunca. Muda so faltas/completo - o
    -- retrato (valores, marcador v=2) e o mesmo de antes.
    IF 'ref_sku' = ANY(v_campos) AND nullif(btrim(coalesce(s.sku, '')), '') IS NOT NULL
       AND NOT coalesce(s.manual, false) AND nullif(btrim(coalesce(s.sku_previsto, '')), '') IS NOT NULL
       AND s.sku IS DISTINCT FROM s.sku_previsto THEN
      v_sku_desat := v_sku_desat + 1;
      IF v_ex_desat IS NULL THEN
        v_ex_desat := coalesce(s.cor_nome, 'sem cor') || ', tam. ' || coalesce(v_tam, s.tamanho_key) || ': ' || s.sku || ' -> ' || s.sku_previsto;
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
  IF v_sku_desat = 1 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku', 'texto',
      '1 SKU desatualizado — Regerar (' || v_ex_desat || ')'));
  ELSIF v_sku_desat > 1 THEN
    v_faltas := v_faltas || jsonb_build_array(jsonb_build_object('campo', 'ref_sku', 'texto',
      v_sku_desat || ' SKUs desatualizados — Regerar (ex.: ' || v_ex_desat || ')'));
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
    'retrato', jsonb_build_object('v', 4, 'campos', to_jsonb(v_campos),
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
    -- medios R14 sku #10: as SUBLINHAS (variante x tamanho) tambem: o conjunto (variante_key, tamanho_key) e os valores
    -- PROPRIOS de cada uma (SKU, cor base, apelido, tamanho; nome da sublinha so quando o retrato gravado e v>=2 - o v=1
    -- tinha o nome sem a cor e acenderia o aviso em todo integrado antigo), so dos campos do RETRATO GRAVADO (como a
    -- linha do produto acima). Os campos herdados do produto ja sao comparados acima. Diferente -> 'sublinhas' no "i".
    IF r.ip_retrato IS NOT NULL AND EXISTS (
         WITH g AS (
           SELECT l.v ->> 'variante_key' AS vk, l.v ->> 'tamanho_key' AS tk,
                  (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) FROM jsonb_each(l.v -> 'valores') AS e
                    WHERE (r.ip_retrato -> 'campos') ? e.key
                      AND (e.key IN ('ref_sku', 'cor_base', 'cor_apelido', 'tamanho')
                           OR (e.key = 'nome' AND coalesce(r.ip_retrato -> 'v', '1'::jsonb) <> '1'::jsonb)
                           -- [urg r8] titulo da sublinha e PROPRIO desde o retrato v=4 (o v<=3 herdava o do produto)
                           OR (e.key = 'titulo' AND coalesce((r.ip_retrato ->> 'v')::int, 1) >= 4))) AS val
             FROM jsonb_array_elements(r.ip_retrato -> 'linhas') AS l(v)
            WHERE l.v ->> 'tipo' = 'variante'),
         h AS (
           SELECT l.v ->> 'variante_key' AS vk, l.v ->> 'tamanho_key' AS tk,
                  (SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) FROM jsonb_each(l.v -> 'valores') AS e
                    WHERE (r.ip_retrato -> 'campos') ? e.key
                      AND (e.key IN ('ref_sku', 'cor_base', 'cor_apelido', 'tamanho')
                           OR (e.key = 'nome' AND coalesce(r.ip_retrato -> 'v', '1'::jsonb) <> '1'::jsonb)
                           -- [urg r8] titulo da sublinha e PROPRIO desde o retrato v=4 (o v<=3 herdava o do produto)
                           OR (e.key = 'titulo' AND coalesce((r.ip_retrato ->> 'v')::int, 1) >= 4))) AS val
             FROM jsonb_array_elements(v_ret -> 'retrato' -> 'linhas') AS l(v)
            WHERE l.v ->> 'tipo' = 'variante')
         (SELECT * FROM g EXCEPT SELECT * FROM h) UNION ALL (SELECT * FROM h EXCEPT SELECT * FROM g)) THEN
      v_difere := v_difere || '["sublinhas"]'::jsonb;
    END IF;
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

CREATE OR REPLACE FUNCTION public._integracao_exemplo(_campos text[], _pagina integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_campos text[] := ARRAY(SELECT u.x FROM unnest(public._integracao_layout()) WITH ORDINALITY AS u(x, n)
                            WHERE u.x = ANY(coalesce(_campos, '{}'::text[])) ORDER BY u.n);
  v_pag integer := least(greatest(coalesce(_pagina, 1), 1), 2);
  v_out jsonb := '[]'::jsonb;
  v_i integer;
  v_ref text;
  v_nome text;
  v_desc text;
  v_base jsonb;
  v_linha jsonb;
  v_linhas jsonb;
  v_tam text;
BEGIN
  -- P-82 A: produtos FICTÍCIOS no formato real (mesmas colunas marcadas da loja), 2 por página, 2 páginas. NUNCA lê produto.
  FOR v_i IN ((v_pag - 1) * 2 + 1)..((v_pag - 1) * 2 + 2) LOOP
    v_ref := 'EXPL' || lpad(v_i::text, 4, '0');
    v_nome := 'Produto Exemplo ' || v_i;
    v_desc := 'Descrição de exemplo do produto ' || v_i || '.';
    v_base := jsonb_build_object('nome', v_nome, 'ref_sku', v_ref, 'preco_anterior', '109.90', 'preco_venda', '99.90',
      'peso', '0.300', 'ncm', '6109.10.00', 'preco_custo', '42.00', 'cor_base', NULL, 'cor_apelido', NULL, 'tamanho', NULL,
      'titulo', v_nome || ' - exemplo', 'descricao', v_desc, 'keywords', 'exemplo, teste', 'metatag', v_desc,
      'comprimento', '60', 'largura', '40', 'altura', '2',
      'colecao', 'Coleção Exemplo', 'categoria_tecido', 'Malha', 'linha', 'Casual');  -- Release I3 (não obrigatórios)
    v_linhas := jsonb_build_array(jsonb_build_object('tipo', 'produto', 'valores',
      (SELECT coalesce(jsonb_agg(CASE WHEN u.x = 'foto' THEN '["exemplo"]'::jsonb ELSE coalesce(v_base -> u.x, 'null'::jsonb) END
                                 ORDER BY u.n), '[]'::jsonb)
         FROM unnest(v_campos) WITH ORDINALITY AS u(x, n))));
    FOREACH v_tam IN ARRAY ARRAY['P', 'M'] LOOP
      v_linha := v_base || jsonb_build_object('nome', v_nome || ' Cor Exemplo ' || v_tam, 'ref_sku', v_ref || '-COR-' || v_tam,
        'titulo', public._integracao_titulo_sublinha(v_base ->> 'titulo', 'Cor Exemplo', 'Apelido Exemplo', 'cor_base'),  -- [urg r8]
        'cor_base', 'Cor Exemplo', 'cor_apelido', 'Apelido Exemplo', 'tamanho', v_tam);
      v_linhas := v_linhas || jsonb_build_array(jsonb_build_object('tipo', 'variante', 'valores',
        (SELECT coalesce(jsonb_agg(CASE WHEN u.x = 'foto' THEN '[]'::jsonb ELSE coalesce(v_linha -> u.x, 'null'::jsonb) END
                                   ORDER BY u.n), '[]'::jsonb)
           FROM unnest(v_campos) WITH ORDINALITY AS u(x, n))));
    END LOOP;
    v_out := v_out || jsonb_build_array(jsonb_build_object('modelo_id', 'exemplo-' || lpad(v_i::text, 4, '0'),
      'estado', 'teste', 'assinatura', NULL, 'integrado_em', NULL, 'linhas', v_linhas));
  END LOOP;
  RETURN jsonb_build_object('produtos', v_out, 'proximo_cursor',
    CASE WHEN v_pag = 1 THEN to_jsonb(encode(convert_to('{"exemplo": 2}', 'UTF8'), 'base64')) ELSE 'null'::jsonb END);
END
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_retrato_core(uuid,text[],jsonb)', '2635e1833654111858a301f7ef06ccf1', '{postgres=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r8a: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r8a: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF public._integracao_titulo_sublinha('Vestido Suelen | Ave Rara', 'Preto', 'Noite', 'cor_base') IS DISTINCT FROM 'Vestido Suelen Preto | Ave Rara'
     OR public._integracao_titulo_sublinha('Vestido Suelen | Ave Rara', 'Preto', 'Noite', 'cor_apelido') IS DISTINCT FROM 'Vestido Suelen Noite | Ave Rara'
     OR public._integracao_titulo_sublinha('Produto Exemplo 1 - exemplo', 'Cor Exemplo', 'Apelido Exemplo', 'cor_base') IS DISTINCT FROM 'Produto Exemplo 1 - exemplo Cor Exemplo'
     OR public._integracao_titulo_sublinha(NULL, 'Preto', NULL, 'cor_base') IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r8a: pos-condicao falhou no _integracao_titulo_sublinha (casos do dono)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_titulo_sublinha(text,text,text,text)', 'a847a61f50f4b72608aa10edaa7ac0c9')
    ) AS x(f, d) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.d THEN
      RAISE EXCEPTION 'urg_r8a: pos-condicao falhou em % (nova invoker; md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.d USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                     AND NOT p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r8a: pos-condicao falhou na ACL/secdef/search_path de % (nova invoker)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.integracao_listar(text,jsonb,integer,integer)', '5fd15e4b95fc5555e055935a67af62e8', '{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r8a: pos-condicao falhou em % (wrapper; md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r8a: pos-condicao falhou na ACL/secdef/search_path de % (wrapper)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_exemplo(text[],integer)', 'd57b40f96cc4a4fdbb2f9dc0ddc6c8d7', '{postgres=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'urg_r8a: pos-condicao falhou em % (invoker; md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND NOT p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r8a: pos-condicao falhou na ACL/secdef/search_path de % (invoker)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
