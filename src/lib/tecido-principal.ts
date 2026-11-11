// Agrupamento do Plan. Produto por Tecido 1 PRINCIPAL (fix 11/nov).
// `modelos.tecidos_planejados` é o POOL (Tecido 1 + substitutos) e serve a reserva de estoque/Plan. Tecido;
// agrupar por ele fazia a peça aparecer em 2 grupos (principal E substituto). Aqui o agrupamento usa SÓ o
// Tecido 1 (`modelo_tecidos` tipo 'tecido' numero 1) — mesma regra canônica da Integração (inv. 14).

export type ModeloTecidoEmbed = { artigo_id: string | null; numero: number | null; tipo: string | null };

/** Artigo do Tecido 1 principal a partir do embed `modelo_tecidos(artigo_id, numero, tipo)`; ausente = null. */
export function artigoTecido1DoEmbed(rows: readonly ModeloTecidoEmbed[] | null | undefined): string | null {
  const t = (rows ?? []).find((r) => r.tipo === "tecido" && r.numero === 1);
  return t?.artigo_id ?? null;
}

/** Chave(s) do grupo "Tecido": UM só grupo (o do principal); sem tecido cai em Acessórios/"Sem tecido". */
export function chavesGrupoTecido(artigoTecido1: string | null | undefined, acessorio: boolean): string[] {
  return [artigoTecido1 || (acessorio ? "__acessorios__" : "__none__")];
}

/** Chave do grupo "Categoria de tecido": categoria do Tecido 1 principal (não do pool). */
export function chavesGrupoCatTecido(
  artigoTecido1: string | null | undefined,
  catPorArtigo: Record<string, string | null | undefined>,
  acessorio: boolean,
): string[] {
  const cat = artigoTecido1 ? catPorArtigo[artigoTecido1] : null;
  return [cat || (acessorio ? "__acessorios__" : "__none__")];
}
