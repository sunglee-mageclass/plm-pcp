// @vitest-environment happy-dom
// "Regerar todos os SKUs da loja" - o card da Config da Loja (RENDER de verdade, supabase mockado): habilitacao do botao, previa em paginas (com recuo no
// timeout), Dialog de revisao com contadores, AlertDialog de confirmar e a gravacao em lotes. Review Focus 1 (timeout 8 s -> paginas, recuo) na tela.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RegerarSkusLojaCard } from "@/components/configuracoes/RegerarSkusLojaCard";
import { TEXTO_FALHA_TEMPO, TEXTO_FALHA_TEMPO_GRAVACAO } from "@/lib/regerar-skus-loja";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ASS = "d".repeat(32);
const cfgComFormato = { partes: ["ref", "cor_base", "tamanho"], separadores: {} };
const mock = vi.hoisted(() => ({ cfg: null as unknown, previa: (() => Promise.resolve({ data: null, error: null })) as (a: any) => Promise<{ data: unknown; error: unknown }>, aplicar: (() => Promise.resolve({ data: null, error: null })) as (a: any) => Promise<{ data: unknown; error: unknown }> }));
const rpcSpy = vi.hoisted(() => vi.fn((nome: string, args: any) =>
  nome === "regerar_skus_loja_previa" ? mock.previa(args) : nome === "regerar_skus_loja_aplicar" ? mock.aplicar(args) : Promise.resolve({ data: null, error: null })));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: rpcSpy, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { sku_config: mock.cfg }, error: null }) }) }) }) },
}));
vi.mock("@/hooks/useActiveTenantId", () => ({ useActiveTenantId: () => "t1" }));
vi.mock("@tanstack/react-router", () => ({ Link: (p: any) => createElement("a", { href: p.to }, p.children) }));
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const item = (id: string, p: Record<string, unknown> = {}) => ({
  modelo_id: id, nome: `Produto ${id}`, ref: `R${id}`, origem: "interno", tamanho_tipo: "numero", estado: "muda", assinatura: ASS, criados: 0, atualizados: 4, removidos: 0,
  manuais: 1, conflitos: 0,
  linhas: [{ variante_key: "k1", cor_nome: "Preto", apelido_nome: "Black", tamanho_key: "34|PPP", acao: "muda", sku_de: "OLD34", sku_para: "NEW34", mensagem: null }], ...p,
});

const limpezas: (() => void)[] = [];
afterEach(() => { for (const f of limpezas.splice(0)) { try { f(); } catch { /* ja desmontado */ } } });
function montar(p: { paginaSuja?: boolean; formatoSujo?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => { root.render(createElement(QueryClientProvider, { client: qc }, createElement(RegerarSkusLojaCard, { paginaSuja: p.paginaSuja ?? false, formatoSujo: p.formatoSujo ?? false }))); });
  limpezas.push(() => { act(() => { root.unmount(); }); container.remove(); });
  return container;
}
const espera = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });
const botao = (texto: string | RegExp) =>
  [...document.body.querySelectorAll("button")].find((b) => (typeof texto === "string" ? (b.textContent ?? "").trim() === texto : texto.test(b.textContent ?? ""))) as HTMLButtonElement | undefined;
const clicar = (b: HTMLButtonElement) => act(async () => { b.click(); await new Promise((r) => setTimeout(r, 30)); });
const testid = (id: string) => document.querySelector(`[data-testid="${id}"]`);

beforeEach(() => {
  rpcSpy.mockClear();
  Object.values(toastMock).forEach((f) => f.mockClear());
  mock.cfg = cfgComFormato;
  mock.previa = async () => ({ data: { formato_ok: true, total_modelos: 3, itens: [item("A"), item("B", { estado: "igual", atualizados: 0, linhas: [], assinatura: ASS }), item("C", { estado: "pulado", motivo: "integracao", assinatura: null })], proximo: null }, error: null });
  mock.aplicar = async (a) => ({ data: { gravados: a._itens.length, desatualizados: 0, pulados: 0, erros: 0, resultados: a._itens.map((i: any) => ({ modelo_id: i.modelo_id, nome: `Produto ${i.modelo_id}`, ref: `R${i.modelo_id}`, estado: "gravado", criados: 0, atualizados: 4, removidos: 0, conflitos: 0 })) }, error: null });
});

