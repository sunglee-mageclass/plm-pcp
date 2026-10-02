-- Inverso de supabase/migrations/20261030110000_integracao_3_campos.sql — GERADO por .superpowers/sdd/2026-10-02-integracao-3-campos/mig/gerar.mjs (os 8 textos de ANTES,
-- lidos da cópia — nunca editar à mão). Ordem:
--   1. guarda: md5 dos 8 ∈ (depois, antes); LIFO: recusa se a I3c (20261030120000) ainda está aplicada (há integrável
--      reprocessado por ela e não devolvido — rode antes supabase/rollback/20261030120000_integracao_3_campos_reprocesso_down.sql).
--   2. integracao_config: tira as 3 chaves de TODA config que as tem (senão o CHECK campos <@ _integracao_layout() falharia no
--      próximo Salvar), rev + 1, 1 registro 'campos' no Log por loja ("Sistema (volta campos informativos)").
--   3. DEFAULT volta a (_integracao_layout())[1:17] (antes do layout de 18).
--   4. os 8 de antes (retrato_core bfcd6aba exigido pelo 20261024200000_down; _integracao_exemplo a7b0687f pelo
--      20261013100000_down). As 3 auxiliares FICAM (sem DROP — brief; inertes, sem EXECUTE para PUBLIC/anon/authenticated) e as
--      3 colunas de integracao_linhas FICAM: o DROP é supabase/rollback/20261030110000_integracao_3_campos_down_drop.sql, separado.
-- Integráveis/integrados marcados DEPOIS da ida ficam com o retrato v = 3 (com ou sem as 3 chaves): a API deixa de entregar as
-- 3 colunas (o layout volta a 18) e o "i" da aba Produtos pode apontar as 3 chaves como diferentes. Integrados nunca mudam.
-- Sem DROP. Aplicar fora de transação: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_layout()', '82832b580e8749d8f50182706ad8c08a', '480106c786ff534affe98e2374c8ce49'),
      ('public._integracao_rotulos()', 'c9e2ea80185a9d300f57a8673b16603c', '53453ee707edde3b1c41b81386149ec5'),
      ('public._integracao_cfg(uuid)', 'a6646c7c458181629d3d1062c1c11e4f', 'db865044a6b9f875c8c920b82f6b9974'),
      ('public._integracao_retrato_core(uuid,text[],jsonb)', 'bfcd6aba0a2f0ebd1a5908888f9c0568', '8a5275cf8c145f88e23c5158c22fdfc6'),
      ('public._integracao_valores(integracao_linhas,text[],text[])', '1397511c97477a103dbeebad85121dd8', '7d094ada6982728a4dfdc96077d51367'),
      ('public._integracao_exemplo(text[],integer)', 'a7b0687f4ef2503fba0d2b8f02718c95', '8882ce651fe5f13a44c60751692da40e'),
      ('public.integracao_marcar(jsonb)', '208d916232f308772c77eaa4220bbf0a', 'b4400251395251b80a458eb11524d172'),
      ('public.integracao_config_ler()', 'fe4614432e39331c4444708e1b00f2ab', '62b81b3853de66118baef1748866b0dd')
    ) AS x(f, antes, depois) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.depois, r.antes) THEN
      RAISE EXCEPTION 'i3b_volta: % mudou depois da ida (md5 %) - refazer o inverso', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regclass('public._bkp_i3c_reprocesso') IS NOT NULL AND EXISTS (
       SELECT 1 FROM public._bkp_i3c_reprocesso b
         JOIN public.integracao_produtos p ON p.modelo_id = b.modelo_id AND p.tenant_id = b.tenant_id
        WHERE p.estado = 'integravel' AND p.assinatura = b.assinatura_depois) THEN
    RAISE EXCEPTION 'i3b_volta: a I3c (20261030120000) ainda esta aplicada (integravel reprocessado) - rode antes o inverso dela (LIFO)'
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DO $config$
DECLARE
  cfg record;
  v_novos text[];
