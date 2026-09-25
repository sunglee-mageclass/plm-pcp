/**
 * "Mover para…" do selo da etapa no header do Sheet unificado (F3.1) com a chave LIGADA — funções PURAS.
 * Consome a F1 (`kanban-auto.ts`: tabela única de arraste) e a F2 (`kanban-auto-ui.ts`: textos). Com a chave
 * DESLIGADA vale `opcoesMoverHoje` (etapa-kanban.ts, regras do board de hoje).
 */
import {
  boardDaLoja, destinoDrop, entradaParaDerivacao, type Derivacao, type KanbanAutoConfig, type ModeloKanban,
} from "@/lib/kanban-auto";
import { labelDaColuna, labelsCondicoes, notaMoverPara } from "@/lib/kanban-auto-ui";
import type { OpcaoMover } from "./etapa-kanban";

export function opcoesMoverAuto(o: {
  modelo: ModeloKanban;
  statusEfetivo: string | null;
  cfg: KanbanAutoConfig;
  cond: Record<string, boolean>;
}): OpcaoMover[] {
  const entrada = entradaParaDerivacao(o.modelo, o.cfg, o.cond);
  return boardDaLoja(o.cfg)
    .filter((c) => c.key !== o.statusEfetivo)
    .map((c) => {
      const n = notaMoverPara(destinoDrop(entrada, c.key));
      return { key: c.key, label: c.label, nota: n.texto, bloqueada: n.bloqueada };
    });
}

/** Mockup: "→ Próxima: Prova de Roupa I — falta: Data de Piloto I preenchida". Só p/ card automático. */
export function proximaEtapa(d: Derivacao | null, cfg: KanbanAutoConfig): { coluna: string; falta: string } | null {
  if (!d || !d.derivavel || d.fixado || !d.primeiraFalha || d.faltando.length === 0) return null;
  return { coluna: labelDaColuna(d.primeiraFalha, boardDaLoja(cfg)), falta: labelsCondicoes(d.faltando).join(", ") };
}
