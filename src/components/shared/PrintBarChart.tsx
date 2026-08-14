import type { ReactNode } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, LabelList } from "recharts";

// Gráficos de barras de TAMANHO FIXO p/ impressão (extraídos de dashboard.tsx — só
// usados dentro de `secoes[].grafico` de <RelatorioPrint>, nunca on-screen).
// ResponsiveContainer mede 0 em display:none; isAnimationActive=false senão sai vazio
// escondido. Impressão é sempre fundo claro com cores fixas de propósito (§Q3) — as
// cores de eixo/grade abaixo NÃO seguem o token de tema.

const labelStyle = { fontSize: 9, fill: "#475569", fontWeight: 600 } as const;

export function PBar({ data, xKey, barKey, fmtL, color = "hsl(217 91% 60%)", horizontal, height = 190, width = 680 }: { data: any[]; xKey: string; barKey: string; fmtL?: (v: any) => string; color?: string; horizontal?: boolean; height?: number; width?: number }) {
  if (horizontal) {
    return (
      <BarChart width={width} height={height} data={data} layout="vertical" margin={{ left: 2, right: 30, top: 2, bottom: 2 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={fmtL} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey={xKey} width={132} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
        <Bar dataKey={barKey} fill={color} isAnimationActive={false} radius={[0, 3, 3, 0]}>
          <LabelList dataKey={barKey} position="right" style={labelStyle} formatter={fmtL} />
        </Bar>
      </BarChart>
    );
  }
  return (
    <BarChart width={width} height={height} data={data} margin={{ top: 16, right: 8, bottom: 2, left: 2 }}>
      <CartesianGrid strokeDasharray="3 3" stroke="#eef0f2" vertical={false} />
      <XAxis dataKey={xKey} tick={{ fontSize: 10 }} axisLine={{ stroke: "#ccc" }} tickLine={false} />
      <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtL} axisLine={false} tickLine={false} width={fmtL ? 42 : 28} />
      <Bar dataKey={barKey} fill={color} isAnimationActive={false} radius={[3, 3, 0, 0]}>
        <LabelList dataKey={barKey} position="top" style={labelStyle} formatter={fmtL} />
      </Bar>
    </BarChart>
  );
}

// Duas mini-barras lado a lado (ex.: Modelos | Grade), p/ caber no A4.
export function PBar2({ a, b }: { a: { titulo: string; node: ReactNode }; b: { titulo: string; node: ReactNode } }) {
  return (
    <div style={{ display: "flex", gap: 18 }}>
      {[a, b].map((c, i) => (
        <div key={i} style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{c.titulo}</div>
          {c.node}
        </div>
      ))}
    </div>
  );
}
