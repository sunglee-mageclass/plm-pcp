-- Urgentes R11b (20261103199100) - ledger do TECIDO para a peca teste: estoque_tecido_baixas ganha o vinculo com a tentativa e 2
-- origens novas, peca_teste (> 0, a baixa) e peca_teste_estorno (< 0, o estorno = linha COMPENSATORIA, nunca DELETE; Ruling 2).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 1 / R11b; Rulings 2, 12) + spec-r9.md (secao R11). Escrito A MAO
-- (nao gerado): a guarda e por ESTADO de public.estoque_tecido_baixas (o MESMO calculo nos 3 arquivos), registrado em
-- tests/integration/urgd-dados.ts (bloco r11b, URGD_ESTADO).
--   ANTES  = coluna peca_teste_tentativa_id AUSENTE, estoque_tecido_baixas_origem_check com as 4 origens antigas, sem
--            etb_peca_teste_forma e sem etb_peca_teste_idx;
--   DEPOIS = coluna uuid NULL com FK ON DELETE SET NULL para modelo_peca_teste_tentativas, origem_check com as 6 origens,
--            etb_peca_teste_forma e o indice parcial etb_peca_teste_idx.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
-- O que muda (DDL em UMA tabela; nenhum dado gravado; os ~83 registros de hoje ficam iguais):
--   1) coluna NOVA peca_teste_tentativa_id uuid REFERENCES modelo_peca_teste_tentativas(id) ON DELETE SET NULL (o card/a tentativa
--      some, a baixa FICA - Ruling 12) + indice parcial etb_peca_teste_idx;
--   2) estoque_tecido_baixas_origem_check: + 'peca_teste', 'peca_teste_estorno';
--   3) CHECK NOVO etb_peca_teste_forma: linha de peca teste NUNCA tem cad_id nem rolo_id (o reenvio ao corte faz
--      DELETE ... WHERE cad_id = _cad_id e nao pode leva-la) e o sinal casa com a origem.
--   Quem le o ledger: _estoque_tecido_core conta toda origem <> separacao_rolo (a nova e a negativa entram sem redefinir o core);
--   saldo_oc_item_m / detalhe_estoque_variante / Plan. Tecido / _completar_deficit_corte_variante somam por item sem filtrar
--   origem; o extrato do tecido ganha o rotulo na 199200. NENHUMA funcao existente muda aqui.
-- Trava (MEDIDA, receita R6: diferenca de pg_locks numa txn REVERTIDA, DDL digitada, supautils carregado): ~19 ms. AccessExclusive
--   em estoque_tecido_baixas (LOCK + ALTER: telas de Estoque/Explosao/Plan. Tecido ESPERAM os ms, ate a LEITURA) + ShareRowExclusive
--   em modelo_peca_teste_tentativas (FK nova: escrita de tentativa espera). NENHUMA trava em auth/storage/realtime (contagem 0).
--   Reaplicar (estado DEPOIS) = so catalogo, nenhuma trava de tabela (~5 ms).
-- HORARIO CALMO. Uma tentativa ATOMICA por vez (LOCK TABLE + ALTER num sub-bloco, receita 174000): se a trava nao vier em 1500ms
--   (> deadlock_timeout: cancela autovacuum) ou houver deadlock, o sub-bloco falha e LIBERA tudo; 1s de pausa; ate 3x; depois
--   55P03 e NADA mudou (rodar o arquivo de novo). Tabela pequena: os 2 CHECKs sao validados na hora (varredura de ms).
-- Idempotente: no estado DEPOIS so da NOTICE (nenhuma trava de tabela).
-- Volta: supabase/rollback/20261103199100_urg_r11_ledger_tecido_down.sql (no-op documentado: a coluna e os CHECKs largos ficam,
--   inertes com o site voltado) ANTES do 20261103199000_down; DROP de verdade = ..._down_drop.sql (RECUSA com linha de peca teste
--   no ledger: o ledger nunca se apaga).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $ida$
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
  TAG constant text := 'urg_r11b';
  i int;
BEGIN
  IF to_regclass('public.modelo_peca_teste_tentativas') IS NULL THEN
    RAISE EXCEPTION 'urg_r11b: exige a 20261103192000 (urg R9a) aplicada (modelo_peca_teste_tentativas ausente)' USING ERRCODE = 'P0001';
  END IF;
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
  IF v_depois THEN
    RAISE NOTICE 'urg_r11b: ja aplicada (estado DEPOIS) - nada a fazer';
    RETURN;
  END IF;
  FOR i IN 1..3 LOOP
    BEGIN
      PERFORM set_config('lock_timeout', '1500ms', true);
      LOCK TABLE public.estoque_tecido_baixas IN ACCESS EXCLUSIVE MODE;
      ALTER TABLE public.estoque_tecido_baixas
        ADD COLUMN peca_teste_tentativa_id uuid REFERENCES public.modelo_peca_teste_tentativas(id) ON DELETE SET NULL,
        DROP CONSTRAINT estoque_tecido_baixas_origem_check,
        ADD CONSTRAINT estoque_tecido_baixas_origem_check
          CHECK (origem = ANY (ARRAY['vinculo','fifo','separacao_rolo','ajuste','peca_teste','peca_teste_estorno'])),
        ADD CONSTRAINT etb_peca_teste_forma CHECK (origem NOT IN ('peca_teste','peca_teste_estorno')
          OR (cad_id IS NULL AND rolo_id IS NULL AND ((origem='peca_teste' AND quantidade>0) OR (origem='peca_teste_estorno' AND quantidade<0))));
      CREATE INDEX etb_peca_teste_idx ON public.estoque_tecido_baixas (peca_teste_tentativa_id)
        WHERE peca_teste_tentativa_id IS NOT NULL;
      COMMENT ON COLUMN public.estoque_tecido_baixas.peca_teste_tentativa_id IS
        'R11: tentativa de peca teste da baixa (origem peca_teste/peca_teste_estorno); SET NULL quando a tentativa some - a baixa fica.';
      EXIT;
    EXCEPTION WHEN lock_not_available OR deadlock_detected THEN
      IF i = 3 THEN
        RAISE;
      END IF;
      PERFORM pg_sleep(1);
    END;
  END LOOP;
END
$ida$;

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
  TAG constant text := 'urg_r11b';
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
  IF NOT v_depois THEN
    RAISE EXCEPTION 'urg_r11b: pos-condicao falhou (coluna %, origem_check %, forma %, fk %, indice %)',
      v_col, coalesce(v_ori, 'ausente'), coalesce(v_for, 'ausente'), coalesce(v_fk, 'ausente'), coalesce(v_idx, 'ausente')
      USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
