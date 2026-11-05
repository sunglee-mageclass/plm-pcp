-- Salvar unico do Planejamento (nucleo atomico) - Task 1 da frente "Salvar unico".
-- Cria a RPC salvar_card_planejamento: UMA transacao que orquestra o nucleo do Salvar do Sheet do Planejamento
-- (cabecalho, BOM, insumos/etiquetas, CAD, mao de obra, grade da revenda, revisao #Erro), CHAMANDO os _core que ja existem.
-- NAO redefine nenhum _core (md5 inalterado; a ida confere que eles existem com a assinatura esperada).
--
-- O que ela e: o novo "wrapper" (invariante 9). Faz os portoes (modulo + pagina) e PERFORMa os _core. Se QUALQUER passo falha
-- (RAISE ou erro de um _core), a funcao inteira aborta e NADA grava (nem o cabecalho, nem o rev).
--
-- Objetos NOVOS (nada existente e substituido):
--   public._salvar_etiquetas_modelo_core(uuid, jsonb)  - diff de modelo_etiquetas (a unica parte sem _core hoje; porta o
--                                                         planoEtiquetas do front). DEFINER, EXECUTE revogado dos 3.
--   public.salvar_card_planejamento(10 args)           - a RPC. DEFINER, search_path=public, EXECUTE so authenticated/service_role.
--
-- Decisoes de desenho (para quem for rever):
--  * Trava otimista UNICA: o passo 2 faz SELECT rev ... FOR UPDATE e compara com _rev_base (NULL = sem trava, manutencao/teste).
--    Os _core de BOM/grade recebem _rev_base => NULL (nao re-travam).
--  * Portao por bloco = o MESMO dos wrappers que a tela usava antes (senao a RPC viraria um atalho que fura a permissao
--    mais forte): BOM = Desenvolvimento (BOM inicial, sem nenhuma linha de tecido/aviamento, tambem Planejamento); etiquetas e CAD =
--    Desenvolvimento; mao de obra = EDITAR Planejamento E ver custos; grade da revenda = modulo Produto Acabado + Planejamento OU
--    Desenvolvimento; cabecalho = Planejamento OU Desenvolvimento (o mesmo OU do gatilho de pagina de modelos).
--    Todos os portoes rodam ANTES de qualquer escrita.
--  * Ordem de travas (a "ordem unica" do card): advisory do CARD -> advisory do CAD -> linha de modelos. Quem ja segue a ordem
--    (Enviar a Explosao, aprovar M.O., excluir CAD, PCP Servicos) fica serializado com este Salvar em vez de cruzar travas.
--  * O cabecalho NAO e um jsonb livre: so as colunas do Draft do Sheet (lista fechada abaixo). Chave fora da lista = P0001
--    (nunca grava lancado, enviado_cad, rev, tenant_id, custos derivados...). Chave AUSENTE = a coluna nao e tocada; chave com
--    JSON null = grava NULL (mesma semantica do PATCH que a tela fazia).
--  * Cada bloco jsonb NULL = nao mexe naquele pedaco. Blocos de ESTADO COMPLETO (_bom, _cad, _etiquetas, _mo) exigem a forma
--    certa (listas) - um bloco malformado e recusado em vez de apagar o que o servidor tem.
--  * Card NOVO fica FORA (ruling do plano): so card existente.
-- Mensagens dos RAISE de codigo P0409/P0002 sao SO ASCII (PostgREST 5xx).
BEGIN;

-- ---------------------------------------------------------------------------------------------------------------------
-- Pre-condicao: os _core e auxiliares que esta RPC chama existem com a assinatura esperada (senao PARA, nada muda).
-- ---------------------------------------------------------------------------------------------------------------------
DO $guard$
DECLARE
  v_sig text;
BEGIN
  FOREACH v_sig IN ARRAY ARRAY[
    'public._salvar_modelo_bom_core(uuid,jsonb,jsonb,jsonb,integer)',
    'public._salvar_cad_completo_core(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,text,date)',
    'public._salvar_modelo_servico_mo_core(uuid,jsonb)',
    'public._salvar_grade_revenda_core(uuid,jsonb,integer)',
    'public.marcar_revisao_por_mudanca(uuid,boolean,boolean,boolean)',
    'public._seg_exige_pagina(text[])',
    'public._pode_ver_custos()',
    'public.tenant_module_enabled(text)'
  ] LOOP
    IF to_regprocedure(v_sig) IS NULL THEN
      RAISE EXCEPTION 'salvar_card_planejamento: dependencia ausente: %', v_sig;
    END IF;
  END LOOP;
END
$guard$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Helper: diff de modelo_etiquetas a partir do ESTADO COMPLETO (porta de planoEtiquetas, ficha-calc.ts).
--   * valida = linha com etiqueta_id (linha sem etiqueta_id e ignorada);
--   * numero = posicao (1-based) entre as validas;
--   * com id -> UPDATE (so se algo mudou); sem id -> INSERT; no banco desse modelo e fora dos ids mantidos -> DELETE.
-- Sem portao aqui dentro: quem chama (salvar_card_planejamento) ja conferiu modulo + pagina.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._salvar_etiquetas_modelo_core(_modelo_id uuid, _etiquetas jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_tenant uuid;
  r record;
  v_manter uuid[] := '{}';
  v_novo uuid;
BEGIN
  IF jsonb_typeof(_etiquetas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'etiquetas_invalidas: esperado uma lista' USING ERRCODE = 'P0001';
  END IF;

  SELECT m.tenant_id INTO v_tenant FROM public.modelos m WHERE m.id = _modelo_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE = 'P0002';
  END IF;

  -- Linhas validas, com a posicao entre as validas (planoEtiquetas: numero = i + 1 sobre o filtro).
  FOR r IN
    SELECT
      NULLIF(x.e->>'id', '')::uuid                                   AS id,
      (x.e->>'etiqueta_id')::uuid                                    AS etiqueta_id,
      NULLIF(x.e->>'cor_id', '')::uuid                               AS cor_id,
      row_number() OVER (ORDER BY x.ord)::int                        AS numero,
      round(COALESCE(NULLIF(x.e->>'consumo', '')::numeric, 0), 4)        AS consumo,
      round(COALESCE(NULLIF(x.e->>'loss_percent', '')::numeric, 0), 2)   AS loss_percent,
      round(COALESCE(NULLIF(x.e->>'custo_previsto', '')::numeric, 0), 2) AS custo_previsto
    FROM jsonb_array_elements(_etiquetas) WITH ORDINALITY AS x(e, ord)
    WHERE NULLIF(x.e->>'etiqueta_id', '') IS NOT NULL
    ORDER BY x.ord
  LOOP
    IF r.id IS NOT NULL THEN
      v_manter := v_manter || r.id;
      UPDATE public.modelo_etiquetas me
         SET etiqueta_id = r.etiqueta_id, cor_id = r.cor_id, numero = r.numero,
             consumo = r.consumo, loss_percent = r.loss_percent, custo_previsto = r.custo_previsto
       WHERE me.id = r.id AND me.modelo_id = _modelo_id
         AND (me.etiqueta_id IS DISTINCT FROM r.etiqueta_id OR me.cor_id IS DISTINCT FROM r.cor_id
              OR me.numero IS DISTINCT FROM r.numero OR me.consumo IS DISTINCT FROM r.consumo
              OR me.loss_percent IS DISTINCT FROM r.loss_percent OR me.custo_previsto IS DISTINCT FROM r.custo_previsto);
      IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.modelo_etiquetas me WHERE me.id = r.id AND me.modelo_id = _modelo_id) THEN
        -- id que nao e deste modelo (ou sumiu): nunca grava calado nem recria com outro id.
        RAISE EXCEPTION 'nao_encontrado: etiqueta' USING ERRCODE = 'P0002';
      END IF;
    ELSE
      INSERT INTO public.modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, numero, consumo, loss_percent, custo_previsto)
      VALUES (v_tenant, _modelo_id, r.etiqueta_id, r.cor_id, r.numero, r.consumo, r.loss_percent, r.custo_previsto)
      RETURNING id INTO v_novo;
      -- a linha recem-criada tambem e "mantida" (senao o DELETE abaixo a apagaria).
      v_manter := v_manter || v_novo;
    END IF;
  END LOOP;

  -- Apaga so as linhas DESTE modelo que o estado completo nao manteve.
  DELETE FROM public.modelo_etiquetas me
   WHERE me.modelo_id = _modelo_id AND NOT (me.id = ANY (v_manter));
END
$fn$;

REVOKE EXECUTE ON FUNCTION public._salvar_etiquetas_modelo_core(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- A RPC
-- ---------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.salvar_card_planejamento(
  _modelo_id uuid,
  _header jsonb,
  _rev_base integer,
  _bom jsonb,
  _etiquetas jsonb,
  _cad jsonb,
  _mo jsonb,
  _grade_revenda jsonb,
  _revisao jsonb,
  _flags jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  -- Colunas de modelos que o Salvar do Sheet grava (Draft de modelo-shared.ts + tecidos_planejados). Lista FECHADA.
  c_header_ok constant text[] := ARRAY[
    'nome','ref','estilista_id','linha_id','colecao','colecao_id','subcolecao','semana','mes_id','ano_id',
    'categoria_principal_id','subcategoria1_id','subcategoria2_id','origem','preco_venda','preco_atacado',
    'markup_editado','data_lancamento','tecidos_planejados','status_planejamento','croqui_url','desenho_tecnico_url',
    'fotos_modelo','fotos_referencia','observacoes_gerais','observacoes_mao_obra','versao','modelo_base_id','custo_simulado',
    'modelista_id','piloteiro1_id','piloteiro2_id','piloteiro3_id','data_piloto1','data_piloto2','data_piloto3',
    'data_desenho_tecnico','data_aprovacao','observacoes_tecnicas','motivo_cancelamento','ficha_medida_url',
    'descricao_produto','proporcoes','custos_adicionais','tamanho_tipo','titulo_pagina','peso_kg','comprimento_cm',
    'largura_cm','altura_cm','ncm','preco_anterior'
  ];
  v_tenant uuid;
  v_rev integer;
  v_ruins text;
  v_sets text;
  v_bom_inicial boolean;
  v_proporcoes jsonb;
  v_marcadas jsonb := '{}'::jsonb;
BEGIN
  -- 1. login, modulo e portoes de pagina (todos ANTES de qualquer escrita; sem oraculo: id inexistente e sem permissao
  --    dao o mesmo 42501 de pagina porque o portao vem antes da busca).
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  PERFORM public._seg_exige_pagina('criacao_planejamento', 'criacao_desenvolvimento');

  -- JSON null (e nao so SQL NULL) tambem significa "bloco ausente".
  _header := NULLIF(_header, 'null'::jsonb);
  _bom := NULLIF(_bom, 'null'::jsonb);
  _etiquetas := NULLIF(_etiquetas, 'null'::jsonb);
  _cad := NULLIF(_cad, 'null'::jsonb);
  _mo := NULLIF(_mo, 'null'::jsonb);
  _grade_revenda := NULLIF(_grade_revenda, 'null'::jsonb);
  _revisao := NULLIF(_revisao, 'null'::jsonb);
  _flags := NULLIF(_flags, 'null'::jsonb);

  IF _header IS NOT NULL AND jsonb_typeof(_header) <> 'object' THEN
    RAISE EXCEPTION 'header_invalido: esperado um objeto' USING ERRCODE = 'P0001';
  END IF;
  IF _flags IS NOT NULL AND jsonb_typeof(_flags) <> 'object' THEN
    RAISE EXCEPTION 'flags_invalido: esperado um objeto' USING ERRCODE = 'P0001';
  END IF;

  -- Portoes por bloco = os dos wrappers que a tela chamava antes.
  IF _bom IS NOT NULL THEN
    IF jsonb_typeof(_bom) <> 'object'
       OR jsonb_typeof(_bom->'tecidos') IS DISTINCT FROM 'array'
       OR jsonb_typeof(_bom->'aviamentos') IS DISTINCT FROM 'array'
       OR jsonb_typeof(_bom->'grades') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'bom_invalido: esperado tecidos, aviamentos e grades (listas)' USING ERRCODE = 'P0001';
    END IF;
    v_bom_inicial := NOT (EXISTS (SELECT 1 FROM public.modelo_tecidos WHERE modelo_id = _modelo_id)
                          OR EXISTS (SELECT 1 FROM public.modelo_aviamentos WHERE modelo_id = _modelo_id));
    IF v_bom_inicial THEN
      PERFORM public._seg_exige_pagina('criacao_desenvolvimento', 'criacao_planejamento');
    ELSE
      PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
    END IF;
  END IF;
  IF _etiquetas IS NOT NULL THEN
    IF jsonb_typeof(_etiquetas) <> 'array' THEN
      RAISE EXCEPTION 'etiquetas_invalidas: esperado uma lista' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
  END IF;
  IF _cad IS NOT NULL THEN
    IF jsonb_typeof(_cad) <> 'object'
       OR jsonb_typeof(_cad->'tecidos') IS DISTINCT FROM 'array'
       OR jsonb_typeof(_cad->'grades') IS DISTINCT FROM 'array'
       OR jsonb_typeof(_cad->'aviamentos') IS DISTINCT FROM 'array'
       OR jsonb_typeof(_cad->'etiquetas') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'cad_invalido: esperado tecidos, grades, aviamentos e etiquetas (listas)' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public._seg_exige_pagina('criacao_desenvolvimento');
  END IF;
  IF _mo IS NOT NULL THEN
    IF jsonb_typeof(_mo) <> 'array' THEN
      RAISE EXCEPTION 'mo_invalida: esperado uma lista' USING ERRCODE = 'P0001';
    END IF;
    IF NOT (public.user_can_edit('criacao_planejamento') AND public._pode_ver_custos()) THEN
      RAISE EXCEPTION 'mao_obra_sem_permissao: editar criacao_planejamento e ver custos' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _grade_revenda IS NOT NULL THEN
    IF jsonb_typeof(_grade_revenda) <> 'array' THEN
      RAISE EXCEPTION 'grade_invalida: esperado uma lista' USING ERRCODE = 'P0001';
    END IF;
    IF NOT public.tenant_module_enabled('produto_acabado') THEN
      RAISE EXCEPTION 'Módulo Produto Acabado (Revenda) não habilitado para esta loja' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF _revisao IS NOT NULL AND jsonb_typeof(_revisao) <> 'object' THEN
    RAISE EXCEPTION 'revisao_invalida: esperado um objeto' USING ERRCODE = 'P0001';
  END IF;

  -- Cabecalho: so colunas da lista fechada.
  IF _header IS NOT NULL THEN
    SELECT string_agg(k, ',' ORDER BY k) INTO v_ruins
      FROM jsonb_object_keys(_header) AS k
     WHERE k <> ALL (c_header_ok);
    IF v_ruins IS NOT NULL THEN
      RAISE EXCEPTION 'header_campo_invalido: %', v_ruins USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- 2. o card existe e e da loja do chamador (ou super admin); travas na ORDEM UNICA (card -> CAD -> linha de modelos);
  --    trava otimista. A existencia e conferida ANTES das advisory (nao da para tomar trava de id alheio).
  SELECT m.tenant_id INTO v_tenant
    FROM public.modelos m
   WHERE m.id = _modelo_id AND (m.tenant_id = public.get_user_tenant_id() OR public.is_super_admin());
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'nao_encontrado: modelo' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('cad:modelo_id:' || _modelo_id::text));
  PERFORM pg_advisory_xact_lock(hashtext(c.id::text)) FROM public.cad c WHERE c.modelo_id = _modelo_id ORDER BY c.id;

  SELECT m.rev INTO v_rev FROM public.modelos m WHERE m.id = _modelo_id FOR UPDATE;
  IF _rev_base IS NOT NULL AND v_rev IS DISTINCT FROM _rev_base THEN
    RAISE EXCEPTION 'conflito_versao: card' USING ERRCODE = 'P0409';
  END IF;

  -- 3. cabecalho (so as chaves presentes; o merge/omissao por permissao e decidido pela tela, como antes).
  IF _header IS NOT NULL AND _header <> '{}'::jsonb THEN
    SELECT string_agg(format('%1$I = r.%1$I', k), ', ') INTO v_sets FROM jsonb_object_keys(_header) AS k;
    EXECUTE format(
      'UPDATE public.modelos m SET %s FROM jsonb_populate_record(NULL::public.modelos, $1) r WHERE m.id = $2', v_sets)
      USING _header, _modelo_id;
  END IF;

  -- 4. BOM (rev ja conferido acima: _rev_base => NULL no _core)
  IF _bom IS NOT NULL THEN
    PERFORM public._salvar_modelo_bom_core(_modelo_id, _bom->'tecidos', _bom->'aviamentos', _bom->'grades', NULL);
  END IF;

  -- 5. insumos/etiquetas (diff do estado completo)
  IF _etiquetas IS NOT NULL THEN
    PERFORM public._salvar_etiquetas_modelo_core(_modelo_id, _etiquetas);
  END IF;

  -- 6. CAD (proporcoes ausentes = mantem as do card, nunca zera)
  IF _cad IS NOT NULL THEN
    IF jsonb_typeof(_cad->'proporcoes') = 'object' THEN
      v_proporcoes := _cad->'proporcoes';
    ELSE
      SELECT COALESCE(m.proporcoes, '{}'::jsonb) INTO v_proporcoes FROM public.modelos m WHERE m.id = _modelo_id;
    END IF;
    PERFORM public._salvar_cad_completo_core(
      _modelo_id, _cad->'tecidos', _cad->'grades', _cad->'aviamentos', _cad->'etiquetas', v_proporcoes,
      _cad->>'observacoes_molde', NULLIF(_cad->>'data_previsao_corte', '')::date);
  END IF;

  -- 7. mao de obra por servico (estado completo)
  IF _mo IS NOT NULL THEN
    PERFORM public._salvar_modelo_servico_mo_core(_modelo_id, _mo);
  END IF;

  -- 8. grade da revenda
  IF _grade_revenda IS NOT NULL THEN
    PERFORM public._salvar_grade_revenda_core(_modelo_id, _grade_revenda, NULL);
  END IF;

  -- 9. #Erro nas etapas seguintes (so o que o BOM gravado mudou)
  IF _revisao IS NOT NULL THEN
    v_marcadas := public.marcar_revisao_por_mudanca(
      _modelo_id,
      COALESCE((_revisao->>'grade')::boolean, false),
      COALESCE((_revisao->>'consumo')::boolean, false),
      COALESCE((_revisao->>'aviamentos')::boolean, false));
  END IF;

  -- 10. rev atual (o processador adiado do custo pode somar 1 no COMMIT: a tela releia se precisar do rev final)
  SELECT m.rev INTO v_rev FROM public.modelos m WHERE m.id = _modelo_id;
  RETURN jsonb_build_object('modelo_id', _modelo_id, 'rev', v_rev, 'revisao_marcada', COALESCE(v_marcadas, '{}'::jsonb));
END
$fn$;

REVOKE EXECUTE ON FUNCTION public.salvar_card_planejamento(uuid, jsonb, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_card_planejamento(uuid, jsonb, integer, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------
-- Pos-condicoes (falhou = a migration inteira desfaz)
-- ---------------------------------------------------------------------------------------------------------------------
DO $post$
DECLARE
  v_rpc text := 'public.salvar_card_planejamento(uuid,jsonb,integer,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)';
  v_help text := 'public._salvar_etiquetas_modelo_core(uuid,jsonb)';
BEGIN
  IF has_function_privilege('anon', v_rpc, 'EXECUTE') OR has_function_privilege('anon', v_help, 'EXECUTE') THEN
    RAISE EXCEPTION 'pos-condicao: anon executa a RPC ou o helper';
  END IF;
  IF NOT has_function_privilege('authenticated', v_rpc, 'EXECUTE') OR NOT has_function_privilege('service_role', v_rpc, 'EXECUTE') THEN
    RAISE EXCEPTION 'pos-condicao: authenticated/service_role sem EXECUTE na RPC';
  END IF;
  IF has_function_privilege('authenticated', v_help, 'EXECUTE') THEN
    RAISE EXCEPTION 'pos-condicao: authenticated executa o helper de etiquetas';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_rpc::regprocedure) THEN
    RAISE EXCEPTION 'pos-condicao: a RPC nao e SECURITY DEFINER';
  END IF;
END
$post$;

COMMIT;
