// "Fazer pedido" do Produto Acabado — a CHAMADA que cria a OC. FONTE ÚNICA do card (`ProdutoCard.fazerPedidoMut`) e do pedido em
// lote ([urg R13], `ProdutoAcabadoSheet`): o payload sai de `montarDadosOcAcabado` e a grade de `gradePedidaDeVariantes`
// (puros, em `shared.ts`) — nada é montado duas vezes. Quem chama decide ANTES o que o card já decidia (guardas, salvar o
// produto sujo) e DEPOIS o que fazer com a OC (patch do rascunho, invalidar queries, navegar).
import { supabase } from "@/integrations/supabase/client";
import {
  gradePedidaDeVariantes, hojeISO, montarDadosOcAcabado,
  type OcRowCriadaAcabado, type ProdutoDraft,
} from "./shared";

/** Cria a OC do produto (`salvar_oc_p_acabado`, `_id: null`) e relê a linha (nº/status reais, gerados por trigger) — sem isso o
 *  card ficaria mostrando "Nenhuma OC vinculada" até um reload, mesmo com a OC criada e vinculada no servidor (fix round 1 item 4b). */
export async function criarOcProdutoAcabado(produto: ProdutoDraft, acessorio: boolean): Promise<OcRowCriadaAcabado | null> {
  const grade = gradePedidaDeVariantes(produto.variantes, produto.grade_proporcao, acessorio);
  const dados = montarDadosOcAcabado(produto, hojeISO());
  const { data: ocId, error } = await supabase.rpc("salvar_oc_p_acabado" as any, { _id: null, _dados: dados, _grade: grade });
  if (error) throw error;
  const { data: ocRow, error: fetchErr } = await supabase
    .from("ocs_p_acabado" as any)
    .select("id, numero, status, qtd_total, valor_unitario_real, grade_detalhe, valor_unitario, desconto_pct")
    .eq("id", ocId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  return ocRow as unknown as OcRowCriadaAcabado | null;
}
