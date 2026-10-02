// Item da OC de Aviamento — regras puras da release L9 (achados LEVES; respostas do dono de 01/out).
//   • P-206 A (fin #8): o item guarda o PREÇO DA COMPRA (`ocs_aviamento_itens.preco`), preenchido com o cadastro ao escolher
//     o aviamento e editável. `null` = item legado: vale o preço do CADASTRO (mesma regra do banco:
//     COALESCE(it.preco, aviamentos.preco, 0) em gerar_parcelas_oc_aviamento / _recalcular_parcelas_core /
//     _dashboard_financeiro_core).
//   • P-208 A (est #5): aviamento com 2+ cores (variantes) exige a cor no item NOVO ou EDITADO; item antigo sem cor e NÃO
//     mexido (ex.: FRANJA 00003118, Ave Rara) só mostra o aviso — não trava o Salvar do resto da OC. Item cancelado não exige.
//     Espelha a recusa do servidor (`_salvar_oc_aviamento_core`, P0001 `oc_aviamento_cor_obrigatoria:`).

export type ItemOcAviamento = {
  id?: string;
  aviamento_id: string;
  variante_aviamento_id: string | null;
  quantidade_pedida: number;
  quantidade_recebida: number | null;
  cancelado: boolean;
  preco: number | null;
};

/**
 * Preço do CADASTRO para o item (P-216 A, dono 02/out): o da COR (`variantes_aviamento.preco`) quando existe e é > 0,
 * senão o geral do aviamento (`aviamentos.preco`) — espelha o tecido (COALESCE(variante, artigo)) e o banco
 * (`COALESCE(it.preco, CASE WHEN va.preco > 0 THEN va.preco END, a.preco, 0)`).
 */
export function precoCadastroAviamento(
  precoGeral: number | string | null | undefined,
  precoCor: number | string | null | undefined,
): number | null {
  const cor = precoCor == null ? null : Number(precoCor);
  if (cor != null && Number.isFinite(cor) && cor > 0) return cor;
  const geral = precoGeral == null ? null : Number(precoGeral);
  return geral != null && Number.isFinite(geral) ? geral : null;
}

/** Preço unitário que vale para o item: o da compra; sem ele (legado), o do cadastro; sem nenhum, 0. */
export function precoEfetivoItem(
  it: Pick<ItemOcAviamento, "preco">,
  precoCadastro: number | null | undefined,
): number {
  const p = it.preco ?? precoCadastro ?? 0;
  return Number.isFinite(Number(p)) ? Number(p) : 0;
}

/** Item ATIVO sem cor de um aviamento com 2+ cores (variantes) cadastradas. */
export function itemSemCorObrigatoria(
  it: Pick<ItemOcAviamento, "aviamento_id" | "variante_aviamento_id" | "cancelado">,
  nVariantes: number,
): boolean {
  return !!it.aviamento_id && !it.cancelado && !it.variante_aviamento_id && nVariantes >= 2;
}

const num = (v: number | null | undefined) => (v == null ? null : Number(v));

/**
 * O item mudou em relação ao que está gravado no servidor (`base`)? Item sem `base` (novo) = sim.
 * Mesmos campos que o servidor compara: aviamento, cor, quantidades, cancelado e preço EFETIVO (vazio = cadastro).
 */
export function itemEditado(
  it: ItemOcAviamento,
  base: ItemOcAviamento | undefined,
  precoCadastro: number | null | undefined,
): boolean {
  if (!it.id || !base) return true;
  return (
    it.aviamento_id !== base.aviamento_id ||
    (it.variante_aviamento_id ?? null) !== (base.variante_aviamento_id ?? null) ||
    !!it.cancelado !== !!base.cancelado ||
    num(it.quantidade_pedida) !== num(base.quantidade_pedida) ||
    num(it.quantidade_recebida) !== num(base.quantidade_recebida) ||
    precoEfetivoItem(it, precoCadastro) !== precoEfetivoItem(base, precoCadastro)
  );
}

/** Situação da cor do item: "ok" | "aviso" (legado não mexido — não trava) | "bloqueia" (novo/editado — trava o Salvar). */
export function situacaoCorItem(
  it: ItemOcAviamento,
  nVariantes: number,
  base: ItemOcAviamento | undefined,
  precoCadastro: number | null | undefined,
): "ok" | "aviso" | "bloqueia" {
  if (!itemSemCorObrigatoria(it, nVariantes)) return "ok";
  return itemEditado(it, base, precoCadastro) ? "bloqueia" : "aviso";
}