BEGIN
  FOR cfg IN SELECT c.tenant_id, c.campos FROM public.integracao_config c
              WHERE c.campos && ARRAY['colecao', 'categoria_tecido', 'linha']::text[]
              ORDER BY c.tenant_id
                FOR UPDATE
  LOOP
    v_novos := ARRAY(SELECT u.x FROM unnest(cfg.campos) WITH ORDINALITY AS u(x, n)
                      WHERE u.x <> ALL(ARRAY['colecao', 'categoria_tecido', 'linha']::text[]) ORDER BY u.n);
    UPDATE public.integracao_config SET campos = v_novos, rev = rev + 1, atualizado_em = now() WHERE tenant_id = cfg.tenant_id;
    PERFORM public._integracao_logar(cfg.tenant_id, 'campos', NULL,
      jsonb_build_object('antes', to_jsonb(cfg.campos), 'depois', to_jsonb(v_novos)), 'Sistema (volta campos informativos)');
  END LOOP;
END
$config$;

ALTER TABLE public.integracao_config ALTER COLUMN campos SET DEFAULT (public._integracao_layout())[1:17];

CREATE OR REPLACE FUNCTION public._integracao_layout()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Ordem FIXA do layout do pedido (P-60 B). 1-17 = layout (padrão marcado); 18 = Foto (opcional, P-83 A).
  SELECT ARRAY['nome', 'ref_sku', 'preco_anterior', 'preco_venda', 'peso', 'ncm', 'preco_custo', 'cor_base',
               'cor_apelido', 'tamanho', 'titulo', 'descricao', 'keywords', 'metatag', 'comprimento', 'largura',
               'altura', 'foto']::text[]
$function$;

CREATE OR REPLACE FUNCTION public._integracao_rotulos()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'nome', 'Nome', 'ref_sku', 'REF / SKU', 'preco_anterior', 'Preço anterior', 'preco_venda', 'Preço de venda',
    'peso', 'Peso', 'ncm', 'NCM', 'preco_custo', 'Preço de custo', 'cor_base', 'Cor base', 'cor_apelido', 'Cor apelido',
    'tamanho', 'Tamanho', 'titulo', 'Título para a página', 'descricao', 'Descrição', 'keywords', 'Keywords',
    'metatag', 'Metatag Description', 'comprimento', 'Comprimento', 'largura', 'Largura', 'altura', 'Altura',
    'foto', 'Foto')
$function$;

CREATE OR REPLACE FUNCTION public._integracao_cfg(_tenant uuid)
 RETURNS integracao_config
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  c public.integracao_config;
BEGIN
  SELECT * INTO c FROM public.integracao_config WHERE tenant_id = _tenant;
  IF NOT FOUND THEN
    -- linha ausente = padrão (D25): layout 1-17 marcado, Foto desmarcada, 60/50/7/10 (P-89 A); rev 0 = "nunca salva"
    c.tenant_id := _tenant;
    c.campos := (public._integracao_layout())[1:17];
    c.limite_por_minuto := 60;
    c.max_por_pagina := 50;
    c.validade_foto_dias := 7;
    c.bloqueio_tentativas := 10;
    c.rev := 0;
    c.atualizado_em := now();
  END IF;
  RETURN c;
END
$function$;

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
    'retrato', jsonb_build_object('v', 2, 'campos', to_jsonb(v_campos),
      'linhas', jsonb_build_array(jsonb_build_object('tipo', 'produto', 'ordem', 0, 'valores', v_prod,
                                                      'fotos', to_jsonb(v_fotos))) || v_linhas),
    'faltas', v_faltas,
    'completo', jsonb_array_length(v_faltas) = 0,
    'variantes_chaves', to_jsonb(v_chaves),
    'meta', v_meta);
END
$function$;

