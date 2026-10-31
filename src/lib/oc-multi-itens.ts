// [urg R13 T7] Regras PURAS da OC com VÁRIOS produtos, comuns às duas famílias (Produto Acabado e Importado — a T8 reusa).
// Sem React e sem supabase: a tela só desenha o que estas funções devolvem. O servidor confere tudo de novo
// (`item_recebido_nao_sai:`, `oc_sem_produtos:`, `excluir_oc_*`); aqui só se evita oferecer o que ele recusaria.

export type StatusItemOc = "encomendado" | "recebido";

/** Textos aprovados no mockup R13 (superfície 3 · OC com vários produtos). */
export const TEXTO_ITEM_RECEBIDO_NAO_SAI = "Já recebido — não sai da OC";
export const TEXTO_UNICO_PRODUTO = "Único produto — exclua a OC para desvincular";
export const TEXTO_OC_COM_RECEBIDO_NAO_EXCLUI = "Há produto recebido — não dá para excluir a OC";
export const TEXTO_GRAVA_AO_SALVAR = "Estes dados são gravados ao salvar a OC. Marcar este produto como recebido é uma ação à parte (só ela libera o CQ e o Direcionamento).";

export const produtosTexto = (n: number): string => `${n} ${n === 1 ? "produto" : "produtos"}`;

/** Topo da OC: "X de N produtos recebidos" (singular com N = 1). */
export function textoRecebidos(recebidos: number, total: number): string {
  return `${recebidos} de ${total} ${total === 1 ? "produto recebido" : "produtos recebidos"}`;
}

export function contarRecebidos(itens: ReadonlyArray<{ status: StatusItemOc }>): { recebidos: number; total: number } {
  return { recebidos: itens.filter((i) => i.status === "recebido").length, total: itens.length };
}

/**
 * "Tirar da OC": `null` = pode; senão o motivo (texto do botão desabilitado). Recebido não sai (o servidor recusa
 * `item_recebido_nao_sai:`); o ÚNICO produto não sai — o caminho é excluir a OC (`oc_sem_produtos:`).
 * `nItens` conta os produtos da OC no rascunho (inclui os ainda não salvos).
 */
export function motivoNaoTirar(item: { status: StatusItemOc }, nItens: number): string | null {
  if (item.status === "recebido") return TEXTO_ITEM_RECEBIDO_NAO_SAI;
  if (nItens <= 1) return TEXTO_UNICO_PRODUTO;
  return null;
}

/** "Excluir OC": `null` = pode; com QUALQUER produto recebido o servidor recusa. */
export function motivoNaoExcluirOc(itens: ReadonlyArray<{ status: StatusItemOc }>): string | null {
  return itens.some((i) => i.status === "recebido") ? TEXTO_OC_COM_RECEBIDO_NAO_EXCLUI : null;
}

/** Coluna "Produtos" da lista: "Vestido Midi +2" (1º produto na ordem da OC + quantos mais). Sem produto = "—". */
export function textoProdutosDaOc(
  itens: ReadonlyArray<{ nome_produto: string | null; ordem?: number | null }>,
): string {
  if (itens.length === 0) return "—";
  const ord = [...itens].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  const nome = (ord[0].nome_produto ?? "").trim() || "Sem nome";
  return itens.length > 1 ? `${nome} +${itens.length - 1}` : nome;
}

type CelulaGrade = { pedida?: number | string | null; recebida?: number | string | null };
type ItemComGrade = {
  nome_produto: string | null;
  ordem?: number | null;
  grade_detalhe?: Record<string, Record<string, CelulaGrade | null | undefined> | null | undefined> | null;
};

/**
 * [urg R13 T9] Janela read-only da OC no Financeiro: achata a grade de CADA item (`grade_detalhe` = {ordem: {tamanho: {pedida,recebida}}})
 * em linhas `{ _nome, quantidade_pedida, quantidade_recebida }` — mesmo shape das OCs de tecido/aviamento/insumo.
 * Nome da linha = `nome do item · variante N · tamanho` (tamanho "UN" some). Itens na ordem da OC; sem grade = nenhuma linha.
 */
export function achatarGradeItensOc(
  itens: ReadonlyArray<ItemComGrade> | null | undefined,
): { _nome: string; quantidade_pedida: number; quantidade_recebida: number }[] {
  const ord = [...(itens ?? [])].sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  return ord.flatMap((it) =>
    Object.entries(it.grade_detalhe ?? {}).flatMap(([variante, porTamanho]) =>
      Object.entries(porTamanho ?? {}).map(([tamanho, g]) => ({
        _nome: `${(it.nome_produto ?? "").trim() || "—"} · variante ${variante}${tamanho && tamanho !== "UN" ? ` · ${tamanho}` : ""}`,
        quantidade_pedida: Number(g?.pedida ?? 0) || 0,
        quantidade_recebida: Number(g?.recebida ?? 0) || 0,
      })),
    ),
  );
}
