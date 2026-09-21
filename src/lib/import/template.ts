// Gera o XLSX modelo (botão "Baixar Modelo") a partir dos MESMOS ColumnSpec que o parser lê.
// SSOT: template e parser nunca dessincronizam (o header vem de `ColumnSpec.header`).
//
// Cada aba nasce com:
//  - linha 1: headers (com * nos obrigatórios)
//  - linhas 2..3: 1-2 exemplos (prefixados "(exemplo)" no 1º campo → o parser os ignora)
//  - abaixo: linhas em branco p/ o usuário preencher
// + uma aba "Instruções" com a legenda de cada coluna (obrigatório / valores aceitos).

import * as XLSX from "xlsx";
import type { ColumnSpec, EntityImportDescriptor } from "./types";

const N_LINHAS_VAZIAS = 50;

function headerCell(c: ColumnSpec): string {
  return c.required ? `${c.header} *` : c.header;
}

/** Constrói a matriz (array de arrays) de uma aba: header + exemplos + linhas vazias. */
function matrizAba(desc: EntityImportDescriptor): string[][] {
  const headers = desc.colunas.map(headerCell);
  const rows: string[][] = [headers];

  // 1 linha de exemplo (a 1ª coluna recebe o prefixo "(exemplo)").
  const temExemplo = desc.colunas.some((c) => c.exemplo);
  if (temExemplo) {
    const ex = desc.colunas.map((c, i) => {
      const v = c.exemplo ?? "";
      if (i === 0) return v ? `(exemplo) ${v}` : "(exemplo)";
      return v;
    });
    rows.push(ex);
  }

  for (let i = 0; i < N_LINHAS_VAZIAS; i++) rows.push(desc.colunas.map(() => ""));
  return rows;
}

/** Aba "Instruções" — legenda por coluna de cada entidade. */
function matrizInstrucoes(descs: EntityImportDescriptor[]): string[][] {
  const rows: string[][] = [
    ["Como preencher — Importação em massa"],
    [""],
    ["Regras gerais:"],
    ["• Uma linha por COR (variante): repita o nome do item em várias linhas, mudando a cor."],
    ["• Campos com * são obrigatórios."],
    ['• As linhas "(exemplo)" são ignoradas na importação — pode deixá-las ou apagar.'],
    ["• Preencha nomes (não códigos): cor, categoria, fornecedor etc. são resolvidos pelo nome."],
    ["• Imagens: arquivos soltos (multi-select, sem ZIP). Como nomear cada aba está descrito abaixo."],
    [""],
  ];
  for (const d of descs) {
    rows.push([`Aba "${d.sheetName}" (${d.label})`]);
    for (const c of d.colunas) {
      const flags = c.required ? "obrigatório" : "opcional";
      const hint = c.hint ? ` — ${c.hint}` : "";
      rows.push([`   • ${c.header} (${flags})${hint}`]);
    }
    if (d.temFoto) {
      const modo = d.fotoModo ?? "entidade";
      rows.push(
        modo === "variante"
          ? [`   • Foto: 1 por COR — nomeie o arquivo "<Nome>_<Cor Apelido>" (ex.: "${d.label === "Tecidos" ? "Malha Fiore_Petróleo" : "Nome_Cor"}"). Sem apelido, use "<Nome>_<Cor base>".`]
          : [`   • Foto: 1 por item — nomeie o arquivo "<Nome>_Modelo" (principal), "<Nome>_Referencia" ou "<Nome>_Desenho".`],
      );
    }
    rows.push([""]);
  }
  return rows;
}

/** Gera o workbook (1 aba por descritor + Instruções). */
export function gerarTemplateWorkbook(descs: EntityImportDescriptor[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  for (const d of descs) {
    const ws = XLSX.utils.aoa_to_sheet(matrizAba(d));
    // largura de coluna generosa p/ leitura
    ws["!cols"] = d.colunas.map((c) => ({ wch: Math.max(14, c.header.length + 4) }));
    XLSX.utils.book_append_sheet(wb, ws, d.sheetName);
  }
  const wsInstr = XLSX.utils.aoa_to_sheet(matrizInstrucoes(descs));
  wsInstr["!cols"] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, wsInstr, "Instruções");
  return wb;
}

/** Dispara o download do template no navegador. */
export function baixarTemplate(descs: EntityImportDescriptor[], nomeArquivo = "modelo-importacao.xlsx") {
  const wb = gerarTemplateWorkbook(descs);
  XLSX.writeFile(wb, nomeArquivo);
}
