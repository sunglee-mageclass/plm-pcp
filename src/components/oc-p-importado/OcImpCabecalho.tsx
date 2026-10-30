import { useState } from "react";
import type { Dispatch, SetStateAction, ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { InfoStrip } from "@/components/shared/InfoStrip";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FornecedorSelect, type EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import { CampoDataNotaEntrada } from "@/components/shared/NotaEntrada";
import { FileField } from "@/components/oc-tecido/FileField";
import { OcSecTitle } from "@/components/oc-tecido/OcTecidoForm";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DICA_CAMPO_NOTA_IMPORTADO } from "@/lib/nota-entrada";
import { MOEDAS, fmtMoeda, simboloMoeda } from "@/lib/moeda";
import { novaEtapaImportado, etapaSemCotacao, erroCotacaoEtapas, patchTrocaBase } from "@/lib/importado-etapas";
import { totaisDaOc, totaisDoItem, valorM1DaCompra, type ItemOcImp } from "./itens";
import { fmtDate, somaPercentualPorBase, type CabecalhoImpDraft, type EtapaDraft } from "./shared";

const OUTRA_MOEDA = "__outra__";
const DIRETA = "__direta__";

/** Select de moeda: lista fixa (MOEDAS) + "Adicionar moeda…" (código livre) + opcionalmente
 *  "Direta (sem M2)" para a moeda intermediária — espelha byte-a-byte o `MoedaSelect` de
 *  `ProdutoImportadoCard.tsx` (não exportado de lá; duplicado aqui de propósito, mesmo
 *  precedente de pequenos helpers de UI duplicados entre telas irmãs no código). */
export function MoedaSelect({ value, onChange, permitirDireta, disabled }: { value: string | null; onChange: (v: string | null) => void; permitirDireta?: boolean; disabled?: boolean }) {
  const ehDireta = permitirDireta && value === null;
  const naLista = value != null && value !== "" && MOEDAS.some((m) => m.code === value);
  const ehLivre = value != null && value !== "" && !naLista;
  const [adicionando, setAdicionando] = useState(false);
  const selectValue = adicionando ? OUTRA_MOEDA : ehDireta ? DIRETA : (value ?? "");
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Select
        value={selectValue}
        disabled={disabled}
        onValueChange={(v) => {
          if (v === DIRETA) { setAdicionando(false); onChange(null); }
          else if (v === OUTRA_MOEDA) { setAdicionando(true); onChange(""); }
          else { setAdicionando(false); onChange(v); }
        }}
      >
        {/* min-w-0 + shrink: no mobile (360-390px) o wrapper "flex-1" do card às vezes não tem
            espaço pra w-32 (trigger) + gap-2 + w-24 (input do código livre) = 232px fixos —
            sem min-w-0 o flex item não encolhe e estoura a largura do card (bug medido:
            body.scrollWidth > clientWidth em 360/390px). O trigger cede primeiro; o input do
            código (w-24, shrink-0) mantém tamanho fixo — 6 caracteres não cabem menor. */}
        <SelectTrigger className={adicionando ? "w-32 min-w-0 shrink" : "w-full"}><SelectValue placeholder="Moeda" /></SelectTrigger>
        <SelectContent>
          {permitirDireta && <SelectItem value={DIRETA}>Direta (sem M2)</SelectItem>}
          {MOEDAS.map((m) => <SelectItem key={m.code} value={m.code}>{m.nome} ({m.code})</SelectItem>)}
          {ehLivre && <SelectItem value={value!}>{value} (outra)</SelectItem>}
          <SelectItem value={OUTRA_MOEDA}>Adicionar moeda…</SelectItem>
        </SelectContent>
      </Select>
      {adicionando && (
        <Input
          autoFocus
          className="w-24 shrink-0"
          placeholder="Código"
          maxLength={6}
          value={value ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          onBlur={() => { if (value) setAdicionando(false); }}
          title="Código da moeda (ex.: JPY, MXN) — Enter/sair para confirmar"
        />
      )}
    </div>
  );
}

