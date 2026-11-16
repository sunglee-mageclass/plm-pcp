import { describe, it, expect } from "vitest";
import { textoRegerarRefConflitos, textoRegerarRefManual, textoRegerarSkusLoja } from "@/lib/confirmacoes-textos";

// Textos das confirmacoes dos botoes Regerar REF / Regerar SKUs: APROVADOS pelo dono (R11) - fixados verbatim para nao mudarem sem querer.
describe("confirmacoes-textos - Regerar REF / Regerar SKUs", () => {
  it("REF digitada a mao: pergunta 'REF atual -> nova' e avisa que so o Salvar grava; confirmar neutro", () => {
    expect(textoRegerarRefManual({ atual: "MEU-REF-1", nova: "PTOBMC10000001" })).toEqual({
      titulo: "Substituir a REF digitada à mão?",
      descricao: "A REF atual (MEU-REF-1) foi digitada à mão. Substituir por PTOBMC10000001? Nada é gravado agora: a troca e a regeração dos SKUs deste card só acontecem quando você clicar em Salvar (os SKUs editados à mão não mudam).",
      confirmar: "Substituir REF", cancelar: "Cancelar", destrutivo: false,
    });
  });
  it("SKUs em conflito no Salvar: singular/plural; Voltar", () => {
    expect(textoRegerarRefConflitos(1).descricao).toBe("1 SKU está em conflito e não será regerado (continua como está). A REF e os demais SKUs serão gravados.");
    expect(textoRegerarRefConflitos(3).descricao).toBe("3 SKUs estão em conflito e não serão regerados (continuam como estão). A REF e os demais SKUs serão gravados.");
    expect(textoRegerarRefConflitos(2)).toMatchObject({ titulo: "Salvar com SKUs em conflito?", confirmar: "Salvar mesmo assim", cancelar: "Voltar", destrutivo: false });
  });
  it("Regerar todos os SKUs da loja: 'Regerar N SKUs em M produtos', sem desfazer em lote, vermelho", () => {
    expect(textoRegerarSkusLoja({ skus: 120, produtos: 14 })).toEqual({
      titulo: "Regerar 120 SKUs em 14 produtos?",
      descricao: "Isto grava de verdade e não há desfazer em lote. Os SKUs editados à mão, os produtos travados pela Integração (ou já exportados) e os SKUs em conflito não mudam. Dá para cancelar no meio: o que já foi gravado fica.",
      confirmar: "Regerar 120 SKUs", cancelar: "Cancelar", destrutivo: true,
    });
    expect(textoRegerarSkusLoja({ skus: 1, produtos: 1 }).titulo).toBe("Regerar 1 SKU em 1 produto?");
  });
});
