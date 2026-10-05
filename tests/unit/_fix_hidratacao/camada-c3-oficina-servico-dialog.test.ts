// @vitest-environment happy-dom
// [camada C3 · F5] Diálogo desconto/multa da Oficina (CQ): carregando != "Nenhum serviço"; erro = aviso + "Tentar de novo"
// (sem Salvar); vazio de verdade (RPC devolve null) = "Nenhum serviço"; refetch com alteração pendente NÃO re-semeia.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const rpc = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc.fn(...a), from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }), channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {} },
}));
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: true, canView: () => true, canEdit: () => true, permissions: [], loading: false }) }));
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
vi.mock("sonner", () => ({ toast: Object.assign((..._a: unknown[]) => {}, { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }), Toaster: () => null }));

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { montar, esperar, aguardar, clicar, digitar } from "./dom-helpers";
import { OficinaServicoDialog } from "@/routes/_authenticated/expedicao.cq.$modeloId";

let desmontar: (() => Promise<void>) | null = null;
beforeEach(() => { rpc.fn.mockReset(); });
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const texto = () => document.body.textContent ?? "";
const botao = (t: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").includes(t)) ?? null;
const SERV = { responsavel: "Oficina X", custo_bruto: 1000, desconto: 10, multa: 5 };
async function abrir(qc: QueryClient) {
  const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(OficinaServicoDialog, { cadId: "c1", open: true, onClose: () => {} })));
  desmontar = m.desmontar;
}
const novoQc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("[camada C3 · F5] OficinaServicoDialog", () => {
  it("carregando: 'Carregando…', NUNCA 'Nenhum serviço'; depois mostra o serviço", async () => {
    let soltar!: (v: unknown) => void;
    rpc.fn.mockImplementation(() => new Promise((r) => { soltar = r; }));
    await abrir(novoQc());
    await esperar(50);
    expect(texto()).toContain("Carregando…");
    expect(texto()).not.toContain("Nenhum serviço");
    soltar({ data: SERV, error: null });
    await aguardar(() => texto().includes("Oficina X"), "serviço carregado");
    expect(texto()).not.toContain("Nenhum serviço");
    expect(botao("Salvar")).not.toBeNull();
  });

  it("erro: aviso + 'Tentar de novo', SEM 'Nenhum serviço' e SEM Salvar; clicar recupera", async () => {
    rpc.fn.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
    rpc.fn.mockResolvedValue({ data: SERV, error: null });
    await abrir(novoQc());
    await aguardar(() => texto().includes("Não foi possível carregar o serviço de Oficina"), "aviso de erro");
    expect(texto()).not.toContain("Nenhum serviço");
    expect(botao("Salvar")).toBeNull();
    await clicar(botao("Tentar de novo")!);
    await aguardar(() => texto().includes("Oficina X"), "recuperou");
    expect(botao("Salvar")).not.toBeNull();
    expect(texto()).not.toContain("Não foi possível carregar");
  });

  it("vazio de verdade (RPC devolve null): 'Nenhum serviço…', sem aviso de erro e sem Salvar", async () => {
    rpc.fn.mockResolvedValue({ data: null, error: null });
    await abrir(novoQc());
    await aguardar(() => texto().includes("Nenhum serviço de Oficina"), "estado vazio");
    expect(texto()).not.toContain("Não foi possível carregar");
    expect(botao("Salvar")).toBeNull();
  });

  it("refetch com alteração pendente NÃO re-semeia o que foi digitado", async () => {
    rpc.fn.mockResolvedValue({ data: SERV, error: null });
    const qc = novoQc();
    await abrir(qc);
    await aguardar(() => texto().includes("Oficina X"), "serviço carregado");
    const campos = () => Array.from(document.querySelectorAll<HTMLInputElement>("input"));
    await aguardar(() => campos().length >= 2, "campos");
    const inicial = campos()[0].value;
    await digitar(campos()[0], "99");
    const digitado = campos()[0].value;
    expect(digitado).not.toBe(inicial);

    // outra sessão mudou o desconto -> o refetch traz 20, mas o rascunho local tem alteração pendente
    rpc.fn.mockResolvedValue({ data: { ...SERV, desconto: 20 }, error: null });
    await qc.invalidateQueries({ queryKey: ["cq-oficina-servico", "c1"] });
    await esperar(100);
    expect(campos()[0].value).toBe(digitado);
  });
});
