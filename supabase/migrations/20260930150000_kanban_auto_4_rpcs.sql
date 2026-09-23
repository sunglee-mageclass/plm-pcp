-- Kanban automático — F1 · migration 4/4: RPCs PÚBLICAS
-- ============================================================================
-- Plano: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md (Tasks 15–16, §3).
-- Inverso pareado: supabase/rollback/20260930150000_kanban_auto_4_rpcs_down.sql.
--
--   kanban_mover(_modelo_id, _para)          → arraste/"Mover para…" (chave LIGADA; F2/F3)
--   kanban_previa_recalculo(_cfg)            → admin; "N cards vão mudar" (+ REFs reveladas) com a config PROPOSTA; NÃO grava
--   kanban_definir_automatico(_ligar)        → admin; o BOTÃO da chave — única porta de kanban_automatico (decisão 16)
--   kanban_previa_restauracao(_lote_id)      → admin; quem volta + movimentos manuais depois; NÃO grava
--   kanban_restaurar(_lote_id)               → admin; exige a chave DESLIGADA
-- Todas: SECURITY DEFINER + search_path; tenant = get_user_tenant_id(); módulo `criacao`;
-- permissão negada = 42501; regra de negócio = P0001; não encontrado = P0002 (mensagens PT-BR).
-- ACL: REVOKE de PUBLIC/anon + GRANT authenticated (invariante #9).

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- A) kanban_mover — aplica a tabela ÚNICA de arraste (`_kanban_destino_drop_puro`) no servidor.
--    fixar/soltar gravam o status (GUC 'manual' → histórico origem 'manual', o guard deixa passar);
--    fixar/soltar/nada apagam o #Erro de kanban (o usuário revisou — paridade com o drop de hoje,
--    que chama marcar_etapa_verificada; pode ser #Erro legado de quando a chave estava desligada).
--    Sair de 'reprovado' NÃO mexe em motivo_cancelamento (decisão 15 do dono, 23/set: o motivo
--    fica guardado e só aparece quando o card está em Reprovado). Bloqueios não gravam nada.
--    Retorno: {acao, status, faltando[], rev}.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kanban_mover(_modelo_id uuid, _para text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_sis_ant  text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.kanban_lote', true), '');
  v_status   text;
  v_d        record;
  v_drop     jsonb;
  v_acao     text;
  v_novo     text;
  v_rev      integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_can_edit('criacao_desenvolvimento') THEN
    RAISE EXCEPTION 'Sem permissão para mover cards do Desenvolvimento.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;

  SELECT m.status_desenvolvimento INTO v_status
    FROM public.modelos m
   WHERE m.id = _modelo_id AND m.tenant_id = v_tenant
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modelo não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public._kanban_ligado(v_tenant) THEN
    RAISE EXCEPTION 'O Kanban automático está desligado nesta loja.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_d FROM public._kanban_derivar_lote(v_tenant, ARRAY[_modelo_id]) LIMIT 1;
  v_drop := public._kanban_destino_drop_puro(v_d.fluxo, v_d.reqs, v_d.exc, v_d.cond, v_d.status_atual, v_d.elegivel, _para);
  v_acao := v_drop ->> 'acao';
  v_novo := v_drop ->> 'status';

  IF v_acao IN ('fixar', 'soltar', 'nada') THEN
    PERFORM set_config('app.kanban_sistema', 'manual', true);
    PERFORM set_config('app.kanban_lote', '', true);
    UPDATE public.modelos m
       SET status_desenvolvimento = CASE WHEN v_acao IN ('fixar', 'soltar') THEN v_novo ELSE m.status_desenvolvimento END,
           revisao_pendente = coalesce(m.revisao_pendente, '{}'::jsonb) - 'kanban'
     WHERE m.id = _modelo_id
       AND (   (v_acao IN ('fixar', 'soltar') AND m.status_desenvolvimento IS DISTINCT FROM v_novo)
            OR coalesce(m.revisao_pendente, '{}'::jsonb) ? 'kanban');
    PERFORM set_config('app.kanban_sistema', v_sis_ant, true);
    PERFORM set_config('app.kanban_lote', v_lote_ant, true);
  END IF;

  SELECT m.status_desenvolvimento, m.rev INTO v_status, v_rev FROM public.modelos m WHERE m.id = _modelo_id;
  RETURN jsonb_build_object(
    'acao', v_acao,
    'status', v_status,
    'faltando', coalesce(v_drop -> 'faltando', '[]'::jsonb),
    'rev', v_rev);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kanban_mover(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kanban_mover(uuid, text) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- B) kanban_previa_recalculo — admin; NÃO grava. `_cfg` = config PROPOSTA (parcial ok: só as chaves
--    status_kanban, kanban_requisitos, kanban_requisitos_excecoes, revenda_kanban_colunas,
--    revenda_kanban_requisitos, kanban_automatico são lidas; o resto vem da config gravada).
--    Calcula COMO SE a chave estivesse ligada. População = cards do quadro do Desenvolvimento
--    (ordem_criacao_enviada, não lançados). Conta pela COLUNA EFETIVA (a que o quadro mostra:
--    status se está no board, senão a 1ª coluna) antes × depois; lista os FIXADOS (não andam sozinhos).
--    R4: lista as REFs que o LIGAR revela — derivável, `ref` vazia, `ref_auto` pronta, MUDA de coluna
--    (fn_modelo_ref_auto) ou está FIXADO (_kanban_aplicar), com a posição derivada na etapa de revelar
--    ou depois: régua de _ref_exibir_gate (etapa configurada; ausente ⇒ 'aprovado'; órfã ⇒ fallback
--    'aprovado'; fora do board ⇒ só igualdade) sobre o board PROPOSTO. REF revelada não volta → aviso.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kanban_previa_recalculo(_cfg jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_atual     jsonb;
  v_prop      jsonb;
  v_board_at  text[];
  v_board_nv  text[];
  v_rb        text[];  -- board PROPOSTO sem dedup (≡ _kanban_status_rows: régua do _ref_exibir_gate)
  v_ref_cfg   text;
  v_ref_pos   integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode ver a prévia do Kanban automático.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;

  v_atual := coalesce(public._kanban_cfg(v_tenant), '{}'::jsonb);
  v_prop  := v_atual || coalesce((
    SELECT jsonb_object_agg(e.k, e.v)
      FROM jsonb_each(CASE WHEN jsonb_typeof(_cfg) = 'object' THEN _cfg ELSE '{}'::jsonb END) AS e(k, v)
     WHERE e.k IN ('kanban_automatico', 'status_kanban', 'kanban_requisitos', 'kanban_requisitos_excecoes',
                   'revenda_kanban_colunas', 'revenda_kanban_requisitos')), '{}'::jsonb);
  v_board_at := public._kanban_fluxo(v_atual, false);
  v_board_nv := public._kanban_fluxo(v_prop, false);
  -- Régua da REF (≡ _ref_exibir_gate, mas sobre o board PROPOSTO; ref_exibir_status vem da config gravada)
  v_rb := ARRAY(SELECT r.key FROM public._kanban_status_rows_raw(v_prop -> 'status_kanban') r ORDER BY r.ord);
  v_ref_cfg := v_atual ->> 'ref_exibir_status';
  IF v_ref_cfg IS NULL OR btrim(v_ref_cfg) = '' THEN v_ref_cfg := 'aprovado'; END IF;
  v_ref_pos := array_position(v_rb, v_ref_cfg);
  IF v_ref_pos IS NULL AND v_ref_cfg <> 'aprovado' THEN
    v_ref_cfg := 'aprovado';
    v_ref_pos := array_position(v_rb, 'aprovado');
  END IF;

  RETURN (
    WITH d AS (
      SELECT x.*, m.nome, coalesce(nullif(m.ref, ''), m.ref_auto) AS ref_exib,
             coalesce(m.ref, '') AS ref_atual, m.ref_auto
        FROM public._kanban_derivar_lote(v_tenant, NULL, v_prop) x
        JOIN public.modelos m ON m.id = x.modelo_id
       WHERE x.elegivel
    ), c AS (
      SELECT d.*,
             CASE WHEN d.status_atual = ANY (v_board_at) THEN d.status_atual ELSE v_board_at[1] END AS de,
             CASE WHEN d.derivavel THEN d.resultado
                  WHEN d.status_atual = ANY (v_board_nv) THEN d.status_atual
                  ELSE v_board_nv[1] END AS para,
             (d.derivavel AND d.ref_atual = '' AND coalesce(d.ref_auto, '') <> ''
              AND (d.fixado OR d.resultado IS DISTINCT FROM d.status_atual)
              AND CASE WHEN v_ref_pos IS NULL OR array_position(v_rb, public._kanban_norm(d.alvo)) IS NULL
                         THEN public._kanban_norm(d.alvo) = v_ref_cfg
                       ELSE array_position(v_rb, public._kanban_norm(d.alvo)) >= v_ref_pos
                  END) AS revela_ref
        FROM d
    )
    SELECT jsonb_build_object(
      'chave_proposta', coalesce((v_prop ->> 'kanban_automatico')::boolean, false),
      'total',   (SELECT count(*) FROM c),
      'mudam',   (SELECT count(*) FROM c WHERE c.de IS DISTINCT FROM c.para),
      'fixados', (SELECT count(*) FROM c WHERE c.fixado),
      'cards', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'modelo_id', c.modelo_id, 'nome', c.nome, 'ref', c.ref_exib, 'origem', c.origem,
                 'de', c.de, 'para', c.para, 'fixado', c.fixado,
                 'recua', coalesce(array_position(v_board_nv, c.para) < array_position(v_board_nv, c.de), false),
                 'primeira_falha', c.primeira_falha, 'faltando', to_jsonb(c.faltando))
               ORDER BY c.nome, c.modelo_id)
          FROM c WHERE c.de IS DISTINCT FROM c.para), '[]'::jsonb),
      'cards_fixados', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'modelo_id', c.modelo_id, 'nome', c.nome, 'ref', c.ref_exib, 'origem', c.origem,
                 'coluna', c.resultado, 'posicao_derivada', c.alvo)
               ORDER BY c.nome, c.modelo_id)
          FROM c WHERE c.fixado), '[]'::jsonb),
      'revelam_ref', (SELECT count(*) FROM c WHERE c.revela_ref),
      'refs_reveladas', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                 'modelo_id', c.modelo_id, 'nome', c.nome, 'ref_auto', c.ref_auto, 'posicao_derivada', c.alvo)
               ORDER BY c.nome, c.modelo_id)
          FROM c WHERE c.revela_ref), '[]'::jsonb),
      'avisos', CASE WHEN EXISTS (SELECT 1 FROM c WHERE c.revela_ref)
                     THEN jsonb_build_array('A REF revelada não volta ao desligar nem ao restaurar as colunas.')
                     ELSE '[]'::jsonb END)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kanban_previa_recalculo(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kanban_previa_recalculo(jsonb) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- B′) kanban_definir_automatico — o BOTÃO da chave (decisão 16 do dono, 23/set; D19). É a ÚNICA
