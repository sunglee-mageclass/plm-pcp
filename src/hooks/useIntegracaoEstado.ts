// Integração — estado de integração dos produtos da loja para os selos/travas das outras telas (F4). UMA consulta por loja
// (integracao_estado_modelos(NULL): só integráveis/integrados; nada de retrato nem custo), compartilhada por todas as telas
// (Sheet do Planejamento, card do Plan. Produto, Produto Acabado/Importado, Plan. Tecido). Antes da ida em produção a RPC não
// existe: sem retry, cai em {} (nenhuma trava na tela — o banco ainda não trava nada).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { lerEstados, type EstadoModeloIntegracao } from "@/lib/integracao/trava";

export function useIntegracaoEstados(): Record<string, EstadoModeloIntegracao> {
  const tenantId = useActiveTenantId();
  const { data } = useQuery({
    queryKey: ["integracao-estado", tenantId],
    enabled: !!tenantId,
    staleTime: 30_000,
    // Fix round 1 (m2/M-1 das revisões) — a trava pode ficar até 30s velha quando o Sheet abre (outro usuário
    // marcou o produto há pouco): "always" refaz a busca a CADA montagem do consumidor (o Sheet do Planejamento
    // remonta por card aberto), sem esperar o staleTime vencer. O cache/staleTime entre telas que já estão
    // montadas ao mesmo tempo continua compartilhado (mesma queryKey) — só a MONTAGEM força um refetch.
    refetchOnMount: "always",
    retry: false,
    queryFn: async () => {
      const { data: d, error } = await supabase.rpc("integracao_estado_modelos" as any, { _ids: null });
      if (error) throw error;
      return lerEstados(d);
    },
  });
  return data ?? {};
}
export function useIntegracaoEstado(modeloId: string | null | undefined): EstadoModeloIntegracao | null {
  const estados = useIntegracaoEstados();
  return modeloId ? (estados[modeloId] ?? null) : null;
}
