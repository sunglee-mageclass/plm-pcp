// @vitest-environment happy-dom
// Render/unit — `ModeloGradeSection` (plano `2026-09-29-tamanho-em`, Tarefa 7, ressalva #4/P-120 A). A prop
// `tamanhoTipo` é OPCIONAL: sem ela, o componente tem de ser BYTE A BYTE o de hoje (o Sheet do Dev só-leitura,
// F5a, depende disso — `tests/unit/f5-dev-somente-leitura*.test.ts`); com ela, os rótulos das colunas relabelam
// pelo lado escolhido (`rotuloDoTamanho`) e a lista de colunas é filtrada (`tamanhosVisiveis`), mas as CHAVES
// que os handlers recebem (`onChangeProporcao`/`onChangeGradeCell`) continuam a chave cheia da grade — ressalva
// #3 do G-plano: filtro de exibição nunca reduz o que é gravado.
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ModeloGradeSection } from "@/components/desenvolvimento/modelo-detail/ModeloGradeSection";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function montar(el: ReturnType<typeof createElement>): { container: HTMLElement; unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(el); });
  return { container, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}

const TAMANHOS = ["34|PPP", "36|PP", "38|P"];
const VARIANTES = [{ numero: 1, label: "Marrom" }];

function baseProps(extra: Record<string, unknown> = {}) {
  return {
    tamanhos: TAMANHOS,
    proporcoes: { "34|PPP": 1, "36|PP": 1, "38|P": 1 },
    onChangeProporcao: vi.fn(),
    grades: [{ variante_numero: 1, grades: { "34|PPP": 2, "36|PP": 0, "38|P": 0 }, grade_total: 2 }],
    onChangeGradeTotal: vi.fn(),
    onChangeGradeCell: vi.fn(),
    tecido1Variantes: VARIANTES,
    gradeAuto: false,
    onToggleGradeAuto: vi.fn(),
    ...extra,
  };
}

describe("ModeloGradeSection — sem tamanhoTipo (byte a byte o de hoje)", () => {
  it("mostra TODOS os tamanhos com a chave cheia como rótulo (proporção e grade)", () => {
    const { container, unmount } = montar(createElement(ModeloGradeSection, baseProps() as any));
    const labels = Array.from(container.querySelectorAll("label")).map((l) => l.textContent);
    // As 3 chaves cheias aparecem 2x (bloco de Proporções + card da Variante 1) — nenhuma é relabelada/filtrada.
    for (const t of TAMANHOS) expect(labels.filter((x) => x === t).length).toBe(2);
    unmount();
  });

  it("tamanhoTipo=null (explicitamente) tem o mesmo resultado de omitir a prop", () => {
    const { container, unmount } = montar(createElement(ModeloGradeSection, baseProps({ tamanhoTipo: null }) as any));
    const labels = Array.from(container.querySelectorAll("label")).map((l) => l.textContent);
    for (const t of TAMANHOS) expect(labels.filter((x) => x === t).length).toBe(2);
    unmount();
  });
});

describe("ModeloGradeSection — com tamanhoTipo (relabela e filtra, mas preserva as chaves)", () => {
  it("relabela pelo lado Letra (rotuloDoTamanho) sem esconder nenhum tamanho par", () => {
    const { container, unmount } = montar(createElement(ModeloGradeSection, baseProps({ tamanhoTipo: "letra" }) as any));
    const labels = Array.from(container.querySelectorAll("label")).map((l) => l.textContent);
    // "34|PPP" → "PPP", "36|PP" → "PP", "38|P" → "P" (o lado Letra) — a chave cheia NUNCA aparece como rótulo.
    for (const t of TAMANHOS) expect(labels).not.toContain(t);
    expect(labels.filter((x) => x === "PPP").length).toBe(2);
    expect(labels.filter((x) => x === "PP").length).toBe(2);
    expect(labels.filter((x) => x === "P").length).toBe(2);
    unmount();
  });

  it("onChangeGradeCell recebe a CHAVE CHEIA, não o rótulo relabelado", () => {
    const onChangeGradeCell = vi.fn();
    const { container, unmount } = montar(
      createElement(ModeloGradeSection, baseProps({ tamanhoTipo: "letra", onChangeGradeCell }) as any),
    );
    const inputs = Array.from(container.querySelectorAll("input[data-colab-path^='grade-cell:1:']"));
    expect(inputs.length).toBe(TAMANHOS.length);
    const input = container.querySelector("input[data-colab-path='grade-cell:1:34|PPP']") as HTMLInputElement;
    expect(input).toBeTruthy();
    // React (controlled input) só reage ao evento "input" nativo se o `.value` for setado pelo setter NATIVO do
    // protótipo (não pelo setter do happy-dom, que React já tem patcheado/rastreado) — mesmo truque usado por
    // @testing-library/react-internals (fireEvent.change).
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, "5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChangeGradeCell).toHaveBeenCalledWith(1, "34|PPP", 5);
    unmount();
  });

  it("solto do lado NÃO escolhido sem valor lançado fica de fora (tamanhosVisiveis)", () => {
    // Tamanhos SEM par (Ark-like): "36" (número solto) e "PP" (letra solta) — pedindo Letra, "36" só entra se
    // tiver comValor (proporção>0 ou grade>0 em algum lugar); aqui não tem, então cai fora da lista visível.
    const props = baseProps({
      tamanhos: ["PP", "36"],
      proporcoes: { PP: 1, "36": 0 },
      grades: [{ variante_numero: 1, grades: { PP: 1, "36": 0 }, grade_total: 1 }],
      tamanhoTipo: "letra",
    });
    const { container, unmount } = montar(createElement(ModeloGradeSection, props as any));
    const labels = Array.from(container.querySelectorAll("label")).map((l) => l.textContent);
    expect(labels).toContain("PP");
    expect(labels).not.toContain("36");
    unmount();
  });

  it("solto do lado NÃO escolhido COM valor lançado aparece esmaecido (nunca escondido — ressalva #3)", () => {
    const props = baseProps({
      tamanhos: ["PP", "36"],
      proporcoes: { PP: 1, "36": 0 },
      // "36" tem quantidade JÁ lançada na grade de uma variante — não pode desaparecer, mesmo pedindo Letra.
      grades: [{ variante_numero: 1, grades: { PP: 1, "36": 3 }, grade_total: 4 }],
      tamanhoTipo: "letra",
    });
    const { container, unmount } = montar(createElement(ModeloGradeSection, props as any));
    const labels = Array.from(container.querySelectorAll("label")).map((l) => l.textContent);
    expect(labels).toContain("36");
    const label36 = Array.from(container.querySelectorAll("label")).find((l) => l.textContent === "36") as HTMLElement;
    expect(label36.parentElement?.className).toContain("opacity-50");
    unmount();
  });
});
