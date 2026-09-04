import { useState } from "react";
import { Plus, Trash2, RefreshCw, Search, X, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { InfoStrip } from "@/components/shared/InfoStrip";
import { FornecedorSelect, type EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import { FileField } from "@/components/oc-tecido/FileField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OcSecTitle } from "@/components/oc-tecido/OcTecidoForm";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { ehGrupoAcessorio, previewNumeroOc } from "@/lib/produto-acabado";
import { varianteLabel } from "@/lib/variante";
import { MOEDAS, fmtMoeda, m1ParaM2, simboloMoeda, custoLanded, type EntradaLanded, type EtapaPagamento } from "@/lib/moeda";
import { GradeDestrinchada } from "./GradeDestrinchada";
import { ProdutoImportadoPicker, type ProdutoImportadoSelecionado } from "./ProdutoImportadoPicker";
import {
  redistribuirPedida, redistribuirVariantesPorPeso, somaPercentualPorBase, TAM_ACESSORIO,
  type Draft, type EtapaDraft, type GradeDetalhe, type VarianteDraft,
} from "./shared";

export type Opt = { id: string; nome: string };
export type CatOpt = Opt & { grupo_id: string | null };
export type SubOpt = Opt & { categoria_id: string | null };
export type CorApelidoOpt = Opt & { cor_base_id: string | null };

const OUTRA_MOEDA = "__outra__";
const DIRETA = "__direta__";

/** Select de moeda: lista fixa (MOEDAS) + "Adicionar moeda…" (código livre) + opcionalmente
 *  "Direta (sem M2)" para a moeda intermediária — espelha byte-a-byte o `MoedaSelect` de
 *  `ProdutoImportadoCard.tsx` (não exportado de lá; duplicado aqui de propósito, mesmo
 *  precedente de pequenos helpers de UI duplicados entre telas irmãs no código). */
function MoedaSelect({ value, onChange, permitirDireta }: { value: string | null; onChange: (v: string | null) => void; permitirDireta?: boolean }) {
  const ehDireta = permitirDireta && value === null;
  const naLista = value != null && value !== "" && MOEDAS.some((m) => m.code === value);
  const ehLivre = value != null && value !== "" && !naLista;
  const [adicionando, setAdicionando] = useState(false);
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

/** Select simples id→nome (sem cascata) — usado nos 4 níveis de taxonomia da OC. */
function CatSelect({
  label, value, onChange, options, placeholder = "Selecione…", disabled,
}: {
  label: string; value: string | null; onChange: (v: string | null) => void; options: Opt[]; placeholder?: string; disabled?: boolean;
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      <Select value={value ?? ""} onValueChange={(v) => onChange(v || null)} disabled={disabled}>
        <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.nome}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export type ProdutoVinculadoInfo = { nome: string; ref: string | null; fornecedor: string | null } | null;

export function OcImpForm({
  draft, setDraft,
  grade, setGrade,
  empresas,
  grupos, categorias, subcats1, subcats2,
  cores, coresApelido,
  tamanhos,
  produtoVinculado,
  handleUpload,
  disabled = false,
  isEdit = false,
  valoresTravados = false,
}: {
  draft: Draft;
  setDraft: React.Dispatch<React.SetStateAction<Draft>>;
  grade: GradeDetalhe;
  setGrade: React.Dispatch<React.SetStateAction<GradeDetalhe>>;
  empresas: EmpresaFornecedor[];
  grupos: Opt[];
  categorias: CatOpt[];
  subcats1: SubOpt[];
  subcats2: SubOpt[];
  cores: Opt[];
  coresApelido: CorApelidoOpt[];
  tamanhos: string[];
  produtoVinculado: ProdutoVinculadoInfo;
  handleUpload: (file: File, key: "anexo_pedido_url" | "anexo_nf_url") => void;
  disabled?: boolean;
  // Espelha o item 3 da OC P. Acabado: picker só faz sentido pra OC NOVA — produto_importado_id
  // só é aplicado no INSERT pela RPC (update não toca).
  isEdit?: boolean;
  // OC 'recebido' — valor/qtd pedida (+ grade "pedida") ficam read-only, espelhando a guarda
  // do servidor (`_salvar_oc_importado_core`, congela ao receber).
  valoresTravados?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fotoProdutoSelecionado, setFotoProdutoSelecionado] = useState<string | null>(null);
  const fotoProdutoUrl = useSignedUrl(fotoProdutoSelecionado, "oc-tecido");

  const selecionarProduto = (p: ProdutoImportadoSelecionado) => {
    setDraft((d) => ({
      ...d,
      produto_importado_id: p.id,
      nome_produto: p.nome,
      grupo_id: p.grupo_id,
      categoria_id: p.categoria_id,
      subcategoria1_id: p.subcategoria1_id,
      subcategoria2_id: p.subcategoria2_id,
      empresa_id: p.empresa_id,
      representante_id: p.representante_id,
      ref_fornecedor: p.ref_fornecedor ?? "",
      composicao: p.composicao ?? "",
      grade_proporcao: p.grade_proporcao,
      variantes: p.variantes,
      qtd_total: p.qtd_total,
      moeda_compra: p.moeda_compra,
      moeda_intermediaria: p.moeda_intermediaria,
      valor_unitario_m1: p.valor_unitario_m1,
      cotacao_ref: p.cotacao_ref,
      peso_kg: p.peso_kg,
      transporte_m2: p.transporte_m2,
      desconto_pct: p.desconto_pct,
      cotacao_final: p.cotacao_final,
      // Copia as etapas do card (senão o preview de custo landed fica errado — usaria só o
      // fallback de frete). Se o card não tiver etapas, mantém as default do draft.
      etapas: p.etapas.length > 0 ? p.etapas : d.etapas,
    }));
    // Grade "pedida" anterior referenciava outras variantes/ordens — reinicia limpa.
    setGrade({});
    setFotoProdutoSelecionado(p.fotoPath);
    setPickerOpen(false);
  };
  const desvincularProduto = () => {
    setDraft((d) => ({ ...d, produto_importado_id: null }));
    setFotoProdutoSelecionado(null);
  };
  const grupoNome = grupos.find((g) => g.id === draft.grupo_id)?.nome ?? "";
  const categoriaNome = categorias.find((c) => c.id === draft.categoria_id)?.nome ?? "";
  const acessorio = ehGrupoAcessorio(grupoNome);
  const empresaNome = empresas.find((e) => e.id === draft.empresa_id)?.nome_fantasia ?? "";
  const numeroPreview = previewNumeroOc(empresaNome, grupoNome, categoriaNome, acessorio);

  const tamanhosAtivos = acessorio ? [TAM_ACESSORIO] : tamanhos;

  const corNome = (id: string | null) => cores.find((c) => c.id === id)?.nome ?? null;
  const apelidoNome = (id: string | null) => coresApelido.find((c) => c.id === id)?.nome ?? null;
  const labelVarianteRow = (v: VarianteDraft) => `${v.ordem} · ${varianteLabel({ cor: corNome(v.cor_id), apelido: apelidoNome(v.cor_apelido_id) })}`;

  const addVariante = () => {
    const proximaOrdem = draft.variantes.length ? Math.max(...draft.variantes.map((v) => v.ordem)) + 1 : 1;
    setDraft((d) => ({ ...d, variantes: [...d.variantes, { ordem: proximaOrdem, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 0 }] }));
  };
  const removeVariante = (ordem: number) => {
    setDraft((d) => ({ ...d, variantes: d.variantes.filter((v) => v.ordem !== ordem) }));
    setGrade((g) => { const next = { ...g }; delete next[String(ordem)]; return next; });
  };
  const setVariante = (ordem: number, patch: Partial<VarianteDraft>) => {
    setDraft((d) => ({ ...d, variantes: d.variantes.map((v) => (v.ordem === ordem ? { ...v, ...patch } : v)) }));
  };
  const setPeso = (tam: string, peso: number) => {
    setDraft((d) => ({ ...d, grade_proporcao: { ...d.grade_proporcao, [tam]: peso } }));
  };

  const redistribuirTudo = () => {
    const variantesRedistribuidas = redistribuirVariantesPorPeso(draft.variantes, draft.qtd_total);
    setDraft((d) => ({ ...d, variantes: variantesRedistribuidas }));
    setGrade((g) => redistribuirPedida(variantesRedistribuidas, g, draft.grade_proporcao, acessorio));
  };

  // ── Câmbio (seção 2) — mesma aritmética AO VIVO do ProdutoImportadoCard, via moeda.ts. ──
  const valorProdutoM2 = m1ParaM2(draft.valor_unitario_m1, draft.cotacao_ref);
  const moedaExibicaoM2 = draft.moeda_intermediaria ?? draft.moeda_compra;
  const valorTranspM2 = (Number(draft.peso_kg) || 0) * (Number(draft.transporte_m2) || 0);

  // ── Etapas de pagamento (seção 5) ──
  const setEtapa = (ordem: number, patch: Partial<EtapaDraft>) =>
    setDraft((d) => ({ ...d, etapas: d.etapas.map((e) => (e.ordem === ordem ? { ...e, ...patch } : e)) }));
  const addEtapa = () => {
    if (draft.etapas.length >= 5) return;
    const proximaOrdem = draft.etapas.length ? Math.max(...draft.etapas.map((e) => e.ordem)) + 1 : 1;
    setDraft((d) => ({ ...d, etapas: [...d.etapas, { ordem: proximaOrdem, rotulo: "", base: "mercadoria", percentual: 0, data_vencimento: null, cotacao: 0 }] }));
  };
  const removeEtapa = (ordem: number) => setDraft((d) => ({ ...d, etapas: d.etapas.filter((e) => e.ordem !== ordem) }));
  const somaPercMerc = somaPercentualPorBase(draft.etapas, "mercadoria");
  const somaPercFrete = somaPercentualPorBase(draft.etapas, "frete");

  // Custo landed AO VIVO (preview — o servidor recalcula `custo_unitario_landed_real` de
  // verdade a partir das etapas persistidas, `_imp_recalcular_landed_real_oc`).
  const etapasLanded: EtapaPagamento[] = draft.etapas.map((e) => ({ base: e.base, percentual: e.percentual, cotacao: e.cotacao }));
  const entradaLanded: EntradaLanded = {
    valorUnitarioM1: draft.valor_unitario_m1,
    qtdTotal: draft.qtd_total,
    freteUnitarioM2: valorTranspM2,
    descontoPct: draft.desconto_pct,
    etapas: etapasLanded,
    cotacaoFinal: draft.cotacao_final,
  };
  const landed = custoLanded(entradaLanded);

  return (
    <>
      {/* ── 1 · Dados do pedido ────────────────────────────────────── */}
      <section id="ocimp-sec-pedido" className="scroll-mt-2 space-y-4">
        <OcSecTitle n={1}>Dados do pedido</OcSecTitle>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 grid gap-1">
            <div className="flex items-center justify-between">
              <Label>Nome do produto *</Label>
              {!isEdit && !disabled && !draft.produto_importado_id && (
                <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setPickerOpen(true)}>
                  <Search className="h-3 w-3 mr-1" /> Selecionar produto existente
                </Button>
              )}
            </div>
            {!isEdit && draft.produto_importado_id ? (
              <div className="flex items-center gap-2 rounded-md border p-2">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">
                  {fotoProdutoUrl ? (
                    <img src={fotoProdutoUrl} alt={draft.nome_produto} className="h-full w-full object-cover" />
                  ) : (
                    <ImageOff className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{draft.nome_produto || "—"}</p>
                  <p className="truncate text-xs text-muted-foreground">Produto existente vinculado</p>
                </div>
                <Button type="button" size="iconSm" variant="ghost" aria-label="Desvincular produto" title="Desvincular — digitar novo nome" onClick={desvincularProduto} disabled={disabled}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Input value={draft.nome_produto} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, nome_produto: e.target.value }))} />
            )}
            {!isEdit && (
              <ProdutoImportadoPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={selecionarProduto} />
            )}
          </div>

          <CatSelect label="Grupo" value={draft.grupo_id} disabled={disabled} options={grupos}
            onChange={(v) => setDraft((d) => ({ ...d, grupo_id: v, categoria_id: null, subcategoria1_id: null, subcategoria2_id: null }))} />
          <CatSelect label="Categoria" value={draft.categoria_id} disabled={disabled}
            options={draft.grupo_id ? categorias.filter((c) => c.grupo_id === draft.grupo_id) : categorias}
            onChange={(v) => setDraft((d) => ({ ...d, categoria_id: v, subcategoria1_id: null, subcategoria2_id: null }))} />
          {!acessorio && (
            <>
              <CatSelect label="Subcategoria 1" value={draft.subcategoria1_id} disabled={disabled}
                options={subcats1.filter((s) => s.categoria_id === draft.categoria_id)}
                onChange={(v) => setDraft((d) => ({ ...d, subcategoria1_id: v }))} />
              <CatSelect label="Subcategoria 2" value={draft.subcategoria2_id} disabled={disabled}
                options={subcats2.filter((s) => s.categoria_id === draft.categoria_id)}
                onChange={(v) => setDraft((d) => ({ ...d, subcategoria2_id: v }))} />
            </>
          )}

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
            <Label>REF Fornecedor</Label>
            <Input value={draft.ref_fornecedor} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, ref_fornecedor: e.target.value }))} />
          </div>

          <div className="grid gap-1">
            <Label>Nº do pedido</Label>
            <Input
              value={draft.numero}
              disabled={disabled}
              placeholder="Automático se vazio"
              onChange={(e) => setDraft((d) => ({ ...d, numero: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              {isEdit
                ? "Deixe em branco para manter o número atual."
                : `Gerado automaticamente ao criar (formato ${numeroPreview || "SIGLA"}-NNNNN) se deixado em branco.`}
            </p>
          </div>
          <div className="grid gap-1">
            <Label>Composição</Label>
            <Input value={draft.composicao} disabled={disabled} onChange={(e) => setDraft((d) => ({ ...d, composicao: e.target.value }))} />
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

        <InfoStrip
          itens={produtoVinculado
            ? [
                { label: "Produto vinculado", valor: produtoVinculado.nome },
                { label: "REF", valor: produtoVinculado.ref || "—" },
                { label: "Fornecedor", valor: produtoVinculado.fornecedor || "—" },
              ]
            : [{ label: "Vínculo", valor: "OC avulsa — sem produto vinculado (vincule pelo Produto Importado)" }]}
        />
      </section>

      {/* ── 2 · Moedas & câmbio ───────────────────────────────────── */}
      <section id="ocimp-sec-cambio" className="scroll-mt-2 space-y-4">
        <OcSecTitle n={2}>Moedas &amp; câmbio</OcSecTitle>
        {valoresTravados && (
          <p className="text-xs text-muted-foreground">
            OC recebida — qtd total, valor unitário e a grade pedida ficam travados (desfaça o recebimento para alterar).
          </p>
        )}
        <div className="max-w-sm space-y-2 rounded-md border p-3">
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Valor unit. ({simboloMoeda(draft.moeda_compra)})</Label>
            <NumberInput blankZero disabled={disabled || valoresTravados} className="flex-1" placeholder="0,00" value={draft.valor_unitario_m1} onChange={(e) => setDraft((d) => ({ ...d, valor_unitario_m1: Number(e.target.value) || 0 }))} />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Moeda de compra</Label>
            <div className="flex-1">
              <MoedaSelect value={draft.moeda_compra} onChange={(v) => setDraft((d) => ({ ...d, moeda_compra: v ?? "" }))} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Moeda intermediária</Label>
            <div className="flex-1">
              <MoedaSelect value={draft.moeda_intermediaria} onChange={(v) => setDraft((d) => ({ ...d, moeda_intermediaria: v }))} permitirDireta />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Cotação de ref.</Label>
            <NumberInput blankZero disabled={disabled} className="flex-1" placeholder="0,00" value={draft.cotacao_ref} onChange={(e) => setDraft((d) => ({ ...d, cotacao_ref: Number(e.target.value) || 0 }))} />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Peso (kg)</Label>
            <NumberInput blankZero disabled={disabled} className="flex-1" placeholder="0,00" value={draft.peso_kg} onChange={(e) => setDraft((d) => ({ ...d, peso_kg: Number(e.target.value) || 0 }))} />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Transporte ({simboloMoeda(moedaExibicaoM2)}/kg)</Label>
            <NumberInput blankZero disabled={disabled} className="flex-1" placeholder="0,00" value={draft.transporte_m2} onChange={(e) => setDraft((d) => ({ ...d, transporte_m2: Number(e.target.value) || 0 }))} />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Cotação {simboloMoeda(moedaExibicaoM2)}→R$</Label>
            <NumberInput blankZero disabled={disabled} className="flex-1" placeholder="0,00" value={draft.cotacao_final} onChange={(e) => setDraft((d) => ({ ...d, cotacao_final: Number(e.target.value) || 0 }))} />
          </div>
        </div>
        <InfoStrip
          itens={[
            { label: "Valor produto", hint: "(unit. ÷ cotação de ref.)", valor: fmtMoeda(valorProdutoM2, moedaExibicaoM2) },
            { label: "Valor transp.", hint: "(peso × transporte)", valor: fmtMoeda(valorTranspM2, moedaExibicaoM2) },
            { label: "Custo landed unit. (BRL)", valor: fmtMoeda(landed.unitarioBrl, "BRL"), hi: true },
          ]}
        />
      </section>

      {/* ── 3 · Grade & variantes ─────────────────────────────────── */}
      <section id="ocimp-sec-grade" className="scroll-mt-2 space-y-4">
        <OcSecTitle
          n={3}
          right={
            <Button type="button" variant="outline" size="sm" disabled={disabled || valoresTravados} onClick={redistribuirTudo}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Redistribuir por peso
            </Button>
          }
        >
          Grade &amp; variantes
        </OcSecTitle>

        {!acessorio && (
          <div className="space-y-1.5">
            <Label className="text-sm">Proporção de grade (peso)</Label>
            <div className="flex flex-wrap gap-2">
              {tamanhos.map((t) => {
                const peso = draft.grade_proporcao[t] ?? 0;
                return (
                  <div key={t} className={peso > 0 ? "rounded-md border border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10 p-1.5" : "rounded-md border p-1.5"}>
                    <div className="text-center text-[10px] font-medium text-muted-foreground">{t}</div>
                    <NumberInput
                      integer
                      disabled={disabled}
                      className="h-8 w-14 border-0 bg-transparent text-center"
                      value={peso}
                      onChange={(e) => setPeso(t, Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-sm">Variantes</Label>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={addVariante}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar variante
            </Button>
          </div>
          {draft.variantes.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma variante ainda.</p>
          ) : (
            <div className="space-y-2">
              {draft.variantes.map((v) => (
                <div key={v.ordem} className="flex flex-wrap items-center gap-2 rounded-md border p-2 max-md:flex-col max-md:items-start">
                  <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted-foreground max-md:hidden">{v.ordem}</span>
                  <Select value={v.cor_id ?? ""} onValueChange={(cid) => setVariante(v.ordem, { cor_id: cid || null, cor_apelido_id: null })} disabled={disabled}>
                    <SelectTrigger className="w-40 max-md:w-full"><SelectValue placeholder="Cor base" /></SelectTrigger>
                    <SelectContent>{cores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={v.cor_apelido_id ?? ""} onValueChange={(aid) => setVariante(v.ordem, { cor_apelido_id: aid || null })} disabled={disabled}>
                    <SelectTrigger className="w-40 max-md:w-full"><SelectValue placeholder="Cor apelido" /></SelectTrigger>
                    <SelectContent>
                      {coresApelido.filter((a) => !v.cor_id || a.cor_base_id === v.cor_id).map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="ml-auto flex items-center gap-2 max-md:ml-0 max-md:w-full">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">peso</span>
                      <NumberInput integer disabled={disabled} className="h-8 w-16 text-center" value={v.peso} onChange={(e) => setVariante(v.ordem, { peso: Math.max(0, Number(e.target.value) || 0) })} />
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">qtd</span>
                      <NumberInput integer disabled={disabled} className="h-8 w-20 text-center" value={v.qtd} onChange={(e) => setVariante(v.ordem, { qtd: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })} />
                    </div>
                    {!disabled && (
                      <Button type="button" size="iconSm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => removeVariante(v.ordem)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="max-w-sm space-y-2 rounded-md border p-3">
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Qtd total</Label>
            <NumberInput integer disabled={disabled || valoresTravados} className="flex-1" value={draft.qtd_total} onChange={(e) => setDraft((d) => ({ ...d, qtd_total: Math.max(0, Math.trunc(Number(e.target.value)) || 0) }))} />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Desconto (%)</Label>
            <NumberInput disabled={disabled || valoresTravados} className="flex-1" value={draft.desconto_pct} onChange={(e) => setDraft((d) => ({ ...d, desconto_pct: Math.max(0, Number(e.target.value) || 0) }))} />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-sm">Grade pedida (destrinchada — auto + editável)</Label>
          <GradeDestrinchada
            variantes={draft.variantes}
            tamanhos={tamanhosAtivos}
            grade={grade}
            campo="pedida"
            onChange={setGrade}
            labelFor={(ordem) => labelVarianteRow(draft.variantes.find((v) => v.ordem === ordem)!)}
            disabled={disabled || valoresTravados}
          />
        </div>
      </section>

      {/* ── 4 · Etapas de pagamento ────────────────────────────────── */}
      <section id="ocimp-sec-etapas" className="scroll-mt-2 space-y-4">
        <OcSecTitle
          n={4}
          right={
            <Button type="button" variant="outline" size="sm" disabled={disabled || draft.etapas.length >= 5} onClick={addEtapa}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar etapa
            </Button>
          }
        >
          Etapas de pagamento
        </OcSecTitle>

        {draft.etapas.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma etapa ainda — adicione ao menos uma (mercadoria e/ou frete).</p>
        ) : (
          <div className="space-y-2">
            {draft.etapas.map((e) => (
              <div key={e.ordem} className="flex flex-wrap items-center gap-2 rounded-md border p-2 max-md:flex-col max-md:items-start">
                <Input className="w-32 max-md:w-full" placeholder="Rótulo" disabled={disabled} value={e.rotulo} onChange={(ev) => setEtapa(e.ordem, { rotulo: ev.target.value })} />
                <Select value={e.base} onValueChange={(v) => setEtapa(e.ordem, { base: v as "mercadoria" | "frete" })} disabled={disabled}>
                  <SelectTrigger className="w-32 max-md:w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mercadoria">Mercadoria</SelectItem>
                    <SelectItem value="frete">Frete</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1">
                  <NumberInput blankZero placeholder="0" disabled={disabled} className="h-8 w-16 text-center" value={e.percentual} onChange={(ev) => setEtapa(e.ordem, { percentual: Math.max(0, Number(ev.target.value) || 0) })} />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <DateField className="w-36 max-md:w-full" disabled={disabled} value={e.data_vencimento ?? ""} onChange={(ev) => setEtapa(e.ordem, { data_vencimento: ev.target.value || null })} />
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">cotação</span>
                  <NumberInput blankZero placeholder="0,00" disabled={disabled} className="h-8 w-20 text-center" value={e.cotacao} onChange={(ev) => setEtapa(e.ordem, { cotacao: Number(ev.target.value) || 0 })} />
                </div>
                {!disabled && (
                  <Button type="button" size="iconSm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive max-md:ml-0" onClick={() => removeEtapa(e.ordem)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {somaPercMerc !== 100 && draft.etapas.some((e) => e.base === "mercadoria") && (
          <p className="text-xs text-amber-600 dark:text-amber-400">Σ% mercadoria = {somaPercMerc}% — precisa fechar 100%.</p>
        )}
        {somaPercFrete !== 100 && draft.etapas.some((e) => e.base === "frete") && (
          <p className="text-xs text-amber-600 dark:text-amber-400">Σ% frete = {somaPercFrete}% — precisa fechar 100%.</p>
        )}
        <p className="text-xs text-muted-foreground">
          As parcelas a pagar são geradas automaticamente a partir destas etapas ao salvar (uma por etapa).
        </p>
      </section>

      {/* ── 5 · Anexos ─────────────────────────────────────────────── */}
      <section id="ocimp-sec-anexos" className="scroll-mt-2 space-y-4">
        <OcSecTitle n={5}>Anexos</OcSecTitle>
        <div className="grid sm:grid-cols-2 gap-4">
          <FileField
            label="Pedido (PDF ou imagem)"
            path={draft.anexo_pedido_url}
            bucket="oc-tecido"
            disabled={disabled}
            onChange={(f) => handleUpload(f, "anexo_pedido_url")}
            onClear={() => setDraft((d) => ({ ...d, anexo_pedido_url: null }))}
          />
          <FileField
            label="Nota Fiscal"
            path={draft.anexo_nf_url}
            bucket="oc-tecido"
            disabled={disabled}
            onChange={(f) => handleUpload(f, "anexo_nf_url")}
            onClear={() => setDraft((d) => ({ ...d, anexo_nf_url: null }))}
          />
        </div>
      </section>
    </>
  );
}
