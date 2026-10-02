-- INVERSO (passo 1 de 2) de supabase/migrations/20261025300000_completar_deficit_corte.sql (achados MEDIOS R15a, P-203 A).
-- NEUTRALIZA a funcao dos gatilhos adiados (fn_completar_deficit_corte -> RETURN NULL): trg_deficit_corte_item_ins,
-- trg_deficit_corte_item_upd e trg_deficit_corte_oc continuam existindo mas nao fazem nada. O helper _completar_deficit_corte_variante fica (sem
-- EXECUTE para ninguem alem do dono). Ele NAO fica sem chamador sozinho: desde a L6 (LEVES 20261028120000) tambem o chamam
-- fn_completar_deficit_corte_artigo (gatilhos trg_deficit_corte_item_artigo/trg_deficit_corte_artigo_rend: troca do artigo do
-- item da OC, rendimento/unidade do artigo), _reverter_ajuste_estoque_core (estorno de "- Metragem") e a RPC
-- reprocessar_faltas_corte; e as _p214_* (so o kit, como postgres). Por isso este arquivo RECUSA enquanto a L6 estiver no
-- banco: o freio de P-203 = _down da L6 (20261028120000_completar_falta_extensoes_down.sql) e DEPOIS este. Sem DROP: so
-- CREATE OR REPLACE, sem trava de tabela, qualquer hora (e o freio de emergencia, com a L6 ja desfeita). O DROP vem no
-- _down_drop (SEPARADO, opcional, horario calmo).
-- Guarda: so roda se a funcao do gatilho esta com o texto da ida (md5 8432f313), o corte segue intocado e a L6 nao esta no
-- banco (fn_completar_deficit_corte_artigo / reprocessar_faltas_corte ausentes ou com o texto NEUTRO do _down da L6, md5
-- 7e4b933c / cc00b41f); outro -> P0001 (rodar 2x = a 2a recusa). Baixas ja completadas ficam no ledger (como as de um corte).
-- Ordem geral: LIFO da APLICACAO (este roda DEPOIS do _down da L6 e do _down da P-214 20261025310000, e ANTES dos inversos
-- 20261025200000 e 20261025100000).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '500ms';
SET LOCAL statement_timeout = '5s';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
BEGIN
  IF to_regprocedure('public.fn_completar_deficit_corte()') IS NULL
     OR md5(pg_get_functiondef(to_regprocedure('public.fn_completar_deficit_corte()'))) IS DISTINCT FROM '8432f313e038796f8776922d604be205' THEN
    RAISE EXCEPTION 'medios_r15a_p203 (volta): fn_completar_deficit_corte nao esta com o texto da 20261025300000 - nada a desfazer ou outra frente mexeu'
      USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._baixar_estoque_tecido_corte_core(uuid)') IS NULL
     OR md5(pg_get_functiondef(to_regprocedure('public._baixar_estoque_tecido_corte_core(uuid)'))) IS DISTINCT FROM '2a6f0ef24da6f9e8b9c68f63e3863577' THEN
    RAISE EXCEPTION 'medios_r15a_p203 (volta): _baixar_estoque_tecido_corte_core mudou - outra frente mexeu' USING ERRCODE = 'P0001';
  END IF;
  -- [revisao final M1] a L6 (LEVES 20261028120000) chama o mesmo helper por 3 caminhos: com ela no ar este freio seria
  -- PARCIAL sem aviso. Recusa ate o _down da L6 deixar as 2 funcoes dela NEUTRAS (ou o _down_drop dela remove-las).
  IF (to_regprocedure('public.fn_completar_deficit_corte_artigo()') IS NOT NULL
      AND md5(pg_get_functiondef(to_regprocedure('public.fn_completar_deficit_corte_artigo()'))) IS DISTINCT FROM '7e4b933c428ae140c239b7ad6c798019')
     OR (to_regprocedure('public.reprocessar_faltas_corte(uuid)') IS NOT NULL
      AND md5(pg_get_functiondef(to_regprocedure('public.reprocessar_faltas_corte(uuid)'))) IS DISTINCT FROM 'cc00b41f5ad93b4e3ba03a5cdb4e6edf') THEN
    RAISE EXCEPTION 'medios_r15a_p203 (volta): a L6 (20261028120000) ainda esta no banco e chama o mesmo helper - rode antes supabase/rollback/20261028120000_completar_falta_extensoes_down.sql'
      USING ERRCODE = 'P0001';
  END IF;
END $guarda$;

CREATE OR REPLACE FUNCTION public.fn_completar_deficit_corte()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [medios R15 P-203 A] NEUTRALIZADA pela volta (20261025300000_completar_deficit_corte_down.sql): os gatilhos adiados
-- trg_deficit_corte_item_ins/_item_upd/_oc continuam existindo mas nao fazem nada. DROP so no _down_drop (separado).
BEGIN
  RETURN NULL;
END
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_completar_deficit_corte() FROM PUBLIC, anon, authenticated;

DO $pos$
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_completar_deficit_corte()'))) IS DISTINCT FROM 'c09fc3f1f011918ea5eb7f11fc8b45e9' THEN
    RAISE EXCEPTION 'medios_r15a_p203 (volta): pos-condicao falhou - a funcao do gatilho nao ficou NEUTRA' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', to_regprocedure('public.fn_completar_deficit_corte()'), 'EXECUTE')
     OR has_function_privilege('authenticated', to_regprocedure('public.fn_completar_deficit_corte()'), 'EXECUTE') THEN
    RAISE EXCEPTION 'medios_r15a_p203 (volta): funcao do gatilho executavel por anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END $pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
