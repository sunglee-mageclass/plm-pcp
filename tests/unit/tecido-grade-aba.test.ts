// @vitest-environment happy-dom
// Grade "Lista tipo Excel" de Cadastro > Tecidos (Task 4): render de verdade da `TecidosGradeAba` com `supabase` mockado.
// Prova: 1 linha por cor (+ "sem cor"), editar só mexe no RASCUNHO (nada grava antes do Salvar), selo âmbar, o cabeçalho do
// tecido reflete em todas as cores, UM Salvar grava o tecido (CAS por rev) ANTES das cores, e o conflito de rev de um tecido
// não derruba as cores ("X salvos, Y com conflito"). O Select do Radix vira botões (a lógica testada é a da tela).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createContext, createElement, useContext } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type Linha = Record<string, any>;
const artigo = (id: string, extra: Linha = {}): Linha => ({
  id, nome: `Tecido ${id}`, empresa_id: null, representante_id: null, categoria_tecido_id: "cat1", composicao: null, ncm: null,
  largura_estimada: null, preco: 10, unidade_medida: "metro", rendimento: null, mes_id: null, ano_id: null, preco_por_metro: null,
  rev: 1, created_at: "2026-01-01", ...extra,
});
const variante = (id: string, artigoId: string, extra: Linha = {}): Linha => ({
  id, artigo_id: artigoId, cor_id: "cor1", cor_apelido_id: null, nome_variante: null, codigo_variante: null, preco: 10, foto_url: null,
  created_at: `2026-01-0${id.slice(-1)}`, ...extra,
});

const estado = {
  artigos: [] as Linha[], variantes: [] as Linha[], cats: [] as Linha[],
  conflitoArtigo: new Set<string>(), falhaTabela: null as string | null,
};
const ordem: string[] = [];
const artigoUpdates: Array<{ payload: Linha; rev: unknown; id: unknown }> = [];
const rpc = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

function chain(t: string) {
  let op = "select"; let payload: Linha = {}; const eqs: Record<string, unknown> = {};
  const c: any = {
    select: () => c, order: () => c, range: () => c,
    eq: (col: string, v: unknown) => { eqs[col] = v; return c; },
    update: (p: Linha) => { op = "update"; payload = p; return c; },
    then: (res: (v: unknown) => unknown) => {
      if (estado.falhaTabela === t) return res({ data: null, error: { message: "falhou" } });
      if (t === "artigos" && op === "update") {
        const id = eqs.id as string;
        if (estado.conflitoArtigo.has(id)) return res({ data: [], error: null });
        ordem.push(`artigos.update:${id}`); artigoUpdates.push({ payload, rev: eqs.rev, id });
        const a = estado.artigos.find((x) => x.id === id)!; Object.assign(a, payload, { rev: a.rev + 1 });
        return res({ data: [{ id, rev: a.rev }], error: null });
      }
      const dados: Record<string, Linha[]> = {
        artigos: estado.artigos.map((a) => ({ ...a })), variantes_tecido: estado.variantes.map((v) => ({ ...v })),
        artigo_categorias_tecido: estado.cats,
        categorias_tecido: [{ id: "cat1", nome: "Malha" }, { id: "cat2", nome: "Plano" }],
        subcategorias_tecido: [{ id: "sub1", nome: "Leve", categoria_tecido_id: "cat1" }],
        empresas: [{ id: "emp1", nome_fantasia: "Fornecedor 1" }],
        cores: [{ id: "cor1", nome: "Azul" }, { id: "cor2", nome: "Verde" }],
        cores_apelido: [{ id: "ap1", nome: "Marinho", cor_base_id: "cor1" }],
        meses: [{ id: "m1", mes: "Janeiro" }], anos: [{ id: "y1", ano: "2026" }],
      };
      return res({ data: dados[t] ?? [], error: null });
    },
  };
  return c;
}
const supabaseMock = {
  rpc: (...a: unknown[]) => rpc(...a),
  from: (t: string) => chain(t),
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: vi.fn() }),
  removeChannel: vi.fn(),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = (ms = 30) => act(async () => { await sleep(ms); });

