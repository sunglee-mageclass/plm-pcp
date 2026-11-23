// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any */
// `useGuardaTrocaLista` generalizado (Tecidos + Aviamentos): o texto do diálogo nomeia a lista ("tecidos" por padrão, como era;
// "aviamentos" na tela de Aviamentos) e o caminho antigo (`@/components/tecido/grade/useGuardaTrocaLista`) segue valendo.
import { describe, it, expect } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function montarGuarda(entidade: string | undefined, importar: "novo" | "antigo") {
  const mod =
    importar === "novo"
      ? await import("@/components/shared/useGuardaTrocaLista")
      : await import("@/components/tecido/grade/useGuardaTrocaLista");
  const acoes: string[] = [];
  function Tela() {
    const g = mod.useGuardaTrocaLista(...(entidade === undefined ? [] : [entidade]));
    return createElement(
      "div",
      null,
      createElement("button", { "data-t": "sujar", onClick: () => g.aoMudarSujo(true) }, "sujar"),
      createElement(
        "button",
        { "data-t": "agir", onClick: g.proteger(() => acoes.push("agiu")) },
        "agir",
      ),
      g.dialog,
    );
  }
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(createElement(Tela));
  });
  const clicar = (sel: string) =>
    act(async () => {
      (el.querySelector(sel) as HTMLElement).click();
    });
  return {
    el,
    acoes,
    clicar,
    desmontar: async () => {
      await act(async () => {
        root.unmount();
      });
      el.remove();
    },
  };
}
const dialogo = () => document.body.querySelector('[role="alertdialog"]') as HTMLElement | null;

describe("useGuardaTrocaLista(entidade)", () => {
  it("padrão = 'tecidos' (a tela de Tecidos fica como era), tanto pelo caminho novo quanto pelo antigo", async () => {
    for (const via of ["novo", "antigo"] as const) {
      const t = await montarGuarda(undefined, via);
      await t.clicar('[data-t="sujar"]');
      await t.clicar('[data-t="agir"]');
      expect(dialogo()!.textContent).toContain(
        "Há alterações não salvas na lista de tecidos. Se continuar, elas serão descartadas.",
      );
      expect(t.acoes).toEqual([]);
      await t.desmontar();
      document.body.innerHTML = "";
    }
  });

  it("'aviamentos' troca o nome da lista no texto; Descartar roda a ação guardada", async () => {
    const t = await montarGuarda("aviamentos", "novo");
    await t.clicar('[data-t="agir"]');
    expect(dialogo()).toBeNull(); // limpo: roda direto
    expect(t.acoes).toEqual(["agiu"]);
    await t.clicar('[data-t="sujar"]');
    await t.clicar('[data-t="agir"]');
    expect(dialogo()!.textContent).toContain("Há alterações não salvas na lista de aviamentos.");
    expect(dialogo()!.textContent).not.toContain("tecidos");
    const descartar = Array.from(dialogo()!.querySelectorAll("button")).find(
      (b) => b.textContent === "Descartar",
    ) as HTMLElement;
    await act(async () => {
      descartar.click();
    });
    expect(t.acoes).toEqual(["agiu", "agiu"]);
    await t.desmontar();
  });
});
