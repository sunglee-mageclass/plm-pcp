// Modelo de template de impressão (PoC: cabeçalho da Ficha de Corte).
// O mesmo layout é usado no editor (com dados fake) e na impressão real.

export type PrintBlock = {
  id: string;
  type: "logo" | "field" | "text";
  field?: string; // quando type = "field"
  text?: string; // quando type = "text"
  x: number;
  y: number;
  w: number;
  h: number;
  bold?: boolean;
  align?: "left" | "center" | "right";
  fontSize?: number;
};

export type HeaderLayout = {
  cols: number; // colunas da grade (ex.: 12)
  rowH: number; // altura de cada linha, em px (referência)
  rows: number; // altura do cabeçalho em linhas
  blocks: PrintBlock[];
};

// Largura útil de impressão (px @96dpi) ≈ A4 (210mm) − margens @page (12mm) −
// padding .print-area (16px). Usada IDÊNTICA no editor e na impressão para a
// escala (fontes/logo/posições) bater exatamente.
export const PRINT_CONTENT_W = 672;

// Campos disponíveis no cabeçalho da Ficha de Corte (com valor de exemplo p/ o editor).
export const FICHA_CORTE_FIELDS: { key: string; label: string; mock: string }[] = [
  { key: "ref", label: "REF", mock: "1234" },
  { key: "nome", label: "Modelo", mock: "Vestido Midi" },
  { key: "colecao", label: "Coleção", mock: "Verão 26" },
  { key: "linha", label: "Linha", mock: "Festa" },
  { key: "categoria", label: "Categoria", mock: "Vestido" },
  { key: "subcategoria", label: "Subcategoria", mock: "Longo" },
  { key: "versao", label: "Versão", mock: "v2" },
  { key: "previsao", label: "Data Prevista", mock: "31/12/2026" },
];

export function fichaCorteFieldLabel(key: string) {
  return FICHA_CORTE_FIELDS.find((f) => f.key === key)?.label ?? key;
}

export function fichaCorteFieldMock(key: string) {
  return FICHA_CORTE_FIELDS.find((f) => f.key === key)?.mock ?? "";
}

// Valor real do campo a partir do modelo (mesma origem do cabeçalho atual).
export function fichaCorteFieldValue(
  key: string,
  ctx: { modelo?: any; previsaoEntrega?: string },
): string {
  const m = ctx.modelo ?? {};
  switch (key) {
    case "ref": return m.ref ?? "—";
    case "nome": return m.nome ?? "—";
    case "colecao": return m.colecao ?? "—";
    case "linha": return m.linha?.nome ?? "—";
    case "categoria": return m.cat_p?.nome ?? "—";
    case "subcategoria": return m.cat_s?.nome ?? "—";
    case "versao": return m.versao ? `v${m.versao}` : "v1";
    case "previsao": return ctx.previsaoEntrega || "—";
    default: return "";
  }
}

export const DEFAULT_FICHA_CORTE_HEADER: HeaderLayout = {
  cols: 12,
  rowH: 28,
  rows: 6,
  blocks: [
    { id: "logo", type: "logo", x: 0, y: 0, w: 3, h: 3 },
    { id: "titulo", type: "text", text: "FICHA DE CORTE", x: 3, y: 0, w: 9, h: 1, bold: true, fontSize: 20 },
    { id: "f_ref", type: "field", field: "ref", x: 3, y: 1, w: 3, h: 1, bold: true },
    { id: "f_nome", type: "field", field: "nome", x: 6, y: 1, w: 6, h: 1 },
    { id: "f_colecao", type: "field", field: "colecao", x: 3, y: 2, w: 3, h: 1 },
    { id: "f_linha", type: "field", field: "linha", x: 6, y: 2, w: 3, h: 1 },
    { id: "f_categoria", type: "field", field: "categoria", x: 9, y: 2, w: 3, h: 1 },
  ],
};

export function isHeaderLayout(v: any): v is HeaderLayout {
  return v && typeof v === "object" && Array.isArray(v.blocks) && typeof v.cols === "number";
}
