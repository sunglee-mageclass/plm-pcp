// @vitest-environment happy-dom
// [camada C2 · P-263 A / 1.4] Desmarcar o Direcionamento (travado E editando) pede "Tem certeza?" — tela REAL com o Supabase falso:
// clicar => abre o diálogo com o texto aprovado e NADA é gravado; Cancelar => nada é gravado; Confirmar => grava UMA vez.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }));

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./fake-supabase")).FAKE.supabase }));
vi.mock("@/hooks/useAuth", () => {
  const AUTH = {
    user: { id: "u1", email: "qa@teste" }, session: null, isAdmin: true, isSuperAdmin: false, isTenantAdmin: true, permissions: [],
    canView: () => true, canEdit: () => true, loading: false, signOut: async () => {},
  };
  return { useAuth: () => AUTH };
});
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/hooks/useTenantModules", () => {
  const modules = { cadastro: true, criacao: true, entrada_saida: true, producao: true, financeiro: true, dashboard: true, otb: false, produto_acabado: false, produto_importado: false, etapas_pl: false };
  return { useTenantModules: () => ({ modules, isModuleEnabled: (k: string) => !!(modules as any)[k], isStockOnly: false, firstActiveModulePath: "/", isLoading: false }) };
});
vi.mock("@tanstack/react-router", async (orig) => {
  const m: any = await orig();
  const { createElement } = await import("react");
  return {
    ...m,
    createFileRoute: () => (opts: any) => ({ options: opts, useParams: () => ({ modeloId: "m1" }), useSearch: () => ({}) }),
    Link: (p: any) => createElement("a", { href: String(p.to ?? "") }, p.children),
    Navigate: () => null,
    useNavigate: () => () => {},
    useBlocker: () => ({ status: "idle", proceed() {}, reset() {} }),
  };
});
vi.mock("sonner", () => ({ toast: Object.assign((..._a: unknown[]) => {}, toastMock), Toaster: () => null }));

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FAKE } from "./fake-supabase";
import { montar, esperar, aguardar, clicar, botaoPorTexto } from "./dom-helpers";
import { Route } from "@/routes/_authenticated/expedicao.direcionamento.$modeloId";
import { SidebarProvider } from "@/components/ui/sidebar";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.modelos = [{ id: "m1", nome: "BLUSA", ref: "R1", origem: "interno" }];
  FAKE.linhas.cad = [{ id: "c1", modelo_id: "m1", direcionamento_status: "separado" }];
  FAKE.linhas.direcionamento_controle = [{ cad_id: "c1", rev: 3 }];
  FAKE.linhas.lojas_direcionamento = [{ id: "l1", tenant_id: "t1", nome: "E-commerce", ativo: true, ordem: 1 }];
  FAKE.linhas.cad_grades = [{ cad_id: "c1", variante_numero: 1, grades_reais: { P: 10, M: 10 }, grades_planejadas: { P: 10, M: 10 } }];
  FAKE.linhas.direcionamento_lojas = [{ id: "d1", cad_id: "c1", loja_id: "l1", variante_numero: 1, grades: { P: 10, M: 10 } }];
  Object.values(toastMock).forEach((f) => f.mockClear());
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const cadUpdates = () => FAKE.chamadas.filter((c) => c.tabela === "cad" && c.op === "update");
const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;
const desmarcar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Desmarcar"]');
const editar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Editar"]');
async function abrir() {
  const qc = new QueryClient();
  const C = (Route as any).options.component;
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(SidebarProvider, null, createElement(C))));
  desmontar = m.desmontar;
}

async function percorrer() {
  await aguardar(() => !!desmarcar() && desmarcar()!.disabled === false, "botão Desmarcar habilitado");
  await clicar(desmarcar()!);
  await aguardar(() => !!dialogo(), "diálogo aberto");
  expect(dialogo()!.textContent).toContain("Desmarcar o Direcionamento de “BLUSA”?");
  expect(dialogo()!.textContent).toContain("O Direcionamento deixa de estar confirmado (separado) e volta para pendente, podendo ser editado de novo. As quantidades por loja já digitadas continuam salvas.");
  expect(cadUpdates()).toHaveLength(0); // abrir o diálogo não grava
  expect(botaoDialogo("Desmarcar")!.className).toContain("destructive");

  await clicar(botaoDialogo("Cancelar")!);
  await aguardar(() => !dialogo(), "diálogo fechado");
  await esperar(50);
  expect(cadUpdates()).toHaveLength(0); // Cancelar NÃO grava

  await clicar(desmarcar()!);
  await aguardar(() => !!dialogo(), "diálogo reaberto");
  await clicar(botaoDialogo("Desmarcar")!);
  await aguardar(() => cadUpdates().length === 1, "UPDATE do cad (separado -> pendente)");
  expect((cadUpdates()[0].payload as any).direcionamento_status).toBe("pendente");
  await esperar(50);
  expect(cadUpdates()).toHaveLength(1);
}

describe("[camada C2 · 1.4] Direcionamento — Desmarcar", () => {
  it("travado (confirmado): confirmação antes de voltar a pendente", async () => {
    await abrir();
    await percorrer();
  });

  it("editando (após Editar): o MESMO diálogo", async () => {
    await abrir();
    await aguardar(() => !!editar() && editar()!.disabled === false, "botão Editar habilitado");
    await clicar(editar()!);
    await aguardar(() => !!desmarcar(), "Desmarcar do modo edição");
    await percorrer();
  });
});
