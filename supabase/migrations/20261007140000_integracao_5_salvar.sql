-- Integração + API — 5/6: MÃO DUPLA e integracao_salvar (spec §5 "Regra da mão dupla por origem", R4, R5, V1, V3, n1, n5).
-- D13: nome e REF de revenda/importado ficam IGUAIS nos 2 registros por gatilhos AFTER UPDATE OF nome, ref (modelos →
-- produtos_* e produtos_* → modelos, só quando MUDOU; REF só valor não vazio): o Sheet, a Integração, o Dev e as telas
-- PA/PI passam a gravar os dois lados na mesma transação sem mudar nenhum gravador (fecha V3). A REF do espelho só chega
-- ao card ANTES do envio à Explosão (R2). P-88 A: vale já a partir desta migration (efeito no app no ar — o RODAR avisa).
-- D14: gravador NOVO do preço fixo do importado (espelha o da revenda: auth + loja + módulo produto_importado; sem checagem de
-- :preco_venda — V1/D1) p/ o Sheet (n1), o card (n2) e a integracao_salvar; e o _salvar_produto_importado_core (o SALVAR da
-- tela Importado, na transação do _rev_base do wrapper — R1) passa a aceitar o preço FIXO no _dados (fixo zera o markup do
-- canal; markup sem fixo limpa o fixo; nenhum dos dois mantém; diff mínimo TRECHO_IMP_FIXO na suíte).
-- integracao_salvar: as edições da tela, ATÔMICAS (passo 2 do Salvar — R4): só em produto não integrável, rev por produto
-- (P0409 ASCII), gates do CARD reconferidos no servidor (_integracao_gates — R2/n5), cada campo no MESMO lugar que o card
-- grava (preço do comprado pelo preço FIXO via os WRAPPERS; nome/REF do comprado pelos gatilhos), Keywords = UPDATE SÓ da
-- coluna com conferência do valor carregado (R5, P0409 keywords_mudou), log 'editar' com antes/depois.
-- Contagens: +5 funções (1 redefinida não conta) | +3 gatilhos. Inverso: supabase/rollback/20261007140000_integracao_5_salvar_down.sql.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL transaction_timeout = '3s';

DO $guarda$
DECLARE
  v_def text := pg_get_functiondef('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'::regprocedure);
BEGIN
  IF to_regprocedure('public.fn_integracao_trava_modelos()') IS NULL THEN
    RAISE EXCEPTION 'integracao_5: aplique a migration 4 antes' USING ERRCODE = 'P0001';
  END IF;
  IF md5(v_def) <> '47584858f55524d18d326dfff00139e6' AND position('[integracao v1]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'integracao_5: _salvar_produto_importado_core com texto inesperado (md5 %)', md5(v_def) USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.salvar_precos_fixo_produto_acabado(uuid,boolean,numeric,boolean,numeric)') IS NULL THEN
    RAISE EXCEPTION 'integracao_5: salvar_precos_fixo_produto_acabado ausente' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_modelo_espelho_nome_ref()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref text := nullif(btrim(coalesce(NEW.ref::text, '')), '');
  v_ref_mudou boolean := OLD.ref IS DISTINCT FROM NEW.ref;
