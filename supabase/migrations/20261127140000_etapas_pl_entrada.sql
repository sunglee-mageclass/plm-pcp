-- Kanban PL configuravel - Onda 2, Task 7: ENTRADA/SAIDA do card no PL pela trilha de peca teste.
-- ADITIVA e idempotente (CREATE OR REPLACE FUNCTION + CREATE TRIGGER guardado, SEM DROP TRIGGER). SO BANCO; nenhuma tela
-- usa ainda (a frente so liga na Onda 3). Com `etapas_pl_automatico=false` NAO ha derivacao (a fila nao enfileira); a
-- ENTRADA/SAIDA em si depende so da loja ter o modulo `etapas_pl` E de o board PL estar configurado (>= 1 etapa).
--
-- Regra (por modelo X):
--   v_tem_pt       := EXISTS(modelo_servico_mo s JOIN categorias_terceirizado ct ON ct.id = s.categoria_terceirizado_id
--                            AND ct.exige_peca_teste WHERE s.modelo_id = X)            -- "tem trilha de peca teste"
--   v_pos_explosao := EXISTS(cad c WHERE c.modelo_id = X AND coalesce(c.enviado_corte, false))
--   ENTRADA: v_tem_pt  E status_etapa_pl IS NULL      E loja com modulo etapas_pl E fluxo PL nao vazio
--            -> status_etapa_pl = 1a etapa do fluxo PL.
--   SAIDA  : NOT v_tem_pt E status_etapa_pl IS NOT NULL E NOT v_pos_explosao
--            -> status_etapa_pl = NULL (sai do PL). Pos-Explosao NUNCA sai.
-- 1a etapa = (_kanban_fluxo(jsonb_build_object('status_kanban', coalesce(_etapas_pl_cfg(tenant) -> 'etapas_pl_kanban','[]')), false))[1]
-- (a MESMA fonte de fluxo da Task 1 / _etapas_pl_derivar_lote; `status_etapa_pl` guarda a KEY normalizada). Fluxo vazio
-- (board nao configurado) -> NAO entra e nao grava nada. ⚠️ a pura _kanban_fluxo cai no board PADRAO do Dev quando o
-- board vem NULL/'[]'/nao-array (nunca devolve vazio), entao a checagem "board PL vazio" e feita no etapas_pl_kanban cru.
--
-- O que cria (todas DEFINER + REVOKE dos 3):
--   _etapas_pl_entrada_avaliar(_modelo uuid)  -> decide e grava entrada/saida de UM modelo (helper).
--   fn_etapas_pl_entrada()                    -> funcao de GATILHO: despacha por TG_TABLE_NAME.
--   trg_etapas_pl_entrada_mo  (modelo_servico_mo, AFTER INSERT OR DELETE OR UPDATE OF categoria_terceirizado_id, modelo_id,
--                              POR LINHA): reavalia o modelo da linha (e o antigo, se a linha trocou de modelo). UPDATE que
--                              nao muda categoria/modelo (ex. so `valor`) sai cedo; INSERT/DELETE de linha SEM categoria
--                              ("Geral (legado)") tambem (nao muda a trilha de peca teste).
--   trg_etapas_pl_entrada_cat (categorias_terceirizado, AFTER UPDATE OF exige_peca_teste, POR LINHA, so quando a flag muda):
--                              reavalia TODOS os modelos que tem servico (M.O.) nessa categoria.
--
-- Escrita do SISTEMA: o helper liga a GUC app.etapas_pl_sistema='auto' (e app.etapas_pl_lote='') em volta do UPDATE em `modelos`
-- e RESTAURA os valores anteriores. A GUC faz as enfileiradoras (trg_etapas_pl_fila_*) e o guard (fn_etapas_pl_status_guard)
-- sairem cedo - entao, apos restaurar, o helper ENFILEIRA o modelo explicitamente (_etapas_pl_enfileirar) na ENTRADA: o
-- processador da fila re-deriva a coluna certa no COMMIT (so com a chave ligada; senao no-op). A GUC 'auto' tambem marca a
-- origem 'auto' no historico (fn_etapas_pl_historico). A SAIDA nao enfileira (status NULL nao entra na fila).
-- `status_etapa_pl` NAO tem gate de escrita proprio (grep: so a Onda 1 e as migrations 20261127* citam a coluna; o gate de
-- `lancado`/`enviado_cad` nao a cobre) e o gatilho/helper sao DEFINER (current_user = dono: o INVOKER fn_seg_pagina_modelos
-- so morde authenticated/anon) - nao precisa de GUC de gate.
--
-- ⚠️ Padrao OBRIGATORIO de CREATE TRIGGER (reference_policy_ddl_trava_auth): criacao guardada idempotente, SEM
-- `DROP TRIGGER IF EXISTS` - um DROP TRIGGER em tabela de negocio (modelo_servico_mo/categorias_terceirizado), mesmo com o
-- gatilho inexistente, toma AccessExclusive e prende ~23 tabelas de auth/storage/realtime ate o COMMIT. O DROP so existe no
-- ..._down_drop (horario calmo).
-- RAISE 5xx so ASCII. Aplicar FORA de transacao:
--   psql "$(cat /tmp/dburl-local.txt)" -v ON_ERROR_STOP=1 -f supabase/migrations/20261127140000_etapas_pl_entrada.sql
-- NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza). Trava: CREATE TRIGGER pega ShareRowExclusive em `modelo_servico_mo` e
-- `categorias_terceirizado` (bloqueia ESCRITA por ms; lock_timeout 1500ms -> 55P03 = nada mudou, rodar de novo; horario calmo).
-- O CREATE TRIGGER NAO prende auth/storage.
-- Volta: supabase/rollback/20261127140000_etapas_pl_entrada_down.sql (NEUTRALIZA as 2 funcoes; sem DROP) e opcional/separado
-- ..._down_drop.sql (DROP TRIGGER + funcoes, HORARIO CALMO).
-- Funcoes todas NOVAS: sem guarda de md5 de funcao redefinida; a guarda confere so a pura reusada (_kanban_fluxo).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   dependencia FIXADA (nao redefinida aqui):
--     public._kanban_fluxo(jsonb,boolean)                                     7b3bbef69c25e08727553fb69c570fb4
-- ====================================================================================
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

