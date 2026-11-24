// PR-GRADE-2 — regras PURAS da edição da grade da revenda na Lista (lib/produto-grade/grade-revenda.ts): trava, células, estado COMPLETO, CAS e conflito.
import { describe, it, expect, vi } from "vitest";
import {
  aplicarMudancas,
  celulasDaGrade,
  chaveCelula,
  gradeEditavelNaLista,
  motivoGradeRevendaSomenteLeitura,
  MOTIVO_ENVIADO_EXPLOSAO,
  MOTIVO_SEM_PERMISSAO_GRADE,
  qtdValida,
  salvarGradeRevenda,
  secaoGradeDaOrigem,
  separarChave,
  TEXTO_CONFLITO_GRADE,
} from "@/lib/produto-grade/grade-revenda";
import { ehConflitoRev } from "@/lib/produto-grade/salvar";

const pode =
  (...chaves: string[]) =>
  (c: string) =>
    chaves.includes(c);

describe("seção do Sheet por origem (o botão 'abrir no Sheet na seção da grade')", () => {
  it("interno = grade; revenda e importado = grade_revenda (a mesma regra do PlanejamentoDetail)", () => {
    expect(secaoGradeDaOrigem("interno")).toBe("grade");
    expect(secaoGradeDaOrigem(null)).toBe("grade");
    expect(secaoGradeDaOrigem(undefined)).toBe("grade");
    expect(secaoGradeDaOrigem("revenda")).toBe("grade_revenda");
    expect(secaoGradeDaOrigem("importado")).toBe("grade_revenda");
  });
  it("SÓ a revenda edita na lista (interno/importado gravam pelo BOM)", () => {
    expect(gradeEditavelNaLista("revenda")).toBe(true);
    expect(gradeEditavelNaLista("interno")).toBe(false);
    expect(gradeEditavelNaLista(null)).toBe(false);
    expect(gradeEditavelNaLista("importado")).toBe(false);
  });
});

describe("motivoGradeRevendaSomenteLeitura", () => {
  const base = { readOnly: false, enviadoCad: false };
  it("edita (null) com a permissão do Planejamento OU do Desenvolvimento (card não enviado)", () => {
    expect(
      motivoGradeRevendaSomenteLeitura({ ...base, canEdit: pode("criacao_planejamento") }),
    ).toBeNull();
    expect(
      motivoGradeRevendaSomenteLeitura({ ...base, canEdit: pode("criacao_desenvolvimento") }),
    ).toBeNull();
  });
  it("sem nenhuma das duas = sem permissão", () => {
    expect(motivoGradeRevendaSomenteLeitura({ ...base, canEdit: pode() })).toBe(
      MOTIVO_SEM_PERMISSAO_GRADE,
    );
  });
  it("enviada à Explosão trava mesmo com permissão (mais estrito que o Sheet)", () => {
    expect(
      motivoGradeRevendaSomenteLeitura({
        readOnly: false,
        enviadoCad: true,
        canEdit: pode("criacao_planejamento", "criacao_desenvolvimento"),
      }),
    ).toBe(MOTIVO_ENVIADO_EXPLOSAO);
  });
  it("tela só-leitura vence tudo", () => {
    expect(
      motivoGradeRevendaSomenteLeitura({
        readOnly: true,
        enviadoCad: true,
        canEdit: pode("criacao_planejamento"),
      }),
    ).toBe("Você não tem permissão para editar.");
  });
});

