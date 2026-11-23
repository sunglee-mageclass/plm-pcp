import { describe, it, expect } from "vitest";
import {
  agruparVariantes,
  type GradeVarianteCompleta,
} from "@/components/aviamento/grade/agruparAviamentoGrade";

const v = (id: string, aviamentoId: string): GradeVarianteCompleta => ({
  id,
  aviamento_id: aviamentoId,
  cor_id: null,
  cor_apelido_id: null,
  nome_variante: null,
  codigo_variante: null,
  preco: null,
  foto_url: null,
  created_at: "2026-01-01",
});

describe("agruparVariantes (aviamento)", () => {
  it("agrupa por aviamento e preserva a ordem de entrada", () => {
    const mapa = agruparVariantes([
      v("1", "A"),
      v("2", "B"),
      v("3", "A"),
      v("4", "B"),
      v("5", "A"),
    ]);
    expect([...mapa.keys()]).toEqual(["A", "B"]);
    expect(mapa.get("A")!.map((x) => x.id)).toEqual(["1", "3", "5"]);
    expect(mapa.get("B")!.map((x) => x.id)).toEqual(["2", "4"]);
  });

  it("lista vazia gera Map vazio e aviamento sem variante fica ausente", () => {
    const mapa = agruparVariantes([]);
    expect(mapa.size).toBe(0);
    expect(mapa.get("A")).toBeUndefined();
  });

  it("mantém as referências dos objetos (não copia a variante)", () => {
    const x = v("1", "A");
    expect(agruparVariantes([x]).get("A")![0]).toBe(x);
  });
});
