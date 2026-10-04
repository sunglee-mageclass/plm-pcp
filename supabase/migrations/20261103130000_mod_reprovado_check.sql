-- Modularidade T4 (Parte 13, X2): "reprovado" com UMA regra so. Escrito a mao (so objetos NOVOS; nenhuma funcao existente e
-- redefinida). Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md (§0 M11, §6 T4, §13); desenho.md (Parte 13, T7).
-- (1) helper public._modelo_eh_reprovado(sd, sp) = _kanban_norm(sd)='reprovado' OR _kanban_norm(sp)='reprovado' (sql IMMUTABLE,
--     INVOKER como o _kanban_norm que ele usa; EXECUTE revogado de PUBLIC/anon/authenticated: so SQL de servidor DEFINER o chama).
-- (2) CHECK NOT VALID em modelos: status_desenvolvimento e status_planejamento = lower(btrim(...)). Com o dado sempre minusculo e
--     sem espaco nas pontas, as 4 grafias que ja existem no SQL ficam EQUIVALENTES sem reescrever as 20+ funcoes guardadas por md5:
--     canonica lower(coalesce(...)) (OTB, dashboards, estoque, Plan. Tecido), _kanban_norm (kanban/REF/Explosao/_integracao_gates),
--     a case-sensitive coalesce(status_planejamento,'')='reprovado' (6 da Integracao: _integracao_base, _integracao_ler,
--     integracao_listar, integracao_marcar, integracao_previa, integracao_gerar_json_ler) e o IS DISTINCT FROM de consumo_por_oc.
--     NOT VALID = so confere linhas NOVAS/alteradas; a validacao das existentes e a 20261103131000 (outra transacao, sem bloquear).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public._modelo_eh_reprovado(text,text) (NOVA)  ANTES ausente  DEPOIS aa2a5c1672a70f0316660cb3c5f86f23
--   public._kanban_norm(text) (dependencia, fixada) 74606b6e06de34fa23fd0642d1ebafbb
--   modelos_status_dev_normalizado_chk / modelos_status_plan_normalizado_chk (NOVAS): ausentes ou com a MESMA expressao.
-- ====================================================================================
-- Trava: ADD CONSTRAINT ... CHECK ... NOT VALID = AccessExclusive em public.modelos (bloqueia leitura e escrita da tabela mais
-- QUENTE) por um instante, ate o COMMIT (sem varrer a tabela). Medido na copia (t4-report.md): so modelos (+ o indice/toast
-- dela), nada em auth/storage/realtime. Pega a trava num sub-bloco em ate 1500ms (> deadlock_timeout: cancela autovacuum);
-- falhou = solta tudo, espera 1s e tenta de novo (ate 3x); depois 55P03 aborta e nada muda. HORARIO CALMO. Arquivo SO dele
-- (Global Constraint 9). Reaplicar com as 2 constraints ja criadas NAO pega trava nenhuma. Sem DROP.
-- A copia NAO tem supautils (producao tem): o efeito dele sobre ALTER TABLE ... ADD CONSTRAINT nao e mensuravel aqui.
-- Front: os status vem de chaves minusculas (STATUS_OPTS, resolveStatusKey/slugify, _kanban_resolve_key/_kanban_slug); quem um
-- dia gravar maiuscula/espaco recebe 23514.
-- Volta: supabase/rollback/20261103130000_mod_reprovado_check_down.sql (no-op documentado: o CHECK e o helper ficam);
-- remover = supabase/rollback/20261103130000_mod_reprovado_check_down_drop.sql (horario calmo). A 131000 nao tem inverso.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
-- 55P03/40P01 = nada mudou; rodar o arquivo de novo.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  r record;
  v text;
  n int;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public._kanban_norm(text)'))) IS DISTINCT FROM '74606b6e06de34fa23fd0642d1ebafbb' THEN
    RAISE EXCEPTION 'mod4_guarda: _kanban_norm ausente ou com texto inesperado - outra frente mexeu' USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public._modelo_eh_reprovado(text,text)')));
  IF v IS NOT NULL AND v <> 'aa2a5c1672a70f0316660cb3c5f86f23' THEN
    RAISE EXCEPTION 'mod4_guarda: _modelo_eh_reprovado com texto inesperado (md5 %) - outra frente mexeu', v USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('modelos_status_dev_normalizado_chk', '((status_desenvolvimento)::text = lower(btrim((status_desenvolvimento)::text)))'),
      ('modelos_status_plan_normalizado_chk', '((status_planejamento)::text = lower(btrim((status_planejamento)::text)))')
    ) AS x(nome, expr) LOOP
    SELECT pg_get_expr(k.conbin, k.conrelid) INTO v
      FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass AND k.conname = r.nome;
    IF FOUND AND (v IS DISTINCT FROM r.expr
                  OR (SELECT k.contype FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass AND k.conname = r.nome) <> 'c') THEN
      RAISE EXCEPTION 'mod4_guarda: % ja existe com outra definicao (%)', r.nome, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  -- pre-condicao do plano: 0 linhas fora do padrao (senao a 131000 nao valida; conferir/limpar ANTES)
  SELECT count(*) INTO n FROM public.modelos m
   WHERE m.status_desenvolvimento IS DISTINCT FROM lower(btrim(m.status_desenvolvimento))
      OR m.status_planejamento IS DISTINCT FROM lower(btrim(m.status_planejamento));
  IF n > 0 THEN
    RAISE EXCEPTION 'mod4_guarda: % modelos com status fora do padrao (maiuscula ou espaco nas pontas) - normalizar antes', n
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public._modelo_eh_reprovado(_sd text, _sp text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
-- [modularidade T4, Parte 13] "reprovado" = Desenvolvimento OU Planejamento, com lower+btrim (= _kanban_norm). SQL NOVO usa
-- este helper. Os CHECK modelos_status_dev/plan_normalizado_chk garantem pelo DADO que as grafias antigas (canonica
-- lower(coalesce()), _kanban_norm, a case-sensitive da Integracao e a de consumo_por_oc) dao o mesmo resultado.
-- ESPELHO de ehReprovadoNoGate (src/lib/reprovado.ts).
  SELECT public._kanban_norm(_sd) = 'reprovado' OR public._kanban_norm(_sp) = 'reprovado';
$function$;

-- auxiliar interno: so SQL de servidor (DEFINER, dono postgres) chama; funcao INVOKER nova nao pode usa-lo (inv. #9: revogar dos 3)
REVOKE EXECUTE ON FUNCTION public._modelo_eh_reprovado(text, text) FROM PUBLIC, anon, authenticated;

-- UMA tentativa ATOMICA por vez: num sub-bloco, LOCK TABLE modelos + os 2 ADD CONSTRAINT. Se a trava nao vier em ate 1500ms
-- ou houver deadlock, o sub-bloco falha e LIBERA a trava antes da pausa de 1s. Ate 3 tentativas; depois, 55P03 aborta.
DO $trava$
DECLARE
  i int;
BEGIN
  -- reaplicar com as 2 ja criadas nao pega trava nenhuma
  IF (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass
        AND k.conname IN ('modelos_status_dev_normalizado_chk', 'modelos_status_plan_normalizado_chk')) = 2 THEN
    RETURN;
  END IF;
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      LOCK TABLE public.modelos IN ACCESS EXCLUSIVE MODE;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass
                      AND k.conname = 'modelos_status_dev_normalizado_chk') THEN
        ALTER TABLE public.modelos ADD CONSTRAINT modelos_status_dev_normalizado_chk
          CHECK (status_desenvolvimento = lower(btrim(status_desenvolvimento))) NOT VALID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass
                      AND k.conname = 'modelos_status_plan_normalizado_chk') THEN
        ALTER TABLE public.modelos ADD CONSTRAINT modelos_status_plan_normalizado_chk
          CHECK (status_planejamento = lower(btrim(status_planejamento))) NOT VALID;
      END IF;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END
