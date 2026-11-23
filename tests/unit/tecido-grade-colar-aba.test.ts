// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mocks de supabase/Radix/happy-dom (mesmo padrão de tecido-grade-aba.test.ts) */
// Grade "Lista tipo Excel" de Cadastro > Tecidos (Task 8): COLAR do Excel (Ctrl+V de bloco TSV). Render real da `TecidosGradeAba`
// com `supabase` mockado. Prova: o bloco vira RASCUNHO a partir da célula-âncora (nada grava antes do Salvar), texto sem
// correspondência NÃO é aplicado e deixa a célula com aviso, linhas além do fim criam tecidos novos (cores do mesmo nome juntas) que
// o Salvar manda por `importar_tecido_linha`, e valor simples continua no colar normal.
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

const estado = {
  artigos: [] as Linha[], variantes: [] as Linha[], cats: [] as Linha[],
  conflitoArtigo: new Set<string>(), falhaTabela: null as string | null,
};
const ordem: string[] = [];
const artigoUpdates: Array<{ payload: Linha; rev: unknown; id: unknown }> = [];
const rpc = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

function chain(t: string) {
  let op = "select"; let payload: Linha = {}; const eqs: Record<string, unknown> = {};
  const c: any = {
    select: () => c, order: () => c, range: () => c,
    eq: (col: string, v: unknown) => { eqs[col] = v; return c; },
    update: (p: Linha) => { op = "update"; payload = p; return c; },
    then: (res: (v: unknown) => unknown) => {
      if (estado.falhaTabela === t) return res({ data: null, error: { message: "falhou" } });
      if (t === "artigos" && op === "update") {
        const id = eqs.id as string;
        if (estado.conflitoArtigo.has(id)) return res({ data: [], error: null });
        ordem.push(`artigos.update:${id}`); artigoUpdates.push({ payload, rev: eqs.rev, id });
        const a = estado.artigos.find((x) => x.id === id)!; Object.assign(a, payload, { rev: a.rev + 1 });
        return res({ data: [{ id, rev: a.rev }], error: null });
      }
      const dados: Record<string, Linha[]> = {
        artigos: estado.artigos.map((a) => ({ ...a })), variantes_tecido: estado.variantes.map((v) => ({ ...v })),
        artigo_categorias_tecido: estado.cats,
        categorias_tecido: [{ id: "cat1", nome: "Malha" }, { id: "cat2", nome: "Plano" }],
        subcategorias_tecido: [{ id: "sub1", nome: "Leve", categoria_tecido_id: "cat1" }],
        empresas: [{ id: "emp1", nome_fantasia: "Fornecedor 1" }],
        cores: [{ id: "cor1", nome: "Azul" }, { id: "cor2", nome: "Verde" }],
        cores_apelido: [{ id: "ap1", nome: "Marinho", cor_base_id: "cor1" }],
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
  vi.doMock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null, VARIANT_BUCKET: "variantes" }));
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

const linhas = (c: HTMLElement) => Array.from(c.querySelectorAll("tbody tr")) as HTMLElement[];
const porLabel = (root: ParentNode, label: string) => Array.from(root.querySelectorAll(`[aria-label="${label}"]`)) as HTMLInputElement[];
function digitar(el: HTMLInputElement, valor: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  return act(async () => { set.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const clicar = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).click(); });
const botaoSalvar = () => Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent?.startsWith("Salvar")) as HTMLButtonElement | undefined;
const selos = (c: HTMLElement) => c.querySelectorAll("[data-selo-nao-salvo]").length;
const salvaRpcs = () => rpc.mock.calls.filter((c) => c[0] === "salvar_variante_tecido");

const novoGrupos = (c: HTMLElement) => Array.from(c.querySelectorAll("[data-linha-nova]")) as HTMLElement[];
const botaoTexto = (txt: string, raiz: ParentNode = document.body) =>
  Array.from(raiz.querySelectorAll("button")).find((b) => b.textContent?.includes(txt)) as HTMLButtonElement | undefined;
/** Escolhe `valor` no Select (mockado em botões) cujo gatilho tem o aria-label dado, dentro de `raiz`. */
function escolher(raiz: ParentNode, label: string, valor: string) {
  const sel = Array.from(raiz.querySelectorAll("[data-select]")).find((d) => d.querySelector(`[aria-label="${label}"]`)) as HTMLElement;
  return clicar(sel.querySelector(`[data-item="${valor}"]`));
}
const importarRpcs = () => rpc.mock.calls.filter((c) => c[0] === "importar_tecido_linha");
let contaNovo = 0;

