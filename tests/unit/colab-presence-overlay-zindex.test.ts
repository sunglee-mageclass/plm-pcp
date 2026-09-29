// @vitest-environment happy-dom
// Fix round pós-QA (achado #8) + B1/B2 (review-fixqa.md) — <ColabPresenceOverlay abaixoDeModal>:
// com um Dialog/Sheet/AlertDialog (z-50) aberto por cima da página, o anel de presença de um campo
// NA PÁGINA (fora de qualquer modal) não pode desenhar por cima do backdrop dele. `abaixoDeModal`
// baixa esse anel pra `z-[35]` (abaixo de `z-50` E dos `z-40` de PageActionBar/MobileActionBar —
// B2). O teste 3 NÃO é o caso do diálogo de Requisitos desta tela (B1: aquele `DialogContent` é
// portal fora do `colabScopeRef` da página, e `elementoDoPath` só procura dentro do scope — ver o
// comentário em `ColabPresenceOverlay.tsx`/`configuracoes.tsx`); é uma SALVAGUARDA para outra
// classe de uso: um overlay cujo PRÓPRIO scope mora dentro de um modal (o padrão normal nas outras
// ~24 instâncias do componente) não pode cair pra z-[35] se `abaixoDeModal` for passado por engano.
// Teste isolado, sem montar a tela inteira: só o componente + elementos de DOM crus com
// `data-colab-path` (a resolução por rótulo já tem cobertura própria em
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

  it("abaixoDeModal=true: anel de um campo DA PÁGINA (fora de qualquer dialog) usa z-[35] — fica abaixo do z-50 do Dialog/Sheet/AlertDialog e do z-40 das barras de ação (B2)", async () => {
    const scope = document.createElement("div");
    document.body.appendChild(scope);
    darRect(scope, { top: 0, left: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 });
    const campo = document.createElement("input");
    campo.setAttribute("data-colab-path", "cfg:timezone");
    scope.appendChild(campo);
    darRect(campo, {});
    const scopeRef = { current: scope };
    await montar(createElement(ColabPresenceOverlay, { presentes: [presente("cfg:timezone")], scopeRef, abaixoDeModal: true }));
    expect(document.body.querySelector(".fixed.z-\\[35\\]")).not.toBeNull();
    expect(document.body.querySelector(".fixed.z-\\[60\\]")).toBeNull();
    scope.remove();
  });

  it("salvaguarda: overlay cujo PRÓPRIO scope mora dentro de um modal (role=\"dialog\") ignora abaixoDeModal e mantém z-[60] — não é o caso do diálogo de Requisitos (B1), é para um scope acidentalmente dentro de um modal", async () => {
    // Simula o padrão NORMAL do componente nas outras ~24 instâncias: um Sheet/Dialog colaborativo
    // (ex.: DistribuirPorLojaDialog) monta <ColabPresenceOverlay scopeRef={corpoRef}> com o scope
    // DENTRO do próprio DialogContent — diferente de configuracoes.tsx, cujo scopeRef é a página.
    const dialogContent = document.createElement("div");
    dialogContent.setAttribute("role", "dialog");
    document.body.appendChild(dialogContent);
    darRect(dialogContent, { top: 0, left: 0, right: 1000, bottom: 1000, width: 1000, height: 1000 });
    const campo = document.createElement("input");
    campo.setAttribute("data-colab-path", "algum:campo");
    dialogContent.appendChild(campo);
    darRect(campo, {});
    const scopeRef = { current: dialogContent };
    // `abaixoDeModal: true` por engano nesta instância (deveria ser o default `false`) — a
    // salvaguarda (`dentroDeDialog`, via `el.closest('[role="dialog"]')`) detecta que o campo
    // resolvido está dentro de um modal e mantém z-[60] em vez de cair pra z-[35].
    await montar(createElement(ColabPresenceOverlay, { presentes: [presente("algum:campo")], scopeRef, abaixoDeModal: true }));
    expect(document.body.querySelector(".fixed.z-\\[60\\]")).not.toBeNull();
    expect(document.body.querySelector(".fixed.z-\\[35\\]")).toBeNull();
    dialogContent.remove();
  });
});
