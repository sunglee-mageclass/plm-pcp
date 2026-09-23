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
 * caminho de hoje. Erro de rede também degrada `ligado` para desligado (o servidor ainda protege: guard
 * da F1) — mas `isError` fica exposto para quem precisa DISTINGUIR "desligada de verdade" de "não sei
 * ainda" (Médio 2: o QUADRO do Desenvolvimento trava o arraste enquanto `isError`/`carregando`, em vez
 * de assumir desligada; o selo do Planejamento não precisa dessa distinção e segue lendo só `ligado`).
 * queryKey começa com "tenant-" ⇒ casa `matchTenantConfig` (save da Config + realtime invalidam).
 */
export function useKanbanConfig(): {
  cfg: KanbanAutoConfig; ligado: boolean; motorDisponivel: boolean; carregando: boolean; isError: boolean;
} {
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
  // Médio 2 (revisão final Opus): `isError` exposto p/ o QUADRO (Desenvolvimento) travar o arraste
  // (`podeMover=false`) enquanto a chave não foi lida com SUCESSO — sem isso, uma falha de rede aqui
  // faz `ligado` cair pra `false` (config vazia) e a tela volta ao caminho de hoje SEM avisar que a
  // chave pode estar ligada de verdade no servidor (arrastar um card poderia então ir por um caminho
  // que a RPC recusa, ou pior, um caminho que ela aceita sem as travas visuais da chave ligada).
  return {
    cfg, ligado: cfg.kanban_automatico, motorDisponivel: motorKanbanDisponivel(q.data),
    carregando: q.isPending, isError: q.isError, // isPending: cobre também a janela com a query desabilitada (tenantId ainda "")
  };
}
