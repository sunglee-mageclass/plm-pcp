// @vitest-environment happy-dom
// Exportar dados — corpo da tela Exportar dados (ex-aba da Integração). Guardas do botão Baixar (nada marcado / sem coleção) e prévia vazia. Sem JSX (arquivo .ts).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { tenant_id: "t1" }, error: null }) }) }) }),
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

  it("tipo salvo ainda sem driver (tecido): aviso no lugar do corpo e NENHUMA RPC de export", async () => {
    localStorage.setItem("wish360:uipref:export:anon:tipo:tipo", JSON.stringify(["tecido"]));
    respostas({ colunas: ["nome"], total: 1, niveis: { "1": [{ nome: "x" }] } });
    const c = await montar();
    expect(c.textContent).toContain("ainda não está disponível");
    expect(c.querySelector("#exportar-colecao")).toBeNull();
    expect(botaoBaixar(c)).toBeUndefined();
    expect(rpc.mock.calls.some((a) => String(a[0]).startsWith("exportar_"))).toBe(false);
  });
});
