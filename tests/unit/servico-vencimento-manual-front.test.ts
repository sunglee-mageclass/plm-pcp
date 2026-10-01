// R10 fin #6 (front): aba Serviços do Financeiro — selo "ajustado à mão" + "Voltar ao cálculo automático".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mensagemErro } from "@/lib/erro-mensagem";
import { mostraAjustadoMaoServico, mostraVoltarAutomaticoServico } from "@/lib/servico-vencimento-manual";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const fin = readFileSync(ROOT + "src/routes/_authenticated/financeiro.tsx", "utf8");

describe("selo 'ajustado à mão' (Serviços)", () => {
  it("aparece só com vencimento_manual e parcela não paga", () => {
    expect(mostraAjustadoMaoServico(true, "a_pagar")).toBe(true);
    expect(mostraAjustadoMaoServico(true, "vencido")).toBe(true);
    expect(mostraAjustadoMaoServico(false, "a_pagar")).toBe(false);
    expect(mostraAjustadoMaoServico(undefined, "a_pagar")).toBe(false);
    expect(mostraAjustadoMaoServico(true, "pago")).toBe(false);
  });
});

describe("ação 'Voltar ao cálculo automático' (Serviços)", () => {
  it("só com marca, não paga e com permissão de editar", () => {
    expect(mostraVoltarAutomaticoServico(true, "a_pagar", true)).toBe(true);
    expect(mostraVoltarAutomaticoServico(true, "vencido", true)).toBe(true);
    expect(mostraVoltarAutomaticoServico(true, "pago", true)).toBe(false);
    expect(mostraVoltarAutomaticoServico(true, "a_pagar", false)).toBe(false);
    expect(mostraVoltarAutomaticoServico(false, "a_pagar", true)).toBe(false);
  });
  it("fonte: ServicosView usa os helpers, chama a RPC, confirma em AlertDialog e invalida servicos-financeiro", () => {
    const i = fin.indexOf("function ServicosView()");
    const bloco = fin.slice(i, fin.indexOf("function ServicoDetailDialog", i));
    expect(bloco).toMatch(/mostraAjustadoMaoServico\(/);
    expect(bloco).toMatch(/mostraVoltarAutomaticoServico\(/);
    expect(bloco).toMatch(/"parcela_servico_voltar_vencimento_automatico" as any, \{ _parcela_id:/);
    expect(bloco).toMatch(/<AlertDialogTitle>Voltar ao cálculo automático\?<\/AlertDialogTitle>/);
    expect(bloco).toMatch(/data-testid="srv-venc-ajustado-mao"/);
    expect(bloco).toMatch(/data-testid="srv-venc-voltar-automatico"/);
    expect(bloco).toMatch(/from\("parcelas_servico" as any\)\.select\("id, vencimento_manual"\)/);
    expect(bloco).toMatch(/invalidateQueries\(\{ queryKey: \["servicos-financeiro"\] \}\)/);
  });
});

describe("mensagemErro — RPC parcela_servico_voltar_vencimento_automatico", () => {
  const casos: [string, string, RegExp][] = [
    ["P0001", "parcela_paga: o vencimento de parcela paga nao muda", /já está paga/],
    ["P0001", "parcela_nao_encontrada: parcela inexistente ou de outra loja", /não existe mais/],
    ["P0001", "servico_nao_encontrado: o servico desta parcela nao existe nesta loja", /serviço desta parcela não foi encontrado/],
    ["P0001", "servico_sem_data_base: o servico nao tem data de entrega nem de envio para calcular o vencimento", /sem data de entrega nem de envio/],
    ["42501", "Sem permissao para editar os Servicos do Financeiro", /permissão para editar os Serviços do Financeiro/],
  ];
  it.each(casos)("%s %s → PT-BR", (code, message, re) => {
    const r = mensagemErro({ code, message });
    expect(r).toMatch(re);
    expect(r).not.toMatch(/^[a-z_]+:/);
  });
});
