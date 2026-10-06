// @vitest-environment happy-dom
// [modularidade F1] RequirePermission: espera `pronto`, perfil por `paginaNoPerfil` (P-256 A) e rota guardada por `PageDef.gate`
// (P-253 A: Plan. Tecido sem OTB, Explosão sem Criação) com o <ModuloDesligadoAviso> — sem redirecionar e sem piscar a tela.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  mods: { modules: {} as Record<string, boolean>, isStockOnly: false, isLoading: false, erro: false, tentarDeNovo: () => {} },
  auth: { isSuperAdmin: false },
}));

vi.mock("@tanstack/react-router", () => ({
  Navigate: (p: any) => createElement("span", { "data-redirect": String(p.to) }),
  Link: (p: any) => createElement("a", { href: String(p.to) }, p.children),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ canView: () => true, canEdit: () => true, loading: false, isSuperAdmin: h.auth.isSuperAdmin }),
}));
vi.mock("@/hooks/useTenantModules", () => ({
  useTenantModules: () => ({
    isModuleEnabled: (k: string) => !!h.mods.modules[k],
    isStockOnly: h.mods.isStockOnly,
    firstActiveModulePath: "/entrada-saida",
    isLoading: h.mods.isLoading,
    pronto: !h.mods.isLoading,
    erro: h.mods.erro,
    tentarDeNovo: () => h.mods.tentarDeNovo(),
  }),
}));

import { RequirePermission } from "@/components/RequirePermission";

async function html(page: string): Promise<string> {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(createElement(RequirePermission, { page }, createElement("main", null, "CONTEUDO"))); });
  const out = container.innerHTML;
  act(() => root.unmount());
  return out;
}

const COMPLETO = { cadastro: true, entrada_saida: true, criacao: true, producao: true, financeiro: true, dashboard: true, otb: true };

beforeEach(() => {
  h.mods = { modules: { ...COMPLETO }, isStockOnly: false, isLoading: false, erro: false, tentarDeNovo: () => {} };
  h.auth = { isSuperAdmin: false };
});

describe("RequirePermission — módulo e perfil", () => {
  it("config da loja ainda não chegou → 'Carregando…' (nunca decide pelos DEFAULTS)", async () => {
    h.mods.isLoading = true;
    h.mods.modules = {};
    const out = await html("criacao_plan_tecido");
    expect(out).toContain("Carregando");
    expect(out).not.toContain("CONTEUDO");
    expect(out).not.toContain("data-redirect");
    expect(out).not.toContain("Módulo desligado");
  });

  it("[backend F1] 1ª carga da loja falhou → aviso com 'Tentar de novo' (sem DEFAULTS, sem 'Módulo desligado', sem redirecionar)", async () => {
    const tentar = vi.fn();
    h.mods = { modules: {}, isStockOnly: false, isLoading: true, erro: true, tentarDeNovo: tentar };
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => { root.render(createElement(RequirePermission, { page: "criacao_plan_tecido" }, createElement("main", null, "CONTEUDO"))); });
    const out = container.innerHTML;
    expect(out).toContain("Não foi possível carregar a sua loja");
    expect(out).not.toContain("Módulo desligado");
    expect(out).not.toContain("CONTEUDO");
    expect(out).not.toContain("data-redirect");
    const botao = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Tentar de novo")!;
    expect(botao).toBeTruthy();
    await act(async () => { botao.click(); });
    expect(tentar).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
  });

  it("Plan. Tecido sem OTB → aviso do módulo (sem redirecionar, sem a tela)", async () => {
    h.mods.modules = { ...COMPLETO, otb: false };
    const out = await html("criacao_plan_tecido");
    expect(out).toContain("Módulo desligado nesta loja");
    expect(out).toContain("módulo OTB");
    expect(out).not.toContain("CONTEUDO");
    expect(out).not.toContain("data-redirect");
  });

  it("Plan. Tecido com OTB → conteúdo", async () => {
    expect(await html("criacao_plan_tecido")).toContain("CONTEUDO");
  });

  it("Explosão sem Criação → aviso (módulo Criação); com Criação → conteúdo", async () => {
    h.mods.modules = { ...COMPLETO, criacao: false };
    const off = await html("producao_explosao");
    expect(off).toContain("módulo Criação");
    // [F2 m5] diz tudo o que a área precisa e o que falta ligar
    expect(off).toContain("precisa dos módulos Criação e Entrada e Saída; falta ligar o módulo Criação");
    expect(off).not.toContain("CONTEUDO");
    h.mods.modules = { ...COMPLETO };
    expect(await html("producao_explosao")).toContain("CONTEUDO");
  });

  it("super admin vê o atalho para Gerenciar Lojas; os demais não", async () => {
    h.mods.modules = { ...COMPLETO, otb: false };
    expect(await html("criacao_plan_tecido")).not.toContain("/admin/lojas");
    h.auth.isSuperAdmin = true;
    expect(await html("criacao_plan_tecido")).toContain('href="/admin/lojas"');
  });

  it("OS Tecido (só-estoque): visível sem Criação MESMO com Financeiro/Dashboard (P-256 A); com Criação → redireciona", async () => {
    h.mods.modules = { cadastro: true, entrada_saida: true, financeiro: true, dashboard: true };
    h.mods.isStockOnly = false;
    expect(await html("entrada_os_tecido")).toContain("CONTEUDO");
    h.mods.modules = { ...COMPLETO };
    const out = await html("entrada_os_tecido");
    expect(out).toContain('data-redirect="/entrada-saida"');
    expect(out).not.toContain("CONTEUDO");
  });

  it("só estoque: página 'full' redireciona como sempre; OS Tecido abre", async () => {
    h.mods.modules = { cadastro: true, entrada_saida: true };
    h.mods.isStockOnly = true;
    expect(await html("cadastro_etiquetas")).toContain("data-redirect");
    expect(await html("entrada_os_aviamento")).toContain("CONTEUDO");
    expect(await html("cadastro_destinos")).toContain("CONTEUDO");
  });

  it("página sem gate nem perfil especial segue abrindo (OC Tecido)", async () => {
    expect(await html("entrada_oc_tecido")).toContain("CONTEUDO");
  });
});
