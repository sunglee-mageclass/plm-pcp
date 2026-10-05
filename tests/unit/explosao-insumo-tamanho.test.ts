// urg R1 T8 — Explosao (secao de insumos) e fichas impressas contam, para o insumo vinculado a UM tamanho, so as pecas
// daquele tamanho. Pure helpers (linhaInsumoExplosao / linhaImpressaoInsumoVinculado / mapaTamanhoVinculado) + a secao
// renderizada + asserts de fonte nos pontos de ligacao (hook, Explosao, fichas).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  linhaImpressaoInsumoVinculado,
  linhaInsumoExplosao,
  mapaTamanhoVinculado,
} from "@/lib/insumo-tamanho";
import { ExplosaoInsumosSection, type InsumoLinha } from "@/components/producao/explosao/ExplosaoInsumosSection";

// 40|M = 16 + 8 = 24; total geral 96 (60 + 36).
const grades = [
  { variante_numero: 1, grades: { "40|M": 16, "38|P": 20, "36|PP": 24 }, grade_total: 60 },
  { variante_numero: 2, grades: { "40|M": 8, "38|P": 12, "36|PP": 16 }, grade_total: 36 },
];
const e = (over: Record<string, unknown> = {}) => ({
  id: "ce1", etiqueta_id: "e1", consumo: 2, quantidade_enviar: null as number | null, ...over,
});

describe("linhaInsumoExplosao", () => {
  it("vinculado e presente na grade: necessaria = consumo x pecas do tamanho; aEnviar nulo -> necessaria", () => {
    const l = linhaInsumoExplosao(e(), { e1: "40|M" }, grades);
    expect(l.tamanhoVinculado).toBe("40|M");
    expect(l.foraDaGrade).toBe(false);
    expect(l.quantidade).toBe(48);
    expect(l.aEnviar).toBe(48);
  });

  it("aEnviar SALVO prevalece (Ruling A6: nada retroativo), inclusive 0", () => {
    expect(linhaInsumoExplosao(e({ quantidade_enviar: 192 }), { e1: "40|M" }, grades).aEnviar).toBe(192);
    expect(linhaInsumoExplosao(e({ quantidade_enviar: 0 }), { e1: "40|M" }, grades).aEnviar).toBe(0);
    expect(linhaInsumoExplosao(e({ quantidade_enviar: "7" }), { e1: "40|M" }, grades).aEnviar).toBe(7);
  });

  it("vinculado a tamanho ausente da grade: quantidade 0 + foraDaGrade (P-281 A)", () => {
    const l = linhaInsumoExplosao(e(), { e1: "46|XG" }, grades);
    expect(l.quantidade).toBe(0);
    expect(l.aEnviar).toBe(0);
    expect(l.foraDaGrade).toBe(true);
    expect(l.tamanhoVinculado).toBe("46|XG");
  });

  it("sem grade ainda (total 0): vinculado nao avisa 'fora da grade'", () => {
    const l = linhaInsumoExplosao(e(), { e1: "40|M" }, []);
    expect(l.foraDaGrade).toBe(false);
    expect(l.quantidade).toBe(0);
  });

  it("sem vinculo (null, id fora do mapa, etiqueta_id nulo): consumo x grade total, como hoje", () => {
    expect(linhaInsumoExplosao(e(), { e1: null }, grades).quantidade).toBe(192);
    expect(linhaInsumoExplosao(e(), {}, grades).quantidade).toBe(192);
    expect(linhaInsumoExplosao(e({ etiqueta_id: null }), { e1: "40|M" }, grades).quantidade).toBe(192);
    const l = linhaInsumoExplosao(e(), { e1: null }, grades);
    expect(l.tamanhoVinculado).toBeNull();
    expect(l.foraDaGrade).toBe(false);
  });

  it("chave que so existe no prototipo nao conta como vinculo nem como grade", () => {
    expect(linhaInsumoExplosao(e({ etiqueta_id: "constructor" }), {}, grades).tamanhoVinculado).toBeNull();
    expect(linhaInsumoExplosao(e(), { e1: "constructor" }, grades).quantidade).toBe(0);
  });

  it("mapa ainda nao carregou (undefined): necessaria null ('—'), NAO decide 'sem vinculo' (padrao C3)", () => {
    const l = linhaInsumoExplosao(e(), undefined, grades);
    expect(l.quantidade).toBeNull();
    expect(l.tamanhoVinculado).toBeNull();
    expect(l.foraDaGrade).toBe(false);
    expect(l.aEnviar).toBeNull(); // sem salvo e sem necessaria
    // com salvo, o salvo vale mesmo antes do mapa
    expect(linhaInsumoExplosao(e({ quantidade_enviar: 5 }), undefined, grades).aEnviar).toBe(5);
  });

  it("consumo nulo/textual vira numero", () => {
    expect(linhaInsumoExplosao(e({ consumo: null }), {}, grades).quantidade).toBe(0);
    expect(linhaInsumoExplosao(e({ consumo: "0.5" }), { e1: "40|M" }, grades).quantidade).toBe(12);
  });
});

