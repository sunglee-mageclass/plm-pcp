/**
 * Normaliza texto para busca client-side insensível a acento/caixa (ex.: "algodão" casa
 * com "algodao"). Fonte única — não duplicar por tela (era local a entrada-saida.oc-tecido.tsx).
 */
export function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
