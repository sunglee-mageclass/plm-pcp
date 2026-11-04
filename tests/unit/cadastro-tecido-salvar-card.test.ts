// @vitest-environment happy-dom
// "Salvar por card" no Cadastro › Tecidos (as CORES/variantes) — Tarefa 5 do plano `2026-11-04-salvar-por-card-tecido`.
// Render de verdade de `VariantesSection` (react-dom/client + act; o projeto não tem @testing-library/react e o vitest só
// inclui `*.test.ts` — por isso sem JSX). `supabase` é mockado (rpc + from); o Select do Radix é trocado por um stub de botões
// (a lógica testada é a dos handlers da tela, não a do Radix).
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

const estado = { variantes: novasVariantes() };
const rpc = vi.fn();
const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };

function chain(dados: () => unknown) {
  const c: any = {
    select: () => c, eq: () => c, order: () => c, update: () => c, insert: () => c,
    then: (res: (v: unknown) => unknown) => res({ data: dados(), error: null }),
  };
  return c;
}
const supabaseMock = {
  rpc: (...a: unknown[]) => rpc(...a),
  from: (t: string) => chain(() =>
    t === "cores" ? [{ id: COR_A, nome: "Azul" }, { id: COR_B, nome: "Verde" }]
    : t === "cores_apelido" ? [{ id: AP_A1, nome: "Marinho", cor_base_id: COR_A }, { id: AP_B1, nome: "Musgo", cor_base_id: COR_B }]
    : t === "variantes_tecido" ? estado.variantes.map((v) => ({ ...v }))
    : []),
  storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function montar(props: { readOnly?: boolean } = {}) {
  vi.resetModules();
  vi.doMock("@/integrations/supabase/client", () => ({ supabase: supabaseMock }));
  vi.doMock("sonner", () => ({ toast }));
  vi.doMock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null, VARIANT_BUCKET: "variantes" }));
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
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { VariantesSection } = await import("@/routes/_authenticated/cadastro.tecidos.$artigoId");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onSujosChange = vi.fn();
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc },
      createElement(VariantesSection, { artigoId: "art1", readOnly: props.readOnly ?? false, precoArtigo: null, onSujosChange })));
  });
  await flush(40);
  return {
    container, qc, onSujosChange,
    desmontar: async () => { await act(async () => { root.unmount(); }); container.remove(); },
  };
}

const flush = (ms = 30) => act(async () => { await sleep(ms); });
const PREVIA_MS = 380; // atraso da prévia (300) + folga

const lis = (c: HTMLElement) => Array.from(c.querySelectorAll("ul > li")) as HTMLElement[];
const porLabel = (li: HTMLElement, label: string) => li.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
const clicar = (el: Element | null) => act(async () => { (el as HTMLElement).click(); });
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

beforeEach(() => {
  estado.variantes = novasVariantes();
  rpc.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
  rpc.mockImplementation(async (nome: string, args: any) => {
    if (nome === "variante_tecido_preco_previa") return { data: { afetados: 3, assinatura: `sig-${args._preco}` }, error: null };
    if (nome === "salvar_variante_tecido") {
      const v = estado.variantes.find((x) => x.id === args._id)!;
      Object.assign(v, args._mudancas);
      return { data: null, error: null };
    }
    return { data: null, error: null };
  });
});

