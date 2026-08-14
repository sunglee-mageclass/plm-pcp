import { format, parseISO } from "date-fns";
import { PrintArea } from "@/components/shared/PrintArea";
import { brl } from "@/lib/format";

type ComprovanteParcela = {
  representanteNome?: string | null;
  empresaNome?: string | null;
  empresas?: { nome: string } | null;
  numero_parcela: number;
  valor: number;
  data_vencimento: string;
  data_pagamento: string | null;
};

/**
 * Comprovante de pagamento — impressão (extraído de financeiro.tsx, onda 2 da varredura
 * §Q). Impressão é sempre fundo claro com cores fixas de propósito (§Q3) — este componente
 * fica FORA da regra de cor (não migra hex p/ token de tema).
 */
export function ComprovantePagamentoPrint({
  parcela, tipoLabel, ocNumero,
}: {
  parcela: ComprovanteParcela;
  tipoLabel: string;
  ocNumero: string;
}) {
  return (
    <PrintArea>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderBottom: "2px solid #000", paddingBottom: 6, marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>COMPROVANTE DE PAGAMENTO</div>
        <div style={{ fontSize: 11 }}>{new Date().toLocaleDateString("pt-BR")}</div>
      </div>
      <div style={{ fontSize: 13, lineHeight: 2 }}>
        <div><b>Fornecedor:</b> {parcela.representanteNome ?? parcela.empresaNome ?? parcela.empresas?.nome ?? "—"}</div>
        <div><b>Origem:</b> {tipoLabel} · Nº {ocNumero}</div>
        <div><b>Parcela:</b> {parcela.numero_parcela}</div>
        <div><b>Valor:</b> {brl(Number(parcela.valor))}</div>
        <div><b>Vencimento:</b> {parcela.data_vencimento ? parcela.data_vencimento.slice(0, 10).split("-").reverse().join("/") : "—"}</div>
        <div><b>Pago em:</b> {parcela.data_pagamento ? format(parseISO(parcela.data_pagamento), "dd/MM/yyyy") : "—"}</div>
      </div>
      <div style={{ marginTop: 48, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, fontSize: 12 }}>
        <div><div style={{ borderBottom: "1px solid #000", height: 16 }} /><div style={{ marginTop: 2 }}>Recebido por</div></div>
        <div><div style={{ borderBottom: "1px solid #000", height: 16 }} /><div style={{ marginTop: 2 }}>Data</div></div>
      </div>
    </PrintArea>
  );
}
