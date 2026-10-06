-- DROP opcional de supabase/migrations/20261103199000_urg_r11_mini_tabelas.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-d.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 1 / R11a; Rulings 1-3, 12-14) + spec-r9.md (secao R11).
-- Rodar SO depois do _down (funcao de imutabilidade no texto neutro), com o SITE ja voltado e os _down/_down_drop da 199400..199200
-- ja rodados, em HORARIO CALMO. RECUSA: sem SET app.confirmo_apagar_baixas_peca_teste = 'sim'; com qualquer funcao de public
-- (fora a de gatilho daqui) citando modelo_peca_teste_mini/estoque_peca_teste_baixas; com view dependendo delas; com o _down
-- nao rodado. Copia TODAS as linhas das 3 tabelas para public._bkp_r11_mini_drop (RLS sem policy + REVOKE ALL; contagem
-- conferida) e apaga as 3 tabelas (com os gatilhos) e a funcao. Idempotente (2a vez so confere).
-- Trava (MEDIDA, mesma receita; ~19 ms): AccessExclusive nas 3 tabelas (LOCK antes da copia) e nas 9 REFERENCIADAS pelas FKs
-- (tenants, modelos, modelo_peca_teste_tentativas, variantes_tecido, variantes_aviamento, ocs_tecido_itens, aviamentos, etiquetas,
-- cores: o DROP TABLE tira os gatilhos de FK delas) - ate a LEITURA delas espera os ms. NENHUMA trava em auth/storage/realtime
-- (sem DROP TRIGGER explicito). SITE VOLTADO, HORARIO CALMO, transacao curtissima; 55P03 = nada mudou, rodar de novo.
-- Exemplo: psql -v ON_ERROR_STOP=1 -c "SET app.confirmo_apagar_baixas_peca_teste = 'sim'" -f supabase/rollback/20261103199000_urg_r11_mini_tabelas_down_drop.sql
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
  IF coalesce(current_setting('app.confirmo_apagar_baixas_peca_teste', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'urg_r11a_down_drop: falta SET app.confirmo_apagar_baixas_peca_teste = ''sim'' (apaga as minis e as baixas de peca teste; copia em public._bkp_r11_mini_drop)'
      USING ERRCODE = 'P0001';
  END IF;
  -- o _down ja rodou: a funcao (se existe) no NEUTRO
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_estoque_peca_teste_imutavel()', '2ccebd01b91760521b76d04f299f97d2')
    ) AS x(f, n) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NOT NULL AND v <> r.n THEN
      RAISE EXCEPTION 'urg_r11a_down_drop: % nao esta no texto neutro (md5 %) - rode o 20261103199000_down antes', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- nenhuma OUTRA funcao de public cita as tabelas (199200..199400 vivas: rode os _down/_down_drop delas antes)
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.oid NOT IN (coalesce(to_regprocedure('public.fn_estoque_peca_teste_imutavel()'), 0::oid))
     AND p.prosrc ~ '(modelo_peca_teste_mini|estoque_peca_teste_baixas)';
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r11a_down_drop: funcoes ainda citam as tabelas da mini: % - rode os _down/_down_drop delas antes', v
      USING ERRCODE = 'P0001';
  END IF;
  -- nenhuma view depende das tabelas
  SELECT string_agg(DISTINCT w.ev_class::regclass::text, ', ') INTO v
    FROM pg_depend d JOIN pg_rewrite w ON w.oid = d.objid AND d.classid = 'pg_rewrite'::regclass
   WHERE d.refobjid IN (SELECT to_regclass(x) FROM (VALUES ('public.modelo_peca_teste_mini'), ('public.modelo_peca_teste_mini_linhas'), ('public.estoque_peca_teste_baixas')) AS t(x))
     AND w.ev_class NOT IN (SELECT coalesce(to_regclass(x), 0::oid) FROM (VALUES ('public.modelo_peca_teste_mini'), ('public.modelo_peca_teste_mini_linhas'), ('public.estoque_peca_teste_baixas')) AS t(x));
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r11a_down_drop: views ainda dependem das tabelas da mini: %', v USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

-- backup (a UNICA copia depois do DROP): 1 linha por registro das 3 tabelas, jsonb inteiro
CREATE TABLE IF NOT EXISTS public._bkp_r11_mini_drop (
  tabela text NOT NULL,
  registro_id uuid,
  dados jsonb NOT NULL,
  copiado_em timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public._bkp_r11_mini_drop IS
  'Backup do _down_drop da urg R11a (20261103199000): minis, linhas e baixas de peca teste apagadas (jsonb da linha). So o dono le. Nao apagar.';
ALTER TABLE public._bkp_r11_mini_drop ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._bkp_r11_mini_drop FROM PUBLIC, anon, authenticated, service_role;

DO $copia$
DECLARE
  v_n integer;
  v_tot integer := 0;
  v_c integer;
BEGIN
  IF to_regclass('public.modelo_peca_teste_mini') IS NULL AND to_regclass('public.modelo_peca_teste_mini_linhas') IS NULL AND to_regclass('public.estoque_peca_teste_baixas') IS NULL THEN
    RAISE NOTICE 'urg_r11a_down_drop: as tabelas da mini ja nao existem - nada a copiar';
    RETURN;
  END IF;
  -- trava as 3 ANTES de copiar: nenhuma linha nova entre a copia e o DROP
  LOCK TABLE public.modelo_peca_teste_mini, public.modelo_peca_teste_mini_linhas, public.estoque_peca_teste_baixas IN ACCESS EXCLUSIVE MODE;
  INSERT INTO public._bkp_r11_mini_drop (tabela, registro_id, dados)
    SELECT 'modelo_peca_teste_mini', x.tentativa_id, to_jsonb(x) FROM public.modelo_peca_teste_mini x;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_tot := v_tot + v_n;
  INSERT INTO public._bkp_r11_mini_drop (tabela, registro_id, dados)
    SELECT 'modelo_peca_teste_mini_linhas', x.id, to_jsonb(x) FROM public.modelo_peca_teste_mini_linhas x;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_tot := v_tot + v_n;
  INSERT INTO public._bkp_r11_mini_drop (tabela, registro_id, dados)
    SELECT 'estoque_peca_teste_baixas', x.id, to_jsonb(x) FROM public.estoque_peca_teste_baixas x;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_tot := v_tot + v_n;
  SELECT (SELECT count(*)::int FROM public.modelo_peca_teste_mini) + (SELECT count(*)::int FROM public.modelo_peca_teste_mini_linhas) + (SELECT count(*)::int FROM public.estoque_peca_teste_baixas) INTO v_c;
  IF v_tot <> v_c OR (SELECT count(*) FROM public._bkp_r11_mini_drop WHERE copiado_em = now()) <> v_c THEN
    RAISE EXCEPTION 'urg_r11a_down_drop: backup nao confere (% copiadas, % nas tabelas)', v_tot, v_c USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'urg_r11a_down_drop: % registro(s) copiado(s) para public._bkp_r11_mini_drop', v_tot;
END
$copia$;

DROP TABLE IF EXISTS public.estoque_peca_teste_baixas;
DROP TABLE IF EXISTS public.modelo_peca_teste_mini_linhas;
DROP TABLE IF EXISTS public.modelo_peca_teste_mini;
DROP FUNCTION IF EXISTS public.fn_estoque_peca_teste_imutavel();

DO $pos$
BEGIN
  IF to_regclass('public.modelo_peca_teste_mini') IS NOT NULL
     OR to_regclass('public.modelo_peca_teste_mini_linhas') IS NOT NULL
     OR to_regclass('public.estoque_peca_teste_baixas') IS NOT NULL
     OR to_regprocedure('public.fn_estoque_peca_teste_imutavel()') IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r11a_down_drop: pos-condicao falhou (tabelas/funcao ainda existem)' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass('public._bkp_r11_mini_drop') AND c.relrowsecurity)
     OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = to_regclass('public._bkp_r11_mini_drop'))
     OR has_table_privilege('anon', 'public._bkp_r11_mini_drop', 'SELECT') OR has_table_privilege('authenticated', 'public._bkp_r11_mini_drop', 'SELECT') THEN
    RAISE EXCEPTION 'urg_r11a_down_drop: backup legivel por anon/authenticated' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
