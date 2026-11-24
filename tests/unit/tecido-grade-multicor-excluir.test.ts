// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom (mesmo padrão de tecido-grade-aba.test.ts) */
// Grade "Lista tipo Excel" de Cadastro > Tecidos (Task 11). Render real da `TecidosGradeAba` com `supabase` mockado.
// PARTE A: multi-seleção de cores na célula da linha-PAI (tecido novo e tecido existente) — só ADICIONA, preço herdado, sem duplicar.
// PARTE B: excluir cor / tecido JÁ CADASTRADOS pede confirmação e grava NA HORA pelas RPCs com guarda; em uso (RPC recusa) mostra a
// mensagem; Cancelar não chama nada; linha NOVA só some do rascunho (sem RPC).
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
const storageRemove = vi.fn(async () => ({ error: null }));
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
        cores: [{ id: "cor1", nome: "Azul" }, { id: "cor2", nome: "Verde" }, { id: "cor3", nome: "Rosa" }, { id: "cor4", nome: "Preto" }],
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
  storage: { from: () => ({ remove: (...a: unknown[]) => storageRemove(...a) }) },
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
  await expandirTudo(container); // a lista nasce com os tecidos recolhidos
  return { container, qc, desmontar: async () => { await act(async () => { root.unmount(); }); container.remove(); document.body.innerHTML = ""; } };
}

