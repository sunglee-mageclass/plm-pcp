-- INVERSO (dados) de supabase/migrations/20261025310000_completar_faltas_existentes.sql (achados MEDIOS R15a, P-214 B):
-- desfaz os lotes da correcao unica que ainda nao foram desfeitos, cad a cad, a partir de _bkp_p214_deficit:
--   * apaga SO as baixas criadas pelo lote (baixa_ids) e devolve o deficit_corte de antes;
--   * so se o cad ainda esta como a correcao deixou (deficit_corte = deficit_depois E todas as baixas do lote existem) - um
--     cad reenviado ao corte depois (o corte refaz as baixas) ou alterado e PULADO e relatado (NOTICE);
--   * marca revertido_at nas linhas desfeitas. Rodar de novo = nada a desfazer (no-op).
-- As funcoes e a tabela ficam (DROP das funcoes = _down_drop). LIFO: roda ANTES do inverso da 20261025300000.
-- Travas: DELETE em estoque_tecido_baixas e UPDATE em cad (linhas do lote). Aplicar fora de transacao:
-- psql -v ON_ERROR_STOP=1 -f <arquivo>.

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '8s';
SET LOCAL transaction_timeout = '10s';

DO $volta$
DECLARE
  r record;
  v_ok int := 0;
  v_pulados int := 0;
  v_bx int := 0;
  v_n int;
BEGIN
  IF to_regclass('public._bkp_p214_deficit') IS NULL THEN
    RAISE NOTICE 'medios_r15a_p214 (volta): _bkp_p214_deficit nao existe - nada a desfazer';
    RETURN;
  END IF;
  FOR r IN
    SELECT k.id, k.cad_id, k.deficit_antes, k.deficit_depois, k.baixa_ids, cd.deficit_corte AS atual
      FROM public._bkp_p214_deficit k
      LEFT JOIN public.cad cd ON cd.id = k.cad_id
     WHERE k.revertido_at IS NULL
     ORDER BY k.id
       FOR UPDATE OF k
  LOOP
    SELECT count(*) INTO v_n FROM public.estoque_tecido_baixas b WHERE b.id = ANY (r.baixa_ids);
    IF r.atual IS DISTINCT FROM r.deficit_depois OR v_n <> cardinality(r.baixa_ids) THEN
      v_pulados := v_pulados + 1;
      RAISE NOTICE 'medios_r15a_p214 (volta): cad % mudou depois da correcao (reenviado/alterado) - PULADO', r.cad_id;
      CONTINUE;
    END IF;
    DELETE FROM public.estoque_tecido_baixas b WHERE b.id = ANY (r.baixa_ids);
    UPDATE public.cad SET deficit_corte = r.deficit_antes WHERE id = r.cad_id;
    UPDATE public._bkp_p214_deficit SET revertido_at = now() WHERE id = r.id;
    v_ok := v_ok + 1;
    v_bx := v_bx + cardinality(r.baixa_ids);
  END LOOP;
  RAISE NOTICE 'medios_r15a_p214 (volta): % cad(s) devolvido(s), % baixa(s) apagada(s), % pulado(s)', v_ok, v_bx, v_pulados;
END $volta$;

NOTIFY pgrst, 'reload schema';
COMMIT;
