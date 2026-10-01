-- Achados MEDIOS, release R14 (Kanban + Integracao; banco antes do site) - parte 3: sku #18 (P-88 A).
--   VINCULAR um produto comprado ao card (o Sheet do Planejamento cria o produto e liga com
--   `.update({modelo_id})` - usePlanejamentoSave.ts:712-728 revenda, :778-796 importado) nao levava a REF ao card: o
--   espelho trg_espelho_modelo_nome_ref so dispara em UPDATE OF nome, ref. Agora: funcao NOVA
--   fn_espelho_ref_ao_vincular + gatilho NOVO trg_espelho_ref_ao_vincular AFTER UPDATE OF modelo_id (WHEN o vinculo
--   mudou e nao e NULL) em produtos_acabados e produtos_importados. Regra (P-88 A, a mesma do espelho de nome/REF): copia
--   a REF do produto SO se o card (revenda/importado, mesma loja) esta com a REF VAZIA (REF manual/digitada nunca e
--   sobrescrita) e ainda NAO foi a Explosao (enviado_cad). Card travado pela Integracao com 'ref_sku' marcado nao recebe
--   (nunca recusa o vinculo). INSERT ja vinculado nao e coberto (criar_card_produto_acabado ja copia a REF direto).
--   Sem loop: a REF copiada e a do proprio produto - o espelho card->produto (trg_modelo_espelho_nome_ref, AFTER UPDATE OF
--   nome, ref em modelos) dispara mas nao acha diferenca (pa.ref IS DISTINCT FROM v_ref = falso) e nao grava; este gatilho
--   so escuta UPDATE OF modelo_id. As travas (trg_zz_integracao_trava*): o produto ligado agora tem OLD.modelo_id NULL ou
--   nao travado (a trava do produto ja recusa trocar o vinculo de um travado ANTES deste AFTER), e o card travado com
--   ref_sku e pulado - nenhuma recusa nova em uma mudanca que nao e mudanca.
--   [fix round 1, M1] A funcao e DEFENSIVA quanto a _integracao_campo_travado: so a consulta se ela existe (to_regprocedure +
--   EXECUTE dinamico); ausente (volta de emergencia da Integracao) = "nao travado" - o vinculo nunca da 42883.
--   Correcao dos ja vinculados: arquivo SEPARADO e opcional 20261024210100_espelho_ref_correcao_unica.sql (o kit roda antes
--   a previa so-leitura supabase/consultas/r14_sku18_correcao_previa.sql).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   public.fn_espelho_ref_ao_vincular()  NOVA: ausente (= producao), ou 7e60628faafaf26beb5920abe75da5c7 (este arquivo; reaplicar = no-op), ou
--     42bcb3e5845ac9753e5fb3ffa40813c8 (neutralizada pelo _down -> esta ida a restaura). O texto do round 0 (6baf719f) NAO e aceito:
--     desfazer com o _down antes.
--   Gatilhos (conjunto = n:md5 de nome:habilitado:md5(triggerdef) em ordem de nome, igual ao Passo 0):
--     produtos_acabados    ANTES 10:cdab1723eecc2cfe70b8589e961630f7  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--                          DEPOIS 11:15c4b1c236f34756c8ca324a5b389073
--     produtos_importados  ANTES 10:6240c87feae9183998f368009fcb2abb  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--                          DEPOIS 11:1facf0023f632407ba243a208abdbce3
--   Sem mudanca (so guarda):
--     public.fn_espelho_modelo_nome_ref()  1867fc82f8a7e73d26a2593598235199  INTOCADA  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06)
--     public.fn_integracao_trava_espelho()  e239279ec27fe8257d31e262138b547e  INTOCADA  -- CONFIRMADO: Passo 0 dos MEDIOS em producao (01/out 11:06) (CSV de gatilhos, md5_funcao)
--     public._integracao_campo_travado(uuid,text)  798bcba30f1f75be96ae55079bc19767  INTOCADA  -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R14
--     public.fn_modelo_espelho_nome_ref()  497f1c1a828d954185dd8d2e67104bc2  INTOCADA  -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R14
--     public.fn_integracao_trava_modelos()  6e98c10d13c469a910c778f66354aac3  INTOCADA  -- PROVISORIO (copia 54422): conferir no Passo 0 do kit R14
--   Qualquer outro estado -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas: CREATE OR REPLACE FUNCTION (objeto) + CREATE TRIGGER = ShareRowExclusiveLock em produtos_acabados e
-- produtos_importados (bloqueia ESCRITA nas 2 tabelas por um instante; leitura segue; NAO trava auth/storage - conferido
-- em pg_locks na copia). lock_timeout 500ms: se alguem esta gravando produto, a migration falha inteira (nada fica) e e
-- so rodar de novo (idempotente) - horario calmo, ate 3 tentativas. Sem DROP. ACL: a funcao do gatilho nasce SEM EXECUTE
-- para PUBLIC/anon/authenticated (inv. #9; gatilho nao confere EXECUTE ao disparar).
-- Volta: supabase/rollback/20261024210000_espelho_ref_ao_vincular_down.sql NEUTRALIZA a funcao (CREATE OR REPLACE, sem
-- trava de tabela, qualquer hora); supabase/rollback/20261024210000_espelho_ref_ao_vincular_down_drop.sql (SEPARADO,
-- opcional) faz o DROP TRIGGER/DROP FUNCTION - DROP TRIGGER trava ~23 tabelas auth/storage/realtime ate o COMMIT:
-- horario calmo. REFs ja copiadas ficam (REF revelada nao volta).
-- LIFO / ORDEM DE VOLTA (G-MIGRATION M1): o _down (neutro) DESTA migration roda ANTES da volta de emergencia da Integracao
-- (.superpowers/integracao/mig/volta-producao.sh - em especial 20261007130000_integracao_4_trava_down.sql, que apaga
-- _integracao_campo_travado). Com a guarda defensiva (fix round 1) o gatilho ja nao quebra se a ordem for invertida, mas a
-- ordem recomendada fica: o roteiro da volta confere fn_espelho_ref_ao_vincular ausente ou NEUTRA (42bcb3e5) antes de
-- seguir. Nenhum inverso confere estes objetos por md5. O Passo 0 dos MEDIOS lista "ausentes_padrao_gatilho_novo_produtos"
-- (vai passar a mostrar trg_espelho_ref_ao_vincular - esperado).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
  v_set text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_espelho_modelo_nome_ref()', '1867fc82f8a7e73d26a2593598235199'),
      ('public.fn_integracao_trava_espelho()', 'e239279ec27fe8257d31e262138b547e'),
      ('public._integracao_campo_travado(uuid,text)', '798bcba30f1f75be96ae55079bc19767'),
      ('public.fn_modelo_espelho_nome_ref()', '497f1c1a828d954185dd8d2e67104bc2'),
      ('public.fn_integracao_trava_modelos()', '6e98c10d13c469a910c778f66354aac3')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'medios_r14_sku18: % nao existe neste banco', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'medios_r14_sku18: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF to_regprocedure('public.fn_espelho_ref_ao_vincular()') IS NOT NULL THEN
    v_md5 := md5(pg_get_functiondef(to_regprocedure('public.fn_espelho_ref_ao_vincular()')));
    IF v_md5 NOT IN ('7e60628faafaf26beb5920abe75da5c7', '42bcb3e5845ac9753e5fb3ffa40813c8') THEN
      RAISE EXCEPTION 'medios_r14_sku18: fn_espelho_ref_ao_vincular existe com outro texto (md5 %) - outra frente mexeu', v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('produtos_acabados', '10:cdab1723eecc2cfe70b8589e961630f7', '11:15c4b1c236f34756c8ca324a5b389073'),
      ('produtos_importados', '10:6240c87feae9183998f368009fcb2abb', '11:1facf0023f632407ba243a208abdbce3')) v(tab, antes, depois) LOOP
    IF to_regclass('public.' || r.tab) IS NULL THEN
      RAISE EXCEPTION 'medios_r14_sku18: tabela % ausente', r.tab USING ERRCODE = 'P0001';
    END IF;
    SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
      INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.tab) AND NOT t.tgisinternal;
    IF v_set NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 'medios_r14_sku18: gatilhos de % fora do esperado (%) - outra frente mexeu; conferir o Passo 0', r.tab, v_set
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public.fn_espelho_ref_ao_vincular()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [medios R14 sku #18, P-88 A] VINCULAR um produto comprado (produtos_acabados/produtos_importados.modelo_id passa a
-- apontar um card) leva a REF do produto ao card, pela mesma regra do espelho de nome/REF (fn_espelho_modelo_nome_ref,
-- que so dispara em OF nome, ref): so se o card ainda NAO tem REF (vazia - REF digitada/manual nunca e sobrescrita) e
-- ainda NAO foi a Explosao (enviado_cad). Card comprado (revenda/importado) da MESMA loja. Card travado pela Integracao
-- com 'ref_sku' marcado nao recebe (nunca recusa o vinculo por causa disto). Sem REF no produto = nada.
-- Sem loop: a REF copiada e a do proprio produto, entao o espelho card->produto (fn_modelo_espelho_nome_ref) nao acha
-- diferenca e nao grava; este gatilho so escuta UPDATE OF modelo_id.
-- [fix round 1, M1] DEFENSIVO: a trava so e consultada se _integracao_campo_travado(uuid,text) EXISTE (to_regprocedure +
-- EXECUTE dinamico - o plpgsql nao guarda dependencia e uma chamada direta daria 42883 depois da volta de emergencia da
-- Integracao, 20261007130000_integracao_4_trava_down, que a apaga); ausente = "nao travado". Mesmo assim a ordem
-- recomendada segue: o _down (neutro) desta funcao roda ANTES da volta da Integracao.
DECLARE
  v_ref text := nullif(btrim(coalesce(NEW.ref::text, '')), '');
  v_travado boolean := false;
