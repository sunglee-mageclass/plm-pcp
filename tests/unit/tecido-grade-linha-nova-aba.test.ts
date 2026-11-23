// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom (mesmo padrão de tecido-grade-aba.test.ts) */
// Grade "Lista tipo Excel" de Cadastro > Tecidos (Task 7): CRIAR na grade. Render real da `TecidosGradeAba` com `supabase` mockado.
// Prova: "+ Novo tecido" é RASCUNHO (nada grava antes do Salvar), "+ adicionar variante (cor)" herda o cabeçalho ("↳ mesmo tecido"),
// UM Salvar manda cada grupo VÁLIDO por `importar_tecido_linha` (depois dos editados), pendente fica em vermelho sem travar os
// válidos, grupo gravado some do rascunho, e "+ cor" em tecido existente usa `_artigo_alvo_id`.
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

const novoGrupos = (c: HTMLElement) => Array.from(c.querySelectorAll("[data-linha-nova]")) as HTMLElement[];
const botaoTexto = (txt: string, raiz: ParentNode = document.body) =>
  Array.from(raiz.querySelectorAll("button")).find((b) => b.textContent?.includes(txt)) as HTMLButtonElement | undefined;
/** Escolhe `valor` no Select (mockado em botões) cujo gatilho tem o aria-label dado, dentro de `raiz`. */
function escolher(raiz: ParentNode, label: string, valor: string) {
  const sel = Array.from(raiz.querySelectorAll("[data-select]")).find((d) => d.querySelector(`[aria-label="${label}"]`)) as HTMLElement;
  return clicar(sel.querySelector(`[data-item="${valor}"]`));
}
const importarRpcs = () => rpc.mock.calls.filter((c) => c[0] === "importar_tecido_linha");
let contaNovo = 0;

beforeEach(() => {
  estado.artigos = [artigo("a1"), artigo("a2")];
  estado.variantes = [variante("v1", "a1"), variante("v2", "a1", { cor_id: "cor2" })];
  estado.cats = [{ id: "l1", artigo_id: "a1", categoria_tecido_id: "cat1", subcategoria_tecido_id: null }];
  estado.conflitoArtigo = new Set(); estado.falhaTabela = null;
  ordem.length = 0; artigoUpdates.length = 0; contaNovo = 0;
  rpc.mockReset(); rpc.mockImplementation(async (nome: string, args: any) => {
    if (nome === "salvar_variante_tecido") { ordem.push("rpc:variante"); return { error: null }; }
    if (nome === "set_artigo_categorias") { ordem.push("rpc:categorias"); return { error: null }; }
    if (nome === "variante_tecido_preco_previa") return { data: { afetados: 1, assinatura: "sig" }, error: null };
    if (nome === "importar_tecido_linha") {
      ordem.push(`rpc:importar:${args._cabecalho.nome}`);
      if (args._artigo_alvo_id) return { data: { artigo_id: args._artigo_alvo_id, acao: "complementado" }, error: null };
      const id = `n${++contaNovo}`;
      estado.artigos.push(artigo(id, { nome: args._cabecalho.nome }));
      return { data: { artigo_id: id, acao: "criado" }, error: null };
    }
    return { error: null };
  });
  Object.values(toast).forEach((f) => f.mockReset());
});

const PROPS = () => estado.artigos.map((a) => ({ id: a.id }));