/** Dispara um Ctrl+V com `texto` no elemento (o evento sobe até a tabela). */
async function colar(el: Element, texto: string) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  (ev as any).clipboardData = { getData: (t: string) => (t === "text/plain" ? texto : "") };
  await act(async () => { el.dispatchEvent(ev); });
  return ev;
}
/** Valor atual de um Select (mockado) pelo aria-label do gatilho, dentro de `raiz`. */
const valorSelect = (raiz: ParentNode, label: string) =>
  (Array.from(raiz.querySelectorAll("[data-select]")).find((d) => d.querySelector(`[aria-label="${label}"]`)) as HTMLElement | undefined)?.dataset.value;
/** Linha do TSV da coluna Nome até Cor base (12 colunas, as do meio vazias): nome, fornecedor, preço, ..., cor base. */
const tsv = (c: { nome?: string; fornecedor?: string; preco?: string; cor?: string }) =>
  [c.nome ?? "", c.fornecedor ?? "", c.preco ?? "", "", "", "", "", "", "", "", "", c.cor ?? ""].join("\t");

beforeEach(() => {
  estado.artigos = [artigo("a1"), artigo("a2")];
  estado.variantes = [variante("v1", "a1"), variante("v2", "a1", { cor_id: "cor2" })];
  estado.cats = [{ id: "l1", artigo_id: "a1", categoria_tecido_id: "cat1", subcategoria_tecido_id: null }];
  estado.conflitoArtigo = new Set(); estado.falhaTabela = null;
  ordem.length = 0; artigoUpdates.length = 0; contaNovo = 0;
  rpc.mockReset(); rpc.mockImplementation(async (nome: string, args: any) => {
    if (nome === "salvar_variante_tecido") { ordem.push("rpc:variante"); return { error: null }; }
    if (nome === "set_artigo_categorias") { ordem.push("rpc:categorias"); return { error: null }; }
    if (nome === "variante_tecido_preco_previa") return { data: { afetados: 1, assinatura: "sig" }, error: null };
    if (nome === "importar_tecido_linha") {
      ordem.push(`rpc:importar:${args._cabecalho.nome}`);
      const id = `n${++contaNovo}`;
      estado.artigos.push(artigo(id, { nome: args._cabecalho.nome }));
      return { data: { artigo_id: id, acao: "criado" }, error: null };
    }
    return { error: null };
  });
  Object.values(toast).forEach((f) => f.mockReset());
});

const PROPS = () => estado.artigos.map((a) => ({ id: a.id }));

