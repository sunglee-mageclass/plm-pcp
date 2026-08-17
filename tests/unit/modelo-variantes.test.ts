import { describe, it, expect } from "vitest";
import {
  removerVarianteDoBloco,
  remapGradesAposRemocao,
  makeEmptyBlocks,
  type TecidoBlock,
  type GradeRow,
} from "@/components/desenvolvimento/modelo-detail/types";

// Item 13 — remover a variante do MEIO no Desenvolvimento remove SÓ a alvo (splice,
// renumerando as posteriores), sem cascatear/zerar as seguintes, e remapeia as grades
// (grade por variante_numero) para que a grade SIGA a variante, não o número.

function blocoCom(ids: (string | null)[], mult: number[] = []): TecidoBlock {
  const b = makeEmptyBlocks().find((x) => x.tipo === "tecido" && x.numero === 1)!;
  const variantes = [...b.variantes];
  const multiplicadores = [...b.multiplicadores];
  const oc_links = b.oc_links.map((a) => [...a]);
  ids.forEach((id, i) => {
    variantes[i] = id;
    if (mult[i] != null) multiplicadores[i] = mult[i];
    // carimba um vínculo de OC por posição p/ provar que o oc_links acompanha o splice
    if (id) oc_links[i] = [{ oc_tecido_item_id: `oc-${id}`, quantidade_m: 1, prioridade: 1 }];
  });
  return { ...b, variantes, multiplicadores, oc_links };
}

describe("removerVarianteDoBloco — splice sem cascata", () => {
  it("remover a 1ª (índice 0) mantém as posteriores, deslocadas p/ cima", () => {
    const b = blocoCom(["A", "B", "C"], [1, 2, 3]);
    const r = removerVarianteDoBloco(b, 0);
    expect(r.variantes.slice(0, 3)).toEqual(["B", "C", null]);
    expect(r.multiplicadores.slice(0, 3)).toEqual([2, 3, 1]);
    expect(r.oc_links[0]?.[0]?.oc_tecido_item_id).toBe("oc-B");
    expect(r.oc_links[1]?.[0]?.oc_tecido_item_id).toBe("oc-C");
    expect(r.oc_links[2]).toEqual([]);
    // comprimento estável (10 posições) — não cria buraco no meio
    expect(r.variantes).toHaveLength(b.variantes.length);
  });

  it("remover a do MEIO (índice 1) preserva a 1ª e a 3ª (deslocada)", () => {
    const b = blocoCom(["A", "B", "C"], [5, 6, 7]);
    const r = removerVarianteDoBloco(b, 1);
    expect(r.variantes.slice(0, 3)).toEqual(["A", "C", null]);
    expect(r.multiplicadores.slice(0, 3)).toEqual([5, 7, 1]);
    expect(r.oc_links[0]?.[0]?.oc_tecido_item_id).toBe("oc-A");
    expect(r.oc_links[1]?.[0]?.oc_tecido_item_id).toBe("oc-C");
  });

  it("remover a última não afeta as anteriores", () => {
    const b = blocoCom(["A", "B", "C"]);
    const r = removerVarianteDoBloco(b, 2);
    expect(r.variantes.slice(0, 3)).toEqual(["A", "B", null]);
  });
});

describe("remapGradesAposRemocao — a grade segue a variante", () => {
  const grades: GradeRow[] = [
    { variante_numero: 1, grades: { P: 10 }, grade_total: 10 },
    { variante_numero: 2, grades: { P: 20 }, grade_total: 20 },
    { variante_numero: 3, grades: { P: 30 }, grade_total: 30 },
  ];

  it("remover a v1 → sobram v2/v3 renumeradas p/ 1/2, com SUAS grades (20/30)", () => {
    const r = remapGradesAposRemocao(grades, 1);
    expect(r).toEqual([
      { variante_numero: 1, grades: { P: 20 }, grade_total: 20 },
      { variante_numero: 2, grades: { P: 30 }, grade_total: 30 },
    ]);
  });

  it("remover a v2 (meio) → v1 intacta, antiga v3 vira v2 (grade 30)", () => {
    const r = remapGradesAposRemocao(grades, 2);
    expect(r).toEqual([
      { variante_numero: 1, grades: { P: 10 }, grade_total: 10 },
      { variante_numero: 2, grades: { P: 30 }, grade_total: 30 },
    ]);
  });

  it("remover a última (v3) → v1/v2 intactas", () => {
    const r = remapGradesAposRemocao(grades, 3);
    expect(r.map((g) => g.grade_total)).toEqual([10, 20]);
  });
});
