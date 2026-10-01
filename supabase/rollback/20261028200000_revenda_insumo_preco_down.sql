-- INVERSO (passo 1 de 2) de supabase/migrations/20261028200000_revenda_insumo_preco.sql (achados LEVES L8).
-- Devolve o texto de ANTES de _pa_recomputar_precos_modelo (insumo = consumo x custo_previsto de novo; markup 0 = preco
-- 0,00), _salvar_produto_acabado_core (insumos_total = consumo x custo_previsto; nao apaga a grade da variante que sai) e
-- _salvar_produto_importado_core (aceita etapa de mercadoria com cotacao 0), e NEUTRALIZA fn_preco_comprado_por_insumo
-- (RETURN NULL): editar insumo volta a nao recalcular o preco do comprado. Os 3 gatilhos de modelo_etiquetas ficam de pe,
-- inertes; o DROP fica no 20261028200000_revenda_insumo_preco_down_drop.sql (SEPARADO, opcional, horario calmo).
-- Guarda: so roda se as 3 funcoes estao EXATAMENTE com o texto da ida e a do gatilho com o da ida; outro -> P0001 e nada
-- muda (2a volta recusa). Nada gravado muda (precos/insumos_total/grades ja tocados ficam). Site: o card do Produto
-- Importado continua recusando cotacao 0 no cliente (inofensivo); voltar o site junto se a volta for definitiva.
-- Travas: so CREATE OR REPLACE FUNCTION (trava de objeto; nada em tabela, nada em auth/storage): qualquer hora.
-- LIFO: este inverso roda ANTES de 20261026200000_custo_real_mo_prevista_down (R16), 20261024200000_..._down (R14),
-- 20261017100000_..._down, 20261016100000_pa_sync_card_so_mudou_down e 20261014100000_tamanho_em_cards_down (conferem os
-- textos que esta volta devolve).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._pa_recomputar_precos_modelo(uuid)', '3f0c4d88da8e23a61ff9e3dda7817be2'),
      ('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)', '77076d81637354d530ee38a03e8f77e7'),
      ('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)', '5c70c3fe0cdc83a2a5bf59f33e171d1b'),
      ('public.fn_preco_comprado_por_insumo()', 'ccd231e45d1e9a379b252e574c5cda5e')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'leves_l8 (volta): % nao existe - a 20261028200000 nao foi aplicada', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l8 (volta): % nao esta com o texto da ida (md5 %) - ja desfeita ou outra frente mexeu', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

-- ACL de antes da volta (a pos-condicao exige a MESMA depois).
CREATE TEMP TABLE _l8v_acl_antes ON COMMIT DROP AS
  SELECT v.s AS assinatura, (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(v.s)) AS acl
    FROM (VALUES ('public._pa_recomputar_precos_modelo(uuid)'), ('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)'),
                 ('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'), ('public.fn_preco_comprado_por_insumo()')) v(s);

