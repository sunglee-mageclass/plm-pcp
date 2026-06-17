import { cell, cellH } from "./types";
import type { AviamentoRow, GradeRow, TecidoRow } from "./types";
import { EtiquetaLavagemArtigoPrint } from "@/components/shared/EtiquetaLavagemArtigo";

type Props = {
  modelo: any;
  cadRow?: any;
  previsaoEntrega?: string;
  tecidos: TecidoRow[];
  grades: GradeRow[];
  tamanhosAll: string[];
  aviamentos: AviamentoRow[];
  gradeTotalGeral?: number;
  labelByNumero?: Record<number, string>;
};

// Altura de uma folha (A4 menos margens) e metade dela.
const PAGE_H = "250mm";
const pageStyle: React.CSSProperties = { height: PAGE_H, display: "flex", flexDirection: "column" };
const halfStyle: React.CSSProperties = { flex: "0 0 50%", overflow: "hidden", minHeight: 0 };
const fmt2 = (n: number | null | undefined) => Number(n ?? 0).toFixed(2);

function Assinatura() {
  return (
    <div style={{ marginTop: 54, fontSize: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 24 }}>
      {["Nome", "Data", "Assinatura"].map((l) => (
        <div key={l}>
          <div style={{ borderBottom: "1px solid #000", height: 16 }} />
          <div style={{ marginTop: 2 }}>{l}</div>
        </div>
      ))}
    </div>
  );
}

function varLabel(v: TecidoRow["variantes"][number]) {
  const cor = v.variante_cor || v.variante_nome;
  return `Variante ${v.ordem}${cor ? ` - ${cor}` : ""}`;
}

