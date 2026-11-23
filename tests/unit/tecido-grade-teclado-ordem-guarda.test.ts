// @vitest-environment happy-dom
// Grade "Lista tipo Excel" de Cadastro > Tecidos (Task 6): TECLADO (Enter/Tab), ORDENAÇÃO por coluna e GUARDA do rascunho na troca
// de visão/filtro. Render de verdade da `TecidosGradeAba` com `supabase` mockado (mesmo molde de `tecido-grade-aba.test.ts`).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { expandirTudo } from "./tecido-grade-expandir";
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


type Montado = { container: HTMLElement; qc: any; desmontar: () => Promise<void> };

/** Monta a Aba sozinha (`extra` = props opcionais, ex.: onDirtyChange) ou um `Harness` próprio que a envolve. */
async function montar(artigosProp: Linha[], extra: Record<string, unknown> = {}): Promise<Montado> {
  mocks();
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { TecidosGradeAba } = await import("@/components/tecido/grade/TecidosGradeAba");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(TecidosGradeAba, { artigos: artigosProp as any, ...extra })));
  });
  await esperarLinhas(container);
  return { container, qc, desmontar: async () => { await act(async () => { root.unmount(); }); container.remove(); document.body.innerHTML = ""; } };
}

async function esperarLinhas(container: HTMLElement) {
  for (let i = 0; i < 40 && container.querySelectorAll("tbody tr").length === 0 && !container.querySelector("[role=alert]"); i++) await flush(30);
  await flush(30);
  await expandirTudo(container); // a lista nasce com os tecidos recolhidos: o teclado só alcança as cores à vista
}

/** Tela-mãe mínima: a MESMA guarda do index (`useGuardaTrocaLista`) ligada a um toggle Cards|Lista e a um filtro. */
async function montarTela(artigosProp: Linha[]) {
  mocks();
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { TecidosGradeAba } = await import("@/components/tecido/grade/TecidosGradeAba");
  const { useGuardaTrocaLista } = await import("@/components/tecido/grade/useGuardaTrocaLista");
  const { useState } = await import("react");
  const trocas: string[] = [];
  function Tela() {
    const [visao, setVisao] = useState<"cards" | "lista">("lista");
    const [filtro, setFiltro] = useState<string[]>([]);
    const guarda = useGuardaTrocaLista();
    const visiveis = filtro.length ? artigosProp.filter((a) => filtro.includes(a.id)) : artigosProp;
    return createElement("div", null,
      createElement("button", { "data-test": "cards", onClick: guarda.proteger(() => { trocas.push("cards"); setVisao("cards"); }) }, "Cards"),
      createElement("button", { "data-test": "so-a2", onClick: guarda.proteger(() => { trocas.push("filtro"); setFiltro(["a2"]); }) }, "Só a2"),
      // "Limpar filtros" do FilterButton chama o onChange de CADA filtro no mesmo clique: duas ações guardadas de uma vez
      createElement("button", { "data-test": "limpar", onClick: () => { guarda.proteger(() => { trocas.push("limpa-1"); setFiltro([]); })(); guarda.proteger(() => { trocas.push("limpa-2"); })(); } }, "Limpar"),
      createElement("span", { "data-test": "visao" }, visao),
      visao === "lista" ? createElement(TecidosGradeAba, { artigos: visiveis as any, onDirtyChange: guarda.aoMudarSujo }) : createElement("p", null, "CARDS"),
      guarda.dialog);
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Tela))); });
  await esperarLinhas(container);
  return { container, trocas, desmontar: async () => { await act(async () => { root.unmount(); }); container.remove(); document.body.innerHTML = ""; } };
}

