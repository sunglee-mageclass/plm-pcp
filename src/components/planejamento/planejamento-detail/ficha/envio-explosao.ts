// F3.3 — "Enviar à Explosão" no Sheet unificado do Planejamento: o gate por etapa e a lista "Para enviar, falta".
// PORTA de ModeloDetailPanel.tsx:1405-1413 (gate), :1576-1598 (pendências/canEnviarCad), com as seções do Sheet do
// Planejamento no lugar das do acordeão do Dev. Decisão travada 10: com a chave LIGADA o gate usa a posição DERIVADA
// do card (`statusParaGate`), espelho do SQL `_explosao_envio_gate(_kanban_status_gate(...))` (F1
// 20260930140000_kanban_auto_3_motor.sql:842). Puro — tests/unit/planejamento-envio-explosao.test.ts.
import { podeEnviarExplosao } from "@/lib/kanban-status";
import { statusParaGate, type Derivacao, type KanbanAutoConfig } from "@/lib/kanban-auto";
import type { GradeRow, TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import type { Draft } from "@/components/planejamento/modelo-shared";
import type { SecaoSheetKey } from "./selos-secoes";

export type GateEnvio = { ok: boolean; carregando: boolean; reqLabel: string };

/** Pode enviar pela ETAPA? `statusCru` = status gravado com a Ordem de Criação enviada (null antes dela). */
export function gateEnvioExplosao(i: {
  cfg: KanbanAutoConfig;
  explosaoEnvioStatus: string | null | undefined;
  statusCru: string | null;
  derivacao: Derivacao | null;
  /** Condições do card E config da loja carregadas (`useFichaKanban.condProntas`). */
  condProntas: boolean;
}): GateEnvio {
  // Chave ligada sem as condições: a posição derivada ainda não é conhecida — não libera "no escuro" (o servidor
  // recusaria, mas o botão não pode prometer).
  if (i.cfg.kanban_automatico && !i.condProntas) return { ok: false, carregando: true, reqLabel: "" };
  const g = podeEnviarExplosao(i.cfg.status_kanban, i.explosaoEnvioStatus, i.statusCru, {
    statusGate: statusParaGate(i.cfg.kanban_automatico, i.derivacao, i.statusCru),
  });
  return { ok: g.ok, carregando: false, reqLabel: g.reqLabel };
}

export type PendenciaEnvio = { label: string; secao: SecaoSheetKey };

/**
 * "Para enviar, falta" (Dev :1576-1595, fluxo INTERNO — o Enviar só aparece p/ interno na F3.3). Cada pendência aponta
 * a seção do Sheet onde se resolve (o link abre a seção). `rotuloRef` = `useFieldLabels()("ref")`, como o Dev.
 */
export function pendenciasEnvioExplosao(i: {
  draft: Pick<Draft, "ref" | "nome" | "estilista_id" | "categoria_principal_id" | "data_desenho_tecnico" | "data_piloto1" | "data_piloto2" | "data_piloto3" | "piloteiro2_id" | "piloteiro3_id">;
  blocks: TecidoBlock[];
  grades: GradeRow[];
  rotuloRef: string;
}): PendenciaEnvio[] {
  const out: PendenciaEnvio[] = [];
  const d = i.draft;
  const vazio = (s: string | null | undefined) => (s ?? "").trim() === "";
  if (vazio(d.ref)) out.push({ label: i.rotuloRef, secao: "desenvolvimento" });
  if (vazio(d.nome)) out.push({ label: "Nome", secao: "info" });
  if (!d.estilista_id) out.push({ label: "Estilista", secao: "info" });
  if (!d.categoria_principal_id) out.push({ label: "Categoria", secao: "info" });
  const temTecidoComVariante = i.blocks.some((b) => b.tipo === "tecido" && !!b.artigo_id && b.variantes.some((v) => !!v));
  const todosComVariante = i.blocks.filter((b) => !!b.artigo_id).every((b) => b.variantes.some((v) => !!v));
  if (!temTecidoComVariante) out.push({ label: "ao menos 1 tecido com variante", secao: "tecidos" });
  else if (!todosComVariante) out.push({ label: "1 variante em cada tecido/forro/entretela selecionado", secao: "tecidos" });
  if (i.grades.reduce((s, g) => s + (g.grade_total || 0), 0) <= 0) out.push({ label: "grade preenchida", secao: "grade" });
  if (vazio(d.data_desenho_tecnico)) out.push({ label: "Data Desenho Técnico", secao: "desenvolvimento" });
  if (vazio(d.data_piloto1)) out.push({ label: "Data Piloto 1", secao: "desenvolvimento" });
  const piloto2Aberto = !!(d.piloteiro2_id || !vazio(d.data_piloto2));
  const piloto3Aberto = !!(d.piloteiro3_id || !vazio(d.data_piloto3));
  if (piloto2Aberto && vazio(d.data_piloto2)) out.push({ label: "Data Piloto 2", secao: "desenvolvimento" });
  if (piloto3Aberto && vazio(d.data_piloto3)) out.push({ label: "Data Piloto 3", secao: "desenvolvimento" });
  return out;
}
