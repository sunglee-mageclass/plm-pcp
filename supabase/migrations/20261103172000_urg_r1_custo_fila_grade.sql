-- Urgentes R1 T4 - fila do custo previsto ao mudar a GRADE do card (modelo_grades) quando o card tem insumo vinculado a UM
-- tamanho. GERADO por .superpowers/sdd/2026-10-05-urgentes/mig/gerar-a1.mjs (nunca editar a mao).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-a.md (Task 4; mapa dos consumidores #6; Rulings A3, A4).
-- O que muda (objetos NOVOS; nenhuma funcao existente e redefinida):
--   1) public.fn_custo_fila_grade() (plpgsql, SECURITY DEFINER, search_path=public, EXECUTE revogado de PUBLIC, anon, authenticated):
--      sai cedo com app.custo_sistema='on' (o proprio aplicador escrevendo); junta os modelo_id de novas/antigas (no UPDATE so as
--      linhas que mudaram de verdade: modelo_id, grades ou grade_total); mantem SO os modelos origem='interno' que tem no BOM
--      (modelo_etiquetas) um insumo com tamanho_vinculado preenchido (superset barato do vinculo efetivo - _custo_calcular decide o
--      fator); e chama _custo_enfileirar(ids, true) - RESPEITA O CONGELADO (Ruling A4): card ja enviado ao corte nao e recalculado.
--   2) 3 gatilhos AFTER INSERT | UPDATE | DELETE ON public.modelo_grades, FOR EACH STATEMENT com tabelas de transicao (um evento por
--      gatilho - regra do PG para transicao): trg_custo_fila_grade_ins / _upd / _del.
-- Efeito: o custo previsto do insumo vinculado acompanha a grade (pecas do tamanho / total) no COMMIT (processador adiado de sempre,
-- 3 s / 25 cards). Card sem insumo vinculado, revenda/importado e card cortado: a fila nao muda. Nenhum dado muda nesta migration.
-- Tempestade? O Salvar do Sheet (salvar_cad_completo) apaga e reinsere modelo_grades de UM card a cada Salvar: enfileira no maximo esse
-- card (1 linha na fila; os INSERTs seguintes da mesma txn nao rearmam - xmin), e nada se ele estiver cortado. MEDIDO na copia, maior
-- loja (Ave Rara, 250 cards, 201 com grade), com os 18 vinculos legados ligados: o Salvar (DELETE + INSERT por variante) de cada um
-- dos 201 = 0 ou 1 na fila (94 no total; o cortado nunca), ~2,5 ms por Salvar com os gatilhos (tests/integration/urg-a1-fila-grade).
-- Trava: CREATE TRIGGER (e CREATE OR REPLACE TRIGGER ao reaplicar) = ShareRowExclusiveLock em public.modelo_grades ate o COMMIT (MEDIDO
-- na copia, supautils carregado, por diferenca de pg_locks: so modelo_grades; NADA em auth/storage/realtime): bloqueia ESCRITA de
-- grade (Salvar do Sheet, Explosao, criar/duplicar card) por ms; leitura segue. lock_timeout 1500ms - 55P03 = nada mudou, rodar o
-- arquivo de novo. HORARIO CALMO. Idempotente (CREATE OR REPLACE da funcao e dos gatilhos).
-- ============================== ACCEPTED-MD5 (guarda) ==============================
--   public.fn_custo_fila_grade()  DEPOIS 6193e2458d9f566caa3b4ff7d0b6a551  NEUTRO 619e266e6dbbc469637802b8acf9920a
--   (ANTES: ausente) - exige a 20261103170000 viva (coluna etiquetas.tamanho_vinculado) e a 20261103171000 viva:
--   public._custo_calcular(uuid,uuid[]) = d10bf1397ea1fb9f37ef9b98d2aa1414; public._custo_enfileirar(uuid[],boolean) presente (md5 na geracao af8976a493758423d267325156f14633).
-- ====================================================================================
-- Volta (LIFO): supabase/rollback/20261103172000_urg_r1_custo_fila_grade_down.sql (NEUTRALIZA a funcao: CREATE OR REPLACE, sem trava de tabela; os gatilhos ficam
-- inertes) - ANTES do 20261103171000_down. DROP de verdade: supabase/rollback/20261103172000_urg_r1_custo_fila_grade_down_drop.sql (opcional, depois, HORARIO CALMO: DROP TRIGGER
-- prende auth/storage/realtime ate o COMMIT). Enquanto esta funcao viva estiver no banco o _down_drop da 20261103170000 RECUSA (ela cita
-- a coluna tamanho_vinculado) - o _down desta a neutraliza.
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
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'etiquetas'
                   AND column_name = 'tamanho_vinculado' AND data_type = 'text') THEN
    RAISE EXCEPTION 'urg_r1_172000: a 20261103170000 (coluna etiquetas.tamanho_vinculado) nao esta aplicada - aplique-a antes' USING ERRCODE = 'P0001';
  END IF;
  IF md5(pg_get_functiondef(to_regprocedure('public._custo_calcular(uuid,uuid[])'))) IS DISTINCT FROM 'd10bf1397ea1fb9f37ef9b98d2aa1414' THEN
    RAISE EXCEPTION 'urg_r1_172000: a 20261103171000 (custo previsto pelo tamanho vinculado) nao esta aplicada - aplique-a antes' USING ERRCODE = 'P0001';
  END IF;
  IF to_regprocedure('public._custo_enfileirar(uuid[],boolean)') IS NULL THEN
    RAISE EXCEPTION 'urg_r1_172000: public._custo_enfileirar(uuid[],boolean) ausente (fila do custo, release 8)' USING ERRCODE = 'P0001';
  END IF;
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_custo_fila_grade()')));
  IF v IS NOT NULL AND v NOT IN ('6193e2458d9f566caa3b4ff7d0b6a551', '619e266e6dbbc469637802b8acf9920a') THEN
    RAISE EXCEPTION 'urg_r1_172000: public.fn_custo_fila_grade() com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT t.tgname FROM pg_trigger t
            WHERE t.tgrelid = 'public.modelo_grades'::regclass AND t.tgname IN ('trg_custo_fila_grade_ins', 'trg_custo_fila_grade_upd', 'trg_custo_fila_grade_del')
              AND t.tgfoid IS DISTINCT FROM to_regprocedure('public.fn_custo_fila_grade()') LOOP
    RAISE EXCEPTION 'urg_r1_172000: gatilho % de modelo_grades ja existe chamando outra funcao - outra frente mexeu', r.tgname USING ERRCODE = 'P0001';
  END LOOP;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_custo_fila_grade()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- [urg R1] GRADE do card (modelo_grades) muda o custo previsto do insumo vinculado a UM tamanho (fator = pecas do tamanho / total
-- da grade, Ruling A3). Gatilhos de STATEMENT com tabelas de transicao (novas/antigas), um por evento. So enfileira modelos
-- INTERNOS com algum insumo do BOM com vinculo de tamanho preenchido (superset barato do vinculo efetivo) e RESPEITA o congelado
-- (Ruling A4, _custo_enfileirar(.., true)): o Salvar do Sheet regrava modelo_grades por DELETE+INSERT mesmo sem mudanca, e o card
-- ja enviado ao corte nao pode ser recalculado com o preco de hoje. No UPDATE so enfileira a linha que mudou de verdade.
DECLARE
  v_ids uuid[];
