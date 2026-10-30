// [urg R13 T7] Leituras da OC de Produto Acabado COM itens, compartilhadas pelo Sheet (edição) e pelo ícone de imprimir da lista.
import { supabase } from "@/integrations/supabase/client";
import { itensDeRows, type ItemOcPa } from "./itens";
import { DEFAULT_TAMANHOS } from "./shared";

/** Cabeçalho + itens, com o REF e a foto do produto vinculado de cada item (embed por FK). */
export const SELECT_OC = "*, itens:ocs_p_acabado_itens(*, produto:produto_acabado_id(ref, modelo:modelo_id(fotos_modelo)))";

export type DadosOc = { oc: any; itens: ItemOcPa[] };

/** A OC + os itens na ordem da OC; `null` = não existe (ou outra loja). Erro de leitura LANÇA (nunca vira "OC vazia"). */
export async function lerOcComItens(ocId: string): Promise<DadosOc | null> {
  const { data, error } = await supabase.from("ocs_p_acabado" as any).select(SELECT_OC).eq("id", ocId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { itens, ...oc } = data as any;
  return { oc, itens: itensDeRows(itens) };
}

/** Colunas de tamanho da loja (`tenant_config.tamanhos_grade`); sem config cai na grade padrão. */
export async function buscarTamanhosLoja(): Promise<string[]> {
  const { data } = await supabase.rpc("get_user_tenant_id" as any);
  if (!data) return DEFAULT_TAMANHOS;
  const { data: cfg } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", data as string).maybeSingle();
  const raw = (cfg as any)?.tamanhos_grade;
  return Array.isArray(raw) && raw.length > 0 ? raw.map(String) : DEFAULT_TAMANHOS;
}
