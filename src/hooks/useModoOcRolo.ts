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
      const { data, error } = await supabase
        .from("tenant_config")
        .select("modo_oc_rolo")
        .eq("tenant_id", tenantId as string)
        .maybeSingle();
      // [backend F1, review m2] o erro sobe: no refetch o RQ mantém o modo de antes (antes o erro virava "ambos" como se fosse
      // sucesso e esse valor valia por 5 min, mudando a OC Tecido/BOM no meio de uma edição). Na 1ª carga com erro cai em "ambos"
      // (o padrão de sempre, o mais permissivo: mostra OC E rolo — nunca esconde tecido) até a próxima tentativa.
      if (error) throw error;
      return ((data as any)?.modo_oc_rolo as ModoOcRolo) ?? "ambos";
    },
  });
  return data ?? "ambos";
}
