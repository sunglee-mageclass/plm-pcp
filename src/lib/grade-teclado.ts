// Navegação por teclado em grades (Enter desce / Tab ao lado), pulando células travadas.
// Spec: docs/superpowers/specs/2026-11-19-navegacao-teclado-grades-design.md
import { useCallback, useRef, type KeyboardEvent, type RefObject } from "react";
import { proximaCelulaTeclado } from "@/lib/plan-tecido/calc";

export function proximaCelulaDisponivel(a: {
  tecla: "Enter" | "Tab"; comShift: boolean; linha: number; coluna: number;
  nLinhas: number; nColunas: number; disponivel: (linha: number, coluna: number) => boolean;
}): { linha: number; coluna: number } | null {
  const max = Math.max(1, a.nLinhas * a.nColunas);
  let pos: { linha: number; coluna: number } | null = { linha: a.linha, coluna: a.coluna };
  for (let i = 0; i < max; i++) {
    pos = proximaCelulaTeclado({ tecla: a.tecla, comShift: a.comShift, linha: pos.linha, coluna: pos.coluna, nLinhas: a.nLinhas, nColunas: a.nColunas });
    if (!pos) return null;
    if (a.disponivel(pos.linha, pos.coluna)) return pos;
  }
  return null;
}

// Motor do teclado (Enter desce / Tab ao lado). Cada instancia enderaca as celulas por UM atributo data-* e so enxerga as celulas
// DENTRO do proprio gridRef — dois grids aninhados (tabela-mae + matriz expandida) usam atributos diferentes e nunca se enxergam.
function useTecladoPorAtributo(o: { nLinhas: number; nColunas: number }, atributo: string) {
  const gridRef = useRef<HTMLElement | null>(null);
  const nRef = useRef(o);
  nRef.current = o;

  const achar = useCallback((linha: number, coluna: number): HTMLInputElement | null => {
    const raiz = gridRef.current;
    if (!raiz) return null; // fail-closed: sem gridRef nao ha onde buscar (nunca cai no document)
    // MatrizGradeResponsiva monta desktop E mobile no DOM: a mesma coordenada aparece 2x. Pega a 1a VISIVEL
    // (display:none => getClientRects().length === 0); nenhuma visivel => null.
    const todos = raiz.querySelectorAll<HTMLInputElement>(`[${atributo}="${linha}:${coluna}"]`);
    for (const el of Array.from(todos)) if (el.getClientRects().length > 0) return el;
    return null;
  }, [atributo]);

  const aoTeclar = useCallback((linha: number, coluna: number) => (e: KeyboardEvent<HTMLElement>) => {
    if (!gridRef.current) return; // sem gridRef o hook fica inerte (fluxo nativo do navegador)
    if ((e.key !== "Enter" && e.key !== "Tab") || e.ctrlKey || e.metaKey || e.altKey) return;
    const { nLinhas, nColunas } = nRef.current;
    const alvo = proximaCelulaDisponivel({
      tecla: e.key, comShift: e.shiftKey, linha, coluna, nLinhas, nColunas,
      disponivel: (l, c) => { const el = achar(l, c); return !!el && !el.disabled; },
    });
    if (!alvo) { if (e.key === "Enter") e.preventDefault(); return; }
    e.preventDefault();
    const el = achar(alvo.linha, alvo.coluna);
    if (el) requestAnimationFrame(() => el.focus());
  }, [achar]);

  return { gridRef, aoTeclar };
}

// Hook: endereca as celulas por data-grade-cel="<linha>:<coluna>" e, no Enter/Tab, foca a proxima celula habilitada.
// Na borda (sem destino): Enter faz preventDefault; Tab segue o fluxo nativo do navegador.
export function useGradeTeclado(o: { nLinhas: number; nColunas: number }): {
  gridRef: RefObject<HTMLElement | null>;
  propsDaCelula: (linha: number, coluna: number) => { "data-grade-cel": string; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };
} {
  const { gridRef, aoTeclar } = useTecladoPorAtributo(o, "data-grade-cel");
  const propsDaCelula = useCallback((linha: number, coluna: number) => ({
    "data-grade-cel": `${linha}:${coluna}`,
    onKeyDown: aoTeclar(linha, coluna),
  }), [aoTeclar]);
  return { gridRef, propsDaCelula };
}

// Mesmo teclado, ESCOPO PROPRIO: para uma grade aninhada dentro de outra que ja usa `useGradeTeclado` (ex.: a matriz cor x tamanho
// da linha expandida do Planejamento de Produto). Atributo distinto (`data-matriz-cel`) + gridRef proprio => a tabela-mae nao
// enxerga estas celulas (nem esta enxerga as da mae). Linha/coluna sao locais a matriz.
export function useMatrizTeclado(o: { nLinhas: number; nColunas: number }): {
  gridRef: RefObject<HTMLElement | null>;
  propsDaCelula: (linha: number, coluna: number) => { "data-matriz-cel": string; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void };
} {
  const { gridRef, aoTeclar } = useTecladoPorAtributo(o, "data-matriz-cel");
  const propsDaCelula = useCallback((linha: number, coluna: number) => ({
    "data-matriz-cel": `${linha}:${coluna}`,
    onKeyDown: aoTeclar(linha, coluna),
  }), [aoTeclar]);
  return { gridRef, propsDaCelula };
}
