-- Inverso NEUTRO de supabase/migrations/20261103199000_urg_r11_mini_tabelas.sql - GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-d.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 1 / R11a; Rulings 1-3, 12-14) + spec-r9.md (secao R11).
-- NEUTRO: fn_estoque_peca_teste_imutavel vira texto neutro (deixa passar; ACL/DEFINER iguais). Tabelas, gatilhos e dados FICAM
-- (inertes com o site e a 199400 voltados: ninguem escreve a mini; a fila do kanban so enfileiraria recalculos inocuos numa
-- cascata de exclusao de card). So catalogo (CREATE OR REPLACE FUNCTION). Idempotente (2a vez = no-op). Remover de fato =
-- _down_drop (opcional, depois).
-- Trava (MEDIDA, mesma receita): SO catalogo (CREATE OR REPLACE FUNCTION; ~2 ms) - nenhuma trava de tabela. Qualquer hora.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_estoque_peca_teste_imutavel() (NOVA)
--     ANTES  ausente
--     DEPOIS 93911c1c230f910f74c93d3f917e9694
--     NEUTRO 2ccebd01b91760521b76d04f299f97d2 (_down)
--   gatilho audit_modelo_peca_teste_mini ON public.modelo_peca_teste_mini (NOVO)  DEPOIS dde0b197ba997c8aae0f7c99ae6ad14a
--   gatilho trg_peca_teste_mini_fila_ins ON public.modelo_peca_teste_mini (NOVO)  DEPOIS 6571dd0b65bfee002d21e55f417f8974
--   gatilho trg_peca_teste_mini_fila_upd ON public.modelo_peca_teste_mini (NOVO)  DEPOIS 8486b70e4f156a184a786bd72da70ec3
--   gatilho trg_peca_teste_mini_fila_del ON public.modelo_peca_teste_mini (NOVO)  DEPOIS 6d41064613f73fa0bcb40a32d45f605a
--   gatilho audit_modelo_peca_teste_mini_linhas ON public.modelo_peca_teste_mini_linhas (NOVO)  DEPOIS df72813c8c6511550ffe04ce1dd1bf99
--   gatilho audit_estoque_peca_teste_baixas ON public.estoque_peca_teste_baixas (NOVO)  DEPOIS 6243dedd847c92ad0bb61953dee9e94e
--   gatilho trg_estoque_peca_teste_imutavel ON public.estoque_peca_teste_baixas (NOVO)  DEPOIS f5d588d362b15927219c6ff5b794ca42
--   tabela public.modelo_peca_teste_mini (NOVA): colunas c9181cb5fac08e4daba2c96c8ae3a066  constraints 3b09a314200fc9f24eb7eb922e5d18ae  indices c9d112730f35d3896dc70f745349287e
--   tabela public.modelo_peca_teste_mini_linhas (NOVA): colunas 10b62d45bdab517a2ac7336325c50b99  constraints eb28b73db052d4bbe3f9203677b2bb74  indices 1d51dce79b5ed9c003bf5d71e8323c35
--   tabela public.estoque_peca_teste_baixas (NOVA): colunas 920415bc46ab195daf5a7e5576aa27b5  constraints 96726b025b0e0a8c9dc1f05b065d09ef  indices 4e3faf9ec955ab1d794f01030cb4cfc6
--   dependencias FIXADAS (nao redefinidas):
--     public.fn_kanban_fila_por_modelo() 83b837afaaab012d00afc37cea9b3572
--     public.fn_audit() 63e5855f24d17914aef609e35ffc499b
-- ====================================================================================
-- Volta (LIFO): este arquivo DEPOIS dos _down da 199400..199100 e ANTES dos da R9. DROP: supabase/rollback/20261103199000_urg_r11_mini_tabelas_down_drop.sql (opcional).
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
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_estoque_peca_teste_imutavel()', '93911c1c230f910f74c93d3f917e9694', '2ccebd01b91760521b76d04f299f97d2')
    ) AS x(f, d, n) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL THEN
      RAISE EXCEPTION 'urg_r11a_down: % ausente - a 20261103199000 nao foi aplicada aqui (ou o _down_drop ja rodou)', r.f USING ERRCODE = 'P0001';
    END IF;
    IF v NOT IN (r.d, r.n) THEN
      RAISE EXCEPTION 'urg_r11a_down: % com texto inesperado (md5 %) - outra frente mexeu', r.f, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

-- a funcao de gatilho no texto NEUTRO (o gatilho fica, inerte; ACL/DEFINER/search_path preservados)
CREATE OR REPLACE FUNCTION public.fn_estoque_peca_teste_imutavel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- [urg r11a] NEUTRA (_down da 20261103199000): o ledger nao trava mais (site e 199400 voltados; a tabela so e lida/escrita por
  -- postgres/service_role); o gatilho fica, inerte.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_estoque_peca_teste_imutavel()', '93911c1c230f910f74c93d3f917e9694', '2ccebd01b91760521b76d04f299f97d2')
    ) AS x(f, d, n) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.n THEN
      RAISE EXCEPTION 'urg_r11a_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.n USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                     AND p.prosecdef AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'urg_r11a_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
