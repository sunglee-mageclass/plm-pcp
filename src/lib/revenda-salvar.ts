// Decisão pura "o que o Salvar manda para a revenda" (extraída dos onBlur de RevendaSetores).
// markup e preço fixo são mutuamente exclusivos POR CANAL no servidor; aqui só decidimos o que
// ENVIAR. Canal varejo travado pela Integração nunca recebe valor novo.
import { markupCanalIntocado } from "@/components/produto-acabado/shared";

export type RevendaBase = { markup_atacado: number | null; markup_varejo: number | null; preco_atacado: number | null; preco_venda: number | null };
export type RevendaRascunho = { markupAtacado: number | null; markupVarejo: number | null; precoAtacadoFixo: number | null; precoVarejoFixo: number | null };
export type MarkupEnviado = { valor: number | null; servidorAntes: number | null | undefined } | null;
export type PayloadRevenda = {
  markups: { markup_atacado: number | null; markup_varejo: number | null } | null;
  fixos: { tocarAtacado: boolean; precoAtacado: number | null; tocarVarejo: boolean; precoVarejo: number | null } | null;
};

export function payloadRevendaParaSalvar(
  base: RevendaBase,
  rasc: RevendaRascunho,
  travaVarejo: boolean,
  enviadoAtacado: MarkupEnviado,
  enviadoVarejo: MarkupEnviado,
): PayloadRevenda {
  // MARKUPS: manda se o canal editável mudou vs. base. O canal não-tocado vai pelo markupCanalIntocado
  // (reenvia o último enviado nesta sessão, não o valor velho do servidor pré-refetch). Varejo travado:
  // sempre o valor do servidor (base.markup_varejo), nunca o rascunho.
  const atacadoMudou = rasc.markupAtacado !== base.markup_atacado;
  const varejoMudou = !travaVarejo && rasc.markupVarejo !== base.markup_varejo;
  let markups: PayloadRevenda["markups"] = null;
  if (atacadoMudou || varejoMudou) {
    markups = {
      markup_atacado: atacadoMudou ? rasc.markupAtacado : markupCanalIntocado(base.markup_atacado, rasc.markupAtacado, enviadoAtacado),
      markup_varejo: travaVarejo
        ? base.markup_varejo
        : varejoMudou ? rasc.markupVarejo : markupCanalIntocado(base.markup_varejo, rasc.markupVarejo, enviadoVarejo),
    };
  }

  // FIXOS: só o canal cujo preço fixo mudou é "tocado". Varejo travado nunca é tocado.
  const atacadoFixoMudou = rasc.precoAtacadoFixo !== base.preco_atacado;
  const varejoFixoMudouDraft = rasc.precoVarejoFixo !== base.preco_venda;
  let fixos: PayloadRevenda["fixos"] = null;
  if (atacadoFixoMudou || varejoFixoMudouDraft) {
    fixos = {
      tocarAtacado: atacadoFixoMudou,
      precoAtacado: atacadoFixoMudou ? rasc.precoAtacadoFixo : null,
      tocarVarejo: !travaVarejo && varejoFixoMudouDraft,
      precoVarejo: !travaVarejo && varejoFixoMudouDraft ? rasc.precoVarejoFixo : null,
    };
  }

  return { markups, fixos };
}