const linhas = (c: HTMLElement) => Array.from(c.querySelectorAll("tbody tr")) as HTMLElement[];
const porLabel = (root: ParentNode, label: string) => Array.from(root.querySelectorAll(`[aria-label="${label}"]`)) as HTMLInputElement[];
function digitar(el: HTMLInputElement, valor: string) {
  const set = Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!; // Nome/Composição são textarea
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
const excluirCorRpcs = () => rpc.mock.calls.filter((c) => c[0] === "excluir_variante_tecido");
const excluirTecidoRpcs = () => rpc.mock.calls.filter((c) => c[0] === "excluir_tecido");
const dialogo = () => document.body.querySelector('[role="alertdialog"]') as HTMLElement | null;
const botaoDialogo = (txt: string) => Array.from(document.body.querySelectorAll('[role="alertdialog"] button')).find((b) => b.textContent === txt) as HTMLButtonElement;
const caixaCor = (nome: string) => document.body.querySelector(`[role="checkbox"][aria-label="Cor ${nome}"]`) as HTMLElement | null;
let contaNovo = 0;

beforeEach(() => {
  estado.artigos = [artigo("a1"), artigo("a2")];
  estado.variantes = [variante("v1", "a1"), variante("v2", "a1", { cor_id: "cor2" })];
  estado.cats = [];
  estado.conflitoArtigo = new Set(); estado.falhaTabela = null;
  ordem.length = 0; artigoUpdates.length = 0; contaNovo = 0;
  storageRemove.mockClear();
  rpc.mockReset(); rpc.mockImplementation(async (nome: string, args: any) => {
    if (nome === "importar_tecido_linha") {
      if (args._artigo_alvo_id) return { data: { artigo_id: args._artigo_alvo_id, acao: "complementado" }, error: null };
      const id = `n${++contaNovo}`;
      estado.artigos.push(artigo(id, { nome: args._cabecalho.nome }));
      return { data: { artigo_id: id, acao: "criado" }, error: null };
    }
    if (nome === "excluir_variante_tecido") {
      estado.variantes = estado.variantes.filter((v) => v.id !== args._variante_id);
      return { data: { foto_url: "tenant/foto-v.jpg" }, error: null };
    }
    if (nome === "excluir_tecido") {
      estado.artigos = estado.artigos.filter((a) => a.id !== args._artigo_id);
      estado.variantes = estado.variantes.filter((v) => v.artigo_id !== args._artigo_id);
      return { data: { fotos: ["tenant/f1.jpg", "tenant/f2.jpg"] }, error: null };
    }
    return { error: null };
  });
  Object.values(toast).forEach((f) => f.mockReset());
});

const PROPS = () => estado.artigos.map((a) => ({ id: a.id }));

describe("Multi-cor na linha-pai (Parte A)", () => {
  it("tecido NOVO: marcar 3 cores cria 3 linhas com a cor base e o PREÇO do tecido herdado (rascunho: nada grava)", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo tecido"));
    await digitar(porLabel(t.container, "Nome do tecido novo")[0], "Malha Multi");
    await digitar(porLabel(t.container, "Preço do tecido novo")[0], "28,00");
    await clicar(t.container.querySelector('[aria-label="Adicionar várias cores do tecido novo"]'));
    await flush(20);
    await clicar(caixaCor("Azul")); await clicar(caixaCor("Verde")); await clicar(caixaCor("Rosa"));
    await clicar(botaoTexto("Adicionar 3 cores"));
    await flush(20);

    const g = novoGrupos(t.container);
    expect(g).toHaveLength(3); // a linha em branco de fábrica foi PREENCHIDA (não sobra uma 4ª sem cor)
    expect(porLabel(g[1], "Preço da variante da cor 2 do tecido novo")[0].value).toBe("28,00");
    expect(importarRpcs()).toHaveLength(0);

    await clicar(botaoSalvar());
    await flush(80);
    const args = importarRpcs()[0][1];
    expect(args._artigo_alvo_id).toBeNull();
    expect(args._variantes.map((v: any) => [v.cor_id, v.preco])).toEqual([["cor1", 28], ["cor2", 28], ["cor3", 28]]);
    await t.desmontar();
  });

  it("cor já presente aparece marcada e TRAVADA (não duplica); desmarcar nunca remove; só o pai tem o multi", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo tecido"));
    await escolher(t.container, "Cor base da cor 1 do tecido novo", "cor1");
    await clicar(t.container.querySelector('[aria-label="Adicionar várias cores do tecido novo"]'));
    await flush(20);
    expect(caixaCor("Azul")!.getAttribute("data-state")).toBe("checked");
    expect(caixaCor("Azul")!.hasAttribute("disabled")).toBe(true);
    await clicar(caixaCor("Azul")); // travada: clique não faz nada
    await clicar(caixaCor("Verde"));
    await clicar(caixaCor("Verde")); // marcou e desmarcou
    expect(botaoTexto("Adicionar cores")!.disabled).toBe(true);
    await clicar(caixaCor("Verde"));
    await clicar(botaoTexto("Adicionar 1 cor"));
    await flush(20);
    expect(novoGrupos(t.container)).toHaveLength(2); // só a Verde entrou (a Azul não duplicou nem saiu)
    // a linha 2 (filha) não tem o multi: continua Select simples
    expect(novoGrupos(t.container)[1].querySelector('[aria-label="Adicionar várias cores do tecido novo"]')).toBeNull();
    await t.desmontar();
  });

  it("tecido EXISTENTE: cores que ele já tem vêm marcadas+travadas; marcar nova cria cor nova com o preço do tecido (_artigo_alvo_id)", async () => {
    const t = await montar(PROPS());
    await clicar(t.container.querySelector('[aria-label="Adicionar várias cores em Tecido a1"]'));
    await flush(20);
    expect(caixaCor("Azul")!.hasAttribute("disabled")).toBe(true);
    expect(caixaCor("Verde")!.hasAttribute("disabled")).toBe(true);
    expect(caixaCor("Rosa")!.hasAttribute("disabled")).toBe(false);
    await clicar(caixaCor("Rosa")); await clicar(caixaCor("Preto"));
    await clicar(botaoTexto("Adicionar 2 cores"));
    await flush(20);
    expect(novoGrupos(t.container)).toHaveLength(2);
    expect(importarRpcs()).toHaveLength(0);

    await clicar(botaoSalvar());
    await flush(80);
    expect(importarRpcs()).toHaveLength(1);
    const args = importarRpcs()[0][1];
    expect(args._artigo_alvo_id).toBe("a1");
    expect(args._variantes.map((v: any) => [v.cor_id, v.preco])).toEqual([["cor3", 10], ["cor4", 10]]);
    await t.desmontar();
  });

  it("tecido existente SEM cores também oferece o multi (a linha 'sem cor' é a linha-pai)", async () => {
    const t = await montar(PROPS()); // a2 não tem variantes
    const gatilho = t.container.querySelector('[aria-label="Adicionar várias cores em Tecido a2"]');
    expect(gatilho).not.toBeNull();
    await clicar(gatilho);
    await flush(20);
    await clicar(caixaCor("Verde"));
    await clicar(botaoTexto("Adicionar 1 cor"));
    await flush(20);
    expect(novoGrupos(t.container)).toHaveLength(1);
    await t.desmontar();
  });
});

