// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom (mesmo padrão de tecido-grade-aba.test.ts) */
// Grade "Lista tipo Excel" de Cadastro > Tecidos (Task 12): AGRUPAMENTO pai/filhos. Cada tecido = 1 linha-PAI (cabeçalho: só ela mostra e
// edita; chevron recolhe/expande as cores; lixeira = excluir o tecido) + 1 linha-FILHO por cor (só os campos da cor; lixeira = só a cor).
// Os tecidos NASCEM RECOLHIDOS (a lista abre só com os cabeçalhos). Cor recolhida segue montada: o Salvar a enxerga e o pai avisa.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createContext, createElement, useContext } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { expandirTudo } from "./tecido-grade-expandir";

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
    if (nome === "variante_tecido_preco_previa") return { data: { afetados: 1, assinatura: "sig" }, error: null };
    return { error: null };
  });
  Object.values(toast).forEach((f) => f.mockReset());
});

const PROPS = () => estado.artigos.map((a) => ({ id: a.id }));
const pais = (c: HTMLElement) => linhas(c).filter((r) => r.dataset.pai !== undefined);
const cores = (c: HTMLElement) => linhas(c).filter((r) => r.dataset.varianteId);
const chevron = (tr: HTMLElement) => tr.querySelector('[data-acao="alternar-cores"]') as HTMLButtonElement | null;
const lixeiras = (tr: HTMLElement) => Array.from(tr.querySelectorAll('button[data-acao^="excluir"]')) as HTMLButtonElement[];
/** Rótulos do CABEÇALHO do tecido (aria-label "<coluna> de <tecido>") e da COR ("<coluna> da cor de <tecido>"). */
const ROTULOS_CABECALHO = ["Nome", "Fornecedor", "Preço", "Unidade", "Largura estimada", "Composição", "NCM", "Rendimento", "Mês", "Ano", "Categoria(s)"];
const ROTULOS_COR = ["Cor base", "Cor apelido", "Nome da variante", "Código da variante", "Preço da variante"]; // + a Foto (célula própria, abaixo)

