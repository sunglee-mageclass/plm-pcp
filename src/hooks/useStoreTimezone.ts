import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { STORE_TIMEZONE } from "@/lib/timezone";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";

// Fuso horário efetivo da loja, lido de tenant_config.timezone (RLS já filtra
// pelo tenant do usuário). Cai no padrão quando não configurado. Cacheado e
// compartilhado entre todos os consumidores (relógio, badges de prazo, etc.).
export function useStoreTimezone(): string {
  const tenantId = useActiveTenantId();
  const { data } = useQuery({
    queryKey: ["tenant_config", "timezone", tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("timezone").eq("tenant_id", tenantId).maybeSingle();
      return (data as { timezone?: string | null } | null)?.timezone ?? null;
    },
  });
  return data || STORE_TIMEZONE;
}
