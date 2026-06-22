import type { ReactNode } from "react";

// Relatório imprimível genérico (tabela). Só aparece na impressão (.print-area).
// Reutilizado por vários relatórios operacionais (Contas a Pagar, Posição de
// Estoque, etc.). Imprime via window.print()/printWithImages com o CSS .print-area.

const cellH: React.CSSProperties = { border: "1px solid #999", padding: "3px 6px", background: "#eee", fontWeight: 600, fontSize: 11 };
const cell: React.CSSProperties = { border: "1px solid #999", padding: "3px 6px", fontSize: 11 };

export type RelColuna = { key: string; label: string; align?: "left" | "right" | "center" };

export function RelatorioPrint({
  titulo,
  subtitulo,
  colunas,
  linhas,
  rodape,
  dataStr,
}: {
  titulo: string;
  subtitulo?: string;
  colunas: RelColuna[];
  linhas: Record<string, ReactNode>[];
  rodape?: ReactNode;
  dataStr: string;
}) {
  return (
    <div className="print-area">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #000", paddingBottom: 6, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{titulo}</div>
          {subtitulo && <div style={{ fontSize: 12, color: "#444" }}>{subtitulo}</div>}
        </div>
        <div style={{ fontSize: 11, textAlign: "right" }}>{dataStr}</div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead>
          <tr>{colunas.map((c) => <th key={c.key} style={{ ...cellH, textAlign: c.align ?? "left" }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.length === 0 ? (
            <tr><td style={cell} colSpan={colunas.length}>Sem dados.</td></tr>
          ) : linhas.map((r, i) => (
            <tr key={i}>{colunas.map((c) => <td key={c.key} style={{ ...cell, textAlign: c.align ?? "left" }}>{r[c.key]}</td>)}</tr>
          ))}
        </tbody>
      </table>
      {rodape && <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600 }}>{rodape}</div>}
    </div>
  );
}
