// @vitest-environment happy-dom
// Permissão de preço (19/nov, Task 4): varejo e atacado SEPARADOS nas telas de produto COMPRADO (ProdutoCard PA, resumo do Sheet, ResumoRevendaPanel,
// PrecoRevendaBloco do Sheet do Planejamento). Regra do dono (Review Focus #5): sem UMA das duas permissões de VER, "—" SÓ naquela parte — o
// bloco NUNCA some inteiro. EDITAR atacado = chave própria (`podeEditarPrecoAtacado`); a trava da Integração segue SÓ no varejo (inv. 14).
// Render de verdade (react-dom/client + happy-dom) dos 4 cruzamentos ver-varejo × ver-atacado + asserts de fonte do que não dá para renderizar.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  CHAVE_VER_PRECO_VAREJO, CHAVE_VER_PRECO_ATACADO, CHAVE_EDITAR_PRECO_VAREJO, CHAVE_EDITAR_PRECO_ATACADO,
} from "@/lib/preco-permissao";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Sem rede: o ProdutoCard dispara leituras (linhas, etc.) — o stub devolve `{ data: [], error: null }` em qualquer cadeia (nunca toca a produção).
function stubSupabase() {
  const resultado = { data: [], error: null };
  const cadeia: any = new Proxy(function () {}, {
    get: (_t, p) => (p === "then" ? (res: (v: unknown) => unknown) => Promise.resolve(resultado).then(res) : cadeia),
    apply: () => cadeia,
  });
  return { supabase: { from: () => cadeia, rpc: () => cadeia, auth: { getSession: async () => ({ data: { session: null } }) }, channel: () => cadeia, removeChannel: () => {} } };
}
const ler = (p: string) => readFileSync(p, "utf8");

type Perm = { verVarejo: boolean; verAtacado: boolean; editaVarejo: boolean; editaAtacado: boolean };
const permissoes = (p: Perm) => {
  const ver = new Set<string>(); const edita = new Set<string>();
  if (p.verVarejo) ver.add(CHAVE_VER_PRECO_VAREJO);
  if (p.verAtacado) ver.add(CHAVE_VER_PRECO_ATACADO);
  if (p.editaVarejo) edita.add(CHAVE_EDITAR_PRECO_VAREJO);
  if (p.editaAtacado) edita.add(CHAVE_EDITAR_PRECO_ATACADO);
  // Só as chaves de PREÇO: o resto (custos, mão de obra, página) fica sem permissão de propósito — prova a ortogonalidade (preço ≠ custos).
  return { canView: (k: string) => ver.has(k), canEdit: (k: string) => edita.has(k) };
};

function montar(el: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(el); });
  return { container, unmount: () => { act(() => { root.unmount(); }); container.remove(); } };
}

