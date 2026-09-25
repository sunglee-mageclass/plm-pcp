import { describe, it, expect } from "vitest";
import {
  AVISO_FALTA_NOTA, AVISO_FALTA_NOTA_CURTO, COLUNA_PARCELA_POR_FAMILIA, FAMILIAS_COM_ALERTA, QUERY_KEYS_VENCIMENTO,
  TEXTO_PARCELA_PROVISORIA, baseVencimento, faltaNotaEntrada, invalidarVencimentos, parcelaPaga, parcelaProvisoria,
  payloadDataNota, temDataNota, textoAvisoFaltaNota, validarDataNota,
} from "@/lib/nota-entrada";

// Data da Nota de Entrada (spec 2026-09-24 §4.5/§5): regra única do alerta e da parcela provisória.
describe("nota-entrada — quando alertar", () => {
  it("alerta só OC RECEBIDA sem a data, nas 4 famílias; Importado nunca (D2)", () => {
    for (const f of ["tecido", "aviamento", "etiqueta", "p_acabado"] as const) {
      expect(faltaNotaEntrada(f, { status: "recebido", data_nota_entrada: null })).toBe(true);
      expect(faltaNotaEntrada(f, { status: "recebido", data_nota_entrada: "" })).toBe(true);
      expect(faltaNotaEntrada(f, { status: "recebido", data_nota_entrada: "   " })).toBe(true);
      expect(faltaNotaEntrada(f, { status: "recebido" })).toBe(true);
      expect(faltaNotaEntrada(f, { status: "recebido", data_nota_entrada: "2026-10-05" })).toBe(false);
      expect(faltaNotaEntrada(f, { status: "encomendado", data_nota_entrada: null })).toBe(false);
    }
    expect(faltaNotaEntrada("p_importado", { status: "recebido", data_nota_entrada: null })).toBe(false);
    expect(faltaNotaEntrada("servico", { status: "recebido" })).toBe(false);
    expect(faltaNotaEntrada("tecido", null)).toBe(false);
    expect(faltaNotaEntrada(null, { status: "recebido" })).toBe(false);
    expect(FAMILIAS_COM_ALERTA).toEqual(["tecido", "aviamento", "etiqueta", "p_acabado"]);
  });
});

describe("nota-entrada — parcela provisória (Financeiro)", () => {
  const semData = { status: "recebido", data_nota_entrada: null };
  it("não paga + OC em falta = provisória; paga nunca (mesma régua do banco)", () => {
    expect(parcelaProvisoria({ tipo_oc: "tecido", status: "a_pagar", data_pagamento: null }, semData)).toBe(true);
    expect(parcelaProvisoria({ tipo_oc: "p_acabado", status: null, data_pagamento: null }, semData)).toBe(true);
    expect(parcelaProvisoria({ tipo_oc: "tecido", status: "pago", data_pagamento: null }, semData)).toBe(false);
    expect(parcelaProvisoria({ tipo_oc: "tecido", status: "a_pagar", data_pagamento: "2026-10-01" }, semData)).toBe(false);
    expect(parcelaProvisoria({ tipo_oc: "p_importado", status: "a_pagar", data_pagamento: null }, semData)).toBe(false);
    expect(parcelaProvisoria({ tipo_oc: "etiqueta", status: "a_pagar" }, { status: "recebido", data_nota_entrada: "2026-10-05" })).toBe(false);
    expect(parcelaProvisoria({ tipo_oc: "aviamento", status: "a_pagar" }, undefined)).toBe(false);
  });
  it("parcelaPaga = status pago OU data de pagamento", () => {
    expect(parcelaPaga({ status: "pago" })).toBe(true);
    expect(parcelaPaga({ status: "a_pagar", data_pagamento: "2026-10-01" })).toBe(true);
    expect(parcelaPaga({ status: "a_pagar", data_pagamento: "" })).toBe(false);
    expect(parcelaPaga({ status: null, data_pagamento: null })).toBe(false);
  });
});