CREATE OR REPLACE FUNCTION public._pa_recomputar_precos_modelo(_produto_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_modelo_id uuid;
  v_valor_unitario numeric;
  v_desconto_pct numeric;
  v_markup_atacado numeric;
  v_markup_varejo numeric;
  v_preco_atacado_fixo numeric;
  v_preco_varejo_fixo numeric;
  v_insumos numeric := 0;
  v_mao_obra numeric := 0;
  v_custo numeric;
  v_atacado_atual numeric;
  v_venda_atual numeric;
  v_preco_atacado numeric;
  v_preco_venda numeric;
begin
  select p.modelo_id, p.valor_unitario, p.desconto_pct, p.markup_atacado, p.markup_varejo,
         p.preco_atacado_fixo, p.preco_varejo_fixo
    into v_modelo_id, v_valor_unitario, v_desconto_pct, v_markup_atacado, v_markup_varejo,
         v_preco_atacado_fixo, v_preco_varejo_fixo
    from public.produtos_acabados p where p.id = _produto_id;

  if v_modelo_id is null then
    return; -- sem espelho no Planejamento ainda — nada a recomputar
  end if;

  select coalesce(sum(me.consumo * me.custo_previsto), 0) into v_insumos
    from public.modelo_etiquetas me where me.modelo_id = v_modelo_id;

  -- MO na base (mesma fonte modelo_servico_mo do card do Planejamento; BRL por peça).
  select coalesce(sum(s.valor), 0) into v_mao_obra
    from public.modelo_servico_mo s where s.modelo_id = v_modelo_id;

  v_custo := coalesce(v_valor_unitario, 0) * (1 - coalesce(v_desconto_pct, 0) / 100.0) + v_insumos + v_mao_obra;

  select m.preco_atacado, m.preco_venda into v_atacado_atual, v_venda_atual
    from public.modelos m where m.id = v_modelo_id;

  -- Preço FIXO manda; senão deriva do markup (base × markup); senão NULL (sem markup nem fixo = não há
  -- preço — NÃO manter o valor antigo, que vira lixo exibido como "fixado" que o usuário nunca digitou).
  v_preco_atacado := case
    when v_preco_atacado_fixo is not null then v_preco_atacado_fixo
    when v_markup_atacado is not null then round(v_custo * v_markup_atacado, 2)
    else null end;
  -- VAREJO INDEPENDENTE: base(custo) × markup_varejo, NÃO preço_atacado × markup_varejo.
  v_preco_venda := case
    when v_preco_varejo_fixo is not null then v_preco_varejo_fixo
    when v_markup_varejo is not null then round(v_custo * v_markup_varejo, 2)
    else null end;

  -- [integracao v1] B1: produto travado pela Integração com "Preço de venda" marcado — o recálculo automático (OC, MO,
  -- markup, preço fixo) NÃO mexe no preco_venda: fica congelado (o retrato já tem o valor enviado). O atacado segue.
  if public._integracao_campo_travado(v_modelo_id, 'preco_venda') then
    v_preco_venda := v_venda_atual;
  end if;

  update public.modelos set preco_atacado = v_preco_atacado, preco_venda = v_preco_venda
    where id = v_modelo_id
      and (preco_atacado is distinct from v_preco_atacado or preco_venda is distinct from v_preco_venda);
end;
$function$;

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
      markup_atacado, markup_varejo, foto_url, tamanho_tipo
    ) values (
      v_tenant, v_nome, nullif(_dados->>'ref', ''), v_grupo_id, v_categoria_id,
      v_sub1_id, v_sub2_id,
      nullif(_dados->>'colecao_id', '')::uuid, _dados->>'subcolecao', _dados->>'semana',
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), v_qtd_total, v_valor_unitario, v_desconto_pct, v_insumos,
      v_markup_atacado, v_markup_varejo, nullif(_dados->>'foto_url', ''), v_tt  -- [tamanho-em v1]
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

  delete from public.produto_acabado_variantes where produto_acabado_id = v_id;
  insert into public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
  select v_tenant, v_id,
         (elem->>'ordem')::int,
         nullif(elem->>'cor_id', '')::uuid,
         nullif(elem->>'cor_apelido_id', '')::uuid,
         coalesce((elem->>'peso')::numeric, 0),
         coalesce((elem->>'qtd')::int, 0)
  from jsonb_array_elements(v_variantes_final) elem;

  perform public._pa_recomputar_precos_modelo(v_id);

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public._salvar_produto_importado_core(_id uuid, _dados jsonb, _variantes jsonb, _etapas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  v_id uuid;
  v_nome text;
  v_grupo_id uuid;
  v_categoria_id uuid;
  v_soma_merc numeric;
  v_soma_frete numeric;
  rec jsonb;
  v_ord int;
  v_tt text;  -- [tamanho-em v1]
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  v_nome := nullif(_dados->>'nome','');
  v_grupo_id := nullif(_dados->>'grupo_id','')::uuid;
  v_categoria_id := nullif(_dados->>'categoria_id','')::uuid;

  -- Validação Σ% por base = 100 (só quando há etapas da base).
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_merc
    from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base' = 'mercadoria';
  select coalesce(sum((e->>'percentual')::numeric),0) into v_soma_frete
    from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base' = 'frete';
  if exists(select 1 from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base'='mercadoria') and round(v_soma_merc,2) <> 100 then
    raise exception 'A soma das etapas de mercadoria (%) precisa fechar 100%%.', round(v_soma_merc,2) using errcode = 'P0001';
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e where e->>'base'='frete') and round(v_soma_frete,2) <> 100 then
    raise exception 'A soma das etapas de frete (%) precisa fechar 100%%.', round(v_soma_frete,2) using errcode = 'P0001';
  end if;

  -- [tamanho-em v1] "Tamanho em" (P-85 A): só quando a chave vem no _dados (a tela manda só se mudou). Com card, o
  -- gatilho do produto (fn_produto_tamanho_tipo_handover) leva o valor ao modelo espelho e limpa o do produto.
  if _dados ? 'tamanho_tipo' then
    v_tt := nullif(_dados->>'tamanho_tipo', '');
    if v_tt is null or v_tt not in ('letra', 'numero') then
      raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';
    end if;
  end if;

  if _id is null then
    if v_grupo_id is null or v_categoria_id is null then
      raise exception 'Informe grupo e categoria do produto.' using errcode = 'P0001';
    end if;
    if v_nome is null then
      raise exception 'Informe o nome do produto.' using errcode = 'P0001';
    end if;
    insert into public.produtos_importados (
      tenant_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor,
      composicao, grade_proporcao, qtd_total, foto_url, data_pedido, data_prevista, data_entrega,
      moeda_compra, moeda_intermediaria, valor_unitario_m1, cotacao_ref, peso_kg, transporte_m2,
      desconto_pct, cotacao_final, markup_atacado, markup_varejo, tamanho_tipo
    ) values (
      -- ref: se o usuário digitou uma REF manual, ela é gravada e o trigger fn_produto_importado_ref
      -- NÃO a sobrescreve (ele só gera quando new.ref é vazio). Senão null → trigger gera a automática.
      v_tenant, v_nome, nullif(_dados->>'ref',''), v_grupo_id, v_categoria_id,
      nullif(_dados->>'subcategoria1_id','')::uuid, nullif(_dados->>'subcategoria2_id','')::uuid,
      nullif(_dados->>'colecao_id','')::uuid, nullif(_dados->>'subcolecao',''), nullif(_dados->>'semana',''),
      nullif(_dados->>'empresa_id','')::uuid, nullif(_dados->>'representante_id','')::uuid, nullif(_dados->>'ref_fornecedor',''),
      nullif(_dados->>'composicao',''), coalesce(_dados->'grade_proporcao','{}'::jsonb), coalesce((_dados->>'qtd_total')::int,0),
      nullif(_dados->>'foto_url',''), nullif(_dados->>'data_pedido','')::date, nullif(_dados->>'data_prevista','')::date, nullif(_dados->>'data_entrega','')::date,
      coalesce(nullif(_dados->>'moeda_compra',''),'RMB'), nullif(_dados->>'moeda_intermediaria',''),
      coalesce((_dados->>'valor_unitario_m1')::numeric,0), coalesce((_dados->>'cotacao_ref')::numeric,0),
      coalesce((_dados->>'peso_kg')::numeric,0), coalesce((_dados->>'transporte_m2')::numeric,0),
      coalesce((_dados->>'desconto_pct')::numeric,0), coalesce((_dados->>'cotacao_final')::numeric,0),
      nullif(_dados->>'markup_atacado','')::numeric, nullif(_dados->>'markup_varejo','')::numeric,
      v_tt  -- [tamanho-em v1]
    ) returning id into v_id;
  else
    update public.produtos_importados set
      nome = coalesce(v_nome, nome),
      -- ref: grava a manual digitada; se vier vazia, mantém a atual (não zera a REF existente).
      ref = coalesce(nullif(_dados->>'ref',''), ref),
      grupo_id = coalesce(v_grupo_id, grupo_id),
      categoria_id = coalesce(v_categoria_id, categoria_id),
      subcategoria1_id = nullif(_dados->>'subcategoria1_id','')::uuid,
      subcategoria2_id = nullif(_dados->>'subcategoria2_id','')::uuid,
      subcolecao = nullif(_dados->>'subcolecao',''),
      semana = nullif(_dados->>'semana',''),
      empresa_id = nullif(_dados->>'empresa_id','')::uuid,
      representante_id = nullif(_dados->>'representante_id','')::uuid,
      ref_fornecedor = nullif(_dados->>'ref_fornecedor',''),
      composicao = nullif(_dados->>'composicao',''),
      grade_proporcao = coalesce(_dados->'grade_proporcao', grade_proporcao),
      qtd_total = coalesce((_dados->>'qtd_total')::int, qtd_total),
      foto_url = nullif(_dados->>'foto_url',''),
      data_pedido = nullif(_dados->>'data_pedido','')::date,
      data_prevista = nullif(_dados->>'data_prevista','')::date,
      data_entrega = nullif(_dados->>'data_entrega','')::date,
      moeda_compra = coalesce(nullif(_dados->>'moeda_compra',''), moeda_compra),
      moeda_intermediaria = nullif(_dados->>'moeda_intermediaria',''),
      valor_unitario_m1 = coalesce((_dados->>'valor_unitario_m1')::numeric, valor_unitario_m1),
      cotacao_ref = coalesce((_dados->>'cotacao_ref')::numeric, cotacao_ref),
      peso_kg = coalesce((_dados->>'peso_kg')::numeric, peso_kg),
      transporte_m2 = coalesce((_dados->>'transporte_m2')::numeric, transporte_m2),
      desconto_pct = coalesce((_dados->>'desconto_pct')::numeric, desconto_pct),
      cotacao_final = coalesce((_dados->>'cotacao_final')::numeric, cotacao_final),
      markup_atacado = nullif(_dados->>'markup_atacado','')::numeric,
      markup_varejo = nullif(_dados->>'markup_varejo','')::numeric,
      tamanho_tipo = case when _dados ? 'tamanho_tipo' then v_tt else tamanho_tipo end,  -- [tamanho-em v1]
      updated_at = now()
    where id = _id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then raise exception 'Produto não encontrado'; end if;
  end if;

  -- [integracao v1] D14/R1: o preço do Importado grava no SALVAR da tela, NESTA transação (a do _rev_base do wrapper).
  -- Preço FIXO no _dados = preço exato do canal e ZERA o markup dele; sem fixo, markup não-nulo LIMPA o fixo ("última
  -- edição manda", como a revenda — fix 2efa2ba); sem nenhum dos dois, o fixo fica (outros gravadores não mandam as chaves).
  -- ruling do controlador, G-migration fix 3 #J2 (P-91 A): a chave preco_atacado_fixo/preco_varejo_fixo PRESENTE com
  -- vazio/NULL (com o markup do canal TAMBÉM vazio/ausente) agora LIMPA o fixo — espelha exatamente o comportamento
  -- do Produto Acabado (o front chama salvar_precos_fixo_produto_acabado com _tocar_varejo=true incondicionalmente a
  -- cada blur que muda o valor exibido, inclusive apagar para vazio: novo=null !== atual dispara _tocar_varejo=true,
  -- _preco_varejo_fixo=null, que grava preco_varejo_fixo=NULL sem olhar o markup — ver ProdutoCard.tsx/
  -- useRevendaPlanejamento.ts). Antes, a chave presente-e-vazia caía no MESMO ramo de "chave ausente" (mantinha o
  -- valor atual, "else x.preco_varejo_fixo") quando o markup também estava vazio — "apagar o Valor" no Importado
  -- não apagava o fixo (D14 do parecer, nuance aceita como bug pelo dono na P-91). Regra final (3 casos, na MESMA
  -- ORDEM de prioridade do código original — fixo primeiro): (1) chave do fixo PRESENTE com número → grava o fixo
  -- exato e zera o markup do canal (prioridade sobre um markup que porventura venha junto no mesmo payload — R1,
  -- "o SALVAR grava o fixo exato e zera o markup"); (2) senão, chave do fixo PRESENTE mas vazia/NULL → NOVO (J2):
  -- limpa o fixo (NULL); o markup do canal só é setado se a chave dele TAMBÉM vier presente com número, senão fica
  -- como estava; (3) chave do fixo AUSENTE e markup do canal PRESENTE e não-vazio → limpa o fixo (NULL) e grava o
  -- markup — "última edição manda" original, preservado byte a byte (era o ÚNICO jeito de limpar o fixo antes do
  -- J2); (4) nenhuma das duas chaves presentes/preenchidas → nada muda (outros gravadores não mandam as chaves).
  if coalesce(nullif(_dados->>'preco_atacado_fixo','')::numeric, 1) <= 0
     or coalesce(nullif(_dados->>'preco_varejo_fixo','')::numeric, 1) <= 0 then
    raise exception 'O preço precisa ser maior que zero.' using errcode = 'P0001';
  end if;
  update public.produtos_importados p
     set preco_atacado_fixo = n.af, markup_atacado = n.am, preco_varejo_fixo = n.vf, markup_varejo = n.vm
    from (select
            case when _dados ? 'preco_atacado_fixo' then nullif(_dados->>'preco_atacado_fixo','')::numeric
                 when nullif(_dados->>'markup_atacado','') is not null then null
                 else x.preco_atacado_fixo end as af,
            case when _dados ? 'preco_atacado_fixo' and nullif(_dados->>'preco_atacado_fixo','') is not null then null
                 when _dados ? 'preco_atacado_fixo' then coalesce(nullif(_dados->>'markup_atacado','')::numeric, x.markup_atacado)
                 when nullif(_dados->>'markup_atacado','') is not null then nullif(_dados->>'markup_atacado','')::numeric
                 else x.markup_atacado end as am,
            case when _dados ? 'preco_varejo_fixo' then nullif(_dados->>'preco_varejo_fixo','')::numeric
                 when nullif(_dados->>'markup_varejo','') is not null then null
                 else x.preco_varejo_fixo end as vf,
            case when _dados ? 'preco_varejo_fixo' and nullif(_dados->>'preco_varejo_fixo','') is not null then null
                 when _dados ? 'preco_varejo_fixo' then coalesce(nullif(_dados->>'markup_varejo','')::numeric, x.markup_varejo)
                 when nullif(_dados->>'markup_varejo','') is not null then nullif(_dados->>'markup_varejo','')::numeric
                 else x.markup_varejo end as vm
            from public.produtos_importados x where x.id = v_id) n
   where p.id = v_id
     and (p.preco_atacado_fixo, p.markup_atacado, p.preco_varejo_fixo, p.markup_varejo) is distinct from (n.af, n.am, n.vf, n.vm);

  -- Variantes: estado completo (apaga e reinsere pela ordem recebida).
  delete from public.produto_importado_variantes where produto_importado_id = v_id;
  for rec in select * from jsonb_array_elements(coalesce(_variantes,'[]'::jsonb)) loop
    insert into public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
    values (v_tenant, v_id, coalesce((rec->>'ordem')::int, 0),
      nullif(rec->>'cor_id','')::uuid, nullif(rec->>'cor_apelido_id','')::uuid,
      coalesce((rec->>'peso')::numeric,0), coalesce((rec->>'qtd')::int,0));
  end loop;

  -- Etapas: estado completo.
  delete from public.produto_importado_etapas where produto_importado_id = v_id;
  for rec in select * from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) loop
    insert into public.produto_importado_etapas (tenant_id, produto_importado_id, ordem, rotulo, base, percentual, data_vencimento, cotacao)
    values (v_tenant, v_id, coalesce((rec->>'ordem')::int,0), nullif(rec->>'rotulo',''),
      coalesce(nullif(rec->>'base',''),'mercadoria'), coalesce((rec->>'percentual')::numeric,0),
      nullif(rec->>'data_vencimento','')::date, coalesce((rec->>'cotacao')::numeric,0));
  end loop;

  perform public._imp_recomputar_precos_modelo(v_id);
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.fn_preco_comprado_por_insumo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [leves L8, preco M2] NEUTRALIZADA pelo inverso (supabase/rollback/20261028200000_revenda_insumo_preco_down.sql): os 3
-- gatilhos de modelo_etiquetas ficam de pe, inertes (editar insumo volta a nao recalcular o preco do comprado). DROP dos
-- gatilhos/funcao so no _down_drop (horario calmo).
BEGIN
  RETURN NULL;
END
$function$;

DO $pos$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._pa_recomputar_precos_modelo(uuid)', '3782da3cce51571bad01df87974c48ab'),
      ('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)', 'e5473bb29fa559408093d1a82c6ac11f'),
      ('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)', '2f3a81d18248752c56a7bd386c8bfe69'),
      ('public.fn_preco_comprado_por_insumo()', '28dc17f09237af0b177e38ee2a1da92a')) v(s, m) LOOP
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l8 (volta): pos-condicao falhou - % nao voltou ao texto esperado (md5 %)', r.s, v_md5 USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT assinatura, acl FROM _l8v_acl_antes LOOP
    IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure(r.assinatura)) IS DISTINCT FROM r.acl THEN
      RAISE EXCEPTION 'leves_l8 (volta): pos-condicao falhou - a ACL de % mudou', r.assinatura USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger t WHERE t.tgname LIKE 'trg\_preco\_comprado\_insumo\_%'
        AND t.tgrelid = to_regclass('public.modelo_etiquetas')) <> 3 THEN
    RAISE EXCEPTION 'leves_l8 (volta): os 3 gatilhos deviam continuar de pe (inertes)' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
