/**
 * KANBAN PL (Etapas PL, Onda 3) — helpers PUROS de apresentação (zero React, zero Supabase).
 *
 * Espelho do `kanban-auto-ui.ts` (Dev) para o board PL. A REGRA mora em `etapas-pl-config.ts` (espelho TS da
 * derivação SQL) e, no fim, no servidor (RPC `etapas_pl_mover`). Aqui ficam: modo da coluna, textos PT-BR
 * (faixa do arraste, "Mover para…", toast), o selo da etapa do produto, as opções do filtro e a checagem de
 * "motor disponível". As AÇÕES de drop são as REAIS do SQL (`AcaoDrop`): fixar | soltar | nada | bloquear_faltando |
 * bloquear_ja_cumprida | fora_do_fluxo — `etapas_pl_mover` devolve a ação crua.
 */
import { CONDICAO_PL_BY_KEY } from "./etapas-pl-condicoes";
import {
  boardEtapasPl, colunaManualPl, fluxoEtapasPl, reqsDaColuna,
  type DestinoDropPl, type EtapasPlConfig,
} from "./etapas-pl-config";
import { normalizeKanbanStatuses } from "./kanban-status";
import { normKey, type AcaoDrop } from "./kanban-auto";

export type AcaoDropPl = AcaoDrop;

/** Nomes das RPCs públicas do PL (migrations 20261127120000 / 20261127130000). */
export const RPC_ETAPAS_PL = {
  mover: "etapas_pl_mover",
  definir: "etapas_pl_definir_automatico",
  previaRestauracao: "etapas_pl_previa_restauracao",
  restaurar: "etapas_pl_restaurar",
} as const;

/** Retorno cru de `etapas_pl_mover`. `acao` fica `string` (o servidor é a autoridade; valor novo não quebra a tela). */
export type ResultadoMoverPl = { acao: string; status: string | null; faltando: string[]; rev: number };
export type ToastPl = { titulo: string; tipo: "ok" | "erro" | "info" };
export type ModoColunaPl = "automatica" | "manual";
export type EtapaSeloPl = { key: string; label: string; color: string; modo: "off" | "automatica" | "fixado" };

/** Id (e key do selo) das opções fora do board: produto lançado ("Finalizado"). */
export const ETAPA_PL_FILTRO_LANCADO = "__lancado";
/** Key do selo de produto que não está no PL (status nulo) ou cuja loja não tem board. */
export const ETAPA_PL_FORA = "__fora_do_pl";

const COR_NEUTRA = "var(--muted-foreground)";

/** Board PL só com colunas válidas, na ordem, com label e cor (a cor vem do normalizador do Dev; board vazio = `[]`). */
function boardComCor(cfg: EtapasPlConfig): { key: string; label: string; color: string }[] {
  const base = boardEtapasPl(cfg);
  if (base.length === 0) return [];
  const cores = new Map(normalizeKanbanStatuses(cfg.board).map((c) => [c.key, c.color]));
  return base.map((c) => ({ ...c, color: cores.get(c.key) ?? COR_NEUTRA }));
}

/** O motor só existe com board PL configurado: board vazio/não-array = indisponível (inércia — NÃO cai no board do Dev). */
export function motorEtapasPlDisponivel(cfg: EtapasPlConfig): boolean {
  return Array.isArray(cfg?.board) && cfg.board.length > 0 && fluxoEtapasPl(cfg).length > 0;
}

/** Modo da coluna: sem requisito PRÓPRIO (ou `reprovado`) = manual; senão automática. */
export function modoColunaPl(cfg: EtapasPlConfig, key: string): ModoColunaPl {
  return colunaManualPl(cfg, key) ? "manual" : "automatica";
}

/** Labels do catálogo PL; key desconhecida volta crua. */
function labelsCondicoesPl(keys: string[]): string[] {
  return keys.map((k) => CONDICAO_PL_BY_KEY.get(k)?.label ?? k);
}

function labelColunaPl(cfg: EtapasPlConfig | undefined, key: string | null | undefined): string {
  const k = normKey(key);
  if (!k) return "—";
  return (cfg ? boardEtapasPl(cfg).find((c) => c.key === k)?.label : undefined) ?? String(key);
}

/** Linha sob o cabeçalho da coluna. */
export function subtituloColunaPl(cfg: EtapasPlConfig, key: string): string {
  if (modoColunaPl(cfg, key) === "manual") return "Manual — o card entra e sai arrastado";
  const labels = labelsCondicoesPl(reqsDaColuna(cfg, key)).join(", ");
  return `Entra com: ${labels}`;
}

/** Destino que o servidor recusa. `fora_do_fluxo` NÃO entra aqui (ruling do controlador): só os 2 `bloquear_*`. */
export function dropBloqueadoPl(d: DestinoDropPl): boolean {
  return d.acao === "bloquear_faltando" || d.acao === "bloquear_ja_cumprida";
}

