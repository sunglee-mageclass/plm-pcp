// @vitest-environment happy-dom
// [camada C2 · P-263 A] Financeiro: "Desmarcar pago" (OC e Serviço, detalhe e lista) e "Recalcular parcelas" (troca o confirm() do navegador)
// pedem "Tem certeza?". Componentes REAIS da tela, Supabase falso: abrir o diálogo não grava; Cancelar não grava; Confirmar grava UMA vez.
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
vi.mock("@tanstack/react-router", async (orig) => {
  const m: any = await orig();
  const { createElement } = await import("react");
  return {
    ...m,
    createFileRoute: () => (opts: any) => ({ options: opts }),
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
import { montar, esperar, aguardar, clicar } from "./dom-helpers";
import { ParcelaDetailDialog, ServicoDetailDialog, DesmarcarPagoBtn, DesmarcarPagoServicoBtn, FinanceiroEditContext } from "@/routes/_authenticated/financeiro";

let desmontar: (() => Promise<void>) | null = null;
let confirmNativo: ReturnType<typeof vi.fn>;
beforeEach(() => {
  FAKE.reset();
  FAKE.linhas.users = [{ id: "u1", tenant_id: "t1" }];
  FAKE.linhas.tenant_config = [{ tenant_id: "t1" }];
  Object.values(toastMock).forEach((f) => f.mockClear());
  confirmNativo = vi.fn(() => true);
  (window as any).confirm = confirmNativo;
});
afterEach(async () => { await desmontar?.(); desmontar = null; document.body.innerHTML = ""; });

const dialogo = () => document.querySelector<HTMLElement>('[role="alertdialog"]');
const botaoDialogo = (t: string) => Array.from(dialogo()?.querySelectorAll<HTMLButtonElement>("button") ?? []).find((b) => (b.textContent ?? "").trim() === t) ?? null;
const botao = (t: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.textContent ?? "").trim() === t) ?? null;
const updates = (tabela: string) => FAKE.chamadas.filter((c) => c.tabela === tabela && c.op === "update");
const rpcs = (nome: string) => FAKE.chamadas.filter((c) => c.tabela === `rpc:${nome}`);
const qcNovo = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
async function abrir(el: ReturnType<typeof createElement>) {
  const m = await montar(createElement(QueryClientProvider, { client: qcNovo() }, createElement(FinanceiroEditContext.Provider, { value: true }, el)));
  desmontar = m.desmontar;
}

const PARCELA_PAGA: any = {
  id: "p1", tipo_oc: "tecido", oc_tecido_id: "oc1", oc_aviamento_id: null, oc_etiqueta_id: null, oc_p_acabado_id: null, oc_importado_id: null,
  empresa_id: "e1", numero_parcela: 2, valor: 150, data_vencimento: "2026-10-10", data_pagamento: "2026-10-03", status: "pago", comprovante_url: null,
  empresas: { nome: "Fornecedor X" }, empresaNome: "Fornecedor X", ocs_tecido: { numero_pedido: "OC-9" },
};

describe("[camada C2 · 1.7] Desmarcar pago — parcela de OC (detalhe da parcela)", () => {
  it("abre o diálogo aprovado sem gravar; Cancelar não grava; Confirmar desmarca UMA vez", async () => {
    await abrir(createElement(ParcelaDetailDialog, { parcela: PARCELA_PAGA, onClose: () => {}, onMarkPaid: () => {}, onOpenOc: () => {} }));
    await aguardar(() => !!botao("Desmarcar pago"), "botão Desmarcar pago");
    await clicar(botao("Desmarcar pago")!);
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(dialogo()!.textContent).toContain("Desmarcar o pagamento desta parcela?");
    expect(dialogo()!.textContent).toContain("A parcela 2 de R$");
    expect(dialogo()!.textContent).toContain("da OC de Tecido Nº OC-9 volta para “a pagar” e a data de pagamento (03/10/2026) é apagada. O comprovante continua anexado.");
    expect(updates("parcelas")).toHaveLength(0);
    expect(botaoDialogo("Desmarcar pagamento")!.className).toContain("destructive");

    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "fechou");
    await esperar(50);
    expect(updates("parcelas")).toHaveLength(0);

    await clicar(botao("Desmarcar pago")!);
    await aguardar(() => !!dialogo(), "reabriu");
    await clicar(botaoDialogo("Desmarcar pagamento")!);
    await aguardar(() => updates("parcelas").length === 1, "UPDATE parcelas");
    expect(updates("parcelas")[0].payload).toEqual({ status: "a_pagar", data_pagamento: null });
    await esperar(50);
    expect(updates("parcelas")).toHaveLength(1);
  });
});

describe("[camada C2 · 1.7] Desmarcar pago — parcela de OC (linha da lista)", () => {
  it("DesmarcarPagoBtn: o clique só chama a ação depois de confirmar", async () => {
    const acao = vi.fn();
    await abrir(createElement(DesmarcarPagoBtn, { parcela: PARCELA_PAGA, onClick: acao, children: "Desmarcar" }));
    await clicar(botao("Desmarcar")!);
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(dialogo()!.textContent).toContain("Desmarcar o pagamento desta parcela?");
    expect(acao).not.toHaveBeenCalled();
    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "fechou");
    expect(acao).not.toHaveBeenCalled();
    await clicar(botao("Desmarcar")!);
    await aguardar(() => !!dialogo(), "reabriu");
    await clicar(botaoDialogo("Desmarcar pagamento")!);
    await aguardar(() => acao.mock.calls.length === 1, "ação chamada");
    await esperar(30);
    expect(acao).toHaveBeenCalledTimes(1);
  });
  it("parcela de OC cancelada continua DESABILITADA (sem diálogo)", async () => {
    const acao = vi.fn();
    await abrir(createElement(DesmarcarPagoBtn, { parcela: { ...PARCELA_PAGA, ocCancelada: true }, onClick: acao, children: "Desmarcar" }));
    expect(botao("Desmarcar")!.disabled).toBe(true);
    expect(dialogo()).toBeNull();
  });
});

