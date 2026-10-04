/**
 * Excluir coleção do OTB (Modularidade, P-255 A) — texto PURO do aviso do AlertDialog.
 *
 * Regra do servidor (`otb_excluir_colecao`, T2): coleção com QUALQUER card no Planejamento é RECUSADA
 * (`colecao_com_cards: N`) e nenhum card é apagado junto. Sem cards, apaga a coleção, as semanas e o plano de
 * tecido dela. A tela consulta os cards ao pedir Excluir e, havendo cards, mostra quantos/quais e NÃO oferece confirmar.
 * Coleção ligada só a produto acabado/importado (sem cards): a FK recusa no servidor; a tela conta esses produtos e recusa
 * antes, no mesmo diálogo (m5 da revisão da F3).
 */
import { textoColecaoComCards, TEXTO_COLECAO_EM_USO_POR_PRODUTO } from "@/lib/erro-mensagem";

export type CardDaColecao = { id: string; nome: string | null; ref: string | null };

/** Quantos cards a lista do aviso mostra (o resto vira "… e mais K"). */
export const LIMITE_LISTA_CARDS = 20;

export type AvisoExclusaoColecao = {
  /** Há card (ou produto acabado/importado) na coleção: a exclusão é recusada e a tela não oferece o botão de confirmar. */
  bloqueada: boolean;
  /** Frase principal (cabe no AlertDialogDescription). */
  mensagem: string;
  /** Uma linha por card mostrado ("REF · Nome"), até `limite`. */
  itens: string[];
  /** "… e mais K" quando N passa do que a lista mostra; senão `null`. */
  maisTexto: string | null;
  /** Frase dos produtos acabados/importados que seguram a coleção (quando há); senão `null`. */
  produtosTexto: string | null;
};

/** "REF · Nome" (ou só um dos dois; "Card sem nome" quando não há nenhum). */
export function rotuloCardDaColecao(c: Pick<CardDaColecao, "nome" | "ref">): string {
  const ref = (c.ref ?? "").trim();
  const nome = (c.nome ?? "").trim();
  if (ref && nome) return `${ref} · ${nome}`;
  return ref || nome || "Card sem nome";
}

/**
 * `n` = total de cards da coleção (`count: "exact"`); `lista` = os cards trazidos (até `limite`);
 * `nProdutos` = produtos acabados + importados da coleção (fora do Planejamento).
 * N = 0 e sem produtos → aviso do AlertDialog de hoje + o plano de tecido também é apagado.
 */
export function avisoExclusaoColecao(n: number, lista: CardDaColecao[], limite = LIMITE_LISTA_CARDS, nProdutos = 0): AvisoExclusaoColecao {
  const produtosTexto =
    nProdutos > 0
      ? `${TEXTO_COLECAO_EM_USO_POR_PRODUTO} (${nProdutos} ${nProdutos === 1 ? "produto" : "produtos"})`
      : null;
  if (n > 0) {
    const itens = lista.slice(0, limite).map(rotuloCardDaColecao);
    const resto = n - itens.length;
    return {
      bloqueada: true,
      mensagem: textoColecaoComCards(n), // MESMO texto do erro do servidor (`colecao_com_cards:`) — fonte única
      itens,
      maisTexto: resto > 0 ? `… e mais ${resto}` : null,
      produtosTexto,
    };
  }
  if (produtosTexto) {
    return { bloqueada: true, mensagem: produtosTexto, itens: [], maisTexto: null, produtosTexto: null };
  }
  return {
    bloqueada: false,
    mensagem:
      "Exclui a coleção e as semanas dela. O plano de tecido desta coleção também será apagado. Esta ação não pode ser desfeita.",
    itens: [],
    maisTexto: null,
    produtosTexto: null,
  };
}
