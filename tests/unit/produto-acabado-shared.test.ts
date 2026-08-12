import { describe, it, expect } from "vitest";
import {
  ehDistribuicaoProporcional,
  redistribuirVariantesPorPeso,
  variantesBatemComTotal,
  type VarianteDraft,
} from "@/components/produto-acabado/shared";

// FIX WAVE, review R1: mudar a Qtd total redistribuía as variantes por peso SEMPRE — mesmo
// quando o usuário tinha acabado de editar uma célula de qtd manualmente, descartando a
// edição em silêncio. `ehDistribuicaoProporcional` é o predicado que decide se a distribuição
// atual ainda É a saída do algoritmo (então redistribuir automaticamente é seguro) ou se foi
// tocada manualmente (então a Qtd total muda mas as qtds ficam como estavam).

const v = (ordem: number, peso: number, qtd: number): VarianteDraft => ({ ordem, cor_id: null, cor_apelido_id: null, peso, qtd });

describe("ehDistribuicaoProporcional", () => {
  it("distribuição recém-gerada por redistribuirVariantesPorPeso é proporcional (true)", () => {
    const variantes = redistribuirVariantesPorPeso([v(1, 3, 0), v(2, 1, 0), v(3, 1, 0)], 100);
    expect(ehDistribuicaoProporcional(variantes, 100)).toBe(true);
  });

  it("editar manualmente a qtd de UMA variante deixa de ser proporcional (false)", () => {
    const variantes = redistribuirVariantesPorPeso([v(1, 3, 0), v(2, 1, 0), v(3, 1, 0)], 100);
    // usuário digita um valor diferente do que o algoritmo teria posto ali
    const editadas = variantes.map((x) => (x.ordem === 2 ? { ...x, qtd: 999 } : x));
    expect(ehDistribuicaoProporcional(editadas, 100)).toBe(false);
  });

  it("lista vazia é proporcional trivialmente (nada pra desalinhar)", () => {
    expect(ehDistribuicaoProporcional([], 50)).toBe(true);
  });

  it("total zerado com todas as qtds zeradas continua proporcional", () => {
    const variantes = [v(1, 1, 0), v(2, 1, 0)];
    expect(ehDistribuicaoProporcional(variantes, 0)).toBe(true);
  });

  it("qtds que batem por coincidência com outro total (não foi editado, só nunca redistribuído p/ o total atual) ainda conta como manual se não bater com o split", () => {
    // variantes paradas em 10/10 (soma 20) mas qtd_total mudou pra 30 sem redistribuir —
    // a saída do split pra peso 1:1 e total 30 seria 15/15, então 10/10 NÃO é proporcional a 30.
    const variantes = [v(1, 1, 10), v(2, 1, 10)];
    expect(ehDistribuicaoProporcional(variantes, 30)).toBe(false);
  });
});

describe("variantesBatemComTotal (sanity — usado junto do predicado acima na UI)", () => {
  it("soma das qtds bate com qtd_total → true", () => {
    expect(variantesBatemComTotal({ variantes: [v(1, 1, 5), v(2, 1, 5)], qtd_total: 10 })).toBe(true);
  });
  it("soma difere de qtd_total (ex.: total mudou e não redistribuiu) → false", () => {
    expect(variantesBatemComTotal({ variantes: [v(1, 1, 5), v(2, 1, 5)], qtd_total: 30 })).toBe(false);
  });
});
