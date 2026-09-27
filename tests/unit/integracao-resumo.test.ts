import { describe, it, expect } from "vitest";
import { brl } from "@/lib/format";
import { TEXTO_PRECISA_CUSTO } from "@/lib/integracao/produtos";
import { celulaResumo, itensMarcar, lerResumo, listaNomes, textoDesfazer, textoVoltar } from "@/lib/integracao/resumo";

const ASS = "a".repeat(64);
const prod = (o: Record<string, unknown>) => ({ modelo_id: "m1", nome: "Blusa Brisa", ref: "BLBR0087", origem: "interno",
  estado: "nao_integravel", reprovado: false, completo: true, faltas: [], assinatura: ASS,
  retrato: { v: 1, campos: ["nome", "preco_venda", "foto"], linhas: [
    { tipo: "produto", ordem: 0, valores: { nome: "Blusa Brisa", preco_venda: "159.90" }, fotos: ["t/f/a.jpg", "t/f/b.jpg", "t/f/c.jpg"] },
    { tipo: "variante", ordem: 1, valores: { nome: "Blusa Brisa P", preco_venda: "159.90" }, fotos: [] },
    { tipo: "variante", ordem: 2, valores: { nome: "Blusa Brisa M", preco_venda: "159.90" }, fotos: [] }] }, ...o });

describe("resumo do Integrar (integracao_previa — sempre o dado SALVO)", () => {
  it("entram os completos não integráveis; sublinhas contadas; itens = assinaturas do resumo", () => {
    const r = lerResumo({ campos: ["foto", "nome", "preco_venda"], precisa_ver_custos: false, pode_ver_custos: true,
      produtos: [prod({}), prod({ modelo_id: "m2", nome: "Macacão", completo: false, faltas: [{ campo: "peso", texto: "Peso" }] })] });
    expect(r.campos).toEqual(["nome", "preco_venda", "foto"]);
    expect(r.entram.map((p) => p.modeloId)).toEqual(["m1"]);
    expect(r.sublinhas).toBe(2);
    // Fix round 1 T13 (revisão T13 #7, code-review m7): `fora` ganhou `modeloId`/`ref` (a UI usa `modeloId` como key
    // do React — nunca `nome`, que colide entre 2 produtos de mesmo nome — e mostra a REF ao lado do nome).
    expect(r.fora).toEqual([{ modeloId: "m2", nome: "Macacão", ref: "BLBR0087", motivo: "Faltam: Peso" }]);
    expect(r.bloqueio).toBeNull();
    expect(itensMarcar(r)).toEqual([{ modelo_id: "m1", assinatura: ASS }]);
  });
  it("Preço de custo marcado e sem ver custos = bloqueio (P-75 A); ninguém entra = bloqueio", () => {
    expect(lerResumo({ campos: ["preco_custo"], precisa_ver_custos: true, pode_ver_custos: false, produtos: [prod({})] }).bloqueio)
      .toBe(TEXTO_PRECISA_CUSTO);
    expect(lerResumo({ campos: ["nome"], produtos: [prod({ estado: "integravel" })] }).bloqueio).toBe("Nenhum produto selecionado pode ser integrado.");
    expect(lerResumo({ campos: ["nome"], produtos: [prod({ reprovado: true })] }).fora[0].motivo).toBe("Produto reprovado.");
  });
  it("células do resumo", () => {
    const r = lerResumo({ campos: ["nome", "preco_venda", "foto"], produtos: [prod({})] });
    const [pl, vl] = r.entram[0].linhas;
    expect(celulaResumo("preco_venda", pl, true)).toBe(brl(159.9));
    expect(celulaResumo("foto", pl, true)).toBe("3 fotos");
    expect(celulaResumo("foto", vl, false)).toBe("—");
  });
  it("textos de Voltar e Desfazer (mockup 3b e 5)", () => {
    expect(listaNomes(["A", "B", "C"])).toBe("A, B e C");
    expect(textoVoltar(["Calça Duna"])).toBe("Calça Duna volta para Não integrável e é destravado. Fica registrado no Log. Só é possível porque a API ainda não levou este produto.");
    expect(textoVoltar(["A", "B"])).toBe("A e B voltam para Não integrável e são destravados. Fica registrado no Log. Só é possível porque a API ainda não levou estes produtos.");
    expect(textoDesfazer("Saia Marola", "SAMA0019")).toBe("Saia Marola (SAMA0019) volta para Não integrável. Os campos travados são destravados. Esta ação é registrada no Log.");
  });
});