describe("mapaTamanhoVinculado (o que o hook devolve)", () => {
  const linha = (id: string, vinc: string | null, formato: string | null, vars: { tamanho: string | null }[] | null) =>
    ({ id, tamanho_vinculado: vinc, formato_tamanho: formato, variantes_etiqueta: vars });

  it("efetivo so p/ insumo sem tamanho proprio; trim de espacos; vazio = null", () => {
    const m = mapaTamanhoVinculado([
      linha("a", "40|M", "nenhum", []),
      linha("b", " 38|P ", "ambos", [{ tamanho: null }]),
      linha("c", "40|M", "ambos", [{ tamanho: "G" }]), // tem tamanho proprio -> ignora o vinculo
      linha("d", "   ", "nenhum", null),
      linha("e", null, "nenhum", null),
    ]);
    expect(m).toEqual({ a: "40|M", b: "38|P", c: null, d: null, e: null });
  });
});

describe("linhaImpressaoInsumoVinculado (Ficha de Corte / Ficha Tecnica)", () => {
  it("UMA linha: Tamanho = rotulo, planejada = consumo x pecas do tamanho, enviar = o gravado", () => {
    const r = linhaImpressaoInsumoVinculado({ consumo: 2, quantidade_enviar: 50 }, "40|M", grades);
    expect(r).toEqual({ tamanho: "M · 40", planejada: 48, enviar: 50, foraDaGrade: false });
  });
  it("fora da grade: '{rotulo} (fora da grade)', planejada 0, enviar = o gravado", () => {
    const r = linhaImpressaoInsumoVinculado({ consumo: 2, quantidade_enviar: 3 }, "46|XG", grades);
    expect(r).toEqual({ tamanho: "XG · 46 (fora da grade)", planejada: 0, enviar: 3, foraDaGrade: true });
  });
});

describe("ExplosaoInsumosSection (renderizada)", () => {
  const base: InsumoLinha = {
    id: "ce1", etiqueta_nome: "Marca", cor: null, cor_label: null, consumo: 2, quantidade: 48, aEnviar: 48,
    tamanhoVinculado: null, foraDaGrade: false,
  };
  const html = (linhas: InsumoLinha[]) =>
    renderToStaticMarkup(createElement(ExplosaoInsumosSection, { linhas, gradeTotalGeral: 96, editing: false, onEnviarChange: () => {} }));

  it("cabecalho com o texto novo (verbatim)", () => {
    const h = html([base]);
    expect(h).toContain("necessária = consumo por peça × grade total (ou × peças do tamanho vinculado); só &quot;a enviar&quot; é editável");
  });
  it("linha vinculada: chip 'Só tam. {rotulo}'; sem vinculo: sem chip", () => {
    expect(html([{ ...base, tamanhoVinculado: "40|M" }])).toContain("Só tam. M · 40");
    expect(html([base])).not.toContain("Só tam.");
  });
  it("fora da grade: linha ambar com o texto do P-281 A", () => {
    const h = html([{ ...base, tamanhoVinculado: "46|XG", foraDaGrade: true, quantidade: 0, aEnviar: 0 }]);
    expect(h).toContain("O tamanho XG · 46 não está na grade deste modelo — quantidade 0.");
  });
  it("dentro da grade: sem o aviso", () => {
    expect(html([{ ...base, tamanhoVinculado: "40|M" }])).not.toContain("não está na grade");
  });
  it("necessaria nula (hook carregando) mostra '—' e nao 0", () => {
    const h = html([{ ...base, quantidade: null }]);
    expect(h).toMatch(/data-label="Qtd necessária"[^>]*>—</);
  });
});

describe("ligacao (fonte)", () => {
  const src = (p: string) => readFileSync(p, "utf8");

  it("hook: queryKey por loja, query SEPARADA que LANCA o erro", () => {
    const s = src("src/hooks/useTamanhoVinculadoInsumos.ts");
    expect(s).toContain('["insumos-tamanho-vinculado", tenantId]');
    expect(s).toContain("buscarTodas"); // lanca o erro de cada pagina (src/lib/buscar-todas.ts) e nao perde linhas alem de 1.000
    expect(src("src/lib/buscar-todas.ts")).toContain("if (error) throw error");
    expect(s).toContain("tamanho_vinculado");
    expect(s).toContain("variantes_etiqueta(tamanho)");
  });

  it("Explosao: usa o hook, o helper puro, e o erro entra no falhaCarga (trava o Salvar)", () => {
    const s = src("src/components/producao/explosao/ExplosaoDetail.tsx");
    expect(s).toContain("useTamanhoVinculadoInsumos");
    expect(s).toContain("linhaInsumoExplosao(");
    expect(s).toMatch(/falhaCarga =[\s\S]{0,700}tamIsErr/);
    expect(s).toMatch(/tentarDeNovo = \(\) => \{[\s\S]{0,500}tamIsErr/);
    // a semente do "a enviar" espera o mapa (senao semearia a necessaria SEM o vinculo)
    expect(s).toMatch(/if \(!seeded \|\| !cadEtiquetasFetched \|\| tamData === undefined \|\| tamFetching \|\| tamIsErr\) return;/);
  });

  it("fichas: useFichaData liga o mapa; as duas impressoes imprimem UMA linha p/ o vinculado", () => {
    const d = src("src/components/producao/cad/useFichaData.ts");
    expect(d).toContain("useTamanhoVinculadoInsumos");
    expect(d).toContain("tamanhoVinculado");
    for (const f of ["src/components/producao/cad/CadFichaCorte.tsx", "src/components/producao/FichaTecnica.tsx"]) {
      expect(src(f)).toContain("linhaImpressaoInsumoVinculado(");
    }
    expect(src("src/components/producao/cad/types.ts")).toMatch(/tamanhoVinculado\?: string \| null/);
  });
});
