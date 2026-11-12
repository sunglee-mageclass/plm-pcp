-- Volta da frente Onda 3 / entrada configuravel (20261128100000): devolve os 2 corpos de ANTES (estado da Onda 2):
--   _avaliar_condicoes_etapas_pl_core md5 3715a292f9cd18a4b8eaa06601e114e9 (sem tem_peca_teste)
--   _etapas_pl_entrada_avaliar        md5 066d482bb0d2f0731f78aec2f5191d47 (entrada por peca teste fixo)
-- fn_etapas_pl_entrada (gatilho) nao foi alterada pela ida. So catalogo. Idempotente. BEGIN...COMMIT.
-- Se a Task 3 (seed) gravou etapas_pl_requisitos, o seed e dado e NAO e revertido aqui.
BEGIN;

CREATE OR REPLACE FUNCTION public._avaliar_condicoes_etapas_pl_core(_tenant uuid, _ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object(
    -- peca_teste_aprovada: MESMO predicado do Dev (_avaliar_condicoes_kanban_core). Vacuoso true sem linha.
    'peca_teste_aprovada', not exists (
      select 1 from modelo_servico_mo pm
      join categorias_terceirizado pc on pc.id = pm.categoria_terceirizado_id and pc.tenant_id = m.tenant_id and pc.exige_peca_teste
      where pm.modelo_id = m.id
        and (pm.aprovado is not true
             or not public._peca_teste_aprovada(pm.id, pm.categoria_terceirizado_id, pm.empresa_id))),
    -- enviado_a_servicos: saiu da Explosao (cad.enviado_corte).
    'enviado_a_servicos', exists (select 1 from cad c where c.modelo_id = m.id and coalesce(c.enviado_corte, false)),
    -- materiais_separados: >=1 bloco ativo E TODOS com data_enviado (0 blocos = false).
    'materiais_separados', (
      exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true))
      and not exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true) and pt.data_enviado is null)
    ),
    -- grade_cortada_retornou: TODOS os blocos ativos tem alguma celula grade_detalhe com cortada>0 (0 blocos = false).
    'grade_cortada_retornou', (
      exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true))
      and not exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true)
          and not exists (
            select 1 from jsonb_path_query(coalesce(pt.grade_detalhe, '{}'::jsonb), '$.*.*') cell
            where coalesce((cell->>'cortada')::numeric, 0) > 0))
    ),
    -- oficina_entregue: TODOS os blocos ativos entregaram (data_entregue + quantidade_recebida>0) (0 blocos = false).
    'oficina_entregue', (
      exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true))
      and not exists (
        select 1 from producao_terceirizados pt join cad c on c.id = pt.cad_id
        where c.modelo_id = m.id and coalesce(pt.ativo, true)
          and not (pt.data_entregue is not null and coalesce(pt.quantidade_recebida, 0) > 0))
    ),
    -- cq_liberado: _cq_liberado(c.id) do CAD do modelo (false sem CAD).
    'cq_liberado', coalesce((select bool_or(public._cq_liberado(c.id)) from cad c where c.modelo_id = m.id), false),
    -- lancado: fonte unica = modelos.lancado.
    'lancado', coalesce(m.lancado, false)
  )), '{}'::jsonb)
  from modelos m
  where m.tenant_id = _tenant and m.id = any(_ids);
$function$

;
REVOKE EXECUTE ON FUNCTION public._avaliar_condicoes_etapas_pl_core(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._etapas_pl_entrada_avaliar(_modelo uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_status   text;
  v_tem_pt   boolean;
  v_pos      boolean;
  v_board    jsonb;
  v_fluxo    text[];
  v_novo     text;
  v_n        integer;
  v_sis_ant  text := coalesce(current_setting('app.etapas_pl_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.etapas_pl_lote', true), '');
BEGIN
  IF _modelo IS NULL THEN RETURN; END IF;

  -- modelo apagado (cascata de exclusao do card) ou inexistente: nada a fazer.
  SELECT m.tenant_id, m.status_etapa_pl INTO v_tenant, v_status
    FROM public.modelos m
   WHERE m.id = _modelo;
  IF NOT FOUND THEN RETURN; END IF;

  v_tem_pt := EXISTS (
    SELECT 1
      FROM public.modelo_servico_mo s
      JOIN public.categorias_terceirizado ct
        ON ct.id = s.categoria_terceirizado_id AND ct.exige_peca_teste
     WHERE s.modelo_id = _modelo);

  IF v_tem_pt THEN
    -- ENTRADA
    IF v_status IS NOT NULL THEN RETURN; END IF;
    IF NOT public._tenant_modulo_ligado(v_tenant, 'etapas_pl') THEN RETURN; END IF;
    v_board := coalesce(public._etapas_pl_cfg(v_tenant) -> 'etapas_pl_kanban', '[]'::jsonb);
    -- board PL nao configurado: NAO entra. ⚠️ _kanban_fluxo NUNCA devolve vazio para '[]'/NULL (a pura cai no board
    -- PADRAO do Dev, 14 colunas); por isso o "fluxo vazio" do ruling e conferido AQUI, no board configurado.
    IF jsonb_typeof(v_board) <> 'array' OR jsonb_array_length(v_board) = 0 THEN RETURN; END IF;
    v_fluxo := public._kanban_fluxo(jsonb_build_object('status_kanban', v_board), false);
    IF v_fluxo IS NULL OR cardinality(v_fluxo) = 0 THEN RETURN; END IF;
    -- 1a etapa de nome em branco (['']/['  ']) viraria status_etapa_pl = '' (dentro do PL mas sem coluna): NAO entra.
    v_novo := NULLIF(btrim(v_fluxo[1]), '');
    IF v_novo IS NULL THEN RETURN; END IF;
  ELSE
    -- SAIDA
    IF v_status IS NULL THEN RETURN; END IF;
    v_pos := EXISTS (
      SELECT 1 FROM public.cad c
       WHERE c.modelo_id = _modelo AND coalesce(c.enviado_corte, false));
    IF v_pos THEN RETURN; END IF;  -- pos-Explosao NUNCA sai
    v_novo := NULL;
  END IF;

  -- escrita do SISTEMA: GUC em volta (origem 'auto' no historico) e RESTAURA depois.
  PERFORM set_config('app.etapas_pl_sistema', 'auto', true);
  PERFORM set_config('app.etapas_pl_lote', '', true);
  UPDATE public.modelos m
     SET status_etapa_pl = v_novo
   WHERE m.id = _modelo
     AND m.status_etapa_pl IS NOT DISTINCT FROM v_status;  -- otimista: se mudou no meio, nao sobrescreve
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM set_config('app.etapas_pl_sistema', v_sis_ant, true);
  PERFORM set_config('app.etapas_pl_lote', v_lote_ant, true);

  -- ENTRADA: com a GUC ligada as enfileiradoras sairam cedo; enfileira AGORA (GUC ja restaurada) para o processador
  -- re-derivar a coluna certa no COMMIT (no-op com a chave desligada).
  IF v_n > 0 AND v_novo IS NOT NULL THEN
    PERFORM public._etapas_pl_enfileirar(ARRAY[_modelo]);
  END IF;
END;
$function$

;
REVOKE EXECUTE ON FUNCTION public._etapas_pl_entrada_avaliar(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
select pg_notify('pgrst', 'reload schema');
