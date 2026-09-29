/**
 * Config da Loja colaborativa — T2, módulo PURO (zero React, zero Supabase). Espelha, do lado do
 * cliente, o que a RPC `salvar_config_loja` (T1, banco) vai exigir: lista branca de colunas da
 * PÁGINA (18 da RPC menos `tab_labels`/`campos_editaveis`, que são da janela "Nomenclaturas" —
 * T5, RPC própria), serialização byte-a-byte igual à de hoje (`configuracoes.tsx mutationFn`),
 * montagem de `{mudancas, base}` (base = valor CRU do servidor, nunca normalizado por DEFAULTS —
 * ver `normalizarKanbanDefaults` em kanban-auto-config.ts para o motivo), rebase da base crua após
 * um P0409 (protege coluna em conflito e, se pedido, as 5 colunas de kanban em voo) e o parsing do
 * `details` do P0409 `conflito_versao: config_loja` (lista "a,b,c" — ver plano, RPC passo 6).
 *
 * Fonte das regras de serialização hoje (não duplicar sem ler antes de mudar):
 * `src/routes/_authenticated/admin/configuracoes.tsx` `mutationFn` (linhas do payload) +
 * `src/lib/config-keywords.ts` `keywordsParaPayload` (keywords só-espaços → null) +
 * `src/lib/kanban-auto-config.ts` (`KANBAN_COLS`, `diffKanban`, `pickKanban`, `jsonCanonico`) +
 * `src/lib/colab/merge.ts` (`igual`).
 */
import { igual } from "./colab/merge";
import { KANBAN_COLS, diffKanban, jsonCanonico, pickKanban, type KanbanCol, type KanbanColsValor } from "./kanban-auto-config";

/**
 * As 16 colunas GERAIS da página (18 da lista branca da RPC menos `tab_labels`/`campos_editaveis`
 * — essas 2 são da janela "Nomenclaturas", com upsert e RPC PRÓPRIOS, T5). As 5 colunas de kanban
 * (dentro dessas 16) NÃO entram no diff genérico — ver `montarMudancas` abaixo.
 */
export const COLUNAS_PAGINA = [
  "timezone",
  "modo_baixa_estoque",
  "modo_oc_rolo",
  "explosao_envio_status",
  "ref_exibir_status",
  "markup_analise_faixa",
  "leadtime",
  "pcp_etapas",
  "revenda_campos",
  "ref_config",
  "keywords",
  "status_kanban",
  "kanban_requisitos",
  "kanban_requisitos_excecoes",
  "revenda_kanban_colunas",
  "revenda_kanban_requisitos",
] as const;
export type ColunaPagina = (typeof COLUNAS_PAGINA)[number];

const COLUNAS_PAGINA_SET: ReadonlySet<string> = new Set(COLUNAS_PAGINA);
const KANBAN_COLS_SET: ReadonlySet<string> = new Set(KANBAN_COLS);

/** Shape mínimo lido/serializado — o resto do `ConfigState` da tela é ignorado aqui de propósito. */
export type ConfigLojaColab = {
  timezone: string;
  modo_baixa_estoque: string;
  modo_oc_rolo: string;
  explosao_envio_status: string;
  ref_exibir_status: string;
  markup_analise_faixa: boolean;
  leadtime: unknown;
  pcp_etapas: unknown;
  revenda_campos: unknown;
  ref_config: { partes?: unknown[] } | null;
  keywords: string;
  status_kanban: unknown;
  kanban_requisitos: unknown;
  kanban_requisitos_excecoes: unknown;
  revenda_kanban_colunas: unknown;
  revenda_kanban_requisitos: unknown;
  [k: string]: unknown;
};

