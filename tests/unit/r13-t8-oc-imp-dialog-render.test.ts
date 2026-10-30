// @vitest-environment happy-dom
// [urg R13 T8] A tela da OC de Produto Importado COM VÁRIOS produtos — RENDER real (react-dom/client + happy-dom) com o supabase mockado:
//   - topo "X de N produtos recebidos"; Excluir desabilitado com produto recebido; landed por item SÓ LEITURA (vem do servidor);
//   - TIRAR da OC (confirmação; recebido e único produto desabilitados; salva junto, UM Salvar, item ausente, `_etapas`, `_rev_base`);
//   - ADICIONAR produto (picker mesmo fornecedor + MESMA MOEDA → `{produto_importado_id, do_produto:true}`);
//   - RECEBER um produto (`receber_item_oc_importado` com o estado completo + etapas + `item_*`);
//   - colaboração: P0409 → merge → retry com o rev novo e o estado MESCLADO (refs vivos); conflito real trava o Salvar.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rpcMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
const dados = vi.hoisted(() => ({ tabelas: {} as Record<string, any> }));
const modulo = vi.hoisted(() => ({ ok: true }));

vi.mock("@/integrations/supabase/client", () => {
  const unico = (t: string) => { const v = dados.tabelas[t]; return Array.isArray(v) ? (v[0] ?? null) : (v ?? null); };
  const builder = (tabela: string) => {
    const b: any = new Proxy({}, {
      get(_, prop: string) {
        if (prop === "then") return (res: any, rej: any) => Promise.resolve({ data: dados.tabelas[tabela] ?? [], error: null }).then(res, rej);
        if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: unico(tabela), error: null });
        return () => b;
      },
    });
    return b;
  };
  return { supabase: { rpc: rpcMock, from: builder, channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }), removeChannel: () => {}, storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: null } }) }) } } };
});
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canView: () => true, canEdit: () => true, user: { id: "u1" }, session: null, loading: false }) }));
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null }));
vi.mock("@/hooks/useColabRegistro", () => ({ useColabRegistro: () => ({ presentes: [] }) }));
vi.mock("@/hooks/useRequerModulo", () => ({
  useRequerModulo: () => (modulo.ok ? { ok: true, faltam: [], motivo: "" } : { ok: false, faltam: ["producao"], motivo: "Precisa do módulo Produção — fale com o administrador do sistema." }),
}));
vi.mock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));
vi.mock("@/lib/print", () => ({ printWithImages: vi.fn() }));
vi.mock("@/components/shared/UnsavedChangesGuard", () => ({
  useUnsavedGuard: ({ onClose }: { onClose?: () => void }) => ({ requestClose: () => onClose?.(), requestAction: (fn: () => void) => fn(), confirm: null }),
  UnsavedChangesGuard: () => null,
}));
vi.mock("@/components/shared/ColabPresenceOverlay", () => ({ ColabPresenceOverlay: () => null }));

const { OcImpDialog } = await import("@/components/oc-p-importado/OcImpDialog");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");

