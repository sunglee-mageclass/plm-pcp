import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { InfoStrip } from "@/components/shared/InfoStrip";
import { FornecedorSelect, type EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import { CampoDataNotaEntrada } from "@/components/shared/NotaEntrada";
import { FileField } from "@/components/oc-tecido/FileField";
import { OcSecTitle } from "@/components/oc-tecido/OcTecidoForm";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { totaisDaOc, totaisDoItem, type ItemOcPa } from "./itens";
import { contarParcelasPrazo, fmtDate, fmtMoney, type CabecalhoDraft } from "./shared";
import type { Dispatch, SetStateAction, ReactNode } from "react";

/**
 * O CABEÇALHO da OC (R13): o que é da OC inteira — fornecedor, datas, prazo e a Data da Nota de Entrada. O produto saiu daqui: cada
 * produto é um item (`OcPaItem`). Seção 1 · Dados do pedido; Seção 3 · Valores & parcelas; Seção 4 · Anexos (o pedido em PDF).
 * O nº da OC é gerado pelo servidor na criação e NUNCA muda (P-361): só é exibido.
 */
export function OcPaCabecalho({
  draft, setDraft, empresas, numeroOc, numeroPrevia, isEdit, disabled = false,
}: {
  draft: CabecalhoDraft;
  setDraft: Dispatch<SetStateAction<CabecalhoDraft>>;
  empresas: EmpresaFornecedor[];
  /** Nº da OC já gerada (OC existente). */
  numeroOc: string | null;
  /** Prévia da sigla ("BELDIV-NNNNN") para a OC nova. */
  numeroPrevia?: string | null;
  isEdit: boolean;
  disabled?: boolean;
}) {
  return (
    <section id="ocpa-sec-pedido" className="scroll-mt-2 space-y-4">
      <OcSecTitle n={1}>Dados do pedido</OcSecTitle>
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="grid gap-1">
          <Label>Nº do pedido</Label>
          <Input
            value={draft.numero}
            onChange={(e) => setDraft((d) => ({ ...d, numero: e.target.value }))}
            placeholder={numeroOc ?? (numeroPrevia ? `Automático — ${numeroPrevia}` : "Automático")}
            maxLength={40}
            disabled={disabled}
          />
          <p className="text-xs text-muted-foreground">
            {isEdit ? "Você pode trocar o número. Em branco, mantém o atual." : "Gerado automaticamente ao criar. Digite para usar outro número."}
          </p>
        </div>
        <div className="grid gap-1">
          <Label>Fornecedor</Label>
          <FornecedorSelect
            empresas={empresas}
            empresaId={draft.empresa_id}
            representanteId={draft.representante_id}
            onChange={(empresa_id, representante_id) => setDraft((d) => ({ ...d, empresa_id, representante_id }))}
            disabled={disabled}
          />
        </div>
        <div className="grid gap-1">
          <Label>Data do pedido</Label>
          <DateField value={draft.data_pedido} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, data_pedido: e.target.value }))} />
        </div>
        <div className="grid gap-1">
          <Label>Data prevista de entrega</Label>
          <DateField value={draft.data_prevista} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, data_prevista: e.target.value }))} />
        </div>
        {/* Prazo digitado → nº de parcelas a pagar DERIVADO (`contarParcelasPrazo` espelha o gatilho do banco). */}
        <div className="grid gap-1">
          <Label>Prazo de pagamento</Label>
          <Input
            placeholder="Ex: 30/60/90" value={draft.prazo_pagamento} disabled={disabled}
            onChange={(e) => { const v = e.target.value; setDraft((d) => ({ ...d, prazo_pagamento: v, parcelas_entrega: contarParcelasPrazo(v) })); }}
          />
        </div>
        <div className="grid gap-1">
          <Label>Parcelas a pagar (derivado)</Label>
          <NumberInput type="number" integer value={draft.parcelas_entrega} readOnly disabled />
        </div>
      </div>
    </section>
  );
}

