// Merge 3-vias por CÉLULA da grade destrinchada compartilhada (spec 2026-08-07).
// PURO. base = último visto do servidor · meu = o que estou vendo · fresh = chegou do
// servidor · tocadas = paths de célula/campo que EU editei ("grade:{vid}:{tam}:{campo}").
// Campo NÃO tocado + mudou no servidor → adota o fresh. Tocado + mudou no servidor +
// diverge → conflito (mantém o meu). null/ausente ≡ 0 (grade é numérica; célula ausente = 0).
import { igual, type Conflito } from "@/lib/colab/merge";
import type { GradeDetalhe, CelulaGrade } from "@/lib/grade-cortada";

const CAMPOS = ["enviada", "cortada", "recebida", "defeito"] as const;
type Campo = (typeof CAMPOS)[number];
const n = (v: unknown) => Number(v) || 0;
const pathDe = (vid: string, tam: string, campo: Campo) => `grade:${vid}:${tam}:${campo}`;

// Clona raso o suficiente p/ setar uma célula sem mutar `meu`.
function setCel(g: GradeDetalhe, vid: string, tam: string, campo: Campo, val: number): GradeDetalhe {
  const out: GradeDetalhe = { ...g, [vid]: { ...(g[vid] ?? {}) } };
  out[vid][tam] = { ...(g[vid]?.[tam] ?? {}), [campo]: val } as CelulaGrade;
  return out;
}

export function mergeGrade(o: {
  base: GradeDetalhe; meu: GradeDetalhe; fresh: GradeDetalhe; tocadas: ReadonlySet<string>;
}): { valor: GradeDetalhe; conflitos: Conflito[]; atualizados: string[] } {
  let valor = o.meu;
  const conflitos: Conflito[] = [];
  const atualizados: string[] = [];
  // UNIÃO de (vid, tam) das 3 fontes.
  const vids = new Set<string>([...Object.keys(o.base), ...Object.keys(o.meu), ...Object.keys(o.fresh)]);
  for (const vid of vids) {
    const tams = new Set<string>([
      ...Object.keys(o.base[vid] ?? {}), ...Object.keys(o.meu[vid] ?? {}), ...Object.keys(o.fresh[vid] ?? {}),
    ]);
    for (const tam of tams) {
      for (const campo of CAMPOS) {
        const vBase = n(o.base[vid]?.[tam]?.[campo]);
        const vMeu = n(o.meu[vid]?.[tam]?.[campo]);
        const vFresh = n(o.fresh[vid]?.[tam]?.[campo]);
        const mudouNoServidor = !igual(vBase, vFresh);
        const path = pathDe(vid, tam, campo);
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
