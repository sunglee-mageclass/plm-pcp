// @vitest-environment happy-dom
// Trava de regressão C1/C1b da Tarefa 5 ("Salvar por card" no Cadastro › Tecidos): o Sheet REAL do Radix (SheetContent +
// Dialog) com o `TecidoDetail` por dentro. Esc/overlay/X do Sheet NÃO podem fechar e perder rascunho de cor sem perguntar,
// e Esc numa cor suja desfaz SÓ aquela cor (o Radix fecha o Sheet no keydown em captura, antes do React).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createContext, createElement, useContext } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const COR_A = "aaaaaaaa-0000-4000-8000-000000000001";
const AP_A1 = "a1a1a1a1-0000-4000-8000-000000000011";
const V1 = "v1000000-0000-4000-8000-000000000001";
const V2 = "v2000000-0000-4000-8000-000000000002";
const variantes = () => [
  { id: V1, artigo_id: "art1", cor_id: COR_A, cor_apelido_id: AP_A1, nome_variante: "Malha", codigo_variante: "C1", preco: 10, foto_url: null, historico_precos: [] },
  { id: V2, artigo_id: "art1", cor_id: COR_A, cor_apelido_id: null, nome_variante: "Liso", codigo_variante: "C2", preco: 20, foto_url: null, historico_precos: [] },
];
const ARTIGO = {
  id: "art1", nome: "Tecido Teste", empresa_id: null, representante_id: null, largura_estimada: null, categoria_tecido_id: null,
  composicao: null, mes_id: null, ano_id: null, preco: 10, rendimento: null, preco_por_metro: null, unidade_medida: "metro",
  ncm: null, historico_precos: [], rev: 1,
};

const rpc = vi.fn(async () => ({ data: { afetados: 0, assinatura: "s" }, error: null }));
function chain(dados: () => unknown) {
  const c: any = {
    select: () => c, eq: () => c, order: () => c, update: () => c, insert: () => c, single: () => c, maybeSingle: () => c,
    then: (res: (v: unknown) => unknown) => res({ data: dados(), error: null }),
  };
  return c;
}
const supabaseMock = {
  rpc: (...a: unknown[]) => (rpc as any)(...a),
  from: (t: string) => chain(() =>
    t === "artigos" ? ARTIGO
    : t === "cores" ? [{ id: COR_A, nome: "Azul" }]
    : t === "cores_apelido" ? [{ id: AP_A1, nome: "Marinho", cor_base_id: COR_A }]
    : t === "variantes_tecido" ? variantes()
    : []),
  storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: vi.fn() }),
  removeChannel: vi.fn(),
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = (ms = 40) => act(async () => { await sleep(ms); });

async function montar() {
  vi.resetModules();
  vi.doMock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));
  vi.doMock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
  vi.doMock("@tanstack/react-router", () => ({
    createFileRoute: () => () => ({ useParams: () => ({ artigoId: "art1" }) }),
    Link: (p: any) => createElement("a", null, p.children),
    useNavigate: () => vi.fn(),
    useBlocker: () => ({ status: "idle" as const, proceed: vi.fn(), reset: vi.fn() }),
  }));
  vi.doMock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null, VARIANT_BUCKET: "variantes" }));
  vi.doMock("@/hooks/useColabRegistro", () => ({ useColabRegistro: () => ({ presentes: [] }) }));
  vi.doMock("@/components/shared/ColabPresenceOverlay", () => ({ ColabPresenceOverlay: () => null }));
  vi.doMock("@/components/shared/Breadcrumb", () => ({ Breadcrumb: () => null }));
  vi.doMock("@/components/shared/FornecedorSelect", () => ({ FornecedorSelect: () => null }));
  vi.doMock("@/components/shared/EtiquetaLavagemArtigo", () => ({ EtiquetaLavagemArtigoEditor: () => null }));
  vi.doMock("@/components/tecido/EnderecoEditor", () => ({ EnderecoConsolidadoEditor: () => null, useEnderecosRollup: () => ({ data: new Map() }) }));
  vi.doMock("@/components/ui/select", () => {
    const Ctx = createContext<{ onValueChange?: (v: string) => void }>({});
    return {
      Select: (p: any) => createElement(Ctx.Provider, { value: { onValueChange: p.onValueChange } }, createElement("div", { "data-select": "" }, p.children)),
      SelectTrigger: () => null, SelectValue: () => null,
      SelectContent: (p: any) => createElement("div", null, p.children),
      SelectItem: (p: any) => { const c = useContext(Ctx); return createElement("button", { type: "button", onClick: () => c.onValueChange?.(p.value) }, p.children); },
    };
  });
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { TecidoDetailSheet } = await import("@/routes/_authenticated/cadastro.tecidos.$artigoId");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(TecidoDetailSheet, { openId: "art1", onClose })));
  });
  // espera as cores carregarem (artigo -> form -> VariantesSection -> queries)
  for (let i = 0; i < 40 && document.querySelectorAll("ul > li").length < 2; i++) await flush(50);
  return { onClose, desmontar: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}

