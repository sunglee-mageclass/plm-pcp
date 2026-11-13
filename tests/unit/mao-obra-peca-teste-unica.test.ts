// @vitest-environment happy-dom
// Freio de UI (nov/2026): o tipo de serviço que EXIGE peça teste só entra 1x por produto no editor de M.O. (2 linhas = 2 trilhas
// "Tentativa 1"). Os tipos normais seguem repetindo (multi-instância de set/2026). SÓ tela — sem trava no banco.
// Select/Dialog do Radix só montam o conteúdo aberto; aqui viram <select>/inline para dirigir o fluxo de verdade.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
const toastInfo = vi.fn();
vi.mock("sonner", () => ({ toast: { info: (...a: unknown[]) => toastInfo(...a), error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) =>
    h("select", { "data-testid": "sel", value, onChange: (e: any) => onValueChange(e.target.value) }, h("option", { value: "" }, "—"), children),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => h("optgroup", null, children),
  SelectItem: ({ value, children }: any) => h("option", { value }, children),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? h("div", null, children) : null),
  DialogContent: ({ children }: any) => h("div", null, children),
  DialogHeader: ({ children }: any) => h("div", null, children),
  DialogTitle: ({ children }: any) => h("h2", null, children),
}));

import { MaoObraEditor } from "@/components/planejamento/MaoObraEditor";
import { MaoObraCardMini } from "@/components/planejamento/MaoObraCardMini";
import { categoriasParaAdicionar, servicoPecaTesteJaNoProduto } from "@/lib/mao-obra";

const ROOT = process.cwd() + "/";
const src = (rel: string) => readFileSync(ROOT + rel, "utf8");

const CATS = [
  { id: "pl", nome: "Peça piloto", ativo: true, valor_padrao: 5, exige_peca_teste: true },
  { id: "corte", nome: "Corte", ativo: true, valor_padrao: null, exige_peca_teste: false },
  { id: "bord", nome: "Bordado", ativo: true, valor_padrao: null }, // sem a chave = não exige
  { id: "pl2", nome: "Outro de teste", ativo: true, valor_padrao: null, exige_peca_teste: true },
  { id: "velho", nome: "Inativo", ativo: false, valor_padrao: null, exige_peca_teste: false },
];
const L = (cat: string, id?: string) => ({ id, categoria_terceirizado_id: cat, valor: 10, aprovado: null as boolean | null });

describe("helper puro: categoriasParaAdicionar / servicoPecaTesteJaNoProduto", () => {
  it("tipo que exige peça teste e já está no produto some; tipos normais já usados continuam (multi-instância)", () => {
    const ids = categoriasParaAdicionar(CATS, [L("pl", "a"), L("corte", "b")]).map((c) => c.id);
    expect(ids).not.toContain("pl");
    expect(ids).toContain("corte");
    expect(ids).toContain("bord");
    expect(ids).toContain("pl2"); // outro tipo de peça teste, ainda não usado
    expect(ids).not.toContain("velho"); // inativo continua fora
  });
  it("produto sem linhas oferece todos os ativos, inclusive os de peça teste", () => {
    expect(categoriasParaAdicionar(CATS, []).map((c) => c.id)).toEqual(["pl", "corte", "bord", "pl2"]);
  });
  it("linha removida do rascunho libera o tipo de volta", () => {
    expect(categoriasParaAdicionar(CATS, [L("pl", "a")]).map((c) => c.id)).not.toContain("pl");
    expect(categoriasParaAdicionar(CATS, []).map((c) => c.id)).toContain("pl");
  });
  it("servicoPecaTesteJaNoProduto: só true p/ exige + presente; legado (null) e normais não travam", () => {
    expect(servicoPecaTesteJaNoProduto(CATS, [L("pl")], "pl")).toBe(true);
    expect(servicoPecaTesteJaNoProduto(CATS, [L("corte"), L("corte")], "corte")).toBe(false);
    expect(servicoPecaTesteJaNoProduto(CATS, [{ categoria_terceirizado_id: null, aprovado: null }], "pl")).toBe(false);
    expect(servicoPecaTesteJaNoProduto(CATS, [L("pl")], "inexistente")).toBe(false);
  });
});

function montar(C: any, props: any) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (p: any) => act(() => { root.render(h(C, p)); });
  render(props);
  return { container, render, unmount: () => { act(() => root.unmount()); container.remove(); } };
}
const opcoes = (c: HTMLElement) => [...c.querySelectorAll("select option")].map((o) => (o as HTMLOptionElement).value).filter(Boolean);
const escolher = (c: HTMLElement, v: string) => act(() => {
  const sel = c.querySelector("select") as HTMLSelectElement;
  // React rastreia o value: usar o setter nativo para o onChange disparar
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(sel, v);
  sel.dispatchEvent(new Event("change", { bubbles: true }));
});
const clicarBtn = (c: HTMLElement, texto: string) => act(() => {
  const b = [...c.querySelectorAll("button")].find((x) => x.textContent?.trim() === texto) as HTMLButtonElement;
  b.click();
});

