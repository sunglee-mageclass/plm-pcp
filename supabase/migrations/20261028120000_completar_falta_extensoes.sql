-- Achados LEVES, release L6 (CQ, producao e completar falta) - parte 3: extensoes do "completar o Faltou estoque do corte"
-- (P-203 A da R15a; backlogs da R15a que vieram para a L6).
--   (a) "- Metragem" desfeito: _reverter_ajuste_estoque_core (Estoque > Rolos/OC "reverter ajuste") apaga a baixa
--       origem='ajuste' e agora, com a variante devolvida pelo DELETE, chama _completar_deficit_corte_variante (o tecido
--       que voltou completa o "Faltou estoque" de cortes da loja nessa variante). Nunca espera trava; erro vira WARNING.
--       (Reverter o corte de OUTRO card ja e coberto pela 20261028110000.)
--   (b) B-R2: o gatilho de item da R15a nao olhava artigo_id, e trocar o rendimento/unidade do artigo (kg x rendimento)
--       muda o saldo em metros dos itens sem evento de item. Gatilho de constraint nao aceita CREATE OR REPLACE e esta
--       release nao usa DROP: em vez de recriar o trg_deficit_corte_item_upd, entram 2 CONSTRAINT TRIGGERs NOVOS ADIADOS
--       (rodam no COMMIT) com funcao NOVA fn_completar_deficit_corte_artigo():
--         trg_deficit_corte_item_artigo  ocs_tecido_itens AFTER UPDATE OF artigo_id WHEN mudou
--         trg_deficit_corte_artigo_rend  artigos AFTER UPDATE OF rendimento, unidade_medida WHEN mudou (LIMITADO: so as
--                                        variantes de itens de OC recebida do artigo que tem cad em falta, ate 50 por evento)
--       A funcao da R15a (fn_completar_deficit_corte) NAO muda.
--   (c) B-R1: RPC NOVA reprocessar_faltas_corte(_variante uuid DEFAULT NULL) - so tenant_admin/super admin, loja do
--       usuario, modulo criacao; roda o helper para uma variante ou todas as com cad em falta; devolve contagens
--       {variantes, processadas, cads, metros, malformadas, adiadas, erros, cads_com_falta}. EXECUTE so authenticated.
-- Nada gravado muda na ida (so age em eventos futuros ou quando o admin chama a RPC).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public._reverter_ajuste_estoque_core(uuid)
--     ANTES  f8390723d3c71be34a43e1d19209e480  -- PROVISORIO (copia 54422; fora do Passo 0): conferir no Passo 0 dos LEVES
--     DEPOIS 09119cbb6fc8e61eb3b0aec4ff733837  (este arquivo; reaplicar = no-op)
--   public.fn_completar_deficit_corte_artigo()   NOVA: ausente, af51f60dffd8efa23dbce971a0c8d422 (este arquivo) ou
--                                                7e4b933c428ae140c239b7ad6c798019 (NEUTRALIZADA pelo _down -> esta ida restaura)
--   public.reprocessar_faltas_corte(uuid)        NOVA: ausente, efb67823cc9961bd7b107debb4cd8b66 (este arquivo) ou
--                                                cc00b41f5ad93b4e3ba03a5cdb4e6edf (NEUTRALIZADA pelo _down -> esta ida restaura)
--   Gatilhos (conjunto = n:md5 de nome:habilitado:md5(triggerdef) em ordem de nome, igual ao Passo 0 / R15a):
--     ocs_tecido_itens  ANTES  4:01bd475466e7e45c7b93691afd66ed28   -- R15a "depois" (20261025300000 fix round 1)
--                       DEPOIS 5:c15a82fef8d5f2ff129f514c3ce587e8
--     artigos           ANTES  5:48889294c9428587a989de88868c2842   -- PROVISORIO (copia 54422; tabela fora do Passo 0): conferir no Passo 0 dos LEVES
--                       DEPOIS 6:c63ed0bad774acf4115e7f2225c779a3
--   Sem mudanca (so guarda):
--     public._completar_deficit_corte_variante(uuid,uuid)  70a91eef1ac40cce86ff7da8e6b14c7f  -- R15a "depois"
--     public.fn_completar_deficit_corte()                    8432f313e038796f8776922d604be205  -- R15a "depois" (NAO neutralizada)
--   Qualquer outro estado -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: CREATE OR REPLACE / CREATE FUNCTION (objeto) + 2 CREATE CONSTRAINT TRIGGER = ShareRowExclusiveLock em
-- ocs_tecido_itens e em artigos (bloqueia ESCRITA nas 2 tabelas por um instante; leitura segue). CREATE TRIGGER nao passa
-- pelo supautils.policy_grants (medicao da C4 / R15a) - quem prende auth/storage e o DROP TRIGGER do _down_drop.
-- lock_timeout 500ms: se alguem esta gravando OC/artigo, a migration falha inteira (nada fica) - rodar de novo
-- (idempotente); horario calmo, ate 3 tentativas. Sem DROP. ACL: fn_completar_deficit_corte_artigo SEM EXECUTE para
-- PUBLIC/anon/authenticated (inv. #9); reprocessar_faltas_corte SO authenticated (sem PUBLIC/anon); _reverter_ajuste_
-- estoque_core segue sem EXECUTE dos 3; o wrapper reverter_ajuste_estoque NAO muda (ACL de hoje, PUBLIC/anon com EXECUTE
-- pre-existente -> backlog do Reforco de seguranca).
-- Volta: supabase/rollback/20261028120000_completar_falta_extensoes_down.sql (devolve o _reverter_ajuste_estoque_core de
-- antes e NEUTRALIZA a funcao dos gatilhos e a RPC; sem trava de tabela, qualquer hora) e, SEPARADO/opcional,
-- supabase/rollback/20261028120000_completar_falta_extensoes_down_drop.sql (DROP TRIGGER/FUNCTION - trava ~23 tabelas
-- auth/storage/realtime ate o COMMIT: horario calmo). LIFO: o inverso desta roda PRIMEIRO na L6 (antes do 110000 e do
-- 100000) e SEMPRE antes dos inversos da R15a: o _down_drop da 20261025300000 confere o conjunto de gatilhos de
-- ocs_tecido_itens (2:...) e a ida da 20261025300000 recusa (4:... vira 5:...) enquanto os gatilhos daqui existirem.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

CREATE TEMP TABLE _l6c_acl_wrapper ON COMMIT DROP AS
  SELECT (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.reverter_ajuste_estoque(uuid)')) AS acl;

DO $guarda$
DECLARE
  r record;
  v_md5 text;
  v_set text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._completar_deficit_corte_variante(uuid,uuid)', '70a91eef1ac40cce86ff7da8e6b14c7f'),
      ('public.fn_completar_deficit_corte()',                   '8432f313e038796f8776922d604be205')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'leves_l6_falta: % nao existe neste banco (R15a aplicada?)', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l6_falta: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regprocedure('public._reverter_ajuste_estoque_core(uuid)') IS NULL
     OR md5(pg_get_functiondef(to_regprocedure('public._reverter_ajuste_estoque_core(uuid)')))
        NOT IN ('f8390723d3c71be34a43e1d19209e480', '09119cbb6fc8e61eb3b0aec4ff733837') THEN
    RAISE EXCEPTION 'leves_l6_falta: _reverter_ajuste_estoque_core ausente ou com outro texto - outra frente mexeu; conferir o Passo 0'
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.reverter_ajuste_estoque(uuid)') IS NULL THEN
    RAISE EXCEPTION 'leves_l6_falta: wrapper reverter_ajuste_estoque ausente' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.fn_completar_deficit_corte_artigo()') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public.fn_completar_deficit_corte_artigo()')))
         NOT IN ('af51f60dffd8efa23dbce971a0c8d422', '7e4b933c428ae140c239b7ad6c798019') THEN
    RAISE EXCEPTION 'leves_l6_falta: fn_completar_deficit_corte_artigo existe com outro texto - outra frente mexeu' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public.reprocessar_faltas_corte(uuid)') IS NOT NULL
     AND md5(pg_get_functiondef(to_regprocedure('public.reprocessar_faltas_corte(uuid)')))
         NOT IN ('efb67823cc9961bd7b107debb4cd8b66', 'cc00b41f5ad93b4e3ba03a5cdb4e6edf') THEN
    RAISE EXCEPTION 'leves_l6_falta: reprocessar_faltas_corte existe com outro texto - outra frente mexeu' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('ocs_tecido_itens', '4:01bd475466e7e45c7b93691afd66ed28', '5:c15a82fef8d5f2ff129f514c3ce587e8'),
      ('artigos',          '5:48889294c9428587a989de88868c2842', '6:c63ed0bad774acf4115e7f2225c779a3')) v(tab, antes, depois) LOOP
    IF to_regclass('public.' || r.tab) IS NULL THEN
      RAISE EXCEPTION 'leves_l6_falta: tabela % ausente', r.tab USING ERRCODE = 'P0001';
    END IF;
    SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
      INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.tab) AND NOT t.tgisinternal;
    IF v_set NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 'leves_l6_falta: gatilhos de % fora do esperado (%) - outra frente mexeu; conferir o Passo 0', r.tab, v_set
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public._reverter_ajuste_estoque_core(_baixa_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid := public.get_user_tenant_id(); v_var uuid;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  DELETE FROM public.estoque_tecido_baixas
  WHERE id = _baixa_id AND tenant_id = v_tenant AND origem = 'ajuste'
  RETURNING variante_tecido_id INTO v_var;
  -- (leves L6, backlog da R15a) o "- Metragem" desfeito devolve tecido ao estoque: completa o "Faltou estoque" dos
  -- cortes da loja nesta variante (corte mais antigo primeiro; regra do P-203). Nunca espera trava (corte da loja em
  -- curso = fica para o próximo evento ou reprocessar_faltas_corte); erro/tempo vira só WARNING.
  IF v_var IS NOT NULL THEN
    BEGIN
      PERFORM public._completar_deficit_corte_variante(v_tenant, v_var);
    EXCEPTION WHEN query_canceled OR OTHERS THEN
      RAISE WARNING 'reverter_ajuste: falta de corte da variante % nao completada (%: %)', v_var, SQLSTATE, SQLERRM;
    END;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_completar_deficit_corte_artigo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [leves L6, B-R2 da R15a] Funcao dos 2 gatilhos ADIADOS (CONSTRAINT TRIGGER ... INITIALLY DEFERRED, rodam no COMMIT) que
-- completam o "Faltou estoque" do corte quando o SALDO EM METROS de itens de OC recebida muda sem passar pelos gatilhos
-- da R15a (fn_completar_deficit_corte):
--   trg_deficit_corte_item_artigo  ocs_tecido_itens AFTER UPDATE OF artigo_id WHEN o artigo MUDOU (o item passa a valer
--                                  pelo kg x rendimento / unidade do outro artigo) -> a variante do item
--   trg_deficit_corte_artigo_rend  artigos AFTER UPDATE OF rendimento, unidade_medida WHEN mudou -> as variantes dos itens
--                                  de OC RECEBIDA desse artigo que tem cad com falta na loja (LIMITADO a 50 por evento; o
--                                  que passar disso fica para o proximo evento ou reprocessar_faltas_corte - WARNING)
-- Chama _completar_deficit_corte_variante(loja, variante) (R15a: nunca espera trava, orcamento de 4 s do COMMIT). Erro vira
-- so WARNING (ASCII) e nunca derruba o COMMIT de quem gravou - inclusive 57014 (query_canceled).
DECLARE
  c_max CONSTANT int := 50;
  v_tenant uuid;
  v_status text;
  v_var uuid;
  v_n int := 0;
BEGIN
  IF TG_TABLE_NAME = 'ocs_tecido_itens' THEN
    IF NEW.variante_tecido_id IS NULL OR NEW.oc_tecido_id IS NULL THEN
      RETURN NULL;
    END IF;
    SELECT oc.tenant_id, oc.status INTO v_tenant, v_status FROM public.ocs_tecido oc WHERE oc.id = NEW.oc_tecido_id;
    IF v_tenant IS NULL OR v_status IS DISTINCT FROM 'recebido' THEN
      RETURN NULL;
    END IF;
    BEGIN
      PERFORM public._completar_deficit_corte_variante(v_tenant, NEW.variante_tecido_id);
    EXCEPTION WHEN query_canceled OR OTHERS THEN
      RAISE WARNING 'completar_deficit_corte: variante % nao completada (%: %)', NEW.variante_tecido_id, SQLSTATE, SQLERRM;
    END;
  ELSIF TG_TABLE_NAME = 'artigos' THEN
    FOR v_tenant, v_var IN
      SELECT DISTINCT oc.tenant_id, it.variante_tecido_id
        FROM public.ocs_tecido_itens it
        JOIN public.ocs_tecido oc ON oc.id = it.oc_tecido_id
       WHERE it.artigo_id = NEW.id
         AND oc.status = 'recebido'
         AND COALESCE(it.cancelado, false) = false
         AND it.variante_tecido_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.cad cd
                       JOIN public.cad_tecidos ct ON ct.cad_id = cd.id
                       JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
                      WHERE cd.tenant_id = oc.tenant_id AND cd.enviado_corte
                        AND (CASE WHEN jsonb_typeof(cd.deficit_corte) = 'array'
                                  THEN jsonb_array_length(cd.deficit_corte) > 0 ELSE false END)
                        AND ctv.variante_tecido_id = it.variante_tecido_id)
       ORDER BY 1, 2
       LIMIT c_max + 1
    LOOP
      v_n := v_n + 1;
      IF v_n > c_max THEN
        RAISE WARNING 'completar_deficit_corte: artigo % tem mais de % variantes com falta - o resto fica para o proximo evento ou reprocessar_faltas_corte', NEW.id, c_max;
        EXIT;
      END IF;
      BEGIN
        PERFORM public._completar_deficit_corte_variante(v_tenant, v_var);
      EXCEPTION WHEN query_canceled OR OTHERS THEN
        RAISE WARNING 'completar_deficit_corte: variante % nao completada (%: %)', v_var, SQLSTATE, SQLERRM;
      END;
    END LOOP;
  END IF;
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_completar_deficit_corte_artigo() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reprocessar_faltas_corte(_variante uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [leves L6, B-R1 da R15a] Reprocessa o "Faltou estoque" do corte da LOJA DO USUARIO: roda
-- _completar_deficit_corte_variante (R15a, P-203 A) para uma variante (_variante) ou para todas as variantes com cad em
-- falta da loja. Para completar o que os gatilhos pularam (trava da loja ocupada, orcamento de tempo estourado, erro
-- virado WARNING). So o administrador da loja (tenant_admin) ou o super admin. Espera um corte em curso da loja (trava
-- 'corte_tenant:' bloqueante - aqui pode esperar; o helper reaproveita a trava). O helper tem orcamento de 4 s contados
-- do inicio do comando: o que nao couber volta como 'adiadas' (clicar de novo continua).
-- Devolve {variantes, processadas, cads, metros, malformadas, adiadas, erros, cads_com_falta}.
DECLARE
  v_tenant uuid;
  v_lista uuid[];
  v_var uuid;
  r jsonb;
  v_proc int := 0;
  v_cads int := 0;
  v_metros numeric := 0;
  v_malf int := 0;
  v_adiadas int := 0;
  v_erros int := 0;
  v_restam int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.tenant_module_enabled('criacao') THEN
    RAISE EXCEPTION 'Módulo criacao não habilitado para esta loja' USING ERRCODE = '42501';
  END IF;
  IF NOT (public.is_tenant_admin() OR public.is_super_admin()) THEN
    RAISE EXCEPTION 'Apenas o administrador da loja pode reprocessar as faltas do corte.' USING ERRCODE = '42501';
  END IF;
  v_tenant := public.get_user_tenant_id();
  IF v_tenant IS NULL OR v_tenant = '00000000-0000-0000-0000-000000000000'::uuid THEN
    RAISE EXCEPTION 'Loja inativa ou sem tenant — operação não permitida.' USING ERRCODE = '42501';
  END IF;
  IF _variante IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.variantes_tecido vt WHERE vt.id = _variante AND vt.tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Variante de tecido não encontrada nesta loja.' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('corte_tenant:' || v_tenant::text));

  SELECT COALESCE(array_agg(DISTINCT ctv.variante_tecido_id), ARRAY[]::uuid[]) INTO v_lista
    FROM public.cad cd
    JOIN public.cad_tecidos ct ON ct.cad_id = cd.id
    JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
   WHERE cd.tenant_id = v_tenant AND cd.enviado_corte
     AND (CASE WHEN jsonb_typeof(cd.deficit_corte) = 'array' THEN jsonb_array_length(cd.deficit_corte) > 0 ELSE false END)
     AND ctv.variante_tecido_id IS NOT NULL
     AND (_variante IS NULL OR ctv.variante_tecido_id = _variante);

  FOREACH v_var IN ARRAY v_lista LOOP
    BEGIN
      r := public._completar_deficit_corte_variante(v_tenant, v_var);
    EXCEPTION WHEN OTHERS THEN
      v_erros := v_erros + 1;
      RAISE WARNING 'reprocessar_faltas_corte: variante % com erro (%: %)', v_var, SQLSTATE, SQLERRM;
      CONTINUE;
    END;
    IF COALESCE((r->>'adiado')::boolean, false) OR COALESCE((r->>'ocupado')::boolean, false) THEN
      v_adiadas := v_adiadas + 1;
    ELSE
      v_proc := v_proc + 1;
    END IF;
    v_cads := v_cads + COALESCE((r->>'cads')::int, 0);
    v_metros := v_metros + COALESCE((r->>'metros')::numeric, 0);
    v_malf := v_malf + COALESCE((r->>'malformadas')::int, 0);
  END LOOP;

  SELECT count(*) INTO v_restam
    FROM public.cad cd
   WHERE cd.tenant_id = v_tenant AND cd.enviado_corte
     AND (CASE WHEN jsonb_typeof(cd.deficit_corte) = 'array' THEN jsonb_array_length(cd.deficit_corte) > 0 ELSE false END)
     AND (_variante IS NULL OR EXISTS (SELECT 1 FROM public.cad_tecidos ct
                                         JOIN public.cad_tecido_variantes ctv ON ctv.cad_tecido_id = ct.id
                                        WHERE ct.cad_id = cd.id AND ctv.variante_tecido_id = _variante));

  RETURN jsonb_build_object(
    'variantes', COALESCE(array_length(v_lista, 1), 0),
    'processadas', v_proc,
    'cads', v_cads,
    'metros', round(v_metros, 4),
    'malformadas', v_malf,
    'adiadas', v_adiadas,
    'erros', v_erros,
    'cads_com_falta', v_restam);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.reprocessar_faltas_corte(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reprocessar_faltas_corte(uuid) TO authenticated;

-- gatilhos (cria se falta - sem DROP; a guarda ja garantiu que, se existe, e o deste arquivo)
DO $gatilho$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_deficit_corte_item_artigo'
                 AND tgrelid = to_regclass('public.ocs_tecido_itens')) THEN
    CREATE CONSTRAINT TRIGGER trg_deficit_corte_item_artigo
      AFTER UPDATE OF artigo_id ON public.ocs_tecido_itens
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (NEW.variante_tecido_id IS NOT NULL AND OLD.artigo_id IS DISTINCT FROM NEW.artigo_id)
      EXECUTE FUNCTION public.fn_completar_deficit_corte_artigo();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_deficit_corte_artigo_rend'
                 AND tgrelid = to_regclass('public.artigos')) THEN
    CREATE CONSTRAINT TRIGGER trg_deficit_corte_artigo_rend
      AFTER UPDATE OF rendimento, unidade_medida ON public.artigos
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW WHEN (OLD.rendimento IS DISTINCT FROM NEW.rendimento OR OLD.unidade_medida IS DISTINCT FROM NEW.unidade_medida)
      EXECUTE FUNCTION public.fn_completar_deficit_corte_artigo();
  END IF;