describe("Agrupamento pai/filhos", () => {
  it("a lista NASCE recolhida: só os cabeçalhos à vista (uma linha por tecido), com o chevron fechado; as cores existem mas escondidas", async () => {
    const t = await montar(PROPS());
    expect(pais(t.container)).toHaveLength(2);
    expect(cores(t.container)).toHaveLength(2);
    expect(cores(t.container).every((r) => r.hidden)).toBe(true);
    expect(pais(t.container).every((r) => !r.hidden)).toBe(true);
    const c = chevron(pais(t.container)[0])!;
    expect(c.getAttribute("aria-expanded")).toBe("false");
    expect(c.getAttribute("aria-label")).toBe("Expandir as cores de Tecido a1");
    expect(pais(t.container)[0].textContent).toContain("2 cores"); // o pai resume o que está escondido
    await t.desmontar();
  });

  it("a linha-PAI mostra e edita o cabeçalho; a linha-FILHO NÃO repete nenhum campo dele (e só tem os da cor)", async () => {
    const t = await montar(PROPS());
    const [pai] = pais(t.container);
    for (const r of ROTULOS_CABECALHO) expect(porLabel(pai, `${r} de Tecido a1`), `pai: ${r}`).toHaveLength(1);
    for (const r of ROTULOS_COR) expect(porLabel(pai, `${r} da cor de Tecido a1`), `pai sem ${r}`).toHaveLength(0);
    for (const filho of cores(t.container)) {
      for (const r of ROTULOS_CABECALHO) expect(porLabel(filho, `${r} de Tecido a1`), `filho sem ${r}`).toHaveLength(0);
      for (const r of ROTULOS_COR) expect(porLabel(filho, `${r} da cor de Tecido a1`), `filho: ${r}`).toHaveLength(1);
      expect(filho.querySelector('[data-col="foto"] [aria-label^="Inserir foto"]')).not.toBeNull(); // a foto é da cor
      expect(pai.querySelector('[data-col="foto"]')!.textContent).toBe(""); // e a do pai fica vazia
      expect(filho.querySelector('[data-col="nome"] input')).toBeNull();
      expect(filho.querySelector('[data-col="fornecedor"] [data-select]')).toBeNull();
    }
    await t.desmontar();
  });

  it("clicar no chevron expande e recolhe as cores DAQUELE tecido (o outro não muda)", async () => {
    const t = await montar(PROPS());
    const [pai] = pais(t.container);
    await clicar(chevron(pai));
    expect(cores(t.container).every((r) => !r.hidden)).toBe(true);
    expect(chevron(pai)!.getAttribute("aria-expanded")).toBe("true");
    expect(chevron(pai)!.getAttribute("aria-label")).toBe("Recolher as cores de Tecido a1");
    await clicar(chevron(pai));
    expect(cores(t.container).every((r) => r.hidden)).toBe(true);
    expect(chevron(pais(t.container)[1])).toBeNull(); // a2 não tem cores: sem chevron
    await t.desmontar();
  });

  it("clicar na LINHA-PAI (fora dos campos) também alterna; clicar num campo do pai NÃO alterna", async () => {
    const t = await montar(PROPS());
    const [pai] = pais(t.container);
    await clicar(pai.querySelector('td[data-col="ncm"]'));
    expect(cores(t.container).every((r) => !r.hidden)).toBe(true);
    await clicar(porLabel(pai, "NCM de Tecido a1")[0]); // dentro do campo: só foca
    await clicar(porLabel(pai, "Nome de Tecido a1")[0]);
    expect(cores(t.container).every((r) => !r.hidden)).toBe(true);
    await clicar(pai.querySelector('td[data-col="ncm"]'));
    expect(cores(t.container).every((r) => r.hidden)).toBe(true);
    await t.desmontar();
  });

  it("tecido SEM cores: só a linha-pai ('sem cores'), sem chevron; clicar nela não faz nada", async () => {
    const t = await montar(PROPS());
    const pai = pais(t.container)[1];
    expect(pai.textContent).toContain("sem cores");
    expect(chevron(pai)).toBeNull();
    await clicar(pai.querySelector('td[data-col="ncm"]'));
    expect(pai.hasAttribute("data-recolhido")).toBe(false);
    expect(linhas(t.container).filter((r) => r.dataset.artigoId === "a2")).toHaveLength(1);
    await t.desmontar();
  });

  it("UMA lixeira por linha: no pai exclui o tecido + cores, na cor exclui só a cor", async () => {
    const t = await montar(PROPS());
    await expandirTudo(t.container);
    for (const tr of linhas(t.container)) expect(lixeiras(tr), tr.dataset.slot).toHaveLength(1);
    expect(lixeiras(pais(t.container)[0])[0].getAttribute("aria-label")).toBe("Excluir o tecido Tecido a1 e todas as cores");
    expect(lixeiras(pais(t.container)[1])[0].getAttribute("aria-label")).toBe("Excluir o tecido Tecido a2 e todas as cores"); // sem cor: o pai também
    expect(cores(t.container).map((r) => lixeiras(r)[0].getAttribute("aria-label"))).toEqual([
      "Excluir a cor Azul de Tecido a1",
      "Excluir a cor Verde de Tecido a1",
    ]);
    expect(t.container.textContent).not.toContain("Excluir tecido"); // o botão de texto antigo saiu
    await t.desmontar();
  });

  it("cor com edição não salva ESCONDIDA: o pai avisa (selo próprio) e o Salvar grava a cor mesmo recolhida", async () => {
    const t = await montar(PROPS());
    const [pai] = pais(t.container);
    await clicar(chevron(pai)); // expande
    await digitar(porLabel(cores(t.container)[1], "Nome da variante da cor de Tecido a1")[0], "Verde bandeira");
    expect(pai.querySelector("[data-selo-filho-oculto]")).toBeNull(); // à vista: o selo da própria cor basta
    await clicar(chevron(pai)); // recolhe com a edição pendente
    expect(pai.querySelector("[data-selo-filho-oculto]")).not.toBeNull();
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");

    await clicar(botaoSalvar());
    await flush(60);
    expect(salvaRpcs()).toHaveLength(1);
    expect(salvaRpcs()[0][1]).toMatchObject({ _id: "v2", _mudancas: { nome_variante: "Verde bandeira" } });
    expect(pai.querySelector("[data-selo-filho-oculto]")).toBeNull();
    await t.desmontar();
  });

  it("cor escondida que NÃO salvou abre o tecido (o erro fica à vista)", async () => {
    rpc.mockImplementation(async (nome: string) => {
      if (nome === "variante_tecido_preco_previa") return { data: { afetados: 1, assinatura: "sig" }, error: null };
      if (nome === "salvar_variante_tecido") return { error: { message: "falhou ao salvar a cor" } };
      return { error: null };
    });
    const t = await montar(PROPS());
    const [pai] = pais(t.container);
    await clicar(chevron(pai));
    await digitar(porLabel(cores(t.container)[0], "Nome da variante da cor de Tecido a1")[0], "X");
    await clicar(chevron(pai)); // recolhe
    expect(cores(t.container).every((r) => r.hidden)).toBe(true);
    await clicar(botaoSalvar());
    await flush(60);
    expect(cores(t.container).every((r) => !r.hidden)).toBe(true); // abriu sozinho
    expect(chevron(pai)!.getAttribute("aria-expanded")).toBe("true");
    expect(cores(t.container)[0].querySelector("[data-erro-linha]")).not.toBeNull();
    await t.desmontar();
  });

  it("cor NOVA (rascunho) de um tecido recolhido continua à vista: rascunho nunca fica escondido", async () => {
    const t = await montar(PROPS());
    const [pai] = pais(t.container);
    expect(cores(t.container).every((r) => r.hidden)).toBe(true);
    await clicar(porLabel(pai, "Adicionar cor em Tecido a1")[0]); // "+ cor" na linha-pai
    const nova = t.container.querySelector("[data-linha-nova]") as HTMLElement;
    expect(nova).not.toBeNull();
    expect(nova.hidden).toBe(false);
    expect(t.container.querySelector("[data-recolhido]")).not.toBeNull(); // o tecido segue recolhido
    await t.desmontar();
  });
});
