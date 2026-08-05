// Direcionamento multi-lojas: diferença por tamanho entre a grade real e a soma das
// linhas por loja. Puro (testado em tests/unit) — alimenta o rodapé vivo e o motivo
// do botão Confirmar. A validação de VERDADE é do servidor (_salvar_direcionamento_core
// estrito); aqui é só o feedback antes de tentar.

export type DiffTamanho = { tamanho: string; real: number; direcionado: number; delta: number };

export function diffPorTamanho(
  real: Record<string, number>,
  linhas: Array<Record<string, number>>,
  tamanhos: string[],
): DiffTamanho[] {
  return tamanhos.map((t) => {
    const r = Number(real?.[t] ?? 0);
    const d = linhas.reduce((s, l) => s + Number(l?.[t] ?? 0), 0);
    return { tamanho: t, real: r, direcionado: d, delta: d - r };
  });
}

/** Primeiro problema encontrado, em PT — null quando toda a grade bate. */
export function motivoNaoConfere(diffs: DiffTamanho[]): string | null {
  for (const d of diffs) {
    if (d.delta < 0) return `Falta direcionar ${-d.delta} peça(s) no tamanho ${d.tamanho}.`;
    if (d.delta > 0) return `${d.delta} peça(s) a mais no tamanho ${d.tamanho}.`;
  }
  return null;
}
