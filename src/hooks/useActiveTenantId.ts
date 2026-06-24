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
export function useActiveTenantId(): string {
  const { user } = useAuth();
  const { data } = useQuery({
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
  return (data as string | undefined) ?? "";
}
