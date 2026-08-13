import type { CSSProperties } from "react";
import { PrintArea } from "@/components/shared/PrintArea";

export type OSItem = {
  servico: string;
  responsavel: string;
  interno: boolean;
  quantidade: number;
  // Quando o serviço é destrinchado por tamanho/variante, a grade ENVIADA (senão `null`/ausente).
  detalhado?: boolean;
  grade?: { tamanhos: string[]; linhas: { label: string; valores: number[]; total: number }[] } | null;
  dataEnviado: string | null;
  dataPrevista: string | null;
  dataEntregue: string | null;
  observacao: string;
  aviamentos: string[];
  tecidos: string[];
};

const thTd: CSSProperties = { border: "1px solid #999", padding: "3px 6px", textAlign: "center", fontSize: 11 };

function fmtDate(d: string | null) {
  if (!d) return "—";
  const s = d.split("T")[0];
  const [y, m, dd] = s.split("-");
  return dd && m && y ? `${dd}/${m}/${y}` : d;
}

/**
 * Ordem de Serviço por terceirizado (impresso): uma OS por bloco com responsável,
 * cada uma em sua página — o documento que acompanha as peças entregues ao
 * terceirizado/colaborador (serviço, quantidade, datas, materiais, recibo).
 */
export function OrdemServicoTerceirizados({
  modelo,
  itens,
  dataStr,
}: {
  modelo: any;
  itens: OSItem[];
  dataStr: string;
}) {
  return (
    <PrintArea>
      {itens.map((it, i) => (
        <section
          key={i}
          style={{
            // Quebra ANTES de cada serviço (menos o 1º) — mais confiável que break-after
            // p/ garantir 1 serviço por página. (Sem "print-section": o page-break-inside:
            // avoid conflitava com a quebra e deixava 2 serviços na mesma folha.)
            pageBreakBefore: i > 0 ? "always" : "auto",
            breakBefore: i > 0 ? "page" : "auto",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #000", paddingBottom: 6, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>ORDEM DE SERVIÇO</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{it.servico}</div>
            </div>
            <div style={{ fontSize: 11, textAlign: "right" }}>{dataStr}</div>
          </div>

          <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 12 }}>
            <div><b>Modelo:</b> {modelo?.ref ?? "—"} — {modelo?.nome ?? ""}{modelo?.colecao ? ` · ${modelo.colecao}` : ""}</div>
            <div><b>Responsável:</b> {it.responsavel}{it.interno ? " (interno)" : ""}</div>
            <div><b>Quantidade enviada:</b> {it.quantidade}</div>
            <div><b>Data de envio:</b> {fmtDate(it.dataEnviado)} &nbsp;·&nbsp; <b>Prazo:</b> {fmtDate(it.dataPrevista)} &nbsp;·&nbsp; <b>Data de entrega:</b> {fmtDate(it.dataEntregue)}</div>
          </div>

          {it.detalhado && it.grade && it.grade.linhas.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>Grade enviada (por tamanho × variante)</div>
              <table style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...thTd, textAlign: "left" }}>Variante</th>
                    {it.grade.tamanhos.map((t, i) => <th key={i} style={thTd}>{t}</th>)}
                    <th style={thTd}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {it.grade.linhas.map((l, i) => (
                    <tr key={i}>
                      <td style={{ ...thTd, textAlign: "left" }}>{l.label}</td>
                      {l.valores.map((v, j) => <td key={j} style={thTd}>{v || ""}</td>)}
                      <td style={{ ...thTd, fontWeight: 700 }}>{l.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {it.tecidos.length > 0 && (
            <div style={{ fontSize: 12, marginBottom: 8 }}><b>Tecidos enviados:</b> {it.tecidos.join(", ")}</div>
          )}
          {it.aviamentos.length > 0 && (
            <div style={{ fontSize: 12, marginBottom: 8 }}><b>Aviamentos enviados:</b> {it.aviamentos.join(", ")}</div>
          )}
          {it.observacao && (
            <div style={{ fontSize: 12, marginBottom: 8 }}><b>Observações:</b> {it.observacao}</div>
          )}

          <div style={{ marginTop: 48, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, fontSize: 12 }}>
            <div><div style={{ borderBottom: "1px solid #000", height: 16 }} /><div style={{ marginTop: 2 }}>Recebido por</div></div>
            <div><div style={{ borderBottom: "1px solid #000", height: 16 }} /><div style={{ marginTop: 2 }}>Data</div></div>
          </div>
        </section>
      ))}
    </PrintArea>
  );
}
