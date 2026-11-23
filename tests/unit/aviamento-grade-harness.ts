/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom (mesmo padrão dos testes da grade de Tecidos) */
// Harness dos testes da grade "Lista" de Aviamentos (AV-2): `supabase` em memória + Select do Radix vira botões + render real da
// `AviamentosGradeAba`. Os testes importam daqui (nada de `.test` no nome: não é suíte).
import { vi } from "vitest";
import { act, createContext, createElement, useContext } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export type Linha = Record<string, any>;

export const aviamento = (id: string, extra: Linha = {}): Linha => ({
  id,
  codigo: `COD-${id}`,
  codigo_nome: `Aviamento ${id}`,
  empresa_id: "emp1",
  representante_id: null,
  categoria_aviamento_id: "cat1",
  subcategoria_aviamento_id: "sub1",
  material_aviamento_id: "mat1",
  composicao: null,
  preco: 2,
  ncm: null,
  observacoes: null,
  intervalo_largura_id: null,
  largura_exata: null,
  intervalo_vazado_id: null,
  largura_exata_vazado: null,
  foto_url: null,
  created_at: "2026-01-01",
  ...extra,
});
export const variante = (id: string, aviamentoId: string, extra: Linha = {}): Linha => ({
  id,
  aviamento_id: aviamentoId,
  cor_id: "cor1",
  cor_apelido_id: null,
  nome_variante: null,
  codigo_variante: null,
  preco: 2,
  foto_url: null,
  created_at: `2026-01-0${id.slice(-1)}`,
  ...extra,
});

export const estado = {
  aviamentos: [] as Linha[],
  variantes: [] as Linha[],
  /** tabela cuja leitura falha */
  falhaTabela: null as string | null,
  /** aviamentos cujo UPDATE falha com 23505 (nome repetido no fornecedor) */
  duplicado: new Set<string>(),
  /** aviamentos cujo UPDATE falha com 23505 (código repetido na loja) */
  duplicadoCodigo: new Set<string>(),
  /** aviamentos cujo UPDATE devolve 0 linhas (excluído) */
  sumiu: new Set<string>(),
  /** erro do lote de cores (RPC `salvar_variantes_aviamento`) */
  erroLote: null as null | { code?: string; message: string },
  falhaUpload: false,
};
export const ordem: string[] = [];
export const aviamentoUpdates: Array<{
  payload: Linha;
  id: unknown;
  eqs: Record<string, unknown>;
}> = [];
export const variantesUpdates: Array<{ payload: Linha; id: unknown }> = [];
export const rpc = vi.fn();
export const upload = vi.fn();
export const remove = vi.fn();
export const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

function chain(t: string) {
  let op = "select";
  let payload: Linha = {};
  const eqs: Record<string, unknown> = {};
  const c: any = {
    select: () => c,
    order: () => c,
    range: () => c,
    eq: (col: string, v: unknown) => {
      eqs[col] = v;
      return c;
    },
    update: (p: Linha) => {
      op = "update";
      payload = p;
      return c;
    },
    then: (res: (v: unknown) => unknown) => {
      if (estado.falhaTabela === t) return res({ data: null, error: { message: "falhou" } });
      if (t === "aviamentos" && op === "update") {
        const id = eqs.id as string;
        if (estado.duplicado.has(id)) {
          return res({
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "uq_aviamento_codigo_fornecedor"',
              details: "",
            },
          });
        }
        if (estado.duplicadoCodigo.has(id)) {
          return res({
            data: null,
            error: {
              code: "23505",
              message:
                'duplicate key value violates unique constraint "ux_aviamentos_tenant_codigo"',
              details: "",
            },
          });
        }
        if (estado.sumiu.has(id)) return res({ data: [], error: null });
        ordem.push(`aviamentos.update:${id}`);
        aviamentoUpdates.push({ payload, id, eqs });
        const a = estado.aviamentos.find((x) => x.id === id)!;
        Object.assign(a, payload);
        return res({ data: [{ id }], error: null });
      }
      if (t === "variantes_aviamento" && op === "update") {
        variantesUpdates.push({ payload, id: eqs.id });
        Object.assign(estado.variantes.find((x) => x.id === eqs.id)!, payload);
        return res({ data: null, error: null });
      }
      if (t === "variantes_aviamento" && op === "select" && eqs.aviamento_id) {
        return res({
          data: estado.variantes
            .filter((v) => v.aviamento_id === eqs.aviamento_id)
            .map((v) => ({ ...v })),
          error: null,
        });
      }
      const dados: Record<string, Linha[]> = {
        aviamentos: estado.aviamentos.map((a) => ({ ...a })),
        variantes_aviamento: estado.variantes.map((v) => ({ ...v })),
        categorias_aviamento: [
          { id: "cat1", nome: "Botões" },
          { id: "cat2", nome: "Zíperes" },
        ],
        subcategorias_aviamento: [
          { id: "sub1", nome: "Pressão", categoria_aviamento_id: "cat1" },
          { id: "sub2", nome: "Metal", categoria_aviamento_id: "cat1" },
          { id: "sub3", nome: "Invisível", categoria_aviamento_id: "cat2" },
        ],
        materiais_aviamento: [
          { id: "mat1", nome: "Plástico" },
          { id: "mat2", nome: "Latão" },
        ],
        cores: [
          { id: "cor1", nome: "Azul" },
          { id: "cor2", nome: "Verde" },
        ],
        cores_apelido: [{ id: "ap1", nome: "Marinho", cor_base_id: "cor1" }],
        intervalos_largura: [
          { id: "int1", intervalo: "1 a 2 cm" },
          { id: "int2", intervalo: "2 a 4 cm" },
        ],
        empresas: [
          {
            id: "emp1",
            nome_fantasia: "Armarinho Alfa",
            representantes: [{ id: "rep1", nome: "Ana" }],
            empresa_categorias_fornecedor: [{ categorias_fornecedor: { nome: "Aviamentos" } }],
          },
          {
            id: "emp2",
            nome_fantasia: "Tecelagem Beta",
            representantes: [],
            empresa_categorias_fornecedor: [{ categorias_fornecedor: { nome: "Tecidos" } }],
          },
          {
            id: "emp3",
            nome_fantasia: "Botões Gama",
            representantes: [{ id: "rep3", nome: "Beto" }],
            empresa_categorias_fornecedor: [{ categorias_fornecedor: { nome: "Aviamento" } }],
          },
        ],
      };
      return res({ data: dados[t] ?? [], error: null });
    },
  };
  return c;
}

