/**
 * KANBAN AUTOMÁTICO — F2 (telas). Helpers PUROS de apresentação (zero React, zero Supabase).
 *
 * A REGRA mora em `kanban-auto.ts` (espelho exato do SQL, F1 — não editar) e, no fim, no servidor
 * (RPC `kanban_mover`). Aqui ficam só: modo da coluna, textos PT-BR (faixa do arraste, "Mover para…",
 * toast), a próxima falta do card, o selo da etapa e os TIPOS/contrato das RPCs públicas da F1.
 * Plano: docs/superpowers/plans/2026-09-23-kanban-automatico-f2-telas.md (§3).
 */
import { CONDICAO_BY_KEY } from "./kanban-condicoes";
import { DEFAULT_STATUSES, labelColunaKanban, type KanbanStatus } from "./kanban-status";
import {
  boardDaLoja, colunaManual, fluxoDoModelo, mensagemDrop, normKey, reqsDoModelo, statusDerivado,
  type AcaoDrop, type Derivacao, type DestinoDrop, type KanbanAutoConfig, type ModeloKanban,
} from "./kanban-auto";

// ── Contrato das RPCs públicas da F1 (supabase/migrations/20260930150000_kanban_auto_4_rpcs.sql) ──
// `tests/unit/kanban-auto-rpc-contrato.test.ts` confere assinatura, GRANT e campos contra o arquivo.
export const RPC_KANBAN = {
  mover: {
    nome: "kanban_mover",
    assinatura: "kanban_mover(_modelo_id uuid, _para text)",
    campos: ["acao", "status", "faltando", "rev"],
  },
  previaRecalculo: {
    nome: "kanban_previa_recalculo",
    assinatura: "kanban_previa_recalculo(_cfg jsonb)",
    campos: ["chave_proposta", "mudam", "fixados", "cards", "cards_fixados", "recua", "primeira_falha", "posicao_derivada", "revelam_ref", "refs_reveladas", "avisos"],
  },
  definirAutomatico: {
    nome: "kanban_definir_automatico",
    assinatura: "kanban_definir_automatico(_ligar boolean)",
    campos: ["ligado", "mudou", "lote_id", "snapshot", "cards_movidos"],
  },
  previaRestauracao: {
    nome: "kanban_previa_restauracao",
    assinatura: "kanban_previa_restauracao(_lote_id uuid DEFAULT NULL::uuid)",
    campos: ["lote_id", "criado_at", "chave_ligada", "voltam", "movidos_depois", "movido_manual_depois", "lotes_superados", "avisos"],
  },
  restaurar: {
    nome: "kanban_restaurar",
    assinatura: "kanban_restaurar(_lote_id uuid)",
    campos: ["restaurados", "historico_apagado", "lotes_superados"],
  },
} as const;

export type ResultadoMover = { acao: AcaoDrop; status: string | null; faltando: string[]; rev: number };
export type PreviaCard = {
  modelo_id: string; nome: string | null; ref: string | null; origem: string | null;
  de: string | null; para: string | null; fixado: boolean; recua: boolean;
  primeira_falha: string | null; faltando: string[];
};
export type PreviaFixado = {
  modelo_id: string; nome: string | null; ref: string | null; origem: string | null;
  coluna: string | null; posicao_derivada: string | null;
};
export type RefRevelada = { modelo_id: string; nome: string | null; ref_auto: string; posicao_derivada: string | null };
export type PreviaRecalculo = {
  chave_proposta: boolean; total: number; mudam: number; fixados: number;
  cards: PreviaCard[]; cards_fixados: PreviaFixado[];
  revelam_ref: number; refs_reveladas: RefRevelada[]; avisos: string[];
};
export type ResultadoDefinir = { ligado: boolean; mudou: boolean; lote_id: string | null; snapshot: number; cards_movidos: number };
export type RestauracaoCard = {
  modelo_id: string; nome: string | null; ref: string | null;
  de: string | null; para: string | null; movido_manual_depois: boolean;
};
export type PreviaRestauracao = {
  lote_id: string | null; motivo?: string | null; criado_at?: string | null; restaurado_at?: string | null;
  chave_ligada: boolean; total: number; voltam: number; movidos_depois: number; lotes_superados: number;
  cards: RestauracaoCard[]; avisos: string[];
};
export type ResultadoRestaurar = { lote_id: string; restaurados: number; historico_apagado: number; lotes_superados: number };