const linhas = (c: HTMLElement) => Array.from(c.querySelectorAll("tbody tr")) as HTMLElement[];
const porLabel = (root: ParentNode, label: string) => Array.from(root.querySelectorAll(`[aria-label="${label}"]`)) as HTMLInputElement[];
function digitar(el: HTMLInputElement, valor: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  return act(async () => { set.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const clicar = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).click(); });
const botaoTexto = (t: string, raiz: ParentNode = document.body) => Array.from(raiz.querySelectorAll("button")).find((b) => b.textContent?.trim() === t) as HTMLButtonElement | undefined;
const celulas = (raiz: ParentNode) => Array.from(raiz.querySelectorAll("[data-grade-cel]")) as HTMLElement[];
const cel = (raiz: ParentNode, id: string) => raiz.querySelector(`[data-grade-cel="${id}"]`) as HTMLInputElement | null;
async function tecla(el: HTMLElement, key: string, shiftKey = false) {
  el.focus();
  const ev = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  await act(async () => { el.dispatchEvent(ev); });
  await flush(40); // resolve o requestAnimationFrame do foco
  return ev;
}
/** Linhas (data-artigo-id) na ordem da tela: o tecido (linha-pai) e, logo abaixo, cada cor dele (`<artigo>/<variante>`). */
const ordemTela = (c: HTMLElement) => linhas(c).filter((tr) => tr.dataset.artigoId).map((tr) => `${tr.dataset.artigoId}${tr.dataset.varianteId ? `/${tr.dataset.varianteId}` : ""}`);
const cabecalho = (c: HTMLElement, rotulo: string) => Array.from(c.querySelectorAll("thead th button")).find((b) => b.textContent?.trim() === rotulo) as HTMLButtonElement | undefined;
/** Nome de cada TECIDO na tela (o cabeçalho só existe na linha-pai; as cores não têm o campo Nome). */
const nomesNaTela = (c: HTMLElement) => linhas(c).filter((tr) => tr.dataset.pai !== undefined).map((tr) => (tr.querySelector('[data-col="nome"] input') as HTMLInputElement).value);

beforeEach(() => {
  estado.artigos = [artigo("a1", { nome: "Zeta" }), artigo("a2", { nome: "Alfa", preco: 30 }), artigo("a3", { nome: "Meio", preco: 20 })];
  // a1 tem 2 cores (Verde antes de Azul no servidor), a2 tem 1, a3 nenhuma
  estado.variantes = [variante("v1", "a1", { cor_id: "cor2" }), variante("v2", "a1", { cor_id: "cor1" }), variante("v3", "a2", { cor_id: "cor1" })];
  estado.cats = [];
  estado.conflitoArtigo = new Set(); estado.falhaTabela = null;
  ordem.length = 0; artigoUpdates.length = 0;
  rpc.mockReset(); rpc.mockImplementation(async () => ({ error: null }));
  Object.values(toast).forEach((f) => f.mockReset());
});

const PROPS = () => estado.artigos.map((a) => ({ id: a.id }));

