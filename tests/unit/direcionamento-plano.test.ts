import { describe, it, expect } from "vitest";
import { celulaPlano, preencherComPlano, tamanhosDoPlano, textoPendencia, totalPlanoVariante, type PlanoModelo } from "@/lib/direcionamento-plano";

const EC = "loja-ec", LF = "loja-lf", AT = "loja-at";
const T = ["38|P", "40|M", "42|G", "44|GG"];
const g = (p: number, m: number, gg: number, xg: number) => ({ "38|P": p, "40|M": m, "42|G": gg, "44|GG": xg });
// Plano do mockup (VESTIDO LONGO POEMA): 1 Marrom, 2 Preto, 3 Vinho (Atacado sem Vinho).
const PLANO: PlanoModelo = {
  tamanho_tipo: "letra", tamanhos: ["34|PPP", "36|PP", ...T],
  lojas: [EC, LF, AT].map((id, i) => ({ loja_id: id, nome: id, ativo: true, is_default: i === 0, ordem: i + 1 })),
  variantes: [1, 2, 3].map((n) => ({ variante_numero: n, variante_tecido_id: `vt${n}`, cor_nome: `cor${n}`, apelido_nome: null })),
  celulas: [
    { loja_id: EC, variante_numero: 1, grades: g(4, 10, 10, 5) }, { loja_id: LF, variante_numero: 1, grades: g(3, 6, 6, 3) }, { loja_id: AT, variante_numero: 1, grades: g(4, 8, 8, 4) },
    { loja_id: EC, variante_numero: 2, grades: g(6, 12, 12, 6) }, { loja_id: LF, variante_numero: 2, grades: g(4, 8, 8, 4) }, { loja_id: AT, variante_numero: 2, grades: g(5, 10, 10, 5) },
    { loja_id: EC, variante_numero: 3, grades: g(3, 6, 6, 3) }, { loja_id: LF, variante_numero: 3, grades: g(2, 4, 4, 2) },
  ],
  sem_correspondencia: [],
};
const REAL = [
  { variante_numero: 1, real: g(11, 23, 24, 12) },
  { variante_numero: 2, real: g(15, 30, 28, 15) },
  { variante_numero: 3, real: g(5, 10, 10, 5) },
];
const lojas = [{ id: EC }, { id: LF }, { id: AT }];
const soma = (linhas: Record<string, Record<string, number>>, t: string) => Object.values(linhas).reduce((s, x) => s + (x[t] ?? 0), 0);

