import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Rótulos customizados das abas (módulos e páginas) do menu, por loja.
 * Lê tenant_config.tab_labels (JSONB): { [moduleKey|pageKey]: "Nome custom" }.
 */
export function useTabLabels() {
  const { data } = useQuery({
    queryKey: ["tenant_config", "tab_labels"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tab_labels").maybeSingle();
      return ((data as any)?.tab_labels ?? {}) as Record<string, string>;
    },
  });
  return (data ?? {}) as Record<string, string>;
}
