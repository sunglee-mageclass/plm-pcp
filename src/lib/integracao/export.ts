// Geração do arquivo da tela "Exportar dados": CSV (1 nível) ou Excel (2-3 níveis, 1 aba por nível).
// `montarMatriz` é PURA (testada). `baixarExport` dispara o download no navegador (não roda em happy-dom).
//
// A ORDEM das colunas vem de `colunas` (já ordenada/deduplicada pela RPC) — jsonb não preserva a ordem
// das chaves, por isso a matriz é montada por `colunas`, nunca por Object.keys da linha.

import * as XLSX from "xlsx";
import { CAMPO_EXPORT_BY_KEY, KEYS_VALIDAS } from "./campos-export";

export type DadosExport = {
  colunas: string[];
  niveis: Record<string, Record<string, unknown>[]>;
};

const NOME_ABA: Record<string, string> = {
  "1": "SKU pai",
  "2": "Até cor",
  "3": "Até tamanho",
};

/** Matriz (array de arrays): 1ª linha = rótulos; depois 1 linha por item, na ordem de `campos`. */
export function montarMatriz(linhas: Record<string, unknown>[], campos: string[]): string[][] {
  const cabecalho = campos.map((k) => CAMPO_EXPORT_BY_KEY.get(k)?.rotulo ?? k);
  const corpo = linhas.map((l) => campos.map((k) => String(l[k] ?? "")));
  return [cabecalho, ...corpo];
}

/**
 * Baixa o arquivo. 1 nível selecionado = `<nomeBase>.csv`; 2-3 níveis = `<nomeBase>.xlsx` (1 aba por nível).
 * Usa só os níveis de `niveisSel` que existem em `dados.niveis`, na ordem 1→2→3.
 */
export function baixarExport(dados: DadosExport, niveisSel: string[], nomeBase: string): void {
  // Segurança: só colunas do catálogo (a RPC já valida; aqui é cinto-e-suspensório).
  const colunas = dados.colunas.filter((k) => KEYS_VALIDAS.has(k));
  const niveis = Object.keys(NOME_ABA).filter((n) => niveisSel.includes(n) && dados.niveis[n]);
  if (niveis.length === 0) return;

  const wb = XLSX.utils.book_new();
  for (const n of niveis) {
    const ws = XLSX.utils.aoa_to_sheet(montarMatriz(dados.niveis[n], colunas));
    XLSX.utils.book_append_sheet(wb, ws, NOME_ABA[n]);
  }
  XLSX.writeFile(wb, niveis.length === 1 ? `${nomeBase}.csv` : `${nomeBase}.xlsx`);
}
