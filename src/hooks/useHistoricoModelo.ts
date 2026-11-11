import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Histórico COMPLETO do produto (F5-3 Task 6) — fonte única: RPC `historico_modelo(_modelo_id)` (Task 4), que devolve a
// timeline única (auditoria da ficha + etapas do kanban) já ORDENADA do mais recente ao mais antigo.
//
// queryKey ["historico-modelo", modeloId]. LANÇA o erro (a tela trata `isError` com "Tentar de novo"; falha de carga nunca vira
// "sem histórico" — regra P-57). `refetchOnMount: "always"` + `gcTime: 0`: o histórico é um retrato do momento (o Sheet só existe
// aberto, `{open && …}`), reabrir sempre relê e nunca mostra o de ontem enquanto carrega.

/** `dados` de um evento de auditoria: diff por campo `{campo: {de, para}}`. */
export type DiffHistorico = Record<string, { de: unknown; para: unknown }>;
/** `dados` de um evento de etapa do kanban. */
export type DadosEtapa = { status?: string | null; origem?: string | null };

export type EventoHistorico = {
  tipo: "audit" | "etapa";
  /** Texto já legível: "Tecidos", "Grade", "Mão de obra", … ou "Etapa" (kanban). */
  entidade: string;
  /** `criar` | `editar` | `excluir` | `resetar` (auditoria) ou `mover` (etapa). */
  acao: string;
  /** Nome de quem fez; `null` nos eventos de etapa (não têm usuário — a origem vem em `dados.origem`). */
  quem: string | null;
  /** ISO timestamptz. */
  quando: string;
  dados: DiffHistorico | DadosEtapa | null;
};

export function useHistoricoModelo(modeloId: string | null | undefined) {
  return useQuery({
    queryKey: ["historico-modelo", modeloId],
    enabled: !!modeloId,
    refetchOnMount: "always",
    gcTime: 0,
    // 1 nova tentativa (aviso em ~1 s, não ~7 s); recusa de permissão/não encontrado não se repete.
    retry: (n, e) => n < 1 && !["42501", "P0002"].includes((e as { code?: string } | null)?.code ?? ""),
    queryFn: async (): Promise<EventoHistorico[]> => {
      const { data, error } = await supabase.rpc("historico_modelo" as any, { _modelo_id: modeloId } as any);
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as EventoHistorico[];
    },
  });
}