export const supabaseMock = {
  rpc: (...a: unknown[]) => rpc(...a),
  from: (t: string) => chain(t),
  channel: () => ({
    on: () => ({ subscribe: () => ({}) }),
    subscribe: () => ({}),
    unsubscribe: vi.fn(),
  }),
  removeChannel: vi.fn(),
  storage: {
    from: (b: string) => ({
      upload: (...a: unknown[]) => upload(b, ...a),
      remove: (...a: unknown[]) => remove(b, ...a),
    }),
  },
};

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const flush = (ms = 30) =>
  act(async () => {
    await sleep(ms);
  });

export function mocks() {
  vi.resetModules();
  vi.doMock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));
  vi.doMock("sonner", () => ({ toast }));
  vi.doMock("@tanstack/react-router", () => ({
    createFileRoute: () => () => ({ useParams: () => ({}) }),
    Link: (p: any) => createElement("a", null, p.children),
    useNavigate: () => vi.fn(),
    useBlocker: () => ({ status: "idle" as const, proceed: vi.fn(), reset: vi.fn() }),
  }));
  vi.doMock("@/components/ui/sidebar", () => ({ useSidebar: () => ({ state: "expanded" }) }));
  // link assinado mockado: (caminho, bucket) -> URL fixa (prova de qual bucket a miniatura lê)
  vi.doMock("@/hooks/useSignedUrl", () => ({
    useSignedUrl: (p: string | null, bucket?: string) =>
      p ? `https://assinado.test/${bucket}/${p}` : null,
    VARIANT_BUCKET: "variantes",
  }));
  vi.doMock("@/hooks/useColabRegistro", () => ({ useColabRegistro: () => ({ presentes: [] }) }));
  vi.doMock("@/components/shared/ColabPresenceOverlay", () => ({
    ColabPresenceOverlay: () => null,
  }));
  vi.doMock("@/components/shared/Breadcrumb", () => ({ Breadcrumb: () => null }));
  vi.doMock("@/components/ui/select", () => {
    const Ctx = createContext<{ onValueChange?: (v: string) => void; disabled?: boolean }>({});
    return {
      Select: (p: any) =>
        createElement(
          Ctx.Provider,
          { value: { onValueChange: p.onValueChange, disabled: p.disabled } },
          createElement("div", { "data-select": "", "data-value": p.value ?? "" }, p.children),
        ),
      SelectTrigger: (p: any) =>
        createElement("span", { "aria-label": p["aria-label"], "data-trigger-class": p.className }),
      SelectValue: () => null,
      SelectContent: (p: any) => createElement("div", null, p.children),
      SelectItem: (p: any) => {
        const c = useContext(Ctx);
        return createElement(
          "button",
          {
            type: "button",
            "data-item": p.value,
            disabled: c.disabled,
            onClick: () => c.onValueChange?.(p.value),
          },
          p.children,
        );
      },
    };
  });
}

