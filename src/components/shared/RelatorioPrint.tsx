import type { ReactNode, CSSProperties } from "react";
import { PrintArea } from "@/components/shared/PrintArea";
import { useTenantBranding } from "@/hooks/useTenantBranding";

// Relatório imprimível de nível executivo (A4). Só aparece na impressão (.print-area).
// Cabeçalho de marca (logo/nome/CNPJ) + faixa de KPIs + donut opcional + corpo
// (tabela simples OU seções com ícone/gráfico/tabela) + rodapé institucional.

const TINTA = "#1a1a1a";

// Paleta fixa de acento p/ KPI/donut do relatório — impressão é sempre fundo claro com
// cores FIXAS de propósito (nunca token de tema, ver exceção de impressão §Q3): exportadas
// p/ os chamadores (dashboard.tsx, financeiro.tsx) montarem `kpis`/`donut` sem reintroduzir
// hex solto fora daqui.
export const REL_COR_SUCESSO = "#16a34a";
export const REL_COR_ALERTA = "#ca8a04";
export const REL_COR_PERIGO = "#dc2626";
const cellH: CSSProperties = { borderBottom: "2px solid #333", padding: "6px 8px", background: "#f0f0f0", fontWeight: 700, fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase", color: TINTA };
const cell: CSSProperties = { borderBottom: "1px solid #e6e6e6", padding: "5px 8px", fontSize: 11, color: TINTA };

export type RelColuna = { key: string; label: string; align?: "left" | "right" | "center" };
export type RelKpi = { label: string; valor: ReactNode; cor?: string };
export type RelDonut = { pct: number; cor?: string; titulo: string; legenda?: string };
export type RelSecao = {
  titulo: string;
  icone?: string;
  descricao?: string;
  grafico?: ReactNode;
  colunas?: RelColuna[];
  linhas?: Record<string, ReactNode>[];
  rodape?: ReactNode;
  /** Zebra azul claro nas linhas ímpares. */
  zebra?: boolean;
};

function Tabela({ colunas, linhas, zebra }: { colunas: RelColuna[]; linhas: Record<string, ReactNode>[]; zebra?: boolean }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
      <thead>
        <tr>{colunas.map((c) => <th key={c.key} style={{ ...cellH, textAlign: c.align ?? "left" }}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {linhas.length === 0 ? (
          <tr><td style={cell} colSpan={colunas.length}>Sem dados.</td></tr>
        ) : linhas.map((r, i) => (
          <tr key={i} className={zebra && i % 2 === 1 ? "rel-az" : undefined}>
            {colunas.map((c) => <td key={c.key} style={{ ...cell, textAlign: c.align ?? "left" }}>{r[c.key]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Icone({ ch }: { ch: string }) {
  return <span style={{ width: 26, height: 26, borderRadius: "50%", background: TINTA, color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, flex: "none" }}>{ch}</span>;
}

function SecaoHeader({ icone, titulo, descricao }: { icone?: string; titulo: string; descricao?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, borderBottom: "1px solid #ccc", paddingBottom: 4 }}>
        {icone && <Icone ch={icone} />}
        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.2, textTransform: "uppercase" }}>{titulo}</div>
      </div>
      {descricao && <div style={{ fontSize: 10, color: "#666", marginTop: 5 }}>{descricao}</div>}
    </div>
  );
}

function Donut({ pct, cor = "#16a34a" }: { pct: number; cor?: string }) {
  const r = 58, c = 2 * Math.PI * r, on = (c * pct) / 100;
  return (
    <svg width="148" height="148" viewBox="0 0 160 160">
      <circle cx="80" cy="80" r={r} fill="none" stroke="#e5e7eb" strokeWidth="22" />
      <circle cx="80" cy="80" r={r} fill="none" stroke={cor} strokeWidth="22" strokeDasharray={`${on} ${c - on}`} transform="rotate(-90 80 80)" />
      <text x="80" y="93" textAnchor="middle" fontSize="38" fontWeight="800" fill={cor}>{pct}%</text>
    </svg>
  );
}

export function RelatorioPrint({
  titulo, subtitulo, dataStr, kpis, donut, secoes, colunas, linhas, topo, rodape,
}: {
  titulo: string;
  subtitulo?: string;
  dataStr: string;
  kpis?: RelKpi[];
  donut?: RelDonut;
  secoes?: RelSecao[];
  colunas?: RelColuna[];
  linhas?: Record<string, ReactNode>[];
  topo?: ReactNode;
  rodape?: ReactNode;
}) {
  const loja = useTenantBranding();
  const nomeLoja = loja.nome ?? "WISH360";

  return (
    <PrintArea>
      <div style={{ fontFamily: "Helvetica, Arial, sans-serif", color: TINTA }}>
        {/* Cabeçalho institucional */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {loja.logoUrl && <img src={loja.logoUrl} alt="" style={{ maxHeight: 38, maxWidth: 96, objectFit: "contain" }} />}
            <div style={{ fontSize: 12, color: "#444" }}>
              <b style={{ color: TINTA }}>{nomeLoja}</b>{loja.cnpj ? ` · CNPJ ${loja.cnpj}` : ""}{loja.contato ? ` · ${loja.contato}` : ""}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#888" }}>Emitido em {dataStr}</div>
        </div>
        <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.4, lineHeight: 1.1 }}>{titulo}</div>
        {subtitulo && <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>{subtitulo}</div>}
        <div style={{ height: 5, background: TINTA, margin: "10px 0 16px" }} />

        {/* Faixa de KPIs */}
        {kpis && kpis.length > 0 && (
          <div className="print-section" style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
            {kpis.map((k, i) => (
              <div key={i} style={{ flex: "1 1 0", minWidth: 110, border: "1px solid #ddd", borderRadius: 8, padding: "9px 13px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#888" }}>{k.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 3, color: k.cor ?? TINTA }}>{k.valor}</div>
              </div>
            ))}
          </div>
        )}

        {/* Donut em destaque (ex.: % no prazo) — lado a lado com legenda */}
        {donut && (
          <div className="print-section" style={{ display: "flex", alignItems: "center", gap: 18, border: "1px solid #ddd", borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
            <Donut pct={donut.pct} cor={donut.cor} />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>{donut.titulo}</div>
              {donut.legenda && <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{donut.legenda}</div>}
            </div>
          </div>
        )}

        {/* Corpo: seções OU tabela simples */}
        {secoes && secoes.length > 0 ? (
          secoes.map((s, i) => (
            <div key={i} className="print-section" style={{ marginBottom: 18 }}>
              <SecaoHeader icone={s.icone} titulo={s.titulo} descricao={s.descricao} />
              {s.grafico && <div style={{ marginBottom: s.colunas ? 10 : 0 }}>{s.grafico}</div>}
              {s.colunas && s.linhas && <Tabela colunas={s.colunas} linhas={s.linhas} zebra={s.zebra} />}
              {s.rodape && <div style={{ marginTop: 6, fontSize: 11, fontWeight: 700, textAlign: "right" }}>{s.rodape}</div>}
            </div>
          ))
        ) : (
          <>
            {topo && <div className="print-section" style={{ marginBottom: 16 }}>{topo}</div>}
            {colunas && linhas && <Tabela colunas={colunas} linhas={linhas} zebra />}
            {rodape && <div style={{ marginTop: 10, paddingTop: 8, borderTop: "2px solid #333", fontSize: 12, fontWeight: 700, textAlign: "right" }}>{rodape}</div>}
          </>
        )}

        {/* Rodapé institucional */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20, paddingTop: 6, borderTop: "1px solid #ddd", fontSize: 11, color: "#999" }}>
          <span>Relatório gerado pelo WISH360</span>
          <span>{nomeLoja} · {dataStr}</span>
        </div>
      </div>
    </PrintArea>
  );
}
