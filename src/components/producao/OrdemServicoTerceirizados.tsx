export type OSItem = {
  servico: string;
  responsavel: string;
  interno: boolean;
  quantidade: number;
  dataEnviado: string | null;
  dataPrevista: string | null;
  observacao: string;
  aviamentos: string[];
  tecidos: string[];
};

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
    <div className="print-area">
      {itens.map((it, i) => (
        <section
          key={i}
          className="print-section"
          style={{
            pageBreakAfter: i < itens.length - 1 ? "always" : "auto",
            breakAfter: i < itens.length - 1 ? "page" : "auto",
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
            <div><b>Data de envio:</b> {fmtDate(it.dataEnviado)} &nbsp;·&nbsp; <b>Prazo:</b> {fmtDate(it.dataPrevista)}</div>
          </div>

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
    </div>
  );
}
