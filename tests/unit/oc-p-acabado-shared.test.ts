import { describe, it, expect } from "vitest";
import {
  redistribuirPedida,
  redistribuirVariantesPorPeso,
  somaGrade,
  contarParcelasPrazo,
  TAM_ACESSORIO,
  type GradeDetalhe,
  type VarianteDraft,
} from "@/components/oc-p-acabado/shared";

// Task 5 fix round 1 (review, CRITICAL): "Redistribuir por peso" fazia replace RASO por
// variante — só emitia as chaves do split ATUAL, então qualquer célula fora da proporção
// (pedida digitada manual, e pior: recebida/defeito já registrados no recebimento) era
// descartada em silêncio. O fix é merge por CÉLULA: só a `pedida` das size-keys ATIVAS é
// recalculada; tudo o mais (outros tamanhos + recebida/defeito de QUALQUER tamanho) sobrevive.

const v1: VarianteDraft = { ordem: 1, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 10 };
const proporcaoAtiva = { "34|PPP": 1, "36|PP": 1 };

describe("redistribuirPedida — merge por célula (fix CRITICAL round 1)", () => {
  it("célula fora da proporção (44|GG) com pedida digitada manual sobrevive intocada ao redistribuir", () => {
    const gradeAntes: GradeDetalhe = {
      "1": { "44|GG": { pedida: 3, recebida: 0, defeito: 0 } },
    };
    const depois = redistribuirPedida([v1], gradeAntes, proporcaoAtiva, false);
    expect(depois["1"]["44|GG"]).toEqual({ pedida: 3, recebida: 0, defeito: 0 });
  });

  it("recebida/defeito sobrevivem tanto em célula DENTRO do split (só a pedida recalcula) quanto FORA dele", () => {
    const gradeAntes: GradeDetalhe = {
      "1": {
        "34|PPP": { pedida: 0, recebida: 5, defeito: 1 }, // dentro do split — pedida vai mudar, resto não
        "44|GG": { pedida: 0, recebida: 2, defeito: 1 }, // fora do split — nada muda
      },
    };
    const depois = redistribuirPedida([v1], gradeAntes, proporcaoAtiva, false);
    // pedida recalculada (10 dividido 1:1 entre 34|PPP e 36|PP → 5/5), recebida/defeito preservados
    expect(depois["1"]["34|PPP"]).toEqual({ pedida: 5, recebida: 5, defeito: 1 });
    // célula fora do split: totalmente intocada
    expect(depois["1"]["44|GG"]).toEqual({ pedida: 0, recebida: 2, defeito: 1 });
  });

  it("cria célula nova (recebida/defeito = 0) pra size-key ativa que ainda não existia na grade", () => {
    const depois = redistribuirPedida([v1], {}, proporcaoAtiva, false);
    expect(depois["1"]["34|PPP"]).toEqual({ pedida: 5, recebida: 0, defeito: 0 });
    expect(depois["1"]["36|PP"]).toEqual({ pedida: 5, recebida: 0, defeito: 0 });
  });

  it("Σ pedida das size-keys ATIVAS da proporção = qtd_total da variante", () => {
    const depois = redistribuirPedida([v1], {}, proporcaoAtiva, false);
    const soma = somaGrade(depois, Object.keys(proporcaoAtiva), "pedida");
    expect(soma).toBe(v1.qtd);
  });

  it("múltiplas variantes: cada uma mescla só a própria linha, sem vazar pra linha da outra", () => {
    const v2: VarianteDraft = { ordem: 2, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 8 };
    const gradeAntes: GradeDetalhe = {
      "1": { "44|GG": { pedida: 1, recebida: 0, defeito: 0 } },
      "2": { "44|GG": { pedida: 2, recebida: 0, defeito: 0 } },
    };
    const depois = redistribuirPedida([v1, v2], gradeAntes, proporcaoAtiva, false);
    expect(depois["1"]["44|GG"]).toEqual({ pedida: 1, recebida: 0, defeito: 0 });
    expect(depois["2"]["44|GG"]).toEqual({ pedida: 2, recebida: 0, defeito: 0 });
    expect(somaGrade(depois, Object.keys(proporcaoAtiva), "pedida")).toBe(v1.qtd + v2.qtd);
  });

  it("outra(s) variante(s) ausente(s) da lista passada ficam intocadas (grade preservada por completo)", () => {
    const gradeAntes: GradeDetalhe = {
      "1": { "34|PPP": { pedida: 0, recebida: 0, defeito: 0 } },
      "9": { "34|PPP": { pedida: 7, recebida: 3, defeito: 0 } }, // variante que não está em `variantes`
    };
    const depois = redistribuirPedida([v1], gradeAntes, proporcaoAtiva, false);
    expect(depois["9"]).toEqual({ "34|PPP": { pedida: 7, recebida: 3, defeito: 0 } });
  });

  it("acessório (grade única 'UN'): mesma regra de merge — recebida/defeito preservados, pedida = qtd inteira", () => {
    const gradeAntes: GradeDetalhe = {
      "1": { [TAM_ACESSORIO]: { pedida: 0, recebida: 4, defeito: 1 } },
    };
    const depois = redistribuirPedida([v1], gradeAntes, {}, true);
    expect(depois["1"][TAM_ACESSORIO]).toEqual({ pedida: 10, recebida: 4, defeito: 1 });
  });

  it("não muta o objeto `grade` recebido (imutabilidade — React precisa de referência nova)", () => {
    const gradeAntes: GradeDetalhe = { "1": { "34|PPP": { pedida: 0, recebida: 5, defeito: 0 } } };
    const congelado = JSON.parse(JSON.stringify(gradeAntes));
    redistribuirPedida([v1], gradeAntes, proporcaoAtiva, false);
    expect(gradeAntes).toEqual(congelado);
  });
});

