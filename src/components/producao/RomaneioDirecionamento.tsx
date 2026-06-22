import { cell, cellH } from "@/components/producao/cad/types";

type VarState = {
  variante_numero: number;
  real?: Record<string, number>;
  ecommerce?: Record<string, number>;
};

const cellC: React.CSSProperties = { ...cell, textAlign: "center" };

function fmtTam(t: string) {
  const [num, sig] = t.split("|");
  return sig ? `${sig} · ${num}` : t;
}

/**
 * Romaneio de Direcionamento (impresso): por variante, a separação Grade Real /
 * E-commerce / Loja Física por tamanho, mais o total geral. Loja Física = por
 * tamanho/variante, max(0, real − e-commerce); o total geral soma as variantes
 * (cada uma já pisada em 0), não max(0, soma−soma).
 */
export function RomaneioDirecionamento({
  modelo,
  tamanhos,
  variantes,
  confirmado,
  dataStr,
}: {
  modelo: any;
  tamanhos: string[];
  variantes: VarState[];
  confirmado: boolean;
  dataStr: string;
}) {
  const num = (o: Record<string, number> | undefined, t: string) => Number(o?.[t] ?? 0);
  const sum = (o: Record<string, number>) => tamanhos.reduce((s, t) => s + (o[t] ?? 0), 0);

  // Totais gerais por tamanho (todas as variantes).
  const gReal: Record<string, number> = {};
  const gEc: Record<string, number> = {};
  const gLf: Record<string, number> = {};
  tamanhos.forEach((t) => {
    let r = 0, e = 0, l = 0;
    variantes.forEach((v) => {
      const rv = num(v.real, t), ev = num(v.ecommerce, t);
      r += rv; e += ev; l += Math.max(0, rv - ev);
    });
    gReal[t] = r; gEc[t] = e; gLf[t] = l;
  });

  const renderRow = (label: string, vals: Record<string, number>) => (
    <tr>
      <td style={{ ...cell, fontWeight: 600 }}>{label}</td>
      {tamanhos.map((t) => <td key={t} style={cellC}>{vals[t] ?? 0}</td>)}
      <td style={{ ...cellC, fontWeight: 700 }}>{sum(vals)}</td>
    </tr>
  );

  const tabela = (vals: { real: Record<string, number>; ec: Record<string, number>; lf: Record<string, number> }) => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "fixed" }}>
      <thead>
        <tr>
          <th style={cellH}>Destino</th>
          {tamanhos.map((t) => <th key={t} style={cellH}>{fmtTam(t)}</th>)}
          <th style={cellH}>Total</th>
        </tr>
      </thead>
      <tbody>
        {renderRow("Grade Real", vals.real)}
        {renderRow("E-commerce", vals.ec)}
        {renderRow("Loja Física", vals.lf)}
      </tbody>
    </table>
  );

  return (
    <div className="print-area">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #000", paddingBottom: 6, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>ROMANEIO DE DIRECIONAMENTO</div>
          <div style={{ fontSize: 13 }}>{modelo?.ref ?? "—"} — {modelo?.nome ?? ""}{modelo?.colecao ? ` · ${modelo.colecao}` : ""}</div>
        </div>
        <div style={{ fontSize: 11, textAlign: "right" }}>{confirmado ? "Separado" : "Pendente"}<br />{dataStr}</div>
      </div>

      {variantes.map((v) => {
        const real: Record<string, number> = {}, ec: Record<string, number> = {}, lf: Record<string, number> = {};
        tamanhos.forEach((t) => {
          const rv = num(v.real, t), ev = num(v.ecommerce, t);
          real[t] = rv; ec[t] = ev; lf[t] = Math.max(0, rv - ev);
        });
        return (
          <div key={v.variante_numero} className="print-section" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Variante {v.variante_numero}</div>
            {tabela({ real, ec, lf })}
          </div>
        );
      })}

      {variantes.length > 1 && (
        <div className="print-section" style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Total geral (todas as variantes)</div>
          {tabela({ real: gReal, ec: gEc, lf: gLf })}
        </div>
      )}
    </div>
  );
}