// ── utilitários ─────────────────────────────────────────────────────────────────────────────────────────────────────
let root: Root | null = null;
let host: HTMLElement | null = null;
const onClose = vi.fn(); const onSaved = vi.fn(); const onDelete = vi.fn();
async function montar(ocId: string | null = "oc1") {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const empresas = [{ id: "f1", nome_fantasia: "Shenzhen Co", representantes: [] }];
  await act(async () => {
    root!.render(createElement(QueryClientProvider, { client: qc }, createElement(OcImpDialog, { ocId, empresas, onClose, onSaved, onDelete })));
  });
  await tick(20);
  return qc;
}
const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const botoes = () => Array.from(document.querySelectorAll("button")) as HTMLButtonElement[];
const botao = (txt: string) => botoes().find((b) => b.textContent?.trim().includes(txt));
const clicar = async (b: Element | null | undefined) => {
  if (!b) throw new Error("elemento não encontrado");
  await act(async () => { (b as HTMLElement).click(); });
  await tick(10);
};
const texto = () => (document.body.textContent ?? "").replace(/ /g, " "); // fmtMoeda/brl usam espaço sem quebra
const cabecalhoItem = (nome: string) => botoes().find((b) => b.hasAttribute("aria-expanded") && b.textContent?.includes(nome));
const abrir = async (nome: string) => { await clicar(cabecalhoItem(nome)); };
const digitar = async (el: HTMLInputElement, valor: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const campoColab = (path: string) => document.querySelector(`[data-colab-path="${path}"]`) as HTMLInputElement | null;

beforeEach(() => {
  rpcMock.mockReset(); onClose.mockReset(); onSaved.mockReset(); onDelete.mockReset();
  Object.values(toastMock).forEach((f) => f.mockReset());
  dados.tabelas = {};
  modulo.ok = true;
  rpcMock.mockImplementation(async (nome: string) => (nome === "get_user_tenant_id" ? { data: null, error: null } : { data: "oc1", error: null }));
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null; host?.remove(); host = null;
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────
const grade = (rec = 0) => ({ "1": { "36|PP": { pedida: 5, recebida: rec, defeito: 0 }, "38|P": { pedida: 5, recebida: rec, defeito: 0 } } });
const itemRow = (id: string, nome: string, ordem: number, over: Record<string, unknown> = {}) => ({
  id, ordem, produto_importado_id: `prod-${id}`, nome_produto: nome, grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null,
  ref_fornecedor: null, composicao: null, grade_proporcao: { "36|PP": 1, "38|P": 1 },
  variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }],
  qtd_total: 10, valor_unitario_m1: 50, peso_kg: 0.4, transporte_m2: 12, desconto_pct: 0, custo_unitario_landed_real: 21.5, grade_detalhe: grade(), status: "encomendado",
  data_entrega: null, nota_fiscal: null, responsavel_recebimento_id: null, devolucao: null, revisao: null,
  produto: { ref: `REF-${id}`, foto_url: null }, ...over,
});
const ETAPAS = [
  { id: "e1", ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 30, data_vencimento: "2026-10-10", cotacao: 5 },
  { id: "e2", ordem: 2, rotulo: "Saldo", base: "mercadoria", percentual: 70, data_vencimento: "2026-11-10", cotacao: 5 },
];
const etapasEsperadas = ETAPAS.map(({ id: _id, ...e }) => e);
const ocBase = (itens: unknown[], over: Record<string, unknown> = {}) => ({
  id: "oc1", numero: "SHEDIV-00123", status: "encomendado", rev: 5, empresa_id: "f1", representante_id: null,
  data_pedido: "2026-10-02", data_prevista: "2026-10-20", data_entrega: null, moeda_compra: "RMB", moeda_intermediaria: "USD", cotacao_ref: 5, cotacao_final: 5.5,
  custo_unitario_landed_real: 21.5, data_nota_entrada: "2026-10-05", anexo_pedido_url: null, etapas: ETAPAS, itens, ...over,
});
const tres = () => [itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2), itemRow("C", "Short Zoe", 3, { status: "recebido", data_entrega: "2026-10-05", grade_detalhe: grade(5) })];
const chamadas = (nome: string) => rpcMock.mock.calls.filter((c) => c[0] === nome);

