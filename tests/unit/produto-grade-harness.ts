/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom (mesmo padrão do harness da grade de Insumos) */
// Harness dos testes da grade "Lista" do Planejamento de Produto: `supabase` em memória (com o CAS por `rev` do UPDATE) + Select do Radix
// vira botões + render real da `ProdutosGradeAba`. Os testes importam daqui (nada de `.test` no nome: não é suíte).
import { vi } from "vitest";
import { act, createContext, createElement, useContext } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export type Linha = Record<string, any>;

export const estado = {
  modelos: [] as Linha[],
  /** tabela cuja leitura falha */
  falhaTabela: null as string | null,
  otb: false,
  permissoes: new Set<string>(),
  todasPermissoes: false,
  /** resposta crua da RPC `integracao_estado_modelos` */
  estadosIntegracao: {} as Record<string, unknown>,
  /** a RPC da Integração falha (1ª carga) */
  integracaoFalha: false,
  /** a RPC da Integração só responde quando esta promise resolver (simula "ainda carregando") */
  integracaoPendente: null as null | Promise<void>,
  /** modelos cujo UPDATE devolve 0 linhas (alguém salvou antes: P0409) — sem mudar o `rev` do servidor */
  conflitoIds: new Set<string>(),
  /** erro devolvido pelo UPDATE de um modelo */
  erroUpdate: new Map<string, { code?: string; message: string }>(),
  /** categorias com pedido (OC): a pré-checagem de Acessórios as barra (via `conferirCategoria`) — não usado pelo harness */
  /** valor do modelo ao ser relido (P0409): sobrescreve `estado.modelos` na releitura de 1 linha */
  relidoPorId: new Map<string, Linha | null>(),
  /** produto excluído por outra pessoa (a releitura devolve null) */
  falhaReleitura: false,
  /** PR-GRADE-1: linhas de tabelas EXTRAS (modelo_grades, modelo_tecidos…) — filtradas pelos `.eq` e devolvidas no `maybeSingle` como 1ª linha ou null. */
  extra: {} as Record<string, Linha[]>,
};
export const chamadas: { tabela: string; select?: string; eqs: Record<string, unknown> }[] = [];
/** UPDATEs recebidos em `modelos` (na ordem). */
export const updates: Array<{ id: unknown; rev: unknown; payload: Linha }> = [];
export const rpc = vi.fn();
export const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

function chain(t: string) {
  const reg: { tabela: string; select?: string; eqs: Record<string, unknown> } = {
    tabela: t,
    eqs: {},
  };
  let faixa: [number, number] | null = null;
  let op = "select";
  let payload: Linha = {};
  let unico = false;
  const c: any = {
    select: (s?: string) => {
      if (reg.select === undefined) reg.select = s;
      return c;
    },
    order: () => c,
    limit: () => c,
    eq: (col: string, v: unknown) => {
      reg.eqs[col] = v;
      return c;
    },
    in: () => c,
    update: (p: Linha) => {
      op = "update";
      payload = p;
      return c;
    },
    maybeSingle: () => {
      unico = true;
      return c;
    },
    single: () => {
      unico = true;
      return c;
    },
    range: (de: number, ate: number) => {
      faixa = [de, ate];
      return c;
    },
    then: (res: (v: unknown) => unknown) => {
      if (t === "modelos" && op === "update") {
        const id = reg.eqs.id as string;
        const rev = reg.eqs.rev;
        updates.push({ id, rev, payload });
        const erro = estado.erroUpdate.get(id);
        if (erro) return res({ data: null, error: erro });
        const m = estado.modelos.find((x) => x.id === id);
        if (!m || estado.conflitoIds.has(id) || m.rev !== rev)
          return res({ data: [], error: null });
        Object.assign(m, payload);
        m.rev = m.rev + 1;
        return res({ data: [{ id, rev: m.rev }], error: null });
      }
      chamadas.push(reg);
      if (estado.falhaTabela === t) return res({ data: null, error: { message: "falhou" } });
      if (t === "modelos" && unico) {
        if (estado.falhaReleitura) return res({ data: null, error: { message: "falhou" } });
        const id = reg.eqs.id as string;
        const fresco = estado.relidoPorId.has(id)
          ? estado.relidoPorId.get(id)
          : estado.modelos.find((x) => x.id === id);
        if (!fresco) return res({ data: null, error: null });
        // PR-GRADE-2: `lerGradeServidorComprado` lê `rev` + o embed `grades:modelo_grades(...)` num SELECT só.
        if (reg.select?.includes("modelo_grades")) {
          const grades = (estado.extra.modelo_grades ?? [])
            .filter((r) => r.modelo_id === id)
            .map((r) => ({ ...r }));
          return res({ data: { ...fresco, grades }, error: null });
        }
        return res({ data: { ...fresco }, error: null });
      }
      if (estado.extra[t]) {
        const filtradas = estado.extra[t]
          .filter((r) => Object.entries(reg.eqs).every(([k, v]) => r[k] === v))
          .map((r) => ({ ...r }));
        return res({ data: unico ? (filtradas[0] ?? null) : filtradas, error: null });
      }
      const dados: Record<string, any[]> = {
        modelos: estado.modelos.map((m) => ({ ...m })),
        colaboradores: [{ id: "est1", nome: "Ana" }],
        meses: [{ id: "mes1", mes: "Janeiro" }],
        anos: [{ id: "ano1", ano: "2027" }],
        grupos_produto: [
          { id: "g1", nome: "Vestuário" },
          { id: "g2", nome: "Acessórios" },
        ],
        categorias_produto: [
          { id: "cat1", nome: "Vestido", grupo_id: "g1" },
          { id: "cat2", nome: "Saia", grupo_id: "g1" },
          { id: "cat3", nome: "Bolsa", grupo_id: "g2" },
        ],
        linhas: [{ id: "lin1", nome: "Casual", markup: 2, markup_min: 1, markup_max: 3 }],
        artigos: [],
        subcategorias1_produto: [
          { id: "s1", nome: "Longo", categoria_id: "cat1" },
          { id: "s1b", nome: "Midi", categoria_id: "cat2" },
        ],
        subcategorias2_produto: [{ id: "s2", nome: "Manga", categoria_id: "cat1" }],
        colecoes: [{ id: "col1", nome: "Verão 27", mes_id: "mes1", ano_id: "ano1" }],
        colecao_subcolecoes: [{ id: "sc1", colecao_id: "col1", nome: "Sub A" }],
      };
      const todos = dados[t] ?? [];
      const fatia = faixa ? todos.slice(faixa[0], faixa[1] + 1) : todos;
      return res({ data: fatia, error: null });
    },
  };
  return c;
}

