// Geração do arquivo da tela "Exportar dados": CSV (1 nível) ou Excel (2-3 níveis, 1 aba por nível).
// `montarMatriz` é PURA (testada). `baixarExport` dispara o download no navegador (não roda em happy-dom).
// Rótulos, nomes de aba e chaves válidas vêm POR PARÂMETRO (cada TIPO de export tem os seus) — nada fixo do produto.
//
// A ORDEM das colunas vem de `colunas` (já ordenada/deduplicada pela RPC) — jsonb não preserva a ordem
// das chaves, por isso a matriz é montada por `colunas`, nunca por Object.keys da linha.

import * as XLSX from "xlsx";

export type DadosExport = {
  colunas: string[];
  niveis: Record<string, Record<string, unknown>[]>;
};

/** Neutraliza CSV/formula injection: uma célula que começa com um caractere de fórmula (= + - @, ou
 *  tab/CR, que o Excel também interpreta) ganha um apóstrofo na frente, para o Excel/Sheets tratar o
 *  conteúdo como TEXTO e não executar `=HYPERLINK(...)`/`@cmd`/etc. Rótulos (cabeçalho) são nossos,
 *  fixos — não precisam. Só o corpo (dado do produto, texto livre) é escapado. */
function escaparCelula(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** Matriz (array de arrays): 1ª linha = rótulos (do mapa `rotulos` recebido; sem rótulo cai na própria key);
 *  depois 1 linha por item, na ordem de `campos`. */
export function montarMatriz(
  linhas: Record<string, unknown>[], campos: string[], rotulos: Map<string, string>,
): string[][] {
  const cabecalho = campos.map((k) => rotulos.get(k) ?? k);
  const corpo = linhas.map((l) => campos.map((k) => escaparCelula(String(l[k] ?? ""))));
  return [cabecalho, ...corpo];
}

/**
 * Baixa o arquivo. 1 nível selecionado = `<nomeBase>.csv`; 2-3 níveis = `<nomeBase>.xlsx` (1 aba por nível).
 * Usa só os níveis de `niveisSel` que existem em `dados.niveis`, na ordem de `opts.nomeAba` (1→2→3).
 * `opts` traz, do TIPO ativo: o mapa de rótulos, o nome da aba por nível e as chaves válidas do catálogo.
 */
export function baixarExport(
  dados: DadosExport, niveisSel: string[], nomeBase: string,
  opts: { rotulos: Map<string, string>; nomeAba: Record<string, string>; keysValidas: Set<string> },
): void {
  // Segurança: só colunas do catálogo (a RPC já valida; aqui é cinto-e-suspensório).
  const colunas = dados.colunas.filter((k) => opts.keysValidas.has(k));
  const niveis = Object.keys(opts.nomeAba).filter((n) => niveisSel.includes(n) && dados.niveis[n]);
  if (niveis.length === 0) return;

  const wb = XLSX.utils.book_new();
  for (const n of niveis) {
    const ws = XLSX.utils.aoa_to_sheet(montarMatriz(dados.niveis[n], colunas, opts.rotulos));
    XLSX.utils.book_append_sheet(wb, ws, opts.nomeAba[n]);
  }
  XLSX.writeFile(wb, niveis.length === 1 ? `${nomeBase}.csv` : `${nomeBase}.xlsx`);
}
