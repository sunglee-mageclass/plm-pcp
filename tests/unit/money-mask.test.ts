import { describe, it, expect } from "vitest";
import { groupInt, countSig, valueToMasked, maskLive, caretAfterFormat, normalizarPontos, sigBeforeCaret } from "@/lib/money-mask";

describe("groupInt", () => {
  it("agrupa milhares com ponto", () => {
    expect(groupInt("")).toBe("");
    expect(groupInt("1")).toBe("1");
    expect(groupInt("123")).toBe("123");
    expect(groupInt("1234")).toBe("1.234");
    expect(groupInt("1234567")).toBe("1.234.567");
  });
});

describe("countSig", () => {
  it("conta dígitos e a vírgula, ignora o ponto de milhar", () => {
    expect(countSig("")).toBe(0);
    expect(countSig("1.234")).toBe(4);
    expect(countSig("1.234,5")).toBe(6);
    expect(countSig(",")).toBe(1);
  });
});

describe("maskLive (decimals=2)", () => {
  const cases: Array<[string, string, string]> = [
    // raw            masked           canonical
    ["", "", ""],
    ["1", "1", "1"],
    ["1234", "1.234", "1234"],
    ["1234567", "1.234.567", "1234567"],
    ["1234,5", "1.234,5", "1234.5"],
    ["1234,", "1.234,", "1234"], // vírgula só na exibição
    [",", ",", ""], // sem prefixo "0" ao vivo
    [",5", ",5", "0.5"],
    ["1.234", "1.234", "1234"], // ponto tratado como milhar
    ["12a34", "1.234", "1234"], // ignora não-dígitos
    ["0007", "7", "7"], // zeros à esquerda
    ["1234,567", "1.234,56", "1234.56"], // trunca 2 casas
    ["1.234.567,89", "1.234.567,89", "1234567.89"],
  ];
  it.each(cases)("maskLive(%j) -> %j / %j", (raw, masked, canonical) => {
    expect(maskLive(raw, 2)).toEqual({ masked, canonical });
  });
});

describe("maskLive (decimals=0, só inteiro)", () => {
  it("ignora a vírgula e mantém só o inteiro agrupado", () => {
    expect(maskLive("1234,5", 0)).toEqual({ masked: "12.345", canonical: "12345" });
    expect(maskLive("1234", 0)).toEqual({ masked: "1.234", canonical: "1234" });
  });
});

describe("valueToMasked (repouso — só mostra decimais se existirem)", () => {
  it("vazios", () => {
    expect(valueToMasked("", 2)).toBe("");
    expect(valueToMasked(null, 2)).toBe("");
    expect(valueToMasked(undefined, 2)).toBe("");
    expect(valueToMasked(NaN, 2)).toBe("");
  });
  it("inteiro sem casas, decimal com vírgula", () => {
    expect(valueToMasked(1234, 2)).toBe("1.234");
    expect(valueToMasked(1234.5, 2)).toBe("1.234,5");
    expect(valueToMasked("1234.50", 2)).toBe("1.234,50");
    expect(valueToMasked(0.5, 2)).toBe("0,5");
    expect(valueToMasked("1234567.89", 2)).toBe("1.234.567,89");
    expect(valueToMasked(1234.567, 2)).toBe("1.234,56"); // trunca 2
  });
});

describe("valueToMasked (fixed — SEMPRE 2 casas: preço)", () => {
  it("inteiro ganha ,00; decimal com 1 casa vira ,x0; 2 casas intactas", () => {
    expect(valueToMasked(698, 2, true)).toBe("698,00");
    expect(valueToMasked(698.5, 2, true)).toBe("698,50");
    expect(valueToMasked("698.5", 2, true)).toBe("698,50");
    expect(valueToMasked("1234.5", 2, true)).toBe("1.234,50");
    expect(valueToMasked("1234.56", 2, true)).toBe("1.234,56");
    expect(valueToMasked(0, 2, true)).toBe("0,00");
    expect(valueToMasked(1234, 2, true)).toBe("1.234,00");
    expect(valueToMasked(1234.567, 2, true)).toBe("1.234,56"); // trava/trunca em 2
  });
  it("vazios continuam vazios (não vira 0,00 à toa)", () => {
    expect(valueToMasked("", 2, true)).toBe("");
    expect(valueToMasked(null, 2, true)).toBe("");
    expect(valueToMasked(undefined, 2, true)).toBe("");
  });
});

