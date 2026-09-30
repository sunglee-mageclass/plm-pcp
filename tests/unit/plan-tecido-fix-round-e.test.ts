import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { custoDetalheDoCard, poderVendaCalculando } from "@/lib/plan-tecido/preco-vaga";

const src = (f: string) => readFileSync(`src/components/plan-tecido/${f}`, "utf8");

describe("invalidação após salvar/aplicar", () => {
  const sheet = src("PlanTecidoSheet.tsx");
  it("cada invalidação de vinculos também invalida custo-cards e vinculos-detalhe", () => {
    const n = (sheet.match(/\["plan-tecido-vinculos", (colecaoId|cid)\] \}\)/g) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect((sheet.match(/\["plan-tecido-custo-cards", (colecaoId|cid)\] \}\)/g) ?? []).length).toBe(n);
    expect((sheet.match(/\["plan-tecido-vinculos-detalhe", (colecaoId|cid)\] \}\)/g) ?? []).length).toBe(n);
  });
  it("Aplicar ao modelo (ModelCard) também invalida", () => {
    const m = src("ModelCard.tsx");
    expect(m).toContain('["plan-tecido-custo-cards", colecaoId]');
    expect(m).toContain('["plan-tecido-vinculos-detalhe", colecaoId]');
  });
});

describe("detalhe de custo do card", () => {
  const m = { custo_tecido_total: "100.5", custo_forro_total: 10, custo_entretela_total: null, custo_aviamento_total: 5 };
  it("mapeia os totais do servidor", () => {
    expect(custoDetalheDoCard(m, true)).toEqual({ tecido: 100.5, forro: 10, entretela: 0, aviamento: 5 });
  });
  it("sem permissão/carregando ou sem modelo => null", () => {
    expect(custoDetalheDoCard(m, false)).toBeNull();
    expect(custoDetalheDoCard(undefined, true)).toBeNull();
  });
  it("CustoDoCard não usa mais a estimativa da vaga", () => {
    const s = src("CustoSection.tsx");
    const bloco = s.slice(s.indexOf("function CustoDoCard"), s.indexOf("function CustoDaVagaSemCard"));
    expect(bloco).not.toContain("custoMateriaisPrevisto");
    expect(bloco).toContain("custoCardDetalhe");
  });
});

describe("poder de venda calculando", () => {
  it("só enquanto pendente E há vaga com card", () => {
    expect(poderVendaCalculando(true, true)).toBe(true);
    expect(poderVendaCalculando(true, false)).toBe(false);
    expect(poderVendaCalculando(false, true)).toBe(false);
  });
  it("Resumo usa o helper", () => {
    expect(src("ResumoPanel.tsx")).toContain("calculando…");
  });
});
