import { describe, it, expect } from "vitest";
import { artigosTec1DoGrupo, rotuloGrupoTecido } from "@/lib/plan-tecido/calc";

const slot = (artigo_id: string | null, extras: string[] = []) => ({
  materiais: [{ tipo: "tecido", numero: 1, artigo_id, artigo_ids_extra: extras, variantes: [], consumo: 1, loss_percent: 0, ordem: 0 }],
});

describe("F1 B2: resumo inclui tecido substituto", () => {
  it("coleta artigo principal E substitutos (artigo_ids_extra), sem duplicar", () => {
    const itens = [{ slot: slot("A", ["SUB1"]) }, { slot: slot("A", ["SUB1"]) }, { slot: slot("B") }];
    expect(artigosTec1DoGrupo(itens as never).sort()).toEqual(["A", "B", "SUB1"]);
  });
  it("sem substituto, comporta-se como antes (so o principal)", () => {
    expect(artigosTec1DoGrupo([{ slot: slot("A") }] as never)).toEqual(["A"]);
  });
  it("substituto e alternativa: o mesmo artigo extra em varios cards entra UMA vez (nao dobra linhas de cobertura)", () => {
    const itens = [{ slot: slot("A", ["S"]) }, { slot: slot("A", ["S"]) }, { slot: slot("A", ["S", "S2"]) }];
    const ids = artigosTec1DoGrupo(itens as never);
    expect(ids.filter((i) => i === "S")).toHaveLength(1);
    expect(ids.sort()).toEqual(["A", "S", "S2"]);
  });
  it("slot sem tecido/artigo nao contribui (nem extras orfaos)", () => {
    expect(artigosTec1DoGrupo([{ slot: slot(null, ["X"]) }] as never)).toEqual([]);
  });
  it("rotulo do grupo: nome + fornecedor, ou so o nome", () => {
    expect(rotuloGrupoTecido("Linho", "Forn X")).toBe("Linho · Forn X");
    expect(rotuloGrupoTecido("Linho", null)).toBe("Linho");
  });
});