describe("TecidosGradeAba: criar tecido/cor na grade", () => {
  it("'+ Novo tecido' cria linha em RASCUNHO: nada vai ao servidor e aparece o selo + 'Salvar (1)'", async () => {
    const t = await montar(PROPS());
    expect(botaoSalvar()).toBeUndefined();
    await clicar(botaoTexto("Novo tecido"));
    expect(novoGrupos(t.container)).toHaveLength(1);
    expect(t.container.querySelectorAll("[data-selo-novo]")).toHaveLength(1);
    expect(importarRpcs()).toHaveLength(0);
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)");
    await t.desmontar();
  });

  it("'+ adicionar variante (cor)' herda o cabeçalho ('↳ mesmo tecido'); UM Salvar manda UMA chamada com as 2 cores e limpa o rascunho", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo tecido"));
    await digitar(porLabel(t.container, "Nome do tecido novo")[0], "Malha Fiore");
    await digitar(porLabel(t.container, "Preço do tecido novo")[0], "28,00");
    await escolher(t.container, "Cor base da cor 1 do tecido novo", "cor1");
    await clicar(botaoTexto("adicionar variante (cor)", t.container));
    const linhasNovas = novoGrupos(t.container);
    expect(linhasNovas).toHaveLength(2);
    expect(linhasNovas[1].textContent).toContain("↳ mesmo tecido");
    expect(porLabel(linhasNovas[1], "Nome do tecido novo")).toHaveLength(0); // cabeçalho não repete como campo
    await escolher(linhasNovas[1], "Cor base da cor 2 do tecido novo", "cor2");
    expect(importarRpcs()).toHaveLength(0); // ainda rascunho

    await clicar(botaoSalvar());
    await flush(80);

    expect(importarRpcs()).toHaveLength(1);
    const args = importarRpcs()[0][1];
    expect(args._artigo_alvo_id).toBeNull();
    expect(args._cabecalho).toMatchObject({ nome: "Malha Fiore", preco: 28, unidade_medida: "metro" });
    expect(args._variantes.map((v: any) => v.cor_id)).toEqual(["cor1", "cor2"]);
    expect(args._categoria_ids).toEqual([]);
    expect(toast.success).toHaveBeenCalledWith("1 salvo.");
    expect(novoGrupos(t.container)).toHaveLength(0); // gravado: sai do rascunho
    expect(botaoSalvar()).toBeUndefined(); // sem 2º Salvar que reenvie
    await t.desmontar();
  });

  it("linha pendente (sem nome/cor) fica em VERMELHO e não trava a válida: 'resultado parcial'", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo tecido"));
    await clicar(botaoTexto("Novo tecido"));
    const g = () => novoGrupos(t.container);
    // 1º grupo completo; 2º fica em branco
    await digitar(porLabel(g()[0], "Nome do tecido novo")[0], "Tecido Bom");
    await escolher(g()[0], "Cor base da cor 1 do tecido novo", "cor1");
    // antes de tentar salvar, a linha em branco NÃO grita
    expect(t.container.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);

    await clicar(botaoSalvar());
    await flush(80);

    expect(importarRpcs()).toHaveLength(1);
    expect(importarRpcs()[0][1]._cabecalho.nome).toBe("Tecido Bom");
    expect(toast.warning).toHaveBeenCalled();
    const msg = String(toast.warning.mock.calls[0][0]);
    expect(msg).toContain("1 salvo.");
    expect(msg).toContain("1 linha nova pendente");
    expect(g()).toHaveLength(1); // só a pendente ficou
    const nome = porLabel(g()[0], "Nome do tecido novo")[0];
    expect(nome.getAttribute("aria-invalid")).toBe("true"); // célula em vermelho
    expect(nome.getAttribute("title")).toBe("nome obrigatório");
    expect(t.container.querySelector("[data-erro-linha]")).not.toBeNull();
    await t.desmontar();
  });

  it("editados vão ANTES dos novos no mesmo Salvar (e somam no toast)", async () => {
    const t = await montar(PROPS());
    await digitar(porLabel(linhas(t.container)[0], "Nome de Tecido a1")[0], "Malha Nova");
    await clicar(botaoTexto("Novo tecido"));
    await digitar(porLabel(t.container, "Nome do tecido novo")[0], "Tecido Z");
    await escolher(t.container, "Cor base da cor 1 do tecido novo", "cor1");
    expect(botaoSalvar()?.textContent).toContain("Salvar (2)");
    await clicar(botaoSalvar());
    await flush(80);
    expect(ordem.indexOf("artigos.update:a1")).toBeLessThan(ordem.indexOf("rpc:importar:Tecido Z"));
    expect(toast.success).toHaveBeenCalledWith("2 salvos.");
    await t.desmontar();
  });

  it("'+ cor' em tecido EXISTENTE: chama a RPC com _artigo_alvo_id e cabeçalho só com o nome (não troca a unidade)", async () => {
    const t = await montar(PROPS());
    await clicar(t.container.querySelector('[aria-label="Adicionar cor em Tecido a2"]'));
    const g = novoGrupos(t.container);
    expect(g).toHaveLength(1);
    expect(g[0].textContent).toContain("↳ mesmo tecido");
    await escolher(g[0], "Cor base da cor nova 1 de Tecido a2", "cor2");
    await clicar(botaoSalvar());
    await flush(80);
    expect(importarRpcs()).toHaveLength(1);
    const args = importarRpcs()[0][1];
    expect(args._artigo_alvo_id).toBe("a2");
    expect(args._cabecalho).toEqual({ nome: "Tecido a2" });
    expect(args._variantes).toEqual([{ cor_id: "cor2", cor_apelido_id: null, nome_variante: null, codigo_variante: null, preco: null }]);
    expect(novoGrupos(t.container)).toHaveLength(0);
    await t.desmontar();
  });

  it("falha do servidor mantém o grupo na tela com o aviso e conta 'com erro'; Descartar limpa tudo", async () => {
    rpc.mockImplementation(async (nome: string) => {
      if (nome === "importar_tecido_linha") return { data: null, error: { code: "P0001", message: "Cor base não pertence à loja." } };
      return { error: null };
    });
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo tecido"));
    await digitar(porLabel(t.container, "Nome do tecido novo")[0], "Tecido Z");
    await escolher(t.container, "Cor base da cor 1 do tecido novo", "cor1");
    await clicar(botaoSalvar());
    await flush(80);
    expect(toast.error).toHaveBeenCalled();
    expect(String(toast.error.mock.calls[0][0])).toContain("1 com erro");
    expect(novoGrupos(t.container)).toHaveLength(1);
    expect(t.container.querySelector("[data-erro-linha]")).not.toBeNull();
    await clicar(botaoTexto("Descartar alterações"));
    await flush(20);
    await clicar(Array.from(document.body.querySelectorAll("button")).filter((b) => b.textContent === "Descartar").pop());
    await flush(30);
    expect(novoGrupos(t.container)).toHaveLength(0);
    await t.desmontar();
  });
});