describe("TecidosGradeAba: teclado (Enter/Tab)", () => {
  it("toda célula de digitação ganha data-grade-cel com a linha GLOBAL da tela; Select/categorias/foto ficam de fora", async () => {
    const t = await montar(PROPS());
    const trs = linhas(t.container);
    expect(trs).toHaveLength(6); // a1: pai + 2 cores; a2: pai + 1 cor; a3 (sem cor): só o pai
    trs.forEach((tr, i) => {
      const cs = celulas(tr);
      expect(cs.length).toBeGreaterThan(0);
      // a linha do endereço = posição da <tr> na tela (contínua entre os tecidos; a linha-pai conta como uma linha)
      cs.forEach((c) => expect(c.getAttribute("data-grade-cel")!.startsWith(`${i}:`)).toBe(true));
    });
    // colunas = posição em COLUNAS_TECIDO: Nome 0, Preço 2, Composição 5, NCM 6, Nome da variante 13
    expect(cel(trs[0], "0:0")?.getAttribute("aria-label")).toBe("Nome de Zeta");
    expect(cel(trs[0], "0:2")?.getAttribute("aria-label")).toBe("Preço de Zeta");
    expect(cel(trs[4], "4:13")?.getAttribute("aria-label")).toBe("Nome da variante da cor de Alfa");
    // controles que não são campo de digitação: sem endereço (o foco pula por cima)
    for (const rotulo of ["Fornecedor de Zeta", "Unidade de Zeta", "Categoria(s) de Zeta"]) {
      const el = porLabel(trs[0], rotulo)[0];
      expect(el, rotulo).toBeTruthy();
      expect(el.hasAttribute("data-grade-cel"), rotulo).toBe(false);
    }
    const selCorBase = porLabel(trs[1], "Cor base da cor de Zeta")[0];
    expect(selCorBase).toBeTruthy();
    expect(selCorBase.hasAttribute("data-grade-cel")).toBe(false);
    // o cabeçalho só tem célula na linha-pai (colunas 0..10) e a cor só nas colunas da cor (13..15): nunca misturam
    const colunasDe = (tr: HTMLElement) => celulas(tr).map((c) => Number(c.getAttribute("data-grade-cel")!.split(":")[1]));
    for (const i of [0, 3, 5]) expect(colunasDe(trs[i]).every((n) => n <= 10), `pai ${i}`).toBe(true);
    for (const i of [1, 2, 4]) expect(colunasDe(trs[i]).every((n) => [13, 14, 15].includes(n)), `cor ${i}`).toBe(true);
    await t.desmontar();
  });

  it("Enter desce na mesma coluna, atravessando de um tecido para o outro", async () => {
    const t = await montar(PROPS());
    // Nome só existe na linha-pai: desce por cima das cores de Zeta direto para o Nome do tecido de baixo
    await tecla(cel(t.container, "0:0")!, "Enter");
    expect(document.activeElement).toBe(cel(t.container, "3:0")); // Nome de Alfa (outro tecido)
    // Nome da variante: desce de cor em cor e, ao acabar as cores de um tecido, atravessa para as do próximo (pulando a linha-pai)
    await tecla(cel(t.container, "1:13")!, "Enter");
    expect(document.activeElement).toBe(cel(t.container, "2:13")); // 2ª cor de Zeta
    await tecla(cel(t.container, "2:13")!, "Enter");
    expect(document.activeElement).toBe(cel(t.container, "4:13")); // cor de Alfa (outro tecido)
    await t.desmontar();
  });

  it("Tab anda para o lado e PULA o Select; célula desabilitada (Rendimento em metro) também fica de fora", async () => {
    const t = await montar(PROPS());
    // Nome(0) -> Fornecedor(1) é Select: cai direto no Preço(2)
    await tecla(cel(t.container, "0:0")!, "Tab");
    expect(document.activeElement).toBe(cel(t.container, "0:2"));
    // NCM(6) -> Rendimento(7) está desabilitado (metro), 8..12 são Select/categorias e a linha-pai não tem as colunas da cor:
    // o Tab segue para a 1ª cor (linha de baixo), no Nome da variante(13)
    expect(cel(t.container, "0:7")!.disabled).toBe(true);
    await tecla(cel(t.container, "0:6")!, "Tab");
    expect(document.activeElement).toBe(cel(t.container, "1:13"));
    // Shift+Tab volta
    await tecla(cel(t.container, "1:13")!, "Tab", true);
    expect(document.activeElement).toBe(cel(t.container, "0:6"));
    await t.desmontar();
  });

  it("Enter na Composição (várias linhas) NÃO navega; Tab sim", async () => {
    const t = await montar(PROPS());
    const comp = cel(t.container, "0:5")!;
    expect(comp.tagName).toBe("TEXTAREA");
    const ev = await tecla(comp, "Enter");
    expect(ev.defaultPrevented).toBe(false); // o Enter segue como quebra de linha
    expect(document.activeElement).toBe(comp);
    await tecla(comp, "Tab");
    expect(document.activeElement).toBe(cel(t.container, "0:6"));
    await t.desmontar();
  });

  it("linhas NOVAS entram na contagem, depois das cadastradas, e o Enter chega nelas", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo tecido", t.container));
    await flush(20);
    const nova = cel(t.container, "6:0"); // 6 linhas cadastradas (0..5: pais e cores) -> a nova é a 6
    expect(nova).toBeTruthy();
    expect(nova!.getAttribute("aria-label")).toBe("Nome do tecido novo");
    await tecla(cel(t.container, "5:0")!, "Enter"); // última linha cadastrada (o pai de Meio, sem cor) -> desce para a nova
    expect(document.activeElement).toBe(nova);
    await t.desmontar();
  });
});

