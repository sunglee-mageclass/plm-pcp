/**
 * KANBAN AUTOMÁTICO — F2, Config da Loja. PURO (zero React/Supabase).
 *
 * RP3 (guardião, G-plano F1): a Config fazia `upsert` da linha INTEIRA de `tenant_config`. Com a chave
 * ligada, uma aba aberta antes de outro admin mudar requisitos/ordem regravaria os valores velhos e o
 * gatilho da F1 recalcularia a loja SEM prévia. Por isso as 5 colunas de kanban saem do upsert genérico
 * e vão SÓ as que o usuário mudou (diff canônico), depois de conferir que o banco ainda tem o que a tela
 * carregou (`conflitoKanban`). Aqui também o agrupamento das prévias (ligar / salvar / restaurar).
 */
import type { PreviaCard, PreviaFixado } from "./kanban-auto-ui";

export const KANBAN_COLS = [
  "status_kanban",
  "kanban_requisitos",
  "kanban_requisitos_excecoes",
  "revenda_kanban_colunas",
  "revenda_kanban_requisitos",
] as const;
export type KanbanCol = (typeof KANBAN_COLS)[number];
export type KanbanColsValor = Partial<Record<KanbanCol, unknown>>;

export function pickKanban(src: unknown): Record<KanbanCol, unknown> {
  const o = (src && typeof src === "object" && !Array.isArray(src) ? src : {}) as Record<string, unknown>;
  const out = {} as Record<KanbanCol, unknown>;
  for (const c of KANBAN_COLS) out[c] = o[c] ?? null;
  return out;
}

/** JSON com chaves de objeto ordenadas (o jsonb do Postgres reordena as chaves); arrays mantêm a ordem. */
export function jsonCanonico(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
    .join(",")}}`;
}

export function diffKanban(base: KanbanColsValor, atual: KanbanColsValor): KanbanColsValor {
  const out: KanbanColsValor = {};
  for (const c of KANBAN_COLS) {
    if (jsonCanonico(base[c]) !== jsonCanonico(atual[c])) out[c] = atual[c] ?? null;
  }
  return out;
}

export function conflitoKanban(baseServidor: KanbanColsValor, servidorAgora: unknown): KanbanCol[] {
  const agora = pickKanban(servidorAgora);
  return KANBAN_COLS.filter((c) => jsonCanonico(baseServidor[c]) !== jsonCanonico(agora[c]));
}

export function separarPayloadKanban(payload: Record<string, unknown>): { geral: Record<string, unknown>; kanban: KanbanColsValor } {
  const geral: Record<string, unknown> = {};
  const kanban: KanbanColsValor = {};
  for (const [k, v] of Object.entries(payload)) {
    if ((KANBAN_COLS as readonly string[]).includes(k)) (kanban as Record<string, unknown>)[k] = v;
    else geral[k] = v;
  }
  return { geral, kanban };
}

/**
 * Fix round 1 (revisão Opus): o `upsert(geral)` do RP3 pode ter sucesso e o `update(diff)` do
 * kanban falhar LOGO DEPOIS (rede caiu no meio, RLS, etc.) — falha PARCIAL. O `upsert` sozinho já
 * dispara o eco do Realtime global (`useRealtimeInvalidation`) e refaz a leitura de
 * `tenant_config`, que normalmente sobrescreveria as 5 colunas de kanban na tela com o valor do
 * SERVIDOR (sem o diff que falhou) — apagando em silêncio a edição do usuário que ele ainda não
 * conseguiu salvar.
 *
 * Esta função decide, nesse eco, o que a tela deve mostrar: com uma falha parcial PENDENTE,
 * mantém o kanban LOCAL (as colunas como o usuário as deixou, sujas) em vez de adotar o do
 * servidor — para ele poder tentar salvar de novo sem perder o que digitou. Sem falha pendente,
 * comportamento de sempre: adota o servidor.
 */
export function mesclarKanbanNoEco(
  pendente: boolean,
  localCfg: KanbanColsValor,
  servidorCfg: KanbanColsValor,
): KanbanColsValor {
  return pendente ? localCfg : servidorCfg;
}

const DESCRICAO_COL: Record<KanbanCol, string> = {
  status_kanban: "as colunas do kanban (nomes ou ordem)",
  kanban_requisitos: "os requisitos",
  kanban_requisitos_excecoes: "as exceções da cascata",
  revenda_kanban_colunas: "as colunas da revenda",
  revenda_kanban_requisitos: "os requisitos da revenda",
};

export function juntarLista(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

export function descreverMudancasKanban(cols: readonly KanbanCol[]): string {
  return juntarLista(cols.map((c) => DESCRICAO_COL[c]));
}

export function mensagemConflitoKanban(cols: readonly KanbanCol[]): string {
  return `Outra pessoa mudou ${descreverMudancasKanban(cols)} depois que você abriu esta tela. Recarregue a página e refaça a sua alteração antes de salvar.`;
}

export function nCards(n: number): string {
  return n === 1 ? "1 card" : `${n} cards`;
}

export type GrupoMovimento = { de: string | null; para: string | null; recua: boolean; cards: PreviaCard[] };

const posicao = (ordem: string[], k: string | null) => {
  const i = k ? ordem.indexOf(k) : -1;
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};

/** Agrupa a prévia por (de → para), na ordem do board (coluna fora do board vai para o fim). */
export function agruparMovimentos(cards: PreviaCard[], ordem: string[]): GrupoMovimento[] {
  const mapa = new Map<string, GrupoMovimento>();
  for (const c of cards) {
    const k = `${c.de ?? ""}→${c.para ?? ""}`;
    const g = mapa.get(k);
    if (g) g.cards.push(c);
    else mapa.set(k, { de: c.de, para: c.para, recua: c.recua, cards: [c] });
  }
  return [...mapa.values()].sort(
    (a, b) => posicao(ordem, a.de) - posicao(ordem, b.de) || posicao(ordem, a.para) - posicao(ordem, b.para),
  );
}

/** "N cards ficam onde estão, em colunas manuais (Em Ajuste 2 · Stand By 2 · …)". */
export function resumirFixados(fixados: PreviaFixado[], ordem: string[]): { coluna: string | null; n: number }[] {
  const mapa = new Map<string | null, number>();
  for (const f of fixados) mapa.set(f.coluna, (mapa.get(f.coluna) ?? 0) + 1);
  return [...mapa.entries()]
    .map(([coluna, n]) => ({ coluna, n }))
    .sort((a, b) => posicao(ordem, a.coluna) - posicao(ordem, b.coluna));
}

/** O diálogo de desligar DESLIGA antes de restaurar — o aviso "Desligue…" da prévia não se aplica. */
export function avisosRestauracaoVisiveis(avisos: string[]): string[] {
  return avisos.filter((a) => !a.startsWith("Desligue o Kanban automático antes de restaurar"));
}

/** "dd/mm/aaaa hh:mm" no fuso da loja (tenant_config.timezone). */
export function formatarDataHora(iso: string | null | undefined, tz: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? "";
  return `${v("day")}/${v("month")}/${v("year")} ${v("hour")}:${v("minute")}`;
}
