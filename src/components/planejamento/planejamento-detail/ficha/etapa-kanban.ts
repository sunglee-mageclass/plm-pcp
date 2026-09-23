/**
 * Etapa do kanban no Sheet unificado do Planejamento (F3.1) — funções PURAS (zero React, zero Supabase).
 * A regra do kanban mora em `src/lib/kanban-auto.ts` (espelho do SQL, F1 — NÃO editar) e no board do
 * Desenvolvimento. Aqui só:
 *  • a coluna EFETIVA do card (≡ board: status fora do board/nulo cai na 1ª coluna);
 *  • o gate do campo REF (≡ Dev, `refCampoVisivel`), com a posição DERIVADA quando a chave está ligada
 *    (decisão 10 — `statusParaGate`);
 *  • o "podeEntrar" de HOJE (chave desligada): espelho LITERAL de `criacao.desenvolvimento.tsx:322-332`
 *    (o board não exporta a função) — cascata p/ interno; fluxo de comprado sem cascata.
 */
import { requisitosEfetivos, requisitosOk, type Condicao } from "@/lib/kanban-condicoes";
import { normalizeKanbanStatuses, refCampoVisivel } from "@/lib/kanban-status";
import { boardDaLoja, normKey, statusParaGate, type Derivacao, type KanbanAutoConfig } from "@/lib/kanban-auto";
import { ehOrigemComprada } from "@/lib/origem";
import { revendaColunaPermitida, revendaRequisitos, type RevendaConfig } from "@/lib/revenda-config";

export type OpcaoMover = { key: string; label: string; nota: string; bloqueada: boolean };

/** Coluna onde o board mostra o card (null antes da Ordem de Criação). */
export function statusEfetivoFicha(statusSalvo: string | null | undefined, enviada: boolean, cfg: KanbanAutoConfig): string | null {
  if (!enviada) return null;
  const board = boardDaLoja(cfg);
  const s = normKey(statusSalvo);
  return board.some((c) => c.key === s) ? s : (board[0]?.key ?? null);
}

/** Campo REF visível na seção "Desenvolvimento"? Mesma régua do Dev (`refCampoVisivel`), com a posição
 *  DERIVADA quando a chave está ligada (decisão 10). Sem etapa (antes da Ordem de Criação) = escondido. */
export function refVisivelFicha(o: {
  cfg: KanbanAutoConfig;
  refExibirStatus: string | null | undefined;
  statusEfetivo: string | null;
  derivacao: Derivacao | null;
}): boolean {
  if (!o.statusEfetivo) return false;
  return refCampoVisivel(o.cfg.status_kanban, o.refExibirStatus, o.statusEfetivo, {
    statusGate: statusParaGate(o.cfg.kanban_automatico, o.derivacao, o.statusEfetivo),
  });
}

function revendaDaCfg(cfg: KanbanAutoConfig): RevendaConfig {
  return { colunas: cfg.revenda_kanban_colunas, requisitos: cfg.revenda_kanban_requisitos, campos: {} };
}

/** ≡ `podeEntrar` do board (chave desligada). Condições = estado SALVO (RPC avaliar_condicoes_kanban). */
export function podeEntrarHoje(o: {
  origem: string | null | undefined;
  para: string;
  cfg: KanbanAutoConfig;
  cond: Record<string, boolean>;
}): { ok: boolean; faltando: Condicao[] } {
  if (ehOrigemComprada(o.origem)) {
    const rc = revendaDaCfg(o.cfg);
    if (!revendaColunaPermitida(rc, o.para)) {
      return { ok: false, faltando: [{ key: "__revenda_coluna", label: "fora do fluxo de comprado", modulo: "desenvolvimento" }] };
    }
    return requisitosOk(revendaRequisitos(rc, o.para), o.cond);
  }
  const ordem = normalizeKanbanStatuses(o.cfg.status_kanban).map((s) => s.key);
  return requisitosOk(requisitosEfetivos(o.para, ordem, o.cfg.kanban_requisitos, o.cfg.kanban_requisitos_excecoes), o.cond);
}

/** "Mover para…" com a chave DESLIGADA: todas as colunas do board menos a atual, anotando o que falta. */
export function opcoesMoverHoje(o: {
  origem: string | null | undefined;
  statusEfetivo: string | null;
  cfg: KanbanAutoConfig;
  cond: Record<string, boolean>;
}): OpcaoMover[] {
  return boardDaLoja(o.cfg)
    .filter((c) => c.key !== o.statusEfetivo)
    .map((c) => {
      const { ok, faltando } = podeEntrarHoje({ origem: o.origem, para: c.key, cfg: o.cfg, cond: o.cond });
      return { key: c.key, label: c.label, nota: ok ? "" : `falta ${faltando.map((f) => f.label).join(", ")}`, bloqueada: !ok };
    });
}

/** Mesmo texto do board (criacao.desenvolvimento.tsx:585-590). */
export function mensagemBloqueioHoje(faltando: { label: string }[]): string {
  return `Não pode entrar aqui. Faltam: ${faltando.map((f) => f.label).join(", ")}`;
}
