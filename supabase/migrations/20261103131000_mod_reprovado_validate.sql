-- Modularidade T4 (Parte 13, X2), passo 2 de 2: VALIDATE dos 2 CHECK criados NOT VALID pela 20261103130000. Escrito a mao.
-- Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md (§0 M11, §6 T4, §13).
-- Trava: VALIDATE CONSTRAINT = ShareUpdateExclusive em public.modelos (NAO bloqueia leitura nem escrita; conflita so com
-- VACUUM/ANALYZE/outro DDL) + varredura da tabela; medido na copia (t4-report.md). Nada em auth/storage/realtime. Mesmo
-- padrao de 3 tentativas de 1500ms (cancela autovacuum, que cede a trava depois do deadlock_timeout). Ja validada = nada a fazer
-- (sem trava). Nao muda dado nenhum, por isso NAO tem inverso: o _down_drop da 130000 remove o CHECK inteiro.
-- Pre-condicao: a 130000 aplicada e 0 linhas fora do padrao (a guarda diz quantas, em vez do 23514 cru do VALIDATE).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
-- 55P03/40P01 = nada mudou; rodar o arquivo de novo.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '60s';

DO $guarda$
DECLARE
  r record;
  n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('modelos_status_dev_normalizado_chk', '((status_desenvolvimento)::text = lower(btrim((status_desenvolvimento)::text)))'),
      ('modelos_status_plan_normalizado_chk', '((status_planejamento)::text = lower(btrim((status_planejamento)::text)))')
    ) AS x(nome, expr) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass AND k.conname = r.nome
                    AND k.contype = 'c' AND pg_get_expr(k.conbin, k.conrelid) = r.expr) THEN
      RAISE EXCEPTION 'mod4_validar: rode antes a 20261103130000 (% ausente ou com outra definicao)', r.nome USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  SELECT count(*) INTO n FROM public.modelos m
   WHERE m.status_desenvolvimento IS DISTINCT FROM lower(btrim(m.status_desenvolvimento))
      OR m.status_planejamento IS DISTINCT FROM lower(btrim(m.status_planejamento));
  IF n > 0 THEN
    RAISE EXCEPTION 'mod4_validar: % modelos com status fora do padrao (maiuscula ou espaco nas pontas) - normalizar antes', n
      USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

DO $validar$
DECLARE
  i int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass
                  AND k.conname IN ('modelos_status_dev_normalizado_chk', 'modelos_status_plan_normalizado_chk')
                  AND NOT k.convalidated) THEN
    RETURN;  -- ja validadas: nada a fazer, sem trava
  END IF;
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      IF EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass
                  AND k.conname = 'modelos_status_dev_normalizado_chk' AND NOT k.convalidated) THEN
        ALTER TABLE public.modelos VALIDATE CONSTRAINT modelos_status_dev_normalizado_chk;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass
                  AND k.conname = 'modelos_status_plan_normalizado_chk' AND NOT k.convalidated) THEN
        ALTER TABLE public.modelos VALIDATE CONSTRAINT modelos_status_plan_normalizado_chk;
      END IF;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN RAISE; END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END
$validar$;

DO $pos$
BEGIN
  IF (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = 'public.modelos'::regclass
        AND k.conname IN ('modelos_status_dev_normalizado_chk', 'modelos_status_plan_normalizado_chk') AND k.convalidated) <> 2 THEN
    RAISE EXCEPTION 'mod4_validar: pos-condicao falhou (as 2 constraints tem de estar validadas)' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
