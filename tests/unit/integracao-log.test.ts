import { describe, it, expect } from "vitest";
import { brl } from "@/lib/format";
import { ROTULO_ACAO, lerLog, textoDetalhe } from "@/lib/integracao/log";

const l = (acao: string, detalhe: unknown) => lerLog({ pagina: 1, por_pagina: 50, total: 1, super: true,
  linhas: [{ id: "1", acao, quem: "Marina Alves", quando: "2026-09-26T18:10:00Z", modelo_id: "m", modelo_nome: "Calça Duna", detalhe }] }).linhas[0];

describe("Log — detalhe legível (mockup 8)", () => {
  it("ações de produto", () => {
    expect(textoDetalhe(l("integrar", { campos: 18, sublinhas: 6 }))).toBe("Retrato com 18 campos + 6 sublinhas");
    expect(textoDetalhe(l("integrado", { chave: "ERP Principal", final: "a1b2" }))).toBe("A API confirmou a entrega");
    expect(textoDetalhe(l("voltar", {}))).toBe("Voltou para não integrável");
    expect(textoDetalhe(l("desfazer", { motivo: "NCM errado" }))).toBe('Motivo: "NCM errado"');
    expect(textoDetalhe(l("editar", { campos: { peso_kg: { antes: 0.65, depois: 0.68 }, preco_venda: { antes: 100, depois: 120 } } })))
      .toBe(`Peso: 0,650 kg → 0,680 kg · Preço de venda: ${brl(100)} → ${brl(120)} (salvo)`);
    expect(textoDetalhe(l("editar", { keywords: { antes: "a", depois: "a, b" } }))).toBe('Keywords da loja: "a" → "a, b" (salvo)');
    // P-126: reprocessamento cirúrgico do nome das sublinhas (Sistema, ao trocar "Cor no nome da sublinha").
    expect(textoDetalhe(l("editar", { reprocesso: "nome_sublinhas_cor", cor_no_nome: "cor_apelido", sublinhas: 6, exemplo: { antes: "Saia Marola P", depois: "Saia Marola Preto P" } })))
      .toBe('Nome das sublinhas atualizado com a cor: "Saia Marola P" → "Saia Marola Preto P" (6 sublinhas)');
    // Follow-up do controlador: o banco loga TODO integrável reprocessado, mesmo sem mudança de nome
    // (sublinhas:0, nomes_antes:[], exemplo:null) — texto próprio, nunca "→ ... (0 sublinhas)".
    expect(textoDetalhe(l("editar", { reprocesso: "nome_sublinhas_cor", cor_no_nome: "cor_base", sublinhas: 0, nomes_antes: [], exemplo: null })))
      .toBe("Retrato atualizado com a regra nova do nome (sem mudança de nome)");
  });
  it("ações do super admin", () => {
    expect(textoDetalhe(l("campos", { antes: ["nome"], depois: ["nome", "foto"] }))).toBe('Adicionado "Foto do Modelo" à seleção');
    expect(textoDetalhe(l("campos", { antes: ["nome", "ncm"], depois: ["nome"] }))).toBe('Removido "NCM" da seleção');
    expect(textoDetalhe(l("config_api", { antes: { bloqueio_tentativas: 10, limite_por_minuto: 60 }, depois: { bloqueio_tentativas: 20, limite_por_minuto: 60 } })))
      .toBe("Bloqueio de IP: 10 → 20");
    expect(textoDetalhe(l("chave_criar", { nome: "ERP Principal", final: "a1b2" }))).toBe('Chave "ERP Principal" criada');
    expect(textoDetalhe(l("chave_revogar", { nome: "Integração antiga", final: "90ce" }))).toBe('Chave "Integração antiga" revogada');
    expect(ROTULO_ACAO.config_api).toBe("Config. API");
  });
});
