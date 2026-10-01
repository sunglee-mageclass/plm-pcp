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
  for (let de = 0; ; de += tamanho) {
    const { data, error } = await pagina(de, de + tamanho - 1);
    if (error) throw error;
    const rows = data ?? [];
    todas.push(...rows);
    if (rows.length < tamanho) break;
  }
  return todas;
}
