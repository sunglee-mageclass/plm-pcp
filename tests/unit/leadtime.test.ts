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
  metaConfig,
  splitFaseSub,
  promoverExtintos,
  detalharOutros,
  PROMO_HISTORICO_FRAC,
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

describe("leadtime · split por sub-etapa (grupos expansíveis: Σ sub ≡ agregado)", () => {
  const lookup = idealLookup([
    { etapa: "kanban:em_ajuste", idealDias: 5 },
    { etapa: "servico_cat:corte", idealDias: 3 },
  ]);
  // Item real (shape provado no banco): kanban por status (incl. "aprovado" histórico fora do board),
  // cad_corte + macro "servicos" + servico_cat por categoria (todos na fase Serviços).
  const item = {
    duracoes: {
      planejamento: 4,
      "kanban:em_ajuste": 6,
      "kanban:aprovado": 30, // histórico, fora do board → Outros de Desenvolvimento
      "kanban:stand_by": 2, // no board (sub-coluna própria)
      cad_corte: 10, // Serviços → Outros
      servicos: 18, // macro Serviços → Outros
      "servico_cat:corte": 11, // categoria própria
      "servico_cat:oficina": 5, // categoria própria
      cq: 1,
    },
    sub1_sla: null,
  };

  it("metaConfig: só a config, nunca o default; sub-etapa não configurada → null (célula neutra)", () => {
    expect(metaConfig("kanban:em_ajuste", lookup)).toBe(5);
    expect(metaConfig("servico_cat:corte", lookup)).toBe(3);
    expect(metaConfig("kanban:aprovado", lookup)).toBeNull(); // sem ideal na config → neutra
    expect(metaConfig("cad_corte", lookup)).toBeNull();
  });

  it("Desenvolvimento: Σ das sub-colunas + Outros ≡ agregado; Outros captura status histórico", () => {
    const devKeys = ["kanban:em_ajuste", "kanban:stand_by"]; // ordem do board
    const s = splitFaseSub(item, "desenvolvimento", devKeys);
    expect(s.valores["kanban:em_ajuste"]).toBe(6);
    expect(s.valores["kanban:stand_by"]).toBe(2);
    expect(s.outros).toBe(30); // "aprovado" (fora do board) preservado em Outros
    const agg = itemTotais(item, lookup, null).porFase.desenvolvimento!;
    expect(s.valores["kanban:em_ajuste"] + s.valores["kanban:stand_by"] + s.outros).toBe(agg.valor);
    expect(s.total).toBe(agg.valor); // 38
  });

  it("Serviços: categorias próprias + Outros (cad_corte + macro servicos) ≡ agregado", () => {
    const servKeys = ["servico_cat:corte", "servico_cat:oficina"];
    const s = splitFaseSub(item, "servicos", servKeys);
    expect(s.valores["servico_cat:corte"]).toBe(11);
    expect(s.valores["servico_cat:oficina"]).toBe(5);
    expect(s.outros).toBe(28); // cad_corte 10 + macro servicos 18
    const agg = itemTotais(item, lookup, null).porFase.servicos!;
    expect(11 + 5 + s.outros).toBe(agg.valor);
    expect(s.total).toBe(agg.valor); // 44
  });

  it("sub-coluna sem dado no item fica AUSENTE (célula '—'), sem inventar zero; Outros=0 quando não há resto", () => {
    const s = splitFaseSub(
      { duracoes: { "kanban:em_ajuste": 6 } },
      "desenvolvimento",
      ["kanban:em_ajuste", "kanban:stand_by"],
    );
    expect(s.valores["kanban:em_ajuste"]).toBe(6);
    expect(s.valores["kanban:stand_by"]).toBeUndefined();
    expect(s.outros).toBe(0);
  });

  it("ignora valores não-numéricos (NaN) na partição — paridade com itemTotais", () => {
    // Number("x")=NaN → pulado; Number(null)=0 é finito (contado como 0, igual a itemTotais).
    const s = splitFaseSub({ duracoes: { "kanban:em_ajuste": "x", "kanban:x": 3 } }, "desenvolvimento", ["kanban:em_ajuste"]);
    expect(s.valores["kanban:em_ajuste"]).toBeUndefined();
    expect(s.outros).toBe(3);
    expect(s.total).toBe(3);
  });
});

