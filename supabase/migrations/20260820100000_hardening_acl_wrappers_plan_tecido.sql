-- Hardening de ACL (invariante #9): wrappers de LEITURA do Plan. Tecido nasceram com
-- EXECUTE p/ PUBLIC (default do Postgres) → anon herda. Não explorável hoje (SECURITY DEFINER
-- + get_user_tenant_id() devolve a sentinela nil p/ anon → o gate `tenant_id IS DISTINCT FROM
-- get_user_tenant_id()` dá RAISE 42501), mas é o "anon=true LATENTE" que 20260814110000 já
-- fechou p/ plan_tecido_aplicar_ao_modelo — mesma classe, mesma correção.
-- Achado da revisão da campanha (ago/2026): plan_tecido_fases confirmado; previa_pedido e
-- situacao_ocs são irmãos idênticos, fechados na mesma leva (fix da CLASSE, não só da instância).
-- Os respectivos _core já estão revogados dos três (verificado). Idempotente.

revoke execute on function public.plan_tecido_fases(uuid) from public, anon;
grant execute on function public.plan_tecido_fases(uuid) to authenticated;

revoke execute on function public.plan_tecido_previa_pedido(uuid) from public, anon;
grant execute on function public.plan_tecido_previa_pedido(uuid) to authenticated;

revoke execute on function public.plan_tecido_situacao_ocs(uuid) from public, anon;
grant execute on function public.plan_tecido_situacao_ocs(uuid) to authenticated;
