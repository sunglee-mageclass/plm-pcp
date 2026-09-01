import { format, parseISO } from "date-fns";
import { PrintArea } from "@/components/shared/PrintArea";
import { DocPapel, DocFolha, DocMarcaHeader, DocPeDocumento } from "@/components/shared/DocPrintCasca";
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
  const dataStr = new Date().toLocaleDateString("pt-BR");
  return (
    <PrintArea>
      <DocPapel>
        <DocFolha>
          <DocMarcaHeader titulo="Comprovante de Pagamento" nomeUpper dataStr={dataStr} />
          <div style={{ fontSize: 13, lineHeight: 2 }}>
            <div><b>Fornecedor:</b> {parcela.representanteNome ?? parcela.empresaNome ?? parcela.empresas?.nome ?? "—"}</div>
            <div><b>Origem:</b> {tipoLabel} · Nº {ocNumero}</div>
            <div><b>Parcela:</b> {parcela.numero_parcela}</div>
            <div><b>Valor:</b> {brl(Number(parcela.valor))}</div>
            <div><b>Vencimento:</b> {parcela.data_vencimento ? parcela.data_vencimento.slice(0, 10).split("-").reverse().join("/") : "—"}</div>
            <div><b>Pago em:</b> {parcela.data_pagamento ? format(parseISO(parcela.data_pagamento), "dd/MM/yyyy") : "—"}</div>
          </div>
          <DocPeDocumento tipo="recibo" dataStr={dataStr} />
        </DocFolha>
      </DocPapel>
    </PrintArea>
  );
}