/** Input (o 1º) que mora no mesmo bloco do <label>/<Label> de texto exato. */
function inputDe(container: HTMLElement, rotulo: string): HTMLInputElement | null {
  const lab = [...container.querySelectorAll("label")].find((l) => l.textContent?.trim() === rotulo);
  return (lab?.parentElement?.querySelector("input") as HTMLInputElement | null) ?? null;
}
/** Bloco (pai do rótulo) cujo texto é só "—" depois do rótulo. */
function blocoDe(container: HTMLElement, rotulo: string): HTMLElement | null {
  const lab = [...container.querySelectorAll("label, span, p")].find((l) => l.textContent?.trim() === rotulo);
  return (lab?.parentElement as HTMLElement | null) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. ProdutoCard (Produto Acabado) — título "Varejo … · Atacado …" + inputs do bloco "2 · Preço"
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function produtoBase(over: Record<string, unknown> = {}) {
  return {
    id: "p1", rev: 1, nome: "Blusa", ref: "REF1", grupo_id: "g1", categoria_id: "c1",
    subcategoria1_id: null, subcategoria2_id: null, colecao_id: "col1", subcolecao: null, semana: null,
    empresa_id: null, representante_id: null, ref_fornecedor: "", composicao: "",
    grade_proporcao: {}, qtd_total: 10, valor_unitario: 40, desconto_pct: 0, insumos_total: 0,
    markup_atacado: null, markup_varejo: null, preco_atacado_fixo: 60, preco_varejo_fixo: 100,
    foto_url: null, modelo_id: "m1", mix_id: null,
    tamanho_tipo: "letra", tamanho_tipo_base: "letra", modeloSkusCount: 0,
    variantes: [{ ordem: 1, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 10 }],
    modeloPrecoVenda: 100, modeloPrecoAtacado: 60, modeloLinhaId: null,
    modeloThumbFontes: [null, null, null], oc: null,
    ...over,
  };
}

async function montarCard(perm: Perm, estadoIntegracao: unknown = null) {
  vi.resetModules();
  vi.doMock("@/integrations/supabase/client", stubSupabase);
  vi.doMock("@tanstack/react-router", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@tanstack/react-router")>();
    return { ...actual, useNavigate: () => () => {} };
  });
  vi.doMock("@/hooks/useAuth", () => ({ useAuth: () => ({ ...permissoes(perm), user: { id: "u1" }, session: null, loading: false }) }));
  vi.doMock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null }));
  vi.doMock("@/hooks/useMaoObraModelo", () => ({
    useMaoObraModelo: () => ({ linhas: [], catsServico: [], setLinhas: () => {}, aprovar: { mutate: () => {}, isPending: false }, linhasPersistidas: [], dirty: false, total: 0, salvar: { mutate: () => {}, isPending: false } }),
  }));
  vi.doMock("@/hooks/useIntegracaoEstado", () => ({ useIntegracaoEstado: () => estadoIntegracao }));
  const { ProdutoCard } = await import("@/components/produto-acabado/ProdutoCard");
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const m = montar(createElement(QueryClientProvider, { client: qc },
    createElement(ProdutoCard, {
      produto: produtoBase(), onChange: () => {}, open: true, onToggleOpen: () => {},
      grupos: [{ id: "g1", nome: "Camisas" }], categorias: [], subcats1: [], subcats2: [], categoriasTecido: [], materiaisAviamento: [],
      cores: [], coresApelido: [], empresas: [], tamanhos: ["P", "M", "G"], colecaoNome: null,
      linhasMarkup: {}, onSalvarProduto: async () => {}, onCardCriado: () => {}, onOcVinculada: () => {},
      onExcluido: () => {}, onLimpo: () => {},
    } as any)));
  // abre o acordeão "2 · Preço" (o Radix só monta o conteúdo aberto)
  const gatilho = [...m.container.querySelectorAll("button")].find((b) => b.textContent?.includes("2 · Preço")) as HTMLButtonElement;
  expect(gatilho, "gatilho do acordeão '2 · Preço'").toBeTruthy();
  await act(async () => { gatilho.click(); });
  return m;
}
const todas: Perm = { verVarejo: true, verAtacado: true, editaVarejo: true, editaAtacado: true };
const pill = (c: HTMLElement) => [...c.querySelectorAll("span")].find((s) => /Varejo .*Atacado .*custo\/pç/.test(s.textContent ?? ""))?.textContent ?? "";

describe("ProdutoCard (PA) — varejo × atacado separados (VER)", () => {
  it("vê os DOIS: título com os dois valores", async () => {
    const m = await montarCard(todas);
    const t = pill(m.container);
    expect(t).toMatch(/Varejo R\$\s?100,00/); expect(t).toMatch(/Atacado R\$\s?60,00/);
    m.unmount();
  });
  it("vê varejo mas NÃO atacado: Varejo com valor, Atacado '—'; o bloco '2 · Preço' e o custo/pç continuam", async () => {
    const m = await montarCard({ ...todas, verAtacado: false });
    const t = pill(m.container);
    expect(t).toMatch(/Varejo R\$\s?100,00/); expect(t).toContain("Atacado —"); expect(t).not.toMatch(/60,00/); expect(t).toMatch(/custo\/pç R\$/);
    // bloco inteiro presente: o varejo segue editável/visível, o atacado vira '—' sem input
    expect(inputDe(m.container, "Preço varejo")).not.toBeNull();
    expect(inputDe(m.container, "Preço atacado")).toBeNull();
    expect(inputDe(m.container, "Markup atacado")).toBeNull();
    expect(inputDe(m.container, "Markup varejo")).not.toBeNull();
    expect(blocoDe(m.container, "Preço atacado")?.textContent).toContain("—");
    expect(m.container.textContent).toContain("Custo total da peça");
    m.unmount();
  });
  it("vê atacado mas NÃO varejo: Atacado com valor, Varejo '—'; bloco continua", async () => {
    const m = await montarCard({ ...todas, verVarejo: false });
    const t = pill(m.container);
    expect(t).toContain("Varejo —"); expect(t).toMatch(/Atacado R\$\s?60,00/); expect(t).not.toMatch(/100,00/);
    expect(inputDe(m.container, "Preço varejo")).toBeNull();
    expect(inputDe(m.container, "Markup varejo")).toBeNull();
    expect(inputDe(m.container, "Preço atacado")).not.toBeNull();
    expect(inputDe(m.container, "Markup atacado")).not.toBeNull();
    expect(blocoDe(m.container, "Preço varejo")?.textContent).toContain("—");
    expect(m.container.textContent).toContain("Custo total da peça");
    m.unmount();
  });
  it("não vê NENHUM dos dois: os dois '—', mas o bloco e o custo/pç ficam (custo é outra chave)", async () => {
    const m = await montarCard({ ...todas, verVarejo: false, verAtacado: false });
    const t = pill(m.container);
    expect(t).toContain("Varejo —"); expect(t).toContain("Atacado —"); expect(t).toMatch(/custo\/pç R\$/);
    expect(m.container.textContent).toContain("Custo total da peça");
    for (const r of ["Preço varejo", "Preço atacado", "Markup varejo", "Markup atacado"]) expect(inputDe(m.container, r), r).toBeNull();
    m.unmount();
  });
});

