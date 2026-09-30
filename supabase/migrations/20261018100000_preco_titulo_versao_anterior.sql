-- Preço anterior e Título herdados da VERSÃO ANTERIOR + congelar ao excluir (P-146..P-159; plano
-- .superpowers/sdd/2026-09-30-preco-anterior/plan.md v2 + rulings RB1-RB4 e M4). GERADA por
-- .superpowers/sdd/2026-09-30-preco-anterior/mig/gerar.py a partir do texto VIVO da cópia — NÃO editar à mão.
-- • Fonte única: _modelo_versao_anterior (família P-149 A + título herdado recursivo, R4) e _modelo_automaticos (1 linha
--   SEMPRE, RB3) — o retrato, o congelamento e a RPC do front leem daqui; src/lib/versao-anterior.ts só compõe.
-- • _integracao_retrato_core — 3 trocas: Preço anterior automático = preco_venda GRAVADO (> 0) da versão anterior (P-146;
--   vazio = falta quando o campo está marcado, P-158/P-159 A); v1/órfã = o próprio preco_venda (P-147); Título automático
--   = herdado da anterior na v2+ (P-155 B). O resto byte a byte ('v', 2 incluso: sem reprocesso). Integráveis/integrados
--   ficam com o retrato CONGELADO (o "i" de retrato_difere mostra a diferença, P-151/P-153 A).
-- • _replicar_cards_plan_tecido_core — 1 troca (+ comentário): a réplica nasce com Título e Preço anterior AUTOMÁTICOS
--   (P-150 A/P-155 B; herdam da MAIOR versão existente — a réplica é max(versao)+1).
-- • Congelar ao excluir (P-154 A + R1-R3): fila modelo_versao_congelar_fila (RLS sem policy + REVOKE ALL) + BEFORE DELETE
--   que só ANOTA + CONSTRAINT TRIGGER adiado que APLICA no COMMIT (pula as que sumiram e as Integráveis/Integradas — R2;
--   falha FECHADA: erro/lock desfaz a exclusão com P0001 'versao_congelar: <SQLSTATE>').
-- • RPC modelos_versao_anterior(uuid[]) (DEFINER, loja do usuário, teto 500, anon sem EXECUTE).
-- • Sem backfill (P-151: digitados ficam; automáticos passam a valer pela função).
-- • Ordem: guarda -> fotografia de integracao_produtos/linhas -> funções -> fila -> RPC -> COMMENT -> REVOKE ->
--   pós-condição PESADA (md5, ACL, fila, fotografias iguais, HMAC) -> CREATE TRIGGER em modelos POR ÚLTIMO (SHARE ROW
--   EXCLUSIVE: bloqueia gravações de cards só até o COMMIT; RB4) -> pós-condição leve -> NOTIFY -> COMMIT.
-- • Reaplicar é no-op (guarda aceita o texto de DEPOIS; tabela/gatilhos IF NOT EXISTS).
-- • Inverso: supabase/rollback/20261018100000_preco_titulo_versao_anterior_down.sql (LIFO: roda DEPOIS do inverso da
--   20261018110000 e ANTES dos inversos da 20261014100000/20261013100000 — as guardas deles exigem o texto de antes).
-- Aplicar fora de transação (psql -v ON_ERROR_STOP=1 -f), com o client_encoding abaixo ANTES do BEGIN (há acentos).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  -- funções redefinidas: texto de ANTES (4cd22e4b.../aaf3f2e4...) ou o de DEPOIS (reaplicar = no-op)
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_retrato_core(uuid,text[],jsonb)', '4cd22e4bb5bf081c1ac2fcf34d4a6cf2', 'ed728d100ef6a048427a61c69fa3a1ac'),
      ('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)', 'aaf3f2e4e4bd8eb14b99d53c79a653da', '2f2669cf7136c15038950ac1c1161637')
    ) AS x(f, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 'preco_versao: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- funções novas: ausentes ou com o texto de DEPOIS
  FOR r IN SELECT * FROM (VALUES
      ('public._modelo_versao_anterior(uuid)', '1e50e83e02176b5d09481d827cea3a41'),
      ('public._modelo_automaticos(uuid)', '3a80e1c213968d7e2ec0f0ba8a97b0d0'),
      ('public.fn_modelo_versao_congelar_captura()', '3738030da556e51a81186b04347f8ec4'),
      ('public.fn_modelo_versao_congelar_aplicar()', '12ec7e8d8263f7187b7d3ef685cf040c'),
      ('public.modelos_versao_anterior(uuid[])', '7ef5b3b3d45a712e9c183474832262a5')
    ) AS x(f, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.depois THEN
      RAISE EXCEPTION 'preco_versao: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- a fila: ausente ou com a estrutura esperada
  IF to_regclass('public.modelo_versao_congelar_fila') IS NOT NULL
     AND (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || CASE WHEN a.attnotnull THEN 't' ELSE 'f' END, '|' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.modelo_versao_congelar_fila') AND a.attnum > 0 AND NOT a.attisdropped) IS DISTINCT FROM 'modelo_id:uuid:t|tenant_id:uuid:t|preco_antes:numeric:f|preco_fonte:text:f|preco_versao:integer:f|titulo_antes:text:f|titulo_fonte:text:f|titulo_versao:integer:f|excluido_id:uuid:t|criado_at:timestamp with time zone:t' THEN
    RAISE EXCEPTION 'preco_versao: modelo_versao_congelar_fila com estrutura inesperada - outra frente mexeu' USING ERRCODE = 'P0001';
  END IF;
  -- os 2 gatilhos: ausentes ou com a definição esperada
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_modelo_versao_congelar_captura' AND NOT t.tgisinternal
              AND (t.tgrelid <> 'public.modelos'::regclass OR t.tgtype <> 11 OR t.tgconstraint <> 0
                   OR t.tgfoid <> to_regprocedure('public.fn_modelo_versao_congelar_captura()'))) THEN
    RAISE EXCEPTION 'preco_versao: trg_modelo_versao_congelar_captura com definicao inesperada' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_modelo_versao_congelar_aplicar' AND NOT t.tgisinternal
              AND (t.tgrelid <> to_regclass('public.modelo_versao_congelar_fila') OR t.tgtype <> 5 OR t.tgconstraint = 0
                   OR NOT t.tgdeferrable OR NOT t.tginitdeferred
                   OR t.tgfoid <> to_regprocedure('public.fn_modelo_versao_congelar_aplicar()'))) THEN
    RAISE EXCEPTION 'preco_versao: trg_modelo_versao_congelar_aplicar com definicao inesperada' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- fotografia de integracao_produtos/integracao_linhas (a pós-condição exige a MESMA ao final)
DO $foto$
BEGIN
  PERFORM set_config('app.pv_ip', (SELECT md5(coalesce(string_agg(p::text, '|' ORDER BY p.id), '')) FROM public.integracao_produtos p), true);
  PERFORM set_config('app.pv_il', (SELECT md5(coalesce(string_agg(l::text, '|' ORDER BY l.id), '')) FROM public.integracao_linhas l), true);
END
$foto$;

-- 1. fonte única (helpers)
CREATE OR REPLACE FUNCTION public._modelo_versao_anterior(_modelo_id uuid)
 RETURNS TABLE(anterior_id uuid, anterior_versao integer, anterior_preco numeric, titulo_herdado text, titulo_origem_versao integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- [preco-versao v1] Regra de FAMÍLIA (P-149 A) + título herdado (P-155 B/R4) — fonte única (o retrato, o congelamento
  -- ao excluir e a RPC do front leem daqui; o TS src/lib/versao-anterior.ts só COMPÕE). Família = coalesce(modelo_base_id,
  -- id), MESMA loja. Anterior = a maior versao ESTRITAMENTE menor; empate de versao: created_at mais novo, depois id.
  -- 0 linhas = sem anterior (v1 ou órfã). anterior_preco = preco_venda GRAVADO da anterior quando > 0; senão NULL (P-158:
  -- nunca o sugerido nem o próprio preço). Título herdado = título EFETIVO da anterior, recursivo (desenrolado): o 1º
  -- digitado (não-branco) descendo a cadeia de níveis; se nenhum, o calculado do Nome do nível mais baixo.
  WITH m AS (
    SELECT x.id, x.tenant_id, x.versao, coalesce(x.modelo_base_id, x.id) AS raiz
      FROM public.modelos x
     WHERE x.id = _modelo_id
  ), niveis AS (
    SELECT DISTINCT ON (p.versao) p.id, p.versao, p.nome, p.preco_venda, p.titulo_pagina
      FROM m
      JOIN public.modelos p
        ON p.tenant_id = m.tenant_id AND (p.id = m.raiz OR p.modelo_base_id = m.raiz)
       AND p.id <> m.id AND p.versao < m.versao
     ORDER BY p.versao DESC, p.created_at DESC NULLS LAST, p.id DESC
  ), ant AS (
    SELECT n.id, n.versao, n.preco_venda FROM niveis n ORDER BY n.versao DESC LIMIT 1
  ), dig AS (
    SELECT n.versao, btrim(n.titulo_pagina) AS t
      FROM niveis n
     WHERE nullif(btrim(coalesce(n.titulo_pagina, '')), '') IS NOT NULL
     ORDER BY n.versao DESC LIMIT 1
  ), base AS (
    SELECT n.versao, n.nome FROM niveis n ORDER BY n.versao ASC LIMIT 1
  ), loja AS (
    SELECT t.nome FROM m JOIN public.tenants t ON t.id = m.tenant_id
  )
  SELECT ant.id,
         ant.versao,
         CASE WHEN ant.preco_venda > 0 THEN ant.preco_venda END,
         coalesce((SELECT dig.t FROM dig),
                  nullif(public._titulo_pagina_calculado((SELECT base.nome FROM base), (SELECT loja.nome FROM loja)), '')),
         coalesce((SELECT dig.versao FROM dig), (SELECT base.versao FROM base))
    FROM ant
$function$
;

CREATE OR REPLACE FUNCTION public._modelo_automaticos(_modelo_id uuid)
 RETURNS TABLE(preco_auto numeric, preco_fonte text, preco_versao integer, titulo_auto text, titulo_fonte text, titulo_versao integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- [preco-versao v1] Composição dos 2 automáticos do card (usada pelo retrato e pelo congelamento ao excluir — a MESMA
  -- definição nos dois). SEMPRE exatamente 1 linha (RB3: o retrato faz SELECT ... INTO; 0 linhas deixaria a v1 sem título).
  -- Com anterior: preço = o da anterior (pode ser NULL, P-158), fonte 'anterior'; título = o herdado, fonte 'herdado'.
  -- Sem anterior (v1/órfã): preço = o próprio preco_venda (como o retrato fazia), título = o calculado do próprio Nome;
  -- fonte 'proprio'. Modelo inexistente: 1 linha de NULLs.
  SELECT CASE WHEN a.anterior_id IS NOT NULL THEN a.anterior_preco ELSE m.preco_venda END,
         CASE WHEN a.anterior_id IS NOT NULL THEN 'anterior' WHEN m.id IS NOT NULL THEN 'proprio' END,
         a.anterior_versao,
         CASE WHEN a.anterior_id IS NOT NULL THEN a.titulo_herdado
              ELSE nullif(public._titulo_pagina_calculado(m.nome, (SELECT t.nome FROM public.tenants t WHERE t.id = m.tenant_id)), '')
         END,
         CASE WHEN a.anterior_id IS NOT NULL THEN 'herdado' WHEN m.id IS NOT NULL THEN 'proprio' END,
         a.anterior_versao
    FROM (SELECT 1 AS um) AS u
    LEFT JOIN public.modelos m ON m.id = _modelo_id
    LEFT JOIN LATERAL public._modelo_versao_anterior(m.id) a ON true
$function$
;

-- 2. retrato e replicar (trocas exatas no texto vivo)
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
  -- 272/272 na copia). Titulo automatico = _titulo_pagina_calculado(nome, tenants.nome — a MARCA da loja).
  SELECT t.nome INTO v_loja_nome FROM public.tenants t WHERE t.id = m.tenant_id;
  -- [preco-versao v1] P-146/P-155 B/P-158: automáticos pela VERSÃO ANTERIOR (_modelo_automaticos)
  SELECT a.titulo_auto, a.preco_auto INTO v_titulo_auto, v_preco_anterior_auto FROM public._modelo_automaticos(m.id) a;
  -- Preco anterior automatico = acompanha o preco de venda EFETIVO — a MESMA expressao que o retrato usa para
  -- "Preço de venda" (campo 'preco_venda' abaixo: m.preco_venda, sem outra fonte de preco efetivo nesta funcao).
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
$function$
;

CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(_tenant uuid, _destino_colecao_id uuid, _destino_subcolecao_id uuid, _modelo_ids uuid[], _rev_base integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sub_nome text; v_col_nome text; v_mes uuid; v_ano uuid;
  v_plan uuid; v_sub_pt uuid; v_rev int;
  v_root uuid; v_versao int; v_novo uuid; v_slot uuid; v_slot_idx int; v_ln uuid;
  o record; mt_old record; v_novo_mt uuid; v_out jsonb := '[]'::jsonb;
begin
  -- (0) Guardas de tenant/destino.
  if _tenant is null or _tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inválida.' using errcode = '42501';
  end if;
  if (select tenant_id from colecoes where id = _destino_colecao_id) is distinct from _tenant then
    raise exception 'Coleção de destino de outra loja.' using errcode = '42501';
  end if;
  if _destino_subcolecao_id is not null then
    select nome into v_sub_nome from colecao_subcolecoes
      where id = _destino_subcolecao_id and colecao_id = _destino_colecao_id and tenant_id = _tenant;
    if v_sub_nome is null then
      raise exception 'Subcoleção de destino inválida.' using errcode = '42501';
    end if;
  end if;
  -- nome da coleção destino p/ a coluna TEXTO `modelos.colecao` (o card lê isso) + mes/ano.
  select nome, mes_id, ano_id into v_col_nome, v_mes, v_ano from colecoes where id = _destino_colecao_id;

  if exists (select 1 from modelos where id = any(_modelo_ids) and tenant_id = _tenant and origem = 'revenda') then
    raise exception 'Replicar cards de revenda ainda não é suportado.' using errcode = 'P0001';
  end if;

  -- (1) Trava otimista do DESTINO (só quando o front conhece o rev — destino == coleção aberta).
  if _rev_base is not null then
    select plan_rev into v_rev from colecoes where id = _destino_colecao_id for update;
    if coalesce(v_rev, 0) is distinct from _rev_base then
      raise exception 'conflito_versao: o registro foi salvo por outra pessoa' using errcode = 'P0409';
    end if;
  end if;

  -- (2) Garante plan_tecido + subcoleção-do-plano no DESTINO.
  insert into plan_tecido (colecao_id) values (_destino_colecao_id)
    on conflict (colecao_id) do update set updated_at = now()
    returning id into v_plan;

  if _destino_subcolecao_id is not null then
    insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
    values (v_plan, _destino_subcolecao_id,
            coalesce((select ordem from colecao_subcolecoes where id = _destino_subcolecao_id), 0))
    on conflict (plan_id, subcolecao_id) do update set ordem = excluded.ordem
    returning id into v_sub_pt;
  else
    select id into v_sub_pt from plan_tecido_subcolecoes
      where plan_id = v_plan and subcolecao_id is null limit 1;
    if v_sub_pt is null then
      insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
      values (v_plan, null, 0) returning id into v_sub_pt;
    end if;
  end if;

  -- (3) Por modelo origem.
  for o in select * from modelos where id = any(_modelo_ids) and tenant_id = _tenant for update loop
    v_root := coalesce(o.modelo_base_id, o.id);
    select coalesce(max(versao), 1) + 1 into v_versao
      from modelos where (id = v_root or modelo_base_id = v_root) and tenant_id = _tenant;

    -- Modelo novo: escalares + colecao TEXTO (v3) + custos stored (v3) + semana herdada.
    -- REF do original MANTIDA (copia ref/ref_auto — regra do dono; o card nasce
    -- ordem_criacao_enviada=false, então fn_modelo_ref_auto não sobrescreve).
    -- [preco-versao v1] P-150 A/P-155 B: título e preço anterior nascem AUTOMÁTICOS (herdam da maior versão existente)
    insert into modelos (
      tenant_id, nome, colecao, colecao_id, subcolecao, mes_id, ano_id,
      linha_id, categoria_principal_id, categoria_secundaria_id, subcategoria1_id, subcategoria2_id,
      estilista_id, modelista_id, piloteiro1_id, piloteiro2_id, piloteiro3_id,
      preco_venda, preco_atacado, markup_editado, proporcoes, custos_adicionais, custo_simulado,
      custo_terceirizados_previsto, custo_peca_previsto, custo_tecido_total, custo_forro_total,
      custo_entretela_total, custo_aviamento_total,
      observacoes_tecnicas, observacoes_gerais, observacoes_mao_obra,
      fotos_modelo, fotos_referencia, croqui_url, desenho_tecnico_url, tecidos_planejados,
      origem, status_planejamento, ordem_criacao_enviada, lancado, data_lancamento, semana,
      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto, peso_kg, comprimento_cm, largura_cm, altura_cm, titulo_pagina, ncm, preco_anterior, tamanho_tipo
    ) values (
      _tenant, o.nome, v_col_nome, _destino_colecao_id, v_sub_nome, v_mes, v_ano,
      o.linha_id, o.categoria_principal_id, o.categoria_secundaria_id, o.subcategoria1_id, o.subcategoria2_id,
      o.estilista_id, o.modelista_id, o.piloteiro1_id, o.piloteiro2_id, o.piloteiro3_id,
      o.preco_venda, o.preco_atacado, o.markup_editado, o.proporcoes, o.custos_adicionais, coalesce(o.custo_simulado, '{}'::jsonb),
      o.custo_terceirizados_previsto, o.custo_peca_previsto, o.custo_tecido_total, o.custo_forro_total,
      o.custo_entretela_total, o.custo_aviamento_total,
      o.observacoes_tecnicas, o.observacoes_gerais, o.observacoes_mao_obra,
      o.fotos_modelo, o.fotos_referencia, o.croqui_url, o.desenho_tecnico_url, o.tecidos_planejados,
      'interno', 'em_planejamento', false, false, o.data_lancamento, o.semana,
      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto, o.peso_kg, o.comprimento_cm, o.largura_cm, o.altura_cm, NULL, o.ncm, NULL, o.tamanho_tipo
    ) returning id into v_novo;

    -- BOM PROFUNDO. Tecido/forro/entretela + variantes BLOCO-A-BLOCO (loop por bloco de origem).
    for mt_old in select * from modelo_tecidos where modelo_id = o.id order by numero, tipo, id loop
      insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto)
      values (v_novo, mt_old.artigo_id, mt_old.numero, mt_old.tipo, mt_old.consumo, mt_old.loss_percent, mt_old.custo_previsto)
      returning id into v_novo_mt;
      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador, complementa_variante_ids)
      select v_novo_mt, mtv.variante_tecido_id, mtv.ordem, mtv.multiplicador, mtv.complementa_variante_ids
        from modelo_tecido_variantes mtv where mtv.modelo_tecido_id = mt_old.id;
    end loop;

    insert into modelo_grades (modelo_id, variante_numero, grades, grade_total)
    select v_novo, variante_numero, grades, grade_total from modelo_grades where modelo_id = o.id;

    insert into modelo_aviamentos (modelo_id, aviamento_id, numero, consumo, loss_percent, custo_previsto, variante_aviamento_id)
    select v_novo, aviamento_id, numero, consumo, loss_percent, custo_previsto, variante_aviamento_id
      from modelo_aviamentos where modelo_id = o.id;

    insert into modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto)
    select _tenant, v_novo, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto
      from modelo_etiquetas where modelo_id = o.id;

    insert into modelo_observacoes (tenant_id, modelo_id, ordem, descricao, observacao)
    select _tenant, v_novo, ordem, descricao, observacao from modelo_observacoes where modelo_id = o.id;

    insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, aprovado, motivo_reprovacao, observacoes)
    select _tenant, v_novo, categoria_terceirizado_id, valor, null, null, observacoes
      from modelo_servico_mo where modelo_id = o.id;

    -- (3b) LINHA do bucket certo: casa (linha_id, categoria_id) do modelo → slot no bucket do OTB.
    select id into v_ln from plan_tecido_linhas
      where sub_id = v_sub_pt
        and linha_id is not distinct from o.linha_id
        and categoria_id is not distinct from o.categoria_principal_id
      order by ordem limit 1;
    if v_ln is null then
      insert into plan_tecido_linhas (sub_id, linha_id, categoria_id, ordem)
      values (v_sub_pt, o.linha_id, o.categoria_principal_id,
              coalesce((select max(ordem) + 1 from plan_tecido_linhas where sub_id = v_sub_pt), 0))
      returning id into v_ln;
    end if;

    select sl.id into v_slot
      from plan_tecido_slots sl
      where sl.linha_ref_id = v_ln and sl.modelo_id is null
      order by sl.slot_index
      limit 1 for update skip locked;

    if v_slot is not null then
      -- [tamanho-em v1] vaga livre reaproveitada: com card ela fica NULL (o valor mora no modelo, copiado da origem).
      update plan_tecido_slots set modelo_id = v_novo, tamanho_tipo = null where id = v_slot;
    else
      select coalesce(max(slot_index), -1) + 1 into v_slot_idx
        from plan_tecido_slots where linha_ref_id = v_ln;
      insert into plan_tecido_slots (linha_ref_id, modelo_id, slot_index, nome, preco_venda,
                                     categoria_id, custos_adicionais, custo_simulado)
      values (v_ln, v_novo, v_slot_idx, o.nome, o.preco_venda,
              o.categoria_principal_id, o.custos_adicionais, coalesce(o.custo_simulado, '{}'::jsonb))
      returning id into v_slot;
    end if;

    -- (3c) Copia materiais/variantes/proporcoes/categoria_tecido do slot ORIGEM (se houver) → destino.
    delete from plan_tecido_materiais where slot_id = v_slot;
    with src as (
      select ps.id as slot_id from plan_tecido_slots ps
        where ps.modelo_id = o.id and ps.tenant_id = _tenant limit 1
    ), mats as (
      insert into plan_tecido_materiais (slot_id, artigo_id, tipo, numero, consumo, loss_percent, ordem)
      select v_slot, pm.artigo_id, pm.tipo, pm.numero, pm.consumo, pm.loss_percent, pm.ordem
        from plan_tecido_materiais pm join src on pm.slot_id = src.slot_id
      returning id, tipo, numero
    )
    insert into plan_tecido_variantes (material_id, variante_tecido_id, ordem, multiplicador, grades, grade_total, cor_id, cor_apelido_id)
    select m.id, pv.variante_tecido_id, pv.ordem, pv.multiplicador, pv.grades, pv.grade_total, pv.cor_id, pv.cor_apelido_id
      from plan_tecido_variantes pv
      join plan_tecido_materiais pm_old on pm_old.id = pv.material_id
      join src on pm_old.slot_id = src.slot_id
      join mats m on m.tipo = pm_old.tipo and m.numero = pm_old.numero;
    update plan_tecido_slots dst set
      proporcoes = coalesce((select proporcoes from plan_tecido_slots where modelo_id = o.id and tenant_id = _tenant limit 1), dst.proporcoes),
      categoria_tecido_id = coalesce((select categoria_tecido_id from plan_tecido_slots where modelo_id = o.id and tenant_id = _tenant limit 1), dst.categoria_tecido_id)
    where dst.id = v_slot;

    v_out := v_out || jsonb_build_object('origem_modelo_id', o.id, 'novo_modelo_id', v_novo, 'slot_id', v_slot);
  end loop;

  return v_out;
