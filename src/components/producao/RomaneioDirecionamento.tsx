import { cell, cellH } from "@/components/producao/cad/types";
import { PrintArea } from "@/components/shared/PrintArea";

type Loja = { id: string; nome: string };
type VarState = {
  variante_numero: number;
  real?: Record<string, number>;
  linhas?: Record<string, Record<string, number>>;
};

const cellC: React.CSSProperties = { ...cell, textAlign: "center" };

function fmtTam(t: string) {
  const [num, sig] = t.split("|");
  return sig ? `${sig} · ${num}` : t;
}

/**
 * Romaneio de Direcionamento (impresso): por variante, Grade Real + uma linha POR LOJA
 * + Σ Direcionado por tamanho, mais o total geral (todas as variantes).
 */
export function RomaneioDirecionamento({
  modelo,
  tamanhos,
  variantes,
  lojas,
  confirmado,
  dataStr,
  labelByNumero,
}: {
  modelo: any;
  tamanhos: string[];
  variantes: VarState[];
  lojas: Loja[];
  confirmado: boolean;
  dataStr: string;
  labelByNumero?: Record<number, string>;
}) {
  const num = (o: Record<string, number> | undefined, t: string) => Number(o?.[t] ?? 0);
  const sum = (o: Record<string, number>) => tamanhos.reduce((s, t) => s + (o[t] ?? 0), 0);

  // Linhas de uma variante: real + uma por loja + Σ direcionado.
  const linhasVariante = (v: VarState) => {
    const real: Record<string, number> = {};
    const porLoja = lojas.map((l) => ({ loja: l, vals: {} as Record<string, number> }));
    const dir: Record<string, number> = {};
    tamanhos.forEach((t) => {
      real[t] = num(v.real, t);
      let d = 0;
      porLoja.forEach((pl) => {
        const q = num(v.linhas?.[pl.loja.id], t);
        pl.vals[t] = q;
        d += q;
      });
      dir[t] = d;
    });
    return { real, porLoja, dir };
  };

  // Totais gerais por tamanho (todas as variantes).
  const gReal: Record<string, number> = {};
  const gPorLoja = lojas.map((l) => ({ loja: l, vals: {} as Record<string, number> }));
  const gDir: Record<string, number> = {};
  tamanhos.forEach((t) => {
    let r = 0, d = 0;
    const porLojaT = lojas.map(() => 0);
    variantes.forEach((v) => {
      r += num(v.real, t);
      lojas.forEach((l, i) => {
        const q = num(v.linhas?.[l.id], t);
        porLojaT[i] += q;
        d += q;
      });
    });
    gReal[t] = r; gDir[t] = d;
    gPorLoja.forEach((pl, i) => { pl.vals[t] = porLojaT[i]; });
  });

  const renderRow = (label: string, vals: Record<string, number>) => (
    <tr key={label}>
      <td style={{ ...cell, fontWeight: 600 }}>{label}</td>
      {tamanhos.map((t) => <td key={t} style={cellC}>{vals[t] ?? 0}</td>)}
      <td style={{ ...cellC, fontWeight: 700 }}>{sum(vals)}</td>
    </tr>
  );

  const tabela = (vals: { real: Record<string, number>; porLoja: { loja: Loja; vals: Record<string, number> }[]; dir: Record<string, number> }) => (
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
        {vals.porLoja.map((pl) => renderRow(pl.loja.nome, pl.vals))}
        {renderRow("Σ Direcionado", vals.dir)}
      </tbody>
    </table>
  );

  return (
    <PrintArea>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #000", paddingBottom: 6, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>ROMANEIO DE DIRECIONAMENTO</div>
          <div style={{ fontSize: 13 }}>{modelo?.ref ?? "—"} — {modelo?.nome ?? ""}{modelo?.colecao ? ` · ${modelo.colecao}` : ""}</div>
        </div>
        <div style={{ fontSize: 11, textAlign: "right" }}>{confirmado ? "Separado" : "Pendente"}<br />{dataStr}</div>
      </div>

      {variantes.map((v) => (
        <div key={v.variante_numero} className="print-section" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>{labelByNumero?.[v.variante_numero] ?? `Variante ${v.variante_numero}`}</div>
          {tabela(linhasVariante(v))}
        </div>
      ))}

      {variantes.length > 1 && (
        <div className="print-section" style={{ marginTop: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Total geral (todas as variantes)</div>
          {tabela({ real: gReal, porLoja: gPorLoja, dir: gDir })}
        </div>
      )}
    </PrintArea>
  );
}
