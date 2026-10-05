-- Camada C1 - servico com parcela PAGA nao e excluido por caminho nenhum (P-268 A). GERADO por .superpowers/sdd/2026-10-05-camada/mig/gerar-c1.mjs (nunca editar a mao).
-- Desenho: .superpowers/sdd/2026-10-05-camada/desenho.md §2.4 (+ plan.md, ledger: achado P-268).
-- O que muda: funcao NOVA public.fn_servico_parcela_paga_bloqueia_delete() (SECURITY INVOKER, search_path=public, EXECUTE
-- so postgres/service_role) + gatilho NOVO trg_servico_parcela_paga_bloqueia_delete BEFORE DELETE FOR EACH ROW em
-- producao_terceirizados: excluir servico com parcela paga (status 'pago' OU data_pagamento) = P0001
-- 'servico_com_parcela_paga: <categoria - fornecedor>: parcela n, m' (prefixo ASCII). Antes a FK ON DELETE CASCADE levava as
-- parcelas pagas junto (excluir_cad, SQL direto). NAO morde session_replication_role=replica (_wipe_tenant_core: reset/excluir
-- loja). Desfazer o pagamento no Financeiro e entao excluir continua funcionando. Nenhum dado muda.
-- Trava: CREATE TRIGGER pega ShareRowExclusiveLock em producao_terceirizados por um instante (bloqueia escrita na tabela ate o
-- COMMIT; leitura segue) -> HORARIO CALMO, lock_timeout 1500ms; 55P03 = nada mudou, rodar de novo. Nada em auth/storage/realtime.
-- Idempotente (gatilho ja igual = pula o CREATE TRIGGER, sem trava). Volta: supabase/rollback/20261103161000_camada_parcela_paga_down.sql (NEUTRO, so catalogo) e,
-- opcional/depois/horario calmo, supabase/rollback/20261103161000_camada_parcela_paga_down_drop.sql. LIFO: 20261103161000_down ANTES do 20261103160000_down.
--   public.fn_servico_parcela_paga_bloqueia_delete()  IDA 8e5618da90c83c2e788e0c9f6f8794ad  NEUTRO 7a6dd9a7e13c300569c162808081bf7f
-- Aplicar fora de transacao: psql -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK (o COMMIT vaza).
SET client_encoding = 'UTF8';
BEGIN;
SET LOCAL lock_timeout = '1500ms';
SET LOCAL transaction_timeout = '30s';

DO $guarda$
DECLARE
  v text;
  n int;
