// F5-2 "Grade por fase" (Task 5) — leitura do comparativo Programada | CAD | PCP | CQ (RPC `grade_comparativo`) e gravação da
// Programada (RPC `salvar_grade_programada`, rev otimista). queryKey ["grade-comparativo", modeloId]; só roda quando o card já
// passou da Ordem de Criação (antes dela não há Programada nem as outras fases).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { GradeComparativoResp } from "@/lib/grade-comparativo";

export const GRADE_COMPARATIVO_KEY = "grade-comparativo";

export function useGradeComparativo(modeloId: string | null | undefined, ordemEnviada: boolean) {
  return useQuery({
    queryKey: [GRADE_COMPARATIVO_KEY, modeloId],
    enabled: !!modeloId && ordemEnviada,
    // Sempre relê ao abrir/foco: as outras fases (CAD/PCP/CQ) mudam em outras telas.
    staleTime: 0,
    queryFn: async (): Promise<GradeComparativoResp> => {
      const { data, error } = await supabase.rpc("grade_comparativo" as any, { _modelo_id: modeloId as string });
      if (error) throw error;
      return (data ?? { variantes: [], tamanhos: [], celulas: {} }) as GradeComparativoResp;
    },
  });
}

export type GradeProgramadaPayload = { variante_numero: number; grades: Record<string, number> }[];

/** Grava a Programada (só das variantes enviadas). `revBase` = rev do card que a tela leu — NUNCA null (P0409 se mudou).
 *  O trigger de filhas sobe o `rev` do card: invalida ["modelo", id] (o Sheet re-hidrata o rev) e o comparativo. */
export function useSalvarGradeProgramada(modeloId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ grades, revBase }: { grades: GradeProgramadaPayload; revBase: number }) => {
      const { error } = await supabase.rpc("salvar_grade_programada" as any, {
        _modelo_id: modeloId as string, _grades: grades, _rev_base: revBase,
      });
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [GRADE_COMPARATIVO_KEY, modeloId] });
      qc.invalidateQueries({ queryKey: ["modelo", modeloId] });
    },
  });
}
