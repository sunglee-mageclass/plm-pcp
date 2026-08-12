-- Refino imediato (decisão do dono, ago/2026): produto de revenda COM OC vinculada NÃO pode
-- editar identidade (nome/grupo/categoria/subcategorias) — o nº da OC deriva de
-- fornecedor+grupo+categoria e o pedido já foi feito; mudar a identidade depois divergiria do
-- que foi pedido/numerado. Campos de Compra (valor, desconto, variantes, qtd) CONTINUAM livres
-- — valor/desconto já são espelho da OC (regra existente, não mexida aqui).
--
-- Guarda no SERVIDOR (não só na UI, que só desabilita os campos) — `_salvar_produto_acabado_
-- core` agora RAISE P0001 se: (a) o produto tem uma OC vinculada (`ocs_p_acabado.produto_
-- acabado_id = _id`) E (b) o payload muda nome/grupo_id/categoria_id/subcategoria1_id/
-- subcategoria2_id em relação ao valor ATUAL da linha (comparação com IS DISTINCT FROM —
-- cobre null↔valor e valor↔valor). Só se aplica no ramo UPDATE (`_id is not null`) — produto
-- novo nunca tem OC ainda.
--
-- Diff contra a definição viva capturada antes desta mudança (migration 20260812120000):
-- (1) `v_sub1_id`/`v_sub2_id` viram variáveis nomeadas (antes eram inline nos INSERT/UPDATE) —
--     reusadas pelo novo guard E pelos dois statements, sem duplicar a extração;
-- (2) o SELECT que já buscava `modelo_id` no ramo UPDATE passa a trazer também os valores
--     ATUAIS de nome/grupo/categoria/sub1/sub2 (`v_*_atual`), pra comparação;
-- (3) novo bloco de guarda logo em seguida, ANTES de qualquer outra validação/processamento —
--     falha rápido com mensagem específica.
-- Nada mais muda; ACL re-confirmado com REVOKE explícito ao final.
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
  -- valores FINAIS já persistidos em produtos_acabados neste save (pós-coalesce), pra
  -- propagar pro modelo sem reler _dados 2x.
  v_nome_final text;
  v_categoria_final uuid;
  v_sub1_final uuid;
  v_sub2_final uuid;
  -- Novo (trava com OC): valores ATUAIS de identidade (antes deste save), só preenchidos no
  -- ramo UPDATE — usados pra comparar contra o payload e detectar mudança de identidade.
  v_nome_atual text;
  v_grupo_atual uuid;
  v_categoria_atual uuid;
  v_sub1_atual uuid;
  v_sub2_atual uuid;
  v_tem_oc boolean;
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
    -- Pendência herdada do review da Task 1: sem grupo+categoria a REF automática sai parcial.
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
      where id = _id and tenant_id = v_tenant;
    if not found then
      raise exception 'Produto não encontrado';
    end if;

    -- Trava de identidade com OC vinculada (refino ago/2026) — falha rápido, antes de
    -- qualquer outro processamento. Campos de Compra (valor/desconto/variantes/qtd) NÃO
    -- entram nesta checagem — continuam livres mesmo com OC.
    v_tem_oc := exists (select 1 from public.ocs_p_acabado where produto_acabado_id = _id);
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
      v_sub1_id, v_sub2_id,
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
      updated_at = now()
    where id = _id and tenant_id = v_tenant
    returning nome, categoria_id, subcategoria1_id, subcategoria2_id
      into v_nome_final, v_categoria_final, v_sub1_final, v_sub2_final;
    v_id := _id;

    -- Espelho: produto TEM modelo_id → propaga identidade pro modelo, na MESMA transação.
    -- Sem espelho (v_modelo_id null) → só o produto, como já era. Grupo não é espelhado (não
    -- existe em `modelos`); categoria_principal_id É a categoria_id. Com OC vinculada, o guard
    -- acima já garantiu que nome/categoria/sub1/sub2 não mudaram neste save — este UPDATE vira
    -- um no-op de fato (mesmos valores), não precisa de guarda própria.
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
