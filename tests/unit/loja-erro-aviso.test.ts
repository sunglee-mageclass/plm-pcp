// @vitest-environment happy-dom
// [backend F1] <LojaErroAviso> + ModuleGuard: 1ª carga da loja falhou => aviso com "Tentar de novo" (nunca redireciona pelos DEFAULTS).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  mods: { erro: false, isLoading: false, enabled: true, tentarDeNovo: () => {} },
}));

vi.mock("@tanstack/react-router", () => ({
  Navigate: (p: any) => createElement("span", { "data-redirect": String(p.to) }),
  Outlet: () => createElement("main", null, "CONTEUDO"),
}));
vi.mock("@/hooks/useTenantModules", () => ({
  useTenantModules: () => ({
    isModuleEnabled: () => h.mods.enabled,
    firstActiveModulePath: "/entrada-saida",
    isLoading: h.mods.isLoading,
    pronto: !h.mods.isLoading,
    erro: h.mods.erro,
    tentarDeNovo: () => h.mods.tentarDeNovo(),
  }),
}));

import { ModuleGuard } from "@/components/ModuleGuard";
import { LojaErroAviso } from "@/components/shared/LojaErroAviso";

async function montar(el: any) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(el); });
  return { container, desmontar: () => act(() => root.unmount()) };
}

beforeEach(() => {
  h.mods = { erro: false, isLoading: false, enabled: true, tentarDeNovo: () => {} };
});

describe("LojaErroAviso", () => {
  it("texto em PT e o botão 'Tentar de novo' chama o callback", async () => {
    const tentar = vi.fn();
    const { container, desmontar } = await montar(createElement(LojaErroAviso, { onTentarDeNovo: tentar }));
    expect(container.textContent).toContain("Não foi possível carregar a sua loja");
    expect(container.textContent).toContain("Tente de novo");
    expect(container.textContent).not.toContain("Verifique a conexão e tente"); // não afirma que é a rede (m4)
    const botao = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Tentar de novo")!;
    await act(async () => { botao.click(); });
    expect(tentar).toHaveBeenCalledTimes(1);
    desmontar();
  });
});

describe("LojaErroAviso — tentando", () => {
  it("[review I1] tentando: o aviso FICA na tela, botão desabilitado e 'Tentando…' (não some para o branco)", async () => {
    const tentar = vi.fn();
    const { container, desmontar } = await montar(createElement(LojaErroAviso, { onTentarDeNovo: tentar, tentando: true }));
    expect(container.textContent).toContain("Não foi possível carregar a sua loja");
    const botao = container.querySelector("button") as HTMLButtonElement;
    expect(botao.textContent).toBe("Tentando…");
    expect(botao.disabled).toBe(true);
    desmontar();
  });
});

describe("ModuleGuard", () => {
  it("1ª carga falhou → aviso (não redireciona mesmo com o módulo 'desligado' pelos DEFAULTS, não renderiza a rota)", async () => {
    const tentar = vi.fn();
    h.mods = { erro: true, isLoading: true, enabled: false, tentarDeNovo: tentar };
    const { container, desmontar } = await montar(createElement(ModuleGuard, { module: "otb" }));
    expect(container.textContent).toContain("Tentar de novo");
    expect(container.innerHTML).not.toContain("data-redirect");
    expect(container.textContent).not.toContain("CONTEUDO");
    await act(async () => { (container.querySelector("button") as HTMLButtonElement).click(); });
    expect(tentar).toHaveBeenCalledTimes(1);
    desmontar();
  });

  it("sucesso: módulo ligado → rota; desligado → redireciona (comportamento de sempre)", async () => {
    let r = await montar(createElement(ModuleGuard, { module: "otb" }));
    expect(r.container.textContent).toContain("CONTEUDO");
    r.desmontar();
    h.mods.enabled = false;
    r = await montar(createElement(ModuleGuard, { module: "otb" }));
    expect(r.container.innerHTML).toContain('data-redirect="/entrada-saida"');
    r.desmontar();
  });

  it("carregando (sem erro) → nada", async () => {
    h.mods = { erro: false, isLoading: true, enabled: false, tentarDeNovo: () => {} };
    const { container, desmontar } = await montar(createElement(ModuleGuard, { module: "otb" }));
    expect(container.innerHTML).toBe("");
    desmontar();
  });
});
