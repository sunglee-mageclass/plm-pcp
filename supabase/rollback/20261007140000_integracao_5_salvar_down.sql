-- Inverso de 20261007140000_integracao_5_salvar.sql — MONTADO pela Task 5 (o save do importado volta ao texto de ANTES,
-- gerado por .superpowers/integracao/mig/dump_antes.sh — nunca editar à mão). Rodar SÓ depois do inverso 6 (LIFO).
-- Preços fixos de importado já gravados FICAM (a coluna já existia; o recálculo continua lendo); a mão dupla por gatilho sai.
-- D40/revisão T1 #1: o $guarda$ recusa se _salvar_produto_importado_core mudou depois da migration 5 (aceita só o
-- "antes" exato ou "antes"+TRECHO_IMP_FIXO — nunca sobrescreve uma mudança de outra frente em silêncio).
-- ruling do controlador, G-migration fix 4 #K1 (clareza, sem mudança de comportamento): ESTA VOLTA NÃO DESFAZ O
-- BACKFILL DA REF (J1/P-90 A) que a IDA desta migration faz. As REFs de Produto Acabado/Importado que a ida
-- corrigiu (~32 na cópia, na contagem da rodada gmig-fix3/3b) FICAM como estão depois da volta — não existe
-- código aqui que devolva o valor antigo (decisão aceita pelo dono na P-90: o backfill é irreversível por
-- construção, só um pg_dump tirado ANTES da ida devolveria as REFs de antes). O `$guarda$`/os md5 de função
-- abaixo NÃO mudam por causa disto — é só documentação do comportamento já existente.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_def text;
BEGIN
  IF to_regprocedure('public._integracao_ler(text,boolean,text,integer,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'integracao_5_down: volte a migration 6 antes (LIFO)' USING ERRCODE = 'P0001';
  END IF;
  v_def := pg_get_functiondef('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'::regprocedure);
  IF md5(v_def) <> '47584858f55524d18d326dfff00139e6'
     AND NOT (position('[integracao v1]' IN v_def) > 0
              AND md5(replace(v_def,
'  -- [integracao v1] D14/R1: o preço do Importado grava no SALVAR da tela, NESTA transação (a do _rev_base do wrapper).
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
  if coalesce(nullif(_dados->>''preco_atacado_fixo'','''')::numeric, 1) <= 0
     or coalesce(nullif(_dados->>''preco_varejo_fixo'','''')::numeric, 1) <= 0 then
    raise exception ''O preço precisa ser maior que zero.'' using errcode = ''P0001'';
  end if;
  update public.produtos_importados p
     set preco_atacado_fixo = n.af, markup_atacado = n.am, preco_varejo_fixo = n.vf, markup_varejo = n.vm
    from (select
            case when _dados ? ''preco_atacado_fixo'' then nullif(_dados->>''preco_atacado_fixo'','''')::numeric
                 when nullif(_dados->>''markup_atacado'','''') is not null then null
                 else x.preco_atacado_fixo end as af,
            case when _dados ? ''preco_atacado_fixo'' and nullif(_dados->>''preco_atacado_fixo'','''') is not null then null
                 when _dados ? ''preco_atacado_fixo'' then coalesce(nullif(_dados->>''markup_atacado'','''')::numeric, x.markup_atacado)
                 when nullif(_dados->>''markup_atacado'','''') is not null then nullif(_dados->>''markup_atacado'','''')::numeric
                 else x.markup_atacado end as am,
            case when _dados ? ''preco_varejo_fixo'' then nullif(_dados->>''preco_varejo_fixo'','''')::numeric
                 when nullif(_dados->>''markup_varejo'','''') is not null then null
                 else x.preco_varejo_fixo end as vf,
            case when _dados ? ''preco_varejo_fixo'' and nullif(_dados->>''preco_varejo_fixo'','''') is not null then null
                 when _dados ? ''preco_varejo_fixo'' then coalesce(nullif(_dados->>''markup_varejo'','''')::numeric, x.markup_varejo)
                 when nullif(_dados->>''markup_varejo'','''') is not null then nullif(_dados->>''markup_varejo'','''')::numeric
                 else x.markup_varejo end as vm
            from public.produtos_importados x where x.id = v_id) n
   where p.id = v_id
     and (p.preco_atacado_fixo, p.markup_atacado, p.preco_varejo_fixo, p.markup_varejo) is distinct from (n.af, n.am, n.vf, n.vm);

', '')) = '47584858f55524d18d326dfff00139e6') THEN
    RAISE EXCEPTION 'integracao_5_down: _salvar_produto_importado_core mudou depois da migration 5 - refazer o inverso' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DROP TRIGGER IF EXISTS trg_modelo_espelho_nome_ref ON public.modelos;
DROP TRIGGER IF EXISTS trg_espelho_modelo_nome_ref ON public.produtos_acabados;
DROP TRIGGER IF EXISTS trg_espelho_modelo_nome_ref ON public.produtos_importados;
DROP FUNCTION IF EXISTS public.fn_modelo_espelho_nome_ref();
DROP FUNCTION IF EXISTS public.fn_espelho_modelo_nome_ref();
DROP FUNCTION IF EXISTS public.integracao_salvar(jsonb, jsonb);
DROP FUNCTION IF EXISTS public.salvar_precos_fixo_produto_importado(uuid, boolean, numeric, boolean, numeric);
DROP FUNCTION IF EXISTS public._salvar_precos_fixo_produto_importado_core(uuid, boolean, numeric, boolean, numeric);

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
      desconto_pct, cotacao_final, markup_atacado, markup_varejo
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
      nullif(_dados->>'markup_atacado','')::numeric, nullif(_dados->>'markup_varejo','')::numeric
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
      updated_at = now()
    where id = _id and tenant_id = v_tenant
    returning id into v_id;
    if v_id is null then raise exception 'Produto não encontrado'; end if;
  end if;

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

DO $pos$
DECLARE
  v_n integer;
BEGIN
  IF md5(pg_get_functiondef('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'::regprocedure)) <> '47584858f55524d18d326dfff00139e6' THEN
    RAISE EXCEPTION 'integracao_5_down: save do importado nao voltou ao texto de antes' USING ERRCODE = 'P0001';
  END IF;
  -- ruling do controlador, G-migration fix 1 #G9 (A-M4 + B-M5): o pos-check só conferia integracao_salvar + o
  -- md5 do importado — agora confere as OUTRAS 4 funções novas da migration 5 (fn_modelo_espelho_nome_ref,
  -- fn_espelho_modelo_nome_ref, salvar_precos_fixo_produto_importado, _salvar_precos_fixo_produto_importado_core)
  -- E os 3 gatilhos da mão dupla, não só integracao_salvar sozinho.
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('integracao_salvar', 'fn_modelo_espelho_nome_ref',
     'fn_espelho_modelo_nome_ref', 'salvar_precos_fixo_produto_importado', '_salvar_precos_fixo_produto_importado_core');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'integracao_5_down: funcoes da migration 5 ainda existem (%)', v_n USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_n FROM pg_trigger t JOIN pg_class k ON k.oid = t.tgrelid
   WHERE k.relnamespace = 'public'::regnamespace AND NOT t.tgisinternal
     AND t.tgname IN ('trg_modelo_espelho_nome_ref', 'trg_espelho_modelo_nome_ref');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'integracao_5_down: gatilhos da mao dupla ainda existem (%)', v_n USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