describe("normalizarPontos (ponto digitado vira vírgula decimal, sem quebrar milhar colado)", () => {
  it("sem vírgula: último ponto com ≤ decimals dígitos depois vira decimal", () => {
    expect(normalizarPontos("12.5", 2)).toBe("12,5");
    expect(normalizarPontos("0.9", 2)).toBe("0,9");
    expect(normalizarPontos("1234.56", 2)).toBe("1234,56");
    expect(normalizarPontos(".", 2)).toBe(",");
    expect(normalizarPontos("12.", 2)).toBe("12,"); // ponto no fim, ainda digitando
  });
  it("múltiplos pontos sem vírgula: só o ÚLTIMO vira decimal, os anteriores somem (milhar)", () => {
    expect(normalizarPontos("1.234.5", 2)).toBe("1234,5");
  });
  it("3+ dígitos após o último ponto = milhar (ambíguo, decide por milhar)", () => {
    expect(normalizarPontos("1.234", 2)).toBe("1.234"); // inalterado — vira milhar no maskLive
  });
  it("já tem vírgula: pontos são milhar legítimo, string INTOCADA", () => {
    expect(normalizarPontos("1.234,56", 2)).toBe("1.234,56");
    expect(normalizarPontos("1.234.567,89", 2)).toBe("1.234.567,89");
  });
  it("sem ponto: no-op", () => {
    expect(normalizarPontos("1234", 2)).toBe("1234");
    expect(normalizarPontos("1234,5", 2)).toBe("1234,5");
  });
  it("decimals=0: no-op (não há decimal pra converter)", () => {
    expect(normalizarPontos("12.5", 0)).toBe("12.5");
  });
});

describe("sigBeforeCaret (cursor não pula ao ponto virar vírgula — regressão do achado 2)", () => {
  it("digitar '.' no fim: cursor conta a vírgula nova (senão a próxima tecla cai ANTES dela)", () => {
    // raw="12." (usuário acabou de digitar o ponto no fim), cursor no fim (pos 3).
    // Sem o fix, countSig("12.") = 2 (ponto não conta) -> cursor ficaria ANTES da
    // vírgula no masked "12," e a próxima tecla "5" viraria "125," (bug real, achado
    // em QA de navegador: pressSequentially digitando "12.5" produzia "125,").
    expect(sigBeforeCaret("12.", 3, 2)).toBe(3);
  });
  it("fluxo completo ao vivo: '1','2','.','5' -> cursor sempre no fim, resultado '12,5'", () => {
    let raw = "";
    for (const ch of ["1", "2", ".", "5"]) {
      const caret = raw.length + 1;
      raw = raw + ch;
      const sigBefore = sigBeforeCaret(raw, caret, 2);
      const { masked } = maskLive(raw, 2);
      raw = masked; // próxima iteração parte do texto já mascarado (input controlado)
      expect(caretAfterFormat(masked, sigBefore)).toBe(masked.length); // cursor sempre no fim
    }
    expect(raw).toBe("12,5");
  });
  it("cursor no MEIO antes de todos os pontos: não desloca (nada foi removido antes dele)", () => {
    expect(sigBeforeCaret("1.234.5", 1, 2)).toBe(1);
  });
  it("colar '1.234,56' (já tem vírgula): comportamento igual ao countSig (sem normalizar)", () => {
    expect(sigBeforeCaret("1.234,56", 8, 2)).toBe(countSig("1.234,56"));
  });
  it("'1.234' (ambíguo -> milhar, normalizarPontos não muda nada): igual ao countSig", () => {
    expect(sigBeforeCaret("1.234", 5, 2)).toBe(countSig("1.234"));
  });
});

describe("maskLive — ponto digitado vira vírgula decimal (pedido do dono)", () => {
  const cases: Array<[string, string, string]> = [
    // raw               masked          canonical
    ["12.5", "12,5", "12.5"], // ponto digitado -> decimal
    ["12,5", "12,5", "12.5"], // vírgula já digitada -> inalterado
    ["1.234,56", "1.234,56", "1234.56"], // COLADO milhar+decimal -> NÃO quebra
    ["1234.56", "1.234,56", "1234.56"], // ponto decimal com milhar formatado na saída
    ["0.9", "0,9", "0.9"],
    ["1.234", "1.234", "1234"], // ambíguo: 3 dígitos após o ponto -> tratado como milhar
    [".", ",", ""], // só o ponto, ainda digitando
    ["12.", "12,", "12"], // ponto no fim, esperando o decimal
    ["1.234.5", "1.234,5", "1234.5"], // 2 pontos: só o último decide, anteriores somem
    ["1.234.567,89", "1.234.567,89", "1234567.89"], // colado 3 grupos de milhar + decimal
  ];
  it.each(cases)("maskLive(%j) -> %j / %j", (raw, masked, canonical) => {
    expect(maskLive(raw, 2)).toEqual({ masked, canonical });
  });
});

