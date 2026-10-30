-- ============================================================================
-- R13 T1 — INVERSO NEUTRO (_down). Devolve as 4 funcoes de ANTES, repoe o ponteiro do cabecalho a partir do item unico e as
-- colunas legadas (so onde IS DISTINCT FROM). As TABELAS de itens FICAM (inertes). Sem DROP (ver _down_drop).
--   docker exec -i supabase_db_banco-local psql -U postgres -d copia4 -v ON_ERROR_STOP=1 < supabase/rollback/20261105100000_urg_r13_oc_itens_down.sql
-- RECUSA se existir OC com != 1 item (r13_down_oc_varios_produtos: N — o dono exclui/desfaz essas OCs ou mantem a R13).
-- RECUSA se o vivo nao for o "depois" da R13 (md5) — nao rodar fora de ordem.
-- ============================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

-- guarda: o vivo tem de ser o "depois" da R13 (md5-r13.txt). Se alguem ja desfez (ANTES) ou outra frente mexeu, PARA.
DO $g$
DECLARE r record; v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.fn_oc_p_acabado_numero()','03e778c0069e6ea85c1f607d7bb55e02'),
    ('public.fn_oc_importado_numero()','84012d0b0d93f2f642e8d943b56b67b1'),
    ('public.enforce_oc_pa_vinculo_unico()','6a1cc63439c2987525a777fd9f37e2da'),
    ('public.enforce_oc_importado_vinculo_unico()','1911cb571aa7cf977903dee0744a26b6')
  ) x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'r13_down: % nao esta no DEPOIS da R13 (md5 %) - nao desfazer fora de ordem', r.f, coalesce(v,'ausente') USING ERRCODE='P0001';
    END IF;
  END LOOP;
END $g$;

-- recusa OC com != 1 item (a volta so representa OC de 1 produto)
DO $v$
DECLARE v_n int; v_nums text;
BEGIN
  SELECT count(*), string_agg(numero, ', ') INTO v_n, v_nums FROM (
    SELECT o.numero FROM public.ocs_p_acabado o
     WHERE (SELECT count(*) FROM public.ocs_p_acabado_itens it WHERE it.oc_id = o.id) <> 1
    UNION ALL
    SELECT o.numero FROM public.ocs_importado o
     WHERE (SELECT count(*) FROM public.ocs_importado_itens it WHERE it.oc_id = o.id) <> 1
  ) d;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'r13_down_oc_varios_produtos: % (%) - exclua/desfaca essas OCs ou mantenha a R13', v_n, v_nums USING ERRCODE='P0001';
  END IF;
END $v$;

-- 1) devolve as 4 funcoes de ANTES (o ponteiro volta a ser gravavel; a guarda antiga "1 OC por produto" volta).
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
  select coalesce(max((substring(numero from '([0-9]+)$'))::bigint),0)+1 into v_num
    from public.ocs_p_acabado where tenant_id=new.tenant_id and numero ~ ('^'||v_sig||'-[0-9]+$');
  new.numero := v_sig || '-' || lpad(v_num::text,5,'0');
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
  select coalesce(max((substring(numero from '([0-9]+)$'))::bigint),0)+1 into v_num
    from public.ocs_importado where tenant_id=new.tenant_id and numero ~ ('^'||v_sig||'-[0-9]+$');
  new.numero := v_sig || '-' || lpad(v_num::text,5,'0');
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_oc_pa_vinculo_unico()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare v_num text;
begin
  if new.produto_acabado_id is null then return new; end if;
  select numero into v_num from public.ocs_p_acabado
   where produto_acabado_id = new.produto_acabado_id and id is distinct from new.id limit 1;
  if v_num is not null then
    raise exception 'Este produto já tem a OC % vinculada — desvincule antes.', v_num using errcode='P0001';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.enforce_oc_importado_vinculo_unico()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare v_num text;
begin
  if new.produto_importado_id is null then return new; end if;
  select numero into v_num from public.ocs_importado
   where produto_importado_id = new.produto_importado_id and id is distinct from new.id limit 1;
  if v_num is not null then
    raise exception 'Este produto já tem a OC % vinculada — desvincule antes.', v_num using errcode='P0001';
  end if;
  return new;
end $function$;

-- 2) repoe o ponteiro + colunas legadas a partir do item unico, SO onde IS DISTINCT FROM (parcelas so refazem onde mudou).
UPDATE public.ocs_p_acabado o SET produto_acabado_id = it.produto_acabado_id
  FROM public.ocs_p_acabado_itens it WHERE it.oc_id = o.id AND o.produto_acabado_id IS DISTINCT FROM it.produto_acabado_id;
