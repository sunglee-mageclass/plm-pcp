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
--
-- Task 3 (A) - SEED: _kanban_pl_seed_etapas, ao semear etapas_pl_kanban, grava tambem etapas_pl_requisitos da 1a coluna
--   com ["tem_peca_teste"] SO quando etapas_pl_requisitos estava vazio ('{}'/NULL). Nunca sobrescreve requisitos ja
--   configurados; o seed segue saindo cedo se etapas_pl_kanban ja esta preenchido (reaplicar nao muda nada).
-- Task 3 (B) - GATILHO EM cad: fn_etapas_pl_entrada escuta so modelo_servico_mo/categorias_terceirizado; se a 1a coluna
--   usar enviado_a_servicos (vem de cad.enviado_corte), o produto que vai a Explosao nao entraria no board ate o proximo
--   evento de M.O. Gatilho novo trg_etapas_pl_entrada_cad (AFTER INSERT OR UPDATE OF enviado_corte, modelo_id ON cad,
--   POR LINHA) chama _etapas_pl_entrada_avaliar via fn_etapas_pl_entrada_cad (funcao propria: a fn_etapas_pl_entrada
--   despacha por TG_TABLE_NAME e nao conhece `cad`; nao mexer nela). Sem recursao: a decisao so escreve modelos.status_etapa_pl.
--   CREATE TRIGGER GUARDADO, SEM DROP (cad e tabela de negocio; DROP TRIGGER prende auth/storage ate o COMMIT): o DROP vive
--   so em supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down_drop.sql (horario calmo).
--
-- ADITIVA (CREATE OR REPLACE + CREATE TRIGGER guardado). BEGIN...COMMIT. Idempotente. lock_timeout 1500ms: 55P03 = nada mudou, rodar de novo.
-- Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261128100000_etapas_pl_entrada_configuravel.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK. Banco ANTES do site.
-- Volta: supabase/rollback/20261128100000_etapas_pl_entrada_configuravel_down.sql (devolve os corpos de ANTES:
--   _avaliar_condicoes_etapas_pl_core md5 3715a292f9cd18a4b8eaa06601e114e9, _etapas_pl_entrada_avaliar md5
--   066d482bb0d2f0731f78aec2f5191d47 e _kanban_pl_seed_etapas md5 fe9b651bd5ffcb8780410c4adc5b627e) e, DEPOIS, o
--   ..._down_drop.sql (DROP do gatilho de cad + sua funcao; horario calmo).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';

