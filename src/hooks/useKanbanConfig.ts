import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { lerKanbanAutoConfig, type KanbanAutoConfig } from "@/lib/kanban-auto";
import { motorKanbanDisponivel } from "@/lib/kanban-auto-ui";

/**
 * Config do Kanban automático da loja ATIVA (F2): board, requisitos, exceções, fluxo de revenda e a chave.
 * `select("*")` DE PROPÓSITO: antes da F1 ser aplicada a coluna `kanban_automatico` não existe — pedi-la
 * pelo nome daria 42703 e quebraria a tela; com `*` ela só vem AUSENTE ⇒ `ligado=false` ⇒ a tela segue o
 * caminho de hoje. Erro de rede também degrada para desligado (o servidor ainda protege: guard da F1).
 * queryKey começa com "tenant-" ⇒ casa `matchTenantConfig` (save da Config + realtime invalidam).
 */
export function useKanbanConfig(): { cfg: KanbanAutoConfig; ligado: boolean; motorDisponivel: boolean; carregando: boolean } {
  const tenantId = useActiveTenantId();
  const q = useQuery({
    queryKey: ["tenant-kanban-auto", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
  });
  const cfg = useMemo(() => lerKanbanAutoConfig(q.data ?? null), [q.data]);
  return { cfg, ligado: cfg.kanban_automatico, motorDisponivel: motorKanbanDisponivel(q.data), carregando: q.isLoading };
}