describe("TecidosGradeAba: ordenação por coluna", () => {
  it("sem clique = a ordem do servidor; as cores de um tecido não se espalham", async () => {
    const t = await montar(PROPS());
    expect(ordemTela(t.container)).toEqual(["a1", "a1/v1", "a1/v2", "a2", "a2/v3", "a3"]);
    await t.desmontar();
  });

  it("clicar em Nome ordena os TECIDOS (asc, depois desc) e mantém as cores do tecido juntas, na ordem de antes", async () => {
    const t = await montar(PROPS());
    await clicar(cabecalho(t.container, "Nome"));
    expect(nomesNaTela(t.container)).toEqual(["Alfa", "Meio", "Zeta"]);
    expect(ordemTela(t.container)).toEqual(["a2", "a2/v3", "a3", "a1", "a1/v1", "a1/v2"]); // cores de Zeta: mesma ordem do servidor
    expect(t.container.querySelector('thead th[aria-sort="ascending"]')?.textContent).toContain("Nome");
    await clicar(cabecalho(t.container, "Nome"));
    expect(nomesNaTela(t.container)).toEqual(["Zeta", "Meio", "Alfa"]);
    expect(ordemTela(t.container)).toEqual(["a1", "a1/v1", "a1/v2", "a3", "a2", "a2/v3"]);
    await t.desmontar();
  });

  it("número ordena como número; vazio vai sempre para o fim", async () => {
    const t = await montar(PROPS()); // preços: Zeta 10, Alfa 30, Meio 20
    await clicar(cabecalho(t.container, "Preço"));
    expect(nomesNaTela(t.container)).toEqual(["Zeta", "Meio", "Alfa"]);
    await clicar(cabecalho(t.container, "Preço"));
    expect(nomesNaTela(t.container)).toEqual(["Alfa", "Meio", "Zeta"]);
    await t.desmontar();
  });

  it("coluna da COR ordena as cores DENTRO do tecido, pelo NOME da cor (não pelo id), e o tecido sem cor vai para o fim", async () => {
    const t = await montar(PROPS());
    await clicar(cabecalho(t.container, "Cor base")); // Azul (cor1) < Verde (cor2)
    // Zeta: Verde(v1) e Azul(v2) -> Azul antes; ambos os tecidos têm Azul primeiro (empate: ordem do servidor); a3 sem cor por último
    expect(ordemTela(t.container)).toEqual(["a1", "a1/v2", "a1/v1", "a2", "a2/v3", "a3"]);
    await clicar(cabecalho(t.container, "Cor base")); // desc: Verde primeiro dentro de Zeta; tecido pela maior cor
    expect(ordemTela(t.container)).toEqual(["a1", "a1/v1", "a1/v2", "a2", "a2/v3", "a3"]);
    await t.desmontar();
  });

  it("ordena pelo valor SALVO: digitar no nome NÃO faz a linha pular", async () => {
    const t = await montar(PROPS());
    await clicar(cabecalho(t.container, "Nome"));
    const antes = ordemTela(t.container);
    await digitar(porLabel(linhas(t.container)[0], "Nome de Alfa")[0], "Zzz Novo"); // passaria de Zeta se ordenasse pelo rascunho
    expect(ordemTela(t.container)).toEqual(antes);
    expect(nomesNaTela(t.container)[0]).toBe("Zzz Novo");
    await t.desmontar();
  });

  it("o teclado segue a ordem da TELA depois de ordenar (Enter desce para o tecido que está embaixo)", async () => {
    const t = await montar(PROPS());
    await clicar(cabecalho(t.container, "Nome")); // Alfa, Meio, Zeta, Zeta
    // tela: [Alfa, cor v3, Meio, Zeta, v1, v2]: o Enter no Nome de Alfa pula a cor (sem Nome) e cai no Nome de Meio
    await tecla(cel(t.container, "0:0")!, "Enter");
    expect(document.activeElement).toBe(cel(t.container, "2:0"));
    expect((document.activeElement as HTMLInputElement).value).toBe("Meio");
    await t.desmontar();
  });

  it("a coluna Foto não ordena e a 1ª coluna segue FIXA (sticky) no cabeçalho", async () => {
    const t = await montar(PROPS());
    expect(cabecalho(t.container, "Foto")).toBeUndefined();
    const nome = Array.from(t.container.querySelectorAll("thead th")).find((th) => th.textContent?.trim() === "Nome") as HTMLElement;
    expect(nome.className).toContain("sticky");
    expect(nome.className).toContain("left-10");
    await t.desmontar();
  });
});