describe("OC com vários produtos — leitura", () => {
  it("topo 'X de N produtos recebidos', um acordeão por produto, moeda da OC e Excluir desabilitado com o motivo", async () => {
    dados.tabelas.ocs_importado = ocBase(tres());
    await montar();
    expect(texto()).toContain("1 de 3 produtos recebidos");
    for (const n of ["Vestido Midi", "Blusa Lia", "Short Zoe"]) expect(cabecalhoItem(n)).toBeTruthy();
    expect(texto()).toContain("Recebido em 05/10/2026");
    expect(texto()).toContain("Aguardando");
    expect(texto()).toContain("RMB → USD");
    expect(texto()).toContain("¥ 1.500,00"); // total da OC em M1 (moeda da compra), não em R$
    const excluir = botao("Excluir")!;
    expect(excluir.disabled).toBe(true);
    expect(excluir.title).toBe("Há produto recebido — não dá para excluir a OC");
  });
  it("sem produto recebido o Excluir fica habilitado e chama onDelete com a OC (itens e moeda)", async () => {
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await clicar(botao("Excluir"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0][0]).toMatchObject({ id: "oc1", status: "encomendado", moeda_compra: "RMB" });
    expect(onDelete.mock.calls[0][0].itens).toHaveLength(2);
  });
});

describe("custo landed por item — SÓ LEITURA, vem do servidor", () => {
  it("mostra o landed gravado do item aberto, sem campo editável, e a tela não recalcula ao mexer no M1", async () => {
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1, { custo_unitario_landed_real: 21.5 }), itemRow("B", "Blusa Lia", 2, { custo_unitario_landed_real: 0 })]);
    await montar();
    await abrir("Vestido Midi");
    expect(texto()).toContain("Custo landed unit. (R$)");
    expect(texto()).toContain("R$ 21,50");
    expect(campoColab("item:A:custo_unitario_landed_real")).toBeNull();
    expect(Array.from(document.querySelectorAll("label")).some((l) => l.textContent?.includes("landed") && l.parentElement?.querySelector("input"))).toBe(false);
    await digitar(campoColab("item:A:valor_unitario_m1")!, "99");
    expect(texto()).toContain("R$ 21,50"); // continua o do servidor
    await abrir("Blusa Lia");
    expect(texto()).toContain("atualiza ao salvar");
  });
  it("o Salvar não manda landed nem status do item", async () => {
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await abrir("Vestido Midi");
    await digitar(campoColab("item:A:valor_unitario_m1")!, "60");
    await clicar(botao("Salvar"));
    await tick(20);
    const itens = chamadas("salvar_oc_importado_itens")[0][1]._itens;
    expect(itens[0]).toMatchObject({ id: "A", valor_unitario_m1: 60, peso_kg: 0.4, transporte_m2: 12 });
    expect(itens[0]).not.toHaveProperty("custo_unitario_landed_real");
    expect(itens[0]).not.toHaveProperty("status");
  });
});

describe("etapas = estado completo em TODA chamada", () => {
  it("Salvar manda o cronograma inteiro, a moeda e as cotações do cabeçalho e o rev", async () => {
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await clicar(botao("Salvar"));
    await tick(20);
    const a = chamadas("salvar_oc_importado_itens")[0][1];
    expect(a._id).toBe("oc1");
    expect(a._rev_base).toBe(5);
    expect(a._etapas).toEqual(etapasEsperadas);
    expect(a._dados).toMatchObject({ moeda_compra: "RMB", moeda_intermediaria: "USD", cotacao_ref: 5, cotacao_final: 5.5, empresa_id: "f1" });
    expect(chamadas("salvar_oc_importado")).toHaveLength(0); // a RPC antiga (1 produto no cabeçalho) não é mais chamada
  });
  it("etapa de mercadoria sem cotação em OC com valor recusa na tela (nada vai ao servidor)", async () => {
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)], { etapas: [{ ...ETAPAS[0], percentual: 100, cotacao: 0 }] });
    await montar();
    await clicar(botao("Salvar"));
    await tick(10);
    expect(chamadas("salvar_oc_importado_itens")).toHaveLength(0);
    expect(toastMock.error).toHaveBeenCalled();
  });
});

describe("hidratação (P-57)", () => {
  it("OC que não carrega: avisa e o Salvar fica desabilitado (nunca grava um cabeçalho em branco por cima)", async () => {
    dados.tabelas.ocs_importado = null;
    await montar();
    expect(texto()).toContain("OC não encontrada.");
    expect(botao("Salvar")!.disabled).toBe(true);
    await clicar(botao("Salvar"));
    expect(chamadas("salvar_oc_importado_itens")).toHaveLength(0);
  });
});

