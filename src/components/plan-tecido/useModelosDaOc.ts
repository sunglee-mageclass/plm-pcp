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
  /** Status do card (R15b L5): o dialog mostra o selo "Reprovado". Lido à parte (a RPC não devolve). */
  status_desenvolvimento?: string | null;
  status_planejamento?: string | null;
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
      const lista = (data ?? []) as ModeloDaOc[];
      // R15b L5: status do card p/ o selo "Reprovado" (a RPC só lista). Falha aqui não derruba a lista.
      const ids = lista.map((m) => m.modelo_id);
      if (!ids.length) return lista;
      const { data: st } = await supabase.from("modelos").select("id, status_desenvolvimento, status_planejamento").in("id", ids);
      type St = { id: string; status_desenvolvimento: string | null; status_planejamento: string | null };
      const porId = new Map(((st ?? []) as St[]).map((r) => [r.id, r]));
      return lista.map((m) => ({
        ...m,
        status_desenvolvimento: porId.get(m.modelo_id)?.status_desenvolvimento ?? null,
        status_planejamento: porId.get(m.modelo_id)?.status_planejamento ?? null,
      }));
    },
  });
}