describe("Guarda do rascunho na troca de visão/filtro", () => {
  const dialogo = () => document.body.querySelector('[role="alertdialog"]');
  const botaoDialogo = (txt: string) => Array.from(document.body.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === txt) as HTMLButtonElement | undefined;

  it("SEM rascunho: trocar para Cards e filtrar são diretos (sem pergunta)", async () => {
    const t = await montarTela(PROPS());
    await clicar(t.container.querySelector('[data-test="so-a2"]'));
    expect(dialogo()).toBeNull();
    expect(t.trocas).toEqual(["filtro"]);
    await clicar(t.container.querySelector('[data-test="cards"]'));
    expect(dialogo()).toBeNull();
    expect(t.container.querySelector('[data-test="visao"]')?.textContent).toBe("cards");
    await t.desmontar();
  });

  it("COM rascunho sujo: pede confirmação; Cancelar mantém a Lista e o rascunho; Confirmar troca e descarta", async () => {
    const t = await montarTela(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "Nome de Zeta")[0], "Zeta editado");
    await clicar(t.container.querySelector('[data-test="cards"]'));
    await flush(30);
    expect(dialogo()).not.toBeNull();
    expect(dialogo()!.textContent).toContain("Descartar alterações?");
    expect(t.container.querySelector('[data-test="visao"]')?.textContent).toBe("lista"); // ainda não trocou

    // Continuar editando = fica na Lista, com o rascunho intacto
    await clicar(botaoDialogo("Continuar editando"));
    await flush(30);
    expect(dialogo()).toBeNull();
    expect(t.trocas).toEqual([]);
    expect(t.container.querySelector('[data-test="visao"]')?.textContent).toBe("lista");
    expect((porLabel(linhas(t.container)[0], "Nome de Zeta")[0]).value).toBe("Zeta editado");

    // Descartar = troca para Cards
    await clicar(t.container.querySelector('[data-test="cards"]'));
    await flush(30);
    await clicar(botaoDialogo("Descartar"));
    await flush(30);
    expect(t.trocas).toEqual(["cards"]);
    expect(t.container.querySelector('[data-test="visao"]')?.textContent).toBe("cards");
    expect(t.container.textContent).toContain("CARDS");
    // a grade saiu da tela: o aviso de "sujo" voltou a limpo (voltar a Lista e trocar de novo NÃO pergunta)
    await t.desmontar();
  });

  it("filtro com rascunho sujo também pergunta (a grade esconderia o tecido editado)", async () => {
    const t = await montarTela(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "Nome de Zeta")[0], "Zeta editado");
    await clicar(t.container.querySelector('[data-test="so-a2"]'));
    await flush(30);
    expect(dialogo()).not.toBeNull();
    expect(nomesNaTela(t.container)).toContain("Zeta editado"); // nada mudou ainda
    await clicar(botaoDialogo("Continuar editando"));
    await flush(30);
    expect(t.trocas).toEqual([]);
    expect(nomesNaTela(t.container)).toContain("Zeta editado");
    await t.desmontar();
  });

  it("2 mudanças disparadas juntas (Limpar filtros) = UMA pergunta e as duas valem ao confirmar", async () => {
    const t = await montarTela(PROPS());
    await clicar(t.container.querySelector('[data-test="so-a2"]')); // sem rascunho: filtra direto
    await digitar(porLabel(linhas(t.container)[0], "Nome de Alfa")[0], "Alfa editado");
    await clicar(t.container.querySelector('[data-test="limpar"]')); // 2 ações guardadas no mesmo clique
    await flush(30);
    expect(document.body.querySelectorAll('[role="alertdialog"]')).toHaveLength(1);
    expect(t.trocas).toEqual(["filtro"]); // nenhuma das duas rodou ainda
    await clicar(botaoDialogo("Descartar"));
    await flush(30);
    // as DUAS rodaram, na ordem (sem a fila, o 2º pedido trocava o 1º e só a última valeria)
    expect(t.trocas).toEqual(["filtro", "limpa-1", "limpa-2"]);
    await esperarLinhas(t.container);
    expect(nomesNaTela(t.container)).toHaveLength(3); // o filtro saiu: voltaram os 3 tecidos
    await t.desmontar();
  });

  it("a Aba avisa onDirtyChange(true) ao editar, (false) ao descartar e (false) ao desmontar", async () => {
    const avisos: boolean[] = [];
    const t = await montar(PROPS(), { onDirtyChange: (v: boolean) => avisos.push(v) });
    expect(avisos.at(-1)).toBe(false);
    await digitar(porLabel(linhas(t.container)[0], "Nome de Zeta")[0], "Zeta editado");
    expect(avisos.at(-1)).toBe(true);
    await t.desmontar();
    expect(avisos.at(-1)).toBe(false);
  });
});

describe("Tela de Tecidos: a guarda está ligada ao toggle e aos filtros (asserção de fonte)", () => {
  it("toggle Cards, busca e os 2 filtros passam por guarda.proteger; a Aba recebe onDirtyChange", async () => {
    const fs = await import("node:fs");
    const fonte = fs.readFileSync("src/routes/_authenticated/cadastro.tecidos.index.tsx", "utf8");
    expect(fonte).toContain('onClick={guarda.proteger(() => setVisaoPref(["cards"]))}');
    expect(fonte).toContain("onChange={guarda.proteger(setSearch)}");
    expect(fonte).toContain("onChange: guarda.proteger(setEmpresaFilter)");
    expect(fonte).toContain("onChange: guarda.proteger(setCatFilter)");
    expect(fonte).toContain("onDirtyChange={guarda.aoMudarSujo}");
    expect(fonte).toContain("{guarda.dialog}");
  });
});
