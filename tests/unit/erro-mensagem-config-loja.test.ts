import { describe, it, expect } from "vitest";
import { mensagemErro } from "@/lib/erro-mensagem";
import { MENSAGEM_CHAVE_KANBAN_MUDOU } from "@/lib/kanban-auto-config";

// Config da Loja colaborativa (T3): textos das recusas da RPC `salvar_config_loja` (t1-report.md).
describe("mensagemErro — Config da Loja (salvar_config_loja)", () => {
  it("P0409 conflito_versao: config_loja → texto PT (fallback genérico; a tela usa os rótulos das colunas)", () => {
    expect(mensagemErro({ code: "P0409", message: "conflito_versao: config_loja", details: "keywords,timezone" })).toBe(
      "Outra pessoa salvou a Configuração da Loja agora há pouco. Confira os itens em destaque e salve de novo.",
    );
  });
  it("P0409 chave_kanban_mudou: → a mesma mensagem da tela", () => {
    expect(mensagemErro({ code: "P0409", message: "chave_kanban_mudou: a chave do kanban mudou" })).toBe(MENSAGEM_CHAVE_KANBAN_MUDOU);
  });
  it("42501 próprio da RPC mostra o motivo real (não o genérico)", () => {
    const m = "Apenas o administrador da loja pode salvar a Configuração da Loja.";
    expect(mensagemErro({ code: "42501", message: m })).toBe(m);
  });
  it("57014 (statement_timeout) → nada foi gravado, tente de novo", () => {
    expect(mensagemErro({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(
      "O salvamento demorou demais e foi cancelado — nada foi gravado. Tente de novo em instantes.",
    );
  });
  it("P0409 de outro domínio segue no genérico de sempre", () => {
    expect(mensagemErro({ code: "P0409", message: "conflito_versao: modelos" })).toBe(
      "Outra pessoa salvou este registro agora há pouco. A tela foi atualizada — confira suas alterações e salve de novo.",
    );
  });
  it("P0001 da RPC passa direto (já vem em PT)", () => {
    const m = "A loja ativa mudou. Recarregue a página antes de salvar.";
    expect(mensagemErro({ code: "P0001", message: m })).toBe(m);
  });
});
