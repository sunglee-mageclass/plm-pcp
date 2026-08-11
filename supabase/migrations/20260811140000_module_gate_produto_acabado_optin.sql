-- Fix round do FF2 (Revenda, ago/2026) — HIGH confirmado pelo reviewer com evidência ao
-- vivo: `tenant_module_enabled` (20260710140000_module_gate_optin.sql) só trata `otb`
-- como opt-in-default-OFF no fallback (`COALESCE(..., _module <> 'otb')`). Pra
-- `produto_acabado`, um tenant SEM a chave explícita em `tenant_config.modules` (ex.:
-- "Controle de Estoque"/"French"/"Mun", e QUALQUER loja nova — `NovaLojaModal` só insere
-- em `tenants`, não semeia `tenant_config`) recebe TRUE nesse fallback — falha ABERTA.
-- Isso furava tanto as policies RESTRICTIVE do FF2 (20260811110000) quanto TODOS os
-- wrappers da feature que chamam `tenant_module_enabled('produto_acabado')`
-- (estoque_p_acabado, salvar_oc_p_acabado, etc.) — o front mostra OFF (useTenantModules.
-- DEFAULTS) mas o servidor considerava ON.
--
-- Fix: `produto_acabado` entra na mesma lista de módulos opt-in-default-OFF do fallback.
-- Único trecho alterado é o literal do fallback (`_module <> 'otb'` →
-- `_module NOT IN ('otb','produto_acabado')`) — diff-validado abaixo antes de aplicar
-- (nada mais muda: mesma assinatura, mesmo corpo STABLE SECURITY DEFINER, mesmo
-- search_path, mesmo is_super_admin()/COALESCE por cima).
--
-- Não precisa semear tenant_config nas lojas existentes: o fallback corrigido já cobre
-- (chave ausente agora nega os 2 módulos opt-in, não só otb). NovaLojaModal continua sem
-- semear tenant_config nesta rodada (ver observação no report da FF).
create or replace function public.tenant_module_enabled(_module text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- ATENÇÃO: toda chave opt-in-default-OFF NOVA (ex.: um módulo futuro que nasça
  -- desligado) precisa entrar nesta lista — espelha `useTenantModules.DEFAULTS`/
  -- `admin/lojas.tsx MODULE_DEFAULTS` no front. Módulos "clássicos" (criacao,
  -- entrada_saida, producao, financeiro, cadastro, dashboard) ficam de fora de
  -- propósito: chave ausente = ON pra eles (comportamento histórico, loja sem
  -- tenant_config nunca deveria perder acesso aos módulos-núcleo).
  SELECT public.is_super_admin() OR COALESCE(
    (SELECT (c.modules ->> _module) = 'true'
       FROM public.tenant_config c
      WHERE c.tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())),
    _module NOT IN ('otb', 'produto_acabado')
  );
$function$;

-- Re-afirma os GRANTs (CREATE OR REPLACE preserva ACL na prática, mas este helper é
-- chamado direto por clientes autenticados — restatar defensivamente, espelhando o
-- estado conferido antes desta migração: anon/authenticated/service_role com EXECUTE).
GRANT EXECUTE ON FUNCTION public.tenant_module_enabled(text) TO anon, authenticated, service_role;