BEGIN
  v := md5(pg_get_functiondef(to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()')));
  IF v IS NOT NULL AND v NOT IN ('8e5618da90c83c2e788e0c9f6f8794ad', '7a6dd9a7e13c300569c162808081bf7f') THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga: public.fn_servico_parcela_paga_bloqueia_delete() com texto inesperado (md5 %) - outra frente mexeu; gere de novo', v USING ERRCODE = 'P0001';
  END IF;
  -- se o gatilho ja existe, e o nosso (mesma funcao, BEFORE DELETE FOR EACH ROW, ligado)
  SELECT count(*) INTO n FROM pg_trigger g WHERE g.tgrelid = 'public.producao_terceirizados'::regclass AND g.tgname = 'trg_servico_parcela_paga_bloqueia_delete'
     AND (g.tgfoid <> to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()') OR g.tgtype <> 11 OR g.tgenabled <> 'O');
  IF n > 0 THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga: gatilho trg_servico_parcela_paga_bloqueia_delete existe com outra definicao' USING ERRCODE = 'P0001';
  END IF;
  -- colunas usadas pela funcao seguem existindo
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND ((table_name = 'parcelas_servico' AND column_name IN ('producao_terceirizado_id', 'status', 'data_pagamento', 'numero_parcela'))
      OR (table_name = 'producao_terceirizados' AND column_name IN ('id', 'categoria_terceirizado_id', 'empresa_id', 'colaborador_id')));
  IF n <> 8 THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga: colunas de parcelas_servico/producao_terceirizados mudaram (% de 8)', n USING ERRCODE = 'P0001';
  END IF;
END
$guarda$;

CREATE OR REPLACE FUNCTION public.fn_servico_parcela_paga_bloqueia_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
-- [camada C1 / P-268 A] (migration 20261103161000) gatilho BEFORE DELETE FOR EACH ROW em producao_terceirizados: excluir um servico
-- que tem parcela PAGA (parcelas_servico status 'pago' OU data_pagamento preenchida - a mesma regra do
-- fn_servico_parcela_valor_pago) = recusa P0001 'servico_com_parcela_paga: <servico>: parcela n, m' (prefixo ASCII; a tela
-- traduz). Sem isto a FK ON DELETE CASCADE levava as parcelas pagas junto, sem trilha. Pega TODO caminho: salvar_terceirizados
-- (que ja recusa antes, com a lista inteira), excluir_cad (cascata do CAD), _reverter_corte_tecido_core, service_role, SQL
-- direto. Fluxo certo: desmarcar o pagamento no Financeiro e entao excluir. Gatilho comum (ENABLE ORIGIN): NAO roda com
-- session_replication_role = replica (_wipe_tenant_core do reset/excluir loja). SECURITY INVOKER (quem apaga servico e o
-- servidor: authenticated nao tem DELETE na tabela).
DECLARE
  v_parcelas text;
  v_rotulo text;
BEGIN
  SELECT string_agg(ps.numero_parcela::text, ', ' ORDER BY ps.numero_parcela) INTO v_parcelas
    FROM public.parcelas_servico ps
   WHERE ps.producao_terceirizado_id = OLD.id
     AND (ps.status = 'pago' OR ps.data_pagamento IS NOT NULL);
  IF v_parcelas IS NULL THEN
    RETURN OLD;
  END IF;
  SELECT concat_ws(' - ', COALESCE(ct.nome, 'sem categoria'), COALESCE(e.nome_fantasia, co.nome)) INTO v_rotulo
    FROM (SELECT 1) x
    LEFT JOIN public.categorias_terceirizado ct ON ct.id = OLD.categoria_terceirizado_id
    LEFT JOIN public.empresas e ON e.id = OLD.empresa_id
    LEFT JOIN public.colaboradores co ON co.id = OLD.colaborador_id;
  RAISE EXCEPTION 'servico_com_parcela_paga: %: parcela %', v_rotulo, v_parcelas USING ERRCODE = 'P0001';
END
$function$;

REVOKE ALL ON FUNCTION public.fn_servico_parcela_paga_bloqueia_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_servico_parcela_paga_bloqueia_delete() TO service_role;

DO $gatilho$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = 'public.producao_terceirizados'::regclass AND g.tgname = 'trg_servico_parcela_paga_bloqueia_delete') THEN
    EXECUTE 'CREATE TRIGGER trg_servico_parcela_paga_bloqueia_delete BEFORE DELETE ON public.producao_terceirizados FOR EACH ROW EXECUTE FUNCTION public.fn_servico_parcela_paga_bloqueia_delete()';
  END IF;
END
$gatilho$;

DO $pos$
DECLARE
  n int;
BEGIN
  IF md5(pg_get_functiondef(to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()'))) IS DISTINCT FROM '8e5618da90c83c2e788e0c9f6f8794ad' THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga: pos-condicao falhou no texto de public.fn_servico_parcela_paga_bloqueia_delete()' USING ERRCODE = 'P0001';
  END IF;
  IF has_function_privilege('anon', 'public.fn_servico_parcela_paga_bloqueia_delete()', 'EXECUTE') OR has_function_privilege('authenticated', 'public.fn_servico_parcela_paga_bloqueia_delete()', 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                 WHERE p.oid = to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()') AND x.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()')
                 AND (p.prosecdef OR coalesce(array_to_string(p.proconfig, '|'), '') <> 'search_path=public')) THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga: pos-condicao falhou na ACL/secdef/search_path de public.fn_servico_parcela_paga_bloqueia_delete()' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO n FROM pg_trigger g WHERE g.tgrelid = 'public.producao_terceirizados'::regclass AND g.tgname = 'trg_servico_parcela_paga_bloqueia_delete'
     AND g.tgfoid = to_regprocedure('public.fn_servico_parcela_paga_bloqueia_delete()') AND g.tgtype = 11 AND g.tgenabled = 'O';
  IF n <> 1 THEN
    RAISE EXCEPTION 'camada_c1_parcela_paga: pos-condicao falhou no gatilho trg_servico_parcela_paga_bloqueia_delete' USING ERRCODE = 'P0001';
  END IF;
END
$pos$;

COMMIT;
