// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/no-explicit-any -- mock de supabase (mesmo padrão dos outros testes de grade) */
// Ajustes transversais das grades "Lista tipo Excel" de CADASTRO (Tecido/Aviamento/Insumo):
//  1) texto GRANDE (nome, composição, observações) = textarea auto-crescente; texto curto (ncm, códigos) segue input de 1 linha;
//  2) toda célula BLOQUEADA diz o PORQUÊ no `title` (sem permissão / só-leitura derivado / regra do cadastro).
import { describe, it, expect, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn(), storage: { from: vi.fn() } },
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { CelulaTecido } from "@/components/tecido/grade/CelulaTecido";
import { CelulaAviamento } from "@/components/aviamento/grade/CelulaAviamento";
import { CelulaInsumo } from "@/components/insumo/grade/CelulaInsumo";
import { COLUNAS_TECIDO } from "@/lib/tecido-grade/colunas";
import { COLUNAS_AVIAMENTO } from "@/lib/aviamento-grade/colunas";
import { COLUNAS_INSUMO } from "@/lib/insumo-grade/colunas";
import { ehTextoGrande as grandeTecido } from "@/lib/tecido-grade/celulas";
import { ehTextoGrande as grandeAviamento } from "@/lib/aviamento-grade/celulas";
import { ehTextoGrande as grandeInsumo } from "@/lib/insumo-grade/celulas";
import {
  MOTIVO_GENERICO,
  MOTIVO_SEM_PERMISSAO,
  MOTIVO_SOMENTE_LEITURA,
  motivoBloqueio,
} from "@/lib/grade-bloqueio";

const colDe = (cols: readonly { key: string }[], key: string) =>
  cols.find((c) => c.key === key) as any;

async function montar(el: any) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(el);
  });
  return {
    container,
    desmontar: () =>
      act(async () => {
        root.unmount();
        container.remove();
      }),
  };
}

describe("motivoBloqueio (precedência dos motivos)", () => {
  it("sem permissão > derivado > regra do cadastro > nada", () => {
    expect(motivoBloqueio(true, false, "regra")).toBe(MOTIVO_SEM_PERMISSAO);
    expect(motivoBloqueio(false, false, "regra")).toBe(MOTIVO_SOMENTE_LEITURA);
    expect(motivoBloqueio(false, true, "regra")).toBe("regra");
    expect(motivoBloqueio(false, true)).toBeUndefined();
  });
});

describe("texto GRANDE x curto, por cadastro", () => {
  it("nome/composição/observações são grandes; ncm e códigos seguem curtos", () => {
    expect(
      ["nome", "composicao", "ncm", "codigo_variante", "nome_variante"].map(grandeTecido),
    ).toEqual([true, true, false, false, false]);
    expect(
      ["codigo_nome", "composicao", "observacoes", "codigo", "ncm"].map(grandeAviamento),
    ).toEqual([true, true, true, false, false]);
    expect(["nome", "observacoes", "preco"].map(grandeInsumo)).toEqual([true, true, false]);
  });
});

describe("células de texto: textarea nos campos grandes, input nos curtos", () => {
  it("Tecido: nome e composição = textarea; ncm = input", async () => {
    const campos = [
      ["nome", "textarea"],
      ["composicao", "textarea"],
      ["ncm", "input"],
    ] as const;
    for (const [key, tag] of campos) {
      const t = await montar(
        createElement(CelulaTecido, {
          coluna: colDe(COLUNAS_TECIDO, key),
          ariaLabel: key,
          valor: "x",
        }),
      );
      expect(t.container.querySelector("[aria-label]")!.tagName.toLowerCase(), key).toBe(tag);
      await t.desmontar();
    }
  });
  it("Aviamento: nome (codigo_nome)/composição/observações = textarea; código e NCM = input", async () => {
    const campos = [
      ["codigo_nome", "textarea"],
      ["composicao", "textarea"],
      ["observacoes", "textarea"],
      ["codigo", "input"],
      ["ncm", "input"],
    ] as const;
    for (const [key, tag] of campos) {
      const t = await montar(
        createElement(CelulaAviamento, {
          coluna: colDe(COLUNAS_AVIAMENTO, key),
          ariaLabel: key,
          valor: "x",
        }),
      );
      expect(t.container.querySelector("[aria-label]")!.tagName.toLowerCase(), key).toBe(tag);
      await t.desmontar();
    }
  });
  it("Insumo: nome e observações = textarea", async () => {
    for (const key of ["nome", "observacoes"]) {
      const t = await montar(
        createElement(CelulaInsumo, {
          coluna: colDe(COLUNAS_INSUMO, key),
          ariaLabel: key,
          valor: "x",
        }),
      );
      expect(t.container.querySelector("[aria-label]")!.tagName.toLowerCase(), key).toBe(
        "textarea",
      );
      await t.desmontar();
    }
  });

  it("Enter no NOME desce (vai para a navegação da grade) e quebra de linha colada vira espaço; na COMPOSIÇÃO o Enter quebra a linha", async () => {
    const nav = vi.fn();
    const gradeProps = { "data-grade-cel": "0:0", onKeyDown: nav };
    const onChange = vi.fn();
    const nome = await montar(
      createElement(CelulaTecido, {
        coluna: colDe(COLUNAS_TECIDO, "nome"),
        ariaLabel: "nome",
        valor: "",
        onChange,
        gradeProps,
      }),
    );
    const ta = nome.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(nav).toHaveBeenCalledTimes(1);
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      set.call(ta, "Malha\nlisa");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith("Malha lisa");
    await nome.desmontar();

    nav.mockClear();
    const comp = await montar(
      createElement(CelulaTecido, {
        coluna: colDe(COLUNAS_TECIDO, "composicao"),
        ariaLabel: "comp",
        valor: "",
        onChange,
        gradeProps,
      }),
    );
    const tc = comp.container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      tc.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(nav).not.toHaveBeenCalled(); // Enter quebra a linha, não desce
    await act(async () => {
      tc.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    });
    expect(nav).toHaveBeenCalledTimes(1); // Tab segue a navegação
    await comp.desmontar();
  });
});

