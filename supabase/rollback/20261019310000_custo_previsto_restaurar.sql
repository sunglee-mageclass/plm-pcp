-- RESTAURAR os custos de ANTES da correcao unica do custo previsto (contas certas C2, 20261019310000; plano
-- .superpowers/sdd/2026-09-30-contas-certas-cd/plan-cd.md §4 C2 e §6 "Volta"). PASSO SEPARADO E EXPLICITO: so roda com
-- decisao do DONO (recomendado depois do passo 4 da volta, com o 20261019300000 neutralizado - senao a proxima edicao do
-- card recalcula de novo).
--
-- AUTOCONTIDO: nao usa nenhuma funcao do 20261019310000 (o inverso dele pode ja ter rodado) - so le public._bkp_custo_previsto,
-- que o inverso MANTEM.
--   • exige a confirmacao: rodar com  PGOPTIONS='-c app.confirmo_restaurar_custo=sim' psql -v ON_ERROR_STOP=1 -f <arquivo>
--     (sem ela: recusa, nada muda);
--   • liga app.custo_sistema='on' na transacao (o trg_modelo_custo_derivado deixa gravar as 5 colunas e as linhas do BOM
--     regravadas nao entram na fila de recalculo) e devolve o valor anterior no fim;
--   • por lote, do mais novo para o mais antigo, e POR MODELO (tudo ou nada): devolve o "antes" do backup (as colunas de
--     modelos E o custo_previsto das linhas do BOM) SO se TODOS os valores daquele modelo no lote ainda sao o "depois" do
--     backup. Modelo mexido depois da correcao (editado, recalculado, linha apagada, modelo excluido) NAO e tocado e e
--     relatado (NOTICE com os ids);
--   • nao apaga o backup: rodar de novo nao faz nada (o valor ja e o "antes", nao o "depois").
-- Travas: LOCK de modelos + linhas do BOM em SHARE ROW EXCLUSIVE ate o COMMIT (ninguem grava no meio). Sem DDL.
-- Aplicar fora de transacao (psql -f). NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).

SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

DO $restaurar$
DECLARE
  v_ant text := coalesce(current_setting('app.custo_sistema', true), '');
  v_lote uuid;
  v_ok uuid[];
  v_pulados uuid[];
  v_ja uuid[];
  v_n_m integer;
  v_n_l integer;
  v_tot_m integer := 0;
  v_tot_l integer := 0;
  v_tot_pulados integer := 0;
