-- FF2 (fast-follow Revenda, ago/2026): fecha o gap conhecido/aceito da invariante 13
-- (CLAUDE.md) — as 3 tabelas da feature Produto Acabado (`produtos_acabados`,
-- `produto_acabado_variantes`, `ocs_p_acabado`) tinham só RLS tenant-scoped (igual
-- `otb`), sem policy `modgate_*` RESTRICTIVE de `tenant_module_enabled('produto_acabado')`.
-- Módulo OFF era enforçado só nos WRAPPERS de escrita (invariante 9) e por empty-state
-- na UI — leitura direta via REST/embed (alguém montando a query à mão) NÃO era
-- bloqueada no banco.
--
-- Diferente do modgate "clássico" (`20260622120000_enforce_modulo_rls.sql`,
-- `20260717110000_financeiro_hardening.sql` em `parcelas_servico`), que só cobre
-- INSERT/UPDATE/DELETE (reads não eram afetados — módulos "sempre tiveram" tenant_config,
-- então SELECT nunca precisou de gate extra), esta migração é um MODGATE DE LEITURA: como
-- `produto_acabado` é opt-in (default OFF só no FRONT — `useTenantModules.DEFAULTS`/
-- `admin/lojas.tsx MODULE_DEFAULTS`; não há enforcement de "off por padrão" no banco), o
-- objetivo aqui é impedir leitura direta quando o módulo está desligado na loja, também.
--
-- Predicado espelhado BYTE-A-BYTE do que já protege `parcelas_servico` (financeiro) e,
-- mais perto ainda, do que os wrappers desta própria feature já usam internamente
-- (`estoque_p_acabado`, `salvar_oc_p_acabado`, etc. — ver `20260807150000`/`170000`):
-- `tenant_module_enabled('produto_acabado')`. Essa função já embute o tratamento de
-- super_admin (`is_super_admin() OR COALESCE(...)`) — não há tratamento adicional a
-- espelhar além de chamar a mesma função.
--
-- RPCs SECURITY DEFINER continuam funcionando: as 3 tabelas são owned by `postgres`
-- (mesmo dono das funções DEFINER) e NÃO têm FORCE ROW LEVEL SECURITY — o Postgres
-- isenta o dono da tabela do RLS por padrão, então os `_core` (chamados só depois do
-- wrapper já ter checado `tenant_module_enabled`) seguem lendo/escrevendo normalmente;
-- só sessões `authenticated`/`anon` batendo direto nas tabelas via PostgREST são pegas
-- pelas policies novas. Validado em BEGIN/ROLLBACK (ver relatório da FF).

DO $modgate_leitura$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['produtos_acabados','produto_acabado_variantes','ocs_p_acabado'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS modgate_sel ON public.%I', v_tbl);
    EXECUTE format('CREATE POLICY modgate_sel ON public.%I AS RESTRICTIVE FOR SELECT USING (public.tenant_module_enabled(%L))', v_tbl, 'produto_acabado');
    EXECUTE format('DROP POLICY IF EXISTS modgate_ins ON public.%I', v_tbl);
    EXECUTE format('CREATE POLICY modgate_ins ON public.%I AS RESTRICTIVE FOR INSERT WITH CHECK (public.tenant_module_enabled(%L))', v_tbl, 'produto_acabado');
    EXECUTE format('DROP POLICY IF EXISTS modgate_upd ON public.%I', v_tbl);
    EXECUTE format('CREATE POLICY modgate_upd ON public.%I AS RESTRICTIVE FOR UPDATE USING (public.tenant_module_enabled(%L))', v_tbl, 'produto_acabado');
    EXECUTE format('DROP POLICY IF EXISTS modgate_del ON public.%I', v_tbl);
    EXECUTE format('CREATE POLICY modgate_del ON public.%I AS RESTRICTIVE FOR DELETE USING (public.tenant_module_enabled(%L))', v_tbl, 'produto_acabado');
  END LOOP;
END
$modgate_leitura$;
