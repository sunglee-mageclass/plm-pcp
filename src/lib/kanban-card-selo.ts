// F4a T1 — funções PURAS que PA/PI/PT usam para montar o selo do kanban no CARD (embed `modelo:modelo_id(...)`)
// e podar reprovados por card. A lógica de requisitos NÃO vive aqui (reuso de `etapaDoModelo`/`opcoesMover*`).
import type { ModeloKanban } from "@/lib/kanban-auto";
import { ehReprovadoStatus } from "@/lib/reprovado";

/** Monta o ModeloKanban do embed `modelo:modelo_id(...)` de PA/PI. Campos ausentes = null/false
 *  (nunca "assume enviado"): ordem/lancado só true quando o embed diz true. */
export function modeloKanbanDoEmbed(m: {
  origem?: string | null;
  status_desenvolvimento?: string | null;
  ordem_criacao_enviada?: boolean | null;
  lancado?: boolean | null;
} | null | undefined): ModeloKanban {
  return {
    origem: m?.origem ?? null,
    status_desenvolvimento: m?.status_desenvolvimento ?? null,
    ordem_criacao_enviada: m?.ordem_criacao_enviada === true,
    lancado: m?.lancado === true,
  };
}

/** Poda de exibição do filtro "Status" (default sem_reprovado). Nunca apaga — quem chama só decide o que
 *  renderiza. Card sem modelo (null/undefined) não é reprovado. */
export function cardReprovado(
  s: { status_desenvolvimento?: string | null; status_planejamento?: string | null } | null | undefined,
): boolean {
  return ehReprovadoStatus(s?.status_desenvolvimento, s?.status_planejamento);
}

export function passaFiltroStatusCard(
  s: { status_desenvolvimento?: string | null; status_planejamento?: string | null } | null | undefined,
  modo: "todos" | "sem_reprovado",
): boolean {
  return modo === "todos" ? true : !cardReprovado(s);
}
