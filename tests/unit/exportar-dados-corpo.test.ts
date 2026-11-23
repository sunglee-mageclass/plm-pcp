// @vitest-environment happy-dom
// Exportar dados — corpo da tela Exportar dados (ex-aba da Integração). Guardas do botão Baixar (nada marcado / sem coleção) e prévia vazia. Sem JSX (arquivo .ts).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.fn();
// Opções de cadastro da loja (tecido/aviamento/insumo): `from(tabela).select().eq().order()`; `maybeSingle` segue para o resto da tela.
const opcoes = vi.hoisted(() => ({} as Record<string, { id: string; nome: string }[]>));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { tenant_id: "t1" }, error: null }),
          order: async () => ({ data: opcoes[tabela] ?? [], error: null }),
        }),
      }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null, loading: false, canView: () => true, canEdit: () => true }) }));
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const baixarExport = vi.fn();
vi.mock("@/lib/integracao/export", () => ({ baixarExport: (...a: unknown[]) => baixarExport(...a) }));

import { ExportarDados } from "@/components/exportar/ExportarDados";

const montados: { unmount: () => void; el: HTMLElement }[] = [];
async function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  montados.push({ unmount: () => root.unmount(), el: container });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(ExportarDados)));
  });
  // coleções -> subcoleções -> prévia: cada passo depende do anterior (várias voltas do event loop).
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return container;
}
const botaoBaixar = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("button")).find((b) => /baixar/i.test(b.textContent ?? "")) as HTMLButtonElement | undefined;

afterEach(() => {
  for (const m of montados.splice(0)) { act(() => m.unmount()); m.el.remove(); }
});

beforeEach(() => {
  rpc.mockReset();
  baixarExport.mockReset();
  for (const k of Object.keys(opcoes)) delete opcoes[k];
  localStorage.clear();
  rpc.mockResolvedValue({ data: { colecoes: [], subcolecoes: [] }, error: null });
});

