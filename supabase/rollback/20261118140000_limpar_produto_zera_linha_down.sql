-- INVERSO de 20261118140000_limpar_produto_zera_linha.sql: devolve os 2 cores `_limpar_produto_*_core` ao texto EXATO de antes (sem `linha_id = null`).
--   Por funcao: aceita o md5 do DEPOIS da ida e o de antes (reaplicar o down = no-op); qualquer outro -> P0001, nada muda:
--   public._limpar_produto_acabado_core(uuid)      ANTES da3d5e8e14c3609fc97f9e73bc8db08d  DEPOIS b5ef31d7274ec7887d6741b93b8ee71e
--   public._limpar_produto_importado_core(uuid)    ANTES d863544b621523cf9c1d4532b4909759  DEPOIS c45ebb23ad4d2d905bd88af34c0bcaa6
-- Nao toca dados (produtos ja limpos continuam sem linha). Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL statement_timeout = '30s';
SET LOCAL transaction_timeout = '60s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public._limpar_produto_acabado_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'limpar_produto_zera_linha_down: _limpar_produto_acabado_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._limpar_produto_acabado_core(uuid)')));
  IF v_md5 NOT IN ('da3d5e8e14c3609fc97f9e73bc8db08d', 'b5ef31d7274ec7887d6741b93b8ee71e') THEN
    RAISE EXCEPTION 'limpar_produto_zera_linha_down: _limpar_produto_acabado_core mudou desde o planejamento (md5 %) - outra frente mexeu; conferir antes de aplicar', v_md5
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._limpar_produto_importado_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'limpar_produto_zera_linha_down: _limpar_produto_importado_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._limpar_produto_importado_core(uuid)')));
  IF v_md5 NOT IN ('d863544b621523cf9c1d4532b4909759', 'c45ebb23ad4d2d905bd88af34c0bcaa6') THEN
    RAISE EXCEPTION 'limpar_produto_zera_linha_down: _limpar_produto_importado_core mudou desde o planejamento (md5 %) - outra frente mexeu; conferir antes de aplicar', v_md5
      USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

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
end $function$
;

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
end $function$
;

REVOKE EXECUTE ON FUNCTION public._limpar_produto_acabado_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._limpar_produto_importado_core(uuid) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._limpar_produto_acabado_core(uuid)')));
  IF v_md5 <> 'da3d5e8e14c3609fc97f9e73bc8db08d' THEN
    RAISE EXCEPTION 'limpar_produto_zera_linha_down: pos-condicao - _limpar_produto_acabado_core md5 vivo % <> esperado da3d5e8e14c3609fc97f9e73bc8db08d', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._limpar_produto_importado_core(uuid)')));
  IF v_md5 <> 'd863544b621523cf9c1d4532b4909759' THEN
    RAISE EXCEPTION 'limpar_produto_zera_linha_down: pos-condicao - _limpar_produto_importado_core md5 vivo % <> esperado d863544b621523cf9c1d4532b4909759', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['public._limpar_produto_acabado_core(uuid)', 'public._limpar_produto_importado_core(uuid)']) AS s(sig)
              WHERE has_function_privilege('public', to_regprocedure(s.sig), 'EXECUTE')
                 OR has_function_privilege('anon', to_regprocedure(s.sig), 'EXECUTE')
                 OR has_function_privilege('authenticated', to_regprocedure(s.sig), 'EXECUTE')) THEN
    RAISE EXCEPTION 'limpar_produto_zera_linha_down: pos-condicao - _core com EXECUTE para PUBLIC/anon/authenticated (inv. #9)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
