// @vitest-environment happy-dom
// F7 Armário · D3 — dialog de variantes disponíveis: render real (react-dom + happy-dom) com a RPC mockada.
//   1 mini-card por variante (produto x cor) · em-desenvolvimento esmaecido, SEM alça de arraste e SEM "+" ·
//   card normal é arrastável (atributos do useDraggable) e clicável (onAdicionar) · aviso "já em outro armário" não bloqueia ·
//   chave de identidade = chaveVariante · busca por nome/REF · "Na grade" não arrasta.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rpcMock = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/components/RequirePermission", () => ({ useReadOnly: () => false }));
vi.mock("@/components/plan-tecido/ModeloThumb", () => ({ ModeloThumb: () => null })); // usa storage assinado

const { VariantesDialog, achatarVariantes, filtrarEntradas, VARIANTE_DRAG_PREFIXO } = await import("@/components/armario/VariantesDialog");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { DndContext } = await import("@dnd-kit/core");
const { chaveVariante } = await import("@/lib/armario/variante-chave");

const V = (o: Record<string, unknown>) => ({
  variante_tecido_id: null, produto_variante_id: null, cor_id: "c", cor_apelido_id: null,
  cor_nome: "Azul", cor_apelido_nome: null, ordem: 1, ja_em_outro: false, armarios_com: [], ...o,
});
const MODELOS = [
  {
    modelo_id: "m1", nome: "Vestido Lis", ref: "VES-001", foto_path: null, origem: "interno", em_desenvolvimento: false,
    variantes: [
      V({ variante_tecido_id: "vt1", cor_id: "azul", cor_nome: "Azul", cor_apelido_nome: "Mar" }),
      V({ variante_tecido_id: "vt2", cor_id: "verde", cor_nome: "Verde", ordem: 2, ja_em_outro: true, armarios_com: [{ id: "a9", nome: "Vitrine Outono" }] }),
    ],
  },
  { modelo_id: "m2", nome: "Saia Nova", ref: null, foto_path: null, origem: "interno", em_desenvolvimento: true, variantes: [] },
  {
    modelo_id: "m3", nome: "Bolsa Palha", ref: "BOL-7", foto_path: null, origem: "revenda", em_desenvolvimento: false,
    variantes: [V({ produto_variante_id: "pv1", cor_id: "bege", cor_nome: "Bege" })],
  },
];

let root: Root | null = null;
let host: HTMLElement | null = null;
async function montar(props: Record<string, unknown> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const el = createElement(DndContext, null,
    createElement(VariantesDialog, { colecaoId: "col1", colecao: "Coleção 2027", subcolecao: "Verão", armarioId: "arm1", onFechar: vi.fn(), ...props } as any));
  await act(async () => { root!.render(createElement(QueryClientProvider, { client: qc }, el)); });
  await tick(10);
}
const tick = async (ms = 0) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const cards = () => Array.from(document.querySelectorAll('[data-testid="variante-card"]'));
const cardEmDev = () => document.querySelector('[data-testid="variante-card-em-desenvolvimento"]') as HTMLElement | null;

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue({ data: MODELOS, error: null });
});
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = host = null;
  document.body.innerHTML = "";
});

describe("achatarVariantes (puro)", () => {
  it("produto com N cores vira N entradas; em desenvolvimento vira 1 entrada sem variantes", () => {
    const e = achatarVariantes(MODELOS as any);
    expect(e.map((x) => x.tipo)).toEqual(["variante", "variante", "em_desenvolvimento", "variante"]);
    const v = e[0] as any;
    expect(v.chave).toBe(chaveVariante({ modelo_id: "m1", variante_tecido_id: "vt1", cor_id: "azul", cor_apelido_id: null }));
    expect(e[3].chave).toBe(chaveVariante({ modelo_id: "m3", produto_variante_id: "pv1", cor_id: "bege", cor_apelido_id: null }));
  });
  it("filtra por nome/REF/cor sem acento nem caixa", () => {
    const e = achatarVariantes(MODELOS as any);
    expect(filtrarEntradas(e, "bol-7")).toHaveLength(1);
    expect(filtrarEntradas(e, "VESTIDO")).toHaveLength(2);
    expect(filtrarEntradas(e, "mar")).toHaveLength(1);
    expect(filtrarEntradas(e, "")).toHaveLength(4);
  });
});

