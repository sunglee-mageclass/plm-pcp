import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decidirStatusServidor, statusCqDe } from "@/lib/cq-status-tela";

describe("cq-status-tela (R14 M1 / M-A / M-C)", () => {
  it("statusCqDe: sem linha/sem status = pendente", () => {
    expect(statusCqDe(null)).toBe("pendente");
    expect(statusCqDe(undefined)).toBe("pendente");
    expect(statusCqDe({ status: null })).toBe("pendente");
    expect(statusCqDe({ status: "confirmado" })).toBe("confirmado");
  });
  it("status igual: nada a fazer", () => {
    expect(decidirStatusServidor({ atual: "pendente", fresco: "pendente", temEdicao: true }))
      .toEqual({ status: "pendente", manterEdicao: false, rebaselinar: false, aviso: null });
  });
  it("M-A: pendente + edição não salva + servidor confirmou => mantém edição e avisa (não fica só leitura)", () => {
    const d = decidirStatusServidor({ atual: "pendente", fresco: "confirmado", temEdicao: true });
    expect(d).toMatchObject({ status: "confirmado", manterEdicao: true, rebaselinar: false });
    expect(d.aviso).toContain("Suas alterações continuam aqui");
    expect(d.aviso).toContain("confirmado");
  });
  it("M-C: confirmado só olhando + servidor rebaixou => adota, rebaselina e avisa", () => {
    const d = decidirStatusServidor({ atual: "confirmado", fresco: "pendente", temEdicao: false });
    expect(d).toMatchObject({ status: "pendente", manterEdicao: false, rebaselinar: true });
    expect(d.aviso).toBe("O CQ voltou para pendente (a grade real mudou no PCP ou o Pré foi desmarcado).");
  });
  it("sem edição + servidor confirmou em outra tela => adota e avisa", () => {
    const d = decidirStatusServidor({ atual: "pendente", fresco: "confirmado", temEdicao: false });
    expect(d).toMatchObject({ status: "confirmado", rebaselinar: true });
    expect(d.aviso).toContain("confirmado");
  });
  it("edição + rebaixe: mantém a edição com aviso", () => {
    const d = decidirStatusServidor({ atual: "confirmado", fresco: "pendente", temEdicao: true });
    expect(d).toMatchObject({ status: "pendente", manterEdicao: true });
  });
  it("as telas Pré e Pós usam o helper nos caminhos de releitura", () => {
    const pre = readFileSync("src/routes/_authenticated/expedicao.cq.$modeloId.tsx", "utf8");
    expect(pre.match(/decidirStatusServidor\(/g)?.length).toBe(1);
    expect(pre.match(/aplicarDecisaoStatus\(statusCqDe\(/g)?.length).toBe(2); // merge + reconcile P0409
    expect(pre).toContain("setStatus(statusCqDe(freshCq))"); // reseed pós-save
    const pos = readFileSync("src/components/producao/CqPosView.tsx", "utf8");
    expect(pos).toContain("decidirStatusServidor(");
  });
});
