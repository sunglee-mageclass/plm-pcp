import { useCallback } from "react";
import { useUserPref } from "@/hooks/useUiPrefs";

/**
 * Persiste, POR USUÁRIO e POR TELA, quais DIMENSÕES de agrupamento estão ativas — no BANCO
 * (`user_ui_prefs`, scope 'agrupar'), então a preferência SEGUE o usuário em qualquer dispositivo
 * (antes: 5 telas não persistiam nada; 2 persistiam em localStorage sem uid). Gêmeo do
 * `useFilterState` — mesmo backend (`useUserPref` + espelho localStorage + debounce), só muda o
 * `scope`.
 *
 * Guarda um ARRAY de chaves de dimensão ativas (ex.: `["categoria","linha"]`), não N booleanos:
 * reduz a superfície e reusa toda a mecânica do filtro. Cada tela deriva os booleanos com
 * `isOn(dim)` / alterna com `toggle(dim, on)`.
 *
 * Uso:
 *   const g = useAgrupamentoState("criacao-planejamento", ["tecido"]); // dims iniciais ativas
 *   g.isOn("categoria")           // boolean
 *   g.toggle("categoria", true)   // liga/desliga
 *   g.ativos                      // string[] (p/ montar os GroupToggle do AgrupamentoButton)
 */
export function useAgrupamentoState(screen: string, initial: string[] = []) {
  // `key` fixo "dims" — uma pref por tela (o array cobre todas as dimensões daquela tela).
  const [ativos, setAtivos] = useUserPref("agrupar", screen, "dims", initial);

  const isOn = useCallback((dim: string) => ativos.includes(dim), [ativos]);

  const toggle = useCallback(
    (dim: string, on: boolean) => {
      const jaTem = ativos.includes(dim);
      if (on === jaTem) return;
      setAtivos(on ? [...ativos, dim] : ativos.filter((d) => d !== dim));
    },
    [ativos, setAtivos],
  );

  const set = useCallback((dims: string[]) => setAtivos(dims), [setAtivos]);

  return { ativos, isOn, toggle, set };
}
