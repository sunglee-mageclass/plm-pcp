import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { lerEtapasPlConfig, type EtapasPlConfig } from "@/lib/etapas-pl-config";
import { motorEtapasPlDisponivel } from "@/lib/etapas-pl-ui";

/**
 * Config do kanban PL (Etapas PL) da loja ATIVA: board, requisitos e a chave do modo automático.
 * `select("*")` DE PROPÓSITO (como `useKanbanConfig`): se a coluna ainda não existir ela só vem AUSENTE ⇒
 * `ligado=false` / board vazio ⇒ a tela segue o caminho de hoje, sem 42703. `isError` fica exposto para quem
 * precisa distinguir "desligada de verdade" de "não sei ainda" (o quadro trava o arraste enquanto isso).
 * `motorDisponivel` = há board PL configurado (board vazio = inércia, NÃO o board do Dev).
 * queryKey começa com "tenant-" ⇒ casa `matchTenantConfig` (save da Config + realtime invalidam).
 */
export function useEtapasPlConfig(): {
  cfg: EtapasPlConfig; ligado: boolean; motorDisponivel: boolean; carregando: boolean; isError: boolean;
} {
  const tenantId = useActiveTenantId();
  const q = useQuery({
    queryKey: ["tenant-etapas-pl", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
  });
  const cfg = useMemo(() => lerEtapasPlConfig(q.data ?? null), [q.data]);
  return {
    cfg, ligado: cfg.automatico, motorDisponivel: motorEtapasPlDisponivel(cfg),
    carregando: q.isPending, isError: q.isError, // isPending: cobre a janela com a query desabilitada (tenantId ainda "")
  };
}
