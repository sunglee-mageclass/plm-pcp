// @vitest-environment happy-dom
// F7 Armário · D3 — dialog de variantes disponíveis: render real (react-dom + happy-dom) com a RPC mockada.
//   1 mini-card por variante (produto x cor) · em-desenvolvimento esmaecido, SEM alça de arraste e SEM "+" ·
//   card normal é arrastável (atributos do useDraggable) e clicável (onAdicionar) · aviso "já em outro armário" não bloqueia ·
//   chave de identidade = chaveVariante · busca por nome/REF · "Na grade" não arrasta.
// Task 5 — FILTROS (grupo>categoria>sub1 em cascata c/ poda, cor, linha, estado, planejamento): cada um restringe a lista;
//   Acessórios mostra as subcategorias do próprio grupo; combinam entre si e com a lupa; cards seguem arrastáveis após filtrar.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/components/RequirePermission", () => ({ useReadOnly: () => false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) })); // FilterButton (uso por usuário)
vi.mock("@/components/plan-tecido/ModeloThumb", () => ({ ModeloThumb: () => null })); // usa storage assinado

const {
  VariantesDialog, achatarVariantes, filtrarEntradas, VARIANTE_DRAG_PREFIXO,
  filtrarPorFacetas, opcoesDosFiltros, podarFiltros, contarFiltrosAtivos, chaveCor, FILTROS_VAZIOS,
} = await import("@/components/armario/VariantesDialog");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { DndContext } = await import("@dnd-kit/core");
const { chaveVariante } = await import("@/lib/armario/variante-chave");

const V = (o: Record<string, unknown>) => ({
  variante_tecido_id: null, produto_variante_id: null, cor_id: "c", cor_apelido_id: null,
  cor_nome: "Azul", cor_apelido_nome: null, ordem: 1, ja_em_outro: false, armarios_com: [], ...o,
});
// Facetas do modelo (nível do mini-card) como a RPC devolve; ids/nomes curtos de propósito.
const F = (o: Record<string, unknown>) => ({
  categoria_principal_id: null, categoria_nome: null, subcategoria1_id: null, subcategoria1_nome: null,
  grupo_id: null, grupo_nome: null, eh_acessorio: false, linha_id: null, linha_nome: null, status_planejamento: null,
  mes_id: null, mes_ordem: null, ano_id: null, ano: null, ...o,
});
const MODELOS = [
  {
    ...F({ grupo_id: "g-rou", grupo_nome: "Roupas", categoria_principal_id: "c-ves", categoria_nome: "Vestido", subcategoria1_id: "s-lon", subcategoria1_nome: "Longo", linha_id: "l-pre", linha_nome: "Premium", status_planejamento: "planejado" }),
    modelo_id: "m1", nome: "Vestido Lis", ref: "VES-001", foto_path: null, origem: "interno", em_desenvolvimento: false,
    variantes: [
      V({ variante_tecido_id: "vt1", cor_id: "azul", cor_nome: "Azul", cor_apelido_nome: "Mar" }),
      V({ variante_tecido_id: "vt2", cor_id: "verde", cor_nome: "Verde", ordem: 2, ja_em_outro: true, armarios_com: [{ id: "a9", nome: "Vitrine Outono" }] }),
    ],
  },
  {
    ...F({ grupo_id: "g-rou", grupo_nome: "Roupas", categoria_principal_id: "c-sai", categoria_nome: "Saia", subcategoria1_id: "s-mid", subcategoria1_nome: "Midi", linha_id: "l-cas", linha_nome: "Casual", status_planejamento: "em_planejamento" }),
    modelo_id: "m2", nome: "Saia Nova", ref: null, foto_path: null, origem: "interno", em_desenvolvimento: true, variantes: [],
  },
  {
    ...F({ grupo_id: "g-ace", grupo_nome: "Acessórios", eh_acessorio: true, categoria_principal_id: "c-bol", categoria_nome: "Bolsa", subcategoria1_id: "s-tot", subcategoria1_nome: "Tote", linha_id: "l-cas", linha_nome: "Casual", status_planejamento: "reprovado" }),
    modelo_id: "m3", nome: "Bolsa Palha", ref: "BOL-7", foto_path: null, origem: "revenda", em_desenvolvimento: false,
    variantes: [V({ produto_variante_id: "pv1", cor_id: "bege", cor_nome: "Bege" })],
  },
];

