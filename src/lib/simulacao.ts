// Cálculo puro do Simulador de Uso de OC (sem I/O; testável).
// Espelha a distribuição do editor PV (splitEven) e a metragem de consumo_por_oc.

/** Reparte um inteiro igualmente em n baldes; o resto vai pros primeiros. */
export const splitEven = (total: number, n: number): number[] => {
  if (n <= 0) return [];
  const base = Math.floor(total / n), rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
};

/** Metragem do item de OC: kg converte por rendimento; unidade em metro é direto. */
export const metragemDisponivel = (unidadeMedida: string | null, quantidade: number, rendimento: number | null): number =>
  (unidadeMedida === "kg" ? (quantidade || 0) * (rendimento || 0) : (quantidade || 0));

/** Peças de uma linha = profundidade × cores (Orçamento: cores = 1). */
export const pecasLinha = (profCor: number, cores: number): number => (profCor || 0) * (cores || 0);

/** Demanda (m) de uma linha = Σ dos modelos (peças × consumo). Sem perda. */
export const demandaLinha = (profCor: number, cores: number, consumos: number[]): number => {
  const p = pecasLinha(profCor, cores);
  return consumos.reduce((s, c) => s + p * (c || 0), 0);
};

/** Saldo = disponível − demanda (≥0 sobra, <0 estoura). */
export const saldo = (disponivel: number, demanda: number): number => (disponivel || 0) - (demanda || 0);

/** Distribui `num` nas semanas dadas (chaves string), via splitEven. */
export const distribuirNasSemanas = (num: number, semanas: number[]): Record<string, number> => {
  const shares = splitEven(num, semanas.length);
  const out: Record<string, number> = {};
  semanas.forEach((w, i) => { out[String(w)] = shares[i] ?? 0; });
  return out;
};
