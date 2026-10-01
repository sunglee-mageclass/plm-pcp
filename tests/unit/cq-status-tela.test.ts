import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { decidirStatusServidor, deveReaplicarStatusAposErro, mensagemToastPosSavePcp, statusCqDe } from "@/lib/cq-status-tela";

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

import { baselineAposMerge } from "@/lib/cq-status-tela";
describe("baselineAposMerge (R14 N1)", () => {
  it("sem bloco-fonte (merge só do form): a grade do baseline é a do state, NÃO a zerada de mg.valor", () => {
    const gradesAtuais = { recebimento: { 1: { grades: { P: 3 }, grade_total: 3 } } };
    const aplicar = () => ({ recebimento: { 1: { grades: {}, grade_total: 0 } } }); // o que aplicarGradeNoState faria com mg.valor = {}
    const b = baselineAposMerge({ formMexeu: true, gradeMexeu: false, formMesclado: { obs: "novo" }, formAtual: { obs: "velho" }, gradesAtuais, aplicarGrade: aplicar });
    expect(b.grades).toBe(gradesAtuais);
    expect(b.form).toEqual({ obs: "novo" });
    // o snapshot (JSON) do baseline == o do state => changed === false
    expect(JSON.stringify({ form: b.form, grades: b.grades })).toBe(JSON.stringify({ form: { obs: "novo" }, grades: gradesAtuais }));
  });
  it("só a grade mexeu: form do state; grade aplicada", () => {
    const b = baselineAposMerge({ formMexeu: false, gradeMexeu: true, formMesclado: { obs: "x" }, formAtual: { obs: "atual" }, gradesAtuais: { a: 1 }, aplicarGrade: () => ({ a: 2 }) });
    expect(b).toEqual({ form: { obs: "atual" }, grades: { a: 2 } });
  });
  it("Pós: o aviso fala em 'CQ Pós'", () => {
    expect(decidirStatusServidor({ atual: "confirmado", fresco: "pendente", temEdicao: false, nome: "CQ Pós" }).aviso).toMatch(/^O CQ Pós voltou para pendente/);
  });
});

describe("deveReaplicarStatusAposErro (R14 N6)", () => {
  it("erro que não é P0409 relê o CQ", () => {
    expect(deveReaplicarStatusAposErro({ code: "42501" })).toBe(true);
    expect(deveReaplicarStatusAposErro(new Error("rede"))).toBe(true);
    expect(deveReaplicarStatusAposErro(null)).toBe(true);
  });
  it("P0409 segue pelo reconcile próprio", () => {
    expect(deveReaplicarStatusAposErro({ code: "P0409" })).toBe(false);
  });
});

describe("mensagemToastPosSavePcp (R13)", () => {
  it("confirmado -> pendente é o rebaixamento", () => {
    expect(mensagemToastPosSavePcp("confirmado", "pendente")).toEqual({ rebaixou: true, texto: "O CQ voltou a pendente: a grade real zerou" });
  });
  it("confirmado -> confirmado, antes null/pendente e leitura que falhou => neutro", () => {
    for (const [a, d] of [["confirmado", "confirmado"], [null, "pendente"], ["pendente", "pendente"], ["confirmado", null]] as const)
      expect(mensagemToastPosSavePcp(a, d)).toEqual({ rebaixou: false, texto: "Salvo com sucesso" });
  });
});
