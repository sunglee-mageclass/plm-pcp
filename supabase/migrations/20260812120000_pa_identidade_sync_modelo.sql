-- Produto Acabado: edição de identidade (nome/grupo/categoria/subcategorias) fica editável no
-- card do canvas (ProdutoCard) — pedido do dono ago/2026, "já que é possível criar item por
-- lá". `_salvar_produto_acabado_core` já ACEITA esses campos em `_dados` no UPDATE (verificado
-- na definição viva antes desta migration — nome/grupo_id/categoria_id/subcategoria1_id/
-- subcategoria2_id já eram gravados em `produtos_acabados`, só não havia UI editável nem
-- espelho). Esta migration ESTENDE o `_core` pra também sincronizar o modelo espelho
-- (`produtos_acabados.modelo_id`) na MESMA transação, quando ele existe — mesmo padrão de
-- `_pa_recomputar_precos_modelo` (no-op se `modelo_id is null`).
--
-- Espelho: `modelos.nome`, `categoria_principal_id` (= categoria_id — nomes divergem entre as
-- tabelas), `subcategoria1_id`, `subcategoria2_id`. `modelos` NÃO tem coluna `grupo_id` (o
-- grupo só existe em `produtos_acabados`; a grade Acessório/normal é decidida a partir de LÁ —
-- ver `_pa_grade_variante(p.grupo_id, ...)` em `criar_card_produto_acabado`/
-- `aplicar_produto_ao_modelo` — nada a espelhar aqui).
--
-- REF do modelo NÃO é tocada: `fn_modelo_ref_auto` só age quando `ordem_criacao_enviada=true`
-- (invariante #11/#13 do CLAUDE.md) — cards espelho de revenda nascem com essa flag `false` e
-- nunca a viram `true`, então o trigger sai no primeiro `RETURN NEW` independente de
-- nome/categoria mudarem. Confirmado lendo `fn_modelo_ref_auto` antes desta migration.
--
-- Diff-validado contra a definição viva (capturada antes desta mudança): a única alteração é
-- (a) a UPDATE de `produtos_acabados` ganha `RETURNING ... INTO` pra capturar os valores FINAIS
-- já persistidos (evita reler `_dados` uma 2ª vez / drift entre os dois writes) e (b) o novo
-- bloco de sync do espelho logo em seguida. Ramo de INSERT (`_id is null`) intocado — produto
-- novo nunca tem `modelo_id` ainda.
create or replace function public._salvar_produto_acabado_core(_id uuid, _dados jsonb, _variantes jsonb)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_tenant uuid;
  v_id uuid;
  v_modelo_id uuid;
  v_grupo_id uuid;
  v_categoria_id uuid;
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
  -- Novo (identidade → espelho): valores FINAIS já persistidos em produtos_acabados neste
  -- save (pós-coalesce), pra propagar pro modelo sem reler _dados 2x.
  v_nome_final text;
  v_categoria_final uuid;
  v_sub1_final uuid;
  v_sub2_final uuid;
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

  if _id is null then
    -- Pendência herdada do review da Task 1: sem grupo+categoria a REF automática sai parcial.
    if v_grupo_id is null or v_categoria_id is null then
      raise exception 'Informe grupo e categoria do produto.' using errcode = 'P0001';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
    v_modelo_id := null;
  else
    select modelo_id into v_modelo_id from public.produtos_acabados
      where id = _id and tenant_id = v_tenant;
    if not found then
      raise exception 'Produto não encontrado';
    end if;
  end if;

  v_qtd_total := coalesce(nullif(_dados->>'qtd_total', '')::int, 0);
  v_valor_unitario := coalesce(nullif(_dados->>'valor_unitario', '')::numeric, 0);
  v_desconto_pct := coalesce(nullif(_dados->>'desconto_pct', '')::numeric, 0);
  v_redistribuir := coalesce(_dados->>'redistribuir', 'false') = 'true';

  -- Markups digitáveis (novo) — null = "não definido"; > 0 obrigatório quando presente
  -- (markup ≤ 0 zeraria/inverteria o preço derivado em silêncio).
  v_markup_atacado := nullif(_dados->>'markup_atacado', '')::numeric;
  v_markup_varejo := nullif(_dados->>'markup_varejo', '')::numeric;
  if (v_markup_atacado is not null and v_markup_atacado <= 0)
     or (v_markup_varejo is not null and v_markup_varejo <= 0) then
    raise exception 'O markup precisa ser maior que zero.' using errcode = 'P0001';
  end if;

  -- pesos por ordem (chave = ordem em texto, casa com o retorno de _split_maior_resto)
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
    select coalesce(sum(me.custo_previsto * me.consumo), 0) into v_insumos
      from public.modelo_etiquetas me where me.modelo_id = v_modelo_id;
  end if;

  if _id is null then
    insert into public.produtos_acabados (
      tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
      grade_proporcao, qtd_total, valor_unitario, desconto_pct, insumos_total,
      markup_atacado, markup_varejo
    ) values (
      v_tenant, v_nome, nullif(_dados->>'ref', ''), v_grupo_id, v_categoria_id,
      nullif(_dados->>'subcategoria1_id', '')::uuid, nullif(_dados->>'subcategoria2_id', '')::uuid,
      nullif(_dados->>'colecao_id', '')::uuid, _dados->>'subcolecao', _dados->>'semana',
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), v_qtd_total, v_valor_unitario, v_desconto_pct, v_insumos,
      v_markup_atacado, v_markup_varejo
    ) returning id into v_id;
  else
    update public.produtos_acabados set
      nome = coalesce(v_nome, nome),
      ref = coalesce(nullif(_dados->>'ref', ''), ref),
      grupo_id = v_grupo_id,
      categoria_id = v_categoria_id,
      subcategoria1_id = nullif(_dados->>'subcategoria1_id', '')::uuid,
      subcategoria2_id = nullif(_dados->>'subcategoria2_id', '')::uuid,
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
      updated_at = now()
    where id = _id and tenant_id = v_tenant
    returning nome, categoria_id, subcategoria1_id, subcategoria2_id
      into v_nome_final, v_categoria_final, v_sub1_final, v_sub2_final;
    v_id := _id;

    -- Espelho (novo): produto TEM modelo_id → propaga identidade pro modelo, na MESMA
    -- transação. Sem espelho (v_modelo_id null) → só o produto, como já era. Grupo não é
    -- espelhado (não existe em `modelos`); categoria_principal_id É a categoria_id.
    if v_modelo_id is not null then
      update public.modelos set
        nome = v_nome_final,
        categoria_principal_id = v_categoria_final,
        subcategoria1_id = v_sub1_final,
        subcategoria2_id = v_sub2_final
      where id = v_modelo_id;
    end if;
  end if;

  delete from public.produto_acabado_variantes where produto_acabado_id = v_id;
  insert into public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
  select v_tenant, v_id,
         (elem->>'ordem')::int,
         nullif(elem->>'cor_id', '')::uuid,
         nullif(elem->>'cor_apelido_id', '')::uuid,
         coalesce((elem->>'peso')::numeric, 0),
         coalesce((elem->>'qtd')::int, 0)
  from jsonb_array_elements(v_variantes_final) elem;

  -- Novo: custo (valor_unitario/desconto/insumos) pode ter mudado neste save — recomputa e
  -- persiste preco_atacado/preco_venda do espelho (no-op se ainda não há modelo_id).
  perform public._pa_recomputar_precos_modelo(v_id);

  return v_id;
end;
$function$;

-- Re-REVOKE explícito (padrão do projeto, invariante #9) — CREATE OR REPLACE preserva o ACL da
-- função existente (assinatura idêntica), então isto é um no-op defensivo, não uma correção.
revoke all on function public._salvar_produto_acabado_core(uuid, jsonb, jsonb) from public, anon, authenticated;