describe("TIRAR da OC", () => {
  it("produto recebido não sai; único produto não sai (botão desabilitado com o motivo)", async () => {
    dados.tabelas.ocs_importado = ocBase(tres());
    await montar();
    await abrir("Short Zoe");
    expect(texto()).toContain("Já recebido — não sai da OC");
    expect(botao("Tirar da OC")!.disabled).toBe(true);
    await act(async () => { root?.unmount(); }); root = null; host?.remove(); host = null;
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1)]);
    await montar();
    expect(texto()).toContain("Único produto — exclua a OC para desvincular");
    expect(botao("Tirar da OC")!.disabled).toBe(true);
  });
  it("Cancelar NÃO grava; Confirmar salva UMA vez com o item ausente, as etapas, o rev e as pendências; a tela fica aberta", async () => {
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2), itemRow("D", "Short Zoe", 3)]);
    await montar();
    await abrir("Blusa Lia");
    await clicar(botao("Tirar da OC"));
    expect(texto()).toContain("Tirar “Blusa Lia” da OC?");
    expect(texto()).toContain("O total da OC passa de ¥ 1.500,00 para ¥ 1.000,00 e as parcelas são refeitas.");
    await clicar(botao("Cancelar"));
    expect(chamadas("salvar_oc_importado_itens")).toHaveLength(0);
    await clicar(botao("Tirar da OC"));
    const confirmar = botoes().filter((b) => b.textContent?.trim() === "Tirar da OC").pop()!;
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("D", "Short Zoe", 3)], { rev: 6, custo_unitario_landed_real: 30 });
    await clicar(confirmar);
    await tick(20);
    const c = chamadas("salvar_oc_importado_itens");
    expect(c).toHaveLength(1);
    const args = c[0][1];
    expect(args._id).toBe("oc1");
    expect(args._rev_base).toBe(5);
    expect(args._etapas).toEqual(etapasEsperadas);
    expect(args._itens.map((i: any) => i.id)).toEqual(["A", "D"]);
    expect(onClose).not.toHaveBeenCalled();
    expect(texto()).not.toContain("Blusa Lia");
    expect(texto()).toContain("0 de 2 produtos recebidos");
  });
});

