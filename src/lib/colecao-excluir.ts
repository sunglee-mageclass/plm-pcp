/**
 * Excluir coleção do OTB (Modularidade, P-255 A) — texto PURO do aviso do AlertDialog.
 *
 * Regra do servidor (`otb_excluir_colecao`, T2): coleção com QUALQUER card no Planejamento é RECUSADA
 * (`colecao_com_cards: N`) e nenhum card é apagado junto. Sem cards, apaga a coleção, as semanas e o plano de
 * tecido dela. A tela consulta os cards ao pedir Excluir e, havendo cards, mostra quantos/quais e NÃO oferece confirmar.
 */
export type CardDaColecao = { id: string; nome: string | null; ref: string | null };

/** Quantos cards a lista do aviso mostra (o resto vira "… e mais K"). */
export const LIMITE_LISTA_CARDS = 20;

export type AvisoExclusaoColecao = {
  /** Há card na coleção: a exclusão é recusada e a tela não oferece o botão de confirmar. */
  bloqueada: boolean;
  /** Frase principal (cabe no AlertDialogDescription). */
  mensagem: string;
  /** Uma linha por card mostrado ("REF · Nome"), até `limite`. */
  itens: string[];
  /** "… e mais K" quando N passa do que a lista mostra; senão `null`. */
  maisTexto: string | null;
};

/** "REF · Nome" (ou só um dos dois; "Card sem nome" quando não há nenhum). */
export function rotuloCardDaColecao(c: Pick<CardDaColecao, "nome" | "ref">): string {
  const ref = (c.ref ?? "").trim();
  const nome = (c.nome ?? "").trim();
  if (ref && nome) return `${ref} · ${nome}`;
  return ref || nome || "Card sem nome";
}

/**
 * `n` = total de cards da coleção (`count: "exact"`); `lista` = os cards trazidos (até `limite`).
 * N = 0 → aviso do AlertDialog de hoje + o plano de tecido também é apagado.
 */
export function avisoExclusaoColecao(n: number, lista: CardDaColecao[], limite = LIMITE_LISTA_CARDS): AvisoExclusaoColecao {
  if (n > 0) {
    const itens = lista.slice(0, limite).map(rotuloCardDaColecao);
    const resto = n - itens.length;
    return {
      bloqueada: true,
      mensagem: `Esta coleção tem ${n} ${n === 1 ? "card" : "cards"} no Planejamento — mova ou exclua os cards antes de excluir a coleção.`,
      itens,
      maisTexto: resto > 0 ? `… e mais ${resto}` : null,
    };
  }
  return {
    bloqueada: false,
    mensagem:
      "Exclui a coleção e as semanas dela. O plano de tecido desta coleção também será apagado. Esta ação não pode ser desfeita.",
    itens: [],
    maisTexto: null,
  };
}