function mocks() {
  vi.resetModules();
  vi.doMock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));
  vi.doMock("sonner", () => ({ toast }));
  vi.doMock("@tanstack/react-router", () => ({
    createFileRoute: () => () => ({ useParams: () => ({ artigoId: "x" }) }),
    Link: (p: any) => createElement("a", null, p.children),
    useNavigate: () => vi.fn(),
    useBlocker: () => ({ status: "idle" as const, proceed: vi.fn(), reset: vi.fn() }),
  }));
  vi.doMock("@/components/ui/sidebar", () => ({ useSidebar: () => ({ state: "expanded" }) }));
  vi.doMock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null, VARIANT_BUCKET: "variantes" }));
  vi.doMock("@/hooks/useColabRegistro", () => ({ useColabRegistro: () => ({ presentes: [] }) }));
  vi.doMock("@/components/shared/ColabPresenceOverlay", () => ({ ColabPresenceOverlay: () => null }));
  vi.doMock("@/components/shared/Breadcrumb", () => ({ Breadcrumb: () => null }));
  vi.doMock("@/components/shared/FornecedorSelect", () => ({ FornecedorSelect: () => null }));
  vi.doMock("@/components/shared/EtiquetaLavagemArtigo", () => ({ EtiquetaLavagemArtigoEditor: () => null }));
  vi.doMock("@/components/tecido/EnderecoEditor", () => ({ EnderecoConsolidadoEditor: () => null, useEnderecosRollup: () => ({ data: new Map() }) }));
  vi.doMock("@/components/ui/select", () => {
    const Ctx = createContext<{ onValueChange?: (v: string) => void; disabled?: boolean }>({});
    return {
      Select: (p: any) => createElement(Ctx.Provider, { value: { onValueChange: p.onValueChange, disabled: p.disabled } },
        createElement("div", { "data-select": "", "data-value": p.value ?? "" }, p.children)),
      SelectTrigger: (p: any) => createElement("span", { "aria-label": p["aria-label"] }),
      SelectValue: () => null,
      SelectContent: (p: any) => createElement("div", null, p.children),
      SelectItem: (p: any) => {
        const c = useContext(Ctx);
        return createElement("button", { type: "button", "data-item": p.value, disabled: c.disabled, onClick: () => c.onValueChange?.(p.value) }, p.children);
      },
    };
  });
}

async function montar(artigosProp: Linha[]) {
  mocks();
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { TecidosGradeAba } = await import("@/components/tecido/grade/TecidosGradeAba");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(TecidosGradeAba, { artigos: artigosProp as any })));
  });
  for (let i = 0; i < 40 && container.querySelectorAll("tbody tr").length === 0 && !container.querySelector("[role=alert]"); i++) await flush(30);
  await flush(30);
  return { container, qc, desmontar: async () => { await act(async () => { root.unmount(); }); container.remove(); document.body.innerHTML = ""; } };
}

const linhas = (c: HTMLElement) => Array.from(c.querySelectorAll("tbody tr")) as HTMLElement[];
const porLabel = (root: ParentNode, label: string) => Array.from(root.querySelectorAll(`[aria-label="${label}"]`)) as HTMLInputElement[];
function digitar(el: HTMLInputElement, valor: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  return act(async () => { set.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const clicar = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).click(); });
const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Salvar")) as HTMLButtonElement | undefined;
const selos = (c: HTMLElement) => c.querySelectorAll("[data-selo-nao-salvo]").length;
const salvaRpcs = () => rpc.mock.calls.filter((c) => c[0] === "salvar_variante_tecido");

beforeEach(() => {
  estado.artigos = [artigo("a1"), artigo("a2")];
  estado.variantes = [variante("v1", "a1"), variante("v2", "a1", { cor_id: "cor2" })]; // a2 sem cores
  estado.cats = [{ id: "l1", artigo_id: "a1", categoria_tecido_id: "cat1", subcategoria_tecido_id: null }];
  estado.conflitoArtigo = new Set(); estado.falhaTabela = null;
  ordem.length = 0; artigoUpdates.length = 0;
  rpc.mockReset(); rpc.mockImplementation(async (nome: string) => {
    if (nome === "salvar_variante_tecido") { ordem.push("rpc:variante"); return { error: null }; }
    if (nome === "set_artigo_categorias") { ordem.push("rpc:categorias"); return { error: null }; }
    if (nome === "variante_tecido_preco_previa") return { data: { afetados: 1, assinatura: "sig" }, error: null };
    return { error: null };
  });
  Object.values(toast).forEach((f) => f.mockReset());
});

const PROPS = () => estado.artigos.map((a) => ({ id: a.id }));

