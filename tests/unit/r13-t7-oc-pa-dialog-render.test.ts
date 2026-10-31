// @vitest-environment happy-dom
// [urg R13 T7] A tela da OC de Produto Acabado COM VÁRIOS produtos — RENDER real (react-dom/client + happy-dom) com o supabase mockado:
//   - topo "X de N produtos recebidos"; Excluir desabilitado com produto recebido;
//   - TIRAR da OC (confirmação; recebido e único produto desabilitados; salva junto, UM Salvar, item ausente, `_rev_base`);
//   - ADICIONAR produto (picker → `{produto_acabado_id, do_produto:true}` no Salvar);
//   - RECEBER um produto (`receber_item_oc_p_acabado` com o estado completo + `item_*`);
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

const { OcPaDialog } = await import("@/components/oc-p-acabado/OcPaDialog");
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
  const empresas = [{ id: "f1", nome_fantasia: "Bella Malhas", representantes: [] }];
  await act(async () => {
    root!.render(createElement(QueryClientProvider, { client: qc }, createElement(OcPaDialog, { ocId, empresas, onClose, onSaved, onDelete })));
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
const texto = () => (document.body.textContent ?? "").replace(/\u00a0/g, " "); // brl() usa espaço sem quebra
const cabecalhoItem = (nome: string) => botoes().find((b) => b.hasAttribute("aria-expanded") && b.textContent?.includes(nome));
const abrir = async (nome: string) => { await clicar(cabecalhoItem(nome)); };
const digitar = async (el: HTMLInputElement, valor: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const campoPorRotulo = (rotulo: string) => {
  const l = Array.from(document.querySelectorAll("label")).find((x) => x.textContent?.trim().startsWith(rotulo));
  return l?.parentElement?.querySelector("input") as HTMLInputElement | null;
};

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
  id, ordem, produto_acabado_id: `prod-${id}`, nome_produto: nome, grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null,
  ref_fornecedor: null, composicao: null, grade_proporcao: { "36|PP": 1, "38|P": 1 },
  variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 10 }],
  qtd_total: 10, valor_unitario: 50, desconto_pct: 0, grade_detalhe: grade(), status: "encomendado",
  data_entrega: null, nota_fiscal: null, responsavel_recebimento_id: null, devolucao: null, revisao: null,
  produto: { ref: `REF-${id}`, modelo: { fotos_modelo: [] } }, ...over,
});
const ocBase = (itens: unknown[], over: Record<string, unknown> = {}) => ({
  id: "oc1", numero: "BELDIV-00123", status: "encomendado", rev: 5, empresa_id: "f1", representante_id: null,
  data_pedido: "2026-10-02", data_prevista: "2026-10-20", data_entrega: null, prazo_pagamento: "30", parcelas_entrega: 1,
  data_nota_entrada: "2026-10-05", anexo_pedido_url: null, itens, ...over,
});
const tres = () => [itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2), itemRow("C", "Short Zoe", 3, { status: "recebido", data_entrega: "2026-10-05", grade_detalhe: grade(5) })];
const chamadas = (nome: string) => rpcMock.mock.calls.filter((c) => c[0] === nome);

dados.tabelas = {};

describe("OC com vários produtos — leitura", () => {
  it("topo 'X de N produtos recebidos', um acordeão por produto, total da OC e Excluir desabilitado com o motivo", async () => {
    dados.tabelas.ocs_p_acabado = ocBase(tres());
    await montar();
    expect(texto()).toContain("1 de 3 produtos recebidos");
    for (const n of ["Vestido Midi", "Blusa Lia", "Short Zoe"]) expect(cabecalhoItem(n)).toBeTruthy();
    expect(texto()).toContain("Recebido em 05/10/2026");
    expect(texto()).toContain("Aguardando");
    const excluir = botao("Excluir")!;
    expect(excluir.disabled).toBe(true);
    expect(excluir.title).toBe("Há produto recebido — não dá para excluir a OC");
  });
  it("sem produto recebido o Excluir fica habilitado e chama onDelete com a OC", async () => {
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await clicar(botao("Excluir"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0][0]).toMatchObject({ id: "oc1", status: "encomendado" });
  });
});