BEGIN
  IF coalesce(current_setting('app.confirmo_restaurar_custo', true), '') <> 'sim' THEN
    RAISE EXCEPTION 'custo_restaurar: recusado - rode com app.confirmo_restaurar_custo=sim (so com decisao do dono)' USING ERRCODE = 'P0001';
  END IF;
  IF to_regclass('public._bkp_custo_previsto') IS NULL THEN
    RAISE NOTICE 'custo_restaurar: _bkp_custo_previsto nao existe - nada a restaurar';
    RETURN;
  END IF;
  LOCK TABLE public.modelos, public.modelo_tecidos, public.modelo_aviamentos, public.modelo_etiquetas IN SHARE ROW EXCLUSIVE MODE;
  PERFORM set_config('app.custo_sistema', 'on', true);

  FOR v_lote IN SELECT b.lote FROM public._bkp_custo_previsto b GROUP BY b.lote ORDER BY max(b.gravado_em) DESC, b.lote LOOP
    WITH b AS (
      SELECT b.modelo_id, b.antes, b.depois,
             CASE b.tabela
               WHEN 'modelo_tecidos' THEN (SELECT t.custo_previsto FROM public.modelo_tecidos t WHERE t.id = b.id)
               WHEN 'modelo_aviamentos' THEN (SELECT t.custo_previsto FROM public.modelo_aviamentos t WHERE t.id = b.id)
               WHEN 'modelo_etiquetas' THEN (SELECT t.custo_previsto FROM public.modelo_etiquetas t WHERE t.id = b.id)
               ELSE (SELECT CASE b.coluna WHEN 'custo_peca_previsto' THEN m.custo_peca_previsto
                                          WHEN 'custo_tecido_total' THEN m.custo_tecido_total
                                          WHEN 'custo_forro_total' THEN m.custo_forro_total
                                          WHEN 'custo_entretela_total' THEN m.custo_entretela_total
                                          WHEN 'custo_aviamento_total' THEN m.custo_aviamento_total END
                       FROM public.modelos m WHERE m.id = b.id) END AS atual
        FROM public._bkp_custo_previsto b
       WHERE b.lote = v_lote
    )
    SELECT coalesce(array_agg(x.modelo_id ORDER BY x.modelo_id) FILTER (WHERE x.intacto), '{}'),
           coalesce(array_agg(x.modelo_id ORDER BY x.modelo_id) FILTER (WHERE NOT x.intacto AND NOT x.ja_antes), '{}'),
           coalesce(array_agg(x.modelo_id ORDER BY x.modelo_id) FILTER (WHERE NOT x.intacto AND x.ja_antes), '{}')
      INTO v_ok, v_pulados, v_ja
      FROM (SELECT b.modelo_id, bool_and(b.atual IS NOT DISTINCT FROM b.depois) AS intacto,
                   bool_and(b.atual IS NOT DISTINCT FROM b.antes) AS ja_antes
              FROM b GROUP BY b.modelo_id) x;

    WITH ut AS (
      UPDATE public.modelo_tecidos t SET custo_previsto = b.antes
        FROM public._bkp_custo_previsto b
       WHERE b.lote = v_lote AND b.tabela = 'modelo_tecidos' AND b.modelo_id = ANY (v_ok) AND t.id = b.id
      RETURNING 1
    ), ua AS (
      UPDATE public.modelo_aviamentos t SET custo_previsto = b.antes
        FROM public._bkp_custo_previsto b
       WHERE b.lote = v_lote AND b.tabela = 'modelo_aviamentos' AND b.modelo_id = ANY (v_ok) AND t.id = b.id
      RETURNING 1
    ), ue AS (
      UPDATE public.modelo_etiquetas t SET custo_previsto = b.antes
        FROM public._bkp_custo_previsto b
       WHERE b.lote = v_lote AND b.tabela = 'modelo_etiquetas' AND b.modelo_id = ANY (v_ok) AND t.id = b.id
      RETURNING 1
    )
    SELECT (SELECT count(*) FROM ut) + (SELECT count(*) FROM ua) + (SELECT count(*) FROM ue) INTO v_n_l;

    UPDATE public.modelos m
       SET custo_peca_previsto = CASE WHEN p.tem_peca THEN p.peca ELSE m.custo_peca_previsto END,
           custo_tecido_total = CASE WHEN p.tem_tecido THEN p.tecido ELSE m.custo_tecido_total END,
           custo_forro_total = CASE WHEN p.tem_forro THEN p.forro ELSE m.custo_forro_total END,
           custo_entretela_total = CASE WHEN p.tem_entretela THEN p.entretela ELSE m.custo_entretela_total END,
           custo_aviamento_total = CASE WHEN p.tem_aviamento THEN p.aviamento ELSE m.custo_aviamento_total END
      FROM (SELECT b.id,
                   bool_or(b.coluna = 'custo_peca_previsto') AS tem_peca, max(b.antes) FILTER (WHERE b.coluna = 'custo_peca_previsto') AS peca,
                   bool_or(b.coluna = 'custo_tecido_total') AS tem_tecido, max(b.antes) FILTER (WHERE b.coluna = 'custo_tecido_total') AS tecido,
                   bool_or(b.coluna = 'custo_forro_total') AS tem_forro, max(b.antes) FILTER (WHERE b.coluna = 'custo_forro_total') AS forro,
                   bool_or(b.coluna = 'custo_entretela_total') AS tem_entretela, max(b.antes) FILTER (WHERE b.coluna = 'custo_entretela_total') AS entretela,
                   bool_or(b.coluna = 'custo_aviamento_total') AS tem_aviamento, max(b.antes) FILTER (WHERE b.coluna = 'custo_aviamento_total') AS aviamento
              FROM public._bkp_custo_previsto b
             WHERE b.lote = v_lote AND b.tabela = 'modelos' AND b.modelo_id = ANY (v_ok)
             GROUP BY b.id) p
     WHERE m.id = p.id;
    GET DIAGNOSTICS v_n_m = ROW_COUNT;

    v_tot_m := v_tot_m + v_n_m;
    v_tot_l := v_tot_l + v_n_l;
    v_tot_pulados := v_tot_pulados + cardinality(v_pulados);
    RAISE NOTICE 'custo_restaurar: lote % -> % modelo(s) devolvido(s) (% com colunas de modelos, % linha(s) do BOM), % pulado(s) por terem mudado depois da correcao, % ja estavam com o antes',
      v_lote, cardinality(v_ok), v_n_m, v_n_l, cardinality(v_pulados), cardinality(v_ja);
    IF cardinality(v_pulados) > 0 THEN
      RAISE NOTICE 'custo_restaurar: lote % PULADOS (ficam como estao): %', v_lote, array_to_string(v_pulados, ',');
    END IF;
  END LOOP;

  PERFORM set_config('app.custo_sistema', v_ant, true);
  RAISE NOTICE 'custo_restaurar: total -> % modelo(s) com colunas devolvidas, % linha(s) do BOM devolvida(s), % modelo(s) pulado(s); o backup fica (rodar de novo nao muda nada)',
    v_tot_m, v_tot_l, v_tot_pulados;
END $restaurar$;

COMMIT;
