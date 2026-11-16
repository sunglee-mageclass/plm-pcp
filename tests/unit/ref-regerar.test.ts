import { describe, it, expect } from "vitest";
import {
  lerPreviaRefRegerar, lerResultadoRegerarRef, mensagemRegerarRef, mesmaEntradaRef, podeRegerarRef, textoAvisoIrmaos, TEXTO_MOTIVO_REF,
  MSG_REF_DESATUALIZADA, PREFIXO_REF_NAO_GRAVADA, TITULO_REGERAR_REF,
} from "@/lib/ref-regerar";

const previaCrua = (p: Record<string, unknown> = {}) => ({
  pode: true, motivo: null, ref_atual: "VEA10000001", ref_auto_atual: "VEA10000001", ref_nova: "PTOBMC10000001", tipo_ref: "automatica", muda: true, irmaos: 0, ...p,
});

describe("lerPreviaRefRegerar - leitura FAIL-CLOSED do jsonb de ref_regerar_previa", () => {
  it("le os campos", () => {
    expect(lerPreviaRefRegerar(previaCrua({ irmaos: 2, tipo_ref: "manual" }))).toEqual({
      pode: true, motivo: null, refAtual: "VEA10000001", refAutoAtual: "VEA10000001", refNova: "PTOBMC10000001", tipoRef: "manual", muda: true, irmaos: 2,
    });
  });
  it("recusa do servidor: pode=false com o motivo; motivo desconhecido, forma errada ou pode=true sem ref_nova => 'desconhecido' (o botao nao inicia nada)", () => {
    expect(lerPreviaRefRegerar(previaCrua({ pode: false, motivo: "sem_numero", ref_nova: null, muda: false }))).toMatchObject({ pode: false, motivo: "sem_numero", refNova: null });
    for (const ruim of [previaCrua({ motivo: "inventado" }), previaCrua({ muda: "sim" }), previaCrua({ tipo_ref: "x" }), previaCrua({ ref_nova: null }), null, "x"]) {
      expect(lerPreviaRefRegerar(ruim)).toMatchObject({ pode: false, motivo: "desconhecido", refNova: null });
    }
  });
  it("textos das 6 recusas existem e batem com os do banco (mensagens PT em erro-mensagem)", () => {
    for (const m of ["nao_interno", "pulado_integracao", "pulado_exportado", "nao_revelada", "sem_sigla", "sem_numero", "desconhecido"] as const) {
      expect(TEXTO_MOTIVO_REF[m], m).toMatch(/\S/);
    }
  });
});

describe("textoAvisoIrmaos - replica so avisa (Review Focus 4)", () => {
  it("sem irmaos = sem aviso; com irmaos = 'familia de N cards' (N = irmaos + 1) e os irmaos mantem a REF", () => {
    expect(textoAvisoIrmaos(0)).toBeNull();
    expect(textoAvisoIrmaos(1)).toBe("Este card faz parte de uma família de 2 cards; os irmãos mantêm a REF atual.");
    expect(textoAvisoIrmaos(4)).toBe("Este card faz parte de uma família de 5 cards; os irmãos mantêm a REF atual.");
  });
});

describe("podeRegerarRef - habilitacao do botao (a tela; o servidor confere de novo)", () => {
  const ok = { refEditavel: true, podeEditarSkus: true, origemInterno: true, rascunhoLimpo: true, skusAGravarVazio: true, jaPendente: false, consultando: false };
  it("tudo certo = habilita", () => {
    expect(podeRegerarRef(ok)).toEqual({ pode: true, motivo: TITULO_REGERAR_REF });
  });
  it.each([
    ["nao e interno (revenda/importado)", { origemInterno: false }],
    ["a REF nao e editavel (Explosao/Dev travado, etapa, trava da Integracao)", { refEditavel: false }],
    ["sem permissao de SKU / SKUs travados", { podeEditarSkus: false }],
    ["a previa ja esta na tela", { jaPendente: true }],
    ["ha SKUs a gravar (exclusao mutua com o Regerar SKUs)", { skusAGravarVazio: false }],
    ["rascunho sujo (categoria/sub1/REF diferentes das salvas)", { rascunhoLimpo: false }],
    ["consultando o servidor", { consultando: true }],
  ])("desabilita com motivo: %s", (_n, mudanca) => {
    const r = podeRegerarRef({ ...ok, ...mudanca });
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/\S/);
  });
});

describe("mesmaEntradaRef - o que cancela a previa pendente", () => {
  it("REF (aparada), categoria ou sub1 diferentes = cancela; igual = mantem", () => {
    const a = { ref: "X1", categoria: "c1", sub1: null };
    expect(mesmaEntradaRef(a, { ref: " X1 ", categoria: "c1", sub1: null })).toBe(true);
    expect(mesmaEntradaRef(a, { ref: "X2", categoria: "c1", sub1: null })).toBe(false);
    expect(mesmaEntradaRef(a, { ref: "X1", categoria: "c2", sub1: null })).toBe(false);
    expect(mesmaEntradaRef(a, { ref: "X1", categoria: "c1", sub1: "s1" })).toBe(false);
  });
});

describe("lerResultadoRegerarRef / mensagemRegerarRef", () => {
  it("separa a REF, o rev e a matriz dos SKUs do resumo (criados/atualizados/removidos/manuais/conflitos)", () => {
    const r = lerResultadoRegerarRef({
      ref: "PTOB1", ref_auto: "PTOB1", rev: 7, criados: 0, atualizados: 4, removidos: 0, manuais: 1, conflitos: [],
      skus: { status: "ok", tamanho_tipo: "numero", tamanho_tipo_card: "numero", linhas: [], faltas: [], avisos: [] },
    });
    expect(r).toMatchObject({ ref: "PTOB1", rev: 7, matriz: { status: "ok" }, resumo: { atualizados: 4, manuais: 1, conflitos: [] } });
    expect(r.resumo).not.toHaveProperty("skus");
  });
  it("P0409 (REF ou assinatura dos SKUs) = texto da previa desatualizada; outro erro = prefixo 'o card foi salvo, mas a REF e os SKUs nao...'", () => {
    expect(mensagemRegerarRef({ code: "P0409", message: "previa_desatualizada: ref" })).toBe(MSG_REF_DESATUALIZADA);
    expect(mensagemRegerarRef({ code: "P0409", message: "previa_desatualizada: os SKUs mudaram desde a previa" })).toBe(MSG_REF_DESATUALIZADA);
    expect(mensagemRegerarRef({ code: "P0001", message: "ref_manual_confirmar: a REF foi digitada a mao - confirme a troca" }))
      .toBe(PREFIXO_REF_NAO_GRAVADA + "A REF foi digitada à mão: confirme a troca antes de salvar.");
  });
});
