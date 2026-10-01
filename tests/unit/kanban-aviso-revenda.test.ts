import { describe, it, expect } from "vitest";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { revendaSemRequisitos } from "@/lib/kanban-auto-config";
import { AvisoRevendaSemRequisitos } from "@/components/admin/KanbanAutomaticoDialog";

// kanban #9 — aviso âmbar (não bloqueia) só com módulo produto_acabado ligado e requisitos da revenda vazios.
describe("revendaSemRequisitos", () => {
  it("módulo desligado → nunca avisa", () => {
    expect(revendaSemRequisitos(false, {})).toBe(false);
    expect(revendaSemRequisitos(false, null)).toBe(false);
  });
  it("módulo ligado + vazio → avisa", () => {
    expect(revendaSemRequisitos(true, {})).toBe(true);
    expect(revendaSemRequisitos(true, null)).toBe(true);
    expect(revendaSemRequisitos(true, { a: [], b: [] })).toBe(true);
  });
  it("módulo ligado + ao menos um requisito → não avisa", () => {
    expect(revendaSemRequisitos(true, { a: [], b: ["foto"] })).toBe(false);
  });
});

describe("AvisoRevendaSemRequisitos", () => {
  it("renderiza só quando `mostrar`, com o atalho", () => {
    expect(renderToStaticMarkup(h(AvisoRevendaSemRequisitos, { mostrar: false, onIrParaFluxo: () => {} }))).toBe("");
    const html = renderToStaticMarkup(h(AvisoRevendaSemRequisitos, { mostrar: true, onIrParaFluxo: () => {} }));
    expect(html).toContain("Revenda sem requisitos");
    expect(html).toContain("Ir para o Fluxo de Revenda");
  });
  it("a Config liga o aviso ao módulo + requisitos e o card tem o id do atalho", () => {
    const s = readFileSync("src/routes/_authenticated/admin/configuracoes.tsx", "utf8");
    expect(s).toMatch(/revendaSemRequisitos\(!!\(modules as any\)\.produto_acabado, cfg\.revenda_kanban_requisitos\)/);
    expect(s).toContain('<Card id="fluxo-revenda-card">');
    expect((s.match(/avisoRevenda=\{avisoRevenda\}/g) ?? []).length).toBe(2);
  });
});
