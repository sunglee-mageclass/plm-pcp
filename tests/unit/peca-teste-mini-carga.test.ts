// @vitest-environment happy-dom
// R11 T6 fix1 — carga da mini explosão (`useMiniExplosao`): (2) só consulta estoque/variantes quando `habilitado` (há Peça Teste), com staleTime e sem
// refetch no foco; (3) erro de QUALQUER das duas leituras vira `erro` (nunca "Carregando…" para sempre) e "Tentar de novo" refaz só a que falhou.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const V1 = "00000000-0000-4000-8000-0000000000c1";
const h = vi.hoisted(() => ({
  chamadas: [] as string[],
  falhaVariantes: { on: false },
  falhaEstoque: { on: false },
}));

vi.mock("@/hooks/useTenantModules", () => ({ useTenantModules: () => ({ isModuleEnabled: () => true }) }));
vi.mock("@/integrations/supabase/client", () => {
  const rpc = (nome: string) => {
    h.chamadas.push(`rpc:${nome}`);
    if (h.falhaEstoque.on) return Promise.resolve({ data: null, error: { message: "boom" } });
    return Promise.resolve({ data: { modo: "por_oc", tecidos: [], aviamentos: [], insumos: [] }, error: null });
  };
  const from = (tabela: string) => {
    h.chamadas.push(`from:${tabela}`);
    const q: any = {
      select: () => q, in: () => q,
      then: (ok: any, ko: any) => Promise.resolve(h.falhaVariantes.on ? { data: null, error: { message: "boom" } } : { data: [{ id: V1, cor_id: null, nome_variante: "Preto", codigo_variante: null, cor: { nome: "Preto" }, apelido: null }], error: null }).then(ok, ko),
    };
    return q;
  };
  return { supabase: { rpc, from } };
});

import { useMiniExplosao, type MiniApi } from "@/components/planejamento/planejamento-detail/useMiniExplosao";

const ficha: any = {
  habilitada: true, carregado: true,
  estado: { blocks: [{ tipo: "tecido", numero: 1, artigo_id: "a1", consumo: 1, loss_percent: 0, variantes: [V1], multiplicadores: [1], complementas: [null] }], aviamentos: [], etiquetas: [], grades: [] },
  dados: { aviamentoMap: {}, etiquetaMap: {}, tamanhos: [] },
};

let api: MiniApi;
let qc: QueryClient;
function Sonda({ habilitado }: { habilitado: boolean }) {
  api = useMiniExplosao({ modeloId: "m1", habilitado, ficha, tamanhoTipo: "letra" });
  return null;
}
const assentar = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
async function montar(habilitado: boolean) {
  qc = new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } });
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda, { habilitado }))); });
  await assentar();
  return root;
}

beforeEach(() => { h.chamadas.length = 0; h.falhaVariantes.on = false; h.falhaEstoque.on = false; });

describe("useMiniExplosao — carga só com Peça Teste", () => {
  it("habilitado=false: nenhuma RPC de estoque nem leitura de variantes", async () => {
    await montar(false);
    expect(h.chamadas).toEqual([]);
    expect(api.ativo).toBe(false);
  });
  it("habilitado=true: lê estoque e variantes; as duas queries têm staleTime e não refazem no foco da janela", async () => {
    await montar(true);
    expect(h.chamadas).toContain("rpc:peca_teste_mini_estoque");
    expect(h.chamadas).toContain("from:variantes_tecido");
    expect(api.pronta).toBe(true);
    for (const chave of ["peca-teste-mini-estoque", "peca-teste-mini-variantes"]) {
      const q = qc.getQueryCache().getAll().find((x) => x.queryKey[0] === chave)!;
      expect(q.observers[0].options.staleTime).toBe(30_000);
      expect(q.observers[0].options.refetchOnWindowFocus).toBe(false);
    }
    const antes = h.chamadas.length;
    window.dispatchEvent(new Event("focus"));
    await assentar();
    expect(h.chamadas.length).toBe(antes);
  });
  it("a Peça Teste que passa a existir no meio da sessão religa a carga (habilitado false → true)", async () => {
    qc = new QueryClient({ defaultOptions: { queries: { retryDelay: 1 } } });
    const root = createRoot(document.createElement("div"));
    await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda, { habilitado: false }))); });
    await assentar();
    expect(h.chamadas).toEqual([]);
    await act(async () => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda, { habilitado: true }))); });
    await assentar();
    expect(h.chamadas).toContain("rpc:peca_teste_mini_estoque");
  });
});

describe("useMiniExplosao — erro cobre as DUAS leituras", () => {
  it("falha das variantes: erro=true (não 'carregando'), pronta=false; 'Tentar de novo' refaz só a que falhou e destrava", async () => {
    h.falhaVariantes.on = true;
    await montar(true);
    expect(api.erro).toBe(true);
    expect(api.carregando).toBe(false);
    expect(api.pronta).toBe(false);
    h.falhaVariantes.on = false;
    h.chamadas.length = 0;
    await act(async () => { api.tentarDeNovo(); });
    await assentar();
    expect(h.chamadas).toEqual(["from:variantes_tecido"]); // o estoque já estava bom: não refaz
    expect(api.erro).toBe(false);
    expect(api.pronta).toBe(true);
  });
  it("falha do estoque: erro=true; depois de 'Tentar de novo' com sucesso, pronta=true", async () => {
    h.falhaEstoque.on = true;
    await montar(true);
    expect(api.erro).toBe(true);
    h.falhaEstoque.on = false;
    await act(async () => { api.tentarDeNovo(); });
    await assentar();
    expect(api.erro).toBe(false);
    expect(api.pronta).toBe(true);
  });
});