/**
 * Serializa UMA coluna da tela pro valor que vai no payload da RPC — as MESMAS 3 regras hoje
 * inline no `mutationFn`/`keywordsParaPayload` (byte-a-byte, mesmos casos):
 * - `explosao_envio_status`/`ref_exibir_status`: "" (Aprovado/ausência) → `null` (mantém o
 *   fallback histórico sem gravar valor explícito).
 * - `ref_config`: sem `partes` (array) ou `partes` vazio → `null` (config "vazia" = comportamento
 *   histórico, sem objeto inerte gravado).
 * - `keywords`: string com só espaços (inclusive "") → `null`; senão o texto CRU (sem trim — igual
 *   ao `keywordsParaPayload`, que só decide null/mantém, nunca corta espaços do meio/bordas do que
 *   é gravado).
 * - qualquer outra coluna: valor passa direto (`cfg[k]`).
 *
 * NÃO decide "mudou ou não" (isso é `montarMudancas`) — sempre devolve o valor PRONTO pro payload,
 * dado o valor da tela.
 */
export function serializarColuna(k: ColunaPagina | string, v: unknown): unknown {
  if (k === "explosao_envio_status" || k === "ref_exibir_status") {
    return typeof v === "string" && v.trim() !== "" ? v : null;
  }
  if (k === "ref_config") {
    const vazio = !v || typeof v !== "object" || !Array.isArray((v as { partes?: unknown }).partes) || ((v as { partes: unknown[] }).partes.length === 0);
    return vazio ? null : v;
  }
  if (k === "keywords") {
    if (typeof v !== "string") return null;
    return v.trim() === "" ? null : v;
  }
  return v;
}

export type MontarMudancasArgs = {
  /** O que está NA TELA agora (rascunho do usuário). */
  cfg: ConfigLojaColab;
  /** O que a tela carregou/último merge aplicado (equivalente ao `cfgBaseRef` de hoje) — usado só
   * para decidir quais colunas GERAIS foram tocadas (`!igual(cfg[k], baseUi[k])`). */
  baseUi: ConfigLojaColab;
  /** Valor CRU do servidor (SELECT * de `tenant_config`, sem nenhum fallback de DEFAULTS aplicado)
   * — vira `base` para as colunas gerais tocadas. NUNCA usar um valor normalizado aqui: uma loja
   * com `status_kanban` NULL bateria pra sempre contra `DEFAULTS.status_kanban` (ver
   * `normalizarKanbanDefaults`, kanban-auto-config.ts) e a RPC recusaria com P0001/P0409 falso. */
  baseRaw: Record<string, unknown>;
  /** Base de comparação do kanban (mesmo `kanbanBase.cfg` de hoje) — as 5 colunas de kanban usam
   * `diffKanban`, não `igual` direto (mesma régua RP3 de sempre: kanban sai do diff genérico). */
  kanbanBaseCfg: KanbanColsValor;
};

export type MontarMudancasResult = {
  /** Só as colunas TOCADAS, já serializadas (`serializarColuna`) — payload de `_mudancas` da RPC. */
  mudancas: Record<string, unknown>;
  /** `_base` da RPC: o valor CRU do servidor para CADA chave que está em `mudancas` (nunca
   * DEFAULTS-normalizado). Toda chave de `mudancas` está em `base` (contrato da RPC, passo 2). */
  base: Record<string, unknown>;
};

/**
 * Monta `{mudancas, base}` para a RPC `salvar_config_loja`:
 * - Colunas GERAIS (as 16 menos as 5 de kanban): tocada = `!igual(cfg[k], baseUi[k])` (mesmo
 *   critério do merge 3-vias hoje, `mergeDraft`/`cfgBaseRef`). Tocada entra em `mudancas`
 *   SERIALIZADA (`serializarColuna`) e `base[k] = baseRaw[k] ?? null` (CRU, não normalizado).
 * - Colunas de KANBAN: usa `diffKanban(kanbanBaseCfg, pickKanban(cfg))` (mesma função de hoje,
 *   RP3) — o diff já devolve o valor ATUAL (não precisa `serializarColuna`, nenhuma das 5 colunas
 *   de kanban tem regra de serialização especial). Cada coluna do diff entra em `mudancas` e
 *   `base[k] = baseRaw[k] ?? null`.
 * - Toda chave de `mudancas` tem um par em `base` (nunca uma sem a outra) — invariante conferida
 *   nos testes e pelo contrato da RPC (passo 2: "Toda chave de `_mudancas` TEM de estar em `_base`").
 */