CREATE OR REPLACE FUNCTION public._integracao_valores(_l integracao_linhas, _chaves text[], _campos_produto text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- valores na ordem de _chaves; campo fora do retrato DESTE produto = null (D6); foto = lista de caminhos (D5)
  SELECT coalesce(jsonb_agg(CASE WHEN NOT (u.k = ANY(coalesce(_campos_produto, '{}'::text[]))) THEN 'null'::jsonb
    ELSE coalesce(CASE u.k
      WHEN 'nome' THEN to_jsonb(_l.nome) WHEN 'ref_sku' THEN to_jsonb(_l.ref_sku)
      WHEN 'preco_anterior' THEN to_jsonb(_l.preco_anterior) WHEN 'preco_venda' THEN to_jsonb(_l.preco_venda)
      WHEN 'peso' THEN to_jsonb(_l.peso) WHEN 'ncm' THEN to_jsonb(_l.ncm) WHEN 'preco_custo' THEN to_jsonb(_l.preco_custo)
      WHEN 'cor_base' THEN to_jsonb(_l.cor_base) WHEN 'cor_apelido' THEN to_jsonb(_l.cor_apelido)
      WHEN 'tamanho' THEN to_jsonb(_l.tamanho) WHEN 'titulo' THEN to_jsonb(_l.titulo)
      WHEN 'descricao' THEN to_jsonb(_l.descricao) WHEN 'keywords' THEN to_jsonb(_l.keywords)
      WHEN 'metatag' THEN to_jsonb(_l.metatag) WHEN 'comprimento' THEN to_jsonb(_l.comprimento)
      WHEN 'largura' THEN to_jsonb(_l.largura) WHEN 'altura' THEN to_jsonb(_l.altura)
      WHEN 'foto' THEN to_jsonb(coalesce(_l.fotos, '{}'::text[]))
    END, 'null'::jsonb) END ORDER BY u.n), '[]'::jsonb)
    FROM unnest(_chaves) WITH ORDINALITY AS u(k, n)
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
      'comprimento', '60', 'largura', '40', 'altura', '2');
    v_linhas := jsonb_build_array(jsonb_build_object('tipo', 'produto', 'valores',
      (SELECT coalesce(jsonb_agg(CASE WHEN u.x = 'foto' THEN '["exemplo"]'::jsonb ELSE coalesce(v_base -> u.x, 'null'::jsonb) END
                                 ORDER BY u.n), '[]'::jsonb)
         FROM unnest(v_campos) WITH ORDINALITY AS u(x, n))));
    FOREACH v_tam IN ARRAY ARRAY['P', 'M'] LOOP
      v_linha := v_base || jsonb_build_object('nome', v_nome || ' Cor Exemplo ' || v_tam, 'ref_sku', v_ref || '-COR-' || v_tam,
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
  -- ruling do controlador, revisão T7 #12 (fix round 2, re-review round 1 Minor 3): a 1ª versão do regex tinha
  -- \{? e \}? INDEPENDENTES, então uma string com só UMA chave ("{<uuid>" ou "<uuid>}") passava o regex mas o
  -- ::uuid rejeita chaves desbalanceadas — 22P02 cru continuava alcançável nesses 2 casos. Fix: as chaves agora
  -- são um par ATÔMICO — '^(\{H\}|H)$', H = 8-4-4-4-12 hex com hifens opcionais — então só "sem chave nenhuma" ou
  -- "as duas chaves" passam; uma chave sozinha cai no "sem modelo_id" (P0001), nunca chega ao cast.
  IF (SELECT count(*) FILTER (WHERE jsonb_typeof(e.x -> 'modelo_id') IS DISTINCT FROM 'string'
                                  OR NOT (e.x ->> 'modelo_id' ~* '^(\{[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\}|[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})$'))
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
    -- ruling do controlador, G-migration fix 1 #G6 (B-M10): reconfere o modulo `criacao` E o modulo da ORIGEM
    -- (produto_acabado/produto_importado), o MESMO predicado base que integracao_salvar reconfere via
    -- _integracao_gates — sem isso, dava pra marcar (e travar) um produto de revenda com o modulo
    -- produto_acabado desligado. Mesma mensagem/ERRCODE do salvar (integracao_sem_permissao: <gate>, 42501).
    -- ruling do controlador, G-migration fix 2 #H3 (A + B-DM-3): a checagem NÃO compara mais o TEXTO do motivo
    -- (frágil — qualquer edição de copy destravaria isto em silêncio). _integracao_gates agora expõe
    -- 'modulo_bloqueado' (chave ASCII estável, true só quando o motivo de base é de módulo) — usa ISSO.
    IF coalesce((public._integracao_gates(r.modelo_id) ->> 'modulo_bloqueado')::boolean, false) THEN
      RAISE EXCEPTION 'integracao_sem_permissao: compartilhado' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.integracao_config_ler()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(false);
  v_cfg public.integracao_config;
BEGIN
  v_cfg := public._integracao_cfg(v_tenant);
  -- LER os campos = quem vê a tela (a aba Produtos monta as colunas); config da API = SÓ super admin (v4)
  RETURN jsonb_build_object('campos', to_jsonb(v_cfg.campos), 'layout', to_jsonb(public._integracao_layout()),
    'rotulos', public._integracao_rotulos(), 'rev', v_cfg.rev,
    'api', CASE WHEN public.is_super_admin() THEN jsonb_build_object(
      'limite_por_minuto', v_cfg.limite_por_minuto, 'max_por_pagina', v_cfg.max_por_pagina,
      'validade_foto_dias', v_cfg.validade_foto_dias, 'bloqueio_tentativas', v_cfg.bloqueio_tentativas) END);
END
$function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_layout()', '82832b580e8749d8f50182706ad8c08a'),
      ('public._integracao_rotulos()', 'c9e2ea80185a9d300f57a8673b16603c'),
      ('public._integracao_cfg(uuid)', 'a6646c7c458181629d3d1062c1c11e4f'),
      ('public._integracao_retrato_core(uuid,text[],jsonb)', 'bfcd6aba0a2f0ebd1a5908888f9c0568'),
      ('public._integracao_valores(integracao_linhas,text[],text[])', '1397511c97477a103dbeebad85121dd8'),
      ('public._integracao_exemplo(text[],integer)', 'a7b0687f4ef2503fba0d2b8f02718c95'),
      ('public.integracao_marcar(jsonb)', '208d916232f308772c77eaa4220bbf0a'),
      ('public.integracao_config_ler()', 'fe4614432e39331c4444708e1b00f2ab')
    ) AS x(f, md5) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION 'i3b_volta: pos-condicao falhou em % (md5 %)', r.f, coalesce(v, 'ausente') USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._integracao_layout()'),
      ('public._integracao_rotulos()'),
      ('public._integracao_cfg(uuid)'),
      ('public._integracao_retrato_core(uuid,text[],jsonb)'),
      ('public._integracao_valores(integracao_linhas,text[],text[])'),
      ('public._integracao_exemplo(text[],integer)'),
      ('public._integracao_padrao()'),
      ('public._integracao_opcionais()'),
      ('public._integracao_extras(uuid)')
    ) AS x(f) LOOP
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM aclexplode(coalesce((SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)),
                    acldefault('f', (SELECT p.proowner FROM pg_proc p WHERE p.oid = to_regprocedure(r.f))))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'i3b_volta: % executavel por PUBLIC/anon/authenticated (inv. 9)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.integracao_marcar(jsonb)'),
      ('public.integracao_config_ler()')
    ) AS x(f) LOOP
    IF has_function_privilege('anon', r.f, 'EXECUTE') OR NOT has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM aclexplode(coalesce((SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)),
                    acldefault('f', (SELECT p.proowner FROM pg_proc p WHERE p.oid = to_regprocedure(r.f))))) a
                   WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'i3b_volta: ACL inesperada em % (RPC da tela: authenticated sim, anon/PUBLIC nao)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE d.adrelid = 'public.integracao_config'::regclass AND a.attname = 'campos') IS DISTINCT FROM '(_integracao_layout())[1:17]' THEN
    RAISE EXCEPTION 'i3b_volta: pos-condicao falhou no DEFAULT de integracao_config.campos' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.integracao_config c WHERE NOT (c.campos <@ public._integracao_layout())) THEN
    RAISE EXCEPTION 'i3b_volta: config com chave fora do layout' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