describe("Cadastro › Tecidos — Salvar por card (cores)", () => {
  it("editar o preço: 'não salvo' + ✓/↺, NÃO chama a RPC ao digitar; ✓ manda _mudancas:{preco: NÚMERO} + _assinatura", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    expect(porLabel(li1, "Salvar esta cor")).toBeNull(); // limpo: sem controles
    await expandir(li1);
    await digitar(campos(li1)[2], "25,5"); // centavos com vírgula: Number() cru daria NaN
    expect(li1.textContent).toContain("não salvo");
    expect(porLabel(li1, "Salvar esta cor")).toBeTruthy();
    expect(porLabel(li1, "Desfazer esta cor")).toBeTruthy();
    expect(salvaRpcs().length).toBe(0); // digitar não grava

    await flush(PREVIA_MS);
    expect(previaRpcs().at(-1)).toEqual(["variante_tecido_preco_previa", { _id: V1, _preco: 25.5 }]);

    await clicar(porLabel(li1, "Salvar esta cor"));
    await flush();
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
    expect(li1.textContent).not.toContain("não salvo");
    expect(toast.success).toHaveBeenCalledWith("Cor salva.");
    await t.desmontar();
  });

  it("↺ Desfazer volta ao valor salvo e some o 'não salvo'", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await digitar(campos(li1)[2], "99");
    expect(li1.textContent).toContain("não salvo");
    await clicar(porLabel(li1, "Desfazer esta cor"));
    await flush();
    expect(li1.textContent).not.toContain("não salvo");
    expect(campos(li1)[2].value).toBe("10,00");
    expect(salvaRpcs().length).toBe(0);
    await t.desmontar();
  });

  it("editar as 2 cores: 'Salvar todos (2)' aparece e salva as duas (só os campos tocados; sem assinatura quando o preço não mudou)", async () => {
    const t = await montar();
    const [li1, li2] = lis(t.container);
    await expandir(li1); await expandir(li2);
    expect(t.container.textContent).not.toContain("Salvar todos");
    await digitar(campos(li1)[0], "Malha Fria");
    await digitar(campos(li2)[1], "X-77");
    const botao = Array.from(t.container.querySelectorAll("button")).find((b) => b.textContent?.includes("Salvar todos (2)"));
    expect(botao).toBeTruthy();
    expect(t.onSujosChange).toHaveBeenLastCalledWith(2);

    await clicar(botao!);
    await flush(60);
    const chamadas = salvaRpcs().map((c) => c[1]);
    expect(chamadas.length).toBe(2);
    expect(chamadas.find((a) => a._id === V1)._mudancas).toEqual({ nome_variante: "Malha Fria" });
    expect(chamadas.find((a) => a._id === V2)._mudancas).toEqual({ codigo_variante: "X-77" });
    expect(chamadas.every((a) => a._assinatura === null)).toBe(true);
    expect(toast.success).toHaveBeenCalledWith("2 cores salvas.");
    await flush(60);
    expect(t.container.textContent).not.toContain("Salvar todos");
    expect(t.onSujosChange).toHaveBeenLastCalledWith(0);
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

  it("✓ logo depois de digitar o preço espera a prévia (não manda assinatura velha nem nula)", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await digitar(campos(li1)[2], "31");
    await clicar(porLabel(li1, "Salvar esta cor")); // ainda no atraso da prévia
    expect(salvaRpcs().length).toBe(0);
    await flush(PREVIA_MS + 100);
    // (dentro de um `act` assíncrono o React só renderiza ao sair: o laço de espera da tela enxerga a prévia pronta depois)
    await flush(160);
    expect(salvaRpcs().length).toBe(1);
    expect(salvaRpcs()[0][1]._assinatura).toBe("sig-31");
    await t.desmontar();
  });

  it("Enter (campo de texto, card sujo) salva; Esc desfaz; card limpo ou alvo fora dos campos não faz nada", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    const nome = campos(li1)[0];
    await tecla(nome, "Enter"); // limpo
    await tecla(nome, "Escape");
    expect(salvaRpcs().length).toBe(0);

    await digitar(nome, "Outro");
    await tecla(nome, "Escape");
    await flush();
    expect(campos(li1)[0].value).toBe("Malha");
    expect(li1.textContent).not.toContain("não salvo");

    await digitar(campos(li1)[0], "Outro");
    // Enter vindo de um botão (ex.: item de um Select aberto) NÃO salva
    await tecla(item(selects(li1)[0], COR_B), "Enter");
    expect(salvaRpcs().length).toBe(0);
    await tecla(campos(li1)[0], "Enter");
    await flush();
    expect(salvaRpcs().length).toBe(1);
    expect(salvaRpcs()[0][1]._mudancas).toEqual({ nome_variante: "Outro" });
    await t.desmontar();
  });

  it("trocar a cor base zera o apelido incompatível e manda cor_apelido_id:null JUNTO de cor_id (minúsculo)", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await clicar(item(selects(li1)[0], COR_B)); // a1 é da cor A; B não tem a1
    expect(selects(li1)[1].getAttribute("data-value")).toBe(""); // apelido zerado no rascunho
    expect(salvaRpcs().length).toBe(0);
    await clicar(porLabel(li1, "Salvar esta cor"));
    await flush();
    expect(salvaRpcs()[0][1]._mudancas).toEqual({ cor_id: COR_B.toLowerCase(), cor_apelido_id: null });
    await t.desmontar();
  });

  it("escolher um apelido de outra cor preenche a cor base junto", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await clicar(item(selects(li1)[1], AP_A1)); // mesmo apelido: nada muda
    expect(li1.textContent).not.toContain("não salvo");
    // sem filtro de base não há como listar o apelido de B com A selecionada → limpa a base e escolhe
    await clicar(item(selects(li1)[0], COR_B));
    await clicar(item(selects(li1)[1], AP_B1));
    await clicar(porLabel(li1, "Salvar esta cor"));
    await flush();
    expect(salvaRpcs()[0][1]._mudancas).toEqual({ cor_id: COR_B.toLowerCase(), cor_apelido_id: AP_B1.toLowerCase() });
    await t.desmontar();
  });

  it("P0409 conflito_versao: relê, adota o campo que NÃO toquei e oferece 'manter meu / usar o novo' no que os dois mexemos", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await digitar(campos(li1)[0], "Meu nome");
    rpc.mockImplementation(async (nome: string, args: any) => {
      if (nome === "variante_tecido_preco_previa") return { data: { afetados: 0, assinatura: "s" }, error: null };
      // outra pessoa mexeu no nome E no código antes do meu Salvar
      estado.variantes[0].nome_variante = "Nome dela";
      estado.variantes[0].codigo_variante = "C9";
      return { data: null, error: { code: "P0409", message: "conflito_versao: variante_tecido", details: "nome_variante,codigo_variante" } };
    });
    await clicar(porLabel(li1, "Salvar esta cor"));
    await flush(80);
    expect(toast.warning).toHaveBeenCalled();
    expect(campos(li1)[1].value).toBe("C9"); // não toquei o código: adota o do servidor
    expect(campos(li1)[0].value).toBe("Meu nome"); // o meu fica
    expect(li1.textContent).toContain("Outra pessoa mudou este campo para");
    expect(li1.textContent).toContain("Nome dela");
    expect(li1.textContent).toContain("não salvo");

    // com o conflito aberto o ✓ NÃO manda nada
    const antes = salvaRpcs().length;
    await clicar(porLabel(li1, "Salvar esta cor"));
    await flush();
    expect(salvaRpcs().length).toBe(antes);

    // "usar o novo" adota o do servidor e o card volta a limpo
    const usar = Array.from(li1.querySelectorAll("button")).find((b) => b.textContent === "Usar o novo")!;
    await clicar(usar);
    await flush();
    expect(campos(li1)[0].value).toBe("Nome dela");
    expect(li1.textContent).not.toContain("não salvo");
    await t.desmontar();
  });

  it("P0409 conflito + 'manter meu': o próximo Salvar manda a base NOVA do servidor", async () => {
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
    await clicar(porLabel(li1, "Salvar esta cor"));
    await flush(80);
    await clicar(Array.from(li1.querySelectorAll("button")).find((b) => b.textContent === "Manter meu")!);
    await clicar(porLabel(li1, "Salvar esta cor"));
    await flush(80);
    const ultima = salvaRpcs().at(-1)![1];
    expect(ultima._mudancas).toEqual({ nome_variante: "Meu nome" });
    expect(ultima._base.nome_variante).toBe("Nome dela");
    expect(li1.textContent).not.toContain("não salvo");
    await t.desmontar();
  });

  it("P0409 previa_desatualizada: NÃO grava, repede a prévia e avisa 'o resultado mudou'", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await digitar(campos(li1)[2], "40");
    await flush(PREVIA_MS);
    const previasAntes = previaRpcs().length;
    rpc.mockImplementation(async (nome: string, args: any) => {
      if (nome === "variante_tecido_preco_previa") return { data: { afetados: 5, assinatura: "nova" }, error: null };
      return { data: null, error: { code: "P0409", message: "previa_desatualizada: salvar_preco" } };
    });
    await clicar(porLabel(li1, "Salvar esta cor"));
    await flush(PREVIA_MS + 100);
    expect(previaRpcs().length).toBeGreaterThan(previasAntes);
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/resultado mudou/i));
    expect(toast.success).not.toHaveBeenCalled();
    expect(li1.textContent).toContain("não salvo"); // segue sujo
    expect(li1.textContent).toContain("até 5 produtos terão o custo recalculado");
    await t.desmontar();
  });

  it("23505 (cor+apelido duplicados) vira mensagem clara; o card segue sujo", async () => {
    const t = await montar();
    const [li1] = lis(t.container);
    await expandir(li1);
    await clicar(item(selects(li1)[0], COR_B));
    await clicar(item(selects(li1)[1], AP_B1)); // v2 já é B/b1
    rpc.mockImplementation(async () => ({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "uq_variantes_tecido_artigo_cor_apelido"' } }));
    await clicar(porLabel(li1, "Salvar esta cor"));
    await flush();
    expect(toast.error).toHaveBeenCalledWith("Já existe uma variante com essa cor e apelido.");
    expect(li1.textContent).toContain("não salvo");
    await t.desmontar();
  });

  it("outra pessoa salva (refetch) com o card SUJO: o campo que não toquei adota o do servidor sem conflito", async () => {
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
    await clicar(porLabel(li1, "Salvar esta cor"));
    await flush();
    expect(salvaRpcs()[0][1]._mudancas).toEqual({ nome_variante: "Meu nome" }); // só o meu
    expect(salvaRpcs()[0][1]._base.codigo_variante).toBe("Z9");
    await t.desmontar();
  });

  it("só leitura: sem ✓/↺, sem 'Salvar todos', campos travados", async () => {
    const t = await montar({ readOnly: true });
    const [li1] = lis(t.container);
    await expandir(li1);
    expect(campos(li1).every((i) => i.readOnly)).toBe(true);
    expect(selects(li1).length).toBe(2);
    expect(item(selects(li1)[0], COR_B).disabled).toBe(true);
    expect(porLabel(li1, "Salvar esta cor")).toBeNull();
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
  it("o preço da cor é MoneyInput (não <input type=number>)", () => {
    const linha = src.slice(src.indexOf("function VariantRow({"));
    expect(linha).toContain("<MoneyInput");
    expect(linha).not.toMatch(/type="number"/);
  });
});