/** Tabela de variantes (mesmo esquema p/ tecido e p/ forro/entretela). */
function MaterialTable({ blocks, colMaterial }: { blocks: TecidoRow[]; colMaterial: string }) {
  const rows = blocks.flatMap((t) =>
    (t.variantes ?? []).filter((v) => v.variante_tecido_id).map((v) => ({ t, v })),
  );
  if (rows.length === 0) return <p style={{ fontSize: 11, color: "#666" }}>—</p>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
      <thead>
        <tr style={{ background: "#eee" }}>
          <th style={cellH}>Variante</th>
          <th style={cellH}>{colMaterial}</th>
          <th style={cellH}>Consumo</th>
          <th style={cellH}>Metr. Planejada</th>
          <th style={cellH}>Qtd Folhas</th>
          <th style={cellH}>Tamanho da Folha</th>
          <th style={cellH}>Metr. a Enviar/Separar</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ t, v }, i) => (
          <tr key={i}>
            <td style={cell}>{varLabel(v)}</td>
            <td style={cell}>{t.artigo_nome ?? "—"}</td>
            <td style={cell}>{fmt2(t.consumo_cad)}</td>
            <td style={cell}>{fmt2(v.metragem_planejada)}</td>
            <td style={cell}>{fmt2(v.quantidade_folhas)}</td>
            <td style={cell}>{fmt2(t.tamanho_folha)}</td>
            <td style={cell}>{fmt2(v.metragem_enviada)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Etiquetas({ blocks }: { blocks: TecidoRow[] }) {
  const withEt = blocks.filter((t) => t.artigo_id && (t.etiqueta_lavagem_urls ?? []).length > 0);
  if (withEt.length === 0) return null;
  return (
    <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 12 }}>
      {withEt.map((t, i) => (
        <div key={i} style={{ fontSize: 11 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Etiqueta — {t.artigo_nome}</div>
          <EtiquetaLavagemArtigoPrint artigoId={t.artigo_id} />
        </div>
      ))}
    </div>
  );
}

export function CadFichaCorte({ modelo, tecidos, grades, tamanhosAll, aviamentos, labelByNumero }: Props) {
  const isConjunto = (modelo?.cat_p?.nome ?? "").trim().toLowerCase() === "conjunto";
  const tecidoBlocks = tecidos.filter((t) => t.tipo === "tecido");
  const forroEntretela = tecidos.filter((t) => t.tipo === "forro" || t.tipo === "entretela");

  const refHl: React.CSSProperties = {
    background: "#ffcdd2",
    padding: "1px 8px",
    borderRadius: 3,
    fontWeight: 700,
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  };
  const repHl: React.CSSProperties = {
    marginLeft: 8,
    background: "#fff3cd",
    border: "1px solid #e0a800",
    color: "#8a6d00",
    borderRadius: 3,
    padding: "0 6px",
    fontSize: 11,
    fontWeight: 600,
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  };

  return (
    <div className="print-area">
      {/* ===== Página 1 ===== */}
      <div style={pageStyle}>
        {/* Metade de cima: cabeçalho + Tecido */}
        <div className="print-section" style={halfStyle}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>FICHA DE CORTE</h1>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", fontSize: 12, marginBottom: 8 }}>
            <div>
              REF: <span style={refHl}>{modelo?.ref ?? "—"}</span>
              {Number(modelo?.versao ?? 1) > 1 && <span style={repHl}>↻ Repetição v{modelo.versao}</span>}
            </div>
            <div>Modelo: <b>{modelo?.nome ?? "—"}</b></div>
            <div>Coleção: {modelo?.colecao ?? "—"}</div>
            <div>Linha: {modelo?.linha?.nome ?? "—"}</div>
            <div>Categoria: {modelo?.cat_p?.nome ?? "—"}</div>
            {isConjunto && <div>Subcategoria: {modelo?.cat_s?.nome ?? "—"}</div>}
          </div>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Tecido</h3>
          <MaterialTable blocks={tecidoBlocks} colMaterial="Tecido" />
          <Etiquetas blocks={tecidoBlocks} />
          <Assinatura />
        </div>

        {/* Metade de baixo: Forro e Entretela */}
        <div className="print-section" style={{ ...halfStyle, borderTop: "1px dashed #999", paddingTop: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Forro e Entretela</h3>
          <MaterialTable blocks={forroEntretela} colMaterial="Material" />
          <Etiquetas blocks={forroEntretela} />
          <Assinatura />
        </div>
      </div>

      {/* ===== Página 2 ===== */}
      <div style={{ ...pageStyle, pageBreakBefore: "always", breakBefore: "page" }}>
        {/* Metade de cima: Explosão de Aviamentos */}
        <div className="print-section" style={halfStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 0 }}>Explosão de Aviamentos</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
            <thead>
              <tr style={{ background: "#eee" }}>
                <th style={cellH}>Aviamento</th>
                <th style={cellH}>Consumo</th>
                <th style={cellH}>Quantidade Planejada</th>
                <th style={cellH}>Quantidade a Enviar</th>
              </tr>
            </thead>
            <tbody>
              {aviamentos.map((a, i) => (
                <tr key={i}>
                  <td style={cell}>{a.aviamento_nome ?? "—"}</td>
                  <td style={cell}>{fmt2(a.consumo)}</td>
                  <td style={cell}>{fmt2(a.quantidade_enviar)}</td>
                  <td style={cell}>{fmt2(a.quantidade_separar)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Assinatura />
        </div>

        {/* Metade de baixo: Grade */}
        <div className="print-section" style={{ ...halfStyle, borderTop: "1px dashed #999", paddingTop: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Grade</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
            <thead>
              <tr style={{ background: "#eee" }}>
                <th style={cellH}>Variante</th>
                {tamanhosAll.map((t) => <th key={t} style={cellH}>{t}</th>)}
                <th style={cellH}>Total</th>
              </tr>
            </thead>
            <tbody>
              {grades.map((g) => (
                <tr key={g.variante_numero}>
                  <td style={cell}>{labelByNumero?.[g.variante_numero] ?? `Variante ${g.variante_numero}`}</td>
                  {tamanhosAll.map((t) => <td key={t} style={cell}>{g.grades[t] ?? 0}</td>)}
                  <td style={cell}>{g.grade_total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
