/**
 * Migração de prefixo de localStorage `sistrama:` → `wish360:` (renome da marca ago/2026).
 *
 * As preferências de filtro por-usuário/tela (`useFilterState`/`useFilterUsage`) eram
 * chaveadas com o prefixo `sistrama:`. Ao trocar o prefixo p/ `wish360:`, sem esta migração
 * o navegador não acharia os valores antigos e os filtros salvos de todos resetariam. Este
 * helper COPIA cada chave `sistrama:*` para a nova `wish360:*` (uma vez, idempotente), então
 * ninguém perde preferência. Best-effort: falha silenciosa em quota/modo privado/SSR.
 *
 * Rodado uma única vez por carregamento de app (flag em memória) — não custa nada nas leituras
 * subsequentes. Não apaga as chaves antigas (barato deixar; some naturalmente quando o valor é
 * reescrito sob a nova chave).
 */
const LEGACY_PREFIX = "sistrama:";
export const STORAGE_PREFIX = "wish360:";

let migrado = false;

export function migrarPrefixoStorage(): void {
  if (migrado) return;
  migrado = true;
  if (typeof window === "undefined") return;
  try {
    const ls = window.localStorage;
    // Coleta as chaves legadas primeiro (não mutar durante a iteração do length).
    const legadas: string[] = [];
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith(LEGACY_PREFIX)) legadas.push(k);
    }
    for (const antiga of legadas) {
      const nova = STORAGE_PREFIX + antiga.slice(LEGACY_PREFIX.length);
      // Só copia se a nova ainda não existe (não sobrescreve preferência já feita sob o novo prefixo).
      if (ls.getItem(nova) === null) {
        const v = ls.getItem(antiga);
        if (v !== null) ls.setItem(nova, v);
      }
    }
  } catch {
    /* quota/privado: ignora — a migração é best-effort */
  }
}
