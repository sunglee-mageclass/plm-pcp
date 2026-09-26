// Keywords da loja (F3.6 — dono 25/set; plano 2026-09-25 R38/R39): `tenant_config.keywords text`, texto livre editado na
// Config da Loja (admin da loja e super admin) — p/ uma tela FUTURA só de super admin. Puro (sem I/O).

/** O valor do banco p/ a tela: texto ou "" (NULL/ausente = vazio). */
export function keywordsDoServidor(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * O pedaço do upsert da Config: `keywords` SÓ se o usuário a mudou nesta tela (tela ≠ servidor) — uma aba velha que não
 * mexeu nas Keywords nunca regrava o texto de outra pessoa; e o upsert SEM a chave não toca a coluna (PostgREST: `ON CONFLICT
 * DO UPDATE` só das colunas enviadas — provado em tests/integration/sheet-reorg-campos.test.ts). Só espaços = NULL.
 */
export function keywordsParaPayload(tela: string, servidor: unknown): { keywords?: string | null } {
  if (tela === keywordsDoServidor(servidor)) return {};
  return { keywords: tela.trim() === "" ? null : tela };
}
