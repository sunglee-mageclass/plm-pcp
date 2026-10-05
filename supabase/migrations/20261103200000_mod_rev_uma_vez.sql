-- Modularidade T5 — rev do card sobe UMA vez por transacao (Parte 14 / medios D-2). GERADO por .superpowers/sdd/2026-10-04-modularidade/mig/gerar-mod5.mjs (nunca editar à mão).
-- Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md (§12 T5, §13, Ruling R1: bloco PROPRIO, ULTIMO do kit unico).
-- O que muda (troca de texto EXATA sobre o texto vivo; nada mais nas 2 funcoes de gatilho):
--   fn_colab_bump_modelo (7 gatilhos trg_colab_bump: modelo_aviamentos/_etiquetas/_grades/_observacoes/_prova_comentarios/
--     _tecido_oc_links/_tecidos) e fn_colab_bump_modelo_via_tecido (trg_colab_bump de modelo_tecido_variantes): o
--     'update modelos set id = id' (que soma 1 ao rev pelo fn_colab_touch_rev) ganha 'and xmin <> pg_current_xact_id()::xid'
--     -> a linha do card ja escrita por ESTA transacao (pelo proprio Salvar ou por um bump anterior) nao e tocada de novo.
--     Antes: 1 Salvar do BOM = 1 bump por linha apagada/inserida (~70 no card de teste; dezenas de avisos no canal
--     Realtime das telas colaborativas). Depois: +1 por transacao (o processador adiado do custo/kanban no COMMIT pode
--     somar +1 se de fato mudar o card). O P0409 segue igual: toda transacao que escreve uma filha de card existente sobe
--     o rev >= 1 (a linha so e pulada se JA foi escrita nesta transacao, e todo UPDATE de modelos soma 1).
-- Gatilhos, ACL, SECURITY DEFINER e search_path ficam iguais (guarda/pos-condicao). Nenhum objeto novo (sem _down_drop).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_colab_bump_modelo()  [P14 (plano §12)]
--     ANTES  76faacb20914225261b543c3a6522c8a
--     DEPOIS b6710e04db96e2a14b34d13ac02ca262
--   public.fn_colab_bump_modelo_via_tecido()  [P14 (desvio: variantes do tecido)]
--     ANTES  b259fa426ff19086c4ff5e8cf650ebcd
--     DEPOIS 6287bff3596e0920cbe2bef4521339a6
--   dependencias fixadas: public._custo_enfileirar(uuid[],boolean) = af8976a493758423d267325156f14633; public.fn_colab_touch_rev() = 292f1a1077df1e08fdca7f21eb0d856c
-- ====================================================================================
-- Trava: so catalogo (CREATE OR REPLACE FUNCTION de 2 funcoes de gatilho): nenhuma tabela (os gatilhos NAO sao recriados),
-- nada de auth/storage/realtime. Sem DROP, sem CREATE/DROP TRIGGER/POLICY. Idempotente (a guarda aceita antes OU depois).
-- Volta: supabase/rollback/20261103200000_mod_rev_uma_vez_down.sql (LIFO: e o PRIMEIRO inverso do kit - antes de 20261103130000_down - e antes de
-- qualquer inverso antigo que guarde estas funcoes por md5: S1 20261031130000_down (ACL) e o custo-servidor 20261019300000
-- (dependencia fixada); ver md5-mod5.txt).
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
      RAISE EXCEPTION 'mod5_rev_uma_vez: % com texto inesperado (md5 %) - outra frente mexeu; gere de novo', r.f, coalesce(v, 'ausente')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('public._custo_enfileirar(uuid[],boolean)', 'af8976a493758423d267325156f14633'),
      ('public.fn_colab_touch_rev()', '292f1a1077df1e08fdca7f21eb0d856c')
    ) AS x(f, m) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'mod5_rev_uma_vez: dependencia % com texto inesperado (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- premissa: todo UPDATE de modelos soma 1 ao rev (trg_colab_rev BEFORE UPDATE FOR EACH ROW, ligado)
  IF NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = 'public.modelos'::regclass AND g.tgname = 'trg_colab_rev'
                   AND g.tgfoid = 'public.fn_colab_touch_rev()'::regprocedure AND g.tgenabled = 'O' AND g.tgattr::text = ''
                   AND (g.tgtype & 1) = 1 AND (g.tgtype & 2) = 2 AND (g.tgtype & 16) = 16 AND g.tgqual IS NULL) THEN
    RAISE EXCEPTION 'mod5_rev_uma_vez: trg_colab_rev de modelos ausente ou diferente (premissa do rev)' USING ERRCODE = 'P0001';
  END IF;
  -- os gatilhos que chamam as 2 funcoes sao os de hoje (AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW, ligados)
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_colab_bump_modelo()', 'modelo_aviamentos,modelo_etiquetas,modelo_grades,modelo_observacoes,modelo_prova_comentarios,modelo_tecido_oc_links,modelo_tecidos'),
      ('public.fn_colab_bump_modelo_via_tecido()', 'modelo_tecido_variantes')
    ) AS x(f, ts) LOOP
    SELECT string_agg(c.relname, ',' ORDER BY c.relname) INTO v
      FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
     WHERE NOT g.tgisinternal AND g.tgfoid = to_regprocedure(r.f) AND g.tgname = 'trg_colab_bump' AND g.tgenabled = 'O'
       AND (g.tgtype & 1) = 1 AND (g.tgtype & 2) = 0 AND (g.tgtype & 28) = 28 AND c.relnamespace = 'public'::regnamespace;
    IF v IS DISTINCT FROM r.ts THEN
      RAISE EXCEPTION 'mod5_rev_uma_vez: gatilhos de % = % (esperado %)', r.f, coalesce(v, 'nenhum'), r.ts USING ERRCODE = 'P0001';
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
begin
  -- [modularidade P14 / medios D-2] o rev sobe UMA vez por transacao: a linha de modelos ja escrita por ESTA transacao
  -- (xmin = xid atual) nao e tocada de novo. Mesmo idioma de _custo_enfileirar/_kanban_enfileirar. Linha escrita dentro
  -- de SAVEPOINT/bloco EXCEPTION tem o xid da subtransacao: ali o bump segue por linha (como antes da T5), aceito.
  update public.modelos set id = id where id = v_id and xmin <> pg_current_xact_id()::xid;
  return coalesce(new, old);