describe("célula bloqueada diz o porquê (title)", () => {
  it("Tecido: texto, textarea e money desabilitados mostram o motivo; sem motivo informado cai no genérico", async () => {
    for (const key of ["nome", "ncm", "preco"]) {
      const t = await montar(
        createElement(CelulaTecido, {
          coluna: colDe(COLUNAS_TECIDO, key),
          ariaLabel: key,
          valor: "x",
          desabilitado: true,
          motivoBloqueio: MOTIVO_SEM_PERMISSAO,
        }),
      );
      expect((t.container.querySelector("[aria-label]") as HTMLElement).title, key).toBe(
        MOTIVO_SEM_PERMISSAO,
      );
      await t.desmontar();
    }
    const g = await montar(
      createElement(CelulaTecido, {
        coluna: colDe(COLUNAS_TECIDO, "ncm"),
        ariaLabel: "ncm",
        valor: "x",
        desabilitado: true,
      }),
    );
    expect((g.container.querySelector("[aria-label]") as HTMLElement).title).toBe(MOTIVO_GENERICO);
    await g.desmontar();
  });
  it("Tecido: célula habilitada NÃO ganha title de bloqueio; erro/aviso vencem o motivo", async () => {
    const a = await montar(
      createElement(CelulaTecido, {
        coluna: colDe(COLUNAS_TECIDO, "ncm"),
        ariaLabel: "ncm",
        valor: "x",
      }),
    );
    expect((a.container.querySelector("[aria-label]") as HTMLElement).title).toBe("");
    await a.desmontar();
    const b = await montar(
      createElement(CelulaTecido, {
        coluna: colDe(COLUNAS_TECIDO, "ncm"),
        ariaLabel: "ncm",
        valor: "x",
        desabilitado: true,
        motivoBloqueio: "motivo",
        erro: "falta dado",
      }),
    );
    expect((b.container.querySelector("[aria-label]") as HTMLElement).title).toBe("falta dado");
    await b.desmontar();
  });
  it("Tecido: Preço por metro (só leitura) explica que é calculado", async () => {
    const t = await montar(
      createElement(CelulaTecido, {
        coluna: colDe(COLUNAS_TECIDO, "preco_por_metro"),
        ariaLabel: "ppm",
        texto: "R$ 1,00",
      }),
    );
    expect(
      (t.container.querySelector("[data-controle='somente-leitura']") as HTMLElement).title,
    ).toBe(MOTIVO_SOMENTE_LEITURA);
    await t.desmontar();
  });
  it("Aviamento e Insumo: desabilitados mostram o motivo (textarea e input)", async () => {
    for (const [El, cols, keys] of [
      [CelulaAviamento, COLUNAS_AVIAMENTO, ["codigo_nome", "codigo"]],
      [CelulaInsumo, COLUNAS_INSUMO, ["nome", "observacoes"]],
    ] as const) {
      for (const key of keys) {
        const t = await montar(
          createElement(El as any, {
            coluna: colDe(cols, key),
            ariaLabel: key,
            valor: "x",
            desabilitado: true,
            motivoBloqueio: MOTIVO_SEM_PERMISSAO,
          }),
        );
        expect((t.container.querySelector("[aria-label]") as HTMLElement).title, key).toBe(
          MOTIVO_SEM_PERMISSAO,
        );
        await t.desmontar();
      }
    }
  });
  it("Foto em tela somente-leitura mostra o motivo no title", async () => {
    const t = await montar(
      createElement(CelulaTecido, {
        coluna: colDe(COLUNAS_TECIDO, "foto"),
        ariaLabel: "foto",
        foto: { path: null, dica: MOTIVO_SEM_PERMISSAO },
      }),
    );
    expect((t.container.querySelector("[data-controle='foto']") as HTMLElement).title).toBe(
      MOTIVO_SEM_PERMISSAO,
    );
    await t.desmontar();
  });
});