end $function$
;

-- 3. congelar ao excluir: a fila (padrão kanban_recalculo_fila: RLS sem policy + REVOKE ALL; sem FK — a versão pode
--    sumir na mesma transação e o COMMIT a pula; a fila vive só dentro da transação)
CREATE TABLE IF NOT EXISTS public.modelo_versao_congelar_fila (
  modelo_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  preco_antes numeric,
  preco_fonte text,
  preco_versao integer,
  titulo_antes text,
  titulo_fonte text,
  titulo_versao integer,
  excluido_id uuid NOT NULL,
  criado_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS modelo_versao_congelar_fila_tenant_idx ON public.modelo_versao_congelar_fila (tenant_id);
ALTER TABLE public.modelo_versao_congelar_fila ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.modelo_versao_congelar_fila FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.modelo_versao_congelar_fila IS 'P-154 A (congelar ao excluir): fila por transação — a captura (BEFORE DELETE em modelos) anota, o gatilho adiado trg_modelo_versao_congelar_aplicar aplica e esvazia no COMMIT. Fora de uma transação fica sempre vazia.';

CREATE OR REPLACE FUNCTION public.fn_modelo_versao_congelar_captura()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [preco-versao v1] P-154 A + R1/R3: ao EXCLUIR um modelo, ANOTA (só anota — o COMMIT aplica) os automáticos de TODAS as
  -- outras versões da família dele (mesma loja = OLD.tenant_id), calculados AGORA. A 1ª anotação da transação vence (ON
  -- CONFLICT DO NOTHING): num DELETE de várias linhas, o 1º BEFORE vê a família inteira (as linhas seguintes ainda não
  -- foram apagadas e o SET NULL do modelo_base_id é ação RI do FIM do comando). Só entra quem tem algo a congelar
  -- (Preço anterior NULL ou Título automático). Gatilho antes de trg_zz_integracao_trava_del (ordem alfabética): se a
  -- trava recusar, o comando aborta e a anotação volta junto.
  INSERT INTO public.modelo_versao_congelar_fila AS q
         (modelo_id, tenant_id, preco_antes, preco_fonte, preco_versao, titulo_antes, titulo_fonte, titulo_versao, excluido_id)
  SELECT p.id, p.tenant_id, a.preco_auto, a.preco_fonte, a.preco_versao, a.titulo_auto, a.titulo_fonte, a.titulo_versao, OLD.id
    FROM public.modelos p
    CROSS JOIN LATERAL public._modelo_automaticos(p.id) a
   WHERE p.tenant_id = OLD.tenant_id
     AND (p.id = coalesce(OLD.modelo_base_id, OLD.id) OR p.modelo_base_id = coalesce(OLD.modelo_base_id, OLD.id))
     AND p.id <> OLD.id
     AND (p.preco_anterior IS NULL OR nullif(btrim(coalesce(p.titulo_pagina, '')), '') IS NULL)
  ON CONFLICT (modelo_id) DO NOTHING;
  RETURN OLD;
END
$function$
;

CREATE OR REPLACE FUNCTION public.fn_modelo_versao_congelar_aplicar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  v_f record;
  v_m record;
  v_d record;
  v_preco boolean;
  v_titulo boolean;
BEGIN
  -- [preco-versao v1] P-154 A + R1/R2/R3: aplica no COMMIT o que a captura anotou. Drena a fila da LOJA (o 1º evento faz
  -- tudo; os outros acham a fila vazia). Por versão que SOBROU: (1) sumiu na mesma transação -> pula; (2) Integrável/
  -- Integrada -> pula (R2: o retrato já guarda o valor e o "i" avisa; a trava #14 nunca é furada); (3) congela o valor de
  -- ANTES só se o campo continua automático, a fonte de antes era a versão anterior e o automático de DEPOIS é outro.
  -- Um "aguardando" (antes NULL, P-158) não tem o que congelar. FALHA FECHADA (ruling do controlador): qualquer erro
  -- (lock de 2 s, bug) desfaz a exclusão INTEIRA com P0001 ASCII 'versao_congelar: <SQLSTATE>' (erro-mensagem.ts traduz).
  -- O UPDATE sobe o rev da versão (P0409 num Sheet aberto -> merge) e audita em nome de quem excluiu; fora da fila do
  -- kanban (o WHEN de trg_kanban_fila_upd não cita esses 2 campos).
  BEGIN
    FOR v_f IN
      WITH dr AS (
        DELETE FROM public.modelo_versao_congelar_fila q WHERE q.tenant_id = NEW.tenant_id RETURNING q.*
      )
      SELECT * FROM dr ORDER BY dr.modelo_id
    LOOP
      SELECT x.id, x.preco_anterior, x.titulo_pagina INTO v_m
        FROM public.modelos x
       WHERE x.id = v_f.modelo_id AND x.tenant_id = v_f.tenant_id
         FOR UPDATE;
      CONTINUE WHEN NOT FOUND;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.integracao_produtos ip
                             WHERE ip.modelo_id = v_f.modelo_id AND ip.estado IN ('integravel', 'integrado'));
      SELECT a.preco_auto, a.titulo_auto INTO v_d FROM public._modelo_automaticos(v_f.modelo_id) a;
      v_preco := v_m.preco_anterior IS NULL AND v_f.preco_fonte = 'anterior' AND v_f.preco_antes IS NOT NULL
                 AND v_d.preco_auto IS DISTINCT FROM v_f.preco_antes;
      v_titulo := nullif(btrim(coalesce(v_m.titulo_pagina, '')), '') IS NULL AND v_f.titulo_fonte = 'herdado'
                  AND v_f.titulo_antes IS NOT NULL AND v_d.titulo_auto IS DISTINCT FROM v_f.titulo_antes;
      IF v_preco AND v_titulo THEN
        UPDATE public.modelos SET preco_anterior = v_f.preco_antes, titulo_pagina = v_f.titulo_antes WHERE id = v_f.modelo_id;
      ELSIF v_preco THEN
        UPDATE public.modelos SET preco_anterior = v_f.preco_antes WHERE id = v_f.modelo_id;
      ELSIF v_titulo THEN
        UPDATE public.modelos SET titulo_pagina = v_f.titulo_antes WHERE id = v_f.modelo_id;
      END IF;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'versao_congelar: %', SQLSTATE USING ERRCODE = 'P0001', DETAIL = SQLERRM;
  END;
  RETURN NULL;
END
$function$
;

DO $gatilho_fila$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_modelo_versao_congelar_aplicar'
                  AND tgrelid = 'public.modelo_versao_congelar_fila'::regclass) THEN
    CREATE CONSTRAINT TRIGGER trg_modelo_versao_congelar_aplicar
      AFTER INSERT ON public.modelo_versao_congelar_fila
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_versao_congelar_aplicar();
  END IF;
