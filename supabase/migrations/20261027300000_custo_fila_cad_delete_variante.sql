-- Achados LEVES, release L5 (fila do custo previsto; so banco, sem site): C1 L4 (plano .superpowers/sdd/2026-10-02-leves/
-- plan.md §1 "C1 L4", §2 L5; contexto: contas certas C1, 20261019300000_custo_previsto_servidor.sql, P-169 A/R-CD1).
--   Dois buracos da fila custo_recalculo_fila aceitos na C1 (L4) e fechados agora:
--   (1) APAGAR o CAD de um card ja enviado ao corte DESCONGELA o card (o congelado e EXISTS cad.enviado_corte), mas nada
--       enfileirava (so havia trg_custo_fila_upd, que cobre reverter o corte true -> false). Agora: gatilho NOVO
--       trg_custo_fila_del AFTER DELETE ON cad (por COMANDO, tabela de transicao antigas) -> fn_custo_fila_cad_del NOVA:
--       enfileira o modelo de cada CAD apagado que ESTAVA enviado ao corte, so se o modelo e da mesma loja do CAD (M3),
--       com _respeitar_congelado = true (se sobrar outro CAD cortado do mesmo modelo, ele segue congelado). CAD apagado sem
--       corte nao congelava nada: nao enfileira.
--   (2) TROCAR o artigo de uma variante de tecido (variantes_tecido.artigo_id) muda o preco que ela empresta ao custo
--       (_custo_preco_tecido: MAX dos artigos dos substitutos via modelo_tecido_variantes; e o vinculo de OC via
--       modelo_tecido_oc_links -> artigo da variante, kg / rendimento e a loja do preco congelado), mas nada enfileirava.
--       Agora: gatilho NOVO trg_custo_fila_upd AFTER UPDATE OF artigo_id ON variantes_tecido FOR EACH ROW WHEN (artigo
--       mudou) -> fn_custo_fila_variante_tecido NOVA: enfileira os modelos DA MESMA LOJA da variante que a usam pelos dois
--       caminhos. E mudanca de CADASTRO (como o preco do artigo em fn_custo_fila_preco): respeita o congelado (card ja
--       enviado ao corte fica, P-169 A). Por LINHA com coluna + WHEN (e nao por comando com transicao): tabela de transicao
--       nao combina com lista de colunas, e o preco da variante muda com frequencia - assim todo UPDATE que nao troca o
--       artigo nao custa nada.
--   Quem processa e o de sempre (fn_custo_processar_fila, adiado, no COMMIT). Nada gravado muda na ida; nenhuma funcao
--   existente e reescrita (_custo_enfileirar, fn_custo_fila_cad e fn_custo_processar_fila so sao conferidas).
--
-- ============================== ACCEPTED-MD5 (guarda) ===============================================================
--   Sem mudanca (so guarda; texto da 20261019300000):
--     public._custo_enfileirar(uuid[],boolean)  af8976a493758423d267325156f14633  INTOCADA  -- CONFIRMADO: pos-condicao da
--       20261019300000 em producao (ida-release8-passo1 01/out 09:56, rc 0; arquivo igual byte a byte); Passo 0 dos LEVES reconfere
--     public.fn_custo_fila_cad()  382a1d5e86635d0bf9d2a114ca0b0a97  INTOCADA  -- CONFIRMADO: idem (pos-condicao da release 8)
--     public.fn_custo_processar_fila()  e401fe02e63efee355a59f9f58c399ad  INTOCADA  -- CONFIRMADO: idem (pos-condicao da release 8)
--   NOVAS: ausentes (= producao), ou com o texto deste arquivo (reaplicar = no-op), ou NEUTRALIZADAS pelo _down (esta ida
--     as restaura):
--     public.fn_custo_fila_cad_del()          DEPOIS 7a98464376a1e4f60a1dc4da83bec516  NEUTRA 9df86c53e45c99810ec4ba5ca120bedb
--     public.fn_custo_fila_variante_tecido()  DEPOIS 5a57e42a4b3595c2889e85c1c2823b0e  NEUTRA e92a84443182afee5ce356d70f24384d
--   Gatilhos (conjunto = n:md5 de nome:habilitado:md5(triggerdef) em ordem de nome, igual ao Passo 0):
--     cad               ANTES  9:36b488d7e6efd874c706b6d01f80109c  -- DERIVADO de producao: Passo 0-CD (8:25cb4493, sem trg_custo_*)
--                                                                   + trg_custo_fila_upd da pos-condicao da release 8; Passo 0 dos LEVES reconfere
--                       DEPOIS 10:cbaa238a6081b7c9753a574addb79ee7
--     variantes_tecido  ANTES  4:5e380b55c9d0d129985b3c45b51add9f  -- PROVISORIO (copia 54422): conferir no Passo 0 dos LEVES
--                       DEPOIS 5:73280f59db22184fa890cb9b0e60ba6c
--   (o plano §4 cita "cad (8)" = o conjunto SEM os trg_custo_* da release 8, e "variantes_tecido (3)"; na copia sao 9 e 4 -
--    a contagem 3 do plano nao bate com a copia: conferir no Passo 0.)
--   Qualquer outro estado -> P0001 e nada muda.
-- =====================================================================================================================
-- Travas (medidas em pg_locks na copia 54422, 01/out): CREATE FUNCTION/REVOKE = so trava de objeto (nenhuma tabela);
-- CREATE TRIGGER = ShareRowExclusiveLock em cad e em variantes_tecido (bloqueia ESCRITA nas 2 por um instante; leitura
-- segue). cad e tabela QUENTE (CQ/PCP/Explosao gravam nela): gatilhos POR ULTIMO, lock_timeout 500ms - se alguem esta
-- gravando, a migration falha inteira (nada fica) e e so rodar de novo (idempotente), horario calmo, ate 3 tentativas.
-- CREATE TRIGGER NAO trava auth/storage/realtime (medido: so cad + variantes_tecido no pg_locks; ja o DROP TRIGGER do
-- _down_drop, medido na mesma copia, pega AccessExclusive em cad, variantes_tecido e 25 tabelas auth/storage/realtime).
-- Sem DROP aqui. ACL: as 2 funcoes nascem SEM EXECUTE para
-- PUBLIC/anon/authenticated (inv. #9; gatilho nao confere EXECUTE ao disparar).
-- Volta: supabase/rollback/20261027300000_custo_fila_cad_delete_variante_down.sql NEUTRALIZA as 2 funcoes (CREATE OR REPLACE,
-- sem trava de tabela, qualquer hora - freio de emergencia); supabase/rollback/20261027300000_custo_fila_cad_delete_variante_down_drop.sql
-- (SEPARADO, opcional) faz DROP TRIGGER/DROP FUNCTION - DROP TRIGGER pega AccessExclusive em cad/variantes_tecido e, em
-- producao, ~23 tabelas auth/storage/realtime ate o COMMIT: horario calmo. Nada gravado volta (o custo ja recalculado fica).
-- LIFO: esta volta roda ANTES das voltas da release 8 (20261019300000). Os nomes novos seguem o padrao trg_custo_*: o
-- _down da release 8 (DISABLE TRIGGER ... LIKE 'trg\_custo\_%') desliga estes 2 tambem, e o _down_drop dela os apaga.
-- Reaplicar a IDA da 20261019300000 com a L5 no banco e recusado pela guarda (d) dela (gatilho trg_custo_* fora da lista):
-- rodar antes o _down + _down_drop DESTA.
-- [fix round 1, M1] FREIO DA RELEASE 8 com a L5 no banco: soltar o freio (20261019300000_custo_previsto_servidor_down_neutraliza)
-- "reaplicando a ida da 20261019300000" e RECUSADO enquanto os gatilhos da L5 existirem (guarda (d) dela: trg_custo_* fora da
-- lista) - o _down da L5 sozinho NAO basta (os gatilhos ficam de pe). Sequencia: _down da L5 -> _down_drop da L5 (DROP TRIGGER:
-- AccessExclusive em cad + auth/storage/realtime, HORARIO CALMO) -> reaplicar a ida da 20261019300000 -> reaplicar esta L5.
-- Os gatilhos NAO devem ser renomeados para fugir do padrao trg_custo_*: o _down_drop da release 8 apaga _custo_enfileirar, e
-- um gatilho da L5 com outro nome chamaria funcao inexistente em todo DELETE de cad.
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
      ('public._custo_enfileirar(uuid[],boolean)', 'af8976a493758423d267325156f14633'),
      ('public.fn_custo_fila_cad()', '382a1d5e86635d0bf9d2a114ca0b0a97'),
      ('public.fn_custo_processar_fila()', 'e401fe02e63efee355a59f9f58c399ad')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'leves_l5: % nao existe neste banco (a 20261019300000 tem de estar aplicada)', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l5: % mudou desde o planejamento (md5 %) - outra frente mexeu; conferir o Passo 0', r.s, v_md5
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_custo_fila_cad_del()', '7a98464376a1e4f60a1dc4da83bec516', '9df86c53e45c99810ec4ba5ca120bedb'),
      ('public.fn_custo_fila_variante_tecido()', '5a57e42a4b3595c2889e85c1c2823b0e', 'e92a84443182afee5ce356d70f24384d')) v(s, depois, neutro) LOOP
    IF to_regprocedure(r.s) IS NOT NULL THEN
      v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
      IF v_md5 NOT IN (r.depois, r.neutro) THEN
        RAISE EXCEPTION 'leves_l5: % existe com outro texto (md5 %) - outra frente mexeu', r.s, v_md5 USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('cad', '9:36b488d7e6efd874c706b6d01f80109c', '10:cbaa238a6081b7c9753a574addb79ee7'),
      ('variantes_tecido', '4:5e380b55c9d0d129985b3c45b51add9f', '5:73280f59db22184fa890cb9b0e60ba6c')) v(tab, antes, depois) LOOP
    IF to_regclass('public.' || r.tab) IS NULL THEN
      RAISE EXCEPTION 'leves_l5: tabela % ausente', r.tab USING ERRCODE = 'P0001';
    END IF;
    SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
      INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.tab) AND NOT t.tgisinternal;
    IF v_set NOT IN (r.antes, r.depois) THEN
      RAISE EXCEPTION 'leves_l5: gatilhos de % fora do esperado (%) - outra frente mexeu; conferir o Passo 0', r.tab, v_set
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_cad_del()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [leves L5, C1 L4] APAGAR o CAD de um card ja enviado ao corte DESCONGELA o card (P-169 A/R-CD1: o congelado e o EXISTS
-- de cad.enviado_corte) - igual a reverter o corte (fn_custo_fila_cad), enfileira o modelo para o custo previsto alcancar o
-- cadastro de hoje. CAD apagado que NAO estava enviado ao corte nao congelava nada: nao enfileira. So modelo da MESMA loja do
-- CAD (M3). _respeitar_congelado = true: se o modelo ainda tem OUTRO CAD enviado ao corte, ele segue congelado e fica fora.
-- Gatilho de STATEMENT com tabela de transicao (antigas), como os demais trg_custo_fila_*.
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.custo_sistema', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(DISTINCT m.id) INTO v_ids
    FROM antigas o
    JOIN public.modelos m ON m.id = o.modelo_id AND m.tenant_id = o.tenant_id
   WHERE coalesce(o.enviado_corte, false);
  PERFORM public._custo_enfileirar(v_ids, true);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_variante_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [leves L5, C1 L4] a variante de tecido mudou de ARTIGO (variantes_tecido.artigo_id): o preco que ela empresta muda nos