describe("direcionamento-plano — regra do semi-preenchimento (R22, mockup)", () => {
  const r = preencherComPlano({ variantes: REAL, tamanhos: T, lojas, podeEditar: () => true, plano: PLANO });
  it("onde bate, cada loja recebe o plano; onde não bate, a coluna fica VAZIA em todas as lojas", () => {
    expect(r.linhas[1][EC]).toEqual({ "38|P": 4, "42|G": 10, "44|GG": 5 });   // M (real 23 × plano 24) vazio
    expect(r.linhas[2][LF]).toEqual({ "38|P": 4, "40|M": 8, "44|GG": 4 });    // G (real 28 × plano 30) vazio
    expect(r.linhas[3][AT]).toEqual(g(0, 0, 0, 0));                            // Atacado sem Vinho no plano → 0 (bateu)
  });
  it("pendências = Marrom M (23 × 24) e Preto G (28 × 30); Σ Direcionado 47/70 e 60/88", () => {
    expect(r.pendentes).toEqual([
      { variante_numero: 1, tamanho: "40|M", real: 23, plano: 24 },
      { variante_numero: 2, tamanho: "42|G", real: 28, plano: 30 },
    ]);
    expect(T.reduce((s, t) => s + soma(r.linhas[1], t), 0)).toBe(47);
    expect(T.reduce((s, t) => s + soma(r.linhas[2], t), 0)).toBe(60);
    expect(T.reduce((s, t) => s + soma(r.linhas[3], t), 0)).toBe(30);
  });
  it("doPlano = células escritas pelo plano (12 do Vinho inclui o 0 do Atacado); escritas (T7 fix2, I1) só as que DIFEREM da base — pendentes (vazias) e 0-sobre-0 do Atacado (sem essa cor, base já 0) ficam de fora", () => {
    expect(r.doPlano).toHaveLength(9 + 9 + 12);
    expect(r.doPlano).toContain("dir:1:loja-ec:38|P");
    expect(r.doPlano).not.toContain("dir:1:loja-ec:40|M");
    // Marrom (9) + Preto (9) + Vinho SEM o Atacado (8, pois AT=0=base não é "minha" edição) = 26.
    expect(r.escritas).toHaveLength(9 + 9 + 8);
    expect(r.escritas).not.toContain("dir:1:loja-ec:40|M"); // pendente: nunca escreve
    expect(r.escritas).not.toContain("dir:3:loja-at:38|P"); // Vinho no Atacado: plano 0 == base 0 → não é "minha"
    expect(r.escritas).toContain("dir:3:loja-ec:38|P");     // Vinho no E-commerce: plano 3 ≠ base 0 → "minha"
  });
  it("I1 (revisão T7 fix2): B salva as pendentes enquanto o rascunho semi-preenchido de A está intacto — A não deve ver conflito nelas", () => {
    // Simula o cenário completo da tela: `base` (servidor no momento da abertura) é vazio (sem `existing`),
    // então toda célula não-escrita por `escritas` (as pendentes, e o 0-sobre-0 do Atacado) NÃO entra no
    // `touched` — se o servidor (B) escrever ali depois, o merge 3-vias adota o valor de B sem conflito.
    const base: Record<number, Record<string, Record<string, number>>> = {};
    const rComBase = preencherComPlano({ variantes: REAL, tamanhos: T, lojas, podeEditar: () => true, plano: PLANO, base });
    const touched = new Set(rComBase.escritas);
    expect(touched.has("dir:1:loja-ec:40|M")).toBe(false); // Marrom M (pendente) não é "minha"
    expect(touched.has("dir:2:loja-lf:42|G")).toBe(false); // Preto G (pendente) não é "minha"
    // B salva 8/6/9 nas 3 lojas p/ Marrom M (fecha o 24) e 9/7/12 p/ Preto G (fecha o 30) — servidor "fresh".
    const fresh: Record<number, Record<string, Record<string, number>>> = {
      1: { [EC]: { "40|M": 9 }, [LF]: { "40|M": 6 }, [AT]: { "40|M": 9 } },
      2: { [EC]: { "42|G": 11 }, [LF]: { "42|G": 8 }, [AT]: { "42|G": 11 } },
    };
    // Reproduz o merge 3-vias (mesma regra de mergeGradeDir): célula não-tocada que mudou no servidor → adota o fresh.
    for (const [vnumStr, lojasFresh] of Object.entries(fresh)) {
      for (const [lojaId, porTam] of Object.entries(lojasFresh)) {
        for (const t of Object.keys(porTam)) {
          const path = `dir:${vnumStr}:${lojaId}:${t}`;
          expect(touched.has(path)).toBe(false); // condição para "sem conflito" no merge real (mergeGradeDir)
        }
      }
    }
  });
  it("loja NÃO editável (inativa sem par histórico) fica fora da conta e não recebe nada", () => {
    const x = preencherComPlano({ variantes: REAL, tamanhos: T, lojas, podeEditar: (id) => id !== AT, plano: PLANO });
    expect(x.linhas[3][AT]).toBeUndefined();
    expect(x.linhas[3][EC]).toEqual(g(3, 6, 6, 3));                           // Vinho: EC+LF = real → bate
    expect(x.pendentes.filter((p) => p.variante_numero === 1).map((p) => p.tamanho)).toEqual(T); // Marrom: sem o Atacado nada bate
  });
  it("sem plano não inventa nada", () => {
    const x = preencherComPlano({ variantes: [{ variante_numero: 1, real: g(1, 0, 0, 0) }], tamanhos: T, lojas, podeEditar: () => true, plano: null });
    expect(x.pendentes.map((p) => p.tamanho)).toEqual(["38|P"]);
    expect(x.linhas[1][EC]).toEqual({ "40|M": 0, "42|G": 0, "44|GG": 0 });
  });
});

describe("direcionamento-plano — leitura do plano", () => {
  it("celulaPlano: null = a loja não tem essa cor ('—')", () => {
    expect(celulaPlano(PLANO, AT, 3, "38|P")).toBeNull();
    expect(celulaPlano(PLANO, EC, 1, "40|M")).toBe(10);
  });
  it("totalPlanoVariante: Marrom 71 (P 11 · M 24 · G 24 · GG 12)", () => {
    expect(totalPlanoVariante(PLANO, 1)).toEqual({ porTamanho: g(11, 24, 24, 12), total: 71 });
  });
  it("tamanhosDoPlano: Grade Real ∪ tamanhos com plano > 0, na ordem da grade (R34)", () => {
    const p2: PlanoModelo = { ...PLANO, celulas: [...PLANO.celulas, { loja_id: EC, variante_numero: 1, grades: { "36|PP": 2 } }] };
    expect(tamanhosDoPlano(PLANO.tamanhos, T, p2)).toEqual(["36|PP", ...T]);
    expect(tamanhosDoPlano(PLANO.tamanhos, T, PLANO)).toEqual(T);
  });
  it("textoPendencia (mockup)", () => {
    expect(textoPendencia("M", { variante_numero: 1, tamanho: "40|M", real: 23, plano: 24 })).toBe(
      "M: plano 24 · real 23 → distribua à mão as 23 peças entre as lojas. Nenhuma loja veio preenchida porque não dá para saber de qual tirar.");
  });
});