END $gatilho$;

DO $pos$
DECLARE
  r record;
  v_set text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._reverter_ajuste_estoque_core(uuid)',            '09119cbb6fc8e61eb3b0aec4ff733837'),
      ('public.fn_completar_deficit_corte_artigo()',            'af51f60dffd8efa23dbce971a0c8d422'),
      ('public.reprocessar_faltas_corte(uuid)',                 'efb67823cc9961bd7b107debb4cd8b66'),
      ('public._completar_deficit_corte_variante(uuid,uuid)',   '70a91eef1ac40cce86ff7da8e6b14c7f'),
      ('public.fn_completar_deficit_corte()',                   '8432f313e038796f8776922d604be205')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l6_falta: pos-condicao falhou - % nao ficou com o texto esperado', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: helper, _core e funcao de gatilho sem EXECUTE para PUBLIC/anon/authenticated
  FOR r IN SELECT * FROM (VALUES ('public._reverter_ajuste_estoque_core(uuid)'),
                                 ('public.fn_completar_deficit_corte_artigo()'),
                                 ('public._completar_deficit_corte_variante(uuid,uuid)')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l6_falta: % ficou executavel por PUBLIC/anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- RPC publica nova: authenticated SIM; anon e PUBLIC NAO.
  IF NOT has_function_privilege('authenticated', to_regprocedure('public.reprocessar_faltas_corte(uuid)'), 'EXECUTE')
     OR has_function_privilege('anon', to_regprocedure('public.reprocessar_faltas_corte(uuid)'), 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.reprocessar_faltas_corte(uuid)') AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'leves_l6_falta: ACL de reprocessar_faltas_corte fora do esperado (authenticated sim; anon/PUBLIC nao)' USING ERRCODE = 'P0001';
  END IF;
  -- o wrapper do "- Metragem" nao muda (ACL de hoje)
  IF (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.reverter_ajuste_estoque(uuid)'))
     IS DISTINCT FROM (SELECT acl FROM _l6c_acl_wrapper) THEN
    RAISE EXCEPTION 'leves_l6_falta: a ACL de reverter_ajuste_estoque mudou' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('ocs_tecido_itens', 'trg_deficit_corte_item_artigo', '5:c15a82fef8d5f2ff129f514c3ce587e8',
       'CREATE CONSTRAINT TRIGGER trg_deficit_corte_item_artigo AFTER UPDATE OF artigo_id ON public.ocs_tecido_itens DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((new.variante_tecido_id IS NOT NULL) AND (old.artigo_id IS DISTINCT FROM new.artigo_id))) EXECUTE FUNCTION fn_completar_deficit_corte_artigo()'),
      ('artigos', 'trg_deficit_corte_artigo_rend', '6:c63ed0bad774acf4115e7f2225c779a3',
       'CREATE CONSTRAINT TRIGGER trg_deficit_corte_artigo_rend AFTER UPDATE OF rendimento, unidade_medida ON public.artigos DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (((old.rendimento IS DISTINCT FROM new.rendimento) OR ((old.unidade_medida)::text IS DISTINCT FROM (new.unidade_medida)::text))) EXECUTE FUNCTION fn_completar_deficit_corte_artigo()')
    ) v(tab, tg, depois, def) LOOP
    IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = r.tg
          AND t.tgrelid = to_regclass('public.' || r.tab) AND t.tgenabled = 'O') IS DISTINCT FROM r.def THEN
      RAISE EXCEPTION 'leves_l6_falta: gatilho % de % ausente, desligado ou diferente', r.tg, r.tab USING ERRCODE = 'P0001';
    END IF;
    SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
      INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.tab) AND NOT t.tgisinternal;
    IF v_set IS DISTINCT FROM r.depois THEN
      RAISE EXCEPTION 'leves_l6_falta: pos-condicao falhou - gatilhos de % = % (esperado %)', r.tab, v_set, r.depois USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