-- dois caminhos do custo (_custo_preco_tecido): substituto da linha (modelo_tecido_variantes -> MAX dos artigos) e vinculo
-- de OC (modelo_tecido_oc_links -> artigo da variante: kg / rendimento e a loja do preco congelado). Enfileira os modelos
-- DA MESMA LOJA da variante que a usam por qualquer dos dois. E mudanca de CADASTRO (como o preco do artigo em
-- fn_custo_fila_preco): respeita o congelado - card ja enviado ao corte fica (P-169 A/R-CD1). Gatilho por LINHA com
-- UPDATE OF artigo_id + WHEN (OLD x NEW): a tabela de transicao nao combina com lista de colunas, e o preco da variante
-- muda com frequencia - a coluna e o WHEN mantem o custo zero para todo UPDATE que nao troca o artigo.
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.custo_sistema', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(DISTINCT m.id) INTO v_ids
    FROM (SELECT mt.modelo_id
            FROM public.modelo_tecido_variantes mtv
            JOIN public.modelo_tecidos mt ON mt.id = mtv.modelo_tecido_id
           WHERE mtv.variante_tecido_id = NEW.id
          UNION
          SELECT l.modelo_id
            FROM public.modelo_tecido_oc_links l
           WHERE l.variante_tecido_id = NEW.id) u
    JOIN public.modelos m ON m.id = u.modelo_id AND m.tenant_id = NEW.tenant_id;
  PERFORM public._custo_enfileirar(v_ids, true);
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_custo_fila_cad_del() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_custo_fila_variante_tecido() FROM PUBLIC, anon, authenticated;

