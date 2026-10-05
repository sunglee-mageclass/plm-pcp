-- Inverso de supabase/migrations/20261103200000_mod_rev_uma_vez.sql — GERADO por .superpowers/sdd/2026-10-04-modularidade/mig/gerar-mod5.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md (§12 T5, §13, Ruling R1: bloco PROPRIO, ULTIMO do kit unico).
-- NEUTRO: devolve os 2 textos de ANTES (md5 conferido) = o bump volta a ser por linha. Sem DROP.
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_colab_bump_modelo()  [P14 (plano §12)]
--     ANTES  76faacb20914225261b543c3a6522c8a
--     DEPOIS b6710e04db96e2a14b34d13ac02ca262
--   public.fn_colab_bump_modelo_via_tecido()  [P14 (desvio: variantes do tecido)]
--     ANTES  b259fa426ff19086c4ff5e8cf650ebcd
--     DEPOIS 6287bff3596e0920cbe2bef4521339a6
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION de 2 funcoes de gatilho): nenhuma tabela (os gatilhos NAO sao recriados),
-- nada de auth/storage/realtime. Sem DROP, sem CREATE/DROP TRIGGER/POLICY. Idempotente (a guarda aceita antes OU depois).
-- 55P03/40P01 = nada mudou; rodar o arquivo de novo.
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
      ('public.fn_colab_bump_modelo()', '76faacb20914225261b543c3a6522c8a', 'b6710e04db96e2a14b34d13ac02ca262'),
      ('public.fn_colab_bump_modelo_via_tecido()', 'b259fa426ff19086c4ff5e8cf650ebcd', '6287bff3596e0920cbe2bef4521339a6')
    ) AS x(f, a, b) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS NULL OR v NOT IN (r.a, r.b) THEN
      RAISE EXCEPTION 'mod5_rev_uma_vez_down: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_modelo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid := coalesce(new.modelo_id, old.modelo_id);
begin update public.modelos set id = id where id = v_id; return coalesce(new, old); end $function$;

CREATE OR REPLACE FUNCTION public.fn_colab_bump_modelo_via_tecido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  select mt.modelo_id into v_id from public.modelo_tecidos mt
   where mt.id = coalesce(new.modelo_tecido_id, old.modelo_tecido_id);
  if v_id is not null then update public.modelos set id = id where id = v_id; end if;
  return coalesce(new, old);
end $function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_colab_bump_modelo()', '76faacb20914225261b543c3a6522c8a', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public.fn_colab_bump_modelo_via_tecido()', 'b259fa426ff19086c4ff5e8cf650ebcd', '{postgres=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'mod5_rev_uma_vez_down: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND p.proconfig = ARRAY['search_path=public'])
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'mod5_rev_uma_vez_down: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
