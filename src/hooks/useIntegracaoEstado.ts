// Integração — estado de integração dos produtos da loja para os selos/travas das outras telas (F4). UMA consulta por loja
// (integracao_estado_modelos(NULL): só integráveis/integrados; nada de retrato nem custo), compartilhada por todas as telas
// (Sheet do Planejamento, card do Plan. Produto, Produto Acabado/Importado, Plan. Tecido). Antes da ida em produção a RPC não
// existe: sem retry, cai em {} (nenhuma trava na tela — o banco ainda não trava nada).
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { lerEstados, type EstadoModeloIntegracao } from "@/lib/integracao/trava";

const SEM_ESTADOS: Record<string, EstadoModeloIntegracao> = {};

function useIntegracaoEstadosQuery(
  o?: {
    /** Fix round 1 (m2/M-1), OPT-IN a partir do round 3 (R-6 da re-revisão) — a trava pode ficar até 30s velha
     *  quando o Sheet abre (outro usuário marcou o produto há pouco): `true` refaz a busca a CADA montagem do
     *  consumidor, sem esperar o staleTime vencer. Só o Sheet do Planejamento (quem de fato TRAVA campos e
     *  bloqueia Salvar) passa `true` — os outros consumidores (card do Plan. Produto, Produto Acabado/
     *  Importado, slot do Plan.Tecido, e o Dialog "Novo card") ficam com o default (staleTime de 30s), porque
     *  são MUITOS mounts por navegação (filtro, colapsar grupo, trocar de aba) e cada `refetchOnMount: "always"`
     *  dispara um RPC cheio (`_ids: null`, até 5000 linhas) por montagem — o Sheet é 1 card por vez, os outros
     *  não. O banco continua sendo o guardião real (42501) nos dois casos; isto só afeta o quão rápido a TELA
     *  reflete um lock recente. */
    sempreAoAbrir?: boolean;
  } | null,
) {
  const tenantId = useActiveTenantId();
  return useQuery({
    queryKey: ["integracao-estado", tenantId],
    enabled: !!tenantId,
    staleTime: 30_000,
    refetchOnMount: o?.sempreAoAbrir ? "always" : undefined,
    retry: false,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: d, error } = await supabase.rpc("integracao_estado_modelos" as any, {
        _ids: null,
      });
      if (error) throw error;
      return lerEstados(d);
    },
  });
}

export function useIntegracaoEstados(
  o?: Parameters<typeof useIntegracaoEstadosQuery>[0],
): Record<string, EstadoModeloIntegracao> {
  return useIntegracaoEstadosQuery(o).data ?? {};
}

/**
 * Mesma consulta (mesma queryKey/cache), MAS com o sinal que `useIntegracaoEstados` não dá: `pronto` = o estado da loja JÁ chegou
 * (`data !== undefined` — um refetch com erro mantém o último dado bom, então NÃO volta a "não pronto"). Quem TRAVA campos por produto
 * (a grade "Lista" do Planejamento) espera `pronto` antes de habilitar uma célula travável: `{}` de "ainda carregando" não pode
 * parecer "nenhum produto travado". `erro` = a 1ª carga falhou (sem dado nenhum): as travas seguem bloqueadas + "Tentar de novo".
 */
export function useIntegracaoEstadosCarregados(
  o?: Parameters<typeof useIntegracaoEstadosQuery>[0],
): {
  estados: Record<string, EstadoModeloIntegracao>;
  pronto: boolean;
  erro: boolean;
  recarregando: boolean;
  recarregar: () => Promise<unknown>;
} {
  const q = useIntegracaoEstadosQuery(o);
  return {
    estados: q.data ?? SEM_ESTADOS,
    pronto: q.data !== undefined,
    erro: q.isError && q.data === undefined,
    recarregando: q.isError && q.isFetching,
    recarregar: () => q.refetch(),
  };
}

export function useIntegracaoEstado(
  modeloId: string | null | undefined,
  o?: { sempreAoAbrir?: boolean } | null,
): EstadoModeloIntegracao | null {
  const estados = useIntegracaoEstados(o);
  return modeloId ? (estados[modeloId] ?? null) : null;
}