describe("RegerarSkusLojaCard - habilitacao do botao 'Gerar previa'", () => {
  it("com Formato gravado e nada sujo: habilitado", async () => {
    montar();
    await espera(50);
    expect(botao("Gerar prévia")!.disabled).toBe(false);
  });
  it.each([
    ["pagina com alteracao nao salva", { paginaSuja: true }, /Salve ou descarte as outras alterações da página antes/],
    ["Formato do SKU em rascunho (o lote le o GRAVADO)", { formatoSujo: true }, /Formato do SKU tem alterações não salvas/],
  ])("desabilitado com o motivo: %s", async (_n, props, texto) => {
    montar(props);
    await espera(50);
    expect(botao("Gerar prévia")!.disabled).toBe(true);
    expect(document.body.textContent).toMatch(texto);
  });
  it("loja SEM Formato do SKU (partes = []): desabilitado e avisa com o link para o card do Formato", async () => {
    mock.cfg = { partes: [], separadores: {} };
    montar();
    await espera(50);
    expect(botao("Gerar prévia")!.disabled).toBe(true);
    expect(document.body.textContent).toContain("A loja ainda não tem o Formato do SKU");
    expect(document.querySelector('a[href="/admin/configuracoes"]')).not.toBeNull();
  });
});

describe("RegerarSkusLojaCard - previa em paginas, revisao, confirmacao e gravacao em lotes", () => {
  it("gera a previa (limite 25), mostra os contadores, abre o AlertDialog 'Regerar N SKUs em M produtos?' e grava SO os produtos 'muda' com a assinatura da previa", async () => {
    montar();
    await espera(50);
    await clicar(botao("Gerar prévia")!);
    await espera(50);
    const chamadasPrevia = rpcSpy.mock.calls.filter(([n]) => n === "regerar_skus_loja_previa").map(([, a]) => a);
    expect(chamadasPrevia).toEqual([{ _tenant_id: "t1", _apos: null, _limite: 25 }]);
    const cont = testid("regerar-skus-contadores")!.textContent!;
    expect(cont).toContain("SKUs que mudam");
    expect(testid("regerar-skus-contadores")!.children[0].textContent).toContain("4"); // 4 SKUs mudam (A); B igual; C pulado
    expect(testid("regerar-skus-pulados")!.textContent).toContain("1 produto(s) mudam");
    expect(testid("regerar-skus-pulados")!.textContent).toContain("Integrável / Integrado 1");
    const regerar = botao(/Regerar 4 SKU\(s\) em 1 produto\(s\)/)!;
    expect(regerar.disabled).toBe(false);
    // o produto vem recolhido; abrir mostra variante/tamanho/antes/depois
    await clicar(botao(/Produto A/)!);
    expect(testid("regerar-skus-lista")!.textContent).toContain("Preto · Black · 34");
    expect(testid("regerar-skus-lista")!.textContent).toContain("OLD34");
    expect(testid("regerar-skus-lista")!.textContent).toContain("NEW34");
    await clicar(regerar);
    expect(document.body.textContent).toContain("Regerar 4 SKUs em 1 produto?");
    expect(document.body.textContent).toContain("não há desfazer em lote");
    expect(rpcSpy.mock.calls.some(([n]) => n === "regerar_skus_loja_aplicar")).toBe(false); // nada grava antes da confirmacao
    await clicar(botao("Regerar 4 SKUs")!);
    await espera(50);
    const aplicar = rpcSpy.mock.calls.filter(([n]) => n === "regerar_skus_loja_aplicar").map(([, a]) => a);
    expect(aplicar).toEqual([{ _tenant_id: "t1", _itens: [{ modelo_id: "A", assinatura: ASS }] }]);
    expect(testid("regerar-skus-resumo")!.textContent).toContain("1 produto(s) gravado(s) (4 SKU(s))");
  });

  it("TIMEOUT na pagina: a MESMA pagina volta com a metade (25 -> 12); a tela mostra o aviso de lotes menores e termina a previa", async () => {
    let n = 0;
    mock.previa = async (a) => {
      if (n++ === 0) return { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
      return { data: { formato_ok: true, total_modelos: 1, itens: [item("A")], proximo: null }, error: null };
    };
    montar();
    await espera(50);
    await clicar(botao("Gerar prévia")!);
    await espera(80);
    const limites = rpcSpy.mock.calls.filter(([x]) => x === "regerar_skus_loja_previa").map(([, a]) => a._limite);
    expect(limites).toEqual([25, 12]);
    expect(testid("regerar-skus-contadores")).not.toBeNull(); // chegou na revisao
  });

  it("falha que NAO e tempo (ex.: so admin): para com a mensagem PT e oferece 'Continuar de onde parou'; nada e gravado", async () => {
    mock.previa = async () => ({ data: null, error: { code: "42501", message: "sem_permissao_admin: so o administrador da loja regera os SKUs" } });
    montar();
    await espera(50);
    await clicar(botao("Gerar prévia")!);
    await espera(50);
    expect(document.body.textContent).toContain("Só o administrador da loja regera os SKUs da loja inteira.");
    expect(botao(/Continuar de onde parou/)).toBeTruthy();
    expect(rpcSpy.mock.calls.some(([x]) => x === "regerar_skus_loja_aplicar")).toBe(false);
  });

  it("previa FALHA: o dialogo FECHA pelo botao 'Voltar' (o X ficava morto na falha porque a fase seguia 'calculando'); a barra de progresso some", async () => {
    mock.previa = async () => ({ data: null, error: { code: "42501", message: "sem_permissao_admin: so o administrador da loja regera os SKUs" } });
    montar();
    await espera(50);
    await clicar(botao("Gerar prévia")!);
    await espera(50);
    const dialogo = document.querySelector('[data-testid="regerar-skus-dialogo"]');
    expect(dialogo).toBeTruthy(); // dialogo aberto, mostrando o erro
    // na falha a barra de progresso "Calculando… X de ?" nao deve aparecer (so o erro)
    expect(document.querySelector('[data-testid="regerar-skus-progresso"] [role="progressbar"]')).toBeNull();
    // o rodape mostra "Voltar" (nao "Cancelar") e fechar por ele some com o dialogo
    const voltar = botao(/Voltar/);
    expect(voltar).toBeTruthy();
    await clicar(voltar!);
    await espera(50);
    expect(document.querySelector('[data-testid="regerar-skus-dialogo"]')).toBeNull(); // fechou
  });

  it("previa sem nada a mudar: 'Nenhum SKU precisa mudar' e o botao de regerar fica desabilitado (0 SKUs)", async () => {
    mock.previa = async () => ({ data: { formato_ok: true, total_modelos: 1, itens: [item("B", { estado: "igual", atualizados: 0, linhas: [] })], proximo: null }, error: null });
    montar();
    await espera(50);
    await clicar(botao("Gerar prévia")!);
    await espera(50);
    expect(document.body.textContent).toContain("Nenhum SKU precisa mudar.");
    expect(botao(/Regerar 0 SKU\(s\)/)!.disabled).toBe(true);
  });

  it("produto 'desatualizado' no aplicar: aparece no resumo com 'Refazer a prévia' e os outros gravam", async () => {
    mock.previa = async () => ({ data: { formato_ok: true, total_modelos: 2, itens: [item("A"), item("B")], proximo: null }, error: null });
    mock.aplicar = async () => ({ data: { gravados: 1, desatualizados: 1, pulados: 0, erros: 0, resultados: [
      { modelo_id: "A", nome: "Produto A", ref: "RA", estado: "gravado", criados: 0, atualizados: 4, removidos: 0, conflitos: 0 },
      { modelo_id: "B", nome: "Produto B", ref: "RB", estado: "desatualizado" },
    ] }, error: null });
    montar();
    await espera(50);
    await clicar(botao("Gerar prévia")!);
    await espera(50);
    await clicar(botao(/Regerar 8 SKU\(s\) em 2 produto\(s\)/)!);
    await clicar(botao("Regerar 8 SKUs")!);
    await espera(50);
    const resumo = testid("regerar-skus-resumo")!.textContent!;
    expect(resumo).toContain("1 produto(s) gravado(s)");
    expect(resumo).toContain("1 desatualizado(s)");
    expect(resumo).toContain("Produto B");
    expect(botao("Refazer a prévia")).toBeTruthy();
  });
});

describe("RegerarSkusLojaCard - falhas e cancelamento (textos certos de prévia x gravação, 'continuar')", () => {
  it("TIMEOUT na GRAVAÇÃO até o mínimo: mostra o texto da GRAVAÇÃO (os já gravados ficam), nunca o da prévia ('nada foi gravado'); oferece 'Continuar gravando (N)'", async () => {
    mock.aplicar = async () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    montar();
    await espera(50);
    await clicar(botao("Gerar prévia")!);
    await espera(50);
    await clicar(botao(/Regerar 4 SKU\(s\) em 1 produto\(s\)/)!);
    await clicar(botao("Regerar 4 SKUs")!);
    await espera(80);
    const resumo = testid("regerar-skus-resumo")!.textContent!;
    expect(resumo).toContain(TEXTO_FALHA_TEMPO_GRAVACAO);
    expect(resumo).not.toContain(TEXTO_FALHA_TEMPO);
    expect(resumo).not.toContain("Nada foi gravado nesta fase");
    expect(botao(/Continuar gravando \(1\)/)).toBeTruthy();
  });

  it("Cancelar NO MEIO da gravação: o lote em curso termina, o que gravou FICA e restam os demais ('Cancelado.' + 'Continuar gravando (5)')", async () => {
    const todos = Array.from({ length: 30 }, (_, i) => item(`P${i}`));
    mock.previa = async (a) => a._apos === null
      ? { data: { formato_ok: true, total_modelos: 30, itens: todos.slice(0, 25), proximo: "c1" }, error: null }
      : { data: { formato_ok: true, total_modelos: 30, itens: todos.slice(25), proximo: null }, error: null };
    const base = mock.aplicar;
    let solta: () => void = () => {};
    mock.aplicar = async (a) => { await new Promise<void>((r) => { solta = r; }); return base(a); }; // o 1o lote fica "em voo" ate o teste clicar Cancelar
    montar();
    await espera(50);
    await clicar(botao("Gerar prévia")!);
    await espera(80);
    await clicar(botao(/Regerar 120 SKU\(s\) em 30 produto\(s\)/)!);
    await clicar(botao("Regerar 120 SKUs")!);
    await espera(30);
    const cancelar = [...document.querySelectorAll('[data-testid="regerar-skus-dialogo"] button')].find((x) => (x.textContent ?? "").trim() === "Cancelar") as HTMLButtonElement;
    expect(cancelar).toBeTruthy(); // gravando: o botao e "Cancelar"
    await clicar(cancelar);
    await act(async () => { solta(); await new Promise((r) => setTimeout(r, 50)); });
    const aplicar = rpcSpy.mock.calls.filter(([n]) => n === "regerar_skus_loja_aplicar").map(([, a]) => a);
    expect(aplicar).toHaveLength(1); // o 2o lote nao sai depois do cancelar
    expect(aplicar[0]._itens).toHaveLength(25);
    const resumo = testid("regerar-skus-resumo")!.textContent!;
    expect(resumo).toContain("25 produto(s) gravado(s)");
    expect(resumo).toContain("Cancelado.");
    expect(resumo).toContain("Faltam 5 produto(s)");
    expect(botao(/Continuar gravando \(5\)/)).toBeTruthy();
  });

  it("prévia que falha na 2ª página: 'Continuar de onde parou' retoma com o cursor certo (_apos) e termina sem refazer a 1ª página", async () => {
    let n = 0;
    mock.previa = async (a) => {
      n++;
      if (n === 1) return { data: { formato_ok: true, total_modelos: 2, itens: [item("A")], proximo: "cursor-A" }, error: null };
      if (n === 2) return { data: null, error: { code: "42501", message: "sem_permissao_admin: so o administrador da loja regera os SKUs" } };
      return { data: { formato_ok: true, total_modelos: 2, itens: [item("B")], proximo: null }, error: null };
    };
    montar();
    await espera(50);
    await clicar(botao("Gerar prévia")!);
    await espera(80);
    await clicar(botao(/Continuar de onde parou/)!);
    await espera(80);
    const apos = rpcSpy.mock.calls.filter(([x]) => x === "regerar_skus_loja_previa").map(([, a]) => a._apos);
    expect(apos).toEqual([null, "cursor-A", "cursor-A"]);
    expect(testid("regerar-skus-contadores")).not.toBeNull();
    expect(botao(/Regerar 8 SKU\(s\) em 2 produto\(s\)/)).toBeTruthy(); // A (da 1a pagina) + B (da retomada)
  });
});