-- Guarda: a pura reusada tem o texto esperado e as dependencias das Sessoes A/B existem.
DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public._kanban_fluxo(jsonb,boolean)')));
  IF v IS DISTINCT FROM '7b3bbef69c25e08727553fb69c570fb4' THEN
    RAISE EXCEPTION 'kpl_o2en: dependencia public._kanban_fluxo(jsonb,boolean) com texto inesperado (md5 %) - outra frente mexeu; gere de novo', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public._etapas_pl_cfg(uuid)'),
      ('public._etapas_pl_enfileirar(uuid[])'),
      ('public._tenant_modulo_ligado(uuid,text)')
    ) AS x(f) LOOP
    IF to_regprocedure(r.f) IS NULL THEN
      RAISE EXCEPTION 'kpl_o2en: dependencia % ausente (aplique as Sessoes A/B antes)', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'modelos' AND column_name = 'status_etapa_pl')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'categorias_terceirizado' AND column_name = 'exige_peca_teste') THEN
    RAISE EXCEPTION 'kpl_o2en: colunas modelos.status_etapa_pl / categorias_terceirizado.exige_peca_teste ausentes' USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) helper: decide e grava ENTRADA/SAIDA de UM modelo.
-- ────────────────────────────────────────────────────────────────────────────
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
    v_novo := v_fluxo[1];
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

