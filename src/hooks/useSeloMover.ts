// F4a T1 — fonte única do selo + opções + mover POR CARD, em modo LOTE (PA/PI): a tela carrega `cfg` e as
// condições (1 chamada `avaliar_condicoes_kanban` por coleção) UMA vez e passa o recorte de cada card aqui.
// NÃO reimplementa requisito: usa `etapaDoModelo` (selo), `opcoesMoverAuto`/`opcoesMoverHoje` (destinos) e
// `useMoverEtapa` (RPC `kanban_mover` / UPDATE de hoje) — o mesmo fio do Sheet do Planejamento.
// Não toca as queryKeys por-modelo do `useFichaKanban` (`tenant-plan-ficha-config`, `plan-kanban-cond`): cada
// tela (PA/PI) tem as suas (`pa-kanban-config`/`pa-kanban-cond`, `pi-…`) e passa em `invalidar` o que precisa
// reler depois de mover.
import { useMemo } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { etapaDoModelo, type EtapaSelo } from "@/lib/kanban-auto-ui";
import { opcoesMoverHoje, statusEfetivoFicha } from "@/components/planejamento/planejamento-detail/ficha/etapa-kanban";
import { opcoesMoverAuto } from "@/components/planejamento/planejamento-detail/ficha/etapa-mover";
import { useMoverEtapa } from "@/components/planejamento/planejamento-detail/ficha/useMoverEtapa";
import type { KanbanAutoConfig, ModeloKanban } from "@/lib/kanban-auto";

/** Modo LOTE (PA/PI): cfg e cond já carregados pela tela (1 chamada/coleção). Retorna o que o
 *  `MoverEtapaMenu` precisa. */
export function useSeloMoverLote(o: {
  modeloId: string | null;
  /** `modeloKanbanDoEmbed(...)` */
  modelo: ModeloKanban;
  cfg: KanbanAutoConfig;
  /** `mapaCond[modeloId] ?? {}` */
  cond: Record<string, boolean>;
  /** cfg carregada E cond em lote carregada */
  prontas: boolean;
  tenantId?: string | null;
  /** queryKeys da TELA a reler depois de mover (lista + condições em lote). */
  invalidar?: QueryKey[];
}) {
  const qc = useQueryClient();
  const selo: EtapaSelo = useMemo(() => etapaDoModelo(o.modelo, o.cfg), [o.modelo, o.cfg]);
  const statusEfetivo = useMemo(
    () => statusEfetivoFicha(o.modelo.status_desenvolvimento, o.modelo.ordem_criacao_enviada === true, o.cfg),
    [o.modelo, o.cfg],
  );
  const opcoes = useMemo(() => {
    if (!o.prontas || selo.fase !== "kanban") return [];
    return o.cfg.kanban_automatico
      ? opcoesMoverAuto({ modelo: o.modelo, statusEfetivo, cfg: o.cfg, cond: o.cond })
      : opcoesMoverHoje({ origem: o.modelo.origem ?? null, statusEfetivo, cfg: o.cfg, cond: o.cond });
  }, [o.prontas, selo.fase, o.modelo, o.cfg, o.cond, statusEfetivo]);
  const mut = useMoverEtapa(o.modeloId, o.tenantId);
  const onMover = (para: string) => mut.mutate(
    {
      para, origem: o.modelo.origem ?? null,
      statusAntes: statusEfetivo, fixadoAntes: selo.modo === "fixado",
      cfg: o.cfg, cond: o.cond,
    },
    { onSettled: () => { for (const k of o.invalidar ?? []) qc.invalidateQueries({ queryKey: k }); } },
  );
  const podeMover = o.prontas && selo.fase === "kanban" && opcoes.length > 0;
  return { selo, opcoes, onMover, podeMover, movendo: mut.isPending };
}