let root: Root | null = null;
let host: HTMLElement | null = null;
async function montar(props: Record<string, unknown> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const el = createElement(DndContext, null,
    createElement(VariantesDialog, { colecaoId: "col1", colecao: "Coleção 2027", subcolecao: "Verão", armarioId: "arm1", onFechar: vi.fn(), ...props } as any));
  await act(async () => { root!.render(createElement(QueryClientProvider, { client: qc }, el)); });
  await tick(10);
}
const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const cards = () => Array.from(document.querySelectorAll('[data-testid="variante-card"]'));
const cardEmDev = () => document.querySelector('[data-testid="variante-card-em-desenvolvimento"]') as HTMLElement | null;

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: MODELOS, error: null });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = host = null;
  document.body.innerHTML = "";
});

// 4º produto só dos testes de filtro (não mexe nas contagens dos testes antigos): outro acessório, outra categoria/sub.
const M4 = {
  ...F({ grupo_id: "g-ace", grupo_nome: "Acessórios", eh_acessorio: true, categoria_principal_id: "c-bri", categoria_nome: "Brinco", subcategoria1_id: "s-arg", subcategoria1_nome: "Argola", linha_id: "l-pre", linha_nome: "Premium", status_planejamento: "planejado" }),
  modelo_id: "m4", nome: "Brinco Sol", ref: "BRI-9", foto_path: null, origem: "interno", em_desenvolvimento: false,
  variantes: [V({ variante_tecido_id: "vt9", cor_id: "azul", cor_nome: "Azul", cor_apelido_nome: "Mar" }), V({ variante_tecido_id: "vt10", cor_id: "dourado", cor_nome: "Dourado", ordem: 2 })],
};
const TODOS = [...MODELOS, M4];
const entradasTodos = () => achatarVariantes(TODOS as any);
const nomes = (es: ReturnType<typeof achatarVariantes>) => es.map((e) => (e.tipo === "variante" ? `${e.item.nome}/${e.item.cor_nome}` : `${e.modelo.nome}/dev`));
const F0 = FILTROS_VAZIOS;

describe("achatarVariantes (puro)", () => {
  it("produto com N cores vira N entradas; em desenvolvimento vira 1 entrada sem variantes", () => {
    const e = achatarVariantes(MODELOS as any);
    expect(e.map((x) => x.tipo)).toEqual(["variante", "variante", "em_desenvolvimento", "variante"]);
    const v = e[0] as any;
    expect(v.chave).toBe(chaveVariante({ modelo_id: "m1", variante_tecido_id: "vt1", cor_id: "azul", cor_apelido_id: null }));
    expect(e[3].chave).toBe(chaveVariante({ modelo_id: "m3", produto_variante_id: "pv1", cor_id: "bege", cor_apelido_id: null }));
  });
  it("filtra por nome/REF/cor sem acento nem caixa", () => {
    const e = achatarVariantes(MODELOS as any);
    expect(filtrarEntradas(e, "bol-7")).toHaveLength(1);
    expect(filtrarEntradas(e, "VESTIDO")).toHaveLength(2);
    expect(filtrarEntradas(e, "mar")).toHaveLength(1);
    expect(filtrarEntradas(e, "")).toHaveLength(4);
  });
});

