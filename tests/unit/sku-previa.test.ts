import { describe, it, expect } from "vitest";
import {
  MSG_PREVIA_DESATUALIZADA, PREFIXO_SKUS_NAO_GRAVADOS, SKUS_A_GRAVAR_VAZIO, TITULO_REGERAR, chaveEntradaPrevia,
  chaveLinhaSku, comRegerar, digitarSku, entradaDaChave, lerPrevia, manterMeu, manuaisParaRpc, mensagemAplicarSkus,
  mensagemErroPrevia, modoPrevia, nadaAGravar, podeRegerar, refParaPrevia, resumoAplicacao, semManual, situacaoPrevia,
  skuExibido, type LinhaPrevia, type SkusAGravar,
} from "@/components/planejamento/planejamento-detail/codigos/sku-previa";
import { seloCodigos, type LinhaSku, type MatrizSkus } from "@/components/planejamento/planejamento-detail/codigos/sku-card";

// SKU em PRÉVIA (spec 2026-09-25-sku-previa-regerar §4.2 — P-46 do dono): o Regerar e o SKU à mão ficam "a gravar" e só o
// Salvar grava. Regras PURAS: entrada da prévia, leitura tolerante (fail-closed), textos. Sem espelho TS da geração.
const K1 = "11111111-1111-1111-1111-111111111111";
const K2 = "22222222-2222-2222-2222-222222222222";
const ASS = "0123456789abcdef0123456789abcdef";
const linha = (p: Partial<LinhaSku> = {}): LinhaSku => ({
  variante_key: K1, variante_ordem: 1, cor_nome: "Amarelo", apelido_nome: null, tamanho_key: "34|PPP", tamanho_ordem: 1,
  id: "id-1", sku: "AA34", manual: false, rev: 0, sku_previsto: "AA34", faltas: [], avisos: [], conflito_com: null,
  estado: "ok", ...p,
});
const comPrevia = (l: LinhaSku, previa: LinhaPrevia["previa"]): LinhaPrevia => ({ ...l, previa });
const matriz = (p: Partial<MatrizSkus> = {}): MatrizSkus => ({
  status: "ok", tamanho_tipo: "numero", tamanho_tipo_card: "numero", linhas: [], faltas: [], avisos: [], ...p,
});
const cruaLinha = (p: Record<string, unknown> = {}) => ({
  variante_key: K1, variante_ordem: 1, cor_nome: "Amarelo", apelido_nome: null, tamanho_key: "34|PPP", tamanho_ordem: 1,
  id: "id-1", sku: "AA34", manual: false, rev: 0, sku_previsto: "AA34", faltas: [], avisos: [], conflito_com: null,
  estado: "ok", previa: null, ...p,
});

