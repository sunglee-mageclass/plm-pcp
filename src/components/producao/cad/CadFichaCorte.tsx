import { cell, cellH } from "./types";
import type { AviamentoRow, GradeRow, TecidoRow } from "./types";

type Props = {
  modelo: any;
  cadRow: any;
  previsaoEntrega: string;
  tecidos: TecidoRow[];
  grades: GradeRow[];
  tamanhosAll: string[];
  aviamentos: AviamentoRow[];
  gradeTotalGeral: number;
};

const section: React.CSSProperties = { pageBreakInside: "avoid", breakInside: "avoid", marginTop: 12 };

export function CadFichaCorte({
  modelo,
  cadRow,
  previsaoEntrega,
  tecidos,
  grades,
  tamanhosAll,
  aviamentos,
  gradeTotalGeral,
}: Props) {
  return (
    <div className="print-area">
      <section className="print-section" style={{ pageBreakInside: "avoid", breakInside: "avoid" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Ficha de Corte</h1>
        <div style={{ fontSize: 12, marginBottom: 12 }}>
          REF: <b>{modelo?.ref ?? "—"}</b> &nbsp;|&nbsp; Modelo: <b>{modelo?.nome ?? "—"}</b>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12, marginBottom: 12 }}>
          <div>Estilista: {modelo?.estilista?.nome ?? "—"}</div>
          <div>Coleção: {modelo?.colecao ?? "—"}</div>
          <div>Categoria: {modelo?.cat_p?.nome ?? "—"}</div>
          <div>Sub-categoria: {modelo?.cat_s?.nome ?? "—"}</div>
          <div>Data Enviado ao Corte: {cadRow?.data_enviado_corte ?? "_____________"}</div>
          <div>Previsão de Entrega: {previsaoEntrega || "_____________"}</div>
        </div>
      </section>

      <section className="print-section" style={section}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 0 }}>Tecidos</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
          <thead><tr style={{ background: "#eee" }}>
            <th style={cellH}>Tipo</th><th style={cellH}>Artigo</th><th style={cellH}>Variantes</th><th style={cellH}>Consumo</th><th style={cellH}>%Loss</th><th style={cellH}>Folha (m)</th><th style={cellH}>Etiqueta</th>
          </tr></thead>
          <tbody>
            {tecidos.map((t, i) => (
              <tr key={i}>
                <td style={cell}>{t.tipo} {t.numero}</td>
                <td style={cell}>{t.artigo_nome ?? "—"}</td>
                <td style={cell}>{(t as any).variantes_nomes?.join(", ") ?? "—"}</td>
                <td style={cell}>{t.consumo_cad}</td>
                <td style={cell}>{t.loss_percent_cad}%</td>
                <td style={cell}>{t.tamanho_folha}</td>
                <td style={cell}>
                  {(t.etiqueta_lavagem_urls ?? []).length > 0
                    ? `${(t.etiqueta_lavagem_urls ?? []).length} arquivo(s)`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="print-section" style={section}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 0 }}>Grade Replanejada (total: {gradeTotalGeral})</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
          <thead><tr style={{ background: "#eee" }}>
            <th style={cellH}>Variante</th>
            {tamanhosAll.map((t) => <th key={t} style={cellH}>{t}</th>)}
            <th style={cellH}>Total</th>
          </tr></thead>
          <tbody>
            {grades.map((g) => (
              <tr key={g.variante_numero}>
                <td style={cell}>V{g.variante_numero}</td>
                {tamanhosAll.map((t) => <td key={t} style={cell}>{g.grades_planejadas[t] ?? 0}</td>)}
                <td style={cell}>{g.grade_total_planejada}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="print-section" style={section}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 0 }}>Aviamentos</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4 }}>
          <thead><tr style={{ background: "#eee" }}>
            <th style={cellH}>Aviamento</th><th style={cellH}>Consumo</th><th style={cellH}>Qtd a Enviar</th><th style={cellH}>Qtd a Separar</th>
          </tr></thead>
          <tbody>
            {aviamentos.map((a, i) => (
              <tr key={i}>
                <td style={cell}>{a.aviamento_nome ?? "—"}</td>
                <td style={cell}>{a.consumo}</td>
                <td style={cell}>{a.quantidade_enviar.toFixed(2)}</td>
                <td style={cell}>{a.quantidade_separar.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {(modelo?.observacoes_tecnicas || modelo?.observacoes_gerais) && (
        <section className="print-section" style={section}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginTop: 0 }}>Observações Técnicas</h3>
          {modelo?.observacoes_tecnicas && (
            <p style={{ fontSize: 11, whiteSpace: "pre-wrap", margin: "4px 0" }}>{modelo.observacoes_tecnicas}</p>
          )}
          {modelo?.observacoes_gerais && (
            <p style={{ fontSize: 11, whiteSpace: "pre-wrap", margin: "4px 0" }}>{modelo.observacoes_gerais}</p>
          )}
        </section>
      )}

      <section className="print-section" style={{ ...section, marginTop: 40 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, fontSize: 12 }}>
          <div>Nome: ______________________________</div>
          <div>Assinatura: ______________________________</div>
          <div>Nome: ______________________________</div>
          <div>Assinatura: ______________________________</div>
        </div>
      </section>
    </div>
  );
}
