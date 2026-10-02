-- INVERSO (dados) de supabase/migrations/20261025310000_completar_faltas_existentes.sql (achados MEDIOS R15a, P-214 B):
-- desfaz os lotes da correcao unica que ainda nao foram desfeitos, cad a cad, a partir de _bkp_p214_deficit:
--   * apaga SO as baixas criadas pelo lote (baixa_ids) e devolve o deficit_corte de antes;
--   * so se o cad ainda esta como a correcao deixou (deficit_corte = deficit_depois E todas as baixas do lote existem) - um
--     cad reenviado ao corte depois (o corte refaz as baixas) ou alterado e PULADO e relatado (NOTICE);
--   * [fix round 1, B-P2] pega antes a trava do corte de cada loja envolvida (pg_advisory_xact_lock 'corte_tenant:', a mesma
--     do corte e do P-203; espera ate o lock_timeout de 3 s) e FOR UPDATE no cad antes de conferir - um reenvio do corte
--     concorrente nao consegue mudar o cad entre a conferencia e a devolucao;
--   * [B-P6] as linhas de audit_log NASCIDAS nesta volta (baixas apagadas e cad devolvidos) ficam com user_nome 'Sistema' e
--     descricao 'Sistema: volta da correcao (P-214) - ...' (linhas que ja existiam na transacao nao sao tocadas);
--   * marca revertido_at nas linhas desfeitas. Rodar de novo = nada a desfazer (no-op).
-- As funcoes e a tabela ficam (DROP das funcoes = _down_drop). LIFO: roda DEPOIS do _down da L6 (LEVES 20261028120000) e
-- ANTES do inverso da 20261025300000.
-- Travas: advisory por loja + FOR UPDATE nos cad do lote + DELETE em estoque_tecido_baixas/UPDATE em cad (linhas do lote).
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.

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
  v_atual jsonb;
  v_achou boolean;
  v_aud_antes uuid[];
  v_bx_ids uuid[] := ARRAY[]::uuid[];
  v_cads uuid[] := ARRAY[]::uuid[];
BEGIN
  IF to_regclass('public._bkp_p214_deficit') IS NULL THEN
    RAISE NOTICE 'medios_r15a_p214 (volta): _bkp_p214_deficit nao existe - nada a desfazer';
    RETURN;
  END IF;
  SELECT COALESCE(array_agg(a.id), ARRAY[]::uuid[]) INTO v_aud_antes
    FROM public.audit_log a WHERE a.created_at = now() AND a.tabela IN ('cad', 'estoque_tecido_baixas');

  -- (B-P2) a trava do corte de cada loja envolvida, em ordem
  FOR r IN SELECT DISTINCT k.tenant_id FROM public._bkp_p214_deficit k
            WHERE k.revertido_at IS NULL AND k.tenant_id IS NOT NULL ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(hashtext('corte_tenant:' || r.tenant_id::text));
  END LOOP;

  FOR r IN
    SELECT k.id, k.cad_id, k.deficit_antes, k.deficit_depois, k.baixa_ids
      FROM public._bkp_p214_deficit k
     WHERE k.revertido_at IS NULL
     ORDER BY k.id
       FOR UPDATE OF k
  LOOP
    SELECT cd.deficit_corte INTO v_atual FROM public.cad cd WHERE cd.id = r.cad_id FOR UPDATE;
    v_achou := FOUND;
    SELECT count(*) INTO v_n FROM public.estoque_tecido_baixas b WHERE b.id = ANY (r.baixa_ids);
    IF NOT v_achou OR v_atual IS DISTINCT FROM r.deficit_depois OR v_n <> cardinality(r.baixa_ids) THEN
      v_pulados := v_pulados + 1;
      RAISE NOTICE 'medios_r15a_p214 (volta): cad % mudou depois da correcao (reenviado/alterado) - PULADO', r.cad_id;
      CONTINUE;
    END IF;
    DELETE FROM public.estoque_tecido_baixas b WHERE b.id = ANY (r.baixa_ids);
    UPDATE public.cad SET deficit_corte = r.deficit_antes WHERE id = r.cad_id;
    UPDATE public._bkp_p214_deficit SET revertido_at = now() WHERE id = r.id;
    v_ok := v_ok + 1;
    v_bx := v_bx + cardinality(r.baixa_ids);
    v_bx_ids := v_bx_ids || r.baixa_ids;
    v_cads := array_append(v_cads, r.cad_id);
  END LOOP;

  -- (B-P6) Auditoria: so as linhas nascidas nesta volta, das baixas apagadas e dos cad devolvidos
  UPDATE public.audit_log a
     SET user_nome = 'Sistema',
         descricao = 'Sistema: volta da correcao (P-214) - ' || COALESCE(a.descricao, '')
   WHERE a.created_at = now()
     AND NOT (a.id = ANY (v_aud_antes))
     AND ((a.tabela = 'estoque_tecido_baixas' AND a.registro_id = ANY (v_bx_ids))
          OR (a.tabela = 'cad' AND a.registro_id = ANY (v_cads)));

  RAISE NOTICE 'medios_r15a_p214 (volta): % cad(s) devolvido(s), % baixa(s) apagada(s), % pulado(s)', v_ok, v_bx, v_pulados;
END $volta$;

NOTIFY pgrst, 'reload schema';
COMMIT;
