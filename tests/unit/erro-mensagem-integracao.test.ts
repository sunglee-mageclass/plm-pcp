import { describe, it, expect } from "vitest";
import { mensagemErro } from "@/lib/erro-mensagem";

describe("mensagemErro — recusas da Integração (traduz pelo code + prefixo ASCII)", () => {
  it("trava de campo", () => {
    expect(mensagemErro({ code: "42501", message: "integracao_travado: nome" })).toBe(
      'Produto travado pela Integração (integrável ou integrado): "Nome" não pode mudar. Volte para não integrável na tela Integração (ou, se já integrado, peça ao super admin para desfazer).');
    expect(mensagemErro({ code: "42501", message: "integracao_travado: tamanho_tipo" })).toMatch(/"Tamanho em" não pode mudar/);
  });
  it("trava de exclusão", () => {
    expect(mensagemErro({ code: "42501", message: "integracao_travado: excluir" })).toBe(
      "Produto travado pela Integração (integrável ou integrado). Volte para não integrável na tela Integração antes de excluir.");
  });
  it("permissão de campo, custo, conflitos", () => {
    // Fix round 1 T12b (revisão A-I4/B-I7 b): a mensagem NOMEIA o campo — antes dizia só "este campo", genérico
    // demais pra achar a célula certa num lote de até 50 produtos.
    expect(mensagemErro({ code: "42501", message: "integracao_sem_permissao: preco_venda" }))
      .toBe('Você não tem permissão para editar "Preço de venda" (mesma regra do card do produto).');
    expect(mensagemErro({ code: "42501", message: "integracao_sem_custo: x" })).toBe('Com "Preço de custo" marcado, só integra quem pode ver custos.');
    expect(mensagemErro({ code: "P0409", message: "integracao_mudou: produto x mudou desde o resumo" }))
      .toBe("O produto mudou desde o resumo (outra pessoa editou, integrou ou voltou). Confira o resumo novo e confirme de novo.");
    // Fix round 2 T12b (minor m6): "O texto foi recarregado" ficou falso pro caminho corrigido de
    // `KeywordsDialog.tsx` (o texto digitado nunca é tocado) — texto atualizado pra descrever o que de fato acontece.
    expect(mensagemErro({ code: "P0409", message: "keywords_mudou: as keywords da loja mudaram" }))
      .toBe("Outra pessoa mudou as Keywords da loja enquanto você editava. Confira o valor mais recente e salve de novo.");
    expect(mensagemErro({ code: "P0409", message: "conflito_versao: o produto foi salvo por outra pessoa" })).toMatch(/Outra pessoa salvou/);
  });
  it("42501 próprios da Integração mostram o motivo real", () => {
    expect(mensagemErro({ code: "42501", message: "Só o super admin pode fazer isto." })).toBe("Só o super admin pode fazer isto.");
    expect(mensagemErro({ code: "42501", message: "Sem permissão para editar a Integração." })).toBe("Sem permissão para editar a Integração.");
  });
});

// Revisão T5 Minor 4: 40P01 (deadlock detected) pode acontecer quando o mesmo produto comprado
// (revenda/importado) é salvo simultaneamente pelo Sheet do Planejamento e pela tela de Produto
// Acabado/Importado.
describe("mensagemErro — 40P01 (deadlock, ruling T5 Minor 4)", () => {
  it("deadlock detected vira mensagem PT amigável", () => {
    expect(mensagemErro({ code: "40P01", message: "deadlock detected" }))
      .toBe("Outra pessoa salvou ou excluiu este produto ao mesmo tempo. Nada foi gravado — tente de novo.");
  });
  // M2 (G-migration da frente Preço anterior/Título por versão): 2 pessoas excluindo versões da MESMA família no mesmo
  // instante podem cair num deadlock (a vítima recebe o 40P01 CRU no DELETE, fora do P0001 do congelamento) — o PostgREST
  // devolve o código; a tela mostra "tente de novo", nunca o genérico nem o inglês.
  it("M2: deadlock ao EXCLUIR (DELETE de versões da mesma família) vira 'tente de novo' em PT", () => {
    const m = mensagemErro({ code: "40P01", message: "deadlock detected", details: "Process 123 waits for ShareLock on transaction 456" }, "Não foi possível excluir.");
    expect(m).toMatch(/tente de novo/);
    expect(m).toMatch(/excluiu/);
    expect(m).not.toMatch(/deadlock/i);
  });
});

describe("mensagemErro — Gerar JSON (prefixos ASCII P0001 traduzidos; teto vem da mensagem)", () => {
  it("os 6 prefixos", () => {
    expect(mensagemErro({ code: "P0001", message: "gerar_json_loja_mudou: loja ativa diferente" }))
      .toBe("A loja ativa mudou (em outra aba ou janela). Recarregue a página antes de salvar.");
    expect(mensagemErro({ code: "P0001", message: "gerar_json_itens: envie de 1 a 50 produtos" })).toBe("Selecione de 1 a 50 produtos.");
    expect(mensagemErro({ code: "P0001", message: "gerar_json_itens: produto repetido" })).toBe("Selecione os produtos sem repetir.");
    expect(mensagemErro({ code: "P0001", message: "gerar_json_loja: produto nao encontrado nesta loja" }))
      .toBe("Algum produto selecionado não é desta loja. Recarregue a página.");
    expect(mensagemErro({ code: "P0001", message: "gerar_json_limite: aguarde 12 s" }))
      .toBe("Muitas gerações em pouco tempo. Espere um minuto e tente de novo.");
    expect(mensagemErro({ code: "P0001", message: "gerar_json_desligado: recurso desligado" })).toBe("O Gerar JSON está desligado no momento.");
  });
  it("nota 1 do revisor: sem 100 fixo — o número vem da mensagem; sem número, texto genérico", () => {
    expect(mensagemErro({ code: "P0001", message: "gerar_json_itens: envie de 1 a 20 produtos" })).toBe("Selecione de 1 a 20 produtos.");
    expect(mensagemErro({ code: "P0001", message: "gerar_json_itens: algo novo" })).not.toMatch(/\d/);
  });
  it("gerar_json_falhou (qualquer code, vindo da server function) e função ausente (banco velho)", () => {
    const falhou = "Não foi possível concluir a geração. Nenhum arquivo foi entregue; confira a lista e tente de novo.";
    expect(mensagemErro({ code: "ERRO_INTERNO", message: "gerar_json_falhou" })).toBe(falhou);
    expect(mensagemErro({ code: "P0001", message: "gerar_json_falhou: confirmacao" })).toBe(falhou);
    expect(mensagemErro({ code: "PGRST202", message: "Could not find the function public.integracao_gerar_json_ler(_loja, _modelo_ids) in the schema cache" }))
      .toMatch(/ainda não está disponível/);
  });
  it("o texto de loja mudou é o MESMO de useIntegracao (anti-drift)", async () => {
    const { TEXTO_LOJA_MUDOU } = await import("@/components/integracao/useIntegracao");
    expect(mensagemErro({ code: "P0001", message: "gerar_json_loja_mudou: x" })).toBe(TEXTO_LOJA_MUDOU);
  });
});
