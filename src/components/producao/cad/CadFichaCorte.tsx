import { cell, cellH } from "./types";
import type { AviamentoRow, GradeRow, TecidoRow } from "./types";
import { EtiquetaLavagemArtigoView } from "@/components/shared/EtiquetaLavagemArtigo";

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

const section: React.CSSProperties = { pageBreakInside: "avoid", breakInside: "avoid", marginTop: 12 };
const fmt2 = (n: number | null | undefined) => Number(n ?? 0).toFixed(2);

function Assinatura() {
  return (
    <div style={{ marginTop: 18, fontSize: 12, display: "flex", gap: 28, flexWrap: "wrap" }}>
      <span>Nome: ____________________</span>
      <span>Data: ____________</span>
      <span>Assinatura: ____________________</span>
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
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      {withEt.map((t, i) => (
        <div key={i} style={{ fontSize: 11 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>
            Etiqueta — {t.artigo_nome}
          </div>
          <EtiquetaLavagemArtigoView artigoId={t.artigo_id} label="" size="sm" />
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

  return (
    <div className="print-area">
      {/* ===== Página 1: cabeçalho + tecidos + forro/entretela ===== */}
      <section className="print-section" style={{ pageBreakInside: "avoid", breakInside: "avoid" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>FICHA DE CORTE</h1>
        <div style={{ fontSize: 13, marginBottom: 6 }}>
          REF: <span style={refHl}>{modelo?.ref ?? "—"}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12 }}>
          <div>Modelo: <b>{modelo?.nome ?? "—"}</b></div>
          <div>Coleção: {modelo?.colecao ?? "—"}</div>
          <div>Categoria: {modelo?.cat_p?.nome ?? "—"}</div>
          {isConjunto && <div>Subcategoria: {modelo?.cat_s?.nome ?? "—"}</div>}
        </div>
      </section>

      <section className="print-section" style={section}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 0, marginBottom: 0 }}>Tecido</h3>
        <MaterialTable blocks={tecidoBlocks} colMaterial="Tecido" />
        <Etiquetas blocks={tecidoBlocks} />
        <Assinatura />
      </section>

      <div style={{ borderTop: "1px dashed #999", margin: "16px 0" }} />

      <section className="print-section" style={{ ...section, marginTop: 0 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 0, marginBottom: 0 }}>Forro e Entretela</h3>
        <MaterialTable blocks={forroEntretela} colMaterial="Material" />
        <Etiquetas blocks={forroEntretela} />
        <Assinatura />
      </section>

      {/* ===== Página 2: explosão de aviamentos + grade ===== */}
      <section className="print-section" style={{ ...section, pageBreakBefore: "always", breakBefore: "page", marginTop: 0 }}>
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
      </section>

      <section className="print-section" style={section}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 0 }}>Grade</h3>
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
      </section>
    </div>
  );
}
