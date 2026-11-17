// @vitest-environment happy-dom
// F7 Armário · D4 — tela de MONTAGEM: render real (react-dom + happy-dom) com supabase mockado. happy-dom não faz drag real
// de ponteiro: os handlers são exercitados chamando o `onDragEnd` capturado do DndContext (como a D2) + as regras PURAS (lib).
//   itens na ordem salva com índice 1..N · item com cor sumida = "cor removida" · reordenar muda a sequência ·
//   soltar do dialog insere · variante já na grade não duplica · mudar COLUNAS não muda a ordem 1..N ·
//   publicado barra edição · Salvar manda a lista na ordem + colunas + status atual.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rpcMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
const dados = vi.hoisted(() => ({ tabelas: {} as Record<string, any> }));
const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((ev: any) => void) }));
const permissao = vi.hoisted(() => ({ readOnly: false }));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (tabela: string) => {
    const b: any = new Proxy({}, {
      get(_, prop: string) {
        if (prop === "maybeSingle") return () => Promise.resolve({ data: dados.tabelas[tabela] ?? null, error: null });
        if (prop === "then") return (res: any, rej: any) => Promise.resolve({ data: dados.tabelas[tabela] ?? [], error: null }).then(res, rej);
        return () => b;
      },
    });
    return b;
  };
  return { supabase: { rpc: rpcMock, from: builder } };
});
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/components/RequirePermission", () => ({ useReadOnly: () => permissao.readOnly }));
vi.mock("@/components/shared/Breadcrumb", () => ({ Breadcrumb: () => null })); // usa <Link> (exige RouterProvider)
vi.mock("@/components/plan-tecido/ModeloThumb", () => ({ ModeloThumb: () => null })); // usa storage assinado
vi.mock("@tanstack/react-router", async (orig) => ({ ...(await orig<typeof import("@tanstack/react-router")>()), useBlocker: () => ({ status: "idle" }) }));
// Select Radix não abre em happy-dom: troca por <select> nativo (mesma API value/onValueChange).
vi.mock("@/components/ui/select", () => ({
  Select: (p: any) => createElement("select", { "data-testid": "armario-colunas", value: p.value, disabled: p.disabled, onChange: (e: any) => p.onValueChange(e.target.value) }, p.children),
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: (p: any) => createElement("optgroup", null, p.children),
  SelectItem: (p: any) => createElement("option", { value: p.value }, p.children),
}));
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return { ...actual, DndContext: (p: any) => { dnd.onDragEnd = p.onDragEnd; return createElement(actual.DndContext, p); } };
});

const { ArmarioMontagem } = await import("@/components/armario/ArmarioMontagem");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { resolverDragEnd, inserirItem, removerItem, itensParaSalvar, chaveDoIdGrade, idItemGrade, GRADE_DROP_ID } = await import("@/lib/armario/montagem");
const { chaveVariante } = await import("@/lib/armario/variante-chave");

let root: Root | null = null;
let host: HTMLElement | null = null;
async function montar(onVoltar = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root!.render(createElement(QueryClientProvider, { client: qc }, createElement(ArmarioMontagem, { armarioId: "a1", onVoltar }))); });
  await tick(15);
  return onVoltar;
}
const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const botoes = () => Array.from(document.querySelectorAll("button"));
const botao = (txt: string) => botoes().find((b) => b.textContent?.trim().includes(txt)) as HTMLButtonElement | undefined;
const clicar = async (b: Element | null | undefined) => {
  if (!b) throw new Error("elemento não encontrado");
  await act(async () => { (b as HTMLElement).click(); });
  await tick(5);
};
const cards = () => Array.from(document.querySelectorAll('[data-testid="grade-card"]')) as HTMLElement[];
const ordemChaves = () => cards().map((c) => c.getAttribute("data-chave"));
const indices = () => cards().map((c) => c.querySelector('[data-testid="grade-indice"]')?.textContent);
const soltar = async (ev: any) => { await act(async () => { dnd.onDragEnd!(ev); }); await tick(5); };

