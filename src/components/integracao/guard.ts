// Integração — guarda de "alterações não salvas" ÚNICA da página: 1 useUnsavedGuard com blockNav em IntegracaoPage (2 guardas
// brigariam pelo mesmo useBlocker do router). Cada aba informa aqui se está suja; trocar de aba com algo sujo pede
// "Descartar alterações?" (a aba que sai desmonta e o rascunho dela some).
import { createContext, useContext, useEffect } from "react";
import type { Aba } from "@/lib/integracao/abas";

export type GuardaIntegracao = { informarSujo: (aba: Aba, sujo: boolean) => void };
export const GuardaIntegracaoContext = createContext<GuardaIntegracao | null>(null);
export function useAbaSuja(aba: Aba, sujo: boolean): void {
  const ctx = useContext(GuardaIntegracaoContext);
  useEffect(() => {
    ctx?.informarSujo(aba, sujo);
  }, [ctx, aba, sujo]);
  useEffect(() => () => ctx?.informarSujo(aba, false), [ctx, aba]);
}