describe("leadtime · promoção de status extinto + CAD→Corte fora do balde (Σ fecha)", () => {
  const lookup = idealLookup([
    { etapa: "kanban:em_ajuste", idealDias: 5 },
    { etapa: "cad_corte", idealDias: 7 },
  ]);
  // Board = só em_ajuste + stand_by. "aprovado"/"reprovado" são EXTINTOS (fora do board).
  const devBoardKeys = ["kanban:em_ajuste", "kanban:stand_by"];
  const A = {
    duracoes: {
      "kanban:em_ajuste": 6,
      "kanban:aprovado": 30, // extinto pesado
      "kanban:stand_by": 2,
      cad_corte: 10,
      servicos: 18, // macro
      "servico_cat:corte": 11,
      "servico_cat:oficina": 5,
    },
    sub1_sla: null,
  };
  const B = {
    duracoes: {
      "kanban:em_ajuste": 4,
      "kanban:aprovado": 2, // extinto leve
      "kanban:reprovado": 1, // extinto raro
    },
    sub1_sla: null,
  };

  it("promoverExtintos: só o extinto RELEVANTE (Σ ≥ 20% da fase) vira coluna; leves ficam no balde", () => {
    // Dev fase total = A(6+30+2) + B(4+2+1) = 45; limite = 0,2×45 = 9.
    // aprovado Σ = 32 ≥ 9 → promovido; reprovado Σ = 1 < 9 → fica em Histórico.
    expect(promoverExtintos([A, B], "desenvolvimento", devBoardKeys)).toEqual(["kanban:aprovado"]);
  });

  it("promoverExtintos: nada passa do limiar ⇒ [] (balde intacto)", () => {
    // Só extintos LEVES: aprovado 2 + reprovado 1 numa fase de 4+2+1=7; limite 1,4. Ambos pequenos
    // vs board dominante em_ajuste 4… aprovado 2 ≥ 1,4 → NA verdade passa. Ajuste: board grande.
    const big = { duracoes: { "kanban:em_ajuste": 100, "kanban:aprovado": 5 }, sub1_sla: null };
    // fase = 105; limite = 21; aprovado 5 < 21 → não promove.
    expect(promoverExtintos([big], "desenvolvimento", devBoardKeys)).toEqual([]);
  });

  it("promoverExtintos: fase sem tempo ⇒ [] (empty-state honesto)", () => {
    expect(promoverExtintos([{ duracoes: {} }], "desenvolvimento", devBoardKeys)).toEqual([]);
    expect(promoverExtintos([], "desenvolvimento", devBoardKeys)).toEqual([]);
  });

  it("PROMO_HISTORICO_FRAC é o critério REGISTRADO (20%)", () => {
    expect(PROMO_HISTORICO_FRAC).toBe(0.2);
  });

  it("Dev: com o extinto PROMOVIDO em devKeys, ele sai do Histórico e Σ continua fechando", () => {
    const devKeys = [...devBoardKeys, "kanban:aprovado"]; // aprovado promovido
    const s = splitFaseSub(A, "desenvolvimento", devKeys);
    expect(s.valores["kanban:aprovado"]).toBe(30); // agora coluna própria
    expect(s.outros).toBe(0); // nada sobra em Histórico
    const agg = itemTotais(A, lookup, null).porFase.desenvolvimento!;
    expect(s.valores["kanban:em_ajuste"] + s.valores["kanban:stand_by"] + s.valores["kanban:aprovado"] + s.outros).toBe(agg.valor);
    expect(s.total).toBe(agg.valor); // 38
    // e o extinto leve de B continua no Histórico (não foi promovido)
    const sB = splitFaseSub(B, "desenvolvimento", devKeys);
    expect(sB.valores["kanban:aprovado"]).toBe(2);
    expect(sB.outros).toBe(1); // reprovado, não-promovido
  });

  it("Serviços: CAD→Corte em servKeys vira coluna própria; Outros fica só com macro/inativas; Σ fecha", () => {
    const servKeys = ["cad_corte", "servico_cat:corte", "servico_cat:oficina"];
    const s = splitFaseSub(A, "servicos", servKeys);
    expect(s.valores["cad_corte"]).toBe(10); // fora do balde
    expect(s.valores["servico_cat:corte"]).toBe(11);
    expect(s.valores["servico_cat:oficina"]).toBe(5);
    expect(s.outros).toBe(18); // SÓ o macro "servicos" (antigo) — cad_corte não está mais aqui
    const agg = itemTotais(A, lookup, null).porFase.servicos!;
    expect(10 + 11 + 5 + s.outros).toBe(agg.valor);
    expect(s.total).toBe(agg.valor); // 44
  });

  it("detalharOutros: itemiza o resíduo por chave (célula = 1 item), ordenado por valor desc", () => {
    // Dev, sem promover: resíduo de A = aprovado 30.
    expect(detalharOutros(A, "desenvolvimento", devBoardKeys)).toEqual([{ key: "kanban:aprovado", valor: 30 }]);
    // Serviços, cad_corte já é coluna: resíduo = só macro servicos 18.
    expect(detalharOutros(A, "servicos", ["cad_corte", "servico_cat:corte", "servico_cat:oficina"])).toEqual([
      { key: "servicos", valor: 18 },
    ]);
  });

  it("detalharOutros: agregado do FILTRO (header) soma os itens e ordena por peso", () => {
    // Dev, sem promover: aprovado 30+2=32, reprovado 1 → ordenado desc.
    expect(detalharOutros([A, B], "desenvolvimento", devBoardKeys)).toEqual([
      { key: "kanban:aprovado", valor: 32 },
      { key: "kanban:reprovado", valor: 1 },
    ]);
  });

  it("detalharOutros: sem resíduo ⇒ [] (Histórico/Outros não aparece)", () => {
    const devKeys = [...devBoardKeys, "kanban:aprovado", "kanban:reprovado"];
    expect(detalharOutros([A, B], "desenvolvimento", devKeys)).toEqual([]);
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
