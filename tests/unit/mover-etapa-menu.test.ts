// @vitest-environment happy-dom
// F4a T1 — `MoverEtapaMenu` (extraído do `EtapaHeader`): o Sheet do Planejamento tem de ficar IGUAL (mesmos
// data-testid por default) e PA/PI/PT ganham testIds por prefixo.
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MoverEtapaMenu } from "@/components/shared/MoverEtapaMenu";
import { EtapaHeader } from "@/components/planejamento/planejamento-detail/ficha/EtapaHeader";
import type { EtapaSelo } from "@/lib/kanban-auto-ui";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function montar(el: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(el); });
  return { container, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}
const SELO: EtapaSelo = { fase: "kanban", key: "em_modelagem", label: "Em Modelagem", color: null, modo: "off" };
const OPCOES = [{ key: "aprovado", label: "Aprovado", nota: "falta X", bloqueada: true, modo: null }];
const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe("MoverEtapaMenu", () => {
  it("default = testIds do Sheet (etapa-mover-gatilho / etapa-kanban-selo-header)", () => {
    const { container, unmount } = montar(createElement(MoverEtapaMenu, { selo: SELO, podeMover: true, opcoes: OPCOES, onMover: vi.fn(), movendo: false }));
    expect(q(container, "etapa-mover-gatilho")).not.toBeNull();
    expect(q(container, "etapa-kanban-selo-header")?.textContent).toContain("Em Modelagem");
    unmount();
  });
  it("testIdPrefix troca os ids (pa-…)", () => {
    const { container, unmount } = montar(createElement(MoverEtapaMenu, { selo: SELO, podeMover: true, opcoes: OPCOES, onMover: vi.fn(), movendo: false, testIdPrefix: "pa" }));
    expect(q(container, "pa-mover-gatilho")).not.toBeNull();
    expect(q(container, "pa-kanban-selo")).not.toBeNull();
    expect(q(container, "etapa-mover-gatilho")).toBeNull();
    unmount();
  });
  it("abre o menu, lista as opções e chama onMover com a key", () => {
    const onMover = vi.fn();
    const { container, unmount } = montar(createElement(MoverEtapaMenu, { selo: SELO, podeMover: true, opcoes: OPCOES, onMover, movendo: false, sujo: true }));
    act(() => { q(container, "etapa-mover-gatilho")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const opt = q(document.body, "etapa-mover-aprovado");
    expect(opt?.textContent).toContain("falta X");
    expect(q(document.body, "etapa-mover-menu")?.textContent).toContain("salve antes de mover");
    act(() => { opt!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onMover).toHaveBeenCalledWith("aprovado");
    unmount();
  });
  it("sem podeMover: só leitura (sem gatilho); carregando mostra o texto visível", () => {
    const a = montar(createElement(MoverEtapaMenu, { selo: SELO, podeMover: false, opcoes: [], onMover: vi.fn(), movendo: false }));
    expect(q(a.container, "etapa-mover-gatilho")).toBeNull();
    expect(q(a.container, "etapa-kanban-selo-header")).not.toBeNull();
    a.unmount();
    const b = montar(createElement(MoverEtapaMenu, { selo: SELO, podeMover: false, opcoes: [], onMover: vi.fn(), movendo: false, carregando: "carregando" }));
    expect(b.container.textContent).toContain("Carregando regras…");
    b.unmount();
    const c = montar(createElement(MoverEtapaMenu, { selo: SELO, podeMover: false, opcoes: [], onMover: vi.fn(), movendo: false, carregando: "erro" }));
    expect(c.container.textContent).toContain("Erro ao carregar as regras");
    c.unmount();
  });
  it("fase fora do kanban nunca mostra 'carregando'", () => {
    const plan: EtapaSelo = { fase: "planejamento", key: null, label: "Planejamento", color: null, modo: "off" };
    const { container, unmount } = montar(createElement(MoverEtapaMenu, { selo: plan, podeMover: false, opcoes: [], onMover: vi.fn(), movendo: false, carregando: "carregando" }));
    expect(container.textContent).not.toContain("Carregando");
    unmount();
  });
  it("dentroDeCard: clique no gatilho não sobe ao card", () => {
    const aoCard = vi.fn();
    const { container, unmount } = montar(createElement("div", { onClick: aoCard },
      createElement(MoverEtapaMenu, { selo: SELO, podeMover: true, opcoes: OPCOES, onMover: vi.fn(), movendo: false, dentroDeCard: true })));
    act(() => { q(container, "etapa-mover-gatilho")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(aoCard).not.toHaveBeenCalled();
    unmount();
  });
});

describe("EtapaHeader (Sheet do Planejamento) segue igual usando o MoverEtapaMenu", () => {
  it("mantém wrapper etapa-header, gatilho e a linha 'Próxima'", () => {
    const { container, unmount } = montar(createElement(EtapaHeader, {
      selo: SELO, podeMover: true, opcoes: OPCOES, onMover: vi.fn(), movendo: false,
      proxima: { coluna: "Aprovado", falta: "Data" }, sujo: false,
    }));
    expect(q(container, "etapa-header")).not.toBeNull();
    expect(q(container, "etapa-mover-gatilho")).not.toBeNull();
    expect(q(container, "etapa-proxima")?.textContent).toContain("Próxima: Aprovado — falta: Data");
    unmount();
  });
  it("sem 'proxima' não renderiza a linha", () => {
    const { container, unmount } = montar(createElement(EtapaHeader, {
      selo: SELO, podeMover: false, opcoes: [], onMover: vi.fn(), movendo: false, proxima: null, sujo: false,
    }));
    expect(q(container, "etapa-proxima")).toBeNull();
    unmount();
  });
});
