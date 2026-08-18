import { describe, it, expect } from "vitest";
import {
  FASES,
  faseDeEtapa,
  idealLookup,
  idealDeEtapa,
  itemTotais,
  heroStats,
  seqIndexRatio,
  seqTextToken,
  bulletScaleMax,
} from "@/lib/leadtime";

describe("leadtime · fases (colapso de 18 etapas → 6 fases)", () => {
  it("tem 6 fases em ordem de fluxo", () => {
    expect(FASES.map((f) => f.key)).toEqual([
      "planejamento",
      "desenvolvimento",
      "servicos",
      "cq",
      "direcionamento",
      "lancamento",
    ]);
  });

  it("colapsa TODO o kanban (incl. status histórico 'aprovado') em Desenvolvimento", () => {
    expect(faseDeEtapa("kanban:em_ajuste")).toBe("desenvolvimento");
    expect(faseDeEtapa("kanban:aprovado")).toBe("desenvolvimento"); // histórico, fora do board
    expect(faseDeEtapa("kanban:explosao")).toBe("desenvolvimento");
    expect(faseDeEtapa("planejamento")).toBe("planejamento");
  });

  it("dobra cad_corte e servico_cat em Serviços; cq/direc/lançam próprias", () => {
    expect(faseDeEtapa("cad_corte")).toBe("servicos");
    expect(faseDeEtapa("servicos")).toBe("servicos");
    expect(faseDeEtapa("servico_cat:43150a2d")).toBe("servicos");
    expect(faseDeEtapa("cq")).toBe("cq");
    expect(faseDeEtapa("direcionamento")).toBe("direcionamento");
    expect(faseDeEtapa("lancamento")).toBe("lancamento");
  });
});

describe("leadtime · ideal por etapa", () => {
  const lookup = idealLookup([
    { etapa: "planejamento", idealDias: 7 },
    { etapa: "kanban:em_ajuste", idealDias: 5 },
  ]);
  it("usa a config quando existe", () => {
    expect(idealDeEtapa("planejamento", lookup)).toBe(7);
    expect(idealDeEtapa("kanban:em_ajuste", lookup)).toBe(5);
  });
  it("cai no default por tipo p/ chaves fora do board (kanban 5d, macro/serviço 7d)", () => {
    expect(idealDeEtapa("kanban:aprovado", lookup)).toBe(5); // histórico não configurado
    expect(idealDeEtapa("cad_corte", lookup)).toBe(7);
    expect(idealDeEtapa("servico_cat:x", lookup)).toBe(7);
  });
});

describe("leadtime · itemTotais (soma completa + meta apples-to-apples)", () => {
  const lookup = idealLookup([
    { etapa: "planejamento", idealDias: 7 },
    { etapa: "kanban:aprovacao_do_modelo", idealDias: 5 },
  ]);

  it("soma TODAS as durações (inclui 'aprovado' histórico) e agrega por fase", () => {
    const item = {
      duracoes: {
        planejamento: 4,
        "kanban:aprovado": 31, // histórico, fora do board → Desenvolvimento, ideal default 5
        "kanban:aprovacao_do_modelo": 3.7,
      },
      sub1_sla: null,
    };
    const r = itemTotais(item, lookup, null);
    expect(r.total).toBeCloseTo(38.7, 5);
    // meta = 7 (planej) + 5 (aprovado default) + 5 (aprov modelo) = 17
    expect(r.meta).toBe(17);
    expect(r.porFase.planejamento).toEqual({ valor: 4, meta: 7 });
    expect(r.porFase.desenvolvimento).toEqual({ valor: 34.7, meta: 10 });
    expect(r.porFase.servicos).toBeUndefined();
  });

  it("usa o SLA da Sub1 do item na etapa de SLA quando configurado", () => {
    const item = { duracoes: { "servico_cat:x": 12 }, sub1_sla: 10 };
    const r = itemTotais(item, lookup, "servico_cat:x");
    expect(r.porFase.servicos).toEqual({ valor: 12, meta: 10 });
  });

  it("ignora valores não-numéricos", () => {
    const r = itemTotais({ duracoes: { planejamento: null, cq: 2 } }, lookup, null);
    expect(r.total).toBe(2);
    expect(r.porFase.cq).toEqual({ valor: 2, meta: 7 });
  });
});

describe("leadtime · heroStats", () => {
  const lookup = idealLookup([{ etapa: "planejamento", idealDias: 7 }]);
  it("média ponta-a-ponta, meta média, desvio e % dentro da meta", () => {
    const itens = [
      { duracoes: { planejamento: 4 } }, // total 4 ≤ meta 7 → dentro
      { duracoes: { planejamento: 10 } }, // total 10 > meta 7 → fora
    ];
    const h = heroStats(itens, lookup, null);
    expect(h.n).toBe(2);
    expect(h.mediaTotal).toBe(7);
    expect(h.mediaMeta).toBe(7);
    expect(h.delta).toBe(0);
    expect(h.dentroMeta).toBe(1);
    expect(h.pctDentro).toBe(50);
  });
  it("filtro vazio = zeros (empty-state honesto)", () => {
    expect(heroStats([], lookup, null)).toMatchObject({ n: 0, mediaTotal: 0, pctDentro: 0 });
  });
});

describe("leadtime · rampa sequencial + texto legível", () => {
  it("razão real/ideal → índice 0..4 (nunca satura)", () => {
    expect(seqIndexRatio(0.5)).toBe(0);
    expect(seqIndexRatio(1.0)).toBe(1);
    expect(seqIndexRatio(1.4)).toBe(2);
    expect(seqIndexRatio(2.5)).toBe(3);
    expect(seqIndexRatio(3.1)).toBe(4); // gargalo 3,1× a meta
    expect(seqIndexRatio(0)).toBe(0);
    expect(seqIndexRatio(NaN)).toBe(0);
  });
  it("texto: índices claros = --foreground; intensos = --background (theme-proof)", () => {
    expect(seqTextToken(0)).toBe("var(--foreground)");
    expect(seqTextToken(2)).toBe("var(--foreground)");
    expect(seqTextToken(3)).toBe("var(--background)");
    expect(seqTextToken(4)).toBe("var(--background)");
  });
});

describe("leadtime · escala do bullet (nunca satura — R7)", () => {
  it("cobre a pior barra e a faixa atrasado (1,5× ideal) com folga", () => {
    // pior barra 15,5 domina; ideal 5 → 1,5× = 7,5
    expect(bulletScaleMax([0.5, 2.2, 15.5], [5, 5, 5])).toBeCloseTo(16.74, 2);
    // ideal grande domina quando as barras são pequenas
    expect(bulletScaleMax([1], [7])).toBeCloseTo(11.2, 2);
    expect(bulletScaleMax([], [])).toBe(1);
  });
});
