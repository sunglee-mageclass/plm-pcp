import { useMemo, useState } from "react";
import { ChevronRight, ImagePlus, MoreHorizontal, Paperclip, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { InfoStrip } from "@/components/shared/InfoStrip";
import { DateField } from "@/components/shared/DateField";
import { FornecedorSelect, type EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { varianteLabel } from "@/lib/variante";
import { VarianteSwatch } from "@/components/shared/VarianteSwatch";
import { MOEDAS, fmtMoeda, m1ParaM2, simboloMoeda } from "@/lib/moeda";
import type { Opt, CatOpt, SubOpt, CorApelidoOpt } from "@/components/produto-acabado/shared";
import {
  custoDoDraft, precosDoDraft, qtdTotalDeVariantes, recalcVariantesPorPeso, somaPercentualPorBase,
  type ProdutoImportadoDraft, type VarianteImportadoDraft, type EtapaImportadoDraft,
} from "./shared";

// label exibido de um tamanho cadastrado ("34|PPP" → "PPP") — mesmo helper usado em
// GradeSection.tsx (Plan. Tecido) / ProdutoCard.tsx (Produto Acabado).
const labelTamanho = (t: string) => (t.includes("|") ? t.split("|")[1] || t : t);

const OUTRA_MOEDA = "__outra__";
const DIRETA = "__direta__";

/** Select de moeda: lista fixa (MOEDAS) + "Adicionar moeda…" (código livre) — e, opcionalmente,
 *  a opção "Direta (sem M2)" para a moeda intermediária. Uma moeda livre já escolhida entra como
 *  opção própria no dropdown (o Select consegue exibi-la); "Adicionar moeda…" abre um input de
 *  código ao lado para digitar/trocar. */
function MoedaSelect({ value, onChange, permitirDireta }: { value: string | null; onChange: (v: string | null) => void; permitirDireta?: boolean }) {
  const ehDireta = permitirDireta && value === null;
  const naLista = value != null && value !== "" && MOEDAS.some((m) => m.code === value);
  const ehLivre = value != null && value !== "" && !naLista; // moeda livre já com código
  const [adicionando, setAdicionando] = useState(false);
  // O valor selecionado no Select: direta / código livre existente / código fixo / (adicionando).
  const selectValue = adicionando ? OUTRA_MOEDA : ehDireta ? DIRETA : (value ?? "");
  return (
    <div className="flex items-center gap-2">
      <Select
        value={selectValue}
        onValueChange={(v) => {
          if (v === DIRETA) { setAdicionando(false); onChange(null); }
          else if (v === OUTRA_MOEDA) { setAdicionando(true); onChange(""); }
          else { setAdicionando(false); onChange(v); }
        }}
      >
        <SelectTrigger className={adicionando ? "w-32" : "w-full"}><SelectValue placeholder="Moeda" /></SelectTrigger>
        <SelectContent>
          {permitirDireta && <SelectItem value={DIRETA}>Direta (sem M2)</SelectItem>}
          {MOEDAS.map((m) => <SelectItem key={m.code} value={m.code}>{m.nome} ({m.code})</SelectItem>)}
          {/* moeda livre já escolhida aparece como opção selecionável (senão o Select fica em branco) */}
          {ehLivre && <SelectItem value={value!}>{value} (outra)</SelectItem>}
          <SelectItem value={OUTRA_MOEDA}>Adicionar moeda…</SelectItem>
        </SelectContent>
      </Select>
      {adicionando && (
        <Input
          autoFocus
          className="w-24"
          placeholder="Código"
          maxLength={6}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          onBlur={() => { if (value) setAdicionando(false); }}
          title="Código da moeda (ex.: JPY, MXN) — Enter/sair para confirmar"
        />
      )}
    </div>
  );
}

export function ProdutoImportadoCard({
  draft,
  onChange,
  open,
  onToggleOpen,
  grupos,
  categorias,
  subcats1,
  subcats2,
  cores,
  coresApelido,
  empresas,
  tamanhos,
  onExcluir,
}: {
  draft: ProdutoImportadoDraft;
  onChange: (patch: Partial<ProdutoImportadoDraft>) => void;
  open: boolean;
  onToggleOpen: () => void;
  grupos: Opt[];
  categorias: CatOpt[];
  subcats1: SubOpt[];
  subcats2: SubOpt[];
  cores: Opt[];
  coresApelido: CorApelidoOpt[];
  empresas: EmpresaFornecedor[];
  tamanhos: string[];
  onExcluir: () => void;
}) {
  const [confirmExcluir, setConfirmExcluir] = useState(false);
  // Accordion CONTROLADO (state próprio) — com `defaultValue` (uncontrolled) a seção fechava
  // ao editar um campo (re-render do card resetava o estado interno do Radix). Controlar aqui
  // fixa quais seções estão abertas independentemente de re-renders do draft.
  // Começa com TODAS fechadas: o card aberto mostra só os 7 títulos (compacto, tamanho de bloco),
  // e o usuário abre a seção que quer — senão o card fica gigante com as 7 seções empilhadas.
  const [secoesAbertas, setSecoesAbertas] = useState<string[]>([]);

  const grupoNome = grupos.find((g) => g.id === draft.grupo_id)?.nome ?? "";
  const categoriaNome = categorias.find((c) => c.id === draft.categoria_id)?.nome ?? "";
  const empresaNome = empresas.find((e) => e.id === draft.empresa_id)?.nome_fantasia ?? "";
  const corNome = (id: string | null) => cores.find((c) => c.id === id)?.nome ?? null;
  const apelidoNome = (id: string | null) => coresApelido.find((c) => c.id === id)?.nome ?? null;
  const taxonomia = [grupoNome, categoriaNome].filter(Boolean).join(" › ");

  // ── Cálculos AO VIVO — só chamam moeda.ts/shared.ts, nunca reimplementam aritmética aqui. ──
  const resultado = useMemo(() => custoDoDraft(draft), [draft]);
  const precos = useMemo(() => precosDoDraft(draft, resultado), [draft, resultado]);
  const valorProdutoM2 = useMemo(() => m1ParaM2(draft.valor_unitario_m1, draft.cotacao_ref), [draft.valor_unitario_m1, draft.cotacao_ref]);
  const valorTranspM2 = (Number(draft.peso_kg) || 0) * (Number(draft.transporte_m2) || 0);
  const moedaM2 = draft.moeda_intermediaria; // null = cadeia direta (mostra na moeda de compra)
  const moedaExibicaoM2 = moedaM2 ?? draft.moeda_compra;
  const somaPercMerc = somaPercentualPorBase(draft.etapas, "mercadoria");
  const somaPercFrete = somaPercentualPorBase(draft.etapas, "frete");

  // ── Pills de resumo (seção FECHADA) — mesmo padrão do Produto Acabado ("2 · Preço"): um
  //    resumo de 1 linha à direita do título quando a seção não está expandida. Sempre
  //    calculados via os helpers já existentes (shared.ts/moeda.ts) — nunca aritmética nova.
  const pillVariantes = draft.variantes.length > 0 ? `${draft.variantes.length} cores · ${draft.qtd_total} pç` : null;
  const pillQuantidade = draft.valor_unitario_m1 > 0 && draft.cotacao_ref > 0 ? `${simboloMoeda(draft.moeda_compra)} ${draft.valor_unitario_m1} ÷ ${draft.cotacao_ref} = ${fmtMoeda(valorProdutoM2, moedaExibicaoM2)}` : null;
  const pillFrete = valorTranspM2 > 0 ? `${fmtMoeda(valorTranspM2, moedaExibicaoM2)}/pç` : null;
  const pillPagamentos = draft.etapas.length > 0 ? draft.etapas.map((e) => `${e.percentual}%`).join(" · ") : null;
  const pillValores = precos.varejo > 0 ? `varejo ${fmtMoeda(precos.varejo, "BRL")}` : null;

  // ── 2 · Grade & proporção ──
  const setPeso = (tam: string, peso: number) => {
    const grade_proporcao = { ...draft.grade_proporcao, [tam]: peso };
    onChange({ grade_proporcao, variantes: recalcVariantesPorPeso({ variantes: draft.variantes, qtd_total: draft.qtd_total }) });
  };

  // ── 3 · Variantes — BIDIRECIONAL (qtd_total ↔ Σ variantes; peso → rateio automático nas
  //     não-touched; editar a qtd de 1 variante marca _touched e recalcula qtd_total). ──
  const setVariante = (ordem: number, patch: Partial<VarianteImportadoDraft>) => {
    const variantes = draft.variantes.map((v) => (v.ordem === ordem ? { ...v, ...patch } : v));
    if ("qtd" in patch) {
      // Edição manual de qtd: trava esta variante e reajusta o total = Σ variantes.
      onChange({ variantes, qtd_total: qtdTotalDeVariantes(variantes) });
    } else if ("peso" in patch) {
      // Peso mudou: reaplica o rateio nas não-touched, mantendo o total atual.
      onChange({ variantes: recalcVariantesPorPeso({ variantes, qtd_total: draft.qtd_total }) });
    } else {
      onChange({ variantes });
    }
  };
  const addVariante = () => {
    const proximaOrdem = draft.variantes.length ? Math.max(...draft.variantes.map((v) => v.ordem)) + 1 : 1;
    const variantes = [...draft.variantes, { ordem: proximaOrdem, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 0, _touched: false }];
    onChange({ variantes: recalcVariantesPorPeso({ variantes, qtd_total: draft.qtd_total }) });
  };
  const removeVariante = (ordem: number) => {
    const variantes = draft.variantes.filter((v) => v.ordem !== ordem);
    onChange({ variantes: recalcVariantesPorPeso({ variantes, qtd_total: draft.qtd_total }) });
  };
  const setQtdTotal = (novoTotal: number) => {
    // Muda o total → reaplica o rateio nas não-touched (mesma ideia do Produto Acabado: só
    // redistribui o que ainda não foi editado manualmente).
    onChange({ qtd_total: novoTotal, variantes: recalcVariantesPorPeso({ variantes: draft.variantes, qtd_total: novoTotal }) });
  };

  // ── 6 · Pagamentos — etapas (até 5) ──
  const setEtapa = (ordem: number, patch: Partial<EtapaImportadoDraft>) =>
    onChange({ etapas: draft.etapas.map((e) => (e.ordem === ordem ? { ...e, ...patch } : e)) });
  const addEtapa = () => {
    if (draft.etapas.length >= 5) return;
    const proximaOrdem = draft.etapas.length ? Math.max(...draft.etapas.map((e) => e.ordem)) + 1 : 1;
    onChange({ etapas: [...draft.etapas, { ordem: proximaOrdem, rotulo: "", base: "mercadoria", percentual: 0, data_vencimento: null, cotacao: 0 }] });
  };
  const removeEtapa = (ordem: number) => onChange({ etapas: draft.etapas.filter((e) => e.ordem !== ordem) });

  return (
    <div className="rounded-lg border bg-card">
      <button type="button" onClick={onToggleOpen} className="flex w-full items-start gap-2 p-3 text-left">
        <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
          <ImagePlus className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight">{draft.nome || "Sem nome"}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{draft.ref ?? "REF —"}</span>
            <span>{empresaNome || "sem fornecedor"}</span>
            <span className="tabular-nums">{draft.qtd_total} pç</span>
          </div>
          {open && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{taxonomia || "sem taxonomia"}</div>}
        </div>
        <Popover>
          <PopoverTrigger asChild>
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Mais ações"
            >
              <MoreHorizontal className="h-4 w-4" />
            </span>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-1" onClick={(e) => e.stopPropagation()}>
            <PopoverClose asChild>
              <button
                type="button"
                onClick={() => setConfirmExcluir(true)}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4 shrink-0" /> Excluir produto
              </button>
            </PopoverClose>
          </PopoverContent>
        </Popover>
      </button>

      {open && (
        <div className="border-t px-3 pb-3">
          <Accordion type="multiple" value={secoesAbertas} onValueChange={setSecoesAbertas} className="[&>div]:border-b-0">
            {/* ── 1 · Identificação ────────────────────────────── */}
            {/* Trigger igual às outras 6 seções: linha INTEIRA clicável (não envolver num flex com
                outro elemento, senão o trigger encolhe pro tamanho do texto). A foto (clipe) vai
                POR DENTRO do conteúdo, como um campo normal. */}
            <AccordionItem value="identificacao">
              <AccordionTrigger className="text-xs font-semibold">1 · Identificação</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  <div className="max-w-sm space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-3">
                      <Label className="w-[130px] shrink-0 text-sm">Foto</Label>
                      {/* Clipe de anexo (por dentro da seção 1, feedback do dono). Upload real chega
                          com a persistência de imagem — por ora só o affordance. */}
                      <Button
                        type="button" variant="outline" size="sm" disabled
                        className="gap-1 text-muted-foreground"
                        title="Anexar foto (chega com a persistência de imagem)."
                      >
                        <Paperclip className="h-3.5 w-3.5" /> Anexar
                      </Button>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[130px] shrink-0 text-sm">REF</Label>
                      <Input
                        className="flex-1"
                        value={draft.ref ?? ""}
                        placeholder="Gerada ao salvar (ou digite manual)"
                        title="Deixe em branco para a REF automática ao salvar, ou digite uma REF manual."
                        onChange={(e) => onChange({ ref: e.target.value || null })}
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[130px] shrink-0 text-sm">Nome</Label>
                      <Input className="flex-1" value={draft.nome} onChange={(e) => onChange({ nome: e.target.value })} />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[130px] shrink-0 text-sm">Fornecedor</Label>
                      <div className="flex-1">
                        <FornecedorSelect empresas={empresas} empresaId={draft.empresa_id} representanteId={draft.representante_id}
                          onChange={(empresa_id, representante_id) => onChange({ empresa_id, representante_id })} />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[130px] shrink-0 text-sm">REF Fornecedor</Label>
                      <Input className="flex-1" value={draft.ref_fornecedor} onChange={(e) => onChange({ ref_fornecedor: e.target.value })} />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[130px] shrink-0 text-sm">Composição</Label>
                      <Input className="flex-1" value={draft.composicao} onChange={(e) => onChange({ composicao: e.target.value })} />
                    </div>
                  </div>
                  <div className="max-w-sm space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-3">
                      <Label className="w-[130px] shrink-0 text-sm">Data do pedido</Label>
                      <DateField className="flex-1" value={draft.data_pedido ?? ""} onChange={(e) => onChange({ data_pedido: e.target.value || null })} />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[130px] shrink-0 text-sm">Previsão</Label>
                      <DateField className="flex-1" value={draft.data_prevista ?? ""} onChange={(e) => onChange({ data_prevista: e.target.value || null })} />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[130px] shrink-0 text-sm">Entrega</Label>
                      <DateField className="flex-1" value={draft.data_entrega ?? ""} onChange={(e) => onChange({ data_entrega: e.target.value || null })} />
                    </div>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* ── 2 · Grade & proporção ────────────────────────── */}
            <AccordionItem value="grade">
              <AccordionTrigger className="text-xs font-semibold">2 · Grade &amp; proporção</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-1.5">
                  <Label className="text-sm">Proporção de grade</Label>
                  <div className="flex flex-wrap gap-1">
                    {tamanhos.map((t) => {
                      const peso = draft.grade_proporcao[t] ?? 0;
                      return (
                        <div key={t} className={`flex w-[30px] max-md:w-11 flex-col items-center overflow-hidden rounded border bg-background ${peso > 0 ? "border-amber-300 dark:border-amber-500/40" : ""}`}>
                          <NumberInput
                            integer
                            blankZero
                            placeholder="0"
                            className="h-6 w-full rounded-none border-0 bg-transparent px-0 text-center text-xs shadow-none focus-visible:ring-0 max-md:h-9 max-md:text-base"
                            value={peso}
                            onChange={(e) => setPeso(t, Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
                          />
                          <span className="pb-0.5 text-[8px] uppercase tracking-tight text-muted-foreground">{labelTamanho(t)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* ── 3 · Variantes ─────────────────────────────────── */}
            <AccordionItem value="variantes">
              <AccordionTrigger className="text-xs font-semibold">
                <span className="flex flex-1 items-center justify-between pr-2">
                  <span>3 · Variantes</span>
                  {pillVariantes && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium normal-case text-muted-foreground">{pillVariantes}</span>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {/* Qtd total ANTES das variantes (feedback do dono): o usuário digita a total
                      primeiro; o rateio por peso distribui automaticamente ao adicionar variantes.
                      Bidirecional: editar a qtd de uma variante recalcula a total = Σ variantes. */}
                  <div className="flex items-center gap-3 rounded-md border bg-muted/30 p-2">
                    <Label className="shrink-0 text-sm font-medium">Quantidade total</Label>
                    <NumberInput
                      integer
                      blankZero
                      placeholder="0"
                      className="h-8 w-28"
                      value={draft.qtd_total}
                      onChange={(e) => setQtdTotal(Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
                    />
                    <span className="text-xs text-muted-foreground">distribuída por peso nas variantes abaixo</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Cor, peso e quantidade</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addVariante}><Plus className="mr-1 h-3.5 w-3.5" /> Adicionar variante</Button>
                  </div>
                  {draft.variantes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nenhuma variante ainda.</p>
                  ) : (
                    <div className="space-y-2">
                      {draft.variantes.map((v) => {
                        const consumo = draft.valor_unitario_m1;
                        const total = (Number(v.qtd) || 0) * consumo;
                        return (
                          <div key={v.ordem} className="flex flex-wrap items-center gap-2 rounded-md border p-2 max-md:flex-col max-md:items-start">
                            <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted-foreground max-md:hidden">{v.ordem}</span>
                            <Select value={v.cor_id ?? ""} onValueChange={(cid) => setVariante(v.ordem, { cor_id: cid || null, cor_apelido_id: null })}>
                              <SelectTrigger className="w-36 max-md:w-full"><SelectValue placeholder="Cor base" /></SelectTrigger>
                              <SelectContent>{cores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
                            </Select>
                            <Select value={v.cor_apelido_id ?? ""} onValueChange={(aid) => setVariante(v.ordem, { cor_apelido_id: aid || null })}>
                              <SelectTrigger className="w-36 max-md:w-full"><SelectValue placeholder="Cor apelido" /></SelectTrigger>
                              <SelectContent>{coresApelido.filter((a) => !v.cor_id || a.cor_base_id === v.cor_id).map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}</SelectContent>
                            </Select>
                            <VarianteSwatch nome={corNome(v.cor_id) ?? undefined} label={varianteLabel({ cor: corNome(v.cor_id), apelido: apelidoNome(v.cor_apelido_id) })} className="max-md:w-full" />
                            <div className="ml-auto flex flex-wrap items-center gap-2 max-md:ml-0 max-md:w-full">
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">peso</span>
                                <NumberInput integer className="h-8 w-14 text-center" value={v.peso} onChange={(e) => setVariante(v.ordem, { peso: Math.max(0, Number(e.target.value) || 0) })} />
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-muted-foreground">qtd</span>
                                <NumberInput
                                  integer
                                  className="h-8 w-16 text-center"
                                  value={v.qtd}
                                  onChange={(e) => setVariante(v.ordem, { qtd: Math.max(0, Math.trunc(Number(e.target.value)) || 0), _touched: true })}
                                />
                              </div>
                              <div className="text-[11px] tabular-nums text-muted-foreground">
                                {fmtMoeda(consumo, draft.moeda_compra)} · <b className="text-foreground">{fmtMoeda(total, draft.moeda_compra)}</b>
                              </div>
                              <Button type="button" size="iconSm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => removeVariante(v.ordem)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* ── 4 · Quantidade & previsão ─────────────────────── */}
            <AccordionItem value="quantidade">
              <AccordionTrigger className="text-xs font-semibold">
                <span className="flex flex-1 items-center justify-between pr-2">
                  <span>4 · Quantidade &amp; previsão</span>
                  {pillQuantidade && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium normal-case text-muted-foreground">{pillQuantidade}</span>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="max-w-sm space-y-2 rounded-md border p-3">
                  {/* Qtd total mora na seção Variantes (o usuário a digita antes das cores). Aqui
                      só a previsão de valor/moeda/cotação. */}
                  <div className="flex items-center gap-3">
                    <Label className="w-[150px] shrink-0 text-sm">Valor unit. ({simboloMoeda(draft.moeda_compra)})</Label>
                    <NumberInput blankZero className="flex-1" placeholder="0,00" value={draft.valor_unitario_m1} onChange={(e) => onChange({ valor_unitario_m1: Number(e.target.value) || 0 })} />
                  </div>
                  <div className="flex items-center gap-3">
                    <Label className="w-[150px] shrink-0 text-sm">Moeda de compra</Label>
                    <div className="flex-1">
                      <MoedaSelect value={draft.moeda_compra} onChange={(v) => onChange({ moeda_compra: v ?? "" })} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Label className="w-[150px] shrink-0 text-sm">Moeda intermediária</Label>
                    <div className="flex-1">
                      <MoedaSelect value={draft.moeda_intermediaria} onChange={(v) => onChange({ moeda_intermediaria: v })} permitirDireta />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Label className="w-[150px] shrink-0 text-sm">Cotação de ref.</Label>
                    <NumberInput blankZero className="flex-1" placeholder="0,00" value={draft.cotacao_ref} onChange={(e) => onChange({ cotacao_ref: Number(e.target.value) || 0 })} />
                  </div>
                </div>
                <InfoStrip className="mt-3" itens={[
                  { label: "Valor produto", hint: `(unit. ÷ cotação de ref.)`, valor: fmtMoeda(valorProdutoM2, moedaExibicaoM2), hi: true },
                ]} />
              </AccordionContent>
            </AccordionItem>

            {/* ── 5 · Frete ──────────────────────────────────────── */}
            <AccordionItem value="frete">
              <AccordionTrigger className="text-xs font-semibold">
                <span className="flex flex-1 items-center justify-between pr-2">
                  <span>5 · Frete</span>
                  {pillFrete && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium normal-case text-muted-foreground">{pillFrete}</span>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="max-w-sm space-y-2 rounded-md border p-3">
                  <div className="flex items-center gap-3">
                    <Label className="w-[150px] shrink-0 text-sm">Peso (kg)</Label>
                    <NumberInput blankZero className="flex-1" placeholder="0,00" value={draft.peso_kg} onChange={(e) => onChange({ peso_kg: Number(e.target.value) || 0 })} />
                  </div>
                  <div className="flex items-center gap-3">
                    <Label className="w-[150px] shrink-0 text-sm">Transporte ({simboloMoeda(moedaExibicaoM2)}/kg)</Label>
                    <NumberInput blankZero className="flex-1" placeholder="0,00" value={draft.transporte_m2} onChange={(e) => onChange({ transporte_m2: Number(e.target.value) || 0 })} />
                  </div>
                </div>
                <InfoStrip className="mt-3" itens={[
                  { label: "Valor transp.", hint: "(peso × transporte)", valor: fmtMoeda(valorTranspM2, moedaExibicaoM2), hi: true },
                ]} />
              </AccordionContent>
            </AccordionItem>

            {/* ── 6 · Pagamentos ─────────────────────────────────── */}
            <AccordionItem value="pagamentos">
              <AccordionTrigger className="text-xs font-semibold">
                <span className="flex flex-1 items-center justify-between pr-2">
                  <span>6 · Pagamentos</span>
                  {pillPagamentos && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium normal-case text-muted-foreground">{pillPagamentos}</span>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  <div className="flex max-w-sm items-center gap-3 rounded-md border p-3">
                    <Label className="w-[150px] shrink-0 text-sm">Desconto (%)</Label>
                    <NumberInput blankZero placeholder="0" className="flex-1" value={draft.desconto_pct} onChange={(e) => onChange({ desconto_pct: Math.max(0, Number(e.target.value) || 0) })} />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Etapas de pagamento</Label>
                    <Button type="button" variant="outline" size="sm" disabled={draft.etapas.length >= 5} onClick={addEtapa}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar etapa
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {draft.etapas.map((e) => (
                      <div key={e.ordem} className="flex flex-wrap items-center gap-2 rounded-md border p-2 max-md:flex-col max-md:items-start">
                        <Input className="w-32 max-md:w-full" placeholder="Rótulo" value={e.rotulo} onChange={(ev) => setEtapa(e.ordem, { rotulo: ev.target.value })} />
                        <Select value={e.base} onValueChange={(v) => setEtapa(e.ordem, { base: v as "mercadoria" | "frete" })}>
                          <SelectTrigger className="w-32 max-md:w-full"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="mercadoria">Mercadoria</SelectItem>
                            <SelectItem value="frete">Frete</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1">
                          <NumberInput blankZero placeholder="0" className="h-8 w-16 text-center" value={e.percentual} onChange={(ev) => setEtapa(e.ordem, { percentual: Math.max(0, Number(ev.target.value) || 0) })} />
                          <span className="text-xs text-muted-foreground">%</span>
                        </div>
                        <DateField className="w-36 max-md:w-full" value={e.data_vencimento ?? ""} onChange={(ev) => setEtapa(e.ordem, { data_vencimento: ev.target.value || null })} />
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">cotação</span>
                          <NumberInput className="h-8 w-20 text-center" value={e.cotacao} onChange={(ev) => setEtapa(e.ordem, { cotacao: Number(ev.target.value) || 0 })} />
                        </div>
                        <Button type="button" size="iconSm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive max-md:ml-0" onClick={() => removeEtapa(e.ordem)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  {somaPercMerc !== 100 && draft.etapas.some((e) => e.base === "mercadoria") && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">Σ% mercadoria = {somaPercMerc}% — precisa fechar 100%.</p>
                  )}
                  {somaPercFrete !== 100 && draft.etapas.some((e) => e.base === "frete") && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">Σ% frete = {somaPercFrete}% — precisa fechar 100%.</p>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* ── 7 · Valores ────────────────────────────────────── */}
            <AccordionItem value="valores">
              <AccordionTrigger className="text-xs font-semibold">
                <span className="flex flex-1 items-center justify-between pr-2">
                  <span>7 · Valores</span>
                  {pillValores && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium normal-case text-muted-foreground">{pillValores}</span>
                  )}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3">
                  <div className="max-w-sm space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-3">
                      <Label className="w-[150px] shrink-0 text-sm">Moeda da cotação</Label>
                      <div className="flex-1">
                        {/* Moeda de ORIGEM da cotação final (converte → BRL). É a intermediária (M2);
                            editável aqui também para o dono não precisar voltar à seção 4. */}
                        <MoedaSelect value={draft.moeda_intermediaria} onChange={(v) => onChange({ moeda_intermediaria: v })} permitirDireta />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[150px] shrink-0 text-sm">Cotação {simboloMoeda(moedaExibicaoM2)}→R$</Label>
                      <NumberInput blankZero className="flex-1" placeholder="0,00" value={draft.cotacao_final} onChange={(e) => onChange({ cotacao_final: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[150px] shrink-0 text-sm">Markup atacado</Label>
                      <div className="relative flex-1">
                        <NumberInput
                          blankZero
                          placeholder="2,50"
                          className="pr-6"
                          value={draft.markup_atacado ?? 0}
                          onChange={(e) => onChange({ markup_atacado: Number(e.target.value) > 0 ? Number(e.target.value) : null })}
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">×</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[150px] shrink-0 text-sm">Markup varejo</Label>
                      <div className="relative flex-1">
                        <NumberInput
                          blankZero
                          placeholder="2,50"
                          className="pr-6"
                          value={draft.markup_varejo ?? 0}
                          onChange={(e) => onChange({ markup_varejo: Number(e.target.value) > 0 ? Number(e.target.value) : null })}
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">×</span>
                      </div>
                    </div>
                  </div>
                  <InfoStrip itens={[
                    { label: "Valor final (BRL)", valor: fmtMoeda(resultado.unitarioBrl, "BRL"), hi: true },
                    { label: "Valor atacado", valor: fmtMoeda(precos.atacado, "BRL") },
                    { label: "Valor varejo", valor: fmtMoeda(precos.varejo, "BRL") },
                  ]} />
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}

      <AlertDialog open={confirmExcluir} onOpenChange={setConfirmExcluir}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação remove o rascunho local — nada foi persistido no banco ainda (Fase 1).</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => { setConfirmExcluir(false); onExcluir(); }}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
