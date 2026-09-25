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
import { boardDaLoja, fluxoDoModelo, reqsDoModelo, statusParaGate, type Derivacao, type KanbanAutoConfig } from "@/lib/kanban-auto";
import { modoColuna, type ModoColuna } from "@/lib/kanban-auto-ui";
import { ehOrigemComprada } from "@/lib/origem";
import { revendaColunaPermitida, revendaRequisitos, type RevendaConfig } from "@/lib/revenda-config";

export type OpcaoMover = {
  key: string;
  label: string;
  nota: string;
  bloqueada: boolean;
  /** M6, fix round 1 — modo da coluna (Zap=automática, Hand=manual…) p/ o ícone no menu "Mover
   *  para…" (reusa `ModoColunaBadge` da F2 — não duplica ícone/rótulo). `null` fora do fluxo. */
  modo?: ModoColuna | null;
};

/** Modo da coluna `col` no fluxo do MODELO (origem comprado tem fluxo/reqs próprios — `fluxoDoModelo`/`reqsDoModelo`).
 *  Exportada p/ `etapa-mover.ts` (chave ligada) reusar — mesmo cálculo, sem duplicar. */
export function modoDoDestino(col: string, origem: string | null | undefined, cfg: KanbanAutoConfig): ModoColuna | null {
  const fluxoKeys = fluxoDoModelo(origem, cfg).map((c) => c.key);
  const { reqs } = reqsDoModelo(origem, cfg);
  return modoColuna(col, fluxoKeys, reqs);
}

/** I1 (fix round 1) — "condições prontas" pro card: precisa do card estar NO kanban
 *  (`noKanban`) E das DUAS queries do hook terem chegado (condições do card E config da
 *  loja). Antes só olhava as condições; se a config chegasse depois (ou falhasse), o hook
 *  seguia com os defaults de `KanbanAutoConfig` (chave desligada, board vazio ⇒
 *  DEFAULT_STATUSES, zero requisitos) — o "Mover para…" (Task 8) podia então oferecer uma
 *  coluna que não existe no board real da loja, ou pular a cascata de requisitos. */
export function condProntasFicha(o: { noKanban: boolean; condOk: boolean; cfgOk: boolean }): boolean {
  return o.noKanban && o.condOk && o.cfgOk;
}

/** Coluna onde o board mostra o card (null antes da Ordem de Criação).
 *  M1 (fix round 1): régua IGUAL ao board — trim, SEM lowercase (`criacao.desenvolvimento.tsx:480,
 *  539-541`: `m.status_desenvolvimento && map.has(m.status_desenvolvimento)`, comparação EXATA).
 *  `etapaDoModelo` da F2 também só faz trim; a Task 8 vai ter anti-drift contra ela — não trocar
 *  para `normKey` (que faz lowercase) de novo sem atualizar esse anti-drift. */
export function statusEfetivoFicha(statusSalvo: string | null | undefined, enviada: boolean, cfg: KanbanAutoConfig): string | null {
  if (!enviada) return null;
  const board = boardDaLoja(cfg);
  const s = String(statusSalvo ?? "").trim();
  return board.some((c) => c.key === s) ? s : (board[0]?.key ?? null);
}

/** Campo REF visível na seção "Desenvolvimento"? Mesma régua do Dev (`refCampoVisivel`), com a posição
 *  DERIVADA quando a chave está ligada (decisão 10). Sem etapa (antes da Ordem de Criação) = escondido.
 *  M3 (fix round 1): `statusEfetivo` aqui é o **status CRU** do modelo (enviada ? statusSalvo : null),
 *  NÃO a coluna EFETIVA do board (`statusEfetivoFicha`, que já cai na 1ª coluna se nulo/órfão) — mesma
 *  fonte que o Dev usa (`ModeloDetailPanel.tsx curStatus`) e o SQL (`_ref_exibir_gate(…,
 *  _kanban_status_gate(…, status_desenvolvimento))`, migration 20260930140000). O nome do parâmetro
 *  ficou como estava (evita renomear a assinatura pública) — quem chama é quem decide QUAL status
 *  passar; o `useFichaKanban` passa o cru. */
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
      return {
        key: c.key, label: c.label, nota: ok ? "" : `falta ${faltando.map((f) => f.label).join(", ")}`, bloqueada: !ok,
        modo: modoDoDestino(c.key, o.origem, o.cfg),
      };
    });
}

/** Mesmo texto do board (criacao.desenvolvimento.tsx:585-590). */
export function mensagemBloqueioHoje(faltando: { label: string }[]): string {
  return `Não pode entrar aqui. Faltam: ${faltando.map((f) => f.label).join(", ")}`;
}
