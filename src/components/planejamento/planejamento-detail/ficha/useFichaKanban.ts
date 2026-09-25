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
import { condProntasFicha, refVisivelFicha, statusEfetivoFicha } from "./etapa-kanban";

export type FichaKanban = {
  kanbanCfg: KanbanAutoConfig;
  revendaCfg: RevendaConfig;
  refExibirStatus: string | null;
  /** Condições do card (RPC avaliar_condicoes_kanban) — {} enquanto não carregou ou fora do kanban. */
  cond: Record<string, boolean>;
  /** Config da loja (`tenant_config`) carregada. */
  cfgPronta: boolean;
  /** Condições carregadas E config da loja carregada (e o card está no kanban). O "Mover
   *  para…" só abre com isto — ver I1 do fix round 1. */
  condProntas: boolean;
  modeloKanban: ModeloKanban;
  statusSalvo: string | null;
  statusEfetivo: string | null;
  /** Só com a chave ligada e as condições carregadas; senão null. */
  derivacao: Derivacao | null;
  refVisivel: boolean;
  isReprovado: boolean;
  /** (Opcional, fix round 2, item 5) — a config da loja OU as condições do card falharam ao
   *  carregar (`isError` das 2 queries). Distingue "ainda carregando" de "não vai carregar
   *  sozinho" pro selo (`EtapaHeader` mostra "erro, recarregue" em vez de um spinner infinito). */
  regrasComErro: boolean;
};

export function useFichaKanban({ modeloId, modeloData, enviada, lancado }: {
  modeloId: string | null;
  modeloData: unknown;
  enviada: boolean;
  lancado: boolean;
}): FichaKanban {
  const tenantId = useActiveTenantId();
  const { data: cfgRow, isSuccess: cfgOk, isError: cfgErro } = useQuery({
    queryKey: ["tenant-plan-ficha-config", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_config").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (error) throw error;
      return (data ?? null) as Record<string, unknown> | null;
    },
  });
  /** Config da loja carregada (mesma régua de "pronto" que `condOk`, mas p/ `tenant_config`). */
  const cfgPronta = !!tenantId && cfgOk;
  const kanbanCfg = useMemo(() => lerKanbanAutoConfig(cfgRow ?? null), [cfgRow]);
  const revendaCfg = useMemo(() => lerRevendaConfig(cfgRow ?? null), [cfgRow]);
  const refExibirStatus = (cfgRow?.ref_exibir_status as string | null | undefined) ?? null;

  const noKanban = !!modeloId && enviada && !lancado;
  const { data: condData, isSuccess: condOk, isError: condErro } = useQuery({
    queryKey: ["plan-kanban-cond", modeloId],
    enabled: noKanban,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("avaliar_condicoes_kanban" as any, { _ids: [modeloId] });
      if (error) throw error;
      return (((data ?? {}) as Record<string, Record<string, boolean>>)[modeloId as string] ?? {}) as Record<string, boolean>;
    },
  });
  const cond = condData ?? {};
  // I1 (fix round 1): ver `condProntasFicha` (etapa-kanban.ts) — precisa das DUAS queries
  // prontas (condições E config da loja), não só das condições.
  const condProntas = condProntasFicha({ noKanban, condOk, cfgOk: cfgPronta });

  const row = (modeloData ?? null) as { origem?: string | null; status_desenvolvimento?: string | null } | null;
  const statusSalvo = row?.status_desenvolvimento ?? null;
  const modeloKanban: ModeloKanban = { origem: row?.origem ?? null, status_desenvolvimento: statusSalvo, ordem_criacao_enviada: enviada, lancado };
  const derivacao = kanbanCfg.kanban_automatico && condProntas ? derivarModelo(modeloKanban, kanbanCfg, cond) : null;
  const statusEfetivo = statusEfetivoFicha(statusSalvo, enviada, kanbanCfg);
  // M3 (fix round 1): o gate da REF usa o status CRU (enviada ? statusSalvo : null), NÃO o
  // status EFETIVO (que já cai na 1ª coluna se nulo/órfão) — mesma fonte do Dev
  // (`ModeloDetailPanel.tsx` `curStatus = (draft?.status_desenvolvimento ?? "").toLowerCase()`)
  // e do SQL (`_ref_exibir_gate(tenant_id, _kanban_status_gate(tenant_id, id,
  // NEW.status_desenvolvimento))`, migration 20260930140000). `statusParaGate` já lida com a
  // posição DERIVADA quando a chave está ligada (decisão 10) — aqui só trocamos a ENTRADA dele.
  const statusCru = enviada ? statusSalvo : null;
  return {
    kanbanCfg, revendaCfg, refExibirStatus, cond, cfgPronta, condProntas, modeloKanban, statusSalvo, statusEfetivo, derivacao,
    refVisivel: refVisivelFicha({ cfg: kanbanCfg, refExibirStatus, statusEfetivo: statusCru, derivacao }),
    // M2 (fix round 1): modelo LANÇADO sai do fluxo normal (vai só pra coluna terminal
    // "Lançado" no board, criacao.desenvolvimento.tsx:538) — nunca é "Reprovado" mesmo que o
    // status salvo/efetivo tenha ficado nessa coluna antes de lançar.
    isReprovado: !lancado && statusEfetivo === "reprovado",
    // (Opcional, fix round 2, item 5) — SÓ enquanto o card está no kanban (`noKanban`): fora dele
    // a query de condições nem roda (`enabled: noKanban`), então `condErro` ficaria sempre false
    // e não deve contar como "erro nas regras" pra um card que nem precisa delas ainda.
    regrasComErro: cfgErro || (noKanban && condErro),
  };
}
