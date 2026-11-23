// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mock do hook de dados */
// Shell da visão "Lista" de Cadastro > Aviamentos (AV-1): contagem "N aviamentos · M variantes", erro honesto e "Tentar de novo".
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const recarregar = vi.fn();
let dados: any;
vi.mock("@/components/aviamento/grade/useAviamentosGrade", () => ({
  useAviamentosGrade: () => dados,
}));

import { AviamentosGradeAba } from "@/components/aviamento/grade/AviamentosGradeAba";

const base = () => ({
  aviamentos: [{ id: "A1" }, { id: "A2" }, { id: "A3" }],
  variantesPorAviamento: new Map<string, any[]>([
    ["A1", [{ id: "v1" }, { id: "v2" }]],
    ["A2", [{ id: "v3" }]],
  ]),
  opcoes: {},
  isLoading: false,
  isError: false,
  erro: null,
  recarregar,
  recarregando: false,
});

function montar(props: any = {}) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(createElement(AviamentosGradeAba, props)));
  return { el, desmontar: () => act(() => root.unmount()) };
}

beforeEach(() => {
  recarregar.mockReset();
  dados = base();
  document.body.innerHTML = "";
});

describe("AviamentosGradeAba (shell)", () => {
  it("sem lista filtrada conta todos os aviamentos e as variantes deles", () => {
    const { el, desmontar } = montar();
    const t = el.textContent ?? "";
    expect(t).toContain("3aviamentos");
    expect(t).toContain("3variantes");
    desmontar();
  });

  it("com lista filtrada conta só os aviamentos recebidos", () => {
    const { el, desmontar } = montar({ aviamentos: [{ id: "A1" }] });
    const t = el.textContent ?? "";
    expect(t).toContain("1aviamento");
    expect(t).not.toContain("1aviamentos");
    expect(t).toContain("2variantes");
    desmontar();
  });

  it("singular de variante e aviamento sem variante conta 0", () => {
    const { el, desmontar } = montar({ aviamentos: [{ id: "A2" }, { id: "A3" }] });
    expect(el.textContent).toContain("1variante");
    expect(el.textContent).not.toContain("1variantes");
    desmontar();
  });

  it("erro de carga mostra o aviso e 'Tentar de novo' chama recarregar (nunca finge 'vazio')", () => {
    dados = { ...base(), isError: true };
    const { el, desmontar } = montar();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      "Não foi possível carregar a lista de aviamentos.",
    );
    const botao = [...el.querySelectorAll("button")].find(
      (b) => b.textContent === "Tentar de novo",
    )!;
    act(() => botao.click());
    expect(recarregar).toHaveBeenCalledTimes(1);
    desmontar();
  });

  it("durante o refetch do erro o botão vira 'Tentando…' e fica desabilitado", () => {
    dados = { ...base(), isError: true, recarregando: true };
    const { el, desmontar } = montar();
    const botao = [...el.querySelectorAll("button")].find(
      (b) => b.textContent === "Tentando…",
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);
    desmontar();
  });

  it("carregando mostra 'Carregando…' e não mostra o placeholder", () => {
    dados = { ...base(), isLoading: true };
    const { el, desmontar } = montar();
    expect(el.textContent).toContain("Carregando…");
    expect(el.textContent).not.toContain("em construção");
    desmontar();
  });

  it("carregado e sem erro mostra o placeholder da grade", () => {
    const { el, desmontar } = montar();
    expect(el.textContent).toContain("em construção");
    desmontar();
  });
});
