// R10 fin #6 (front): regras de exibição do selo "ajustado à mão" e da ação "Voltar ao cálculo automático"
// na aba Serviços do Financeiro (espelha a OC; a RPC `parcela_servico_voltar_vencimento_automatico` recusa parcela paga).
export type StatusParcelaServico = "pago" | "vencido" | "a_pagar";

export function mostraAjustadoMaoServico(manual: boolean | null | undefined, st: StatusParcelaServico): boolean {
  return !!manual && st !== "pago";
}

export function mostraVoltarAutomaticoServico(
  manual: boolean | null | undefined,
  st: StatusParcelaServico,
  podeEditar: boolean,
): boolean {
  return mostraAjustadoMaoServico(manual, st) && podeEditar;
}
