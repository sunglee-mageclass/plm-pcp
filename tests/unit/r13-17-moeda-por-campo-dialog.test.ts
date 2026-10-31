// @vitest-environment happy-dom
// [urg R13 #17, Onda 2] A moeda-rótulo por campo DENTRO da tela da OC de Importado (OcImpDialog): total da OC, "não salvo", Salvar e item novo.
//   - escolher a moeda do valor unit. de UM produto muda o rótulo dele; o total da OC (soma) só troca de moeda quando todos concordam;
//   - mexer SÓ na moeda-rótulo não acende "alterações não salvas" e nada de moeda vai ao Salvar (a conta/cotações seguem o cabeçalho);
//   - item avulso novo nasce com o ÚLTIMO escolhido no campo.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act, createContext, useContext } from "react";
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

// Select de Radix não abre em happy-dom: casca nativa (gatilho com aria-label + um botão por item).
const CtxSel = createContext<(v: string) => void>(() => {});
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) =>
    createElement(CtxSel.Provider, { value: onValueChange }, createElement("div", { "data-mock-select": "", "data-value": value }, children)),
  SelectTrigger: ({ children, ...p }: any) => createElement("button", { type: "button", "aria-label": p["aria-label"] }, children),
  SelectValue: ({ children }: any) => createElement("span", { "data-valor-exibido": "" }, children),
  SelectContent: ({ children }: any) => createElement("div", null, children),
  SelectItem: ({ value, children }: any) => {
    const cb = useContext(CtxSel);
    return createElement("button", { type: "button", "data-item": value, onClick: () => cb(value) }, children);
  },
}));

const { OcImpDialog } = await import("@/components/oc-p-importado/OcImpDialog");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const MC = await import("@/lib/moeda-campo");

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


const gatilho = (rotulo: string, n = 0) => document.querySelectorAll(`button[aria-label="${rotulo}"]`)[n] as HTMLButtonElement | undefined;
const exibido = (rotulo: string, n = 0) => gatilho(rotulo, n)?.querySelector("[data-valor-exibido]")?.textContent ?? null;
const escolher = async (rotulo: string, code: string, n = 0) => {
  const alvo = gatilho(rotulo, n)!.closest("[data-mock-select]")!.querySelector(`[data-item="${code}"]`) as HTMLButtonElement;
  await act(async () => { alvo.click(); });
  await tick(5);
};

describe("moeda-rótulo por campo na tela da OC", () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { window.localStorage.clear(); });

  it("rótulo do produto muda sozinho; o total da OC só troca de moeda quando TODOS os produtos concordam; não acende 'não salvo'", async () => {
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    expect(texto()).toContain("¥ 1.000,00");
    await abrir("Vestido Midi");
    await abrir("Blusa Lia");
    expect(exibido("Moeda do valor unitário", 0)).toBe("RMB");
    await escolher("Moeda do valor unitário", "USD", 0);
    expect(exibido("Moeda do valor unitário", 0)).toBe("USD");
    expect(texto()).toContain("US$ 500,00");        // subtítulo/valores do produto A na moeda registrada
    expect(texto()).toContain("¥ 1.000,00");        // divergem (A=USD, B=RMB): a soma fica na moeda do cabeçalho
    await escolher("Moeda do valor unitário", "USD", 1);
    expect(texto()).toContain("US$ 1.000,00");      // todos iguais: o total acompanha
    expect(texto()).not.toContain("alterações não salvas"); // SÓ rótulo: nada a salvar
  });

  it("Salvar não manda moeda-rótulo e a conta/cotações do cabeçalho seguem iguais", async () => {
    dados.tabelas.ocs_importado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await abrir("Vestido Midi");
    await escolher("Moeda do valor unitário", "USD", 0);
    await escolher("Moeda do transporte", "PYG", 0);
    await digitar(campoColab("item:A:valor_unitario_m1")!, "60"); // edição real, para ter o que salvar
    await clicar(botao("Salvar"));
    await tick(20);
    const a = chamadas("salvar_oc_importado_itens")[0][1];
    expect(JSON.stringify(a)).not.toMatch(/moedas|PYG/); // o PYG escolhido no transporte é só rótulo
    expect(a._itens[0]).toMatchObject({ id: "A", valor_unitario_m1: 60, peso_kg: 0.4, transporte_m2: 12 });
    expect(a._itens[0]).not.toHaveProperty("moedas");
    expect(a._dados).toMatchObject({ moeda_compra: "RMB", moeda_intermediaria: "USD", cotacao_ref: 5, cotacao_final: 5.5 });
    expect(a._etapas).toEqual(etapasEsperadas);
  });

  it("item avulso novo nasce com o ÚLTIMO escolhido em cada campo (o campo sem histórico segue o cabeçalho)", async () => {
    await montar(null);
    await clicar(botao("Item avulso"));
    expect(exibido("Moeda do valor unitário", 0)).toBe("RMB");   // 1º item: sem histórico → slot do cabeçalho (RMB→USD)
    expect(exibido("Moeda do transporte", 0)).toBe("USD");
    await escolher("Moeda do valor unitário", "PYG", 0);
    await escolher("Moeda do transporte", "BRL", 0);
    expect(MC.lerUltimaMoeda("valor_unitario")).toBe("PYG");
    expect(MC.lerUltimaMoeda("transporte")).toBe("BRL");
    await clicar(botao("Item avulso"));
    expect(document.querySelectorAll('button[aria-label="Moeda do valor unitário"]')).toHaveLength(2);
    expect(exibido("Moeda do valor unitário", 1)).toBe("PYG");   // o 2º item herda o último usado
    expect(exibido("Moeda do transporte", 1)).toBe("BRL");
    expect(exibido("Moeda do valor unitário", 0)).toBe("PYG");   // e o 1º continua com a sua escolha
  });
});