describe("Excluir (Parte B)", () => {
  it("excluir COR cadastrada: o botão só PEDE confirmação; Cancelar não chama a RPC; Confirmar grava NA HORA e relê a grade", async () => {
    const t = await montar(PROPS());
    expect(linhas(t.container).filter((r) => r.dataset.varianteId)).toHaveLength(2);
    await clicar(t.container.querySelector('[aria-label="Excluir a cor Azul de Tecido a1"]'));
    await flush(20);
    expect(dialogo()).not.toBeNull();
    expect(dialogo()!.textContent).toContain("Excluir a cor Azul?");
    expect(excluirCorRpcs()).toHaveLength(0); // pediu confirmação, NADA gravou ainda

    await clicar(botaoDialogo("Cancelar"));
    await flush(20);
    expect(excluirCorRpcs()).toHaveLength(0);

    await clicar(t.container.querySelector('[aria-label="Excluir a cor Azul de Tecido a1"]'));
    await flush(20);
    await clicar(botaoDialogo("Excluir cor"));
    await flush(80);
    expect(excluirCorRpcs()).toHaveLength(1);
    expect(excluirCorRpcs()[0][1]).toEqual({ _variante_id: "v1" });
    expect(storageRemove).toHaveBeenCalledWith(["tenant/foto-v.jpg"]); // foto sai do storage DEPOIS do delete
    expect(toast.success).toHaveBeenCalledWith("Cor excluída.");
    expect(linhas(t.container).filter((r) => r.dataset.varianteId)).toHaveLength(1); // a grade foi relida
    await t.desmontar();
  });

  it("cor EM USO: a RPC recusa, a mensagem aparece e a linha continua", async () => {
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (nome: string, args: any) =>
      nome === "excluir_variante_tecido" ? { data: null, error: { message: "Esta cor está em uso em OC e não pode ser excluída." } } : original(nome, args));
    const t = await montar(PROPS());
    await clicar(t.container.querySelector('[aria-label="Excluir a cor Azul de Tecido a1"]'));
    await flush(20);
    await clicar(botaoDialogo("Excluir cor"));
    await flush(80);
    expect(excluirCorRpcs()).toHaveLength(1);
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(linhas(t.container).filter((r) => r.dataset.varianteId)).toHaveLength(2);
    await t.desmontar();
  });

  it("excluir TECIDO inteiro: confirma ('e todas as cores'), chama excluir_tecido, limpa as fotos e o tecido some", async () => {
    const t = await montar(PROPS());
    await clicar(t.container.querySelector('[aria-label="Excluir o tecido Tecido a1 e todas as cores"]'));
    await flush(20);
    expect(dialogo()!.textContent).toContain("Excluir o tecido Tecido a1 e todas as cores?");
    expect(excluirTecidoRpcs()).toHaveLength(0);
    await clicar(botaoDialogo("Excluir tecido"));
    await flush(80);
    expect(excluirTecidoRpcs()).toHaveLength(1);
    expect(excluirTecidoRpcs()[0][1]).toEqual({ _artigo_id: "a1" });
    expect(storageRemove).toHaveBeenCalledWith(["tenant/f1.jpg", "tenant/f2.jpg"]);
    expect(toast.success).toHaveBeenCalledWith("Tecido excluído.");
    expect(t.container.querySelector('[data-grupo-artigo="a1"]')).toBeNull();
    await t.desmontar();
  });

  it("excluir tecido leva junto as cores NOVAS em rascunho dele (não ficam apontando para um tecido que sumiu)", async () => {
    const t = await montar(PROPS());
    await clicar(t.container.querySelector('[aria-label="Adicionar cor em Tecido a1"]'));
    expect(novoGrupos(t.container)).toHaveLength(1);
    await clicar(t.container.querySelector('[aria-label="Excluir o tecido Tecido a1 e todas as cores"]'));
    await flush(20);
    await clicar(botaoDialogo("Excluir tecido"));
    await flush(80);
    expect(novoGrupos(t.container)).toHaveLength(0);
    await t.desmontar();
  });

  it("linha NOVA: descartar só remove do rascunho — sem confirmação pesada e SEM chamar RPC de excluir", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo tecido"));
    await clicar(botaoTexto("adicionar variante (cor)", t.container));
    expect(novoGrupos(t.container)).toHaveLength(2);
    await clicar(t.container.querySelector('[data-variante-nova] [aria-label="Remover esta cor"]')); // a cor nova some
    expect(novoGrupos(t.container)).toHaveLength(1);
    await clicar(botaoTexto("Descartar tecido novo", t.container)); // o tecido novo inteiro
    expect(novoGrupos(t.container)).toHaveLength(0);
    expect(dialogo()).toBeNull();
    expect(excluirCorRpcs()).toHaveLength(0);
    expect(excluirTecidoRpcs()).toHaveLength(0);
    await t.desmontar();
  });

  it("cor NOVA de tecido existente também só é descartada (sem RPC)", async () => {
    const t = await montar(PROPS());
    await clicar(t.container.querySelector('[aria-label="Adicionar cor em Tecido a1"]'));
    await clicar(t.container.querySelector('[aria-label="Descartar a cor nova"]'));
    expect(novoGrupos(t.container)).toHaveLength(0);
    expect(excluirCorRpcs()).toHaveLength(0);
    await t.desmontar();
  });
});
