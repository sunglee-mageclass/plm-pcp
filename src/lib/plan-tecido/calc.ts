import type { PtArvore } from "./types";

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
  variantes: { variante_tecido_id: string; label: string; metros: number }[];
  totalMetros: number;
};

export function necessidadePorTecido(arvore: PtArvore): NecTecido[] {
  const byArtigo = new Map<string, NecTecido>();
  for (const sub of arvore.subcolecoes ?? []) {
    for (const ln of sub.linhas ?? []) {
      for (const slot of ln.slots ?? []) {
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
            if (!vr) { vr = { variante_tecido_id: v.variante_tecido_id, label: v.label ?? "", metros: 0 }; t.variantes.push(vr); }
            vr.metros += metros;
            t.totalMetros += metros;
          }
        }
      }
    }
  }
  return [...byArtigo.values()];
}