// 3 itens salvos: 2 do interno (vt1 azul+apelido, vt2 verde) + 1 com cor que sumiu do cadastro (vt3).
const MODELO = (nome: string, ref: string) => ({ nome, ref, ref_auto: null, fotos_modelo: [], desenho_tecnico_url: null, croqui_url: null });
const ITENS = [
  { modelo_id: "m1", origem: "interno", variante_tecido_id: "vt1", produto_variante_id: null, cor_id: "azul", cor_apelido_id: "mar", ordem: 1, modelos: MODELO("Vestido Lis", "VES-1") },
  { modelo_id: "m1", origem: "interno", variante_tecido_id: "vt2", produto_variante_id: null, cor_id: "verde", cor_apelido_id: null, ordem: 2, modelos: MODELO("Vestido Lis", "VES-1") },
  { modelo_id: "m2", origem: "interno", variante_tecido_id: "vt3", produto_variante_id: null, cor_id: "cor-apagada", cor_apelido_id: null, ordem: 3, modelos: MODELO("Saia Nova", "SAI-2") },
];
const K1 = chaveVariante({ modelo_id: "m1", variante_tecido_id: "vt1", cor_id: "azul", cor_apelido_id: "mar" });
const K2 = chaveVariante({ modelo_id: "m1", variante_tecido_id: "vt2", cor_id: "verde" });
const K3 = chaveVariante({ modelo_id: "m2", variante_tecido_id: "vt3", cor_id: "cor-apagada" });

const DISPONIVEIS = [{
  modelo_id: "m9", nome: "Bolsa Palha", ref: "BOL-9", foto_path: null, origem: "revenda", em_desenvolvimento: false,
  variantes: [{ variante_tecido_id: null, produto_variante_id: "pv1", cor_id: "bege", cor_apelido_id: null, cor_nome: "Bege", cor_apelido_nome: null, ordem: 1, ja_em_outro: false, armarios_com: [] }],
}];
const ITEM_DIALOG = {
  chave: chaveVariante({ modelo_id: "m9", produto_variante_id: "pv1", cor_id: "bege" }), modelo_id: "m9", nome: "Bolsa Palha", ref: "BOL-9", foto_path: null,
  origem: "revenda", variante_tecido_id: null, produto_variante_id: "pv1", cor_id: "bege", cor_apelido_id: null, cor_nome: "Bege", cor_apelido_nome: null,
  ja_em_outro: false, armarios_com: [],
};

const armarioRow = (o: Record<string, unknown> = {}) => ({
  id: "a1", nome: "Vitrine Verão", status: "rascunho", colunas: 5, ano_id: "an1", mes_id: "me1", ...o,
});

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockImplementation(async (nome: string) => (nome === "armario_variantes_disponiveis" ? { data: DISPONIVEIS, error: null } : { data: "a1", error: null }));
  Object.values(toastMock).forEach((f) => f.mockReset());
  dados.tabelas = {
    armarios: armarioRow(),
    armario_itens: ITENS,
    cores: [{ id: "azul", nome: "Azul" }, { id: "verde", nome: "Verde" }, { id: "bege", nome: "Bege" }],
    cores_apelido: [{ id: "mar", nome: "Mar" }],
  };
  dnd.onDragEnd = null;
  permissao.readOnly = false;
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = null; host?.remove(); host = null;
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
});

