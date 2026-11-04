// @vitest-environment happy-dom
// UM Salvar só no Cadastro › Tecidos (P-392 A, Task 8 do plano `2026-11-04-salvar-por-card-tecido`): editar uma cor (ou o
// tecido) fica SOLTO na tela (rascunho local, selo "editado", NADA no banco); o botão Salvar do CABEÇALHO grava o tecido E todas
// as cores sujas (RPC `salvar_variante_tecido`, uma chamada por cor); "Descartar alterações" volta tudo ao banco. Sem ✓/↺ por
// cor e sem "Salvar todos".
// Render de verdade do `TecidoDetail` (react-dom/client + act; o projeto não tem @testing-library/react e o vitest só inclui
// `*.test.ts` — por isso sem JSX). `supabase` é mockado (rpc + from); o Select do Radix é trocado por um stub de botões (a
// lógica testada é a dos handlers da tela, não a do Radix).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createContext, createElement, useContext } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// uuids em MAIÚSCULO de propósito: o payload da RPC tem de sair em minúsculo.
const COR_A = "AAAAAAAA-0000-4000-8000-000000000001";
const COR_B = "BBBBBBBB-0000-4000-8000-000000000002";
const AP_A1 = "A1A1A1A1-0000-4000-8000-000000000011";
const AP_B1 = "B1B1B1B1-0000-4000-8000-000000000022";
const V1 = "v1000000-0000-4000-8000-000000000001";
const V2 = "v2000000-0000-4000-8000-000000000002";

type Linha = Record<string, any>;
const novasVariantes = (): Linha[] => [
  { id: V1, artigo_id: "art1", cor_id: COR_A, cor_apelido_id: AP_A1, nome_variante: "Malha", codigo_variante: "C1", preco: 10, foto_url: null, historico_precos: [] },
  { id: V2, artigo_id: "art1", cor_id: COR_B, cor_apelido_id: AP_B1, nome_variante: null, codigo_variante: null, preco: 20.5, foto_url: null, historico_precos: [] },
];
const novoArtigo = (): Linha => ({
  id: "art1", nome: "Tecido Teste", empresa_id: null, representante_id: null, largura_estimada: null, categoria_tecido_id: null,
  composicao: null, mes_id: null, ano_id: null, preco: 10, rendimento: null, preco_por_metro: null, unidade_medida: "metro",
  ncm: null, historico_precos: [], rev: 1,
});

const estado = { variantes: novasVariantes(), artigo: novoArtigo(), artigoUpdate: { data: [{ id: "art1", rev: 2 }], error: null } as any };
const rpc = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
let ordem: string[] = []; // ordem das gravações (tecido ANTES das cores)
let artigoUpdates: Linha[] = [];

function chain(t: string) {
  let op = "select"; let payload: Linha | undefined;
  const dados = () =>
    t === "artigos" ? { ...estado.artigo }
    : t === "cores" ? [{ id: COR_A, nome: "Azul" }, { id: COR_B, nome: "Verde" }]
    : t === "cores_apelido" ? [{ id: AP_A1, nome: "Marinho", cor_base_id: COR_A }, { id: AP_B1, nome: "Musgo", cor_base_id: COR_B }]
    : t === "variantes_tecido" ? estado.variantes.map((v) => ({ ...v }))
    : [];
  const c: any = {
    select: () => c, eq: () => c, order: () => c, insert: () => c, single: () => c, maybeSingle: () => c,
    update: (p: Linha) => { op = "update"; payload = p; return c; },
    then: (res: (v: unknown) => unknown) => {
      if (t === "artigos" && op === "update") {
        ordem.push("artigos.update"); artigoUpdates.push(payload!);
        if (estado.artigoUpdate.data?.length) Object.assign(estado.artigo, payload, { rev: estado.artigoUpdate.data[0].rev });
        return res(estado.artigoUpdate);
      }
      return res({ data: dados(), error: null });
    },
  };
  return c;
}
const supabaseMock = {
  rpc: (...a: unknown[]) => rpc(...a),
  from: (t: string) => chain(t),
  storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: vi.fn() }),
  removeChannel: vi.fn(),
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function mocksComuns() {
  vi.resetModules();
  vi.doMock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));
  vi.doMock("sonner", () => ({ toast }));
  vi.doMock("@tanstack/react-router", () => ({
    createFileRoute: () => () => ({ useParams: () => ({ artigoId: "art1" }) }),
    Link: (p: any) => createElement("a", null, p.children),
    useNavigate: () => vi.fn(),
    useBlocker: () => ({ status: "idle" as const, proceed: vi.fn(), reset: vi.fn() }),
  }));
  vi.doMock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null, VARIANT_BUCKET: "variantes" }));
  vi.doMock("@/hooks/useColabRegistro", () => ({ useColabRegistro: () => ({ presentes: [] }) }));
  vi.doMock("@/components/shared/ColabPresenceOverlay", () => ({ ColabPresenceOverlay: () => null }));
  vi.doMock("@/components/shared/Breadcrumb", () => ({ Breadcrumb: () => null }));
  vi.doMock("@/components/shared/FornecedorSelect", () => ({ FornecedorSelect: () => null }));
  vi.doMock("@/components/shared/EtiquetaLavagemArtigo", () => ({ EtiquetaLavagemArtigoEditor: () => null }));
  vi.doMock("@/components/tecido/EnderecoEditor", () => ({
    EnderecoConsolidadoEditor: () => null,
    useEnderecosRollup: () => ({ data: new Map() }),
  }));
  vi.doMock("@/components/ui/select", () => {
    const Ctx = createContext<{ onValueChange?: (v: string) => void; disabled?: boolean }>({});
    return {
      Select: (p: any) => createElement(Ctx.Provider, { value: { onValueChange: p.onValueChange, disabled: p.disabled } },
        createElement("div", { "data-select": "", "data-value": p.value ?? "" }, p.children)),
      SelectTrigger: () => null,
      SelectValue: () => null,
      SelectContent: (p: any) => createElement("div", null, p.children),
      SelectItem: (p: any) => {
        const c = useContext(Ctx);
        return createElement("button", { type: "button", "data-item": p.value, disabled: c.disabled, onClick: () => c.onValueChange?.(p.value) }, p.children);
      },
    };
  });
}

