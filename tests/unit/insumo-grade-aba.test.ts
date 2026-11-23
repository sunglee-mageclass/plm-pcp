/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/happy-dom */
// @vitest-environment happy-dom
// Grade "Lista" de Cadastro > Insumos (IN-1, fundação): render de verdade da `InsumosGradeAba` (shell) + `useInsumosGrade` com
// `supabase` mockado. Prova: 1 linha por COR (a contagem de cores), tamanhos da grade da loja (config ou padrão), erro HONESTO (C3 —
// nenhuma consulta que falha vira "vazio"/padrão), queryKeys únicas `insumos-grade`, e o placeholder do shell.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const estado = {
  etiquetas: [] as any[],
  variantes: [] as any[],
  tenantConfig: [{ tamanhos_grade: null }] as any[],
  falhaTabela: null as string | null,
  loja: "tenant1",
  lojaErro: false,
};
const chamadas: string[] = [];

function chain(t: string) {
  const eqs: Record<string, unknown> = {};
  const c: any = {
    select: () => c,
    order: () => c,
    range: () => c,
    limit: () => c,
    eq: (col: string, v: unknown) => {
      eqs[col] = v;
      return c;
    },
    then: (res: (v: unknown) => unknown) => {
      chamadas.push(t);
      if (estado.falhaTabela === t) return res({ data: null, error: { message: "falhou" } });
      const dados: Record<string, any[]> = {
        etiquetas: estado.etiquetas,
        variantes_etiqueta: estado.variantes,
        tipos_insumo: [{ id: "tp1", nome: "Cartão" }],
        cores: [
          { id: "azul", nome: "Azul" },
          { id: "verde", nome: "Verde" },
        ],
        tenant_config: estado.tenantConfig,
        empresas: [
          {
            id: "emp1",
            nome_fantasia: "Etiquetas Alfa",
            representantes: [{ id: "rep1", nome: "Ana" }],
            empresa_categorias_fornecedor: [{ categorias_fornecedor: { nome: "Etiquetas" } }],
          },
          {
            id: "emp2",
            nome_fantasia: "Tecelagem Beta",
            representantes: [],
            empresa_categorias_fornecedor: [{ categorias_fornecedor: { nome: "Tecidos" } }],
          },
        ],
      };
      return res({ data: dados[t] ?? [], error: null });
    },
  };
  return c;
}

const etq = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  nome: `Insumo ${id}`,
  unidade: "unidade",
  preco: 1,
  empresa_id: "emp1",
  representante_id: null,
  observacoes: null,
  formato_tamanho: "ambos",
  tipo_insumo_id: "tp1",
  tamanho_vinculado: null,
  created_at: "2026-01-01",
  ...extra,
});
const vr = (id: string, etiquetaId: string, corId: string | null, tamanho: string | null) => ({
  id,
  etiqueta_id: etiquetaId,
  cor_id: corId,
  tamanho,
  preco: 2,
  created_at: `2026-01-0${id.slice(-1)}`,
});

