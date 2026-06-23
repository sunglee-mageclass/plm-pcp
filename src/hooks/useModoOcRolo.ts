import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";

export type ModoOcRolo = "oc" | "rolo" | "ambos";

/**
 * Modo de trabalho da loja: OC, Rolo ou ambos (`tenant_config.modo_oc_rolo`).
 * Define quais itens aparecem para vincular tecido no Desenvolvimento.
 * Default 'ambos'.
 */
export function useModoOcRolo(): ModoOcRolo {
  const tenantId = useActiveTenantId();
  const { data } = useQuery({
    queryKey: ["tenant_config", "modo_oc_rolo", tenantId],
    enabled: !!tenantId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("tenant_config")
        .select("modo_oc_rolo")
        .eq("tenant_id", tenantId as string)
        .maybeSingle();
      return ((data as any)?.modo_oc_rolo as ModoOcRolo) ?? "ambos";
    },
  });
  return data ?? "ambos";
}
