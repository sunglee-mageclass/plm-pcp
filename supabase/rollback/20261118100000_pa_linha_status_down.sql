-- INVERSO da Task 1 (20261118100000_pa_linha_status.sql): devolve `_salvar_produto_acabado_core` ao texto EXATO da R13
-- (md5 43a9ec5e03ddd9d85e016cb1ca516843: sem linha_id/status) e REMOVE a coluna `produtos_acabados.status` (e o CHECK, que cai junto com ela).
--   public._salvar_produto_acabado_core(uuid,jsonb,jsonb)
--     ANTES  8380b15f5ae3ad9d581d3205cb23a4ec  (= Task 1; reaplicar o down quando ja esta na R13 = no-op)
--     DEPOIS 43a9ec5e03ddd9d85e016cb1ca516843  (= texto da R13)
--   Qualquer outro texto -> P0001 e nada muda.
-- ⚠ DROP COLUMN apaga os status gravados: RECUSA se houver algum produto com status e nao houver
--   SET LOCAL app.confirmo_apagar_status_produto = 'sim' (a linha do card nao e afetada: ela mora em modelos.linha_id, que fica).
-- ⚠ RECUSA tambem se o gate de "Criar card" da Task 3 (produto_reprovado_sem_card) ainda estiver vivo — reverta a Task 3 antes (LIFO).
-- ORDEM (LIFO): SITE da paridade primeiro (o front manda linha_id/status), depois Task 3 down, depois este.
-- Travas: DROP COLUMN = AccessExclusive em produtos_acabados (lock_timeout 1500ms; 55P03 = rodar de novo, horario calmo).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL statement_timeout = '15s';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_md5 text;
  v_n bigint;
BEGIN
  IF to_regprocedure('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'pa_linha_status_down: _salvar_produto_acabado_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)')));
  IF v_md5 NOT IN ('8380b15f5ae3ad9d581d3205cb23a4ec', '43a9ec5e03ddd9d85e016cb1ca516843') THEN
    RAISE EXCEPTION 'pa_linha_status_down: _salvar_produto_acabado_core mudou desde a Task 1 (md5 %) - outra frente mexeu; conferir antes de reverter', v_md5
      USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.prosrc LIKE '%produto_reprovado_sem_card%') THEN
    RAISE EXCEPTION 'pa_linha_status_down: o gate de Criar card (Task 3) ainda esta vivo - reverta a Task 3 antes (LIFO)' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'produtos_acabados'
                AND column_name = 'status') THEN
    EXECUTE 'SELECT count(*) FROM public.produtos_acabados WHERE status IS NOT NULL' INTO v_n;
    IF v_n > 0 AND coalesce(current_setting('app.confirmo_apagar_status_produto', true), '') <> 'sim' THEN
      RAISE EXCEPTION 'pa_linha_status_down: % produto(s) com status gravado seriam perdidos; confirme com SET LOCAL app.confirmo_apagar_status_produto = ''sim''', v_n
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
END $guarda$;

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
$function$
;

REVOKE EXECUTE ON FUNCTION public._salvar_produto_acabado_core(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.produtos_acabados DROP COLUMN IF EXISTS status;

DO $pos$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)'))) <> '43a9ec5e03ddd9d85e016cb1ca516843' THEN
    RAISE EXCEPTION 'pa_linha_status_down: pos-condicao - o corpo nao voltou ao texto da R13' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('public', to_regprocedure('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'pa_linha_status_down: pos-condicao - _core com EXECUTE para PUBLIC/anon/authenticated (inv. #9)' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'produtos_acabados' AND column_name = 'status') THEN
    RAISE EXCEPTION 'pa_linha_status_down: pos-condicao - a coluna status ainda existe' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