BEGIN
  -- ruling do controlador, revisão T5 #1 (Important #1 parte 1): a REF só é copiada quando ELA MESMA mudou
  -- (OLD.ref IS DISTINCT FROM NEW.ref no lado que está sendo GRAVADO — aqui, modelos) — nunca "de carona" numa
  -- edição só de nome. Sem isso, renomear só o card sobrescrevia a REF do espelho em silêncio (e vice-versa na
  -- outra função), e um produto travado com ref_sku marcado mas nome não marcado ficava sem conseguir renomear
  -- (a trava recusava a mudança de REF que o gatilho tentava fazer de carona). Nome continua sempre.
  -- ruling do controlador, revisão T5 #3 (Important #2): AND <tabela>.tenant_id = NEW.tenant_id em TODAS as 3
  -- UPDATEs de sincronização — sem isso, produtos_importados (que, ao contrário de produtos_acabados, NÃO tem
  -- um trg_pi_modelo_tenant equivalente ao trg_pa_modelo_tenant) deixava um usuário da loja A vincular seu
  -- importado a um card da loja B (via modelo_id) e o gatilho escrevia nome/REF na linha de OUTRA loja.
  -- ruling do controlador, revisão T5 #5 (Minor #5): produtos_acabados/produtos_importados.nome é varchar(200)
  -- (modelos.nome é varchar(255)) — um nome de 201-255 chars gravado no card daria 22001 sem tradução ao tentar
  -- sincronizar. Recusa cedo com mensagem PT clara (P0001), ANTES do UPDATE.
  IF length(NEW.nome) > 200 THEN
    RAISE EXCEPTION 'Nome muito longo para o Produto % (máx. 200 caracteres).',
      CASE NEW.origem WHEN 'revenda' THEN 'Acabado' ELSE 'Importado' END USING ERRCODE = 'P0001';
  END IF;
  IF NEW.origem = 'revenda' THEN
    UPDATE public.produtos_acabados pa
       SET nome = NEW.nome, ref = CASE WHEN v_ref_mudou THEN coalesce(v_ref, pa.ref) ELSE pa.ref END
     WHERE pa.modelo_id = NEW.id
       AND pa.tenant_id = NEW.tenant_id
       AND (pa.nome IS DISTINCT FROM NEW.nome OR (v_ref_mudou AND v_ref IS NOT NULL AND pa.ref IS DISTINCT FROM v_ref));
  ELSIF NEW.origem = 'importado' THEN
    UPDATE public.produtos_importados pi
       SET nome = NEW.nome, ref = CASE WHEN v_ref_mudou THEN coalesce(v_ref, pi.ref) ELSE pi.ref END
     WHERE pi.modelo_id = NEW.id
       AND pi.tenant_id = NEW.tenant_id
       AND (pi.nome IS DISTINCT FROM NEW.nome OR (v_ref_mudou AND v_ref IS NOT NULL AND pi.ref IS DISTINCT FROM v_ref));
  END IF;
  RETURN NULL;
END
$function$;

CREATE OR REPLACE FUNCTION public.fn_espelho_modelo_nome_ref()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref text := nullif(btrim(coalesce(NEW.ref, '')), '');
  v_ref_mudou boolean := OLD.ref IS DISTINCT FROM NEW.ref;
BEGIN
  IF NEW.modelo_id IS NULL THEN
    RETURN NULL;
  END IF;
  -- R2 (G-plano do plano): a REF do espelho só chega ao card enquanto o card deixaria mudar a REF (a régua do refEditavel:
  -- ANTES do envio à Explosão); depois disso não propaga (os SKUs guardam a REF do card). O nome vale sempre.
  -- ruling do controlador, revisão T5 #1 (Important #1 parte 1, espelhado aqui): idem — só copia a REF quando
  -- ELA MESMA mudou no produto espelho (v_ref_mudou), nunca de carona numa edição só de nome.
  -- ruling do controlador, revisão T5 #3 (Important #2, espelhado aqui): AND m.tenant_id = NEW.tenant_id — mesmo
  -- fix de isolamento por loja, agora no sentido produto->card.
  UPDATE public.modelos m
     SET nome = NEW.nome,
         ref = CASE WHEN v_ref_mudou AND v_ref IS NOT NULL AND NOT coalesce(m.enviado_cad, false) THEN v_ref ELSE m.ref END
   WHERE m.id = NEW.modelo_id
     AND m.tenant_id = NEW.tenant_id
     AND (m.nome IS DISTINCT FROM NEW.nome
          OR (v_ref_mudou AND v_ref IS NOT NULL AND NOT coalesce(m.enviado_cad, false) AND m.ref::text IS DISTINCT FROM v_ref));
  RETURN NULL;
