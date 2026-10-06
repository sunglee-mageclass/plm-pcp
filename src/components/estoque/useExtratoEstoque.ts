import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { movDeLinhaRpc, type FamiliaEstoque, type MovEstoque } from "@/lib/estoque-extrato";

// Extrato ("Histórico") do estoque de UM item — urgentes R3 (plano-a Task 16). Fonte ÚNICA: as 3 RPCs de leitura da T14
// (`estoque_extrato_tecido/_aviamento/_insumo`, 177000), 1 chamada por item devolvendo TODOS os buckets dele. O filtro do bucket
// (variante / tamanho×cor) e o saldo corrente são do `montarExtrato`/`filtrarBucket` (src/lib/estoque-extrato.ts), não daqui.
//
// queryKey ["estoque-extrato", familia, itemId] — única por item. `enabled` só com o Sheet aberto (o componente só existe aberto,
// `{open && …}`), `refetchOnMount: "always"` (o extrato é um retrato do momento: reabrir sempre relê) e LANÇA o erro
// (P-57: falha de carga nunca vira "extrato vazio" — o Sheet mostra o aviso + "Tentar de novo").

/** Nome da RPC e do parâmetro, por família (o parâmetro é o id do ITEM, não do bucket). */
export const RPC_EXTRATO: Record<FamiliaEstoque, { fn: string; arg: string }> = {
  tecido: { fn: "estoque_extrato_tecido", arg: "_variante_tecido_id" },
  aviamento: { fn: "estoque_extrato_aviamento", arg: "_aviamento_id" },
  insumo: { fn: "estoque_extrato_insumo", arg: "_etiqueta_id" },
};

export function useExtratoEstoque(familia: FamiliaEstoque, itemId: string, enabled = true) {
  return useQuery({
    queryKey: ["estoque-extrato", familia, itemId],
    enabled: enabled && !!itemId,
    refetchOnMount: "always",
    gcTime: 0, // sem cache entre aberturas: nunca mostra o extrato de ontem enquanto relê
    // 1 nova tentativa (aviso em ~1 s, não ~7 s); recusa de permissão não se repete.
    retry: (n, e) => n < 1 && (e as { code?: string } | null)?.code !== "42501",
    queryFn: async (): Promise<MovEstoque[]> => {
      const { fn, arg } = RPC_EXTRATO[familia];
      const { data, error } = await supabase.rpc(fn as any, { [arg]: itemId } as any);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(movDeLinhaRpc);
    },
  });
}