/** Monta o `TecidoDetail` COMPLETO (cabeçalho com o Salvar único + cores), embutido (sem Sheet). */
async function montar() {
  mocksComuns();
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { TecidoDetail } = await import("@/routes/_authenticated/cadastro.tecidos.$artigoId");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(TecidoDetail, { artigoId: "art1", onClose, embedded: true })));
  });
  for (let i = 0; i < 40 && container.querySelectorAll("ul > li").length < 2; i++) await flush(50);
  return { container, qc, onClose, desmontar: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}

/** Só a `VariantesSection` (sem cabeçalho): para o modo SÓ LEITURA, que o `TecidoDetail` recebe do contexto. */
async function montarSecao(props: { readOnly: boolean }) {
  mocksComuns();
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { VariantesSection } = await import("@/routes/_authenticated/cadastro.tecidos.$artigoId");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc },
      createElement(VariantesSection, { artigoId: "art1", readOnly: props.readOnly, precoArtigo: null })));
  });
  await flush(40);
  return { container, desmontar: async () => { await act(async () => { root.unmount(); }); container.remove(); } };
}

const flush = (ms = 30) => act(async () => { await sleep(ms); });
const PREVIA_MS = 380; // atraso da prévia (300) + folga

const lis = (c: HTMLElement) => Array.from(c.querySelectorAll("ul > li")) as HTMLElement[];
const porLabel = (c: HTMLElement, label: string) => c.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
const clicar = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).click(); });
const expandir = async (li: HTMLElement) => { await clicar(porLabel(li, "Expandir")); };
function digitar(el: HTMLInputElement, valor: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  return act(async () => { set.call(el, valor); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const campos = (li: HTMLElement) => Array.from(li.querySelectorAll("input:not([type=file])")) as HTMLInputElement[]; // nome, código, preço
const selects = (li: HTMLElement) => Array.from(li.querySelectorAll("[data-select]")) as HTMLElement[];
const item = (sel: HTMLElement, valor: string) => sel.querySelector(`[data-item="${valor}"]`) as HTMLButtonElement;
const tecla = (el: Element, key: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
const salvaRpcs = () => rpc.mock.calls.filter((c) => c[0] === "salvar_variante_tecido");
const previaRpcs = () => rpc.mock.calls.filter((c) => c[0] === "variante_tecido_preco_previa");
/** Nome do TECIDO (1º campo da seção "Informações", fora das cores). */
const nomeTecido = (c: HTMLElement) => Array.from(c.querySelectorAll("input")).find((i) => !i.closest("ul") && i.value.length > 0 && i.type !== "file")! as HTMLInputElement;
const salvarGeral = (c: HTMLElement) => clicar(porLabel(c, "Salvar"));
const descartarGeral = (c: HTMLElement) => clicar(porLabel(c, "Descartar alterações"));
const aviso = (li: HTMLElement) => li.querySelector("[data-erro-cor]")?.textContent ?? "";
const botoesComTexto = (c: HTMLElement, t: string) => Array.from(c.querySelectorAll("button")).filter((b) => b.textContent?.includes(t));

beforeEach(() => {
  estado.variantes = novasVariantes();
  estado.artigo = novoArtigo();
  estado.artigoUpdate = { data: [{ id: "art1", rev: 2 }], error: null };
  ordem = []; artigoUpdates = [];
  rpc.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
  rpc.mockImplementation(async (nome: string, args: any) => {
    if (nome === "variante_tecido_preco_previa") return { data: { afetados: 3, assinatura: `sig-${args._preco}` }, error: null };
    if (nome === "salvar_variante_tecido") {
      ordem.push("rpc:salvar_variante_tecido");
      const v = estado.variantes.find((x) => x.id === args._id)!;
      Object.assign(v, args._mudancas);
      return { data: null, error: null };
    }
    if (nome === "set_artigo_categorias") { ordem.push("rpc:set_artigo_categorias"); return { data: null, error: null }; }
    return { data: null, error: null };
  });
});

describe("Cadastro › Tecidos — UM Salvar para o tecido e as cores", () => {
  it("editar o preço de uma cor fica SOLTO: selo 'editado' (sem ✓/↺), nada vai ao banco; o Salvar do cabeçalho grava _mudancas:{preco: NÚMERO} + _assinatura", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    expect(li1.textContent).not.toContain("editado"); // limpa: sem selo
    expect(porLabel(t.container, "Descartar alterações")).toBeNull(); // nada sujo: sem Descartar
    await expandir(li1);
    await digitar(campos(li1)[2], "25,5"); // centavos com vírgula: Number() cru daria NaN
    expect(li1.querySelector("[data-selo-editado]")?.textContent).toContain("editado");
    // SEM botões por cor
    expect(porLabel(t.container, "Salvar esta cor")).toBeNull();
    expect(porLabel(t.container, "Desfazer esta cor")).toBeNull();
    expect(t.container.textContent).toContain("alterações não salvas"); // o selo do cabeçalho conta a cor suja
    expect(salvaRpcs().length).toBe(0); // digitar não grava
    expect(artigoUpdates.length).toBe(0);

    await flush(PREVIA_MS);
    expect(previaRpcs().at(-1)).toEqual(["variante_tecido_preco_previa", { _id: V1, _preco: 25.5 }]);
    expect(salvaRpcs().length).toBe(0); // a prévia é só leitura

    await salvarGeral(t.container);
    await flush(60);
    expect(salvaRpcs().length).toBe(1);
    const [, args] = salvaRpcs()[0];
    expect(args._id).toBe(V1);
    expect(args._mudancas).toEqual({ preco: 25.5 });
    expect(typeof args._mudancas.preco).toBe("number");
    expect(args._assinatura).toBe("sig-25.5");
    // _base completa (a RPC exige a chave de cada campo mandado), uuids em minúsculo, preço como número
    expect(args._base).toEqual({
      cor_id: COR_A.toLowerCase(), cor_apelido_id: AP_A1.toLowerCase(), nome_variante: "Malha", codigo_variante: "C1", preco: 10,
    });
    // tecido limpo: NÃO regrava o `artigos` (nem categorias) — só as cores
    expect(ordem).toEqual(["rpc:salvar_variante_tecido"]);
    expect(li1.textContent).not.toContain("editado");
    expect(t.container.textContent).not.toContain("alterações não salvas");
    expect(toast.success).toHaveBeenCalledWith("1 cor salva.");
    await t.desmontar();
  });

  it("o Salvar do cabeçalho grava o TECIDO e depois TODAS as cores sujas (cada uma com SÓ os campos tocados; sem assinatura quando o preço não mudou)", async () => {
    const t = await montar();
    const [li1, li2] = lis(t.container);
    await expandir(li1); await expandir(li2);
    await digitar(nomeTecido(t.container), "Tecido Novo");
    await digitar(campos(li1)[0], "Malha Fria");
    await digitar(campos(li2)[1], "X-77");
    expect(salvaRpcs().length).toBe(0);
    expect(artigoUpdates.length).toBe(0); // tudo solto até o Salvar

    await salvarGeral(t.container);
    await flush(80);
    expect(ordem).toEqual(["artigos.update", "rpc:set_artigo_categorias", "rpc:salvar_variante_tecido", "rpc:salvar_variante_tecido"]);
    expect(artigoUpdates[0].nome).toBe("Tecido Novo");
    const chamadas = salvaRpcs().map((c) => c[1]);
    expect(chamadas.find((a) => a._id === V1)._mudancas).toEqual({ nome_variante: "Malha Fria" });
    expect(chamadas.find((a) => a._id === V2)._mudancas).toEqual({ codigo_variante: "X-77" });
    expect(chamadas.every((a) => a._assinatura === null)).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("Tecido atualizado e 2 cores salvas.");
    await flush(60);
    expect(t.container.textContent).not.toContain("editado");
    expect(t.container.textContent).not.toContain("alterações não salvas");
    expect(porLabel(t.container, "Descartar alterações")).toBeNull();
    await t.desmontar();
  });

  it("NÃO existe mais 'Salvar todos' nem ✓/↺ por cor, com 1 ou 2 cores sujas — só UM botão Salvar", async () => {
    const t = await montar();
    const [li1, li2] = lis(t.container);
    await expandir(li1); await expandir(li2);
    await digitar(campos(li1)[0], "Malha Fria");
    await digitar(campos(li2)[1], "X-77");
    expect(botoesComTexto(t.container, "Salvar todos").length).toBe(0);
    expect(t.container.querySelectorAll('[aria-label="Salvar esta cor"], [aria-label="Desfazer esta cor"]').length).toBe(0);
    expect(t.container.querySelectorAll('[aria-label="Salvar"]').length).toBe(1);
    expect(li1.querySelectorAll('[aria-label^="Salvar"], [aria-label^="Desfazer"]').length).toBe(0);
    await t.desmontar();
  });

  it("Descartar alterações volta o tecido E todas as cores ao que está no banco (nenhuma RPC)", async () => {
    const t = await montar();
    const [li1, li2] = lis(t.container);
    await expandir(li1); await expandir(li2);
    await digitar(nomeTecido(t.container), "Tecido Novo");
    await digitar(campos(li1)[2], "99");
    await digitar(campos(li2)[1], "X-77");
    expect(porLabel(t.container, "Descartar alterações")).toBeTruthy();

    await descartarGeral(t.container);
    await flush();
    expect(nomeTecido(t.container).value).toBe("Tecido Teste");
    expect(campos(li1)[2].value).toBe("10,00"); // o MoneyInput remontou com o valor do banco
    expect(campos(li2)[1].value).toBe("");
    expect(t.container.textContent).not.toContain("editado");
    expect(t.container.textContent).not.toContain("alterações não salvas");
    expect(porLabel(t.container, "Descartar alterações")).toBeNull();
    expect(salvaRpcs().length).toBe(0);
    expect(artigoUpdates.length).toBe(0);
    await t.desmontar();
  });

  it("nada sujo: o Salvar segue gravando o tecido (comportamento de sempre)", async () => {
    const t = await montar();
    await salvarGeral(t.container);
    await flush(60);
    expect(ordem).toEqual(["artigos.update", "rpc:set_artigo_categorias"]);
    expect(toast.success).toHaveBeenCalledWith("Tecido atualizado.");
    await t.desmontar();
  });

  it("conflito do TECIDO (rev) aborta ANTES das cores: nenhuma cor é gravada e todas seguem sujas", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await digitar(nomeTecido(t.container), "Tecido Novo");
    await digitar(campos(li1)[0], "Meu nome");
    estado.artigoUpdate = { data: [], error: null }; // outra pessoa salvou o tecido: 0 linhas casam o rev
    await salvarGeral(t.container);
    await flush(80);
    expect(salvaRpcs().length).toBe(0);
    expect(toast.warning).toHaveBeenCalledWith(expect.stringContaining("Alguém salvou este tecido agora"));
    expect(li1.textContent).toContain("editado");
    expect(t.container.textContent).toContain("alterações não salvas");
    await t.desmontar();
  });

  it("prévia de preço: 'até 3 produtos terão o custo recalculado' (plural) e 'até 1 produto terá…' (singular); 0 não mostra nada", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await digitar(campos(li1)[2], "12");
    expect(li1.textContent).not.toContain("terá o custo"); // ainda dentro do atraso
    await flush(PREVIA_MS);
    expect(li1.textContent).toContain("até 3 produtos terão o custo recalculado");
    expect(salvaRpcs().length).toBe(0); // só mostra; o efeito real grava no Salvar

    rpc.mockImplementation(async (nome: string, args: any) => ({ data: { afetados: 1, assinatura: `s1-${args._preco}` }, error: null }));
    await digitar(campos(li1)[2], "13");
    await flush(PREVIA_MS);
    expect(li1.textContent).toContain("até 1 produto terá o custo recalculado");

    rpc.mockImplementation(async (nome: string, args: any) => ({ data: { afetados: 0, assinatura: `s0-${args._preco}` }, error: null }));
    await digitar(campos(li1)[2], "14");
    await flush(PREVIA_MS);
    expect(li1.textContent).not.toContain("custo recalculado");
    await t.desmontar();
  });

  it("M4: recalculando a prévia, o último 'até N' FICA (esmaecido) em vez de virar 'calculando…' (sem piscar); ao chegar volta ao normal", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await digitar(campos(li1)[2], "12");
    await flush(PREVIA_MS);
    const linha = () => li1.querySelector("[data-previa-linha]") as HTMLElement;
    const texto = () => li1.querySelector("[data-previa-texto]") as HTMLElement | null;
    expect(linha()).toBeTruthy(); // a linha existe (altura reservada) mesmo antes de haver texto
    // altura reservada = a linha do Label vizinho (<label> inline: o pai struta ~24px = h-6, medido no Chromium); h-3.5/min-h-5 desalinham Preço × Código no md:grid-cols-3
    expect(linha().className).toMatch(/(^|\s)h-6(\s|$)/);
    expect(linha().className).not.toContain("min-h-");
    expect(texto()?.textContent).toContain("até 3 produtos terão o custo recalculado");
    expect(texto()?.className).not.toContain("opacity-60");

    // a próxima prévia demora: segura a resposta até liberarmos
    let liberar!: () => void;
    const segura = new Promise<void>((r) => { liberar = r; });
    rpc.mockImplementation(async (nome: string, args: any) => {
      if (nome === "variante_tecido_preco_previa") { await segura; return { data: { afetados: 1, assinatura: `s1-${args._preco}` }, error: null }; }
      return { data: null, error: null };
    });
    await digitar(campos(li1)[2], "13");
    await flush(PREVIA_MS); // pedido já saiu e NÃO voltou: carregando
    expect(li1.textContent).not.toContain("calculando o efeito…"); // o texto visível antigo (o sr-only do spinner não leva reticências)
    expect(texto()?.textContent).toContain("até 3 produtos terão o custo recalculado"); // o último valor continua visível…
    expect(texto()?.className).toContain("opacity-60"); // …esmaecido
    expect(li1.querySelector("[data-previa-calculando]")).toBeTruthy(); // e há o sinal de que está recalculando
    expect(li1.querySelector("[data-previa-calculando]")?.getAttribute("role")).toBe("status"); // acessível ao leitor de tela

    liberar();
    await flush(60);
    expect(texto()?.textContent).toContain("até 1 produto terá o custo recalculado");
    expect(texto()?.className).not.toContain("opacity-60");
    expect(li1.querySelector("[data-previa-calculando]")).toBeNull();

    // preço de volta ao original: a linha some mas a altura continua reservada
    await digitar(campos(li1)[2], "10");
    await flush(PREVIA_MS);
    expect(texto()).toBeNull();
    expect(linha()).toBeTruthy();
    await t.desmontar();
  });

  it("Salvar logo depois de digitar o preço ESPERA a prévia (não manda assinatura velha nem nula)", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await digitar(campos(li1)[2], "31");
    await salvarGeral(t.container); // ainda no atraso da prévia
    expect(salvaRpcs().length).toBe(0);
    await flush(PREVIA_MS + 100);
    // (dentro de um `act` assíncrono o React só renderiza ao sair: o laço de espera da tela enxerga a prévia pronta depois)
    await flush(160);
    expect(salvaRpcs().length).toBe(1);
    expect(salvaRpcs()[0][1]._assinatura).toBe("sig-31");
    await t.desmontar();
  });

  it("prévia FALHOU: o Salvar não grava ESSA cor (sem gravar às cegas), diz a verdade no aviso da cor; re-editar o preço repede a prévia", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    rpc.mockImplementation(async (nome: string) => nome === "variante_tecido_preco_previa"
      ? { data: null, error: { message: "boom" } } : { data: null, error: null });
    await digitar(campos(li1)[2], "50");
    await flush(PREVIA_MS);
    await salvarGeral(t.container);
    await flush(60);
    expect(salvaRpcs().length).toBe(0);
    expect(aviso(li1)).toContain("Não consegui calcular o efeito do preço");
    expect(aviso(li1)).not.toContain("Aguarde");
    expect(toast.error).toHaveBeenCalledWith("1 cor com erro — veja o aviso na cor.");
    expect(li1.textContent).toContain("editado"); // segue suja

    const antes = previaRpcs().length;
    rpc.mockImplementation(async (nome: string, args: any) => nome === "variante_tecido_preco_previa"
      ? { data: { afetados: 2, assinatura: `ok-${args._preco}` }, error: null } : { data: null, error: null });
    await digitar(campos(li1)[2], "51");
    await flush(PREVIA_MS);
    expect(previaRpcs().length).toBeGreaterThan(antes); // re-editar repediu
    await salvarGeral(t.container);
    await flush(60);
    expect(salvaRpcs()[0][1]._assinatura).toBe("ok-51");
    expect(aviso(li1)).toBe("");
    await t.desmontar();
  });

  it("Esc numa cor editada DESFAZ só aquela cor; Enter NÃO salva nada (não há save por item)", async () => {
    const t = await montar();
    const [li1, li2] = lis(t.container);
    await expandir(li1); await expandir(li2);
    const nome = campos(li1)[0];
    await tecla(nome, "Enter"); // limpa
    await tecla(nome, "Escape");
    expect(salvaRpcs().length).toBe(0);

    await digitar(nome, "Outro");
    await digitar(campos(li2)[1], "X9");
    await tecla(campos(li1)[0], "Enter"); // sujo: Enter NÃO grava (nem a cor, nem o tecido)
    await flush();
    expect(salvaRpcs().length).toBe(0);
    expect(artigoUpdates.length).toBe(0);
    expect(li1.textContent).toContain("editado");

    await tecla(campos(li1)[0], "Escape");
    await flush();
    expect(campos(li1)[0].value).toBe("Malha");
    expect(li1.textContent).not.toContain("editado");
    expect(li2.textContent).toContain("editado"); // a outra segue intacta
    expect(campos(li2)[1].value).toBe("X9");
    expect(salvaRpcs().length).toBe(0);
    await t.desmontar();
  });

  it("trocar a cor base zera o apelido incompatível e manda cor_apelido_id:null JUNTO de cor_id (minúsculo)", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await clicar(item(selects(li1)[0], COR_B)); // a1 é da cor A; B não tem a1
    expect(selects(li1)[1].getAttribute("data-value")).toBe(""); // apelido zerado no rascunho
    expect(salvaRpcs().length).toBe(0);
    await salvarGeral(t.container);
    await flush();
    expect(salvaRpcs()[0][1]._mudancas).toEqual({ cor_id: COR_B.toLowerCase(), cor_apelido_id: null });
    await t.desmontar();
  });

  it("escolher um apelido de outra cor preenche a cor base junto", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await clicar(item(selects(li1)[1], AP_A1)); // mesmo apelido: nada muda
    expect(li1.textContent).not.toContain("editado");
    // sem filtro de base não há como listar o apelido de B com A selecionada → limpa a base e escolhe
    await clicar(item(selects(li1)[0], COR_B));
    await clicar(item(selects(li1)[1], AP_B1));
    await salvarGeral(t.container);
    await flush();
    expect(salvaRpcs()[0][1]._mudancas).toEqual({ cor_id: COR_B.toLowerCase(), cor_apelido_id: AP_B1.toLowerCase() });
    await t.desmontar();
  });

  it("conflito P0409 numa cor NÃO perde o resto: o tecido e a outra cor ficam gravados, a cor em conflito segue suja com merge por campo", async () => {
    const t = await montar();
    const [li1, li2] = lis(t.container);
    await expandir(li1); await expandir(li2);
    await digitar(nomeTecido(t.container), "Tecido Novo");
    await digitar(campos(li1)[0], "Meu nome");
    await digitar(campos(li2)[1], "X-77");
    const padrao = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (nome: string, args: any) => {
      if (nome === "salvar_variante_tecido" && args._id === V1) {
        // outra pessoa mexeu no nome E no código desta cor antes do meu Salvar
        estado.variantes[0].nome_variante = "Nome dela";
        estado.variantes[0].codigo_variante = "C9";
        return { data: null, error: { code: "P0409", message: "conflito_versao: variante_tecido", details: "nome_variante,codigo_variante" } };
      }
      return padrao(nome, args);
    });
    await salvarGeral(t.container);
    await flush(100);

    // tecido e a OUTRA cor gravados
    expect(artigoUpdates[0].nome).toBe("Tecido Novo");
    expect(salvaRpcs().find((c) => c[1]._id === V2)![1]._mudancas).toEqual({ codigo_variante: "X-77" });
    expect(estado.variantes[1].codigo_variante).toBe("X-77");
    expect(li2.textContent).not.toContain("editado");
    expect(toast.error).toHaveBeenCalledWith("Tecido atualizado e 1 cor salva; 1 cor com erro — veja o aviso na cor.");
    expect(nomeTecido(t.container).value).toBe("Tecido Novo");

    // a cor em conflito: suja, com aviso, adotou o campo que NÃO toquei e oferece 'manter meu / usar o novo' no que os dois mexemos
    expect(li1.textContent).toContain("editado");
    expect(aviso(li1)).toContain("Outra pessoa alterou esta cor");
    expect(campos(li1)[1].value).toBe("C9");
    expect(campos(li1)[0].value).toBe("Meu nome");
    expect(li1.textContent).toContain("Outra pessoa mudou este campo para");
    expect(li1.textContent).toContain("Nome dela");
    expect(t.container.textContent).toContain("alterações não salvas"); // o Salvar não 'fecha' enquanto houver cor suja

    // com o conflito aberto o Salvar NÃO manda a cor
    const antes = salvaRpcs().length;
    await salvarGeral(t.container);
    await flush(80);
    expect(salvaRpcs().length).toBe(antes);
    expect(aviso(li1)).toContain("Resolva os campos em conflito");

    // "usar o novo" adota o do servidor e a cor volta a limpa
    await clicar(Array.from(li1.querySelectorAll("button")).find((b) => b.textContent === "Usar o novo"));
    await flush();
    expect(campos(li1)[0].value).toBe("Nome dela");
    expect(li1.textContent).not.toContain("editado");
    expect(aviso(li1)).toBe("");
    await t.desmontar();
  });

  it("conflito + 'manter meu': o próximo Salvar manda a base NOVA do servidor", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await digitar(campos(li1)[0], "Meu nome");
    let primeira = true;
    rpc.mockImplementation(async (nome: string, args: any) => {
      if (nome === "variante_tecido_preco_previa") return { data: { afetados: 0, assinatura: "s" }, error: null };
      if (primeira) {
        primeira = false;
        estado.variantes[0].nome_variante = "Nome dela";
        return { data: null, error: { code: "P0409", message: "conflito_versao: variante_tecido" } };
      }
      Object.assign(estado.variantes[0], args._mudancas);
      return { data: null, error: null };
    });
    await salvarGeral(t.container);
    await flush(80);
    await clicar(Array.from(li1.querySelectorAll("button")).find((b) => b.textContent === "Manter meu"));
    await salvarGeral(t.container);
    await flush(80);
    const ultima = salvaRpcs().at(-1)![1];
    expect(ultima._mudancas).toEqual({ nome_variante: "Meu nome" });
    expect(ultima._base.nome_variante).toBe("Nome dela");
    expect(li1.textContent).not.toContain("editado");
    await t.desmontar();
  });

  it("previa_desatualizada: NÃO grava essa cor, repede a prévia e avisa 'o resultado mudou'", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await digitar(campos(li1)[2], "40");
    await flush(PREVIA_MS);
    const previasAntes = previaRpcs().length;
    rpc.mockImplementation(async (nome: string) => {
      if (nome === "variante_tecido_preco_previa") return { data: { afetados: 5, assinatura: "nova" }, error: null };
      return { data: null, error: { code: "P0409", message: "previa_desatualizada: salvar_preco" } };
    });
    await salvarGeral(t.container);
    await flush(PREVIA_MS + 100);
    expect(previaRpcs().length).toBeGreaterThan(previasAntes);
    expect(aviso(li1)).toMatch(/resultado mudou/i);
    expect(toast.success).not.toHaveBeenCalled();
    expect(li1.textContent).toContain("editado"); // segue suja
    expect(li1.textContent).toContain("até 5 produtos terão o custo recalculado");
    await t.desmontar();
  });

  it("23505 (cor+apelido duplicados) numa cor vira mensagem clara NA COR; a outra cor é gravada e a duplicada segue suja", async () => {
    const t = await montar();
    const [li1, li2] = lis(t.container);
    await expandir(li1); await expandir(li2);
    await clicar(item(selects(li1)[0], COR_B));
    await clicar(item(selects(li1)[1], AP_B1)); // v2 já é B/b1
    await digitar(campos(li2)[1], "X-77");
    const padrao = rpc.getMockImplementation()!;
    rpc.mockImplementation(async (nome: string, args: any) =>
      nome === "salvar_variante_tecido" && args._id === V1
        ? { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "uq_variantes_tecido_artigo_cor_apelido"' } }
        : padrao(nome, args));
    await salvarGeral(t.container);
    await flush(80);
    expect(aviso(li1)).toContain("Já existe uma variante com essa cor e apelido.");
    expect(li1.textContent).toContain("editado");
    expect(estado.variantes[1].codigo_variante).toBe("X-77"); // a outra gravou
    expect(li2.textContent).not.toContain("editado");
    expect(toast.error).toHaveBeenCalledWith("1 cor salva; 1 cor com erro — veja o aviso na cor.");
    await t.desmontar();
  });

  it("outra pessoa salva (refetch) com a cor SUJA: o campo que não toquei adota o do servidor sem conflito", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await digitar(campos(li1)[0], "Meu nome");
    estado.variantes[0].codigo_variante = "Z9";
    await act(async () => { await t.qc.invalidateQueries({ queryKey: ["variantes", "art1"] }); });
    await flush(60);
    expect(campos(li1)[1].value).toBe("Z9");
    expect(campos(li1)[0].value).toBe("Meu nome");
    expect(li1.textContent).not.toContain("Outra pessoa mudou este campo");
    await salvarGeral(t.container);
    await flush();
    expect(salvaRpcs()[0][1]._mudancas).toEqual({ nome_variante: "Meu nome" }); // só o meu
    expect(salvaRpcs()[0][1]._base.codigo_variante).toBe("Z9");
    await t.desmontar();
  });
});