describe("ADICIONAR produto", () => {
  const pi = (id: string, nome: string, over: Record<string, unknown> = {}) => ({
    id, nome, ref: `R-${id}`, grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null, empresa_id: "f1", representante_id: null,
    ref_fornecedor: null, composicao: null, grade_proporcao: { "36|PP": 1, "38|P": 1 }, qtd_total: 20, moeda_compra: "RMB", moeda_intermediaria: "USD",
    valor_unitario_m1: 40, cotacao_ref: 5, peso_kg: 0.3, transporte_m2: 10, desconto_pct: 0, cotacao_final: 5.5, foto_url: null,
    grupo: { nome: "Feminino" }, produto_importado_variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 20 }],
    produto_importado_etapas: [{ ordem: 1, rotulo: "Total", base: "mercadoria", percentual: 100, data_vencimento: null, cotacao: 5 }],
    ocs_importado_itens: [], ...over,
  });
  it("picker lista só quem não tem OC; MOEDA diferente fica desabilitada com o motivo; escolhido entra como 'Novo' e vai como {produto_importado_id, do_produto:true}", async () => {
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    dados.tabelas.produtos_importados = [
      pi("px", "Short Zoe"),
      pi("py", "Cinto Vega", { ocs_importado_itens: [{ id: "i9" }] }),                       // já tem OC → não aparece
      pi("pz", "Calça Nina", { moeda_compra: "USD", moeda_intermediaria: null }),           // outra moeda → desabilitado com o motivo
    ];
    await montar();
    await clicar(botao("Adicionar produto"));
    expect(texto()).toContain("Adicionar produto à OC SHEDIV-00123");
    expect(texto()).toContain("Short Zoe");
    expect(texto()).not.toContain("Cinto Vega");
    expect(texto()).toContain("Calça Nina");
    expect(texto()).toContain("Moeda diferente da OC (USD; a OC é RMB → USD).");
    expect(botoes().find((b) => b.textContent?.trim() === "Adicionar")!.disabled).toBe(true);
    await clicar(document.querySelector('button[role="checkbox"][aria-label="Adicionar Short Zoe"]'));
    await clicar(botao("Adicionar 1 produto"));
    expect(cabecalhoItem("Short Zoe")).toBeTruthy();
    expect(texto()).toContain("Novo");
    await clicar(botao("Salvar"));
    await tick(20);
    const itens = chamadas("salvar_oc_importado_itens")[0][1]._itens;
    expect(itens.map((i: any) => i.id ?? null)).toEqual(["A", "B", null]);
    expect(itens[2]).toEqual({ produto_importado_id: "px", do_produto: true });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("RECEBER um produto", () => {
  it("confirma, manda o estado completo da OC + etapas + item_* numa RPC só e fica aberta", async () => {
    const A = itemRow("A", "Vestido Midi", 1, { data_entrega: "2026-10-06", grade_detalhe: grade(5) });
    dados.tabelas.ocs_importado = ocBase([A, itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await abrir("Vestido Midi");
    const marcar = botao("Marcar este produto como recebido")!;
    expect(marcar.disabled).toBe(false);
    await clicar(marcar);
    expect(texto()).toContain("Marcar “Vestido Midi” como recebido?");
    dados.tabelas.ocs_importado = ocBase([{ ...A, status: "recebido", custo_unitario_landed_real: 25 }, itemRow("B", "Blusa Lia", 2)], { rev: 6 });
    await clicar(botao("Confirmar recebimento"));
    await tick(20);
    const c = chamadas("receber_item_oc_importado");
    expect(c).toHaveLength(1);
    expect(chamadas("salvar_oc_importado_itens")).toHaveLength(0);
    const a = c[0][1];
    expect(a._oc_id).toBe("oc1"); expect(a._item_id).toBe("A"); expect(a._rev_base).toBe(5);
    expect(a._dados.item_data_entrega).toBe("2026-10-06");
    expect(a._itens.map((i: any) => i.id)).toEqual(["A", "B"]);
    expect(a._etapas).toEqual(etapasEsperadas);
    expect(onClose).not.toHaveBeenCalled();
    expect(texto()).toContain("1 de 2 produtos recebidos");
  });
  it("sem o módulo Produção (ou Criação) o botão fica desabilitado com o motivo — o servidor também recusa", async () => {
    modulo.ok = false;
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1, { data_entrega: "2026-10-06", grade_detalhe: grade(5) }), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await abrir("Vestido Midi");
    const marcar = botao("Marcar este produto como recebido")!;
    expect(marcar.disabled).toBe(true);
    expect(marcar.title).toBe("Precisa do módulo Produção — fale com o administrador do sistema.");
  });
  it("sem data de entrega o botão fica desabilitado e diz o que falta", async () => {
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1, { grade_detalhe: grade(5) }), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await abrir("Vestido Midi");
    expect(botao("Marcar este produto como recebido")!.disabled).toBe(true);
    expect(texto()).toContain("Preencha a data de entrega para marcar.");
  });
});

describe("colaboração — P0409", () => {
  const p0409 = { code: "P0409", message: "conflito_versao: o registro foi salvo por outra pessoa" };
  const itens2 = () => [itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)];
  it("outra pessoa mudou OUTRO campo: o retry manda o rev novo e o estado MESCLADO (o que ela mudou + o que eu mudei)", async () => {
    dados.tabelas.ocs_importado = ocBase(itens2());
    await montar();
    await digitar(campoColab("cotacao-final")!, "6");                       // EU: cotação final
    rpcMock.mockImplementationOnce(async () => {                             // ELA: data prevista (e o rev sobe)
      dados.tabelas.ocs_importado = ocBase(itens2(), { rev: 6, data_prevista: "2026-11-01" });
      return { data: null, error: p0409 };
    });
    await clicar(botao("Salvar"));
    await tick(40);
    const c = chamadas("salvar_oc_importado_itens");
    expect(c).toHaveLength(2);
    expect(c[0][1]._rev_base).toBe(5);
    expect(c[1][1]._rev_base).toBe(6);
    expect(c[1][1]._dados).toMatchObject({ cotacao_final: 6, data_prevista: "2026-11-01" });
    expect(c[1][1]._etapas).toEqual(etapasEsperadas);
    expect(onClose).toHaveBeenCalled();
  });
  it("TIRAR com P0409: o retry reaproveita a escolha (item continua ausente) com o rev novo", async () => {
    const tresItens = () => [itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2), itemRow("D", "Short Zoe", 3)];
    dados.tabelas.ocs_importado = ocBase(tresItens());
    await montar();
    await abrir("Blusa Lia");
    await clicar(botao("Tirar da OC"));
    rpcMock.mockImplementationOnce(async () => {
      dados.tabelas.ocs_importado = ocBase(tresItens(), { rev: 6, data_prevista: "2026-11-01" });
      return { data: null, error: p0409 };
    });
    await clicar(botoes().filter((b) => b.textContent?.trim() === "Tirar da OC").pop()!);
    await tick(40);
    const c = chamadas("salvar_oc_importado_itens");
    expect(c).toHaveLength(2);
    expect(c[1][1]._rev_base).toBe(6);
    expect(c[1][1]._itens.map((i: any) => i.id)).toEqual(["A", "D"]);
    expect(c[1][1]._dados.data_prevista).toBe("2026-11-01");
  });
  it("CONFLITO real (eu e ela no mesmo campo): não tenta de novo, avisa e o Salvar fica travado", async () => {
    dados.tabelas.ocs_importado = ocBase(itens2());
    await montar();
    await digitar(campoColab("cotacao-final")!, "6");
    rpcMock.mockImplementationOnce(async () => {
      dados.tabelas.ocs_importado = ocBase(itens2(), { rev: 6, cotacao_final: 7 });
      return { data: null, error: p0409 };
    });
    await clicar(botao("Salvar"));
    await tick(40);
    expect(chamadas("salvar_oc_importado_itens")).toHaveLength(1);
    expect(toastMock.warning).toHaveBeenCalled();
    expect(texto()).toContain("1 conflito a resolver");
    expect(botao("Salvar")!.disabled).toBe(true);
    await clicar(botoes().find((b) => b.textContent === "usar o novo"));
    expect(botao("Salvar")!.disabled).toBe(false);
  });
  it("CONFLITO no cronograma (etapas) é UM conflito do cronograma inteiro", async () => {
    dados.tabelas.ocs_importado = ocBase(itens2());
    await montar();
    await digitar(campoColab("etapa-pct:1")!, "20");
    rpcMock.mockImplementationOnce(async () => {
      dados.tabelas.ocs_importado = ocBase(itens2(), { rev: 6, etapas: [{ ...ETAPAS[0], percentual: 40 }, { ...ETAPAS[1], percentual: 60 }] });
      return { data: null, error: p0409 };
    });
    await clicar(botao("Salvar"));
    await tick(40);
    expect(texto()).toContain("1 conflito a resolver");
    expect(texto()).toContain("Etapas de pagamento");
    expect(botao("Salvar")!.disabled).toBe(true);
  });
});