const base = (linhas: any[]) => ({
  linhas, categorias: CATS, podeVerCustos: true, podeAprovar: true, podeEditarValor: true,
  onChangeLinhas: vi.fn(), onAprovar: () => {}, onReprovar: () => {},
  linhasPersistidas: new Set(linhas.map((l) => l.id).filter(Boolean)), linhasBase: linhas,
});

beforeEach(() => { toastInfo.mockClear(); document.body.innerHTML = ""; });

describe("MaoObraEditor (Sheet do Planejamento)", () => {
  it("produto com 1 linha de peça teste: o dropdown NÃO oferece o tipo de novo; oferece Corte mesmo já usado", () => {
    const m = montar(MaoObraEditor, base([L("pl", "a"), L("corte", "b")]));
    const o = opcoes(m.container);
    expect(o).not.toContain("pl");
    expect(o).toContain("corte");
    expect(o).toContain("bord");
    m.unmount();
  });

  it("tipo normal repete: adiciona uma 2ª linha de Corte", () => {
    const p = base([L("corte", "b")]);
    const m = montar(MaoObraEditor, p);
    escolher(m.container, "corte");
    clicarBtn(m.container, "Adicionar");
    expect(p.onChangeLinhas).toHaveBeenCalledTimes(1);
    const novas = p.onChangeLinhas.mock.calls[0][0];
    expect(novas.filter((l: any) => l.categoria_terceirizado_id === "corte")).toHaveLength(2);
    m.unmount();
  });

  it("peça teste ainda não usada pode entrar (1ª vez)", () => {
    const p = base([]);
    const m = montar(MaoObraEditor, p);
    escolher(m.container, "pl");
    clicarBtn(m.container, "Adicionar");
    expect(p.onChangeLinhas.mock.calls[0][0]).toHaveLength(1);
    m.unmount();
  });

  it("guarda defensiva: escolha velha de peça teste que ENTROU no produto depois não duplica (no-op + aviso)", () => {
    const p = base([]);
    const m = montar(MaoObraEditor, p);
    escolher(m.container, "pl");                       // escolhe com o produto ainda sem PL
    // PL aparece no produto (merge/realtime) com a escolha ainda no estado
    const p2 = base([L("pl", "a")]);
    m.render(p2);
    clicarBtn(m.container, "Adicionar");
    expect(p2.onChangeLinhas).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith("Este serviço de peça teste já está no produto");
    m.unmount();
  });
});

describe("MaoObraCardMini (cards Produto Acabado / Importado)", () => {
  const abrir = (m: ReturnType<typeof montar>) => act(() => { (m.container.querySelector('button[aria-label="Adicionar serviço"]') as HTMLButtonElement).click(); });

  it("produto com 1 linha de peça teste: o diálogo NÃO oferece o tipo de novo; oferece Corte mesmo já usado", () => {
    const m = montar(MaoObraCardMini, base([L("pl", "a"), L("corte", "b")]));
    abrir(m);
    const o = opcoes(m.container);
    expect(o).not.toContain("pl");
    expect(o).toContain("corte");
    m.unmount();
  });

  it("tipo normal repete: adiciona uma 2ª linha de Corte", () => {
    const p = base([L("corte", "b")]);
    const m = montar(MaoObraCardMini, p);
    abrir(m);
    escolher(m.container, "corte");
    clicarBtn(m.container, "Adicionar");
    const novas = p.onChangeLinhas.mock.calls[0][0];
    expect(novas.filter((l: any) => l.categoria_terceirizado_id === "corte")).toHaveLength(2);
    m.unmount();
  });

  it("guarda defensiva: confirmarAdd não duplica peça teste já presente (no-op + aviso)", () => {
    const m = montar(MaoObraCardMini, base([]));
    abrir(m);
    escolher(m.container, "pl");
    const p2 = base([L("pl", "a")]);
    m.render(p2);
    clicarBtn(m.container, "Adicionar");
    expect(p2.onChangeLinhas).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledWith("Este serviço de peça teste já está no produto");
    m.unmount();
  });
});

describe("anti-drift: o campo chega às opções", () => {
  it("as 3 queries de categorias de serviço selecionam exige_peca_teste", () => {
    for (const f of ["src/hooks/useMaoObraModelo.ts", "src/components/planejamento/PlanejamentoDetail.tsx", "src/components/desenvolvimento/ModeloDetailPanel.tsx"]) {
      const t = src(f);
      const i = t.indexOf("categorias_terceirizado");
      expect(t.slice(i, i + 200), f).toContain("exige_peca_teste");
    }
  });
  it("os 2 editores usam o helper nas opções e na guarda", () => {
    for (const f of ["MaoObraEditor", "MaoObraCardMini"]) {
      const t = src(`src/components/planejamento/${f}.tsx`);
      expect(t, f).toContain("categoriasParaAdicionar(categorias, linhas)");
      expect(t, f).toContain("servicoPecaTesteJaNoProduto(categorias, linhas, addSel)");
    }
  });
});
