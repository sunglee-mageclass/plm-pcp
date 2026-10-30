-- DROP opcional de supabase/migrations/20261103199100_urg_r11_ledger_tecido.sql (escrito a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 1 / R11b; Rulings 2, 12) + spec-r9.md (secao R11). Escrito A MAO
-- (nao gerado): a guarda e por ESTADO de public.estoque_tecido_baixas (o MESMO calculo nos 3 arquivos), registrado em
-- tests/integration/urgd-dados.ts (bloco r11b, URGD_ESTADO).
--   ANTES  = coluna peca_teste_tentativa_id AUSENTE, estoque_tecido_baixas_origem_check com as 4 origens antigas, sem
--            etb_peca_teste_forma e sem etb_peca_teste_idx;
--   DEPOIS = coluna uuid NULL com FK ON DELETE SET NULL para modelo_peca_teste_tentativas, origem_check com as 6 origens,
--            etb_peca_teste_forma e o indice parcial etb_peca_teste_idx.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
-- Rodar SO com o SITE voltado e DEPOIS dos _down/_down_drop da 199400..199200, em HORARIO CALMO. RECUSA (P0001, nada muda):
--   - com QUALQUER linha de peca teste no ledger (origem peca_teste/peca_teste_estorno ou peca_teste_tentativa_id preenchido),
--     conferido SOB a trava: o ledger nunca se apaga;
--   - com funcao de public citando peca_teste_tentativa_id/peca_teste_estorno (199200/199300 vivas);
--   - em estado inesperado (nem ANTES nem DEPOIS).
-- Sem elas: DROP do indice, do CHECK etb_peca_teste_forma e da coluna (com a FK) e o origem_check volta as 4 origens antigas.
-- Trava (MEDIDA, mesma receita; ~11 ms): AccessExclusive em estoque_tecido_baixas (LOCK) e em modelo_peca_teste_tentativas (DROP da
--   FK) - ate a LEITURA delas espera os ms. NENHUMA trava em auth/storage/realtime (contagem 0).
-- Tentativa ATOMICA (LOCK TABLE + ALTER num sub-bloco) com lock_timeout 1500ms, ate 3x com 1s de pausa; depois 55P03 e nada mudou.
-- Idempotente: no estado ANTES so da NOTICE.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $drop$
DECLARE
  c_ori_antes constant text := 'CHECK ((origem = ANY (ARRAY[''vinculo''::text, ''fifo''::text, ''separacao_rolo''::text, ''ajuste''::text])))';
  c_ori_depois constant text := 'CHECK ((origem = ANY (ARRAY[''vinculo''::text, ''fifo''::text, ''separacao_rolo''::text, ''ajuste''::text, ''peca_teste''::text, ''peca_teste_estorno''::text])))';
  c_forma constant text := 'CHECK (((origem <> ALL (ARRAY[''peca_teste''::text, ''peca_teste_estorno''::text])) OR ((cad_id IS NULL) AND (rolo_id IS NULL) AND (((origem = ''peca_teste''::text) AND (quantidade > (0)::numeric)) OR ((origem = ''peca_teste_estorno''::text) AND (quantidade < (0)::numeric))))))';
  c_fk constant text := 'FOREIGN KEY (peca_teste_tentativa_id) REFERENCES modelo_peca_teste_tentativas(id) ON DELETE SET NULL';
  c_idx constant text := 'CREATE INDEX etb_peca_teste_idx ON public.estoque_tecido_baixas USING btree (peca_teste_tentativa_id) WHERE (peca_teste_tentativa_id IS NOT NULL)';
  v_col boolean;
  v_ori text;
  v_for text;
  v_fk text;
  v_idx text;
  v_antes boolean;
  v_depois boolean;
  TAG constant text := 'urg_r11b_down_drop';
  i int;
  v_n int;
  v_fn text;
