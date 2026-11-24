// @vitest-environment happy-dom

// PR-3 (Produto) — AJUSTE A: só a REVENDA edita a grade pós-Explosão (interno/importado seguem só-leitura + botão do Sheet);
// AJUSTE B: a matriz expandida tem TECLADO PRÓPRIO (Enter desce / Tab ao lado entre as células de tamanho) sem colidir com o teclado
// das linhas de produto da tabela-mãe (`data-grade-cel`).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act } from "react";
import {
  celula,
  clicar,
  estado,
  flush,
  linhaDe,
  mod,
  montar,
  resetar,
} from "./produto-grade-harness";

beforeEach(() => resetar());

const TAMANHOS = ["34|PPP", "36|PP", "38|P", "M", "42"];

function revenda(extra: Record<string, unknown> = {}) {
  estado.todasPermissoes = true;
  estado.modelos = [mod("M1", { origem: "revenda", rev: 5, ...extra }), mod("M2")];
  estado.extra.tenant_config = [{ tenant_id: "tenant1", tamanhos_grade: TAMANHOS }];
  estado.extra.produtos_acabados = [
    {
      modelo_id: "M1",
      id: "pa1",
      grade_proporcao: { "36|PP": 1, "38|P": 1, M: 1 },
      variantes: [
        { ordem: 1, cor: { nome: "Branco" }, apelido: null },
        { ordem: 2, cor: { nome: "Azul" }, apelido: { nome: "Mar" } },
        { ordem: 3, cor: { nome: "Verde" }, apelido: null },
      ],
    },
  ];
  estado.extra.modelo_grades = [
    { modelo_id: "M1", variante_numero: 1, grades: { "36|PP": 6 }, grade_total: 6 },
  ];
}

const abrir = async (c: HTMLElement, id = "M1") => {
  await clicar(linhaDe(c, id).querySelector("[data-expandir-grade]"));
  await flush();
};
const expandida = (c: HTMLElement) =>
  c.querySelector("[data-testid=produto-linha-expandida]") as HTMLElement;
const cel = (c: HTMLElement, num: number, t: string) =>
  expandida(c).querySelector(`input[data-qtd-celula="${num}:${t}"]`) as HTMLInputElement;
const NOME = (id: string) => `Nome de Modelo ${id}`;

async function tecla(el: HTMLElement, key: string, shift = false) {
  el.focus();
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true, cancelable: true }),
    );
  });
  await flush(40);
}

describe("PR-3 A — só a REVENDA edita pós-Explosão", () => {
  it("revenda enviada à Explosão: célula EDITÁVEL; interno enviado: só-leitura sem campo", async () => {
    revenda({ enviado_cad: true });
    const t = await montar();
    await abrir(t.container);
    expect(cel(t.container, 1, "36|PP")).not.toBeNull();
    expect(cel(t.container, 1, "36|PP").disabled).toBe(false);
    await t.desmontar();

    // INTERNO enviado à Explosão (cores = Tecido 1): matriz sem campo + botão do Sheet
    estado.todasPermissoes = true;
    estado.modelos = [mod("M1", { origem: "interno", enviado_cad: true })];
    estado.extra.tenant_config = [{ tenant_id: "tenant1", tamanhos_grade: TAMANHOS }];
    estado.extra.modelo_tecidos = [{ id: "t1", modelo_id: "M1", tipo: "tecido", numero: 1 }];
    estado.extra.modelo_tecido_variantes = [
      {
        modelo_tecido_id: "t1",
        ordem: 1,
        variante_tecido_id: "v1",
        variantes_tecido: {
          nome_variante: null,
          codigo_variante: null,
          cor: { nome: "Verde" },
          apelido: null,
        },
      },
    ];
    estado.extra.modelo_grades = [
      { modelo_id: "M1", variante_numero: 1, grades: { "36|PP": 9 }, grade_total: 9 },
    ];
    const t2 = await montar({ onAbrirNoSheet: vi.fn() });
    await abrir(t2.container);
    expect(expandida(t2.container).querySelectorAll("input")).toHaveLength(0);
    expect(expandida(t2.container).querySelector("[data-abrir-sheet-grade]")).not.toBeNull();
    expect(
      expandida(t2.container).querySelector("[data-testid=grade-somente-leitura]")!.textContent,
    ).toContain("enviado à Explosão");
    await t2.desmontar();
  });

  it("IMPORTADO enviado à Explosão: segue só-leitura (não afrouxou)", async () => {
    estado.todasPermissoes = true;
    estado.modelos = [mod("M1", { origem: "importado", enviado_cad: true })];
    estado.extra.tenant_config = [{ tenant_id: "tenant1", tamanhos_grade: TAMANHOS }];
    estado.extra.produtos_importados = [
      {
        modelo_id: "M1",
        id: "pi1",
        grade_proporcao: { "36|PP": 1 },
        variantes: [{ ordem: 1, cor: { nome: "Verde" }, apelido: null }],
      },
    ];
    estado.extra.modelo_grades = [
      { modelo_id: "M1", variante_numero: 1, grades: { "36|PP": 9 }, grade_total: 9 },
    ];
    const t = await montar();
    await abrir(t.container);
    expect(expandida(t.container).querySelectorAll("input")).toHaveLength(0);
    expect(
      expandida(t.container).querySelector("[data-testid=grade-somente-leitura]"),
    ).not.toBeNull();
    await t.desmontar();
  });
});

