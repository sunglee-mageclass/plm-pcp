import type { PtArvore, PtSlot } from "./types";

/** Tecidos/forros já usados pelos cards da coleção (distinct artigo_id + papel), p/ a paleta. */
export function tecidosDaArvore(arvore: PtArvore): { artigo_id: string; papel: string }[] {
  const seen = new Set<string>();
  const out: { artigo_id: string; papel: string }[] = [];
  for (const sub of arvore.subcolecoes ?? [])
    for (const ln of sub.linhas ?? [])
      for (const slot of ln.slots ?? [])
        for (const m of slot.materiais ?? []) {
          if (!m.artigo_id) continue;
          const papel = m.tipo === "forro" ? "forro" : "tecido";
          const k = `${m.artigo_id}|${papel}`;
          if (seen.has(k)) continue;
          seen.add(k);
          out.push({ artigo_id: m.artigo_id, papel });
        }
  return out;
}

export function custoMateriaisPrevisto(slot: PtSlot): number {
  // Σ (material.consumo × material.preco_por_metro) — ignores material without preco
  return (slot.materiais ?? []).reduce((sum, mat) => {
    if (!mat.preco_por_metro) return sum;
    return sum + (Number(mat.consumo) || 0) * Number(mat.preco_por_metro);
  }, 0);
}

export const necessidadeVariante = (consumo: number, gradeTotal: number, mult: number): number =>
  (Number(consumo) || 0) * (Number(gradeTotal) || 0) * (Number(mult) || 0);

/** Metros de necessidade de UM slot, filtrando os materiais por papel (tecido/forro/qualquer). */
export function slotMetros(slot: PtSlot, papel?: "tecido" | "forro"): number {
  let m = 0;
  for (const mat of slot.materiais ?? []) {
    if (papel === "tecido" && mat.tipo === "forro") continue;
    if (papel === "forro" && mat.tipo !== "forro") continue;
    for (const v of mat.variantes ?? []) m += necessidadeVariante(mat.consumo, v.grade_total, v.multiplicador);
  }
  return m;
}

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
        for (const mat of slot.materiais ?? []) {
          if (!mat.artigo_id) continue;
          let t = byArtigo.get(mat.artigo_id);
          if (!t) {
            t = { artigo_id: mat.artigo_id, artigo_nome: mat.artigo_nome ?? "", unidade_medida: mat.unidade_medida ?? null, rendimento: mat.rendimento ?? null, variantes: [], totalMetros: 0 };
            byArtigo.set(mat.artigo_id, t);
          }
          for (const v of mat.variantes ?? []) {
            const gradeBase = v.grade_total; // forro tem grade PRÓPRIA por variante (não mais multiplicador do Tecido 1)
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