describe("ExportarDados (corpo)", () => {
  it("botão Baixar desabilitado quando nada está marcado", async () => {
    const c = await montar();
    expect(botaoBaixar(c)?.disabled).toBe(true);
  });

  it("sem coleção: avisa para escolher e NÃO chama exportar_produtos", async () => {
    const c = await montar();
    expect(c.textContent).toContain("Escolha uma coleção");
    expect(rpc.mock.calls.some((a) => a[0] === "exportar_produtos")).toBe(false);
  });

  it("mostra as 27 colunas e os 3 níveis, todos desmarcados", async () => {
    const c = await montar();
    const caixas = Array.from(c.querySelectorAll('button[role="checkbox"]')) as HTMLElement[];
    expect(caixas.length).toBe(27 + 3);
    expect(caixas.every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
  });

  const semear = (colecao: string, colunas: string[], niveis: string[]) => {
    const k = (chave: string) => `wish360:uipref:export:anon:integracao:${chave}`;
    localStorage.setItem(k("colecao"), JSON.stringify([colecao]));
    localStorage.setItem(k("colunas"), JSON.stringify(colunas));
    localStorage.setItem(k("niveis"), JSON.stringify(niveis));
  };
  const respostas = (previa: unknown) => {
    rpc.mockImplementation(async (nome: string) => {
      if (nome === "opcoes_colecao_modelos") return { data: { colecoes: ["Verão"], subcolecoes: [] }, error: null };
      if (nome === "exportar_subcolecoes") return { data: ["R1", "R2"], error: null };
      if (nome === "exportar_produtos") return { data: previa, error: null };
      return { data: null, error: null };
    });
  };

  it("prefs salvas: prévia usa o menor nível marcado, ignora coluna inválida e pede 20 produtos", async () => {
    semear("Verão", ["nome", "coluna_que_nao_existe", "tamanho"], ["3", "1"]);
    respostas({
      colunas: ["nome", "tamanho"],
      total: 57,
      niveis: { "1": [{ nome: "Vestido A", tamanho: null }], "3": [{ nome: "Vestido A", tamanho: "M" }] },
    });
    const c = await montar();
    const chamada = rpc.mock.calls.find((a) => a[0] === "exportar_produtos");
    expect(chamada?.[1]).toEqual({ _colecao: "Verão", _subcolecao: null, _campos: ["nome", "tamanho"], _niveis: ["1", "3"], _limite: 20 });
    expect(c.textContent).toContain("Mostrando 20 produtos de 57");
    expect(c.textContent).toContain("SKU pai"); // o menor nível (1)
    expect(c.textContent).toContain("Vestido A");
    expect(c.querySelectorAll("tbody tr").length).toBe(1); // linhas do nível 1, não as do 3
    expect(botaoBaixar(c)?.disabled).toBe(false);
  });

  it("recorte sem produtos: mostra 'Nenhum produto neste recorte.'", async () => {
    semear("Verão", ["nome"], ["1"]);
    respostas({ colunas: ["nome"], total: 0, niveis: { "1": [] } });
    const c = await montar();
    expect(c.textContent).toContain("Nenhum produto neste recorte.");
  });

  it("coleção salva que não existe mais na loja = não escolhida (nada é consultado)", async () => {
    semear("Coleção apagada", ["nome"], ["1"]);
    respostas({ colunas: ["nome"], total: 1, niveis: { "1": [{ nome: "x" }] } });
    const c = await montar();
    expect(c.textContent).toContain("Escolha uma coleção");
    expect(rpc.mock.calls.some((a) => a[0] === "exportar_produtos")).toBe(false);
    expect(botaoBaixar(c)?.disabled).toBe(true);
  });

  // ---- "Todas as coleções": escolha EXPLÍCITA (3 estados: nada / todas / uma coleção) ----
  const TODAS_COLECOES = "__todas_colecoes__";

  it("estado inicial VAZIO não vira 'todas': sem escolha, nem com colunas e níveis marcados, nada é consultado e Baixar fica desabilitado", async () => {
    const k = (chave: string) => `wish360:uipref:export:anon:integracao:${chave}`;
    localStorage.setItem(k("colunas"), JSON.stringify(["nome"]));
    localStorage.setItem(k("niveis"), JSON.stringify(["1"]));
    respostas({ colunas: ["nome"], total: 9, niveis: { "1": [{ nome: "x" }] } });
    const c = await montar();
    expect(rpc.mock.calls.some((a) => a[0] === "exportar_produtos")).toBe(false);
    expect(c.textContent).toContain("Escolha uma coleção");
    expect(botaoBaixar(c)?.disabled).toBe(true);
  });

  it("'Todas as coleções' escolhida: prévia e download mandam _colecao null (loja inteira), sem subcoleção, e Baixar habilita", async () => {
    semear(TODAS_COLECOES, ["nome"], ["1"]);
    respostas({ colunas: ["nome"], total: 321, niveis: { "1": [{ nome: "Vestido A" }] } });
    const c = await montar();
    const previa = rpc.mock.calls.find((a) => a[0] === "exportar_produtos");
    expect(previa?.[1]).toEqual({ _colecao: null, _subcolecao: null, _campos: ["nome"], _niveis: ["1"], _limite: 20 });
    expect(rpc.mock.calls.some((a) => a[0] === "exportar_subcolecoes")).toBe(false); // subcoleção é POR coleção
    expect(c.textContent).toContain("Mostrando 20 produtos de 321");
    const sub = c.querySelector("#exportar-subcolecao") as HTMLButtonElement;
    expect(sub.disabled).toBe(true);
    expect(botaoBaixar(c)?.disabled).toBe(false);
    rpc.mockClear();
    await act(async () => { botaoBaixar(c)!.click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const baixa = rpc.mock.calls.find((a) => a[0] === "exportar_produtos");
    expect(baixa?.[1]).toEqual({ _colecao: null, _subcolecao: null, _campos: ["nome"], _niveis: ["1"], _limite: null }); // sem limite
    expect(baixarExport).toHaveBeenCalledTimes(1);
  });

  it("'Todas as coleções' ainda exige colunas e níveis: sem eles, Baixar fica desabilitado", async () => {
    semear(TODAS_COLECOES, [], []);
    respostas({ colunas: [], total: 0, niveis: {} });
    const c = await montar();
    expect(botaoBaixar(c)?.disabled).toBe(true);
    expect(rpc.mock.calls.some((a) => a[0] === "exportar_produtos")).toBe(false);
  });
  // ---- Seletor de TIPO (Task 4): produto é o padrão e o corpo do produto é o de sempre ----
  it("seletor de tipo: sem pref = Produto (corpo do produto montado, mesmas prefs)", async () => {
    const c = await montar();
    const tipo = c.querySelector("#exportar-tipo") as HTMLButtonElement;
    expect(tipo).toBeTruthy();
    expect(tipo.textContent).toContain("Produto");
    expect(c.querySelector("#exportar-colecao")).toBeTruthy();
  });

  // ---- Drivers tecido / aviamento / insumo (Task 5): filtro do tipo, RPC do tipo, prefs por tipo ----
  const prefTipo = (tela: string, chave: string, valor: string[]) =>
    localStorage.setItem(`wish360:uipref:export:anon:${tela}:${chave}`, JSON.stringify(valor));
  const escolherTipo = (t: string) => localStorage.setItem("wish360:uipref:export:anon:tipo:tipo", JSON.stringify([t]));
  const respostaTipo = (rpcNome: string, previa: unknown) => {
    rpc.mockImplementation(async (nome: string) => (nome === rpcNome ? { data: previa, error: null } : { data: null, error: null }));
  };
  const chamadasExport = () => rpc.mock.calls.filter((a) => String(a[0]).startsWith("exportar_"));

  it("tipo tecido: monta o corpo do tecido (filtro Categoria, 2 níveis, aviso 'cabeçalho'); nada é consultado sem escolha", async () => {
    escolherTipo("tecido");
    opcoes.categorias_tecido = [{ id: "c1", nome: "Malha" }];
    prefTipo("tecido", "colunas", ["nome"]);
    prefTipo("tecido", "niveis", ["1"]);
    respostaTipo("exportar_tecidos", { colunas: ["nome"], total: 5, niveis: { "1": [{ nome: "x" }] } });
    const c = await montar();
    expect(c.querySelector("#exportar-colecao")).toBeNull();
    expect(c.querySelector("#exportar-tecido-categoria")).toBeTruthy();
    expect(c.textContent).toContain("Escolha uma categoria");
    expect(c.textContent).toContain("1. Cabeçalho");
    expect(c.textContent).toContain("2. Até variante");
    expect(c.textContent).toContain("vazios no cabeçalho");
    expect(c.textContent).not.toContain("SKU pai");
    expect(chamadasExport()).toHaveLength(0);
    expect(botaoBaixar(c)?.disabled).toBe(true);
  });

  it("tecido: 'Todas as categorias' (sentinela) -> _categoria null, prévia 20 itens, Baixar sem limite e nome-base do tipo", async () => {
    escolherTipo("tecido");
    prefTipo("tecido", "categoria", ["__todos__"]);
    prefTipo("tecido", "colunas", ["nome", "coluna_que_nao_existe"]);
    prefTipo("tecido", "niveis", ["2", "1"]);
    respostaTipo("exportar_tecidos", { colunas: ["nome"], total: 7, niveis: { "1": [{ nome: "Viscose" }], "2": [] } });
    const c = await montar();
    expect(chamadasExport()[0][0]).toBe("exportar_tecidos");
    expect(chamadasExport()[0][1]).toEqual({ _categoria: null, _campos: ["nome"], _niveis: ["1", "2"], _limite: 20 });
    expect(c.textContent).toContain("Mostrando 7 tecidos de 7");
    expect(c.textContent).toContain("Viscose");
    rpc.mockClear();
    await act(async () => { botaoBaixar(c)!.click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(chamadasExport()[0][1]).toEqual({ _categoria: null, _campos: ["nome"], _niveis: ["1", "2"], _limite: null });
    expect(baixarExport).toHaveBeenCalledTimes(1);
    const [dados, niveis, nomeBase, opts] = baixarExport.mock.calls[0];
    expect(dados.total).toBe(7);
    expect(niveis).toEqual(["1", "2"]);
    expect(nomeBase).toBe("export-tecido-todas");
    expect(opts.nomeAba).toEqual({ "1": "Cabeçalho", "2": "Até variante" });
    expect(opts.keysValidas.has("categorias")).toBe(true);
  });

  it("tecido: categoria específica vai como id; categoria que sumiu da loja = não escolhida (nada é consultado)", async () => {
    escolherTipo("tecido");
    opcoes.categorias_tecido = [{ id: "c1", nome: "Malha" }];
    prefTipo("tecido", "categoria", ["c1"]);
    prefTipo("tecido", "colunas", ["nome"]);
    prefTipo("tecido", "niveis", ["1"]);
    respostaTipo("exportar_tecidos", { colunas: ["nome"], total: 1, niveis: { "1": [{ nome: "x" }] } });
    await montar();
    expect(chamadasExport()[0][1]._categoria).toBe("c1");
    for (const m of montados.splice(0)) { act(() => m.unmount()); m.el.remove(); }
    rpc.mockClear();
    prefTipo("tecido", "categoria", ["id-que-sumiu"]);
    const c2 = await montar();
    expect(chamadasExport()).toHaveLength(0);
    expect(c2.textContent).toContain("Escolha uma categoria");
    expect(botaoBaixar(c2)?.disabled).toBe(true);
  });

  it("aviamento: 2 filtros independentes; só o Material escolhido -> categoria null (Todas) e material como id", async () => {
    escolherTipo("aviamento");
    opcoes.categorias_aviamento = [{ id: "ca1", nome: "Botões" }];
    opcoes.materiais_aviamento = [{ id: "m1", nome: "Metal" }];
    prefTipo("aviamento", "material", ["m1"]);
    prefTipo("aviamento", "colunas", ["nome"]);
    prefTipo("aviamento", "niveis", ["1"]);
    respostaTipo("exportar_aviamentos", { colunas: ["nome"], total: 2, niveis: { "1": [{ nome: "Botão" }] } });
    const c = await montar();
    expect(c.querySelector("#exportar-aviamento-categoria")).toBeTruthy();
    expect(c.querySelector("#exportar-aviamento-material")).toBeTruthy();
    expect(chamadasExport()[0][0]).toBe("exportar_aviamentos");
    expect(chamadasExport()[0][1]).toEqual({ _categoria: null, _material: "m1", _campos: ["nome"], _niveis: ["1"], _limite: 20 });
    expect(c.textContent).toContain("Mostrando 2 aviamentos de 2");
    rpc.mockClear();
    await act(async () => { botaoBaixar(c)!.click(); });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(baixarExport.mock.calls[0][2]).toBe("export-aviamento-todas-m1");
  });

  it("aviamento: nenhum dos dois escolhido NUNCA vira 'todos' (nada consultado, Baixar desabilitado)", async () => {
    escolherTipo("aviamento");
    prefTipo("aviamento", "colunas", ["nome"]);
    prefTipo("aviamento", "niveis", ["1"]);
    respostaTipo("exportar_aviamentos", { colunas: ["nome"], total: 9, niveis: { "1": [] } });
    const c = await montar();
    expect(chamadasExport()).toHaveLength(0);
    expect(c.textContent).toContain("Escolha uma categoria e/ou um material");
    expect(botaoBaixar(c)?.disabled).toBe(true);
  });

  it("insumo: filtro Tipo de insumo, nível 2 'cor × tamanho', RPC exportar_insumos com _tipo_insumo", async () => {
    escolherTipo("insumo");
    opcoes.tipos_insumo = [{ id: "t9", nome: "Etiqueta" }];
    prefTipo("insumo", "tipo_insumo", ["t9"]);
    prefTipo("insumo", "colunas", ["nome", "cor"]);
    prefTipo("insumo", "niveis", ["1", "2"]);
    respostaTipo("exportar_insumos", { colunas: ["nome", "cor"], total: 3, niveis: { "1": [{ nome: "Etiq A" }], "2": [] } });
    const c = await montar();
    expect(c.querySelector("#exportar-insumo-tipo")).toBeTruthy();
    expect(c.textContent).toContain("2. Até variante (cor × tamanho)");
    expect(chamadasExport()[0][0]).toBe("exportar_insumos");
    expect(chamadasExport()[0][1]).toEqual({ _tipo_insumo: "t9", _campos: ["nome", "cor"], _niveis: ["1", "2"], _limite: 20 });
    expect(c.textContent).toContain("Mostrando 3 insumos de 3");
  });

  it("prefs por tipo não se misturam: colunas do tecido não aparecem marcadas no produto e vice-versa", async () => {
    prefTipo("tecido", "colunas", ["nome"]);
    prefTipo("tecido", "niveis", ["1"]);
    const c = await montar(); // tipo = produto (padrão)
    const caixas = Array.from(c.querySelectorAll('button[role="checkbox"]')) as HTMLElement[];
    expect(caixas.every((b) => b.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("tipo desconhecido salvo cai em Produto (nenhum tipo fica sem driver)", async () => {
    escolherTipo("xyz");
    const c = await montar();
    expect(c.querySelector("#exportar-colecao")).toBeTruthy();
    expect(c.textContent).not.toContain("ainda não está disponível");
  });
});
