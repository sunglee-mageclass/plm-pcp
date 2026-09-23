/**
 * F3.1 — etapa do card no Sheet unificado: config do kanban da loja + condições do card (estado SALVO) +
 * derivados (coluna efetiva, gate do campo REF, Reprovado). Independe da F2: lê `tenant_config` com
 * `select("*")` (sem a F1 aplicada, `kanban_automatico` vem ausente ⇒ chave desligada — mesmo padrão do
 * useKanbanConfig da F2) sob key PRÓPRIA (contém "tenant" ⇒ o save da Config e o realtime invalidam).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import {
  derivarModelo, lerKanbanAutoConfig, type Derivacao, type KanbanAutoConfig, type ModeloKanban,
} from "@/lib/kanban-auto";
import { lerRevendaConfig, type RevendaConfig } from "@/lib/revenda-config";
import { refVisivelFicha, statusEfetivoFicha } from "./etapa-kanban";

export type FichaKanban = {
  kanbanCfg: KanbanAutoConfig;
  revendaCfg: RevendaConfig;
  refExibirStatus: string | null;
  /** Condições do card (RPC avaliar_condicoes_kanban) — {} enquanto não carregou ou fora do kanban. */
  cond: Record<string, boolean>;
  /** Condições carregadas (e o card está no kanban). O "Mover para…" só abre com isto. */
  condProntas: boolean;
  modeloKanban: ModeloKanban;
  statusSalvo: string | null;
  statusEfetivo: string | null;
  /** Só com a chave ligada e as condições carregadas; senão null. */
  derivacao: Derivacao | null;
  refVisivel: boolean;
  isReprovado: boolean;
};

export function useFichaKanban({ modeloId, modeloData, enviada, lancado }: {
  modeloId: string | null;
  modeloData: unknown;
  enviada: boolean;
  lancado: boolean;
}): FichaKanban {
  const tenantId = useActiveTenantId();
  const { data: cfgRow } = useQuery({
    queryKey: ["tenant-plan-ficha-config", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
  });
  const kanbanCfg = useMemo(() => lerKanbanAutoConfig(cfgRow ?? null), [cfgRow]);
  const revendaCfg = useMemo(() => lerRevendaConfig(cfgRow ?? null), [cfgRow]);
  const refExibirStatus = (cfgRow?.ref_exibir_status as string | null | undefined) ?? null;

  const noKanban = !!modeloId && enviada && !lancado;
  const { data: condData, isSuccess } = useQuery({
    queryKey: ["plan-kanban-cond", modeloId],
    enabled: noKanban,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("avaliar_condicoes_kanban" as any, { _ids: [modeloId] });
      if (error) throw error;
      return (((data ?? {}) as Record<string, Record<string, boolean>>)[modeloId as string] ?? {}) as Record<string, boolean>;
    },
  });
  const cond = condData ?? {};
  const condProntas = noKanban && isSuccess;

  const row = (modeloData ?? null) as { origem?: string | null; status_desenvolvimento?: string | null } | null;
  const statusSalvo = row?.status_desenvolvimento ?? null;
  const modeloKanban: ModeloKanban = { origem: row?.origem ?? null, status_desenvolvimento: statusSalvo, ordem_criacao_enviada: enviada, lancado };
  const derivacao = kanbanCfg.kanban_automatico && condProntas ? derivarModelo(modeloKanban, kanbanCfg, cond) : null;
  const statusEfetivo = statusEfetivoFicha(statusSalvo, enviada, kanbanCfg);
  return {
    kanbanCfg, revendaCfg, refExibirStatus, cond, condProntas, modeloKanban, statusSalvo, statusEfetivo, derivacao,
    refVisivel: refVisivelFicha({ cfg: kanbanCfg, refExibirStatus, statusEfetivo, derivacao }),
    isReprovado: statusEfetivo === "reprovado",
  };
}
