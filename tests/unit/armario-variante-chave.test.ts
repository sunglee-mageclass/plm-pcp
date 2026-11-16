import { describe, it, expect } from "vitest";
import { chaveVariante, rotuloVariante, dedupeVariantes, origemDoItem } from "@/lib/armario/variante-chave";

const interno = { modelo_id: "m1", variante_tecido_id: "vt1", cor_id: "c1", cor_apelido_id: "a1" };
const revenda = { modelo_id: "m2", produto_variante_id: "pv1", cor_id: "c1", cor_apelido_id: null };
const importado = { modelo_id: "m3", produto_variante_id: "pv2", cor_id: "c2", cor_apelido_id: "a2" };

describe("chaveVariante", () => {
  it("3 origens produzem a mesma FORMA (5 partes)", () => {
    for (const it_ of [interno, revenda, importado]) {
      expect(chaveVariante(it_).split("|")).toHaveLength(5);
    }
    expect(chaveVariante(interno)).toBe("m1|vt1||c1|a1");
    expect(chaveVariante(revenda)).toBe("m2||pv1|c1|");
  });
  it("mesma identidade colide; diferença de qualquer campo separa", () => {
    expect(chaveVariante({ ...interno })).toBe(chaveVariante(interno));
    expect(chaveVariante({ ...interno, cor_apelido_id: "a9" })).not.toBe(chaveVariante(interno));
    expect(chaveVariante({ ...interno, variante_tecido_id: "vt9" })).not.toBe(chaveVariante(interno));
    expect(chaveVariante({ ...interno, modelo_id: "m9" })).not.toBe(chaveVariante(interno));
  });
  it("undefined e null equivalem a ausente", () => {
    expect(chaveVariante({ modelo_id: "m", produto_variante_id: "p" })).toBe(
      chaveVariante({ modelo_id: "m", produto_variante_id: "p", variante_tecido_id: null, cor_id: null, cor_apelido_id: null }),
    );
  });
  it("ignora ordem/posição (não faz parte da identidade)", () => {
    const a = { ...interno, ordem: 1 } as typeof interno;
    const b = { ...interno, ordem: 7 } as typeof interno;
    expect(chaveVariante(a)).toBe(chaveVariante(b));
  });
  it("dedupeVariantes mantém a 1ª ocorrência e a ordem", () => {
    expect(dedupeVariantes([interno, revenda, { ...interno }, importado])).toEqual([interno, revenda, importado]);
  });
  it("origemDoItem", () => {
    expect(origemDoItem(interno)).toBe("interno");
    expect(origemDoItem(revenda)).toBe("revenda");
    expect(origemDoItem({ modelo_id: "m" })).toBeNull();
  });
});

describe("rotuloVariante", () => {
  it("cor - cor apelido", () => {
    expect(rotuloVariante({ ...interno, cor_nome: "Azul", cor_apelido_nome: "Marinho" })).toBe("Azul - Marinho");
    expect(rotuloVariante({ ...revenda, cor_nome: "Azul" })).toBe("Azul");
  });
  it("cor removida vira 'cor removida'", () => {
    expect(rotuloVariante({ ...interno, cor_removida: true, cor_nome: "Azul" })).toBe("cor removida");
    expect(rotuloVariante({ ...interno })).toBe("cor removida");
  });
});