describe("a gravar — rascunho dos SKUs (nada grava antes do Salvar)", () => {
  it("vazio = nada a gravar (modo 'manuais'); Regerar entra, é idempotente e muda o modo", () => {
    expect(nadaAGravar(SKUS_A_GRAVAR_VAZIO)).toBe(true);
    expect(modoPrevia(SKUS_A_GRAVAR_VAZIO)).toBe("manuais");
    const r = comRegerar(SKUS_A_GRAVAR_VAZIO);
    expect([nadaAGravar(r), modoPrevia(r)]).toEqual([false, "regerar"]);
    expect(comRegerar(r)).toBe(r);
  });

  it("digitarSku: normaliza como o servidor; igual ao que a linha MOSTRA = nada; inválido/vazio = erro PT e nada muda", () => {
    const l = linha();
    expect(digitarSku(SKUS_A_GRAVAR_VAZIO, l, " aa34 ")).toEqual({ aGravar: SKUS_A_GRAVAR_VAZIO, erro: null, valor: "AA34" });
    const r = digitarSku(SKUS_A_GRAVAR_VAZIO, l, " meu-1 ");
    expect([r.erro, r.valor]).toEqual([null, "MEU-1"]);
    expect(r.aGravar.manuais[chaveLinhaSku(K1, "34|PPP")]).toEqual({ varianteKey: K1, tamanhoKey: "34|PPP", sku: "MEU-1", id: "id-1", rev: 0 });
    const inv = digitarSku(r.aGravar, l, "a#b");
    expect(inv).toEqual({ aGravar: r.aGravar, erro: "SKU inválido: use só letras, números e - . _ /.", valor: "MEU-1" });
    expect(digitarSku(SKUS_A_GRAVAR_VAZIO, l, "   ").erro).toBe("Informe o SKU.");
    const semSku = linha({ id: null, sku: null, rev: null });
    expect(digitarSku(SKUS_A_GRAVAR_VAZIO, semSku, "")).toEqual({ aGravar: SKUS_A_GRAVAR_VAZIO, erro: null, valor: "" });
    const nova = digitarSku(SKUS_A_GRAVAR_VAZIO, semSku, "x-1").aGravar.manuais[chaveLinhaSku(K1, "34|PPP")];
    expect(nova).toEqual({ varianteKey: K1, tamanhoKey: "34|PPP", sku: "X-1", id: null, rev: null });
  });

  it("skuExibido: digitado > o que o Salvar grava (novo/muda) > o gravado; 'sai' e 'conflito' mostram o gravado", () => {
    const l = linha();
    expect(skuExibido(l, SKUS_A_GRAVAR_VAZIO)).toBe("AA34");
    const muda = comPrevia(l, { acao: "muda", sku_de: "AA34", sku_para: "AAPPP", mensagem: null, code: null });
    expect(skuExibido(muda, SKUS_A_GRAVAR_VAZIO)).toBe("AAPPP");
    const sai = comPrevia(l, { acao: "sai", sku_de: "AA34", sku_para: null, mensagem: null, code: null });
    expect(skuExibido(sai, SKUS_A_GRAVAR_VAZIO)).toBe("AA34");
    const conf = comPrevia(l, { acao: "conflito", sku_de: "AA34", sku_para: "BB34", mensagem: "x", code: null });
    expect(skuExibido(conf, SKUS_A_GRAVAR_VAZIO)).toBe("AA34");
    const s = digitarSku(SKUS_A_GRAVAR_VAZIO, muda, "meu").aGravar;
    expect(skuExibido(muda, s)).toBe("MEU");
    // o digitado igual ao que o Regerar vai gravar (AAPPP) = nada (não marca "à mão" por engano)
    expect(digitarSku(SKUS_A_GRAVAR_VAZIO, muda, "aappp").aGravar).toBe(SKUS_A_GRAVAR_VAZIO);
  });

  it("semManual tira só aquela linha; manterMeu troca id/rev pela versão NOVA (outra pessoa mudou) e mantém o meu SKU", () => {
    const s = digitarSku(SKUS_A_GRAVAR_VAZIO, linha(), "meu-1").aGravar;
    const c = chaveLinhaSku(K1, "34|PPP");
    expect(semManual(s, c).manuais).toEqual({});
    expect(semManual(s, "outra")).toBe(s);
    expect(manterMeu(s, linha({ id: "id-1", rev: 3, sku: "DELA" })).manuais[c]).toEqual({
      varianteKey: K1, tamanhoKey: "34|PPP", sku: "MEU-1", id: "id-1", rev: 3,
    });
    expect(manterMeu(SKUS_A_GRAVAR_VAZIO, linha())).toBe(SKUS_A_GRAVAR_VAZIO);
  });

  it("manuaisParaRpc em ordem estável; chaveEntradaPrevia estável (ordem de digitação não importa) e reversível", () => {
    let a: SkusAGravar = SKUS_A_GRAVAR_VAZIO;
    a = digitarSku(a, linha({ variante_key: K2 }), "b").aGravar;
    a = digitarSku(a, linha(), "a").aGravar;
    let b: SkusAGravar = SKUS_A_GRAVAR_VAZIO;
    b = digitarSku(b, linha(), "a").aGravar;
    b = digitarSku(b, linha({ variante_key: K2 }), "b").aGravar;
    expect(manuaisParaRpc(a).map((m) => m.variante_key)).toEqual([K1, K2]);
    const e = { ref: "  REF1 ", tamanhoTipo: "letra" as const, aGravar: comRegerar(a) };
    expect(chaveEntradaPrevia(e)).toBe(chaveEntradaPrevia({ ...e, ref: "REF1", aGravar: comRegerar(b) }));
    expect(entradaDaChave(chaveEntradaPrevia(e))).toEqual({
      ref: "REF1", tamanhoTipo: "letra", modo: "regerar",
      manuais: [
        { variante_key: K1, tamanho_key: "34|PPP", sku: "A", rev: 0 },
        { variante_key: K2, tamanho_key: "34|PPP", sku: "B", rev: 0 },
      ],
    });
  });

  it("refParaPrevia: a do rascunho (aparada) só quando ela vai no Salvar; senão a SALVA", () => {
    expect(refParaPrevia({ refVaiNoSalvar: true, refRascunho: " NOVA ", refSalva: "VELHA" })).toBe("NOVA");
    expect(refParaPrevia({ refVaiNoSalvar: false, refRascunho: "NOVA", refSalva: " VELHA " })).toBe("VELHA");
  });
});

