-- ============================================================================
-- R13 T1 — OC por fornecedor com VARIOS produtos (Produto Acabado e Importado).
-- Migration UNICA, GERADA por .superpowers/sdd/2026-10-06-r14/mig/gerar-r13.mjs
-- (blocos SQL a mao + 4 CREATE OR REPLACE por troca exata; NAO editar a mao — rode o gerador).
--
-- Aplicar FORA de txn de teste:
--   docker exec -i supabase_db_banco-local psql -U postgres -d copia4 -v ON_ERROR_STOP=1 \
--     < supabase/migrations/20261105100000_urg_r13_oc_itens.sql
-- Destrutiva (move o produto do cabecalho para itens, zera o ponteiro) => BEGIN..COMMIT atomico, idempotente onde da.
-- 55P03/40P01 = NADA mudou, rodar de novo (horario calmo). Nenhuma trava em auth/storage na ida.
-- ============================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL statement_timeout = '0';

-- ── Passo 2: fotos temporarias de ANTES (so dentro desta txn; as pos-condicoes comparam) ──
-- _imp_etapas_brl_oc (SETOF record: ordem/rotulo/base/data_vencimento/valor_brl) de toda OC importada: md5 agregado por OC.
CREATE TEMP TABLE _r13_imp_brl ON COMMIT DROP AS
  SELECT o.id AS oc_id,
         md5(coalesce((
           SELECT string_agg(
             e.ordem::text || '|' || coalesce(e.rotulo,'') || '|' || coalesce(e.base,'') || '|' ||
             coalesce(e.data_vencimento::text,'') || '|' || coalesce(e.valor_brl::text,''),
             ';' ORDER BY e.ordem, e.rotulo)
           FROM public._imp_etapas_brl_oc(o.id) e), '')) AS h
    FROM public.ocs_importado o;

-- md5 ordenado das parcelas (PA/PI): id, numero, valor, vencimento, status, manual.
CREATE TEMP TABLE _r13_parcelas_antes ON COMMIT DROP AS
  SELECT tipo_oc,
         md5(coalesce(string_agg(
           id::text || '|' || coalesce(numero_parcela::text,'') || '|' || coalesce(valor::text,'') || '|' ||
           coalesce(data_vencimento::text,'') || '|' || coalesce(status,'') || '|' || coalesce(vencimento_manual::text,''),
           '' ORDER BY id), '')) AS h
    FROM public.parcelas
   WHERE tipo_oc IN ('p_acabado','p_importado')
   GROUP BY tipo_oc;

-- entradas do custo por produto COMPRADO (status/valor_unitario_real/landed) — a identidade do custo real.
CREATE TEMP TABLE _r13_custo_antes ON COMMIT DROP AS
  SELECT 'pa'::text AS fam, pa.id AS produto_id, o.status, o.valor_unitario_real::numeric AS vur, NULL::numeric AS landed
    FROM public.produtos_acabados pa
    JOIN public.ocs_p_acabado o ON o.produto_acabado_id = pa.id
  UNION ALL
  SELECT 'pi', pi.id, o.status, NULL::numeric, o.custo_unitario_landed_real::numeric
    FROM public.produtos_importados pi
    JOIN public.ocs_importado o ON o.produto_importado_id = pi.id;

-- contagem de ponteiros ANTES (pos-condicao do backup).
CREATE TEMP TABLE _r13_ptr_antes ON COMMIT DROP AS
  SELECT 'pa'::text AS fam, count(*) AS n FROM public.ocs_p_acabado WHERE produto_acabado_id IS NOT NULL
  UNION ALL
  SELECT 'pi', count(*) FROM public.ocs_importado WHERE produto_importado_id IS NOT NULL;

-- ============================ Passo 3: tabelas de itens + indices + RLS + perms + gatilhos ============================
-- Produto Acabado
CREATE TABLE IF NOT EXISTS public.ocs_p_acabado_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  oc_id uuid NOT NULL REFERENCES public.ocs_p_acabado(id) ON DELETE CASCADE,
  ordem int NOT NULL,
  produto_acabado_id uuid REFERENCES public.produtos_acabados(id),  -- NO ACTION; NULL = item avulso
  nome_produto varchar(200) NOT NULL,
  grupo_id uuid, categoria_id uuid, subcategoria1_id uuid, subcategoria2_id uuid,
  ref_fornecedor varchar(120), composicao text,
  grade_proporcao jsonb NOT NULL DEFAULT '{}'::jsonb,
  grade_detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  variantes jsonb NOT NULL DEFAULT '[]'::jsonb,
  qtd_total int NOT NULL DEFAULT 0,
  valor_unitario numeric(12,2) NOT NULL DEFAULT 0,
  desconto_pct numeric(6,2) NOT NULL DEFAULT 0,
  valor_bruto numeric(14,2) NOT NULL DEFAULT 0,
  valor_total_desconto numeric(14,2) NOT NULL DEFAULT 0,
  valor_unitario_real numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'encomendado' CHECK (status IN ('encomendado','recebido')),
  data_entrega date,
  nota_fiscal varchar(120),
  anexo_nf_url text,
  responsavel_recebimento_id uuid REFERENCES public.colaboradores(id),
  devolucao text,
  revisao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocs_p_acabado_itens_oc_ordem_ux UNIQUE (oc_id, ordem)
);
CREATE INDEX IF NOT EXISTS ocpa_itens_oc_idx ON public.ocs_p_acabado_itens (oc_id);
CREATE INDEX IF NOT EXISTS ocpa_itens_produto_idx ON public.ocs_p_acabado_itens (produto_acabado_id) WHERE produto_acabado_id IS NOT NULL;
ALTER TABLE public.ocs_p_acabado_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.ocs_p_acabado_itens;
CREATE POLICY tenant_select ON public.ocs_p_acabado_itens AS PERMISSIVE FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_p_acabado_itens FROM authenticated;
REVOKE ALL ON TABLE public.ocs_p_acabado_itens FROM anon;
COMMENT ON TABLE public.ocs_p_acabado_itens IS 'R13: 1 linha por produto da OC de Produto Acabado; escrita so pelas RPCs (DEFINER). Cliente so le.';

-- Importado
CREATE TABLE IF NOT EXISTS public.ocs_importado_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  oc_id uuid NOT NULL REFERENCES public.ocs_importado(id) ON DELETE CASCADE,
  ordem int NOT NULL,
  produto_importado_id uuid REFERENCES public.produtos_importados(id),  -- NO ACTION; NULL = item avulso
  nome_produto varchar(200) NOT NULL,
  grupo_id uuid, categoria_id uuid, subcategoria1_id uuid, subcategoria2_id uuid,
  ref_fornecedor varchar(120), composicao text,
  grade_proporcao jsonb NOT NULL DEFAULT '{}'::jsonb,
  grade_detalhe jsonb NOT NULL DEFAULT '{}'::jsonb,
  variantes jsonb NOT NULL DEFAULT '[]'::jsonb,
  qtd_total int NOT NULL DEFAULT 0,
  valor_unitario_m1 numeric(14,4) NOT NULL DEFAULT 0,
  peso_kg numeric(12,4) NOT NULL DEFAULT 0,
  transporte_m2 numeric(14,4) NOT NULL DEFAULT 0,
  desconto_pct numeric(6,2) NOT NULL DEFAULT 0,
  valor_bruto numeric(14,2) NOT NULL DEFAULT 0,
  valor_total_desconto numeric(14,2) NOT NULL DEFAULT 0,
  valor_unitario_real numeric(12,2) NOT NULL DEFAULT 0,
  custo_unitario_landed_real numeric(14,4) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'encomendado' CHECK (status IN ('encomendado','recebido')),
  data_entrega date,
  nota_fiscal varchar(120),
  anexo_nf_url text,
  responsavel_recebimento_id uuid REFERENCES public.colaboradores(id),
  devolucao text,
  revisao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ocs_importado_itens_oc_ordem_ux UNIQUE (oc_id, ordem)
);
CREATE INDEX IF NOT EXISTS oci_itens_oc_idx ON public.ocs_importado_itens (oc_id);
CREATE INDEX IF NOT EXISTS oci_itens_produto_idx ON public.ocs_importado_itens (produto_importado_id) WHERE produto_importado_id IS NOT NULL;
ALTER TABLE public.ocs_importado_itens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_select ON public.ocs_importado_itens;
CREATE POLICY tenant_select ON public.ocs_importado_itens AS PERMISSIVE FOR SELECT
  USING (tenant_id = public.get_user_tenant_id());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ocs_importado_itens FROM authenticated;
REVOKE ALL ON TABLE public.ocs_importado_itens FROM anon;
COMMENT ON TABLE public.ocs_importado_itens IS 'R13: 1 linha por produto da OC de Produto Importado; escrita so pelas RPCs (DEFINER). Cliente so le.';

-- ── Gatilhos por familia: 1 OC por produto (passou do cabecalho para o item) + mesma loja ──
-- PA: "1 OC por produto". FOR UPDATE no produto e EXISTS em outro item. Texto IGUAL ao antigo enforce_oc_pa_vinculo_unico
-- (erro-mensagem.ts nao muda).
CREATE OR REPLACE FUNCTION public.fn_oc_item_produto_unico()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_num text; v_prod uuid; v_tab text;
BEGIN
  v_tab := TG_ARGV[0];  -- 'ocs_p_acabado' | 'ocs_importado'
  IF v_tab = 'ocs_p_acabado' THEN
    v_prod := NEW.produto_acabado_id;
    IF v_prod IS NULL THEN RETURN NEW; END IF;
    PERFORM 1 FROM public.produtos_acabados WHERE id = v_prod FOR UPDATE;
    SELECT o.numero INTO v_num
      FROM public.ocs_p_acabado_itens it JOIN public.ocs_p_acabado o ON o.id = it.oc_id
     WHERE it.produto_acabado_id = v_prod AND it.id IS DISTINCT FROM NEW.id LIMIT 1;
  ELSE
    v_prod := NEW.produto_importado_id;
    IF v_prod IS NULL THEN RETURN NEW; END IF;
    PERFORM 1 FROM public.produtos_importados WHERE id = v_prod FOR UPDATE;
    SELECT o.numero INTO v_num
      FROM public.ocs_importado_itens it JOIN public.ocs_importado o ON o.id = it.oc_id
     WHERE it.produto_importado_id = v_prod AND it.id IS DISTINCT FROM NEW.id LIMIT 1;
  END IF;
  IF v_num IS NOT NULL THEN
    RAISE EXCEPTION 'Este produto já tem a OC % vinculada — desvincule antes.', v_num USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_oc_item_produto_unico() FROM PUBLIC, anon, authenticated;

-- Mesma loja: item, OC e produto da mesma loja (espelha enforce_oc_pa_produto_tenant). P0001 ASCII.
CREATE OR REPLACE FUNCTION public.fn_oc_item_tenant()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_tab text; v_oc_tenant uuid; v_prod_tenant uuid;
BEGIN
  v_tab := TG_ARGV[0];
  IF v_tab = 'ocs_p_acabado' THEN
    SELECT tenant_id INTO v_oc_tenant FROM public.ocs_p_acabado WHERE id = NEW.oc_id;
    IF NEW.produto_acabado_id IS NOT NULL THEN
      SELECT tenant_id INTO v_prod_tenant FROM public.produtos_acabados WHERE id = NEW.produto_acabado_id;
    END IF;
  ELSE
    SELECT tenant_id INTO v_oc_tenant FROM public.ocs_importado WHERE id = NEW.oc_id;
    IF NEW.produto_importado_id IS NOT NULL THEN
      SELECT tenant_id INTO v_prod_tenant FROM public.produtos_importados WHERE id = NEW.produto_importado_id;
    END IF;
  END IF;
  IF v_oc_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'item_oc_loja_diferente: a OC e o item sao de lojas diferentes' USING ERRCODE = 'P0001';
  END IF;
  IF v_prod_tenant IS NOT NULL AND v_prod_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'item_oc_loja_diferente: o produto e de outra loja' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fn_oc_item_tenant() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ocpa_item_tenant ON public.ocs_p_acabado_itens;
CREATE TRIGGER trg_ocpa_item_tenant BEFORE INSERT OR UPDATE OF produto_acabado_id, oc_id, tenant_id
  ON public.ocs_p_acabado_itens FOR EACH ROW EXECUTE FUNCTION public.fn_oc_item_tenant('ocs_p_acabado');
DROP TRIGGER IF EXISTS trg_ocpa_item_produto_unico ON public.ocs_p_acabado_itens;
CREATE TRIGGER trg_ocpa_item_produto_unico BEFORE INSERT OR UPDATE OF produto_acabado_id, oc_id, tenant_id
  ON public.ocs_p_acabado_itens FOR EACH ROW EXECUTE FUNCTION public.fn_oc_item_produto_unico('ocs_p_acabado');

DROP TRIGGER IF EXISTS trg_oci_item_tenant ON public.ocs_importado_itens;
CREATE TRIGGER trg_oci_item_tenant BEFORE INSERT OR UPDATE OF produto_importado_id, oc_id, tenant_id
  ON public.ocs_importado_itens FOR EACH ROW EXECUTE FUNCTION public.fn_oc_item_tenant('ocs_importado');
DROP TRIGGER IF EXISTS trg_oci_item_produto_unico ON public.ocs_importado_itens;
CREATE TRIGGER trg_oci_item_produto_unico BEFORE INSERT OR UPDATE OF produto_importado_id, oc_id, tenant_id
  ON public.ocs_importado_itens FOR EACH ROW EXECUTE FUNCTION public.fn_oc_item_produto_unico('ocs_importado');

-- ── Backup do vinculo (RLS sem policy + REVOKE ALL) ──
CREATE TABLE IF NOT EXISTS public._bkp_r13_oc_vinculo (
  familia text NOT NULL,
  oc_id uuid NOT NULL,
  produto_id uuid NOT NULL,
  gravado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._bkp_r13_oc_vinculo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_r13_oc_vinculo FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public._bkp_r13_oc_vinculo IS 'R13: backup do ponteiro produto_*_id do cabecalho antes de zerar; so para a volta.';

-- ============================ Passo 4: DROP NOT NULL de nome_produto + COMMENT nas colunas LEGADAS ============================
ALTER TABLE public.ocs_p_acabado ALTER COLUMN nome_produto DROP NOT NULL;
ALTER TABLE public.ocs_importado ALTER COLUMN nome_produto DROP NOT NULL;

DO $leg$
DECLARE c text;
BEGIN
  FOREACH c IN ARRAY ARRAY['produto_acabado_id','nome_produto','subcategoria1_id','subcategoria2_id','ref_fornecedor',
    'composicao','grade_proporcao','grade_detalhe','variantes','valor_unitario','desconto_pct','valor_unitario_real',
    'nota_fiscal','responsavel_recebimento_id','devolucao','revisao','anexo_nf_url']
  LOOP
    EXECUTE format('COMMENT ON COLUMN public.ocs_p_acabado.%I IS %L', c, 'LEGADO R13: nao ler (o dado vive em ocs_p_acabado_itens)');
  END LOOP;
  FOREACH c IN ARRAY ARRAY['produto_importado_id','nome_produto','subcategoria1_id','subcategoria2_id','ref_fornecedor',
    'composicao','grade_proporcao','grade_detalhe','variantes','valor_unitario_m1','peso_kg','transporte_m2','desconto_pct',
    'valor_unitario_real','nota_fiscal','responsavel_recebimento_id','devolucao','revisao','anexo_nf_url']
  LOOP
    EXECUTE format('COMMENT ON COLUMN public.ocs_importado.%I IS %L', c, 'LEGADO R13: nao ler (o dado vive em ocs_importado_itens)');
  END LOOP;
END $leg$;

-- ============================ Passo 7a: helpers novos (DEFINER, REVOKE dos 3) — §2.1 ============================
-- Sigla do lote: fornecedor _norm3(nome_fantasia)||'FOR' + (ACE se todos acessorios | G1+C2 se todos mesmo grupo+categoria | DIV).
-- Com 1 item reproduz byte a byte o calculo de fn_oc_p_acabado_numero. _itens = jsonb array [{grupo_id, categoria_id}].
CREATE OR REPLACE FUNCTION public._oc_lote_sigla(_empresa uuid, _itens jsonb)
 RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_sig text;
  v_g uuid; v_c uuid;
  v_todos_ace boolean;
  v_mesmo_g boolean;
  v_mesmo_c boolean;
  v_n int;
BEGIN
  v_sig := public._norm3((SELECT nome_fantasia FROM public.empresas WHERE id = _empresa));
  IF v_sig = '' OR v_sig IS NULL THEN v_sig := 'FOR'; END IF;
  _itens := coalesce(_itens, '[]'::jsonb);
  SELECT count(*) INTO v_n FROM jsonb_array_elements(_itens);
  IF v_n = 0 THEN RETURN v_sig || 'DIV'; END IF;

  -- todos acessorios?
  SELECT bool_and(public._grupo_eh_acessorio(nullif(e->>'grupo_id','')::uuid)) INTO v_todos_ace
    FROM jsonb_array_elements(_itens) e;
  IF coalesce(v_todos_ace, false) THEN RETURN v_sig || 'ACE'; END IF;

  -- todos mesmo grupo E mesma categoria?
  SELECT count(DISTINCT coalesce(e->>'grupo_id','')) = 1,
         count(DISTINCT coalesce(e->>'categoria_id','')) = 1
    INTO v_mesmo_g, v_mesmo_c
    FROM jsonb_array_elements(_itens) e;
  IF v_mesmo_g AND v_mesmo_c THEN
    v_g := nullif((_itens->0)->>'grupo_id','')::uuid;
    v_c := nullif((_itens->0)->>'categoria_id','')::uuid;
    RETURN v_sig
      || substr(public._norm3((SELECT nome FROM public.grupos_produto WHERE id = v_g)), 1, 1)
      || substr(public._norm3((SELECT nome FROM public.categorias_produto WHERE id = v_c)), 1, 2);
  END IF;

  RETURN v_sig || 'DIV';
END $fn$;
REVOKE EXECUTE ON FUNCTION public._oc_lote_sigla(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Numero proximo com advisory lock por (tabela, loja): MAX+1 (5 digitos), serializando pedidos simultaneos (fim do 23505).
-- Saida IDENTICA ao calculo antigo (v_sig || '-' || lpad(num,5,'0')).
CREATE OR REPLACE FUNCTION public._oc_numero_proximo(_tabela text, _tenant uuid, _sig text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE v_num bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('oc_numero:' || _tabela || ':' || _tenant::text));
  IF _tabela = 'ocs_p_acabado' THEN
    SELECT coalesce(max((substring(numero FROM '([0-9]+)$'))::bigint), 0) + 1 INTO v_num
      FROM public.ocs_p_acabado WHERE tenant_id = _tenant AND numero ~ ('^' || _sig || '-[0-9]+$');
  ELSIF _tabela = 'ocs_importado' THEN
    SELECT coalesce(max((substring(numero FROM '([0-9]+)$'))::bigint), 0) + 1 INTO v_num
      FROM public.ocs_importado WHERE tenant_id = _tenant AND numero ~ ('^' || _sig || '-[0-9]+$');
  ELSE
    RAISE EXCEPTION 'oc_numero_tabela_invalida: %', _tabela USING ERRCODE = 'P0001';
  END IF;
  RETURN _sig || '-' || lpad(v_num::text, 5, '0');
END $fn$;
REVOKE EXECUTE ON FUNCTION public._oc_numero_proximo(text, uuid, text) FROM PUBLIC, anon, authenticated;

-- Montador de item a partir do produto SALVO (PA). Grade por _pa_grade_variante (espelho de splitMaiorResto). Produto de outra
-- loja => P0002 nao_encontrado: produto (ASCII). Devolve jsonb com nome/taxonomia/ref/composicao/valores + grade/variantes.
CREATE OR REPLACE FUNCTION public._ocpa_item_de_produto(_tenant uuid, _produto_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE p record; v_grade jsonb; v_variantes jsonb; v_bruto numeric; v_vtd numeric; v_vur numeric;
        r record; v_var_split jsonb; v_var_grade jsonb; kv record;
BEGIN
  SELECT * INTO p FROM public.produtos_acabados WHERE id = _produto_id;
  IF p.id IS NULL OR p.tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'nao_encontrado: produto' USING ERRCODE = 'P0002';
  END IF;
  -- grade_detalhe do ITEM = {ordem:{tam:{pedida,recebida:0,defeito:0}}}: por variante, _pa_grade_variante(qtd da variante)
  -- reparte a qtd pela proporcao da grade (ou {UN:qtd} em Acessorios); cada tamanho vira {pedida, recebida:0, defeito:0}.
  v_grade := '{}'::jsonb;
  FOR r IN SELECT v.ordem, coalesce(v.qtd,0) AS qtd FROM public.produto_acabado_variantes v
           WHERE v.produto_acabado_id = _produto_id ORDER BY v.ordem
  LOOP
    v_var_split := public._pa_grade_variante(p.grupo_id, coalesce(p.grade_proporcao, '{}'::jsonb), r.qtd);
    v_var_grade := '{}'::jsonb;
    FOR kv IN SELECT key, value FROM jsonb_each_text(coalesce(v_var_split, '{}'::jsonb)) LOOP
      v_var_grade := v_var_grade || jsonb_build_object(kv.key,
        jsonb_build_object('pedida', coalesce(kv.value::numeric, 0), 'recebida', 0, 'defeito', 0));
    END LOOP;
    v_grade := v_grade || jsonb_build_object(r.ordem::text, v_var_grade);
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'ordem', v.ordem, 'cor_id', v.cor_id, 'cor_apelido_id', v.cor_apelido_id, 'qtd', v.qtd)
           ORDER BY v.ordem), '[]'::jsonb)
    INTO v_variantes
    FROM public.produto_acabado_variantes v WHERE v.produto_acabado_id = _produto_id;
  v_bruto := round(coalesce(p.valor_unitario, 0) * coalesce(p.qtd_total, 0), 2);
  v_vtd := round(v_bruto * (1 - coalesce(p.desconto_pct, 0) / 100.0), 2);
  v_vur := CASE WHEN coalesce(p.qtd_total, 0) > 0 THEN round(v_vtd / p.qtd_total, 2) ELSE 0 END;
  RETURN jsonb_build_object(
    'produto_acabado_id', p.id, 'nome_produto', p.nome, 'grupo_id', p.grupo_id, 'categoria_id', p.categoria_id,
    'subcategoria1_id', p.subcategoria1_id, 'subcategoria2_id', p.subcategoria2_id, 'ref_fornecedor', p.ref_fornecedor,
    'composicao', p.composicao, 'grade_proporcao', coalesce(p.grade_proporcao, '{}'::jsonb), 'grade_detalhe', v_grade,
    'variantes', v_variantes, 'qtd_total', coalesce(p.qtd_total, 0), 'valor_unitario', coalesce(p.valor_unitario, 0),
    'desconto_pct', coalesce(p.desconto_pct, 0), 'valor_bruto', v_bruto, 'valor_total_desconto', v_vtd,
    'valor_unitario_real', v_vur);
END $fn$;
REVOKE EXECUTE ON FUNCTION public._ocpa_item_de_produto(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Montador de item a partir do produto SALVO (PI). Valores em M1 (sem câmbio); landed fica 0 ate o recebimento ratear.
CREATE OR REPLACE FUNCTION public._oci_item_de_produto(_tenant uuid, _produto_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE p record; v_grade jsonb; v_variantes jsonb; v_bruto numeric; v_vtd numeric; v_vur numeric;
        r record; v_var_split jsonb; v_var_grade jsonb; kv record;
BEGIN
  SELECT * INTO p FROM public.produtos_importados WHERE id = _produto_id;
  IF p.id IS NULL OR p.tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'nao_encontrado: produto' USING ERRCODE = 'P0002';
  END IF;
  v_grade := '{}'::jsonb;
  FOR r IN SELECT v.ordem, coalesce(v.qtd,0) AS qtd FROM public.produto_importado_variantes v
           WHERE v.produto_importado_id = _produto_id ORDER BY v.ordem
  LOOP
    v_var_split := public._pa_grade_variante(p.grupo_id, coalesce(p.grade_proporcao, '{}'::jsonb), r.qtd);
    v_var_grade := '{}'::jsonb;
    FOR kv IN SELECT key, value FROM jsonb_each_text(coalesce(v_var_split, '{}'::jsonb)) LOOP
      v_var_grade := v_var_grade || jsonb_build_object(kv.key,
        jsonb_build_object('pedida', coalesce(kv.value::numeric, 0), 'recebida', 0, 'defeito', 0));
    END LOOP;
    v_grade := v_grade || jsonb_build_object(r.ordem::text, v_var_grade);
  END LOOP;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'ordem', v.ordem, 'cor_id', v.cor_id, 'cor_apelido_id', v.cor_apelido_id, 'qtd', v.qtd)
           ORDER BY v.ordem), '[]'::jsonb)
    INTO v_variantes
    FROM public.produto_importado_variantes v WHERE v.produto_importado_id = _produto_id;
  v_bruto := round(coalesce(p.valor_unitario_m1, 0) * coalesce(p.qtd_total, 0), 2);
  v_vtd := round(v_bruto * (1 - coalesce(p.desconto_pct, 0) / 100.0), 2);
  v_vur := CASE WHEN coalesce(p.qtd_total, 0) > 0 THEN round(v_vtd / p.qtd_total, 2) ELSE 0 END;
  RETURN jsonb_build_object(
    'produto_importado_id', p.id, 'nome_produto', p.nome, 'grupo_id', p.grupo_id, 'categoria_id', p.categoria_id,
    'subcategoria1_id', p.subcategoria1_id, 'subcategoria2_id', p.subcategoria2_id, 'ref_fornecedor', p.ref_fornecedor,
    'composicao', p.composicao, 'grade_proporcao', coalesce(p.grade_proporcao, '{}'::jsonb), 'grade_detalhe', v_grade,
    'variantes', v_variantes, 'qtd_total', coalesce(p.qtd_total, 0), 'valor_unitario_m1', coalesce(p.valor_unitario_m1, 0),
    'peso_kg', coalesce(p.peso_kg, 0), 'transporte_m2', coalesce(p.transporte_m2, 0), 'desconto_pct', coalesce(p.desconto_pct, 0),
    'valor_bruto', v_bruto, 'valor_total_desconto', v_vtd, 'valor_unitario_real', v_vur, 'custo_unitario_landed_real', 0);
