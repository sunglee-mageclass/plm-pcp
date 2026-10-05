import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";

export type ModoOcRolo = "oc" | "rolo" | "ambos";

export type ModoOcRoloEstado = {
  /** O modo da loja; enquanto `pronto` for false vale o padrao 'ambos' (so para EXIBIR, nunca para decidir uma gravacao). */
  modo: ModoOcRolo;
  /** true so quando ja houve uma leitura bem-sucedida de `tenant_config.modo_oc_rolo` (`data` definido; um refetch com erro depois disso mantem true,
   *  pois o RQ guarda o dado anterior — por isso nao e `isSuccess`, que cai para false no refetch com erro). */
  pronto: boolean;
  /** 1a carga falhou (sem dado): o modo e desconhecido, nao 'ambos'. */
  erro: boolean;
  recarregar: () => void;
};

/**
 * Modo de trabalho da loja + se ele ja e CONHECIDO. [backend F2.2 / R7] Quem GRAVA com base no modo (OC Tecido: Salvar /
 * Marcar Recebido decidem rolos x OC) usa `pronto` para nao decidir com o fallback 'ambos' depois de uma 1a carga com erro.
 */
export function useModoOcRoloEstado(): ModoOcRoloEstado {
  const tenantId = useActiveTenantId();
  const { data, isError, refetch } = useQuery({
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
  return { modo: data ?? "ambos", pronto: data !== undefined, erro: isError && data === undefined, recarregar: () => void refetch() };
}

/**
 * Modo de trabalho da loja: OC, Rolo ou ambos (`tenant_config.modo_oc_rolo`).
 * Define quais itens aparecem para vincular tecido no Desenvolvimento.
 * Default 'ambos' (so para exibir; quem grava usa `useModoOcRoloEstado().pronto`).
 */
export function useModoOcRolo(): ModoOcRolo {
  return useModoOcRoloEstado().modo;
}
