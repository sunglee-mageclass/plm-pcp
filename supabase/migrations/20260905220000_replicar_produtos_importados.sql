-- Produtos Importados — ação "Replicar card(s)" p/ outra coleção/subcoleção.
-- Espelha replicar_cards_plan_tecido (v3), adaptado: copia produtos_importados + variantes +
-- etapas + câmbio; **REF MANTIDA do original** (é o MESMO produto — diferencia só o versionamento);
-- espelho `modelos` VERSIONADO (modelo_base_id/versao da família do original, laço de versão como o
-- Plan.Tecido) + modelo_grades + recompute de preços. v1/v2 compartilham a REF; `versao` distingue.
-- NÃO copia OC/CAD/parcelas/lançamento. Só produtos que TÊM card materializado (modelo_id) — a
-- versão precisa da raiz da família. Wrapper+_core+REVOKE (#9); gate produto_importado. Idempotente.

BEGIN;

create or replace function public._replicar_produtos_importados_core(
  _tenant uuid, _destino_colecao_id uuid, _destino_subcolecao_id uuid, _produto_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  v_col_nome text;
  v_sub_nome text;
  o record;           -- produto de origem
  om record;          -- modelo espelho do original
  v_root uuid;
  v_versao int;
  v_novo_produto uuid;
  v_novo_modelo uuid;
  v_grade jsonb;
  v_total numeric;
  rec record;
  v_out jsonb := '[]'::jsonb;
begin
  if _tenant is null or _tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant' using errcode = '42501';
  end if;

  -- Coleção destino da loja + nome (produtos_importados guarda subcolecao TEXTO, como a revenda).
  select nome into v_col_nome from public.colecoes where id = _destino_colecao_id and tenant_id = _tenant;
  if v_col_nome is null then raise exception 'Coleção de destino não encontrada' using errcode = 'P0001'; end if;
  if _destino_subcolecao_id is not null then
    select nome into v_sub_nome from public.colecao_subcolecoes
      where id = _destino_subcolecao_id and colecao_id = _destino_colecao_id and tenant_id = _tenant;
    if v_sub_nome is null then raise exception 'Subcoleção de destino inválida' using errcode = 'P0001'; end if;
  end if;

  for o in select * from public.produtos_importados
           where id = any(_produto_ids) and tenant_id = _tenant for update loop
    -- Só replica quem tem card materializado (precisamos da raiz da família p/ versionar).
    if o.modelo_id is null then continue; end if;
    select * into om from public.modelos where id = o.modelo_id and tenant_id = _tenant;
    if not found then continue; end if;

    -- Versão: raiz da família + max(versao)+1 (laço de versão, como Plan.Tecido).
    v_root := coalesce(om.modelo_base_id, om.id);
    select coalesce(max(versao),0)+1 into v_versao from public.modelos
      where tenant_id = _tenant and (id = v_root or modelo_base_id = v_root);

    -- (1) Copia produtos_importados p/ o destino. REF MANTIDA do original (é O MESMO produto — a
    --     diferenciação é só o versionamento do espelho `modelos`). Passar `o.ref` faz o trigger
    --     fn_produto_importado_ref NÃO gerar outra (ele só gera quando ref vem vazia).
    --     modelo_id NULL (setado abaixo). v1 e v2 compartilham a REF; `versao` distingue.
    insert into public.produtos_importados (
      tenant_id, modelo_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
      grade_proporcao, qtd_total, foto_url, data_pedido, data_prevista, data_entrega,
      moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2,
      desconto_pct, cotacao_final, markup_atacado, markup_varejo
    ) values (
      _tenant, null, o.nome, o.ref, o.grupo_id, o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,
      _destino_colecao_id, v_sub_nome, o.semana, o.empresa_id, o.representante_id, o.ref_fornecedor, o.composicao,
      o.grade_proporcao, o.qtd_total, o.foto_url, o.data_pedido, o.data_prevista, o.data_entrega,
      o.moeda_compra, o.moeda_intermediaria, o.valor_unitario_m1, o.cotacao_ref, o.peso_kg, o.transporte_m2,
      o.desconto_pct, o.cotacao_final, o.markup_atacado, o.markup_varejo
    ) returning id into v_novo_produto;

    -- (2) Variantes + etapas.
    insert into public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
      select _tenant, v_novo_produto, ordem, cor_id, cor_apelido_id, peso, qtd
      from public.produto_importado_variantes where produto_importado_id = o.id;
    insert into public.produto_importado_etapas (tenant_id, produto_importado_id, ordem, rotulo, base, percentual, data_vencimento, cotacao)
      select _tenant, v_novo_produto, ordem, rotulo, base, percentual, data_vencimento, cotacao
      from public.produto_importado_etapas where produto_importado_id = o.id;

    -- (3) Espelho modelos VERSIONADO (origem='importado'). REF = a do produto (= a do original,
    --     mantida acima); importado passa por fora do fluxo ref_auto. versao/modelo_base_id distinguem.
    insert into public.modelos (
      tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, ref, linha_id, modelo_base_id, versao
    )
    select _tenant, o.nome, 'importado', o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,
           _destino_colecao_id, v_sub_nome, o.semana, pi.ref, null, v_root, v_versao
    from public.produtos_importados pi where pi.id = v_novo_produto
    returning id into v_novo_modelo;

    update public.produtos_importados set modelo_id = v_novo_modelo, updated_at = now() where id = v_novo_produto;

    -- modelo_grades por variante (mesma lógica de _criar_card_produto_importado_core).
    for rec in select ordem, qtd from public.produto_importado_variantes where produto_importado_id = v_novo_produto loop
      v_grade := public._pa_grade_variante(o.grupo_id, o.grade_proporcao, rec.qtd);
      select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
      insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
      values (v_novo_modelo, rec.ordem, v_grade, v_total::int);
    end loop;

    perform public._imp_recomputar_precos_modelo(v_novo_produto);

    v_out := v_out || jsonb_build_object('origem_produto_id', o.id, 'novo_produto_id', v_novo_produto, 'novo_modelo_id', v_novo_modelo);
  end loop;

  return v_out;
end $$;
revoke execute on function public._replicar_produtos_importados_core(uuid,uuid,uuid,uuid[]) from public, anon, authenticated;

create or replace function public.replicar_produtos_importados(
  _destino_colecao_id uuid, _destino_subcolecao_id uuid, _produto_ids uuid[]
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não está ativo para esta loja.' using errcode = '42501';
  end if;
  return public._replicar_produtos_importados_core(public.get_user_tenant_id(), _destino_colecao_id, _destino_subcolecao_id, _produto_ids);
end $$;
revoke execute on function public.replicar_produtos_importados(uuid,uuid,uuid[]) from public, anon;
grant execute on function public.replicar_produtos_importados(uuid,uuid,uuid[]) to authenticated;

COMMIT;