beforeEach(() => {
  estado.etiquetas = [etq("E1"), etq("E2")];
  estado.variantes = [
    vr("v1", "E1", "azul", "34|PPP"),
    vr("v2", "E1", "azul", "36|PP"),
    vr("v3", "E1", "verde", null),
  ]; // E1 = 2 cores (azul com 2 tamanhos, verde sem); E2 sem cor
  estado.tenantConfig = [{ tamanhos_grade: null }];
  estado.falhaTabela = null;
  estado.loja = "tenant1";
  estado.lojaErro = false;
  chamadas.length = 0;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = (ms = 40) =>
  act(async () => {
    await sleep(ms);
  });

async function montar(props: Record<string, unknown> = {}) {
  vi.resetModules();
  vi.doMock("@/integrations/supabase/client", () => ({
    supabase: { from: (t: string) => chain(t) },
  }));
  vi.doMock("@/hooks/useActiveTenantId", () => ({
    useActiveTenant: () => ({
      tenantId: estado.loja,
      resolvido: !!estado.loja,
      erro: estado.lojaErro,
      tentando: false,
      tentarDeNovo: vi.fn(),
    }),
  }));
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { InsumosGradeAba } = await import("@/components/insumo/grade/InsumosGradeAba");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(QueryClientProvider, { client: qc }, createElement(InsumosGradeAba, props)),
    );
  });
  await flush();
  return {
    container,
    qc,
    desmontar: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

describe("InsumosGradeAba (shell da fundação)", () => {
  it("mostra a contagem de insumos e de COR (não de cor×tamanho) e o placeholder", async () => {
    const t = await montar();
    const txt = t.container.textContent ?? "";
    expect(t.container.querySelector("[data-testid=insumos-grade-aba]")).not.toBeNull();
    expect(txt).toContain("2");
    expect(txt).toMatch(/2\s*insumos/);
    expect(txt).toMatch(/2\s*cores/); // azul + verde; os 2 tamanhos do azul NÃO viram cores
    expect(t.container.querySelector("[data-testid=insumos-grade-placeholder]")).not.toBeNull();
    await t.desmontar();
  });

  it("usa as queryKeys ÚNICAS 'insumos-grade' (não colide com as da tela)", async () => {
    const t = await montar();
    const keys = t.qc
      .getQueryCache()
      .getAll()
      .map((q) => String(q.queryKey[0]));
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys)).toEqual(new Set(["insumos-grade"]));
    await t.desmontar();
  });

  it("a prop `etiquetas` restringe os insumos mostrados (filtro da tela)", async () => {
    const t = await montar({ etiquetas: [{ id: "E2" }] });
    const txt = t.container.textContent ?? "";
    expect(txt).toMatch(/1\s*insumo\b/);
    expect(txt).toMatch(/0\s*cores/);
    await t.desmontar();
  });

  it("avisa a tela-mãe que não há rascunho (onDirtyChange(false)) e não mostra o placeholder no celular", async () => {
    const onDirtyChange = vi.fn();
    const t = await montar({ onDirtyChange, isMobile: true });
    expect(onDirtyChange).toHaveBeenCalledWith(false);
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
    expect(t.container.querySelector("[data-testid=insumos-grade-placeholder]")).toBeNull();
    await t.desmontar();
  });

  it("C3: leitura que falha mostra aviso + 'Tentar de novo' e NUNCA '0 insumos'", async () => {
    estado.falhaTabela = "etiquetas";
    const t = await montar();
    const txt = t.container.textContent ?? "";
    expect(t.container.querySelector("[role=alert]")).not.toBeNull();
    expect(txt).toContain("Não foi possível carregar a lista de insumos.");
    expect(txt).toContain("Tentar de novo");
    expect(txt).not.toMatch(/0\s*insumos/);
    expect(t.container.querySelector("[data-testid=insumos-grade-placeholder]")).toBeNull();
    await t.desmontar();
  });

  it("C3: a config de tamanhos que falha NÃO cai no padrão calado — vira erro", async () => {
    estado.falhaTabela = "tenant_config";
    const t = await montar();
    expect(t.container.querySelector("[role=alert]")).not.toBeNull();
    await t.desmontar();
  });

  it("loja ainda sem resolver = carregando (não se dá por pronta com o padrão)", async () => {
    estado.loja = "";
    const t = await montar();
    const txt = t.container.textContent ?? "";
    expect(txt).toContain("Carregando…");
    expect(txt).not.toMatch(/insumos/);
    expect(chamadas).not.toContain("tenant_config");
    await t.desmontar();
  });
});

describe("useInsumosGrade (opções e dados)", () => {
  async function rodarHook() {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client", () => ({
      supabase: { from: (t: string) => chain(t) },
    }));
    vi.doMock("@/hooks/useActiveTenantId", () => ({
      useActiveTenant: () => ({
        tenantId: estado.loja,
        resolvido: true,
        erro: false,
        tentando: false,
        tentarDeNovo: vi.fn(),
      }),
    }));
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { useInsumosGrade } = await import("@/components/insumo/grade/useInsumosGrade");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let ultimo: ReturnType<typeof useInsumosGrade> | null = null;
    function Sonda() {
      ultimo = useInsumosGrade();
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client: qc }, createElement(Sonda)));
    });
    await flush();
    return { get: () => ultimo!, desmontar: () => act(async () => root.unmount()) };
  }

  it("entrega o shape do brief: etiquetas, blocosPorEtiqueta (etiqueta→cor) e opções", async () => {
    const h = await rodarHook();
    const d = h.get();
    expect(d.isLoading).toBe(false);
    expect(d.isError).toBe(false);
    expect(d.etiquetas.map((e) => e.id)).toEqual(["E1", "E2"]);
    expect(d.blocosPorEtiqueta.get("E1")).toEqual([
      { cor_id: "azul", preco: 2, tamanhos: ["34|PPP", "36|PP"] },
      { cor_id: "verde", preco: 2, tamanhos: [] },
    ]);
    expect(d.blocosPorEtiqueta.get("E2")).toBeUndefined();
    expect(d.opcoes.tipos).toEqual([{ id: "tp1", nome: "Cartão" }]);
    expect(d.opcoes.cores.map((c) => c.id)).toEqual(["azul", "verde"]);
    expect(d.opcoes.empresas.map((e) => [e.id, e.ehInsumo])).toEqual([
      ["emp1", true],
      ["emp2", false],
    ]);
    expect(d.opcoes.representantes).toEqual([{ id: "rep1", nome: "Ana", empresa_id: "emp1" }]);
    await h.desmontar();
  });

  it("tamanhosGrade: sem config = padrão da loja nova; com config = o da loja", async () => {
    let h = await rodarHook();
    expect(h.get().opcoes.tamanhosGrade).toEqual([
      "34|PPP",
      "36|PP",
      "38|P",
      "40|M",
      "42|G",
      "44|GG",
    ]);
    await h.desmontar();

    estado.tenantConfig = [{ tamanhos_grade: ["XS|XS", { nome: "S|S" }] }];
    h = await rodarHook();
    expect(h.get().opcoes.tamanhosGrade).toEqual(["XS|XS", "S|S"]);
    await h.desmontar();
  });
});