$trava$;

DO $pos$
DECLARE
  r record;
  f constant text := 'public._modelo_eh_reprovado(text,text)';
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('modelos_status_dev_normalizado_chk', '((status_desenvolvimento)::text = lower(btrim((status_desenvolvimento)::text)))'),
      ('modelos_status_plan_normalizado_chk', '((status_planejamento)::text = lower(btrim((status_planejamento)::text)))')
    ) AS x(nome, expr) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass AND k.conname = r.nome
                    AND k.contype = 'c' AND pg_get_expr(k.conbin, k.conrelid) = r.expr) THEN
      RAISE EXCEPTION 'mod4_guarda: pos-condicao falhou em %', r.nome USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF md5(pg_get_functiondef(to_regprocedure(f))) IS DISTINCT FROM 'aa2a5c1672a70f0316660cb3c5f86f23' THEN
    RAISE EXCEPTION 'mod4_guarda: pos-condicao falhou em % (md5)', f USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT p.prosecdef OR p.provolatile <> 'i' OR p.proconfig IS DISTINCT FROM ARRAY['search_path=public']
        FROM pg_proc p WHERE p.oid = to_regprocedure(f))
     OR has_function_privilege('anon', f, 'EXECUTE') OR has_function_privilege('authenticated', f, 'EXECUTE')
     OR NOT has_function_privilege('service_role', f, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x WHERE p.oid = to_regprocedure(f) AND x.grantee = 0) THEN
    RAISE EXCEPTION 'mod4_guarda: pos-condicao falhou em % (ACL, volatilidade ou search_path)', f USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

NOTIFY pgrst, 'reload schema';
COMMIT;