describe("células do rascunho", () => {
  it("a chave sobrevive a tamanhos com '|' e a números", () => {
    const k = chaveCelula(3, "36|PP");
    expect(separarChave(k)).toEqual({ num: 3, tam: "36|PP" });
    expect(separarChave(chaveCelula(12, "M"))).toEqual({ num: 12, tam: "M" });
  });
  it("a base é cores × tamanhos com 0 explícito", () => {
    expect(celulasDaGrade({ 1: { PP: 4 } }, [1, 2], ["PP", "P"])).toEqual({
      "1::PP": 4,
      "1::P": 0,
      "2::PP": 0,
      "2::P": 0,
    });
  });
  it("quantidade → inteiro ≥ 0", () => {
    expect(qtdValida(-3)).toBe(0);
    expect(qtdValida("7")).toBe(7);
    expect(qtdValida(2.9)).toBe(2);
    expect(qtdValida("abc")).toBe(0);
    expect(qtdValida(null)).toBe(0);
  });
  it("estado COMPLETO = servidor + células editadas (linha órfã e células não editadas ficam)", () => {
    const servidor = [
      { variante_numero: 1, grades: { PP: 6 }, grade_total: 6 },
      { variante_numero: 9, grades: { PP: 3 }, grade_total: 3 },
    ];
    expect(aplicarMudancas(servidor, { "1::P": 4, "2::PP": 1 })).toEqual({
      1: { PP: 6, P: 4 },
      2: { PP: 1 },
      9: { PP: 3 },
    });
  });
});

describe("salvarGradeRevenda", () => {
  const servidor = [{ variante_numero: 1, grades: { PP: 6 }, grade_total: 6 }];
  const conferida = { 1: { PP: 6 } };
  const monta = (o: Partial<Parameters<typeof salvarGradeRevenda>[0]> = {}) => ({
    modeloId: "M1",
    revBase: 5 as number | null,
    conferida,
    mudancas: { "1::P": 4 },
    lerServidor: vi.fn(async () => servidor),
    rpc: vi.fn(async () => ({ error: null })),
    ...o,
  });

  it("grava pela RPC da revenda com o estado completo e o rev de base", async () => {
    const i = monta();
    const r = await salvarGradeRevenda(i);
    expect(i.lerServidor).toHaveBeenCalledWith("M1", 5);
    expect(i.rpc).toHaveBeenCalledWith("salvar_grade_revenda", {
      _modelo_id: "M1",
      _grades: [{ variante_numero: 1, grades: { PP: 6, P: 4 }, grade_total: 10 }],
      _rev_base: 5,
    });
    expect(r).toEqual({ 1: { PP: 6, P: 4 } });
  });
  it("sem rev de base = conflito (nada lido, nada gravado)", async () => {
    const i = monta({ revBase: null });
    await expect(salvarGradeRevenda(i)).rejects.toSatisfy(ehConflitoRev);
    expect(i.lerServidor).not.toHaveBeenCalled();
    expect(i.rpc).not.toHaveBeenCalled();
  });
  it("o servidor já não é a grade que a pessoa viu = conflito P0409, NADA grava", async () => {
    const i = monta({
      lerServidor: vi.fn(async () => [{ variante_numero: 1, grades: { PP: 7 }, grade_total: 7 }]),
    });
    const e = await salvarGradeRevenda(i).catch((x) => x);
    expect(ehConflitoRev(e)).toBe(true);
    expect(e.message).toBe(TEXTO_CONFLITO_GRADE);
    expect(i.rpc).not.toHaveBeenCalled();
  });
  it("célula zerada no servidor não conta como mudança (a RPC não grava linha sem valor)", async () => {
    const i = monta({
      lerServidor: vi.fn(async () => [
        { variante_numero: 1, grades: { PP: 6, P: 0 }, grade_total: 6 },
      ]),
    });
    await expect(salvarGradeRevenda(i)).resolves.toBeTruthy();
  });
  it("rev lido ≠ rev de base (P0409 do `lerGradeServidorComprado`) propaga e NADA grava", async () => {
    const p0409 = Object.assign(new Error("conflito_versao"), { code: "P0409" });
    const i = monta({
      lerServidor: vi.fn(async () => {
        throw p0409;
      }),
    });
    await expect(salvarGradeRevenda(i)).rejects.toBe(p0409);
    expect(i.rpc).not.toHaveBeenCalled();
  });
  it("erro da RPC sobe como está (o chamador traduz)", async () => {
    const err = { code: "42501", message: "x" };
    const i = monta({ rpc: vi.fn(async () => ({ error: err })) });
    await expect(salvarGradeRevenda(i)).rejects.toBe(err);
  });
});
