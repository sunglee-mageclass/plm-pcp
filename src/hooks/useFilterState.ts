import { useUserPref, parseStrArray } from "@/hooks/useUiPrefs";

/**
 * Persiste, POR USUÁRIO e POR TELA, a seleção (array de ids) de UM filtro multi.
 *
 * ⚠️ ago→set/2026: o MIOLO migrou de localStorage-only para o BANCO (`user_ui_prefs`, via
 * `useUserPref`) — agora a preferência SEGUE o usuário em qualquer dispositivo. A API é a MESMA
 * (`useFilterState(screen, key, initial) → [value, setter]`), então os ~19 consumidores não
 * mudam. O localStorage continua como ESPELHO (não piscar + fallback offline) por dentro do
 * `useUserPref`; a migração das chaves legadas `wish360:filtro-sel:*` → banco roda 1×/usuário lá.
 */
export function useFilterState(
  screen: string,
  key: string,
  initial: string[],
): [string[], (v: string[]) => void] {
  return useUserPref("filtro", screen, key, initial);
}

/**
 * Parse + validação pura (testável sem localStorage/window). Mantida por compatibilidade — hoje
 * delega a `parseStrArray` (mesma semântica: corrompido/!array → `initial`; array vazio é válido).
 */
export function parseFilterSel(raw: string | null, initial: string[]): string[] {
  return parseStrArray(raw, initial);
}
