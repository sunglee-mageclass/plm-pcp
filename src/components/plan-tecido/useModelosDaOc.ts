import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Um modelo que usa (reserva) uma OC — GLOBAL (qualquer coleção/subcoleção da loja). `colecao_id`/
 *  `subcolecao` alimentam o deep-link ao clicar no card (→ Plan.Tecido daquele modelo). */
export type ModeloDaOc = {
  modelo_id: string;
  ref: string | null;
  nome: string | null;
  thumb_path: string | null;
  colecao_id: string | null;
  colecao_nome: string | null;
  subcolecao_id: string | null; // uuid p/ o deep-link (?sub= casa contra subcolecao_id, não o nome)
  subcolecao: string | null;    // nome p/ exibir
};

/**
 * Modelos vinculados a uma OC de tecido — escopo GLOBAL (todas as coleções), pra casar com a Reserva
 * do dialog (que já é global). Fonte: RPC `plan_tecido_modelos_da_oc` (união modelo_tecido_oc_links +
 * plan_tecido_slot_oc). `ocId` null = dialog fechado → query desabilitada.
 */
export function useModelosDaOc(ocId: string | null) {
  return useQuery({
    queryKey: ["plan-tecido-modelos-da-oc", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("plan_tecido_modelos_da_oc" as any, { _oc_id: ocId });
      if (error) throw error;
      return (data ?? []) as ModeloDaOc[];
    },
  });
}
