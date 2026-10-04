/**
 * Rótulo da COLEÇÃO de um card (Modularidade, Parte 12 — "coleção pelo id vale como coleção").
 *
 * Regra ÚNICA: o NOME da coleção do OTB (`modelos.colecao_id` → `colecoes.nome`, da mesma loja) e, sem ela, o texto livre
 * `modelos.colecao` com trim; vazio = `null`. ESPELHO de `_modelo_colecao_rotulo(tenant, colecao_id, colecao)` no SQL (usada
 * pelos `_core` dos Dashboards) e de `_integracao_extras(...)->>'colecao'` (Integração) — anti-drift em
 * `tests/integration/mod-3-kanban-colecao.test.ts` (SQL × SQL) e `tests/unit/colecao-rotulo.test.ts` (fixtures).
 *
 * `colecaoNome` = o nome da coleção JÁ resolvido pelo chamador (join/embed de `colecoes` da mesma loja); `undefined`/`null` =
 * card sem coleção do OTB (ou de outra loja).
 */
export function rotuloColecao(m: {
  colecao?: string | null;
  colecaoNome?: string | null;
}): string | null {
  if (m.colecaoNome != null) return m.colecaoNome;
  const t = (m.colecao ?? "").trim();
  return t === "" ? null : t;
}

/**
 * Embed PostgREST do nome da coleção do OTB (`modelos.colecao_id` → `colecoes.nome`, da mesma loja pelo RLS). Entra no `select`
 * de TODA tela que lê `modelos.colecao` para filtrar ou mostrar (Modularidade R11/Parte 12) — junto de `colecao` e `colecao_id`.
 */
export const EMBED_COLECAO = "colecoes(nome)";

/** Nome da coleção vindo do embed `colecoes(nome)` (objeto, ou array de 1 conforme o cliente). */
export function nomeColecaoEmbed(m: { colecoes?: unknown } | null | undefined): string | null {
  const c = m?.colecoes as { nome?: string | null } | { nome?: string | null }[] | null | undefined;
  const nome = Array.isArray(c) ? c[0]?.nome : c?.nome;
  return nome ?? null;
}

/** `rotuloColecao` de uma linha de `modelos` carregada com o embed `colecoes(nome)`. */
export function rotuloColecaoDoModelo(m: { colecao?: string | null; colecoes?: unknown } | null | undefined): string | null {
  return rotuloColecao({ colecao: m?.colecao, colecaoNome: nomeColecaoEmbed(m) });
}

/** Devolve a linha com `colecao` = o RÓTULO (nome do OTB, senão o texto): o resto da tela segue lendo `.colecao` (filtro, opções,
 *  agrupamento e exibição) e passa a ver também o card que só tem `colecao_id`. Não use para escrever de volta. */
export function comRotuloColecao<T extends { colecao?: string | null }>(m: T): T {
  return { ...m, colecao: rotuloColecaoDoModelo(m as { colecao?: string | null; colecoes?: unknown }) };
}

export function comRotuloColecaoLista<T extends { colecao?: string | null }>(rows: readonly T[] | null | undefined): T[] {
  return (rows ?? []).map(comRotuloColecao);
}