-- gatilhos POR ULTIMO (cria se falta - sem DROP; a guarda ja garantiu que, se existe, e o deste arquivo e esta ligado)
DO $gatilhos$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custo_fila_del' AND tgrelid = to_regclass('public.cad')) THEN
    CREATE TRIGGER trg_custo_fila_del
      AFTER DELETE ON public.cad
      REFERENCING OLD TABLE AS antigas
      FOR EACH STATEMENT EXECUTE FUNCTION public.fn_custo_fila_cad_del();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custo_fila_upd' AND tgrelid = to_regclass('public.variantes_tecido')) THEN
    CREATE TRIGGER trg_custo_fila_upd
      AFTER UPDATE OF artigo_id ON public.variantes_tecido
      FOR EACH ROW WHEN (OLD.artigo_id IS DISTINCT FROM NEW.artigo_id)
      EXECUTE FUNCTION public.fn_custo_fila_variante_tecido();
  END IF;
END $gatilhos$;

DO $pos$
DECLARE
  r record;
  v_set text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_custo_fila_cad_del()', '7a98464376a1e4f60a1dc4da83bec516'),
      ('public.fn_custo_fila_variante_tecido()', '5a57e42a4b3595c2889e85c1c2823b0e'),
      ('public._custo_enfileirar(uuid[],boolean)', 'af8976a493758423d267325156f14633'),
      ('public.fn_custo_fila_cad()', '382a1d5e86635d0bf9d2a114ca0b0a97'),
      ('public.fn_custo_processar_fila()', 'e401fe02e63efee355a59f9f58c399ad')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l5: pos-condicao falhou - % nao ficou com o texto esperado', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- inv. #9: funcao de gatilho sem EXECUTE para PUBLIC/anon/authenticated
  FOR r IN SELECT * FROM (VALUES ('public.fn_custo_fila_cad_del()'), ('public.fn_custo_fila_variante_tecido()')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l5: % ficou executavel por PUBLIC/anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('cad', 'trg_custo_fila_del', '10:cbaa238a6081b7c9753a574addb79ee7',
       'CREATE TRIGGER trg_custo_fila_del AFTER DELETE ON public.cad REFERENCING OLD TABLE AS antigas FOR EACH STATEMENT EXECUTE FUNCTION fn_custo_fila_cad_del()'),
      ('variantes_tecido', 'trg_custo_fila_upd', '5:73280f59db22184fa890cb9b0e60ba6c',
       'CREATE TRIGGER trg_custo_fila_upd AFTER UPDATE OF artigo_id ON public.variantes_tecido FOR EACH ROW WHEN ((old.artigo_id IS DISTINCT FROM new.artigo_id)) EXECUTE FUNCTION fn_custo_fila_variante_tecido()')
    ) v(tab, nome, depois, def) LOOP
    IF (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgname = r.nome
          AND t.tgrelid = to_regclass('public.' || r.tab) AND t.tgenabled = 'O') IS DISTINCT FROM r.def THEN
      RAISE EXCEPTION 'leves_l5: gatilho % de % ausente, desligado ou diferente', r.nome, r.tab USING ERRCODE = 'P0001';
    END IF;
    SELECT count(t.oid)::text || ':' || md5(coalesce(string_agg(t.tgname || ':' || t.tgenabled::text || ':' || md5(pg_get_triggerdef(t.oid)), '|' ORDER BY t.tgname), ''))
      INTO v_set FROM pg_trigger t WHERE t.tgrelid = to_regclass('public.' || r.tab) AND NOT t.tgisinternal;
    IF v_set IS DISTINCT FROM r.depois THEN
      RAISE EXCEPTION 'leves_l5: pos-condicao falhou - gatilhos de % = % (esperado %)', r.tab, v_set, r.depois USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