export function resetar() {
  estado.aviamentos = [
    aviamento("av1", { codigo_nome: "Botão" }),
    aviamento("av2", { codigo_nome: "Zíper", subcategoria_aviamento_id: null }),
  ];
  estado.variantes = [
    variante("v1", "av1"),
    variante("v2", "av1", { cor_id: "cor2", nome_variante: "Verde bandeira", preco: 3 }),
  ]; // av2 sem cores
  estado.falhaTabela = null;
  estado.duplicado = new Set();
  estado.duplicadoCodigo = new Set();
  estado.sumiu = new Set();
  estado.erroLote = null;
  estado.falhaUpload = false;
  ordem.length = 0;
  aviamentoUpdates.length = 0;
  variantesUpdates.length = 0;
  rpc.mockReset();
  rpc.mockImplementation(async (nome: string, args: any) => {
    if (nome === "get_user_tenant_id") return { data: "tenant1", error: null };
    if (nome === "salvar_variantes_aviamento") {
      if (estado.erroLote) return { data: null, error: estado.erroLote };
      ordem.push("rpc:variantes");
      // aplica como a RPC: update dos ids reenviados (os que faltam seriam apagados)
      for (const v of args._variantes as Linha[])
        Object.assign(estado.variantes.find((x) => x.id === v.id)!, v);
      return { data: { aviamento_id: args._aviamento_id }, error: null };
    }
    return { error: null };
  });
  upload.mockReset();
  upload.mockImplementation(async () => ({
    error: estado.falhaUpload ? { message: "falhou" } : null,
  }));
  remove.mockReset();
  remove.mockImplementation(async () => ({ error: null }));
  Object.values(toast).forEach((f) => f.mockReset());
}

export type Montado = { container: HTMLElement; qc: any; desmontar: () => Promise<void> };

/** Clica o chevron de cada aviamento ainda recolhido (a lista nasce só com os cabeçalhos). */
export async function expandirTudo(container: ParentNode): Promise<void> {
  const fechados = Array.from(
    container.querySelectorAll('[data-acao="alternar-cores"][aria-expanded="false"]'),
  ) as HTMLElement[];
  for (const b of fechados)
    await act(async () => {
      b.click();
    });
}

export async function esperarLinhas(container: HTMLElement) {
  for (
    let i = 0;
    i < 40 &&
    container.querySelectorAll("tbody tr").length === 0 &&
    !container.querySelector("[role=alert]");
    i++
  )
    await flush(30);
  await flush(30);
}

/** Monta a Aba sozinha. `expandir=false` mantém os aviamentos como nascem (recolhidos). */
export async function montar(
  aviamentosProp: Linha[] | undefined,
  extra: Record<string, unknown> = {},
  expandir = true,
): Promise<Montado> {
  mocks();
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { AviamentosGradeAba } = await import("@/components/aviamento/grade/AviamentosGradeAba");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(AviamentosGradeAba, { aviamentos: aviamentosProp as any, ...extra }),
      ),
    );
  });
  await esperarLinhas(container);
  if (expandir) await expandirTudo(container);
  return {
    container,
    qc,
    desmontar: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      document.body.innerHTML = "";
    },
  };
}

export const PROPS = () => estado.aviamentos.map((a) => ({ id: a.id }));
export const linhas = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("tbody tr")) as HTMLElement[];
export const porLabel = (root: ParentNode, label: string) =>
  Array.from(root.querySelectorAll(`[aria-label="${label}"]`)) as HTMLInputElement[];
export function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto =
    el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  return act(async () => {
    set.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
export const clicar = (el: Element | null | undefined) =>
  act(async () => {
    (el as HTMLElement).click();
  });
export const botaoSalvar = () =>
  Array.from(document.body.querySelectorAll("button")).find((b) =>
    b.textContent?.startsWith("Salvar"),
  ) as HTMLButtonElement | undefined;
export const selos = (c: HTMLElement) => c.querySelectorAll("[data-selo-nao-salvo]").length;
export const salvaLotes = () => rpc.mock.calls.filter((c) => c[0] === "salvar_variantes_aviamento");
/** O `<div data-select>` do Select cujo gatilho tem este aria-label. */
export const seletor = (raiz: ParentNode, label: string) =>
  Array.from(raiz.querySelectorAll("[data-select]")).find((d) =>
    d.querySelector(`[aria-label="${label}"]`),
  ) as HTMLElement | undefined;
