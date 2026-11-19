// Navegação por teclado em grades (Enter desce / Tab ao lado), pulando células travadas.
// Spec: docs/superpowers/specs/2026-11-19-navegacao-teclado-grades-design.md
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
