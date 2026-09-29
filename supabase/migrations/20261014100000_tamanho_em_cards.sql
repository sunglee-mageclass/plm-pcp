-- "Tamanho em" nos cards do Plan. Tecido, Produto Acabado e Importado (D2 do SKU, P-85 A; P-118 A, P-119 A, P-120 A).
-- Plano: .superpowers/sdd/2026-09-29-tamanho-em/plan.md (Tarefa 1 + rulings do G-plano). GERADA por
-- .superpowers/sdd/2026-09-29-tamanho-em/mig/gerar_sql.py a partir do texto VIVO da cópia — NÃO editar à mão.
-- • fn_produto_tamanho_tipo_handover: o repasse produto -> modelo espelho troca sempre que DIFERE (era "só se o modelo
--   não tinha" e o default 'letra' do modelo engolia a escolha do produto). Modelo integravel/integrado recusa 42501
--   (trg_zz_integracao_trava, invariante #14) => trocar o "Tamanho em" de um produto travado ABORTA o Salvar dele.
-- • _salvar_produto_acabado_core / _salvar_produto_importado_core: aceitam _dados.tamanho_tipo (só com a chave;
--   letra|numero, senão P0001 ASCII); o bloco [integracao v1] do importado fica intocado. _limpar_*: zeram o valor.
-- • _replicar_produtos_acabados_core / _replicar_produtos_importados_core: a réplica leva o "Tamanho em" do card.
-- • plan_tecido_slots.tamanho_tipo (nova, text, CHECK letra|numero NOT VALID): a vaga SEM card guarda a escolha (P-119 A).
--   _salvar_plan_tecido_core grava na vaga sem card; na vaga COM card, só com tamanho_tipo_tocado=true atualiza o
--   modelo (filtro loja + coleção + interno; valor validado P0001); _plan_tecido_arvore_core devolve o do modelo (com
--   card) ou o da vaga; _plan_tecido_criar_card_core cria o modelo com o da vaga salva (senão payload, senão letra) e
--   zera a vaga; _replicar_cards_plan_tecido_core zera a vaga livre reaproveitada; _plan_tecido_snapshot leva a chave.
-- • 12 funções redefinidas (guarda md5 aceita ANTES ou DEPOIS — reaplicar é no-op; outro texto -> P0001), 0 novas,
--   0 gatilhos novos; REVOKE EXECUTE dos TRES (PUBLIC, anon, authenticated) reafirmado nas 12; sem backfill.
-- • Ordem: funções plpgsql -> coluna/CHECK/COMMENT (trava curta em plan_tecido_slots) -> árvore (LANGUAGE sql valida a
--   coluna no CREATE) -> REVOKE -> pós-condição (md5 de depois das 12, ACL, coluna/CHECK) -> NOTIFY -> COMMIT.
-- • Banco ANTES do front (front velho + banco novo = compatível). Inverso:
--   supabase/rollback/20261014100000_tamanho_em_cards_down.sql (LIFO: volta ANTES do inverso da cor no nome
--   (20261013100000) e das voltas da Integração 5, da Distribuição e da F3.5a; o FRONT volta antes do banco).
-- • Numeração = ordem de aplicação: vai DEPOIS da 20261013100000 (cor no nome, já em produção) e da 20261010100000
--   (Distribuição parte 2); renumerada de 20261011100000 em 29/set. Nenhuma das 12 funções é redefinida por elas.
-- Aplicar fora de transação (psql -f), com o client_encoding abaixo ANTES do BEGIN (os textos têm acento).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public.fn_produto_tamanho_tipo_handover()') IS NULL THEN
    RAISE EXCEPTION 'tamanho_em: fn_produto_tamanho_tipo_handover nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public.fn_produto_tamanho_tipo_handover()'::regprocedure));
  IF v_md5 NOT IN ('16f03fe8cce7f92a8bbe77ad0d2c7e5a', '2712720482d94963ffda1b807fdf6931') THEN
    RAISE EXCEPTION 'tamanho_em: fn_produto_tamanho_tipo_handover mudou desde o planejamento (md5 %) - outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._replicar_produtos_acabados_core(uuid,uuid,uuid,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'tamanho_em: _replicar_produtos_acabados_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._replicar_produtos_acabados_core(uuid,uuid,uuid,uuid[])'::regprocedure));
  IF v_md5 NOT IN ('bb39e1ce5681e944160e59b71a28d206', '5aa4cf782687fe1dec96d18ef4d2923d') THEN
    RAISE EXCEPTION 'tamanho_em: _replicar_produtos_acabados_core mudou desde o planejamento (md5 %) - outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._replicar_produtos_importados_core(uuid,uuid,uuid,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'tamanho_em: _replicar_produtos_importados_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._replicar_produtos_importados_core(uuid,uuid,uuid,uuid[])'::regprocedure));
  IF v_md5 NOT IN ('150dbbca4cba9e4523427552bcd7e5c3', 'dc37b0adf427d1b2f6bca71a8d755ae0') THEN
    RAISE EXCEPTION 'tamanho_em: _replicar_produtos_importados_core mudou desde o planejamento (md5 %) - outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'tamanho_em: _salvar_produto_acabado_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)'::regprocedure));
  IF v_md5 NOT IN ('fd05edfc91464798639d761110607d30', '20f8e442b95f8bb02bc8201b431c21b1') THEN
    RAISE EXCEPTION 'tamanho_em: _salvar_produto_acabado_core mudou desde o planejamento (md5 %) - outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'tamanho_em: _salvar_produto_importado_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'::regprocedure));
  IF v_md5 NOT IN ('d29c80190739b780523a3a4d4a175f08', '2f3a81d18248752c56a7bd386c8bfe69') THEN
    RAISE EXCEPTION 'tamanho_em: _salvar_produto_importado_core mudou desde o planejamento (md5 %) - outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._limpar_produto_acabado_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'tamanho_em: _limpar_produto_acabado_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._limpar_produto_acabado_core(uuid)'::regprocedure));
  IF v_md5 NOT IN ('5e93aa82de5cf6f24faa25ba2d7891af', '123ddc5a717d896bc38193806769ccae') THEN
    RAISE EXCEPTION 'tamanho_em: _limpar_produto_acabado_core mudou desde o planejamento (md5 %) - outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._limpar_produto_importado_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'tamanho_em: _limpar_produto_importado_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._limpar_produto_importado_core(uuid)'::regprocedure));
  IF v_md5 NOT IN ('b1b89e0d2020d0de4c32b1448872ab08', '5fe6e90f2a96881614f45f84f9865bdd') THEN
    RAISE EXCEPTION 'tamanho_em: _limpar_produto_importado_core mudou desde o planejamento (md5 %) - outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._salvar_plan_tecido_core(uuid,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'tamanho_em: _salvar_plan_tecido_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._salvar_plan_tecido_core(uuid,jsonb,integer)'::regprocedure));
  IF v_md5 NOT IN ('58fcaddadee3c7ab8cac44c0597c9368', '81a3606444a2cf68ee376937009b9bad') THEN
    RAISE EXCEPTION 'tamanho_em: _salvar_plan_tecido_core mudou desde o planejamento (md5 %) - outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._plan_tecido_criar_card_core(uuid,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'tamanho_em: _plan_tecido_criar_card_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._plan_tecido_criar_card_core(uuid,uuid,jsonb)'::regprocedure));
  IF v_md5 NOT IN ('3a398cfecbfd8c434e998fc781a71f0b', 'fceac02c52bd0b29a33856dc9e0f9b11') THEN
    RAISE EXCEPTION 'tamanho_em: _plan_tecido_criar_card_core mudou desde o planejamento (md5 %) - outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._plan_tecido_snapshot(uuid)') IS NULL THEN
    RAISE EXCEPTION 'tamanho_em: _plan_tecido_snapshot nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._plan_tecido_snapshot(uuid)'::regprocedure));
  IF v_md5 NOT IN ('75d43c800b38b08c77831a645dcb4b3d', '2c2ba1e79ab311b2c5ba8080cac958e9') THEN
    RAISE EXCEPTION 'tamanho_em: _plan_tecido_snapshot mudou desde o planejamento (md5 %) - outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)') IS NULL THEN
    RAISE EXCEPTION 'tamanho_em: _replicar_cards_plan_tecido_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)'::regprocedure));
  IF v_md5 NOT IN ('cd89885741a32a63cbfa899d31ac0661', 'aaf3f2e4e4bd8eb14b99d53c79a653da') THEN
    RAISE EXCEPTION 'tamanho_em: _replicar_cards_plan_tecido_core mudou desde o planejamento (md5 %) - outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._plan_tecido_arvore_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'tamanho_em: _plan_tecido_arvore_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef('public._plan_tecido_arvore_core(uuid)'::regprocedure));
  IF v_md5 NOT IN ('137774116f4ec7fad102b6754a6decf3', '5111f417c2679a4bb2157ad0df61f55a') THEN
    RAISE EXCEPTION 'tamanho_em: _plan_tecido_arvore_core mudou desde o planejamento (md5 %) - outra frente mexeu; refazer dump + gerar', v_md5 USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public.fn_produto_tamanho_tipo_handover()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.modelo_id IS NOT NULL AND NEW.tamanho_tipo IS NOT NULL THEN
    UPDATE public.modelos m
       SET tamanho_tipo = NEW.tamanho_tipo
     WHERE m.id = NEW.modelo_id
       AND m.tenant_id = NEW.tenant_id
       -- [tamanho-em v1] o produto manda (P-85 A): troca o do modelo espelho sempre que DIFERE (antes: só se o modelo
       -- não tinha, e o default 'letra' do modelo fazia o valor do produto se perder). Modelo integravel/integrado
       -- recusa com 42501 via trg_zz_integracao_trava (invariante #14) — o Salvar do produto aborta inteiro.
       AND m.tamanho_tipo IS DISTINCT FROM NEW.tamanho_tipo;
    NEW.tamanho_tipo := NULL;
  END IF;
  RETURN NEW;
END
$function$
;

CREATE OR REPLACE FUNCTION public._replicar_produtos_acabados_core(_tenant uuid, _destino_colecao_id uuid, _destino_subcolecao_id uuid, _produto_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Coleção destino da loja + nome (produtos_acabados guarda subcolecao TEXTO).
  select nome into v_col_nome from public.colecoes where id = _destino_colecao_id and tenant_id = _tenant;
  if v_col_nome is null then raise exception 'Coleção de destino não encontrada' using errcode = 'P0001'; end if;
  if _destino_subcolecao_id is not null then
    select nome into v_sub_nome from public.colecao_subcolecoes
      where id = _destino_subcolecao_id and colecao_id = _destino_colecao_id and tenant_id = _tenant;
    if v_sub_nome is null then raise exception 'Subcoleção de destino inválida' using errcode = 'P0001'; end if;
  end if;

  for o in select * from public.produtos_acabados
           where id = any(_produto_ids) and tenant_id = _tenant for update loop
    -- Só replica quem tem card materializado (precisamos da raiz da família p/ versionar).
    if o.modelo_id is null then continue; end if;
    select * into om from public.modelos where id = o.modelo_id and tenant_id = _tenant;
    if not found then continue; end if;

    -- Versão: raiz da família + max(versao)+1 (laço de versão, como Plan.Tecido/Importado).
    v_root := coalesce(om.modelo_base_id, om.id);
    select coalesce(max(versao),0)+1 into v_versao from public.modelos
      where tenant_id = _tenant and (id = v_root or modelo_base_id = v_root);

    -- (1) Copia produtos_acabados p/ o destino. REF MANTIDA do original (o mesmo produto — a
    --     diferenciação é só o versionamento do espelho `modelos`). Passar `o.ref` faz o trigger
    --     fn_produto_acabado_ref NÃO gerar outra (ele só gera quando ref vem vazia). modelo_id NULL
    --     (setado abaixo). mix_id NÃO copiado: a família (colecao_mixes) é escopada por
    --     (colecao_id, subcolecao); a réplica vai p/ OUTRO destino, então herdar o mix da ORIGEM
    --     apontaria p/ família de outra subcoleção (órfão). Réplica nasce sem família (mix_id null).
    insert into public.produtos_acabados (
      tenant_id, modelo_id, nome, ref, grupo_id, categoria_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, empresa_id, representante_id, ref_fornecedor, composicao,
      grade_proporcao, qtd_total, valor_unitario, desconto_pct, insumos_total, markup_atacado, markup_varejo
    ) values (
      _tenant, null, o.nome, o.ref, o.grupo_id, o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,
      _destino_colecao_id, v_sub_nome, o.semana, o.empresa_id, o.representante_id, o.ref_fornecedor, o.composicao,
      o.grade_proporcao, o.qtd_total, o.valor_unitario, o.desconto_pct, o.insumos_total, o.markup_atacado, o.markup_varejo
    ) returning id into v_novo_produto;

    -- (2) Variantes.
    insert into public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
      select _tenant, v_novo_produto, ordem, cor_id, cor_apelido_id, peso, qtd
      from public.produto_acabado_variantes where produto_acabado_id = o.id;

    -- (3) Espelho modelos VERSIONADO (origem='revenda'). REF = a do produto (= a do original,
    --     mantida acima); revenda passa por FORA do fluxo ref_auto→aprovar. versao/modelo_base_id
    --     distinguem. mix_id null (família não migra p/ outra subcoleção — ver comentário no INSERT do produto).
    insert into public.modelos (
      tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, ref, linha_id, modelo_base_id, versao, tamanho_tipo
    )
    select _tenant, o.nome, 'revenda', o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,
           _destino_colecao_id, v_sub_nome, o.semana, pa.ref, null, v_root, v_versao,
           coalesce(om.tamanho_tipo, 'letra')  -- [tamanho-em v1] a réplica leva o "Tamanho em" do card de origem
    from public.produtos_acabados pa where pa.id = v_novo_produto
    returning id into v_novo_modelo;

    update public.produtos_acabados set modelo_id = v_novo_modelo, updated_at = now() where id = v_novo_produto;

    -- modelo_grades por variante (mesma lógica de _criar_card_produto_acabado_core).
    for rec in select ordem, qtd from public.produto_acabado_variantes where produto_acabado_id = v_novo_produto loop
      v_grade := public._pa_grade_variante(o.grupo_id, o.grade_proporcao, rec.qtd);
      select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
      insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
      values (v_novo_modelo, rec.ordem, v_grade, v_total::int);
    end loop;

    perform public._pa_recomputar_precos_modelo(v_novo_produto);

    v_out := v_out || jsonb_build_object('origem_produto_id', o.id, 'novo_produto_id', v_novo_produto, 'novo_modelo_id', v_novo_modelo);
  end loop;

  return v_out;
end $function$
;

CREATE OR REPLACE FUNCTION public._replicar_produtos_importados_core(_tenant uuid, _destino_colecao_id uuid, _destino_subcolecao_id uuid, _produto_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- (3) Espelho modelos VERSIONADO (origem='importado'). REF copiada direto (fluxo de revenda/
    --     importado passa por fora do ref_auto — a REF do produto já foi gerada acima).
    insert into public.modelos (
      tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
      colecao_id, subcolecao, semana, ref, linha_id, modelo_base_id, versao, tamanho_tipo
    )
    select _tenant, o.nome, 'importado', o.categoria_id, o.subcategoria1_id, o.subcategoria2_id,
           _destino_colecao_id, v_sub_nome, o.semana, pi.ref, null, v_root, v_versao,
           coalesce(om.tamanho_tipo, 'letra')  -- [tamanho-em v1] a réplica leva o "Tamanho em" do card de origem
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
end $function$
;

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
      where id = _id and tenant_id = v_tenant;
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

  perform public._pa_recomputar_precos_modelo(v_id);

  return v_id;
end;
$function$
;

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
end $function$
;

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
    tamanho_tipo = null,  -- [tamanho-em v1]
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
    tamanho_tipo = null,  -- [tamanho-em v1]
    updated_at = now()
  where id = _produto_id and tenant_id = v_tenant;

  delete from public.produto_importado_variantes where produto_importado_id = _produto_id;
  delete from public.produto_importado_etapas where produto_importado_id = _produto_id;
end $function$
;

CREATE OR REPLACE FUNCTION public._salvar_plan_tecido_core(_colecao_id uuid, _arvore jsonb, _rev_base integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_plan uuid;
  v_sub jsonb; v_ln jsonb; v_slot jsonb; v_mat jsonb; v_var jsonb;
  v_sub_id uuid; v_ln_id uuid; v_slot_id uuid; v_mat_id uuid;
  v_slot_oc jsonb;
  v_tt text;  -- [tamanho-em v1]
begin
  -- [NOVO] guarda de tenant incondicional (não depende de _rev_base) — fecha o IDOR
  -- de escrita cross-tenant: antes disso, o filtro de tenant só existia dentro do
  -- bloco da trava otimista, que não roda quando _rev_base é null.
  if not exists (
    select 1 from public.colecoes c
    where c.id = _colecao_id
      and (c.tenant_id = public.get_user_tenant_id() or public.is_super_admin())
  ) then
    raise exception 'Coleção não encontrada ou sem permissão.';
  end if;

  -- trava otimista (spec 2026-08-03)
  if _rev_base is not null then
    declare v_rev int;
    begin
      select plan_rev into v_rev from public.colecoes
        where id = _colecao_id and (tenant_id = public.get_user_tenant_id() or public.is_super_admin())
        for update;
      if v_rev is distinct from _rev_base then
        raise exception 'conflito_versao: o registro foi salvo por outra pessoa'
          using errcode = 'P0409';
      end if;
    end;
  end if;

  insert into plan_tecido (colecao_id) values (_colecao_id)
    on conflict (colecao_id) do update set updated_at = now()
    returning id into v_plan;

  -- [BLINDAGEM 1] snapshot do ESTADO ANTERIOR da árvore (antes de qualquer delete/reinsert).
  perform public._plan_tecido_snapshot(v_plan);

  -- captura a OC-por-SLOT de TODOS os slots ANTES do delete (o slot_oc cascateia no delete)
  select coalesce(jsonb_agg(distinct jsonb_build_object('s', so.slot_id, 'o', so.oc_tecido_id)), '[]'::jsonb)
    into v_slot_oc
  from plan_tecido_slot_oc so
  join plan_tecido_slots sl on sl.id = so.slot_id
  join plan_tecido_linhas l on l.id = sl.linha_ref_id
  join plan_tecido_subcolecoes s on s.id = l.sub_id
  where s.plan_id = v_plan;

  delete from plan_tecido_subcolecoes where plan_id = v_plan;  -- cascateia subcolecao_categorias + slot_oc
  for v_sub in select * from jsonb_array_elements(coalesce(_arvore->'subcolecoes','[]'::jsonb)) loop
    insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
      values (v_plan, nullif(v_sub->>'subcolecao_id','')::uuid, coalesce((v_sub->>'ordem')::int,0))
      returning id into v_sub_id;
    insert into plan_tecido_subcolecao_categorias (subcolecao_id, categoria_id, ordem)
      select v_sub_id, nullif(t.val,'')::uuid, t.ord
      from jsonb_array_elements_text(coalesce(v_sub->'categorias_tecido','[]'::jsonb)) with ordinality as t(val, ord)
      where nullif(t.val,'') is not null
      on conflict (subcolecao_id, categoria_id) do nothing;
    for v_ln in select * from jsonb_array_elements(coalesce(v_sub->'linhas','[]'::jsonb)) loop
      insert into plan_tecido_linhas (sub_id, linha_id, categoria_id, ordem)
        values (v_sub_id, nullif(v_ln->>'linha_id','')::uuid, nullif(v_ln->>'categoria_id','')::uuid, coalesce((v_ln->>'ordem')::int,0))
        returning id into v_ln_id;
      for v_slot in select * from jsonb_array_elements(coalesce(v_ln->'slots','[]'::jsonb)) loop
        -- [tamanho-em v1] "Tamanho em" (P-119 A): a vaga SEM card guarda a escolha; com card ele mora no modelo.
        -- Valida SÓ onde o valor é gravado (vaga sem card; o "tocado" valida abaixo): na vaga COM card sem a marca o
        -- valor é descartado — um legado fora do domínio no modelo (CHECK NOT VALID) não pode travar o Salvar inteiro.
        v_tt := nullif(v_slot->>'tamanho_tipo', '');
        if v_tt is not null and v_tt not in ('letra', 'numero') and nullif(v_slot->>'modelo_id','') is null then
          raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';
        end if;
        insert into plan_tecido_slots (id, linha_ref_id, modelo_id, slot_index, nome, custo_simulado,
          custo_terceirizados_previsto, custos_adicionais, preco_venda, categoria_id, usar_estoque, proporcoes,
          categoria_tecido_id, mix_id, referencia_paths, tamanho_tipo)
          values (coalesce(nullif(v_slot->>'id','')::uuid, gen_random_uuid()),  -- PRESERVA o id do slot
            v_ln_id, nullif(v_slot->>'modelo_id','')::uuid, coalesce((v_slot->>'slot_index')::int,0),
            v_slot->>'nome', v_slot->'custo_simulado',
            nullif(v_slot->>'custo_terceirizados_previsto','')::numeric,
            coalesce(v_slot->'custos_adicionais','[]'::jsonb),
            nullif(v_slot->>'preco_venda','')::numeric,
            nullif(v_slot->>'categoria_id','')::uuid,
            coalesce((v_slot->>'usar_estoque')::boolean, false),
            v_slot->'proporcoes',
            nullif(v_slot->>'categoria_tecido_id','')::uuid,
            nullif(v_slot->>'mix_id','')::uuid,
            coalesce((select array_agg(t.x) from jsonb_array_elements_text(coalesce(v_slot->'referencia_paths','[]'::jsonb)) t(x)), '{}'),
            case when nullif(v_slot->>'modelo_id','') is null then v_tt end)  -- [tamanho-em v1] com card: NULL
          returning id into v_slot_id;
        -- [tamanho-em v1] vaga COM card: grava no modelo SÓ quando a tela marca tamanho_tipo_tocado (a pessoa trocou).
        -- Filtro loja + coleção + interno fecha o IDOR do modelo_id vindo do cliente (fora dele: ignorado) e espelha a
        -- tela (o toggle só existe no interno). Card integravel/integrado recusa 42501 via trg_zz_integracao_trava.
        if nullif(v_slot->>'modelo_id','') is not null and coalesce(v_slot->>'tamanho_tipo_tocado', '') = 'true' then
          if v_tt is null or v_tt not in ('letra', 'numero') then
            raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';
          end if;
          update public.modelos m set tamanho_tipo = v_tt
           where m.id = (v_slot->>'modelo_id')::uuid
             and m.tenant_id = (select c.tenant_id from public.colecoes c where c.id = _colecao_id)
             and m.colecao_id = _colecao_id
             and coalesce(m.origem, 'interno') = 'interno'
             and m.tamanho_tipo is distinct from v_tt;
        end if;
        for v_mat in select * from jsonb_array_elements(coalesce(v_slot->'materiais','[]'::jsonb)) loop
          insert into plan_tecido_materiais (slot_id, artigo_id, tipo, numero, consumo, loss_percent, ordem)
            values (v_slot_id, nullif(v_mat->>'artigo_id','')::uuid, coalesce(v_mat->>'tipo','tecido'),
              coalesce((v_mat->>'numero')::int,1), coalesce((v_mat->>'consumo')::numeric,0),
              coalesce((v_mat->>'loss_percent')::numeric,0), coalesce((v_mat->>'ordem')::int,0))
            returning id into v_mat_id;
          -- [DEDUP] variante repetida (mesma cor real, ou mesma cor planejada) só entra 1× por
          -- material — mantém a de MAIOR grade_total (empate → menor ordem/posição original);
          -- linha sem identidade (variante e cor nulos) nunca colapsa. NUNCA soma. Ordem 1..n.
          insert into plan_tecido_variantes (material_id, variante_tecido_id, cor_id, cor_apelido_id, ordem, multiplicador, grades, grade_total, distribuicao, atende)
          select v_mat_id, w.variante_tecido_id, w.cor_id, w.cor_apelido_id,
                 (row_number() over (order by w.ord_min, w.pos_min))::int,
                 w.multiplicador, w.grades, w.grade_total, w.distribuicao, w.atende
          from (
            select r.*,
                   row_number() over (partition by r.dkey order by r.grade_total desc, r.ord_orig asc, r.pos asc) as rn,
                   min(r.ord_orig) over (partition by r.dkey) as ord_min,
                   min(r.pos)      over (partition by r.dkey) as pos_min
            from (
              select
                nullif(e->>'variante_tecido_id','')::uuid  as variante_tecido_id,
                nullif(e->>'cor_id','')::uuid              as cor_id,
                nullif(e->>'cor_apelido_id','')::uuid      as cor_apelido_id,
                coalesce((e->>'multiplicador')::numeric,1) as multiplicador,
                coalesce(e->'grades','{}'::jsonb)          as grades,
                coalesce((e->>'grade_total')::int,0)       as grade_total,
                -- Distribuição por produto (20261006100000): `distribuicao` SÓ no Tecido 1 e só objeto; `atende` SÓ fora
                -- do Tecido 1 e só array (o DEDUP leva as da linha vencedora).
                case when coalesce(v_mat->>'tipo','tecido') = 'tecido' and coalesce((v_mat->>'numero')::int,1) = 1 and jsonb_typeof(e->'distribuicao') = 'object'
                     then e->'distribuicao' else '{}'::jsonb end as distribuicao,
                case when not (coalesce(v_mat->>'tipo','tecido') = 'tecido' and coalesce((v_mat->>'numero')::int,1) = 1) and jsonb_typeof(e->'atende') = 'array'
                     then e->'atende' else null end as atende,
                coalesce((e->>'ordem')::int, pos::int)     as ord_orig,
                pos,
                case
                  when nullif(e->>'variante_tecido_id','') is not null
                    then 'v:'||(e->>'variante_tecido_id')
                  when nullif(e->>'cor_id','') is not null or nullif(e->>'cor_apelido_id','') is not null
                    then 'p:'||coalesce(e->>'cor_id','')||'|'||coalesce(e->>'cor_apelido_id','')
                  else 'n:'||pos::text
                end as dkey
              from jsonb_array_elements(coalesce(v_mat->'variantes','[]'::jsonb)) with ordinality as t(e, pos)
            ) r
          ) w
          where w.rn = 1;
        end loop;
      end loop;
    end loop;
  end loop;

  -- re-liga o slot_oc pelos ids PRESERVADOS (slots que continuam existindo)
  if jsonb_array_length(v_slot_oc) > 0 then
    insert into plan_tecido_slot_oc (colecao_id, slot_id, oc_tecido_id)
      select _colecao_id, (e->>'s')::uuid, (e->>'o')::uuid
      from jsonb_array_elements(v_slot_oc) e
      join plan_tecido_slots sl on sl.id = (e->>'s')::uuid
      join plan_tecido_linhas l on l.id = sl.linha_ref_id
      join plan_tecido_subcolecoes s on s.id = l.sub_id
      where s.plan_id = v_plan
      on conflict (slot_id, oc_tecido_id) do nothing;
  end if;

  -- bump da árvore do Plan. Tecido: NÃO precisa de update manual aqui. O insert/upsert em
  -- plan_tecido (topo desta função) já dispara trg_colab_bump (Task 1) → fn_colab_bump_plan()
  -- → UPDATE no-op em colecoes → trg_colab_plan_rev incrementa plan_rev em exatamente 1.
  -- (Um update explícito aqui SOMARIA um 2º bump — foi removido no fix round da revisão.)

  return v_plan;
end $function$
;

CREATE OR REPLACE FUNCTION public._plan_tecido_criar_card_core(_tenant uuid, _colecao_id uuid, _slot jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_mid uuid; v_mes uuid; v_ano uuid; v_sub text;
  v_tt text;  -- [tamanho-em v1]
begin
  if (select tenant_id from colecoes where id = _colecao_id) is distinct from _tenant then
    raise exception 'Coleção de outra loja.' using errcode = '42501';
  end if;
  select mes_id, ano_id into v_mes, v_ano from colecoes where id = _colecao_id;
  v_sub := nullif(_slot->>'subcolecao_nome','');
  if v_sub is null and nullif(_slot->>'subcolecao_id','') is not null then
    select nome into v_sub from colecao_subcolecoes where id = (_slot->>'subcolecao_id')::uuid and tenant_id = _tenant;
  end if;

  -- [tamanho-em v1] "Tamanho em" do card = o da VAGA SALVA (P-119 A); sem vaga salva com valor, o do payload
  -- (validado); senão Letra.
  v_tt := nullif(_slot->>'tamanho_tipo', '');
  if v_tt is not null and v_tt not in ('letra', 'numero') then
    raise exception 'tamanho_tipo invalido: use letra ou numero' using errcode = 'P0001';
  end if;
  if nullif(_slot->>'slot_id','') is not null then
    v_tt := coalesce((select sl.tamanho_tipo from plan_tecido_slots sl
                       where sl.id = (_slot->>'slot_id')::uuid and sl.tenant_id = _tenant), v_tt);
  end if;

  insert into modelos (tenant_id, nome, colecao_id, subcolecao, linha_id, categoria_principal_id,
                       mes_id, ano_id, preco_venda, custo_terceirizados_previsto, custo_simulado,
                       origem, status_planejamento, mix_id, tamanho_tipo)
  values (_tenant,
          coalesce(nullif(_slot->>'nome',''), nullif(_slot->>'ref',''), 'Novo modelo (Plan. Tecido)'),
          _colecao_id, v_sub,
          nullif(_slot->>'linha_id','')::uuid, nullif(_slot->>'categoria_id','')::uuid,
          v_mes, v_ano,
          nullif(_slot->>'preco_venda','')::numeric,
          coalesce(nullif(_slot->>'custo_terceirizados_previsto','')::numeric, 0),
          coalesce(_slot->'custo_simulado', '{}'::jsonb),
          'interno', 'em_planejamento',
          nullif(_slot->>'mix_id','')::uuid,   -- herda o mix reservado pela vaga (decisão 9)
          coalesce(v_tt, 'letra'))  -- [tamanho-em v1]
  returning id into v_mid;

  perform public._plan_tecido_gravar_bom_core(v_mid, _slot->'materiais');

  -- [G4] migra referências do slot (se houver) para o modelo recém-criado.
  update modelos set fotos_referencia = fotos_referencia || (
    select coalesce(array_agg(t.x),'{}') from jsonb_array_elements_text(coalesce(_slot->'referencia_paths','[]'::jsonb)) t(x)
  ) where id = v_mid and jsonb_array_length(coalesce(_slot->'referencia_paths','[]'::jsonb)) > 0;

  -- vincula o slot do plano ao modelo criado (persistente; some o botão "Criar card")
  if nullif(_slot->>'slot_id','') is not null then
    update plan_tecido_slots set modelo_id = v_mid, tamanho_tipo = null  -- [tamanho-em v1] com card, a vaga fica NULL
    where id = (_slot->>'slot_id')::uuid and tenant_id = _tenant;
  end if;

  return v_mid;
end $function$
;

CREATE OR REPLACE FUNCTION public._plan_tecido_snapshot(_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_col uuid; v_tenant uuid;
  v_arvore jsonb; v_slot_oc jsonb;
begin
  if not exists (select 1 from plan_tecido_subcolecoes where plan_id = _plan_id) then
    return;  -- nada a snapshotar (plano novo / vazio)
  end if;

  select pt.colecao_id, c.tenant_id into v_col, v_tenant
  from plan_tecido pt join colecoes c on c.id = pt.colecao_id
  where pt.id = _plan_id;
  if v_tenant is null then return; end if;

  select jsonb_build_object('subcolecoes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'subcolecao_id', s.subcolecao_id,
      'ordem', s.ordem,
      'categorias_tecido', coalesce((
        select jsonb_agg(sc.categoria_id order by sc.ordem)
        from plan_tecido_subcolecao_categorias sc where sc.subcolecao_id = s.id), '[]'::jsonb),
      'linhas', coalesce((
        select jsonb_agg(jsonb_build_object(
          'linha_id', l.linha_id, 'categoria_id', l.categoria_id, 'ordem', l.ordem,
          'slots', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', sl.id, 'modelo_id', sl.modelo_id, 'slot_index', sl.slot_index,
              'nome', sl.nome, 'custo_simulado', sl.custo_simulado,
              'custo_terceirizados_previsto', sl.custo_terceirizados_previsto,
              'custos_adicionais', sl.custos_adicionais, 'preco_venda', sl.preco_venda,
              'categoria_id', sl.categoria_id, 'usar_estoque', sl.usar_estoque,
              'proporcoes', sl.proporcoes, 'categoria_tecido_id', sl.categoria_tecido_id,
              'tamanho_tipo', sl.tamanho_tipo,  -- [tamanho-em v1]
              'materiais', coalesce((
                select jsonb_agg(jsonb_build_object(
                  'artigo_id', pm.artigo_id, 'tipo', pm.tipo, 'numero', pm.numero,
                  'consumo', pm.consumo, 'loss_percent', pm.loss_percent, 'ordem', pm.ordem,
                  'variantes', coalesce((
                    select jsonb_agg(jsonb_build_object(
                      'variante_tecido_id', pv.variante_tecido_id, 'cor_id', pv.cor_id,
                      'cor_apelido_id', pv.cor_apelido_id, 'ordem', pv.ordem,
                      'multiplicador', pv.multiplicador, 'grades', pv.grades,
                      'grade_total', pv.grade_total,
                      'distribuicao', pv.distribuicao, 'atende', pv.atende
                    ) order by pv.ordem)
                    from plan_tecido_variantes pv where pv.material_id = pm.id), '[]'::jsonb)
                ) order by pm.ordem)
                from plan_tecido_materiais pm where pm.slot_id = sl.id), '[]'::jsonb)
            ) order by sl.slot_index)
            from plan_tecido_slots sl where sl.linha_ref_id = l.id), '[]'::jsonb)
        ) order by l.ordem)
        from plan_tecido_linhas l where l.sub_id = s.id), '[]'::jsonb)
    ) order by s.ordem)
    from plan_tecido_subcolecoes s where s.plan_id = _plan_id), '[]'::jsonb))
  into v_arvore;

  select coalesce(jsonb_agg(jsonb_build_object('slot_id', so.slot_id, 'oc_tecido_id', so.oc_tecido_id)), '[]'::jsonb)
  into v_slot_oc
  from plan_tecido_slot_oc so
  join plan_tecido_slots sl on sl.id = so.slot_id
  join plan_tecido_linhas l on l.id = sl.linha_ref_id
  join plan_tecido_subcolecoes s on s.id = l.sub_id
  where s.plan_id = _plan_id;

  insert into plan_tecido_snapshots (tenant_id, plan_id, colecao_id, payload, user_id)
  values (v_tenant, _plan_id, v_col,
    jsonb_build_object('colecao_id', v_col, 'plan_id', _plan_id, 'arvore', v_arvore, 'slot_oc', v_slot_oc),
    auth.uid());

  -- retenção: 20 últimos por plan + apaga >60 dias
  delete from plan_tecido_snapshots ps
  where ps.plan_id = _plan_id
    and ps.id not in (
      select id from plan_tecido_snapshots where plan_id = _plan_id
      order by created_at desc, id desc limit 20);
  delete from plan_tecido_snapshots where plan_id = _plan_id and created_at < now() - interval '60 days';
