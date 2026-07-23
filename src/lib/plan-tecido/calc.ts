import type { PtArvore, PtSlot } from "./types";

export function custoMateriaisPrevisto(slot: PtSlot): number {
  // Σ (material.consumo × material.preco_por_metro) — ignores material without preco
  return (slot.materiais ?? []).reduce((sum, mat) => {
    if (!mat.preco_por_metro) return sum;
    return sum + (Number(mat.consumo) || 0) * Number(mat.preco_por_metro);
  }, 0);
}

export const necessidadeVariante = (consumo: number, gradeTotal: number, mult: number): number =>
  (Number(consumo) || 0) * (Number(gradeTotal) || 0) * (Number(mult) || 0);

export const metrosParaKg = (metros: number, rendimento: number | null): number =>
  rendimento && rendimento > 0 ? (Number(metros) || 0) / rendimento : 0;

export const abaterEstoque = (necessidadeMetros: number, estoqueMetros: number): number =>
  Math.max(0, (Number(necessidadeMetros) || 0) - (Number(estoqueMetros) || 0));

export type NecTecido = {
  artigo_id: string;
  artigo_nome: string;
  unidade_medida: string | null;
  rendimento: number | null;
  variantes: { variante_tecido_id: string; label: string; cor_nome: string | null; metros: number }[];
  totalMetros: number;
};

export function necessidadePorTecido(arvore: PtArvore, filtroSlot?: (slot: PtSlot) => boolean): NecTecido[] {
  const byArtigo = new Map<string, NecTecido>();
  for (const sub of arvore.subcolecoes ?? []) {
    for (const ln of sub.linhas ?? []) {
      for (const slot of ln.slots ?? []) {
        if (filtroSlot && !filtroSlot(slot)) continue;
        // Design D8: forro uses grade_total from Tecido 1 of the same slot
        const tecido1Total = (slot.materiais ?? [])
          .filter((m) => m.tipo === "tecido" && m.numero === 1)
          .flatMap((m) => m.variantes ?? [])
          .reduce((sum, v) => sum + (Number(v.grade_total) || 0), 0);

        for (const mat of slot.materiais ?? []) {
          if (!mat.artigo_id) continue;
          let t = byArtigo.get(mat.artigo_id);
          if (!t) {
            t = { artigo_id: mat.artigo_id, artigo_nome: mat.artigo_nome ?? "", unidade_medida: mat.unidade_medida ?? null, rendimento: mat.rendimento ?? null, variantes: [], totalMetros: 0 };
            byArtigo.set(mat.artigo_id, t);
          }
          for (const v of mat.variantes ?? []) {
            const gradeBase = mat.tipo === "forro" ? tecido1Total : v.grade_total;
            const metros = necessidadeVariante(mat.consumo, gradeBase, v.multiplicador);
            if (metros <= 0) continue;
            let vr = t.variantes.find((x) => x.variante_tecido_id === v.variante_tecido_id);
            if (!vr) { vr = { variante_tecido_id: v.variante_tecido_id, label: (v.label || v.cor_nome) ?? "", cor_nome: v.cor_nome ?? null, metros: 0 }; t.variantes.push(vr); }
            vr.metros += metros;
            t.totalMetros += metros;
          }
        }
      }
    }
  }
  return [...byArtigo.values()];
}

/**
 * Distribui gradeTotal pelos tamanhos de proporcoes, proporcional ao peso.
 * Resto de arredondamento vai pro tamanho de maior peso.
 * proporcoes null/undefined/vazio → retorna {}.
 */
export function distribuirGrade(
  gradeTotal: number,
  proporcoes: Record<string, number> | null | undefined,
): Record<string, number> {
  if (!proporcoes) return {};
  const entradas = Object.entries(proporcoes);
  if (entradas.length === 0) return {};
  const soma = entradas.reduce((s, [, p]) => s + (Number(p) || 0), 0);
  if (soma <= 0 || gradeTotal <= 0) {
    return Object.fromEntries(entradas.map(([tam]) => [tam, 0]));
  }
  // distribuição base (floor)
  const resultado: Record<string, number> = {};
  let distribuido = 0;
  for (const [tam, peso] of entradas) {
    const val = Math.floor((gradeTotal * (Number(peso) || 0)) / soma);
    resultado[tam] = val;
    distribuido += val;
  }
  // resto vai pro maior peso
  const resto = gradeTotal - distribuido;
  if (resto > 0) {
    const [tamMaior] = entradas.reduce(([bestTam, bestP], [tam, p]) =>
      (Number(p) || 0) > (Number(bestP) || 0) ? [tam, p] : [bestTam, bestP],
    );
    resultado[tamMaior] = (resultado[tamMaior] ?? 0) + resto;
  }
  return resultado;
}
