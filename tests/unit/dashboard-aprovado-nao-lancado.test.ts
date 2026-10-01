import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { aprovadosNaoLancados, colunaAprovado } from "@/lib/dashboard-producao";

// Achados MÉDIOS R12, prod #6: o KPI "No status Aprovado" (subtítulo "aprovados, não lançados") lê a chave
// aprovadoNaoLancado da RPC dashboard_producao — a coluna do gráfico conta também os lançados (Blusa Master).
describe("aprovadosNaoLancados (R12 prod #6)", () => {
  const kanbanDev = [
    { key: "em_modelagem", label: "Em Modelagem", modelos: 3 },
    { key: "aprovado", label: "Aprovado", modelos: 6 },
  ];

  it("usa a chave aprovadoNaoLancado da RPC, não a coluna do gráfico", () => {
    expect(aprovadosNaoLancados({ aprovadoNaoLancado: 5, kanbanDev })).toBe(5);
    expect(aprovadosNaoLancados({ aprovadoNaoLancado: 0, kanbanDev })).toBe(0);
  });

  it("sem a chave (banco sem a migration) cai na contagem da coluna", () => {
    expect(aprovadosNaoLancados({ kanbanDev })).toBe(6);
    expect(aprovadosNaoLancados({ aprovadoNaoLancado: null, kanbanDev })).toBe(6);
    expect(aprovadosNaoLancados(undefined)).toBe(0);
    expect(aprovadosNaoLancados({ kanbanDev: [{ key: "pcp", label: "PCP", modelos: 9 }] })).toBe(0);
  });

  it("coluna: key exata 'aprovado' antes do match por label (mesmo critério do SQL)", () => {
    const cols = [
      { key: "pre_aprovado", label: "Pré-aprovado", modelos: 1 },
      { key: "aprovado", label: "Aprovado", modelos: 2 },
    ];
    expect(colunaAprovado(cols)?.key).toBe("aprovado");
    expect(colunaAprovado([{ key: "ok", label: "Aprovada", modelos: 4 }])?.key).toBe("ok");
    expect(
      colunaAprovado([{ key: "aprovacao_de_custo", label: "Aprovação de Custo" }]),
    ).toBeUndefined();
  });

  it("dashboard.tsx usa o helper (não refaz a conta pela coluna)", () => {
    const src = readFileSync(
      resolve(__dirname, "../../src/routes/_authenticated/dashboard.tsx"),
      "utf8",
    );
    expect(src).toMatch(/const aprovados = aprovadosNaoLancados\(prod\.data\)/);
    expect(src).not.toMatch(/kanbanDev\.find\(\(k\) => k\.key === "aprovado"\)/);
  });
});
