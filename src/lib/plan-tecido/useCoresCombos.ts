import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Combinação cor base + apelido do cadastro — p/ planejar cor SEM variante real (tecido s/ fornecedor). */
export type CorCombo = { cor_id: string; cor_nome: string; cor_apelido_id: string; apelido_nome: string };

export function useCoresCombos() {
  return useQuery({
    queryKey: ["plan-tecido-cores-combos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cores_apelido")
        .select("id, nome, cor_base:cor_base_id(id, nome)")
        .order("nome");
      return ((data ?? []) as unknown as { id: string; nome: string; cor_base: { id: string; nome: string } | null }[])
        .filter((r) => r.cor_base)
        .map((r) => ({ cor_id: r.cor_base!.id, cor_nome: r.cor_base!.nome, cor_apelido_id: r.id, apelido_nome: r.nome })) as CorCombo[];
    },
  });
}