export type ModoColuna = "entrada" | "automatica" | "manual" | "manual_sempre";
export type EtapaSelo = {
  fase: "planejamento" | "kanban" | "lancado";
  key: string | null;
  label: string;
  color: string | null;
  modo: "off" | "automatica" | "fixado";
};
export type ToastKanban = { tipo: "success" | "info" | "error"; texto: string };

export const MOTIVO_REPROVADO_MANUAL = "Reprovado é sempre manual: requisitos nesta coluna não valem.";

/** A linha de `tenant_config` já tem a coluna da chave? (F1 aplicada). Sem ela o front age como chave desligada. */
export function motorKanbanDisponivel(row: unknown): boolean {
  return !!row && typeof row === "object" && !Array.isArray(row)
    && Object.prototype.hasOwnProperty.call(row, "kanban_automatico");
}

/** Modo da coluna no fluxo: 1ª = entrada; Reprovado = manual (sempre); sem requisito PRÓPRIO = manual; senão automática. */
export function modoColuna(col: string, fluxoKeys: string[], reqs: Record<string, string[]>): ModoColuna | null {
  const k = normKey(col);
  const i = fluxoKeys.indexOf(k);
  if (i < 0) return null;
  if (i === 0) return "entrada";
  if (k === "reprovado") return "manual_sempre";
  return colunaManual(k, reqs) ? "manual" : "automatica";
}

const ROTULO_MODO: Record<ModoColuna, string> = {
  entrada: "Entrada",
  automatica: "Automática",
  manual: "Manual",
  manual_sempre: "Manual (sempre)",
};
const DESCRICAO_MODO: Record<ModoColuna, string> = {
  entrada: "1ª coluna: todo card novo cai aqui.",
  automatica: "Com requisito: o card entra sozinho quando cumpre esta coluna e todas as anteriores.",
  manual: "Sem requisito: o card entra e sai arrastado.",
  manual_sempre: "Reprovado é sempre manual: o card entra e sai arrastado.",
};
export function rotuloModoColuna(m: ModoColuna): string { return ROTULO_MODO[m]; }
export function descricaoModoColuna(m: ModoColuna): string { return DESCRICAO_MODO[m]; }

/** Labels do catálogo (`CONDICAO_BY_KEY`); key desconhecida volta crua. */
export function labelsCondicoes(keys: string[]): string[] {
  return keys.map((k) => CONDICAO_BY_KEY.get(k)?.label ?? k);
}

/** Label de uma coluna: board da loja → DEFAULT_STATUSES → a própria key; vazio → "—". */
export function labelDaColuna(key: string | null | undefined, cols: KanbanStatus[]): string {
  const k = normKey(key);
  if (!k) return "—";
  return cols.find((c) => c.key === k)?.label ?? DEFAULT_STATUSES.find((c) => c.key === k)?.label ?? String(key);
}

/** Linha sob o cabeçalho da coluna (chave ligada) — textos do mockup aprovado. */
export function subtituloColuna(m: ModoColuna | null, reqsProprios: string[]): string {
  if (!m) return "";
  if (m === "manual") return "Manual — o card entra e sai arrastado";
  if (m === "manual_sempre") return "Manual (sempre) — o card entra e sai arrastado";
  const labels = labelsCondicoes(reqsProprios).join(", ");
  if (m === "entrada") return labels ? `Todo card novo cai aqui. Exigido daqui em diante: ${labels}` : "Todo card novo cai aqui.";
  return `Entra com: ${labels}`;
}

