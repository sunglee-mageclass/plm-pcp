import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";

export const DEFAULT_FIELD_LABELS = {
  colecao: "Coleção",
  ref: "REF",
  estilista: "Estilista",
  modelista: "Modelista",
  piloteiro: "Piloteiro",
  linha: "Linha",
} as const;

export type FieldKey = keyof typeof DEFAULT_FIELD_LABELS;

/**
 * Lê tenant_config.campos_editaveis (JSONB) e devolve o rótulo customizado
 * de cada campo, com fallback para o nome padrão.
 *
 * Uso: const labels = useFieldLabels(); labels("colecao") -> "Drop" ou "Coleção".
 */
export function useFieldLabels() {
  const tenantId = useActiveTenantId();
  const { data } = useQuery({
    queryKey: ["tenant_config", "campos_editaveis", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_config")
        .select("campos_editaveis")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      return (data?.campos_editaveis ?? {}) as Record<string, string>;
    },
    staleTime: 5 * 60_000,
  });

  const custom = data ?? {};

  return function label(key: FieldKey): string {
    const v = custom[key];
    return (typeof v === "string" && v.trim()) || DEFAULT_FIELD_LABELS[key];
  };
}