describe("[camada C2 · 1.12] Recalcular parcelas — AlertDialog no lugar do confirm() do navegador", () => {
  const PARCELA_ABERTA = { ...PARCELA_PAGA, id: "p2", status: "a_pagar", data_pagamento: null };
  it("abre o diálogo aprovado sem chamar confirm() nem a RPC; Cancelar não grava; Confirmar chama recalcular_parcelas UMA vez", async () => {
    await abrir(createElement(ParcelaDetailDialog, { parcela: PARCELA_ABERTA, onClose: () => {}, onMarkPaid: () => {}, onOpenOc: () => {} }));
    await aguardar(() => !!botao("Recalcular"), "botão Recalcular");
    await clicar(botao("Recalcular")!);
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(dialogo()!.textContent).toContain("Recalcular as parcelas desta OC?");
    expect(dialogo()!.textContent).toContain("As parcelas pagas são preservadas e as demais são regeradas com os valores atuais da OC de Tecido Nº OC-9. Datas de vencimento ajustadas à mão são mantidas.");
    expect(confirmNativo).not.toHaveBeenCalled(); // o confirm() nativo saiu
    expect(rpcs("recalcular_parcelas")).toHaveLength(0);
    // refazer = neutro (não vermelho)
    expect(botaoDialogo("Recalcular")!.className).not.toContain("destructive");

    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "fechou");
    await esperar(50);
    expect(rpcs("recalcular_parcelas")).toHaveLength(0);

    await clicar(botao("Recalcular")!);
    await aguardar(() => !!dialogo(), "reabriu");
    await clicar(botaoDialogo("Recalcular")!);
    await aguardar(() => rpcs("recalcular_parcelas").length === 1, "RPC chamada");
    expect(rpcs("recalcular_parcelas")[0].payload).toEqual({ _oc_id: "oc1", _tipo: "tecido" });
    expect(confirmNativo).not.toHaveBeenCalled();
    await esperar(50);
    expect(rpcs("recalcular_parcelas")).toHaveLength(1);
  });
});

const ROW_SERVICO = { parcela_id: "s1", numero_parcela: 1, numero_parcelas: 2, servico: "Costura", ref: "R1", valor_parcela: 80, data_pagamento: "2026-10-03", data_vencimento: "2026-10-10", status: "pago", responsavel: "Oficina X" };

describe("[camada C2 · 1.8] Desmarcar pago — parcela de Serviço", () => {
  it("detalhe: ServicoDetailDialog só chama onTogglePago(false) depois de confirmar", async () => {
    const toggle = vi.fn();
    await abrir(createElement(ServicoDetailDialog, {
      row: ROW_SERVICO, stLabel: "Pago", stVariant: "default", fmtD: (d: string | null) => (d ? d.split("-").reverse().join("/") : "—"),
      canPay: true, onTogglePago: toggle, toggling: false, onClose: () => {},
    }));
    await aguardar(() => !!botao("Desmarcar pago"), "botão Desmarcar pago");
    await clicar(botao("Desmarcar pago")!);
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(dialogo()!.textContent).toContain("Desmarcar o pagamento deste serviço?");
    expect(dialogo()!.textContent).toContain("A parcela 1 do serviço “Costura” (R1) de R$");
    expect(dialogo()!.textContent).toContain("volta para “a pagar” e a data de pagamento (03/10/2026) é apagada. O valor pago registrado deixa de valer e a parcela volta a entrar no cálculo do saldo. O comprovante continua anexado.");
    expect(toggle).not.toHaveBeenCalled();
    expect(botaoDialogo("Desmarcar pagamento")!.className).toContain("destructive");
    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "fechou");
    expect(toggle).not.toHaveBeenCalled();
    await clicar(botao("Desmarcar pago")!);
    await aguardar(() => !!dialogo(), "reabriu");
    await clicar(botaoDialogo("Desmarcar pagamento")!);
    await aguardar(() => toggle.mock.calls.length === 1, "toggle chamado");
    expect(toggle).toHaveBeenCalledWith(false);
    await esperar(30);
    expect(toggle).toHaveBeenCalledTimes(1);
  });
  it("lista: DesmarcarPagoServicoBtn só chama a ação depois de confirmar", async () => {
    const acao = vi.fn();
    await abrir(createElement(DesmarcarPagoServicoBtn, { row: ROW_SERVICO, onConfirmar: acao, children: "Desmarcar" }));
    await clicar(botao("Desmarcar")!);
    await aguardar(() => !!dialogo(), "diálogo aberto");
    expect(acao).not.toHaveBeenCalled();
    await clicar(botaoDialogo("Cancelar")!);
    await aguardar(() => !dialogo(), "fechou");
    expect(acao).not.toHaveBeenCalled();
    await clicar(botao("Desmarcar")!);
    await aguardar(() => !!dialogo(), "reabriu");
    await clicar(botaoDialogo("Desmarcar pagamento")!);
    await aguardar(() => acao.mock.calls.length === 1, "ação chamada");
    await esperar(30);
    expect(acao).toHaveBeenCalledTimes(1);
  });
});