BEGIN
  IF NEW.modelo_id IS NULL OR v_ref IS NULL OR NEW.modelo_id IS NOT DISTINCT FROM OLD.modelo_id THEN
    RETURN NULL;
  END IF;
  IF to_regprocedure('public._integracao_campo_travado(uuid,text)') IS NOT NULL THEN
    EXECUTE 'SELECT public._integracao_campo_travado($1, $2)' INTO v_travado USING NEW.modelo_id, 'ref_sku'::text;
  END IF;
  IF coalesce(v_travado, false) THEN
    RETURN NULL;
  END IF;
  UPDATE public.modelos m
     SET ref = v_ref
   WHERE m.id = NEW.modelo_id
     AND m.tenant_id = NEW.tenant_id
     AND coalesce(m.origem, 'interno') IN ('revenda', 'importado')
     AND coalesce(btrim(m.ref::text), '') = ''
     AND NOT coalesce(m.enviado_cad, false);
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_espelho_ref_ao_vincular() FROM PUBLIC, anon, authenticated;

-- gatilhos (cria se falta - sem DROP; a guarda ja garantiu que, se existe, e o deste arquivo e esta ligado)
DO $gatilho$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_espelho_ref_ao_vincular'
                 AND tgrelid = to_regclass('public.produtos_acabados')) THEN
    CREATE TRIGGER trg_espelho_ref_ao_vincular
      AFTER UPDATE OF modelo_id ON public.produtos_acabados
      FOR EACH ROW WHEN (NEW.modelo_id IS NOT NULL AND OLD.modelo_id IS DISTINCT FROM NEW.modelo_id)
      EXECUTE FUNCTION public.fn_espelho_ref_ao_vincular();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_espelho_ref_ao_vincular'
                 AND tgrelid = to_regclass('public.produtos_importados')) THEN
    CREATE TRIGGER trg_espelho_ref_ao_vincular
      AFTER UPDATE OF modelo_id ON public.produtos_importados
      FOR EACH ROW WHEN (NEW.modelo_id IS NOT NULL AND OLD.modelo_id IS DISTINCT FROM NEW.modelo_id)
      EXECUTE FUNCTION public.fn_espelho_ref_ao_vincular();
  END IF;