describe("regras puras da montagem (lib/armario/montagem)", () => {
  const L = (...ks: string[]) => ks.map((chave) => ({ chave }));
  const ord = (l: readonly { chave: string }[]) => l.map((x) => x.chave);

  it("grade→grade move para a posição do alvo; mesma posição = sem mudança", () => {
    const r = resolverDragEnd({ lista: L("a", "b", "c"), origem: { tipo: "grade", chave: "a" }, overId: idItemGrade("c"), travado: false });
    expect(r.mudou).toBe(true);
    expect(ord(r.lista)).toEqual(["b", "c", "a"]);
    const igual = resolverDragEnd({ lista: L("a", "b"), origem: { tipo: "grade", chave: "a" }, overId: idItemGrade("a"), travado: false });
    expect(igual).toMatchObject({ mudou: false, motivo: "mesma-posicao" });
  });

  it("dialog→grade insere NA posição do alvo; no container vai pro fim; duplicado não entra", () => {
    const novo = { chave: "x" };
    expect(ord(resolverDragEnd({ lista: L("a", "b"), origem: { tipo: "variante", item: novo }, overId: idItemGrade("b"), travado: false }).lista)).toEqual(["a", "x", "b"]);
    expect(ord(resolverDragEnd({ lista: L("a", "b"), origem: { tipo: "variante", item: novo }, overId: GRADE_DROP_ID, travado: false }).lista)).toEqual(["a", "b", "x"]);
    const dup = resolverDragEnd({ lista: L("a", "x"), origem: { tipo: "variante", item: novo }, overId: GRADE_DROP_ID, travado: false });
    expect(dup).toMatchObject({ mudou: false, motivo: "duplicado" });
    expect(ord(dup.lista)).toEqual(["a", "x"]);
  });

  it("travado e soltar fora (over null) não mudam nada", () => {
    expect(resolverDragEnd({ lista: L("a", "b"), origem: { tipo: "grade", chave: "a" }, overId: idItemGrade("b"), travado: true })).toMatchObject({ mudou: false, motivo: "travado" });
    expect(resolverDragEnd({ lista: L("a", "b"), origem: { tipo: "grade", chave: "a" }, overId: null, travado: false })).toMatchObject({ mudou: false, motivo: "sem-destino" });
  });

  it("inserirItem/removerItem não duplicam nem mutam; chaveDoIdGrade lê o prefixo", () => {
    const base = L("a");
    expect(inserirItem(base, { chave: "a" })).toBe(base);
    expect(base).toHaveLength(1);
    expect(removerItem(L("a", "b"), "a").map((x) => x.chave)).toEqual(["b"]);
    expect(chaveDoIdGrade("grade:abc")).toBe("abc");
    expect(chaveDoIdGrade("variante:abc")).toBeNull();
  });

  it("itensParaSalvar manda só os 3 ponteiros, na ordem do array", () => {
    const out = itensParaSalvar([
      { modelo_id: "m1", variante_tecido_id: "vt1", produto_variante_id: null, cor_id: "x" } as any,
      { modelo_id: "m2", variante_tecido_id: null, produto_variante_id: "pv" } as any,
    ]);
    expect(out).toEqual([
      { modelo_id: "m1", variante_tecido_id: "vt1", produto_variante_id: null },
      { modelo_id: "m2", variante_tecido_id: null, produto_variante_id: "pv" },
    ]);
  });
});

