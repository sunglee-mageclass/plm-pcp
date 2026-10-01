-- INVERSO (passo 1 de 2) de supabase/migrations/20261028120000_completar_falta_extensoes.sql (achados LEVES L6).
-- Devolve o _reverter_ajuste_estoque_core de ANTES (so apaga a baixa de ajuste, sem completar) e NEUTRALIZA:
--   fn_completar_deficit_corte_artigo -> RETURN NULL (trg_deficit_corte_item_artigo/trg_deficit_corte_artigo_rend continuam
--   existindo mas nao fazem nada) e reprocessar_faltas_corte -> recusa P0001 sem gravar (o botao do site, se ainda no ar,
--   mostra a recusa). Sem DROP: so CREATE OR REPLACE, sem trava de tabela, qualquer hora (freio de emergencia). O DROP vem
--   no _down_drop (SEPARADO, opcional, horario calmo). Baixas ja completadas ficam no ledger (como as de um corte).
-- Guarda: so roda se as 3 funcoes estao com o texto da ida e o helper/funcao de gatilho da R15a seguem com o texto
-- conferido; outro -> P0001 (rodar 2x = a 2a recusa).
-- LIFO: o PRIMEIRO inverso da L6 (antes do 20261028110000_down e do 20261028100000_down) e antes dos inversos da R15a.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v_md5 text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._reverter_ajuste_estoque_core(uuid)',            '09119cbb6fc8e61eb3b0aec4ff733837'),
      ('public.fn_completar_deficit_corte_artigo()',            'af51f60dffd8efa23dbce971a0c8d422'),
      ('public.reprocessar_faltas_corte(uuid)',                 'efb67823cc9961bd7b107debb4cd8b66'),
      ('public._completar_deficit_corte_variante(uuid,uuid)',   '70a91eef1ac40cce86ff7da8e6b14c7f')) v(s, m) LOOP
    IF to_regprocedure(r.s) IS NULL THEN
      RAISE EXCEPTION 'leves_l6_falta (volta): % nao existe - nada a desfazer', r.s USING ERRCODE = 'P0001';
    END IF;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(r.s)));
    IF v_md5 IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l6_falta (volta): % nao esta com o texto da 20261028120000 (md5 %) - nada a desfazer ou outra frente mexeu', r.s, v_md5
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
DECLARE v_tenant uuid := public.get_user_tenant_id();
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Sem tenant'; END IF;
  DELETE FROM public.estoque_tecido_baixas
  WHERE id = _baixa_id AND tenant_id = v_tenant AND origem = 'ajuste';
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_completar_deficit_corte_artigo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [leves L6, B-R2] NEUTRALIZADA pela volta (20261028120000_completar_falta_extensoes_down.sql): os gatilhos adiados
-- trg_deficit_corte_item_artigo/trg_deficit_corte_artigo_rend continuam existindo mas nao fazem nada. DROP so no _down_drop.
BEGIN
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
-- [leves L6, B-R1] NEUTRALIZADA pela volta (20261028120000_completar_falta_extensoes_down.sql): recusa sem gravar nada.
-- DROP so no _down_drop.
BEGIN
  RAISE EXCEPTION 'reprocessar_faltas_corte desativado (volta da L6)' USING ERRCODE = 'P0001';
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.reprocessar_faltas_corte(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reprocessar_faltas_corte(uuid) TO authenticated;

DO $pos$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public._reverter_ajuste_estoque_core(uuid)',  'f8390723d3c71be34a43e1d19209e480'),
      ('public.fn_completar_deficit_corte_artigo()',  '7e4b933c428ae140c239b7ad6c798019'),
      ('public.reprocessar_faltas_corte(uuid)',       'cc00b41f5ad93b4e3ba03a5cdb4e6edf')) v(s, m) LOOP
    IF md5(pg_get_functiondef(to_regprocedure(r.s))) IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'leves_l6_falta (volta): pos-condicao falhou - % nao ficou com o texto esperado (md5 %)', r.s,
        md5(pg_get_functiondef(to_regprocedure(r.s))) USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES ('public._reverter_ajuste_estoque_core(uuid)'),
                                 ('public.fn_completar_deficit_corte_artigo()')) v(s) LOOP
    IF has_function_privilege('anon', to_regprocedure(r.s), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure(r.s), 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.s) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'leves_l6_falta (volta): % ficou executavel por PUBLIC/anon/authenticated (inv. #9)', r.s USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF has_function_privilege('anon', to_regprocedure('public.reprocessar_faltas_corte(uuid)'), 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.reprocessar_faltas_corte(uuid)') AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'leves_l6_falta (volta): reprocessar_faltas_corte executavel por anon/PUBLIC' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