/** "Fora do fluxo" com o RÓTULO da coluna (R1 do G-plano). A `mensagemDrop` da F1 (travada) põe a key crua
 *  (`A etapa "em_ajuste" …`); a frase é a mesma, só troca a key pelo rótulo. Key desconhecida volta crua. */
function textoForaDoFluxo(para: string, cols: KanbanStatus[]): string {
  return `A etapa "${labelDaColuna(para, cols)}" não faz parte do fluxo deste modelo.`;
}

export function dropBloqueado(d: DestinoDrop): boolean {
  return d.acao === "bloquear_faltando" || d.acao === "bloquear_ja_cumprida" || d.acao === "fora_do_fluxo";
}

/** Faixa da coluna enquanto o card é arrastado (null = sem faixa). */
export function textoFaixaDrop(d: DestinoDrop, para: string, cols: KanbanStatus[]): string | null {
  switch (d.acao) {
    case "bloquear_faltando": return `Não pode entrar aqui. ${mensagemDrop(d, para, cols)}`;
    case "bloquear_ja_cumprida": return mensagemDrop(d, para, cols);
    case "fora_do_fluxo": return textoForaDoFluxo(para, cols);
    case "fixar": return "Solte aqui para fixar o card nesta coluna";
    case "soltar": return `Solte aqui para soltar o card — ele vai para "${labelDaColuna(d.status, cols)}"`;
    default: return null;
  }
}

/** Anotação de cada destino no "Mover para…" (mobile). */
export function notaMoverPara(d: DestinoDrop): { texto: string; bloqueada: boolean } {
  switch (d.acao) {
    case "fixar": return { texto: "fixa aqui", bloqueada: false };
    case "soltar": return { texto: "solta o card", bloqueada: false };
    case "bloquear_faltando": {
      const n = d.faltando.length;
      return { texto: n === 1 ? "falta 1 dado" : n > 1 ? `faltam ${n} dados` : "faltam dados", bloqueada: true };
    }
    case "bloquear_ja_cumprida": return { texto: "já cumpre", bloqueada: true };
    case "fora_do_fluxo": return { texto: "fora do fluxo", bloqueada: true };
    default: return { texto: "", bloqueada: false };
  }
}

/** Toast depois do `kanban_mover` — pela RESPOSTA do servidor (a autoridade), não pela previsão local. */
export function toastDoMover(
  r: Pick<ResultadoMover, "acao" | "status" | "faltando">,
  para: string,
  cols: KanbanStatus[],
  statusAntes: string | null,
  fixadoAntes: boolean,
): ToastKanban | null {
  const d: DestinoDrop = { acao: r.acao, status: r.status, faltando: r.faltando ?? [] };
  switch (r.acao) {
    case "fixar":
      return { tipo: "info", texto: `Fixado em "${labelDaColuna(r.status, cols)}". O card não anda sozinho até alguém tirá-lo daqui.` };
    case "soltar":
      return { tipo: "success", texto: `Card solto. Voltou para "${labelDaColuna(r.status, cols)}" — a etapa que os campos preenchidos indicam.` };
    case "bloquear_faltando": {
      const base = `Não pode entrar aqui. ${mensagemDrop(d, para, cols)}`;
      return { tipo: "error", texto: fixadoAntes ? `${base}. O card continua fixado em "${labelDaColuna(statusAntes, cols)}".` : base };
    }
    case "bloquear_ja_cumprida": return { tipo: "info", texto: mensagemDrop(d, para, cols) ?? "" };
    case "fora_do_fluxo": return { tipo: "error", texto: textoForaDoFluxo(para, cols) };
    default: return null;
  }
}

/** "falta X" (+N) da 1ª coluna automática que o card ainda não cumpre; null se fixado/não derivável/tudo cumprido. */
export function proximaFalta(d: Derivacao): string | null {
  if (!d.derivavel || d.fixado || !d.primeiraFalha || d.faltando.length === 0) return null;
  const labels = labelsCondicoes(d.faltando);
  return labels.length === 1 ? `falta ${labels[0]}` : `falta ${labels[0]} +${labels.length - 1}`;
}

