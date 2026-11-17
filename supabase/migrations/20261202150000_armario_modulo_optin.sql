-- F7 Armario vira MODULO OPT-IN (default OFF) com flag propria `armario`.
-- O dono pediu um toggle do Armario em Gerenciar Lojas (como otb/produto_acabado/etapas_pl).
-- A "lista opt-in" vive no CORPO de 2 funcoes SQL (nao ha tabela de lista): acrescenta 'armario' ao NOT IN.
-- ESPELHO do front: useTenantModules.DEFAULTS + admin/lojas.tsx MODULE_DEFAULTS (anti-drift: mod-antidrift.test.ts "b").
-- So catalogo (CREATE OR REPLACE das 2 funcoes). Sem DDL de tabela, sem trava alem do catalogo. Idempotente.
-- Aplicar fora de transacao de teste: psql "$(cat /tmp/dburl.txt)" -v ON_ERROR_STOP=1 -f <arquivo>. NUNCA \i dentro de BEGIN...ROLLBACK.
-- Volta: supabase/rollback/20261202150000_armario_modulo_optin_down.sql (reemite as 2 funcoes SEM 'armario').
SET client_encoding = 'UTF8';
BEGIN;

-- 1) tenant_module_enabled(text): regra da loja do usuario (JWT). Acrescenta 'armario' a lista opt-in.
CREATE OR REPLACE FUNCTION public.tenant_module_enabled(_module text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- 'distribuicao' entrou em 20261006100000 (Distribuição por produto): servidor = front (chave ausente = desligado).
  -- ATENÇÃO: toda chave opt-in-default-OFF NOVA precisa entrar nesta lista — espelha
  -- `useTenantModules.DEFAULTS`/`admin/lojas.tsx MODULE_DEFAULTS` no front. Módulos "clássicos"
  -- (criacao, entrada_saida, producao, financeiro, cadastro, dashboard) ficam de fora de
  -- propósito: chave ausente = ON pra eles (loja sem tenant_config não perde os módulos-núcleo).
  SELECT public.is_super_admin() OR COALESCE(
    (SELECT (c.modules ->> _module) = 'true'
       FROM public.tenant_config c
      WHERE c.tenant_id = (SELECT u.tenant_id FROM public.users u WHERE u.id = auth.uid())),
    _module NOT IN ('otb', 'produto_acabado', 'produto_importado', 'distribuicao', 'etapas_pl', 'armario')  -- [F7] armario opt-in
  );
$function$;

-- 2) _tenant_modulo_ligado(uuid, text): regra da LOJA (sem JWT, sem atalho de super). MESMA lista.
CREATE OR REPLACE FUNCTION public._tenant_modulo_ligado(_tenant uuid, _modulo text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- [modularidade T1/M2] o modulo da LOJA (sem JWT, sem atalho de super admin). ESPELHO da regra de tenant_module_enabled:
  -- chave ausente = padrao; opt-in default OFF = a MESMA lista (anti-drift: mod-antidrift.test.ts).
  SELECT COALESCE(
    (SELECT (c.modules ->> _modulo) = 'true' FROM public.tenant_config c WHERE c.tenant_id = _tenant),
    _modulo NOT IN ('otb', 'produto_acabado', 'produto_importado', 'distribuicao', 'etapas_pl', 'armario')
  );
$function$;

-- Grants (CREATE OR REPLACE preserva, mas reaplica p/ o estado ficar explicito e idempotente):
REVOKE EXECUTE ON FUNCTION public.tenant_module_enabled(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._tenant_modulo_ligado(uuid, text) FROM PUBLIC, anon, authenticated;

-- Pos-condicao: as 2 funcoes agora recusam 'armario' sem config (chave ausente = desligado).
DO $pos$
BEGIN
  IF public._tenant_modulo_ligado('00000000-0000-0000-0000-000000000000'::uuid, 'armario') THEN
    RAISE EXCEPTION 'armario_optin: _tenant_modulo_ligado devolveu TRUE para armario sem config (deveria ser opt-in OFF)';
  END IF;
END
$pos$;

COMMIT;
