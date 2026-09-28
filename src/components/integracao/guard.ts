// Integração — guarda de "alterações não salvas" ÚNICA da página: 1 useUnsavedGuard com blockNav em IntegracaoPage (2 guardas
// brigariam pelo mesmo useBlocker do router). Cada aba informa aqui se está suja; trocar de aba com algo sujo pede
// "Descartar alterações?" (a aba que sai desmonta e o rascunho dela some).
//
// Fix round 2 T15 (code-review "Re-check round 1", Minor n1): `informarChaveVisivel` é um segundo canal, PARALELO a
// `informarSujo` — a página precisa saber, na hora de decidir o toast de uma troca de loja, se o motivo específico
// da aba "api" estar suja era uma CHAVE NOVA ainda visível (não copiada) — esse caso perde o segredo pra sempre e
// merece um aviso mais específico que o genérico "alterações descartadas" (ver `ApiAba.tsx`/`IntegracaoPage.tsx`).
// Nunca substitui `informarSujo` (que continua governando o bloqueio de navegação) — é só um sinal A MAIS.
import { createContext, useContext, useEffect } from "react";
import type { Aba } from "@/lib/integracao/abas";

export type GuardaIntegracao = {
  informarSujo: (aba: Aba, sujo: boolean) => void;
  informarChaveVisivel?: (visivel: boolean) => void;
};
export const GuardaIntegracaoContext = createContext<GuardaIntegracao | null>(null);
export function useAbaSuja(aba: Aba, sujo: boolean): void {
  const ctx = useContext(GuardaIntegracaoContext);
  useEffect(() => {
    ctx?.informarSujo(aba, sujo);
  }, [ctx, aba, sujo]);
  useEffect(() => () => ctx?.informarSujo(aba, false), [ctx, aba]);
}