end $function$
;

CREATE OR REPLACE FUNCTION public._replicar_cards_plan_tecido_core(_tenant uuid, _destino_colecao_id uuid, _destino_subcolecao_id uuid, _modelo_ids uuid[], _rev_base integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sub_nome text; v_col_nome text; v_mes uuid; v_ano uuid;
  v_plan uuid; v_sub_pt uuid; v_rev int;
  v_root uuid; v_versao int; v_novo uuid; v_slot uuid; v_slot_idx int; v_ln uuid;
  o record; mt_old record; v_novo_mt uuid; v_out jsonb := '[]'::jsonb;
begin
  -- (0) Guardas de tenant/destino.
  if _tenant is null or _tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inválida.' using errcode = '42501';
  end if;
  if (select tenant_id from colecoes where id = _destino_colecao_id) is distinct from _tenant then
    raise exception 'Coleção de destino de outra loja.' using errcode = '42501';
  end if;
  if _destino_subcolecao_id is not null then
    select nome into v_sub_nome from colecao_subcolecoes
      where id = _destino_subcolecao_id and colecao_id = _destino_colecao_id and tenant_id = _tenant;
    if v_sub_nome is null then
      raise exception 'Subcoleção de destino inválida.' using errcode = '42501';
    end if;
  end if;
  -- nome da coleção destino p/ a coluna TEXTO `modelos.colecao` (o card lê isso) + mes/ano.
  select nome, mes_id, ano_id into v_col_nome, v_mes, v_ano from colecoes where id = _destino_colecao_id;

  if exists (select 1 from modelos where id = any(_modelo_ids) and tenant_id = _tenant and origem = 'revenda') then
    raise exception 'Replicar cards de revenda ainda não é suportado.' using errcode = 'P0001';
  end if;

  -- (1) Trava otimista do DESTINO (só quando o front conhece o rev — destino == coleção aberta).
  if _rev_base is not null then
    select plan_rev into v_rev from colecoes where id = _destino_colecao_id for update;
    if coalesce(v_rev, 0) is distinct from _rev_base then
      raise exception 'conflito_versao: o registro foi salvo por outra pessoa' using errcode = 'P0409';
    end if;
  end if;

  -- (2) Garante plan_tecido + subcoleção-do-plano no DESTINO.
  insert into plan_tecido (colecao_id) values (_destino_colecao_id)
    on conflict (colecao_id) do update set updated_at = now()
    returning id into v_plan;

  if _destino_subcolecao_id is not null then
    insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
    values (v_plan, _destino_subcolecao_id,
            coalesce((select ordem from colecao_subcolecoes where id = _destino_subcolecao_id), 0))
    on conflict (plan_id, subcolecao_id) do update set ordem = excluded.ordem
    returning id into v_sub_pt;
  else
    select id into v_sub_pt from plan_tecido_subcolecoes
      where plan_id = v_plan and subcolecao_id is null limit 1;
    if v_sub_pt is null then
      insert into plan_tecido_subcolecoes (plan_id, subcolecao_id, ordem)
      values (v_plan, null, 0) returning id into v_sub_pt;
    end if;
  end if;

  -- (3) Por modelo origem.
  for o in select * from modelos where id = any(_modelo_ids) and tenant_id = _tenant for update loop
    v_root := coalesce(o.modelo_base_id, o.id);
    select coalesce(max(versao), 1) + 1 into v_versao
      from modelos where (id = v_root or modelo_base_id = v_root) and tenant_id = _tenant;

    -- Modelo novo: escalares + colecao TEXTO (v3) + custos stored (v3) + semana herdada.
    -- REF do original MANTIDA (copia ref/ref_auto — regra do dono; o card nasce
    -- ordem_criacao_enviada=false, então fn_modelo_ref_auto não sobrescreve).
    insert into modelos (
      tenant_id, nome, colecao, colecao_id, subcolecao, mes_id, ano_id,
      linha_id, categoria_principal_id, categoria_secundaria_id, subcategoria1_id, subcategoria2_id,
      estilista_id, modelista_id, piloteiro1_id, piloteiro2_id, piloteiro3_id,
      preco_venda, preco_atacado, markup_editado, proporcoes, custos_adicionais, custo_simulado,
      custo_terceirizados_previsto, custo_peca_previsto, custo_tecido_total, custo_forro_total,
      custo_entretela_total, custo_aviamento_total,
      observacoes_tecnicas, observacoes_gerais, observacoes_mao_obra,
      fotos_modelo, fotos_referencia, croqui_url, desenho_tecnico_url, tecidos_planejados,
      origem, status_planejamento, ordem_criacao_enviada, lancado, data_lancamento, semana,
      versao, modelo_base_id, mix_id, ref, ref_auto, descricao_produto, peso_kg, comprimento_cm, largura_cm, altura_cm, titulo_pagina, ncm, preco_anterior, tamanho_tipo
    ) values (
      _tenant, o.nome, v_col_nome, _destino_colecao_id, v_sub_nome, v_mes, v_ano,
      o.linha_id, o.categoria_principal_id, o.categoria_secundaria_id, o.subcategoria1_id, o.subcategoria2_id,
      o.estilista_id, o.modelista_id, o.piloteiro1_id, o.piloteiro2_id, o.piloteiro3_id,
      o.preco_venda, o.preco_atacado, o.markup_editado, o.proporcoes, o.custos_adicionais, coalesce(o.custo_simulado, '{}'::jsonb),
      o.custo_terceirizados_previsto, o.custo_peca_previsto, o.custo_tecido_total, o.custo_forro_total,
      o.custo_entretela_total, o.custo_aviamento_total,
      o.observacoes_tecnicas, o.observacoes_gerais, o.observacoes_mao_obra,
      o.fotos_modelo, o.fotos_referencia, o.croqui_url, o.desenho_tecnico_url, o.tecidos_planejados,
      'interno', 'em_planejamento', false, false, o.data_lancamento, o.semana,
      v_versao, v_root, o.mix_id, o.ref, o.ref_auto, o.descricao_produto, o.peso_kg, o.comprimento_cm, o.largura_cm, o.altura_cm, o.titulo_pagina, o.ncm, o.preco_anterior, o.tamanho_tipo
    ) returning id into v_novo;

    -- BOM PROFUNDO. Tecido/forro/entretela + variantes BLOCO-A-BLOCO (loop por bloco de origem).
    for mt_old in select * from modelo_tecidos where modelo_id = o.id order by numero, tipo, id loop
      insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent, custo_previsto)
      values (v_novo, mt_old.artigo_id, mt_old.numero, mt_old.tipo, mt_old.consumo, mt_old.loss_percent, mt_old.custo_previsto)
      returning id into v_novo_mt;
      insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador, complementa_variante_ids)
      select v_novo_mt, mtv.variante_tecido_id, mtv.ordem, mtv.multiplicador, mtv.complementa_variante_ids
        from modelo_tecido_variantes mtv where mtv.modelo_tecido_id = mt_old.id;
    end loop;

    insert into modelo_grades (modelo_id, variante_numero, grades, grade_total)
    select v_novo, variante_numero, grades, grade_total from modelo_grades where modelo_id = o.id;

    insert into modelo_aviamentos (modelo_id, aviamento_id, numero, consumo, loss_percent, custo_previsto, variante_aviamento_id)
    select v_novo, aviamento_id, numero, consumo, loss_percent, custo_previsto, variante_aviamento_id
      from modelo_aviamentos where modelo_id = o.id;

    insert into modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto)
    select _tenant, v_novo, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto
      from modelo_etiquetas where modelo_id = o.id;

    insert into modelo_observacoes (tenant_id, modelo_id, ordem, descricao, observacao)
    select _tenant, v_novo, ordem, descricao, observacao from modelo_observacoes where modelo_id = o.id;

    insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, aprovado, motivo_reprovacao, observacoes)
    select _tenant, v_novo, categoria_terceirizado_id, valor, null, null, observacoes
      from modelo_servico_mo where modelo_id = o.id;

    -- (3b) LINHA do bucket certo: casa (linha_id, categoria_id) do modelo → slot no bucket do OTB.
    select id into v_ln from plan_tecido_linhas
      where sub_id = v_sub_pt
        and linha_id is not distinct from o.linha_id
        and categoria_id is not distinct from o.categoria_principal_id
      order by ordem limit 1;
    if v_ln is null then
      insert into plan_tecido_linhas (sub_id, linha_id, categoria_id, ordem)
      values (v_sub_pt, o.linha_id, o.categoria_principal_id,
              coalesce((select max(ordem) + 1 from plan_tecido_linhas where sub_id = v_sub_pt), 0))
      returning id into v_ln;
    end if;

    select sl.id into v_slot
      from plan_tecido_slots sl
      where sl.linha_ref_id = v_ln and sl.modelo_id is null
      order by sl.slot_index
      limit 1 for update skip locked;

    if v_slot is not null then
      -- [tamanho-em v1] vaga livre reaproveitada: com card ela fica NULL (o valor mora no modelo, copiado da origem).
      update plan_tecido_slots set modelo_id = v_novo, tamanho_tipo = null where id = v_slot;
    else
      select coalesce(max(slot_index), -1) + 1 into v_slot_idx
        from plan_tecido_slots where linha_ref_id = v_ln;
      insert into plan_tecido_slots (linha_ref_id, modelo_id, slot_index, nome, preco_venda,
                                     categoria_id, custos_adicionais, custo_simulado)
      values (v_ln, v_novo, v_slot_idx, o.nome, o.preco_venda,
              o.categoria_principal_id, o.custos_adicionais, coalesce(o.custo_simulado, '{}'::jsonb))
      returning id into v_slot;
    end if;

    -- (3c) Copia materiais/variantes/proporcoes/categoria_tecido do slot ORIGEM (se houver) → destino.
    delete from plan_tecido_materiais where slot_id = v_slot;
    with src as (
      select ps.id as slot_id from plan_tecido_slots ps
        where ps.modelo_id = o.id and ps.tenant_id = _tenant limit 1
    ), mats as (
      insert into plan_tecido_materiais (slot_id, artigo_id, tipo, numero, consumo, loss_percent, ordem)
      select v_slot, pm.artigo_id, pm.tipo, pm.numero, pm.consumo, pm.loss_percent, pm.ordem
        from plan_tecido_materiais pm join src on pm.slot_id = src.slot_id
      returning id, tipo, numero
    )
    insert into plan_tecido_variantes (material_id, variante_tecido_id, ordem, multiplicador, grades, grade_total, cor_id, cor_apelido_id)
    select m.id, pv.variante_tecido_id, pv.ordem, pv.multiplicador, pv.grades, pv.grade_total, pv.cor_id, pv.cor_apelido_id
      from plan_tecido_variantes pv
      join plan_tecido_materiais pm_old on pm_old.id = pv.material_id
      join src on pm_old.slot_id = src.slot_id
      join mats m on m.tipo = pm_old.tipo and m.numero = pm_old.numero;
    update plan_tecido_slots dst set
      proporcoes = coalesce((select proporcoes from plan_tecido_slots where modelo_id = o.id and tenant_id = _tenant limit 1), dst.proporcoes),
      categoria_tecido_id = coalesce((select categoria_tecido_id from plan_tecido_slots where modelo_id = o.id and tenant_id = _tenant limit 1), dst.categoria_tecido_id)
    where dst.id = v_slot;

    v_out := v_out || jsonb_build_object('origem_modelo_id', o.id, 'novo_modelo_id', v_novo, 'slot_id', v_slot);
  end loop;

  return v_out;
