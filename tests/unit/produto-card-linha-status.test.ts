// @vitest-environment happy-dom
// Paridade PA/PI (nov/2026, Task 6): seletores do card — Linha SÓ com card; Pendente/Reprovado SÓ sem card; o selo do kanban
// (F4a, com card) e o Select de status (sem card) são EXCLUSIVOS. A regra mora no bloco compartilhado `ProdutoLinhaStatusBloco`
// (usado pelo ProdutoCard e pelo ProdutoImportadoCard) — render de verdade + asserções de fonte dos 2 cards.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const LINHAS = [{ id: "l1", nome: "Casual" }, { id: "l2", nome: "Festa" }];

async function montar(props: Record<string, unknown>) {
  vi.resetModules();
  const { createElement } = await import("react");
  const { act } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { ProdutoLinhaStatusBloco } = await import("@/components/shared/ProdutoLinhaStatusBloco");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onLinha = vi.fn();
  const onStatus = vi.fn();
  await act(async () => {
    root.render(createElement(ProdutoLinhaStatusBloco as any, {
      linhasOpts: LINHAS, linhaId: null, statusProduto: null, onLinha, onStatus,
      selo: createElement("div", { "data-testid": "selo-kanban" }, "selo"), ...props,
    }));
  });
  return { container, onLinha, onStatus, desmontar: () => { act(() => root.unmount()); container.remove(); } };
}

const temLinha = (c: HTMLElement) => !!c.querySelector('[data-testid="produto-linha-select"]');
const temStatus = (c: HTMLElement) => !!c.querySelector('[data-testid="produto-status-select"]');
const temSelo = (c: HTMLElement) => !!c.querySelector('[data-testid="selo-kanban"]');

describe("ProdutoLinhaStatusBloco", () => {
  it("COM card: seletor de Linha + selo do kanban; SEM Select Pendente/Reprovado", async () => {
    const m = await montar({ temCard: true });
    expect(temLinha(m.container)).toBe(true);
    expect(temSelo(m.container)).toBe(true);
    expect(temStatus(m.container)).toBe(false);
    m.desmontar();
  });

  it("COM card e SEM kanban (selo ausente): Linha aparece e AINDA não há Select de status", async () => {
    const m = await montar({ temCard: true, selo: null });
    expect(temLinha(m.container)).toBe(true);
    expect(temStatus(m.container)).toBe(false);
    expect(temSelo(m.container)).toBe(false);
    m.desmontar();
  });

  it("SEM card: Select Pendente/Reprovado; SEM seletor de Linha e SEM selo do kanban (mesmo que o selo venha)", async () => {
    const m = await montar({ temCard: false });
    expect(temStatus(m.container)).toBe(true);
    expect(temLinha(m.container)).toBe(false);
    expect(temSelo(m.container)).toBe(false);
    m.desmontar();
  });

  it("exclusividade: em nenhuma combinação o selo e o Select de status aparecem juntos", async () => {
    for (const temCard of [true, false]) {
      for (const selo of [undefined, null]) {
        const m = await montar(selo === null ? { temCard, selo: null } : { temCard });
        expect(temSelo(m.container) && temStatus(m.container)).toBe(false);
        m.desmontar();
      }
    }
  });

  it("sem card, o valor exibido do status é o do produto (reprovado) e o padrão é pendente", async () => {
    const a = await montar({ temCard: false, statusProduto: "reprovado" });
    expect(a.container.querySelector('[data-testid="produto-status-select"]')?.textContent).toContain("Reprovado");
    a.desmontar();
    const b = await montar({ temCard: false, statusProduto: null });
    expect(b.container.querySelector('[data-testid="produto-status-select"]')?.textContent).toContain("Pendente");
    b.desmontar();
  });
});

describe("os 2 cards usam o bloco compartilhado (e só ele decide Linha/status/selo)", () => {
  const ler = (p: string) => readFileSync(resolve(__dirname, "../../", p), "utf8");
  const pa = ler("src/components/produto-acabado/ProdutoCard.tsx");
  const pi = ler("src/components/produto-importado/ProdutoImportadoCard.tsx");

  it("ProdutoCard (PA) liga Linha/status ao draft e passa o selo do kanban como `selo`", () => {
    expect(pa).toContain("<ProdutoLinhaStatusBloco");
    expect(pa).toMatch(/temCard=\{!!produto\.modelo_id\}/);
    expect(pa).toMatch(/linhaId: v \}\)/);
    expect(pa).toMatch(/statusProduto: v \}\)/);
    // o selo NÃO é mais renderizado fora do bloco (senão voltaria a coexistir com o Select)
    expect(pa).not.toMatch(/\{kanban && produto\.modelo_id && \(\s*<div[^>]*>\s*<MoverEtapaMenu/);
  });

  it("ProdutoImportadoCard (PI) idem", () => {
    expect(pi).toContain("<ProdutoLinhaStatusBloco");
    expect(pi).toMatch(/temCard=\{!!draft\.modelo_id\}/);
    expect(pi).toMatch(/onChange\(\{ linhaId: v \}\)/);
    expect(pi).toMatch(/onChange\(\{ statusProduto: v \}\)/);
    expect(pi).not.toMatch(/\{kanban && draft\.modelo_id && \(\s*<div[^>]*>\s*<MoverEtapaMenu/);
  });

  it("comentários desatualizados da Task 5 corrigidos nos 2 Sheets", () => {
    for (const f of ["src/components/produto-acabado/ProdutoAcabadoSheet.tsx", "src/components/produto-importado/ProdutoImportadoSheet.tsx"]) {
      expect(ler(f)).not.toMatch(/nunca [ée] reprovado/i);
    }
  });
});
