/**
 * O PostgREST corta silenciosamente qualquer resposta em `max-rows` (1.000 no Supabase): uma lista
 * sem `.range` simplesmente "perde" as linhas além da 1.000ª, sem erro. `buscarTodas` busca em
 * blocos até vir uma página curta.
 *
 * `pagina(de, ate)` monta a consulta COM o `.range(de, ate)` aplicado. A consulta precisa ter ordem
 * ESTÁVEL e única (ex.: `.order("data_vencimento").order("id")`), senão linhas podem repetir/sumir
 * entre as páginas.
 */
export const TAMANHO_BLOCO = 1000;

type RespostaPagina<T> = { data: T[] | null; error: { message: string } | null };

export async function buscarTodas<T>(
  pagina: (de: number, ate: number) => PromiseLike<RespostaPagina<T>>,
  tamanho: number = TAMANHO_BLOCO,
): Promise<T[]> {
  const todas: T[] = [];
  const vistos = new Set<unknown>(); // dedupe por id: insert/delete concorrente desloca a janela entre páginas
  for (let de = 0; ; de += tamanho) {
    const { data, error } = await pagina(de, de + tamanho - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows) {
      const id = (r as { id?: unknown } | null)?.id;
      if (id != null) {
        if (vistos.has(id)) continue;
        vistos.add(id);
      }
      todas.push(r);
    }
    if (rows.length < tamanho) break;
  }
  return todas;
}
