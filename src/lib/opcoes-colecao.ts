import { supabase } from "@/integrations/supabase/client";

/**
 * [backend F2.2] Opções dos filtros de Coleção/Subcoleção (PCP › Etapas, Dashboard › Comercial) vindas do SERVIDOR:
 * RPC `opcoes_colecao_modelos()` → `{ colecoes, subcolecoes }` (distintos, sem vazio, da loja ativa). Antes a tela baixava
 * todos os cards só para montar a lista (e o PostgREST cortava em 1.000 linhas sem avisar). A regra do rótulo da coleção
 * continua única: a RPC repete `_modelo_colecao_rotulo` (anti-drift em `tests/integration/bk-f2-opcoes-colecao.test.ts`).
 * A ordem da lista é da tela (`.sort()`, mesma de sempre).
 */
export type OpcoesColecao = { colecoes: string[]; subcolecoes: string[] };

const lista = (v: unknown): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.filter((x): x is string => typeof x === "string" && x !== ""))).sort() : [];

/** Resposta crua da RPC → listas ordenadas e sem vazios/duplicados (defensivo: `null` ou formato inesperado = vazio). */
export function normalizarOpcoesColecao(data: unknown): OpcoesColecao {
  const d = (data ?? {}) as { colecoes?: unknown; subcolecoes?: unknown };
  return { colecoes: lista(d.colecoes), subcolecoes: lista(d.subcolecoes) };
}

/** Uma ida ao banco (sem trazer cards). Erro SOBE (não esvazia o filtro em silêncio). */
export async function buscarOpcoesColecao(): Promise<OpcoesColecao> {
  const { data, error } = await supabase.rpc("opcoes_colecao_modelos" as any);
  if (error) throw error;
  return normalizarOpcoesColecao(data);
}
