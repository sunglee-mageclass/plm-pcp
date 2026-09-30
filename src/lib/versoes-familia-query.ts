// P-152 — LEITURA das versões de cada família (só SELECT, pela RLS; nenhuma escrita, nenhuma RPC).
import type { SupabaseClient } from "@supabase/supabase-js";
import { emLotes, raizDaFamilia, type LinhaVersao } from "@/lib/versoes-familia";

/** Ids por lote no 1º SELECT (`id in (...)`). */
export const LOTE_IDS = 100;
/** Raízes por lote no 2º SELECT (`id.in.(..),modelo_base_id.in.(..)` repete a lista 2x): 50 raízes ≈ 4 KB de URL
 *  (medido no teste); 100 já passaria de 7 KB, perto do limite de cabeçalho de proxies (8 KB). */
export const LOTE_RAIZES = 50;

const COLUNAS = "id, nome, versao, modelo_base_id, colecao_id, colecao, subcolecao, created_at, colecoes(nome)";

/** Todas as versões (em QUALQUER coleção/subcoleção) das famílias dos `modeloIds`. Lança em erro (falha fechada). */
export async function buscarVersoesFamilia(client: SupabaseClient<any, any, any>, modeloIds: string[]): Promise<LinhaVersao[]> {
  const ids = Array.from(new Set(modeloIds.filter(Boolean)));
  if (ids.length === 0) return [];

  const raizes = new Set<string>();
  for (const lote of emLotes(ids, LOTE_IDS)) {
    const { data, error } = await client.from("modelos").select("id, modelo_base_id").in("id", lote);
    if (error) throw error;
    for (const r of (data ?? []) as { id: string; modelo_base_id: string | null }[]) raizes.add(raizDaFamilia(r));
  }

  const porId = new Map<string, LinhaVersao>();
  for (const lote of emLotes(Array.from(raizes), LOTE_RAIZES)) {
    const lista = lote.join(",");
    const { data, error } = await client
      .from("modelos")
      .select(COLUNAS)
      .or(`id.in.(${lista}),modelo_base_id.in.(${lista})`);
    if (error) throw error;
    for (const r of (data ?? []) as any[]) {
      porId.set(r.id, {
        id: r.id,
        nome: r.nome,
        versao: r.versao ?? null,
        modelo_base_id: r.modelo_base_id ?? null,
        colecao_id: r.colecao_id ?? null,
        // embed pela FK; fallback no espelho de texto (o espelho PA/PI não grava `modelos.colecao`)
        colecao: r.colecoes?.nome ?? r.colecao ?? null,
        subcolecao: r.subcolecao ?? null,
        created_at: r.created_at ?? null,
      });
    }
  }
  return Array.from(porId.values());
}