describe("hidratação (P-57)", () => {
  it("OC que não carrega: avisa e o Salvar fica desabilitado (nunca grava um cabeçalho em branco por cima)", async () => {
    dados.tabelas.ocs_p_acabado = null;
    await montar();
    expect(texto()).toContain("OC não encontrada.");
    expect(botao("Salvar")!.disabled).toBe(true);
    await clicar(botao("Salvar"));
    expect(chamadas("salvar_oc_p_acabado_itens")).toHaveLength(0);
  });
});

describe("TIRAR da OC", () => {
  it("produto recebido não sai; único produto não sai (botão desabilitado com o motivo)", async () => {
    dados.tabelas.ocs_p_acabado = ocBase(tres());
    await montar();
    await abrir("Short Zoe");
    expect(texto()).toContain("Já recebido — não sai da OC");
    expect(botao("Tirar da OC")!.disabled).toBe(true);
    await act(async () => { root?.unmount(); }); root = null; host?.remove(); host = null;
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1)]);
    await montar();
    expect(texto()).toContain("Único produto — exclua a OC para desvincular");
    expect(botao("Tirar da OC")!.disabled).toBe(true);
  });
  it("Cancelar NÃO grava; Confirmar salva UMA vez com o item ausente, o rev e as pendências; a tela fica aberta", async () => {
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2), itemRow("D", "Short Zoe", 3)]);
    await montar();
    await abrir("Blusa Lia");
    await clicar(botao("Tirar da OC"));
    expect(texto()).toContain("Tirar “Blusa Lia” da OC?");
    expect(texto()).toContain("O total da OC passa de R$ 1.500,00 para R$ 1.000,00 e as parcelas são refeitas.");
    await clicar(botao("Cancelar"));
    expect(chamadas("salvar_oc_p_acabado_itens")).toHaveLength(0);
    await clicar(botao("Tirar da OC"));        // reabre o pedido
    // depois do Cancelar o botão do item ainda existe; o do diálogo é o ÚLTIMO "Tirar da OC"
    const confirmar = botoes().filter((b) => b.textContent?.trim() === "Tirar da OC").pop()!;
    // a OC "muda no servidor" (tirar B) para o refetch que vem depois do Salvar
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("D", "Short Zoe", 3)], { rev: 6 });
    await clicar(confirmar);
    await tick(20);
    const c = chamadas("salvar_oc_p_acabado_itens");
    expect(c).toHaveLength(1);
    const args = c[0][1];
    expect(args._id).toBe("oc1");
    expect(args._rev_base).toBe(5);
    expect(args._itens.map((i: any) => i.id)).toEqual(["A", "D"]);
    expect(onClose).not.toHaveBeenCalled();     // continua aberta: os outros produtos seguem
    expect(texto()).not.toContain("Blusa Lia");  // e relida: B saiu
    expect(texto()).toContain("0 de 2 produtos recebidos");
  });
});

