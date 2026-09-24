import { describe, it, expect } from "vitest";
import { CONDICAO_BY_KEY } from "@/lib/kanban-condicoes";
import {
  CONDICOES_SECAO_BOM, requisitosUniao, seloSecaoBom, type SecaoBomKey,
} from "@/components/planejamento/planejamento-detail/ficha/selos-bom";
import type { ResumoBom } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";

// F3.2 — selos de completude das seções do BOM no Sheet do Planejamento: MAPA PRÓPRIO seção→condições
// (o catálogo/`CondicaoSecao` fica intocado — decisão travada 8).
const cheio: ResumoBom = { nTecidos: 2, todosBlocosComArtigoTemVariante: true, nAviamentos: 3, nInsumos: 1, gradeTotalGeral: 24 };
const vazio: ResumoBom = { nTecidos: 0, todosBlocosComArtigoTemVariante: true, nAviamentos: 0, nInsumos: 0, gradeTotalGeral: 0 };

describe("mapa próprio seção → condições", () => {
  it("toda chave do mapa existe no catálogo (anti-drift local)", () => {
    for (const keys of Object.values(CONDICOES_SECAO_BOM)) for (const k of keys) expect(CONDICAO_BY_KEY.has(k), k).toBe(true);
  });
  it("'Tecido planejado' passa a morar na seção Tecidos (no catálogo ela não tem seção)", () => {
    expect(CONDICOES_SECAO_BOM.tecidos).toContain("tecido_planejado");
  });
});

describe("requisitosUniao", () => {
  it("une as colunas e ignora lixo", () => {
    expect([...requisitosUniao({ a: ["grade_preenchida", 3], b: ["aviamento_definido"], c: "x" })].sort()).toEqual(["aviamento_definido", "grade_preenchida"]);
    expect(requisitosUniao(null).size).toBe(0);
  });
});

describe("seloSecaoBom", () => {
  it("sem requisito configurado na seção → selo informativo (fallback do Dev)", () => {
    const f = (s: SecaoBomKey, r: ResumoBom) => seloSecaoBom(s, new Set(), {}, r);
    expect(f("tecidos", cheio)).toEqual({ tone: "ok", texto: "2 tecidos" });
    expect(f("tecidos", vazio)).toEqual({ tone: "muted", texto: "vazio" });
    expect(f("tecidos", { ...cheio, nTecidos: 1, todosBlocosComArtigoTemVariante: false })).toEqual({ tone: "warn", texto: "falta variante" });
    expect(f("aviamentos", cheio)).toEqual({ tone: "ok", texto: "3" });
    expect(f("insumos", vazio)).toEqual({ tone: "muted", texto: "vazio" });
    expect(f("grade", cheio)).toEqual({ tone: "ok", texto: "preenchida" });
    expect(f("grade", vazio)).toEqual({ tone: "warn", texto: "falta preencher" });
  });
  it("requisito configurado e satisfeito → ok", () => {
    expect(seloSecaoBom("grade", new Set(["grade_preenchida"]), { grade_preenchida: true }, vazio)).toEqual({ tone: "ok", texto: "ok" });
  });
  it("1 requisito faltando → 'falta <rótulo>' + a condição p/ o 'i'", () => {
    const s = seloSecaoBom("tecidos", new Set(["tecido_com_variante"]), {}, cheio);
    expect(s.tone).toBe("warn");
    expect(s.texto).toBe("falta tecido com variante (≥ 1)");
    expect(s.condicaoUnica?.key).toBe("tecido_com_variante");
  });
  it("2 faltando → 'faltam 2' com a lista no title", () => {
    const s = seloSecaoBom("grade", new Set(["grade_preenchida", "grade_todas_variantes"]), {}, cheio);
    expect(s.texto).toBe("faltam 2");
    expect(s.title).toBe("Falta: Grade preenchida, Grade preenchida (todas as variantes)");
    expect(s.condicaoUnica).toBeUndefined();
  });
  it("Insumos não tem condição no catálogo → sempre o selo informativo", () => {
    expect(seloSecaoBom("insumos", new Set(["grade_preenchida"]), {}, cheio)).toEqual({ tone: "ok", texto: "1" });
  });
});
