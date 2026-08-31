import { useState } from "react";
import { Plus, Trash2, RefreshCw, Search, X, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { InfoStrip } from "@/components/shared/InfoStrip";
import { FornecedorSelect, type EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import { FileField } from "@/components/oc-tecido/FileField";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OcSecTitle } from "@/components/oc-tecido/OcTecidoForm";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { ehGrupoAcessorio, cadeiaValores, previewNumeroOc } from "@/lib/produto-acabado";
import { varianteLabel } from "@/lib/variante";
import { GradeDestrinchada } from "./GradeDestrinchada";
import { ProdutoAcabadoPicker, type ProdutoAcabadoSelecionado } from "./ProdutoAcabadoPicker";
import {
  redistribuirPedida, redistribuirVariantesPorPeso, contarParcelasPrazo, fmtMoney, TAM_ACESSORIO,
  type Draft, type GradeDetalhe, type VarianteDraft,
} from "./shared";

export type Opt = { id: string; nome: string };
export type CatOpt = Opt & { grupo_id: string | null };
export type SubOpt = Opt & { categoria_id: string | null };
export type CorApelidoOpt = Opt & { cor_base_id: string | null };

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

export function OcPaForm({
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
  // Item 3 (refino onda 2): o seletor de produto existente só faz sentido pra OC NOVA —
  // `produto_acabado_id` só é aplicado no INSERT pela RPC (update não toca, comentário
  // em `montarDados` no route file), então picker em modo edição vincularia visualmente
  // sem nenhum efeito real no servidor. `!isEdit` decide a UI (nome vira picker); sem
  // isso o form não sabe se está criando ou editando.
  isEdit?: boolean;
  // Item 4: OC 'recebido' — valor unitário/desconto/qtd pedida (+ grade "pedida", campo
  // section 2) ficam read-only na UI, espelhando a guarda do servidor (P0001, migração
  // 20260811150000). NÃO afeta o resto do form (nome/categorias/fornecedor/datas/prazo/
  // anexos seguem editáveis) — só os campos de $/qtd pedida.
  valoresTravados?: boolean;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Foto do produto escolhido no picker (item 3) — estado local só de exibição (não vai
  // pro payload de save): capturada no momento da seleção, junto do path de storage
  // devolvido pela query do picker. Some ao trocar/desvincular ou ao reabrir a OC do
  // zero (o InfoStrip de "Produto vinculado" abaixo já cobre a exibição pós-reload).
  const [fotoProdutoSelecionado, setFotoProdutoSelecionado] = useState<string | null>(null);
  const fotoProdutoUrl = useSignedUrl(fotoProdutoSelecionado, "modelos");

  const selecionarProduto = (p: ProdutoAcabadoSelecionado) => {
    setDraft((d) => ({
      ...d,
      produto_acabado_id: p.id,
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
      valor_unitario: p.valor_unitario,
      desconto_pct: p.desconto_pct,
    }));
    // Grade "pedida" anterior referenciava outras variantes/ordens — reinicia limpa (o
    // usuário preenche/"Redistribui por peso" em cima das variantes recém-carregadas,
    // igual a uma OC avulsa nova).
    setGrade({});
    setFotoProdutoSelecionado(p.fotoPath);
    setPickerOpen(false);
  };
  const desvincularProduto = () => {
    setDraft((d) => ({ ...d, produto_acabado_id: null }));
    setFotoProdutoSelecionado(null);
  };
  const grupoNome = grupos.find((g) => g.id === draft.grupo_id)?.nome ?? "";
  const categoriaNome = categorias.find((c) => c.id === draft.categoria_id)?.nome ?? "";
  const acessorio = ehGrupoAcessorio(grupoNome);
  const empresaNome = empresas.find((e) => e.id === draft.empresa_id)?.nome_fantasia ?? "";
  const numeroPreview = previewNumeroOc(empresaNome, grupoNome, categoriaNome, acessorio);

  const tamanhosAtivos = acessorio ? [TAM_ACESSORIO] : tamanhos;
  const { bruto, totalDesc, unitReal } = cadeiaValores(draft.qtd_total, draft.valor_unitario, draft.desconto_pct);

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

  // "Redistribuir por peso" (§N: auto por maior resto + editável): 1 clique refaz TANTO a
  // qtd de cada variante (peso × qtd_total) QUANTO a grade pedida de cada uma (peso × qtd
  // da variante) — os dois splits usam o mesmo helper do banco (_split_maior_resto).
  // `redistribuirPedida` já devolve a grade INTEIRA mesclada célula-a-célula (preserva
  // recebida/defeito e tamanhos fora da proporção — ver comentário na função) — setGrade
  // recebe o resultado direto, sem spread por cima (evitaria só duplicar o merge à toa).
  const redistribuirTudo = () => {
    const variantesRedistribuidas = redistribuirVariantesPorPeso(draft.variantes, draft.qtd_total);
    setDraft((d) => ({ ...d, variantes: variantesRedistribuidas }));
    setGrade((g) => redistribuirPedida(variantesRedistribuidas, g, draft.grade_proporcao, acessorio));
  };

  return (
    <>
      {/* ── 1 · Dados do pedido ────────────────────────────────────── */}
      <section id="ocpa-sec-pedido" className="scroll-mt-2 space-y-4">
        <OcSecTitle n={1}>Dados do pedido</OcSecTitle>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 grid gap-1">
            <div className="flex items-center justify-between">
              <Label>Nome do produto *</Label>
              {/* Item 3: só faz sentido pra OC NOVA sem produto ainda escolhido — editar
                  não vincula (a RPC ignora produto_acabado_id no update) e um produto já
                  escolhido mostra o chip abaixo em vez do link. */}
              {!isEdit && !disabled && !draft.produto_acabado_id && (
                <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setPickerOpen(true)}>
                  <Search className="h-3 w-3 mr-1" /> Selecionar produto existente
                </Button>
              )}
            </div>
            {!isEdit && draft.produto_acabado_id ? (
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
              <ProdutoAcabadoPicker open={pickerOpen} onOpenChange={setPickerOpen} onSelect={selecionarProduto} />
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
            {/* Item 1: EDITÁVEL — a trigger `fn_oc_p_acabado_numero` só gera quando vazio
                (guard `if new.numero is not null and new.numero <> ''`); em branco = gera
                ao criar (ou mantém o valor atual ao editar, RPC 20260811160000). */}
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

          {/* Item 2: prazo digitado → nº de parcelas a pagar DERIVADO ao lado (mesmo
              formato da OC Tecido, `OcTecidoForm.tsx` — campo "Parcelas a pagar
              (derivado)" readOnly; parser próprio da OC P. Acabado — `contarParcelasPrazo`
              espelha o trigger `gerar_parcelas_oc_p_acabado`, que só reconhece "/"). */}
          <div className="grid gap-1">
            <Label>Prazo de pagamento</Label>
            <Input placeholder="Ex: 30/60/90" value={draft.prazo_pagamento} disabled={disabled}
              onChange={(e) => {
                const v = e.target.value;
                setDraft((d) => ({ ...d, prazo_pagamento: v, parcelas_entrega: contarParcelasPrazo(v) }));
              }} />
          </div>
          <div className="grid gap-1">
            <Label>Parcelas a pagar (derivado)</Label>
            <NumberInput type="number" integer value={draft.parcelas_entrega} readOnly disabled />
          </div>
        </div>

        <InfoStrip
          itens={produtoVinculado
            ? [
                { label: "Produto vinculado", valor: produtoVinculado.nome },
                { label: "REF", valor: produtoVinculado.ref || "—" },
                { label: "Fornecedor", valor: produtoVinculado.fornecedor || "—" },
              ]
            : [{ label: "Vínculo", valor: "OC avulsa — sem produto vinculado (vincule pelo Produto Acabado)" }]}
        />
      </section>

      {/* ── 2 · Grade, variantes & valores ────────────────────────── */}
      <section id="ocpa-sec-grade" className="scroll-mt-2 space-y-4">
        <OcSecTitle
          n={2}
          right={
            // Item 4: desabilitado quando travado — o botão só reescreve qtd/pedida, os
            // dois campos congelados; deixá-lo ativo levaria a um Salvar que falha (P0001)
            // sem nenhum sinal visual do porquê.
            <Button type="button" variant="outline" size="sm" disabled={disabled || valoresTravados} onClick={redistribuirTudo}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Redistribuir por peso
            </Button>
          }
        >
          Grade, variantes &amp; valores
        </OcSecTitle>

        {valoresTravados && (
          <p className="text-xs text-muted-foreground">
            OC recebida — qtd total, valor unitário, desconto e a grade pedida ficam travados (desfaça o recebimento pra alterar).
          </p>
        )}

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

        {/* Bloco de valores — EMPILHADO 1 campo/linha, rótulo ~150px (§N: formato da
            planilha de referência do dono). */}
        <div className="max-w-sm space-y-2 rounded-md border p-3">
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Qtd total</Label>
            <NumberInput integer disabled={disabled || valoresTravados} className="flex-1" value={draft.qtd_total} onChange={(e) => setDraft((d) => ({ ...d, qtd_total: Math.max(0, Math.trunc(Number(e.target.value)) || 0) }))} />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Valor unitário</Label>
            <MoneyInput disabled={disabled || valoresTravados} className="flex-1" value={draft.valor_unitario} onChange={(e) => setDraft((d) => ({ ...d, valor_unitario: Number(e.target.value) || 0 }))} />
          </div>
          <div className="flex items-center gap-3">
            <Label className="w-[150px] shrink-0 text-sm">Desconto (%)</Label>
            <NumberInput disabled={disabled || valoresTravados} className="flex-1" value={draft.desconto_pct} onChange={(e) => setDraft((d) => ({ ...d, desconto_pct: Math.max(0, Number(e.target.value) || 0) }))} />
          </div>
        </div>

        <InfoStrip
          itens={[
            { label: "Bruto", valor: fmtMoney(bruto) },
            { label: "Total c/ desconto", valor: fmtMoney(totalDesc) },
            { label: "V. unit. real", valor: fmtMoney(unitReal), hi: true },
          ]}
        />

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

      {/* ── 3 · Anexos ─────────────────────────────────────────────── */}
      <section id="ocpa-sec-anexos" className="scroll-mt-2 space-y-4">
        <OcSecTitle n={3}>Anexos</OcSecTitle>
        <div className="grid sm:grid-cols-2 gap-4">
          <FileField
            label="Pedido (PDF)"
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