BEGIN
  IF coalesce(current_setting('app.custo_sistema', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT n.modelo_id) INTO v_ids FROM novas n WHERE n.modelo_id IS NOT NULL;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT o.modelo_id) INTO v_ids FROM antigas o WHERE o.modelo_id IS NOT NULL;
  ELSE
    SELECT array_agg(DISTINCT x.mid) INTO v_ids
      FROM novas n FULL JOIN antigas o ON o.id = n.id
      CROSS JOIN LATERAL unnest(ARRAY[o.modelo_id, n.modelo_id]) AS x(mid)
     WHERE x.mid IS NOT NULL
       AND (o.modelo_id, o.grades, o.grade_total) IS DISTINCT FROM (n.modelo_id, n.grades, n.grade_total);
  END IF;
  IF v_ids IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(m.id ORDER BY m.id) INTO v_ids
    FROM public.modelos m
   WHERE m.id = ANY (v_ids)
     AND m.origem = 'interno'
     AND EXISTS (SELECT 1
                   FROM public.modelo_etiquetas me
                   JOIN public.etiquetas e ON e.id = me.etiqueta_id
                  WHERE me.modelo_id = m.id
                    AND nullif(btrim(e.tamanho_vinculado), '') IS NOT NULL);
  PERFORM public._custo_enfileirar(v_ids, true);
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.fn_custo_fila_grade() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER trg_custo_fila_grade_ins AFTER INSERT ON public.modelo_grades REFERENCING NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_custo_fila_grade();
CREATE OR REPLACE TRIGGER trg_custo_fila_grade_upd AFTER UPDATE ON public.modelo_grades REFERENCING OLD TABLE AS antigas NEW TABLE AS novas
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_custo_fila_grade();
CREATE OR REPLACE TRIGGER trg_custo_fila_grade_del AFTER DELETE ON public.modelo_grades REFERENCING OLD TABLE AS antigas
  FOR EACH STATEMENT EXECUTE FUNCTION public.fn_custo_fila_grade();