/**
 * O CABEÇALHO da OC (R13): o que é da OC inteira — fornecedor, datas e a MOEDA/cotações. O produto saiu daqui: cada produto é um item
 * (`OcImpItem`). Seção 1 · Dados do pedido; Seção 2 · Moedas & câmbio. O nº da OC é gerado pelo servidor na criação e NUNCA muda (P-361):
 * só é exibido. A moeda é da OC inteira: todos os produtos dela têm a MESMA moeda (o servidor recusa `moeda_diferente:`).
 */
export function OcImpCabecalho({
  draft, setDraft, empresas, numeroOc, numeroPrevia, isEdit, disabled = false,
}: {
  draft: CabecalhoImpDraft;
  setDraft: Dispatch<SetStateAction<CabecalhoImpDraft>>;
  empresas: EmpresaFornecedor[];
  /** Nº da OC já gerada (OC existente). */
  numeroOc: string | null;
  /** Prévia da sigla ("BELDIV-NNNNN") para a OC nova. */
  numeroPrevia?: string | null;
  isEdit: boolean;
  disabled?: boolean;
}) {
  const moedaExibicaoM2 = draft.moeda_intermediaria ?? draft.moeda_compra;
  return (
    <>
      <section id="ocimp-sec-pedido" className="scroll-mt-2 space-y-4">
        <OcSecTitle n={1}>Dados do pedido</OcSecTitle>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="grid gap-1">
            <Label>Nº do pedido</Label>
            <Input value={numeroOc ?? (numeroPrevia ? `Automático — ${numeroPrevia}` : "Automático")} disabled readOnly />
            <p className="text-xs text-muted-foreground">
              {isEdit ? "O número é gerado ao criar e não muda." : "Gerado automaticamente ao criar a OC."}
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
        </div>
      </section>

      {/* ── 2 · Moedas & câmbio (da OC inteira) ─────────────────────── */}
      <section id="ocimp-sec-cambio" className="scroll-mt-2 space-y-4">
        <OcSecTitle n={2}>Moedas &amp; câmbio</OcSecTitle>
        <p className="text-xs text-muted-foreground">
          A moeda e as cotações valem para a OC inteira — todos os produtos dela são comprados na mesma moeda. O valor, o peso e o transporte
          de cada produto ficam no próprio produto.
        </p>
        <div className="max-w-sm space-y-2 rounded-md border p-3">
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Moeda de compra</Label>
            <div className="min-w-0 flex-1">
              <MoedaSelect value={draft.moeda_compra} disabled={disabled} onChange={(v) => setDraft((d) => ({ ...d, moeda_compra: v ?? "" }))} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Moeda intermediária</Label>
            <div className="min-w-0 flex-1">
              <MoedaSelect value={draft.moeda_intermediaria} disabled={disabled} onChange={(v) => setDraft((d) => ({ ...d, moeda_intermediaria: v }))} permitirDireta />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Cotação de ref.</Label>
            <NumberInput blankZero disabled={disabled} className="flex-1" placeholder="0,00" data-colab-path="cotacao-ref" value={draft.cotacao_ref} onChange={(e) => setDraft((d) => ({ ...d, cotacao_ref: Number(e.target.value) || 0 }))} />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Cotação {simboloMoeda(moedaExibicaoM2)}→R$</Label>
            <NumberInput blankZero disabled={disabled} className="flex-1" placeholder="0,00" data-colab-path="cotacao-final" value={draft.cotacao_final} onChange={(e) => setDraft((d) => ({ ...d, cotacao_final: Number(e.target.value) || 0 }))} />
          </div>
        </div>
      </section>
    </>
  );
}

/**
 * Seção 4 · Etapas de pagamento & valores da OC: o cronograma da OC inteira (as parcelas a pagar saem das ETAPAS, uma por etapa), uma
 * linha por produto com o total em M1 e o custo landed REAL do item (derivado no servidor — SÓ LEITURA), o total da OC e a Data da Nota.
 * O cronograma é estado completo por save (como sempre no importado); a tela NÃO recalcula landed.
 */