--     porta de tenant_config.kanban_automatico: seta app.kanban_chave='rpc' só em volta do UPDATE
--     (a trava trg_kanban_chave_protegida ignora qualquer outra escrita) e restaura o valor anterior.
--     Ao LIGAR, o gatilho AFTER trg_kanban_config grava o lote 'ligar' e recalcula a loja na MESMA
--     txn (erro lá PROPAGA — D6). Desligar não grava lote. Mesmo valor → mudou=false, nada grava.
--     Retorno: {ligado, mudou, lote_id, snapshot (linhas do lote), cards_movidos (mudaram de coluna)}.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kanban_definir_automatico(_ligar boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant    uuid;
  v_chave_ant text := coalesce(current_setting('app.kanban_chave', true), '');
  v_antes     boolean;
  v_depois    boolean;
  v_inicio    timestamptz := clock_timestamp();
  v_lote      uuid;
  v_snap      integer := 0;
  v_mov       integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode ligar ou desligar o Kanban automático.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF _ligar IS NULL THEN
    RAISE EXCEPTION 'Informe se o Kanban automático deve ser ligado ou desligado.' USING ERRCODE = 'P0001';
  END IF;

  SELECT tc.kanban_automatico INTO v_antes
    FROM public.tenant_config tc
   WHERE tc.tenant_id = v_tenant
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Configuração da loja não encontrada.' USING ERRCODE = 'P0002';
  END IF;

  IF v_antes IS DISTINCT FROM _ligar THEN
    PERFORM set_config('app.kanban_chave', 'rpc', true);
    UPDATE public.tenant_config SET kanban_automatico = _ligar WHERE tenant_id = v_tenant;
    PERFORM set_config('app.kanban_chave', v_chave_ant, true);
  END IF;

  SELECT tc.kanban_automatico INTO v_depois FROM public.tenant_config tc WHERE tc.tenant_id = v_tenant;

  IF _ligar AND v_antes IS DISTINCT FROM _ligar THEN
    SELECT s.lote_id, count(*)::integer INTO v_lote, v_snap
      FROM public.kanban_snapshot s
     WHERE s.tenant_id = v_tenant AND s.motivo = 'ligar' AND s.criado_at >= v_inicio
     GROUP BY s.lote_id
     ORDER BY max(s.criado_at) DESC
     LIMIT 1;
    IF v_lote IS NOT NULL THEN
      SELECT count(DISTINCT h.modelo_id)::integer INTO v_mov
        FROM public.modelo_kanban_historico h
       WHERE h.tenant_id = v_tenant AND h.lote_id = v_lote AND h.origem = 'config';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ligado', v_depois,
    'mudou', v_antes IS DISTINCT FROM v_depois,
    'lote_id', v_lote,
    'snapshot', coalesce(v_snap, 0),
    'cards_movidos', coalesce(v_mov, 0));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kanban_definir_automatico(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kanban_definir_automatico(boolean) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- C) kanban_previa_restauracao — admin; NÃO grava. `_lote_id` NULL = o lote 'ligar' mais recente
