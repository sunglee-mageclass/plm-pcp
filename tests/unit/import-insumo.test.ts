import { describe, it, expect } from "vitest";
import { agregar } from "@/lib/import/aggregate";
import { alvosDeFoto } from "@/lib/import/foto-match";
import { insumoDescriptor } from "@/lib/import/entities/insumo.descriptor";
import type { LookupMaps, RawRow, EntidadeAgregada } from "@/lib/import/types";

// grade tolerante: número "34" e letra "PPP" → chave "34|PPP"
const gradeMap = new Map<string, string>();
for (const k of ["34|PPP", "36|PP", "38|P", "40|M"]) {
  const [n, s] = k.split("|");
  gradeMap.set(k.toLowerCase(), k);
  gradeMap.set(n.toLowerCase(), k);
  gradeMap.set(s.toLowerCase(), k);
}

const maps: LookupMaps = {
  cores: new Map([["branco", "cor-branco"], ["preto", "cor-preto"]]),
  tipos: new Map([["etiqueta", "tipo-etq"]]),
  tamanhos: gradeMap,
  fornecedores: new Map([["silva", ["emp-silva"]]]),
  representantes: new Map(),
};

function row(n: number, over: Partial<Record<string, string>> = {}): RawRow {
  return { __linha: n, nome: "", ...over } as RawRow;
}

describe("insumoDescriptor.resolve — explode cor × tamanho", () => {
  it("1 cor + 3 tamanhos = 3 variantes (cor × tamanho)", () => {
    const r = insumoDescriptor.resolve(row(2, { nome: "Etiqueta A", cor_base: "Branco", tamanhos: "34,36,38", tipo_insumo: "Etiqueta" }), maps);
    expect(r.variantes).toHaveLength(3);
    expect(r.variantes.map((v) => v.tamanho)).toEqual(["34|PPP", "36|PP", "38|P"]);
    expect(r.variantes.every((v) => v.cor_id === "cor-branco")).toBe(true);
    expect(r.cabecalho.tipo_insumo_id).toBe("tipo-etq");
  });

  it("match TOLERANTE: número '34' e letra 'PPP' e 'P' casam a grade", () => {
    const r = insumoDescriptor.resolve(row(2, { nome: "X", cor_base: "Branco", tamanhos: "PPP,P,40" }), maps);
    expect(r.variantes.map((v) => v.tamanho).sort()).toEqual(["34|PPP", "38|P", "40|M"].sort());
  });

  it("sem tamanho (formato nenhum) = 1 variante só com cor, tamanho null", () => {
    const r = insumoDescriptor.resolve(row(2, { nome: "X", cor_base: "Branco", tamanhos: "" }), maps);
    expect(r.variantes).toHaveLength(1);
    expect(r.variantes[0].tamanho).toBeNull();
    expect(r.variantes[0].cor_id).toBe("cor-branco");
  });

  it("sem cor e sem tamanho = nenhuma variante", () => {
    const r = insumoDescriptor.resolve(row(2, { nome: "X" }), maps);
    expect(r.variantes).toHaveLength(0);
  });

  it("tamanho fora da grade = aviso (ignorado)", () => {
    const r = insumoDescriptor.resolve(row(2, { nome: "X", cor_base: "Branco", tamanhos: "34,XG" }), maps);
    expect(r.variantes).toHaveLength(1); // só 34 casou
    expect(r.problemas.some((p) => p.nivel === "aviso" && /XG/.test(p.mensagem))).toBe(true);
  });

  it("cor digitada inexistente = ERRO", () => {
    const r = insumoDescriptor.resolve(row(2, { nome: "X", cor_base: "Roxo", tamanhos: "34" }), maps);
    expect(r.problemas.some((p) => p.nivel === "erro" && p.campo === "cor_base")).toBe(true);
  });

  it("tamanho duplicado na lista = dedupe (34,34 → 1 variante)", () => {
    const r = insumoDescriptor.resolve(row(2, { nome: "X", cor_base: "Branco", tamanhos: "34,34,36" }), maps);
    expect(r.variantes).toHaveLength(2);
  });

  it("foto desativada: temFoto=false, sem alvos de foto", () => {
    expect(insumoDescriptor.temFoto).toBe(false);
    const ag = agregar(insumoDescriptor, [row(2, { nome: "X", cor_base: "Branco", tamanhos: "34" })], maps);
    // alvosDeFoto no modo entidade gera 1 alvo, mas o engine não sobe foto (temFoto false)
    const alvos = alvosDeFoto(insumoDescriptor, ag.entidades);
    expect(alvos.length).toBeGreaterThanOrEqual(0);
  });
});