describe("VariantesDialog", () => {
  it("chama a RPC com coleção/sub/armário e lista 1 card por variante + 1 em desenvolvimento", async () => {
    await montar();
    expect(rpcMock).toHaveBeenCalledWith("armario_variantes_disponiveis", { _colecao_id: "col1", _subcolecao: "Verão", _armario_id: "arm1" });
    expect(cards()).toHaveLength(3);
    expect(cardEmDev()).not.toBeNull();
    const t = document.body.textContent ?? "";
    expect(t).toContain("Vestido Lis");
    expect(t).toContain("REF VES-001");
    expect(t).toContain("Azul - Mar"); // cor base - apelido (corApelidoLabel)
  });

  it("em desenvolvimento: esmaecido, com badge, SEM alça de arraste e SEM botão de adicionar", async () => {
    const onAdicionar = vi.fn();
    await montar({ onAdicionar });
    const dev = cardEmDev()!;
    expect(dev.textContent).toContain("Saia Nova");
    expect(dev.textContent).toContain("Em desenvolvimento");
    expect(dev.className).toContain("opacity-50");
    expect(dev.className).toContain("cursor-not-allowed");
    expect(dev.querySelector('[aria-roledescription="draggable"]')).toBeNull();
    expect(dev.querySelector('[data-testid="variante-alca"]')).toBeNull();
    expect(dev.querySelector("button")).toBeNull();
    await act(async () => { dev.click(); });
    expect(onAdicionar).not.toHaveBeenCalled();
  });

  it("variante normal é arrastável (useDraggable) e clicável (onAdicionar com o item)", async () => {
    const onAdicionar = vi.fn();
    await montar({ onAdicionar });
    const card = cards()[0] as HTMLElement;
    const alca = card.querySelector('[data-testid="variante-alca"]') as HTMLElement;
    expect(alca.getAttribute("aria-roledescription")).toBe("draggable");
    expect(alca.getAttribute("role")).toBe("button");
    const btn = card.querySelector("button") as HTMLButtonElement;
    await act(async () => { btn.click(); });
    expect(onAdicionar).toHaveBeenCalledTimes(1);
    const item = onAdicionar.mock.calls[0][0];
    expect(item).toMatchObject({ modelo_id: "m1", variante_tecido_id: "vt1", cor_id: "azul", nome: "Vestido Lis" });
    expect(item.chave).toBe(card.getAttribute("data-chave"));
    expect(VARIANTE_DRAG_PREFIXO).toBe("variante:");
  });

  it("sem onAdicionar não há botão +; o arraste segue disponível", async () => {
    await montar();
    const card = cards()[0] as HTMLElement;
    expect(card.querySelector("button")).toBeNull();
    expect(card.querySelector('[aria-roledescription="draggable"]')).not.toBeNull();
  });

  it("já em outro armário: aviso aparece (com os nomes) mas o card continua arrastável/clicável", async () => {
    const onAdicionar = vi.fn();
    await montar({ onAdicionar });
    const avisos = Array.from(document.querySelectorAll('[data-testid="aviso-ja-em-outro"]'));
    expect(avisos).toHaveLength(1);
    expect(avisos[0].textContent).toBe("já em outro armário");
    expect(avisos[0].getAttribute("aria-label")).toContain("Vitrine Outono");
    const card = avisos[0].closest('[data-testid="variante-card"]') as HTMLElement;
    expect(card.querySelector('[aria-roledescription="draggable"]')).not.toBeNull();
    await act(async () => { (card.querySelector("button") as HTMLButtonElement).click(); });
    expect(onAdicionar).toHaveBeenCalledTimes(1);
    expect(onAdicionar.mock.calls[0][0].ja_em_outro).toBe(true);
  });

  it("chavesNaGrade: card vira 'Na grade', sem alça de arraste e sem +", async () => {
    const chave = chaveVariante({ modelo_id: "m3", produto_variante_id: "pv1", cor_id: "bege", cor_apelido_id: null });
    await montar({ onAdicionar: vi.fn(), chavesNaGrade: new Set([chave]) });
    const card = cards().find((c) => c.getAttribute("data-chave") === chave) as HTMLElement;
    expect(card.textContent).toContain("Na grade");
    expect(card.querySelector('[aria-roledescription="draggable"]')).toBeNull();
    expect(card.querySelector("button")).toBeNull();
  });

  it("busca filtra por nome/REF e mostra estado vazio da busca", async () => {
    await montar();
    const input = document.querySelector('input[aria-label="Buscar variantes"]') as HTMLInputElement;
    const digitar = async (v: string) => {
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        set.call(input, v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await digitar("bol-7");
    expect(cards()).toHaveLength(1);
    expect(cardEmDev()).toBeNull();
    await digitar("zzz");
    expect(document.body.textContent).toContain("Nada encontrado");
  });

  it("subcoleção sem produtos mostra estado vazio; erro da RPC mostra mensagem", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await montar();
    expect(document.body.textContent).toContain("Nenhum produto nesta subcoleção");
    await act(async () => { root!.unmount(); }); host!.remove(); document.body.innerHTML = "";
    rpcMock.mockResolvedValue({ data: null, error: { message: "x" } });
    await montar();
    expect(document.body.textContent).toContain("Não foi possível carregar");
  });
});

describe("filtros por faceta (puro)", () => {
  it("achatar leva as facetas do modelo para a variante E para o card em desenvolvimento", () => {
    const e = entradasTodos();
    const v = e.find((x) => x.tipo === "variante" && x.item.modelo_id === "m3") as any;
    expect(v.item).toMatchObject({ grupo_id: "g-ace", eh_acessorio: true, categoria_nome: "Bolsa", linha_id: "l-cas", status_planejamento: "reprovado" });
    const dev = e.find((x) => x.tipo === "em_desenvolvimento") as any;
    expect(dev.modelo).toMatchObject({ grupo_id: "g-rou", subcategoria1_nome: "Midi", status_planejamento: "em_planejamento" });
  });

  it("sem filtro devolve a lista inteira (mesma referência)", () => {
    const e = entradasTodos();
    expect(filtrarPorFacetas(e, F0)).toBe(e);
    expect(contarFiltrosAtivos(F0)).toBe(0);
  });

  it("Grupo Acessórios: só os acessórios; Categoria/Subcategoria oferecem só as do grupo (mesma árvore)", () => {
    const e = entradasTodos();
    expect(nomes(filtrarPorFacetas(e, { ...F0, grupo: ["g-ace"] }))).toEqual(["Bolsa Palha/Bege", "Brinco Sol/Azul", "Brinco Sol/Dourado"]);
    const sem = opcoesDosFiltros(e, F0);
    expect(sem.grupos.map((o) => o.nome)).toEqual(["Acessórios", "Roupas"]);
    expect(sem.categorias.map((o) => o.nome)).toEqual(["Bolsa", "Brinco", "Saia", "Vestido"]);
    const ace = opcoesDosFiltros(e, { ...F0, grupo: ["g-ace"] });
    expect(ace.categorias.map((o) => o.nome)).toEqual(["Bolsa", "Brinco"]);
    expect(ace.subcategorias.map((o) => o.nome)).toEqual(["Argola", "Tote"]);
    const rou = opcoesDosFiltros(e, { ...F0, grupo: ["g-rou"] });
    expect(rou.categorias.map((o) => o.nome)).toEqual(["Saia", "Vestido"]);
  });

  it("Categoria e Subcategoria restringem (cascata: Subcategoria só das categorias marcadas)", () => {
    const e = entradasTodos();
    expect(nomes(filtrarPorFacetas(e, { ...F0, categoria: ["c-bri"] }))).toEqual(["Brinco Sol/Azul", "Brinco Sol/Dourado"]);
    expect(nomes(filtrarPorFacetas(e, { ...F0, sub1: ["s-tot"] }))).toEqual(["Bolsa Palha/Bege"]);
    expect(nomes(filtrarPorFacetas(e, { ...F0, categoria: ["c-bol", "c-sai"] }))).toEqual(["Saia Nova/dev", "Bolsa Palha/Bege"]); // OU dentro do dropdown
    expect(opcoesDosFiltros(e, { ...F0, categoria: ["c-bri"] }).subcategorias.map((o) => o.nome)).toEqual(["Argola"]);
  });

  it("PODA: trocar Grupo/Categoria remove da seleção o que saiu das opções (só remove)", () => {
    const e = entradasTodos();
    const a = podarFiltros(e, { ...F0, grupo: ["g-rou"], categoria: ["c-bol", "c-ves"], sub1: ["s-tot", "s-lon"] });
    expect(a.categoria).toEqual(["c-ves"]);
    expect(a.sub1).toEqual(["s-lon"]);
    const b = podarFiltros(e, { ...F0, categoria: ["c-ves"], sub1: ["s-tot"] });
    expect(b.sub1).toEqual([]);
    const ok = { ...F0, grupo: ["g-ace"], categoria: ["c-bol"], sub1: ["s-tot"] };
    expect(podarFiltros(e, ok)).toBe(ok); // nada a podar = mesma referência
  });

  it("Cor: só a variante da cor escolhida (o produto fica visível se ≥1 variante casa); dev (sem cor) sai", () => {
    const e = entradasTodos();
    const cores = opcoesDosFiltros(e, F0).cores;
    expect(cores.map((o) => o.nome)).toEqual(["Azul - Mar", "Bege", "Dourado", "Verde"]); // corApelidoLabel; uma opção por cor+apelido
    expect(nomes(filtrarPorFacetas(e, { ...F0, cor: [chaveCor("azul", null)] }))).toEqual(["Vestido Lis/Azul", "Brinco Sol/Azul"]);
    expect(nomes(filtrarPorFacetas(e, { ...F0, cor: [chaveCor("verde", null), chaveCor("bege", null)] }))).toEqual(["Vestido Lis/Verde", "Bolsa Palha/Bege"]);
  });

  it("Cor distingue o apelido pelo id (mesma cor base, apelidos diferentes = opções diferentes)", () => {
    const m = { ...M4, variantes: [V({ variante_tecido_id: "a", cor_id: "azul", cor_apelido_id: "ap1", cor_nome: "Azul", cor_apelido_nome: "Mar" }), V({ variante_tecido_id: "b", cor_id: "azul", cor_apelido_id: "ap2", cor_nome: "Azul", cor_apelido_nome: "Céu" })] };
    const e = achatarVariantes([m] as any);
    expect(opcoesDosFiltros(e, F0).cores.map((o) => o.nome)).toEqual(["Azul - Céu", "Azul - Mar"]);
    expect(filtrarPorFacetas(e, { ...F0, cor: [chaveCor("azul", "ap2")] })).toHaveLength(1);
  });

  it("Linha restringe (inclui o card em desenvolvimento)", () => {
    const e = entradasTodos();
    expect(opcoesDosFiltros(e, F0).linhas.map((o) => o.nome)).toEqual(["Casual", "Premium"]);
    expect(nomes(filtrarPorFacetas(e, { ...F0, linha: ["l-cas"] }))).toEqual(["Saia Nova/dev", "Bolsa Palha/Bege"]);
  });

  it("Estado: Em desenvolvimento / Disponível / Já em outro armário (derivados de em_desenvolvimento e ja_em_outro)", () => {
    const e = entradasTodos();
    expect(opcoesDosFiltros(e, F0).estados.map((o) => o.id)).toEqual(["disponivel", "ja_em_outro", "em_desenvolvimento"]);
    expect(nomes(filtrarPorFacetas(e, { ...F0, estado: ["em_desenvolvimento"] }))).toEqual(["Saia Nova/dev"]);
    expect(nomes(filtrarPorFacetas(e, { ...F0, estado: ["ja_em_outro"] }))).toEqual(["Vestido Lis/Verde"]);
    expect(nomes(filtrarPorFacetas(e, { ...F0, estado: ["disponivel"] }))).toEqual(["Vestido Lis/Azul", "Bolsa Palha/Bege", "Brinco Sol/Azul", "Brinco Sol/Dourado"]);
    // só as opções que existem: sem "ja_em_outro" e sem dev na lista, o dropdown não oferece
    const so = achatarVariantes([M4] as any);
    expect(opcoesDosFiltros(so, F0).estados.map((o) => o.id)).toEqual(["disponivel"]);
  });

  it("Planejamento: usa os valores NORMALIZADOS da RPC (em_planejamento/planejado/reprovado)", () => {
    const e = entradasTodos();
    expect(opcoesDosFiltros(e, F0).planejamentos.map((o) => `${o.id}=${o.nome}`)).toEqual(["em_planejamento=Em planejamento", "planejado=Planejado", "reprovado=Reprovado"]);
    expect(nomes(filtrarPorFacetas(e, { ...F0, planejamento: ["reprovado"] }))).toEqual(["Bolsa Palha/Bege"]);
    expect(nomes(filtrarPorFacetas(e, { ...F0, planejamento: ["planejado"] }))).toEqual(["Vestido Lis/Azul", "Vestido Lis/Verde", "Brinco Sol/Azul", "Brinco Sol/Dourado"]);
  });

  it("filtros combinam em E entre si e com a lupa", () => {
    const e = entradasTodos();
    expect(nomes(filtrarPorFacetas(e, { ...F0, grupo: ["g-ace"], linha: ["l-pre"] }))).toEqual(["Brinco Sol/Azul", "Brinco Sol/Dourado"]);
    expect(nomes(filtrarPorFacetas(e, { ...F0, grupo: ["g-ace"], linha: ["l-pre"], cor: [chaveCor("dourado", null)] }))).toEqual(["Brinco Sol/Dourado"]);
    expect(filtrarPorFacetas(e, { ...F0, grupo: ["g-rou"], planejamento: ["reprovado"] })).toEqual([]);
    const aposLupa = filtrarEntradas(e, "azul"); // Vestido/Azul + Brinco/Azul
    expect(nomes(filtrarPorFacetas(aposLupa, { ...F0, grupo: ["g-ace"] }))).toEqual(["Brinco Sol/Azul"]);
    expect(contarFiltrosAtivos({ ...F0, grupo: ["g-ace"], cor: ["x"] })).toBe(2);
  });

  it("RPC antiga (sem facetas) segue funcionando: tudo null, nenhum dropdown tem opção", () => {
    const e = achatarVariantes([{ modelo_id: "x", nome: "Velho", ref: null, foto_path: null, origem: "interno", em_desenvolvimento: false, variantes: [V({ variante_tecido_id: "v" })] }] as any);
    const o = opcoesDosFiltros(e, F0);
    expect([o.grupos, o.categorias, o.subcategorias, o.linhas, o.planejamentos].every((l) => l.length === 0)).toBe(true);
    expect(filtrarPorFacetas(e, { ...F0, grupo: ["g"] })).toEqual([]);
  });
});

describe("VariantesDialog — barra de filtros (render)", () => {
  const filtrosBtn = () => document.body.querySelector('button[aria-label="Filtros"]') as HTMLButtonElement | null;
  const busca = async (v: string) => {
    const input = document.querySelector('input[aria-label="Buscar variantes"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  /** Abre "Filtros" (se preciso), abre o dropdown `filtro` e marca a opção `opcao`. */
  async function marcar(filtro: string, opcao: string) {
    if (!document.body.textContent?.includes("Limpar filtros") && !Array.from(document.body.querySelectorAll("label")).some((l) => l.textContent?.trim() === filtro)) {
      await act(async () => { filtrosBtn()!.click(); });
    }
    const lab = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim() === filtro) as HTMLElement;
    const gatilho = lab.parentElement!.querySelector("button") as HTMLButtonElement;
    await act(async () => { gatilho.click(); });
    const alvo = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim() === opcao && l !== lab) as HTMLElement;
    expect(alvo, `opção ${opcao}`).toBeTruthy();
    await act(async () => { alvo.click(); });
  }
  const opcoesDe = (filtro: string): string[] => {
    const lab = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim() === filtro) as HTMLElement;
    return Array.from(document.body.querySelectorAll('[role="dialog"] label, [data-radix-popper-content-wrapper] label'))
      .filter((l) => l !== lab).map((l) => l.textContent?.trim() ?? "");
  };

  beforeEach(() => { rpcMock.mockResolvedValue({ data: TODOS, error: null }); });

  it("sem facetas na lista (RPC antiga) não mostra o botão Filtros; com facetas mostra", async () => {
    rpcMock.mockResolvedValue({ data: [{ modelo_id: "x", nome: "Velho", ref: null, foto_path: null, origem: "interno", em_desenvolvimento: false, variantes: [V({ variante_tecido_id: "v" })] }], error: null });
    await montar();
    expect(filtrosBtn()).toBeNull();
    await act(async () => { root!.unmount(); }); host!.remove(); document.body.innerHTML = "";
    rpcMock.mockResolvedValue({ data: TODOS, error: null });
    await montar();
    expect(filtrosBtn()).not.toBeNull();
  });

  it("Grupo Acessórios restringe os cards; Categoria passa a oferecer só as do grupo e Subcategoria as dele", async () => {
    await montar();
    expect(cards()).toHaveLength(5); // 5 variantes + 1 em desenvolvimento
    expect(cardEmDev()).not.toBeNull();
    await marcar("Grupo", "Acessórios");
    expect(cards()).toHaveLength(3);
    expect(cardEmDev()).toBeNull();
    const t = document.querySelector('[role="dialog"]')!.textContent ?? "";
    expect(t).toContain("Bolsa Palha");
    expect(t).toContain("Brinco Sol");
    expect(t).not.toContain("Vestido Lis");
    expect(t).toContain("3 de 5 variantes");
    // abre Categoria e Subcategoria: só as do grupo Acessórios (bolsa/brinco; tote/argola) — nada de Saia/Vestido
    const catLab = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim() === "Categoria") as HTMLElement;
    await act(async () => { (catLab.parentElement!.querySelector("button") as HTMLButtonElement).click(); });
    expect(opcoesDe("Categoria")).toEqual(expect.arrayContaining(["Bolsa", "Brinco"]));
    expect(opcoesDe("Categoria")).not.toContain("Saia");
    expect(opcoesDe("Categoria")).not.toContain("Vestido");
    const subLab = Array.from(document.body.querySelectorAll("label")).find((l) => l.textContent?.trim() === "Subcategoria") as HTMLElement;
    await act(async () => { (subLab.parentElement!.querySelector("button") as HTMLButtonElement).click(); });
    expect(opcoesDe("Subcategoria")).toEqual(expect.arrayContaining(["Argola", "Tote"]));
    expect(opcoesDe("Subcategoria")).not.toContain("Midi");
  });

  it("Cor restringe às variantes da cor; Linha e Estado também", async () => {
    await montar();
    await marcar("Cor", "Dourado");
    expect(cards()).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Brinco Sol");
    await act(async () => { root!.unmount(); }); host!.remove(); document.body.innerHTML = "";
    await montar();
    await marcar("Estado", "Já em outro armário");
    expect(cards()).toHaveLength(1);
    expect(cards()[0].querySelector('[data-testid="aviso-ja-em-outro"]')).not.toBeNull();
    await act(async () => { root!.unmount(); }); host!.remove(); document.body.innerHTML = "";
    await montar();
    await marcar("Estado", "Em desenvolvimento (sem cor)");
    expect(cards()).toHaveLength(0);
    expect(cardEmDev()).not.toBeNull();
    await act(async () => { root!.unmount(); }); host!.remove(); document.body.innerHTML = "";
    await montar();
    await marcar("Linha", "Casual");
    expect(cards()).toHaveLength(1); // Bolsa (a Saia Casual é "em desenvolvimento")
    expect(cardEmDev()).not.toBeNull();
  });

  it("filtro combina com a lupa e 'Limpar filtros' devolve a lista; sem resultado há atalho para limpar", async () => {
    await montar();
    await marcar("Grupo", "Acessórios");
    await busca("azul");
    expect(cards()).toHaveLength(1); // Brinco/Azul (a Vestido/Azul é de Roupas)
    await busca("vestido");
    expect(cards()).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Nada encontrado com a busca e os filtros aplicados.");
    const limpar = Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent?.trim() === "Limpar filtros") as HTMLButtonElement | undefined
      ?? (Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Limpar filtros") as HTMLButtonElement);
    await act(async () => { limpar.click(); });
    await busca("");
    expect(cards()).toHaveLength(5); // 5 variantes + 1 em desenvolvimento
  });

  it("depois de filtrar os cards seguem arrastáveis (alça do useDraggable) e o '+' segue funcionando", async () => {
    const onAdicionar = vi.fn();
    await montar({ onAdicionar });
    await marcar("Grupo", "Acessórios");
    const lista = cards() as HTMLElement[];
    expect(lista).toHaveLength(3);
    for (const c of lista) expect(c.querySelector('[aria-roledescription="draggable"]')).not.toBeNull();
    await act(async () => { (lista[0].querySelector("button") as HTMLButtonElement).click(); });
    expect(onAdicionar).toHaveBeenCalledTimes(1);
    expect(onAdicionar.mock.calls[0][0]).toMatchObject({ modelo_id: "m3", grupo_nome: "Acessórios", eh_acessorio: true });
  });
});
