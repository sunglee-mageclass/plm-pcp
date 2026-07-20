import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ReverterImpacto = {
  servicos: number;
  contas: number;
  contasPagas: number;
  cq: number;
  temPaga: boolean;
};

/**
 * Impacto de "Voltar uma etapa" (reverter o corte → Explosão): o que será desfeito.
 * Serviços, contas a pagar (parcelas_servico) e CQ do CAD. Se houver conta PAGA, o
 * reverter é bloqueado no servidor — a UI usa `temPaga` para avisar/desabilitar.
 */
export function useReverterImpacto(cadId: string | undefined, enabled: boolean) {
  return useQuery<ReverterImpacto>({
    queryKey: ["reverter-impacto", cadId],
    enabled: !!cadId && enabled,
    queryFn: async () => {
      const { data: terc } = await supabase
        .from("producao_terceirizados")
        .select("id")
        .eq("cad_id", cadId!);
      const tercIds = (terc ?? []).map((r: any) => r.id as string);

      const { count: cqCount } = await supabase
        .from("controle_qualidade")
        .select("id", { count: "exact", head: true })
        .eq("cad_id", cadId!);

      let contas: any[] = [];
      if (tercIds.length > 0) {
        const { data } = await supabase
          .from("parcelas_servico")
          .select("status")
          .in("producao_terceirizado_id", tercIds);
        contas = data ?? [];
      }

      return {
        servicos: tercIds.length,
        contas: contas.length,
        contasPagas: contas.filter((c) => c.status === "pago").length,
        cq: cqCount ?? 0,
        temPaga: contas.some((c) => c.status === "pago"),
      };
    },
  });
}
