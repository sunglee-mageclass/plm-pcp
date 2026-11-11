import { describe, expect, it } from "vitest";
import { artigoTecido1DoEmbed, chavesGrupoCatTecido, chavesGrupoTecido } from "@/lib/tecido-principal";

const cats = { tessa: "malha", fiore: "tecido-plano" };

describe("agrupamento por Tecido 1 principal", () => {
  it("pega só o Tecido 1 (tipo tecido, numero 1), ignorando substitutos/forro/outros números", () => {
    const rows = [
      { artigo_id: "fiore", numero: 2, tipo: "tecido" },
      { artigo_id: "forro1", numero: 1, tipo: "forro" },
      { artigo_id: "tessa", numero: 1, tipo: "tecido" },
    ];
    expect(artigoTecido1DoEmbed(rows)).toBe("tessa");
  });
  it("sem modelo_tecidos (comprado) = null", () => {
    expect(artigoTecido1DoEmbed(null)).toBeNull();
    expect(artigoTecido1DoEmbed([])).toBeNull();
    expect(artigoTecido1DoEmbed([{ artigo_id: null, numero: 1, tipo: "tecido" }])).toBeNull();
  });
  it("Tecido: peça com principal + substituto cai em UM grupo só (o do principal)", () => {
    expect(chavesGrupoTecido("tessa", false)).toEqual(["tessa"]);
  });
  it("Tecido: sem principal cai em Acessórios ou Sem tecido", () => {
    expect(chavesGrupoTecido(null, true)).toEqual(["__acessorios__"]);
    expect(chavesGrupoTecido(undefined, false)).toEqual(["__none__"]);
  });
  it("Categoria de tecido: usa a categoria do principal, nunca a do substituto", () => {
    expect(chavesGrupoCatTecido("tessa", cats, false)).toEqual(["malha"]);
  });
  it("Categoria de tecido: principal sem categoria ou sem principal cai no balde certo", () => {
    expect(chavesGrupoCatTecido("x", cats, false)).toEqual(["__none__"]);
    expect(chavesGrupoCatTecido(null, cats, true)).toEqual(["__acessorios__"]);
  });
});
