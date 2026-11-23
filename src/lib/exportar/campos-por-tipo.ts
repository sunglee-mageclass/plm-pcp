// Catalogos de colunas da tela "Exportar dados" POR TIPO (tecido/aviamento/insumo). Shape igual ao do produto.
// A ORDEM do array = a ordem das colunas no arquivo. `soVariante` = valor so na linha da variante (nivel 2).
// O produto fica em @/lib/integracao/campos-export (intocado); aqui ficam os 3 tipos novos + um resolvedor por tipo.
// As chaves TEM de ser as do `v_catalogo` do `_core` de cada tipo (migration 20261212100000); anti-drift em
// tests/unit/exportar-campos-por-tipo.test.ts (chave fora do catalogo SQL = RPC rejeita com exportar_campo_invalido).
import {
  CAMPOS_EXPORT, type CampoExport,
} from "@/lib/integracao/campos-export";

export type { CampoExport };
export type TipoExport = "produto" | "tecido" | "aviamento" | "insumo";

// TECIDO ('categorias'/'subcategoria_tecido' = agregadas por ' | ' no SQL).
export const CAMPOS_TECIDO: readonly CampoExport[] = [
  { key: "nome", rotulo: "Nome", soVariante: false },
  { key: "unidade", rotulo: "Unidade", soVariante: false },
  { key: "composicao", rotulo: "Composição", soVariante: false },
  { key: "rendimento", rotulo: "Rendimento", soVariante: false },
  { key: "ncm", rotulo: "NCM", soVariante: false },
  { key: "preco", rotulo: "Preço", soVariante: false },
  { key: "preco_por_metro", rotulo: "Preço por metro", soVariante: false },
  { key: "largura", rotulo: "Largura estimada", soVariante: false },
  { key: "fornecedor", rotulo: "Fornecedor", soVariante: false },
  { key: "mes", rotulo: "Mês", soVariante: false },
  { key: "ano", rotulo: "Ano", soVariante: false },
  { key: "categorias", rotulo: "Categoria(s)", soVariante: false },
  { key: "subcategoria_tecido", rotulo: "Subcategoria de tecido", soVariante: false },
  { key: "cor_base", rotulo: "Cor base", soVariante: true },
  { key: "cor_apelido", rotulo: "Cor apelido", soVariante: true },
  { key: "codigo_variante", rotulo: "Código da variante", soVariante: true },
];

// AVIAMENTO ('nome' vem de aviamentos.codigo_nome no SQL; cor_base_cab/cor_apelido_cab = cabeçalho).
export const CAMPOS_AVIAMENTO: readonly CampoExport[] = [
  { key: "nome", rotulo: "Nome", soVariante: false },
  { key: "codigo", rotulo: "Código", soVariante: false },
  { key: "ncm", rotulo: "NCM", soVariante: false },
  { key: "composicao", rotulo: "Composição", soVariante: false },
  { key: "preco", rotulo: "Preço", soVariante: false },
  { key: "categoria", rotulo: "Categoria", soVariante: false },
  { key: "subcategoria", rotulo: "Subcategoria", soVariante: false },
  { key: "material", rotulo: "Material", soVariante: false },
  { key: "fornecedor", rotulo: "Fornecedor", soVariante: false },
  { key: "cor_base_cab", rotulo: "Cor base (cabeçalho)", soVariante: false },
  { key: "cor_apelido_cab", rotulo: "Cor apelido (cabeçalho)", soVariante: false },
  { key: "cor_base", rotulo: "Cor base", soVariante: true },
  { key: "cor_apelido", rotulo: "Cor apelido", soVariante: true },
  { key: "codigo_variante", rotulo: "Código da variante", soVariante: true },
  { key: "preco_variante", rotulo: "Preço da variante", soVariante: true },
];

// INSUMO (variante = cor × tamanho, SEM apelido).
export const CAMPOS_INSUMO: readonly CampoExport[] = [
  { key: "nome", rotulo: "Nome", soVariante: false },
  { key: "unidade", rotulo: "Unidade", soVariante: false },
  { key: "tipo_insumo", rotulo: "Tipo de insumo", soVariante: false },
  { key: "formato_tamanho", rotulo: "Formato de tamanho", soVariante: false },
  { key: "preco", rotulo: "Preço", soVariante: false },
  { key: "fornecedor", rotulo: "Fornecedor", soVariante: false },
  { key: "observacoes", rotulo: "Observações", soVariante: false },
  { key: "cor", rotulo: "Cor", soVariante: true },
  { key: "tamanho", rotulo: "Tamanho", soVariante: true },
  { key: "preco_variante", rotulo: "Preço da variante", soVariante: true },
];

const POR_TIPO: Record<Exclude<TipoExport, "produto">, readonly CampoExport[]> = {
  tecido: CAMPOS_TECIDO, aviamento: CAMPOS_AVIAMENTO, insumo: CAMPOS_INSUMO,
};

export function catalogoDoTipo(tipo: TipoExport): readonly CampoExport[] {
  return tipo === "produto" ? CAMPOS_EXPORT : POR_TIPO[tipo];
}
export function byKeyDoTipo(tipo: TipoExport): Map<string, CampoExport> {
  return new Map(catalogoDoTipo(tipo).map((c) => [c.key, c]));
}
export function keysValidasDoTipo(tipo: TipoExport): Set<string> {
  return new Set(catalogoDoTipo(tipo).map((c) => c.key));
}
export function rotulosDoTipo(tipo: TipoExport): Map<string, string> {
  return new Map(catalogoDoTipo(tipo).map((c) => [c.key, c.rotulo]));
}
export function ordenarCamposDoTipo(tipo: TipoExport, keys: string[]): string[] {
  const pos = new Map(catalogoDoTipo(tipo).map((c, i) => [c.key, i]));
  const validas = keysValidasDoTipo(tipo);
  return keys.filter((k) => validas.has(k)).sort((a, b) => (pos.get(a) as number) - (pos.get(b) as number));
}