describe("Cores — modo só leitura", () => {
  it("sem selo 'editado', sem Salvar todos, campos travados", async () => {
    const t = await montarSecao({ readOnly: true });
    const [li1] = lis(t.container);
    await expandir(li1);
    expect(campos(li1).every((i) => i.readOnly)).toBe(true);
    expect(selects(li1).length).toBe(2);
    expect(item(selects(li1)[0], COR_B).disabled).toBe(true);
    expect(li1.querySelector("[data-selo-editado]")).toBeNull();
    expect(t.container.textContent).not.toContain("Salvar todos");
    await t.desmontar();
  });
});

describe("helpers puros do Salvar por card (cores)", () => {
  it("canonicoParaNumero: vírgula decimal/milhar pelo parser do money-mask, nunca NaN", async () => {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));
    const m = await import("@/routes/_authenticated/cadastro.tecidos.$artigoId");
    expect(m.canonicoParaNumero("25.5")).toBe(25.5); // canônico do MoneyInput
    expect(m.canonicoParaNumero("20,50")).toBe(20.5);
    expect(m.canonicoParaNumero("1.234,56")).toBe(1234.56);
    expect(m.canonicoParaNumero("0.10")).toBe(0.1);
    expect(m.canonicoParaNumero("")).toBeNull();
    expect(m.canonicoParaNumero(null)).toBeNull();
    expect(m.canonicoParaNumero("abc")).toBeNull();
    expect(m.canonicoParaNumero(7)).toBe(7);
  });

  it("draftParaServidor: uuid minúsculo/null, texto vazio = null, preço número", async () => {
    vi.resetModules();
    vi.doMock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));
    const m = await import("@/routes/_authenticated/cadastro.tecidos.$artigoId");
    expect(m.draftParaServidor({ cor_id: COR_A, cor_apelido_id: "", nome_variante: "", codigo_variante: "C1", preco: 12.5 })).toEqual({
      cor_id: COR_A.toLowerCase(), cor_apelido_id: null, nome_variante: null, codigo_variante: "C1", preco: 12.5,
    });
    expect(m.draftParaServidor({ preco: null })).toEqual({ preco: null });
    expect(m.textoPreviaPreco(2)).toBe("até 2 produtos terão o custo recalculado");
    expect(m.textoPreviaPreco(1)).toBe("até 1 produto terá o custo recalculado");
    expect(m.textoPreviaPreco(0)).toBeNull();
    expect(m.textoPreviaPreco(undefined)).toBeNull();
  });
});