/** Faixa da coluna enquanto o card é arrastado ("" = sem faixa). `cfg` opcional: dá o rótulo da coluna destino do "soltar". */
export function textoFaixaDropPl(d: DestinoDropPl, cfg?: EtapasPlConfig): string {
  switch (d.acao) {
    case "bloquear_faltando": return `Faltam: ${labelsCondicoesPl(d.faltando ?? []).join(", ")}`;
    case "bloquear_ja_cumprida": return "O card já cumpre esta etapa — já cumpre; use coluna manual para segurá-lo";
    case "fora_do_fluxo": return "Etapa fora do fluxo";
    case "fixar": return "Solte aqui para fixar o card nesta coluna";
    case "soltar": return `Solte aqui para soltar o card — ele vai para "${labelColunaPl(cfg, d.status)}"`;
    default: return "";
  }
}

/** Anotação de cada destino no "Mover para…" (mobile). "" = sem nota. */
export function notaMoverPlPara(d: DestinoDropPl): string {
  switch (d.acao) {
    case "fixar": return "fixa aqui";
    case "soltar": return "solta o card";
    case "bloquear_faltando": {
      const n = (d.faltando ?? []).length;
      return n === 1 ? "falta 1 dado" : n > 1 ? `faltam ${n} dados` : "faltam dados";
    }
    case "bloquear_ja_cumprida": return "já cumpre";
    case "fora_do_fluxo": return "fora do fluxo";
    default: return "";
  }
}

/** Toast depois do `etapas_pl_mover` — pela RESPOSTA do servidor (a autoridade). Um texto por ação. */
export function toastDoMoverPl(r: ResultadoMoverPl, para: string, cfg?: EtapasPlConfig): ToastPl {
  switch (r.acao) {
    case "fixar":
      return { tipo: "ok", titulo: `Fixado em "${labelColunaPl(cfg, r.status ?? para)}". O card não anda sozinho até alguém tirá-lo daqui.` };
    case "soltar":
      return { tipo: "ok", titulo: `Card solto. Voltou para "${labelColunaPl(cfg, r.status)}" — a etapa que os dados preenchidos indicam.` };
    case "manual": // chave desligada (modo manual): a pessoa decidiu, o servidor só gravou
      return { tipo: "ok", titulo: `Movido para "${labelColunaPl(cfg, r.status ?? para)}".` };
    case "nada":
      return { tipo: "info", titulo: "O card já está nesta etapa." };
    case "bloquear_faltando": {
      const labels = labelsCondicoesPl(r.faltando ?? []);
      return { tipo: "erro", titulo: `Não pode entrar em "${labelColunaPl(cfg, para)}". Faltam: ${labels.join(", ")}` };
    }
    case "bloquear_ja_cumprida":
      return { tipo: "info", titulo: `O card já cumpre "${labelColunaPl(cfg, para)}"; use coluna manual para segurá-lo numa etapa.` };
    case "fora_do_fluxo":
      return { tipo: "erro", titulo: `A etapa "${labelColunaPl(cfg, para)}" não faz parte do fluxo.` };
    default:
      return { tipo: "info", titulo: "Movimento processado." };
  }
}

/** Selo da etapa do produto. Lançado (`satisfeitas.lancado`) = "Finalizado". Status nulo / board vazio = fora do PL.
 *  Status órfão cai na 1ª coluna (onde o card aparece). Chave desligada = "off". Ligada: coluna manual ≠ 1ª = "fixado". */
export function etapaDoProduto(
  cfg: EtapasPlConfig,
  statusAtual: string | null | undefined,
  satisfeitas: Record<string, boolean>,
  ligado: boolean,
): EtapaSeloPl {
  if (satisfeitas?.lancado === true) {
    return { key: ETAPA_PL_FILTRO_LANCADO, label: "Finalizado", color: "var(--success)", modo: "off" };
  }
  const board = boardComCor(cfg);
  const bruto = String(statusAtual ?? "").trim();
  if (!bruto || board.length === 0) {
    return { key: ETAPA_PL_FORA, label: "Fora do PL", color: COR_NEUTRA, modo: "off" };
  }
  const col = board.find((c) => c.key === bruto) ?? board[0];
  if (!ligado) return { key: col.key, label: col.label, color: col.color, modo: "off" };
  const fixado = col.key !== board[0].key && colunaManualPl(cfg, col.key);
  return { key: col.key, label: col.label, color: col.color, modo: fixado ? "fixado" : "automatica" };
}

/** Opções do filtro "Etapa PL": colunas do board NA ORDEM + "Finalizado" (lançado). Mesmos ids/rótulos do selo. */
export function etapaPlFiltroOpts(cfg: EtapasPlConfig): { id: string; label: string }[] {
  return [
    ...boardEtapasPl(cfg).map((c) => ({ id: c.key, label: c.label })),
    { id: ETAPA_PL_FILTRO_LANCADO, label: "Finalizado" },
  ];
}
