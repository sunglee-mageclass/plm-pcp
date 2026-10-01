import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { statusCqAposServidor, statusCqDe } from "@/lib/cq-status-tela";

describe("cq-status (R14 M1)", () => {
  it("statusCqDe: sem linha/sem status = pendente", () => {
    expect(statusCqDe(null)).toBe("pendente");
    expect(statusCqDe(undefined)).toBe("pendente");
    expect(statusCqDe({ status: null })).toBe("pendente");
    expect(statusCqDe({ status: "confirmado" })).toBe("confirmado");
  });
  it("servidor rebaixou o CQ (confirmado -> pendente): a tela adota o pendente", () => {
    expect(statusCqAposServidor("confirmado", { status: "pendente" })).toBe("pendente");
    expect(statusCqAposServidor("confirmado", null)).toBe("pendente");
  });
  it("servidor confirmou em outra tela: adota o confirmado; igual = mesmo valor", () => {
    expect(statusCqAposServidor("pendente", { status: "confirmado" })).toBe("confirmado");
    expect(statusCqAposServidor("confirmado", { status: "confirmado" })).toBe("confirmado");
  });
  it("a tela do CQ re-semeia o status nos 3 caminhos (merge, reseed pós-save, reconcile P0409)", () => {
    const src = readFileSync("src/routes/_authenticated/expedicao.cq.$modeloId.tsx", "utf8");
    expect(src.match(/statusCqAposServidor\(atual, /g)?.length).toBe(2);
    expect(src).toContain("setStatus(statusCqDe(freshCq))");
    expect(src).toContain("setStatus(statusCqDe(cqRow as any))");
  });
});
