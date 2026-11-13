// @vitest-environment happy-dom
// Reforma da Peça Teste por TIPO (nov/2026): o "freio de tela" do editor de M.O. (tipo que exige peça teste só 1x por produto) SAIU — a trilha de
// peça teste é por TIPO, então 2 linhas do mesmo tipo = 1 trilha (sem "Tentativa 1" duas vezes). Os dois editores oferecem todos os serviços ativos e
// deixam repetir qualquer um (multi-instância de set/2026). Select/Dialog do Radix só montam o conteúdo aberto; aqui viram <select>/inline.
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
import * as maoObra from "@/lib/mao-obra";

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
  it("produto com 1 linha de peça teste: o dropdown OFERECE o tipo de novo (e todos os ativos, inclusive os já usados); inativo continua fora", () => {
    const m = montar(MaoObraEditor, base([L("pl", "a"), L("corte", "b")]));
    const o = opcoes(m.container);
    expect(o).toEqual(expect.arrayContaining(["pl", "corte", "bord", "pl2"]));
    expect(o).not.toContain("velho");
    m.unmount();
  });

  it("tipo que exige peça teste REPETE: adiciona uma 2ª linha de PL, sem aviso", () => {
    const p = base([L("pl", "a")]);
    const m = montar(MaoObraEditor, p);
    escolher(m.container, "pl");
    clicarBtn(m.container, "Adicionar");
    expect(p.onChangeLinhas).toHaveBeenCalledTimes(1);
    const novas = p.onChangeLinhas.mock.calls[0][0];
    expect(novas.filter((l: any) => l.categoria_terceirizado_id === "pl")).toHaveLength(2);
    expect(toastInfo).not.toHaveBeenCalled();
    m.unmount();
  });

  it("tipo normal repete: adiciona uma 2ª linha de Corte", () => {
    const p = base([L("corte", "b")]);
    const m = montar(MaoObraEditor, p);
    escolher(m.container, "corte");
    clicarBtn(m.container, "Adicionar");
    const novas = p.onChangeLinhas.mock.calls[0][0];
    expect(novas.filter((l: any) => l.categoria_terceirizado_id === "corte")).toHaveLength(2);
    m.unmount();
  });
});

describe("MaoObraCardMini (cards Produto Acabado / Importado)", () => {
  const abrir = (m: ReturnType<typeof montar>) => act(() => { (m.container.querySelector('button[aria-label="Adicionar serviço"]') as HTMLButtonElement).click(); });

  it("o diálogo OFERECE o tipo de peça teste de novo e os já usados", () => {
    const m = montar(MaoObraCardMini, base([L("pl", "a"), L("corte", "b")]));
    abrir(m);
    expect(opcoes(m.container)).toEqual(expect.arrayContaining(["pl", "corte", "bord"]));
    m.unmount();
  });

  it("tipo que exige peça teste REPETE: adiciona uma 2ª linha de PL, sem aviso", () => {
    const p = base([L("pl", "a")]);
    const m = montar(MaoObraCardMini, p);
    abrir(m);
    escolher(m.container, "pl");
    clicarBtn(m.container, "Adicionar");
    const novas = p.onChangeLinhas.mock.calls[0][0];
    expect(novas.filter((l: any) => l.categoria_terceirizado_id === "pl")).toHaveLength(2);
    expect(toastInfo).not.toHaveBeenCalled();
    m.unmount();
  });
});

describe("anti-drift: o freio SAIU e o campo ainda chega às opções", () => {
  it("as 3 queries de categorias de serviço seguem selecionando exige_peca_teste (a seção Peça Teste do Sheet usa para 'Salve o card para lançar…')", () => {
    for (const f of ["src/hooks/useMaoObraModelo.ts", "src/components/planejamento/PlanejamentoDetail.tsx", "src/components/desenvolvimento/ModeloDetailPanel.tsx"]) {
      const t = src(f);
      const i = t.indexOf("categorias_terceirizado");
      expect(t.slice(i, i + 200), f).toContain("exige_peca_teste");
    }
  });
  it("mao-obra.ts não exporta mais o freio e os 2 editores não o referenciam", () => {
    expect("categoriasParaAdicionar" in maoObra).toBe(false);
    expect("servicoPecaTesteJaNoProduto" in maoObra).toBe(false);
    expect("TEXTO_MO_PECA_TESTE_JA_NO_PRODUTO" in maoObra).toBe(false);
    for (const f of ["MaoObraEditor", "MaoObraCardMini"]) {
      const t = src(`src/components/planejamento/${f}.tsx`);
      expect(t, f).not.toContain("categoriasParaAdicionar");
      expect(t, f).not.toContain("servicoPecaTesteJaNoProduto");
    }
  });
});
