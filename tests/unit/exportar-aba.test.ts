// @vitest-environment happy-dom
// Exportar dados — Task 5: aba Exportar. Guardas do botão Baixar (nada marcado / sem coleção) e prévia vazia. Sem JSX (arquivo .ts).
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

import { ExportarAba } from "@/components/integracao/ExportarAba";

const montados: { unmount: () => void; el: HTMLElement }[] = [];
async function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  montados.push({ unmount: () => root.unmount(), el: container });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(ExportarAba)));
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
  localStorage.clear();
  rpc.mockResolvedValue({ data: { colecoes: [], subcolecoes: [] }, error: null });
});

describe("ExportarAba", () => {
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
});