describe("OC nova", () => {
  it("sem produtos o Salvar recusa na tela (nada vai ao servidor); recebimento só depois de salvar", async () => {
    await montar(null);
    expect(texto()).toContain("O Recebimento de cada produto fica disponível depois de salvar a OC");
    await clicar(botao("Salvar"));
    await tick(10);
    expect(chamadas("salvar_oc_importado_itens")).toHaveLength(0);
    expect(toastMock.error).toHaveBeenCalled();
  });
  it("o 1º produto escolhido define fornecedor, MOEDA, cotações e o cronograma da OC (o servidor não copia sozinho na OC avulsa)", async () => {
    dados.tabelas.produtos_importados = [{
      id: "px", nome: "Short Zoe", ref: "R-px", grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null, empresa_id: "f1", representante_id: null,
      ref_fornecedor: null, composicao: null, grade_proporcao: { "36|PP": 1 }, qtd_total: 20, moeda_compra: "USD", moeda_intermediaria: null,
      valor_unitario_m1: 40, cotacao_ref: 1, peso_kg: 0.3, transporte_m2: 10, desconto_pct: 0, cotacao_final: 5.7, foto_url: null, grupo: { nome: "Feminino" },
      produto_importado_variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 20 }],
      produto_importado_etapas: [{ ordem: 1, rotulo: "Total", base: "mercadoria", percentual: 100, data_vencimento: null, cotacao: 1 }],
      ocs_importado_itens: [],
    }];
    await montar(null);
    await clicar(botao("Adicionar produto"));
    await clicar(document.querySelector('button[role="checkbox"][aria-label="Adicionar Short Zoe"]'));
    await clicar(botao("Adicionar 1 produto"));
    await clicar(botao("Salvar"));
    await tick(20);
    const a = chamadas("salvar_oc_importado_itens")[0][1];
    expect(a._id).toBeNull();
    expect(a._rev_base).toBeNull();
    expect(a._dados).toMatchObject({ empresa_id: "f1", moeda_compra: "USD", moeda_intermediaria: null, cotacao_ref: 1, cotacao_final: 5.7 });
    expect(a._etapas).toEqual([{ ordem: 1, rotulo: "Total", base: "mercadoria", percentual: 100, data_vencimento: null, cotacao: 1 }]);
    expect(a._itens).toEqual([{ produto_importado_id: "px", do_produto: true }]);
  });
});

