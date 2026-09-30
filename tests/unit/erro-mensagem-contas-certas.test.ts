// Contas certas (fix round 2, R1-L2): as recusas ASCII com prefixo das RPCs/gatilhos novos viram texto PT na tela.
// As mensagens abaixo são as EXATAS do banco (migrations 20261019210000 e 20261019220000); a última asserção confere
// que cada prefixo traduzido ainda existe no SQL (anti-drift banco × tela).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mensagemErro, MENSAGENS_CONTAS_CERTAS, TEXTO_SESSAO_EXPIRADA } from "@/lib/erro-mensagem";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SQL =
  readFileSync(ROOT + "supabase/migrations/20261019210000_servico_parcela_valor_pago.sql", "utf8") +
  readFileSync(
    ROOT + "supabase/migrations/20261019220000_parcela_voltar_vencimento_automatico.sql",
    "utf8",
  );

const CASOS: [string, string, string][] = [
  [
    "P0001",
    "parcela_paga: o vencimento de parcela paga nao muda",
    MENSAGENS_CONTAS_CERTAS.parcela_paga,
  ],
  [
    "P0001",
    "parcela_nao_encontrada: parcela inexistente ou de outra loja",
    MENSAGENS_CONTAS_CERTAS.parcela_nao_encontrada,
  ],
  [
    "P0001",
    "oc_nao_encontrada: a OC desta parcela nao existe",
    MENSAGENS_CONTAS_CERTAS.oc_nao_encontrada,
  ],
  ["P0001", "tipo_oc_sem_regra: xyz", MENSAGENS_CONTAS_CERTAS.tipo_oc_sem_regra],
  [
    "P0001",
    "parcela_fora_do_prazo: esta parcela saiu do prazo atual do servico - recarregue a tela antes de pagar",
    MENSAGENS_CONTAS_CERTAS.parcela_fora_do_prazo,
  ],
  [
    "P0001",
    "parcela_servico_outra_loja: a parcela nao e da loja do servico",
    MENSAGENS_CONTAS_CERTAS.parcela_servico_outra_loja,
  ],
  [
    "42501",
    "Sem permissao para editar o Financeiro",
    MENSAGENS_CONTAS_CERTAS.sem_permissao_financeiro,
  ],
  [
    "42501",
    "Modulo financeiro nao habilitado para esta loja",
    MENSAGENS_CONTAS_CERTAS.modulo_financeiro_desligado,
  ],
  ["42501", "Nao autenticado", TEXTO_SESSAO_EXPIRADA],
];

describe("mensagemErro — recusas novas do Contas certas (A2 e P-171)", () => {
  it.each(CASOS)("%s %s → texto PT", (code, message, esperado) => {
    const r = mensagemErro({ code, message });
    expect(r).toBe(esperado);
    expect(r).not.toMatch(/^[a-z_]+:/); // nada de prefixo técnico na tela
  });

  it("os textos são PT com acento (não repassa o ASCII do banco)", () => {
    expect(MENSAGENS_CONTAS_CERTAS.parcela_paga).toMatch(/já está paga/);
    expect(MENSAGENS_CONTAS_CERTAS.parcela_fora_do_prazo).toMatch(/serviço/);
  });

  it("P0001 de outros domínios continua passando direto", () => {
    const m = "A loja ativa mudou. Recarregue a página antes de salvar.";
    expect(mensagemErro({ code: "P0001", message: m })).toBe(m);
  });

  it("anti-drift: cada mensagem traduzida existe no SQL das migrations", () => {
    for (const [, message] of CASOS) {
      const chave = message.includes(":") ? message.slice(0, message.indexOf(":") + 1) : message;
      expect(SQL, chave).toContain(chave === "tipo_oc_sem_regra:" ? "tipo_oc_sem_regra: %" : chave);
    }
  });
});
