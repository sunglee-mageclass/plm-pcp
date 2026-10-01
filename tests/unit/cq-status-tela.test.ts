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

import { mergeDraft } from "@/lib/colab/merge";
describe("retry do P0409 (QA cenário 19)", () => {
  it("o estado do retry contém o campo que o OUTRO salvou (A não tocou) e preserva o que A tocou", () => {
    const base = { observacoes_cq: "QA19 do B", pecas_incompletas: 0 };
    const draftA = { observacoes_cq: "QA19 do B", pecas_incompletas: 7 }; // A só mexeu em peças
    const fresh = { observacoes_cq: "QA19 B novo", pecas_incompletas: 0 }; // B salvou a obs
    const md = mergeDraft({ base, draft: draftA, fresh, touched: new Set(["pecas_incompletas"]) });
    const formMexeu = md.atualizados.length > 0 || md.conflitos.length > 0;
    const b = baselineAposMerge({ formMexeu, gradeMexeu: false, formMesclado: md.valor, formAtual: draftA, gradesAtuais: {}, aplicarGrade: () => ({}) });
    expect(formMexeu).toBe(true);
    expect(b.form.observacoes_cq).toBe("QA19 B novo"); // antes do fix: "QA19 do B" (velho) apagava a edição do B
    expect(b.form.pecas_incompletas).toBe(7);
  });
  it("a tela monta o payload do retry a partir de retryEstadoRef (não do state)", () => {
    const src = readFileSync("src/routes/_authenticated/expedicao.cq.$modeloId.tsx", "utf8");
    expect(src).toContain("retryEstadoRef.current = { form: b.form, grades: b.grades }");
    expect(src).toContain("const f = retryEstadoRef.current?.form ?? form;");
  });
});