describe("ArmarioMontagem — grade", () => {
  it("mostra os itens salvos na ordem, com índice 1..N, nome/REF/cor e cabeçalho (nome, status, colunas)", async () => {
    await montar();
    expect(ordemChaves()).toEqual([K1, K2, K3]);
    expect(indices()).toEqual(["1", "2", "3"]);
    expect(cards()[0].textContent).toContain("Vestido Lis");
    expect(cards()[0].textContent).toContain("REF VES-1");
    expect(cards()[0].textContent).toContain("Azul - Mar");
    expect(document.querySelector('[data-testid="armario-nome"]')?.textContent).toBe("Vitrine Verão");
    expect(document.body.textContent).toContain("Rascunho");
    expect((document.querySelector('[data-testid="armario-colunas"]') as HTMLSelectElement).value).toBe("5");
    const grade = document.querySelector('[data-testid="armario-grade"]') as HTMLElement;
    expect(grade.style.gridTemplateColumns).toBe("repeat(5, minmax(0, 1fr))");
  });

  it("item com cor sumida do cadastro aparece como 'cor removida' (não quebra)", async () => {
    await montar();
    expect(cards()[2].textContent).toContain("cor removida");
    expect(cards()[2].textContent).toContain("Saia Nova");
  });

  it("reordenar na grade (onDragEnd) muda a sequência e os índices; sujo até salvar", async () => {
    await montar();
    expect(botao("Salvar")?.disabled).toBe(true); // nada mudou
    await soltar({ active: { id: idItemGrade(K1), data: { current: { tipo: "grade" } } }, over: { id: idItemGrade(K3) } });
    expect(ordemChaves()).toEqual([K2, K3, K1]);
    expect(indices()).toEqual(["1", "2", "3"]);
    expect(document.body.textContent).toContain("alterações não salvas");
    expect(botao("Salvar")?.disabled).toBe(false);
  });

  it("soltar vindo do dialog insere na posição do alvo e a variante vira 'Na grade' no dialog", async () => {
    await montar();
    await clicar(botao("Adicionar variantes"));
    expect(document.querySelectorAll('[data-testid="variante-card"]').length).toBe(1);
    await soltar({ active: { id: `variante:${ITEM_DIALOG.chave}`, data: { current: { tipo: "variante", item: ITEM_DIALOG } } }, over: { id: idItemGrade(K2) } });
    expect(ordemChaves()).toEqual([K1, ITEM_DIALOG.chave, K2, K3]);
    expect(indices()).toEqual(["1", "2", "3", "4"]);
    expect(document.querySelector('[data-testid="variante-card"]')?.getAttribute("data-na-grade")).toBe("true");
  });

  it("variante já na grade não duplica (arrastada do dialog ou via +)", async () => {
    await montar();
    const item = { ...ITEM_DIALOG, chave: K2, modelo_id: "m1", variante_tecido_id: "vt2" };
    await soltar({ active: { id: `variante:${K2}`, data: { current: { tipo: "variante", item } } }, over: { id: GRADE_DROP_ID } });
    expect(ordemChaves()).toEqual([K1, K2, K3]);
    expect(toastMock.info).toHaveBeenCalledWith("Essa variante já está na grade.");
  });

  it("o + do dialog (mobile/sem drag) adiciona no fim; remover tira o card e reindexa", async () => {
    await montar();
    await clicar(botao("Adicionar variantes"));
    await clicar(document.querySelector('button[aria-label^="Adicionar Bolsa Palha"]'));
    expect(ordemChaves()).toEqual([K1, K2, K3, ITEM_DIALOG.chave]);
    await clicar(document.querySelector(`[data-chave="${K1}"] button[aria-label^="Remover"]`));
    expect(ordemChaves()).toEqual([K2, K3, ITEM_DIALOG.chave]);
    expect(indices()).toEqual(["1", "2", "3"]);
  });

  it("mudar o nº de COLUNAS reflui o grid mas NÃO muda a ordem 1..N", async () => {
    await montar();
    const antes = ordemChaves();
    const sel = document.querySelector('[data-testid="armario-colunas"]') as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, "8");
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await tick(5);
    const grade = document.querySelector('[data-testid="armario-grade"]') as HTMLElement;
    expect(grade.style.gridTemplateColumns).toBe("repeat(8, minmax(0, 1fr))");
    expect(ordemChaves()).toEqual(antes);
    expect(indices()).toEqual(["1", "2", "3"]);
    expect(document.body.textContent).toContain("alterações não salvas"); // colunas mudou = sujo
  });
});

