// "Fazer pedido" do Produto Importado — a CHAMADA que cria a OC. FONTE ÚNICA do card (`ProdutoImportadoCard.fazerPedidoMut`) e do
// pedido em lote ([urg R13], `ProdutoImportadoSheet`): o payload sai de `montarDadosOcImportado` e a grade de
// `gradePedidaDeVariantes` (puros) — nada é montado duas vezes. Quem chama decide ANTES as guardas e o salvar do produto sujo,
// e DEPOIS o que fazer com a OC (navegar no card; patch do rascunho no lote).
import { supabase } from "@/integrations/supabase/client";
import { gradePedidaDeVariantes } from "@/components/produto-acabado/shared";
import { montarDadosOcImportado, type OcImportadoInfo, type ProdutoImportadoDraft } from "./shared";

/** Cria a OC do produto importado (`salvar_oc_importado`, `_id: null`, `_etapas: []` = a RPC COPIA o cronograma atual do card) e
 *  devolve o id. Grade "pedida" = variantes/proporção atuais, pelo mesmo helper puro da revenda. */
export async function criarOcProdutoImportado(draft: ProdutoImportadoDraft, produtoId: string, acessorio: boolean): Promise<string> {
  const grade = gradePedidaDeVariantes(draft.variantes, draft.grade_proporcao, acessorio);
  const dadosOc = montarDadosOcImportado(draft, produtoId, new Date().toISOString().slice(0, 10));
  const { data: ocId, error } = await supabase.rpc("salvar_oc_importado" as any, {
    _id: null,
    _dados: dadosOc,
    _grade: grade,
    _etapas: [],
  });
  if (error) throw error;
  return ocId as string;
}

/** Relê nº/status da OC recém-criada (gerados por trigger) — só o pedido em lote precisa (o card navega pra OC). */
export async function lerOcImportado(ocId: string): Promise<OcImportadoInfo | null> {
  const { data, error } = await supabase.from("ocs_importado" as any).select("id, numero, status").eq("id", ocId).maybeSingle();
  if (error) throw error;
  return (data as unknown as OcImportadoInfo | null) ?? null;
}