END $gatilho$;

DO $pos$
DECLARE
  r record;
  v_set text;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_espelho_ref_ao_vincular()'))) IS DISTINCT FROM '7e60628faafaf26beb5920abe75da5c7' THEN
    RAISE EXCEPTION 'medios_r14_sku18: pos-condicao falhou - fn_espelho_ref_ao_vincular nao ficou com o texto deste arquivo' USING ERRCODE = 'P0001';
  END IF;
  -- inv. #9: funcao de gatilho sem EXECUTE para PUBLIC/anon/authenticated
  IF has_function_privilege('anon', to_regprocedure('public.fn_espelho_ref_ao_vincular()'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public.fn_espelho_ref_ao_vincular()'), 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.fn_espelho_ref_ao_vincular()') AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r14_sku18: fn_espelho_ref_ao_vincular ficou executavel por PUBLIC/anon/authenticated (inv. #9)' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('produtos_acabados', '11:15c4b1c236f34756c8ca324a5b389073', 'CREATE TRIGGER trg_espelho_ref_ao_vincular AFTER UPDATE OF modelo_id ON public.produtos_acabados FOR EACH ROW WHEN (((new.modelo_id IS NOT NULL) AND (old.modelo_id IS DISTINCT FROM new.modelo_id))) EXECUTE FUNCTION fn_espelho_ref_ao_vincular()'),
      ('produtos_importados', '11:1facf0023f632407ba243a208abdbce3', 'CREATE TRIGGER trg_espelho_ref_ao_vincular AFTER UPDATE OF modelo_id ON public.produtos_importados FOR EACH ROW WHEN (((new.modelo_id IS NOT NULL) AND (old.modelo_id IS DISTINCT FROM new.modelo_id))) EXECUTE FUNCTION fn_espelho_ref_ao_vincular()')) v(tab, depois, def) LOOP
    IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = 'trg_espelho_ref_ao_vincular'
          AND t.tgrelid = to_regclass('public.' || r.tab) AND t.tgenabled = 'O') IS DISTINCT FROM r.def THEN
      RAISE EXCEPTION 'medios_r14_sku18: gatilho trg_espelho_ref_ao_vincular de % ausente, desligado ou diferente', r.tab USING ERRCODE = 'P0001';
    END IF;
    SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
      INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.tab) AND NOT t.tgisinternal;
    IF v_set IS DISTINCT FROM r.depois THEN
      RAISE EXCEPTION 'medios_r14_sku18: pos-condicao falhou - gatilhos de % = % (esperado %)', r.tab, v_set, r.depois USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
