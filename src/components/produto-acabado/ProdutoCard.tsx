import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ChevronRight, MoreHorizontal, ExternalLink, RefreshCw, Plus, Trash2, ShoppingCart, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mensagemErro } from "@/lib/erro-mensagem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/shared/NumberInput";
import { MoneyInput } from "@/components/shared/MoneyInput";
import { InfoStrip } from "@/components/shared/InfoStrip";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { FornecedorSelect, type EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { varianteLabel } from "@/lib/variante";
import { ehGrupoAcessorio, cadeiaValores } from "@/lib/produto-acabado";
import {
  redistribuirVariantesPorPeso, gradePedidaDeVariantes, somaGradeCampo, somaPecas, hojeISO, fmtMoney,
  type ProdutoDraft, type VarianteDraft, type Opt, type CatOpt, type SubOpt, type CorApelidoOpt, type OcVinculadaInfo,
} from "./shared";

type OcAvulsa = {
  id: string;
  numero: string | null;
  nome_produto: string;
  status: "encomendado" | "recebido";
  qtd_total: number | null;
  valor_total_desconto: number | null;
  valor_unitario_real: number | null;
  grade_detalhe: OcVinculadaInfo["grade_detalhe"] | null;
};

export function ProdutoCard({
  produto,
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
  colecaoNome,
  linhasMarkup,
  onCardCriado,
  onOcVinculada,
  onExcluido,
}: {
  produto: ProdutoDraft;
  onChange: (next: ProdutoDraft) => void;
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
  colecaoNome: string | null;
  /** id da linha → markup do cadastro (Cadastro > Linhas) — §N "markup da linha do cadastro
   *  = sugestão". Modelos espelho de revenda nascem SEM linha (`criar_card_produto_acabado`
   *  grava `linha_id: null`); mostra "—" até alguém setar uma linha no Plan. Produto. */
  linhasMarkup: Record<string, number>;
  /** Patch local imediato (sem esperar refetch) após criar o card espelho — preserva edições
   *  não salvas de OUTROS cards (a tela não tem colab/merge — Fora de escopo, ver design spec). */
  onCardCriado: (modeloId: string) => void;
  onOcVinculada: (oc: OcVinculadaInfo | null) => void;
  onExcluido: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [confirmExcluir, setConfirmExcluir] = useState(false);
  const [vincularOpen, setVincularOpen] = useState(false);
  const [criandoCard, setCriandoCard] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [fazendoPedido, setFazendoPedido] = useState(false);

  const grupoNome = grupos.find((g) => g.id === produto.grupo_id)?.nome ?? "";
  const categoriaNome = categorias.find((c) => c.id === produto.categoria_id)?.nome ?? "";
  const sub1Nome = subcats1.find((s) => s.id === produto.subcategoria1_id)?.nome ?? "";
  const sub2Nome = subcats2.find((s) => s.id === produto.subcategoria2_id)?.nome ?? "";
  const acessorio = ehGrupoAcessorio(grupoNome);
  const empresaNome = empresas.find((e) => e.id === produto.empresa_id)?.nome_fantasia ?? "";
  const pecas = somaPecas(produto);
  const taxonomia = [grupoNome, categoriaNome, !acessorio ? sub1Nome : null, !acessorio ? sub2Nome : null].filter(Boolean).join(" › ");

  const corNome = (id: string | null) => cores.find((c) => c.id === id)?.nome ?? null;
  const apelidoNome = (id: string | null) => coresApelido.find((c) => c.id === id)?.nome ?? null;

  // ── Compra & variantes (editável) ──
  const setVariante = (ordem: number, patch: Partial<VarianteDraft>) =>
    onChange({ ...produto, variantes: produto.variantes.map((v) => (v.ordem === ordem ? { ...v, ...patch } : v)) });
  const addVariante = () => {
    const proximaOrdem = produto.variantes.length ? Math.max(...produto.variantes.map((v) => v.ordem)) + 1 : 1;
    onChange({ ...produto, variantes: [...produto.variantes, { ordem: proximaOrdem, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 0 }] });
  };
  const removeVariante = (ordem: number) => onChange({ ...produto, variantes: produto.variantes.filter((v) => v.ordem !== ordem) });
  const setPeso = (tam: string, peso: number) => onChange({ ...produto, grade_proporcao: { ...produto.grade_proporcao, [tam]: peso } });
  const redistribuir = () => onChange({ ...produto, variantes: redistribuirVariantesPorPeso(produto.variantes, produto.qtd_total) });

  const { bruto, totalDesc, unitReal } = cadeiaValores(produto.qtd_total, produto.valor_unitario, produto.desconto_pct);
  const somaPeso = produto.variantes.reduce((s, v) => s + (Number(v.peso) || 0), 0);
  const base = unitReal + produto.insumos_total;
  const markupLinha = produto.modeloLinhaId ? linhasMarkup[produto.modeloLinhaId] ?? null : null;

  // ── ⋯ menu: criar card / aplicar ao modelo / excluir ──
  // Invalidação ampla é segura aqui (não sobrescreve os `drafts` em memória do Sheet — a
  // re-hidratação só acontece no 1º load, ver ProdutoAcabadoSheet), então cuida da higiene de
  // cache das telas VIZINHAS (Planejamento, OTB) enquanto o patch local dá o feedback imediato.
  const invalidarVizinhos = () => {
    qc.invalidateQueries({ queryKey: ["otb-orcamento"] });
    qc.invalidateQueries({ queryKey: ["modelo"] });
    qc.invalidateQueries({ queryKey: ["modelos-desenvolvimento"] });
  };

  const criarCardMut = useMutation({
    mutationFn: async () => {
      setCriandoCard(true);
      const { data, error } = await supabase.rpc("criar_card_produto_acabado" as any, { _produto_id: produto.id });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (modeloId) => { toast.success("Card criado no Planejamento."); onCardCriado(modeloId); invalidarVizinhos(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao criar card.")),
    onSettled: () => setCriandoCard(false),
  });

  const aplicarMut = useMutation({
    mutationFn: async () => {
      setAplicando(true);
      const { error } = await supabase.rpc("aplicar_produto_ao_modelo" as any, { _produto_id: produto.id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Quantidade/variantes reaplicadas ao modelo."); invalidarVizinhos(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao aplicar ao modelo.")),
    onSettled: () => setAplicando(false),
  });

  const excluirMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("produtos_acabados" as any).delete().eq("id", produto.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Produto excluído."); setConfirmExcluir(false); onExcluido(); invalidarVizinhos(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  // ── OC vinculada (seção 3) ──
  const vincularMut = useMutation({
    mutationFn: async (oc: OcAvulsa | null) => {
      const { error } = await supabase.rpc("vincular_oc_p_acabado" as any, { _oc_id: oc?.id ?? null, _produto_id: produto.id });
      if (error) throw error;
      return oc;
    },
    onSuccess: (oc) => {
      toast.success(oc ? "OC vinculada." : "OC desvinculada.");
      setVincularOpen(false);
      onOcVinculada(oc ? { id: oc.id, numero: oc.numero, status: oc.status, qtd_total: oc.qtd_total ?? 0, valor_unitario_real: Number(oc.valor_unitario_real) || 0, grade_detalhe: oc.grade_detalhe ?? {} } : null);
      qc.invalidateQueries({ queryKey: ["ocs_p_acabado"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao vincular OC.")),
  });

  const fazerPedidoMut = useMutation({
    mutationFn: async () => {
      setFazendoPedido(true);
      // Consistência: redistribui a qtd das variantes pela proporção de peso ANTES de gerar a
      // OC — evita P0001 "soma da grade pedida difere da qtd total" se o usuário mudou qtd_total
      // sem clicar em Redistribuir aqui na Compra.
      const variantesConsistentes = redistribuirVariantesPorPeso(produto.variantes, produto.qtd_total);
      const grade = gradePedidaDeVariantes(variantesConsistentes, produto.grade_proporcao, acessorio);
      const dados = {
        nome_produto: produto.nome,
        grupo_id: produto.grupo_id,
        categoria_id: produto.categoria_id,
        subcategoria1_id: produto.subcategoria1_id,
        subcategoria2_id: produto.subcategoria2_id,
        empresa_id: produto.empresa_id,
        representante_id: produto.representante_id,
        ref_fornecedor: produto.ref_fornecedor || null,
        composicao: produto.composicao || null,
        data_pedido: hojeISO(),
        prazo_pagamento: "30",
        parcelas_entrega: 1,
        grade_proporcao: produto.grade_proporcao,
        variantes: variantesConsistentes,
        qtd_total: produto.qtd_total,
        valor_unitario: produto.valor_unitario,
        desconto_pct: produto.desconto_pct,
        produto_acabado_id: produto.id,
      };
      const { data: ocId, error } = await supabase.rpc("salvar_oc_p_acabado" as any, { _id: null, _dados: dados, _grade: grade });
      if (error) throw error;
      return ocId as string;
    },
    onSuccess: (ocId) => {
      toast.success("Pedido criado e vinculado.");
      qc.invalidateQueries({ queryKey: ["produtos-acabados"] });
      qc.invalidateQueries({ queryKey: ["ocs_p_acabado"] });
      navigate({ to: "/entrada-saida/oc-p-acabado", search: { oc: ocId } as any });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao criar pedido.")),
    onSettled: () => setFazendoPedido(false),
  });

  const { data: ocsAvulsas = [] } = useQuery({
    queryKey: ["ocs-p-acabado-avulsas"],
    enabled: vincularOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_p_acabado" as any)
        .select("id, numero, nome_produto, status, qtd_total, valor_total_desconto, valor_unitario_real, grade_detalhe")
        .is("produto_acabado_id", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as OcAvulsa[];
    },
  });
  const [buscaOc, setBuscaOc] = useState("");
  const ocsFiltradas = ocsAvulsas.filter((o) => !buscaOc || `${o.numero ?? ""} ${o.nome_produto}`.toLowerCase().includes(buscaOc.toLowerCase()));

  const somaPedida = somaGradeCampo(produto.oc?.grade_detalhe, "pedida");
  const somaRecebida = somaGradeCampo(produto.oc?.grade_detalhe, "recebida");

  return (
    <div id={`produto-card-${produto.id}`} className="scroll-mt-3 rounded-lg border bg-card">
      <button type="button" onClick={onToggleOpen} className="flex w-full items-start gap-2 p-3 text-left">
        <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight">{produto.nome}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{produto.ref ?? "REF —"}</span>
            <span>{empresaNome || "sem fornecedor"}</span>
            <span className="tabular-nums">{pecas} pç</span>
          </div>
          {open && (
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="truncate">{taxonomia || "sem taxonomia"}{colecaoNome ? ` › ${colecaoNome}` : ""}</span>
              {produto.modelo_id && (
                <button
                  type="button"
                  title="Abrir card no Plan. Produto"
                  onClick={(e) => { e.stopPropagation(); navigate({ to: "/criacao/planejamento", search: { modelo: produto.modelo_id } as any }); }}
                  className="shrink-0 rounded p-0.5 text-primary hover:bg-primary/10"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
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
          <PopoverContent align="end" className="w-56 p-1" onClick={(e) => e.stopPropagation()}>
            <PopoverClose asChild>
              <button
                type="button"
                disabled={!!produto.modelo_id || criandoCard}
                title={produto.modelo_id ? "Este produto já tem card" : undefined}
                onClick={() => criarCardMut.mutate()}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-4 w-4 shrink-0" /> Criar card em Planejamento
              </button>
            </PopoverClose>
            <PopoverClose asChild>
              <button
                type="button"
                disabled={!produto.modelo_id || aplicando}
                title={!produto.modelo_id ? "Crie o card primeiro" : "Reempurra qtd/variantes pro modelo espelho"}
                onClick={() => aplicarMut.mutate()}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw className="h-4 w-4 shrink-0" /> Aplicar ao modelo
              </button>
            </PopoverClose>
            <div className="my-1 border-t" />
            <button
              type="button"
              onClick={() => setConfirmExcluir(true)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4 shrink-0" /> Excluir produto
            </button>
          </PopoverContent>
        </Popover>
      </button>

      {open && (
        <div className="border-t px-3 pb-3">
          <Accordion type="multiple" defaultValue={["compra"]} className="[&>div]:border-b-0">
            {/* ── 1 · Compra & variantes ────────────────────────────── */}
            <AccordionItem value="compra">
              <AccordionTrigger className="text-xs font-semibold">1 · Compra &amp; variantes</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4">
                  <div className="max-w-sm space-y-2 rounded-md border p-3">
                    <div className="flex items-center gap-3">
                      <Label className="w-[150px] shrink-0 text-sm">Fornecedor</Label>
                      <div className="flex-1">
                        <FornecedorSelect empresas={empresas} empresaId={produto.empresa_id} representanteId={produto.representante_id}
                          onChange={(empresa_id, representante_id) => onChange({ ...produto, empresa_id, representante_id })} />
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[150px] shrink-0 text-sm">REF Fornecedor</Label>
                      <Input className="flex-1" value={produto.ref_fornecedor} onChange={(e) => onChange({ ...produto, ref_fornecedor: e.target.value })} />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[150px] shrink-0 text-sm">Qtd total</Label>
                      <NumberInput integer className="flex-1" value={produto.qtd_total} onChange={(e) => onChange({ ...produto, qtd_total: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })} />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[150px] shrink-0 text-sm">Valor unitário</Label>
                      <MoneyInput className="flex-1" value={produto.valor_unitario} onChange={(e) => onChange({ ...produto, valor_unitario: Number(e.target.value) || 0 })} />
                    </div>
                    <div className="flex items-center gap-3">
                      <Label className="w-[150px] shrink-0 text-sm">Desconto (%)</Label>
                      <NumberInput className="flex-1" value={produto.desconto_pct} onChange={(e) => onChange({ ...produto, desconto_pct: Math.max(0, Number(e.target.value) || 0) })} />
                    </div>
                  </div>

                  {!acessorio && (
                    <div className="space-y-1.5">
                      <Label className="text-sm">Proporção de grade (peso)</Label>
                      <div className="flex flex-wrap gap-2">
                        {tamanhos.map((t) => {
                          const peso = produto.grade_proporcao[t] ?? 0;
                          return (
                            <div key={t} className={peso > 0 ? "rounded-md border border-amber-300 bg-amber-50 p-1.5 dark:border-amber-500/40 dark:bg-amber-500/10" : "rounded-md border p-1.5"}>
                              <div className="text-center text-[10px] font-medium text-muted-foreground">{t}</div>
                              <NumberInput integer className="h-8 w-14 border-0 bg-transparent text-center" value={peso} onChange={(e) => setPeso(t, Math.max(0, Math.trunc(Number(e.target.value)) || 0))} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Variantes (cor)</Label>
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={redistribuir}><RefreshCw className="mr-1 h-3.5 w-3.5" /> Redistribuir por peso</Button>
                        <Button type="button" variant="outline" size="sm" onClick={addVariante}><Plus className="mr-1 h-3.5 w-3.5" /> Adicionar variante</Button>
                      </div>
                    </div>
                    {produto.variantes.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nenhuma variante ainda.</p>
                    ) : (
                      <div className="space-y-2">
                        {produto.variantes.map((v) => (
                          <div key={v.ordem} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                            <span className="w-6 shrink-0 text-center text-xs tabular-nums text-muted-foreground">{v.ordem}</span>
                            <Select value={v.cor_id ?? ""} onValueChange={(cid) => setVariante(v.ordem, { cor_id: cid || null, cor_apelido_id: null })}>
                              <SelectTrigger className="w-40"><SelectValue placeholder="Cor base" /></SelectTrigger>
                              <SelectContent>{cores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}</SelectContent>
                            </Select>
                            <Select value={v.cor_apelido_id ?? ""} onValueChange={(aid) => setVariante(v.ordem, { cor_apelido_id: aid || null })}>
                              <SelectTrigger className="w-40"><SelectValue placeholder="Cor apelido" /></SelectTrigger>
                              <SelectContent>{coresApelido.filter((a) => !v.cor_id || a.cor_base_id === v.cor_id).map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}</SelectContent>
                            </Select>
                            <span className="text-xs text-muted-foreground">{varianteLabel({ cor: corNome(v.cor_id), apelido: apelidoNome(v.cor_apelido_id) })}</span>
                            <div className="ml-auto flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">peso</span>
                              <NumberInput integer className="h-8 w-16 text-center" value={v.peso} onChange={(e) => setVariante(v.ordem, { peso: Math.max(0, Number(e.target.value) || 0) })} />
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">qtd</span>
                              <NumberInput integer className="h-8 w-20 text-center" value={v.qtd} onChange={(e) => setVariante(v.ordem, { qtd: Math.max(0, Math.trunc(Number(e.target.value)) || 0) })} />
                            </div>
                            <Button type="button" size="iconSm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={() => removeVariante(v.ordem)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <InfoStrip itens={[
                    { label: "Bruto", valor: fmtMoney(bruto) },
                    { label: "Total c/ desconto", valor: fmtMoney(totalDesc) },
                    { label: "V. unit. real", valor: fmtMoney(unitReal), hi: true },
                    { label: "Σ peso", valor: somaPeso },
                  ]} />
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* ── 2 · Preço (somente leitura) ──────────────────────── */}
            <AccordionItem value="preco">
              <AccordionTrigger className="text-xs font-semibold">
                <span className="flex flex-1 items-center justify-between pr-2">
                  <span>2 · Preço</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium normal-case text-muted-foreground">
                    {produto.modelo_id
                      ? `Varejo ${fmtMoney(produto.modeloPrecoVenda)} · Atacado ${fmtMoney(produto.modeloPrecoAtacado)} · base ${fmtMoney(base)}`
                      : "sem espelho — crie o card"}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                {produto.modelo_id ? (
                  <InfoStrip itens={[
                    { label: "V. unit. real", valor: fmtMoney(unitReal) },
                    { label: "Σ insumos", valor: fmtMoney(produto.insumos_total) },
                    { label: "Base", valor: fmtMoney(base), hi: true },
                    { label: "Markup da linha", valor: markupLinha != null ? `${markupLinha.toFixed(2)}×` : "—" },
                  ]} />
                ) : (
                  <p className="text-sm text-muted-foreground">Preço e markup aparecem quando este produto tiver um card no Planejamento — crie o card no menu ⋯.</p>
                )}
              </AccordionContent>
            </AccordionItem>

            {/* ── 3 · OC vinculada ──────────────────────────────────── */}
            <AccordionItem value="oc">
              <AccordionTrigger className="text-xs font-semibold">3 · OC vinculada</AccordionTrigger>
              <AccordionContent className="space-y-3">
                {produto.oc ? (
                  <InfoStrip itens={[
                    {
                      label: "Nº",
                      valor: (
                        <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline"
                          onClick={() => navigate({ to: "/entrada-saida/oc-p-acabado", search: { oc: produto.oc!.id } as any })}>
                          {produto.oc.numero ?? "—"} <ExternalLink className="h-3 w-3" />
                        </button>
                      ),
                    },
                    { label: "Status", valor: <StatusBadge tone={produto.oc.status === "recebido" ? "success" : "warning"}>{produto.oc.status === "recebido" ? "Recebido" : "Encomendado"}</StatusBadge> },
                    { label: "Pedida", valor: somaPedida },
                    { label: "Recebida", valor: somaRecebida },
                    { label: "V. unit. real", valor: fmtMoney(produto.oc.valor_unitario_real), hi: true },
                  ]} />
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhuma OC vinculada ainda.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setVincularOpen(true)}>
                    <Link2 className="mr-1 h-3.5 w-3.5" /> Vincular OC existente
                  </Button>
                  {!produto.oc && (
                    <Button type="button" size="sm" disabled={fazendoPedido} onClick={() => fazerPedidoMut.mutate()}>
                      <ShoppingCart className="mr-1 h-3.5 w-3.5" /> {fazendoPedido ? "Criando…" : "Fazer pedido"}
                    </Button>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      )}

      {/* Excluir produto */}
      <AlertDialog open={confirmExcluir} onOpenChange={setConfirmExcluir}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir produto?</AlertDialogTitle>
            <AlertDialogDescription>
              {produto.oc
                ? `Este produto tem a OC ${produto.oc.numero ?? ""} vinculada — desvincule antes (aba "3 · OC vinculada" → Vincular OC existente → nenhuma) para poder excluir.`
                : "Esta ação não pode ser desfeita. O produto e suas variantes serão removidos."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {!produto.oc && (
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => excluirMut.mutate()}>
                Excluir
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Vincular OC existente */}
      <Dialog open={vincularOpen} onOpenChange={setVincularOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Vincular OC existente</DialogTitle></DialogHeader>
          <Input placeholder="Buscar por nº ou nome…" value={buscaOc} onChange={(e) => setBuscaOc(e.target.value)} />
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {produto.oc && (
              <button type="button" onClick={() => vincularMut.mutate(null)} className="flex w-full items-center gap-2 rounded-md border border-dashed p-2 text-left text-sm text-muted-foreground hover:bg-muted">
                Desvincular OC atual
              </button>
            )}
            {ocsFiltradas.length === 0 && <p className="p-2 text-sm text-muted-foreground">Nenhuma OC avulsa encontrada.</p>}
            {ocsFiltradas.map((o) => (
              <button key={o.id} type="button" onClick={() => vincularMut.mutate(o)} className="flex w-full items-center justify-between gap-2 rounded-md border p-2 text-left text-sm hover:bg-muted">
                <span className="min-w-0 truncate"><b>{o.numero ?? "—"}</b> · {o.nome_produto}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{fmtMoney(o.valor_total_desconto)}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