/** Um modelo da grade (o que a query devolve). `rev` 1, origem interna, sem categoria. */
export const mod = (id: string, extra: Linha = {}): Linha => ({
  id,
  rev: 1,
  nome: `Modelo ${id}`,
  ref: null,
  colecao: null,
  colecao_id: null,
  colecoes: null,
  origem: "interno",
  enviado_cad: false,
  status_planejamento: "em_planejamento",
  versao: 1,
  tamanho_tipo: "letra",
  ...extra,
});

export function resetar() {
  estado.modelos = [mod("M1"), mod("M2"), mod("M3")];
  estado.falhaTabela = null;
  estado.otb = false;
  estado.permissoes = new Set();
  estado.todasPermissoes = false;
  estado.estadosIntegracao = {};
  estado.integracaoFalha = false;
  estado.integracaoPendente = null;
  estado.conflitoIds = new Set();
  estado.erroUpdate = new Map();
  estado.relidoPorId = new Map();
  estado.falhaReleitura = false;
  estado.extra = {};
  chamadas.length = 0;
  updates.length = 0;
  rpc.mockReset();
  rpc.mockImplementation(async (nome: string) => {
    if (nome === "integracao_estado_modelos") {
      if (estado.integracaoPendente) await estado.integracaoPendente;
      if (estado.integracaoFalha) return { data: null, error: { message: "falhou" } };
      return { data: estado.estadosIntegracao, error: null };
    }
    return { data: null, error: null };
  });
  Object.values(toast).forEach((f) => f.mockReset());
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const flush = (ms = 60) =>
  act(async () => {
    await sleep(ms);
  });

export function preparar() {
  vi.resetModules();
  vi.doMock("@/integrations/supabase/client", () => ({
    supabase: {
      from: (t: string) => chain(t),
      rpc: (...a: unknown[]) => (rpc as any)(...a),
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
        unsubscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    },
  }));
  vi.doMock("@/hooks/useActiveTenantId", () => ({
    useActiveTenantId: () => "tenant1",
    useActiveTenant: () => ({
      tenantId: "tenant1",
      resolvido: true,
      erro: false,
      tentando: false,
      tentarDeNovo: vi.fn(),
    }),
  }));
  vi.doMock("@/hooks/useAuth", () => ({
    useAuth: () => ({
      canView: (k: string) => estado.todasPermissoes || estado.permissoes.has(k),
      canEdit: (k: string) => estado.todasPermissoes || estado.permissoes.has(k),
    }),
  }));
  vi.doMock("@/hooks/useTenantModules", () => ({
    useTenantModules: () => ({
      isModuleEnabled: (k: string) => (k === "otb" ? estado.otb : true),
      pronto: true,
      erro: false,
      tentando: false,
      tentarDeNovo: vi.fn(),
    }),
  }));
  vi.doMock("sonner", () => ({ toast }));
  vi.doMock("@tanstack/react-router", () => ({
    createFileRoute: () => () => ({ useParams: () => ({}) }),
    Link: (p: any) => createElement("a", null, p.children),
    useNavigate: () => vi.fn(),
    useBlocker: () => ({ status: "idle" as const, proceed: vi.fn(), reset: vi.fn() }),
  }));
  vi.doMock("@/components/ui/sidebar", () => ({ useSidebar: () => ({ state: "expanded" }) }));
  vi.doMock("@/components/ui/select", () => {
    const Ctx = createContext<{ onValueChange?: (v: string) => void; disabled?: boolean }>({});
    return {
      Select: (p: any) =>
        createElement(
          Ctx.Provider,
          { value: { onValueChange: p.onValueChange, disabled: p.disabled } },
          createElement(
            "div",
            {
              "data-select": "",
              "data-value": p.value ?? "",
              "data-disabled": p.disabled ? "" : undefined,
            },
            p.children,
          ),
        ),
      SelectTrigger: (p: any) =>
        createElement("span", {
          "aria-label": p["aria-label"],
          title: p.title,
          "data-controle": p["data-controle"],
          "data-trigger-class": p.className,
          "data-travada": p["data-travada"],
          "data-verificando": p["data-verificando"],
        }),
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

export type Montado = { container: HTMLElement; qc: any; desmontar: () => Promise<void> };

export async function montar(
  props: Record<string, unknown> = {},
  opcoes: { somenteLeitura?: boolean } = {},
): Promise<Montado> {
  // Resíduo de um teste anterior que falhou antes de `desmontar` (portal da barra de Salvar no body) não pode contaminar este.
  document.body.innerHTML = "";
  preparar();
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { ProdutosGradeAba } = await import("@/components/planejamento/grade/ProdutosGradeAba");
  const { ReadOnlyScope } = await import("@/components/RequirePermission");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    const aba = createElement(ProdutosGradeAba, props as any);
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        opcoes.somenteLeitura ? createElement(ReadOnlyScope, { value: true }, aba) : aba,
      ),
    );
  });
  await flush();
  return {
    container,
    qc,
    desmontar: async () => {
      await act(async () => root.unmount());
      container.remove();
      document.body.innerHTML = "";
    },
  };
}

export const linhas = (c: HTMLElement) =>
  Array.from(c.querySelectorAll("tbody tr")) as HTMLElement[];
export const porLabel = (root: ParentNode, label: string) =>
  Array.from(root.querySelectorAll(`[aria-label="${label}"]`)) as HTMLInputElement[];
export const celula = (root: ParentNode, label: string): HTMLInputElement => {
  const achados = porLabel(root, label);
  if (achados.length !== 1)
    throw new Error(`${achados.length} célula(s) com aria-label "${label}"`);
  return achados[0];
};
export const linhaDe = (c: HTMLElement, id: string) =>
  c.querySelector(`tr[data-modelo-id="${id}"]`) as HTMLElement;
/** Texto (modo "texto") de uma coluna na linha do modelo. */
export const textoDe = (c: HTMLElement, id: string, col: string) =>
  linhaDe(c, id)?.querySelector(`td[data-col="${col}"]`)?.textContent ?? null;

export function digitar(el: HTMLInputElement | HTMLTextAreaElement, valor: string) {
  const proto =
    el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  return act(async () => {
    el.focus();
    setter.call(el, valor);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
export const clicar = (el: Element | null) =>
  act(async () => {
    (el as HTMLElement).click();
  });
/** Escolhe uma opção do Select (mockado em botões) cujo gatilho tem o `aria-label` dado. */
export async function escolher(root: ParentNode, label: string, valor: string) {
  const gatilho = root.querySelector(`span[aria-label="${label}"]`) as HTMLElement;
  if (!gatilho) throw new Error(`select "${label}" não encontrado`);
  const btn = gatilho
    .closest("[data-select]")!
    .querySelector(`button[data-item="${valor}"]`) as HTMLElement;
  if (!btn) throw new Error(`opção "${valor}" não encontrada em "${label}"`);
  await clicar(btn);
}
export const botaoSalvar = (c: HTMLElement) =>
  Array.from(document.querySelectorAll("button")).find((b) =>
    /^Salvar/.test(b.textContent ?? ""),
  ) as HTMLButtonElement | undefined;
/** Clica em Salvar e espera o UM Salvar terminar (o resumo do fim sempre dá um toast: sucesso, aviso ou erro). */
export async function salvar() {
  const b = botaoSalvar(document.body);
  if (!b) throw new Error("botão Salvar não está na tela");
  const antes =
    toast.success.mock.calls.length +
    toast.warning.mock.calls.length +
    toast.error.mock.calls.length;
  await clicar(b);
  for (let i = 0; i < 100; i++) {
    await flush(25);
    if (
      toast.success.mock.calls.length +
        toast.warning.mock.calls.length +
        toast.error.mock.calls.length >
      antes
    )
      break;
  }
  await flush(60);
}
export const selos = (c: HTMLElement) => c.querySelectorAll("[data-selo-nao-salvo]").length;
