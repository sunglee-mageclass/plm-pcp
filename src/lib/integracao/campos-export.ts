// Catálogo de campos da tela "Exportar dados" (CSV). Shape PRÓPRIO — não depende de `campos.ts` da Integração.
// 27 campos = os 20 da Integração (sem 'foto': caminho de storage é inútil no CSV) + 7 extras.
// A ORDEM do array é a ordem das colunas no arquivo: identidade, preços, cor/tamanho, taxonomia, resto.
// `soVariante` = o valor só existe na linha da variante×tamanho (cor base, cor apelido, tamanho).

export type CampoExport = { key: string; rotulo: string; soVariante: boolean };

export const CAMPOS_EXPORT: readonly CampoExport[] = [
  // identidade
  { key: "nome", rotulo: "Nome", soVariante: false },
  { key: "ref_sku", rotulo: "REF / SKU", soVariante: false },
  { key: "origem", rotulo: "Origem", soVariante: false },
  // preços
  { key: "preco_venda", rotulo: "Preço de venda", soVariante: false },
  { key: "preco_atacado", rotulo: "Preço de atacado", soVariante: false },
  { key: "preco_anterior", rotulo: "Preço anterior", soVariante: false },
  { key: "preco_custo", rotulo: "Preço de custo", soVariante: false },
  // cor / tamanho
  { key: "cor_base", rotulo: "Cor base", soVariante: true },
  { key: "cor_apelido", rotulo: "Cor apelido", soVariante: true },
  { key: "tamanho", rotulo: "Tamanho", soVariante: true },
  // taxonomia
  { key: "grupo", rotulo: "Grupo", soVariante: false },
  { key: "categoria", rotulo: "Categoria", soVariante: false },
  { key: "subcategoria1", rotulo: "Subcategoria 1", soVariante: false },
  { key: "subcategoria2", rotulo: "Subcategoria 2", soVariante: false },
  { key: "categoria_tecido", rotulo: "Categoria do Tecido Principal", soVariante: false },
  { key: "colecao", rotulo: "Coleção", soVariante: false },
  { key: "subcolecao", rotulo: "Subcoleção", soVariante: false },
  { key: "linha", rotulo: "Linha", soVariante: false },
  // o resto
  { key: "ncm", rotulo: "NCM", soVariante: false },
  { key: "peso", rotulo: "Peso", soVariante: false },
  { key: "comprimento", rotulo: "Comprimento", soVariante: false },
  { key: "largura", rotulo: "Largura", soVariante: false },
  { key: "altura", rotulo: "Altura", soVariante: false },
  { key: "titulo", rotulo: "Título para a página", soVariante: false },
  { key: "descricao", rotulo: "Descrição", soVariante: false },
  { key: "keywords", rotulo: "Keywords", soVariante: false },
  { key: "metatag", rotulo: "Metatag Description", soVariante: false },
];

export const CAMPO_EXPORT_BY_KEY: Map<string, CampoExport> = new Map(CAMPOS_EXPORT.map((c) => [c.key, c]));

export const KEYS_VALIDAS: Set<string> = new Set(CAMPOS_EXPORT.map((c) => c.key));

const POSICAO: Map<string, number> = new Map(CAMPOS_EXPORT.map((c, i) => [c.key, i]));

/** Filtra pelas chaves válidas e ordena pela posição no catálogo. */
export function ordenarCamposExport(keys: string[]): string[] {
  return keys
    .filter((k) => KEYS_VALIDAS.has(k))
    .sort((a, b) => (POSICAO.get(a) as number) - (POSICAO.get(b) as number));
}