describe("caretAfterFormat (preservação do cursor)", () => {
  it("digitar dígito no fim mantém o cursor no fim", () => {
    // "1.234" + "5" no fim -> cru "1.2345" (sigBefore=5), masked "12.345"
    expect(caretAfterFormat("12.345", 5)).toBe(6);
  });
  it("digitar dígito no meio reposiciona após o dígito", () => {
    // "1.234.567" com "0" após o "1" -> cru "10.234.567" (sigBefore=2), masked "10.234.567"
    expect(caretAfterFormat("10.234.567", 2)).toBe(2);
  });
  it("fluxo vírgula-primeiro: cursor cai depois da vírgula (regressão do achado 1)", () => {
    // Campo vazio, digita "," -> masked "," (sigBefore=1) -> cursor após a vírgula (pos 1)
    expect(caretAfterFormat(",", 1)).toBe(1);
    // Depois "5" -> cru ",5" (sigBefore=2), masked ",5" -> cursor no fim (pos 2)
    expect(caretAfterFormat(",5", 2)).toBe(2);
  });
  it("cursor no início quando não há significativos antes", () => {
    expect(caretAfterFormat("1.234", 0)).toBe(0);
  });
});

// Fix round 2 (review Opus — blur do preço fixo do Produto Acabado não salvava o valor
// digitado): documenta o MECANISMO exato do bug e prova o comportamento certo do fix, sem
// depender de montar `<MoneyInput>`/`<ProdutoCard>` (testes de componente ficam nos arquivos
// de shared/produto-acabado). `valueToMasked` (com `fixed=true`, o `fixedDecimals` que os
// campos de preço usam) reproduz exatamente o texto que fica no DOM em repouso/blur — era ESSE
// texto que o `onBlur` de `ProdutoCard.tsx` (antes do fix) reparseava com `Number(e.target.
// value)`, em vez de usar o valor canônico que o próprio `onChange` já tinha calculado.
describe("Fix round 2 — Number() no texto MASCARADO (blur) é NaN; no CANÔNICO (onChange) é correto", () => {
  it.each([
    [698, "698,00"],
    [1234.56, "1.234,56"],
    [50, "50,00"],
  ])("valor %j vira o texto mascarado %j em repouso (fixedDecimals)", (valor, masked) => {
    expect(valueToMasked(valor, 2, true)).toBe(masked);
  });

  it("Number() no texto MASCARADO com decimal ou milhar é NaN — a causa raiz do bug", () => {
    expect(Number("698,00")).toBeNaN();
    expect(Number("1.234,56")).toBeNaN();
    // Só o caso sem vírgula/ponto (raro com fixedDecimals, que sempre mostra 2 casas) não quebra:
    expect(Number("50")).toBe(50); // isto é por que markup inteiro "passava por acidente"
  });

  it("maskLive (o que onChange usa) sempre devolve um canonical que Number() entende — 698,00 / 1.234,56 / vazio", () => {
    // Simula o usuário digitando cada texto mascarado (como se fosse o valor cru do input) —
    // `onChange` do MoneyInput roda maskLive sobre o texto digitado e emite `canonical`.
    expect(Number(maskLive("698,00", 2).canonical)).toBe(698);
    expect(Number(maskLive("1.234,56", 2).canonical)).toBe(1234.56);
    // Campo esvaziado -> canonical "" -> Number("") é 0, e o padrão do sistema (`Number(x) > 0 ?
    // Number(x) : null`) trata isso como "voltar a null" (calculado) — nunca NaN, nunca trava.
    expect(maskLive("", 2).canonical).toBe("");
    expect(Number(maskLive("", 2).canonical) > 0 ? Number(maskLive("", 2).canonical) : null).toBeNull();
  });
});
