// Merge 3-vias por CÉLULA de uma grade `Record<vid, Record<tam, Record<campo, number>>>`, com os
// CAMPOS parametrizados. Generaliza o `merge-grade.ts` (que é hard-coded p/ os 4 campos do CQ
// enviada/cortada/recebida/defeito e o tipo GradeDetalhe do grade-cortada) para grades com OUTRO
// conjunto de campos — ex.: a grade `grade_detalhe` das OCs de Produto Acabado/Importado, cuja célula
// é {pedida, recebida, defeito}. PURO.
//
// base = último visto do servidor · meu = o que estou vendo · fresh = chegou do servidor · tocadas =
// paths de célula/campo que EU editei ("grade:{vid}:{tam}:{campo}"). Campo NÃO tocado + mudou no
// servidor → adota o fresh. Tocado + mudou no servidor + diverge → conflito (mantém o meu).
// null/ausente ≡ 0.
import { igual, type Conflito } from "@/lib/colab/merge";

// Grade genérica: vid → tam → célula (mapa campo→número).
export type GradeCel = Record<string, number>;
export type GradeGenerica = Record<string, Record<string, GradeCel>>;

const n = (v: unknown) => Number(v) || 0;
export const pathCelula = (vid: string, tam: string, campo: string) => `grade:${vid}:${tam}:${campo}`;

function setCel(g: GradeGenerica, vid: string, tam: string, campo: string, val: number): GradeGenerica {
  const out: GradeGenerica = { ...g, [vid]: { ...(g[vid] ?? {}) } };
  out[vid][tam] = { ...(g[vid]?.[tam] ?? {}), [campo]: val };
  return out;
}

/**
 * @param campos os campos da célula a fundir (ex.: ["pedida","recebida","defeito"]).
 */
export function mergeGradeGenerico(o: {
  base: GradeGenerica; meu: GradeGenerica; fresh: GradeGenerica; tocadas: ReadonlySet<string>; campos: readonly string[];
}): { valor: GradeGenerica; conflitos: Conflito[]; atualizados: string[] } {
  let valor = o.meu;
  const conflitos: Conflito[] = [];
  const atualizados: string[] = [];
  const vids = new Set<string>([...Object.keys(o.base), ...Object.keys(o.meu), ...Object.keys(o.fresh)]);
  for (const vid of vids) {
    const tams = new Set<string>([
      ...Object.keys(o.base[vid] ?? {}), ...Object.keys(o.meu[vid] ?? {}), ...Object.keys(o.fresh[vid] ?? {}),
    ]);
    for (const tam of tams) {
      for (const campo of o.campos) {
        const vBase = n(o.base[vid]?.[tam]?.[campo]);
        const vMeu = n(o.meu[vid]?.[tam]?.[campo]);
        const vFresh = n(o.fresh[vid]?.[tam]?.[campo]);
        const mudouNoServidor = !igual(vBase, vFresh);
        const path = pathCelula(vid, tam, campo);
        if (!o.tocadas.has(path)) {
          if (mudouNoServidor) { valor = setCel(valor, vid, tam, campo, vFresh); atualizados.push(path); }
        } else if (mudouNoServidor && !igual(vMeu, vFresh)) {
          conflitos.push({ path, meu: vMeu, dele: vFresh }); // mantém o meu no valor
        }
      }
    }
  }
  return { valor, conflitos, atualizados };
}