describe("ArmarioMontagem — salvar", () => {
  it("Salvar manda a lista na ordem atual + colunas + status ATUAL e limpa o 'sujo'", async () => {
    dados.tabelas.armarios = armarioRow({ status: "pronto", colunas: 6 });
    await montar();
    await soltar({ active: { id: idItemGrade(K3), data: { current: { tipo: "grade" } } }, over: { id: idItemGrade(K1) } });
    await clicar(botao("Salvar"));
    const chamada = rpcMock.mock.calls.find((c) => c[0] === "armario_salvar");
    expect(chamada).toBeTruthy();
    expect(chamada![1]).toMatchObject({ _id: "a1", _ano_id: "an1", _mes_id: "me1", _nome: "Vitrine Verão", _colunas: 6, _status: "pronto" });
    expect(chamada![1]._itens).toEqual([
      { modelo_id: "m2", variante_tecido_id: "vt3", produto_variante_id: null },
      { modelo_id: "m1", variante_tecido_id: "vt1", produto_variante_id: null },
      { modelo_id: "m1", variante_tecido_id: "vt2", produto_variante_id: null },
    ]);
    expect(toastMock.success).toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("alterações não salvas");
    expect(botao("Salvar")?.disabled).toBe(true);
  });

  it("erro do servidor é traduzido (P0001) e o estado continua sujo", async () => {
    await montar();
    rpcMock.mockImplementation(async () => ({ data: null, error: { message: "armario_publicado_travado: x" } }));
    await soltar({ active: { id: idItemGrade(K1), data: { current: { tipo: "grade" } } }, over: { id: idItemGrade(K2) } });
    await clicar(botao("Salvar"));
    expect(toastMock.error).toHaveBeenCalledWith(expect.stringContaining("somente leitura"));
    expect(document.body.textContent).toContain("alterações não salvas");
  });

  it("Voltar à lista chama onVoltar", async () => {
    const onVoltar = await montar();
    await clicar(botao("Voltar à lista"));
    expect(onVoltar).toHaveBeenCalled();
  });
});

describe("ArmarioMontagem — publicado (somente leitura)", () => {
  beforeEach(() => { dados.tabelas.armarios = armarioRow({ status: "publicado" }); });

  it("trava Adicionar/Remover/Colunas/Salvar e mostra o aviso 'despublique antes'", async () => {
    await montar();
    expect(botao("Adicionar variantes")?.disabled).toBe(true);
    expect(botao("Salvar")?.disabled).toBe(true);
    expect((document.querySelector('[data-testid="armario-colunas"]') as HTMLSelectElement).disabled).toBe(true);
    expect((document.querySelector('button[aria-label^="Remover"]') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[data-testid="armario-travado"]')?.textContent).toContain("despublique antes");
    expect(document.body.textContent).toContain("Publicado");
  });

  it("barra o drop: onDragEnd (reordenar ou inserir) não altera a grade", async () => {
    await montar();
    await soltar({ active: { id: idItemGrade(K1), data: { current: { tipo: "grade" } } }, over: { id: idItemGrade(K3) } });
    await soltar({ active: { id: `variante:${ITEM_DIALOG.chave}`, data: { current: { tipo: "variante", item: ITEM_DIALOG } } }, over: { id: GRADE_DROP_ID } });
    expect(ordemChaves()).toEqual([K1, K2, K3]);
    expect(toastMock.warning).toHaveBeenCalled();
    expect(rpcMock.mock.calls.some((c) => c[0] === "armario_salvar")).toBe(false);
  });
});

describe("ArmarioMontagem — vazio / inexistente", () => {
  it("armário vazio mostra a grade vazia como alvo de drop", async () => {
    dados.tabelas.armario_itens = [];
    await montar();
    expect(cards().length).toBe(0);
    expect(document.body.textContent).toContain("Grade vazia");
    expect(document.querySelector('[data-testid="armario-grade-zona"]')).toBeTruthy();
  });

  it("armário inexistente mostra aviso e Voltar", async () => {
    dados.tabelas.armarios = null;
    await montar();
    expect(document.querySelector('[data-testid="armario-inexistente"]')).toBeTruthy();
  });
});