END $fn$;
REVOKE EXECUTE ON FUNCTION public._oci_item_de_produto(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Motivos "fora do pedido" (espelho de motivosForaDoPedido, 93ce43e1): ordem fixa. _familia = 'pa'|'pi'. Retorna text[].
CREATE OR REPLACE FUNCTION public._oc_produto_motivos(_familia text, _produto_id uuid)
 RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  p record; m text[] := ARRAY[]::text[];
  v_tem_oc boolean; v_qtd int; v_valor numeric; v_nvar int; v_sum_var int; v_acess boolean;
BEGIN
  -- Espelho de motivosForaDoPedido (93ce43e1), ORDEM FIXA: ja_tem_oc, sem_nome, sem_fornecedor, sem_quantidade, sem_variante,
  -- soma_variantes, grade_vazia (fora Acessorios), sem_valor. (Cotacao de etapa do PI fica para a RPC do pedido — T3.)
  IF _familia = 'pa' THEN
    SELECT pa.id, pa.nome, pa.grupo_id, pa.empresa_id, pa.qtd_total, pa.valor_unitario AS valor, pa.grade_proporcao INTO p
      FROM public.produtos_acabados pa WHERE pa.id = _produto_id;
    SELECT EXISTS(SELECT 1 FROM public.ocs_p_acabado_itens WHERE produto_acabado_id = _produto_id) INTO v_tem_oc;
    SELECT count(*), coalesce(sum(coalesce(qtd,0)),0) INTO v_nvar, v_sum_var
      FROM public.produto_acabado_variantes WHERE produto_acabado_id = _produto_id;
  ELSE
    SELECT pi.id, pi.nome, pi.grupo_id, pi.empresa_id, pi.qtd_total, pi.valor_unitario_m1 AS valor, pi.grade_proporcao INTO p
      FROM public.produtos_importados pi WHERE pi.id = _produto_id;
    SELECT EXISTS(SELECT 1 FROM public.ocs_importado_itens WHERE produto_importado_id = _produto_id) INTO v_tem_oc;
    SELECT count(*), coalesce(sum(coalesce(qtd,0)),0) INTO v_nvar, v_sum_var
      FROM public.produto_importado_variantes WHERE produto_importado_id = _produto_id;
  END IF;
  IF p.id IS NULL THEN RETURN ARRAY['sem_produto']; END IF;

  v_acess := public._grupo_eh_acessorio(p.grupo_id);
  v_qtd := coalesce(p.qtd_total, 0);
  v_valor := coalesce(p.valor, 0);

  IF v_tem_oc THEN m := array_append(m, 'ja_tem_oc'); END IF;
  IF nullif(btrim(coalesce(p.nome,'')), '') IS NULL THEN m := array_append(m, 'sem_nome'); END IF;
  IF p.empresa_id IS NULL THEN m := array_append(m, 'sem_fornecedor'); END IF;
  IF v_qtd <= 0 THEN m := array_append(m, 'sem_quantidade'); END IF;
  IF v_nvar = 0 THEN m := array_append(m, 'sem_variante'); END IF;
  IF v_nvar > 0 AND v_sum_var <> v_qtd THEN m := array_append(m, 'soma_variantes'); END IF;
  IF NOT v_acess AND coalesce(p.grade_proporcao, '{}'::jsonb) = '{}'::jsonb THEN m := array_append(m, 'grade_vazia'); END IF;
  IF v_valor <= 0 THEN m := array_append(m, 'sem_valor'); END IF;
  RETURN m;
END $fn$;
REVOKE EXECUTE ON FUNCTION public._oc_produto_motivos(text, uuid) FROM PUBLIC, anon, authenticated;

-- Derivados do cabecalho a partir dos itens (Σ, status, max data_entrega). Quem grava usa no UPDATE unico do cabecalho.
CREATE OR REPLACE FUNCTION public._ocpa_cabecalho_derivados(_oc_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE r record;
BEGIN
  SELECT coalesce(sum(qtd_total),0) AS qtd, coalesce(sum(valor_bruto),0) AS bruto,
         coalesce(sum(valor_total_desconto),0) AS vtd,
         CASE WHEN count(*) > 0 AND bool_and(status = 'recebido') THEN 'recebido' ELSE 'encomendado' END AS status,
         max(data_entrega) AS data_entrega,
         CASE WHEN count(DISTINCT coalesce(grupo_id::text,'')) = 1 THEN (array_agg(grupo_id))[1] ELSE NULL END AS grupo,
         CASE WHEN count(DISTINCT coalesce(categoria_id::text,'')) = 1 THEN (array_agg(categoria_id))[1] ELSE NULL END AS cat
    INTO r FROM public.ocs_p_acabado_itens WHERE oc_id = _oc_id;
  RETURN jsonb_build_object('qtd_total', r.qtd, 'valor_bruto', r.bruto, 'valor_total_desconto', r.vtd,
    'status', r.status, 'data_entrega', r.data_entrega, 'grupo_id', r.grupo, 'categoria_id', r.cat);
END $fn$;
REVOKE EXECUTE ON FUNCTION public._ocpa_cabecalho_derivados(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._oci_cabecalho_derivados(_oc_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE r record;
BEGIN
  SELECT coalesce(sum(qtd_total),0) AS qtd, coalesce(sum(valor_bruto),0) AS bruto,
         coalesce(sum(valor_total_desconto),0) AS vtd,
         CASE WHEN count(*) > 0 AND bool_and(status = 'recebido') THEN 'recebido' ELSE 'encomendado' END AS status,
         max(data_entrega) AS data_entrega,
         CASE WHEN count(DISTINCT coalesce(grupo_id::text,'')) = 1 THEN (array_agg(grupo_id))[1] ELSE NULL END AS grupo,
         CASE WHEN count(DISTINCT coalesce(categoria_id::text,'')) = 1 THEN (array_agg(categoria_id))[1] ELSE NULL END AS cat,
         CASE WHEN coalesce(sum(qtd_total),0) > 0
              THEN round(sum(coalesce(custo_unitario_landed_real,0) * coalesce(qtd_total,0)) / sum(qtd_total), 4)
              ELSE 0 END AS landed
    INTO r FROM public.ocs_importado_itens WHERE oc_id = _oc_id;
  RETURN jsonb_build_object('qtd_total', r.qtd, 'valor_bruto', r.bruto, 'valor_total_desconto', r.vtd,
    'status', r.status, 'data_entrega', r.data_entrega, 'grupo_id', r.grupo, 'categoria_id', r.cat,
    'custo_unitario_landed_real', r.landed);
END $fn$;
REVOKE EXECUTE ON FUNCTION public._oci_cabecalho_derivados(uuid) FROM PUBLIC, anon, authenticated;

-- ===== funcoes redefinidas T1 (geradas por troca exata sobre o vivo; md5 em mig/md5-r13.txt) =====

CREATE OR REPLACE FUNCTION public.fn_oc_p_acabado_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sig text; v_num bigint;
begin
  if new.numero is not null and new.numero <> '' then return new; end if;
  v_sig := public._norm3((select nome_fantasia from empresas where id=new.empresa_id));
  if v_sig = '' then v_sig := 'FOR'; end if;
  if public._grupo_eh_acessorio(new.grupo_id) then v_sig := v_sig || 'ACE';
  else v_sig := v_sig || substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,1)
                      || substr(public._norm3((select nome from categorias_produto where id=new.categoria_id)),1,2);
  end if;
  -- [r13] advisory lock por (tabela, loja): fecha o 23505 entre dois pedidos simultaneos. Saida identica (helper _oc_numero_proximo).
  new.numero := public._oc_numero_proximo('ocs_p_acabado', new.tenant_id, v_sig);
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.fn_oc_importado_numero()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sig text; v_num bigint;
begin
  if new.numero is not null and new.numero <> '' then return new; end if;
  v_sig := public._norm3((select nome_fantasia from empresas where id=new.empresa_id));
  if v_sig = '' then v_sig := 'FOR'; end if;
  if public._grupo_eh_acessorio(new.grupo_id) then v_sig := v_sig || 'ACE';
  else v_sig := v_sig || substr(public._norm3((select nome from grupos_produto where id=new.grupo_id)),1,1)
                      || substr(public._norm3((select nome from categorias_produto where id=new.categoria_id)),1,2);
  end if;
  -- [r13] advisory lock por (tabela, loja): fecha o 23505 entre dois pedidos simultaneos. Saida identica (helper _oc_numero_proximo).
  new.numero := public._oc_numero_proximo('ocs_importado', new.tenant_id, v_sig);
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_oc_pa_vinculo_unico()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- [r13] o produto saiu do cabecalho para ocs_p_acabado_itens: o ponteiro do cabecalho vira LEGADO e nao pode mais ser
  -- gravado nao-nulo (a copia da migration zera; a guarda de "1 OC por produto" passou para fn_oc_item_produto_unico).
  if new.produto_acabado_id is not null then
    raise exception 'oc_produto_por_item: o produto da OC agora fica nos itens (ocs_p_acabado_itens)' using errcode='P0001';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_oc_importado_vinculo_unico()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- [r13] o produto saiu do cabecalho para ocs_importado_itens: o ponteiro do cabecalho vira LEGADO e nao pode mais ser
  -- gravado nao-nulo (a copia da migration zera; a guarda de "1 OC por produto" passou para fn_oc_item_produto_unico).
  if new.produto_importado_id is not null then
    raise exception 'oc_produto_por_item: o produto da OC agora fica nos itens (ocs_importado_itens)' using errcode='P0001';
  end if;
  return new;
end $function$;

-- ============================ Passo 5: copia 1 item (ordem 1) por cabecalho, byte a byte ============================
-- NENHUM UPDATE de coluna escutada por gatilho de parcela. O INSERT dispara fn_oc_item_tenant/fn_oc_item_produto_unico (1 item
-- por produto, mesma loja: passam). nome_produto NOT NULL no item: usa coalesce p/ o raro cabecalho sem nome (nunca na copia).
INSERT INTO public.ocs_p_acabado_itens (
  tenant_id, oc_id, ordem, produto_acabado_id, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
  ref_fornecedor, composicao, grade_proporcao, grade_detalhe, variantes, qtd_total, valor_unitario, desconto_pct, valor_bruto,
  valor_total_desconto, valor_unitario_real, status, data_entrega, nota_fiscal, anexo_nf_url, responsavel_recebimento_id,
  devolucao, revisao, created_at, updated_at)
SELECT o.tenant_id, o.id, 1, o.produto_acabado_id, coalesce(o.nome_produto, ''), o.grupo_id, o.categoria_id, o.subcategoria1_id,
  o.subcategoria2_id, o.ref_fornecedor, o.composicao, o.grade_proporcao, o.grade_detalhe, o.variantes, o.qtd_total,
  o.valor_unitario, o.desconto_pct, o.valor_bruto, o.valor_total_desconto, o.valor_unitario_real, o.status, o.data_entrega,
  o.nota_fiscal, o.anexo_nf_url, o.responsavel_recebimento_id, o.devolucao, o.revisao, o.created_at, o.updated_at
FROM public.ocs_p_acabado o
WHERE NOT EXISTS (SELECT 1 FROM public.ocs_p_acabado_itens it WHERE it.oc_id = o.id);

INSERT INTO public.ocs_importado_itens (
  tenant_id, oc_id, ordem, produto_importado_id, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
  ref_fornecedor, composicao, grade_proporcao, grade_detalhe, variantes, qtd_total, valor_unitario_m1, peso_kg, transporte_m2,
  desconto_pct, valor_bruto, valor_total_desconto, valor_unitario_real, custo_unitario_landed_real, status, data_entrega,
  nota_fiscal, anexo_nf_url, responsavel_recebimento_id, devolucao, revisao, created_at, updated_at)
SELECT o.tenant_id, o.id, 1, o.produto_importado_id, coalesce(o.nome_produto, ''), o.grupo_id, o.categoria_id, o.subcategoria1_id,
  o.subcategoria2_id, o.ref_fornecedor, o.composicao, o.grade_proporcao, o.grade_detalhe, o.variantes, o.qtd_total,
  o.valor_unitario_m1, o.peso_kg, o.transporte_m2, o.desconto_pct, o.valor_bruto, o.valor_total_desconto, o.valor_unitario_real,
  o.custo_unitario_landed_real, o.status, o.data_entrega, o.nota_fiscal, o.anexo_nf_url, o.responsavel_recebimento_id,
  o.devolucao, o.revisao, o.created_at, o.updated_at
FROM public.ocs_importado o
WHERE NOT EXISTS (SELECT 1 FROM public.ocs_importado_itens it WHERE it.oc_id = o.id);

-- ============================ Passo 6: backup do ponteiro + zerar (vira LEGADO) ============================
-- O zerar dispara so rev/vinculo/tenant; NAO dispara trg_gerar_parcelas_ocpa (escuta valor_total_desconto/prazo/datas),
-- trg_parcelas_importado_oc (escuta valor_unitario_m1/qtd/peso/transporte/desconto/cotacao/data/empresa) nem trg_nota_entrada_valida.
INSERT INTO public._bkp_r13_oc_vinculo (familia, oc_id, produto_id)
SELECT 'pa', id, produto_acabado_id FROM public.ocs_p_acabado WHERE produto_acabado_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public._bkp_r13_oc_vinculo b WHERE b.familia = 'pa' AND b.oc_id = ocs_p_acabado.id);
INSERT INTO public._bkp_r13_oc_vinculo (familia, oc_id, produto_id)
SELECT 'pi', id, produto_importado_id FROM public.ocs_importado WHERE produto_importado_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public._bkp_r13_oc_vinculo b WHERE b.familia = 'pi' AND b.oc_id = ocs_importado.id);

UPDATE public.ocs_p_acabado SET produto_acabado_id = NULL WHERE produto_acabado_id IS NOT NULL;
UPDATE public.ocs_importado SET produto_importado_id = NULL WHERE produto_importado_id IS NOT NULL;

-- ============================ Passo 7b (T2 PA): applier dos derivados + RPCs novas de Produto Acabado ============================
-- Emitido DEPOIS da copia (Passo 5/6) e ANTES das redefinicoes T2 (que incluem _vincular_oc_p_acabado_core, que usa o applier).
-- Padrao de sempre (invariante 9): wrapper (login -> modulo -> _seg_exige_pagina antes de qualquer busca) + _core REVOKE dos 3.
-- Mensagens 5xx (P0001/P0002/P0409) em ASCII. Ordem unica de travas: cabecalho FOR UPDATE + rev -> produtos FOR UPDATE ORDER BY id -> itens.

-- Applier: recalcula os derivados do cabecalho a partir dos itens e grava num UNICO UPDATE (totais + status + data_entrega +
-- grupo/categoria informativos). O valor_total_desconto muda => trg_gerar_parcelas_ocpa refaz as parcelas (desconto do pago).
CREATE OR REPLACE FUNCTION public._ocpa_aplicar_derivados(_oc_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE d jsonb;
BEGIN
  d := public._ocpa_cabecalho_derivados(_oc_id);
  UPDATE public.ocs_p_acabado SET
    qtd_total = coalesce((d->>'qtd_total')::int, 0),
    valor_bruto = coalesce((d->>'valor_bruto')::numeric, 0),
    valor_total_desconto = coalesce((d->>'valor_total_desconto')::numeric, 0),
    status = coalesce(d->>'status', 'encomendado'),
    data_entrega = nullif(d->>'data_entrega','')::date,
    grupo_id = nullif(d->>'grupo_id','')::uuid,
    categoria_id = nullif(d->>'categoria_id','')::uuid,
    updated_at = now()
  WHERE id = _oc_id;
END $fn$;
REVOKE EXECUTE ON FUNCTION public._ocpa_aplicar_derivados(uuid) FROM PUBLIC, anon, authenticated;

-- ── fazer_pedido_p_acabado: cria TODAS as OCs numa transacao (tudo-ou-nada), 1 por pedido do assistente ──
CREATE OR REPLACE FUNCTION public._fazer_pedido_p_acabado_core(_pedidos jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_out jsonb := '[]'::jsonb;
  ped jsonb;
  v_prod_ids uuid[];
  v_empresa uuid;
  v_rep uuid;
  v_sig text;
  v_numero text;
  v_oc_id uuid;
  v_itens_sigla jsonb;
  pid uuid;
  v_item jsonb;
  v_ordem int;
  v_mot text[];
  v_prod record;
  v_primeiro boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant' USING ERRCODE = '42501';
  END IF;
  IF _pedidos IS NULL OR jsonb_typeof(_pedidos) <> 'array' THEN RETURN v_out; END IF;

  FOR ped IN SELECT jsonb_array_elements(_pedidos) LOOP
    SELECT array_agg(x::uuid) INTO v_prod_ids FROM jsonb_array_elements_text(coalesce(ped->'produto_ids','[]'::jsonb)) x;
    IF v_prod_ids IS NULL OR array_length(v_prod_ids, 1) IS NULL THEN CONTINUE; END IF;
    v_empresa := nullif(ped->>'empresa_id','')::uuid;
    v_rep := nullif(ped->>'representante_id','')::uuid;

    -- (1) produtos FOR UPDATE ORDER BY id (ordem unica de travas; fecha o pedido simultaneo do mesmo produto)
    FOR v_prod IN
      SELECT * FROM public.produtos_acabados WHERE id = ANY(v_prod_ids) AND tenant_id = v_tenant ORDER BY id FOR UPDATE
    LOOP NULL; END LOOP;

    -- (2) cada produto: existe na loja? motivos? fornecedor do produto == do pedido?
    FOREACH pid IN ARRAY v_prod_ids LOOP
      SELECT * INTO v_prod FROM public.produtos_acabados WHERE id = pid AND tenant_id = v_tenant;
      IF NOT FOUND THEN RAISE EXCEPTION 'nao_encontrado: produto' USING ERRCODE = 'P0002'; END IF;
      v_mot := public._oc_produto_motivos('pa', pid);
      IF array_length(v_mot, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'pedido_recusado: %: %', v_prod.nome, array_to_string(v_mot, ', ') USING ERRCODE = 'P0001';
      END IF;
      IF v_prod.empresa_id IS DISTINCT FROM v_empresa THEN
        RAISE EXCEPTION 'fornecedor_diferente: % nao e do fornecedor do pedido', v_prod.nome USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- (3) sigla do lote + (4) numero (helper com advisory lock por loja)
    SELECT coalesce(jsonb_agg(jsonb_build_object('grupo_id', pa.grupo_id, 'categoria_id', pa.categoria_id) ORDER BY pa.id), '[]'::jsonb)
      INTO v_itens_sigla FROM public.produtos_acabados pa WHERE pa.id = ANY(v_prod_ids) AND pa.tenant_id = v_tenant;
    v_sig := public._oc_lote_sigla(v_empresa, v_itens_sigla);
    v_numero := public._oc_numero_proximo('ocs_p_acabado', v_tenant, v_sig);

    -- (5) INSERT do cabecalho (numero ja calculado => fn_oc_p_acabado_numero nao recalcula; produto_acabado_id NULL = LEGADO)
    INSERT INTO public.ocs_p_acabado (
      tenant_id, numero, nome_produto, empresa_id, representante_id,
      data_pedido, data_prevista, prazo_pagamento, parcelas_entrega, qtd_total, valor_bruto, valor_total_desconto, valor_unitario_real
    ) VALUES (
      v_tenant, v_numero, NULL, v_empresa, v_rep,
      coalesce(nullif(ped->>'data_pedido','')::date, current_date), nullif(ped->>'data_prevista','')::date,
      coalesce(nullif(ped->>'prazo_pagamento',''), '30'), coalesce(nullif(ped->>'parcelas_entrega','')::int, 1),
      0, 0, 0, 0
    ) RETURNING id INTO v_oc_id;

    -- (6) INSERT dos itens (um por produto, na ordem dos ids travados)
    v_ordem := 0;
    FOREACH pid IN ARRAY v_prod_ids LOOP
      v_ordem := v_ordem + 1;
      v_item := public._ocpa_item_de_produto(v_tenant, pid);
      INSERT INTO public.ocs_p_acabado_itens (
        tenant_id, oc_id, ordem, produto_acabado_id, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
        ref_fornecedor, composicao, grade_proporcao, grade_detalhe, variantes, qtd_total, valor_unitario, desconto_pct,
        valor_bruto, valor_total_desconto, valor_unitario_real)
      VALUES (
        v_tenant, v_oc_id, v_ordem, pid, v_item->>'nome_produto', nullif(v_item->>'grupo_id','')::uuid, nullif(v_item->>'categoria_id','')::uuid,
        nullif(v_item->>'subcategoria1_id','')::uuid, nullif(v_item->>'subcategoria2_id','')::uuid,
        v_item->>'ref_fornecedor', v_item->>'composicao', coalesce(v_item->'grade_proporcao','{}'::jsonb),
        coalesce(v_item->'grade_detalhe','{}'::jsonb), coalesce(v_item->'variantes','[]'::jsonb),
        coalesce((v_item->>'qtd_total')::int, 0), coalesce((v_item->>'valor_unitario')::numeric, 0),
        coalesce((v_item->>'desconto_pct')::numeric, 0), coalesce((v_item->>'valor_bruto')::numeric, 0),
        coalesce((v_item->>'valor_total_desconto')::numeric, 0), coalesce((v_item->>'valor_unitario_real')::numeric, 0));
      -- (7) sincroniza o produto (valor_unitario/desconto) como hoje + preco derivado
      UPDATE public.produtos_acabados SET valor_unitario = coalesce((v_item->>'valor_unitario')::numeric, 0),
        desconto_pct = coalesce((v_item->>'desconto_pct')::numeric, 0), updated_at = now()
        WHERE id = pid AND tenant_id = v_tenant;
      PERFORM public._pa_recomputar_precos_modelo(pid);
    END LOOP;

    -- derivados do cabecalho (Σ + status + data_entrega) num UNICO UPDATE => refaz parcelas sobre o total
    PERFORM public._ocpa_aplicar_derivados(v_oc_id);

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'oc_id', v_oc_id, 'numero', v_numero, 'produto_ids', to_jsonb(v_prod_ids)));
  END LOOP;

  RETURN v_out;
END $fn$;
REVOKE EXECUTE ON FUNCTION public._fazer_pedido_p_acabado_core(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fazer_pedido_p_acabado(_pedidos jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.tenant_module_enabled('produto_acabado') THEN
    RAISE EXCEPTION 'Módulo Produto Acabado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('entrada_oc_p_acabado', 'criacao_produto_acabado');
  RETURN public._fazer_pedido_p_acabado_core(_pedidos);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fazer_pedido_p_acabado(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fazer_pedido_p_acabado(jsonb) TO authenticated;

-- ── salvar_oc_p_acabado_itens: estado completo, diff por id (invariante 3, IDs preservados) ──
CREATE OR REPLACE FUNCTION public._salvar_oc_p_acabado_itens_core(_id uuid, _dados jsonb, _itens jsonb, _rev_base integer DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_oc_id uuid;
  v_status text;
  v_rev int;
  it jsonb;
  v_item_id uuid;
  v_ids_mantidos uuid[] := ARRAY[]::uuid[];
  v_ordem int := 0;
  v_prod_id uuid;
  v_montado jsonb;
  v_mot text[];
  v_empresa uuid;
  v_oc_status text;
  v_atual record;
  v_bruto numeric; v_vtd numeric; v_vur numeric;
  v_qtd int; v_vu numeric; v_dp numeric;
  v_soma_pedida numeric; v_tem_neg boolean;
  v_sig text; v_itens_sigla jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant' USING ERRCODE = '42501';
  END IF;

  IF _id IS NULL THEN
    -- OC avulsa nova (tela "Novo pedido"): numero pelo helper, cabecalho em branco (produtos vem nos itens).
    v_empresa := nullif(_dados->>'empresa_id','')::uuid;
    v_sig := public._oc_lote_sigla(v_empresa, '[]'::jsonb);
    INSERT INTO public.ocs_p_acabado (
      tenant_id, numero, nome_produto, empresa_id, representante_id,
      data_pedido, data_prevista, prazo_pagamento, parcelas_entrega, data_nota_entrada, anexo_pedido_url,
      qtd_total, valor_bruto, valor_total_desconto, valor_unitario_real
    ) VALUES (
      v_tenant, public._oc_numero_proximo('ocs_p_acabado', v_tenant, v_sig), NULL, v_empresa, nullif(_dados->>'representante_id','')::uuid,
      coalesce(nullif(_dados->>'data_pedido','')::date, current_date), nullif(_dados->>'data_prevista','')::date,
      coalesce(nullif(_dados->>'prazo_pagamento',''), '30'), coalesce(nullif(_dados->>'parcelas_entrega','')::int, 1),
      nullif(_dados->>'data_nota_entrada','')::date, _dados->>'anexo_pedido_url', 0, 0, 0, 0
    ) RETURNING id INTO v_oc_id;
  ELSE
    -- trava otimista + cabecalho FOR UPDATE (ordem unica de travas)
    SELECT rev, status INTO v_rev, v_oc_status FROM public.ocs_p_acabado WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'nao_encontrado: oc' USING ERRCODE = 'P0002'; END IF;
    IF _rev_base IS NOT NULL AND v_rev IS DISTINCT FROM _rev_base THEN
      RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
    v_oc_id := _id;
    UPDATE public.ocs_p_acabado SET
      empresa_id = nullif(_dados->>'empresa_id','')::uuid,
      representante_id = nullif(_dados->>'representante_id','')::uuid,
      data_pedido = coalesce(nullif(_dados->>'data_pedido','')::date, data_pedido),
      data_prevista = nullif(_dados->>'data_prevista','')::date,
      prazo_pagamento = coalesce(nullif(_dados->>'prazo_pagamento',''), prazo_pagamento),
      parcelas_entrega = coalesce(nullif(_dados->>'parcelas_entrega','')::int, parcelas_entrega),
      anexo_pedido_url = _dados->>'anexo_pedido_url',
      data_nota_entrada = CASE WHEN _dados ? 'data_nota_entrada' THEN nullif(_dados->>'data_nota_entrada','')::date ELSE data_nota_entrada END,
      updated_at = now()
    WHERE id = v_oc_id;
  END IF;

  SELECT empresa_id INTO v_empresa FROM public.ocs_p_acabado WHERE id = v_oc_id;

  -- Evita colisao do UNIQUE(oc_id, ordem) ao renumerar na ordem do payload: desloca os itens existentes para uma faixa alta
  -- (os finais serao 1..N dentro do loop). Itens novos recebem v_ordem 1..N direto (fora da faixa alta).
  UPDATE public.ocs_p_acabado_itens SET ordem = ordem + 1000000 WHERE oc_id = v_oc_id;

  -- diff por id: percorre os itens enviados (estado completo)
  FOR it IN SELECT jsonb_array_elements(coalesce(_itens, '[]'::jsonb)) LOOP
    v_ordem := v_ordem + 1;
    v_item_id := nullif(it->>'id','')::uuid;

    IF v_item_id IS NOT NULL THEN
      -- item EXISTENTE: atualiza. Recebido trava valor/qtd/grade pedida.
      SELECT status, valor_unitario, desconto_pct, qtd_total, grade_detalhe, produto_acabado_id
        INTO v_atual FROM public.ocs_p_acabado_itens WHERE id = v_item_id AND oc_id = v_oc_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'nao_encontrado: item' USING ERRCODE = 'P0002'; END IF;

      -- trocar o produto de um item avulso = "vincular" legado (sem exigir mesmo fornecedor)
      v_prod_id := coalesce(nullif(it->>'produto_acabado_id','')::uuid, v_atual.produto_acabado_id);
      v_qtd := coalesce(nullif(it->>'qtd_total','')::int, 0);
      v_vu := coalesce(nullif(it->>'valor_unitario','')::numeric, 0);
      v_dp := coalesce(nullif(it->>'desconto_pct','')::numeric, 0);

      IF v_atual.status = 'recebido' THEN
        IF v_vu IS DISTINCT FROM v_atual.valor_unitario OR v_dp IS DISTINCT FROM v_atual.desconto_pct
           OR v_qtd IS DISTINCT FROM v_atual.qtd_total
           OR public._pa_grade_pedida_only(coalesce(it->'grade_detalhe','{}'::jsonb)) IS DISTINCT FROM public._pa_grade_pedida_only(v_atual.grade_detalhe) THEN
          raise exception 'Item recebido - desfaca o recebimento para alterar valores.' using errcode = 'P0001';
        END IF;
      END IF;

      -- grade negativa / Σ pedida <> qtd
      SELECT coalesce(bool_or(coalesce(nullif(t.value->>'pedida','')::numeric,0) < 0
             or coalesce(nullif(t.value->>'recebida','')::numeric,0) < 0 or coalesce(nullif(t.value->>'defeito','')::numeric,0) < 0), false),
             coalesce(sum(coalesce(nullif(t.value->>'pedida','')::numeric,0)),0)
        INTO v_tem_neg, v_soma_pedida
        FROM jsonb_each(coalesce(it->'grade_detalhe','{}'::jsonb)) o CROSS JOIN LATERAL jsonb_each(o.value) t;
      IF v_tem_neg THEN raise exception 'As quantidades da grade nao podem ser negativas.' using errcode = 'P0001'; END IF;
      IF v_qtd > 0 AND v_soma_pedida <> v_qtd THEN
        raise exception 'A soma da grade pedida (%) difere da quantidade total (%)', v_soma_pedida, v_qtd using errcode = 'P0001';
      END IF;

      v_bruto := round(v_qtd * v_vu, 2);
      v_vtd := round(v_bruto * (1 - v_dp / 100.0), 2);
      v_vur := CASE WHEN v_qtd > 0 THEN round(v_vtd / v_qtd, 2) ELSE 0 END;

      UPDATE public.ocs_p_acabado_itens SET
        ordem = v_ordem,
        produto_acabado_id = v_prod_id,
        nome_produto = coalesce(nullif(it->>'nome_produto',''), nome_produto),
        grupo_id = nullif(it->>'grupo_id','')::uuid,
        categoria_id = nullif(it->>'categoria_id','')::uuid,
        subcategoria1_id = nullif(it->>'subcategoria1_id','')::uuid,
        subcategoria2_id = nullif(it->>'subcategoria2_id','')::uuid,
        ref_fornecedor = it->>'ref_fornecedor',
        composicao = it->>'composicao',
        grade_proporcao = coalesce(it->'grade_proporcao','{}'::jsonb),
        grade_detalhe = coalesce(it->'grade_detalhe','{}'::jsonb),
        variantes = coalesce(it->'variantes','[]'::jsonb),
        qtd_total = v_qtd, valor_unitario = v_vu, desconto_pct = v_dp,
        valor_bruto = v_bruto, valor_total_desconto = v_vtd, valor_unitario_real = v_vur,
        updated_at = now()
      WHERE id = v_item_id AND oc_id = v_oc_id;
      v_ids_mantidos := v_ids_mantidos || v_item_id;

    ELSIF coalesce((it->>'do_produto')::boolean, false) AND nullif(it->>'produto_acabado_id','') IS NOT NULL THEN
      -- "Adicionar produto" (P-358): monta do produto no servidor. OC recebida recusa; fornecedor igual; motivos.
      v_prod_id := (it->>'produto_acabado_id')::uuid;
      SELECT status INTO v_oc_status FROM public.ocs_p_acabado WHERE id = v_oc_id;
      IF v_oc_status = 'recebido' THEN
        RAISE EXCEPTION 'oc_recebida_nao_adiciona: OC recebida nao aceita produtos novos' USING ERRCODE = 'P0001';
      END IF;
      PERFORM 1 FROM public.produtos_acabados WHERE id = v_prod_id AND tenant_id = v_tenant FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'nao_encontrado: produto' USING ERRCODE = 'P0002'; END IF;
      IF v_empresa IS DISTINCT FROM (SELECT empresa_id FROM public.produtos_acabados WHERE id = v_prod_id) THEN
        RAISE EXCEPTION 'fornecedor_diferente: o produto e de outro fornecedor' USING ERRCODE = 'P0001';
      END IF;
      v_mot := public._oc_produto_motivos('pa', v_prod_id);
      IF array_length(v_mot, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'pedido_recusado: %: %', (SELECT nome FROM public.produtos_acabados WHERE id = v_prod_id),
          array_to_string(v_mot, ', ') USING ERRCODE = 'P0001';
      END IF;
      v_montado := public._ocpa_item_de_produto(v_tenant, v_prod_id);
      INSERT INTO public.ocs_p_acabado_itens (
        tenant_id, oc_id, ordem, produto_acabado_id, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
        ref_fornecedor, composicao, grade_proporcao, grade_detalhe, variantes, qtd_total, valor_unitario, desconto_pct,
        valor_bruto, valor_total_desconto, valor_unitario_real)
      VALUES (
        v_tenant, v_oc_id, v_ordem, v_prod_id, v_montado->>'nome_produto', nullif(v_montado->>'grupo_id','')::uuid, nullif(v_montado->>'categoria_id','')::uuid,
        nullif(v_montado->>'subcategoria1_id','')::uuid, nullif(v_montado->>'subcategoria2_id','')::uuid,
        v_montado->>'ref_fornecedor', v_montado->>'composicao', coalesce(v_montado->'grade_proporcao','{}'::jsonb),
        coalesce(v_montado->'grade_detalhe','{}'::jsonb), coalesce(v_montado->'variantes','[]'::jsonb),
        coalesce((v_montado->>'qtd_total')::int, 0), coalesce((v_montado->>'valor_unitario')::numeric, 0),
        coalesce((v_montado->>'desconto_pct')::numeric, 0), coalesce((v_montado->>'valor_bruto')::numeric, 0),
        coalesce((v_montado->>'valor_total_desconto')::numeric, 0), coalesce((v_montado->>'valor_unitario_real')::numeric, 0))
      RETURNING id INTO v_item_id;
      v_ids_mantidos := v_ids_mantidos || v_item_id;

    ELSE
      -- item avulso digitado (sem id, sem do_produto)
      v_qtd := coalesce(nullif(it->>'qtd_total','')::int, 0);
      v_vu := coalesce(nullif(it->>'valor_unitario','')::numeric, 0);
      v_dp := coalesce(nullif(it->>'desconto_pct','')::numeric, 0);
      v_bruto := round(v_qtd * v_vu, 2); v_vtd := round(v_bruto * (1 - v_dp / 100.0), 2);
      v_vur := CASE WHEN v_qtd > 0 THEN round(v_vtd / v_qtd, 2) ELSE 0 END;
      INSERT INTO public.ocs_p_acabado_itens (
        tenant_id, oc_id, ordem, produto_acabado_id, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
        ref_fornecedor, composicao, grade_proporcao, grade_detalhe, variantes, qtd_total, valor_unitario, desconto_pct,
        valor_bruto, valor_total_desconto, valor_unitario_real)
      VALUES (
        v_tenant, v_oc_id, v_ordem, nullif(it->>'produto_acabado_id','')::uuid, coalesce(nullif(it->>'nome_produto',''), ''),
        nullif(it->>'grupo_id','')::uuid, nullif(it->>'categoria_id','')::uuid, nullif(it->>'subcategoria1_id','')::uuid,
        nullif(it->>'subcategoria2_id','')::uuid, it->>'ref_fornecedor', it->>'composicao', coalesce(it->'grade_proporcao','{}'::jsonb),
        coalesce(it->'grade_detalhe','{}'::jsonb), coalesce(it->'variantes','[]'::jsonb), v_qtd, v_vu, v_dp, v_bruto, v_vtd, v_vur)
      RETURNING id INTO v_item_id;
      v_ids_mantidos := v_ids_mantidos || v_item_id;
    END IF;
  END LOOP;

  -- itens AUSENTES = tirar. Item recebido nao sai; lista final vazia com itens no servidor recusa.
  IF EXISTS (SELECT 1 FROM public.ocs_p_acabado_itens WHERE oc_id = v_oc_id AND status = 'recebido'
             AND NOT (id = ANY(v_ids_mantidos))) THEN
    RAISE EXCEPTION 'item_recebido_nao_sai: ha produto recebido que nao pode ser tirado' USING ERRCODE = 'P0001';
  END IF;
  IF array_length(v_ids_mantidos, 1) IS NULL AND EXISTS (SELECT 1 FROM public.ocs_p_acabado_itens WHERE oc_id = v_oc_id) THEN
    RAISE EXCEPTION 'oc_sem_produtos: exclua a OC' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.ocs_p_acabado_itens WHERE oc_id = v_oc_id AND NOT (id = ANY(v_ids_mantidos));

  -- UPDATE unico do cabecalho (derivados; refaz parcelas) + sincroniza preco do produto POR item
  PERFORM public._ocpa_aplicar_derivados(v_oc_id);
  FOR v_prod_id IN
    SELECT DISTINCT produto_acabado_id FROM public.ocs_p_acabado_itens WHERE oc_id = v_oc_id AND produto_acabado_id IS NOT NULL
  LOOP
    UPDATE public.produtos_acabados pa SET
      valor_unitario = it2.valor_unitario, desconto_pct = it2.desconto_pct, updated_at = now()
      FROM public.ocs_p_acabado_itens it2
      WHERE pa.id = v_prod_id AND pa.tenant_id = v_tenant AND it2.oc_id = v_oc_id AND it2.produto_acabado_id = v_prod_id;
    PERFORM public._pa_recomputar_precos_modelo(v_prod_id);
  END LOOP;

  RETURN v_oc_id;
END $fn$;
REVOKE EXECUTE ON FUNCTION public._salvar_oc_p_acabado_itens_core(uuid,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.salvar_oc_p_acabado_itens(_id uuid, _dados jsonb, _itens jsonb, _rev_base integer DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.tenant_module_enabled('produto_acabado') THEN
    RAISE EXCEPTION 'Módulo Produto Acabado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('entrada_oc_p_acabado', 'criacao_produto_acabado');
  RETURN public._salvar_oc_p_acabado_itens_core(_id, _dados, _itens, _rev_base);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.salvar_oc_p_acabado_itens(uuid,jsonb,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_oc_p_acabado_itens(uuid,jsonb,jsonb,integer) TO authenticated;

-- ── receber_item_oc_p_acabado: salva pendencias (via o _core do salvar) e recebe o item ──
CREATE OR REPLACE FUNCTION public._receber_item_oc_p_acabado_core(_oc_id uuid, _item_id uuid, _dados jsonb, _itens jsonb, _rev_base integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_item record;
  v_produto record;
  v_cad_id uuid;
  v_grade_final jsonb;
  rec record; tam_rec record;
  v_var_grade jsonb; v_planejadas jsonb; v_reais jsonb;
  v_tot_plan int; v_tot_real int; v_grand_total int := 0;
  v_pedida numeric; v_recebida numeric; v_defeito numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant' USING ERRCODE = '42501';
  END IF;

  -- 1) salva as pendencias (estado completo da OC) ANTES de receber — atomico; "CRITICAL" da inv.1 garantido pela txn.
  PERFORM public._salvar_oc_p_acabado_itens_core(_oc_id, _dados, _itens, _rev_base);

  -- 2) recebe o item
  SELECT * INTO v_item FROM public.ocs_p_acabado_itens WHERE id = _item_id AND oc_id = _oc_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'nao_encontrado: item' USING ERRCODE = 'P0002'; END IF;
  IF v_item.produto_acabado_id IS NULL THEN
    RAISE EXCEPTION 'Crie o card no Planejamento antes de receber.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_produto FROM public.produtos_acabados WHERE id = v_item.produto_acabado_id AND tenant_id = v_tenant;
  IF NOT FOUND OR v_produto.modelo_id IS NULL THEN
    RAISE EXCEPTION 'Crie o card no Planejamento antes de receber.' USING ERRCODE = 'P0001';
  END IF;

  v_grade_final := coalesce(v_item.grade_detalhe, '{}'::jsonb);

  UPDATE public.ocs_p_acabado_itens SET
    data_entrega = nullif(_dados->>'item_data_entrega','')::date,
    nota_fiscal = _dados->>'item_nota_fiscal',
    responsavel_recebimento_id = nullif(_dados->>'item_responsavel_recebimento_id','')::uuid,
    devolucao = _dados->>'item_devolucao',
    revisao = _dados->>'item_revisao',
    status = 'recebido',
    updated_at = now()
  WHERE id = _item_id;

  -- upsert cad BARE (1 por modelo)
  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = v_produto.modelo_id AND tenant_id = v_tenant;
  IF v_cad_id IS NULL THEN
    INSERT INTO public.cad (tenant_id, modelo_id) VALUES (v_tenant, v_produto.modelo_id) RETURNING id INTO v_cad_id;
  END IF;

  -- cad_grades por variante: planejada = pedida; real = max(0, recebida-defeito)
  FOR rec IN SELECT ordem FROM public.produto_acabado_variantes WHERE produto_acabado_id = v_produto.id ORDER BY ordem LOOP
    v_var_grade := coalesce(v_grade_final -> rec.ordem::text, '{}'::jsonb);
    v_planejadas := '{}'::jsonb; v_reais := '{}'::jsonb; v_tot_plan := 0; v_tot_real := 0;
    FOR tam_rec IN SELECT key, value FROM jsonb_each(v_var_grade) LOOP
      v_pedida := coalesce(nullif(tam_rec.value->>'pedida','')::numeric, 0);
      v_recebida := coalesce(nullif(tam_rec.value->>'recebida','')::numeric, 0);
      v_defeito := coalesce(nullif(tam_rec.value->>'defeito','')::numeric, 0);
      v_planejadas := v_planejadas || jsonb_build_object(tam_rec.key, v_pedida::int);
      v_reais := v_reais || jsonb_build_object(tam_rec.key, greatest(0, v_recebida - v_defeito)::int);
      v_tot_plan := v_tot_plan + v_pedida::int;
      v_tot_real := v_tot_real + greatest(0, v_recebida - v_defeito)::int;
    END LOOP;
    INSERT INTO public.cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
    VALUES (v_cad_id, rec.ordem, v_planejadas, v_reais, v_tot_plan, v_tot_real)
    ON CONFLICT (cad_id, variante_numero) DO UPDATE SET
      grades_planejadas = excluded.grades_planejadas, grades_reais = excluded.grades_reais,
      grade_total_planejada = excluded.grade_total_planejada, grade_total_real = excluded.grade_total_real;
    v_grand_total := v_grand_total + v_tot_real;
  END LOOP;

  -- cad_etiquetas com os helpers da R1 (insumo por tamanho); idempotente
  DELETE FROM public.cad_etiquetas WHERE cad_id = v_cad_id;
  INSERT INTO public.cad_etiquetas (cad_id, etiqueta_id, cor_id, consumo, quantidade_planejada, quantidade_enviar)
  SELECT v_cad_id, me.etiqueta_id, me.cor_id, me.consumo,
         round(coalesce(me.consumo,0) * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(v_cad_id, true), v_grand_total), 2),
         round(coalesce(me.consumo,0) * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(v_cad_id, true), v_grand_total), 2)
  FROM public.modelo_etiquetas me WHERE me.modelo_id = v_produto.modelo_id;

  -- CQ pendente so se nao existir
  IF NOT EXISTS (SELECT 1 FROM public.controle_qualidade WHERE cad_id = v_cad_id) THEN
    INSERT INTO public.controle_qualidade (cad_id, tenant_id, status) VALUES (v_cad_id, v_tenant, 'pendente');
  END IF;

  PERFORM public._pa_recomputar_precos_modelo(v_produto.id);

  -- status do cabecalho derivado (recebido <=> todos os itens recebidos) + data_entrega = max; outros itens intocados.
  PERFORM public._ocpa_aplicar_derivados(_oc_id);

  RETURN jsonb_build_object('cad_id', v_cad_id, 'item_id', _item_id, 'total_real', v_grand_total);
END $fn$;
REVOKE EXECUTE ON FUNCTION public._receber_item_oc_p_acabado_core(uuid,uuid,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.receber_item_oc_p_acabado(_oc_id uuid, _item_id uuid, _dados jsonb, _itens jsonb, _rev_base integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.tenant_module_enabled('produto_acabado') THEN
    RAISE EXCEPTION 'Módulo Produto Acabado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('criacao', 'producao');
  PERFORM public._seg_exige_pagina('entrada_oc_p_acabado');
  RETURN public._receber_item_oc_p_acabado_core(_oc_id, _item_id, _dados, _itens, _rev_base);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.receber_item_oc_p_acabado(uuid,uuid,jsonb,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receber_item_oc_p_acabado(uuid,uuid,jsonb,jsonb,integer) TO authenticated;

-- ===== funcoes redefinidas T2 (geradas por troca exata sobre o vivo; md5 em mig/md5-r13.txt) =====

CREATE OR REPLACE FUNCTION public._salvar_oc_p_acabado_core(_id uuid, _dados jsonb, _grade jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_qtd_total int;
  v_valor_unitario numeric;
  v_desconto_pct numeric;
  v_bruto numeric;
  v_total_desc numeric;
  v_unit_real numeric;
  v_soma_pedida numeric := 0;
  v_tem_negativo boolean := false;
  v_produto_id uuid;
  v_atual_status text;
  v_atual_valor_unitario numeric;
  v_atual_desconto_pct numeric;
  v_atual_qtd_total int;
  v_atual_grade jsonb;
begin
  -- [r13] escritor antigo de 1 produto por cabecalho: o produto agora mora em ocs_p_acabado_itens (salvar_oc_p_acabado_itens).
  -- Recusa: site velho + banco novo nao grava nada errado. Mensagem ASCII (P0001 = 400).
  raise exception 'versao_antiga: recarregue a pagina' using errcode = 'P0001';
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  -- trava otimista (Fase 3) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
  if _rev_base is not null then
    declare v_rev int;
    begin
      select rev into v_rev from public.ocs_p_acabado
        where id = _id and tenant_id = v_tenant for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;

  v_nome := nullif(_dados->>'nome_produto', '');
  if _id is null then
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
  else
    select status, valor_unitario, desconto_pct, qtd_total, grade_detalhe, produto_acabado_id
      into v_atual_status, v_atual_valor_unitario, v_atual_desconto_pct, v_atual_qtd_total, v_atual_grade, v_produto_id
      from public.ocs_p_acabado where id = _id and tenant_id = v_tenant;
    if not found then
      raise exception 'OC não encontrada';
    end if;
  end if;

  v_qtd_total := coalesce(nullif(_dados->>'qtd_total', '')::int, 0);
  v_valor_unitario := coalesce(nullif(_dados->>'valor_unitario', '')::numeric, 0);
  v_desconto_pct := coalesce(nullif(_dados->>'desconto_pct', '')::numeric, 0);

  if _id is not null and v_atual_status = 'recebido' then
    if v_valor_unitario is distinct from v_atual_valor_unitario
       or v_desconto_pct is distinct from v_atual_desconto_pct
       or v_qtd_total is distinct from v_atual_qtd_total
       or public._pa_grade_pedida_only(_grade) is distinct from public._pa_grade_pedida_only(v_atual_grade)
    then
      raise exception 'OC recebida — desfaça o recebimento para alterar valores.' using errcode = 'P0001';
    end if;
  end if;

  select
    coalesce(bool_or(
      coalesce(nullif(t.value->>'pedida', '')::numeric, 0) < 0
      or coalesce(nullif(t.value->>'recebida', '')::numeric, 0) < 0
      or coalesce(nullif(t.value->>'defeito', '')::numeric, 0) < 0
    ), false),
    coalesce(sum(coalesce(nullif(t.value->>'pedida', '')::numeric, 0)), 0)
  into v_tem_negativo, v_soma_pedida
  from jsonb_each(coalesce(_grade, '{}'::jsonb)) o
  cross join lateral jsonb_each(o.value) t;

  if v_tem_negativo then
    raise exception 'As quantidades da grade não podem ser negativas.' using errcode = 'P0001';
  end if;
  if v_qtd_total > 0 and v_soma_pedida <> v_qtd_total then
    raise exception 'A soma da grade pedida (%) difere da quantidade total (%)', v_soma_pedida, v_qtd_total
      using errcode = 'P0001';
  end if;

  v_bruto := v_qtd_total * v_valor_unitario;
  v_total_desc := v_bruto * (1 - v_desconto_pct / 100);
  v_unit_real := case when v_qtd_total > 0 then v_total_desc / v_qtd_total else 0 end;

  if _id is null then
    v_produto_id := nullif(_dados->>'produto_acabado_id', '')::uuid;
    if v_produto_id is not null then
      perform 1 from public.produtos_acabados where id = v_produto_id and tenant_id = v_tenant;
      if not found then
        raise exception 'Produto não encontrado';
      end if;
    end if;

    insert into public.ocs_p_acabado (
      tenant_id, produto_acabado_id, numero, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      empresa_id, representante_id, ref_fornecedor, composicao,
      data_pedido, data_prevista, data_entrega, prazo_pagamento, parcelas_entrega,
      grade_proporcao, grade_detalhe, variantes,
      qtd_total, valor_unitario, desconto_pct, valor_bruto, valor_total_desconto, valor_unitario_real,
      nota_fiscal, responsavel_recebimento_id, devolucao, revisao,
      anexo_pedido_url, anexo_nf_url, data_nota_entrada
    ) values (
      v_tenant, v_produto_id, nullif(_dados->>'numero', ''), v_nome, nullif(_dados->>'grupo_id', '')::uuid, nullif(_dados->>'categoria_id', '')::uuid,
      nullif(_dados->>'subcategoria1_id', '')::uuid, nullif(_dados->>'subcategoria2_id', '')::uuid,
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(nullif(_dados->>'data_pedido', '')::date, current_date),
      nullif(_dados->>'data_prevista', '')::date, nullif(_dados->>'data_entrega', '')::date,
      coalesce(nullif(_dados->>'prazo_pagamento', ''), '30'),
      coalesce(nullif(_dados->>'parcelas_entrega', '')::int, 1),
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), coalesce(_grade, '{}'::jsonb), coalesce(_dados->'variantes', '[]'::jsonb),
      v_qtd_total, v_valor_unitario, v_desconto_pct, v_bruto, v_total_desc, v_unit_real,
      _dados->>'nota_fiscal', nullif(_dados->>'responsavel_recebimento_id', '')::uuid, _dados->>'devolucao', _dados->>'revisao',
      _dados->>'anexo_pedido_url', _dados->>'anexo_nf_url', nullif(_dados->>'data_nota_entrada', '')::date
    ) returning id into v_id;
  else
    update public.ocs_p_acabado set
      numero = coalesce(nullif(_dados->>'numero', ''), numero),
      nome_produto = coalesce(v_nome, nome_produto),
      grupo_id = nullif(_dados->>'grupo_id', '')::uuid,
      categoria_id = nullif(_dados->>'categoria_id', '')::uuid,
      subcategoria1_id = nullif(_dados->>'subcategoria1_id', '')::uuid,
      subcategoria2_id = nullif(_dados->>'subcategoria2_id', '')::uuid,
      empresa_id = nullif(_dados->>'empresa_id', '')::uuid,
      representante_id = nullif(_dados->>'representante_id', '')::uuid,
      ref_fornecedor = _dados->>'ref_fornecedor',
      composicao = _dados->>'composicao',
      data_pedido = coalesce(nullif(_dados->>'data_pedido', '')::date, data_pedido),
      data_prevista = nullif(_dados->>'data_prevista', '')::date,
      data_entrega = nullif(_dados->>'data_entrega', '')::date,
      prazo_pagamento = coalesce(nullif(_dados->>'prazo_pagamento', ''), prazo_pagamento),
      parcelas_entrega = coalesce(nullif(_dados->>'parcelas_entrega', '')::int, parcelas_entrega),
      grade_proporcao = coalesce(_dados->'grade_proporcao', '{}'::jsonb),
      grade_detalhe = coalesce(_grade, '{}'::jsonb),
      variantes = coalesce(_dados->'variantes', '[]'::jsonb),
      qtd_total = v_qtd_total,
      valor_unitario = v_valor_unitario,
      desconto_pct = v_desconto_pct,
      valor_bruto = v_bruto,
      valor_total_desconto = v_total_desc,
      valor_unitario_real = v_unit_real,
      nota_fiscal = _dados->>'nota_fiscal',
      responsavel_recebimento_id = nullif(_dados->>'responsavel_recebimento_id', '')::uuid,
      devolucao = _dados->>'devolucao',
      revisao = _dados->>'revisao',
      anexo_pedido_url = _dados->>'anexo_pedido_url',
      anexo_nf_url = _dados->>'anexo_nf_url',
      data_nota_entrada = CASE WHEN _dados ? 'data_nota_entrada' THEN NULLIF(_dados->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
      updated_at = now()
    where id = _id and tenant_id = v_tenant;
    v_id := _id;
  end if;

  if v_produto_id is not null then
    update public.produtos_acabados
      set valor_unitario = v_valor_unitario, desconto_pct = v_desconto_pct, updated_at = now()
      where id = v_produto_id and tenant_id = v_tenant;

    perform public._pa_recomputar_precos_modelo(v_produto_id);
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public._receber_oc_p_acabado_core(_oc_id uuid, _dados jsonb, _grade jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_oc record;
  v_produto record;
  v_cad_id uuid;
  v_grade_final jsonb;
  rec record;
  tam_rec record;
  v_var_grade jsonb;
  v_planejadas jsonb;
  v_reais jsonb;
  v_tot_plan int;
  v_tot_real int;
  v_grand_total int := 0;
  v_pedida numeric;
  v_recebida numeric;
  v_defeito numeric;
begin
  -- [r13] recebimento antigo por OC inteira: agora e POR ITEM (receber_item_oc_p_acabado). Recusa (ASCII, P0001).
  raise exception 'versao_antiga: recarregue a pagina' using errcode = 'P0001';
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select * into v_oc from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'OC não encontrada';
  end if;

  if v_oc.produto_acabado_id is null then
    raise exception 'Crie o card no Planejamento antes de receber — o recebimento alimenta CQ e Direcionamento.'
      using errcode = 'P0001';
  end if;

  select * into v_produto from public.produtos_acabados
    where id = v_oc.produto_acabado_id and tenant_id = v_tenant;
  if not found or v_produto.modelo_id is null then
    raise exception 'Crie o card no Planejamento antes de receber — o recebimento alimenta CQ e Direcionamento.'
      using errcode = 'P0001';
  end if;

  v_grade_final := coalesce(_grade, v_oc.grade_detalhe, '{}'::jsonb);

  update public.ocs_p_acabado set
    data_entrega = nullif(_dados->>'data_entrega', '')::date,
    nota_fiscal = _dados->>'nota_fiscal',
    responsavel_recebimento_id = nullif(_dados->>'responsavel_recebimento_id', '')::uuid,
    devolucao = _dados->>'devolucao',
    revisao = _dados->>'revisao',
    grade_detalhe = v_grade_final,
    status = 'recebido',
    updated_at = now()
  where id = _oc_id;

  -- upsert cad (1 por modelo — trigger enforce_unique_fk('modelo_id') garante a
  -- invariante; aqui só evitamos o INSERT redundante quando já existe).
  select id into v_cad_id from public.cad where modelo_id = v_produto.modelo_id and tenant_id = v_tenant;
  if v_cad_id is null then
    insert into public.cad (tenant_id, modelo_id) values (v_tenant, v_produto.modelo_id)
      returning id into v_cad_id;
  end if;

  -- upsert cad_grades por variante: variante_numero = ordem; grades_planejadas = pedida
  -- por tamanho; grades_reais = max(0, recebida−defeito) por tamanho.
  for rec in
    select ordem from public.produto_acabado_variantes
    where produto_acabado_id = v_produto.id
    order by ordem
  loop
    v_var_grade := coalesce(v_grade_final -> rec.ordem::text, '{}'::jsonb);
    v_planejadas := '{}'::jsonb;
    v_reais := '{}'::jsonb;
    v_tot_plan := 0;
    v_tot_real := 0;

    for tam_rec in select key, value from jsonb_each(v_var_grade) loop
      v_pedida := coalesce(nullif(tam_rec.value->>'pedida', '')::numeric, 0);
      v_recebida := coalesce(nullif(tam_rec.value->>'recebida', '')::numeric, 0);
      v_defeito := coalesce(nullif(tam_rec.value->>'defeito', '')::numeric, 0);

      v_planejadas := v_planejadas || jsonb_build_object(tam_rec.key, v_pedida::int);
      v_reais := v_reais || jsonb_build_object(tam_rec.key, greatest(0, v_recebida - v_defeito)::int);
      v_tot_plan := v_tot_plan + v_pedida::int;
      v_tot_real := v_tot_real + greatest(0, v_recebida - v_defeito)::int;
    end loop;

    insert into public.cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
    values (v_cad_id, rec.ordem, v_planejadas, v_reais, v_tot_plan, v_tot_real)
    on conflict (cad_id, variante_numero) do update set
      grades_planejadas = excluded.grades_planejadas,
      grades_reais = excluded.grades_reais,
      grade_total_planejada = excluded.grade_total_planejada,
      grade_total_real = excluded.grade_total_real;

    v_grand_total := v_grand_total + v_tot_real;
  end loop;

  -- NOVO (set/2026): materializa cad_etiquetas do BOM (modelo_etiquetas) — a etiqueta/insumo a
  -- separar na Explosão (troca de etiqueta da revenda). quantidade_planejada = quantidade_enviar =
  -- consumo × peças reais recebidas. Idempotente: apaga e regrava as do cad (sem UNIQUE p/ upsert).
  -- O caminho manufaturado NÃO usa esta função — só revenda passa por aqui.
  delete from public.cad_etiquetas where cad_id = v_cad_id;
  insert into public.cad_etiquetas (cad_id, etiqueta_id, cor_id, consumo, quantidade_planejada, quantidade_enviar)
  -- [urg R1] insumo vinculado a UM tamanho: consumo x pecas recebidas DAQUELE tamanho (grade real do cad, regravada acima)
  select v_cad_id, me.etiqueta_id, me.cor_id, me.consumo,
         round(coalesce(me.consumo,0) * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(v_cad_id, true), v_grand_total), 2),
         round(coalesce(me.consumo,0) * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(v_cad_id, true), v_grand_total), 2)
  from public.modelo_etiquetas me
  where me.modelo_id = v_produto.modelo_id;

  -- upsert controle_qualidade: mantém 'pendente' (default da coluna) se não existe;
  -- se já existe (inclusive 'confirmado'), NÃO toca — o cad_grades acima já regravou
  -- grades_reais e o trigger trg_rebaixa_direcionamento_grade (AFTER UPDATE OF
  -- grades_reais ON cad_grades) cuida da rebaixa do Direcionamento sozinho.
  if not exists (select 1 from public.controle_qualidade where cad_id = v_cad_id) then
    insert into public.controle_qualidade (cad_id, tenant_id, status) values (v_cad_id, v_tenant, 'pendente');
  end if;

  -- Novo: custo real chegou — recomputa e persiste os preços derivados do espelho
  -- (defensivo/paridade; ver comentário no cabeçalho da migração).
  perform public._pa_recomputar_precos_modelo(v_produto.id);

  return jsonb_build_object('cad_id', v_cad_id, 'total_real', v_grand_total);
end;
$function$;

CREATE OR REPLACE FUNCTION public._vincular_oc_p_acabado_core(_oc_id uuid, _produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_ok boolean;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  -- [r13] trava: cabecalho -> produto (ordem unica). O produto agora e um ITEM (ocs_p_acabado_itens).
  perform 1 from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'nao_encontrado: oc' using errcode = 'P0002';
  end if;

  if _produto_id is null then
    -- (c) DESVINCULAR: OC de 1 item -> item.produto = NULL (legado). 2+ itens -> recusa (abra a OC para tirar o produto).
    declare v_n int; v_item uuid;
    begin
      select count(*) into v_n from public.ocs_p_acabado_itens where oc_id = _oc_id;
      if v_n >= 2 then
        raise exception 'oc_varios_produtos: abra a OC para tirar o produto' using errcode = 'P0001';
      end if;
      select id into v_item from public.ocs_p_acabado_itens where oc_id = _oc_id limit 1;
      if v_item is not null then
        update public.ocs_p_acabado_itens set produto_acabado_id = null, updated_at = now() where id = v_item;
      end if;
    end;
    return;
  end if;

  -- produto da loja
  select exists(select 1 from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant for update) into v_ok;
  if not v_ok then
    raise exception 'nao_encontrado: produto' using errcode = 'P0002';
  end if;

  declare
    v_oc record; v_n int; v_item uuid; v_vu numeric; v_dp numeric; v_item_jsonb jsonb;
  begin
    select empresa_id, status, numero into v_oc from public.ocs_p_acabado where id = _oc_id;
    select count(*) into v_n from public.ocs_p_acabado_itens where oc_id = _oc_id;

    if v_n = 1 then
      select id into v_item from public.ocs_p_acabado_itens where oc_id = _oc_id and produto_acabado_id is null limit 1;
    end if;

    if v_item is not null then
      -- (a) VINCULAR item avulso legado: o unico item (sem produto) recebe o produto; o produto herda valor/desconto do item.
      select valor_unitario, desconto_pct into v_vu, v_dp from public.ocs_p_acabado_itens where id = v_item;
      update public.ocs_p_acabado_itens set produto_acabado_id = _produto_id, updated_at = now() where id = v_item;
      update public.produtos_acabados set valor_unitario = coalesce(v_vu,0), desconto_pct = coalesce(v_dp,0), updated_at = now()
        where id = _produto_id and tenant_id = v_tenant;
    else
      -- (b) ADICIONAR o produto como item NOVO. OC encomendada + mesmo fornecedor + passa pelos motivos.
      if v_oc.status = 'recebido' then
        raise exception 'oc_recebida_nao_adiciona: OC recebida nao aceita produtos novos' using errcode = 'P0001';
      end if;
      if v_oc.empresa_id is distinct from (select empresa_id from public.produtos_acabados where id = _produto_id) then
        raise exception 'fornecedor_diferente: o produto e de outro fornecedor' using errcode = 'P0001';
      end if;
      declare v_mot text[]; begin
        v_mot := public._oc_produto_motivos('pa', _produto_id);
        if array_length(v_mot, 1) is not null then
          raise exception 'pedido_recusado: %: %', (select nome from public.produtos_acabados where id = _produto_id),
            array_to_string(v_mot, ', ') using errcode = 'P0001';
        end if;
      end;
      v_item_jsonb := public._ocpa_item_de_produto(v_tenant, _produto_id);
      insert into public.ocs_p_acabado_itens (
        tenant_id, oc_id, ordem, produto_acabado_id, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
        ref_fornecedor, composicao, grade_proporcao, grade_detalhe, variantes, qtd_total, valor_unitario, desconto_pct,
        valor_bruto, valor_total_desconto, valor_unitario_real)
      values (
        v_tenant, _oc_id, coalesce((select max(ordem) from public.ocs_p_acabado_itens where oc_id = _oc_id), 0) + 1,
        _produto_id, v_item_jsonb->>'nome_produto', nullif(v_item_jsonb->>'grupo_id','')::uuid, nullif(v_item_jsonb->>'categoria_id','')::uuid,
        nullif(v_item_jsonb->>'subcategoria1_id','')::uuid, nullif(v_item_jsonb->>'subcategoria2_id','')::uuid,
        v_item_jsonb->>'ref_fornecedor', v_item_jsonb->>'composicao', coalesce(v_item_jsonb->'grade_proporcao','{}'::jsonb),
        coalesce(v_item_jsonb->'grade_detalhe','{}'::jsonb), coalesce(v_item_jsonb->'variantes','[]'::jsonb),
        coalesce((v_item_jsonb->>'qtd_total')::int, 0), coalesce((v_item_jsonb->>'valor_unitario')::numeric, 0),
        coalesce((v_item_jsonb->>'desconto_pct')::numeric, 0), coalesce((v_item_jsonb->>'valor_bruto')::numeric, 0),
        coalesce((v_item_jsonb->>'valor_total_desconto')::numeric, 0), coalesce((v_item_jsonb->>'valor_unitario_real')::numeric, 0));
    end if;

    -- UPDATE unico do cabecalho (totais derivados; o valor_total_desconto refaz as parcelas via trg_gerar_parcelas_ocpa).
    perform public._ocpa_aplicar_derivados(_oc_id);
    perform public._pa_recomputar_precos_modelo(_produto_id);
  end;
end;
$function$;

CREATE OR REPLACE FUNCTION public._excluir_oc_p_acabado_core(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select status into v_status from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'nao_encontrado: oc' using errcode = 'P0002';
  end if;

  -- [r13] recusa se QUALQUER item foi recebido (o status do cabecalho e derivado = todos recebidos; um item recebido ja basta).
  if v_status = 'recebido'
     or exists (select 1 from public.ocs_p_acabado_itens where oc_id = _oc_id and status = 'recebido') then
    raise exception 'Ha produto recebido na OC - estorne o recebimento antes de excluir.'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.parcelas where oc_p_acabado_id = _oc_id and status = 'pago') then
    raise exception 'Não é possível excluir: a OC tem parcela paga no financeiro.' using errcode = 'P0001';
  end if;

  -- Parcelas NÃO pagas somem via ON DELETE CASCADE (oc_p_acabado_id, Task 3); a parcela
  -- paga já foi barrada acima, então nenhum DELETE explícito é necessário aqui.
  delete from public.ocs_p_acabado where id = _oc_id and tenant_id = v_tenant;
end;
$function$;

CREATE OR REPLACE FUNCTION public._excluir_produto_acabado_core(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_oc_id uuid;
  v_oc_numero text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  perform 1 from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'nao_encontrado: produto' using errcode = 'P0002';
  end if;

  -- [r13] o produto agora e um item; junta ao cabecalho para o numero.
  select o.id, o.numero into v_oc_id, v_oc_numero
    from public.ocs_p_acabado_itens it join public.ocs_p_acabado o on o.id = it.oc_id
    where it.produto_acabado_id = _produto_id and o.tenant_id = v_tenant
    limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de excluir.', coalesce(v_oc_numero, 'sem número')
      using errcode = 'P0001';
  end if;

  delete from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant;
end;
$function$;

CREATE OR REPLACE FUNCTION public._limpar_produto_acabado_core(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_modelo_id uuid;
  v_oc_id uuid; v_oc_numero text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select modelo_id into v_modelo_id from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant;
  if not found then raise exception 'nao_encontrado: produto' using errcode = 'P0002'; end if;
  -- Só rascunho (sem card no Planejamento).
  if v_modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento — não pode ser limpo.' using errcode = 'P0001';
  end if;
  -- Guarda de OC: zerar qtd/variantes/valor com pedido ativo dessincronizaria a OC.
  -- [r13] o produto agora e um item; junta ao cabecalho para o numero.
  select o.id, o.numero into v_oc_id, v_oc_numero
    from public.ocs_p_acabado_itens it join public.ocs_p_acabado o on o.id = it.oc_id
    where it.produto_acabado_id = _produto_id and o.tenant_id = v_tenant limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de limpar.', coalesce(v_oc_numero, 'sem número') using errcode = 'P0001';
  end if;

  -- Zera os campos editáveis; PRESERVA id/colecao_id/subcolecao/ref/mix_id/modelo_id(null).
  update public.produtos_acabados set
    nome = '',
    grupo_id = null, categoria_id = null, subcategoria1_id = null, subcategoria2_id = null,
    semana = null, empresa_id = null, representante_id = null,
    ref_fornecedor = null, composicao = null,
    grade_proporcao = '{}'::jsonb, qtd_total = 0, valor_unitario = 0, desconto_pct = 0,
    insumos_total = 0, markup_atacado = null, markup_varejo = null,
    tamanho_tipo = null,  -- [tamanho-em v1]
    categoria_tecido_id = null, material_aviamento_id = null,  -- [i3 v1] (ruling do controlador)
    updated_at = now()
  where id = _produto_id and tenant_id = v_tenant;

  delete from public.produto_acabado_variantes where produto_acabado_id = _produto_id;
end $function$;

CREATE OR REPLACE FUNCTION public._salvar_produto_acabado_core(_id uuid, _dados jsonb, _variantes jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_id uuid;
  v_modelo_id uuid;
  v_grupo_id uuid;
  v_categoria_id uuid;
  v_sub1_id uuid;
  v_sub2_id uuid;
  v_nome text;
  v_qtd_total int;
  v_valor_unitario numeric;
  v_desconto_pct numeric;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_insumos numeric := 0;
  v_redistribuir boolean;
  v_soma_var int := 0;
  v_pesos jsonb := '{}'::jsonb;
  v_split jsonb := '{}'::jsonb;
  v_variantes_final jsonb := '[]'::jsonb;
  v_nome_final text;
  v_categoria_final uuid;
  v_sub1_final uuid;
  v_sub2_final uuid;
  v_nome_atual text;
  v_grupo_atual uuid;
  v_categoria_atual uuid;
  v_sub1_atual uuid;
  v_sub2_atual uuid;
  v_tem_oc boolean;
  v_tt text;  -- [tamanho-em v1]
  v_ordens_antes int[] := '{}'::int[];  -- [leves L8, sku #22]
  v_cat_tecido uuid;     -- [i3 v1]
  v_mat_aviamento uuid;  -- [i3 v1]
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  v_nome := nullif(_dados->>'nome', '');
  v_grupo_id := nullif(_dados->>'grupo_id', '')::uuid;
  v_categoria_id := nullif(_dados->>'categoria_id', '')::uuid;
  v_sub1_id := nullif(_dados->>'subcategoria1_id', '')::uuid;
  v_sub2_id := nullif(_dados->>'subcategoria2_id', '')::uuid;

  if _id is null then
    if v_grupo_id is null or v_categoria_id is null then
      raise exception 'Informe grupo e categoria do produto.' using errcode = 'P0001';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
    v_modelo_id := null;
  else
    select modelo_id, nome, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id
      into v_modelo_id, v_nome_atual, v_grupo_atual, v_categoria_atual, v_sub1_atual, v_sub2_atual
      from public.produtos_acabados
      where id = _id and tenant_id = v_tenant
      for update;  -- [pa-sync v1] trava a linha: o "antes" comparado abaixo e o UPDATE veem o MESMO estado
    if not found then
      raise exception 'Produto não encontrado';
    end if;

    v_tem_oc := exists (select 1 from public.ocs_p_acabado_itens where produto_acabado_id = _id);  -- [r13] produto agora e item
    if v_tem_oc and (
      coalesce(v_nome, v_nome_atual) is distinct from v_nome_atual
      or v_grupo_id is distinct from v_grupo_atual
      or v_categoria_id is distinct from v_categoria_atual
      or v_sub1_id is distinct from v_sub1_atual
      or v_sub2_id is distinct from v_sub2_atual
    ) then
      raise exception 'Produto com pedido vinculado — desvincule a OC para alterar a identidade.'
        using errcode = 'P0001';
    end if;
  end if;

  v_qtd_total := coalesce(nullif(_dados->>'qtd_total', '')::int, 0);
  v_valor_unitario := coalesce(nullif(_dados->>'valor_unitario', '')::numeric, 0);
  v_desconto_pct := coalesce(nullif(_dados->>'desconto_pct', '')::numeric, 0);
  v_redistribuir := coalesce(_dados->>'redistribuir', 'false') = 'true';

  v_markup_atacado := nullif(_dados->>'markup_atacado', '')::numeric;
  v_markup_varejo := nullif(_dados->>'markup_varejo', '')::numeric;
  if (v_markup_atacado is not null and v_markup_atacado <= 0)
     or (v_markup_varejo is not null and v_markup_varejo <= 0) then
    raise exception 'O markup precisa ser maior que zero.' using errcode = 'P0001';
  end if;

  -- [tamanho-em v1] "Tamanho em" (P-85 A): só quando a chave vem no _dados (a tela manda só se mudou). Com card, o
  -- gatilho do produto (fn_produto_tamanho_tipo_handover) leva o valor ao modelo espelho e limpa o do produto.
  if _dados ? 'tamanho_tipo' then
    v_tt := nullif(_dados->>'tamanho_tipo', '');
    if v_tt is null or v_tt not in ('letra', 'numero') then
      raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';
    end if;
  end if;

  -- [i3 v1] Release I3: Categoria do tecido (grupo nao Acessorios) / Material do aviamento (Acessorios) do produto - so
  -- quando a chave vem no _dados (padrao tamanho_tipo; a tela manda sempre as 2); vazio = limpa. Fora da trava de
  -- identidade com OC e da trava da Integracao (campo informativo, P-219 A). Id de outra loja = recusa (o gatilho
  -- trg_pa_cat_material_tenant confere de novo).
  if _dados ? 'categoria_tecido_id' then
    v_cat_tecido := nullif(_dados->>'categoria_tecido_id', '')::uuid;
    if v_cat_tecido is not null and not exists (select 1 from public.categorias_tecido ct
                                                 where ct.id = v_cat_tecido and ct.tenant_id = v_tenant) then
      raise exception 'Categoria do tecido não encontrada nesta loja.' using errcode = 'P0001';
    end if;
  end if;
  if _dados ? 'material_aviamento_id' then
    v_mat_aviamento := nullif(_dados->>'material_aviamento_id', '')::uuid;
    if v_mat_aviamento is not null and not exists (select 1 from public.materiais_aviamento ma
                                                    where ma.id = v_mat_aviamento and ma.tenant_id = v_tenant) then
      raise exception 'Material do aviamento não encontrado nesta loja.' using errcode = 'P0001';
    end if;
  end if;

  select coalesce(jsonb_object_agg(v->>'ordem', coalesce(nullif(v->>'peso', '')::numeric, 0)), '{}'::jsonb)
    into v_pesos
    from jsonb_array_elements(coalesce(_variantes, '[]'::jsonb)) v;

  if v_redistribuir then
    v_split := public._split_maior_resto(v_qtd_total, v_pesos);
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'ordem', (v->>'ordem')::int,
      'cor_id', nullif(v->>'cor_id', ''),
      'cor_apelido_id', nullif(v->>'cor_apelido_id', ''),
      'peso', coalesce(nullif(v->>'peso', '')::numeric, 0),
      'qtd', case when v_redistribuir
                  then coalesce((v_split->>(v->>'ordem'))::int, 0)
                  else coalesce(nullif(v->>'qtd', '')::int, 0)
             end
    )), '[]'::jsonb),
    coalesce(sum(case when v_redistribuir
                       then coalesce((v_split->>(v->>'ordem'))::int, 0)
                       else coalesce(nullif(v->>'qtd', '')::int, 0)
                  end), 0)
  into v_variantes_final, v_soma_var
  from jsonb_array_elements(coalesce(_variantes, '[]'::jsonb)) v;

  if not v_redistribuir and v_soma_var <> v_qtd_total then
    raise exception 'A soma das variantes (%) difere da quantidade total (%)', v_soma_var, v_qtd_total
      using errcode = 'P0001';
  end if;

  if v_modelo_id is not null then
    -- [leves L8, preco M1] custo_previsto da linha JA e preco x consumo x (1 + perda) (por peca) -> soma direta (antes
    -- multiplicava o consumo de novo); = _pa_recomputar_precos_modelo e _custo_unitario_modelos_core (CTE pa).
    select coalesce(sum(coalesce(me.custo_previsto, 0)), 0) into v_insumos
      from public.modelo_etiquetas me where me.modelo_id = v_modelo_id;
  end if;

  if _id is null then
    insert into public.produtos_acabados (
      tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
      grade_proporcao, qtd_total, valor_unitario, desconto_pct, insumos_total,
      markup_atacado, markup_varejo, foto_url, tamanho_tipo, categoria_tecido_id, material_aviamento_id  -- [i3 v1]
    ) values (
      v_tenant, v_nome, nullif(_dados->>'ref', ''), v_grupo_id, v_categoria_id,
      v_sub1_id, v_sub2_id,
      nullif(_dados->>'colecao_id', '')::uuid, _dados->>'subcolecao', _dados->>'semana',
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), v_qtd_total, v_valor_unitario, v_desconto_pct, v_insumos,
      v_markup_atacado, v_markup_varejo, nullif(_dados->>'foto_url', ''), v_tt,  -- [tamanho-em v1]
      v_cat_tecido, v_mat_aviamento  -- [i3 v1]
    ) returning id into v_id;
  else
    update public.produtos_acabados set
      nome = coalesce(v_nome, nome),
      ref = coalesce(nullif(_dados->>'ref', ''), ref),
      grupo_id = v_grupo_id,
      categoria_id = v_categoria_id,
      subcategoria1_id = v_sub1_id,
      subcategoria2_id = v_sub2_id,
      colecao_id = nullif(_dados->>'colecao_id', '')::uuid,
      subcolecao = _dados->>'subcolecao',
      semana = _dados->>'semana',
      empresa_id = nullif(_dados->>'empresa_id', '')::uuid,
      representante_id = nullif(_dados->>'representante_id', '')::uuid,
      ref_fornecedor = _dados->>'ref_fornecedor',
      composicao = _dados->>'composicao',
      grade_proporcao = coalesce(_dados->'grade_proporcao', '{}'::jsonb),
      qtd_total = v_qtd_total,
      valor_unitario = v_valor_unitario,
      desconto_pct = v_desconto_pct,
      insumos_total = v_insumos,
      markup_atacado = v_markup_atacado,
      markup_varejo = v_markup_varejo,
      -- Última edição manda (set/2026): markup não-null LIMPA o preço fixo do canal, espelhando a RPC
      -- dedicada `_salvar_precos_fixo_produto_acabado_core`. Sem isto o save em LOTE deixava fixo E
      -- markup no mesmo canal (banco inconsistente + arredondamento ressuscitava no próximo ciclo).
      preco_atacado_fixo = case when v_markup_atacado is not null then null else preco_atacado_fixo end,
      preco_varejo_fixo = case when v_markup_varejo is not null then null else preco_varejo_fixo end,
      foto_url = nullif(_dados->>'foto_url', ''),
      tamanho_tipo = case when _dados ? 'tamanho_tipo' then v_tt else tamanho_tipo end,  -- [tamanho-em v1]
      categoria_tecido_id = case when _dados ? 'categoria_tecido_id' then v_cat_tecido else categoria_tecido_id end,  -- [i3 v1]
      material_aviamento_id = case when _dados ? 'material_aviamento_id' then v_mat_aviamento else material_aviamento_id end,  -- [i3 v1]
      updated_at = now()
    where id = _id and tenant_id = v_tenant
    returning nome, categoria_id, subcategoria1_id, subcategoria2_id
      into v_nome_final, v_categoria_final, v_sub1_final, v_sub2_final;
    v_id := _id;

    -- [pa-sync v1] P-136 A: o card só recebe do produto o que MUDOU neste save (valor novo IS DISTINCT FROM o gravado
    -- antes, lido acima), coluna a coluna; o resto fica como está no card (ex.: Categoria trocada no Planejamento).
    -- Nada mudou (ou o card já tem o valor, ex.: nome já levado por trg_espelho_modelo_nome_ref) = nenhum UPDATE:
    -- o rev do card não sobe e a trava da Integração (trg_zz_integracao_trava) não é acionada.
    if v_modelo_id is not null then
      update public.modelos set
        nome = case when v_nome_final is distinct from v_nome_atual then v_nome_final else nome end,
        categoria_principal_id = case when v_categoria_final is distinct from v_categoria_atual
                                      then v_categoria_final else categoria_principal_id end,
        subcategoria1_id = case when v_sub1_final is distinct from v_sub1_atual then v_sub1_final else subcategoria1_id end,
        subcategoria2_id = case when v_sub2_final is distinct from v_sub2_atual then v_sub2_final else subcategoria2_id end
      where id = v_modelo_id
        and ((v_nome_final is distinct from v_nome_atual and nome is distinct from v_nome_final)
          or (v_categoria_final is distinct from v_categoria_atual and categoria_principal_id is distinct from v_categoria_final)
          or (v_sub1_final is distinct from v_sub1_atual and subcategoria1_id is distinct from v_sub1_final)
          or (v_sub2_final is distinct from v_sub2_atual and subcategoria2_id is distinct from v_sub2_final));
    end if;
  end if;

  -- [leves L8, sku #22] ordens das variantes ANTES deste save (a grade cor x tamanho do card espelho mora em
  -- modelo_grades com variante_numero = ordem).
  select coalesce(array_agg(pav.ordem), '{}'::int[]) into v_ordens_antes
    from public.produto_acabado_variantes pav where pav.produto_acabado_id = v_id;

  delete from public.produto_acabado_variantes where produto_acabado_id = v_id;
  insert into public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
  select v_tenant, v_id,
         (elem->>'ordem')::int,
         nullif(elem->>'cor_id', '')::uuid,
         nullif(elem->>'cor_apelido_id', '')::uuid,
         coalesce((elem->>'peso')::numeric, 0),
         coalesce((elem->>'qtd')::int, 0)
  from jsonb_array_elements(v_variantes_final) elem;

  -- [leves L8, sku #22] a variante que SAIU neste save leva junto a grade dela no card espelho: sem isto, uma variante
  -- nova que reusasse a mesma ordem herdava a grade da apagada. So as ordens que existiam antes e nao vieram agora (a
  -- grade de quem fica nao muda). Produto travado pela Integracao ja recusa mudar variantes (trg_zz_integracao_trava_var).
  if v_modelo_id is not null and cardinality(v_ordens_antes) > 0 then
    delete from public.modelo_grades g
     where g.modelo_id = v_modelo_id
       and g.variante_numero = any (v_ordens_antes)
       and not exists (select 1 from jsonb_array_elements(v_variantes_final) e
                        where (e->>'ordem')::int = g.variante_numero);
  end if;

  perform public._pa_recomputar_precos_modelo(v_id);

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public._custo_unitario_modelos_core(_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid := public.get_user_tenant_id(); v_result jsonb;
begin
  if v_tenant is null then raise exception 'Sem tenant'; end if;

  with cad_conf as (
    select distinct on (c.modelo_id) c.modelo_id, c.id as cad_id
    from cad c
    where c.tenant_id = v_tenant and c.enviado_corte
    order by c.modelo_id, c.data_enviado_corte desc nulls last
  ),
  mat as (
    select cc.modelo_id,
      coalesce((select sum(case when ct.custo_cad is not null then ct.custo_cad
          else coalesce(ct.consumo_cad,0) * (1 + coalesce(ct.loss_percent_cad,0)/100.0)
               * public._preco_tecido_por_metro(cc.modelo_id, ct.tipo, ct.numero, ct.artigo_id) end)
        from cad_tecidos ct where ct.cad_id = cc.cad_id), 0)
      + coalesce((select sum(coalesce(ca.consumo,0) * coalesce(av.preco,0))
        from cad_aviamentos ca left join aviamentos av on av.id = ca.aviamento_id where ca.cad_id = cc.cad_id), 0)
      -- [urg R1] insumo vinculado a UM tamanho: custo REAL rateado como o previsto (Ruling A5) - consumo x fator, fator = pecas do
      -- tamanho / grade do CAD (_insumo_fator_custo: grade vazia = 1, tamanho fora da grade = 0), com o MESMO total da coluna grade
      -- abaixo (real, senao planejada, por linha de cad_grades). Insumo sem vinculo: fator 1 = o valor de antes.
      + COALESCE((SELECT SUM(COALESCE(ce.consumo,0)
          * public._insumo_fator_custo(public._insumo_tamanho_de(ce.etiqueta_id), public._grade_mapa_cad(cc.cad_id, true),
              (SELECT coalesce(sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)),0) FROM cad_grades g WHERE g.cad_id = cc.cad_id))
          * COALESCE(NULLIF((SELECT MAX(COALESCE(ve.preco,0)) FROM variantes_etiqueta ve WHERE ve.etiqueta_id = ce.etiqueta_id AND ve.cor_id IS NOT DISTINCT FROM ce.cor_id),0), (SELECT et.preco FROM etiquetas et WHERE et.id = ce.etiqueta_id), 0)) FROM cad_etiquetas ce WHERE ce.cad_id = cc.cad_id), 0) as materials,
      coalesce((select sum(coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0)
            - coalesce(pt.desconto_total,0) + coalesce(pt.multa_total,0))
        from producao_terceirizados pt where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false
          and coalesce(pt.ativo,true)
          -- [R16 fix round 1/2, M2 + INFO R1] "o lancado" do servico = bloco com BRUTO (preco x qtd) > 0; soma o liquido
          -- (bruto - desconto + multa), que pode ser 0 (servico feito e todo descontado = custo 0, nao a prevista)
          and coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0) > 0), 0) as servico_total,
      coalesce((select sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)) from cad_grades g where g.cad_id = cc.cad_id), 0) as grade,
      -- [medios R16 preco M7, P-186 A] M.O. PREVISTA dos servicos SEM bloco externo lancado (por peca):
      --   (fix round 1/2, M2 + INFO R1: "lancado" = bloco externo ativo com BRUTO preco x qtd > 0; bloco vazio ainda nao
      --   lancou -> vale a prevista daquele servico; bloco lancado e todo descontado -> custo 0, nao a prevista)
      --   linha de modelo_servico_mo COM categoria -> entra se o cad NAO tem bloco externo ativo daquela categoria
      --     (com bloco, vale o lancado, ja somado em servico_total); costura/oficina INTERNA nunca tem lancado -> prevista;
      --   linha "Geral (legado)" (categoria NULL) -> entra se o cad NAO tem bloco externo ativo de servico SEM linha
      --     propria (sem categoria, ou de categoria sem linha no modelo) - esse lancado e o que substitui o "Geral".
      coalesce((select sum(s.valor) from modelo_servico_mo s
        where s.modelo_id = cc.modelo_id
          and case when s.categoria_terceirizado_id is not null
                then not exists (select 1 from producao_terceirizados pt
                                  where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false and coalesce(pt.ativo,true)
                                    and coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0) > 0
                                    and pt.categoria_terceirizado_id = s.categoria_terceirizado_id)
                else not exists (select 1 from producao_terceirizados pt
                                  where pt.cad_id = cc.cad_id and coalesce(pt.interno,false) = false and coalesce(pt.ativo,true)
                                    and coalesce(pt.preco_metro_unidade,0) * coalesce(pt.quantidade_enviada,0) > 0
                                    and (pt.categoria_terceirizado_id is null
                                         or not exists (select 1 from modelo_servico_mo s2
                                                         where s2.modelo_id = cc.modelo_id
                                                           and s2.categoria_terceirizado_id = pt.categoria_terceirizado_id)))
              end), 0) as mo_prevista_sem_lancado
    from cad_conf cc
  ),
  pa as (
    select p.modelo_id,
      p.valor_unitario,
      p.desconto_pct,
      oc.valor_unitario_real,
      oc.status as oc_status,
      -- [medios R16, preco M1] custo_previsto da linha JA e preco x consumo x (1 + perda) (por peca; = o que a ficha
      -- soma em totaisBom) -> soma direta (antes multiplicava o consumo de novo).
      coalesce((select sum(coalesce(me.custo_previsto,0))
                from modelo_etiquetas me where me.modelo_id = p.modelo_id), 0) as insumos_por_peca
    from produtos_acabados p
    -- [r13] o produto agora e um item (ocs_p_acabado_itens); a OC de 1 item da o MESMO status/valor_unitario_real de antes.
    left join ocs_p_acabado_itens oc on oc.produto_acabado_id = p.id
    where p.tenant_id = v_tenant and p.modelo_id is not null
  ),
  imp as (
    -- Card: `landed` (previsto). OC (se vinculada): status + custo landed REAL da OC.
    select p.modelo_id,
      public._imp_custo_landed(p.id) as landed,
      oc.status as oc_status,
      oc.custo_unitario_landed_real as landed_real
    from produtos_importados p
    -- [r13] idem PI: o produto agora e um item (ocs_importado_itens). Incluido aqui para a T3 nao reabrir este leitor.
    left join ocs_importado_itens oc on oc.produto_importado_id = p.id
    where p.tenant_id = v_tenant and p.modelo_id is not null
  )
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    'previsto', case when m.origem = 'revenda' and pa.modelo_id is not null
                  then coalesce(pa.valor_unitario,0) * (1 - coalesce(pa.desconto_pct,0)/100.0) + coalesce(pa.insumos_por_peca,0)
                when m.origem = 'importado' and imp.modelo_id is not null
                  then coalesce(imp.landed,0)
                else coalesce(m.custo_peca_previsto,0) end,
    'real', case when m.origem = 'revenda' and pa.modelo_id is not null
                  then case when pa.oc_status = 'recebido'
                         -- [medios R16, R12 INFO 6] recebida sem valor real (a coluna e NOT NULL DEFAULT 0: "sem" = 0)
                         -- -> o valor da compra (bruto - desconto), nunca 0
                         then coalesce(nullif(pa.valor_unitario_real, 0),
                                       coalesce(pa.valor_unitario,0) * (1 - coalesce(pa.desconto_pct,0)/100.0))
                              + coalesce(pa.insumos_por_peca,0)
                       else null end
             when m.origem = 'importado' and imp.modelo_id is not null
                  then case when imp.oc_status = 'recebido'
                         -- [medios R16, R12 INFO 6] recebida sem landed real (NOT NULL DEFAULT 0: "sem" = 0) -> o
                         -- landed do card, nunca 0
                         then coalesce(nullif(imp.landed_real, 0), imp.landed, 0)
                       else null end
             when exists(select 1 from cad_conf cc where cc.modelo_id = m.id)
               then coalesce((select materials + case when grade > 0 then servico_total / grade else 0 end
                                     + mo_prevista_sem_lancado
                              from mat where mat.modelo_id = m.id), 0)
                    + coalesce((select sum((c->>'valor')::numeric)
                               from jsonb_array_elements(coalesce(m.custos_adicionais,'[]'::jsonb)) c), 0)
             else coalesce(m.custo_peca_previsto,0)
           end,
    'mao_obra_previsto', coalesce((select sum(s.valor) from modelo_servico_mo s where s.modelo_id = m.id), 0),
    -- [medios R16 preco M7] M.O. embutida no 'real' = lancado / grade + prevista dos servicos sem lancado.
    'mao_obra_real', coalesce((select case when grade > 0 then servico_total / grade else 0 end + mo_prevista_sem_lancado
                                from mat where mat.modelo_id = m.id), 0),
    'confirmado', case when m.origem = 'revenda' and pa.modelo_id is not null
                     then coalesce(pa.oc_status = 'recebido', false)
                   when m.origem = 'importado' and imp.modelo_id is not null
                     then coalesce(imp.oc_status = 'recebido', false)
                   else exists(select 1 from cad_conf cc where cc.modelo_id = m.id) end
  )), '{}'::jsonb)
  into v_result
  from modelos m
  left join pa on pa.modelo_id = m.id
  left join imp on imp.modelo_id = m.id
  where m.tenant_id = v_tenant and m.id = any(_ids);

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public._dashboard_leadtime_itens_core(p_colecao uuid DEFAULT NULL::uuid, p_subcolecao text DEFAULT NULL::text, p_semana text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.get_user_tenant_id();
  v_out jsonb;
  v_sla_servico text;  -- etapa cujo prazo vem do SLA da Sub1 (servicos | servico_cat:<id>)
  v_ultima text;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  -- [medios R12, prod #7, P-185 A] a ULTIMA coluna do quadro e o ponto de chegada: NAO conta tempo.
  SELECT r.key INTO v_ultima FROM public._kanban_status_rows(v_tenant) r ORDER BY r.ord DESC LIMIT 1;
  SELECT leadtime->>'slaServico' INTO v_sla_servico FROM public.tenant_config WHERE tenant_id = v_tenant;

  WITH
  spans AS (
    SELECT m.id AS modelo_id, 'planejamento'::text AS etapa,
           (m.ordem_criacao_enviada_at::date - m.created_at::date)::numeric AS dias
      FROM public.modelos m
      WHERE m.tenant_id = v_tenant AND m.ordem_criacao_enviada_at IS NOT NULL
    UNION ALL
    -- COMPRA (revenda): OC feita → recebimento. Liga ocs_p_acabado → produtos_acabados → modelo.
    -- [r13] "compra" = it.data_entrega (ITEM) - oc.data_pedido (cabecalho). Item de 1 produto = identico ao de antes.
    SELECT pa.modelo_id, 'compra', (it.data_entrega - oc.data_pedido)::numeric
      FROM public.ocs_p_acabado_itens it
      JOIN public.ocs_p_acabado oc ON oc.id = it.oc_id
      JOIN public.produtos_acabados pa ON pa.id = it.produto_acabado_id AND pa.tenant_id = v_tenant
      WHERE oc.data_pedido IS NOT NULL AND it.data_entrega IS NOT NULL AND pa.modelo_id IS NOT NULL
    UNION ALL
    -- COMPRA (importado): OC feita → recebimento (inclui trânsito/câmbio; etapas de câmbio são
    -- financeiras, sem marco de tempo próprio). Liga ocs_importado → produtos_importados → modelo.
    -- [r13] idem PI (incluido na T2 para a T3 nao reabrir): it.data_entrega - oc.data_pedido.
    SELECT pi.modelo_id, 'compra', (it.data_entrega - oc.data_pedido)::numeric
      FROM public.ocs_importado_itens it
      JOIN public.ocs_importado oc ON oc.id = it.oc_id
      JOIN public.produtos_importados pi ON pi.id = it.produto_importado_id AND pi.tenant_id = v_tenant
      WHERE oc.data_pedido IS NOT NULL AND it.data_entrega IS NOT NULL AND pi.modelo_id IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'cad_corte', (c.data_enviado_corte - c.created_at::date)::numeric
      FROM public.cad c
      WHERE c.tenant_id = v_tenant AND c.data_enviado_corte IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'servicos', (svc.dt - c.data_enviado_corte)::numeric
      FROM public.cad c
      JOIN LATERAL (SELECT max(t.data_entregue) AS dt FROM public.producao_terceirizados t WHERE t.cad_id = c.id) svc ON true
      WHERE c.tenant_id = v_tenant AND c.data_enviado_corte IS NOT NULL AND svc.dt IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'cq', (q.confirmado_at::date - COALESCE(svc.dt, q.created_at::date))::numeric
      FROM public.controle_qualidade q
      JOIN public.cad c ON c.id = q.cad_id AND c.tenant_id = v_tenant
      LEFT JOIN LATERAL (SELECT max(t.data_entregue) AS dt FROM public.producao_terceirizados t WHERE t.cad_id = c.id) svc ON true
      WHERE q.confirmado_at IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'direcionamento', (c.direcionamento_confirmado_at::date - q.confirmado_at::date)::numeric
      FROM public.cad c
      JOIN public.controle_qualidade q ON q.cad_id = c.id
      WHERE c.tenant_id = v_tenant AND c.direcionamento_confirmado_at IS NOT NULL AND q.confirmado_at IS NOT NULL
    UNION ALL
    SELECT m.id, 'lancamento', (m.data_lancamento - c.direcionamento_confirmado_at::date)::numeric
      FROM public.modelos m
      JOIN public.cad c ON c.modelo_id = m.id
      WHERE m.tenant_id = v_tenant AND m.data_lancamento IS NOT NULL AND c.direcionamento_confirmado_at IS NOT NULL
    UNION ALL
    SELECT c.modelo_id, 'servico_cat:' || ct.id::text, (pt.data_entregue - pt.data_enviado)::numeric
      FROM public.producao_terceirizados pt
      JOIN public.cad c ON c.id = pt.cad_id AND c.tenant_id = v_tenant
      JOIN public.categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
      WHERE pt.data_enviado IS NOT NULL AND pt.data_entregue IS NOT NULL
    UNION ALL
    -- [medios R12, P-185 A] a ultima coluna do quadro NUNCA conta tempo (trecho aberto ou fechado). O lead() e calculado
  -- ANTES do filtro: a coluna anterior fecha quando o card ENTRA na ultima. Status fora do quadro atual seguem contando.
    SELECT h.modelo_id, 'kanban:' || h.status,
           (EXTRACT(EPOCH FROM (COALESCE(h.nxt, now()) - h.entrou_at)) / 86400.0)::numeric
      FROM (SELECT h0.modelo_id, h0.status, h0.entrou_at,
                   lead(h0.entrou_at) OVER (PARTITION BY h0.modelo_id ORDER BY h0.entrou_at) AS nxt
              FROM public.modelo_kanban_historico h0
             WHERE h0.tenant_id = v_tenant) h
      WHERE h.status IS DISTINCT FROM v_ultima
  ),
  per_etapa AS (
    SELECT modelo_id, etapa, ROUND(SUM(GREATEST(dias, 0)), 1) AS dias
      FROM spans GROUP BY modelo_id, etapa
  ),
  dur AS (
    SELECT modelo_id, jsonb_object_agg(etapa, dias) AS duracoes
      FROM per_etapa GROUP BY modelo_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'modelo_id', m.id, 'ref', m.ref, 'nome', m.nome, 'versao', m.versao,
      'origem', COALESCE(m.origem, 'interno'),
      'colecao', COALESCE(col.nome, m.colecao), 'colecao_id', m.colecao_id,
      'subcolecao', m.subcolecao, 'semana', m.semana,
      'sub1_id', m.subcategoria1_id, 'sub1', s1.nome, 'sub1_sla', s1.sla_oficina,
      'duracoes', COALESCE(d.duracoes, '{}'::jsonb)
    ) ORDER BY COALESCE(col.nome, m.colecao) NULLS LAST, m.subcolecao NULLS LAST, m.semana NULLS LAST, m.ref NULLS LAST), '[]'::jsonb)
  INTO v_out
  FROM public.modelos m
  LEFT JOIN dur d ON d.modelo_id = m.id
  LEFT JOIN public.colecoes col ON col.id = m.colecao_id
  LEFT JOIN public.subcategorias1_produto s1 ON s1.id = m.subcategoria1_id
  WHERE m.tenant_id = v_tenant
    -- [medios R12, fix round 2] o card cujo UNICO historico e a ultima coluna (que nao conta tempo) continua na lista,
    -- com duracoes vazias: mesmo conjunto de cards de antes (todo card com historico tinha trecho de kanban).
    AND (d.modelo_id IS NOT NULL
         OR EXISTS (SELECT 1 FROM public.modelo_kanban_historico hk WHERE hk.modelo_id = m.id AND hk.tenant_id = v_tenant))
    AND (p_colecao IS NULL OR m.colecao_id = p_colecao)
    AND (p_subcolecao IS NULL OR m.subcolecao = p_subcolecao)
    AND (p_semana IS NULL OR m.semana = p_semana);

  RETURN jsonb_build_object('itens', v_out, 'slaServico', v_sla_servico);
END;
$function$;

CREATE OR REPLACE FUNCTION public._estoque_extrato_insumo_core(_tenant uuid, _etiqueta_id uuid)
 RETURNS TABLE(bucket_variante_id uuid, bucket_tamanho text, bucket_cor_id uuid, bucket_cor_nome text, quando timestamp with time zone, quando_fonte text, tipo text, origem text, quantidade numeric, quem text, ref_oc text, ref_modelo text, ref_id uuid, detalhe text, core_recebido numeric, core_baixa numeric, core_fisico numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
-- [urg R3 T14] Extrato ("Historico") de UM insumo, por bucket (tamanho, cor) = a chave da linha do _estoque_etiqueta_core (o bucket
-- da tela e da lib TS e (tamanho, nome da cor); core_* = a soma das linhas DISTINTAS do core com a mesma chave), so leitura. Mesmas
-- fontes e regras do core: item nao cancelado de OC Insumo 'recebido' (bucket da variante; recebida senao a pedida); por CAD enviado ao
-- PCP, a contribuicao ATUAL pela MESMA regra (enviar_por_tamanho preenchido = por tamanho; senao o "a enviar" inteiro repartido pela
-- grade planejada do CAD com _split_maior_resto, a fracao no bucket sem tamanho, quando o insumo tem tamanho; senao tudo sem tamanho)
-- vira a linha-base 'explosao' (C - Sigma ajustes, data/quem do envio) + uma linha 'explosao_ajuste' por transacao (txid) do
-- estoque_mov_log gravada DEPOIS do ultimo envio (antes/depois mapeados pela mesma regra com os pesos de HOJE - Ruling A19; delta
-- liquido <> 0); revenda/importado ainda nao enviado = consumo x pecas recebidas (_insumo_pecas: vinculado = so o tamanho; R1).
-- Sigma por bucket = recebido - baixa do core POR CONSTRUCAO (A17). Datas: OC Insumo sem audit = so a data de entrega (DIA =
-- meia-noite no fuso da loja); envio = audit (enviado_corte -> true) senao data_enviado_corte; revenda = data de entrega da OC de
-- P. Acabado/Importado recebida. Quem = so o NOME (A21). Loja errada/item inexistente = conjunto vazio.
DECLARE
  v_tz text;
BEGIN
  SELECT tc.timezone INTO v_tz FROM public.tenant_config tc WHERE tc.tenant_id = _tenant;
  BEGIN
    PERFORM now() AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz := NULL;
  END;
  v_tz := coalesce(nullif(v_tz, ''), 'America/Sao_Paulo');

  RETURN QUERY
  WITH
  cr AS (
    SELECT d.tamanho AS tam, d.cor_nome AS cnome, SUM(d.recebido) AS rec, SUM(d.baixa) AS bx, SUM(d.fisico) AS fis
      FROM (SELECT DISTINCT x.tamanho, x.cor_nome, x.recebido, x.prev_receb, x.baixa, x.fisico
              FROM public._estoque_etiqueta_core(_tenant) x
             WHERE x.etiqueta_id = _etiqueta_id) d
     GROUP BY 1, 2
  ),
  etq AS (
    SELECT e.id, (COALESCE(e.formato_tamanho, 'ambos') <> 'nenhum'
                  AND EXISTS (SELECT 1 FROM public.variantes_etiqueta ve WHERE ve.etiqueta_id = e.id AND ve.tamanho IS NOT NULL)) AS com_tam
      FROM public.etiquetas e
     WHERE e.id = _etiqueta_id AND e.tenant_id = _tenant
       AND EXISTS (SELECT 1 FROM cr)
  ),
  oc0 AS (
    SELECT ve.tamanho AS tam, ve.cor_id AS cor, o.id AS oc_id, o.numero_pedido, o.data_entrega,
           COALESCE(i.quantidade_recebida, i.quantidade_pedida, 0) AS q
      FROM public.ocs_etiqueta_itens i
      JOIN public.ocs_etiqueta o ON o.id = i.oc_etiqueta_id AND o.tenant_id = _tenant AND o.status = 'recebido'
      LEFT JOIN public.variantes_etiqueta ve ON ve.id = i.variante_etiqueta_id
     WHERE i.etiqueta_id = _etiqueta_id AND COALESCE(i.cancelado, false) = false
       AND EXISTS (SELECT 1 FROM etq)
  ),
  ent AS (
    SELECT o.tam, o.cor,
           CASE WHEN o.data_entrega IS NOT NULL THEN (o.data_entrega::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN o.data_entrega IS NOT NULL THEN 'data_oc' ELSE 'sem_data' END AS fonte,
           'oc' AS org, o.q, NULL::text AS por, o.numero_pedido::text AS oc_ref, NULL::text AS mod_ref, o.oc_id AS rid, NULL::text AS det
      FROM oc0 o
  ),
  ce AS (
    SELECT ce.cad_id AS cad, ce.cor_id AS cor, COALESCE(ce.quantidade_enviar, 0) AS v, ce.enviar_por_tamanho AS ept
      FROM public.cad_etiquetas ce
      JOIN public.cad c ON c.id = ce.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
     WHERE ce.etiqueta_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
  ),
  lg0 AS (
    SELECT l.id, l.cad_id AS cad, l.cor_id AS cor, l.txid, l.created_at, l.created_by, l.antes, l.depois, l.ept_antes, l.ept_depois
      FROM public.estoque_mov_log l
      JOIN public.cad c ON c.id = l.cad_id AND c.tenant_id = _tenant AND c.enviado_corte
     WHERE l.tenant_id = _tenant AND l.familia = 'insumo' AND l.item_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
  ),
  cads AS (
    SELECT DISTINCT x.cad FROM (SELECT cad FROM ce UNION ALL SELECT cad FROM lg0) x
  ),
  pesos AS (  -- pesos de HOJE = grade planejada do CAD por tamanho (so com peca > 0), so se o insumo tem tamanho (regra do ce_sem)
    SELECT k.cad,
           CASE WHEN (SELECT e.com_tam FROM etq e)
                THEN (SELECT jsonb_object_agg(w.k, w.s)
                        FROM (SELECT kv.key AS k, sum((kv.value)::numeric) AS s
                                FROM public.cad_grades g
                                CROSS JOIN LATERAL jsonb_each_text(coalesce(g.grades_planejadas, '{}'::jsonb)) kv
                               WHERE g.cad_id = k.cad AND kv.value ~ '^[0-9]+(\.[0-9]+)?$'
                               GROUP BY kv.key
                              HAVING sum((kv.value)::numeric) > 0) w)
           END AS p
      FROM cads k
  ),
  contrib AS (
    SELECT r.cad, m.tam, r.cor, SUM(m.q) AS c
      FROM ce r
      LEFT JOIN pesos pe ON pe.cad = r.cad
      CROSS JOIN LATERAL (
        SELECT kv.key AS tam, (kv.value)::numeric AS q
          FROM jsonb_each_text(CASE WHEN coalesce(r.ept, '{}'::jsonb) <> '{}'::jsonb THEN r.ept ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT kv.key, (kv.value)::numeric
          FROM jsonb_each_text(CASE WHEN coalesce(r.ept, '{}'::jsonb) = '{}'::jsonb AND pe.p IS NOT NULL AND r.v >= 1
                                    THEN public._split_maior_resto(floor(r.v)::int, pe.p) ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT NULL::text, CASE WHEN pe.p IS NOT NULL AND r.v >= 1 THEN r.v - floor(r.v) ELSE r.v END
         WHERE coalesce(r.ept, '{}'::jsonb) = '{}'::jsonb
      ) m
     GROUP BY 1, 2, 3
  ),
  aud_cad AS (
    SELECT DISTINCT ON (al.registro_id) al.registro_id, al.created_at, al.user_nome
      FROM public.audit_log al
     WHERE al.registro_id IN (SELECT k.cad FROM cads k)
       AND al.tenant_id = _tenant AND al.tabela = 'cad' AND al.acao = 'editar'
       AND al.dados -> 'enviado_corte' ->> 'para' = 'true'
     ORDER BY al.registro_id, al.created_at DESC, al.id DESC
  ),
  envio AS (
    SELECT k.cad,
           CASE WHEN ac.registro_id IS NOT NULL THEN ac.created_at
                WHEN c.data_enviado_corte IS NOT NULL THEN (c.data_enviado_corte::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ac.registro_id IS NOT NULL THEN 'registro' WHEN c.data_enviado_corte IS NOT NULL THEN 'data_envio'
                ELSE 'sem_data' END AS fonte,
           ac.user_nome AS por,
           COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref
      FROM cads k
      JOIN public.cad c ON c.id = k.cad
      LEFT JOIN aud_cad ac ON ac.registro_id = k.cad
      LEFT JOIN public.modelos m ON m.id = c.modelo_id AND m.tenant_id = _tenant
  ),
  lgm AS (  -- cada lado do log mapeado para (tamanho) pela regra do core com os pesos de HOJE; depois - antes
    SELECT x.id, x.cad, m.tam, x.cor, x.txid, x.created_at, x.created_by, m.q * x.sinal AS d
      FROM (SELECT l.id, l.cad, l.cor, l.txid, l.created_at, l.created_by, l.depois AS v, l.ept_depois AS ept, 1 AS sinal
              FROM lg0 l JOIN envio e ON e.cad = l.cad WHERE e.qd IS NULL OR l.created_at > e.qd
            UNION ALL
            SELECT l.id, l.cad, l.cor, l.txid, l.created_at, l.created_by, l.antes, l.ept_antes, -1
              FROM lg0 l JOIN envio e ON e.cad = l.cad WHERE e.qd IS NULL OR l.created_at > e.qd) x
      LEFT JOIN pesos pe ON pe.cad = x.cad
      CROSS JOIN LATERAL (
        SELECT kv.key AS tam, (kv.value)::numeric AS q
          FROM jsonb_each_text(CASE WHEN coalesce(x.ept, '{}'::jsonb) <> '{}'::jsonb THEN x.ept ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT kv.key, (kv.value)::numeric
          FROM jsonb_each_text(CASE WHEN coalesce(x.ept, '{}'::jsonb) = '{}'::jsonb AND pe.p IS NOT NULL AND x.v >= 1
                                    THEN public._split_maior_resto(floor(x.v)::int, pe.p) ELSE '{}'::jsonb END) kv
        UNION ALL
        SELECT NULL::text, CASE WHEN pe.p IS NOT NULL AND x.v >= 1 THEN x.v - floor(x.v) ELSE x.v END
         WHERE coalesce(x.ept, '{}'::jsonb) = '{}'::jsonb
      ) m
  ),
  lg AS (
    SELECT l.cad, l.tam, l.cor, l.txid, SUM(l.d) AS d, max(l.created_at) AS qd,
           (array_agg(l.created_by ORDER BY l.created_at DESC, l.id DESC))[1] AS por_id
      FROM lgm l
     GROUP BY 1, 2, 3, 4
    HAVING SUM(l.d) <> 0
  ),
  base AS (
    SELECT k.cad, k.tam, k.cor,
           COALESCE(ct.c, 0) - COALESCE((SELECT SUM(g.d) FROM lg g
                                          WHERE g.cad = k.cad AND g.tam IS NOT DISTINCT FROM k.tam AND g.cor IS NOT DISTINCT FROM k.cor), 0) AS b
      FROM (SELECT cad, tam, cor FROM contrib UNION SELECT cad, tam, cor FROM lg) k
      LEFT JOIN contrib ct ON ct.cad = k.cad AND ct.tam IS NOT DISTINCT FROM k.tam AND ct.cor IS NOT DISTINCT FROM k.cor
  ),
  sai_cad AS (
    SELECT b.tam, b.cor, e.qd, e.fonte, 'explosao' AS org, -b.b AS q, e.por::text AS por, NULL::text AS oc_ref, e.mod_ref, b.cad AS rid,
           NULL::text AS det
      FROM base b JOIN envio e ON e.cad = b.cad
    UNION ALL
    SELECT g.tam, g.cor, g.qd, 'registro', 'explosao_ajuste', -g.d, u.nome::text, NULL::text, e.mod_ref, g.cad, NULL::text
      FROM lg g JOIN envio e ON e.cad = g.cad
      LEFT JOIN public.users u ON u.id = g.por_id
  ),
  rev0 AS (  -- a MESMA baixa_revenda do core (revenda/importado ainda nao enviado ao PCP, pecas recebidas do cad-espelho)
    SELECT m.id AS modelo, m.origem AS m_origem, COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref, c.id AS cad, me.cor_id AS cor,
           sum(me.consumo * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(c.id, true),
                                                 coalesce(cg.total_real, 0))) AS q
      FROM public.modelo_etiquetas me
      JOIN public.modelos m ON m.id = me.modelo_id AND m.tenant_id = _tenant AND m.origem IN ('revenda', 'importado')
      JOIN public.cad c ON c.modelo_id = m.id AND c.tenant_id = _tenant AND NOT coalesce(c.enviado_corte, false)
      JOIN LATERAL (SELECT g.cad_id, sum(g.grade_total_real) AS total_real FROM public.cad_grades g WHERE g.cad_id = c.id GROUP BY g.cad_id) cg
        ON true
     WHERE me.etiqueta_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
     GROUP BY 1, 2, 3, 4, 5
  ),
  rev_oc AS (
    SELECT DISTINCT ON (r.modelo) r.modelo, x.numero, x.data_entrega
      FROM rev0 r
      JOIN LATERAL (
        -- [r13] rotulo/numero/data pelo ITEM recebido (o cabecalho e derivado; o item carrega a data_entrega/status).
        SELECT o.numero::text AS numero, it.data_entrega, o.created_at
          FROM public.ocs_p_acabado_itens it JOIN public.ocs_p_acabado o ON o.id = it.oc_id
          JOIN public.produtos_acabados pa ON pa.id = it.produto_acabado_id
         WHERE r.m_origem = 'revenda' AND pa.modelo_id = r.modelo AND o.tenant_id = _tenant AND it.status = 'recebido'
        UNION ALL
        SELECT o.numero::text, it.data_entrega, o.created_at
          FROM public.ocs_importado_itens it JOIN public.ocs_importado o ON o.id = it.oc_id
          JOIN public.produtos_importados pi ON pi.id = it.produto_importado_id
         WHERE r.m_origem = 'importado' AND pi.modelo_id = r.modelo AND o.tenant_id = _tenant AND it.status = 'recebido'
      ) x ON true
     ORDER BY r.modelo, x.data_entrega DESC NULLS LAST, x.created_at DESC
  ),
  sai_rev AS (
    SELECT NULL::text AS tam, r.cor,
           CASE WHEN ro.data_entrega IS NOT NULL THEN (ro.data_entrega::timestamp AT TIME ZONE v_tz) END AS qd,
           CASE WHEN ro.data_entrega IS NOT NULL THEN 'data_oc' ELSE 'sem_data' END AS fonte,
           'revenda' AS org, -r.q AS q, NULL::text AS por, ro.numero AS oc_ref, r.mod_ref, r.cad AS rid, NULL::text AS det
      FROM rev0 r
      LEFT JOIN rev_oc ro ON ro.modelo = r.modelo
  ),
  sai_pt AS (  -- [urg r11c] baixa da PECA TESTE (ledger estoque_peca_teste_baixas, familia 'insumo'): 1 linha por registro, bucket
               -- (tamanho, cor_id) da propria linha. baixa = saida negativa; estorno = entrada positiva (q = -quantidade). mod_ref =
               -- REF/nome do card VIVO (tentativa -> modelo) senao NULL; det = rotulo; quem = users.nome do created_by.
    SELECT b.tamanho AS tam, b.cor_id AS cor, b.created_at AS qd, 'registro' AS fonte, b.origem AS org,
           -b.quantidade AS q, u.nome::text AS por, NULL::text AS oc_ref,
           COALESCE(NULLIF(btrim(m.ref), ''), m.nome)::text AS mod_ref, b.id AS rid, NULLIF(btrim(b.rotulo), '') AS det
      FROM public.estoque_peca_teste_baixas b
      LEFT JOIN public.users u ON u.id = b.created_by
      LEFT JOIN public.modelo_peca_teste_tentativas pt ON pt.id = b.tentativa_id
      LEFT JOIN public.modelos m ON m.id = pt.modelo_id AND m.tenant_id = _tenant
     WHERE b.tenant_id = _tenant AND b.familia = 'insumo' AND b.etiqueta_id = _etiqueta_id
       AND EXISTS (SELECT 1 FROM etq)
  ),
  mov AS (
    SELECT * FROM ent UNION ALL SELECT * FROM sai_cad UNION ALL SELECT * FROM sai_rev UNION ALL SELECT * FROM sai_pt
  )
  SELECT NULL::uuid, cr.tam, mov.cor, cr.cnome::text,
         mov.qd, mov.fonte, CASE WHEN mov.q > 0 THEN 'entrada' ELSE 'saida' END, mov.org, mov.q,
         mov.por, mov.oc_ref, mov.mod_ref, mov.rid, mov.det,
         cr.rec, cr.bx, cr.fis
    FROM mov
    LEFT JOIN public.cores co ON co.id = mov.cor
    JOIN cr ON cr.tam IS NOT DISTINCT FROM mov.tam AND cr.cnome IS NOT DISTINCT FROM co.nome
   WHERE mov.q <> 0
   ORDER BY cr.tam NULLS FIRST, cr.cnome NULLS FIRST, mov.qd NULLS FIRST, (mov.q < 0), mov.oc_ref, mov.rid;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_modelo_espelho_categoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- P-137 A (R1): coluna a coluna — cada uma so vai ao produto quando ELA mudou no card nesta escrita.
  -- P-145 A (R3b): NULL do card nunca e copiado (categoria nem subs).
  v_cat boolean := OLD.categoria_principal_id IS DISTINCT FROM NEW.categoria_principal_id;
  v_s1 boolean := NEW.subcategoria1_id IS NOT NULL AND OLD.subcategoria1_id IS DISTINCT FROM NEW.subcategoria1_id;
  v_s2 boolean := NEW.subcategoria2_id IS NOT NULL AND OLD.subcategoria2_id IS DISTINCT FROM NEW.subcategoria2_id;
  v_grupo uuid;
  r record;
  v_g uuid;
  v_c uuid;
  v_n1 uuid;
  v_n2 uuid;
BEGIN
  -- Card sem categoria (passo intermediario da troca de grupo no Sheet): o produto fica como esta.
  IF NEW.categoria_principal_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- P-143 A: o grupo vem da categoria nova. Categoria sem grupo (ou de outra loja) -> nao copia nada (R3a).
  SELECT c.grupo_id INTO v_grupo
    FROM public.categorias_produto c
   WHERE c.id = NEW.categoria_principal_id AND c.tenant_id = NEW.tenant_id;
  IF v_grupo IS NULL OR NOT (v_cat OR v_s1 OR v_s2) THEN
    RETURN NULL;
  END IF;

  -- Cada produto espelho (1:1 por gatilho, nao por UNIQUE — por isso o laco cobre todas as linhas) travado FOR UPDATE:
  -- serializa com um INSERT de OC concorrente (a FK dele pede KEY SHARE nesta linha).
  FOR r IN
    SELECT 'produtos_acabados'::text AS tabela, pa.id, pa.grupo_id, pa.categoria_id, pa.subcategoria1_id AS s1, pa.subcategoria2_id AS s2
      FROM public.produtos_acabados pa
     WHERE NEW.origem = 'revenda' AND pa.modelo_id = NEW.id AND pa.tenant_id = NEW.tenant_id
       FOR UPDATE
  LOOP
    -- P-142 B: produto com pedido nao troca entre Acessorios e outro grupo (grade UN x grade por tamanho).
    IF v_cat AND r.grupo_id IS DISTINCT FROM v_grupo
       AND public._grupo_eh_acessorio(r.grupo_id) IS DISTINCT FROM public._grupo_eh_acessorio(v_grupo)
       AND (EXISTS (SELECT 1 FROM public.ocs_p_acabado_itens o WHERE r.tabela = 'produtos_acabados' AND o.produto_acabado_id = r.id)
         OR EXISTS (SELECT 1 FROM public.ocs_importado_itens o WHERE r.tabela = 'produtos_importados' AND o.produto_importado_id = r.id)) THEN  -- [r13] pedido = item
      RAISE EXCEPTION 'categoria_acessorio_com_pedido: produto com pedido nao pode trocar entre Acessorios e outro grupo pela Categoria do card'
        USING ERRCODE = 'P0001';
    END IF;
    v_g := CASE WHEN v_cat THEN v_grupo ELSE r.grupo_id END;
    v_c := CASE WHEN v_cat THEN NEW.categoria_principal_id ELSE r.categoria_id END;
    -- Sub (H1/M1 do G-migration): a sub do card vai ao produto quando mudou E pertence ao contexto certo — junto com a
    -- categoria copiada, ou (troca SO da sub) quando o produto ja esta na MESMA categoria do card (senao seria sub de
    -- outra categoria). Categoria copiada e sub do card vazia: a sub do produto fica SE ainda pertence a categoria
    -- nova; se nao pertence, e limpa (nunca sub orfa de outra categoria).
    v_n1 := CASE
      WHEN v_s1 AND (v_cat OR r.categoria_id = NEW.categoria_principal_id) THEN NEW.subcategoria1_id
      WHEN v_cat AND r.s1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.subcategorias1_produto s
                                                      WHERE s.id = r.s1 AND s.categoria_id = NEW.categoria_principal_id) THEN NULL
      ELSE r.s1 END;
    v_n2 := CASE
      WHEN v_s2 AND (v_cat OR r.categoria_id = NEW.categoria_principal_id) THEN NEW.subcategoria2_id
      WHEN v_cat AND r.s2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.subcategorias2_produto s
                                                      WHERE s.id = r.s2 AND s.categoria_id = NEW.categoria_principal_id) THEN NULL
      ELSE r.s2 END;
    IF (v_g, v_c, v_n1, v_n2) IS DISTINCT FROM (r.grupo_id, r.categoria_id, r.s1, r.s2) THEN
      UPDATE public.produtos_acabados
         SET grupo_id = v_g, categoria_id = v_c, subcategoria1_id = v_n1, subcategoria2_id = v_n2, updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;

  FOR r IN
    SELECT 'produtos_importados'::text AS tabela, pi.id, pi.grupo_id, pi.categoria_id, pi.subcategoria1_id AS s1, pi.subcategoria2_id AS s2
      FROM public.produtos_importados pi
     WHERE NEW.origem = 'importado' AND pi.modelo_id = NEW.id AND pi.tenant_id = NEW.tenant_id
       FOR UPDATE
  LOOP
    -- P-142 B: produto com pedido nao troca entre Acessorios e outro grupo (grade UN x grade por tamanho).
    IF v_cat AND r.grupo_id IS DISTINCT FROM v_grupo
       AND public._grupo_eh_acessorio(r.grupo_id) IS DISTINCT FROM public._grupo_eh_acessorio(v_grupo)
       AND (EXISTS (SELECT 1 FROM public.ocs_p_acabado_itens o WHERE r.tabela = 'produtos_acabados' AND o.produto_acabado_id = r.id)
         OR EXISTS (SELECT 1 FROM public.ocs_importado_itens o WHERE r.tabela = 'produtos_importados' AND o.produto_importado_id = r.id)) THEN  -- [r13] pedido = item
      RAISE EXCEPTION 'categoria_acessorio_com_pedido: produto com pedido nao pode trocar entre Acessorios e outro grupo pela Categoria do card'
        USING ERRCODE = 'P0001';
    END IF;
    v_g := CASE WHEN v_cat THEN v_grupo ELSE r.grupo_id END;
    v_c := CASE WHEN v_cat THEN NEW.categoria_principal_id ELSE r.categoria_id END;
    -- Sub (H1/M1 do G-migration): a sub do card vai ao produto quando mudou E pertence ao contexto certo — junto com a
    -- categoria copiada, ou (troca SO da sub) quando o produto ja esta na MESMA categoria do card (senao seria sub de
    -- outra categoria). Categoria copiada e sub do card vazia: a sub do produto fica SE ainda pertence a categoria
    -- nova; se nao pertence, e limpa (nunca sub orfa de outra categoria).
    v_n1 := CASE
      WHEN v_s1 AND (v_cat OR r.categoria_id = NEW.categoria_principal_id) THEN NEW.subcategoria1_id
      WHEN v_cat AND r.s1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.subcategorias1_produto s
                                                      WHERE s.id = r.s1 AND s.categoria_id = NEW.categoria_principal_id) THEN NULL
      ELSE r.s1 END;
    v_n2 := CASE
      WHEN v_s2 AND (v_cat OR r.categoria_id = NEW.categoria_principal_id) THEN NEW.subcategoria2_id
      WHEN v_cat AND r.s2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.subcategorias2_produto s
                                                      WHERE s.id = r.s2 AND s.categoria_id = NEW.categoria_principal_id) THEN NULL
      ELSE r.s2 END;
    IF (v_g, v_c, v_n1, v_n2) IS DISTINCT FROM (r.grupo_id, r.categoria_id, r.s1, r.s2) THEN
      UPDATE public.produtos_importados
         SET grupo_id = v_g, categoria_id = v_c, subcategoria1_id = v_n1, subcategoria2_id = v_n2, updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;
  RETURN NULL;
END
$function$;

-- ============================ Passo 7c (T3 PI): applier dos derivados + RPCs novas de Produto Importado ============================
-- Emitido DEPOIS da copia (Passo 5/6) e do bloco 35 (PA), ANTES das redefinicoes T3 (que incluem o cambio/landed por item).
-- Padrao de sempre (invariante 9): wrapper (login -> modulo -> _seg_exige_pagina antes de qualquer busca) + _core REVOKE dos 3.
-- Mensagens 5xx (P0001/P0002/P0409) em ASCII. Ordem unica de travas: cabecalho FOR UPDATE + rev -> produtos FOR UPDATE ORDER BY id -> itens.
-- Moeda/cotacoes/etapas sao do cabecalho (OC inteira, do 1o produto); qtd/valor/peso/transporte/desconto/grade/landed sao POR ITEM.

-- Applier: recalcula os derivados do cabecalho a partir dos itens (Σ + status + data_entrega + grupo/categoria + landed) num
-- UNICO UPDATE. O cambio/landed por item ja foi gravado por _imp_recalcular_landed_real_oc ANTES; aqui so consolida o cabecalho.
CREATE OR REPLACE FUNCTION public._oci_aplicar_derivados(_oc_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE d jsonb;
BEGIN
  d := public._oci_cabecalho_derivados(_oc_id);
  UPDATE public.ocs_importado SET
    qtd_total = coalesce((d->>'qtd_total')::int, 0),
    valor_bruto = coalesce((d->>'valor_bruto')::numeric, 0),
    valor_total_desconto = coalesce((d->>'valor_total_desconto')::numeric, 0),
    valor_unitario_real = CASE WHEN coalesce((d->>'qtd_total')::int, 0) > 0
                               THEN round(coalesce((d->>'valor_total_desconto')::numeric, 0) / (d->>'qtd_total')::int, 2) ELSE 0 END,
    status = coalesce(d->>'status', 'encomendado'),
    data_entrega = nullif(d->>'data_entrega','')::date,
    grupo_id = nullif(d->>'grupo_id','')::uuid,
    categoria_id = nullif(d->>'categoria_id','')::uuid,
    custo_unitario_landed_real = coalesce((d->>'custo_unitario_landed_real')::numeric, 0),
    updated_at = now()
  WHERE id = _oc_id;
END $fn$;
REVOKE EXECUTE ON FUNCTION public._oci_aplicar_derivados(uuid) FROM PUBLIC, anon, authenticated;

-- Copia as etapas do 1o produto para a OC (ocs_importado_etapas) — mesma logica do _salvar_oc_importado_core com _etapas vazio.
CREATE OR REPLACE FUNCTION public._oci_copiar_etapas_do_produto(_tenant uuid, _oc_id uuid, _produto_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  DELETE FROM public.ocs_importado_etapas WHERE oc_importado_id = _oc_id;
  INSERT INTO public.ocs_importado_etapas (tenant_id, oc_importado_id, ordem, rotulo, base, percentual, data_vencimento, cotacao)
  SELECT _tenant, _oc_id, coalesce(e.ordem,0), nullif(e.rotulo,''), coalesce(nullif(e.base,''),'mercadoria'),
         coalesce(e.percentual,0), e.data_vencimento, coalesce(e.cotacao,0)
    FROM public.produto_importado_etapas e
   WHERE e.produto_importado_id = _produto_id;
END $fn$;
REVOKE EXECUTE ON FUNCTION public._oci_copiar_etapas_do_produto(uuid,uuid,uuid) FROM PUBLIC, anon, authenticated;

-- ── fazer_pedido_importado: cria TODAS as OCs numa transacao (tudo-ou-nada), 1 por pedido do assistente ──
-- Agrupamento (do front) separa por (empresa, representante, moeda_compra, moeda_intermediaria). Cada pedido ja e um grupo.
CREATE OR REPLACE FUNCTION public._fazer_pedido_importado_core(_pedidos jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_out jsonb := '[]'::jsonb;
  ped jsonb;
  v_prod_ids uuid[];
  v_empresa uuid;
  v_rep uuid;
  v_moeda_compra text;
  v_moeda_inter text;
  v_sig text;
  v_numero text;
  v_oc_id uuid;
  v_itens_sigla jsonb;
  v_primeiro uuid;
  pid uuid;
  v_item jsonb;
  v_ordem int;
  v_mot text[];
  v_prod record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant' USING ERRCODE = '42501';
  END IF;
  IF _pedidos IS NULL OR jsonb_typeof(_pedidos) <> 'array' THEN RETURN v_out; END IF;

  FOR ped IN SELECT jsonb_array_elements(_pedidos) LOOP
    SELECT array_agg(x::uuid) INTO v_prod_ids FROM jsonb_array_elements_text(coalesce(ped->'produto_ids','[]'::jsonb)) x;
    IF v_prod_ids IS NULL OR array_length(v_prod_ids, 1) IS NULL THEN CONTINUE; END IF;
    v_empresa := nullif(ped->>'empresa_id','')::uuid;
    v_rep := nullif(ped->>'representante_id','')::uuid;
    v_moeda_compra := coalesce(nullif(ped->>'moeda_compra',''), 'RMB');
    v_moeda_inter := nullif(ped->>'moeda_intermediaria','');

    -- (1) produtos FOR UPDATE ORDER BY id (ordem unica de travas; fecha o pedido simultaneo do mesmo produto)
    FOR v_prod IN
      SELECT * FROM public.produtos_importados WHERE id = ANY(v_prod_ids) AND tenant_id = v_tenant ORDER BY id FOR UPDATE
    LOOP NULL; END LOOP;

    -- (2) cada produto: existe na loja? motivos? fornecedor == do pedido? MOEDA == a do pedido?
    FOREACH pid IN ARRAY v_prod_ids LOOP
      SELECT * INTO v_prod FROM public.produtos_importados WHERE id = pid AND tenant_id = v_tenant;
      IF NOT FOUND THEN RAISE EXCEPTION 'nao_encontrado: produto' USING ERRCODE = 'P0002'; END IF;
      v_mot := public._oc_produto_motivos('pi', pid);
      IF array_length(v_mot, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'pedido_recusado: %: %', v_prod.nome, array_to_string(v_mot, ', ') USING ERRCODE = 'P0001';
      END IF;
      IF v_prod.empresa_id IS DISTINCT FROM v_empresa THEN
        RAISE EXCEPTION 'fornecedor_diferente: % nao e do fornecedor do pedido', v_prod.nome USING ERRCODE = 'P0001';
      END IF;
      IF coalesce(v_prod.moeda_compra,'RMB') IS DISTINCT FROM v_moeda_compra
         OR nullif(v_prod.moeda_intermediaria,'') IS DISTINCT FROM v_moeda_inter THEN
        RAISE EXCEPTION 'moeda_diferente: % tem moeda diferente da do pedido', v_prod.nome USING ERRCODE = 'P0001';
      END IF;
    END LOOP;

    -- (3) sigla do lote + (4) numero (helper com advisory lock por loja)
    SELECT coalesce(jsonb_agg(jsonb_build_object('grupo_id', pi.grupo_id, 'categoria_id', pi.categoria_id) ORDER BY pi.id), '[]'::jsonb)
      INTO v_itens_sigla FROM public.produtos_importados pi WHERE pi.id = ANY(v_prod_ids) AND pi.tenant_id = v_tenant;
    v_sig := public._oc_lote_sigla(v_empresa, v_itens_sigla);
    v_numero := public._oc_numero_proximo('ocs_importado', v_tenant, v_sig);

    -- 1o produto (menor id, = ordem dos travados): fonte das cotacoes + cronograma do cabecalho
    SELECT id INTO v_primeiro FROM public.produtos_importados WHERE id = ANY(v_prod_ids) AND tenant_id = v_tenant ORDER BY id LIMIT 1;
    SELECT * INTO v_prod FROM public.produtos_importados WHERE id = v_primeiro;

    -- (5) INSERT do cabecalho (numero ja calculado => fn_oc_importado_numero nao recalcula; produto_importado_id NULL = LEGADO)
    --     moeda/cotacoes do 1o produto; qtd/valores/landed derivados ficam 0 ate o applier.
    INSERT INTO public.ocs_importado (
      tenant_id, numero, nome_produto, empresa_id, representante_id,
      data_pedido, data_prevista, moeda_compra, moeda_intermediaria, cotacao_ref, cotacao_final,
      qtd_total, valor_bruto, valor_total_desconto, valor_unitario_real, custo_unitario_landed_real
    ) VALUES (
      v_tenant, v_numero, NULL, v_empresa, v_rep,
      coalesce(nullif(ped->>'data_pedido','')::date, current_date), nullif(ped->>'data_prevista','')::date,
      v_moeda_compra, v_moeda_inter,
      coalesce(v_prod.cotacao_ref, 0), coalesce(v_prod.cotacao_final, 0),
      0, 0, 0, 0, 0
    ) RETURNING id INTO v_oc_id;

    -- cronograma do 1o produto -> ocs_importado_etapas
    PERFORM public._oci_copiar_etapas_do_produto(v_tenant, v_oc_id, v_primeiro);

    -- (6) INSERT dos itens (um por produto, na ordem dos ids travados)
    v_ordem := 0;
    FOR pid IN SELECT unnest(v_prod_ids) ORDER BY 1 LOOP
      v_ordem := v_ordem + 1;
      v_item := public._oci_item_de_produto(v_tenant, pid);
      INSERT INTO public.ocs_importado_itens (
        tenant_id, oc_id, ordem, produto_importado_id, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
        ref_fornecedor, composicao, grade_proporcao, grade_detalhe, variantes, qtd_total, valor_unitario_m1, peso_kg, transporte_m2,
        desconto_pct, valor_bruto, valor_total_desconto, valor_unitario_real, custo_unitario_landed_real)
      VALUES (
        v_tenant, v_oc_id, v_ordem, pid, v_item->>'nome_produto', nullif(v_item->>'grupo_id','')::uuid, nullif(v_item->>'categoria_id','')::uuid,
        nullif(v_item->>'subcategoria1_id','')::uuid, nullif(v_item->>'subcategoria2_id','')::uuid,
        v_item->>'ref_fornecedor', v_item->>'composicao', coalesce(v_item->'grade_proporcao','{}'::jsonb),
        coalesce(v_item->'grade_detalhe','{}'::jsonb), coalesce(v_item->'variantes','[]'::jsonb),
        coalesce((v_item->>'qtd_total')::int, 0), coalesce((v_item->>'valor_unitario_m1')::numeric, 0),
        coalesce((v_item->>'peso_kg')::numeric, 0), coalesce((v_item->>'transporte_m2')::numeric, 0),
        coalesce((v_item->>'desconto_pct')::numeric, 0), coalesce((v_item->>'valor_bruto')::numeric, 0),
        coalesce((v_item->>'valor_total_desconto')::numeric, 0), coalesce((v_item->>'valor_unitario_real')::numeric, 0), 0);
    END LOOP;

    -- cambio/landed por item + derivados do cabecalho + parcelas EXPLICITAS (o gatilho escuta colunas legadas que nao mudam aqui)
    PERFORM public._imp_recalcular_landed_real_oc(v_oc_id);
    PERFORM public._oci_aplicar_derivados(v_oc_id);
    PERFORM public._gerar_parcelas_importado(v_oc_id);

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'oc_id', v_oc_id, 'numero', v_numero, 'produto_ids', to_jsonb(v_prod_ids)));
  END LOOP;

  RETURN v_out;
END $fn$;
REVOKE EXECUTE ON FUNCTION public._fazer_pedido_importado_core(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fazer_pedido_importado(_pedidos jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.tenant_module_enabled('produto_importado') THEN
    RAISE EXCEPTION 'Módulo Produto Importado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('entrada_oc_p_importado', 'criacao_produto_importado');
  RETURN public._fazer_pedido_importado_core(_pedidos);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.fazer_pedido_importado(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fazer_pedido_importado(jsonb) TO authenticated;

-- ── salvar_oc_importado_itens: estado completo, diff por id (invariante 3, IDs preservados) + etapas (estado completo) ──
CREATE OR REPLACE FUNCTION public._salvar_oc_importado_itens_core(_id uuid, _dados jsonb, _itens jsonb, _etapas jsonb, _rev_base integer DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_oc_id uuid;
  v_rev int;
  v_oc_status text;
  it jsonb;
  v_item_id uuid;
  v_ids_mantidos uuid[] := ARRAY[]::uuid[];
  v_ordem int := 0;
  v_prod_id uuid;
  v_montado jsonb;
  v_mot text[];
  v_empresa uuid;
  v_atual record;
  v_bruto numeric; v_vtd numeric; v_vur numeric;
  v_qtd int; v_vu numeric; v_dp numeric; v_peso numeric; v_tr numeric;
  v_soma_pedida numeric; v_tem_neg boolean;
  v_sig text;
  v_etapas jsonb; rec jsonb; v_soma_merc numeric; v_soma_frete numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant' USING ERRCODE = '42501';
  END IF;

  IF _id IS NULL THEN
    -- OC avulsa nova: numero pelo helper; cabecalho em branco (produtos vem nos itens; moeda/cotacoes vem em _dados).
    v_empresa := nullif(_dados->>'empresa_id','')::uuid;
    v_sig := public._oc_lote_sigla(v_empresa, '[]'::jsonb);
    INSERT INTO public.ocs_importado (
      tenant_id, numero, nome_produto, empresa_id, representante_id, data_pedido, data_prevista, data_nota_entrada,
      anexo_pedido_url, moeda_compra, moeda_intermediaria, cotacao_ref, cotacao_final,
      qtd_total, valor_bruto, valor_total_desconto, valor_unitario_real, custo_unitario_landed_real
    ) VALUES (
      v_tenant, public._oc_numero_proximo('ocs_importado', v_tenant, v_sig), NULL, v_empresa, nullif(_dados->>'representante_id','')::uuid,
      coalesce(nullif(_dados->>'data_pedido','')::date, current_date), nullif(_dados->>'data_prevista','')::date,
      nullif(_dados->>'data_nota_entrada','')::date, _dados->>'anexo_pedido_url',
      coalesce(nullif(_dados->>'moeda_compra',''), 'RMB'), nullif(_dados->>'moeda_intermediaria',''),
      coalesce(nullif(_dados->>'cotacao_ref','')::numeric, 0), coalesce(nullif(_dados->>'cotacao_final','')::numeric, 0),
      0, 0, 0, 0, 0
    ) RETURNING id INTO v_oc_id;
  ELSE
    SELECT rev, status INTO v_rev, v_oc_status FROM public.ocs_importado WHERE id = _id AND tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'nao_encontrado: oc' USING ERRCODE = 'P0002'; END IF;
    IF _rev_base IS NOT NULL AND v_rev IS DISTINCT FROM _rev_base THEN
      RAISE EXCEPTION 'conflito_versao: o registro foi salvo por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
    v_oc_id := _id;
    UPDATE public.ocs_importado SET
      empresa_id = nullif(_dados->>'empresa_id','')::uuid,
      representante_id = nullif(_dados->>'representante_id','')::uuid,
      data_pedido = coalesce(nullif(_dados->>'data_pedido','')::date, data_pedido),
      data_prevista = nullif(_dados->>'data_prevista','')::date,
      anexo_pedido_url = _dados->>'anexo_pedido_url',
      -- moeda/cotacoes sao do cabecalho (OC inteira): so sobrescreve quando a chave vem em _dados (chave ausente = mantem).
      moeda_compra = CASE WHEN _dados ? 'moeda_compra' THEN coalesce(nullif(_dados->>'moeda_compra',''), moeda_compra) ELSE moeda_compra END,
      moeda_intermediaria = CASE WHEN _dados ? 'moeda_intermediaria' THEN nullif(_dados->>'moeda_intermediaria','') ELSE moeda_intermediaria END,
      cotacao_ref = CASE WHEN _dados ? 'cotacao_ref' THEN coalesce(nullif(_dados->>'cotacao_ref','')::numeric, 0) ELSE cotacao_ref END,
      cotacao_final = CASE WHEN _dados ? 'cotacao_final' THEN coalesce(nullif(_dados->>'cotacao_final','')::numeric, 0) ELSE cotacao_final END,
      data_nota_entrada = CASE WHEN _dados ? 'data_nota_entrada' THEN nullif(_dados->>'data_nota_entrada','')::date ELSE data_nota_entrada END,
      updated_at = now()
    WHERE id = v_oc_id;
  END IF;

  SELECT empresa_id INTO v_empresa FROM public.ocs_importado WHERE id = v_oc_id;

  -- Evita colisao do UNIQUE(oc_id, ordem) ao renumerar na ordem do payload (faixa alta antes do loop; igual PA).
  UPDATE public.ocs_importado_itens SET ordem = ordem + 1000000 WHERE oc_id = v_oc_id;

  -- diff por id: percorre os itens enviados (estado completo)
  FOR it IN SELECT jsonb_array_elements(coalesce(_itens, '[]'::jsonb)) LOOP
    v_ordem := v_ordem + 1;
    v_item_id := nullif(it->>'id','')::uuid;

    IF v_item_id IS NOT NULL THEN
      SELECT status, valor_unitario_m1, desconto_pct, qtd_total, grade_detalhe, produto_importado_id
        INTO v_atual FROM public.ocs_importado_itens WHERE id = v_item_id AND oc_id = v_oc_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'nao_encontrado: item' USING ERRCODE = 'P0002'; END IF;

      v_prod_id := coalesce(nullif(it->>'produto_importado_id','')::uuid, v_atual.produto_importado_id);
      v_qtd := coalesce(nullif(it->>'qtd_total','')::int, 0);
      v_vu := coalesce(nullif(it->>'valor_unitario_m1','')::numeric, 0);
      v_dp := coalesce(nullif(it->>'desconto_pct','')::numeric, 0);
      v_peso := coalesce(nullif(it->>'peso_kg','')::numeric, 0);
      v_tr := coalesce(nullif(it->>'transporte_m2','')::numeric, 0);

      IF v_atual.status = 'recebido' THEN
        IF v_vu IS DISTINCT FROM v_atual.valor_unitario_m1 OR v_dp IS DISTINCT FROM v_atual.desconto_pct
           OR v_qtd IS DISTINCT FROM v_atual.qtd_total
           OR public._pa_grade_pedida_only(coalesce(it->'grade_detalhe','{}'::jsonb)) IS DISTINCT FROM public._pa_grade_pedida_only(v_atual.grade_detalhe) THEN
          raise exception 'Item recebido - desfaca o recebimento para alterar valores.' using errcode = 'P0001';
        END IF;
      END IF;

      SELECT coalesce(bool_or(coalesce(nullif(t.value->>'pedida','')::numeric,0) < 0
             or coalesce(nullif(t.value->>'recebida','')::numeric,0) < 0 or coalesce(nullif(t.value->>'defeito','')::numeric,0) < 0), false),
             coalesce(sum(coalesce(nullif(t.value->>'pedida','')::numeric,0)),0)
        INTO v_tem_neg, v_soma_pedida
        FROM jsonb_each(coalesce(it->'grade_detalhe','{}'::jsonb)) o CROSS JOIN LATERAL jsonb_each(o.value) t;
      IF v_tem_neg THEN raise exception 'As quantidades da grade nao podem ser negativas.' using errcode = 'P0001'; END IF;
      IF v_qtd > 0 AND v_soma_pedida <> v_qtd THEN
        raise exception 'A soma da grade pedida (%) difere da quantidade total (%)', v_soma_pedida, v_qtd using errcode = 'P0001';
      END IF;

      v_bruto := round(v_qtd * v_vu, 2);
      v_vtd := round(v_bruto * (1 - v_dp / 100.0), 2);
      v_vur := CASE WHEN v_qtd > 0 THEN round(v_vtd / v_qtd, 2) ELSE 0 END;

      UPDATE public.ocs_importado_itens SET
        ordem = v_ordem,
        produto_importado_id = v_prod_id,
        nome_produto = coalesce(nullif(it->>'nome_produto',''), nome_produto),
        grupo_id = nullif(it->>'grupo_id','')::uuid,
        categoria_id = nullif(it->>'categoria_id','')::uuid,
        subcategoria1_id = nullif(it->>'subcategoria1_id','')::uuid,
        subcategoria2_id = nullif(it->>'subcategoria2_id','')::uuid,
        ref_fornecedor = it->>'ref_fornecedor',
        composicao = it->>'composicao',
        grade_proporcao = coalesce(it->'grade_proporcao','{}'::jsonb),
        grade_detalhe = coalesce(it->'grade_detalhe','{}'::jsonb),
        variantes = coalesce(it->'variantes','[]'::jsonb),
        qtd_total = v_qtd, valor_unitario_m1 = v_vu, desconto_pct = v_dp, peso_kg = v_peso, transporte_m2 = v_tr,
        valor_bruto = v_bruto, valor_total_desconto = v_vtd, valor_unitario_real = v_vur,
        updated_at = now()
      WHERE id = v_item_id AND oc_id = v_oc_id;
      v_ids_mantidos := v_ids_mantidos || v_item_id;

    ELSIF coalesce((it->>'do_produto')::boolean, false) AND nullif(it->>'produto_importado_id','') IS NOT NULL THEN
      v_prod_id := (it->>'produto_importado_id')::uuid;
      SELECT status INTO v_oc_status FROM public.ocs_importado WHERE id = v_oc_id;
      IF v_oc_status = 'recebido' THEN
        RAISE EXCEPTION 'oc_recebida_nao_adiciona: OC recebida nao aceita produtos novos' USING ERRCODE = 'P0001';
      END IF;
      PERFORM 1 FROM public.produtos_importados WHERE id = v_prod_id AND tenant_id = v_tenant FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'nao_encontrado: produto' USING ERRCODE = 'P0002'; END IF;
      IF v_empresa IS DISTINCT FROM (SELECT empresa_id FROM public.produtos_importados WHERE id = v_prod_id) THEN
        RAISE EXCEPTION 'fornecedor_diferente: o produto e de outro fornecedor' USING ERRCODE = 'P0001';
      END IF;
      IF coalesce((SELECT moeda_compra FROM public.produtos_importados WHERE id = v_prod_id),'RMB')
           IS DISTINCT FROM (SELECT coalesce(moeda_compra,'RMB') FROM public.ocs_importado WHERE id = v_oc_id)
         OR nullif((SELECT moeda_intermediaria FROM public.produtos_importados WHERE id = v_prod_id),'')
           IS DISTINCT FROM (SELECT nullif(moeda_intermediaria,'') FROM public.ocs_importado WHERE id = v_oc_id) THEN
        RAISE EXCEPTION 'moeda_diferente: o produto tem moeda diferente da OC' USING ERRCODE = 'P0001';
      END IF;
      v_mot := public._oc_produto_motivos('pi', v_prod_id);
      IF array_length(v_mot, 1) IS NOT NULL THEN
        RAISE EXCEPTION 'pedido_recusado: %: %', (SELECT nome FROM public.produtos_importados WHERE id = v_prod_id),
          array_to_string(v_mot, ', ') USING ERRCODE = 'P0001';
      END IF;
      v_montado := public._oci_item_de_produto(v_tenant, v_prod_id);
      INSERT INTO public.ocs_importado_itens (
        tenant_id, oc_id, ordem, produto_importado_id, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
        ref_fornecedor, composicao, grade_proporcao, grade_detalhe, variantes, qtd_total, valor_unitario_m1, peso_kg, transporte_m2,
        desconto_pct, valor_bruto, valor_total_desconto, valor_unitario_real, custo_unitario_landed_real)
      VALUES (
        v_tenant, v_oc_id, v_ordem, v_prod_id, v_montado->>'nome_produto', nullif(v_montado->>'grupo_id','')::uuid, nullif(v_montado->>'categoria_id','')::uuid,
        nullif(v_montado->>'subcategoria1_id','')::uuid, nullif(v_montado->>'subcategoria2_id','')::uuid,
        v_montado->>'ref_fornecedor', v_montado->>'composicao', coalesce(v_montado->'grade_proporcao','{}'::jsonb),
        coalesce(v_montado->'grade_detalhe','{}'::jsonb), coalesce(v_montado->'variantes','[]'::jsonb),
        coalesce((v_montado->>'qtd_total')::int, 0), coalesce((v_montado->>'valor_unitario_m1')::numeric, 0),
        coalesce((v_montado->>'peso_kg')::numeric, 0), coalesce((v_montado->>'transporte_m2')::numeric, 0),
        coalesce((v_montado->>'desconto_pct')::numeric, 0), coalesce((v_montado->>'valor_bruto')::numeric, 0),
        coalesce((v_montado->>'valor_total_desconto')::numeric, 0), coalesce((v_montado->>'valor_unitario_real')::numeric, 0), 0)
      RETURNING id INTO v_item_id;
      v_ids_mantidos := v_ids_mantidos || v_item_id;

    ELSE
      -- item avulso digitado (sem id, sem do_produto)
      v_qtd := coalesce(nullif(it->>'qtd_total','')::int, 0);
      v_vu := coalesce(nullif(it->>'valor_unitario_m1','')::numeric, 0);
      v_dp := coalesce(nullif(it->>'desconto_pct','')::numeric, 0);
      v_peso := coalesce(nullif(it->>'peso_kg','')::numeric, 0);
      v_tr := coalesce(nullif(it->>'transporte_m2','')::numeric, 0);
      v_bruto := round(v_qtd * v_vu, 2); v_vtd := round(v_bruto * (1 - v_dp / 100.0), 2);
      v_vur := CASE WHEN v_qtd > 0 THEN round(v_vtd / v_qtd, 2) ELSE 0 END;
      INSERT INTO public.ocs_importado_itens (
        tenant_id, oc_id, ordem, produto_importado_id, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
        ref_fornecedor, composicao, grade_proporcao, grade_detalhe, variantes, qtd_total, valor_unitario_m1, peso_kg, transporte_m2,
        desconto_pct, valor_bruto, valor_total_desconto, valor_unitario_real, custo_unitario_landed_real)
      VALUES (
        v_tenant, v_oc_id, v_ordem, nullif(it->>'produto_importado_id','')::uuid, coalesce(nullif(it->>'nome_produto',''), ''),
        nullif(it->>'grupo_id','')::uuid, nullif(it->>'categoria_id','')::uuid, nullif(it->>'subcategoria1_id','')::uuid,
        nullif(it->>'subcategoria2_id','')::uuid, it->>'ref_fornecedor', it->>'composicao', coalesce(it->'grade_proporcao','{}'::jsonb),
        coalesce(it->'grade_detalhe','{}'::jsonb), coalesce(it->'variantes','[]'::jsonb), v_qtd, v_vu, v_peso, v_tr, v_dp, v_bruto, v_vtd, v_vur, 0)
      RETURNING id INTO v_item_id;
      v_ids_mantidos := v_ids_mantidos || v_item_id;
    END IF;
  END LOOP;

  -- itens AUSENTES = tirar. Item recebido nao sai; lista final vazia com itens no servidor recusa.
  IF EXISTS (SELECT 1 FROM public.ocs_importado_itens WHERE oc_id = v_oc_id AND status = 'recebido'
             AND NOT (id = ANY(v_ids_mantidos))) THEN
    RAISE EXCEPTION 'item_recebido_nao_sai: ha produto recebido que nao pode ser tirado' USING ERRCODE = 'P0001';
  END IF;
  IF array_length(v_ids_mantidos, 1) IS NULL AND EXISTS (SELECT 1 FROM public.ocs_importado_itens WHERE oc_id = v_oc_id) THEN
    RAISE EXCEPTION 'oc_sem_produtos: exclua a OC' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.ocs_importado_itens WHERE oc_id = v_oc_id AND NOT (id = ANY(v_ids_mantidos));

  -- Etapas: estado completo (delete+reinsere), como _salvar_oc_importado_core. Σ%=100 por base (quando ha etapa daquela base);
  -- etapa de mercadoria com % > 0 e cotacao <= 0 recusa (so quando ha valor de compra = ha item com valor_unitario_m1 > 0).
  IF _etapas IS NOT NULL THEN
    v_etapas := coalesce(_etapas, '[]'::jsonb);
    SELECT coalesce(sum((e->>'percentual')::numeric),0) INTO v_soma_merc
      FROM jsonb_array_elements(v_etapas) e WHERE e->>'base' = 'mercadoria';
    SELECT coalesce(sum((e->>'percentual')::numeric),0) INTO v_soma_frete
      FROM jsonb_array_elements(v_etapas) e WHERE e->>'base' = 'frete';
    IF exists(select 1 from jsonb_array_elements(v_etapas) e where e->>'base'='mercadoria') AND round(v_soma_merc,2) <> 100 THEN
      RAISE EXCEPTION 'A soma das etapas de mercadoria (%) precisa fechar 100%%.', round(v_soma_merc,2) USING ERRCODE = 'P0001';
    END IF;
    IF exists(select 1 from jsonb_array_elements(v_etapas) e where e->>'base'='frete') AND round(v_soma_frete,2) <> 100 THEN
      RAISE EXCEPTION 'A soma das etapas de frete (%) precisa fechar 100%%.', round(v_soma_frete,2) USING ERRCODE = 'P0001';
    END IF;
    IF exists(select 1 from public.ocs_importado_itens where oc_id = v_oc_id and coalesce(valor_unitario_m1,0) > 0)
       AND exists(select 1 from jsonb_array_elements(v_etapas) e
                  where coalesce(nullif(e->>'base',''),'mercadoria') = 'mercadoria'
                    and coalesce(nullif(e->>'percentual','')::numeric, 0) > 0
                    and coalesce(nullif(e->>'cotacao','')::numeric, 0) <= 0) THEN
      RAISE EXCEPTION 'Informe a cotacao da etapa de mercadoria (percentual maior que zero e cotacao zerada).' USING ERRCODE = 'P0001';
    END IF;
    DELETE FROM public.ocs_importado_etapas WHERE oc_importado_id = v_oc_id;
    FOR rec IN SELECT * FROM jsonb_array_elements(v_etapas) LOOP
      INSERT INTO public.ocs_importado_etapas (tenant_id, oc_importado_id, ordem, rotulo, base, percentual, data_vencimento, cotacao)
      VALUES (v_tenant, v_oc_id, coalesce((rec->>'ordem')::int,0), nullif(rec->>'rotulo',''),
        coalesce(nullif(rec->>'base',''),'mercadoria'), coalesce((rec->>'percentual')::numeric,0),
        nullif(rec->>'data_vencimento','')::date, coalesce((rec->>'cotacao')::numeric,0));
    END LOOP;
  END IF;

  -- cambio/landed por item + UPDATE unico do cabecalho + parcelas EXPLICITAS (idempotente; o gatilho nao escuta estas colunas).
  PERFORM public._imp_recalcular_landed_real_oc(v_oc_id);
  PERFORM public._oci_aplicar_derivados(v_oc_id);
  PERFORM public._gerar_parcelas_importado(v_oc_id);

  RETURN v_oc_id;
END $fn$;
REVOKE EXECUTE ON FUNCTION public._salvar_oc_importado_itens_core(uuid,jsonb,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.salvar_oc_importado_itens(_id uuid, _dados jsonb, _itens jsonb, _etapas jsonb, _rev_base integer DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.tenant_module_enabled('produto_importado') THEN
    RAISE EXCEPTION 'Módulo Produto Importado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('entrada_oc_p_importado', 'criacao_produto_importado');
  RETURN public._salvar_oc_importado_itens_core(_id, _dados, _itens, _etapas, _rev_base);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.salvar_oc_importado_itens(uuid,jsonb,jsonb,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_oc_importado_itens(uuid,jsonb,jsonb,jsonb,integer) TO authenticated;

-- ── receber_item_oc_importado: salva pendencias (via o _core do salvar) e recebe o item + landed por item ──
CREATE OR REPLACE FUNCTION public._receber_item_oc_importado_core(_oc_id uuid, _item_id uuid, _dados jsonb, _itens jsonb, _etapas jsonb, _rev_base integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  v_item record;
  v_produto record;
  v_cad_id uuid;
  v_grade_final jsonb;
  rec record; tam_rec record;
  v_var_grade jsonb; v_planejadas jsonb; v_reais jsonb;
  v_tot_plan int; v_tot_real int; v_grand_total int := 0;
  v_pedida numeric; v_recebida numeric; v_defeito numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant' USING ERRCODE = '42501';
  END IF;

  -- 1) salva as pendencias (estado completo da OC + etapas) ANTES de receber — atomico; "CRITICAL" da inv.1 garantido pela txn.
  PERFORM public._salvar_oc_importado_itens_core(_oc_id, _dados, _itens, _etapas, _rev_base);

  -- 2) recebe o item
  SELECT * INTO v_item FROM public.ocs_importado_itens WHERE id = _item_id AND oc_id = _oc_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'nao_encontrado: item' USING ERRCODE = 'P0002'; END IF;
  IF v_item.produto_importado_id IS NULL THEN
    RAISE EXCEPTION 'Crie o card no Planejamento antes de receber.' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_produto FROM public.produtos_importados WHERE id = v_item.produto_importado_id AND tenant_id = v_tenant;
  IF NOT FOUND OR v_produto.modelo_id IS NULL THEN
    RAISE EXCEPTION 'Crie o card no Planejamento antes de receber.' USING ERRCODE = 'P0001';
  END IF;

  v_grade_final := coalesce(v_item.grade_detalhe, '{}'::jsonb);

  UPDATE public.ocs_importado_itens SET
    data_entrega = nullif(_dados->>'item_data_entrega','')::date,
    nota_fiscal = _dados->>'item_nota_fiscal',
    responsavel_recebimento_id = nullif(_dados->>'item_responsavel_recebimento_id','')::uuid,
    devolucao = _dados->>'item_devolucao',
    revisao = _dados->>'item_revisao',
    status = 'recebido',
    updated_at = now()
  WHERE id = _item_id;

  -- upsert cad BARE (1 por modelo)
  SELECT id INTO v_cad_id FROM public.cad WHERE modelo_id = v_produto.modelo_id AND tenant_id = v_tenant;
  IF v_cad_id IS NULL THEN
    INSERT INTO public.cad (tenant_id, modelo_id) VALUES (v_tenant, v_produto.modelo_id) RETURNING id INTO v_cad_id;
  END IF;

  -- cad_grades por variante: planejada = pedida; real = max(0, recebida-defeito)
  FOR rec IN SELECT ordem FROM public.produto_importado_variantes WHERE produto_importado_id = v_produto.id ORDER BY ordem LOOP
    v_var_grade := coalesce(v_grade_final -> rec.ordem::text, '{}'::jsonb);
    v_planejadas := '{}'::jsonb; v_reais := '{}'::jsonb; v_tot_plan := 0; v_tot_real := 0;
    FOR tam_rec IN SELECT key, value FROM jsonb_each(v_var_grade) LOOP
      v_pedida := coalesce(nullif(tam_rec.value->>'pedida','')::numeric, 0);
      v_recebida := coalesce(nullif(tam_rec.value->>'recebida','')::numeric, 0);
      v_defeito := coalesce(nullif(tam_rec.value->>'defeito','')::numeric, 0);
      v_planejadas := v_planejadas || jsonb_build_object(tam_rec.key, v_pedida::int);
      v_reais := v_reais || jsonb_build_object(tam_rec.key, greatest(0, v_recebida - v_defeito)::int);
      v_tot_plan := v_tot_plan + v_pedida::int;
      v_tot_real := v_tot_real + greatest(0, v_recebida - v_defeito)::int;
    END LOOP;
    INSERT INTO public.cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
    VALUES (v_cad_id, rec.ordem, v_planejadas, v_reais, v_tot_plan, v_tot_real)
    ON CONFLICT (cad_id, variante_numero) DO UPDATE SET
      grades_planejadas = excluded.grades_planejadas, grades_reais = excluded.grades_reais,
      grade_total_planejada = excluded.grade_total_planejada, grade_total_real = excluded.grade_total_real;
    v_grand_total := v_grand_total + v_tot_real;
  END LOOP;

  -- cad_etiquetas com os helpers da R1 (insumo por tamanho); idempotente
  DELETE FROM public.cad_etiquetas WHERE cad_id = v_cad_id;
  INSERT INTO public.cad_etiquetas (cad_id, etiqueta_id, cor_id, consumo, quantidade_planejada, quantidade_enviar)
  SELECT v_cad_id, me.etiqueta_id, me.cor_id, me.consumo,
         round(coalesce(me.consumo,0) * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(v_cad_id, true), v_grand_total), 2),
         round(coalesce(me.consumo,0) * public._insumo_pecas(public._insumo_tamanho_de(me.etiqueta_id), public._grade_mapa_cad(v_cad_id, true), v_grand_total), 2)
  FROM public.modelo_etiquetas me WHERE me.modelo_id = v_produto.modelo_id;

  -- CQ pendente so se nao existir
  IF NOT EXISTS (SELECT 1 FROM public.controle_qualidade WHERE cad_id = v_cad_id) THEN
    INSERT INTO public.controle_qualidade (cad_id, tenant_id, status) VALUES (v_cad_id, v_tenant, 'pendente');
  END IF;

  PERFORM public._imp_recomputar_precos_modelo(v_produto.id);

  -- cambio/landed por item (chegou custo real) + status do cabecalho derivado + data_entrega = max; outros itens intocados.
  PERFORM public._imp_recalcular_landed_real_oc(_oc_id);
  PERFORM public._oci_aplicar_derivados(_oc_id);

  RETURN jsonb_build_object('cad_id', v_cad_id, 'item_id', _item_id, 'total_real', v_grand_total);
END $fn$;
REVOKE EXECUTE ON FUNCTION public._receber_item_oc_importado_core(uuid,uuid,jsonb,jsonb,jsonb,integer) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.receber_item_oc_importado(_oc_id uuid, _item_id uuid, _dados jsonb, _itens jsonb, _etapas jsonb, _rev_base integer DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.tenant_module_enabled('produto_importado') THEN
    RAISE EXCEPTION 'Módulo Produto Importado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._exige_modulos('criacao', 'producao');
  PERFORM public._seg_exige_pagina('entrada_oc_p_importado');
  RETURN public._receber_item_oc_importado_core(_oc_id, _item_id, _dados, _itens, _etapas, _rev_base);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.receber_item_oc_importado(uuid,uuid,jsonb,jsonb,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.receber_item_oc_importado(uuid,uuid,jsonb,jsonb,jsonb,integer) TO authenticated;

-- ── vincular_oc_importado (NOVO, P-363): semantica a/b/c do _vincular_oc_p_acabado_core + checagem de MOEDA ──
CREATE OR REPLACE FUNCTION public._vincular_oc_importado_core(_oc_id uuid, _produto_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid; v_ok boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'nao_autenticado' USING ERRCODE = '42501'; END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant' USING ERRCODE = '42501';
  END IF;

  -- trava: cabecalho -> produto (ordem unica). O produto agora e um ITEM (ocs_importado_itens).
  PERFORM 1 FROM public.ocs_importado WHERE id = _oc_id AND tenant_id = v_tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'nao_encontrado: oc' USING ERRCODE = 'P0002'; END IF;

  IF _produto_id IS NULL THEN
    -- (c) DESVINCULAR: OC de 1 item -> item.produto = NULL (legado). 2+ itens -> recusa.
    DECLARE v_n int; v_item uuid;
    BEGIN
      SELECT count(*) INTO v_n FROM public.ocs_importado_itens WHERE oc_id = _oc_id;
      IF v_n >= 2 THEN
        RAISE EXCEPTION 'oc_varios_produtos: abra a OC para tirar o produto' USING ERRCODE = 'P0001';
      END IF;
      SELECT id INTO v_item FROM public.ocs_importado_itens WHERE oc_id = _oc_id LIMIT 1;
      IF v_item IS NOT NULL THEN
        UPDATE public.ocs_importado_itens SET produto_importado_id = NULL, updated_at = now() WHERE id = v_item;
      END IF;
    END;
    RETURN;
  END IF;

  SELECT exists(SELECT 1 FROM public.produtos_importados WHERE id = _produto_id AND tenant_id = v_tenant FOR UPDATE) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'nao_encontrado: produto' USING ERRCODE = 'P0002'; END IF;

  DECLARE
    v_oc record; v_n int; v_item uuid; v_vu numeric; v_dp numeric; v_peso numeric; v_tr numeric; v_item_jsonb jsonb;
  BEGIN
    SELECT empresa_id, status, numero, coalesce(moeda_compra,'RMB') AS moeda_compra, nullif(moeda_intermediaria,'') AS moeda_inter
      INTO v_oc FROM public.ocs_importado WHERE id = _oc_id;
    SELECT count(*) INTO v_n FROM public.ocs_importado_itens WHERE oc_id = _oc_id;

    IF v_n = 1 THEN
      SELECT id INTO v_item FROM public.ocs_importado_itens WHERE oc_id = _oc_id AND produto_importado_id IS NULL LIMIT 1;
    END IF;

    IF v_item IS NOT NULL THEN
      -- (a) VINCULAR item avulso legado: o unico item (sem produto) recebe o produto; o produto herda valor/peso/transporte/desconto do item.
      SELECT valor_unitario_m1, desconto_pct, peso_kg, transporte_m2 INTO v_vu, v_dp, v_peso, v_tr
        FROM public.ocs_importado_itens WHERE id = v_item;
      UPDATE public.ocs_importado_itens SET produto_importado_id = _produto_id, updated_at = now() WHERE id = v_item;
      UPDATE public.produtos_importados SET valor_unitario_m1 = coalesce(v_vu,0), desconto_pct = coalesce(v_dp,0),
        peso_kg = coalesce(v_peso,0), transporte_m2 = coalesce(v_tr,0), updated_at = now()
        WHERE id = _produto_id AND tenant_id = v_tenant;
    ELSE
      -- (b) ADICIONAR o produto como item NOVO. OC encomendada + mesmo fornecedor + MESMA MOEDA + passa pelos motivos.
      IF v_oc.status = 'recebido' THEN
        RAISE EXCEPTION 'oc_recebida_nao_adiciona: OC recebida nao aceita produtos novos' USING ERRCODE = 'P0001';
      END IF;
      IF v_oc.empresa_id IS DISTINCT FROM (SELECT empresa_id FROM public.produtos_importados WHERE id = _produto_id) THEN
        RAISE EXCEPTION 'fornecedor_diferente: o produto e de outro fornecedor' USING ERRCODE = 'P0001';
      END IF;
      IF v_oc.moeda_compra IS DISTINCT FROM coalesce((SELECT moeda_compra FROM public.produtos_importados WHERE id = _produto_id),'RMB')
         OR v_oc.moeda_inter IS DISTINCT FROM nullif((SELECT moeda_intermediaria FROM public.produtos_importados WHERE id = _produto_id),'') THEN
        RAISE EXCEPTION 'moeda_diferente: o produto tem moeda diferente da OC' USING ERRCODE = 'P0001';
      END IF;
      DECLARE v_mot text[]; BEGIN
        v_mot := public._oc_produto_motivos('pi', _produto_id);
        IF array_length(v_mot, 1) IS NOT NULL THEN
          RAISE EXCEPTION 'pedido_recusado: %: %', (SELECT nome FROM public.produtos_importados WHERE id = _produto_id),
            array_to_string(v_mot, ', ') USING ERRCODE = 'P0001';
        END IF;
      END;
      v_item_jsonb := public._oci_item_de_produto(v_tenant, _produto_id);
      INSERT INTO public.ocs_importado_itens (
        tenant_id, oc_id, ordem, produto_importado_id, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
        ref_fornecedor, composicao, grade_proporcao, grade_detalhe, variantes, qtd_total, valor_unitario_m1, peso_kg, transporte_m2,
        desconto_pct, valor_bruto, valor_total_desconto, valor_unitario_real, custo_unitario_landed_real)
      VALUES (
        v_tenant, _oc_id, coalesce((SELECT max(ordem) FROM public.ocs_importado_itens WHERE oc_id = _oc_id), 0) + 1,
        _produto_id, v_item_jsonb->>'nome_produto', nullif(v_item_jsonb->>'grupo_id','')::uuid, nullif(v_item_jsonb->>'categoria_id','')::uuid,
        nullif(v_item_jsonb->>'subcategoria1_id','')::uuid, nullif(v_item_jsonb->>'subcategoria2_id','')::uuid,
        v_item_jsonb->>'ref_fornecedor', v_item_jsonb->>'composicao', coalesce(v_item_jsonb->'grade_proporcao','{}'::jsonb),
        coalesce(v_item_jsonb->'grade_detalhe','{}'::jsonb), coalesce(v_item_jsonb->'variantes','[]'::jsonb),
        coalesce((v_item_jsonb->>'qtd_total')::int, 0), coalesce((v_item_jsonb->>'valor_unitario_m1')::numeric, 0),
        coalesce((v_item_jsonb->>'peso_kg')::numeric, 0), coalesce((v_item_jsonb->>'transporte_m2')::numeric, 0),
        coalesce((v_item_jsonb->>'desconto_pct')::numeric, 0), coalesce((v_item_jsonb->>'valor_bruto')::numeric, 0),
        coalesce((v_item_jsonb->>'valor_total_desconto')::numeric, 0), coalesce((v_item_jsonb->>'valor_unitario_real')::numeric, 0), 0);
    END IF;

    -- cambio/landed por item + UPDATE unico do cabecalho + parcelas (idempotente).
    PERFORM public._imp_recalcular_landed_real_oc(_oc_id);
    PERFORM public._oci_aplicar_derivados(_oc_id);
    PERFORM public._gerar_parcelas_importado(_oc_id);
    PERFORM public._imp_recomputar_precos_modelo(_produto_id);
  END;
END $fn$;
REVOKE EXECUTE ON FUNCTION public._vincular_oc_importado_core(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.vincular_oc_importado(_oc_id uuid, _produto_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT public.tenant_module_enabled('produto_importado') THEN
    RAISE EXCEPTION 'Módulo Produto Importado não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('entrada_oc_p_importado', 'criacao_produto_importado');
  PERFORM public._vincular_oc_importado_core(_oc_id, _produto_id);
END $fn$;
REVOKE EXECUTE ON FUNCTION public.vincular_oc_importado(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vincular_oc_importado(uuid,uuid) TO authenticated;

-- ===== funcoes redefinidas T3 (geradas por troca exata sobre o vivo; md5 em mig/md5-r13.txt) =====

CREATE OR REPLACE FUNCTION public._salvar_oc_importado_core(_id uuid, _dados jsonb, _grade jsonb, _etapas jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_qtd_total int;
  v_valor_unitario_m1 numeric;
  v_desconto_pct numeric;
  v_bruto numeric;
  v_total_desc numeric;
  v_unit_real numeric;
  v_soma_pedida numeric := 0;
  v_tem_negativo boolean := false;
  v_produto_id uuid;
  v_etapas jsonb;
  v_soma_merc numeric;
  v_soma_frete numeric;
  rec jsonb;
  -- Estado atual da OC (só preenchido quando _id is not null) — guarda de congelamento.
  v_atual_status text;
  v_atual_valor_unitario_m1 numeric;
  v_atual_desconto_pct numeric;
  v_atual_qtd_total int;
  v_atual_grade jsonb;
begin
  -- [r13] escritor antigo de 1 produto por cabecalho: o produto agora mora em ocs_importado_itens (salvar_oc_importado_itens).
  -- Recusa: site velho + banco novo nao grava nada errado. Mensagem ASCII (P0001 = 400).
  raise exception 'versao_antiga: recarregue a pagina' using errcode = 'P0001';
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  -- trava otimista (Fase 3) — P0409 se outra pessoa salvou no meio. _rev_base null = bypass.
  if _rev_base is not null then
    declare v_rev int;
    begin
      select rev into v_rev from public.ocs_importado
        where id = _id and tenant_id = v_tenant for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;

  v_nome := nullif(_dados->>'nome_produto', '');
  if _id is null then
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
  else
    select status, valor_unitario_m1, desconto_pct, qtd_total, grade_detalhe, produto_importado_id
      into v_atual_status, v_atual_valor_unitario_m1, v_atual_desconto_pct, v_atual_qtd_total, v_atual_grade, v_produto_id
      from public.ocs_importado where id = _id and tenant_id = v_tenant;
    if not found then
      raise exception 'OC não encontrada';
    end if;
  end if;

  v_qtd_total := coalesce(nullif(_dados->>'qtd_total', '')::int, 0);
  v_valor_unitario_m1 := coalesce(nullif(_dados->>'valor_unitario_m1', '')::numeric, 0);
  v_desconto_pct := coalesce(nullif(_dados->>'desconto_pct', '')::numeric, 0);

  -- Congela ao receber: valor/qtd pedida e a grade "pedida" não mudam mais por este
  -- caminho (recebida/defeito seguem editáveis via receber_oc_importado). NF/revisão/
  -- devolução/anexos/nome/categorias/fornecedor/datas seguem editáveis normalmente.
  if _id is not null and v_atual_status = 'recebido' then
    if v_valor_unitario_m1 is distinct from v_atual_valor_unitario_m1
       or v_desconto_pct is distinct from v_atual_desconto_pct
       or v_qtd_total is distinct from v_atual_qtd_total
       or public._pa_grade_pedida_only(_grade) is distinct from public._pa_grade_pedida_only(v_atual_grade)
    then
      raise exception 'OC recebida — desfaça o recebimento para alterar valores.' using errcode = 'P0001';
    end if;
  end if;

  -- Valida células (nenhuma negativa) e soma da grade "pedida" contra qtd_total.
  select
    coalesce(bool_or(
      coalesce(nullif(t.value->>'pedida', '')::numeric, 0) < 0
      or coalesce(nullif(t.value->>'recebida', '')::numeric, 0) < 0
      or coalesce(nullif(t.value->>'defeito', '')::numeric, 0) < 0
    ), false),
    coalesce(sum(coalesce(nullif(t.value->>'pedida', '')::numeric, 0)), 0)
  into v_tem_negativo, v_soma_pedida
  from jsonb_each(coalesce(_grade, '{}'::jsonb)) o
  cross join lateral jsonb_each(o.value) t;

  if v_tem_negativo then
    raise exception 'As quantidades da grade não podem ser negativas.' using errcode = 'P0001';
  end if;
  if v_qtd_total > 0 and v_soma_pedida <> v_qtd_total then
    raise exception 'A soma da grade pedida (%) difere da quantidade total (%)', v_soma_pedida, v_qtd_total
      using errcode = 'P0001';
  end if;

  -- Derivados (só exibição — o custo real é o landed, recalculado no final).
  v_bruto := v_qtd_total * v_valor_unitario_m1;
  v_total_desc := v_bruto * (1 - v_desconto_pct / 100);
  v_unit_real := case when v_qtd_total > 0 then v_total_desc / v_qtd_total else 0 end;

  if _id is null then
    v_produto_id := nullif(_dados->>'produto_importado_id', '')::uuid;
    if v_produto_id is not null then
      perform 1 from public.produtos_importados where id = v_produto_id and tenant_id = v_tenant;
      if not found then
        raise exception 'Produto não encontrado';
      end if;
    end if;

    insert into public.ocs_importado (
      tenant_id, produto_importado_id, numero, nome_produto, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      empresa_id, representante_id, ref_fornecedor, composicao,
      data_pedido, data_prevista, data_entrega,
      grade_proporcao, grade_detalhe, variantes,
      qtd_total, valor_bruto, valor_total_desconto, valor_unitario_real,
      nota_fiscal, responsavel_recebimento_id, devolucao, revisao,
      anexo_pedido_url, anexo_nf_url,
      moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2,
      desconto_pct, cotacao_final, data_nota_entrada
    ) values (
      v_tenant, v_produto_id, nullif(_dados->>'numero', ''), v_nome, nullif(_dados->>'grupo_id', '')::uuid, nullif(_dados->>'categoria_id', '')::uuid,
      nullif(_dados->>'subcategoria1_id', '')::uuid, nullif(_dados->>'subcategoria2_id', '')::uuid,
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(nullif(_dados->>'data_pedido', '')::date, current_date),
      nullif(_dados->>'data_prevista', '')::date, nullif(_dados->>'data_entrega', '')::date,
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), coalesce(_grade, '{}'::jsonb), coalesce(_dados->'variantes', '[]'::jsonb),
      v_qtd_total, v_bruto, v_total_desc, v_unit_real,
      _dados->>'nota_fiscal', nullif(_dados->>'responsavel_recebimento_id', '')::uuid, _dados->>'devolucao', _dados->>'revisao',
      _dados->>'anexo_pedido_url', _dados->>'anexo_nf_url',
      coalesce(nullif(_dados->>'moeda_compra', ''), 'RMB'), nullif(_dados->>'moeda_intermediaria', ''),
      v_valor_unitario_m1, coalesce(nullif(_dados->>'cotacao_ref', '')::numeric, 0),
      coalesce(nullif(_dados->>'peso_kg', '')::numeric, 0), coalesce(nullif(_dados->>'transporte_m2', '')::numeric, 0),
      v_desconto_pct, coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0), nullif(_dados->>'data_nota_entrada', '')::date
    ) returning id into v_id;

    -- "Fazer pedido": se _etapas não veio (vazio/null) e há produto vinculado, copia o
    -- cronograma do CARD (snapshot — a OC pode divergir depois). Se _etapas veio
    -- preenchido, usa ele (ramo comum abaixo).
    if (_etapas is null or jsonb_array_length(_etapas) = 0) and v_produto_id is not null then
      select coalesce(jsonb_agg(jsonb_build_object(
        'ordem', e.ordem, 'rotulo', e.rotulo, 'base', e.base,
        'percentual', e.percentual, 'data_vencimento', e.data_vencimento, 'cotacao', e.cotacao
      ) order by e.ordem), '[]'::jsonb)
      into v_etapas
      from public.produto_importado_etapas e
      where e.produto_importado_id = v_produto_id;
    else
      v_etapas := coalesce(_etapas, '[]'::jsonb);
    end if;
  else
    update public.ocs_importado set
      numero = coalesce(nullif(_dados->>'numero', ''), numero),
      nome_produto = coalesce(v_nome, nome_produto),
      grupo_id = nullif(_dados->>'grupo_id', '')::uuid,
      categoria_id = nullif(_dados->>'categoria_id', '')::uuid,
      subcategoria1_id = nullif(_dados->>'subcategoria1_id', '')::uuid,
      subcategoria2_id = nullif(_dados->>'subcategoria2_id', '')::uuid,
      empresa_id = nullif(_dados->>'empresa_id', '')::uuid,
      representante_id = nullif(_dados->>'representante_id', '')::uuid,
      ref_fornecedor = _dados->>'ref_fornecedor',
      composicao = _dados->>'composicao',
      data_pedido = coalesce(nullif(_dados->>'data_pedido', '')::date, data_pedido),
      data_prevista = nullif(_dados->>'data_prevista', '')::date,
      data_entrega = nullif(_dados->>'data_entrega', '')::date,
      grade_proporcao = coalesce(_dados->'grade_proporcao', '{}'::jsonb),
      grade_detalhe = coalesce(_grade, '{}'::jsonb),
      variantes = coalesce(_dados->'variantes', '[]'::jsonb),
      qtd_total = v_qtd_total,
      valor_bruto = v_bruto,
      valor_total_desconto = v_total_desc,
      valor_unitario_real = v_unit_real,
      nota_fiscal = _dados->>'nota_fiscal',
      responsavel_recebimento_id = nullif(_dados->>'responsavel_recebimento_id', '')::uuid,
      devolucao = _dados->>'devolucao',
      revisao = _dados->>'revisao',
      anexo_pedido_url = _dados->>'anexo_pedido_url',
      anexo_nf_url = _dados->>'anexo_nf_url',
      moeda_compra = coalesce(nullif(_dados->>'moeda_compra', ''), moeda_compra),
      moeda_intermediaria = nullif(_dados->>'moeda_intermediaria', ''),
      valor_unitario_m1 = v_valor_unitario_m1,
      cotacao_ref = coalesce(nullif(_dados->>'cotacao_ref', '')::numeric, 0),
      peso_kg = coalesce(nullif(_dados->>'peso_kg', '')::numeric, 0),
      transporte_m2 = coalesce(nullif(_dados->>'transporte_m2', '')::numeric, 0),
      desconto_pct = v_desconto_pct,
      cotacao_final = coalesce(nullif(_dados->>'cotacao_final', '')::numeric, 0),
      data_nota_entrada = CASE WHEN _dados ? 'data_nota_entrada' THEN NULLIF(_dados->>'data_nota_entrada', '')::date ELSE data_nota_entrada END,  -- chave ausente (front antigo) = mantém
      updated_at = now()
    where id = _id and tenant_id = v_tenant;
    v_id := _id;
    v_etapas := coalesce(_etapas, '[]'::jsonb);
  end if;

  -- Etapas: estado completo (delete+reinsere, como _salvar_produto_importado_core).
  -- Valida Σ%=100 por base (só quando há etapas daquela base).
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_merc
    from jsonb_array_elements(v_etapas) e where e->>'base' = 'mercadoria';
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_frete
    from jsonb_array_elements(v_etapas) e where e->>'base' = 'frete';
  if exists(select 1 from jsonb_array_elements(v_etapas) e where e->>'base'='mercadoria') and round(v_soma_merc,2) <> 100 then
    raise exception 'A soma das etapas de mercadoria (%) precisa fechar 100%%.', round(v_soma_merc,2) using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(v_etapas) e where e->>'base'='frete') and round(v_soma_frete,2) <> 100 then
    raise exception 'A soma das etapas de frete (%) precisa fechar 100%%.', round(v_soma_frete,2) using errcode = 'P0001';
  end if;
  -- [leves L8, P-207 A + Q1] etapa de MERCADORIA (base vazia = mercadoria) com % > 0 e cotacao <= 0 vira parcela 0 e
  -- _gerar_parcelas_importado a pula em silencio (fin #10): recusa - SO quando a compra tem valor (valor_unitario_m1 > 0;
  -- Q2). Mesma regra do card (_salvar_produto_importado_core) e da tela (erroCotacaoEtapas). Frete com 0 = identidade.
  if v_valor_unitario_m1 > 0 and exists(select 1 from jsonb_array_elements(v_etapas) e
             where coalesce(nullif(e->>'base',''),'mercadoria') = 'mercadoria'
               and coalesce(nullif(e->>'percentual','')::numeric, 0) > 0
               and coalesce(nullif(e->>'cotacao','')::numeric, 0) <= 0) then
    raise exception 'Informe a cotacao da etapa de mercadoria (percentual maior que zero e cotacao zerada).' using errcode = 'P0001';
  end if;

  delete from public.ocs_importado_etapas where oc_importado_id = v_id;
  for rec in select * from jsonb_array_elements(v_etapas) loop
    insert into public.ocs_importado_etapas (tenant_id, oc_importado_id, ordem, rotulo, base, percentual, data_vencimento, cotacao)
    values (v_tenant, v_id, coalesce((rec->>'ordem')::int,0), nullif(rec->>'rotulo',''),
      coalesce(nullif(rec->>'base',''),'mercadoria'), coalesce((rec->>'percentual')::numeric,0),
      nullif(rec->>'data_vencimento','')::date, coalesce((rec->>'cotacao')::numeric,0));
  end loop;

  perform public._imp_recalcular_landed_real_oc(v_id);
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public._receber_oc_importado_core(_oc_id uuid, _dados jsonb, _grade jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_oc record;
  v_produto record;
  v_cad_id uuid;
  v_grade_final jsonb;
  rec record;
  tam_rec record;
  v_var_grade jsonb;
  v_planejadas jsonb;
  v_reais jsonb;
  v_tot_plan int;
  v_tot_real int;
  v_grand_total int := 0;
  v_pedida numeric;
  v_recebida numeric;
  v_defeito numeric;
begin
  -- [r13] recebimento antigo por OC inteira: agora e POR ITEM (receber_item_oc_importado). Recusa (ASCII, P0001).
  raise exception 'versao_antiga: recarregue a pagina' using errcode = 'P0001';
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select * into v_oc from public.ocs_importado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'OC não encontrada';
  end if;

  if v_oc.produto_importado_id is null then
    raise exception 'Crie o card no Planejamento antes de receber — o recebimento alimenta CQ e Direcionamento.'
      using errcode = 'P0001';
  end if;

  select * into v_produto from public.produtos_importados
    where id = v_oc.produto_importado_id and tenant_id = v_tenant;
  if not found or v_produto.modelo_id is null then
    raise exception 'Crie o card no Planejamento antes de receber — o recebimento alimenta CQ e Direcionamento.'
      using errcode = 'P0001';
  end if;

  v_grade_final := coalesce(_grade, v_oc.grade_detalhe, '{}'::jsonb);

  update public.ocs_importado set
    data_entrega = nullif(_dados->>'data_entrega', '')::date,
    nota_fiscal = _dados->>'nota_fiscal',
    responsavel_recebimento_id = nullif(_dados->>'responsavel_recebimento_id', '')::uuid,
    devolucao = _dados->>'devolucao',
    revisao = _dados->>'revisao',
    grade_detalhe = v_grade_final,
    status = 'recebido',
    updated_at = now()
  where id = _oc_id;

  -- upsert cad (1 por modelo — trigger enforce_unique_fk('modelo_id') garante a
  -- invariante; aqui só evitamos o INSERT redundante quando já existe).
  select id into v_cad_id from public.cad where modelo_id = v_produto.modelo_id and tenant_id = v_tenant;
  if v_cad_id is null then
    insert into public.cad (tenant_id, modelo_id) values (v_tenant, v_produto.modelo_id)
      returning id into v_cad_id;
  end if;

  -- upsert cad_grades por variante: variante_numero = ordem; grades_planejadas = pedida
  -- por tamanho; grades_reais = max(0, recebida−defeito) por tamanho.
  for rec in
    select ordem from public.produto_importado_variantes
    where produto_importado_id = v_produto.id
    order by ordem
  loop
    v_var_grade := coalesce(v_grade_final -> rec.ordem::text, '{}'::jsonb);
    v_planejadas := '{}'::jsonb;
    v_reais := '{}'::jsonb;
    v_tot_plan := 0;
    v_tot_real := 0;

    for tam_rec in select key, value from jsonb_each(v_var_grade) loop
      v_pedida := coalesce(nullif(tam_rec.value->>'pedida', '')::numeric, 0);
      v_recebida := coalesce(nullif(tam_rec.value->>'recebida', '')::numeric, 0);
      v_defeito := coalesce(nullif(tam_rec.value->>'defeito', '')::numeric, 0);

      v_planejadas := v_planejadas || jsonb_build_object(tam_rec.key, v_pedida::int);
      v_reais := v_reais || jsonb_build_object(tam_rec.key, greatest(0, v_recebida - v_defeito)::int);
      v_tot_plan := v_tot_plan + v_pedida::int;
      v_tot_real := v_tot_real + greatest(0, v_recebida - v_defeito)::int;
    end loop;

    insert into public.cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real)
    values (v_cad_id, rec.ordem, v_planejadas, v_reais, v_tot_plan, v_tot_real)
    on conflict (cad_id, variante_numero) do update set
      grades_planejadas = excluded.grades_planejadas,
      grades_reais = excluded.grades_reais,
      grade_total_planejada = excluded.grade_total_planejada,
      grade_total_real = excluded.grade_total_real;

    v_grand_total := v_grand_total + v_tot_real;
  end loop;

  -- upsert controle_qualidade: mantém 'pendente' (default da coluna) se não existe;
  -- se já existe (inclusive 'confirmado'), NÃO toca — o cad_grades acima já regravou
  -- grades_reais e o trigger trg_rebaixa_direcionamento_grade (AFTER UPDATE OF
  -- grades_reais ON cad_grades) cuida da rebaixa do Direcionamento sozinho.
  if not exists (select 1 from public.controle_qualidade where cad_id = v_cad_id) then
    insert into public.controle_qualidade (cad_id, tenant_id, status) values (v_cad_id, v_tenant, 'pendente');
  end if;

  -- Custo real chegou — recalcula o landed real da OC a partir das etapas.
  perform public._imp_recalcular_landed_real_oc(_oc_id);

  return jsonb_build_object('cad_id', v_cad_id, 'total_real', v_grand_total);
end $function$;

CREATE OR REPLACE FUNCTION public._excluir_oc_importado_core(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select status into v_status from public.ocs_importado where id = _oc_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'nao_encontrado: oc' using errcode = 'P0002';
  end if;

  -- [r13] recusa se QUALQUER item foi recebido (o status do cabecalho e derivado = todos recebidos; um item recebido ja basta).
  if v_status = 'recebido'
     or exists (select 1 from public.ocs_importado_itens where oc_id = _oc_id and status = 'recebido') then
    raise exception 'Ha produto recebido na OC - estorne o recebimento antes de excluir.'
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.parcelas where oc_importado_id = _oc_id and status = 'pago') then
    raise exception 'Não é possível excluir: a OC tem parcela paga no financeiro.' using errcode = 'P0001';
  end if;

  -- Parcelas NÃO pagas somem via ON DELETE CASCADE (oc_importado_id); a paga já foi
  -- barrada acima. Etapas somem via ON DELETE CASCADE (ocs_importado_etapas.oc_importado_id).
  delete from public.ocs_importado where id = _oc_id and tenant_id = v_tenant;
end $function$;

CREATE OR REPLACE FUNCTION public._excluir_produto_importado_core(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_tenant uuid; v_modelo_id uuid; v_oc_id uuid; v_oc_numero text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  select modelo_id into v_modelo_id from public.produtos_importados where id = _produto_id and tenant_id = v_tenant;
  if not found then raise exception 'Produto não encontrado'; end if;
  -- [r13] o produto agora e um item; junta ao cabecalho para o numero.
  select o.id, o.numero into v_oc_id, v_oc_numero
    from public.ocs_importado_itens it join public.ocs_importado o on o.id = it.oc_id
    where it.produto_importado_id = _produto_id and o.tenant_id = v_tenant limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de excluir.', coalesce(v_oc_numero, 'sem número') using errcode = 'P0001';
  end if;
  delete from public.produtos_importados where id = _produto_id and tenant_id = v_tenant;
  -- o modelo espelho (se houver) vira modelo comum (modelo_id já é on delete set null); NÃO apaga.
end $function$;

CREATE OR REPLACE FUNCTION public._limpar_produto_importado_core(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_modelo_id uuid;
  v_oc_id uuid; v_oc_numero text;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select modelo_id into v_modelo_id from public.produtos_importados where id = _produto_id and tenant_id = v_tenant;
  if not found then raise exception 'nao_encontrado: produto' using errcode = 'P0002'; end if;
  if v_modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento — não pode ser limpo.' using errcode = 'P0001';
  end if;
  -- [r13] o produto agora e um item; junta ao cabecalho para o numero.
  select o.id, o.numero into v_oc_id, v_oc_numero
    from public.ocs_importado_itens it join public.ocs_importado o on o.id = it.oc_id
    where it.produto_importado_id = _produto_id and o.tenant_id = v_tenant limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de limpar.', coalesce(v_oc_numero, 'sem número') using errcode = 'P0001';
  end if;

  -- Zera escalares + câmbio; PRESERVA id/colecao_id/subcolecao/ref/mix_id/modelo_id(null).
  -- moeda_compra/intermediaria voltam ao DEFAULT do emptyDraft (RMB/USD) — mantém o banco COERENTE
  -- com o reset do front (que parte de emptyDraft) e respeita o NOT NULL de moeda_compra.
  update public.produtos_importados set
    nome = '',
    grupo_id = null, categoria_id = null, subcategoria1_id = null, subcategoria2_id = null,
    semana = null, empresa_id = null, representante_id = null,
    ref_fornecedor = null, composicao = null, foto_url = null,
    data_pedido = null, data_prevista = null, data_entrega = null,
    grade_proporcao = '{}'::jsonb, qtd_total = 0,
    moeda_compra = 'RMB', moeda_intermediaria = 'USD',
    valor_unitario_m1 = 0, cotacao_ref = 0, peso_kg = 0, transporte_m2 = 0,
    desconto_pct = 0, cotacao_final = 0, markup_atacado = null, markup_varejo = null,
    tamanho_tipo = null,  -- [tamanho-em v1]
    categoria_tecido_id = null, material_aviamento_id = null,  -- [i3 v1] (ruling do controlador)
    updated_at = now()
  where id = _produto_id and tenant_id = v_tenant;

  delete from public.produto_importado_variantes where produto_importado_id = _produto_id;
  delete from public.produto_importado_etapas where produto_importado_id = _produto_id;
end $function$;

CREATE OR REPLACE FUNCTION public._imp_etapas_brl_oc(_oc_id uuid)
 RETURNS TABLE(ordem integer, rotulo text, base text, data_vencimento date, valor_brl numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  o record;
  v_desc numeric;
  v_merc_liq_m1 numeric;
  v_frete_liq_m2 numeric;
  v_tem_etapa_frete boolean;
  v_prox_ordem int;
begin
  -- [r13] moeda/cotacoes/etapas sao do cabecalho (OC inteira); qtd/valor/peso/transporte/desconto sao POR ITEM. O SELECT abaixo
  -- da estrutura ao record o (cotacao_final/data_pedido vem dai); as colunas legadas valor_unitario_m1/peso/transporte/desconto
  -- do cabecalho NAO sao mais usadas (ficam no record mas ignoradas); as liquidas vem da SOMA por item. O GUARD e por Soma das
  -- pecas dos ITENS, NAO pelo cabecalho.qtd_total (derivado, pode estar stale quando o pedido ainda nao rodou o applier).
  select valor_unitario_m1, qtd_total, peso_kg, transporte_m2, desconto_pct, cotacao_final, data_pedido
    into o from public.ocs_importado where id = _oc_id;
  if not found then
    return;
  end if;
  -- as liquidas sao a SOMA por item (merc em M1, frete em M2); cada item tem seu proprio desconto. Com 1 item = identico ao de antes.
  select coalesce(sum(coalesce(it.qtd_total,0)), 0),
         coalesce(sum(coalesce(it.valor_unitario_m1,0) * coalesce(it.qtd_total,0) * (1 - coalesce(it.desconto_pct,0) / 100.0)), 0),
         coalesce(sum(coalesce(it.peso_kg,0) * coalesce(it.transporte_m2,0) * coalesce(it.qtd_total,0) * (1 - coalesce(it.desconto_pct,0) / 100.0)), 0)
    into o.qtd_total, v_merc_liq_m1, v_frete_liq_m2
    from public.ocs_importado_itens it where it.oc_id = _oc_id;
  if coalesce(o.qtd_total,0) <= 0 then
    return;
  end if;

  -- etapas reais
  return query
  select e.ordem, e.rotulo::text, e.base::text, e.data_vencimento,
    round(
      case
        when e.base = 'mercadoria' then
          case when coalesce(e.cotacao,0) > 0
            then (v_merc_liq_m1 * (coalesce(e.percentual,0)/100.0)) / e.cotacao
            else 0 end
        else -- frete: já em M2
          case when coalesce(e.cotacao,0) > 0 and e.cotacao <> 1
            then (v_frete_liq_m2 * (coalesce(e.percentual,0)/100.0)) / e.cotacao
            else (v_frete_liq_m2 * (coalesce(e.percentual,0)/100.0)) end
      end * coalesce(o.cotacao_final,0)
    , 2) as valor_brl
  from public.ocs_importado_etapas e
  where e.oc_importado_id = _oc_id
  order by e.ordem;

  -- Frete IMPLÍCITO: há frete mas nenhuma etapa de frete → emite 100% do frete (sem conversão,
  -- já em M2), espelhando o fallback do _imp_custo_landed. Vence na data do pedido.
  select exists(select 1 from public.ocs_importado_etapas ie where ie.oc_importado_id = _oc_id and ie.base = 'frete')
    into v_tem_etapa_frete;
  if not v_tem_etapa_frete and v_frete_liq_m2 > 0 then
    select coalesce(max(ie.ordem),0)+1 into v_prox_ordem from public.ocs_importado_etapas ie where ie.oc_importado_id = _oc_id;
    return query select v_prox_ordem, 'Frete'::text, 'frete'::text, o.data_pedido,
      round(v_frete_liq_m2 * coalesce(o.cotacao_final,0), 2);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public._imp_recalcular_landed_real_oc(_oc_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_qtd int; v_total_brl numeric;
  v_n_itens int; v_n_q int;
begin
  -- [r13] landed POR ITEM: cada etapa (base mercadoria|frete) e rateada pela fatia do item na base daquela etapa.
  --   base_item(merc)  = vu_m1 x q x (1-d/100);  base_item(frete) = peso x tr x q x (1-d/100)
  --   brl_item = Soma_etapa valor_brl x (base_item / base_total da etapa);  landed_item = round(brl_item / q_item, 4)
  --   base_total 0 numa etapa -> divisao IGUAL entre os itens com q>0 (nunca perde a parcela).
  -- O cabecalho continua round(Soma_brl / Soma_q, 4) (= igual a hoje; aplicado por _oci_aplicar_derivados / _oci_cabecalho_derivados).
  -- qtd = Soma das pecas dos ITENS (NAO o cabecalho ocs_importado.qtd_total, que e derivado e pode estar stale quando esta
  -- funcao roda ANTES do applier do cabecalho, ordem: INSERT itens -> recalcular landed -> aplicar derivados).
  select coalesce(sum(coalesce(qtd_total,0)),0) into v_qtd from public.ocs_importado_itens where oc_id = _oc_id;
  if coalesce(v_qtd,0) <= 0 then
    update public.ocs_importado set custo_unitario_landed_real = 0 where id = _oc_id;
    update public.ocs_importado_itens set custo_unitario_landed_real = 0 where oc_id = _oc_id;
    return;
  end if;

  select coalesce(sum(valor_brl),0) into v_total_brl from public._imp_etapas_brl_oc(_oc_id);
  select count(*), count(*) filter (where coalesce(qtd_total,0) > 0)
    into v_n_itens, v_n_q from public.ocs_importado_itens where oc_id = _oc_id;

  -- landed por item: percorre as etapas e rateia; grava em ocs_importado_itens.custo_unitario_landed_real.
  update public.ocs_importado_itens it set custo_unitario_landed_real = coalesce(x.landed, 0)
  from (
    select i.id,
           case when coalesce(i.qtd_total,0) > 0
                then round(coalesce(sum(
                  e.valor_brl * (
                    case when bt.base_total > 0 then (bi.base_item / bt.base_total)
                         -- base total 0 na etapa: divide igual entre os itens com q>0 (ou todos se nenhum tem q)
                         else (case when v_n_q > 0 then (case when coalesce(i.qtd_total,0) > 0 then 1.0 else 0 end) / v_n_q
                                    else 1.0 / greatest(v_n_itens,1) end) end)
                ), 0) / i.qtd_total, 4)
                else 0 end as landed
    from public.ocs_importado_itens i
    cross join lateral public._imp_etapas_brl_oc(_oc_id) e
    cross join lateral (
      select case when e.base = 'frete'
                  then coalesce(i.peso_kg,0) * coalesce(i.transporte_m2,0) * coalesce(i.qtd_total,0) * (1 - coalesce(i.desconto_pct,0)/100.0)
                  else coalesce(i.valor_unitario_m1,0) * coalesce(i.qtd_total,0) * (1 - coalesce(i.desconto_pct,0)/100.0) end as base_item
    ) bi
    cross join lateral (
      select coalesce(sum(
               case when e.base = 'frete'
                    then coalesce(j.peso_kg,0) * coalesce(j.transporte_m2,0) * coalesce(j.qtd_total,0) * (1 - coalesce(j.desconto_pct,0)/100.0)
                    else coalesce(j.valor_unitario_m1,0) * coalesce(j.qtd_total,0) * (1 - coalesce(j.desconto_pct,0)/100.0) end
             ), 0) as base_total
      from public.ocs_importado_itens j where j.oc_id = _oc_id
    ) bt
    where i.oc_id = _oc_id
    group by i.id, i.qtd_total
  ) x
  where it.id = x.id and it.oc_id = _oc_id;

  -- cabecalho = round(Soma_brl / Soma_q, 4) (igual a hoje).
  update public.ocs_importado
    set custo_unitario_landed_real = round(v_total_brl / v_qtd, 4)
    where id = _oc_id;
end $function$;

-- ============================ Passo 8: pos-condicoes (P0001 ASCII 'r13_pos:', desfaz tudo em caso de falha) ============================
DO $pos$
DECLARE
  n_cab int; n_item int; r record; v_h text; v_brl numeric; v_cnt int;
BEGIN
  -- (a) nº de itens = nº de cabecalhos, por familia
  SELECT count(*) INTO n_cab FROM public.ocs_p_acabado;
  SELECT count(*) INTO n_item FROM public.ocs_p_acabado_itens;
  IF n_item <> n_cab THEN RAISE EXCEPTION 'r13_pos: PA itens % != cabecalhos %', n_item, n_cab USING ERRCODE='P0001'; END IF;
  SELECT count(*) INTO n_cab FROM public.ocs_importado;
  SELECT count(*) INTO n_item FROM public.ocs_importado_itens;
  IF n_item <> n_cab THEN RAISE EXCEPTION 'r13_pos: PI itens % != cabecalhos %', n_item, n_cab USING ERRCODE='P0001'; END IF;

  -- (b) Σ qtd/valor dos itens = cabecalho (OC de 1 item: identico) + (c) status igual
  FOR r IN
    SELECT o.id, o.qtd_total oq, o.valor_bruto ob, o.valor_total_desconto ov, o.status os,
           it.qtd_total iq, it.valor_bruto ib, it.valor_total_desconto iv, it.status iis
      FROM public.ocs_p_acabado o JOIN public.ocs_p_acabado_itens it ON it.oc_id = o.id
  LOOP
    IF r.oq <> r.iq OR r.ob <> r.ib OR r.ov <> r.iv THEN
      RAISE EXCEPTION 'r13_pos: PA totais divergem na OC %', r.id USING ERRCODE='P0001';
    END IF;
    IF r.os <> r.iis THEN RAISE EXCEPTION 'r13_pos: PA status diverge na OC %', r.id USING ERRCODE='P0001'; END IF;
  END LOOP;
  FOR r IN
    SELECT o.id, o.qtd_total oq, o.valor_bruto ob, o.valor_total_desconto ov, o.status os,
           it.qtd_total iq, it.valor_bruto ib, it.valor_total_desconto iv, it.status iis
      FROM public.ocs_importado o JOIN public.ocs_importado_itens it ON it.oc_id = o.id
  LOOP
    IF r.oq <> r.iq OR r.ob <> r.ib OR r.ov <> r.iv THEN
      RAISE EXCEPTION 'r13_pos: PI totais divergem na OC %', r.id USING ERRCODE='P0001';
    END IF;
    IF r.os <> r.iis THEN RAISE EXCEPTION 'r13_pos: PI status diverge na OC %', r.id USING ERRCODE='P0001'; END IF;
  END LOOP;

  -- (d) ponteiros = 0
  SELECT count(*) INTO v_cnt FROM public.ocs_p_acabado WHERE produto_acabado_id IS NOT NULL;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'r13_pos: PA ainda tem % ponteiros', v_cnt USING ERRCODE='P0001'; END IF;
  SELECT count(*) INTO v_cnt FROM public.ocs_importado WHERE produto_importado_id IS NOT NULL;
  IF v_cnt <> 0 THEN RAISE EXCEPTION 'r13_pos: PI ainda tem % ponteiros', v_cnt USING ERRCODE='P0001'; END IF;

  -- (e) backup = nº de ponteiros ANTES (por familia)
  FOR r IN SELECT fam, n FROM _r13_ptr_antes LOOP
    SELECT count(*) INTO v_cnt FROM public._bkp_r13_oc_vinculo WHERE familia = r.fam;
    IF v_cnt <> r.n THEN RAISE EXCEPTION 'r13_pos: backup % tem % != ponteiros antes %', r.fam, v_cnt, r.n USING ERRCODE='P0001'; END IF;
  END LOOP;

  -- (f) _imp_etapas_brl_oc ≡ antes (por OC; md5 agregado)
  FOR r IN SELECT oc_id, h FROM _r13_imp_brl LOOP
    SELECT md5(coalesce((
             SELECT string_agg(
               e.ordem::text || '|' || coalesce(e.rotulo,'') || '|' || coalesce(e.base,'') || '|' ||
               coalesce(e.data_vencimento::text,'') || '|' || coalesce(e.valor_brl::text,''),
               ';' ORDER BY e.ordem, e.rotulo)
             FROM public._imp_etapas_brl_oc(r.oc_id) e), '')) INTO v_h;
    IF v_h IS DISTINCT FROM r.h THEN RAISE EXCEPTION 'r13_pos: _imp_etapas_brl_oc mudou na OC %', r.oc_id USING ERRCODE='P0001'; END IF;
  END LOOP;

  -- (g) md5 das parcelas ≡ antes (por familia)
  FOR r IN SELECT tipo_oc, h FROM _r13_parcelas_antes LOOP
    SELECT md5(coalesce(string_agg(
             id::text || '|' || coalesce(numero_parcela::text,'') || '|' || coalesce(valor::text,'') || '|' ||
             coalesce(data_vencimento::text,'') || '|' || coalesce(status,'') || '|' || coalesce(vencimento_manual::text,''),
             '' ORDER BY id), '')) INTO v_h
      FROM public.parcelas WHERE tipo_oc = r.tipo_oc;
    IF v_h IS DISTINCT FROM r.h THEN RAISE EXCEPTION 'r13_pos: parcelas % mudaram', r.tipo_oc USING ERRCODE='P0001'; END IF;
  END LOOP;

  -- (h) entradas do custo por produto comprado ≡ antes (status/valor_unitario_real/landed, agora LIDOS DO ITEM)
  FOR r IN SELECT fam, produto_id, status, vur, landed FROM _r13_custo_antes LOOP
    IF r.fam = 'pa' THEN
      SELECT it.status, it.valor_unitario_real::numeric, NULL::numeric INTO v_h, v_brl, v_cnt
        FROM public.ocs_p_acabado_itens it WHERE it.produto_acabado_id = r.produto_id LIMIT 1;
      IF v_h IS DISTINCT FROM r.status OR v_brl IS DISTINCT FROM r.vur THEN
        RAISE EXCEPTION 'r13_pos: custo PA mudou no produto %', r.produto_id USING ERRCODE='P0001';
      END IF;
    ELSE
      SELECT it.status, it.custo_unitario_landed_real::numeric INTO v_h, v_brl
        FROM public.ocs_importado_itens it WHERE it.produto_importado_id = r.produto_id LIMIT 1;
      IF v_h IS DISTINCT FROM r.status OR v_brl IS DISTINCT FROM r.landed THEN
        RAISE EXCEPTION 'r13_pos: custo PI mudou no produto %', r.produto_id USING ERRCODE='P0001';
      END IF;
    END IF;
  END LOOP;

  -- (i) gatilhos e ACL das tabelas novas
  FOR r IN SELECT unnest(ARRAY['trg_ocpa_item_tenant','trg_ocpa_item_produto_unico','trg_oci_item_tenant',
                               'trg_oci_item_produto_unico']) AS tg,
                  unnest(ARRAY['ocs_p_acabado_itens','ocs_p_acabado_itens','ocs_importado_itens','ocs_importado_itens']) AS tb
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                    WHERE c.relname = r.tb AND t.tgname = r.tg AND NOT t.tgisinternal) THEN
      RAISE EXCEPTION 'r13_pos: gatilho % ausente em %', r.tg, r.tb USING ERRCODE='P0001';
    END IF;
  END LOOP;
  -- authenticated SEM escrita nas 2 tabelas novas (SELECT ok); anon sem nada
  IF has_table_privilege('authenticated','public.ocs_p_acabado_itens','INSERT')
     OR has_table_privilege('authenticated','public.ocs_p_acabado_itens','UPDATE')
     OR has_table_privilege('authenticated','public.ocs_p_acabado_itens','DELETE')
     OR has_table_privilege('authenticated','public.ocs_importado_itens','INSERT')
     OR has_table_privilege('authenticated','public.ocs_importado_itens','UPDATE')
     OR has_table_privilege('authenticated','public.ocs_importado_itens','DELETE') THEN
    RAISE EXCEPTION 'r13_pos: authenticated ainda escreve em tabela de itens' USING ERRCODE='P0001';
  END IF;
  IF has_table_privilege('anon','public.ocs_p_acabado_itens','SELECT')
     OR has_table_privilege('anon','public.ocs_importado_itens','SELECT') THEN
    RAISE EXCEPTION 'r13_pos: anon ainda le tabela de itens' USING ERRCODE='P0001';
  END IF;

  -- (j) EXECUTE revogado dos 3 nos helpers/gatilhos novos
  FOR r IN SELECT unnest(ARRAY[
      'public.fn_oc_item_produto_unico()','public.fn_oc_item_tenant()',
      'public._oc_lote_sigla(uuid,jsonb)','public._oc_numero_proximo(text,uuid,text)',
      'public._ocpa_item_de_produto(uuid,uuid)','public._oci_item_de_produto(uuid,uuid)',
      'public._oc_produto_motivos(text,uuid)','public._ocpa_cabecalho_derivados(uuid)','public._oci_cabecalho_derivados(uuid)'
    ]) AS sig
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE') OR has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'r13_pos: % ainda executavel por anon/authenticated', r.sig USING ERRCODE='P0001';
    END IF;
  END LOOP;

  RAISE NOTICE 'r13_pos: OK (PA % / PI % OCs; identidade preservada)',
    (SELECT count(*) FROM public.ocs_p_acabado), (SELECT count(*) FROM public.ocs_importado);
END $pos$;

-- ============================ Passo 8b (T2): seguranca das RPCs novas de Produto Acabado ============================
DO $postdois$
DECLARE r record;
BEGIN
  -- (l) os 4 _core/helper novos da T2 revogados dos 3 (invariante 9)
  FOR r IN SELECT unnest(ARRAY[
      'public._ocpa_aplicar_derivados(uuid)',
      'public._fazer_pedido_p_acabado_core(jsonb)',
      'public._salvar_oc_p_acabado_itens_core(uuid,jsonb,jsonb,integer)',
      'public._receber_item_oc_p_acabado_core(uuid,uuid,jsonb,jsonb,integer)'
    ]) AS sig
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE') OR has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'r13_pos: % (core T2) ainda executavel por anon/authenticated', r.sig USING ERRCODE='P0001';
    END IF;
  END LOOP;
  -- (m) os 3 wrappers novos: EXECUTE para authenticated, NUNCA para anon
  FOR r IN SELECT unnest(ARRAY[
      'public.fazer_pedido_p_acabado(jsonb)',
      'public.salvar_oc_p_acabado_itens(uuid,jsonb,jsonb,integer)',
      'public.receber_item_oc_p_acabado(uuid,uuid,jsonb,jsonb,integer)'
    ]) AS sig
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'r13_pos: wrapper % executavel por anon', r.sig USING ERRCODE='P0001';
    END IF;
    IF NOT has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'r13_pos: wrapper % SEM EXECUTE para authenticated', r.sig USING ERRCODE='P0001';
    END IF;
  END LOOP;
END $postdois$;

-- ============================ Passo 8c (T3): seguranca das RPCs novas de Produto Importado ============================
DO $posttres$
DECLARE r record;
BEGIN
  -- (l) os _core/helper novos da T3 revogados dos 3 (invariante 9)
  FOR r IN SELECT unnest(ARRAY[
      'public._oci_aplicar_derivados(uuid)',
      'public._oci_copiar_etapas_do_produto(uuid,uuid,uuid)',
      'public._fazer_pedido_importado_core(jsonb)',
      'public._salvar_oc_importado_itens_core(uuid,jsonb,jsonb,jsonb,integer)',
      'public._receber_item_oc_importado_core(uuid,uuid,jsonb,jsonb,jsonb,integer)',
      'public._vincular_oc_importado_core(uuid,uuid)'
    ]) AS sig
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE') OR has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'r13_pos: % (core T3) ainda executavel por anon/authenticated', r.sig USING ERRCODE='P0001';
    END IF;
  END LOOP;
  -- (m) os 4 wrappers novos: EXECUTE para authenticated, NUNCA para anon
  FOR r IN SELECT unnest(ARRAY[
      'public.fazer_pedido_importado(jsonb)',
      'public.salvar_oc_importado_itens(uuid,jsonb,jsonb,jsonb,integer)',
      'public.receber_item_oc_importado(uuid,uuid,jsonb,jsonb,jsonb,integer)',
      'public.vincular_oc_importado(uuid,uuid)'
    ]) AS sig
  LOOP
    IF has_function_privilege('anon', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'r13_pos: wrapper % executavel por anon', r.sig USING ERRCODE='P0001';
    END IF;
    IF NOT has_function_privilege('authenticated', r.sig, 'EXECUTE') THEN
      RAISE EXCEPTION 'r13_pos: wrapper % SEM EXECUTE para authenticated', r.sig USING ERRCODE='P0001';
    END IF;
  END LOOP;
END $posttres$;

-- (k) md5 das funcoes redefinidas (T1 + T2) = o DEPOIS canonico (= mig/md5-r13.txt)
DO $posfuncs$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_oc_p_acabado_numero()', '03e778c0069e6ea85c1f607d7bb55e02'),
    ('public.fn_oc_importado_numero()', '84012d0b0d93f2f642e8d943b56b67b1'),
    ('public.enforce_oc_pa_vinculo_unico()', '6a1cc63439c2987525a777fd9f37e2da'),
    ('public.enforce_oc_importado_vinculo_unico()', '1911cb571aa7cf977903dee0744a26b6'),
    ('public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)', '2db79beeb9f0cbc51b2a77598de1e59a'),
    ('public._receber_oc_p_acabado_core(uuid,jsonb,jsonb)', '125a50b41e8524e0a849bb5b26a5013f'),
    ('public._vincular_oc_p_acabado_core(uuid,uuid)', '68df0a0954571d756a62f3e3c570893b'),
    ('public._excluir_oc_p_acabado_core(uuid)', '3366d7a394ac49a29223457f697abc0b'),
    ('public._excluir_produto_acabado_core(uuid)', 'd70fee664f13dbe2dab96ebe73b94551'),
    ('public._limpar_produto_acabado_core(uuid)', 'da3d5e8e14c3609fc97f9e73bc8db08d'),
    ('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)', '43a9ec5e03ddd9d85e016cb1ca516843'),
    ('public._custo_unitario_modelos_core(uuid[])', '81de3239233d2efb3565ed3c5ce8cfb3'),
    ('public._dashboard_leadtime_itens_core(uuid,text,text)', '6a8e9b7662e56356ec5602179636c24c'),
    ('public._estoque_extrato_insumo_core(uuid,uuid)', '227331479ecf99b9e39eeca40bbf4512'),
    ('public.fn_modelo_espelho_categoria()', '2e0c70f661e42610e87da2b934dec962'),
    ('public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)', '386051cfffa78f354555cc05721f6cf6'),
    ('public._receber_oc_importado_core(uuid,jsonb,jsonb)', '7f2c60f6e863450b149304c9dde6e5d3'),
    ('public._excluir_oc_importado_core(uuid)', 'edf21a91a5c17830550111db37e18172'),
    ('public._excluir_produto_importado_core(uuid)', '44472997492c854cdbc88fc76febc89a'),
    ('public._limpar_produto_importado_core(uuid)', 'd863544b621523cf9c1d4532b4909759'),
    ('public._imp_etapas_brl_oc(uuid)', '18301e31b0f01b31cb6158afc9556ef3'),
    ('public._imp_recalcular_landed_real_oc(uuid)', 'd9d8b3f88aadc5b30bfae20646d612a6')
  ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'r13_pos: % com md5 % (esperado %) - gere a R13 de novo', r.f, coalesce(v,'ausente'), r.m USING ERRCODE='P0001';
    END IF;
  END LOOP;
END $posfuncs$;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