export function montarMudancas({ cfg, baseUi, baseRaw, kanbanBaseCfg }: MontarMudancasArgs): MontarMudancasResult {
  const mudancas: Record<string, unknown> = {};
  const base: Record<string, unknown> = {};

  for (const k of COLUNAS_PAGINA) {
    if (KANBAN_COLS_SET.has(k)) continue; // kanban vai pelo diff abaixo, não por `igual`
    if (!igual(cfg[k], baseUi[k])) {
      mudancas[k] = serializarColuna(k, cfg[k]);
      base[k] = baseRaw[k] ?? null;
    }
  }

  const diff = diffKanban(kanbanBaseCfg, pickKanban(cfg));
  for (const c of Object.keys(diff) as KanbanCol[]) {
    mudancas[c] = diff[c];
    base[c] = baseRaw[c] ?? null;
  }

  return { mudancas, base };
}

/**
 * Rebase de `baseRaw` (a base CRUA guardada localmente, equivalente ao futuro `baseRawRef` da
 * T3) depois de aplicar um `rawFresh` (releitura do servidor — refetch pós-P0409, ou eco de
 * Realtime). Regra: colunas EM CONFLITO (`emConflito`, tipicamente vindas de `colunasDoErro`)
 * NÃO re-baseiam — ficam com o valor de `anterior` até o usuário resolver ("manter meu"/"usar o
 * novo" na T4); toda outra coluna da lista branca adota o `rawFresh`.
 *
 * `protegidoKanban`: espelha `kanbanProtegidoRef` de hoje — enquanto um save com diff de kanban
 * está EM VOO (ou houve falha parcial), as 5 colunas de kanban NÃO re-baseiam de `rawFresh`
 * mesmo fora de `emConflito` (o eco do Realtime do PRÓPRIO save, ou de uma falha parcial, não
 * pode fazer a base local convergir para um valor que ainda não é definitivo). Fora dessa janela
 * (`protegidoKanban=false`), kanban re-baseia como qualquer outra coluna (sujeito só a
 * `emConflito`).
 */
export function rebasearBaseRaw(
  anterior: Record<string, unknown>,
  rawFresh: Record<string, unknown>,
  emConflito: ReadonlySet<string>,
  protegidoKanban: boolean,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...anterior };
  for (const k of COLUNAS_PAGINA) {
    if (emConflito.has(k)) continue;
    if (protegidoKanban && KANBAN_COLS_SET.has(k)) continue;
    out[k] = (rawFresh as Record<string, unknown>)[k] ?? null;
  }
  return out;
}

/** Rótulos PT das colunas da página — usados no banner de conflito/atualização (T4) e nas
 * mensagens de erro. Espelham o título do card/bloco que a tela mostra hoje. */
const ROTULOS: Record<string, string> = {
  timezone: "Fuso horário",
  modo_baixa_estoque: "Baixa de estoque",
  modo_oc_rolo: "Modo de OC/rolo",
  explosao_envio_status: "Envio à Explosão",
  ref_exibir_status: "Revelar REF",
  markup_analise_faixa: "Análise de markup por faixa",
  leadtime: "Leadtime",
  pcp_etapas: "Etapas do PCP",
  revenda_campos: "Fluxo de Revenda — campos",
  ref_config: "Formato da REF",
  keywords: "Keywords",
  status_kanban: "Colunas do kanban",
  kanban_requisitos: "Requisitos do kanban",
  kanban_requisitos_excecoes: "Exceções dos requisitos",
  revenda_kanban_colunas: "Fluxo de Revenda — colunas",
  revenda_kanban_requisitos: "Fluxo de Revenda — requisitos",
  tab_labels: "Nomes das abas",
  campos_editaveis: "Campos editáveis",
};

/** Rótulo PT de uma coluna (fallback: a própria chave, se desconhecida). */
export function rotuloColuna(k: string): string {
  return ROTULOS[k] ?? k;
}

