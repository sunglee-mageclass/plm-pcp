/**
 * "Mover para…" do selo da etapa no header do Sheet unificado (F3.1) com a chave LIGADA — funções PURAS.
 * Consome a F1 (`kanban-auto.ts`: tabela única de arraste) e a F2 (`kanban-auto-ui.ts`: textos). Com a chave
 * DESLIGADA vale `opcoesMoverHoje` (etapa-kanban.ts, regras do board de hoje).
 */
import {
  boardDaLoja, destinoDrop, entradaParaDerivacao, type Derivacao, type KanbanAutoConfig, type ModeloKanban,
} from "@/lib/kanban-auto";
import { labelDaColuna, labelsCondicoes, notaMoverPara } from "@/lib/kanban-auto-ui";
import { modoDoDestino, podeEntrarHoje, type OpcaoMover } from "./etapa-kanban";

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
      return {
        key: c.key, label: c.label, nota: n.texto, bloqueada: n.bloqueada,
        modo: modoDoDestino(c.key, o.modelo.origem, o.cfg),
      };
    });
}

/** Mockup: "→ Próxima: Prova de Roupa I — falta: Data de Piloto I preenchida". Só p/ card automático. */
export function proximaEtapa(d: Derivacao | null, cfg: KanbanAutoConfig): { coluna: string; falta: string } | null {
  if (!d || !d.derivavel || d.fixado || !d.primeiraFalha || d.faltando.length === 0) return null;
  return { coluna: labelDaColuna(d.primeiraFalha, boardDaLoja(cfg)), falta: labelsCondicoes(d.faltando).join(", ") };
}

/**
 * M5(b), fix round 1 — decisão PURA do `useMoverEtapa` (extraída p/ testar sem hook/Supabase).
 *  • Chave ligada: chama a RPC `kanban_mover` — `plano.tipo === "rpc"`, nenhum UPDATE local.
 *  • Bloqueado (chave desligada, `podeEntrarHoje` reprova): `plano.tipo === "bloqueado"` — nada é gravado.
 *  • Liberado (chave desligada): `plano.tipo === "update"` com o payload EXATO
 *    `{ status_desenvolvimento: para }` — nunca mais campos (nunca toca `motivo_cancelamento`).
 */
export type PlanoMover =
  | { tipo: "rpc"; modeloId: string; para: string }
  | { tipo: "bloqueado"; faltando: { label: string }[] }
  | { tipo: "update"; modeloId: string; payload: { status_desenvolvimento: string } };

export function planoMoverEtapa(o: {
  modeloId: string;
  para: string;
  origem: string | null;
  cfg: KanbanAutoConfig;
  cond: Record<string, boolean>;
}): PlanoMover {
  if (o.cfg.kanban_automatico) return { tipo: "rpc", modeloId: o.modeloId, para: o.para };
  const chk = podeEntrarHoje({ origem: o.origem, para: o.para, cfg: o.cfg, cond: o.cond });
  if (!chk.ok) return { tipo: "bloqueado", faltando: chk.faltando };
  return { tipo: "update", modeloId: o.modeloId, payload: { status_desenvolvimento: o.para } };
}
