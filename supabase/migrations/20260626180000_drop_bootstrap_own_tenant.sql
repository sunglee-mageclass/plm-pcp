-- Remove a policy "Bootstrap own tenant" (resíduo do signup self-service do Lovable):
-- ela permitia a um usuário autenticado com tenant_id NULL dar INSERT em `tenants`.
-- Hoje o cadastro é por CONVITE (super_admin cria a loja via super_admin_all_tenants),
-- então essa policy é um caminho latente sem uso legítimo. Super_admin continua criando
-- lojas (policy super_admin_all_tenants cobre INSERT). Endurecimento de finalização.
DROP POLICY IF EXISTS "Bootstrap own tenant" ON public.tenants;