describe("lerPrevia — leitura tolerante e FAIL-CLOSED", () => {
  it("ok: matriz + previa por linha + assinatura md5 + erros + nº de conflitos", () => {
    const p = lerPrevia({
      status: "ok", tamanho_tipo: "letra", tamanho_tipo_card: "letra", faltas: [], avisos: [], assinatura: ASS,
      conflitos: [{ mensagem: "x" }],
      erros: [{ variante_key: K1, tamanho_key: "34|PPP", code: "P0409", mensagem: "conflito_versao: o SKU foi alterado por outra pessoa" }],
      linhas: [cruaLinha({ previa: { acao: "muda", sku_de: "AA34", sku_para: "AAPPP", mensagem: null, code: null } }), cruaLinha({ tamanho_key: "36|PP" })],
    }, "k");
    expect([p.desconhecida, p.assinatura, p.entrada, p.nConflitos]).toEqual([false, ASS, "k", 1]);
    expect(p.matriz.linhas.map((l) => l.previa?.acao ?? null)).toEqual(["muda", null]);
    expect(p.erros).toEqual([{ variante_key: K1, tamanho_key: "34|PPP", code: "P0409", mensagem: "conflito_versao: o SKU foi alterado por outra pessoa" }]);
  });
  it("ação desconhecida, assinatura que não é md5 ou status desconhecido ⇒ desconhecida e SEM assinatura (o Salvar não grava)", () => {
    const acao = lerPrevia({ status: "ok", assinatura: ASS, linhas: [cruaLinha({ previa: { acao: "teletransporta" } })] }, "k");
    expect([acao.desconhecida, acao.assinatura]).toEqual([true, null]);
    expect(acao.matriz.linhas[0].previa).toMatchObject({ acao: "erro", mensagem: "Situação desconhecida — recarregue a página." });
    expect(lerPrevia({ status: "ok", assinatura: "xyz", linhas: [] }, "k").assinatura).toBeNull();
    expect(lerPrevia({ status: "novo_status", assinatura: ASS, linhas: [] }, "k")).toMatchObject({ desconhecida: true, assinatura: null });
    expect(lerPrevia(null, "k")).toMatchObject({ desconhecida: true, assinatura: null, erros: [] });
  });
});

describe("situacaoPrevia — o que a linha diz", () => {
  const p = (acao: NonNullable<LinhaPrevia["previa"]>["acao"], x: Partial<NonNullable<LinhaPrevia["previa"]>> = {}) =>
    comPrevia(linha(), { acao, sku_de: "AA34", sku_para: "AAPPP", mensagem: null, code: null, ...x });
  it("ações do plano (a gravar em âmbar; conflito/erro em vermelho; rev velho oferece manter/usar)", () => {
    expect(situacaoPrevia(p("novo"))).toMatchObject({ tom: "warning", texto: "novo · a gravar", aGravar: true });
    expect(situacaoPrevia(p("muda"))).toMatchObject({ tom: "warning", texto: "muda de AA34 · a gravar", aGravar: true });
    expect(situacaoPrevia(p("sai"))).toMatchObject({ tom: "warning", texto: "sai no Salvar", aGravar: true });
    expect(situacaoPrevia(p("manual_novo"))).toMatchObject({ tom: "warning", texto: "editado à mão · a gravar", aGravar: true });
    expect(situacaoPrevia(p("conflito", { mensagem: "SKU AAPPP já existe em X (REF Y). Edite este SKU à mão ou mude a sigla." })))
      .toMatchObject({ tom: "danger", texto: "não será gravado — SKU AAPPP já existe em X (REF Y). Edite este SKU à mão ou mude a sigla.", aGravar: false });
    expect(situacaoPrevia(p("erro", { code: "P0001", mensagem: "O SKU X já está em outra linha deste produto." })))
      .toMatchObject({ tom: "danger", texto: "O SKU X já está em outra linha deste produto.", conflitoVersao: false });
    expect(situacaoPrevia(comPrevia(linha({ sku: "DELA" }), { acao: "erro", sku_de: "DELA", sku_para: "meu", mensagem: "conflito_versao", code: "P0409" })))
      .toMatchObject({ tom: "danger", texto: "Outra pessoa mudou este SKU para DELA — o seu (meu) ainda não foi gravado.", conflitoVersao: true });
  });
  it("sem ação (a linha não muda): igual / manual mantido / falta que mantém o gravado / o resto como hoje", () => {
    expect(situacaoPrevia(comPrevia(linha(), null))).toMatchObject({ tom: "neutral", texto: "igual", aGravar: false });
    expect(situacaoPrevia(comPrevia(linha({ estado: "manual", manual: true }), null))).toMatchObject({ tom: "info", texto: "editado à mão — mantido" });
    const falta = linha({ estado: "falta", faltas: [{ atributo: "cor_base", id: null, nome: "Amarelo" }] });
    expect(situacaoPrevia(comPrevia(falta, null)).texto).toMatch(/ \(mantém AA34\)$/);
    expect(situacaoPrevia(comPrevia(linha({ estado: "pendente", sku: null }), null))).toMatchObject({ texto: "a gerar", aGravar: false });
  });
});

