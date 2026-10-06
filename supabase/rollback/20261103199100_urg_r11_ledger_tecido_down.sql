-- Inverso NEUTRO de supabase/migrations/20261103199100_urg_r11_ledger_tecido.sql - NO-OP DOCUMENTADO (escrito a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md (Task 1 / R11b; Rulings 2, 12) + spec-r9.md (secao R11). Escrito A MAO
-- (nao gerado): a guarda e por ESTADO de public.estoque_tecido_baixas (o MESMO calculo nos 3 arquivos), registrado em
-- tests/integration/urgd-dados.ts (bloco r11b, URGD_ESTADO).
--   ANTES  = coluna peca_teste_tentativa_id AUSENTE, estoque_tecido_baixas_origem_check com as 4 origens antigas, sem
--            etb_peca_teste_forma e sem etb_peca_teste_idx;
--   DEPOIS = coluna uuid NULL com FK ON DELETE SET NULL para modelo_peca_teste_tentativas, origem_check com as 6 origens,
--            etb_peca_teste_forma e o indice parcial etb_peca_teste_idx.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
-- Por que nada muda: com o site e a 199400..199200 voltados ninguem grava origem peca_teste*; a coluna (NULL nas linhas antigas) e os
-- CHECKs largos ficam INERTES, e as linhas de peca teste ja gravadas TEM de continuar validas (o ledger nunca se apaga - Ruling 2).
-- Este arquivo so CONFERE o estado (ANTES ou DEPOIS; outro = PARE) e da NOTICE. Nenhuma trava de tabela. Qualquer hora.
-- Volta (LIFO): DEPOIS do 20261103199200_down e ANTES do 20261103199000_down. DROP de verdade (opcional, depois, horario calmo):
--   supabase/rollback/20261103199100_urg_r11_ledger_tecido_down_drop.sql.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $down$
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
  TAG constant text := 'urg_r11b_down';
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
  RAISE NOTICE 'urg_r11b_down: no-op documentado (estado %) - a coluna e os CHECKs ficam; DROP = _down_drop',
    CASE WHEN v_depois THEN 'DEPOIS' ELSE 'ANTES' END;
END
$down$;

COMMIT;
