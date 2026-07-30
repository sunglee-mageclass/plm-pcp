import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Contadores de atenção (RPC `sidebar_badges`) — FONTE ÚNICA das bolinhas da sidebar E
 * dos cards da Home. A queryKey é compartilhada de propósito: os DOIS consumidores usam
 * ESTE hook (mesma queryFn/shape — ver regra de queryKey compartilhada no CLAUDE.md).
 * Chaves: prontos_lancar, alertas_tecido, oc_tecido_atrasada, oc_aviamento_atrasada,
 * oc_etiqueta_atrasada, otb_divergencia, erro_cq, erro_direcionamento, erro_terceirizados.
 * Invalidada por Lançar/alertas/OC; rede de segurança a cada 60s.
 */
export function useSidebarBadges() {
  return useQuery({
    queryKey: ["sidebar-badges"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("sidebar_badges" as any);
      if (error) throw error;
      return (data ?? {}) as Record<string, number>;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