DO $pos$
DECLARE
  r record;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_custo_fila_grade()'))) IS DISTINCT FROM '6193e2458d9f566caa3b4ff7d0b6a551' THEN
    RAISE EXCEPTION 'urg_r1_172000: pos-condicao falhou no texto de public.fn_custo_fila_grade()' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_custo_fila_grade()') AND p.prosecdef AND p.provolatile = 'v'
                   AND coalesce(p.proacl::text, '') = '{postgres=X/postgres,service_role=X/postgres}'
                   AND coalesce(array_to_string(p.proconfig, '|'), '') = 'search_path=public')
     OR has_function_privilege('anon', 'public.fn_custo_fila_grade()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.fn_custo_fila_grade()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.fn_custo_fila_grade()') AND x.grantee = 0) THEN
    RAISE EXCEPTION 'urg_r1_172000: pos-condicao falhou na ACL/secdef/search_path/volatilidade de public.fn_custo_fila_grade()' USING ERRCODE = 'P0001';
  END IF;
  IF (SELECT count(*) FROM pg_trigger t
        WHERE t.tgrelid = 'public.modelo_grades'::regclass AND NOT t.tgisinternal AND t.tgfoid = to_regprocedure('public.fn_custo_fila_grade()')) <> 3 THEN
    RAISE EXCEPTION 'urg_r1_172000: pos-condicao falhou - esperados 3 gatilhos de modelo_grades chamando public.fn_custo_fila_grade()' USING ERRCODE = 'P0001';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('trg_custo_fila_grade_ins', 4, NULL::name, 'novas'),
      ('trg_custo_fila_grade_upd', 16, 'antigas', 'novas'),
      ('trg_custo_fila_grade_del', 8, 'antigas', NULL::name)
    ) AS x(nome, tipo, velha, nova) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                    WHERE t.tgrelid = 'public.modelo_grades'::regclass AND t.tgname = r.nome
                      AND t.tgfoid = to_regprocedure('public.fn_custo_fila_grade()') AND t.tgtype = r.tipo AND t.tgenabled = 'O'
                      AND t.tgoldtable IS NOT DISTINCT FROM r.velha AND t.tgnewtable IS NOT DISTINCT FROM r.nova
                      AND cardinality(t.tgattr::int2[]) = 0 AND t.tgqual IS NULL) THEN
      RAISE EXCEPTION 'urg_r1_172000: pos-condicao falhou no gatilho % de modelo_grades', r.nome USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
END
$pos$;

COMMIT;