// O Sheet é portal no <body>: tudo é consultado em `document`.
const lis = () => Array.from(document.querySelectorAll("ul > li")) as HTMLElement[];
const clicar = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).click(); });
const expandir = (li: HTMLElement) => clicar(li.querySelector('[aria-label="Expandir"]'));
const campos = (li: HTMLElement) => Array.from(li.querySelectorAll("input:not([type=file])")) as HTMLInputElement[];
function digitar(el: HTMLInputElement, valor: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  return act(async () => { set.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const esc = (el: Element) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
const sheetAberto = () => !!document.querySelector('[role="dialog"]');
const dialogoDescartar = () => Array.from(document.querySelectorAll('[role="alertdialog"]')).find((d) => d.textContent?.includes("Descartar alterações?"));
const overlay = () => document.querySelector('[data-state="open"].fixed.inset-0') as HTMLElement | null;
const clicarFora = () => act(async () => {
  const o = overlay();
  o?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
  await sleep(10);
  o?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
  o?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
});

beforeEach(() => { rpc.mockClear(); document.body.innerHTML = ""; });

describe("TecidoDetailSheet — Esc/clique fora com cor suja (C1/C1b)", () => {
  it("(a) Esc dentro do campo de uma cor SUJA não fecha o Sheet e desfaz SÓ aquela cor (a outra suja segue)", async () => {
    const t = await montar();
    expect(sheetAberto()).toBe(true);
    const [li1, li2] = lis();
    await expandir(li1); await expandir(li2);
    await digitar(campos(li1)[0], "Outro nome");
    await digitar(campos(li2)[1], "X9");
    expect(li1.textContent).toContain("não salvo");
    expect(li2.textContent).toContain("não salvo");

    await esc(campos(li1)[0]);
    await flush();
    expect(sheetAberto()).toBe(true);          // não fechou
    expect(dialogoDescartar()).toBeUndefined(); // e nem perguntou: Esc numa cor suja = desfazer a cor
    expect(campos(li1)[0].value).toBe("Malha");
    expect(li1.textContent).not.toContain("não salvo");
    expect(li2.textContent).toContain("não salvo"); // a outra cor suja ficou intacta
    expect(campos(li2)[1].value).toBe("X9");
    expect(t.onClose).not.toHaveBeenCalled();
    await t.desmontar();
  });

  it("(b) Esc fora de card sujo / clique fora do Sheet com cor suja abre o diálogo 'Descartar' em vez de fechar direto", async () => {
    const t = await montar();
    const [li1] = lis();
    await expandir(li1);
    await digitar(campos(li1)[0], "Outro nome");
    // Esc com o foco no cabeçalho do Sheet (fora de qualquer card sujo) segue para a guarda
    await esc(document.querySelector("h1")!);
    await flush();
    expect(dialogoDescartar()).toBeTruthy();
    expect(t.onClose).not.toHaveBeenCalled();
    expect(sheetAberto()).toBe(true);

    // "Continuar editando" mantém tudo
    await clicar(Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Continuar editando"));
    await flush();
    expect(dialogoDescartar()).toBeUndefined();
    expect(li1.textContent).toContain("não salvo");

    // clique no overlay também pergunta
    await clicarFora();
    await flush();
    expect(dialogoDescartar()).toBeTruthy();
    expect(t.onClose).not.toHaveBeenCalled();

    // "Descartar" fecha de verdade
    await clicar(Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Descartar"));
    await flush();
    expect(t.onClose).toHaveBeenCalledTimes(1);
    await t.desmontar();
  });

  it("(c) sem cor suja, Esc e clique fora fecham normalmente (sem diálogo)", async () => {
    const t = await montar();
    await esc(document.querySelector("h1")!);
    await flush();
    expect(dialogoDescartar()).toBeUndefined();
    expect(t.onClose).toHaveBeenCalledTimes(1);
    await t.desmontar();

    const t2 = await montar();
    await clicarFora();
    await flush();
    expect(dialogoDescartar()).toBeUndefined();
    expect(t2.onClose).toHaveBeenCalledTimes(1);
    await t2.desmontar();
  });
});
