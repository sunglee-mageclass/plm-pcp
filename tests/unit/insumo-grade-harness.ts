/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom (mesmo padrão do harness da grade de Aviamentos) */
// Harness dos testes da grade "Lista" de Insumos (IN-2): `supabase` em memória + Select do Radix vira botões + render real da
// `InsumosGradeAba`. Os testes importam daqui (nada de `.test` no nome: não é suíte).
import { vi } from "vitest";
import { act, createContext, createElement, useContext } from "react";
import { createRoot } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

export type Linha = Record<string, any>;

export const insumo = (id: string, extra: Linha = {}): Linha => ({
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
export const variante = (
  id: string,
  etiquetaId: string,
  corId: string | null,
  tamanho: string | null,
  extra: Linha = {},
): Linha => ({
  id,
  etiqueta_id: etiquetaId,
  cor_id: corId,
  tamanho,
  preco: 2,
  created_at: `2026-01-0${id.slice(-1)}`,
  ...extra,
});

export const estado = {
  etiquetas: [] as Linha[],
  variantes: [] as Linha[],
  /** tabela cuja leitura falha */
  falhaTabela: null as string | null,
  /** insumos cujo UPDATE falha com 23505 (nome repetido) */
  nomeRepetido: new Set<string>(),
  /** insumos cujo UPDATE devolve 0 linhas (excluído por outra pessoa) */
  sumiu: new Set<string>(),
  /** insumos cujo DELETE de variantes falha com 23503 (cor em uso) */
  varianteEmUso: new Set<string>(),
  /** erro do PRÓXIMO INSERT de variantes (consumido uma vez) */
  falhaInsertVariantes: null as null | { code?: string; message: string },
  /** erro devolvido por `importar_insumo_linha` */
  erroImportar: null as null | { code?: string; message: string },
  /** insumos cujo DELETE falha com 23503 (em uso) */
  emUso: new Set<string>(),
  /** insumos cujo DELETE não apaga nada (já excluído por outra pessoa) */
  jaExcluido: new Set<string>(),
};
/** Ordem das escritas no banco simulado. */
export const ops: string[] = [];
export const updates: Array<{ id: unknown; payload: Linha }> = [];
export const deletesVariantes: unknown[] = [];
export const insertsVariantes: Array<{ etiquetaId: unknown; linhas: Linha[] }> = [];
/** DELETEs diretos em `etiquetas` (excluir o insumo inteiro). */
export const etiquetaDeletes: Array<{ id: unknown }> = [];
export const rpc = vi.fn();
export const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

function chain(t: string) {
  let op = "select";
  let payload: any = {};
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
    update: (p: Linha) => {
      op = "update";
      payload = p;
      return c;
    },
    delete: () => {
      op = "delete";
      return c;
    },
    insert: (rows: Linha[]) => {
      op = "insert";
      payload = rows;
      return c;
    },
    then: (res: (v: unknown) => unknown) => {
      if (estado.falhaTabela === t && op === "select")
        return res({ data: null, error: { message: "falhou" } });
      if (t === "etiquetas" && op === "update") {
        const id = eqs.id as string;
        if (estado.nomeRepetido.has(id))
          return res({
            data: null,
            error: {
              code: "23505",
              message: "duplicate key uq_etiquetas_tenant_nome",
              details: "",
            },
          });
        if (estado.sumiu.has(id)) return res({ data: [], error: null });
        ops.push(`etiquetas.update:${id}`);
        updates.push({ id, payload });
        Object.assign(estado.etiquetas.find((x) => x.id === id)!, payload);
        return res({ data: [{ id }], error: null });
      }
      if (t === "etiquetas" && op === "delete") {
        const id = eqs.id as string;
        if (estado.emUso.has(id))
          return res({
            data: null,
            error: { code: "23503", message: "violates foreign key constraint", details: "" },
          });
        etiquetaDeletes.push({ id });
        if (estado.jaExcluido.has(id)) return res({ data: [], error: null });
        ops.push(`etiquetas.delete:${id}`);
        estado.etiquetas = estado.etiquetas.filter((x) => x.id !== id);
        estado.variantes = estado.variantes.filter((v) => v.etiqueta_id !== id);
        return res({ data: [{ id }], error: null });
      }
      if (t === "variantes_etiqueta" && op === "delete") {
        const id = eqs.etiqueta_id as string;
        if (estado.varianteEmUso.has(id))
          return res({
            data: null,
            error: { code: "23503", message: "violates foreign key constraint", details: "" },
          });
        ops.push(`variantes.delete:${id}`);
        deletesVariantes.push(id);
        estado.variantes = estado.variantes.filter((v) => v.etiqueta_id !== id);
        return res({ data: null, error: null });
      }
      if (t === "variantes_etiqueta" && op === "insert") {
        const linhas = payload as Linha[];
        const etiquetaId = linhas[0]?.etiqueta_id;
        if (estado.falhaInsertVariantes) {
          const erro = estado.falhaInsertVariantes;
          estado.falhaInsertVariantes = null;
          return res({ data: null, error: erro });
        }
        ops.push(`variantes.insert:${etiquetaId}:${linhas.length}`);
        insertsVariantes.push({ etiquetaId, linhas });
        for (const l of linhas)
          estado.variantes.push({
            id: `nv${estado.variantes.length + 1}`,
            created_at: "2026-02-01",
            ...l,
          });
        return res({ data: null, error: null });
      }
      const dados: Record<string, Linha[]> = {
        etiquetas: estado.etiquetas.map((e) => ({ ...e })),
        variantes_etiqueta: estado.variantes.map((v) => ({ ...v })),
        tipos_insumo: [
          { id: "tp1", nome: "Cartão" },
          { id: "tp2", nome: "Botão" },
        ],
        cores: [
          { id: "azul", nome: "Azul" },
          { id: "verde", nome: "Verde" },
          { id: "preto", nome: "Preto" },
        ],
        tenant_config: [{ tamanhos_grade: null }],
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

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const flush = (ms = 30) =>
  act(async () => {
    await sleep(ms);
  });

export function mocks() {
  vi.resetModules();
  vi.doMock("@/integrations/supabase/client", () => ({
    supabase: {
      from: (t: string) => chain(t),
      rpc: (...a: unknown[]) => rpc(...a),
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
        unsubscribe: vi.fn(),
      }),
      removeChannel: vi.fn(),
    },
  }));
  vi.doMock("@/hooks/useActiveTenantId", () => ({
    useActiveTenant: () => ({
      tenantId: "tenant1",
      resolvido: true,
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
          createElement("div", { "data-select": "", "data-value": p.value ?? "" }, p.children),
        ),
      SelectTrigger: (p: any) =>
        createElement("span", {
          "aria-label": p["aria-label"],
          "aria-invalid": p["aria-invalid"],
          title: p.title,
          "data-trigger-class": p.className,
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

export function resetar() {
  estado.etiquetas = [insumo("E1"), insumo("E2", { nome: "Etiqueta Zeta", unidade: "metro" })];
  estado.variantes = [
    variante("v1", "E1", "azul", "34|PPP"),
    variante("v2", "E1", "azul", "36|PP"),
    variante("v3", "E1", "verde", null, { preco: 3 }),
  ]; // E1 = 2 cores (azul com 2 tamanhos, verde sem); E2 sem cor
  estado.falhaTabela = null;
  estado.nomeRepetido = new Set();
  estado.sumiu = new Set();
  estado.varianteEmUso = new Set();
  estado.falhaInsertVariantes = null;
  estado.erroImportar = null;
  estado.emUso = new Set();
  estado.jaExcluido = new Set();
  etiquetaDeletes.length = 0;
  rpc.mockReset();
  // `importar_insumo_linha` em memória: cria o insumo (ou acrescenta as variantes que faltam ao alvo) como a RPC de verdade
  rpc.mockImplementation(async (nome: string, args: any) => {
    if (nome !== "importar_insumo_linha") return { data: null, error: null };
    if (estado.erroImportar) return { data: null, error: estado.erroImportar };
    const alvo = args._etiqueta_alvo_id as string | null;
    const cab = args._cabecalho as Linha;
    let id = alvo;
    let acao = "complementado";
    if (!id) {
      const nomeNorm = String(cab.nome).trim().toLowerCase();
      const ja = estado.etiquetas.find((e) => String(e.nome).trim().toLowerCase() === nomeNorm);
      if (ja) id = ja.id;
      else {
        id = `N${estado.etiquetas.length + 1}`;
        estado.etiquetas.push(insumo(id, { ...cab }));
        acao = "criado";
      }
    }
    let novas = 0;
    for (const v of args._variantes as Linha[]) {
      const existe = estado.variantes.some(
        (x) =>
          x.etiqueta_id === id &&
          (x.cor_id ?? null) === (v.cor_id ?? null) &&
          (x.tamanho ?? null) === (v.tamanho ?? null),
      );
      if (existe) continue;
      estado.variantes.push(
        variante(`nv${estado.variantes.length + 1}`, id!, v.cor_id ?? null, v.tamanho ?? null, {
          preco: v.preco ?? null,
        }),
      );
      novas++;
    }
    if (acao !== "criado") acao = novas > 0 ? "complementado" : "inalterado";
    ops.push(`rpc:importar:${alvo ?? "novo"}`);
    return { data: { etiqueta_id: id, acao, variantes_novas: novas }, error: null };
  });
  ops.length = 0;
  updates.length = 0;
  deletesVariantes.length = 0;
  insertsVariantes.length = 0;
  Object.values(toast).forEach((f) => f.mockReset());
}

export type Montado = { container: HTMLElement; qc: any; desmontar: () => Promise<void> };

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

/** Clica o chevron de cada insumo ainda recolhido (a lista nasce só com os cabeçalhos). */
export async function expandirTudo(container: ParentNode): Promise<void> {
  const fechados = Array.from(
    container.querySelectorAll('[data-acao="alternar-cores"][aria-expanded="false"]'),
  ) as HTMLElement[];
  for (const b of fechados)
    await act(async () => {
      b.click();
    });
}

/** Monta a Aba sozinha. `expandir=false` mantém os insumos como nascem (recolhidos). */
export async function montar(
  etiquetasProp: Linha[] | undefined,
  extra: Record<string, unknown> = {},
  expandir = true,
): Promise<Montado> {
  mocks();
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { InsumosGradeAba } = await import("@/components/insumo/grade/InsumosGradeAba");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: qc },
        createElement(InsumosGradeAba, { etiquetas: etiquetasProp as any, ...extra }),
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

export const PROPS = () => estado.etiquetas.map((a) => ({ id: a.id }));
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
/** O `<div data-select>` do Select cujo gatilho tem este aria-label. */
export const seletor = (raiz: ParentNode, label: string) =>
  Array.from(raiz.querySelectorAll("[data-select]")).find((d) =>
    d.querySelector(`[aria-label="${label}"]`),
  ) as HTMLElement | undefined;
export const escolher = (raiz: ParentNode, label: string, valor: string) =>
  clicar(seletor(raiz, label)?.querySelector(`[data-item="${valor}"]`));
/** Abre o popover de tamanhos da cor e devolve o checkbox do tamanho. */
export const caixaTamanho = (rotulo: string) =>
  document.body.querySelector(
    `[role="checkbox"][aria-label="Tamanho ${rotulo}"]`,
  ) as HTMLElement | null;
export const salvar = async () => {
  await clicar(botaoSalvar());
  await flush(80);
};
