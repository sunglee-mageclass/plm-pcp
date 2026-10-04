import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * tenant_id ATIVO do usuário (public.users.tenant_id) — para o super_admin é a
 * loja "em visualização" escolhida no TenantSwitcher. Serve para CHAVEAR as
 * queries de identidade da loja (módulos, abas, fuso, posição da oficina) por
 * tenant: ao trocar de loja, a key muda e a query refaz o fetch da loja nova,
 * sem reaproveitar o cache da loja anterior (era o motivo da sidebar não
 * respeitar as toggles ao trocar de loja).
 */
export function useActiveTenant(): { tenantId: string; resolvido: boolean } {
  const { user, loading } = useAuth();
  const { data, status } = useQuery({
    queryKey: ["active-tenant-id", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("users").select("tenant_id").eq("id", user!.id).maybeSingle();
      return data?.tenant_id ?? "";
    },
  });
  // Sentinela "" quando sem usuário/tenant — todas as queries usam `enabled: !!tenantId`,
  // então o `.eq("tenant_id", "")` nunca chega a executar. Mantemos tipo `string` para
  // satisfazer as assinaturas tipadas do Supabase (que não aceitam null em .eq()).
  const tenantId = (data as string | undefined) ?? "";
  // `resolvido` [modularidade F1, parte 1]: a auth terminou E (não há usuário OU a query do tenant já saiu de
  // "pending" — sucesso ou erro). Antes desse ponto `tenantId === ""` NÃO significa "sem loja", significa "ainda não
  // sei" — quem decidia por ele (módulos nos DEFAULTS) redirecionava por engano numa URL direta.
  const resolvido = !loading && (!user?.id || status !== "pending");
  return { tenantId, resolvido };
}

export function useActiveTenantId(): string {
  return useActiveTenant().tenantId;
}