describe("ADICIONAR produto", () => {
  it("picker lista só quem não tem OC do mesmo fornecedor; escolhido entra como 'Novo' e vai como {produto_acabado_id, do_produto:true} no Salvar", async () => {
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    const pa = (id: string, nome: string, over: Record<string, unknown> = {}) => ({
      id, nome, ref: `R-${id}`, grupo_id: "g1", categoria_id: "c1", subcategoria1_id: null, subcategoria2_id: null, empresa_id: "f1", representante_id: null,
      ref_fornecedor: null, composicao: null, grade_proporcao: { "36|PP": 1, "38|P": 1 }, qtd_total: 20, valor_unitario: 40, desconto_pct: 0,
      grupo: { nome: "Feminino" }, modelo: { fotos_modelo: [] }, produto_acabado_variantes: [{ ordem: 1, cor_id: "azul", cor_apelido_id: null, peso: 1, qtd: 20 }],
      ocs_p_acabado_itens: [], ...over,
    });
    dados.tabelas.produtos_acabados = [
      pa("px", "Short Zoe"),
      pa("py", "Cinto Vega", { ocs_p_acabado_itens: [{ id: "i9" }] }),   // já tem OC → não aparece
      pa("pz", "Calça Nina", { valor_unitario: 0 }),                    // sem valor → desabilitado com o motivo
    ];
    await montar();
    await clicar(botao("Adicionar produto"));
    expect(texto()).toContain("Adicionar produto à OC BELDIV-00123");
    expect(texto()).toContain("Short Zoe");
    expect(texto()).not.toContain("Cinto Vega");
    expect(texto()).toContain("Calça Nina");
    expect(texto()).toContain("Falta o valor unitário.");
    expect(botoes().find((b) => b.textContent?.trim() === "Adicionar")!.disabled).toBe(true);
    const ck = document.querySelector('button[role="checkbox"][aria-label="Adicionar Short Zoe"]') as HTMLElement;
    await clicar(ck);
    await clicar(botao("Adicionar 1 produto"));
    expect(cabecalhoItem("Short Zoe")).toBeTruthy();
    expect(texto()).toContain("Novo");
    await clicar(botao("Salvar"));
    await tick(20);
    const itens = chamadas("salvar_oc_p_acabado_itens")[0][1]._itens;
    expect(itens.map((i: any) => i.id ?? null)).toEqual(["A", "B", null]);
    expect(itens[2]).toEqual({ produto_acabado_id: "px", do_produto: true });
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});

describe("RECEBER um produto", () => {
  it("confirma, manda o estado completo da OC + item_* numa RPC só e fica aberta", async () => {
    const A = itemRow("A", "Vestido Midi", 1, { data_entrega: "2026-10-06", grade_detalhe: grade(5) });
    dados.tabelas.ocs_p_acabado = ocBase([A, itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await abrir("Vestido Midi");
    const marcar = botao("Marcar este produto como recebido")!;
    expect(marcar.disabled).toBe(false);
    await clicar(marcar);
    expect(texto()).toContain("Marcar “Vestido Midi” como recebido?");
    expect(texto()).toContain("Isto registra a entrada só deste produto");
    dados.tabelas.ocs_p_acabado = ocBase([{ ...A, status: "recebido" }, itemRow("B", "Blusa Lia", 2)], { rev: 6 });
    await clicar(botao("Confirmar recebimento"));
    await tick(20);
    const c = chamadas("receber_item_oc_p_acabado");
    expect(c).toHaveLength(1);
    expect(chamadas("salvar_oc_p_acabado_itens")).toHaveLength(0);
    const a = c[0][1];
    expect(a._oc_id).toBe("oc1"); expect(a._item_id).toBe("A"); expect(a._rev_base).toBe(5);
    expect(a._dados.item_data_entrega).toBe("2026-10-06");
    expect(a._itens.map((i: any) => i.id)).toEqual(["A", "B"]);
    expect(onClose).not.toHaveBeenCalled();
    expect(texto()).toContain("1 de 2 produtos recebidos");
  });
  it("sem o módulo Produção (ou Criação) o botão fica desabilitado com o motivo — o servidor também recusa", async () => {
    modulo.ok = false;
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1, { data_entrega: "2026-10-06", grade_detalhe: grade(5) }), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await abrir("Vestido Midi");
    const marcar = botao("Marcar este produto como recebido")!;
    expect(marcar.disabled).toBe(true);
    expect(marcar.title).toBe("Precisa do módulo Produção — fale com o administrador do sistema.");
    expect(texto()).toContain("Precisa do módulo Produção");
  });
  it("sem data de entrega o botão fica desabilitado e diz o que falta", async () => {
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1, { grade_detalhe: grade(5) }), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await abrir("Vestido Midi");
    expect(botao("Marcar este produto como recebido")!.disabled).toBe(true);
    expect(texto()).toContain("Preencha a data de entrega para marcar.");
  });
});

describe("colaboração — P0409", () => {
  const p0409 = { code: "P0409", message: "conflito_versao: o registro foi salvo por outra pessoa" };
  it("outra pessoa mudou OUTRO campo: o retry manda o rev novo e o estado MESCLADO (o que ela mudou + o que eu mudei)", async () => {
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await digitar(campoPorRotulo("Prazo de pagamento")!, "30/60");          // EU: prazo
    rpcMock.mockImplementationOnce(async () => {                              // ELA: data prevista (e o rev sobe)
      dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)], { rev: 6, data_prevista: "2026-11-01" });
      return { data: null, error: p0409 };
    });
    await clicar(botao("Salvar"));
    await tick(40);
    const c = chamadas("salvar_oc_p_acabado_itens");
    expect(c).toHaveLength(2);
    expect(c[0][1]._rev_base).toBe(5);
    expect(c[1][1]._rev_base).toBe(6);
    expect(c[1][1]._dados).toMatchObject({ prazo_pagamento: "30/60", data_prevista: "2026-11-01" });
    expect(onClose).toHaveBeenCalled();
  });
  it("TIRAR com P0409: o retry reaproveita a escolha (item continua ausente) com o rev novo", async () => {
    const itens = () => [itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2), itemRow("D", "Short Zoe", 3)];
    dados.tabelas.ocs_p_acabado = ocBase(itens());
    await montar();
    await abrir("Blusa Lia");
    await clicar(botao("Tirar da OC"));
    rpcMock.mockImplementationOnce(async () => {
      dados.tabelas.ocs_p_acabado = ocBase(itens(), { rev: 6, data_prevista: "2026-11-01" });
      return { data: null, error: p0409 };
    });
    await clicar(botoes().filter((b) => b.textContent?.trim() === "Tirar da OC").pop()!);
    await tick(40);
    const c = chamadas("salvar_oc_p_acabado_itens");
    expect(c).toHaveLength(2);
    expect(c[1][1]._rev_base).toBe(6);
    expect(c[1][1]._itens.map((i: any) => i.id)).toEqual(["A", "D"]);
    expect(c[1][1]._dados.data_prevista).toBe("2026-11-01");
  });
  it("CONFLITO real (eu e ela no mesmo campo): não tenta de novo, avisa e o Salvar fica travado", async () => {
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await digitar(campoPorRotulo("Prazo de pagamento")!, "30/60");
    rpcMock.mockImplementationOnce(async () => {
      dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)], { rev: 6, prazo_pagamento: "45" });
      return { data: null, error: p0409 };
    });
    await clicar(botao("Salvar"));
    await tick(40);
    expect(chamadas("salvar_oc_p_acabado_itens")).toHaveLength(1);
    expect(toastMock.warning).toHaveBeenCalled();
    expect(texto()).toContain("1 conflito a resolver");
    expect(botao("Salvar")!.disabled).toBe(true);
    // "usar o novo" resolve e destrava
    await clicar(botoes().find((b) => b.textContent === "usar o novo"));
    expect(botao("Salvar")!.disabled).toBe(false);
  });
});