BEGIN
  -- estado de estoque_tecido_baixas (o MESMO calculo nos 3 arquivos da 199100): ANTES = coluna ausente, CHECK de origem antigo,
  -- sem etb_peca_teste_forma e sem o indice; DEPOIS = coluna uuid NULL com a FK SET NULL, CHECK de origem novo, etb_peca_teste_forma
  -- e o indice parcial. Qualquer outra combinacao = PARE (meio caminho ou outra frente mexeu).
  SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.estoque_tecido_baixas'::regclass
                   AND attname = 'peca_teste_tentativa_id' AND NOT attisdropped) INTO v_col;
  SELECT pg_get_constraintdef(oid) INTO v_ori FROM pg_constraint
   WHERE conrelid = 'public.estoque_tecido_baixas'::regclass AND conname = 'estoque_tecido_baixas_origem_check';
  SELECT pg_get_constraintdef(oid) INTO v_for FROM pg_constraint
   WHERE conrelid = 'public.estoque_tecido_baixas'::regclass AND conname = 'etb_peca_teste_forma';
  SELECT pg_get_constraintdef(k.oid) INTO v_fk FROM pg_constraint k
   WHERE k.conrelid = 'public.estoque_tecido_baixas'::regclass AND k.contype = 'f'
     AND k.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.estoque_tecido_baixas'::regclass
                             AND attname = 'peca_teste_tentativa_id' AND NOT attisdropped)];
  SELECT pg_get_indexdef(i.indexrelid) INTO v_idx FROM pg_index i
   WHERE i.indrelid = 'public.estoque_tecido_baixas'::regclass AND i.indexrelid = to_regclass('public.etb_peca_teste_idx');
  v_antes := coalesce(NOT v_col AND v_ori = c_ori_antes AND v_for IS NULL AND v_idx IS NULL
             AND to_regclass('public.etb_peca_teste_idx') IS NULL, false);
  v_depois := coalesce(v_col AND v_ori = c_ori_depois AND v_for = c_forma AND v_fk = c_fk AND v_idx = c_idx
              AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                            AND table_name = 'estoque_tecido_baixas' AND column_name = 'peca_teste_tentativa_id'
                            AND data_type = 'uuid' AND is_nullable = 'YES' AND column_default IS NULL), false);
  IF NOT v_antes AND NOT v_depois THEN
    RAISE EXCEPTION '%: estoque_tecido_baixas em estado inesperado (coluna %, origem_check %, forma %, fk %, indice %) - PARE',
      TAG, v_col, coalesce(v_ori, 'ausente'), coalesce(v_for, 'ausente'), coalesce(v_fk, 'ausente'), coalesce(v_idx, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
  IF v_antes THEN
    RAISE NOTICE 'urg_r11b_down_drop: ja voltada (estado ANTES) - nada a fazer';
    RETURN;
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO v_fn FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.prosrc ~ '(peca_teste_tentativa_id|peca_teste_estorno)';
  IF v_fn IS NOT NULL THEN
    RAISE EXCEPTION 'urg_r11b_down_drop: funcoes ainda citam a coluna/origem nova: % - rode os _down/_down_drop delas antes', v_fn
      USING ERRCODE = 'P0001';
  END IF;
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      LOCK TABLE public.estoque_tecido_baixas IN ACCESS EXCLUSIVE MODE;
      -- SOB a trava: nenhuma baixa de peca teste no ledger (o ledger nunca se apaga)
      SELECT count(*)::int INTO v_n FROM public.estoque_tecido_baixas
       WHERE origem IN ('peca_teste', 'peca_teste_estorno') OR peca_teste_tentativa_id IS NOT NULL;
      IF v_n > 0 THEN
        RAISE EXCEPTION 'urg_r11b_down_drop: % linha(s) de peca teste no ledger do tecido - o ledger nunca se apaga; PARE', v_n
          USING ERRCODE = 'P0001';
      END IF;
      DROP INDEX public.etb_peca_teste_idx;
      ALTER TABLE public.estoque_tecido_baixas
        DROP CONSTRAINT etb_peca_teste_forma,
        DROP CONSTRAINT estoque_tecido_baixas_origem_check,
        ADD CONSTRAINT estoque_tecido_baixas_origem_check CHECK (origem = ANY (ARRAY['vinculo','fifo','separacao_rolo','ajuste'])),
        DROP COLUMN peca_teste_tentativa_id;
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN
        RAISE;
      END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END
$drop$;

DO $pos$
DECLARE
  c_ori_antes constant text := 'CHECK ((origem = ANY (ARRAY[''vinculo''::text, ''fifo''::text, ''separacao_rolo''::text, ''ajuste''::text])))';
  c_ori_depois constant text := 'CHECK ((origem = ANY (ARRAY[''vinculo''::text, ''fifo''::text, ''separacao_rolo''::text, ''ajuste''::text, ''peca_teste''::text, ''peca_teste_estorno''::text])))';
  c_forma constant text := 'CHECK (((origem <> ALL (ARRAY[''peca_teste''::text, ''peca_teste_estorno''::text])) OR ((cad_id IS NULL) AND (rolo_id IS NULL) AND (((origem = ''peca_teste''::text) AND (quantidade > (0)::numeric)) OR ((origem = ''peca_teste_estorno''::text) AND (quantidade < (0)::numeric))))))';
  c_fk constant text := 'FOREIGN KEY (peca_teste_tentativa_id) REFERENCES modelo_peca_teste_tentativas(id) ON DELETE SET NULL';
  c_idx constant text := 'CREATE INDEX etb_peca_teste_idx ON public.estoque_tecido_baixas USING btree (peca_teste_tentativa_id) WHERE (peca_teste_tentativa_id IS NOT NULL)';
  v_col boolean;
  v_ori text;
  v_for text;
  v_fk text;
  v_idx text;
  v_antes boolean;
  v_depois boolean;
  TAG constant text := 'urg_r11b_down_drop';
BEGIN
  -- estado de estoque_tecido_baixas (o MESMO calculo nos 3 arquivos da 199100): ANTES = coluna ausente, CHECK de origem antigo,
  -- sem etb_peca_teste_forma e sem o indice; DEPOIS = coluna uuid NULL com a FK SET NULL, CHECK de origem novo, etb_peca_teste_forma
  -- e o indice parcial. Qualquer outra combinacao = PARE (meio caminho ou outra frente mexeu).
  SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.estoque_tecido_baixas'::regclass
                   AND attname = 'peca_teste_tentativa_id' AND NOT attisdropped) INTO v_col;
  SELECT pg_get_constraintdef(oid) INTO v_ori FROM pg_constraint
   WHERE conrelid = 'public.estoque_tecido_baixas'::regclass AND conname = 'estoque_tecido_baixas_origem_check';
  SELECT pg_get_constraintdef(oid) INTO v_for FROM pg_constraint
   WHERE conrelid = 'public.estoque_tecido_baixas'::regclass AND conname = 'etb_peca_teste_forma';
  SELECT pg_get_constraintdef(k.oid) INTO v_fk FROM pg_constraint k
   WHERE k.conrelid = 'public.estoque_tecido_baixas'::regclass AND k.contype = 'f'
     AND k.conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.estoque_tecido_baixas'::regclass
                             AND attname = 'peca_teste_tentativa_id' AND NOT attisdropped)];
  SELECT pg_get_indexdef(i.indexrelid) INTO v_idx FROM pg_index i
   WHERE i.indrelid = 'public.estoque_tecido_baixas'::regclass AND i.indexrelid = to_regclass('public.etb_peca_teste_idx');
  v_antes := coalesce(NOT v_col AND v_ori = c_ori_antes AND v_for IS NULL AND v_idx IS NULL
             AND to_regclass('public.etb_peca_teste_idx') IS NULL, false);
  v_depois := coalesce(v_col AND v_ori = c_ori_depois AND v_for = c_forma AND v_fk = c_fk AND v_idx = c_idx
              AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                            AND table_name = 'estoque_tecido_baixas' AND column_name = 'peca_teste_tentativa_id'
                            AND data_type = 'uuid' AND is_nullable = 'YES' AND column_default IS NULL), false);
  IF NOT v_antes THEN
    RAISE EXCEPTION 'urg_r11b_down_drop: pos-condicao falhou (coluna %, origem_check %, forma %, indice %)',
      v_col, coalesce(v_ori, 'ausente'), coalesce(v_for, 'ausente'), coalesce(v_idx, 'ausente') USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
