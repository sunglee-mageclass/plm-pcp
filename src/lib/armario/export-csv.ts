// F7 Armário — "Baixar CSV" (leitura). Lib PURA (a RPC e o download ficam no `ExportarArmarioDialog`).
//
// A RPC `exportar_armario(_armario_id)` devolve `{ nome_armario, linhas: [{sku_pai, grupo, categoria, subcategoria1, subcategoria2}] }`
// (1 objeto por item/cor, na ordem da vitrine). O `nome_armario` vem UMA vez no topo: aqui é replicado em CADA linha.
// A geração do arquivo reusa `montarMatriz`/`baixarExport` (`@/lib/integracao/export`, 1 nível = `.csv`, com escape de fórmula).
// ⚠️ `baixarExport` FILTRA as colunas por `keysValidas`: o Armário passa o PRÓPRIO conjunto (`sku_pai`/`nome_armario` não existem
//    no catálogo central `KEYS_VALIDAS` e seriam descartadas em silêncio).
import { baixarExport, type DadosExport } from "@/lib/integracao/export";

export type CampoArmario = { key: string; rotulo: string };

/** Catálogo das 6 colunas do CSV; a ORDEM daqui é a ordem do arquivo. */
export const CAMPOS_ARMARIO: readonly CampoArmario[] = [
  { key: "sku_pai", rotulo: "SKU" },
  { key: "nome_armario", rotulo: "Nome do Armário" },
  { key: "grupo", rotulo: "Grupo" },
  { key: "categoria", rotulo: "Categoria" },
  { key: "subcategoria1", rotulo: "Subcategoria 1" },
  { key: "subcategoria2", rotulo: "Subcategoria 2" },
];

export const CHAVES_ARMARIO: readonly string[] = CAMPOS_ARMARIO.map((c) => c.key);

/** Mapa key → rótulo do cabeçalho (o que `montarMatriz` espera). */
export function rotulosArmario(): Map<string, string> {
  return new Map(CAMPOS_ARMARIO.map((c) => [c.key, c.rotulo]));
}

/** Chaves aceitas por `baixarExport` neste export (as 6 do Armário — NÃO o `KEYS_VALIDAS` central). */
export function keysValidasArmario(): Set<string> {
  return new Set(CHAVES_ARMARIO);
}

/** Nome da (única) aba — só o `baixarExport` exige a chave "1" em `nomeAba` para aceitar o nível; CSV não usa o nome. */
export const NOME_ABA_ARMARIO: Record<string, string> = { "1": "Armário" };

/** Marca gravada no pref quando a pessoa DESMARCA tudo: o pref `[]` significa "nunca escolheu" (= todas marcadas),
 *  então "nenhuma" precisa de um valor próprio. Não é chave do catálogo, logo `colunasEscolhidas` a ignora (0 colunas). */
export const PREF_NENHUMA_COLUNA = "_nenhuma";

/** Colunas pré-marcadas por padrão (quem nunca escolheu): só o SKU (decisão do dono, 24/nov). */
export const COLUNAS_PADRAO: readonly string[] = ["sku_pai"];

/** Colunas efetivas a partir do pref: `[]` = padrão (só o SKU); senão só as chaves do catálogo, NA ORDEM do catálogo
 *  (chave que saiu do catálogo é ignorada; a marca de "nenhuma" resulta em lista vazia). */
export function colunasEscolhidas(pref: readonly string[]): string[] {
  if (pref.length === 0) return CHAVES_ARMARIO.filter((k) => COLUNAS_PADRAO.includes(k));
  return CHAVES_ARMARIO.filter((k) => pref.includes(k));
}

/** Valor a gravar no pref para uma seleção (na ordem do catálogo; vazia vira a marca "nenhuma"). */
export function prefDeColunas(selecionadas: readonly string[]): string[] {
  const s = CHAVES_ARMARIO.filter((k) => selecionadas.includes(k));
  return s.length === 0 ? [PREF_NENHUMA_COLUNA] : s;
}

/** Retorno da RPC `exportar_armario`. */
export type RetornoExportarArmario = {
  nome_armario: string | null;
  linhas: Record<string, unknown>[];
};

/** Normaliza o retorno cru da RPC (jsonb): sem `linhas` array = lista vazia; `nome_armario` ausente = "". */
export function lerRetornoExportarArmario(raw: unknown): RetornoExportarArmario {
  const o = (raw ?? {}) as { nome_armario?: unknown; linhas?: unknown };
  return {
    nome_armario: o.nome_armario == null ? "" : String(o.nome_armario),
    linhas: Array.isArray(o.linhas) ? (o.linhas as Record<string, unknown>[]) : [],
  };
}

/** Monta o `DadosExport` de 1 nível: `nome_armario` injetado em CADA linha e `colunas` na ordem do catálogo
 *  (só chaves válidas — `colunas` pode vir em qualquer ordem). */
export function montarDadosArmario(ret: RetornoExportarArmario, colunas: readonly string[]): DadosExport {
  const nome = ret.nome_armario ?? "";
  return {
    colunas: CHAVES_ARMARIO.filter((k) => colunas.includes(k)),
    niveis: { "1": ret.linhas.map((l) => ({ ...l, nome_armario: nome })) },
  };
}

/** Nome-base do arquivo: `armario-<nome sem acento, minúsculo, hífens>`; nome vazio/só símbolos = `armario`. */
export function nomeArquivoArmario(nome: string | null | undefined): string {
  const slug = String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug ? `armario-${slug}` : "armario";
}

/** Gera e baixa o CSV (1 nível). Não baixa com 0 colunas válidas. Devolve quantas linhas foram para o arquivo (0 = nada baixado). */
export function baixarCsvArmario(ret: RetornoExportarArmario, colunas: readonly string[]): number {
  const dados = montarDadosArmario(ret, colunas);
  if (dados.colunas.length === 0) return 0;
  baixarExport(dados, ["1"], nomeArquivoArmario(ret.nome_armario), {
    rotulos: rotulosArmario(),
    nomeAba: NOME_ABA_ARMARIO,
    keysValidas: keysValidasArmario(),
  });
  return dados.niveis["1"].length;
}
