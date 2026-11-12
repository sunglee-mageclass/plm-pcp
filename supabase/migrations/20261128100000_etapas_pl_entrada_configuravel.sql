-- Kanban PL - Onda 3 (telas), Tasks 1..3: entrada configuravel da 1a coluna do board PL.
-- ESTE ARQUIVO CRESCE: Task 1 = condicao `tem_peca_teste` no avaliador SQL (_avaliar_condicoes_etapas_pl_core);
-- Task 2 = a decisao de ENTRADA/SAIDA (helper _etapas_pl_entrada_avaliar, chamado pelo gatilho fn_etapas_pl_entrada)
-- passa a avaliar os REQUISITOS da 1a coluna configurada; Task 3 acrescenta o seed no MESMO arquivo.
--
-- tem_peca_teste = EXISTE linha modelo_servico_mo com categoria exige_peca_teste (aprovada OU nao). E a porta
-- de entrada PADRAO da 1a coluna do board PL. NAO confundir com peca_teste_aprovada (vacuamente true sem trilha).
-- Espelho TS: CONDICOES_PL em src/lib/etapas-pl-condicoes.ts (anti-drift em tests/integration/kanban-pl-condicoes.test.ts).
--
-- Task 2 - regra de _etapas_pl_entrada_avaliar(_modelo) (a funcao de GATILHO fn_etapas_pl_entrada nao muda: ela so
-- despacha por tabela; a decisao mora no helper):
--   v_primeira      = 1a etapa do fluxo PL (_kanban_fluxo do board cru; board vazio/nao-array/1a em branco => NADA a fazer).
--   v_reqs_primeira = etapas_pl_requisitos -> v_primeira (lista de keys de condicao).
--   v_cumpre        = TODOS os reqs da 1a coluna cumpridos segundo avaliar_condicoes_etapas_pl_core (key desconhecida =
--                     nao cumprido; lista vazia = FALSE: sem requisito ninguem entra sozinho).
--   v_pos           = cad.enviado_corte (pos-Explosao).
--   ENTRADA: status_etapa_pl IS NULL E modulo etapas_pl ligado E v_cumpre  -> status = v_primeira (GUC 'auto' + enfileira).
--   SAIDA  : status_etapa_pl IS NOT NULL E a 1a coluna TEM requisito E NOT v_cumpre E NOT v_pos -> NULL.
--            1a coluna SEM requisito NAO forca saida (board todo-manual nao se auto-esvazia). Pos-Explosao NUNCA sai.
-- Com o seed da Task 3 (1a coluna = tem_peca_teste) o comportamento e identico ao da Onda 2 (peca teste fixo).
-- Nota: o gatilho so escuta modelo_servico_mo e categorias_terceirizado; outras fontes de requisito (ex. cad.enviado_corte)
-- so reavaliam a entrada quando um desses eventos ocorre (ou por chamada direta ao helper). Sem gatilho novo aqui.
--
-- ADITIVA, so catalogo (CREATE OR REPLACE; nao prende tabela). BEGIN...COMMIT. Idempotente.
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK. Banco ANTES do site.
-- Volta: supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down.sql (devolve os corpos de ANTES:
--   _avaliar_condicoes_etapas_pl_core md5 3715a292f9cd18a4b8eaa06601e114e9 e _etapas_pl_entrada_avaliar md5
--   066d482bb0d2f0731f78aec2f5191d47).

BEGIN;

