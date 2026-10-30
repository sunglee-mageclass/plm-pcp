// [urg R13 T8] Leituras da OC de Produto Importado COM itens, compartilhadas pelo Sheet (edição) e pelo ícone de imprimir da lista.
import { supabase } from "@/integrations/supabase/client";
import { buscarTamanhosLoja } from "@/components/oc-p-acabado/queries";
import { itensDeRows, type ItemOcImp } from "./itens";
import type { EtapaDraft } from "./shared";

export { buscarTamanhosLoja };

/** Cabeçalho + etapas + itens, com o REF e a foto do produto vinculado de cada item (embed por FK). */
export const SELECT_OC = "*, etapas:ocs_importado_etapas(*), itens:ocs_importado_itens(*, produto:produto_importado_id(ref, foto_url))";

export type DadosOc = { oc: any; etapas: EtapaDraft[]; itens: ItemOcImp[] };

/** Etapas do embed → rascunho, ordenadas. */
export function etapasDeRows(rows: ReadonlyArray<any> | null | undefined): EtapaDraft[] {
  return [...(rows ?? [])].sort((a, b) => a.ordem - b.ordem).map((e): EtapaDraft => ({
    ordem: e.ordem, rotulo: e.rotulo ?? "", base: e.base, percentual: Number(e.percentual) || 0,
    data_vencimento: e.data_vencimento ?? null, cotacao: Number(e.cotacao) || 0,
  }));
}

/** A OC + etapas + itens na ordem da OC; `null` = não existe (ou outra loja). Erro de leitura LANÇA (nunca vira "OC vazia"). */
export async function lerOcComItens(ocId: string): Promise<DadosOc | null> {
  const { data, error } = await supabase.from("ocs_importado" as any).select(SELECT_OC).eq("id", ocId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { itens, etapas, ...oc } = data as any;
  return { oc, etapas: etapasDeRows(etapas), itens: itensDeRows(itens) };
}