describe("TecidosGradeAba: grade editável com rascunho", () => {
  it("1 linha por cor + 1 linha 'sem cor' para o tecido sem variantes; cabeçalho do tecido repete por cor", async () => {
    const t = await montar(PROPS());
    const trs = linhas(t.container);
    expect(trs).toHaveLength(3); // a1 (2 cores) + a2 (sem cor)
    // o nome do tecido a1 aparece nas 2 linhas das cores
    expect(porLabel(trs[0], "Nome de Tecido a1")).toHaveLength(1);
    expect(porLabel(trs[1], "Nome de Tecido a1")).toHaveLength(1);
    expect(trs[2].textContent).toContain("—"); // sem cor
    expect(t.container.querySelectorAll("thead th").length).toBeGreaterThan(10); // thead pelo catálogo
    await t.desmontar();
  });

  it("editar NÃO grava nada; mostra o selo âmbar e reflete o nome do tecido em todas as cores", async () => {
    const t = await montar(PROPS());
    const trs = linhas(t.container);
    expect(selos(t.container)).toBe(0);
    expect(botaoSalvar()).toBeUndefined();
    await digitar(porLabel(trs[0], "Nome de Tecido a1")[0], "Malha Nova");
    // nada foi ao banco
    expect(artigoUpdates).toHaveLength(0);
    expect(rpc.mock.calls.filter((c) => c[0] !== "variante_tecido_preco_previa")).toHaveLength(0);
    expect(selos(t.container)).toBeGreaterThan(0);
    // a 2ª cor do mesmo tecido mostra o novo nome (cabeçalho repetido)
    expect((porLabel(linhas(t.container)[1], "Nome de Tecido a1")[0]).value).toBe("Malha Nova");
    expect(t.container.textContent).toContain("alterações não salvas");
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    await t.desmontar();
  });

  it("UM Salvar: grava o tecido (CAS por rev) ANTES das cores; só os campos tocados; MoneyInput vira número", async () => {
    const t = await montar(PROPS());
    let trs = linhas(t.container);
    await digitar(porLabel(trs[0], "Nome de Tecido a1")[0], "Malha Nova");
    await digitar(porLabel(trs[0], "Preço de Tecido a1")[0], "12,50"); // texto mascarado pt-BR -> 12.5, nunca NaN
    trs = linhas(t.container);
    await digitar(porLabel(trs[1], "Nome da variante da cor de Tecido a1")[0], "Verde bandeira");
    expect(botaoSalvar()?.textContent).toContain("Salvar (2)");

    await clicar(botaoSalvar());
    await flush(60);

    expect(artigoUpdates).toHaveLength(1);
    expect(artigoUpdates[0]).toMatchObject({ id: "a1", rev: 1, payload: { nome: "Malha Nova", preco: 12.5 } });
    expect(Object.keys(artigoUpdates[0].payload).sort()).toEqual(["nome", "preco"]); // só os tocados
    expect(salvaRpcs()).toHaveLength(1);
    expect(salvaRpcs()[0][1]).toMatchObject({ _id: "v2", _mudancas: { nome_variante: "Verde bandeira" }, _assinatura: null });
    expect(ordem.indexOf("artigos.update:a1")).toBeLessThan(ordem.indexOf("rpc:variante")); // tecido ANTES da cor
    expect(toast.success).toHaveBeenCalledWith("2 salvos.");
    await t.desmontar();
  });

  it("conflito de rev de UM tecido não derruba a cor: toast '1 salvo, 1 com conflito' e o tecido segue sujo", async () => {
    estado.conflitoArtigo.add("a1");
    const t = await montar(PROPS());
    let trs = linhas(t.container);
    await digitar(porLabel(trs[0], "Nome de Tecido a1")[0], "Malha Nova");
    trs = linhas(t.container);
    await digitar(porLabel(trs[1], "Nome da variante da cor de Tecido a1")[0], "Verde bandeira");
    await clicar(botaoSalvar());
    await flush(60);

    expect(artigoUpdates).toHaveLength(0); // 0 linhas no UPDATE com rev
    expect(salvaRpcs()).toHaveLength(1); // a cor gravou mesmo assim
    expect(toast.warning).toHaveBeenCalled();
    expect(String(toast.warning.mock.calls[0][0])).toContain("1 salvo, 1 com conflito");
    expect(t.container.querySelector("[data-erro-linha]")).not.toBeNull(); // aviso na linha do tecido
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)"); // só o tecido ficou sujo
    await t.desmontar();
  });

  it("select (Unidade) e CATEGORIAS (único popover: lista + subcategoria) vão ao rascunho do TECIDO e gravam no Salvar", async () => {
    const t = await montar(PROPS());
    const trs = linhas(t.container);
    // Unidade -> Kg: o Select do tecido está no <div data-select> logo depois do rótulo da coluna
    const selUnidade = (tr: HTMLElement) => Array.from(tr.querySelectorAll("[data-select]")).find((d) => d.querySelector('[aria-label="Unidade de Tecido a1"]')) as HTMLElement;
    await clicar(selUnidade(trs[0]).querySelector('[data-item="kg"]'));
    expect(selUnidade(linhas(t.container)[1]).getAttribute("data-value")).toBe("kg"); // reflete na outra cor do mesmo tecido
    expect(artigoUpdates).toHaveLength(0);

    // Categorias: abre o popover, marca "Plano" e escolhe a subcategoria de "Malha"
    const gatilho = porLabel(linhas(t.container)[0], "Categoria(s) de Tecido a1")[0];
    expect(gatilho.textContent).toContain("Malha");
    await clicar(gatilho);
    await flush(20);
    const caixas = Array.from(document.body.querySelectorAll('[role="checkbox"]')) as HTMLElement[];
    expect(caixas).toHaveLength(2); // Malha (marcada) e Plano
    await clicar(caixas[1]); // marca Plano
    await flush(20);
    const subMalha = document.body.querySelector('[data-testid="sub-cat-cat1"] [data-item="sub1"]');
    expect(subMalha).not.toBeNull();
    await clicar(subMalha);
    await flush(20);
    expect(gatilho.textContent).toContain("Malha › Leve");
    expect(gatilho.textContent).toContain("Plano");

    await clicar(botaoSalvar());
    await flush(60);
    expect(artigoUpdates[0].payload).toMatchObject({ unidade_medida: "kg", rendimento: null, categoria_tecido_id: "cat1" });
    const cat = rpc.mock.calls.find((c) => c[0] === "set_artigo_categorias")!;
    expect(cat[1]).toEqual({
      _artigo_id: "a1",
      _pares: [{ categoria_tecido_id: "cat1", subcategoria_tecido_id: "sub1" }, { categoria_tecido_id: "cat2", subcategoria_tecido_id: null }],
    });
    expect(ordem.indexOf("artigos.update:a1")).toBeLessThan(ordem.indexOf("rpc:categorias"));
    await t.desmontar();
  });

  it("desmarcar e marcar de novo a MESMA categoria não deixa o tecido sujo (referência da base)", async () => {
    const t = await montar(PROPS());
    const gatilho = porLabel(linhas(t.container)[0], "Categoria(s) de Tecido a1")[0];
    await clicar(gatilho);
    await flush(20);
    const malha = () => (Array.from(document.body.querySelectorAll('[role="checkbox"]')) as HTMLElement[])[0];
    await clicar(malha()); await flush(20); // desmarca
    expect(selos(t.container)).toBeGreaterThan(0);
    await clicar(malha()); await flush(20); // marca de novo
    expect(selos(t.container)).toBe(0);
    await t.desmontar();
  });

  it("preço da cor: pede a assinatura da prévia (leitura) e manda no Salvar", async () => {
    const t = await montar(PROPS());
    const trs = linhas(t.container);
    await digitar(porLabel(trs[0], "Preço da variante da cor de Tecido a1")[0], "15");
    expect(salvaRpcs()).toHaveLength(0);
    await clicar(botaoSalvar());
    await flush(60);
    expect(salvaRpcs()[0][1]).toMatchObject({ _id: "v1", _mudancas: { preco: 15 }, _assinatura: "sig" });
    await t.desmontar();
  });

  it("Descartar alterações volta tudo à base (com confirmação) e some o selo", async () => {
    const t = await montar(PROPS());
    const trs = linhas(t.container);
    await digitar(porLabel(trs[0], "Nome de Tecido a1")[0], "Malha Nova");
    const desc = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.includes("Descartar alterações")) as HTMLButtonElement;
    await clicar(desc);
    const confirmar = Array.from(document.body.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === "Descartar");
    await clicar(confirmar);
    expect((porLabel(linhas(t.container)[0], "Nome de Tecido a1")[0]).value).toBe("Tecido a1");
    expect(selos(t.container)).toBe(0);
    expect(botaoSalvar()).toBeUndefined();
    expect(artigoUpdates).toHaveLength(0);
    await t.desmontar();
  });

  it("isError honesto: aviso 'Não foi possível carregar' + Tentar de novo, sem tabela vazia enganosa", async () => {
    estado.falhaTabela = "variantes_tecido";
    const t = await montar(PROPS());
    expect(t.container.querySelector("[role=alert]")?.textContent).toContain("Não foi possível carregar");
    expect(Array.from(t.container.querySelectorAll("button")).some((b) => b.textContent === "Tentar de novo")).toBe(true);
    expect(t.container.querySelector("tbody")).toBeNull();
    await t.desmontar();
  });
});
