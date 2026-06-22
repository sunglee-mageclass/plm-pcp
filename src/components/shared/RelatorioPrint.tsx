import type { ReactNode, CSSProperties } from "react";
import { PrintArea } from "@/components/shared/PrintArea";
import { useTenantBranding } from "@/hooks/useTenantBranding";

// Relatório imprimível genérico de nível executivo. Só aparece na impressão
// (.print-area). Cabeçalho com identidade da loja (logo/nome/CNPJ), faixa de
// KPIs opcional, gráfico opcional (topo), tabela e rodapé institucional.
// Reutilizado por Contas a Pagar, Posição de Estoque, Serviços, dashboards, etc.

const cellH: CSSProperties = { borderBottom: "2px solid #333", padding: "6px 8px", background: "#f0f0f0", fontWeight: 700, fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase", color: "#1a1a1a" };
const cell: CSSProperties = { borderBottom: "1px solid #e6e6e6", padding: "5px 8px", fontSize: 11, color: "#1a1a1a" };

export type RelColuna = { key: string; label: string; align?: "left" | "right" | "center" };
export type RelKpi = { label: string; valor: ReactNode; cor?: string };

export function RelatorioPrint({
  titulo,
  subtitulo,
  colunas,
  linhas,
  rodape,
  dataStr,
  topo,
  kpis,
}: {
  titulo: string;
  subtitulo?: string;
  colunas: RelColuna[];
  linhas: Record<string, ReactNode>[];
  rodape?: ReactNode;
  dataStr: string;
  /** Conteúdo opcional acima da tabela (ex.: gráfico de tamanho fixo). */
  topo?: ReactNode;
  /** Faixa de indicadores-resumo no topo do relatório (visão executiva). */
  kpis?: RelKpi[];
}) {
  const loja = useTenantBranding();
  const nomeLoja = loja.nome ?? "sisTrama";

  return (
    <PrintArea>
      <div style={{ fontFamily: "Helvetica, Arial, sans-serif", color: "#1a1a1a" }}>
        {/* Cabeçalho institucional */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: "3px solid #1a1a1a", paddingBottom: 10, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {loja.logoUrl && <img src={loja.logoUrl} alt="" style={{ maxHeight: 52, maxWidth: 120, objectFit: "contain" }} />}
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.1 }}>{nomeLoja}</div>
              {loja.cnpj && <div style={{ fontSize: 9.5, color: "#666" }}>CNPJ {loja.cnpj}</div>}
              {loja.contato && <div style={{ fontSize: 9.5, color: "#666" }}>{loja.contato}</div>}
            </div>
          </div>
          <div style={{ textAlign: "right", maxWidth: "55%" }}>
            <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.15 }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: 11, color: "#444", marginTop: 2 }}>{subtitulo}</div>}
            <div style={{ fontSize: 9.5, color: "#888", marginTop: 3 }}>Emitido em {dataStr}</div>
          </div>
        </div>

        {/* Faixa de KPIs */}
        {kpis && kpis.length > 0 && (
          <div className="print-section" style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            {kpis.map((k, i) => (
              <div key={i} style={{ flex: 1, border: "1px solid #ddd", borderRadius: 6, padding: "8px 12px" }}>
                <div style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#888" }}>{k.label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 3, color: k.cor ?? "#1a1a1a" }}>{k.valor}</div>
              </div>
            ))}
          </div>
        )}

        {/* Gráfico */}
        {topo && <div className="print-section" style={{ marginBottom: 16 }}>{topo}</div>}

        {/* Tabela */}
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
        {rodape && <div style={{ marginTop: 10, paddingTop: 8, borderTop: "2px solid #333", fontSize: 12, fontWeight: 700, textAlign: "right" }}>{rodape}</div>}

        {/* Rodapé institucional */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 22, paddingTop: 6, borderTop: "1px solid #ddd", fontSize: 8.5, color: "#999" }}>
          <span>Relatório gerado pelo sisTrama</span>
          <span>{nomeLoja} · {dataStr}</span>
        </div>
      </div>
    </PrintArea>
  );
}