describe("TecidosGradeAba: colar do Excel", () => {
  it("bloco vira RASCUNHO a partir da âncora (linha-pai): nome/fornecedor pelo NOME, sem gravar; texto sem correspondência avisa na célula", async () => {
    const t = await montar(PROPS());
    const nome1 = porLabel(linhas(t.container)[0], "Nome de Tecido a1")[0]; // linha-pai do a1
    const ev = await colar(nome1, "Malha Y\tNao existe\tabc\r\n");
    await flush(30);

    expect(ev.defaultPrevented).toBe(true); // bloco: o colar normal é cancelado
    expect(porLabel(t.container, "Nome de Tecido a1")[0].value).toBe("Malha Y");
    expect(valorSelect(t.container, "Fornecedor de Tecido a1") || "").toBe(""); // "Nao existe" não casa com nenhum fornecedor
    // nada foi ao servidor
    expect(artigoUpdates).toHaveLength(0);
    expect(rpc.mock.calls.filter((c) => c[0] === "importar_tecido_linha" || c[0] === "salvar_variante_tecido")).toHaveLength(0);
    expect(selos(t.container)).toBeGreaterThan(0);
    expect(botaoSalvar()?.textContent).toContain("Salvar (1)"); // só o a1 ficou sujo
    // resumo
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning.mock.calls[0][0]).toBe("Coladas 1 célula em 1 linha · 0 novas · 2 ignoradas");
    expect(String(toast.warning.mock.calls[0][1]?.description)).toContain("sem correspondência");
    // a célula do texto que não casou fica com aviso (e NÃO foi aplicada)
    const avisos = t.container.querySelectorAll("[data-aviso-colar]");
    expect(avisos).toHaveLength(1);
    expect(avisos[0].getAttribute("title")).toContain('"abc" não é um número válido');
    await t.desmontar();
  });

  it("bloco que desce pelas CORES: o cabeçalho só vale na linha-pai (nas cores é recusado, com motivo); a linha-pai de baixo recebe", async () => {
    const t = await montar(PROPS());
    // telas: [pai a1] [cor v1] [cor v2] [pai a2 (sem cores)] — o bloco tem 1 linha para cada uma
    const nome1 = porLabel(linhas(t.container)[0], "Nome de Tecido a1")[0];
    await colar(nome1, ["Malha X\tFornecedor 1\t11,00", "Malha Y\tFornecedor 1\t12,00", "Malha Z", "Malha W"].join("\r\n") + "\r\n");
    await flush(30);

    expect(porLabel(t.container, "Nome de Tecido a1")[0].value).toBe("Malha X"); // o "Y" e o "Z" caíram em cores: NÃO sobrescrevem o pai
    expect(valorSelect(t.container, "Fornecedor de Tecido a1")).toBe("emp1");
    expect(porLabel(t.container, "Nome de Tecido a2")[0].value).toBe("Malha W");
    expect(artigoUpdates).toHaveLength(0); // continua rascunho
    expect(botaoSalvar()?.textContent).toContain("Salvar (2)"); // a1 e a2 sujos
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning.mock.calls[0][0]).toBe("Coladas 4 células em 2 linhas · 0 novas · 4 ignoradas");
    expect(String(toast.warning.mock.calls[0][1]?.description)).toContain("4 linha sem essa célula"); // Y e Z (Nome/Fornecedor/Preço) nas cores
    await t.desmontar();
  });

  it("editar a célula com aviso tira o aviso", async () => {
    const t = await montar(PROPS());
    await colar(porLabel(linhas(t.container)[0], "Nome de Tecido a1")[0], "A\tFornecedor 1\tabc");
    await flush(30);
    // aviso no Preço da 1ª linha do a1 (o texto não foi aplicado)
    const [l0] = linhas(t.container);
    expect(l0.querySelectorAll("[data-aviso-colar]")).toHaveLength(1);
    await digitar(porLabel(l0, "Preço de Tecido a1")[0], "5,00");
    expect(t.container.querySelectorAll("[data-aviso-colar]")).toHaveLength(0);
    await t.desmontar();
  });

  it("cor base e apelido pelo nome numa cor existente (apelido só da cor base colada)", async () => {
    const t = await montar(PROPS());
    // âncora: Cor base da 1ª cor (a1:v1 = 2ª linha da tela, depois da linha-pai); bloco de 2 linhas x 2 colunas (cor base, apelido)
    const ancora = porLabel(linhas(t.container)[1], "Cor base da cor de Tecido a1")[0];
    await colar(ancora, "Azul\tMarinho\nVerde\tMarinho");
    await flush(30);
    const [, l0, l1] = linhas(t.container); // [linha-pai, cor v1, cor v2, ...]
    expect(valorSelect(l0, "Cor base da cor de Tecido a1")).toBe("cor1");
    expect(valorSelect(l0, "Cor apelido da cor de Tecido a1")).toBe("ap1");
    expect(valorSelect(l1, "Cor base da cor de Tecido a1")).toBe("cor2");
    expect(valorSelect(l1, "Cor apelido da cor de Tecido a1") || "").toBe(""); // Marinho não é de Verde: não aplica
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(String(toast.warning.mock.calls[0][0])).toContain("1 ignorada");
    expect(rpc.mock.calls.filter((c) => c[0] === "salvar_variante_tecido")).toHaveLength(0);
    await t.desmontar();
  });

  it("linhas além do fim viram tecidos NOVOS (mesmo nome = cores do mesmo tecido); UM Salvar manda cada um", async () => {
    const t = await montar(PROPS());
    // âncora: Nome da última linha (a2, sem cores); 1 linha existente + 3 novas
    const ancora = porLabel(linhas(t.container).slice(-1)[0], "Nome de Tecido a2")[0];
    const bloco = [
      "A2 renomeado",
      tsv({ nome: "Novo A", fornecedor: "fornecedor 1", preco: "28,50", cor: "Azul" }),
      tsv({ nome: "novo a", cor: "Verde" }),
      tsv({ nome: "Novo B", cor: "Verde" }),
    ].join("\n");
    await colar(ancora, bloco);
    await flush(30);

    expect(porLabel(t.container, "Nome de Tecido a2")[0].value).toBe("A2 renomeado");
    const nv = novoGrupos(t.container);
    expect(nv).toHaveLength(3); // Novo A (2 cores) + Novo B (1 cor)
    expect(new Set(nv.map((r) => r.getAttribute("data-linha-nova"))).size).toBe(2);
    expect(t.container.querySelectorAll("[data-selo-novo]").length).toBe(3);
    expect(importarRpcs()).toHaveLength(0); // ainda rascunho
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success.mock.calls[0][0]).toBe("Coladas 9 células em 4 linhas · 3 novas · 0 ignoradas");

    await clicar(botaoSalvar());
    await flush(80);
    const chamadas = importarRpcs();
    expect(chamadas).toHaveLength(2);
    const a = chamadas[0][1];
    expect(a._cabecalho).toMatchObject({ nome: "Novo A", empresa_id: "emp1", preco: 28.5, unidade_medida: "metro" });
    expect(a._variantes.map((v: any) => v.cor_id)).toEqual(["cor1", "cor2"]);
    expect(chamadas[1][1]._cabecalho.nome).toBe("Novo B");
    expect(chamadas[1][1]._variantes.map((v: any) => v.cor_id)).toEqual(["cor2"]);
    expect(artigoUpdates.map((u) => u.payload.nome)).toContain("A2 renomeado"); // o editado também foi
    expect(novoGrupos(t.container)).toHaveLength(0);
    await t.desmontar();
  });

  it("linha nova sem nome/cor base fica PENDENTE (vermelho) e não trava as válidas", async () => {
    const t = await montar(PROPS());
    const ancora = porLabel(linhas(t.container).slice(-1)[0], "Nome de Tecido a2")[0];
    await colar(ancora, ["A2", tsv({ nome: "Bom", cor: "Azul" }), tsv({ preco: "5,00" })].join("\n"));
    await flush(30);
    await clicar(botaoSalvar());
    await flush(80);
    expect(importarRpcs().map((c) => c[1]._cabecalho.nome)).toEqual(["Bom"]);
    expect(novoGrupos(t.container)).toHaveLength(1); // só a pendente ficou
    expect(String(toast.warning.mock.calls.at(-1)?.[0])).toContain("pendente");
    await t.desmontar();
  });

  it("valor simples (sem TAB/quebra) NÃO é interceptado: segue o colar normal do campo", async () => {
    const t = await montar(PROPS());
    const ev = await colar(porLabel(linhas(t.container)[0], "Nome de Tecido a1")[0], "Malha");
    expect(ev.defaultPrevented).toBe(false);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(selos(t.container)).toBe(0);
    // célula do Excel copiada sozinha (com a quebra final) também é valor simples
    const ev2 = await colar(porLabel(linhas(t.container)[0], "Nome de Tecido a1")[0], "Malha\r\n");
    expect(ev2.defaultPrevented).toBe(false);
    await t.desmontar();
  });

  it("colunas só-leitura/foto/categorias são puladas, rendimento em Metro é recusado e o transbordo é contado", async () => {
    const t = await montar(PROPS());
    // âncora no NCM: ncm, rendimento, mês, ano, categorias, cor base, apelido, nome var, código var, preço var, foto, [transbordo…]
    const ancora = porLabel(linhas(t.container)[0], "NCM de Tecido a1")[0];
    await colar(ancora, "6006\t3,5\tJaneiro\t2026\tMalha\tVerde\t\tVar\tC1\t12,5\tfoto.jpg\tx\ty\tz");
    await flush(30);
    expect(porLabel(t.container, "NCM de Tecido a1")[0].value).toBe("6006");
    const msg = String(toast.warning.mock.calls[0][0]);
    expect(msg).toContain("ignoradas");
    const det = String(toast.warning.mock.calls[0][1]?.description);
    expect(det).toContain("fora da regra da grade"); // rendimento em metro
    expect(det).toContain("coluna que não aceita colar"); // categorias, foto, preço por metro
    expect(det).toContain("além da última coluna");
    await t.desmontar();
  });
});