describe("PR-3 B — teclado PRÓPRIO da matriz de tamanhos", () => {
  it("Enter desce na mesma coluna de tamanho; Tab anda ao lado; Shift+Tab volta (data-matriz-cel, não data-grade-cel)", async () => {
    revenda();
    const t = await montar();
    await abrir(t.container);
    expect(cel(t.container, 1, "36|PP").hasAttribute("data-matriz-cel")).toBe(true);
    expect(cel(t.container, 1, "36|PP").hasAttribute("data-grade-cel")).toBe(false);
    await tecla(cel(t.container, 1, "36|PP"), "Enter");
    expect(document.activeElement).toBe(cel(t.container, 2, "36|PP"));
    await tecla(cel(t.container, 2, "36|PP"), "Tab");
    expect(document.activeElement).toBe(cel(t.container, 2, "38|P"));
    await tecla(cel(t.container, 2, "38|P"), "Tab", true);
    expect(document.activeElement).toBe(cel(t.container, 2, "36|PP"));
    // Tab no fim da linha pula para o início da próxima cor
    await tecla(cel(t.container, 1, "M"), "Tab");
    expect(document.activeElement).toBe(cel(t.container, 2, "36|PP"));
    await t.desmontar();
  });

  it("Enter na última célula da matriz NÃO escapa para a tabela-mãe (fica na matriz)", async () => {
    revenda();
    const t = await montar();
    await abrir(t.container);
    await tecla(cel(t.container, 3, "M"), "Enter");
    expect(document.activeElement).toBe(cel(t.container, 3, "M"));
    await t.desmontar();
  });

  it("NÃO quebra o teclado das linhas de produto: com a matriz aberta, Enter no Nome de M1 vai ao Nome de M2", async () => {
    revenda();
    const t = await montar();
    await abrir(t.container);
    await tecla(celula(t.container, NOME("M1")), "Enter");
    expect(document.activeElement).toBe(celula(t.container, NOME("M2")));
    await t.desmontar();
  });

  it("matriz travada (sem permissão) não tem célula focável: nada de data-matriz-cel", async () => {
    revenda();
    estado.todasPermissoes = false;
    estado.permissoes = new Set();
    const t = await montar();
    await abrir(t.container);
    expect(expandida(t.container).querySelectorAll("[data-qtd]").length).toBeGreaterThan(0);
    expect(t.container.querySelectorAll("[data-matriz-cel]")).toHaveLength(0);
    await t.desmontar();
  });
});
