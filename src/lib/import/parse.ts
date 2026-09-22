// Leitura do XLSX (SheetJS) → linhas cruas por aba.
//
// Cada descritor tem UMA aba (sheetName). O header casa por `ColumnSpec.header`.
// Linhas de EXEMPLO (nome começando com "(exemplo)") são descartadas automaticamente
// — nunca viram cadastro por engano (decisão do dono).

import * as XLSX from "xlsx";
import type { ColumnSpec, RawRow } from "./types";

const EXEMPLO_RE = /^\s*\(exemplo\)/i;

/** Header EXIBÍVEL no template: anexa as opções quando a coluna tem valores fixos, p/
 *  auto-documentar ("Tipo" → "Tipo (Revenda | Importado)"). SSOT usado pelo template (escreve)
 *  e pelo parser (aceita as duas formas do header). NÃO inclui o "*" de obrigatório. */
export function headerComOpcoes(c: ColumnSpec): string {
  return c.opcoes && c.opcoes.length ? `${c.header} (${c.opcoes.join(" | ")})` : c.header;
}

/** Normaliza um header do XLSX p/ casar com ColumnSpec.header. Tira o "*" de obrigatório
 *  (o template escreve "Nome *" mas o ColumnSpec.header é "Nome"), colapsa espaços, lower. */
function normHeader(s: string): string {
  return String(s ?? "").replace(/\*/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export type ParseResult = {
  sheetName: string;
  encontrada: boolean;
  linhas: RawRow[];
  headersDesconhecidos: string[]; // headers no arquivo que não batem com nenhuma coluna
};

/**
 * Lê UMA aba do workbook e devolve as linhas cruas (chave da coluna → valor).
 * `chaveCampo` é o campo do descritor cujo valor decide se a linha é "(exemplo)".
 */
export function parseAba(
  wb: XLSX.WorkBook,
  sheetName: string,
  colunas: ColumnSpec[],
  chaveCampo: string,
): ParseResult {
  const ws = wb.Sheets[sheetName];
  if (!ws) return { sheetName, encontrada: false, linhas: [], headersDesconhecidos: [] };

  // matriz de linhas (array de arrays), 1ª linha = header.
  const matriz = XLSX.utils.sheet_to_json<string[]>(ws, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false, // tudo como string (datas/números viram texto — resolvemos no descritor)
  });
  if (matriz.length === 0) {
    return { sheetName, encontrada: true, linhas: [], headersDesconhecidos: [] };
  }

  const headerRow = matriz[0].map((h) => normHeader(h));
  // header normalizado → key da coluna. Registra as DUAS formas (limpa e com opções) p/ casar
  // tanto "Tipo" quanto "Tipo (Revenda | Importado)" que o template escreve.
  const headerToKey = new Map<string, string>();
  for (const c of colunas) {
    headerToKey.set(normHeader(c.header), c.key);
    headerToKey.set(normHeader(headerComOpcoes(c)), c.key);
  }

  const headersDesconhecidos: string[] = [];
  // índice da coluna → key (ou null se desconhecida)
  const colKey: (string | null)[] = headerRow.map((h) => {
    const k = headerToKey.get(h) ?? null;
    if (!k && h) headersDesconhecidos.push(h);
    return k;
  });

  const linhas: RawRow[] = [];
  for (let i = 1; i < matriz.length; i++) {
    const cells = matriz[i];
    const row = { __linha: i + 1 } as RawRow;
    let vazia = true;
    colKey.forEach((k, idx) => {
      if (!k) return;
      const v = String(cells[idx] ?? "").trim();
      row[k] = v;
      if (v) vazia = false;
    });
    if (vazia) continue; // linha totalmente em branco
    // descarta linha de exemplo (marcada no campo-chave, ex.: nome "(exemplo) Malha Fiore")
    const chaveVal = String(row[chaveCampo] ?? "");
    if (EXEMPLO_RE.test(chaveVal)) continue;
    linhas.push(row);
  }

  return { sheetName, encontrada: true, linhas, headersDesconhecidos };
}

/** Lê o arquivo (ArrayBuffer) e devolve o workbook. */
export function lerWorkbook(buf: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(buf, { type: "array" });
}

/**
 * Converte um valor de célula em número, aceitando OS DOIS formatos que aparecem na prática:
 *  • texto BR digitado pelo usuário: "1.234,56" (ponto = milhar, vírgula = decimal) → 1234.56
 *  • número já formatado pelo SheetJS (raw:false): "2.34" / "0.25" (PONTO = decimal) → 2.34
 *
 * A distinção é pela VÍRGULA: se há vírgula, ela é o separador decimal e os pontos são milhar
 * (padrão BR); se NÃO há vírgula, o ponto é o separador decimal (padrão JS/SheetJS). Isso corrige
 * o bug em que "2,34"/"2.34" viravam 234 (o parser antigo removia TODOS os pontos cegamente).
 * Retorna null p/ vazio ou não-numérico.
 */
export function parseNumeroBR(s: string | number | undefined | null): number | null {
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const v = (s ?? "").toString().trim();
  if (!v) return null;
  let norm: string;
  if (v.includes(",")) {
    // BR: vírgula decimal, pontos = milhar → remove pontos, vírgula vira ponto.
    norm = v.replace(/\./g, "").replace(",", ".");
  } else {
    // sem vírgula → o ponto (se houver) já é o separador decimal (SheetJS/JS). Não mexer.
    norm = v;
  }
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}