describe("fonte da tela (pinos)", () => {
  const src = readFileSync(resolve(__dirname, "../../src/routes/_authenticated/cadastro.tecidos.$artigoId.tsx"), "utf8");
  it("a cor não grava mais por campo; o saveMut direto fica SÓ para a foto", () => {
    expect(src).not.toMatch(/saveMut\.mutate\(\{\s*(cor_id|cor_apelido_id|nome_variante|codigo_variante|preco)/);
    expect(src.match(/saveMut\.mutate\(\{/g)?.length).toBe(1);
    expect(src).toContain("saveMut.mutate({ foto_url: path })");
  });
  it("o UM Salvar do cabeçalho percorre as cores sujas (registry) e a tela não usa mais ✓/↺ nem 'Salvar todos'", () => {
    expect(src).toMatch(/await salvarTodos\(\)/);
    expect(src).toContain("descartarTodos()");
    expect(src).not.toMatch(/<CardSaveControls|BarraSalvarTodasCores|RelataCoresSujas/);
    expect(src).not.toMatch(/Salvar todos \(|Salvar esta cor|Desfazer esta cor/);
    expect(src).not.toMatch(/onSujosChange/);
  });
  it("o preço da cor é MoneyInput (não <input type=number>)", () => {
    const linha = src.slice(src.indexOf("function VariantRow({"));
    expect(linha).toContain("<MoneyInput");
    expect(linha).not.toMatch(/type="number"/);
  });
});