end $function$
;

-- [tamanho-em v1] P-119 A: a vaga SEM card guarda o "Tamanho em". Coluna nullable sem default (ADD é só catálogo);
-- CHECK NOT VALID (não varre a tabela; vale p/ toda escrita nova). Trava curta: logo depois vem a árvore e o COMMIT.
ALTER TABLE public.plan_tecido_slots ADD COLUMN IF NOT EXISTS tamanho_tipo text;
DO $ck$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_tecido_slots_tamanho_tipo_chk'
                  AND conrelid = 'public.plan_tecido_slots'::regclass) THEN
    ALTER TABLE public.plan_tecido_slots
      ADD CONSTRAINT plan_tecido_slots_tamanho_tipo_chk CHECK (tamanho_tipo IN ('letra', 'numero')) NOT VALID;
  END IF;
END $ck$;
COMMENT ON COLUMN public.plan_tecido_slots.tamanho_tipo IS '"Tamanho em" da vaga SEM card (letra | numero; P-119 A). Com card o valor mora em modelos.tamanho_tipo e aqui fica NULL (o criar card leva este valor ao modelo e zera).';

CREATE OR REPLACE FUNCTION public._plan_tecido_arvore_core(_colecao_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when p.id is null then null else jsonb_build_object(
    'plan_id', p.id, 'colecao_id', p.colecao_id,
    'subcolecoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'subcolecao_id', s.subcolecao_id, 'ordem', s.ordem,
        'categorias_tecido', coalesce((select jsonb_agg(sc.categoria_id order by sc.ordem, sc.created_at)
          from plan_tecido_subcolecao_categorias sc where sc.subcolecao_id = s.id), '[]'::jsonb),
        'linhas', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', l.id, 'linha_id', l.linha_id, 'categoria_id', l.categoria_id, 'ordem', l.ordem,
            'slots', coalesce((
              select jsonb_agg(jsonb_build_object(
                'id', sl.id, 'modelo_id', sl.modelo_id, 'ref', m.ref, 'nome', coalesce(m.nome, sl.nome),
                'thumb_path', coalesce((m.fotos_modelo)[1], m.desenho_tecnico_url, m.croqui_url),
                'categoria_id', sl.categoria_id, 'categoria_tecido_id', sl.categoria_tecido_id, 'mix_id', case when sl.modelo_id is not null then m.mix_id else sl.mix_id end,
                'tamanho_tipo', case when sl.modelo_id is not null then m.tamanho_tipo else sl.tamanho_tipo end,  -- [tamanho-em v1]
                'usar_estoque', sl.usar_estoque,
                'proporcoes', coalesce(sl.proporcoes, m.proporcoes),
                'custo_simulado', sl.custo_simulado,
                'custo_terceirizados_previsto', sl.custo_terceirizados_previsto,
                'custos_adicionais', sl.custos_adicionais, 'preco_venda', sl.preco_venda,
                'referencia_paths', to_jsonb(coalesce(sl.referencia_paths,'{}'::text[])),
                'materiais', coalesce((
                  select jsonb_agg(jsonb_build_object(
                    'id', mt.id, 'artigo_id', mt.artigo_id, 'artigo_nome', a.nome,
                    'unidade_medida', a.unidade_medida, 'rendimento', a.rendimento,
                    'preco_por_metro', a.preco_por_metro,
                    'tipo', mt.tipo, 'numero', mt.numero, 'consumo', mt.consumo,
                    'loss_percent', mt.loss_percent, 'ordem', mt.ordem,
                    'variantes', coalesce((
                      select jsonb_agg(jsonb_build_object(
                        'id', vv.id, 'variante_tecido_id', vv.variante_tecido_id,
                        'variante_artigo_id', vt.artigo_id,
                        'cor_id', vv.cor_id, 'cor_apelido_id', vv.cor_apelido_id,
                        'label', concat_ws(' - ', coalesce(cor.nome, pcor.nome), coalesce(ap.nome, pap.nome)),
                        'cor_nome', coalesce(cor.nome, pcor.nome),
                        'ordem', vv.ordem, 'multiplicador', vv.multiplicador,
                        'grades', vv.grades, 'grade_total', vv.grade_total,
                        'distribuicao', vv.distribuicao, 'atende', vv.atende) order by vv.ordem)
                      from plan_tecido_variantes vv
                      left join variantes_tecido vt on vt.id = vv.variante_tecido_id
                      left join cores cor on cor.id = vt.cor_id
                      left join cores_apelido ap on ap.id = vt.cor_apelido_id
                      left join cores pcor on pcor.id = vv.cor_id
                      left join cores_apelido pap on pap.id = vv.cor_apelido_id
                      where vv.material_id = mt.id), '[]'::jsonb)) order by mt.ordem)
                  from plan_tecido_materiais mt
                  left join artigos a on a.id = mt.artigo_id
                  where mt.slot_id = sl.id), '[]'::jsonb)) order by sl.slot_index)
              from plan_tecido_slots sl
              left join modelos m on m.id = sl.modelo_id
              where sl.linha_ref_id = l.id), '[]'::jsonb)) order by l.ordem)
          from plan_tecido_linhas l where l.sub_id = s.id), '[]'::jsonb)) order by s.ordem)
      from plan_tecido_subcolecoes s where s.plan_id = p.id), '[]'::jsonb)
  ) end
  from (select id, colecao_id from plan_tecido where colecao_id = _colecao_id) p;