// P-382 #1 (dono): o nº do pedido é GERADO por padrão, mas EDITÁVEL na tela (antes: campo desabilitado, "gerado ao criar e não muda").
describe("nº do pedido — gerado, mas editável (P-382)", () => {
  const numeroInput = () => {
    const l = Array.from(document.querySelectorAll("label")).find((x) => x.textContent?.trim().startsWith("Nº do pedido"));
    return l?.parentElement?.querySelector("input") as HTMLInputElement | null;
  };
  it("OC existente: o campo vem preenchido com o número da OC, está habilitado e o que se digita vai em _dados.numero", async () => {
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    const campo = numeroInput()!;
    expect(campo).toBeTruthy();
    expect(campo.disabled).toBe(false);
    expect(campo.readOnly).toBe(false);
    expect(campo.value).toBe("SHEDIV-00123");
    await digitar(campo, "MEU-NUM-9");
    await clicar(botao("Salvar"));
    await tick(20);
    expect(chamadas("salvar_oc_importado_itens")[0][1]._dados.numero).toBe("MEU-NUM-9");
  });
  it("OC existente sem mexer no campo: manda o número atual (o servidor mantém); campo em branco manda '' (o servidor mantém o atual)", async () => {
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await digitar(numeroInput()!, "");
    await clicar(botao("Salvar"));
    await tick(20);
    expect(chamadas("salvar_oc_importado_itens")[0][1]._dados.numero).toBe("");
  });
  it("OC nova: campo habilitado e vazio, com a prévia 'Automático' no placeholder (vazio no Salvar = o servidor gera)", async () => {
    await montar(null);
    const campo = numeroInput()!;
    expect(campo.disabled).toBe(false);
    expect(campo.value).toBe("");
    expect(campo.placeholder).toMatch(/^Autom/);
    expect(texto()).toContain("Gerado automaticamente ao criar. Digite para usar outro número.");
  });
});
