// Integração — "abrir card" (R14, P-199 A): o PlanejamentoDetail abre como Sheet POR CIMA da Integração (a página, os
// filtros e a rolagem ficam). A página tem UMA instância do Sheet e passa `abrirCard(id)` por contexto — as células
// (CelulaCampo) e a aba Log só chamam. Sem Provider (testes isolados) o contexto é null e o link não aparece.
import { createContext, useContext } from "react";

export type AbrirCard = (modeloId: string) => void;
export const AbrirCardContext = createContext<AbrirCard | null>(null);
export function useAbrirCard(): AbrirCard | null {
  return useContext(AbrirCardContext);
}
