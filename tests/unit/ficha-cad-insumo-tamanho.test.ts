// urg R1 T7 — o payload do CAD montado no Salvar do Sheet do Planejamento conta, para o insumo vinculado a UM tamanho,
// so as pecas daquele tamanho (espelho do `_enviar_modelo_para_cad_core`); sem vinculo = consumo x grade total (como hoje).
import { describe, it, expect } from "vitest";
import { montarCadPayload } from "@/components/planejamento/planejamento-detail/ficha/ficha-cad";
import type { GradeRow, ModeloEtiquetaRow } from "@/components/desenvolvimento/modelo-detail/types";

// 2 variantes: 40|M = 16 + 8 = 24; total geral 96 (60 + 36).
const grades: GradeRow[] = [
  { variante_numero: 1, grades: { "40|M": 16, "38|P": 20, "36|PP": 24 }, grade_total: 60 },
  { variante_numero: 2, grades: { "40|M": 8, "38|P": 12, "36|PP": 16 }, grade_total: 36 },
];
const linha = (id: string, consumo: number): ModeloEtiquetaRow => ({
  etiqueta_id: id, cor_id: null, consumo, loss_percent: 0, custo_previsto: 0,
});
const base = { cad: [], grades, aviamentos: [], proporcoes: {} };

describe("montarCadPayload — insumo vinculado a um tamanho (urg R1 T7)", () => {
  it("vinculado a 40|M: quantidade = consumo x pecas do M (24), nao x 96", () => {
    const p = montarCadPayload({ ...base, etiquetas: [linha("e1", 2)], tamanhoPorEtiqueta: { e1: "40|M" } });
    expect(p._etiquetas).toEqual([
      { etiqueta_id: "e1", cor_id: null, consumo: 2, quantidade_planejada: 48, quantidade_enviar: 48, enviar_por_tamanho: {} },
    ]);
  });

  it("tamanho ausente da grade: quantidade 0", () => {
    const p = montarCadPayload({ ...base, etiquetas: [linha("e1", 2)], tamanhoPorEtiqueta: { e1: "46|XG" } });
    expect(p._etiquetas[0].quantidade_planejada).toBe(0);
    expect(p._etiquetas[0].quantidade_enviar).toBe(0);
  });

  it("sem vinculo (null ou id fora do mapa): igual a hoje, consumo x 96", () => {
    const p = montarCadPayload({ ...base, etiquetas: [linha("e1", 2), linha("e2", 0.5)], tamanhoPorEtiqueta: { e1: null } });
    expect(p._etiquetas.map((e) => e.quantidade_planejada)).toEqual([192, 48]);
    expect(p._etiquetas.map((e) => e.quantidade_enviar)).toEqual([192, 48]);
  });

  it("mistura: so a linha vinculada muda; arredonda em 4 casas", () => {
    const p = montarCadPayload({
      ...base,
      etiquetas: [linha("e1", 0.3333), linha("e2", 1)],
      tamanhoPorEtiqueta: { e1: "38|P" }, // 20 + 12 = 32
    });
    expect(p._etiquetas[0].quantidade_planejada).toBe(10.6656);
    expect(p._etiquetas[1].quantidade_planejada).toBe(96);
  });

  it("chave do mapa que so existe no prototipo nao conta (propriedade propria)", () => {
    const p = montarCadPayload({ ...base, etiquetas: [linha("e1", 1)], tamanhoPorEtiqueta: { e1: "constructor" } });
    expect(p._etiquetas[0].quantidade_planejada).toBe(0);
  });

  it("aviamentos nao mudam (so o insumo tem vinculo)", () => {
    const p = montarCadPayload({
      ...base,
      aviamentos: [{ aviamento_id: "av1", variante_aviamento_id: null, consumo: 1, loss_percent: 0, custo_previsto: 0 }],
      etiquetas: [linha("e1", 1)],
      tamanhoPorEtiqueta: { e1: "40|M" },
    });
    expect(p._aviamentos[0].quantidade_enviar).toBe(96);
  });
});