export function OcImpTotais({
  draft, setDraft, itens, landedUnitarioOc, disabled = false, aviso,
}: {
  draft: CabecalhoImpDraft;
  setDraft: Dispatch<SetStateAction<CabecalhoImpDraft>>;
  itens: ReadonlyArray<ItemOcImp>;
  /** Custo landed unitário médio da OC (BRL), como o servidor gravou. */
  landedUnitarioOc: number;
  disabled?: boolean;
  /** Aviso acima do conteúdo. */
  aviso?: ReactNode;
}) {
  const t = totaisDaOc(itens);
  const moeda = draft.moeda_compra;
  const valorCompra = valorM1DaCompra(itens);

  const setEtapa = (ordem: number, patch: Partial<EtapaDraft>) =>
    setDraft((d) => ({ ...d, etapas: d.etapas.map((e) => (e.ordem === ordem ? { ...e, ...patch } : e)) }));
  // P-207 A (L8, M1 do review): a etapa nova da OC nasce com a cotação de referência (antes: 0 — a parcela da etapa de
  // mercadoria saía 0 e era pulada em silêncio por `_gerar_parcelas_importado`).
  const addEtapa = () => {
    const nova = novaEtapaImportado(draft.etapas, draft.cotacao_ref);
    if (nova) setDraft((d) => ({ ...d, etapas: [...d.etapas, nova] }));
  };
  const removeEtapa = (ordem: number) => setDraft((d) => ({ ...d, etapas: d.etapas.filter((e) => e.ordem !== ordem) }));
  const somaPercMerc = somaPercentualPorBase(draft.etapas, "mercadoria");
  const somaPercFrete = somaPercentualPorBase(draft.etapas, "frete");
  const erroCot = erroCotacaoEtapas(draft.etapas, valorCompra);

  return (
    <section id="ocimp-sec-valores" className="scroll-mt-2 space-y-4">
      <OcSecTitle
        n={4}
        right={
          <Button type="button" variant="outline" size="sm" disabled={disabled || draft.etapas.length >= 5} onClick={addEtapa}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar etapa
          </Button>
        }
      >
        Etapas de pagamento &amp; valores
      </OcSecTitle>
      {aviso}

      {draft.etapas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma etapa ainda — adicione ao menos uma (mercadoria e/ou frete).</p>
      ) : (
        <div className="space-y-2">
          {draft.etapas.map((e) => (
            <div key={e.ordem} className="flex flex-wrap items-center gap-2 rounded-md border p-2 max-md:flex-col max-md:items-start">
              <Input className="w-32 max-md:w-full" placeholder="Rótulo" disabled={disabled} data-colab-path={`etapa-rotulo:${e.ordem}`} value={e.rotulo} onChange={(ev) => setEtapa(e.ordem, { rotulo: ev.target.value })} />
              <Select value={e.base} onValueChange={(v) => setEtapa(e.ordem, patchTrocaBase(e, v as "mercadoria" | "frete", draft.cotacao_ref))} disabled={disabled}>
                <SelectTrigger className="w-32 max-md:w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mercadoria">Mercadoria</SelectItem>
                  <SelectItem value="frete">Frete</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <NumberInput blankZero placeholder="0" disabled={disabled} className="h-8 w-16 text-center" data-colab-path={`etapa-pct:${e.ordem}`} value={e.percentual} onChange={(ev) => setEtapa(e.ordem, { percentual: Math.max(0, Number(ev.target.value) || 0) })} />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              <DateField className="w-36 max-md:w-full" disabled={disabled} data-colab-path={`etapa-venc:${e.ordem}`} value={e.data_vencimento ?? ""} onChange={(ev) => setEtapa(e.ordem, { data_vencimento: ev.target.value || null })} />
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">cotação</span>
                <NumberInput blankZero placeholder="0,00" disabled={disabled} className={`h-8 w-20 text-center ${etapaSemCotacao(e, valorCompra) ? "border-destructive" : ""}`} data-colab-path={`etapa-cot:${e.ordem}`} value={e.cotacao} onChange={(ev) => setEtapa(e.ordem, { cotacao: Number(ev.target.value) || 0 })} />
              </div>
              {!disabled && (
                <Button type="button" size="iconSm" variant="ghost" aria-label="Remover etapa" className="ml-auto text-muted-foreground hover:text-destructive max-md:ml-0" onClick={() => removeEtapa(e.ordem)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {somaPercMerc !== 100 && draft.etapas.some((e) => e.base === "mercadoria") && (
        <p className="text-xs text-[var(--tone-warning-fg)]">Σ% mercadoria = {somaPercMerc}% — precisa fechar 100%.</p>
      )}
      {somaPercFrete !== 100 && draft.etapas.some((e) => e.base === "frete") && (
        <p className="text-xs text-[var(--tone-warning-fg)]">Σ% frete = {somaPercFrete}% — precisa fechar 100%.</p>
      )}
      {erroCot && <p className="text-xs text-destructive">{erroCot}</p>}
      <p className="text-xs text-muted-foreground">
        As parcelas a pagar são geradas automaticamente a partir destas etapas ao salvar (uma por etapa) e saem do total da OC inteira — o
        ajuste de vencimento e o pagamento são no Financeiro.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Produto</TableHead>
            <TableHead className="text-right">Peças</TableHead>
            <TableHead className="text-right">Total c/ desc. ({simboloMoeda(moeda)})</TableHead>
            <TableHead className="text-right">Landed unit. (R$)</TableHead>
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
                <TableCell className="text-right tabular-nums">{fmtMoeda(x.total, moeda)}</TableCell>
                <TableCell className="text-right tabular-nums">{it.id && it.custo_unitario_landed_real > 0 ? fmtMoeda(it.custo_unitario_landed_real, "BRL") : "—"}</TableCell>
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
            <TableCell className="text-right tabular-nums">{fmtMoeda(t.total, moeda)}</TableCell>
            <TableCell className="text-right tabular-nums">{landedUnitarioOc > 0 ? fmtMoeda(landedUnitarioOc, "BRL") : "—"}</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
      <InfoStrip
        itens={[
          { label: "Etapas", valor: draft.etapas.length },
          { label: "Produtos", valor: itens.length },
          { label: "Total da OC", valor: fmtMoeda(t.total, moeda), hi: true },
          { label: "Landed médio (R$/pç)", hint: "(calculado pelo servidor ao salvar)", valor: landedUnitarioOc > 0 ? fmtMoeda(landedUnitarioOc, "BRL") : "—" },
        ]}
      />
      {/* Data da Nota de Entrada (ajuste do dono 25/set): editável MESMO com a OC recebida. No Importado é SÓ registro — os vencimentos
          seguem as etapas de câmbio (dica própria). */}
      <CampoDataNotaEntrada
        value={draft.data_nota_entrada}
        dica={DICA_CAMPO_NOTA_IMPORTADO}
        onChange={(v) => setDraft((d) => ({ ...d, data_nota_entrada: v }))}
        disabled={disabled}
      />
    </section>
  );
}

/** Seção 5 · Anexos: o PDF/imagem do pedido (a NF é por produto, no recebimento). */
export function OcImpAnexos({
  draft, setDraft, onUpload, disabled = false,
}: {
  draft: CabecalhoImpDraft;
  setDraft: Dispatch<SetStateAction<CabecalhoImpDraft>>;
  onUpload: (file: File) => void;
  disabled?: boolean;
}) {
  return (
    <section id="ocimp-sec-anexos" className="scroll-mt-2 space-y-4">
      <OcSecTitle n={5}>Anexos</OcSecTitle>
      <div className="grid sm:grid-cols-2 gap-4">
        <FileField
          label="Pedido (PDF ou imagem)"
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