-- Guarda md5 ANTES (os corpos que esta migration substitui). Idempotente: se ja esta no "depois" (re-execucao), passa.
DO $pre$
DECLARE
  v_ava text := md5(pg_get_functiondef('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure));
  v_ent text := md5(pg_get_functiondef('public._etapas_pl_entrada_avaliar(uuid)'::regprocedure));
  v_seed text := md5(pg_get_functiondef('public._kanban_pl_seed_etapas(uuid)'::regprocedure));
BEGIN
  IF v_ava <> '3715a292f9cd18a4b8eaa06601e114e9' AND position('tem_peca_teste' in pg_get_functiondef('public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'etapas_pl_entrada_configuravel: _avaliar_condicoes_etapas_pl_core divergente (md5 %), esperado 3715a292f9cd18a4b8eaa06601e114e9', v_ava;
  END IF;
  IF v_ent <> '066d482bb0d2f0731f78aec2f5191d47' AND position('v_reqs_primeira' in pg_get_functiondef('public._etapas_pl_entrada_avaliar(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'etapas_pl_entrada_configuravel: _etapas_pl_entrada_avaliar divergente (md5 %), esperado 066d482bb0d2f0731f78aec2f5191d47', v_ent;
  END IF;
  IF v_seed <> 'fe9b651bd5ffcb8780410c4adc5b627e' AND position('tem_peca_teste' in pg_get_functiondef('public._kanban_pl_seed_etapas(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'etapas_pl_entrada_configuravel: _kanban_pl_seed_etapas divergente (md5 %), esperado fe9b651bd5ffcb8780410c4adc5b627e', v_seed;
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

-- 3) _kanban_pl_seed_etapas: + requisito de entrada da 1a coluna (tem_peca_teste) quando etapas_pl_requisitos estava vazio.
--    Corpo de ANTES (md5 fe9b651b...) intacto ate o UPDATE de etapas_pl_kanban; so o bloco final e novo.
CREATE OR REPLACE FUNCTION public._kanban_pl_seed_etapas(_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_labels jsonb;
BEGIN
  IF (SELECT jsonb_array_length(coalesce(etapas_pl_kanban, '[]'::jsonb)) FROM tenant_config WHERE tenant_id = _tenant) > 0 THEN
    RETURN; -- ja preenchido: nao sobrescreve
  END IF;
  -- Semeia SO as etapas ATIVAS da pcp_etapas (ativa IS NOT FALSE: ausente/null conta como ativa, so
  -- `false` explicito exclui) — uma etapa desativada nao vira coluna do quadro PL. coalesce NULL->default:
  -- se a loja desativou TODAS (jsonb_agg vazio = NULL), cai nos 5 labels default (nunca lista vazia).
  SELECT coalesce(
    (SELECT jsonb_agg(e->>'label' ORDER BY ord)
       FROM tenant_config tc, jsonb_array_elements(tc.pcp_etapas) WITH ORDINALITY AS t(e, ord)
      WHERE tc.tenant_id = _tenant AND tc.pcp_etapas IS NOT NULL AND jsonb_typeof(tc.pcp_etapas) = 'array'
        AND (e->>'ativa') IS DISTINCT FROM 'false'),
    '["Peça Teste","Separação de Materiais","Retorno de Grade de Corte","Oficina","Finalização"]'::jsonb
  ) INTO v_labels;
  UPDATE tenant_config SET etapas_pl_kanban = v_labels WHERE tenant_id = _tenant;
  -- NOVO (Onda 3 / Task 3): requisito de entrada da 1a coluna = tem_peca_teste, SO se nunca configurado ('{}'/NULL).
  -- A KEY da coluna e a MESMA que o avaliador usa para ler etapas_pl_requisitos (_kanban_fluxo(...)[1] = chave resolvida,
  -- ex. 'Peça Teste' -> 'peca_teste'); NAO usar _kanban_norm do label (so faz lower/btrim: 'peça teste' nao casaria).
  UPDATE public.tenant_config tc
     SET etapas_pl_requisitos = jsonb_build_object(
           (public._kanban_fluxo(jsonb_build_object('status_kanban', tc.etapas_pl_kanban), false))[1],
           jsonb_build_array('tem_peca_teste'))
   WHERE tc.tenant_id = _tenant
     AND coalesce(tc.etapas_pl_requisitos, '{}'::jsonb) = '{}'::jsonb
     AND NULLIF(btrim((public._kanban_fluxo(jsonb_build_object('status_kanban', tc.etapas_pl_kanban), false))[1]), '') IS NOT NULL;
END $function$;

-- (mantem os grants de antes: CREATE OR REPLACE preserva o ACL; re-afirma o fechamento da invariante #9)
REVOKE EXECUTE ON FUNCTION public._kanban_pl_seed_etapas(uuid) FROM PUBLIC, anon, authenticated;

-- 4) gatilho de ENTRADA em cad (a Explosao: cad.enviado_corte). Funcao propria; a fn_etapas_pl_entrada nao e tocada.
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_entrada_cad()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- cad novo ja enviado a Explosao (enviado_corte=true) pode cumprir a 1a coluna.
    IF NEW.modelo_id IS NOT NULL AND coalesce(NEW.enviado_corte, false) THEN
      PERFORM public._etapas_pl_entrada_avaliar(NEW.modelo_id);
    END IF;
  ELSE
    -- UPDATE OF enviado_corte, modelo_id dispara mesmo sem mudanca: so reavalia quando mudou de fato.
    IF coalesce(NEW.enviado_corte, false) IS DISTINCT FROM coalesce(OLD.enviado_corte, false)
       OR NEW.modelo_id IS DISTINCT FROM OLD.modelo_id THEN
      IF NEW.modelo_id IS NOT NULL THEN
        PERFORM public._etapas_pl_entrada_avaliar(NEW.modelo_id);
      END IF;
      IF OLD.modelo_id IS NOT NULL AND OLD.modelo_id IS DISTINCT FROM NEW.modelo_id THEN
        PERFORM public._etapas_pl_entrada_avaliar(OLD.modelo_id);
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_etapas_pl_entrada_cad() FROM PUBLIC, anon, authenticated;

-- Idempotente SEM DROP (cad e tabela de negocio; DROP TRIGGER prende auth/storage ate o COMMIT).
DO $kpl3cad$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.cad'::regclass
       AND tgname = 'trg_etapas_pl_entrada_cad'
       AND NOT tgisinternal
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_etapas_pl_entrada_cad '
         || 'AFTER INSERT OR UPDATE OF enviado_corte, modelo_id ON public.cad '
         || 'FOR EACH ROW EXECUTE FUNCTION public.fn_etapas_pl_entrada_cad()';
  END IF;
END
$kpl3cad$;

-- Pos-condicao: gatilho presente, habilitado e POR LINHA.
DO $kpl3pos$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.cad'::regclass AND t.tgname = 'trg_etapas_pl_entrada_cad'
                    AND t.tgenabled = 'O' AND (t.tgtype & 1) = 1) THEN
    RAISE EXCEPTION 'etapas_pl_entrada_configuravel: pos-condicao falhou - trg_etapas_pl_entrada_cad ausente/desabilitado/nao e por linha' USING ERRCODE = 'P0001';
  END IF;
END
$kpl3pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
