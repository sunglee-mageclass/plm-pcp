// Exportar dados por TIPO — contrato do "driver de recorte" + helpers puros (sem React/Supabase, testáveis).
//
// A tela comum (`ExportarDados.tsx`) cuida do que é IGUAL em todo tipo: seletor de TIPO, colunas (catálogo do tipo), níveis,
// prévia do menor nível e Baixar. O que muda por tipo é o RECORTE (os filtros: produto = coleção+subcoleção; tecido = categoria;
// aviamento = categoria+material; insumo = tipo) e a RPC — isso mora no driver do tipo (`drivers/<tipo>.tsx`).
import type { ReactNode } from "react";
import type { TipoExport, CampoExport } from "@/lib/exportar/campos-por-tipo";
import type { DadosExport } from "@/lib/integracao/export";

export type { TipoExport };

/** Sentinela "todos" dos filtros novos (tecido/aviamento/insumo). Espelho do `TODAS_COLECOES` do produto
 *  (o produto segue com o próprio valor `"__todas_colecoes__"` guardado nas prefs dos usuários — não mudar). */
export const SENTINELA_TODOS = "__todos__" as const;

/** Resposta da RPC de export: o formato de `baixarExport` + o total de itens do recorte. */
export type RespostaExport = DadosExport & { total: number };

/** Os 4 tipos do seletor, na ordem em que aparecem. */
export const TIPOS_EXPORT: { valor: TipoExport; rotulo: string }[] = [
  { valor: "produto", rotulo: "Produto" },
  { valor: "tecido", rotulo: "Tecido" },
  { valor: "aviamento", rotulo: "Aviamento" },
  { valor: "insumo", rotulo: "Insumo" },
];

/** Tipo salvo na pref (array de 1) → tipo válido. Vazio/desconhecido = "produto" (o padrão). */
export function tipoValido(pref: string[]): TipoExport {
  const v = pref[0];
  return TIPOS_EXPORT.find((t) => t.valor === v)?.valor ?? "produto";
}

/** Regra (espelho da coleção do produto): vazio = null (nada escolhido); sentinela vale sempre;
 *  um id só vale se ainda está na lista carregada. */
export function valorFiltroValido(pref: string[], opcoes: { id: string }[]): string | null {
  const v = pref[0];
  if (!v) return null;
  if (v === SENTINELA_TODOS) return SENTINELA_TODOS;
  return opcoes.some((o) => o.id === v) ? v : null;
}

/** Nome-base do arquivo por tipo (espelho de `export-<colecao>-<sub>` do produto). O segmento usa o VALOR do filtro
 *  (o id/nome que o RPC recebe, como o produto faz com a coleção), nunca um rótulo legível; sentinela/vazio = "todas"/"todos". */
export function nomeBaseArquivo(
  tipo: TipoExport,
  filtros: {
    colecao?: string | null; subcolecao?: string | null; // produto (null = todas as coleções / todas as subcoleções)
    categoria?: string | null; material?: string | null; // tecido (categoria) · aviamento (categoria + material)
    tipo?: string | null;                                  // insumo (tipo de insumo)
  },
): string {
  const seg = (v: string | null | undefined, vazio: string) => (v && v !== SENTINELA_TODOS ? v : vazio);
  if (tipo === "produto") return `export-${seg(filtros.colecao, "todas-as-colecoes")}-${seg(filtros.subcolecao, "todas")}`;
  if (tipo === "tecido") return `export-tecido-${seg(filtros.categoria, "todas")}`;
  if (tipo === "aviamento") return `export-aviamento-${seg(filtros.categoria, "todas")}-${seg(filtros.material, "todos")}`;
  return `export-insumo-${seg(filtros.tipo, "todos")}`;
}

/** Nível do arquivo (1 = cabeçalho/pai). `ajuda` é o texto cinza ao lado do checkbox. */
export type NivelExport = { valor: string; rotulo: string; ajuda?: string };

/** O que o hook `useRecorte()` do driver devolve para a tela comum: o estado do recorte já resolvido (prefs + listas do servidor). */
export type RecorteAtivo = {
  /** Os seletores de filtro (a seção "1. Recorte"). */
  filtros: ReactNode;
  /** Algum recorte escolhido? (vazio NUNCA vira "todos"; "todos" é escolha explícita). Sem isso: Baixar desabilitado e nada é consultado. */
  escolhido: boolean;
  /** Listas dependentes do recorte já chegaram? (a prévia espera, senão consultaria com o filtro errado). */
  pronta: boolean;
  /** Parte da queryKey da prévia que vem do recorte (a tela soma `["exportar-previa", tenantId, …isto, colunas, níveis]`). */
  chave: unknown[];
  /** Texto da prévia enquanto `escolhido` for false. */
  avisoSemRecorte: string;
  /** Se uma lista dependente do recorte falhou: texto no lugar da prévia (senão null). */
  avisoDependenciaErro: string | null;
  /** Chama a RPC do tipo. `limite` conta ITENS do tipo (produtos/tecidos…), `null` = sem limite (Baixar). */
  chamarRpc: (campos: string[], niveis: string[], limite: number | null) => Promise<RespostaExport>;
  /** Nome-base do arquivo a baixar (sem extensão). */
  nomeBaseArquivo: () => string;
};

/** Contrato do driver de recorte: um por tipo (produto na Task 4; tecido/aviamento/insumo na Task 5). */
export type DriverRecorte = {
  tipo: TipoExport;
  /** Colunas marcáveis do tipo (catálogo, na ordem do arquivo). */
  catalogo: readonly CampoExport[];
  /** Níveis do arquivo: produto 3 (pai/cor/tamanho), demais 2 (cabeçalho/variante). */
  niveis: NivelExport[];
  /** Mapa nível → nome da aba do Excel (passado ao `baixarExport`). */
  nomeAba: Record<string, string>;
  /** Tela das prefs de colunas/níveis (`useUserPref("export", prefScreen, …)`). Produto = "integracao" (histórico, não mudar). */
  prefScreen: string;
  /** Como a tela chama o item do tipo (prévia, toast, "nenhum … neste recorte"). */
  item: { um: string; varios: string };
  /** Hook do recorte (usa as prefs/queries próprias do tipo). Chamado SEMPRE dentro de um componente com `key={tipo}`. */
  useRecorte: () => RecorteAtivo;
};
