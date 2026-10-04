-- Inverso NEUTRO de supabase/migrations/20261103130000_mod_reprovado_check.sql (e da 20261103131000, que nao tem inverso proprio).
-- Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md (§0 M11, §6 T4, §13.3). Escrito a mao.
-- NO-OP DOCUMENTADO: constraint nao tem forma "neutra" sem DDL (e DDL em modelos pega AccessExclusive). O CHECK e o helper
-- _modelo_eh_reprovado FICAM: sao inofensivos (o dado e o front ja usam so minusculas; nenhuma funcao antiga cita o helper).
-- Este arquivo so confere o estado (guarda) e avisa por NOTICE. Para REMOVER de fato: o _down_drop, em horario calmo.
-- Sem trava de tabela, sem DROP. Mantem a forma de todo _down do kit (LIFO: depois do _down da T5, antes do da T3).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '10s';

DO $guarda$
DECLARE
  r record;
  v text;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public._modelo_eh_reprovado(text,text)')));
  IF v IS NOT NULL AND v <> 'aa2a5c1672a70f0316660cb3c5f86f23' THEN
    RAISE EXCEPTION 'mod4_down: _modelo_eh_reprovado com texto inesperado (md5 %) - outra frente mexeu', v USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('modelos_status_dev_normalizado_chk', '((status_desenvolvimento)::text = lower(btrim((status_desenvolvimento)::text)))'),
      ('modelos_status_plan_normalizado_chk', '((status_planejamento)::text = lower(btrim((status_planejamento)::text)))')
    ) AS x(nome, expr) LOOP
    SELECT pg_get_expr(k.conbin, k.conrelid) INTO v
      FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass AND k.conname = r.nome;
    IF FOUND AND v IS DISTINCT FROM r.expr THEN
      RAISE EXCEPTION 'mod4_down: % com outra definicao (%) - outra frente mexeu', r.nome, v USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  RAISE NOTICE 'mod4_down: nada a desfazer - o CHECK e o helper _modelo_eh_reprovado ficam; para remover use o _down_drop (horario calmo)';
END
$guarda$;

COMMIT;