end $function$;

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
  -- [modularidade P14 / medios D-2] o rev sobe UMA vez por transacao: a linha de modelos ja escrita por ESTA transacao
  -- (xmin = xid atual) nao e tocada de novo. Mesmo idioma de _custo_enfileirar/_kanban_enfileirar. Linha escrita dentro
  -- de SAVEPOINT/bloco EXCEPTION tem o xid da subtransacao: ali o bump segue por linha (como antes da T5), aceito.
  if v_id is not null then update public.modelos set id = id where id = v_id and xmin <> pg_current_xact_id()::xid; end if;
  return coalesce(new, old);
end $function$;

DO $pos$
DECLARE
  r record;
  v text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('public.fn_colab_bump_modelo()', 'b6710e04db96e2a14b34d13ac02ca262', '{postgres=X/postgres,service_role=X/postgres}'),
      ('public.fn_colab_bump_modelo_via_tecido()', '6287bff3596e0920cbe2bef4521339a6', '{postgres=X/postgres,service_role=X/postgres}')
    ) AS x(f, m, acl) LOOP
    v := md5(pg_get_functiondef(to_regprocedure(r.f)));
    IF v IS DISTINCT FROM r.m THEN
      RAISE EXCEPTION 'mod5_rev_uma_vez: pos-condicao falhou em % (md5 %, esperado %)', r.f, coalesce(v, 'ausente'), r.m USING ERRCODE = 'P0001';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f) AND coalesce(p.proacl::text, '') = r.acl
                     AND p.prosecdef AND p.proconfig = ARRAY['search_path=public'])
       OR has_function_privilege('anon', r.f, 'EXECUTE')
       OR has_function_privilege('authenticated', r.f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   WHERE p.oid = to_regprocedure(r.f) AND x.grantee = 0) THEN
      RAISE EXCEPTION 'mod5_rev_uma_vez: pos-condicao falhou na ACL/secdef/search_path de %', r.f USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