$function$
;

REVOKE EXECUTE ON FUNCTION public.fn_produto_tamanho_tipo_handover() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._replicar_produtos_acabados_core(uuid, uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._replicar_produtos_importados_core(uuid, uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._salvar_produto_acabado_core(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._salvar_produto_importado_core(uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._limpar_produto_acabado_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._limpar_produto_importado_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._salvar_plan_tecido_core(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._plan_tecido_criar_card_core(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._plan_tecido_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._replicar_cards_plan_tecido_core(uuid, uuid, uuid, uuid[], integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._plan_tecido_arvore_core(uuid) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  v_md5 text;
  r record;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.fn_produto_tamanho_tipo_handover()')));
  IF v_md5 IS DISTINCT FROM '2712720482d94963ffda1b807fdf6931' THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - fn_produto_tamanho_tipo_handover nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._replicar_produtos_acabados_core(uuid,uuid,uuid,uuid[])')));
  IF v_md5 IS DISTINCT FROM '5aa4cf782687fe1dec96d18ef4d2923d' THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - _replicar_produtos_acabados_core nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._replicar_produtos_importados_core(uuid,uuid,uuid,uuid[])')));
  IF v_md5 IS DISTINCT FROM 'dc37b0adf427d1b2f6bca71a8d755ae0' THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - _replicar_produtos_importados_core nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)')));
  IF v_md5 IS DISTINCT FROM '20f8e442b95f8bb02bc8201b431c21b1' THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - _salvar_produto_acabado_core nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)')));
  IF v_md5 IS DISTINCT FROM '2f3a81d18248752c56a7bd386c8bfe69' THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - _salvar_produto_importado_core nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._limpar_produto_acabado_core(uuid)')));
  IF v_md5 IS DISTINCT FROM '123ddc5a717d896bc38193806769ccae' THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - _limpar_produto_acabado_core nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._limpar_produto_importado_core(uuid)')));
  IF v_md5 IS DISTINCT FROM '5fe6e90f2a96881614f45f84f9865bdd' THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - _limpar_produto_importado_core nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_plan_tecido_core(uuid,jsonb,integer)')));
  IF v_md5 IS DISTINCT FROM '81a3606444a2cf68ee376937009b9bad' THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - _salvar_plan_tecido_core nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_criar_card_core(uuid,uuid,jsonb)')));
  IF v_md5 IS DISTINCT FROM 'fceac02c52bd0b29a33856dc9e0f9b11' THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - _plan_tecido_criar_card_core nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_snapshot(uuid)')));
  IF v_md5 IS DISTINCT FROM '2c2ba1e79ab311b2c5ba8080cac958e9' THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - _plan_tecido_snapshot nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)')));
  IF v_md5 IS DISTINCT FROM 'aaf3f2e4e4bd8eb14b99d53c79a653da' THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - _replicar_cards_plan_tecido_core nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._plan_tecido_arvore_core(uuid)')));
  IF v_md5 IS DISTINCT FROM '5111f417c2679a4bb2157ad0df61f55a' THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - _plan_tecido_arvore_core nao ficou com o texto esperado (md5 %); possivel corrupcao (client_encoding?) - desfazendo tudo', v_md5 USING ERRCODE = 'P0001';
  END IF;
  -- ACL: os 12 objetos com EXECUTE revogado dos TRES (invariante #9).
  FOR r IN SELECT unnest(ARRAY['public.fn_produto_tamanho_tipo_handover()', 'public._replicar_produtos_acabados_core(uuid,uuid,uuid,uuid[])', 'public._replicar_produtos_importados_core(uuid,uuid,uuid,uuid[])', 'public._salvar_produto_acabado_core(uuid,jsonb,jsonb)', 'public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)', 'public._limpar_produto_acabado_core(uuid)', 'public._limpar_produto_importado_core(uuid)', 'public._salvar_plan_tecido_core(uuid,jsonb,integer)', 'public._plan_tecido_criar_card_core(uuid,uuid,jsonb)', 'public._plan_tecido_snapshot(uuid)', 'public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)', 'public._plan_tecido_arvore_core(uuid)']) AS sig LOOP
    IF has_function_privilege('public', to_regprocedure(r.sig), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure(r.sig), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.sig), 'EXECUTE') THEN
      RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - % com EXECUTE para PUBLIC/anon/authenticated', r.sig USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.plan_tecido_slots'::regclass AND a.attname = 'tamanho_tipo' AND NOT a.attisdropped
       AND format_type(a.atttypid, a.atttypmod) = 'text' AND NOT a.attnotnull AND NOT a.atthasdef
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.plan_tecido_slots'::regclass
       AND conname = 'plan_tecido_slots_tamanho_tipo_chk'
       AND pg_get_constraintdef(oid) = 'CHECK ((tamanho_tipo = ANY (ARRAY[''letra''::text, ''numero''::text]))) NOT VALID'
  ) THEN
    RAISE EXCEPTION 'tamanho_em: pos-condicao falhou - coluna/CHECK de plan_tecido_slots.tamanho_tipo incompletos ou com outra definicao - desfazendo tudo' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';

COMMIT;