describe("redistribuirVariantesPorPeso — split de qtd_total entre variantes por peso", () => {
  it("distribui qtd_total pelo peso de cada variante (maior resto), preservando cor_id/cor_apelido_id/ordem", () => {
    const variantes: VarianteDraft[] = [
      { ordem: 1, cor_id: "c1", cor_apelido_id: "a1", peso: 3, qtd: 0 },
      { ordem: 2, cor_id: "c2", cor_apelido_id: null, peso: 1, qtd: 0 },
    ];
    const out = redistribuirVariantesPorPeso(variantes, 8);
    expect(out.find((v) => v.ordem === 1)).toEqual({ ordem: 1, cor_id: "c1", cor_apelido_id: "a1", peso: 3, qtd: 6 });
    expect(out.find((v) => v.ordem === 2)).toEqual({ ordem: 2, cor_id: "c2", cor_apelido_id: null, peso: 1, qtd: 2 });
    expect(out.reduce((s, v) => s + v.qtd, 0)).toBe(8);
  });
});

describe("somaGrade", () => {
  it("soma só as chaves de tamanho pedidas, ignorando outras presentes na grade", () => {
    const grade: GradeDetalhe = {
      "1": {
        "34|PPP": { pedida: 5, recebida: 0, defeito: 0 },
        "44|GG": { pedida: 100, recebida: 0, defeito: 0 }, // fora do filtro — não deve entrar na soma
      },
    };
    expect(somaGrade(grade, ["34|PPP"], "pedida")).toBe(5);
  });
});

// Refino onda 2, item 2: contagem de parcelas a pagar DERIVADA do prazo digitado —
// espelha o parser do trigger `gerar_parcelas_oc_p_acabado` (banco): só "/" separa,
// tokens não-numéricos são descartados, sem token válido cai em 1 (fallback array[30]
// do trigger), capado em 24 (least(array_length,24)).
describe("contarParcelasPrazo — espelha o parser do trigger gerar_parcelas_oc_p_acabado", () => {
  it("'30/60/90' → 3 (exemplo do dono)", () => {
    expect(contarParcelasPrazo("30/60/90")).toBe(3);
  });

  it("'30' (sem barra) → 1", () => {
    expect(contarParcelasPrazo("30")).toBe(1);
  });

  it("vazio → 1 (mesmo fallback array[30] do trigger)", () => {
    expect(contarParcelasPrazo("")).toBe(1);
  });

  it("só separador sem números ('/') → 1 (nenhum token válido)", () => {
    expect(contarParcelasPrazo("/")).toBe(1);
  });

  it("vírgula NÃO é separador aqui (diferente da OC Tecido) — '30,60' vira 1 token não-numérico → 1", () => {
    expect(contarParcelasPrazo("30,60")).toBe(1);
  });

  it("token não-numérico misturado é descartado, mas os numéricos contam", () => {
    expect(contarParcelasPrazo("30/abc/90")).toBe(2);
  });

  it("mais de 24 tokens é capado em 24", () => {
    const prazo = Array.from({ length: 30 }, (_, i) => String((i + 1) * 10)).join("/");
    expect(contarParcelasPrazo(prazo)).toBe(24);
  });

  it("espaço ao redor do número quebra o token (SEM trim — espelha o regex ancorado ^[0-9]+$ do trigger, sem espaço tolerado) → cai no fallback 1", () => {
    expect(contarParcelasPrazo("30 / 60 / 90")).toBe(1);
  });
});