/** Seção 3 · Valores & parcelas da OC: uma linha por produto, o total da OC (as parcelas saem do TOTAL) e a Data da Nota de Entrada. */
export function OcPaTotais({
  draft, setDraft, itens, disabled = false, aviso,
}: {
  draft: CabecalhoDraft;
  setDraft: Dispatch<SetStateAction<CabecalhoDraft>>;
  itens: ReadonlyArray<ItemOcPa>;
  disabled?: boolean;
  /** Aviso acima da tabela (ex.: falta a Data da Nota). */
  aviso?: ReactNode;
}) {
  const t = totaisDaOc(itens);
  const nParcelas = contarParcelasPrazo(draft.prazo_pagamento);
  return (
    <section id="ocpa-sec-valores" className="scroll-mt-2 space-y-4">
      <OcSecTitle n={3}>Valores &amp; parcelas da OC</OcSecTitle>
      {aviso}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead className="text-right">Peças</TableHead>
            <TableHead className="text-right">Bruto</TableHead>
            <TableHead className="text-right">Desconto</TableHead>
            <TableHead className="text-right">Total c/ desc.</TableHead>
            <TableHead>Recebimento</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {itens.map((it) => {
            const x = totaisDoItem(it);
            return (
              <TableRow key={it.tempId}>
                <TableCell className="font-medium">{it.nome_produto || "Sem nome"}</TableCell>
                <TableCell className="text-right tabular-nums">{x.pecas}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(x.bruto)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(x.desconto)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(x.total)}</TableCell>
                <TableCell>
                  {it.status === "recebido"
                    ? <StatusBadge tone="success">Recebido{it.data_entrega ? ` em ${fmtDate(it.data_entrega)}` : ""}</StatusBadge>
                    : <StatusBadge tone="warning">Aguardando</StatusBadge>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell>Total da OC</TableCell>
            <TableCell className="text-right tabular-nums">{t.pecas}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtMoney(t.bruto)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtMoney(t.desconto)}</TableCell>
            <TableCell className="text-right tabular-nums">{fmtMoney(t.total)}</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
      <InfoStrip
        itens={[
          { label: "Prazo", valor: `${draft.prazo_pagamento || "—"} · ${nParcelas} ${nParcelas === 1 ? "parcela" : "parcelas"}` },
          { label: "Produtos", valor: itens.length },
          { label: "Total da OC", valor: fmtMoney(t.total), hi: true },
        ]}
      />
      <p className="text-xs text-muted-foreground">As parcelas a pagar saem do total da OC (o ajuste de vencimento e o pagamento são no Financeiro).</p>
      {/* Data da Nota de Entrada (ajuste do dono 25/set): editável MESMO com a OC recebida (é preenchida depois de receber). */}
      <CampoDataNotaEntrada value={draft.data_nota_entrada} onChange={(v) => setDraft((d) => ({ ...d, data_nota_entrada: v }))} disabled={disabled} />
    </section>
  );
}

/** Seção 4 · Anexos: o PDF do pedido (a NF é por produto, no recebimento). */
export function OcPaAnexos({
  draft, setDraft, onUpload, disabled = false,
}: {
  draft: CabecalhoDraft;
  setDraft: Dispatch<SetStateAction<CabecalhoDraft>>;
  onUpload: (file: File) => void;
  disabled?: boolean;
}) {
  return (
    <section id="ocpa-sec-anexos" className="scroll-mt-2 space-y-4">
      <OcSecTitle n={4}>Anexos</OcSecTitle>
      <div className="grid sm:grid-cols-2 gap-4">
        <FileField
          label="Pedido (PDF)"
          path={draft.anexo_pedido_url}
          bucket="oc-tecido"
          disabled={disabled}
          onChange={onUpload}
          onClear={() => setDraft((d) => ({ ...d, anexo_pedido_url: null }))}
        />
      </div>
    </section>
  );
}
