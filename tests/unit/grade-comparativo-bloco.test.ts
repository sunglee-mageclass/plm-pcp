// @vitest-environment happy-dom
// F5-2 Task 5 — bloco comparativo Programada | CAD | PCP | CQ: ordem das colunas = a do SERVIDOR (nunca Object.keys), faltante = "—",
// Programada editável manda o rev lido em `salvar_grade_programada`; sem permissão fica só leitura. Sem JSX (arquivo .ts).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.fn();
const perm = { edit: true };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "m1", rev: 7 }, error: null }) }) }) }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ canEdit: () => perm.edit }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GradeComparativoBloco } from "@/components/planejamento/planejamento-detail/ficha/GradeComparativoBloco";

// Tamanhos NUMÉRICOS em ordem do servidor ("2" antes de "10"): Object.keys reordenaria ("10" antes de "2").
const RESP = {
  variantes: [{ variante_numero: 1, variante_tecido_id: null, label: "Preto" }],
  tamanhos: ["36", "38", "40"],
  celulas: {
    "1|36": { programada: 5, cad: 5, pcp: { enviada: 5, cortada: 4, recebida: 3, defeito: 1 }, cq: { recebida: 3, defeito: 1, real: 2 } },
    "1|38": { programada: 6, cad: null, pcp: null, cq: null },
  },
};

async function montar(ordemEnviada = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // O bloco lê o rev do cache ["modelo", id] que o Sheet (onde ele vive) já populou — simula isso aqui
  // (o bloco NÃO faz query própria de modelos; usa enabled:false na mesma queryKey, sem select("*")).
  qc.setQueryData(["modelo", "m1"], { id: "m1", rev: 7 });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client: qc }, createElement(GradeComparativoBloco, { modeloId: "m1", ordemEnviada })));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, unmount: () => { act(() => root.unmount()); container.remove(); } };
}

beforeEach(() => {
  rpc.mockReset();
  perm.edit = true;
  rpc.mockImplementation(async (nome: string) => (nome === "grade_comparativo" ? { data: RESP, error: null } : { data: { modelo_id: "m1", rev: 8 }, error: null }));
});

describe("GradeComparativoBloco", () => {
  it("antes da Ordem de Criação não renderiza nem chama a RPC", async () => {
    const { container, unmount } = await montar(false);
    expect(container.querySelector("[data-testid=grade-comparativo]")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    unmount();
  });

  it("colunas na ordem do servidor e fase ausente = —", async () => {
    const { container, unmount } = await montar();
    const ths = Array.from(container.querySelectorAll("table th")).map((t) => t.textContent);
    expect(ths.slice(1, 4)).toEqual(["36", "38", "40"]);
    const linhaTam38 = container.querySelectorAll("table tbody tr td")[2].textContent ?? "";
    expect(linhaTam38).toContain("CAD—");
    expect(linhaTam38).toContain("PCP—");
    expect(linhaTam38).toContain("CQ—");
    unmount();
  });

  it("com permissão a Programada vira input e salva mandando o rev lido (nunca null)", async () => {
    const { container, unmount } = await montar();
    const inp = container.querySelector("table input[aria-label^='Programada']") as HTMLInputElement;
    expect(inp).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(inp, "9"); inp.dispatchEvent(new Event("input", { bubbles: true })); });
    const botao = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("Salvar grade programada")) as HTMLButtonElement;
    expect(botao).toBeTruthy();
    await act(async () => { botao.click(); });
    const chamada = rpc.mock.calls.find((c) => c[0] === "salvar_grade_programada");
    expect(chamada?.[1]._rev_base).toBe(7);
    expect(chamada?.[1]._grades).toEqual([{ variante_numero: 1, grades: { "36": 9, "38": 6 } }]);
    unmount();
  });

  it("sem permissão: só leitura (nenhum input)", async () => {
    perm.edit = false;
    const { container, unmount } = await montar();
    expect(container.querySelector("table input")).toBeNull();
    unmount();
  });
});