/**
 * Parseia o `details` de um erro PostgREST do P0409 `conflito_versao: config_loja` (RPC passo 6:
 * `RAISE ... USING ERRCODE='P0409', DETAIL = array_to_string(v_conf, ',')`) — lista ASCII
 * separada por vírgula das colunas em conflito. Aceita o erro em qualquer forma comum que chega
 * do cliente Supabase/PostgREST (`{code,message,details}` ou `{code,message,detail}`, chaves
 * PT/EN já vistas no repo) e devolve só as colunas que SÃO da lista branca da página (ruído/typo
 * no `details` não vaza pro banner). Vazio se não for esse erro ou não houver `details`.
 */
export function colunasDoErro(e: unknown, aceitas: readonly string[] = COLUNAS_PAGINA): string[] {
  if (!e || typeof e !== "object") return [];
  const code = (e as Record<string, unknown>).code;
  if (code !== "P0409") return [];
  const msg = String((e as Record<string, unknown>).message ?? "");
  if (!msg.startsWith("conflito_versao")) return [];
  const raw =
    (e as Record<string, unknown>).details ??
    (e as Record<string, unknown>).detail ??
    (e as Record<string, unknown>).DETAIL;
  if (typeof raw !== "string" || raw.trim() === "") return [];
  // T5: a janela "Nomenclaturas" passa a SUA lista (tab_labels/campos_editaveis); default = as 16 da página.
  const aceitasSet: ReadonlySet<string> = aceitas === COLUNAS_PAGINA ? COLUNAS_PAGINA_SET : new Set(aceitas);
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "" && aceitasSet.has(c));
}

// ── T5: janela "Nomenclaturas" (tab_labels / campos_editaveis) ─────────────────────────────────────
/** As 2 colunas da janela Nomenclaturas (RPC `salvar_config_loja`, mesma lista branca). */
export const COLUNAS_NOMENCLATURAS = ["tab_labels", "campos_editaveis"] as const;
export type ColunaNomenclatura = (typeof COLUNAS_NOMENCLATURAS)[number];

/** Mapa de nomes como é GRAVADO: só nomes não vazios, sem espaços nas pontas (em branco = nome padrão). */
export function limparNomes(m: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m ?? {})) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

export type ConflitoNome = { path: string; meu: string | undefined; dele: string | undefined };

/**
 * Merge 3-vias POR NOME de um mapa de nomenclaturas (P-123 A). `base` = o que a janela carregou (ou o último
 * servidor já fundido), `meu` = o rascunho, `fresh` = o servidor agora. Nome que eu NÃO mexi adota o servidor;
 * nome que eu mexi fica meu — e vira CONFLITO só se o servidor também o mudou para outro valor (convergido não
 * conta). Comparação sobre os mapas LIMPOS (`limparNomes`: vazio = nome padrão = ausente).
 * `prefixo` monta o `path` do conflito (ex.: "nom:tab:" → "nom:tab:producao").
 */
export function mesclarNomes(
  base: Record<string, unknown> | null | undefined,
  meu: Record<string, unknown> | null | undefined,
  fresh: Record<string, unknown> | null | undefined,
  prefixo: string,
): { valor: Record<string, string>; conflitos: ConflitoNome[]; atualizados: string[] } {
  const b = limparNomes(base), m = limparNomes(meu), f = limparNomes(fresh);
  const valor: Record<string, string> = {};
  const conflitos: ConflitoNome[] = [];
  const atualizados: string[] = [];
  for (const k of new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(f)])) {
    const tocado = m[k] !== b[k];
    let v: string | undefined;
    if (!tocado) {
      v = f[k];
      if (f[k] !== b[k]) atualizados.push(k);
    } else {
      v = m[k];
      if (f[k] !== b[k] && f[k] !== m[k]) conflitos.push({ path: `${prefixo}${k}`, meu: m[k], dele: f[k] });
    }
    if (v !== undefined) valor[k] = v;
  }
  return { valor, conflitos, atualizados };
}

// Re-exporta `jsonCanonico` (usado por `montarMudancas`/`diffKanban` internamente e útil para
// quem escreve testes de paridade contra o payload de hoje) sem duplicar a implementação.
export { jsonCanonico };
