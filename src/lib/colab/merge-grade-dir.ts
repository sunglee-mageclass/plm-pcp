// Merge 3-vias por CÉLULA da grade do DIRECIONAMENTO (Fase 3 / Onda 1, set/2026). Espelha
// `merge-grade.ts` (CQ) mas com a dimensão a mais LOJA — a grade é variante × loja × tamanho, e o
// valor da célula é a quantidade DIRETA (sem o "campo" enviada/cortada/recebida/defeito do CQ).
// PURO. base = último visto do servidor · meu = o que estou vendo · fresh = chegou do servidor ·
// tocadas = paths de célula que EU editei ("dir:{variante}:{loja}:{tam}"). Célula não tocada +
// mudou no servidor → adota o fresh. Tocada + mudou no servidor + diverge → conflito (mantém o meu).
// null/ausente ≡ 0 (grade é numérica; célula ausente = 0).
//
// O path `dir:${variante}:${loja}:${tam}` coincide de propósito com o `data-colab-path` dos inputs
// da tela (o mesmo que o ring de presença já usa), então o rótulo/anel/conflito falam a mesma língua.
import { igual, type Conflito } from "@/lib/colab/merge";

// A parte MERGEÁVEL do state: por variante → por loja → por tamanho → qtd. (A grade `real` do
// Direcionamento é read-only e NÃO entra no merge — chega por invalidação, não é "minha edição".)
export type GradeDir = Record<number, Record<string, Record<string, number>>>;

const n = (v: unknown) => Number(v) || 0;
export const pathDirCel = (variante: number, loja: string, tam: string) => `dir:${variante}:${loja}:${tam}`;

// Clona raso o suficiente p/ setar uma célula sem mutar `meu`.
function setCel(g: GradeDir, variante: number, loja: string, tam: string, val: number): GradeDir {
  const out: GradeDir = { ...g, [variante]: { ...(g[variante] ?? {}) } };
  out[variante][loja] = { ...(g[variante]?.[loja] ?? {}), [tam]: val };
  return out;
}

export function mergeGradeDir(o: {
  base: GradeDir; meu: GradeDir; fresh: GradeDir; tocadas: ReadonlySet<string>;
}): { valor: GradeDir; conflitos: Conflito[]; atualizados: string[] } {
  let valor = o.meu;
  const conflitos: Conflito[] = [];
  const atualizados: string[] = [];
  // UNIÃO das variantes das 3 fontes.
  const variantes = new Set<number>([
    ...Object.keys(o.base).map(Number), ...Object.keys(o.meu).map(Number), ...Object.keys(o.fresh).map(Number),
  ]);
  for (const variante of variantes) {
    // UNIÃO das lojas.
    const lojas = new Set<string>([
      ...Object.keys(o.base[variante] ?? {}), ...Object.keys(o.meu[variante] ?? {}), ...Object.keys(o.fresh[variante] ?? {}),
    ]);
    for (const loja of lojas) {
      // UNIÃO dos tamanhos.
      const tams = new Set<string>([
        ...Object.keys(o.base[variante]?.[loja] ?? {}),
        ...Object.keys(o.meu[variante]?.[loja] ?? {}),
        ...Object.keys(o.fresh[variante]?.[loja] ?? {}),
      ]);
      for (const tam of tams) {
        const vBase = n(o.base[variante]?.[loja]?.[tam]);
        const vMeu = n(o.meu[variante]?.[loja]?.[tam]);
        const vFresh = n(o.fresh[variante]?.[loja]?.[tam]);
        const mudouNoServidor = !igual(vBase, vFresh);
        const path = pathDirCel(variante, loja, tam);
        if (!o.tocadas.has(path)) {
          if (mudouNoServidor) { valor = setCel(valor, variante, loja, tam, vFresh); atualizados.push(path); }
        } else if (mudouNoServidor && !igual(vMeu, vFresh)) {
          conflitos.push({ path, meu: vMeu, dele: vFresh }); // mantém o meu no valor
        }
      }
    }
  }
  return { valor, conflitos, atualizados };
}
