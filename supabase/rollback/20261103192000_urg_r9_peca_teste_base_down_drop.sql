-- DROP opcional de supabase/migrations/20261103192000_urg_r9_peca_teste_base.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-c.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md (Task 1 / R9a; Rulings 1-6, 10, 15, 29, 31) + spec-r9.md.
-- Rodar SO depois do _down (trg_kanban_fila_upd no WHEN de ANTES, as 2 funcoes no texto neutro), com o SITE ja voltado e os
-- _down/_down_drop da 196000..193000 ja rodados, em HORARIO CALMO. RECUSA: sem SET app.confirmo_apagar_peca_teste = 'sim';
-- com qualquer funcao de public (fora as 2 de gatilho) citando modelo_peca_teste_tentativas/exige_peca_teste (193000/194000
-- vivas); com o _down nao rodado. Copia as tentativas para public._bkp_r9_tentativas_drop (RLS sem policy + REVOKE ALL; a
-- contagem e conferida) e apaga: gatilho de trava, tabela (com os gatilhos dela), as 2 funcoes e a coluna exige_peca_teste.
-- Idempotente (2a vez so confere).
-- Trava (MEDIDA, mesma receita; ~25 ms): AccessExclusive em modelo_peca_teste_tentativas (LOCK antes da copia), modelo_servico_mo
-- (DROP TRIGGER), categorias_terceirizado (DROP COLUMN) e nas tabelas referenciadas pelas FKs da tabela dropada (modelos,
-- empresas, tenants) - ate a LEITURA de modelos espera; e o supautils prende 23 tabelas de auth/storage/realtime
-- (auth.users/sessions/refresh_tokens/..., storage.objects/buckets/..., realtime.messages/subscription) ate o COMMIT (= o DROP
-- TRIGGER/TABLE das frentes anteriores). SITE VOLTADO, HORARIO CALMO, transacao curtissima; 55P03 = nada mudou, rodar de novo.
-- Exemplo: psql -v ON_ERROR_STOP=1 -c "SET app.confirmo_apagar_peca_teste = 'sim'" -f supabase/rollback/20261103192000_urg_r9_peca_teste_base_down_drop.sql
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  IF coalesce(current_setting('app.confirmo_apagar_peca_teste', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'urg_r9a_down_drop: falta SET app.confirmo_apagar_peca_teste = ''sim'' (apaga as tentativas lancadas; copia em public._bkp_r9_tentativas_drop)'
      USING ERRCODE = 'P0001';
  END IF;
  -- o _down ja rodou: gatilho redefinido no texto de ANTES (o WHEN nao cita mais a coluna) e as funcoes (se existem) no NEUTRO
  v := (SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
       WHERE t.tgrelid = to_regclass('public.categorias_terceirizado') AND t.tgname = 'trg_kanban_fila_upd' AND NOT t.tgisinternal);
  IF v IS DISTINCT FROM '35a23318e5e44ce6af558686b275115e' THEN
    RAISE EXCEPTION 'urg_r9a_down_drop: gatilho trg_kanban_fila_upd nao esta no texto de ANTES (md5 %) - rode o 20261103192000_down antes', coalesce(v, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_peca_teste_regredir()', '9060f2c49f9ebfb7c5e76d393302fd7c'),
      ('public.fn_peca_teste_trava_fornecedor()', '4b41dd70f4751bd076f6468f2c001c23')
    ) AS x(f, n) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.n THEN
      RAISE EXCEPTION 'urg_r9a_down_drop: % nao esta no texto neutro (md5 %) - rode o 20261103192000_down antes', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- nenhuma OUTRA funcao de public cita a tabela/coluna (193000/194000 vivas: rode os _down/_down_drop delas antes)
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.oid NOT IN (coalesce(to_regprocedure('public.fn_peca_teste_regredir()'), 0::oid), coalesce(to_regprocedure('public.fn_peca_teste_trava_fornecedor()'), 0::oid))
     AND p.prosrc ~ '(modelo_peca_teste_tentativas|exige_peca_teste)';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r9a_down_drop: funcoes ainda citam modelo_peca_teste_tentativas/exige_peca_teste: % - rode os _down/_down_drop delas antes', v
      USING ERRCODE = 'P0001';
  END IF;
  -- nenhuma view depende da tabela nem da coluna
  SELECT string_agg(DISTINCT w.ev_class::regclass::text, ', ') INTO v
    FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
   WHERE (d.refobjid = to_regclass('public.modelo_peca_teste_tentativas') AND w.ev_class <> to_regclass('public.modelo_peca_teste_tentativas'))
      OR (d.refobjid = to_regclass('public.categorias_terceirizado') AND d.refobjsubid =
          (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = to_regclass('public.categorias_terceirizado') AND a.attname = 'exige_peca_teste'));
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r9a_down_drop: views ainda dependem de modelo_peca_teste_tentativas/exige_peca_teste: %', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- backup das tentativas (a UNICA copia do historico depois do DROP): 1 linha por tentativa, jsonb inteiro
CREATE TABLE IF NOT EXISTS public._bkp_r9_tentativas_drop (
  tentativa_id uuid,
  dados jsonb NOT NULL,
  copiado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public._bkp_r9_tentativas_drop IS
  'Backup do _down_drop da urg R9a (20261103192000): tentativas de peca teste apagadas (jsonb da linha). So o dono le. Nao apagar.';
ALTER TABLE public._bkp_r9_tentativas_drop ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_r9_tentativas_drop FROM PUBLIC, anon, authenticated, service_role;

DO $copia$
DECLARE
  v_n integer;
  v_c integer;
BEGIN
  IF to_regclass('public.modelo_peca_teste_tentativas') IS NULL THEN
    RAISE NOTICE 'urg_r9a_down_drop: public.modelo_peca_teste_tentativas ja nao existe - nada a copiar';
    RETURN;
  END IF;
  -- trava a tabela ANTES de copiar: nenhuma tentativa nova entre a copia e o DROP
  LOCK TABLE public.modelo_peca_teste_tentativas IN ACCESS EXCLUSIVE MODE;
  INSERT INTO public._bkp_r9_tentativas_drop (tentativa_id, dados) SELECT t.id, to_jsonb(t) FROM public.modelo_peca_teste_tentativas t ORDER BY t.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  SELECT count(*) INTO v_c FROM public.modelo_peca_teste_tentativas;
  IF v_n <> v_c OR (SELECT count(*) FROM public._bkp_r9_tentativas_drop WHERE copiado_em = now()) <> v_c THEN
    RAISE EXCEPTION 'urg_r9a_down_drop: backup nao confere (% copiadas, % na tabela)', v_n, v_c USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'urg_r9a_down_drop: % tentativa(s) copiada(s) para public._bkp_r9_tentativas_drop', v_n;
END
$copia$;

DROP TRIGGER IF EXISTS trg_peca_teste_trava_fornecedor ON public.modelo_servico_mo;
DROP TABLE IF EXISTS public.modelo_peca_teste_tentativas;
DROP FUNCTION IF EXISTS public.fn_peca_teste_regredir();
DROP FUNCTION IF EXISTS public.fn_peca_teste_trava_fornecedor();
ALTER TABLE public.categorias_terceirizado DROP COLUMN IF EXISTS exige_peca_teste;

DO $pos$
BEGIN
  IF to_regclass('public.modelo_peca_teste_tentativas') IS NOT NULL
     OR to_regprocedure('public.fn_peca_teste_regredir()') IS NOT NULL
     OR to_regprocedure('public.fn_peca_teste_trava_fornecedor()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'trg_peca_teste_trava_fornecedor')
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'categorias_terceirizado'
                AND column_name = 'exige_peca_teste') THEN
    RAISE EXCEPTION 'urg_r9a_down_drop: pos-condicao falhou (tabela/funcoes/gatilho/coluna ainda existem)' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
       WHERE t.tgrelid = to_regclass('public.categorias_terceirizado') AND t.tgname = 'trg_kanban_fila_upd' AND NOT t.tgisinternal) IS DISTINCT FROM '35a23318e5e44ce6af558686b275115e' THEN
    RAISE EXCEPTION 'urg_r9a_down_drop: pos-condicao falhou no gatilho trg_kanban_fila_upd' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public._bkp_r9_tentativas_drop') AND c.relrowsecurity)
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass('public._bkp_r9_tentativas_drop'))
     OR has_table_privilege('anon', 'public._bkp_r9_tentativas_drop', 'SELECT') OR has_table_privilege('authenticated', 'public._bkp_r9_tentativas_drop', 'SELECT') THEN
    RAISE EXCEPTION 'urg_r9a_down_drop: backup legivel por anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
