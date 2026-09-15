import { describe, it, expect } from "vitest";
import { mergeGradeGenerico, pathCelula, type GradeGenerica } from "@/lib/colab/merge-grade-generico";

// Campos da grade de OC Produto Acabado/Importado.
const CAMPOS = ["pedida", "recebida", "defeito"] as const;

// Helper: monta uma grade {vid:{tam:{campo:n}}}.
const g = (obj: GradeGenerica): GradeGenerica => obj;

describe("mergeGradeGenerico", () => {
  it("célula não tocada + mudou no servidor → adota o fresh", () => {
    const base = g({ "0": { P: { pedida: 10, recebida: 0, defeito: 0 } } });
    const meu = g({ "0": { P: { pedida: 10, recebida: 0, defeito: 0 } } });
    const fresh = g({ "0": { P: { pedida: 10, recebida: 8, defeito: 1 } } });
    const r = mergeGradeGenerico({ base, meu, fresh, tocadas: new Set(), campos: CAMPOS });
    expect(r.conflitos).toEqual([]);
    expect(r.valor["0"]["P"].recebida).toBe(8);
    expect(r.valor["0"]["P"].defeito).toBe(1);
    // pedida não mudou no servidor → segue igual
    expect(r.valor["0"]["P"].pedida).toBe(10);
    expect(r.atualizados).toContain(pathCelula("0", "P", "recebida"));
    expect(r.atualizados).toContain(pathCelula("0", "P", "defeito"));
  });

  it("célula tocada + mudou no servidor + diverge → conflito (mantém o meu)", () => {
    const base = g({ "0": { P: { pedida: 10, recebida: 0, defeito: 0 } } });
    const meu = g({ "0": { P: { pedida: 10, recebida: 5, defeito: 0 } } }); // eu botei 5
    const fresh = g({ "0": { P: { pedida: 10, recebida: 8, defeito: 0 } } }); // servidor botou 8
    const tocadas = new Set([pathCelula("0", "P", "recebida")]);
    const r = mergeGradeGenerico({ base, meu, fresh, tocadas, campos: CAMPOS });
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0]).toMatchObject({ path: pathCelula("0", "P", "recebida"), meu: 5, dele: 8 });
    // mantém o MEU no valor
    expect(r.valor["0"]["P"].recebida).toBe(5);
  });

  it("célula tocada MAS não mudou no servidor → sem conflito, mantém o meu", () => {
    const base = g({ "0": { P: { pedida: 10, recebida: 0, defeito: 0 } } });
    const meu = g({ "0": { P: { pedida: 10, recebida: 7, defeito: 0 } } });
    const fresh = g({ "0": { P: { pedida: 10, recebida: 0, defeito: 0 } } }); // servidor não tocou recebida
    const tocadas = new Set([pathCelula("0", "P", "recebida")]);
    const r = mergeGradeGenerico({ base, meu, fresh, tocadas, campos: CAMPOS });
    expect(r.conflitos).toEqual([]);
    expect(r.valor["0"]["P"].recebida).toBe(7);
  });

  it("célula tocada + servidor foi pro MESMO valor que eu → NÃO é conflito (convergência)", () => {
    const base = g({ "0": { P: { pedida: 10, recebida: 0, defeito: 0 } } });
    const meu = g({ "0": { P: { pedida: 10, recebida: 8, defeito: 0 } } });
    const fresh = g({ "0": { P: { pedida: 10, recebida: 8, defeito: 0 } } });
    const tocadas = new Set([pathCelula("0", "P", "recebida")]);
    const r = mergeGradeGenerico({ base, meu, fresh, tocadas, campos: CAMPOS });
    expect(r.conflitos).toEqual([]);
    expect(r.valor["0"]["P"].recebida).toBe(8);
  });

  it("null/ausente ≡ 0 (não falso conflito nem falsa atualização)", () => {
    const base = g({ "0": { P: {} } });
    const meu = g({ "0": { P: {} } });
    const fresh = g({ "0": { P: { pedida: 0, recebida: 0, defeito: 0 } } }); // tudo zero explícito
    const r = mergeGradeGenerico({ base, meu, fresh, tocadas: new Set(), campos: CAMPOS });
    expect(r.conflitos).toEqual([]);
    expect(r.atualizados).toEqual([]); // 0≡ausente, nada mudou de fato
  });

  it("varre a UNIÃO de vids e tams (célula nova no servidor entra)", () => {
    const base = g({ "0": { P: { pedida: 5 } } });
    const meu = g({ "0": { P: { pedida: 5 } } });
    // servidor adicionou variante "1" e tamanho "M" na "0"
    const fresh = g({ "0": { P: { pedida: 5 }, M: { pedida: 3 } }, "1": { P: { pedida: 7 } } });
    const r = mergeGradeGenerico({ base, meu, fresh, tocadas: new Set(), campos: CAMPOS });
    expect(r.conflitos).toEqual([]);
    expect(r.valor["0"]["M"].pedida).toBe(3);
    expect(r.valor["1"]["P"].pedida).toBe(7);
  });

  it("os 3 campos são independentes: conflito em recebida não afeta defeito adotado do fresh", () => {
    const base = g({ "0": { P: { pedida: 10, recebida: 0, defeito: 0 } } });
    const meu = g({ "0": { P: { pedida: 10, recebida: 5, defeito: 0 } } }); // toquei recebida
    const fresh = g({ "0": { P: { pedida: 10, recebida: 8, defeito: 2 } } }); // servidor mudou recebida E defeito
    const tocadas = new Set([pathCelula("0", "P", "recebida")]); // só recebida tocada
    const r = mergeGradeGenerico({ base, meu, fresh, tocadas, campos: CAMPOS });
    // recebida = conflito (mantém 5); defeito não tocado = adota fresh (2)
    expect(r.conflitos).toHaveLength(1);
    expect(r.conflitos[0].path).toBe(pathCelula("0", "P", "recebida"));
    expect(r.valor["0"]["P"].recebida).toBe(5);
    expect(r.valor["0"]["P"].defeito).toBe(2);
  });

  it("não muta as entradas (meu/fresh preservados)", () => {
    const base = g({ "0": { P: { pedida: 10, recebida: 0, defeito: 0 } } });
    const meu = g({ "0": { P: { pedida: 10, recebida: 0, defeito: 0 } } });
    const fresh = g({ "0": { P: { pedida: 10, recebida: 8, defeito: 0 } } });
    const meuSnapshot = JSON.stringify(meu);
    const freshSnapshot = JSON.stringify(fresh);
    mergeGradeGenerico({ base, meu, fresh, tocadas: new Set(), campos: CAMPOS });
    expect(JSON.stringify(meu)).toBe(meuSnapshot);
    expect(JSON.stringify(fresh)).toBe(freshSnapshot);
  });
});