describe("mensagens, Regerar e selo", () => {
  it("resumoAplicacao: contagens; com conflito vira erro com a 1ª mensagem do servidor", () => {
    expect(resumoAplicacao({ criados: 1, atualizados: 2, removidos: 0, manuais: 1, conflitos: [] }))
      .toEqual({ erro: false, texto: "SKUs gravados: 1 novo(s), 2 atualizado(s), 0 removido(s), 1 à mão." });
    expect(resumoAplicacao({ criados: 3, conflitos: [{ mensagem: "SKU AA34 já existe em X (REF Y). Edite este SKU à mão ou mude a sigla." }] }))
      .toEqual({ erro: true, texto: "SKUs gravados: 3 novo(s), 0 atualizado(s), 0 removido(s), 0 à mão. 1 SKU não gravado: SKU AA34 já existe em X (REF Y). Edite este SKU à mão ou mude a sigla." });
  });
  it("mensagemAplicarSkus: P0409 = texto do SKU (não o genérico); o resto = 'O card foi salvo, mas os SKUs não…' + a mensagem", () => {
    expect(mensagemAplicarSkus({ code: "P0409", message: "previa_desatualizada: os SKUs mudaram desde a prévia" })).toBe(MSG_PREVIA_DESATUALIZADA);
    expect(mensagemAplicarSkus({ code: "P0001", message: "O SKU X já existe em Y (REF Z). Escolha outro." }))
      .toBe(`${PREFIXO_SKUS_NAO_GRAVADOS}O SKU X já existe em Y (REF Z). Escolha outro.`);
    expect(mensagemErroPrevia({ variante_key: K1, tamanho_key: "34|PPP", code: "P0409", mensagem: "x" }))
      .toBe(`${PREFIXO_SKUS_NAO_GRAVADOS}outra pessoa mudou um SKU que você digitou — escolha “manter o meu” ou “usar o novo” na linha.`);
  });
  it("podeRegerar: permissão → carregado → status legível → Formato → REF → ainda não pedido", () => {
    const base = { podeEditar: true, matriz: matriz(), refPrevia: "REF1", jaPedido: false };
    expect(podeRegerar(base)).toEqual({ pode: true, motivo: TITULO_REGERAR });
    expect(podeRegerar({ ...base, podeEditar: false })).toEqual({ pode: false, motivo: "Sem permissão para editar os SKUs." });
    expect(podeRegerar({ ...base, matriz: undefined }).pode).toBe(false);
    expect(podeRegerar({ ...base, matriz: matriz({ status: "desconhecido" }) }).pode).toBe(false);
    expect(podeRegerar({ ...base, matriz: matriz({ status: "sem_formato" }) })).toEqual({ pode: false, motivo: "A loja ainda não tem o Formato do SKU." });
    // REF/"Tamanho em" digitados e não salvos NÃO travam mais (P-46): só REF vazia
    expect(podeRegerar({ ...base, matriz: matriz({ status: "aguardando_ref" }), refPrevia: "NOVA" }).pode).toBe(true);
    expect(podeRegerar({ ...base, refPrevia: "  " })).toEqual({ pode: false, motivo: "Preencha a REF para regerar." });
    expect(podeRegerar({ ...base, jaPedido: true }).pode).toBe(false);
  });
  it("seloCodigos: com prévia vence tudo ('prévia a gravar'); sem prévia = como antes", () => {
    expect(seloCodigos(matriz({ linhas: [linha()] }), true)).toEqual({ tone: "warn", texto: "prévia a gravar" });
    expect(seloCodigos(undefined, true)).toEqual({ tone: "warn", texto: "prévia a gravar" });
    expect(seloCodigos(matriz({ linhas: [linha()] }))).toEqual(seloCodigos(matriz({ linhas: [linha()] }), false));
  });
});
