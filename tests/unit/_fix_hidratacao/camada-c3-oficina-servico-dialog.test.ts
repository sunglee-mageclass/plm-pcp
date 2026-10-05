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

import { act, createElement, useState } from "react";
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
    // a query tem `retry: 1` (B1): 2 falhas seguidas (tentativa + retry) para o erro aparecer
    rpc.fn.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
    rpc.fn.mockResolvedValueOnce({ data: null, error: { message: "Failed to fetch" } });
    rpc.fn.mockResolvedValue({ data: SERV, error: null });
    await abrir(novoQc());
    await aguardar(() => texto().includes("Não foi possível carregar o serviço de Oficina"), "aviso de erro", 4000);
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

  // ---- fix round 1 (I2) ----------------------------------------------------------------------------------------------
  // O diálogo fica SEMPRE montado na tela do CQ (só `open` muda): o harness reproduz isso.
  let setOpenExt: (v: boolean) => void = () => {};
  function Harness() {
    const [open, setOpen] = useState(true);
    setOpenExt = setOpen;
    return createElement(OficinaServicoDialog, { cadId: "c1", open, onClose: () => setOpen(false) });
  }
  async function abrirHarness(qc: QueryClient) {
    const m = await montar(createElement(QueryClientProvider, { client: qc }, createElement(Harness)));
    desmontar = m.desmontar;
  }
  const campos = () => Array.from(document.querySelectorAll<HTMLInputElement>("input"));
  const num = (el: HTMLInputElement) => Number(el.value.replace(/\./g, "").replace(",", "."));
  const salvarArgs = () => rpc.fn.mock.calls.filter((c) => c[0] === "cq_set_oficina_desconto_multa").map((c) => c[1] as any);

  it("I2: editar + Descartar + (servidor mudou) + reabrir mostra o valor do SERVIDOR e o Salvar manda esse valor", async () => {
    rpc.fn.mockImplementation((nome: string) => Promise.resolve({ data: nome === "cq_oficina_servico" ? SERV : null, error: null }));
    const qc = novoQc();
    await abrirHarness(qc);
    await aguardar(() => campos().length >= 2, "campos");
    await digitar(campos()[0], "99");
    expect(num(campos()[0])).toBe(99);

    // Voltar com alteração pendente -> confirmação -> Descartar
    await clicar(botao("Voltar")!);
    await aguardar(() => !!botao("Descartar"), "confirmação de descarte");
    await clicar(botao("Descartar")!);
    await aguardar(() => campos().length === 0, "diálogo fechado");

    // enquanto fechado, outra sessão muda para 30 / 7
    rpc.fn.mockImplementation((nome: string) => Promise.resolve({ data: nome === "cq_oficina_servico" ? { ...SERV, desconto: 30, multa: 7 } : null, error: null }));
    await act(async () => { setOpenExt(true); });
    await aguardar(() => campos().length >= 2 && num(campos()[0]) === 30 && num(campos()[1]) === 7, "mostra 30 / 7 do servidor", 2000);

    await clicar(botao("Salvar")!);
    await aguardar(() => salvarArgs().length === 1, "RPC de salvar chamada");
    expect(salvarArgs()[0]).toMatchObject({ _cad_id: "c1", _desconto: 30, _multa: 7 });
  });

  it("I2: com o diálogo aberto, só o campo que NÃO toquei adota o servidor (multa nova de outra sessão não é revertida)", async () => {
    rpc.fn.mockImplementation((nome: string) => Promise.resolve({ data: nome === "cq_oficina_servico" ? SERV : null, error: null }));
    const qc = novoQc();
    await abrirHarness(qc);
    await aguardar(() => campos().length >= 2, "campos");
    await digitar(campos()[0], "99"); // só o desconto fica sujo

    rpc.fn.mockImplementation((nome: string) => Promise.resolve({ data: nome === "cq_oficina_servico" ? { ...SERV, multa: 8 } : null, error: null }));
    await qc.invalidateQueries({ queryKey: ["cq-oficina-servico", "c1"] });
    await aguardar(() => num(campos()[1]) === 8, "multa nova adotada", 2000);
    expect(num(campos()[0])).toBe(99); // o desconto editado fica

    await clicar(botao("Salvar")!);
    await aguardar(() => salvarArgs().length === 1, "RPC de salvar chamada");
    expect(salvarArgs()[0]).toMatchObject({ _desconto: 99, _multa: 8 });
  });
});