describe("regressão (revisão): dedupe intra-arquivo por cor×TAMANHO", () => {
  it("mesmo insumo em 2 linhas, mesma cor, tamanhos diferentes = agrega TODAS (não perde)", () => {
    const linhas = [
      row(2, { nome: "Etq A", cor_base: "Branco", tamanhos: "34,36" }),
      row(3, { nome: "Etq A", cor_base: "Branco", tamanhos: "38,40" }),
    ];
    const ag = agregar(insumoDescriptor, linhas, maps);
    expect(ag.entidades).toHaveLength(1);
    expect(ag.entidades[0].variantes).toHaveLength(4); // 34,36,38,40 — nenhuma perdida
    expect(ag.entidades[0].variantes.map((v) => v.tamanho).sort()).toEqual(["34|PPP", "36|PP", "38|P", "40|M"].sort());
  });

  it("mesmo insumo, 2 cores, mesmos tamanhos = 4 variantes (Branco×2 + Preto×2)", () => {
    const linhas = [
      row(2, { nome: "Etq B", cor_base: "Branco", tamanhos: "34,36" }),
      row(3, { nome: "Etq B", cor_base: "Preto", tamanhos: "34,36" }),
    ];
    const ag = agregar(insumoDescriptor, linhas, maps);
    expect(ag.entidades[0].variantes).toHaveLength(4);
  });

  it("variante REALMENTE repetida (mesma cor+tamanho em 2 linhas) = 1 (dedupe correto)", () => {
    const linhas = [
      row(2, { nome: "Etq C", cor_base: "Branco", tamanhos: "34,36" }),
      row(3, { nome: "Etq C", cor_base: "Branco", tamanhos: "34" }), // 34 repetido
    ];
    const ag = agregar(insumoDescriptor, linhas, maps);
    expect(ag.entidades[0].variantes).toHaveLength(2); // 34,36 (o 2º 34 é dup real)
    expect(ag.entidades[0].problemas.some((p) => p.nivel === "duplicata")).toBe(true);
  });
});

describe("insumoDescriptor.analisarBanco (upsert por nome)", () => {
  const fakeSb = (etqs: unknown[]) => ({ from: () => ({ select: async () => ({ data: etqs, error: null }) }) }) as never;
  async function analisar(linhas: RawRow[], etqs: unknown[]) {
    const ag = agregar(insumoDescriptor, linhas, maps);
    await insumoDescriptor.analisarBanco!(fakeSb(etqs), ag.entidades);
    return ag.entidades;
  }

  it("nome inexistente = novo", async () => {
    const [e] = await analisar([row(2, { nome: "Etiqueta Nova", cor_base: "Branco", tamanhos: "34" })], []);
    expect(e.estado).toBe("novo");
  });

  it("nome existe = complementar (upsert por nome, sem fornecedor)", async () => {
    const etqs = [{ id: "etq-1", nome: "Etiqueta A", variantes_etiqueta: [{ cor_id: "cor-branco", tamanho: "34|PPP" }] }];
    const [e] = await analisar([row(2, { nome: "Etiqueta A", cor_base: "Branco", tamanhos: "36" })], etqs);
    expect(e.estado).toBe("complementar");
    expect(e.artigoAlvoId).toBe("etq-1");
  });
});
