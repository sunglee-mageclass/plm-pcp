-- Paridade PA/PI (complemento, nov/2026) — a LINHA tambem SEM card, com espelho BIDIRECIONAL produto <-> card.
--  * `produtos_acabados.linha_id` e `produtos_importados.linha_id` (uuid, FK `linhas`, NO ACTION, nullable) + indice parcial
--    `WHERE linha_id IS NOT NULL`. Backfill: produto COM card herda a linha do card (so onde o produto esta vazio).
--  * `_salvar_produto_acabado_core` / `_salvar_produto_importado_core`: alem de `modelos.linha_id` (reflexivo, ja existia), gravam
--    `produtos_*.linha_id` SEMPRE (com ou sem card), padrao `_dados ? 'linha_id'` (ausente mantem; vazio limpa). INSERT tambem
--    (produto novo ja nasce com a linha escolhida). A validacao "linha da mesma loja" e a que ja existe (P0001 'Linha de outra loja').
--  * `fn_modelo_espelho_categoria()` + trigger `trg_modelo_espelho_categoria`: card -> produto tambem para `linha_id`. A coluna e o
--    WHEN do gatilho ganham `linha_id`; a funcao copia SEMPRE que a linha do card mudou, INCLUSIVE NULL ("sem linha" e valido, ao
--    contrario da categoria). O bloco vem ANTES dos retornos antecipados da categoria (card sem categoria nao impede copiar a linha).
--  * `_criar_card_produto_acabado_core` / `_importado_core`: o card nasce com `linha_id = p.linha_id` (HERDA a do produto; antes null).
-- ADITIVO. Corpos gerados por TROCA EXATA (cada ancora casou 1x) sobre o pg_get_functiondef VIVO. RAISE so ASCII (nenhum novo).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._salvar_produto_acabado_core(uuid,jsonb,jsonb)
--     ANTES  8380b15f5ae3ad9d581d3205cb23a4ec
--     DEPOIS 53a0745fd4f548547485679c19c2363a
--   public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)
--     ANTES  d857ebb676241e411666d699142ccabd
--     DEPOIS ba8ba0f0476c351bfa9d430ec12dc8af
--   public._criar_card_produto_acabado_core(uuid)
--     ANTES  dcbfa5bd2d3cee921d46a9335b3f468c
--     DEPOIS 2bb5b74a8e2b4130d426310d62069d82
--   public._criar_card_produto_importado_core(uuid)
--     ANTES  33b39eab715ac168af5e678e0a051e60
--     DEPOIS e12562cee2e7530c4d7256213e7d4926
--   public.fn_modelo_espelho_categoria()
--     ANTES  2e0c70f661e42610e87da2b934dec962
--     DEPOIS 640a14561ed5cbe6d02855580915e96c
--   Qualquer outro texto -> P0001 e nada muda. Reaplicar = no-op.
-- =====================================================================================================================
-- Travas: ADD COLUMN nullable sem default = metadado (AccessExclusive muito breve em produtos_*; lock_timeout 1500ms; 55P03 = rodar de novo
--   em horario calmo); CREATE INDEX (nao CONCURRENTLY, tabelas pequenas) segura SHARE; CREATE OR REPLACE TRIGGER = ShareRowExclusive em
--   modelos; nada em auth/storage. O backfill UPDATE nao toca updated_at.
-- ACL: o REVOKE dos 4 cores repete a invariante #9 (CREATE OR REPLACE ja mantem a ACL; conferido no fim).
-- Exige a paridade PA/PI (20261118100000/110000/120000). Inverso: supabase/rollback/20261118130000_pa_pi_linha_produto_down.sql.
-- Banco ANTES do site (site novo + banco velho: o produto-sem-card nao grava a linha; site velho + banco novo: nada muda).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL statement_timeout = '30s';
SET LOCAL transaction_timeout = '60s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'produtos_acabados' AND column_name = 'status')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'produtos_importados' AND column_name = 'status') THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: coluna status ausente - aplicar a paridade PA/PI (20261118100000/110000/120000) antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: _salvar_produto_acabado_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)')));
  IF v_md5 NOT IN ('8380b15f5ae3ad9d581d3205cb23a4ec', '53a0745fd4f548547485679c19c2363a') THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: _salvar_produto_acabado_core mudou desde o planejamento (md5 %) - outra frente mexeu; conferir antes de aplicar', v_md5
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: _salvar_produto_importado_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)')));
  IF v_md5 NOT IN ('d857ebb676241e411666d699142ccabd', 'ba8ba0f0476c351bfa9d430ec12dc8af') THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: _salvar_produto_importado_core mudou desde o planejamento (md5 %) - outra frente mexeu; conferir antes de aplicar', v_md5
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._criar_card_produto_acabado_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: _criar_card_produto_acabado_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._criar_card_produto_acabado_core(uuid)')));
  IF v_md5 NOT IN ('dcbfa5bd2d3cee921d46a9335b3f468c', '2bb5b74a8e2b4130d426310d62069d82') THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: _criar_card_produto_acabado_core mudou desde o planejamento (md5 %) - outra frente mexeu; conferir antes de aplicar', v_md5
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._criar_card_produto_importado_core(uuid)') IS NULL THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: _criar_card_produto_importado_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._criar_card_produto_importado_core(uuid)')));
  IF v_md5 NOT IN ('33b39eab715ac168af5e678e0a051e60', 'e12562cee2e7530c4d7256213e7d4926') THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: _criar_card_produto_importado_core mudou desde o planejamento (md5 %) - outra frente mexeu; conferir antes de aplicar', v_md5
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.fn_modelo_espelho_categoria()') IS NULL THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: fn_modelo_espelho_categoria nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_espelho_categoria()')));
  IF v_md5 NOT IN ('2e0c70f661e42610e87da2b934dec962', '640a14561ed5cbe6d02855580915e96c') THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: fn_modelo_espelho_categoria mudou desde o planejamento (md5 %) - outra frente mexeu; conferir antes de aplicar', v_md5
      USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