END
$gatilho_fila$;

-- 4. RPC do front
CREATE OR REPLACE FUNCTION public.modelos_versao_anterior(_modelo_ids uuid[])
 RETURNS TABLE(modelo_id uuid, anterior_id uuid, anterior_versao integer, anterior_preco numeric, titulo_herdado text, titulo_origem_versao integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [preco-versao v1] RPC do front (Sheet do Planejamento e Integração > Produtos): 1 linha por id DA LOJA do usuário
  -- (= RLS de modelos, sem gate de módulo); anterior_* NULL quando não há versão anterior. Teto de 500 ids.
  IF coalesce(cardinality(_modelo_ids), 0) > 500 THEN
    RAISE EXCEPTION 'versao_anterior: limite de 500 ids' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY
  SELECT m.id, a.anterior_id, a.anterior_versao, a.anterior_preco, a.titulo_herdado, a.titulo_origem_versao
    FROM public.modelos m
    LEFT JOIN LATERAL public._modelo_versao_anterior(m.id) a ON true
   WHERE m.id = ANY(_modelo_ids)
     AND m.tenant_id = public.get_user_tenant_id();
END
$function$
;

-- 5. contrato das colunas (ShareUpdateExclusive: não bloqueia leitura nem escrita)
COMMENT ON COLUMN public.modelos.preco_anterior IS 'Preço anterior (F3.6; P-146/P-158). NULL = automático (_modelo_automaticos): v2+ = preco_venda GRAVADO (> 0) da VERSÃO ANTERIOR da família (vazio enquanto ela não tem preço); v1/órfã = o próprio preco_venda. Não-NULL = fixado à mão ou congelado ao excluir uma versão da família (P-154). Nunca ler cru.';
COMMENT ON COLUMN public.modelos.titulo_pagina IS 'Título para a página (F3.6; P-155 B). NULL = automático (_modelo_automaticos): v2+ = título EFETIVO da versão anterior (herdado, recursivo); v1/órfã = _titulo_pagina_calculado(nome, tenants.nome). Não-NULL = digitado ou congelado ao excluir uma versão (P-154). Consumidor/ERP: nunca ler cru.';

-- 6. ACL (invariante #9: internas revogadas dos TRÊS; a RPC só para authenticated)
REVOKE EXECUTE ON FUNCTION public._integracao_retrato_core(uuid, text[], jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._replicar_cards_plan_tecido_core(uuid, uuid, uuid, uuid[], integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._modelo_versao_anterior(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._modelo_automaticos(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_modelo_versao_congelar_captura() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_modelo_versao_congelar_aplicar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.modelos_versao_anterior(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.modelos_versao_anterior(uuid[]) TO authenticated;

-- 7. pós-condição PESADA — ANTES do gatilho em modelos (RB4)
DO $pos$
DECLARE
  r record;
  v text;
  v_n bigint;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public._integracao_retrato_core(uuid,text[],jsonb)')));
  IF v IS DISTINCT FROM 'ed728d100ef6a048427a61c69fa3a1ac' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - _integracao_retrato_core com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)')));
  IF v IS DISTINCT FROM '2f2669cf7136c15038950ac1c1161637' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - _replicar_cards_plan_tecido_core com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._modelo_versao_anterior(uuid)')));
  IF v IS DISTINCT FROM '1e50e83e02176b5d09481d827cea3a41' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - _modelo_versao_anterior com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._modelo_automaticos(uuid)')));
  IF v IS DISTINCT FROM '3a80e1c213968d7e2ec0f0ba8a97b0d0' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - _modelo_automaticos com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_versao_congelar_captura()')));
  IF v IS DISTINCT FROM '3738030da556e51a81186b04347f8ec4' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - fn_modelo_versao_congelar_captura com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_versao_congelar_aplicar()')));
  IF v IS DISTINCT FROM '12ec7e8d8263f7187b7d3ef685cf040c' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - fn_modelo_versao_congelar_aplicar com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.modelos_versao_anterior(uuid[])')));
  IF v IS DISTINCT FROM '7ef5b3b3d45a712e9c183474832262a5' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - modelos_versao_anterior com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT unnest(ARRAY['public._integracao_retrato_core(uuid,text[],jsonb)', 'public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)', 'public._modelo_versao_anterior(uuid)', 'public._modelo_automaticos(uuid)', 'public.fn_modelo_versao_congelar_captura()', 'public.fn_modelo_versao_congelar_aplicar()']) AS sig LOOP
    IF has_function_privilege('public', to_regprocedure(r.sig), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure(r.sig), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.sig), 'EXECUTE') THEN
      RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - % com EXECUTE para PUBLIC/anon/authenticated', r.sig USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.modelos_versao_anterior(uuid[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.modelos_versao_anterior(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - ACL de modelos_versao_anterior' USING ERRCODE = 'P0001';
  END IF;
  -- a fila: estrutura, RLS ligada SEM policy, sem privilégio p/ PUBLIC/anon/authenticated, VAZIA, gatilho adiado
  IF (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || CASE WHEN a.attnotnull THEN 't' ELSE 'f' END, '|' ORDER BY a.attnum) FROM pg_attribute a WHERE a.attrelid = to_regclass('public.modelo_versao_congelar_fila') AND a.attnum > 0 AND NOT a.attisdropped) IS DISTINCT FROM 'modelo_id:uuid:t|tenant_id:uuid:t|preco_antes:numeric:f|preco_fonte:text:f|preco_versao:integer:f|titulo_antes:text:f|titulo_fonte:text:f|titulo_versao:integer:f|excluido_id:uuid:t|criado_at:timestamp with time zone:t'
     OR NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.modelo_versao_congelar_fila'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = 'public.modelo_versao_congelar_fila'::regclass)
     OR has_table_privilege('anon', 'public.modelo_versao_congelar_fila', 'SELECT,INSERT,UPDATE,DELETE')
     OR has_table_privilege('authenticated', 'public.modelo_versao_congelar_fila', 'SELECT,INSERT,UPDATE,DELETE')
     OR EXISTS (SELECT 1 FROM public.modelo_versao_congelar_fila) THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - modelo_versao_congelar_fila fora do esperado' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_modelo_versao_congelar_aplicar' AND NOT t.tgisinternal
                  AND t.tgrelid = 'public.modelo_versao_congelar_fila'::regclass AND t.tgtype = 5 AND t.tgconstraint <> 0
                  AND t.tgdeferrable AND t.tginitdeferred AND t.tgenabled = 'O'
                  AND t.tgfoid = 'public.fn_modelo_versao_congelar_aplicar()'::regprocedure) THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - trg_modelo_versao_congelar_aplicar ausente ou diferente' USING ERRCODE = 'P0001';
  END IF;
  -- integráveis/integrados: retratos, assinaturas e linhas da API INTACTOS (a fotografia de antes = a de agora; um
  -- marcar concorrente entre as 2 fotografias aborta a migration — falha fechada) + HMAC confere com o retrato
  IF current_setting('app.pv_ip', true) IS DISTINCT FROM
       (SELECT md5(coalesce(string_agg(p::text, '|' ORDER BY p.id), '')) FROM public.integracao_produtos p)
     OR current_setting('app.pv_il', true) IS DISTINCT FROM
       (SELECT md5(coalesce(string_agg(l::text, '|' ORDER BY l.id), '')) FROM public.integracao_linhas l) THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - integracao_produtos/integracao_linhas mudaram durante a migration' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM public.integracao_produtos p
   WHERE p.estado IN ('integravel', 'integrado') AND p.retrato IS NOT NULL
     AND p.assinatura IS DISTINCT FROM public._integracao_assinar(p.retrato);
  IF v_n > 0 THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - % assinatura(s) nao conferem com o retrato', v_n USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

-- 8. POR ÚLTIMO: o gatilho de captura em modelos (SHARE ROW EXCLUSIVE até o COMMIT — horário calmo)
DO $gatilho$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_modelo_versao_congelar_captura'
                  AND tgrelid = 'public.modelos'::regclass) THEN
    CREATE TRIGGER trg_modelo_versao_congelar_captura
      BEFORE DELETE ON public.modelos
      FOR EACH ROW EXECUTE FUNCTION public.fn_modelo_versao_congelar_captura();
  END IF;
END
$gatilho$;

DO $pos2$
DECLARE
  v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_modelo_versao_congelar_captura' AND NOT t.tgisinternal
                  AND t.tgrelid = 'public.modelos'::regclass AND t.tgtype = 11 AND t.tgconstraint = 0 AND t.tgenabled = 'O'
                  AND t.tgfoid = 'public.fn_modelo_versao_congelar_captura()'::regprocedure) THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - trg_modelo_versao_congelar_captura ausente ou diferente' USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._integracao_retrato_core(uuid,text[],jsonb)')));
  IF v IS DISTINCT FROM 'ed728d100ef6a048427a61c69fa3a1ac' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - _integracao_retrato_core com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)')));
  IF v IS DISTINCT FROM '2f2669cf7136c15038950ac1c1161637' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - _replicar_cards_plan_tecido_core com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._modelo_versao_anterior(uuid)')));
  IF v IS DISTINCT FROM '1e50e83e02176b5d09481d827cea3a41' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - _modelo_versao_anterior com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._modelo_automaticos(uuid)')));
  IF v IS DISTINCT FROM '3a80e1c213968d7e2ec0f0ba8a97b0d0' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - _modelo_automaticos com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_versao_congelar_captura()')));
  IF v IS DISTINCT FROM '3738030da556e51a81186b04347f8ec4' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - fn_modelo_versao_congelar_captura com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_versao_congelar_aplicar()')));
  IF v IS DISTINCT FROM '12ec7e8d8263f7187b7d3ef685cf040c' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - fn_modelo_versao_congelar_aplicar com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.modelos_versao_anterior(uuid[])')));
  IF v IS DISTINCT FROM '7ef5b3b3d45a712e9c183474832262a5' THEN
    RAISE EXCEPTION 'preco_versao: pos-condicao (ida) - modelos_versao_anterior com md5 %', coalesce(v, 'ausente') USING ERRCODE = 'P0001';
  END IF;
END
$pos2$;

NOTIFY pgrst, 'reload schema';

COMMIT;
