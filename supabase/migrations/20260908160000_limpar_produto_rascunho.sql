-- #4c — "Limpar card": ZERAR os campos de um RASCUNHO de produto (Acabado/Importado),
-- MANTENDO o card vazio na lista (NÃO deleta). RPCs DEDICADAS (não passam pelo save normal,
-- que usa COALESCE e não zeraria `nome`). Preservam id/colecao_id/subcolecao/ref/mix_id;
-- apagam variantes (e etapas no importado); RAISE se já tem card (`modelo_id`) ou OC vinculada.
-- Também FECHA o gap: adiciona a guarda de OC ao `_excluir_produto_importado_core`.
-- Padrão wrapper + `_core` (REVOKE #9) + gate de módulo. BEGIN/COMMIT (idempotente por create-or-replace).

BEGIN;

-- ── Produto Acabado ────────────────────────────────────────────────────────
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
  if not found then raise exception 'Produto não encontrado.' using errcode = 'P0002'; end if;
  -- Só rascunho (sem card no Planejamento).
  if v_modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento — não pode ser limpo.' using errcode = 'P0001';
  end if;
  -- Guarda de OC: zerar qtd/variantes/valor com pedido ativo dessincronizaria a OC.
  select id, numero into v_oc_id, v_oc_numero
    from public.ocs_p_acabado where produto_acabado_id = _produto_id and tenant_id = v_tenant limit 1;
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
    updated_at = now()
  where id = _produto_id and tenant_id = v_tenant;

  delete from public.produto_acabado_variantes where produto_acabado_id = _produto_id;
end $function$;

CREATE OR REPLACE FUNCTION public.limpar_produto_acabado(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_acabado') then
    raise exception 'Módulo Produto Acabado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._limpar_produto_acabado_core(_produto_id);
end $function$;

-- ── Produto Importado ──────────────────────────────────────────────────────
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
  if not found then raise exception 'Produto não encontrado.' using errcode = 'P0002'; end if;
  if v_modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento — não pode ser limpo.' using errcode = 'P0001';
  end if;
  select id, numero into v_oc_id, v_oc_numero
    from public.ocs_importado where produto_importado_id = _produto_id and tenant_id = v_tenant limit 1;
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
    updated_at = now()
  where id = _produto_id and tenant_id = v_tenant;

  delete from public.produto_importado_variantes where produto_importado_id = _produto_id;
  delete from public.produto_importado_etapas where produto_importado_id = _produto_id;
end $function$;

CREATE OR REPLACE FUNCTION public.limpar_produto_importado(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._limpar_produto_importado_core(_produto_id);
end $function$;

-- ── Gap: guarda de OC no excluir do importado (hoje ausente) ─────────────────
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
  -- Guarda de OC (fechada agora — Fase 2 já criou ocs_importado): bloqueia excluir com OC ativa.
  select id, numero into v_oc_id, v_oc_numero
    from public.ocs_importado where produto_importado_id = _produto_id and tenant_id = v_tenant limit 1;
  if v_oc_id is not null then
    raise exception 'Desvincule a OC % antes de excluir.', coalesce(v_oc_numero, 'sem número') using errcode = 'P0001';
  end if;
  delete from public.produtos_importados where id = _produto_id and tenant_id = v_tenant;
  -- o modelo espelho (se houver) vira modelo comum (modelo_id já é on delete set null); NÃO apaga.
end $function$;

-- ── ACL (invariante #9): cores revogados dos três; wrappers só authenticated ─
REVOKE EXECUTE ON FUNCTION public._limpar_produto_acabado_core(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._limpar_produto_importado_core(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._excluir_produto_importado_core(uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.limpar_produto_acabado(uuid) FROM public, anon;
REVOKE EXECUTE ON FUNCTION public.limpar_produto_importado(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.limpar_produto_acabado(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.limpar_produto_importado(uuid) TO authenticated;

COMMIT;