ALTER TABLE public.produtos_acabados  ADD COLUMN IF NOT EXISTS linha_id uuid REFERENCES public.linhas(id);
ALTER TABLE public.produtos_importados ADD COLUMN IF NOT EXISTS linha_id uuid REFERENCES public.linhas(id);
CREATE INDEX IF NOT EXISTS idx_produtos_acabados_linha_id  ON public.produtos_acabados (linha_id)  WHERE linha_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_produtos_importados_linha_id ON public.produtos_importados (linha_id) WHERE linha_id IS NOT NULL;

-- Backfill: produto com card herda a linha do card (so onde o produto ainda esta vazio; mesma loja).
UPDATE public.produtos_acabados pa SET linha_id = m.linha_id
  FROM public.modelos m
 WHERE pa.modelo_id = m.id AND pa.tenant_id = m.tenant_id AND m.linha_id IS NOT NULL AND pa.linha_id IS NULL;
UPDATE public.produtos_importados pi SET linha_id = m.linha_id
  FROM public.modelos m
 WHERE pi.modelo_id = m.id AND pi.tenant_id = m.tenant_id AND m.linha_id IS NOT NULL AND pi.linha_id IS NULL;

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
  v_linha uuid;          -- [pa-linha v1]
  v_status text;         -- [pa-linha v1]
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

  -- [pa-linha v1] Paridade com o Plan. Tecido: a LINHA e do MODELO (nao do produto) — chave `linha_id` em _dados e REFLEXIVA (so
  -- grava modelos.linha_id do card espelho, mais abaixo; produto sem card ignora). So quando a chave vem (padrao tamanho_tipo);
  -- vazio = limpa. Linha de outra loja (ou inexistente) = recusa. `status` (so vale p/ produto SEM card; com card manda o kanban):
  -- pendente | reprovado; vazio = limpa; outro valor = recusa. Mensagens so ASCII.
  if _dados ? 'linha_id' then
    v_linha := nullif(_dados->>'linha_id', '')::uuid;
    if v_linha is not null and not exists (select 1 from public.linhas l
                                            where l.id = v_linha and l.tenant_id = v_tenant) then
      raise exception 'Linha de outra loja' using errcode = 'P0001';
    end if;
  end if;
  if _dados ? 'status' then
    v_status := nullif(_dados->>'status', '');
    if v_status is not null and v_status not in ('pendente', 'reprovado') then
      raise exception 'status invalido: use pendente ou reprovado' using errcode = 'P0001';
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
      markup_atacado, markup_varejo, foto_url, tamanho_tipo, categoria_tecido_id, material_aviamento_id,  -- [i3 v1]
      status,  -- [pa-linha v1]
      linha_id  -- [pa-linha-prod v1]
    ) values (
      v_tenant, v_nome, nullif(_dados->>'ref', ''), v_grupo_id, v_categoria_id,
      v_sub1_id, v_sub2_id,
      nullif(_dados->>'colecao_id', '')::uuid, _dados->>'subcolecao', _dados->>'semana',
      nullif(_dados->>'empresa_id', '')::uuid, nullif(_dados->>'representante_id', '')::uuid,
      _dados->>'ref_fornecedor', _dados->>'composicao',
      coalesce(_dados->'grade_proporcao', '{}'::jsonb), v_qtd_total, v_valor_unitario, v_desconto_pct, v_insumos,
      v_markup_atacado, v_markup_varejo, nullif(_dados->>'foto_url', ''), v_tt,  -- [tamanho-em v1]
      v_cat_tecido, v_mat_aviamento,  -- [i3 v1]
      v_status,  -- [pa-linha v1]
      v_linha  -- [pa-linha-prod v1] linha_id do produto (chave ausente = v_linha nulo = sem linha)
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
      status = case when _dados ? 'status' then v_status else status end,  -- [pa-linha v1]
      -- [pa-linha-prod v1] a Linha agora e tambem do PRODUTO (com ou sem card); chave ausente MANTEM (padrao `_dados ? 'chave'`).
      -- O UPDATE do card (abaixo) so roda DEPOIS deste: o gatilho de espelho modelo->produto ja encontra o valor igual e nao regrava.
      linha_id = case when _dados ? 'linha_id' then v_linha else linha_id end,
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

    -- [pa-linha v1] Linha REFLEXIVA: so quando a chave vem em _dados e o produto tem card; `IS DISTINCT FROM` = save sem mudanca
    -- de linha nao toca o card (o rev dele nao sobe, a trava da Integracao nao e acionada). A linha ja foi validada acima.
    if v_modelo_id is not null and _dados ? 'linha_id' then
      update public.modelos set linha_id = v_linha
       where id = v_modelo_id and tenant_id = v_tenant and linha_id is distinct from v_linha;
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
  v_modelo_id uuid;                     -- [leves L8, sku #22]
  v_ordens_antes int[] := '{}'::int[];  -- [leves L8, sku #22]
  v_vu_m1 numeric := 0;                 -- [leves L8, P-207 A]
  v_cat_tecido uuid;                    -- [i3 v1]
  v_mat_aviamento uuid;                 -- [i3 v1]
  v_linha uuid;                         -- [pa-linha v1]
  v_status text;                        -- [pa-linha v1]
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

  -- [i3 v1] Release I3: Categoria do tecido (grupo nao Acessorios) / Material do aviamento (Acessorios) do produto - so
  -- quando a chave vem no _dados (padrao tamanho_tipo; a tela manda sempre as 2); vazio = limpa. Fora da trava de
  -- identidade com OC e da trava da Integracao (campo informativo, P-219 A). Id de outra loja = recusa (o gatilho
  -- trg_pi_cat_material_tenant confere de novo).
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

  -- [pa-linha v1] Paridade com o Plan. Tecido: a LINHA e do MODELO (nao do produto) — chave `linha_id` em _dados e REFLEXIVA (so
  -- grava modelos.linha_id do card espelho, mais abaixo; produto sem card ignora). So quando a chave vem (padrao tamanho_tipo);
  -- vazio = limpa. Linha de outra loja (ou inexistente) = recusa. `status` (so vale p/ produto SEM card; com card manda o kanban):
  -- pendente | reprovado; vazio = limpa; outro valor = recusa. Mensagens so ASCII.
  if _dados ? 'linha_id' then
    v_linha := nullif(_dados->>'linha_id', '')::uuid;
    if v_linha is not null and not exists (select 1 from public.linhas l
                                            where l.id = v_linha and l.tenant_id = v_tenant) then
      raise exception 'Linha de outra loja' using errcode = 'P0001';
    end if;
  end if;
  if _dados ? 'status' then
    v_status := nullif(_dados->>'status', '');
    if v_status is not null and v_status not in ('pendente', 'reprovado') then
      raise exception 'status invalido: use pendente ou reprovado' using errcode = 'P0001';
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
      desconto_pct, cotacao_final, markup_atacado, markup_varejo, tamanho_tipo, categoria_tecido_id, material_aviamento_id,  -- [i3 v1]
      status,  -- [pa-linha v1]
      linha_id  -- [pa-linha-prod v1]
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
      v_tt,  -- [tamanho-em v1]
      v_cat_tecido, v_mat_aviamento,  -- [i3 v1]
      v_status,  -- [pa-linha v1]
      v_linha  -- [pa-linha-prod v1] linha_id do produto (chave ausente = v_linha nulo = sem linha)
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
      categoria_tecido_id = case when _dados ? 'categoria_tecido_id' then v_cat_tecido else categoria_tecido_id end,  -- [i3 v1]
      material_aviamento_id = case when _dados ? 'material_aviamento_id' then v_mat_aviamento else material_aviamento_id end,  -- [i3 v1]
      status = case when _dados ? 'status' then v_status else status end,  -- [pa-linha v1]
      -- [pa-linha-prod v1] a Linha agora e tambem do PRODUTO (com ou sem card); chave ausente MANTEM (padrao `_dados ? 'chave'`).
      -- O UPDATE do card (abaixo) so roda DEPOIS deste: o gatilho de espelho modelo->produto ja encontra o valor igual e nao regrava.
      linha_id = case when _dados ? 'linha_id' then v_linha else linha_id end,
      updated_at = now()
    where id = _id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then raise exception 'Produto não encontrado'; end if;
  end if;

  -- [leves L8, P-207 A + Q2] etapa de MERCADORIA (base vazia = mercadoria) com % > 0 e cotacao <= 0 nao converte (o landed
  -- a ignora e a parcela da OC sai 0 e e pulada): recusa - mas SO quando a compra tem valor (valor_unitario_m1 > 0, o valor
  -- JA gravado nesta transacao). Produto recem-criado/sem valor salva os outros campos sem a cotacao de referencia. Mesma
  -- regra na tela (erroCotacaoEtapas, src/lib/importado-etapas.ts) e na OC (_salvar_oc_importado_core). Frete com cotacao
  -- 0 segue valendo (= identidade, "deixe 1 se o frete ja esta em R$").
  select pi.modelo_id, coalesce(pi.valor_unitario_m1, 0) into v_modelo_id, v_vu_m1
    from public.produtos_importados pi where pi.id = v_id and pi.tenant_id = v_tenant;
  if v_vu_m1 > 0 and exists(select 1 from jsonb_array_elements(coalesce(_etapas,'[]'::jsonb)) e
             where coalesce(nullif(e->>'base',''),'mercadoria') = 'mercadoria'
               and coalesce(nullif(e->>'percentual','')::numeric, 0) > 0
               and coalesce(nullif(e->>'cotacao','')::numeric, 0) <= 0) then
    raise exception 'Informe a cotacao da etapa de mercadoria (percentual maior que zero e cotacao zerada).' using errcode = 'P0001';
  end if;

  -- [pa-linha v1] Linha REFLEXIVA: so quando a chave vem em _dados e o produto tem card (v_modelo_id, lido acima); `IS DISTINCT FROM` =
  -- save sem mudanca de linha nao toca o card (o rev dele nao sobe, a trava da Integracao nao e acionada). A linha ja foi validada acima.
  if v_modelo_id is not null and _dados ? 'linha_id' then
    update public.modelos set linha_id = v_linha
     where id = v_modelo_id and tenant_id = v_tenant and linha_id is distinct from v_linha;
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

  -- [leves L8, sku #22] ordens das variantes ANTES deste save (a grade cor x tamanho do card espelho mora em
  -- modelo_grades com variante_numero = ordem).
  select coalesce(array_agg(piv.ordem), '{}'::int[]) into v_ordens_antes
    from public.produto_importado_variantes piv where piv.produto_importado_id = v_id;

  -- Variantes: estado completo (apaga e reinsere pela ordem recebida).
  delete from public.produto_importado_variantes where produto_importado_id = v_id;
  for rec in select * from jsonb_array_elements(coalesce(_variantes,'[]'::jsonb)) loop
    insert into public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
    values (v_tenant, v_id, coalesce((rec->>'ordem')::int, 0),
      nullif(rec->>'cor_id','')::uuid, nullif(rec->>'cor_apelido_id','')::uuid,
      coalesce((rec->>'peso')::numeric,0), coalesce((rec->>'qtd')::int,0));
  end loop;

  -- [leves L8, sku #22] a variante que SAIU neste save leva junto a grade dela no card espelho (mesma regra da revenda,
  -- _salvar_produto_acabado_core): so as ordens que existiam antes e nao vieram agora; card da MESMA loja. Produto travado
  -- pela Integracao ja recusa mudar variantes (trg_zz_integracao_trava_var).
  if v_modelo_id is not null and cardinality(v_ordens_antes) > 0
     and exists (select 1 from public.modelos m where m.id = v_modelo_id and m.tenant_id = v_tenant) then
    delete from public.modelo_grades g
     where g.modelo_id = v_modelo_id
       and g.variante_numero = any (v_ordens_antes)
       and not exists (select 1 from jsonb_array_elements(coalesce(_variantes,'[]'::jsonb)) e
                        where coalesce((e->>'ordem')::int, 0) = g.variante_numero);
  end if;

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

CREATE OR REPLACE FUNCTION public._criar_card_produto_acabado_core(_produto_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  p record;
  v_modelo_id uuid;
  v_grade jsonb;
  v_total numeric;
  rec record;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  -- FOR UPDATE: trava a linha até o fim da função — duplo-clique/chamada concorrente
  -- bloqueia na 2ª chamada até a 1ª terminar (INSERT do modelo + UPDATE modelo_id),
  -- daí vê modelo_id já preenchido e cai no RAISE de idempotência normalmente, em vez
  -- de correr e criar 2 espelhos.
  select * into p from public.produtos_acabados where id = _produto_id and tenant_id = v_tenant for update;
  if not found then
    raise exception 'Produto não encontrado';
  end if;
  if p.modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento' using errcode = 'P0001';
  end if;

  -- Paridade PA/PI (Task 3): produto REPROVADO sem card nao vira card ate voltar a Pendente (RAISE so ASCII).
  if coalesce(p.status, '') = 'reprovado' then
    raise exception 'produto_reprovado_sem_card: %', coalesce(p.nome, '') using errcode = 'P0001';
  end if;

  -- Espelho: tenant_id explícito (não confiar no set_tenant_id_trg — o INSERT roda dentro
  -- de uma função SECURITY DEFINER, então basta o valor já resolvido em v_tenant acima).
  -- ref copiada DIRETO do produto: revenda não passa pelo fluxo aprovar/ref_auto do modelo.
  -- mix_id HERDA a família definida no produto (rascunho ou materializado) — #4b.
  insert into public.modelos (
    tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
    colecao_id, subcolecao, semana, ref, linha_id, mix_id
  ) values (
    v_tenant, p.nome, 'revenda', p.categoria_id, p.subcategoria1_id, p.subcategoria2_id,
    p.colecao_id, p.subcolecao, p.semana, p.ref, p.linha_id, p.mix_id
  ) returning id into v_modelo_id;

  update public.produtos_acabados set modelo_id = v_modelo_id, updated_at = now() where id = _produto_id;

  for rec in select ordem, qtd from public.produto_acabado_variantes where produto_acabado_id = _produto_id loop
    v_grade := public._pa_grade_variante(p.grupo_id, p.grade_proporcao, rec.qtd);
    select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
    insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
    values (v_modelo_id, rec.ordem, v_grade, v_total::int);
  end loop;

  perform public._pa_recomputar_precos_modelo(_produto_id);

  return v_modelo_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._criar_card_produto_importado_core(_produto_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
  p record;
  v_modelo_id uuid;
  v_grade jsonb;
  v_total numeric;
  rec record;
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;

  select * into p from public.produtos_importados where id = _produto_id and tenant_id = v_tenant for update;
  if not found then raise exception 'Produto não encontrado'; end if;
  if p.modelo_id is not null then
    raise exception 'Este produto já tem card no Planejamento' using errcode = 'P0001';
  end if;

  -- Paridade PA/PI (Task 3): produto REPROVADO sem card nao vira card ate voltar a Pendente (RAISE so ASCII).
  if coalesce(p.status, '') = 'reprovado' then
    raise exception 'produto_reprovado_sem_card: %', coalesce(p.nome, '') using errcode = 'P0001';
  end if;

  -- mix_id HERDA a família definida no produto (rascunho ou materializado) — #4b.
  insert into public.modelos (
    tenant_id, nome, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id,
    colecao_id, subcolecao, semana, ref, linha_id, mix_id
  ) values (
    v_tenant, p.nome, 'importado', p.categoria_id, p.subcategoria1_id, p.subcategoria2_id,
    p.colecao_id, p.subcolecao, p.semana, p.ref, p.linha_id, p.mix_id
  ) returning id into v_modelo_id;

  update public.produtos_importados set modelo_id = v_modelo_id, updated_at = now() where id = _produto_id;

  for rec in select ordem, qtd from public.produto_importado_variantes where produto_importado_id = _produto_id loop
    v_grade := public._pa_grade_variante(p.grupo_id, p.grade_proporcao, rec.qtd);
    select coalesce(sum((value)::numeric), 0) into v_total from jsonb_each_text(v_grade);
    insert into public.modelo_grades (modelo_id, variante_numero, grades, grade_total)
    values (v_modelo_id, rec.ordem, v_grade, v_total::int);
  end loop;

  perform public._imp_recomputar_precos_modelo(_produto_id);
  return v_modelo_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.fn_modelo_espelho_categoria()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- P-137 A (R1): coluna a coluna — cada uma so vai ao produto quando ELA mudou no card nesta escrita.
  -- P-145 A (R3b): NULL do card nunca e copiado (categoria nem subs).
  v_cat boolean := OLD.categoria_principal_id IS DISTINCT FROM NEW.categoria_principal_id;
  v_s1 boolean := NEW.subcategoria1_id IS NOT NULL AND OLD.subcategoria1_id IS DISTINCT FROM NEW.subcategoria1_id;
  v_s2 boolean := NEW.subcategoria2_id IS NOT NULL AND OLD.subcategoria2_id IS DISTINCT FROM NEW.subcategoria2_id;
  v_grupo uuid;
  r record;
  v_g uuid;
  v_c uuid;
  v_n1 uuid;
  v_n2 uuid;
BEGIN
  -- [pa-linha-prod v1] LINHA modelo->produto (espelho bidirecional). INDEPENDENTE da categoria: vai ANTES dos retornos
  -- antecipados abaixo. Copia SEMPRE que mudou, inclusive NULL ("sem linha" e estado valido, ao contrario da categoria). Mesma
  -- estrutura da categoria: PA so de card 'revenda', PI so de 'importado', mesma loja. `IS DISTINCT FROM` no WHERE = sem regravar
  -- (o save do produto ja gravou o valor antes de tocar o card). Sem FOR UPDATE: o proprio UPDATE trava a linha.
  IF NEW.linha_id IS DISTINCT FROM OLD.linha_id THEN
    UPDATE public.produtos_acabados
       SET linha_id = NEW.linha_id, updated_at = now()
     WHERE NEW.origem = 'revenda' AND modelo_id = NEW.id AND tenant_id = NEW.tenant_id
       AND linha_id IS DISTINCT FROM NEW.linha_id;
    UPDATE public.produtos_importados
       SET linha_id = NEW.linha_id, updated_at = now()
     WHERE NEW.origem = 'importado' AND modelo_id = NEW.id AND tenant_id = NEW.tenant_id
       AND linha_id IS DISTINCT FROM NEW.linha_id;
  END IF;
  -- Card sem categoria (passo intermediario da troca de grupo no Sheet): o produto fica como esta.
  IF NEW.categoria_principal_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- P-143 A: o grupo vem da categoria nova. Categoria sem grupo (ou de outra loja) -> nao copia nada (R3a).
  SELECT c.grupo_id INTO v_grupo
    FROM public.categorias_produto c
   WHERE c.id = NEW.categoria_principal_id AND c.tenant_id = NEW.tenant_id;
  IF v_grupo IS NULL OR NOT (v_cat OR v_s1 OR v_s2) THEN
    RETURN NULL;
  END IF;

  -- Cada produto espelho (1:1 por gatilho, nao por UNIQUE — por isso o laco cobre todas as linhas) travado FOR UPDATE:
  -- serializa com um INSERT de OC concorrente (a FK dele pede KEY SHARE nesta linha).
  FOR r IN
    SELECT 'produtos_acabados'::text AS tabela, pa.id, pa.grupo_id, pa.categoria_id, pa.subcategoria1_id AS s1, pa.subcategoria2_id AS s2
      FROM public.produtos_acabados pa
     WHERE NEW.origem = 'revenda' AND pa.modelo_id = NEW.id AND pa.tenant_id = NEW.tenant_id
       FOR UPDATE
  LOOP
    -- P-142 B: produto com pedido nao troca entre Acessorios e outro grupo (grade UN x grade por tamanho).
    IF v_cat AND r.grupo_id IS DISTINCT FROM v_grupo
       AND public._grupo_eh_acessorio(r.grupo_id) IS DISTINCT FROM public._grupo_eh_acessorio(v_grupo)
       AND (EXISTS (SELECT 1 FROM public.ocs_p_acabado_itens o WHERE r.tabela = 'produtos_acabados' AND o.produto_acabado_id = r.id)
         OR EXISTS (SELECT 1 FROM public.ocs_importado_itens o WHERE r.tabela = 'produtos_importados' AND o.produto_importado_id = r.id)) THEN  -- [r13] pedido = item
      RAISE EXCEPTION 'categoria_acessorio_com_pedido: produto com pedido nao pode trocar entre Acessorios e outro grupo pela Categoria do card'
        USING ERRCODE = 'P0001';
    END IF;
    v_g := CASE WHEN v_cat THEN v_grupo ELSE r.grupo_id END;
    v_c := CASE WHEN v_cat THEN NEW.categoria_principal_id ELSE r.categoria_id END;
    -- Sub (H1/M1 do G-migration): a sub do card vai ao produto quando mudou E pertence ao contexto certo — junto com a
    -- categoria copiada, ou (troca SO da sub) quando o produto ja esta na MESMA categoria do card (senao seria sub de
    -- outra categoria). Categoria copiada e sub do card vazia: a sub do produto fica SE ainda pertence a categoria
    -- nova; se nao pertence, e limpa (nunca sub orfa de outra categoria).
    v_n1 := CASE
      WHEN v_s1 AND (v_cat OR r.categoria_id = NEW.categoria_principal_id) THEN NEW.subcategoria1_id
      WHEN v_cat AND r.s1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.subcategorias1_produto s
                                                      WHERE s.id = r.s1 AND s.categoria_id = NEW.categoria_principal_id) THEN NULL
      ELSE r.s1 END;
    v_n2 := CASE
      WHEN v_s2 AND (v_cat OR r.categoria_id = NEW.categoria_principal_id) THEN NEW.subcategoria2_id
      WHEN v_cat AND r.s2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.subcategorias2_produto s
                                                      WHERE s.id = r.s2 AND s.categoria_id = NEW.categoria_principal_id) THEN NULL
      ELSE r.s2 END;
    IF (v_g, v_c, v_n1, v_n2) IS DISTINCT FROM (r.grupo_id, r.categoria_id, r.s1, r.s2) THEN
      UPDATE public.produtos_acabados
         SET grupo_id = v_g, categoria_id = v_c, subcategoria1_id = v_n1, subcategoria2_id = v_n2, updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;

  FOR r IN
    SELECT 'produtos_importados'::text AS tabela, pi.id, pi.grupo_id, pi.categoria_id, pi.subcategoria1_id AS s1, pi.subcategoria2_id AS s2
      FROM public.produtos_importados pi
     WHERE NEW.origem = 'importado' AND pi.modelo_id = NEW.id AND pi.tenant_id = NEW.tenant_id
       FOR UPDATE
  LOOP
    -- P-142 B: produto com pedido nao troca entre Acessorios e outro grupo (grade UN x grade por tamanho).
    IF v_cat AND r.grupo_id IS DISTINCT FROM v_grupo
       AND public._grupo_eh_acessorio(r.grupo_id) IS DISTINCT FROM public._grupo_eh_acessorio(v_grupo)
       AND (EXISTS (SELECT 1 FROM public.ocs_p_acabado_itens o WHERE r.tabela = 'produtos_acabados' AND o.produto_acabado_id = r.id)
         OR EXISTS (SELECT 1 FROM public.ocs_importado_itens o WHERE r.tabela = 'produtos_importados' AND o.produto_importado_id = r.id)) THEN  -- [r13] pedido = item
      RAISE EXCEPTION 'categoria_acessorio_com_pedido: produto com pedido nao pode trocar entre Acessorios e outro grupo pela Categoria do card'
        USING ERRCODE = 'P0001';
    END IF;
    v_g := CASE WHEN v_cat THEN v_grupo ELSE r.grupo_id END;
    v_c := CASE WHEN v_cat THEN NEW.categoria_principal_id ELSE r.categoria_id END;
    -- Sub (H1/M1 do G-migration): a sub do card vai ao produto quando mudou E pertence ao contexto certo — junto com a
    -- categoria copiada, ou (troca SO da sub) quando o produto ja esta na MESMA categoria do card (senao seria sub de
    -- outra categoria). Categoria copiada e sub do card vazia: a sub do produto fica SE ainda pertence a categoria
    -- nova; se nao pertence, e limpa (nunca sub orfa de outra categoria).
    v_n1 := CASE
      WHEN v_s1 AND (v_cat OR r.categoria_id = NEW.categoria_principal_id) THEN NEW.subcategoria1_id
      WHEN v_cat AND r.s1 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.subcategorias1_produto s
                                                      WHERE s.id = r.s1 AND s.categoria_id = NEW.categoria_principal_id) THEN NULL
      ELSE r.s1 END;
    v_n2 := CASE
      WHEN v_s2 AND (v_cat OR r.categoria_id = NEW.categoria_principal_id) THEN NEW.subcategoria2_id
      WHEN v_cat AND r.s2 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.subcategorias2_produto s
                                                      WHERE s.id = r.s2 AND s.categoria_id = NEW.categoria_principal_id) THEN NULL
      ELSE r.s2 END;
    IF (v_g, v_c, v_n1, v_n2) IS DISTINCT FROM (r.grupo_id, r.categoria_id, r.s1, r.s2) THEN
      UPDATE public.produtos_importados
         SET grupo_id = v_g, categoria_id = v_c, subcategoria1_id = v_n1, subcategoria2_id = v_n2, updated_at = now()
       WHERE id = r.id;
    END IF;
  END LOOP;
  RETURN NULL;
END
$function$
;

CREATE OR REPLACE TRIGGER trg_modelo_espelho_categoria
  AFTER UPDATE OF categoria_principal_id, subcategoria1_id, subcategoria2_id, linha_id ON public.modelos
  FOR EACH ROW
  WHEN (((new.origem = ANY (ARRAY['revenda'::text, 'importado'::text])) AND ((old.categoria_principal_id IS DISTINCT FROM new.categoria_principal_id) OR (old.subcategoria1_id IS DISTINCT FROM new.subcategoria1_id) OR (old.subcategoria2_id IS DISTINCT FROM new.subcategoria2_id) OR (old.linha_id IS DISTINCT FROM new.linha_id))))
  EXECUTE FUNCTION fn_modelo_espelho_categoria();

REVOKE EXECUTE ON FUNCTION public._salvar_produto_acabado_core(uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._salvar_produto_importado_core(uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._criar_card_produto_acabado_core(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._criar_card_produto_importado_core(uuid) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_produto_acabado_core(uuid,jsonb,jsonb)')));
  IF v_md5 <> '53a0745fd4f548547485679c19c2363a' THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: pos-condicao - _salvar_produto_acabado_core md5 vivo % <> esperado 53a0745fd4f548547485679c19c2363a', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)')));
  IF v_md5 <> 'ba8ba0f0476c351bfa9d430ec12dc8af' THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: pos-condicao - _salvar_produto_importado_core md5 vivo % <> esperado ba8ba0f0476c351bfa9d430ec12dc8af', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._criar_card_produto_acabado_core(uuid)')));
  IF v_md5 <> '2bb5b74a8e2b4130d426310d62069d82' THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: pos-condicao - _criar_card_produto_acabado_core md5 vivo % <> esperado 2bb5b74a8e2b4130d426310d62069d82', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._criar_card_produto_importado_core(uuid)')));
  IF v_md5 <> 'e12562cee2e7530c4d7256213e7d4926' THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: pos-condicao - _criar_card_produto_importado_core md5 vivo % <> esperado e12562cee2e7530c4d7256213e7d4926', v_md5 USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.fn_modelo_espelho_categoria()')));
  IF v_md5 <> '640a14561ed5cbe6d02855580915e96c' THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: pos-condicao - fn_modelo_espelho_categoria md5 vivo % <> esperado 640a14561ed5cbe6d02855580915e96c', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['public._salvar_produto_acabado_core(uuid,jsonb,jsonb)', 'public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)', 'public._criar_card_produto_acabado_core(uuid)', 'public._criar_card_produto_importado_core(uuid)']) s(sig)
              WHERE has_function_privilege('public', to_regprocedure(s.sig), 'EXECUTE')
                 OR has_function_privilege('anon', to_regprocedure(s.sig), 'EXECUTE')
                 OR has_function_privilege('authenticated', to_regprocedure(s.sig), 'EXECUTE')) THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: pos-condicao - _core com EXECUTE para PUBLIC/anon/authenticated (inv. #9)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_modelo_espelho_categoria' AND pg_get_triggerdef(oid) LIKE '%linha_id%') THEN
    RAISE EXCEPTION 'pa_pi_linha_produto: pos-condicao - trigger trg_modelo_espelho_categoria sem linha_id' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