describe("nota-entrada — base, payload, textos e invalidação", () => {
  it("base do vencimento espelha o COALESCE do banco", () => {
    expect(baseVencimento("2026-10-05", "2026-09-10")).toBe("2026-10-05");
    expect(baseVencimento(" 2026-10-05 ", "2026-09-10")).toBe("2026-10-05");
    expect(baseVencimento("", "2026-09-10")).toBe("2026-09-10");
    expect(baseVencimento(null, "2026-09-10")).toBe("2026-09-10");
    expect(baseVencimento(undefined, undefined)).toBe("");
  });
  it("payload: vazio LIMPA (null); data vai aparada", () => {
    expect(payloadDataNota("")).toBeNull();
    expect(payloadDataNota("  ")).toBeNull();
    expect(payloadDataNota(null)).toBeNull();
    expect(payloadDataNota(undefined)).toBeNull();
    expect(payloadDataNota(" 2026-10-05 ")).toBe("2026-10-05");
    expect(temDataNota("2026-10-05")).toBe(true);
  });
  it("textos aprovados pelo dono (verbatim)", () => {
    expect(AVISO_FALTA_NOTA).toBe("Falta a Data da Nota de Entrada — os vencimentos estão provisórios");
    expect(TEXTO_PARCELA_PROVISORIA).toBe("vencimento provisório — falta a data da nota");
  });
  it("D6 (decidido pelo dono 24/set): sem parcela a pagar confirmada, o aviso NÃO fala em 'provisórios'", () => {
    expect(textoAvisoFaltaNota(true)).toBe(AVISO_FALTA_NOTA);
    expect(textoAvisoFaltaNota(false)).toBe("Falta a Data da Nota de Entrada");
    expect(textoAvisoFaltaNota(undefined)).toBe(AVISO_FALTA_NOTA_CURTO); // carregando: nunca afirma o que não sabe
    expect(AVISO_FALTA_NOTA_CURTO).not.toMatch(/provis/);
    expect(COLUNA_PARCELA_POR_FAMILIA).toEqual({
      tecido: "oc_tecido_id", aviamento: "oc_aviamento_id", etiqueta: "oc_etiqueta_id", p_acabado: "oc_p_acabado_id",
    });
  });
  it("D7 (decidido pelo dono 24/set): data futura ou antes do pedido é recusada com o MESMO texto do banco", () => {
    const hoje = "2026-09-24";
    expect(validarDataNota("2026-09-25", "2026-09-01", hoje)).toBe("A Data da Nota de Entrada (25/09/2026) não pode ser no futuro.");
    expect(validarDataNota("2026-08-31", "2026-09-01", hoje))
      .toBe("A Data da Nota de Entrada (31/08/2026) não pode ser anterior à data do pedido (01/09/2026).");
    expect(validarDataNota("2026-09-01", "2026-09-01", hoje)).toBeNull(); // = pedido: ok
    expect(validarDataNota("2026-09-24", "2026-09-01", hoje)).toBeNull(); // = hoje: ok
    expect(validarDataNota("2026-09-10", "", hoje)).toBeNull();           // sem pedido: só a regra do futuro
    expect(validarDataNota("", "2026-09-01", hoje)).toBeNull();           // vazio: nada a validar (limpar é permitido)
  });
  it("invalidarVencimentos: Financeiro (calendário/lista/resumo), dashboard, visão da OC e o aviso da OC", () => {
    const chaves: unknown[] = [];
    invalidarVencimentos({ invalidateQueries: (f) => { chaves.push(f.queryKey); } });
    expect(chaves).toEqual([["parcelas"], ["dash-financeiro"], ["oc-view"], ["nota-parcelas-a-pagar"]]);
    expect(QUERY_KEYS_VENCIMENTO).toHaveLength(4);
  });
});