describe("OC nova", () => {
  it("sem produtos o Salvar recusa na tela (nada vai ao servidor); recebimento só depois de salvar", async () => {
    await montar(null);
    expect(texto()).toContain("O Recebimento de cada produto fica disponível depois de salvar a OC");
    await clicar(botao("Salvar"));
    await tick(10);
    expect(chamadas("salvar_oc_p_acabado_itens")).toHaveLength(0);
    expect(toastMock.error).toHaveBeenCalled();
  });
});

// P-382 #1 (dono): o nº do pedido é GERADO por padrão, mas EDITÁVEL na tela (antes: campo desabilitado, "gerado ao criar e não muda").
describe("nº do pedido — gerado, mas editável (P-382)", () => {
  const numeroInput = () => campoPorRotulo("Nº do pedido");
  it("OC existente: o campo vem preenchido com o número da OC, está habilitado e o que se digita vai em _dados.numero", async () => {
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    const campo = numeroInput()!;
    expect(campo).toBeTruthy();
    expect(campo.disabled).toBe(false);
    expect(campo.readOnly).toBe(false);
    expect(campo.value).toBe("BELDIV-00123");
    await digitar(campo, "MEU-NUM-9");
    await clicar(botao("Salvar"));
    await tick(20);
    expect(chamadas("salvar_oc_p_acabado_itens")[0][1]._dados.numero).toBe("MEU-NUM-9");
  });
  it("OC existente sem mexer no campo: manda o número atual (o servidor mantém); campo em branco manda '' (o servidor mantém o atual)", async () => {
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await digitar(numeroInput()!, "");
    await clicar(botao("Salvar"));
    await tick(20);
    expect(chamadas("salvar_oc_p_acabado_itens")[0][1]._dados.numero).toBe("");
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

describe("#16 — recebimento do produto grava no SALVAR (sem receber)", () => {
  const campo = (path: string) => document.querySelector(`[data-colab-path="${path}"]`) as HTMLInputElement | null;
  it("aviso novo: gravam ao salvar a OC; receber é ação à parte (o texto antigo 'só ao receber' sumiu)", async () => {
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await abrir("Vestido Midi");
    expect(texto()).toContain("Estes dados são gravados ao salvar a OC.");
    expect(texto()).toContain("Marcar este produto como recebido é uma ação à parte");
    expect(texto()).not.toContain("gravados ao marcar este produto como recebido");
  });
  it("NF digitada vai no _itens do Salvar (e SÓ no Salvar: nada de RPC de receber); a OC fecha como num Salvar normal", async () => {
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1), itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await abrir("Vestido Midi");
    await digitar(campo("item:A:nota_fiscal")!, "NF-4512");
    await act(async () => {   // Revisão é <textarea>
      const el = campo("item:A:revisao") as unknown as HTMLTextAreaElement;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, "conferido");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await clicar(botao("Salvar"));
    await tick(20);
    expect(chamadas("receber_item_oc_p_acabado")).toHaveLength(0);
    const c = chamadas("salvar_oc_p_acabado_itens");
    expect(c).toHaveLength(1);
    const a = c[0][1]._itens.find((i: any) => i.id === "A");
    expect(a).toMatchObject({ nota_fiscal: "NF-4512", revisao: "conferido", data_entrega: null, responsavel_recebimento_id: null, devolucao: null });
    expect(a).not.toHaveProperty("status");
    const b = c[0][1]._itens.find((i: any) => i.id === "B");
    expect(b).toMatchObject({ nota_fiscal: null, data_entrega: null });
    expect(onSaved).toHaveBeenCalled();
  });
  it("o que veio gravado do servidor volta no Salvar (não é zerado) e um refetch alheio NÃO reverte o que digitei", async () => {
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1, { nota_fiscal: "NF-GRAVADA", data_entrega: "2026-10-06" }), itemRow("B", "Blusa Lia", 2)]);
    const qc = await montar();
    await abrir("Vestido Midi");
    expect(campo("item:A:nota_fiscal")!.value).toBe("NF-GRAVADA");
    await digitar(campo("item:A:nota_fiscal")!, "NF-EDITADA");
    // outra pessoa salva OUTRA coisa (B) -> refetch do Realtime
    dados.tabelas.ocs_p_acabado = ocBase([itemRow("A", "Vestido Midi", 1, { nota_fiscal: "NF-GRAVADA", data_entrega: "2026-10-06" }), itemRow("B", "Blusa Lia", 2, { revisao: "dela" })], { rev: 6 });
    await act(async () => { await qc.invalidateQueries({ queryKey: ["oc-p-acabado", "oc1"] }); });
    await tick(30);
    expect(campo("item:A:nota_fiscal")!.value).toBe("NF-EDITADA");
    await clicar(botao("Salvar"));
    await tick(20);
    const a = chamadas("salvar_oc_p_acabado_itens")[0][1]._itens.find((i: any) => i.id === "A");
    expect(a).toMatchObject({ nota_fiscal: "NF-EDITADA", data_entrega: "2026-10-06" });
    expect(chamadas("salvar_oc_p_acabado_itens")[0][1]._itens.find((i: any) => i.id === "B")).toMatchObject({ revisao: "dela" });
  });
  it("RECEBER leva os mesmos campos no _itens (o servidor os grava junto, na mesma transação)", async () => {
    const A = itemRow("A", "Vestido Midi", 1, { data_entrega: "2026-10-06", nota_fiscal: "NF-7", grade_detalhe: grade(5) });
    dados.tabelas.ocs_p_acabado = ocBase([A, itemRow("B", "Blusa Lia", 2)]);
    await montar();
    await abrir("Vestido Midi");
    await clicar(botao("Marcar este produto como recebido"));
    dados.tabelas.ocs_p_acabado = ocBase([{ ...A, status: "recebido" }, itemRow("B", "Blusa Lia", 2)], { rev: 6 });
    await clicar(botao("Confirmar recebimento"));
    await tick(20);
    const c = chamadas("receber_item_oc_p_acabado");
    expect(c).toHaveLength(1);
    expect(c[0][1]._itens.find((i: any) => i.id === "A")).toMatchObject({ nota_fiscal: "NF-7", data_entrega: "2026-10-06" });
    expect(c[0][1]._dados.item_nota_fiscal).toBe("NF-7");
  });
});
