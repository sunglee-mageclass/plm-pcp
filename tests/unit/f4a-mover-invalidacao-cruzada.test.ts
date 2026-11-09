// F4a T2b — mover a etapa (hook central `useMoverEtapa`) invalida TODAS as telas que mostram o card:
// Planejamento/Dev, Produto Acabado, Produto Importado e Plan. Tecido. A invalidação mora no `onSettled` do
// `useMutation` (roda mesmo com o card desmontado), não no `mutate(..., { onSettled })` por card.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { QueryClient } from "@tanstack/react-query";
import { invalidarAposMoverEtapa } from "@/components/planejamento/planejamento-detail/ficha/useMoverEtapa";

const invalidada = (qc: QueryClient, key: unknown[]) => qc.getQueryState(key)?.isInvalidated === true;

describe("invalidarAposMoverEtapa", () => {
  it("invalida as keys das 3 telas + as de sempre, sem precisar do colecaoId", () => {
    const qc = new QueryClient();
    const keys: unknown[][] = [
      ["modelo", "m1"], ["plan-kanban-cond", "m1"], ["modelos-planejamento"], ["modelos-desenvolvimento"], ["desenv-condicoes"],
      ["produtos-acabados", "col-1"], ["produtos-importados", "col-2"],
      ["pa-kanban-cond", "col-1", ["m1"]], ["pi-kanban-cond", "col-2", ["m2"]],
      ["plan-tecido-modelos", "col-1"], ["plan-tecido-fases", "col-1"], ["plan-tecido-arvore", "col-1"],
    ];
    for (const k of keys) qc.setQueryData(k, 1);
    invalidarAposMoverEtapa(qc, "m1");
    for (const k of keys) expect(invalidada(qc, k), JSON.stringify(k)).toBe(true);
  });

  it("não invalida o que não é do card (config do kanban, outros modelos, telas alheias)", () => {
    const qc = new QueryClient();
    const intactas: unknown[][] = [
      ["pa-kanban-config", "t1"], ["modelo", "outro"], ["plan-kanban-cond", "outro"], ["colecao-nome", "col-1"], ["otb-orcamento"],
    ];
    for (const k of intactas) qc.setQueryData(k, 1);
    invalidarAposMoverEtapa(qc, "m1");
    for (const k of intactas) expect(invalidada(qc, k), JSON.stringify(k)).toBe(false);
  });

  it("a invalidação está no onSettled do PRÓPRIO useMutation (sobrevive ao card desmontar), e o hook de lote não a duplica por card", () => {
    const mover = readFileSync("src/components/planejamento/planejamento-detail/ficha/useMoverEtapa.ts", "utf8");
    expect(mover).toMatch(/onSettled:\s*\(\)\s*=>\s*invalidarAposMoverEtapa\(qc,\s*modeloId\)/);
    // o selo do PA não depende do `mutate(..., { onSettled })` por card: não passa `invalidar`
    const card = readFileSync("src/components/produto-acabado/ProdutoCard.tsx", "utf8");
    expect(card).not.toMatch(/invalidar:/);
  });
});
