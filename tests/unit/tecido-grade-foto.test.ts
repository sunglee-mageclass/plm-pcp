// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom (mesmo padrão de tecido-grade-aba.test.ts) */
// Grade "Lista tipo Excel" de Cadastro > Tecidos (Task 9): FOTO por cor. Render real da `TecidosGradeAba` com `supabase` mockado.
// Prova: cor COM foto mostra a miniatura (link assinado mockado) e cor SEM foto mostra "inserir foto"; escolher o arquivo sobe pro
// bucket, grava `variantes_tecido.foto_url` NA HORA (sem passar pelo Salvar do rascunho, sem selo âmbar) e apaga a foto antiga;
// linha NOVA fica sem botão (a foto precisa do id da cor) com a dica no `title`. O upload real no Storage é QA no navegador.
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

const estado = { artigos: [] as Linha[], variantes: [] as Linha[], falhaUpload: false };
const variantesUpdates: Array<{ payload: Linha; id: unknown }> = [];
const rpc = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

function chain(t: string) {
  let op = "select"; let payload: Linha = {}; const eqs: Record<string, unknown> = {};
  const c: any = {
    select: () => c, order: () => c, range: () => c,
    eq: (col: string, v: unknown) => { eqs[col] = v; return c; },
    update: (p: Linha) => { op = "update"; payload = p; return c; },
    then: (res: (v: unknown) => unknown) => {
      if (t === "variantes_tecido" && op === "update") {
        variantesUpdates.push({ payload, id: eqs.id });
        const v = estado.variantes.find((x) => x.id === eqs.id)!; Object.assign(v, payload);
        // o gatilho de colaboração sobe o rev do tecido a cada cor gravada
        const a = estado.artigos.find((x) => x.id === v.artigo_id)!; a.rev += 1;
        return res({ data: null, error: null });
      }
      const dados: Record<string, Linha[]> = {
        artigos: estado.artigos.map((a) => ({ ...a })), variantes_tecido: estado.variantes.map((v) => ({ ...v })),
        artigo_categorias_tecido: [],
        categorias_tecido: [{ id: "cat1", nome: "Malha" }],
        subcategorias_tecido: [],
        empresas: [{ id: "emp1", nome_fantasia: "Fornecedor 1" }],
        cores: [{ id: "cor1", nome: "Azul" }, { id: "cor2", nome: "Verde" }],
        cores_apelido: [],
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
  storage: { from: (b: string) => ({ upload: (...a: unknown[]) => upload(b, ...a), remove: (...a: unknown[]) => remove(b, ...a) }) },
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
  // link assinado mockado: caminho -> URL fixa (prova que a miniatura vem do `useSignedUrl`)
  vi.doMock("@/hooks/useSignedUrl", () => ({ useSignedUrl: (p: string | null) => (p ? `https://assinado.test/${p}` : null), VARIANT_BUCKET: "variantes" }));
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

const linhaDa = (c: HTMLElement, varianteId: string) => c.querySelector(`tr[data-variante-id="${varianteId}"]`) as HTMLElement;
const celulaFoto = (c: HTMLElement, varianteId: string) => linhaDa(c, varianteId).querySelector('td[data-col="foto"]') as HTMLElement;
const clicar = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).click(); });
const botaoTexto = (txt: string, raiz: ParentNode = document.body) =>
  Array.from(raiz.querySelectorAll("button")).find((b) => b.textContent?.includes(txt)) as HTMLButtonElement | undefined;
function escolherArquivo(input: HTMLInputElement, file: File) {
  return act(async () => {
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(60);
  });
}

beforeEach(() => {
  estado.artigos = [artigo("a1")];
  estado.variantes = [variante("v1", "a1", { foto_url: "tenant1/a1/v1-antiga.jpg" }), variante("v2", "a1", { cor_id: "cor2" })];
  estado.falhaUpload = false;
  variantesUpdates.length = 0;
  rpc.mockReset(); rpc.mockImplementation(async (nome: string) => (nome === "get_user_tenant_id" ? { data: "tenant1", error: null } : { error: null }));
  upload.mockReset(); upload.mockImplementation(async () => ({ error: estado.falhaUpload ? { message: "falhou" } : null }));
  remove.mockReset(); remove.mockImplementation(async () => ({ error: null }));
  Object.values(toast).forEach((f) => f.mockReset());
});

const PROPS = () => estado.artigos.map((a) => ({ id: a.id }));

describe("Foto por cor na grade (Task 9)", () => {
  it("cor COM foto mostra a miniatura (link assinado) e cor SEM foto mostra o botão 'inserir foto'", async () => {
    const t = await montar(PROPS());
    const comFoto = celulaFoto(t.container, "v1");
    const img = comFoto.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://assinado.test/tenant1/a1/v1-antiga.jpg");
    expect(comFoto.querySelector('[aria-label^="Trocar foto"]')).not.toBeNull();

    const semFoto = celulaFoto(t.container, "v2");
    expect(semFoto.querySelector("img")).toBeNull();
    expect(semFoto.textContent).toContain("inserir foto");
    expect(semFoto.querySelector('[aria-label^="Inserir foto"]')).not.toBeNull();
    await t.desmontar();
  });

  it("clicar na miniatura abre o lightbox (ampliar) com a imagem grande", async () => {
    const t = await montar(PROPS());
    await clicar(celulaFoto(t.container, "v1").querySelector('[role="button"]'));
    await flush(20);
    const dentro = document.body.querySelector('[role="dialog"] img') as HTMLImageElement | null;
    expect(dentro?.getAttribute("src")).toBe("https://assinado.test/tenant1/a1/v1-antiga.jpg");
    await t.desmontar();
  });

  it("escolher o arquivo sobe pro bucket, grava foto_url NA HORA (sem Salvar, sem selo) e apaga a foto antiga", async () => {
    const t = await montar(PROPS());
    const input = celulaFoto(t.container, "v1").querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe("image/*");
    await escolherArquivo(input, new File(["x"], "Véu 01.PNG", { type: "image/png" }));
    await flush(60);

    expect(upload).toHaveBeenCalledTimes(1);
    const [bucket, path, , opts] = upload.mock.calls[0];
    expect(bucket).toBe("variantes");
    expect(path).toMatch(/^tenant1\/a1\/v1-\d+\.png$/); // loja/tecido/cor-timestamp.ext (extensão sem acento/maiúscula)
    expect(opts).toEqual({ upsert: true });
    expect(variantesUpdates).toHaveLength(1);
    expect(variantesUpdates[0]).toMatchObject({ id: "v1", payload: { foto_url: path } });
    expect(remove).toHaveBeenCalledWith("variantes", ["tenant1/a1/v1-antiga.jpg"]);
    expect(toast.success).toHaveBeenCalledWith("Foto atualizada.");
    // fora do rascunho: nenhum selo âmbar, nenhuma RPC de salvar
    expect(t.container.querySelectorAll("[data-selo-nao-salvo]")).toHaveLength(0);
    expect(rpc.mock.calls.filter((c) => c[0] === "salvar_variante_tecido")).toHaveLength(0);
    // a grade releu: a miniatura agora é a nova
    expect(celulaFoto(t.container, "v1").querySelector("img")!.getAttribute("src")).toBe(`https://assinado.test/${path}`);
    await t.desmontar();
  });

  it("cor sem foto: sobe sem apagar nada; falha no upload mostra o erro e não grava", async () => {
    const t = await montar(PROPS());
    estado.falhaUpload = true;
    await escolherArquivo(celulaFoto(t.container, "v2").querySelector('input[type="file"]') as HTMLInputElement, new File(["x"], "foto.jpg", { type: "image/jpeg" }));
    await flush(40);
    expect(variantesUpdates).toHaveLength(0);
    expect(remove).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();

    estado.falhaUpload = false;
    await escolherArquivo(celulaFoto(t.container, "v2").querySelector('input[type="file"]') as HTMLInputElement, new File(["x"], "foto.jpg", { type: "image/jpeg" }));
    await flush(60);
    expect(variantesUpdates).toHaveLength(1);
    expect(remove).not.toHaveBeenCalled(); // não havia foto antiga
    await t.desmontar();
  });

  it("arquivo que não é imagem é recusado (nada sobe)", async () => {
    const t = await montar(PROPS());
    await escolherArquivo(celulaFoto(t.container, "v2").querySelector('input[type="file"]') as HTMLInputElement, new File(["x"], "planilha.xlsx", { type: "application/vnd.ms-excel" }));
    await flush(30);
    expect(upload).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    await t.desmontar();
  });

  it("linha NOVA: sem botão de envio (a foto precisa do id da cor); a dica explica", async () => {
    const t = await montar(PROPS());
    await clicar(botaoTexto("Novo tecido"));
    const novo = t.container.querySelector("[data-linha-nova]") as HTMLElement;
    const cel = novo.querySelector('td[data-col="foto"]') as HTMLElement;
    expect(cel.querySelector('input[type="file"]')).toBeNull();
    expect(cel.querySelector("button")).toBeNull();
    expect(cel.querySelector("[title]")?.getAttribute("title")).toBe("A foto fica disponível depois de salvar o tecido");
    await t.desmontar();
  });
});
