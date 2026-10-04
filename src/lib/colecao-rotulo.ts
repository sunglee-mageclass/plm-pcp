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
