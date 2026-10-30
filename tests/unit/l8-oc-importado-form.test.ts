// @vitest-environment happy-dom
// L8 fix round 1 (M1/Q1, P-207 A na OC de importado) — RENDER real do editor de ETAPAS da OC (R13 T8: `OcImpTotais`, que substituiu o
// `OcImpForm`): a etapa nova nasce com a cotação de referência; etapa de mercadoria % > 0 sem cotação em OC com valor (algum produto com
// valor M1 > 0) ganha borda vermelha + mensagem PT; trocar a base Frete → Mercadoria com cotação 1 aplica a referência (B3).
import { describe, it, expect, vi } from "vitest";
import { createElement, useState } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import * as queryModule from "@tanstack/react-query";
import { emptyCabecalho, type CabecalhoImpDraft } from "@/components/oc-p-importado/shared";
import { itemAvulsoVazio, type ItemOcImp } from "@/components/oc-p-importado/itens";

vi.mock("@/hooks/useSignedUrl", () => ({ useSignedUrl: () => null }));
vi.mock("@/hooks/useStoreTimezone", () => ({ useStoreTimezone: () => "America/Sao_Paulo" }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { OcImpTotais } = await import("@/components/oc-p-importado/OcImpCabecalho");

const itemComValor = (valor: number): ItemOcImp => ({ ...itemAvulsoVazio(), nome_produto: "Vestido", qtd_total: 10, valor_unitario_m1: valor });

function montar(inicial: CabecalhoImpDraft, valorItem: number) {
  const atual: { d: CabecalhoImpDraft } = { d: inicial };
  function Harness() {
    const [draft, setDraft] = useState<CabecalhoImpDraft>(inicial);
    atual.d = draft;
    return createElement(OcImpTotais, { draft, setDraft, itens: [itemComValor(valorItem)], landedUnitarioOc: 0 });
  }
  const qc = new queryModule.QueryClient();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(queryModule.QueryClientProvider, { client: qc }, createElement(Harness)),
    );
  });
  return {
    container,
    atual,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("OcImpTotais (etapas da OC) — P-207 A (L8 fix round 1)", () => {
  it("'Adicionar etapa' nasce com a cotação de referência (antes: 0)", () => {
    const { container, atual, unmount } = montar({ ...emptyCabecalho(), cotacao_ref: 5 }, 10);
    const add = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Adicionar etapa"),
    );
    expect(add).toBeTruthy();
    act(() => {
      add!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(atual.d.etapas).toEqual([
      {
        ordem: 1,
        rotulo: "",
        base: "mercadoria",
        percentual: 0,
        data_vencimento: null,
        cotacao: 5,
      },
    ]);
    unmount();
  });

  it("mercadoria 30% sem cotação em OC COM valor: borda vermelha + mensagem PT; SEM valor: nada", () => {
    const etapas: CabecalhoImpDraft["etapas"] = [
      {
        ordem: 1,
        rotulo: "Sinal",
        base: "mercadoria",
        percentual: 30,
        data_vencimento: null,
        cotacao: 0,
      },
    ];
    const com = montar({ ...emptyCabecalho(), cotacao_ref: 5, etapas }, 10);
    const cot = com.container.querySelector('[data-colab-path="etapa-cot:1"]') as HTMLInputElement;
    expect(cot.className).toContain("border-destructive");
    expect(com.container.textContent).toContain(
      'Etapa "Sinal" de mercadoria (30%) está sem cotação',
    );
    com.unmount();
    const sem = montar({ ...emptyCabecalho(), cotacao_ref: 5, etapas }, 0);
    expect(
      (sem.container.querySelector('[data-colab-path="etapa-cot:1"]') as HTMLInputElement)
        .className,
    ).not.toContain("border-destructive");
    expect(sem.container.textContent).not.toContain("está sem cotação");
    sem.unmount();
  });
});
