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
BEGIN
  SELECT * INTO p FROM public.produtos_acabados WHERE id = _produto_id;
  IF p.id IS NULL OR p.tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'nao_encontrado: produto' USING ERRCODE = 'P0002';
  END IF;
  v_grade := public._pa_grade_variante(p.grupo_id, coalesce(p.grade_proporcao, '{}'::jsonb), coalesce(p.qtd_total, 0));
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
BEGIN
  SELECT * INTO p FROM public.produtos_importados WHERE id = _produto_id;
  IF p.id IS NULL OR p.tenant_id IS DISTINCT FROM _tenant THEN
    RAISE EXCEPTION 'nao_encontrado: produto' USING ERRCODE = 'P0002';
  END IF;
  v_grade := public._pa_grade_variante(p.grupo_id, coalesce(p.grade_proporcao, '{}'::jsonb), coalesce(p.qtd_total, 0));
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

  IF v_tem_oc THEN m := m || 'ja_tem_oc'; END IF;
  IF nullif(btrim(coalesce(p.nome,'')), '') IS NULL THEN m := m || 'sem_nome'; END IF;
  IF p.empresa_id IS NULL THEN m := m || 'sem_fornecedor'; END IF;
  IF v_qtd <= 0 THEN m := m || 'sem_quantidade'; END IF;
  IF v_nvar = 0 THEN m := m || 'sem_variante'; END IF;
  IF v_nvar > 0 AND v_sum_var <> v_qtd THEN m := m || 'soma_variantes'; END IF;
  IF NOT v_acess AND coalesce(p.grade_proporcao, '{}'::jsonb) = '{}'::jsonb THEN m := m || 'grade_vazia'; END IF;
  IF v_valor <= 0 THEN m := m || 'sem_valor'; END IF;
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
         CASE WHEN count(DISTINCT coalesce(grupo_id::text,'')) = 1 THEN min(grupo_id) ELSE NULL END AS grupo,
         CASE WHEN count(DISTINCT coalesce(categoria_id::text,'')) = 1 THEN min(categoria_id) ELSE NULL END AS cat
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
         CASE WHEN count(DISTINCT coalesce(grupo_id::text,'')) = 1 THEN min(grupo_id) ELSE NULL END AS grupo,
         CASE WHEN count(DISTINCT coalesce(categoria_id::text,'')) = 1 THEN min(categoria_id) ELSE NULL END AS cat,
         CASE WHEN coalesce(sum(qtd_total),0) > 0
              THEN round(sum(coalesce(custo_unitario_landed_real,0) * coalesce(qtd_total,0)) / sum(qtd_total), 4)
              ELSE 0 END AS landed
    INTO r FROM public.ocs_importado_itens WHERE oc_id = _oc_id;
  RETURN jsonb_build_object('qtd_total', r.qtd, 'valor_bruto', r.bruto, 'valor_total_desconto', r.vtd,
    'status', r.status, 'data_entrega', r.data_entrega, 'grupo_id', r.grupo, 'categoria_id', r.cat,
    'custo_unitario_landed_real', r.landed);
END $fn$;
REVOKE EXECUTE ON FUNCTION public._oci_cabecalho_derivados(uuid) FROM PUBLIC, anon, authenticated;

-- ===== funcoes redefinidas (geradas por troca exata sobre o vivo; md5 em mig/md5-r13.txt) =====

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

-- (k) md5 das 4 funcoes redefinidas = o DEPOIS canonico (= mig/md5-r13.txt)
DO $posfuncs$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_oc_p_acabado_numero()', '03e778c0069e6ea85c1f607d7bb55e02'),
    ('public.fn_oc_importado_numero()', '84012d0b0d93f2f642e8d943b56b67b1'),
    ('public.enforce_oc_pa_vinculo_unico()', '6a1cc63439c2987525a777fd9f37e2da'),
    ('public.enforce_oc_importado_vinculo_unico()', '1911cb571aa7cf977903dee0744a26b6')
  ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'r13_pos: % com md5 % (esperado %) - gere a R13 de novo', r.f, coalesce(v,'ausente'), r.m USING ERRCODE='P0001';
    END IF;
  END LOOP;
END $posfuncs$;

SELECT pg_notify('pgrst', 'reload schema');

COMMIT;