-- ────────────────────────────────────────────────────────────────────────────
-- 2) funcao de GATILHO: despacha por tabela.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_etapas_pl_entrada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
BEGIN
  IF TG_TABLE_NAME = 'modelo_servico_mo' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.categoria_terceirizado_id IS NOT NULL THEN
        PERFORM public._etapas_pl_entrada_avaliar(NEW.modelo_id);
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      IF OLD.categoria_terceirizado_id IS NOT NULL THEN
        PERFORM public._etapas_pl_entrada_avaliar(OLD.modelo_id);
      END IF;
    ELSE
      -- UPDATE OF categoria_terceirizado_id, modelo_id dispara mesmo sem mudanca (o Salvar da M.O. regrava a categoria):
      -- so reavalia quando mudou de fato (sai de uma categoria / entra em outra / troca de modelo).
      IF OLD.categoria_terceirizado_id IS DISTINCT FROM NEW.categoria_terceirizado_id
         OR OLD.modelo_id IS DISTINCT FROM NEW.modelo_id THEN
        PERFORM public._etapas_pl_entrada_avaliar(NEW.modelo_id);
        IF OLD.modelo_id IS DISTINCT FROM NEW.modelo_id THEN
          PERFORM public._etapas_pl_entrada_avaliar(OLD.modelo_id);
        END IF;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'categorias_terceirizado' THEN
    -- ligar/desligar a flag muda v_tem_pt de TODOS os modelos que usam a categoria.
    FOR r IN SELECT DISTINCT s.modelo_id
               FROM public.modelo_servico_mo s
              WHERE s.categoria_terceirizado_id = NEW.id
              ORDER BY s.modelo_id LOOP
      PERFORM public._etapas_pl_entrada_avaliar(r.modelo_id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) gatilhos - criacao GUARDADA idempotente SEM DROP (ver cabecalho).
-- ────────────────────────────────────────────────────────────────────────────
DO $kpl7mo$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.modelo_servico_mo'::regclass
       AND tgname = 'trg_etapas_pl_entrada_mo'
       AND NOT tgisinternal
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_etapas_pl_entrada_mo '
         || 'AFTER INSERT OR DELETE OR UPDATE OF categoria_terceirizado_id, modelo_id ON public.modelo_servico_mo '
         || 'FOR EACH ROW EXECUTE FUNCTION public.fn_etapas_pl_entrada()';
  END IF;
END
$kpl7mo$;

DO $kpl7cat$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.categorias_terceirizado'::regclass
       AND tgname = 'trg_etapas_pl_entrada_cat'
       AND NOT tgisinternal
  ) THEN
    EXECUTE 'CREATE TRIGGER trg_etapas_pl_entrada_cat '
         || 'AFTER UPDATE OF exige_peca_teste ON public.categorias_terceirizado '
         || 'FOR EACH ROW WHEN (OLD.exige_peca_teste IS DISTINCT FROM NEW.exige_peca_teste) '
         || 'EXECUTE FUNCTION public.fn_etapas_pl_entrada()';
  END IF;
END
$kpl7cat$;

-- Invariante #9 - helper e funcao de gatilho sem EXECUTE para ninguem (o gatilho segue disparando: EXECUTE so e
-- conferido no CREATE TRIGGER).
REVOKE EXECUTE ON FUNCTION public._etapas_pl_entrada_avaliar(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_etapas_pl_entrada() FROM PUBLIC, anon, authenticated;

-- Pos-condicao: ACL, DEFINER, search_path=public; os 2 gatilhos presentes e habilitados.
DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._etapas_pl_entrada_avaliar(uuid)'),
      ('public.fn_etapas_pl_entrada()')
    ) AS x(f) LOOP
    IF has_function_privilege('public', r.f, 'EXECUTE')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f)
                        AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public') THEN
      RAISE EXCEPTION 'kpl_o2en: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.modelo_servico_mo'::regclass AND t.tgname = 'trg_etapas_pl_entrada_mo'
                    AND NOT t.tgisinternal AND t.tgenabled = 'O' AND (t.tgtype & 1) = 1) THEN
    RAISE EXCEPTION 'kpl_o2en: pos-condicao falhou - trg_etapas_pl_entrada_mo ausente/desabilitado/nao e por linha' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.categorias_terceirizado'::regclass AND t.tgname = 'trg_etapas_pl_entrada_cat'
                    AND NOT t.tgisinternal AND t.tgenabled = 'O' AND (t.tgtype & 1) = 1) THEN
    RAISE EXCEPTION 'kpl_o2en: pos-condicao falhou - trg_etapas_pl_entrada_cat ausente/desabilitado/nao e por linha' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;

select pg_notify('pgrst', 'reload schema');