-- Guarda md5 ANTES (os corpos que esta migration substitui). Idempotente: se ja esta no "depois" (re-execucao), passa.
DO $pre$
DECLARE
  v_ava text := md5(pg_get_functiondef('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure));
  v_ent text := md5(pg_get_functiondef('public._etapas_pl_entrada_avaliar(uuid)'::regprocedure));
BEGIN
  IF v_ava <> '3715a292f9cd18a4b8eaa06601e114e9' AND position('tem_peca_teste' in pg_get_functiondef('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'etapas_pl_entrada_configuravel: _avaliar_condicoes_etapas_pl_core divergente (md5 %), esperado 3715a292f9cd18a4b8eaa06601e114e9', v_ava;
  END IF;
  IF v_ent <> '066d482bb0d2f0731f78aec2f5191d47' AND position('v_reqs_primeira' in pg_get_functiondef('public._etapas_pl_entrada_avaliar(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'etapas_pl_entrada_configuravel: _etapas_pl_entrada_avaliar divergente (md5 %), esperado 066d482bb0d2f0731f78aec2f5191d47', v_ent;
  END IF;
END
$pre$;

-- 1) _avaliar_condicoes_etapas_pl_core: + key tem_peca_teste (as outras 7 byte a byte)
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
    -- tem_peca_teste: EXISTE trilha de peca teste (linha de M.O. com categoria exige_peca_teste), aprovada OU nao.
    -- Porta de entrada da 1a coluna do kanban PL. DIFERENTE de peca_teste_aprovada (vacuamente true sem trilha).
    'tem_peca_teste', exists (
      select 1 from modelo_servico_mo pm
       join categorias_terceirizado pc
         on pc.id = pm.categoria_terceirizado_id and pc.tenant_id = m.tenant_id and pc.exige_peca_teste
       where pm.modelo_id = m.id),
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
$function$;

REVOKE EXECUTE ON FUNCTION public._avaliar_condicoes_etapas_pl_core(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- 2) _etapas_pl_entrada_avaliar: ENTRADA/SAIDA do card pelos REQUISITOS da 1a coluna (nao mais "peca teste" fixo).
CREATE OR REPLACE FUNCTION public._etapas_pl_entrada_avaliar(_modelo uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant        uuid;
  v_status        text;
  v_cfg           jsonb;
  v_board         jsonb;
  v_fluxo         text[];
  v_primeira      text;
  v_reqs_primeira text[];
  v_cond          jsonb;
  v_cumpre        boolean;
  v_pos           boolean;
  v_novo          text;
  v_n             integer;
  v_sis_ant       text := coalesce(current_setting('app.etapas_pl_sistema', true), '');
  v_lote_ant      text := coalesce(current_setting('app.etapas_pl_lote', true), '');
BEGIN
  IF _modelo IS NULL THEN RETURN; END IF;

  -- modelo apagado (cascata de exclusao do card) ou inexistente: nada a fazer.
  SELECT m.tenant_id, m.status_etapa_pl INTO v_tenant, v_status
    FROM public.modelos m
   WHERE m.id = _modelo;
  IF NOT FOUND THEN RETURN; END IF;

  v_cfg   := coalesce(public._etapas_pl_cfg(v_tenant), '{}'::jsonb);
  v_board := coalesce(v_cfg -> 'etapas_pl_kanban', '[]'::jsonb);
  -- board PL cru vazio/nao-array: INERCIA (nem entra, nem sai). ⚠️ _kanban_fluxo NUNCA devolve vazio para '[]'/NULL
  -- (a pura cai no board PADRAO do Dev); por isso a checagem e feita no board cru.
  IF jsonb_typeof(v_board) <> 'array' OR jsonb_array_length(v_board) = 0 THEN RETURN; END IF;
  v_fluxo := public._kanban_fluxo(jsonb_build_object('status_kanban', v_board), false);
  IF v_fluxo IS NULL OR cardinality(v_fluxo) = 0 THEN RETURN; END IF;
  -- 1a etapa de nome em branco (['']/['  ']) viraria status_etapa_pl = '' (dentro do PL mas sem coluna): inercia.
  v_primeira := NULLIF(btrim(v_fluxo[1]), '');
  IF v_primeira IS NULL THEN RETURN; END IF;

  -- requisitos da 1a coluna (lista de keys de condicao).
  v_reqs_primeira := public._kanban_lista(coalesce(v_cfg -> 'etapas_pl_requisitos', '{}'::jsonb) -> v_primeira);

  IF cardinality(v_reqs_primeira) = 0 THEN
    -- 1a coluna SEM requisito: ninguem entra sozinho (entrada so manual) e ninguem e tirado (board todo-manual
    -- nao se auto-esvazia).
    RETURN;
  END IF;

  -- cumpre TODOS os requisitos da 1a coluna (key ausente no avaliador = nao cumprido).
  v_cond := coalesce(public._avaliar_condicoes_etapas_pl_core(v_tenant, ARRAY[_modelo]) -> _modelo::text, '{}'::jsonb);
  v_cumpre := coalesce(
    (SELECT bool_and(coalesce((v_cond ->> k)::boolean, false)) FROM unnest(v_reqs_primeira) AS k),
    false);

  IF v_cumpre THEN
    -- ENTRADA
    IF v_status IS NOT NULL THEN RETURN; END IF;
    IF NOT public._tenant_modulo_ligado(v_tenant, 'etapas_pl') THEN RETURN; END IF;
    v_novo := v_primeira;
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
$function$;

REVOKE EXECUTE ON FUNCTION public._etapas_pl_entrada_avaliar(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;

select pg_notify('pgrst', 'reload schema');