--    ainda não restaurado da loja. Lista quem VOLTA (status atual ≠ status_anterior) e marca quem
--    teve movimento MANUAL depois do lote (a restauração desfaz esse movimento). Avisa que REF
--    revelada e #Erro NÃO voltam. "Depois" = modelo_kanban_historico.created_at (relógio, gravado
--    por fn_kanban_historico) > kanban_snapshot.criado_at (relógio, gravado por fn_kanban_config).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kanban_previa_restauracao(_lote_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant  uuid;
  v_lote    uuid;
  v_motivo  text;
  v_criado  timestamptz;
  v_restaur timestamptz;
  v_ligada  boolean;
  v_out     jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode restaurar as colunas do Kanban.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;

  v_lote := coalesce(_lote_id, (
    SELECT s.lote_id FROM public.kanban_snapshot s
     WHERE s.tenant_id = v_tenant AND s.motivo = 'ligar' AND s.restaurado_at IS NULL
     ORDER BY s.criado_at DESC LIMIT 1));
  v_ligada := public._kanban_ligado(v_tenant);
  IF v_lote IS NULL THEN
    RETURN jsonb_build_object('lote_id', NULL, 'chave_ligada', v_ligada, 'total', 0, 'voltam', 0,
      'movidos_depois', 0, 'cards', '[]'::jsonb,
      'avisos', jsonb_build_array('Não há colunas guardadas para restaurar.'));
  END IF;

  SELECT min(s.motivo), min(s.criado_at), max(s.restaurado_at) INTO v_motivo, v_criado, v_restaur
    FROM public.kanban_snapshot s
   WHERE s.lote_id = v_lote AND s.tenant_id = v_tenant;
  IF v_criado IS NULL THEN
    RAISE EXCEPTION 'Lote de colunas não encontrado.' USING ERRCODE = 'P0002';
  END IF;

  WITH s AS (
    SELECT s.modelo_id, s.status_anterior, m.nome, coalesce(nullif(m.ref, ''), m.ref_auto) AS ref_exib,
           m.status_desenvolvimento AS status_atual,
           EXISTS (SELECT 1 FROM public.modelo_kanban_historico h
                    WHERE h.modelo_id = s.modelo_id AND h.origem = 'manual' AND h.created_at > v_criado) AS manual_depois
      FROM public.kanban_snapshot s
      JOIN public.modelos m ON m.id = s.modelo_id AND m.tenant_id = v_tenant
     WHERE s.lote_id = v_lote
  )
  SELECT jsonb_build_object(
    'lote_id', v_lote, 'motivo', v_motivo, 'criado_at', v_criado, 'restaurado_at', v_restaur,
    'chave_ligada', v_ligada,
    'total', (SELECT count(*) FROM s),
    'voltam', (SELECT count(*) FROM s WHERE s.status_atual IS DISTINCT FROM s.status_anterior),
    'movidos_depois', (SELECT count(*) FROM s WHERE s.manual_depois AND s.status_atual IS DISTINCT FROM s.status_anterior),
    'cards', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'modelo_id', s.modelo_id, 'nome', s.nome, 'ref', s.ref_exib,
               'de', s.status_atual, 'para', s.status_anterior, 'movido_manual_depois', s.manual_depois)
             ORDER BY s.nome, s.modelo_id)
        FROM s WHERE s.status_atual IS DISTINCT FROM s.status_anterior), '[]'::jsonb),
    'avisos', to_jsonb(array_remove(ARRAY[
      'A REF revelada e o #Erro não voltam.',
      CASE WHEN v_ligada THEN 'Desligue o Kanban automático antes de restaurar (senão o próximo salvamento refaz as colunas).' END,
      CASE WHEN v_restaur IS NOT NULL THEN 'Este lote já foi restaurado.' END
    ], NULL)))
  INTO v_out;
  RETURN v_out;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kanban_previa_restauracao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kanban_previa_restauracao(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- D) kanban_restaurar — admin; exige a chave DESLIGADA (senão o próximo evento desfaria a
--    restauração). Volta status_anterior onde difere (histórico origem 'restauracao'), apaga as
--    linhas auto/config do histórico dos modelos do lote desde criado_at (created_at do histórico,
--    relógio), marca restaurado_at. A linha 'restauracao' do histórico só entra quando a última
--    linha restante é de OUTRA coluna (D14 — fn_kanban_historico).
--    REF revelada e #Erro NÃO voltam (avisado na prévia).
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kanban_restaurar(_lote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant   uuid;
  v_sis_ant  text := coalesce(current_setting('app.kanban_sistema', true), '');
  v_lote_ant text := coalesce(current_setting('app.kanban_lote', true), '');
  v_criado   timestamptz;
  v_restaur  timestamptz;
  v_hist     integer := 0;
  v_n        integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo Criação não habilitado para esta loja.' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode restaurar as colunas do Kanban.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF public._kanban_ligado(v_tenant) THEN
    RAISE EXCEPTION 'Desligue o Kanban automático antes de restaurar as colunas.' USING ERRCODE = 'P0001';
  END IF;

  SELECT min(s.criado_at), max(s.restaurado_at) INTO v_criado, v_restaur
    FROM public.kanban_snapshot s
   WHERE s.lote_id = _lote_id AND s.tenant_id = v_tenant;
  IF v_criado IS NULL THEN
    RAISE EXCEPTION 'Lote de colunas não encontrado.' USING ERRCODE = 'P0002';
  END IF;
  IF v_restaur IS NOT NULL THEN
    RAISE EXCEPTION 'Este lote já foi restaurado.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.kanban_sistema', 'restauracao', true);
  PERFORM set_config('app.kanban_lote', _lote_id::text, true);

  DELETE FROM public.modelo_kanban_historico h
   USING public.kanban_snapshot s
   WHERE s.lote_id = _lote_id
     AND h.modelo_id = s.modelo_id
     AND h.tenant_id = v_tenant
     AND h.origem IN ('auto', 'config')
     AND h.created_at >= v_criado;
  GET DIAGNOSTICS v_hist = ROW_COUNT;

  UPDATE public.modelos m
     SET status_desenvolvimento = s.status_anterior
    FROM public.kanban_snapshot s
   WHERE s.lote_id = _lote_id
     AND m.id = s.modelo_id
     AND m.tenant_id = v_tenant
     AND m.status_desenvolvimento IS DISTINCT FROM s.status_anterior;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.kanban_snapshot SET restaurado_at = now()
   WHERE lote_id = _lote_id AND tenant_id = v_tenant;

  PERFORM set_config('app.kanban_sistema', v_sis_ant, true);
  PERFORM set_config('app.kanban_lote', v_lote_ant, true);
  RETURN jsonb_build_object('lote_id', _lote_id, 'restaurados', v_n, 'historico_apagado', v_hist);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.kanban_restaurar(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.kanban_restaurar(uuid) TO authenticated;
COMMIT;

select pg_notify('pgrst', 'reload schema');
