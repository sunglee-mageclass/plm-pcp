// @vitest-environment happy-dom
// Fix round pós-QA (achado #8) — <ColabPresenceOverlay abaixoDeModal>: com um Dialog/Sheet/
// AlertDialog (z-50) aberto por cima da página, o anel de presença de um campo NA PÁGINA (fora de
// qualquer modal) não pode desenhar por cima do backdrop dele — mas o anel de um campo DENTRO de um
// modal próprio (ex.: o diálogo de Requisitos, que reusa o MESMO overlay da página) precisa
// continuar acima do backdrop DELE. Teste isolado, sem montar a tela inteira: só o componente +
// elementos de DOM crus com `data-colab-path` (a resolução por rótulo já tem cobertura própria em
// colab-field-path-explicito.test.ts).
import { describe, it, expect, afterEach } from "vitest";
import { createElement, type ReactElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ColabPresenceOverlay } from "@/components/shared/ColabPresenceOverlay";
import type { PresencaColab } from "@/hooks/useColabRegistro";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

function montar(el: ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  return act(async () => { root!.render(el); });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = "";
});

const presente = (path: string): PresencaColab => ({ userId: "u2", nome: "Outra Pessoa", campoFocado: path });

// getBoundingClientRect não é implementado com layout de verdade no happy-dom — damos um retângulo
// não-vazio fixo pra todo elemento, e um retângulo grande pro scope (senão a interseção zera tudo).
function darRect(el: HTMLElement, rect: Partial<DOMRect>) {
  el.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30, x: 0, y: 0, toJSON: () => ({}), ...rect } as DOMRect);
}

describe("ColabPresenceOverlay — abaixoDeModal (achado #8)", () => {
  it("abaixoDeModal=false (default): anel do campo de página usa z-[60] (comportamento de sempre)", async () => {
    const scope = document.createElement("div");
    document.body.appendChild(scope);
    darRect(scope, { top: 0, left: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 });
    const campo = document.createElement("input");
    campo.setAttribute("data-colab-path", "cfg:timezone");
    scope.appendChild(campo);
    darRect(campo, {});
    const scopeRef = { current: scope };
    await montar(createElement(ColabPresenceOverlay, { presentes: [presente("cfg:timezone")], scopeRef }));
    const anel = document.body.querySelector<HTMLElement>(".fixed.z-\\[60\\]");
    expect(anel).not.toBeNull();
    scope.remove();
  });

  it("abaixoDeModal=true: anel de um campo DA PÁGINA (fora de qualquer dialog) usa z-40 — fica abaixo do z-50 do Dialog/Sheet/AlertDialog", async () => {
    const scope = document.createElement("div");
    document.body.appendChild(scope);
    darRect(scope, { top: 0, left: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 });
    const campo = document.createElement("input");
    campo.setAttribute("data-colab-path", "cfg:timezone");
    scope.appendChild(campo);
    darRect(campo, {});
    const scopeRef = { current: scope };
    await montar(createElement(ColabPresenceOverlay, { presentes: [presente("cfg:timezone")], scopeRef, abaixoDeModal: true }));
    expect(document.body.querySelector(".fixed.z-40")).not.toBeNull();
    expect(document.body.querySelector(".fixed.z-\\[60\\]")).toBeNull();
    scope.remove();
  });

  it("abaixoDeModal=true: anel de um campo DENTRO de um Dialog próprio (role=\"dialog\") continua em z-[60] — não fica escondido atrás do backdrop do próprio modal", async () => {
    const scope = document.createElement("div");
    document.body.appendChild(scope);
    darRect(scope, { top: 0, left: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 });
    // Simula o DialogContent do diálogo de Requisitos: role="dialog" + data-colab-path próprio,
    // igual a RequisitosStatusDialog.tsx (`<DialogContent data-colab-path={colabPath}>`).
    const dialogContent = document.createElement("div");
    dialogContent.setAttribute("role", "dialog");
    dialogContent.setAttribute("data-colab-path", "cfg:kanban_requisitos");
    scope.appendChild(dialogContent);
    darRect(dialogContent, {});
    const scopeRef = { current: scope };
    await montar(createElement(ColabPresenceOverlay, { presentes: [presente("cfg:kanban_requisitos")], scopeRef, abaixoDeModal: true }));
    expect(document.body.querySelector(".fixed.z-\\[60\\]")).not.toBeNull();
    expect(document.body.querySelector(".fixed.z-40")).toBeNull();
    scope.remove();
  });
});
