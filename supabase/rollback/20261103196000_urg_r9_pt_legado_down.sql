-- Volta de supabase/migrations/20261103196000_urg_r9_pt_legado.sql (urg R9e) - NEUTRA (sem DROP; nenhum dado do usuario apagado).
-- Plano: .superpowers/sdd/2026-10-05-urgentes/plan-c.md (Task 4 / R9e; Ruling 19).
-- O que faz: desliga exige_peca_teste SO das categorias que a ida ligou (_bkp_r9_exige_pl, antes = false) e que AINDA estao ligadas
--   (devolve o antes) e TIRA essas linhas do backup (assim ida -> _down -> ida volta ao estado da ida). Categoria que a pessoa ligou
--   por conta propria (fora do backup) NAO e mexida; categoria do backup que a pessoa ja desligou fica como esta (e no backup: a ida
--   nao a religa). Roda com app.kanban_sistema (nada enfileira); loja que exige 'peca_teste_aprovada' (Passo 0-V; o 194000_down
--   recusa enquanto existir) e tocada aqui e enfileirada explicitamente.
-- O que FICA: as tentativas origem 'legado' (inertes com o site voltado; saem so no 192000_down_drop, com backup), o backup
--   _bkp_r9_pt_legado (sem ele, reaplicar a ida reclassificaria os blocos) e os pt_* (nunca foram mexidos).
-- Idempotente (2a vez = nada a devolver). Sem a ida (backup ausente) = no-op. Trava: so linhas de categorias_terceirizado (ms).
-- Ordem LIFO: SITE -> ESTE -> 195000_down -> 194000_down -> 193000_down -> 192000_down. _down_drop (opcional, depois):
--   supabase/rollback/20261103196000_urg_r9_pt_legado_down_drop.sql.
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>.
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';
SET LOCAL app.kanban_sistema = 'urg_r9_legado_down';

DO $volta$
DECLARE
  v_n integer;
  v_resta integer;
  v_lojas uuid[];
  r record;
BEGIN
  IF to_regclass('public._bkp_r9_exige_pl') IS NULL THEN
    RAISE NOTICE 'urg_r9e_down: sem _bkp_r9_exige_pl (a ida nao rodou ou o _down_drop ja rodou) - nada a devolver';
    RETURN;
  END IF;
  PERFORM 1 FROM public.categorias_terceirizado c JOIN public._bkp_r9_exige_pl b ON b.categoria_id = c.id
   WHERE c.exige_peca_teste AND NOT b.antes
   ORDER BY c.id FOR UPDATE OF c;
  SELECT array_agg(DISTINCT tc.tenant_id ORDER BY tc.tenant_id) INTO v_lojas
    FROM public.tenant_config tc
   WHERE tc.tenant_id IN (SELECT c.tenant_id FROM public.categorias_terceirizado c JOIN public._bkp_r9_exige_pl b ON b.categoria_id = c.id
                           WHERE c.exige_peca_teste AND NOT b.antes)
     AND (coalesce(tc.kanban_requisitos::text, '') || coalesce(tc.revenda_kanban_requisitos::text, '')
          || coalesce(tc.kanban_requisitos_excecoes::text, '')) LIKE '%"peca_teste_aprovada"%';
  WITH dev AS (
    UPDATE public.categorias_terceirizado c SET exige_peca_teste = b.antes
      FROM public._bkp_r9_exige_pl b
     WHERE b.categoria_id = c.id AND c.exige_peca_teste AND NOT b.antes
    RETURNING c.id
  )
  DELETE FROM public._bkp_r9_exige_pl b USING dev WHERE b.categoria_id = dev.id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_lojas IS NOT NULL THEN
    PERFORM set_config('app.kanban_sistema', '', true);
    FOR r IN SELECT unnest(v_lojas) AS t LOOP
      PERFORM public._kanban_enfileirar_tenant(r.t);
    END LOOP;
    PERFORM set_config('app.kanban_sistema', 'urg_r9_legado_down', true);
  END IF;
  SELECT count(*) INTO v_resta FROM public.categorias_terceirizado c JOIN public._bkp_r9_exige_pl b ON b.categoria_id = c.id
   WHERE c.exige_peca_teste AND NOT b.antes;
  IF v_resta > 0 THEN
    RAISE EXCEPTION 'urg_r9e_down: pos-condicao falhou (% categoria(s) ainda ligada(s) pela ida)', v_resta USING ERRCODE = 'P0001';
  END IF;
  RAISE NOTICE 'urg_r9e_down: % categoria(s) PL desligada(s) (devolvidas ao antes); % loja(s) enfileirada(s); tentativas legado ficam',
    v_n, coalesce(cardinality(v_lojas), 0);
END
$volta$;

SELECT set_config('app.kanban_sistema', '', true) AS kanban_sistema_restaurado;

COMMIT;
