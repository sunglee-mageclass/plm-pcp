// "Fazer pedido" do Produto Acabado — as CHAMADAS ao servidor ([urg R13 T6]). O pedido nasce no assistente
// (`PedidoOcLoteWizard`, rodapé / selecionados / card): UMA chamada `fazer_pedido_p_acabado` cria TODAS as OCs numa transação
// (tudo ou nada); o servidor monta o item de cada produto a partir do produto SALVO — aqui só vão ids e cabeçalho.
import { supabase } from "@/integrations/supabase/client";
import type { OcCriadaLote, PedidoOc } from "@/lib/pedido-oc-lote";
import { EMBED_OC_ITEM_PA, ocInfoDeItens, type OcItemEmbedRow, type OcProdutoInfo } from "@/lib/oc-produto-vinculo";

/** `fazer_pedido_p_acabado(_pedidos)` → `[{oc_id, numero, produto_ids}]`. Lança o erro da RPC (nada é criado). */
export async function fazerPedidoAcabado(pedidos: PedidoOc[]): Promise<OcCriadaLote[]> {
  const { data, error } = await supabase.rpc("fazer_pedido_p_acabado" as any, { _pedidos: pedidos });
  if (error) throw error;
  return ((data ?? []) as OcCriadaLote[]).map((o) => ({ oc_id: o.oc_id, numero: o.numero, produto_ids: o.produto_ids ?? [] }));
}

/** Relê a OC (item + cabeçalho + nº de produtos) dos produtos — o patch local que faz o card mostrar o chip sem esperar o refetch. */
export async function lerOcsDosProdutosAcabados(ids: string[]): Promise<Array<{ id: string; rev: number; oc: OcProdutoInfo | null }>> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("produtos_acabados" as any).select(`id, rev, ${EMBED_OC_ITEM_PA}`).in("id", ids);
  if (error) throw error;
  return ((data ?? []) as unknown as Array<{ id: string; rev: number | string | null; oc_item?: OcItemEmbedRow[] | null }>).map((r) => ({
    id: r.id,
    rev: Number(r.rev) || 0,
    oc: ocInfoDeItens(r.oc_item, "acabado"),
  }));
}