describe("ProdutoCard (PA) — EDITAR atacado/varejo por chave própria", () => {
  it("atacado: os 2 inputs só habilitam com podeEditarPrecoAtacado (independente do varejo)", async () => {
    const sem = await montarCard({ ...todas, editaAtacado: false });
    expect(inputDe(sem.container, "Preço atacado")!.disabled).toBe(true);
    expect(inputDe(sem.container, "Markup atacado")!.disabled).toBe(true);
    expect(inputDe(sem.container, "Preço varejo")!.disabled).toBe(false);
    expect(inputDe(sem.container, "Markup varejo")!.disabled).toBe(false);
    sem.unmount();
    const com = await montarCard({ ...todas, editaAtacado: true, editaVarejo: false });
    expect(inputDe(com.container, "Preço atacado")!.disabled).toBe(false);
    expect(inputDe(com.container, "Markup atacado")!.disabled).toBe(false);
    expect(inputDe(com.container, "Preço varejo")!.disabled).toBe(true);
    expect(inputDe(com.container, "Markup varejo")!.disabled).toBe(true);
    com.unmount();
  });
  it("Integração (inv. 14): o varejo TRAVA, o atacado fica LIVRE (editável com a chave de atacado)", async () => {
    const m = await montarCard(todas, { estado: "integravel", campos: ["preco_venda"], marcadoEm: null, integradoEm: null });
    expect(inputDe(m.container, "Preço varejo")!.disabled).toBe(true);
    expect(inputDe(m.container, "Markup varejo")!.disabled).toBe(true);
    expect(inputDe(m.container, "Preço atacado")!.disabled).toBe(false);
    expect(inputDe(m.container, "Markup atacado")!.disabled).toBe(false);
    m.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. ResumoRevendaPanel (varejo) e ResumoVendaDuplo (varejo + atacado, usado nos Sheets PA e PI)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("ResumoRevendaPanel — Poder de venda (varejo) por ver-varejo", () => {
  async function painel(perm: Perm) {
    vi.resetModules();
    vi.doMock("@/hooks/useAuth", () => ({ useAuth: () => ({ ...permissoes(perm), user: { id: "u1" } }) }));
    const { ResumoRevendaPanel } = await import("@/components/produto-acabado/ResumoRevendaPanel");
    return montar(createElement(ResumoRevendaPanel as any, {
      produtos: [produtoBase()], agruparPor: "categoria", categoriaNome: () => "Cat", grupoNome: () => "Grp", otbBucket: null,
    }));
  }
  it("com ver-varejo: mostra o Σ preço × peças; sem: '—' e o bloco NÃO some; 'Custo previsto' fica", async () => {
    const com = await painel(todas);
    expect(com.container.textContent).toMatch(/Σ preço × peças\s*R\$\s?1\.000,00/);
    com.unmount();
    const sem = await painel({ ...todas, verVarejo: false });
    expect(sem.container.textContent).toContain("Poder de venda (previsto)");
    expect(sem.container.textContent).toMatch(/Σ preço × peças\s*—/);
    expect(sem.container.textContent).not.toMatch(/1\.000,00/);
    expect(sem.container.textContent).toContain("Custo previsto"); // custos: outra chave, intocado
    expect(sem.container.textContent).toMatch(/Σ valor c\/ desconto\s*R\$\s?400,00/);
    sem.unmount();
  });
  it("ver SÓ atacado não libera o varejo (as chaves são independentes)", async () => {
    const m = await painel({ ...todas, verVarejo: false, verAtacado: true });
    expect(m.container.textContent).toMatch(/Σ preço × peças\s*—/);
    m.unmount();
  });
});

describe("ResumoVendaDuplo (Sheets PA e PI) — '—' só no canal sem permissão", () => {
  async function resumo(p: { veVarejo?: boolean; veAtacado?: boolean }) {
    vi.resetModules();
    const { ResumoVendaDuplo } = await import("@/components/shared/ResumoVendaDuplo");
    return montar(createElement(ResumoVendaDuplo, { poderVarejo: 1000, poderAtacado: 600, markupVarejo: 2.5, markupAtacado: 1.5, qtd: 3, ...p }));
  }
  it("os 4 cruzamentos", async () => {
    const ambos = await resumo({ veVarejo: true, veAtacado: true });
    expect(ambos.container.textContent).toMatch(/1\.000,00/); expect(ambos.container.textContent).toMatch(/600,00/);
    ambos.unmount();
    const soVarejo = await resumo({ veVarejo: true, veAtacado: false });
    expect(soVarejo.container.textContent).toMatch(/1\.000,00/); expect(soVarejo.container.textContent).not.toMatch(/600,00/);
    expect(soVarejo.container.textContent).toContain("3 produtos");
    soVarejo.unmount();
    const soAtacado = await resumo({ veVarejo: false, veAtacado: true });
    expect(soAtacado.container.textContent).not.toMatch(/1\.000,00/); expect(soAtacado.container.textContent).toMatch(/600,00/);
    soAtacado.unmount();
    const nenhum = await resumo({ veVarejo: false, veAtacado: false });
    expect(nenhum.container.textContent).not.toMatch(/\d\.?\d{3},00|600,00/);
    expect(nenhum.container.textContent).toContain("3 produtos");
    expect((nenhum.container.textContent!.match(/—/g) ?? []).length).toBeGreaterThanOrEqual(4);
    nenhum.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. PrecoRevendaBloco (Sheet do Planejamento, produto comprado)
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("PrecoRevendaBloco — varejo × atacado separados (VER e EDITAR)", () => {
  async function bloco(over: Record<string, unknown> = {}) {
    vi.resetModules();
    vi.doMock("@tanstack/react-router", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@tanstack/react-router")>();
      return { ...actual, useNavigate: () => () => {} };
    });
    const { PrecoRevendaBloco } = await import("@/components/planejamento/planejamento-detail/RevendaSetores");
    const rv = {
      produtoRevenda: { id: "p1" }, produtoRevendaLoading: false,
      markupAtacadoInput: 1.5, setMarkupAtacadoInput: () => {}, markupVarejoInput: 2.5, setMarkupVarejoInput: () => {},
      precoAtacadoDraft: "60", setPrecoAtacadoDraft: () => {}, precoVarejoDraft: "100", setPrecoVarejoDraft: () => {},
    };
    const piRevenda = { custo: 40, markupLinha: 2, markupAplicado: 2, preco: 80, sugerido: 84.9, efetivo: 100, markupReal: 2.5, markupExibir: 2.5 };
    return montar(createElement(PrecoRevendaBloco as any, {
      rv, custoReal: false, piRevenda, draft: { preco_venda: 100, preco_atacado: 60 },
      podeEditarPreco: true, podeEditarPrecoComprado: true, podeEditarAtacado: true, veVarejo: true, veAtacado: true,
      planBloqueado: false, precoAnterior: null, onPrecoAnterior: () => {}, travaVarejo: false, travaPrecoAnterior: false,
      ...over,
    }));
  }
  it("vê os dois: os 4 controles + Preço anterior", async () => {
    const m = await bloco();
    for (const r of ["Markup atacado", "Markup varejo", "Preço atacado", "Preço varejo"]) expect(inputDe(m.container, r), r).not.toBeNull();
    m.unmount();
  });
  it("sem ver ATACADO: Markup/Preço atacado '—'; varejo + Preço anterior seguem; custo/preço-derivado seguem", async () => {
    const m = await bloco({ veAtacado: false });
    expect(inputDe(m.container, "Markup atacado")).toBeNull(); expect(inputDe(m.container, "Preço atacado")).toBeNull();
    expect(inputDe(m.container, "Markup varejo")).not.toBeNull(); expect(inputDe(m.container, "Preço varejo")).not.toBeNull();
    expect(m.container.textContent).toContain("Custo (previsto)"); expect(m.container.textContent).toContain("Preço anterior");
    m.unmount();
  });
  it("sem ver VAREJO: Markup/Preço varejo e Preço anterior '—'; atacado segue", async () => {
    const m = await bloco({ veVarejo: false });
    expect(inputDe(m.container, "Markup varejo")).toBeNull(); expect(inputDe(m.container, "Preço varejo")).toBeNull();
    expect(inputDe(m.container, "Preço anterior")).toBeNull();
    expect(m.container.textContent).toMatch(/Preço anterior\s*—/);
    expect(inputDe(m.container, "Markup atacado")).not.toBeNull(); expect(inputDe(m.container, "Preço atacado")).not.toBeNull();
    expect(m.container.textContent).toContain("Custo (previsto)");
    m.unmount();
  });
  it("EDITAR atacado só com podeEditarAtacado — independente de podeEditarPrecoComprado (que segue no varejo)", async () => {
    const sem = await bloco({ podeEditarAtacado: false });
    expect(inputDe(sem.container, "Markup atacado")!.disabled).toBe(true); expect(inputDe(sem.container, "Preço atacado")!.disabled).toBe(true);
    expect(inputDe(sem.container, "Markup varejo")!.disabled).toBe(false); expect(inputDe(sem.container, "Preço varejo")!.disabled).toBe(false);
    sem.unmount();
    const so = await bloco({ podeEditarAtacado: true, podeEditarPrecoComprado: false });
    expect(inputDe(so.container, "Markup atacado")!.disabled).toBe(false); expect(inputDe(so.container, "Preço atacado")!.disabled).toBe(false);
    expect(inputDe(so.container, "Markup varejo")!.disabled).toBe(true); expect(inputDe(so.container, "Preço varejo")!.disabled).toBe(true);
    so.unmount();
  });
  it("Integração (inv. 14): travaVarejo desabilita SÓ o varejo; o atacado fica livre", async () => {
    const m = await bloco({ travaVarejo: true });
    expect(inputDe(m.container, "Markup varejo")!.disabled).toBe(true); expect(inputDe(m.container, "Preço varejo")!.disabled).toBe(true);
    expect(inputDe(m.container, "Markup atacado")!.disabled).toBe(false); expect(inputDe(m.container, "Preço atacado")!.disabled).toBe(false);
    m.unmount();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 3b. Produto IMPORTADO (card + painel) — o importado TEM atacado (markup + valor), o brief original errou
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("ProdutoImportadoCard — varejo × atacado separados (VER e EDITAR)", () => {
  async function cardPI(perm: Perm, estadoIntegracao: unknown = null) {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client", stubSupabase);
    vi.doMock("@tanstack/react-router", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@tanstack/react-router")>();
      return { ...actual, useNavigate: () => () => {} };
    });
    vi.doMock("@/hooks/useAuth", () => ({ useAuth: () => ({ ...permissoes(perm), user: { id: "u1" }, session: null, loading: false }) }));
    vi.doMock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null }));
    vi.doMock("@/hooks/useMaoObraModelo", () => ({
      useMaoObraModelo: () => ({ linhas: [], catsServico: [], setLinhas: () => {}, aprovar: { mutate: () => {}, isPending: false }, linhasPersistidas: [], dirty: false, total: 0, salvar: { mutate: () => {}, isPending: false } }),
    }));
    vi.doMock("@/hooks/useIntegracaoEstado", () => ({ useIntegracaoEstado: () => estadoIntegracao }));
    const { ProdutoImportadoCard } = await import("@/components/produto-importado/ProdutoImportadoCard");
    const { emptyDraft } = await import("@/components/produto-importado/shared");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const draft = {
      ...emptyDraft("c1", "s1"), id: "p1", rev: 1, nome: "Blusa", modelo_id: "m1", ref: "REF1",
      valor_unitario_m1: 10, moeda_compra: "RMB", moeda_intermediaria: "USD", cotacao_ref: 5, cotacao_final: 5,
      preco_atacado_fixo: 60, preco_varejo_fixo: 100,
      variantes: [{ ordem: 1, cor_id: "c-azul", cor_apelido_id: null, peso: 1, qtd: 10, _touched: false }],
    };
    const m = montar(createElement(QueryClientProvider, { client: qc },
      createElement(ProdutoImportadoCard as any, {
        draft, onChange: () => {}, open: true, onToggleOpen: () => {}, grupos: [], categorias: [], subcats1: [], subcats2: [],
        categoriasTecido: [], materiaisAviamento: [], cores: [{ id: "c-azul", nome: "Azul" }], coresApelido: [], empresas: [],
        tamanhos: ["P", "M", "G"], onExcluir: () => {},
      })));
    const gatilho = [...m.container.querySelectorAll("button[aria-expanded]")].find((b) => b.textContent?.includes("7 · Valores")) as HTMLElement;
    expect(gatilho, "gatilho '7 · Valores'").toBeTruthy();
    await act(async () => { gatilho.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    return m;
  }
  const campo = (c: HTMLElement, path: string) => c.querySelector(`[data-colab-path="card:p1:${path}"]`) as HTMLInputElement | null;
  const CAMPOS = { mkA: "markup-atacado", mkV: "markup-varejo", pA: "preco-atacado-fixo", pV: "preco-varejo-fixo" };

  it("vê os dois: os 4 campos; sem ver atacado => só os de atacado '—' (bloco e Valor final ficam)", async () => {
    const todosVem = await cardPI(todas);
    for (const p of Object.values(CAMPOS)) expect(campo(todosVem.container, p), p).not.toBeNull();
    todosVem.unmount();
    const m = await cardPI({ ...todas, verAtacado: false });
    expect(campo(m.container, CAMPOS.mkA)).toBeNull(); expect(campo(m.container, CAMPOS.pA)).toBeNull();
    expect(campo(m.container, CAMPOS.mkV)).not.toBeNull(); expect(campo(m.container, CAMPOS.pV)).not.toBeNull();
    expect(m.container.textContent).toContain("Valor final (BRL)");
    expect(blocoDe(m.container, "Valor atacado")?.textContent).toContain("—");
    m.unmount();
  });
  it("sem ver varejo => só os de varejo '—' e a pílula 'varejo —'; atacado segue; sem ver nenhum o bloco ainda existe", async () => {
    const m = await cardPI({ ...todas, verVarejo: false });
    expect(campo(m.container, CAMPOS.mkV)).toBeNull(); expect(campo(m.container, CAMPOS.pV)).toBeNull();
    expect(campo(m.container, CAMPOS.mkA)).not.toBeNull(); expect(campo(m.container, CAMPOS.pA)).not.toBeNull();
    expect(blocoDe(m.container, "Valor varejo")?.textContent).toContain("—");
    expect(m.container.textContent).toContain("varejo —");
    expect(m.container.textContent).not.toMatch(/varejo R\$/);
    m.unmount();
    const nenhum = await cardPI({ ...todas, verVarejo: false, verAtacado: false });
    for (const p of Object.values(CAMPOS)) expect(campo(nenhum.container, p), p).toBeNull();
    expect(nenhum.container.textContent).toContain("Valor final (BRL)");
    nenhum.unmount();
  });
  it("EDITAR por chave própria: atacado só com editaAtacado, varejo só com editaVarejo (independentes)", async () => {
    const a = await cardPI({ ...todas, editaAtacado: false });
    expect(campo(a.container, CAMPOS.mkA)!.disabled).toBe(true); expect(campo(a.container, CAMPOS.pA)!.disabled).toBe(true);
    expect(campo(a.container, CAMPOS.mkV)!.disabled).toBe(false); expect(campo(a.container, CAMPOS.pV)!.disabled).toBe(false);
    a.unmount();
    const v = await cardPI({ ...todas, editaVarejo: false });
    expect(campo(v.container, CAMPOS.mkV)!.disabled).toBe(true); expect(campo(v.container, CAMPOS.pV)!.disabled).toBe(true);
    expect(campo(v.container, CAMPOS.mkA)!.disabled).toBe(false); expect(campo(v.container, CAMPOS.pA)!.disabled).toBe(false);
    v.unmount();
  });
  it("Integração (D34/R8): trava SÓ o varejo; o atacado fica livre", async () => {
    const m = await cardPI(todas, { estado: "integravel", campos: ["preco_venda"], marcadoEm: null, integradoEm: null });
    expect(campo(m.container, CAMPOS.mkV)!.disabled).toBe(true); expect(campo(m.container, CAMPOS.pV)!.disabled).toBe(true);
    expect(campo(m.container, CAMPOS.mkA)!.disabled).toBe(false); expect(campo(m.container, CAMPOS.pA)!.disabled).toBe(false);
    m.unmount();
  });
});

describe("ResumoImportadoPanel — Poder de venda (varejo) por ver-varejo", () => {
  async function painelPI(perm: Perm) {
    vi.resetModules();
    vi.doMock("@/hooks/useAuth", () => ({ useAuth: () => ({ ...permissoes(perm), user: { id: "u1" } }) }));
    const { ResumoImportadoPanel } = await import("@/components/produto-importado/ResumoImportadoPanel");
    const { emptyDraft } = await import("@/components/produto-importado/shared");
    const p = { ...emptyDraft("c1", "s1"), id: "p1", valor_unitario_m1: 10, moeda_compra: "BRL", moeda_intermediaria: null, qtd_total: 10, preco_varejo_fixo: 100 };
    return montar(createElement(ResumoImportadoPanel as any, { produtos: [p], bucket: null, nivelMacro: "categoria", categorias: [], grupos: [] }));
  }
  it("com ver-varejo mostra o Σ; sem, '—' e a seção + 'Custo de compra' continuam; ver só atacado não libera", async () => {
    const com = await painelPI(todas);
    expect(com.container.textContent).toMatch(/Σ varejo × peças\s*R\$\s?1\.000,00/);
    com.unmount();
    for (const perm of [{ ...todas, verVarejo: false }, { ...todas, verVarejo: false, verAtacado: true }]) {
      const sem = await painelPI(perm);
      expect(sem.container.textContent).toContain("Poder de venda (varejo)");
      expect(sem.container.textContent).toMatch(/Σ varejo × peças\s*—/);
      expect(sem.container.textContent).not.toMatch(/1\.000,00/);
      expect(sem.container.textContent).toContain("Custo de compra");
      sem.unmount();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// 4. Fiação (fonte): chaves certas, nada de custos, trava só no varejo
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("fiação — chaves de preço, ortogonais a custos; trava da Integração só no varejo", () => {
  const CITA_CUSTOS = /veCustos|podeVerCustos|criacao_planejamento:custos|dashboard_custos/;
  it("PlanejamentoDetail deriva veAtacado/editaAtacado das chaves próprias e os passa ao PrecoRevendaBloco", () => {
    const s = ler("src/components/planejamento/PlanejamentoDetail.tsx");
    expect(s).toMatch(/const veAtacado = podeVerPrecoAtacado\(canView\)/);
    expect(s).toMatch(/const editaAtacado = podeEditarPrecoAtacado\(canEdit\)/);
    expect(s).toMatch(/<PrecoRevendaBloco[\s\S]*?podeEditarAtacado=\{editaAtacado\}[\s\S]*?veVarejo=\{veVarejo\} veAtacado=\{veAtacado\}/);
    expect(s).not.toMatch(/const (veAtacado|editaAtacado) =[^\n]*(veCustos|podeVerCustos)/);
    // varejo do comprado UNIFORMIZADO: SÓ preco_venda (= editaVarejo), igual ao ProdutoCard — o OU com a página do produto saiu
    expect(s).toContain("const podeEditarPrecoComprado = editaVarejo;");
    expect(s).not.toMatch(/const podeEditarPrecoComprado =[^\n]*criacao_produto_acabado/);
  });
  it("RevendaSetores: os 2 controles de ATACADO usam podeEditarAtacado (nunca podeEditarPrecoComprado nem travaVarejo)", () => {
    const s = ler("src/components/planejamento/planejamento-detail/RevendaSetores.tsx");
    expect(s.match(/disabled=\{planBloqueado \|\| !podeEditarAtacado\}/g)?.length).toBe(2);
    expect(s.match(/disabled=\{planBloqueado \|\| !podeEditarPrecoComprado \|\| travaVarejo\}/g)?.length).toBe(2); // varejo: igual a antes
    expect(s).not.toMatch(/disabled=\{planBloqueado \|\| !podeEditarPrecoComprado\}/); // sobrou nenhum atacado no OU antigo
    expect(s).not.toMatch(/disabled=\{[^}]*(podeEditarAtacado)[^}]*travaVarejo/); // atacado nunca trava pela Integração
  });
  it("ProdutoCard: usa as 4 chaves de preço, sem custos; a trava da Integração só entra nos inputs de varejo", () => {
    const s = ler("src/components/produto-acabado/ProdutoCard.tsx");
    expect(s).toMatch(/const veVarejo = podeVerPrecoVarejo\(canView\)/); expect(s).toMatch(/const veAtacado = podeVerPrecoAtacado\(canView\)/);
    expect(s).toMatch(/const editaVarejo = podeEditarPrecoVarejo\(canEdit\)/); expect(s).toMatch(/const editaAtacado = podeEditarPrecoAtacado\(canEdit\)/);
    expect(s).not.toMatch(/const (veVarejo|veAtacado|editaVarejo|editaAtacado) =[^\n]*(podeVerCustos|veCustos|CHAVES_VER_CUSTOS)/);
    expect(s.match(/disabled=\{travaIntegracao\.has\("preco_venda"\) \|\| !editaVarejo\}/g)?.length).toBe(2);
    expect(s.match(/disabled=\{!editaAtacado\}/g)?.length).toBe(2);
    expect(s).not.toMatch(/disabled=\{[^}]*editaAtacado[^}]*travaIntegracao/);
  });
  it("Sheets PA/PI e Resumo: usam as chaves de preço (helpers puros), sem citar custos no trecho de preço", () => {
    for (const f of ["src/components/produto-acabado/ProdutoAcabadoSheet.tsx", "src/components/produto-importado/ProdutoImportadoSheet.tsx"]) {
      const s = ler(f);
      expect(s, f).toMatch(/const veVarejo = podeVerPrecoVarejo\(canView\)/); expect(s, f).toMatch(/const veAtacado = podeVerPrecoAtacado\(canView\)/);
      expect(s, f).toMatch(/<ResumoVendaDuplo[\s\S]*?veVarejo=\{veVarejo\}\s+veAtacado=\{veAtacado\}/);
    }
    const r = ler("src/components/produto-acabado/ResumoRevendaPanel.tsx");
    expect(r).toMatch(/const veVarejo = podeVerPrecoVarejo\(canView\)/);
    expect(r).not.toMatch(/const veVarejo =[^\n]*(podeVerCustos|veCustos)/);
    // o cálculo NÃO foi zerado pelo gate: só a exibição
    expect(r).toMatch(/const poderVenda = produtos\.reduce/);
  });
  it("ProdutoImportadoCard/Painel: 4 chaves de preço (sem custos); trava da Integração só nos inputs de varejo", () => {
    const c = ler("src/components/produto-importado/ProdutoImportadoCard.tsx");
    expect(c).toMatch(/const veVarejo = podeVerPrecoVarejo\(canView\)/); expect(c).toMatch(/const veAtacado = podeVerPrecoAtacado\(canView\)/);
    expect(c).toMatch(/const editaVarejo = podeEditarPrecoVarejo\(canEdit\)/); expect(c).toMatch(/const editaAtacado = podeEditarPrecoAtacado\(canEdit\)/);
    expect(c).not.toMatch(/const (veVarejo|veAtacado|editaVarejo|editaAtacado) =[^\n]*(podeVerCustos|veCustos)/);
    expect(c.match(/disabled=\{travaIntegracao\.has\("preco_venda"\) \|\| !editaVarejo\}/g)?.length).toBe(2);
    expect(c.match(/disabled=\{!editaAtacado\}/g)?.length).toBe(2);
    expect(c).not.toMatch(/disabled=\{[^}]*editaAtacado[^}]*travaIntegracao/);
    const p = ler("src/components/produto-importado/ResumoImportadoPanel.tsx");
    expect(p).toMatch(/const veVarejo = podeVerPrecoVarejo\(canView\)/);
    expect(p).toMatch(/for \(const p of produtos\)/); // o cálculo NÃO foi zerado pelo gate
  });
  it("o helper de preço segue sem citar custos (ortogonalidade)", () => {
    expect(ler("src/lib/preco-permissao.ts").replace(/^\s*\/\/.*$/gm, "")).not.toMatch(CITA_CUSTOS);
  });
});