END
$function$;

CREATE OR REPLACE TRIGGER trg_modelo_espelho_nome_ref AFTER UPDATE OF nome, ref ON public.modelos
  FOR EACH ROW WHEN (NEW.origem IN ('revenda', 'importado') AND (OLD.nome IS DISTINCT FROM NEW.nome OR OLD.ref IS DISTINCT FROM NEW.ref))
  EXECUTE FUNCTION public.fn_modelo_espelho_nome_ref();
CREATE OR REPLACE TRIGGER trg_espelho_modelo_nome_ref AFTER UPDATE OF nome, ref ON public.produtos_acabados
  FOR EACH ROW WHEN (OLD.nome IS DISTINCT FROM NEW.nome OR OLD.ref IS DISTINCT FROM NEW.ref)
  EXECUTE FUNCTION public.fn_espelho_modelo_nome_ref();
CREATE OR REPLACE TRIGGER trg_espelho_modelo_nome_ref AFTER UPDATE OF nome, ref ON public.produtos_importados
  FOR EACH ROW WHEN (OLD.nome IS DISTINCT FROM NEW.nome OR OLD.ref IS DISTINCT FROM NEW.ref)
  EXECUTE FUNCTION public.fn_espelho_modelo_nome_ref();

CREATE OR REPLACE FUNCTION public._salvar_precos_fixo_produto_importado_core(_produto_id uuid, _tocar_atacado boolean,
  _preco_atacado_fixo numeric, _tocar_varejo boolean, _preco_varejo_fixo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid;
begin
  -- D14: espelho de _salvar_precos_fixo_produto_acabado_core — preço EXATO; fixar um canal LIMPA o markup dele.
  if auth.uid() is null then
    raise exception 'Não autenticado';
  end if;
  v_tenant := public.get_user_tenant_id();
  if v_tenant = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'Loja inativa ou sem tenant — operação não permitida' using errcode = '42501';
  end if;
  if (_tocar_atacado and _preco_atacado_fixo is not null and _preco_atacado_fixo <= 0)
     or (_tocar_varejo and _preco_varejo_fixo is not null and _preco_varejo_fixo <= 0) then
    raise exception 'O preço precisa ser maior que zero.' using errcode = 'P0001';
  end if;
  update public.produtos_importados
    set preco_atacado_fixo = case when _tocar_atacado then _preco_atacado_fixo else preco_atacado_fixo end,
        markup_atacado = case when _tocar_atacado and _preco_atacado_fixo is not null then null else markup_atacado end,
        preco_varejo_fixo = case when _tocar_varejo then _preco_varejo_fixo else preco_varejo_fixo end,
        markup_varejo = case when _tocar_varejo and _preco_varejo_fixo is not null then null else markup_varejo end,
        updated_at = now()
    where id = _produto_id and tenant_id = v_tenant;
  if not found then
    raise exception 'Produto não encontrado' using errcode = 'P0001';
  end if;
  perform public._imp_recomputar_precos_modelo(_produto_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.salvar_precos_fixo_produto_importado(_produto_id uuid, _tocar_atacado boolean,
  _preco_atacado_fixo numeric, _tocar_varejo boolean, _preco_varejo_fixo numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.tenant_module_enabled('produto_importado') then
    raise exception 'Módulo Produto Importado não habilitado para esta loja' using errcode = '42501';
  end if;
  perform public._salvar_precos_fixo_produto_importado_core(
    _produto_id, _tocar_atacado, _preco_atacado_fixo, _tocar_varejo, _preco_varejo_fixo);
end;
$function$;

-- D14/R1 — save do importado (antes = md5 47584858…; depois = antes + TRECHO_IMP_FIXO antes das variantes)
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

  -- [integracao v1] D14/R1: o preço do Importado grava no SALVAR da tela, NESTA transação (a do _rev_base do wrapper).
  -- Preço FIXO no _dados = preço exato do canal e ZERA o markup dele; sem fixo, markup não-nulo LIMPA o fixo ("última
  -- edição manda", como a revenda — fix 2efa2ba); sem nenhum dos dois, o fixo fica (outros gravadores não mandam as chaves).
  if coalesce(nullif(_dados->>'preco_atacado_fixo','')::numeric, 1) <= 0
     or coalesce(nullif(_dados->>'preco_varejo_fixo','')::numeric, 1) <= 0 then
    raise exception 'O preço precisa ser maior que zero.' using errcode = 'P0001';
  end if;
  update public.produtos_importados p
     set preco_atacado_fixo = n.af, markup_atacado = n.am, preco_varejo_fixo = n.vf, markup_varejo = n.vm
    from (select
            case when nullif(_dados->>'preco_atacado_fixo','') is not null then (_dados->>'preco_atacado_fixo')::numeric
                 when nullif(_dados->>'markup_atacado','') is not null then null else x.preco_atacado_fixo end as af,
            case when nullif(_dados->>'preco_atacado_fixo','') is not null then null else x.markup_atacado end as am,
            case when nullif(_dados->>'preco_varejo_fixo','') is not null then (_dados->>'preco_varejo_fixo')::numeric
                 when nullif(_dados->>'markup_varejo','') is not null then null else x.preco_varejo_fixo end as vf,
            case when nullif(_dados->>'preco_varejo_fixo','') is not null then null else x.markup_varejo end as vm
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

CREATE OR REPLACE FUNCTION public.integracao_salvar(_itens jsonb, _keywords jsonb DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public._integracao_exige(true);
  v_itens jsonb := coalesce(_itens, '[]'::jsonb);
  v_chaves_ok text[] := ARRAY['nome', 'ref', 'preco_anterior', 'preco_venda', 'peso_kg', 'ncm', 'titulo_pagina',
                              'descricao_produto', 'comprimento_cm', 'largura_cm', 'altura_cm', 'fotos_modelo'];
  v_num text[] := ARRAY['preco_anterior', 'preco_venda', 'peso_kg', 'comprimento_cm', 'largura_cm', 'altura_cm'];
  m public.modelos%ROWTYPE;
  r record;
  v_c jsonb;
  v_g jsonb;
  v_k text;
  v_gate text;
  v_antes jsonb;
  v_depois jsonb;
  v_prod uuid;
  v_revs jsonb := '{}'::jsonb;
  v_n integer := 0;
  v_kw_atual text;
  v_kw_novo text;
BEGIN
  IF jsonb_typeof(v_itens) <> 'array' OR jsonb_array_length(v_itens) > 50 THEN
    RAISE EXCEPTION 'Envie no máximo 50 produtos por vez.' USING ERRCODE = 'P0001';
  END IF;
  -- ruling do controlador, revisão T5 #6 (Minor #6, mesmo padrão de integracao_marcar/revisão T3 Minor #3):
  -- modelo_id duplicado no payload tornaria o DISTINCT ON abaixo não-determinístico (2 conjuntos de campos
  -- diferentes pro mesmo produto — qual vale, e com qual rev checar?); recusa cedo, ANTES de qualquer lock.
  -- resíduos T7 #6 (T5 N3, ruling do controlador, mesmo fix da T3 C): (a) item SEM modelo_id ganha mensagem
  -- PRÓPRIA, ANTES do check de duplicata; (b) duplicata comparada por ::uuid (não texto cru), então um mesmo UUID
  -- em caixa alta/baixa conta como o mesmo produto.
  IF jsonb_array_length(v_itens) > 0
     AND (SELECT count(*) FILTER (WHERE e.x ->> 'modelo_id' IS NULL) FROM jsonb_array_elements(v_itens) AS e(x)) > 0 THEN
    RAISE EXCEPTION 'Envie o modelo_id de cada produto.' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_array_length(v_itens) > 0 AND (SELECT count(*) FROM jsonb_array_elements(v_itens) AS e(x)) <>
     (SELECT count(DISTINCT (e.x ->> 'modelo_id')::uuid) FROM jsonb_array_elements(v_itens) AS e(x)) THEN
    RAISE EXCEPTION 'Produto repetido na lista — envie cada produto uma vez só.' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN
    SELECT DISTINCT ON ((e.x ->> 'modelo_id')::uuid) (e.x ->> 'modelo_id')::uuid AS modelo_id,
           (e.x ->> 'rev')::integer AS rev_base, coalesce(e.x -> 'campos', '{}'::jsonb) AS campos
      FROM jsonb_array_elements(v_itens) AS e(x)
     ORDER BY (e.x ->> 'modelo_id')::uuid
  LOOP
    v_c := r.campos;
    IF jsonb_typeof(v_c) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_c) AS k(k) WHERE k.k <> ALL(v_chaves_ok)) THEN
      RAISE EXCEPTION 'Campo desconhecido na gravação da Integração.' USING ERRCODE = 'P0001';
    END IF;
    -- ruling do controlador, revisão T5 #6 (Minor #6): item sem campo nenhum (campos: {}) é PULADO por inteiro —
    -- sem lock, sem checagem de rev, sem UPDATE, sem bump de rev, sem log — não é um "editar" de fato.
    IF NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_c)) THEN
      CONTINUE;
    END IF;
    SELECT * INTO m FROM public.modelos x WHERE x.id = r.modelo_id AND x.tenant_id = v_tenant FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produto não encontrado nesta loja.' USING ERRCODE = 'P0001';
    END IF;
    IF m.rev IS DISTINCT FROM r.rev_base THEN
      RAISE EXCEPTION 'conflito_versao: o produto foi salvo por outra pessoa' USING ERRCODE = 'P0409';
    END IF;
    v_g := public._integracao_gates(r.modelo_id);
    IF v_g ->> 'estado' <> 'nao_integravel' THEN
      RAISE EXCEPTION 'integracao_travado: produto' USING ERRCODE = '42501';
    END IF;
    -- R2/V1/n5: a MESMA regra do card, campo a campo, reconferida no servidor (inclui módulo da origem)
    FOR v_k IN SELECT k.k FROM jsonb_object_keys(v_c) AS k(k) ORDER BY 1 LOOP
      v_gate := CASE v_k WHEN 'nome' THEN 'compartilhado' WHEN 'descricao_produto' THEN 'compartilhado'
                         WHEN 'fotos_modelo' THEN 'compartilhado' WHEN 'ref' THEN 'ref'
                         WHEN 'preco_venda' THEN 'preco' WHEN 'preco_anterior' THEN 'preco' ELSE 'planejamento' END;
      IF NOT coalesce((v_g -> v_gate ->> 'ok')::boolean, false) THEN
        RAISE EXCEPTION 'integracao_sem_permissao: %', v_k USING ERRCODE = '42501';
      END IF;
    END LOOP;
    IF v_c ? 'nome' AND nullif(btrim(coalesce(v_c ->> 'nome', '')), '') IS NULL THEN
      RAISE EXCEPTION 'O nome não pode ficar vazio.' USING ERRCODE = 'P0001';
    END IF;
    IF v_c ? 'ref' AND nullif(btrim(coalesce(v_c ->> 'ref', '')), '') IS NULL THEN
      RAISE EXCEPTION 'A REF não pode ficar vazia.' USING ERRCODE = 'P0001';
    END IF;
    -- ruling do controlador, revisão T5 #5 (Minor #5): recusa cedo, ANTES do UPDATE em modelos, um nome de comprado
    -- que a sincronização (fn_modelo_espelho_nome_ref) rejeitaria de qualquer forma no espelho (varchar(200)) —
    -- mensagem clara aqui em vez de deixar o gatilho estourar depois do UPDATE já ter mexido no card.
    IF v_c ? 'nome' AND coalesce(m.origem, 'interno') IN ('revenda', 'importado')
       AND length(btrim(v_c ->> 'nome')) > 200 THEN
      RAISE EXCEPTION 'Nome muito longo para o Produto % (máx. 200 caracteres).',
        CASE m.origem WHEN 'revenda' THEN 'Acabado' ELSE 'Importado' END USING ERRCODE = 'P0001';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(v_c) AS e(key, value) WHERE e.key = ANY(v_num)
                AND NOT CASE WHEN jsonb_typeof(e.value) = 'null' THEN true
                             WHEN jsonb_typeof(e.value) = 'number' THEN (e.value #>> '{}')::numeric >= 0
                             ELSE false END) THEN
      RAISE EXCEPTION 'Valor numérico inválido (use número maior ou igual a zero).' USING ERRCODE = 'P0001';
    END IF;
    IF v_c ? 'fotos_modelo' THEN
      IF jsonb_typeof(v_c -> 'fotos_modelo') <> 'array'
         OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_c -> 'fotos_modelo') AS p(x)
                     WHERE NOT starts_with(p.x, v_tenant::text || '/')) THEN
        RAISE EXCEPTION 'Foto inválida (de outra loja).' USING ERRCODE = 'P0001';
      END IF;
    END IF;
    v_antes := to_jsonb(m);
    UPDATE public.modelos SET
      nome = CASE WHEN v_c ? 'nome' THEN btrim(v_c ->> 'nome') ELSE nome END,
      ref = CASE WHEN v_c ? 'ref' THEN btrim(v_c ->> 'ref') ELSE ref END,
      preco_anterior = CASE WHEN v_c ? 'preco_anterior' THEN (v_c ->> 'preco_anterior')::numeric ELSE preco_anterior END,
      preco_venda = CASE WHEN v_c ? 'preco_venda' AND coalesce(m.origem, 'interno') NOT IN ('revenda', 'importado')
                         THEN (v_c ->> 'preco_venda')::numeric ELSE preco_venda END,
      peso_kg = CASE WHEN v_c ? 'peso_kg' THEN (v_c ->> 'peso_kg')::numeric ELSE peso_kg END,
      ncm = CASE WHEN v_c ? 'ncm' THEN nullif(btrim(coalesce(v_c ->> 'ncm', '')), '') ELSE ncm END,
      titulo_pagina = CASE WHEN v_c ? 'titulo_pagina' THEN nullif(btrim(coalesce(v_c ->> 'titulo_pagina', '')), '') ELSE titulo_pagina END,
      descricao_produto = CASE WHEN v_c ? 'descricao_produto' THEN nullif(btrim(coalesce(v_c ->> 'descricao_produto', '')), '') ELSE descricao_produto END,
      comprimento_cm = CASE WHEN v_c ? 'comprimento_cm' THEN (v_c ->> 'comprimento_cm')::numeric ELSE comprimento_cm END,
      largura_cm = CASE WHEN v_c ? 'largura_cm' THEN (v_c ->> 'largura_cm')::numeric ELSE largura_cm END,
      altura_cm = CASE WHEN v_c ? 'altura_cm' THEN (v_c ->> 'altura_cm')::numeric ELSE altura_cm END,
      fotos_modelo = CASE WHEN v_c ? 'fotos_modelo'
                          THEN ARRAY(SELECT p.x FROM jsonb_array_elements_text(v_c -> 'fotos_modelo') AS p(x)) ELSE fotos_modelo END
    WHERE id = r.modelo_id;
    -- preço de venda do COMPRADO = preço FIXO pelo gravador de cada origem (os WRAPPERS — R4; V1: sem checagem nova neles)
    IF v_c ? 'preco_venda' AND m.origem IN ('revenda', 'importado') THEN
      IF m.origem = 'revenda' THEN
        SELECT pa.id INTO v_prod FROM public.produtos_acabados pa WHERE pa.modelo_id = r.modelo_id;
        IF v_prod IS NULL THEN
          RAISE EXCEPTION 'Produto de revenda sem cadastro no Produto Acabado.' USING ERRCODE = 'P0001';
        END IF;
        PERFORM public.salvar_precos_fixo_produto_acabado(v_prod, false, NULL, true, (v_c ->> 'preco_venda')::numeric);
      ELSE
        SELECT pi.id INTO v_prod FROM public.produtos_importados pi WHERE pi.modelo_id = r.modelo_id;
        IF v_prod IS NULL THEN
          RAISE EXCEPTION 'Produto importado sem cadastro no Produto Importado.' USING ERRCODE = 'P0001';
        END IF;
        PERFORM public.salvar_precos_fixo_produto_importado(v_prod, false, NULL, true, (v_c ->> 'preco_venda')::numeric);
      END IF;
    END IF;
    SELECT to_jsonb(x) INTO v_depois FROM public.modelos x WHERE x.id = r.modelo_id;
    PERFORM public._integracao_logar(v_tenant, 'editar', r.modelo_id, jsonb_build_object('campos',
      (SELECT jsonb_object_agg(k.k, jsonb_build_object('antes', v_antes -> k.k, 'depois', v_depois -> k.k))
         FROM jsonb_object_keys(v_c) AS k(k))), NULL);
    v_revs := v_revs || jsonb_build_object(r.modelo_id::text, (v_depois ->> 'rev')::integer);
    v_n := v_n + 1;
  END LOOP;

  IF _keywords IS NOT NULL THEN
    -- R5: SÓ a coluna keywords, com conferência do valor carregado (nunca o upsert da linha da Config)
    IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
      RAISE EXCEPTION 'integracao_sem_permissao: keywords' USING ERRCODE = '42501';
    END IF;
    SELECT tc.keywords INTO v_kw_atual FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant FOR UPDATE;
    IF coalesce(v_kw_atual, '') IS DISTINCT FROM coalesce(_keywords ->> 'esperado', '') THEN
      RAISE EXCEPTION 'keywords_mudou: as keywords da loja mudaram' USING ERRCODE = 'P0409';
    END IF;
    v_kw_novo := nullif(btrim(coalesce(_keywords ->> 'valor', '')), '');
    UPDATE public.tenant_config SET keywords = v_kw_novo WHERE tenant_id = v_tenant;
    PERFORM public._integracao_logar(v_tenant, 'editar', NULL,
      jsonb_build_object('keywords', jsonb_build_object('antes', v_kw_atual, 'depois', v_kw_novo)), NULL);
  END IF;
  RETURN jsonb_build_object('salvos', v_n, 'revs', v_revs);
END
$function$;

REVOKE EXECUTE ON FUNCTION public._salvar_precos_fixo_produto_importado_core(uuid, boolean, numeric, boolean, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.salvar_precos_fixo_produto_importado(uuid, boolean, numeric, boolean, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_precos_fixo_produto_importado(uuid, boolean, numeric, boolean, numeric) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.integracao_salvar(jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integracao_salvar(jsonb, jsonb) TO authenticated;

DO $pos$
BEGIN
  IF position('[integracao v1]' IN pg_get_functiondef('public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'integracao_5: save do importado sem o trecho novo' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_modelo_espelho_nome_ref', 'trg_espelho_modelo_nome_ref')) <> 3 THEN
    RAISE EXCEPTION 'integracao_5: gatilhos da mao dupla incompletos' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('authenticated', 'public._salvar_precos_fixo_produto_importado_core(uuid,boolean,numeric,boolean,numeric)', 'EXECUTE')
     OR has_function_privilege('public', 'public._salvar_precos_fixo_produto_importado_core(uuid,boolean,numeric,boolean,numeric)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.integracao_salvar(jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.integracao_salvar(jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'integracao_5: ACL errada (inv. 9)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