/** Selo da etapa (card do Planejamento; header do Sheet na F3). "fixado" ≡ `statusDerivado(...).fixado`
 *  — que NÃO depende das condições (só da coluna em que o card está), então não precisa do core. */
export function etapaDoModelo(m: ModeloKanban, cfg: KanbanAutoConfig): EtapaSelo {
  if (m.lancado === true) return { fase: "lancado", key: null, label: "Lançado", color: null, modo: "off" };
  if (m.ordem_criacao_enviada !== true) return { fase: "planejamento", key: null, label: "Planejamento", color: null, modo: "off" };
  const board = boardDaLoja(cfg);
  const bruto = String(m.status_desenvolvimento ?? "").trim();
  const col = (bruto ? board.find((c) => c.key === bruto) : undefined) ?? board[0] ?? null;
  const base = { fase: "kanban" as const, key: col?.key ?? null, label: labelColunaKanban(m.status_desenvolvimento, board), color: col?.color ?? null };
  if (!cfg.kanban_automatico) return { ...base, modo: "off" };
  const { reqs, exc } = reqsDoModelo(m.origem, cfg);
  const fluxo = fluxoDoModelo(m.origem, cfg).map((c) => c.key);
  const d = statusDerivado({ fluxo, reqs, exc, cond: {}, status: m.status_desenvolvimento ?? null, derivavel: true });
  return { ...base, modo: d.fixado ? "fixado" : "automatica" };
}

export function tituloSelo(s: EtapaSelo): string {
  if (s.fase === "planejamento") return "Antes da Ordem de Criação — o modelo ainda não está no Desenvolvimento.";
  if (s.fase === "lancado") return "Modelo lançado.";
  const base = `Etapa do Desenvolvimento: ${s.label}`;
  if (s.modo === "automatica") return `${base} — anda sozinho conforme os campos salvos.`;
  if (s.modo === "fixado") return `${base} — fixado numa coluna manual: não anda sozinho.`;
  return base;
}

/** Pseudo-ids das 2 fases fora do board (mesmas do selo — `etapaDoModelo` já as usa via `fase`,
 *  aqui só nomeamos p/ o filtro, que precisa de um id ESTÁVEL por opção). */
export const ETAPA_FILTRO_PLANEJAMENTO = "__planejamento";
export const ETAPA_FILTRO_LANCADO = "__lancado";

/** Id de opção do filtro "Etapa do kanban" a partir do selo (`etapaDoModelo`) — MESMA fonte do
 *  badge, garante que filtro e selo NUNCA divirjam. `fase==="kanban"` usa a key do board (`s.key`,
 *  já cai na 1ª coluna quando nula/órfã — nunca null nesse caso); as 2 pseudo-fases usam id fixo. */
export function etapaFiltroId(s: EtapaSelo): string {
  if (s.fase === "planejamento") return ETAPA_FILTRO_PLANEJAMENTO;
  if (s.fase === "lancado") return ETAPA_FILTRO_LANCADO;
  return s.key ?? ETAPA_FILTRO_PLANEJAMENTO; // s.key só é null aqui se o board estiver vazio (sem coluna alguma)
}

/** Opções do filtro "Etapa do kanban" (Planejamento de Produto): Planejamento → colunas do board
 *  NA ORDEM da loja (mesmos rótulos do selo) → Lançado. Não depende das condições/derivação —
 *  só do board, então serve tanto com a chave ligada quanto desligada. */
export function etapaKanbanFiltroOpts(cfg: KanbanAutoConfig): { id: string; nome: string }[] {
  const board = boardDaLoja(cfg);
  return [
    { id: ETAPA_FILTRO_PLANEJAMENTO, nome: "Planejamento" },
    ...board.map((c) => ({ id: c.key, nome: c.label })),
    { id: ETAPA_FILTRO_LANCADO, nome: "Lançado" },
  ];
}