UPDATE public.ocs_p_acabado o SET
    nome_produto = coalesce(it.nome_produto, o.nome_produto), grupo_id = it.grupo_id, categoria_id = it.categoria_id,
    subcategoria1_id = it.subcategoria1_id, subcategoria2_id = it.subcategoria2_id, ref_fornecedor = it.ref_fornecedor,
    composicao = it.composicao, grade_proporcao = it.grade_proporcao, grade_detalhe = it.grade_detalhe, variantes = it.variantes,
    qtd_total = it.qtd_total, valor_unitario = it.valor_unitario, desconto_pct = it.desconto_pct, valor_bruto = it.valor_bruto,
    valor_total_desconto = it.valor_total_desconto, valor_unitario_real = it.valor_unitario_real, status = it.status,
    data_entrega = it.data_entrega, nota_fiscal = it.nota_fiscal, anexo_nf_url = it.anexo_nf_url,
    responsavel_recebimento_id = it.responsavel_recebimento_id, devolucao = it.devolucao, revisao = it.revisao
  FROM public.ocs_p_acabado_itens it
  WHERE it.oc_id = o.id AND (
    o.nome_produto IS DISTINCT FROM it.nome_produto OR o.grupo_id IS DISTINCT FROM it.grupo_id
    OR o.categoria_id IS DISTINCT FROM it.categoria_id OR o.subcategoria1_id IS DISTINCT FROM it.subcategoria1_id
    OR o.subcategoria2_id IS DISTINCT FROM it.subcategoria2_id OR o.ref_fornecedor IS DISTINCT FROM it.ref_fornecedor
    OR o.composicao IS DISTINCT FROM it.composicao OR o.grade_proporcao IS DISTINCT FROM it.grade_proporcao
    OR o.grade_detalhe IS DISTINCT FROM it.grade_detalhe OR o.variantes IS DISTINCT FROM it.variantes
    OR o.qtd_total IS DISTINCT FROM it.qtd_total OR o.valor_unitario IS DISTINCT FROM it.valor_unitario
    OR o.desconto_pct IS DISTINCT FROM it.desconto_pct OR o.valor_bruto IS DISTINCT FROM it.valor_bruto
    OR o.valor_total_desconto IS DISTINCT FROM it.valor_total_desconto OR o.valor_unitario_real IS DISTINCT FROM it.valor_unitario_real
    OR o.status IS DISTINCT FROM it.status OR o.data_entrega IS DISTINCT FROM it.data_entrega
    OR o.nota_fiscal IS DISTINCT FROM it.nota_fiscal OR o.anexo_nf_url IS DISTINCT FROM it.anexo_nf_url
    OR o.responsavel_recebimento_id IS DISTINCT FROM it.responsavel_recebimento_id
    OR o.devolucao IS DISTINCT FROM it.devolucao OR o.revisao IS DISTINCT FROM it.revisao);

UPDATE public.ocs_importado o SET produto_importado_id = it.produto_importado_id
  FROM public.ocs_importado_itens it WHERE it.oc_id = o.id AND o.produto_importado_id IS DISTINCT FROM it.produto_importado_id;
UPDATE public.ocs_importado o SET
    nome_produto = coalesce(it.nome_produto, o.nome_produto), grupo_id = it.grupo_id, categoria_id = it.categoria_id,
    subcategoria1_id = it.subcategoria1_id, subcategoria2_id = it.subcategoria2_id, ref_fornecedor = it.ref_fornecedor,
    composicao = it.composicao, grade_proporcao = it.grade_proporcao, grade_detalhe = it.grade_detalhe, variantes = it.variantes,
    qtd_total = it.qtd_total, valor_unitario_m1 = it.valor_unitario_m1, peso_kg = it.peso_kg, transporte_m2 = it.transporte_m2,
    desconto_pct = it.desconto_pct, valor_bruto = it.valor_bruto, valor_total_desconto = it.valor_total_desconto,
    valor_unitario_real = it.valor_unitario_real, custo_unitario_landed_real = it.custo_unitario_landed_real, status = it.status,
    data_entrega = it.data_entrega, nota_fiscal = it.nota_fiscal, anexo_nf_url = it.anexo_nf_url,
    responsavel_recebimento_id = it.responsavel_recebimento_id, devolucao = it.devolucao, revisao = it.revisao
  FROM public.ocs_importado_itens it
  WHERE it.oc_id = o.id AND (
    o.nome_produto IS DISTINCT FROM it.nome_produto OR o.grupo_id IS DISTINCT FROM it.grupo_id
    OR o.categoria_id IS DISTINCT FROM it.categoria_id OR o.subcategoria1_id IS DISTINCT FROM it.subcategoria1_id
    OR o.subcategoria2_id IS DISTINCT FROM it.subcategoria2_id OR o.ref_fornecedor IS DISTINCT FROM it.ref_fornecedor
    OR o.composicao IS DISTINCT FROM it.composicao OR o.grade_proporcao IS DISTINCT FROM it.grade_proporcao
    OR o.grade_detalhe IS DISTINCT FROM it.grade_detalhe OR o.variantes IS DISTINCT FROM it.variantes
    OR o.qtd_total IS DISTINCT FROM it.qtd_total OR o.valor_unitario_m1 IS DISTINCT FROM it.valor_unitario_m1
    OR o.peso_kg IS DISTINCT FROM it.peso_kg OR o.transporte_m2 IS DISTINCT FROM it.transporte_m2
    OR o.desconto_pct IS DISTINCT FROM it.desconto_pct OR o.valor_bruto IS DISTINCT FROM it.valor_bruto
    OR o.valor_total_desconto IS DISTINCT FROM it.valor_total_desconto OR o.valor_unitario_real IS DISTINCT FROM it.valor_unitario_real
    OR o.custo_unitario_landed_real IS DISTINCT FROM it.custo_unitario_landed_real OR o.status IS DISTINCT FROM it.status
    OR o.data_entrega IS DISTINCT FROM it.data_entrega OR o.nota_fiscal IS DISTINCT FROM it.nota_fiscal
    OR o.anexo_nf_url IS DISTINCT FROM it.anexo_nf_url OR o.responsavel_recebimento_id IS DISTINCT FROM it.responsavel_recebimento_id
    OR o.devolucao IS DISTINCT FROM it.devolucao OR o.revisao IS DISTINCT FROM it.revisao);

SELECT pg_notify('pgrst', 'reload schema');
COMMIT;
