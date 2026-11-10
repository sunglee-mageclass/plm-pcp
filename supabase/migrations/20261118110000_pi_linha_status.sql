-- Paridade PA/PI (Task 2, nov/2026) — `_salvar_produto_importado_core` aceita `linha_id` e `status` em _dados (espelho da Task 1 do PA).
--  * `linha_id` e REFLEXIVO: a linha e do MODELO. Com `_dados ? 'linha_id'` e o produto com card (modelo_id), grava
--    `modelos.linha_id` do espelho (so se mudou: IS DISTINCT FROM). Linha de outra loja/inexistente = P0001 'Linha de outra loja'.
--    Produto sem card: aceita e ignora. Chave ausente = MANTEM (padrao do tamanho_tipo; site antigo nao apaga).
--  * `status` ('pendente'|'reprovado'; vazio limpa) e do PRODUTO e so vale SEM card (com card manda o kanban): coluna NOVA
--    `produtos_importados.status text` + CHECK `produtos_importados_status_chk` (NOT VALID + VALIDATE). Outro valor = P0001.
-- ADITIVO: nenhuma outra coluna/regra do core muda (4 args: tem `_etapas`); o restante do corpo fica byte a byte igual.
-- Gerado por TROCA EXATA (6 edicoes, cada ancora casou 1x) sobre o pg_get_functiondef vivo (I3a, md5 f28985c19fe5efa4f08011137e20f51f); o gerador e
-- o diff estao no relatorio da Task 2 (.superpowers/sdd/2026-11-10-paridade-pa-pi-linha-status/task-2-report.md).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)
--     ANTES  f28985c19fe5efa4f08011137e20f51f  (= I3a, 20261030100000)
--     DEPOIS d857ebb676241e411666d699142ccabd  (este arquivo; reaplicar = no-op)
--   Qualquer outro texto -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: ADD COLUMN/ADD CONSTRAINT = AccessExclusive em produtos_importados por instantes (lock_timeout 1500ms; 55P03 = nada mudou,
-- rodar de novo em horario calmo); VALIDATE = ShareUpdateExclusive. Nada em auth/storage. ACL: o REVOKE dos 3 repete a invariante #9
-- (CREATE OR REPLACE ja mantem a ACL; conferido no fim).
-- Inverso: supabase/rollback/20261118110000_pi_linha_status_down.sql. Banco ANTES do site.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL statement_timeout = '15s';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF to_regprocedure('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'pi_linha_status: _salvar_produto_importado_core nao existe neste banco' USING ERRCODE = 'P0001';
  END IF;
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)')));
  IF v_md5 NOT IN ('f28985c19fe5efa4f08011137e20f51f', 'd857ebb676241e411666d699142ccabd') THEN
    RAISE EXCEPTION 'pi_linha_status: _salvar_produto_importado_core mudou desde o planejamento (md5 %) - outra frente mexeu; conferir antes de aplicar', v_md5
      USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

ALTER TABLE public.produtos_importados ADD COLUMN IF NOT EXISTS status text;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produtos_importados_status_chk'
                    AND conrelid = 'public.produtos_importados'::regclass) THEN
    ALTER TABLE public.produtos_importados
      ADD CONSTRAINT produtos_importados_status_chk CHECK (status IS NULL OR status IN ('pendente', 'reprovado')) NOT VALID;
  END IF;
END $chk$;
ALTER TABLE public.produtos_importados VALIDATE CONSTRAINT produtos_importados_status_chk;
COMMENT ON COLUMN public.produtos_importados.status IS 'Pendente/Reprovado do produto SEM card (paridade Plan. Tecido). Com card (modelo_id) manda o kanban; este valor e ignorado.';

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
      status  -- [pa-linha v1]
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
      v_status  -- [pa-linha v1]
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

REVOKE EXECUTE ON FUNCTION public._salvar_produto_importado_core(uuid, jsonb, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

DO $pos$
DECLARE
  v_md5 text;
BEGIN
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)')));
  IF v_md5 <> 'd857ebb676241e411666d699142ccabd' THEN
    RAISE EXCEPTION 'pi_linha_status: pos-condicao - md5 vivo % <> esperado d857ebb676241e411666d699142ccabd', v_md5 USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('public', to_regprocedure('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'), 'EXECUTE') THEN
    RAISE EXCEPTION 'pi_linha_status: pos-condicao - _core com EXECUTE para PUBLIC/anon/authenticated (inv. #9)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'produtos_importados_status_chk' AND convalidated) THEN
    RAISE EXCEPTION 'pi_linha_status: pos-condicao - CHECK de status ausente/nao validado' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

COMMIT;
