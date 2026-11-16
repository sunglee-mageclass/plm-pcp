// Regerar REF / Regerar SKUs: as recusas ASCII com prefixo das migrations 20261201100000..120000 viram texto PT na tela (MENSAGENS_REGERAR em erro-mensagem.ts).
// O anti-drift contra o SQL fica em erro-mensagem-regerar-antidrift.test.ts (so roda com as 3 migrations no repo).
import { describe, it, expect } from "vitest";
import { mensagemErro, MENSAGENS_REGERAR, TEXTO_SESSAO_EXPIRADA } from "@/lib/erro-mensagem";

const CASOS: [string, string, string][] = [
  ["P0001", "ref_nao_interno: nao da para regerar a REF deste card", MENSAGENS_REGERAR.ref_nao_interno],
  ["P0001", "ref_pulado_integracao: nao da para regerar a REF deste card", MENSAGENS_REGERAR.ref_pulado_integracao],
  ["P0001", "ref_pulado_exportado: nao da para regerar a REF deste card", MENSAGENS_REGERAR.ref_pulado_exportado],
  ["P0001", "ref_nao_revelada: nao da para regerar a REF deste card", MENSAGENS_REGERAR.ref_nao_revelada],
  ["P0001", "ref_sem_sigla: nao da para regerar a REF deste card", MENSAGENS_REGERAR.ref_sem_sigla],
  ["P0001", "ref_sem_numero: nao da para regerar a REF deste card", MENSAGENS_REGERAR.ref_sem_numero],
  ["P0001", "ref_manual_confirmar: a REF foi digitada a mao - confirme a troca", MENSAGENS_REGERAR.ref_manual_confirmar],
  ["P0409", "previa_desatualizada: ref", MENSAGENS_REGERAR.previa_desatualizada_ref],
  ["P0001", "limite_pagina: a pagina aceita de 1 a 50 produtos", MENSAGENS_REGERAR.limite_pagina],
  ["P0001", "itens_invalidos: envie de 1 a 50 produtos, sem repetir", MENSAGENS_REGERAR.itens_invalidos],
  ["P0001", "loja_mudou: a loja ativa mudou - recarregue a pagina", MENSAGENS_REGERAR.loja_mudou],
  ["42501", "sem_permissao_admin: so o administrador da loja regera os SKUs", MENSAGENS_REGERAR.sem_permissao_admin],
  ["42501", "sem_permissao_modelo: modelo fora da loja", MENSAGENS_REGERAR.sem_permissao_modelo],
  ["42501", "loja_inativa: operacao nao permitida", MENSAGENS_REGERAR.loja_inativa],
  ["42501", "nao_autenticado: login necessario", TEXTO_SESSAO_EXPIRADA],
];

describe("erro-mensagem - Regerar REF / Regerar SKUs", () => {
  it.each(CASOS)("%s %s", (code, message, esperado) => {
    expect(mensagemErro({ code, message }, "fallback")).toBe(esperado);
  });
  it("o codigo errado NAO traduz (prefixo de P0001 chegando como 42501 cai no fluxo normal)", () => {
    expect(mensagemErro({ code: "42501", message: "ref_nao_interno: x" }, "fallback")).not.toBe(MENSAGENS_REGERAR.ref_nao_interno);
  });
});