describe("VariantesDialog", () => {
  it("chama a RPC com coleção/sub/armário e lista 1 card por variante + 1 em desenvolvimento", async () => {
    await montar();
    expect(rpcMock).toHaveBeenCalledWith("armario_variantes_disponiveis", { _colecao_id: "col1", _subcolecao: "Verão", _armario_id: "arm1" });
    expect(cards()).toHaveLength(3);
    expect(cardEmDev()).not.toBeNull();
    const t = document.body.textContent ?? "";
    expect(t).toContain("Vestido Lis");
    expect(t).toContain("REF VES-001");
    expect(t).toContain("Azul - Mar"); // cor base - apelido (corApelidoLabel)
  });

  it("em desenvolvimento: esmaecido, com badge, SEM alça de arraste e SEM botão de adicionar", async () => {
    const onAdicionar = vi.fn();
    await montar({ onAdicionar });
    const dev = cardEmDev()!;
    expect(dev.textContent).toContain("Saia Nova");
    expect(dev.textContent).toContain("Em desenvolvimento");
    expect(dev.className).toContain("opacity-50");
    expect(dev.className).toContain("cursor-not-allowed");
    expect(dev.querySelector('[aria-roledescription="draggable"]')).toBeNull();
    expect(dev.querySelector('[data-testid="variante-alca"]')).toBeNull();
    expect(dev.querySelector("button")).toBeNull();
    await act(async () => { dev.click(); });
    expect(onAdicionar).not.toHaveBeenCalled();
  });

  it("variante normal é arrastável (useDraggable) e clicável (onAdicionar com o item)", async () => {
    const onAdicionar = vi.fn();
    await montar({ onAdicionar });
    const card = cards()[0] as HTMLElement;
    const alca = card.querySelector('[data-testid="variante-alca"]') as HTMLElement;
    expect(alca.getAttribute("aria-roledescription")).toBe("draggable");
    expect(alca.getAttribute("role")).toBe("button");
    const btn = card.querySelector("button") as HTMLButtonElement;
    await act(async () => { btn.click(); });
    expect(onAdicionar).toHaveBeenCalledTimes(1);
    const item = onAdicionar.mock.calls[0][0];
    expect(item).toMatchObject({ modelo_id: "m1", variante_tecido_id: "vt1", cor_id: "azul", nome: "Vestido Lis" });
    expect(item.chave).toBe(card.getAttribute("data-chave"));
    expect(VARIANTE_DRAG_PREFIXO).toBe("variante:");
  });

  it("sem onAdicionar não há botão +; o arraste segue disponível", async () => {
    await montar();
    const card = cards()[0] as HTMLElement;
    expect(card.querySelector("button")).toBeNull();
    expect(card.querySelector('[aria-roledescription="draggable"]')).not.toBeNull();
  });

  it("já em outro armário: aviso aparece (com os nomes) mas o card continua arrastável/clicável", async () => {
    const onAdicionar = vi.fn();
    await montar({ onAdicionar });
    const avisos = Array.from(document.querySelectorAll('[data-testid="aviso-ja-em-outro"]'));
    expect(avisos).toHaveLength(1);
    expect(avisos[0].textContent).toBe("já em outro armário");
    expect(avisos[0].getAttribute("aria-label")).toContain("Vitrine Outono");
    const card = avisos[0].closest('[data-testid="variante-card"]') as HTMLElement;
    expect(card.querySelector('[aria-roledescription="draggable"]')).not.toBeNull();
    await act(async () => { (card.querySelector("button") as HTMLButtonElement).click(); });
    expect(onAdicionar).toHaveBeenCalledTimes(1);
    expect(onAdicionar.mock.calls[0][0].ja_em_outro).toBe(true);
  });

  it("chavesNaGrade: card vira 'Na grade', sem alça de arraste e sem +", async () => {
    const chave = chaveVariante({ modelo_id: "m3", produto_variante_id: "pv1", cor_id: "bege", cor_apelido_id: null });
    await montar({ onAdicionar: vi.fn(), chavesNaGrade: new Set([chave]) });
    const card = cards().find((c) => c.getAttribute("data-chave") === chave) as HTMLElement;
    expect(card.textContent).toContain("Na grade");
    expect(card.querySelector('[aria-roledescription="draggable"]')).toBeNull();
    expect(card.querySelector("button")).toBeNull();
  });

  it("busca filtra por nome/REF e mostra estado vazio da busca", async () => {
    await montar();
    const input = document.querySelector('input[aria-label="Buscar variantes"]') as HTMLInputElement;
    const digitar = async (v: string) => {
      await act(async () => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        set.call(input, v);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await digitar("bol-7");
    expect(cards()).toHaveLength(1);
    expect(cardEmDev()).toBeNull();
    await digitar("zzz");
    expect(document.body.textContent).toContain("Nada encontrado");
  });

  it("subcoleção sem produtos mostra estado vazio; erro da RPC mostra mensagem", async () => {
    rpcMock.mockResolvedValue({ data: [], error: null });
    await montar();
    expect(document.body.textContent).toContain("Nenhum produto nesta subcoleção");
    await act(async () => { root!.unmount(); }); host!.remove(); document.body.innerHTML = "";
    rpcMock.mockResolvedValue({ data: null, error: { message: "x" } });
    await montar();
    expect(document.body.textContent).toContain("Não foi possível carregar");
  });
});
