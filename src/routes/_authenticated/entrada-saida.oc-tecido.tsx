import { useEffect, useMemo, useRef, useState } from "react";
import { fmtNum } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scissors, Plus, Minus, ArrowLeft, Trash2, Printer, Lock, Check, AlertTriangle } from "lucide-react";
import { addDays, format as formatDate, parseISO } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { mensagemErro } from "@/lib/erro-mensagem";
import { empresaTemCategoria, FABRIC_TOKENS } from "@/lib/fornecedor-categoria";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { ColabBanner } from "@/components/shared/ColabBanner";
import { useColabRegistro } from "@/hooks/useColabRegistro";
import { mergeDraft, mergeLinhas, type Conflito } from "@/lib/colab/merge";
import { OcTecidoList } from "@/components/oc-tecido/OcTecidoList";
import { useEstoqueTecidos } from "@/components/oc-tecido/EstoqueTecidosTab";
import { RolosList, RoloDialog, RemoverMetragemDialog, AjustesList } from "@/components/oc-tecido/Rolos";
import { OcCqSection, alertaBadge } from "@/components/oc-tecido/CqTecido";
import { FilterButton, SearchToggle } from "@/components/shared/filters";
import { printWithImages } from "@/lib/print";
import { useResponsavelFilter, SENTINEL_UUID } from "@/hooks/useResponsavelFilter";
import { OcTecidoForm } from "@/components/oc-tecido/OcTecidoForm";
import { OcTecidoRecebimento } from "@/components/oc-tecido/OcTecidoRecebimento";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { OcModalShell } from "@/components/shared/OcModalShell";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { useModoOcRolo } from "@/hooks/useModoOcRolo";
import {
  emptyDraft, uploadFile, fmtDate, fmtMoney, labelVariante, metragemPedidaItem, precoItem,
  type Artigo, type Colab, type Draft, type Empresa, type ItemDraft,
  type OC, type OCItem, type OCStatus, type OcTecidoTab, type RoloEntry, type Variante,
} from "@/components/oc-tecido/shared";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/entrada-saida/oc-tecido")({
  // Aba endereçável: a Home aponta "OCs atrasadas" direto p/ ?tab=encomendado — sem isso o
  // clique pousava na aba "Recebidos", onde a OC atrasada é invisível (laudo do time, jul/2026).
  validateSearch: (s: Record<string, unknown>): { tab?: OcTecidoTab } => ({
    tab: s.tab === "encomendado" || s.tab === "recebido" || s.tab === "estoque" || s.tab === "rolos" ? (s.tab as OcTecidoTab) : undefined,
  }),
  component: () => (
    <RequirePermission page="entrada_oc_tecido">
      <OcTecidoPage />
    </RequirePermission>
  ),
});

function OcTecidoPage() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  // Navegação de 1 NÍVEL (redesign ago/2026): Rolos virou ABA (o toggle OCs/Rolos + abas
  // formava "2 estoques" — laudo das 3 lentes). ?tab=rolos é endereçável.
  const [openRolo, setOpenRolo] = useState(false);
  const [openRemover, setOpenRemover] = useState(false);
  const [tab, setTab] = useState<OcTecidoTab>(search.tab ?? "recebido");
  const [busca, setBusca] = useState("");
  // Estado da aba Estoque (consulta + filtros) — controles vão p/ o header (contextual).
  const estoque = useEstoqueTecidos(tab === "estoque");
  const [filterEmpresa, setFilterEmpresa] = useState<string>("all");
  const respF = useResponsavelFilter();
  const [filterAlerta, setFilterAlerta] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OC | null>(null);

  const { data: ocs = [] } = useQuery({
    queryKey: ["ocs_tecido", tab, filterEmpresa, respF.tipo, respF.pessoaId, filterAlerta],
    enabled: tab !== "estoque" && tab !== "rolos", // essas abas não listam OCs
    queryFn: async () => {
      // Recebidos trazem o status de alerta dos itens (p/ badge na lista + filtro).
      const sel = tab === "recebido" ? "*, ocs_tecido_itens!oc_tecido_id(cq_alerta_status)" : "*";
      let q = supabase.from("ocs_tecido").select(sel).eq("status", tab as OCStatus).eq("is_rolo" as never, false as never).order("created_at", { ascending: false });
      if (filterEmpresa !== "all") q = q.eq("empresa_id", filterEmpresa);
      if (respF.idsFiltro) q = q.in("responsavel_id", respF.idsFiltro.length ? respF.idsFiltro : [SENTINEL_UUID]);
      const { data, error } = await q;
      if (error) throw error;
      let rows = (data ?? []) as any[];
      if (tab === "recebido" && filterAlerta !== "all")
        rows = rows.filter((oc) => (oc.ocs_tecido_itens ?? []).some((it: any) => it.cq_alerta_status === filterAlerta));
      return rows as unknown as OC[];
    },
  });

  // Badge de alerta por OC (na lista de Recebidos), pro operador ver sem abrir.
  const alertaBadgeByOc = useMemo(() => {
    const m: Record<string, { label: string; cls: string } | null> = {};
    for (const oc of ocs as any[]) {
      m[oc.id] = alertaBadge((oc.ocs_tecido_itens ?? []).map((it: any) => it.cq_alerta_status));
    }
    return m;
  }, [ocs]);

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options", "tecido-forro-entretela"],
    staleTime: 5 * 60 * 1000, // dados de referência: não revalidar a cada abertura
    queryFn: async () => {
      // Fornecedores de material + representantes + categorias; casa por TOKEN flexível
      // no cliente (o nome da categoria varia por loja — ver @/lib/fornecedor-categoria).
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome_fantasia, representantes(id, nome), empresa_categorias_fornecedor(categorias_fornecedor(nome))")
        .eq("tipo", "material")
        .order("nome_fantasia");
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((e) => empresaTemCategoria(e, FABRIC_TOKENS))
        .map((e) => ({ id: e.id as string, nome_fantasia: e.nome_fantasia as string, representantes: e.representantes ?? [] })) as Empresa[];
    },
  });

  const empresaMap = useMemo(() => Object.fromEntries(empresas.map((e) => [e.id, e.nome_fantasia])), [empresas]);

  const deleteMut = useMutation({
    mutationFn: async (oc: OC) => {
      // Via RPC com guarda (excluir_oc_tecido): o `.delete()` cru cascateava ocs_tecido_itens →
      // estoque_tecido_baixas (LEDGER), modelo_tecido_oc_links (vínculos de Dev) e enderecamento,
      // apagando tudo em silêncio. A RPC bloqueia OC em uso (invariantes #5 + #9).
      const { error } = await supabase.rpc("excluir_oc_tecido" as any, { _oc_id: oc.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OC excluída.");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  const ocIds = useMemo(() => ocs.map((o) => o.id), [ocs]);

  // Tecido(s) de cada OC (p/ a coluna "Tecido(s)" da lista, nas duas abas). Lista os
  // artigos DISTINTOS dos itens da OC, na ordem em que aparecem.
  const { data: tecidosByOc = {} } = useQuery({
    queryKey: ["ocs_tecido_artigos", ocIds],
    enabled: ocIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_tecido_itens")
        .select("oc_tecido_id, artigo_id, artigos:artigo_id(nome)")
        .in("oc_tecido_id", ocIds);
      if (error) throw error;
      const byOc: Record<string, string[]> = {};
      for (const it of (data ?? []) as any[]) {
        const nome = it.artigos?.nome as string | undefined;
        if (!it.oc_tecido_id || !nome) continue;
        const arr = (byOc[it.oc_tecido_id] ||= []);
        if (!arr.includes(nome)) arr.push(nome);
      }
      const out: Record<string, string> = {};
      for (const [id, nomes] of Object.entries(byOc)) out[id] = nomes.join(", ");
      return out;
    },
  });

  const { data: qtdRecebidaByOc = {} } = useQuery({
    queryKey: ["ocs_tecido_qtd_recebida", ocIds],
    enabled: tab === "recebido" && ocIds.length > 0,
    queryFn: async () => {
      const { data: items, error } = await supabase
        .from("ocs_tecido_itens")
        .select("oc_tecido_id, artigo_id, quantidade_recebida")
        .in("oc_tecido_id", ocIds);
      if (error) throw error;
      const artIds = Array.from(new Set((items ?? []).map((i) => i.artigo_id).filter(Boolean))) as string[];
      const artRes = artIds.length
        ? await supabase.from("artigos").select("id, unidade_medida").in("id", artIds)
        : { data: [] as { id: string; unidade_medida: string | null }[], error: null };
      if (artRes.error) throw artRes.error;
      const unidadeById = Object.fromEntries((artRes.data ?? []).map((a) => [a.id, a.unidade_medida ?? ""]));
      const sums: Record<string, Record<string, number>> = {};
      for (const it of items ?? []) {
        if (!it.oc_tecido_id || it.quantidade_recebida == null) continue;
        const unidade = (it.artigo_id ? unidadeById[it.artigo_id] : "") || "—";
        const sufixo = unidade === "kg" ? "kg" : unidade === "metro" ? "m" : "";
        const key = sufixo || "—";
        sums[it.oc_tecido_id] ||= {};
        sums[it.oc_tecido_id][key] = (sums[it.oc_tecido_id][key] ?? 0) + Number(it.quantidade_recebida ?? 0);
      }
      const out: Record<string, string> = {};
      for (const [ocId, parts] of Object.entries(sums)) {
        out[ocId] = Object.entries(parts)
          .map(([u, v]) => `${fmtNum(v)}${u !== "—" ? ` ${u}` : ""}`)
          .join(" + ");
      }
      return out;
    },
  });

  // Contagem das abas (Encomendadas/Recebidas/Rolos) — head:true não baixa linhas.
  const { data: tabCounts } = useQuery({
    queryKey: ["ocs_tecido", "tab-counts"],
    queryFn: async () => {
      const [enc, rec, rol] = await Promise.all([
        supabase.from("ocs_tecido").select("id", { count: "exact", head: true }).eq("status", "encomendado").eq("is_rolo" as never, false as never),
        supabase.from("ocs_tecido").select("id", { count: "exact", head: true }).eq("status", "recebido").eq("is_rolo" as never, false as never),
        supabase.from("ocs_tecido").select("id", { count: "exact", head: true }).eq("is_rolo" as never, true as never),
      ]);
      return { encomendado: enc.count ?? 0, recebido: rec.count ?? 0, rolos: rol.count ?? 0 };
    },
  });

  // Busca por nº, fornecedor ou tecido (não existia — laudo). Client-side, sem acento.
  const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const ocsFiltradas = useMemo(() => {
    const q = semAcento(busca.trim());
    if (!q) return ocs;
    return ocs.filter((o) =>
      semAcento(`${o.numero_pedido ?? ""} ${o.empresa_id ? empresaMap[o.empresa_id] ?? "" : ""} ${tecidosByOc?.[o.id] ?? ""}`).includes(q),
    );
  }, [ocs, busca, empresaMap, tecidosByOc]);

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Scissors className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">OC de Tecido</h1>
            {/* Subtítulo contextual: explica p/ que serve cada aba (um usuário não entendeu Rolos). */}
            <p className="text-sm text-muted-foreground mt-1">
              {tab === "rolos"
                ? "Estoque físico de rolos de tecido: cadastre rolos para ajustar seu inventário ou separe um rolo de uma OC."
                : "Ordens de compra de tecidos."}
            </p>
          </div>
        </div>
        {/* Ações CONTEXTUAIS por aba (redesign): abas de OC = busca + filtros + Nova OC;
            aba Rolos = − Metragem + Novo Rolo. O toggle OCs/Rolos foi absorvido pelas abas. */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {tab === "estoque" && (
            <>
              <SearchToggle value={estoque.search} onChange={estoque.setSearch} placeholder="Tecido ou variante" />
              <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => printWithImages()}>
                <Printer className="h-4 w-4 mr-1" /> Imprimir
              </Button>
              <FilterButton filters={estoque.filtros} />
            </>
          )}
          {(tab === "encomendado" || tab === "recebido") && (
            <>
              <SearchToggle value={busca} onChange={setBusca} placeholder="Nº, fornecedor ou tecido" />
              <FilterButton
                filters={[
                  { label: "Fornecedor", value: filterEmpresa, onChange: setFilterEmpresa, options: [{ id: "all", nome: "Todos" }, ...empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }))] },
                  ...(tab === "encomendado" ? respF.filters : []),
                  ...(tab === "recebido"
                    ? [{ label: "Alerta", value: filterAlerta, onChange: setFilterAlerta, options: [
                        { id: "all", nome: "Todos" },
                        { id: "alertado", nome: "Alerta estilo" },
                        { id: "troca_pendente", nome: "Troca pendente" },
                        { id: "trocado", nome: "Trocado" },
                        { id: "estilo_ok", nome: "Estilo OK" },
                        { id: "cancelado", nome: "Cancelado" },
                      ] }]
                    : []),
                ]}
              />
            </>
          )}
          {tab !== "rolos" && (
            <Button className="max-sm:hidden" onClick={() => { setEditingId(null); setOpenNew(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Nova OC
            </Button>
          )}
          {tab === "rolos" && (
            <>
              <Button className="max-sm:hidden" variant="outline" onClick={() => setOpenRemover(true)}>
                <Minus className="h-4 w-4 mr-1" /> Metragem
              </Button>
              <Button className="max-sm:hidden" onClick={() => setOpenRolo(true)}>
                <Plus className="h-4 w-4 mr-1" /> Novo Rolo
              </Button>
            </>
          )}
        </div>
      </header>

      <OcTecidoList
        tab={tab}
        setTab={setTab}
        ocs={ocsFiltradas}
        tabCounts={tabCounts}
        empresaMap={empresaMap}
        onRowClick={(id) => { setEditingId(id); setOpenNew(true); }}
        onDelete={(oc) => setDeleting(oc)}
        qtdRecebidaByOc={qtdRecebidaByOc}
        tecidosByOc={tecidosByOc}
        alertaBadgeByOc={alertaBadgeByOc}
        estoque={estoque}
        rolosSlot={
          <div className="space-y-6">
            <RolosList />
            <AjustesList />
          </div>
        }
      />

      {openRolo && (
        <RoloDialog onClose={() => setOpenRolo(false)} onSaved={() => {}} />
      )}

      {openRemover && (
        <RemoverMetragemDialog onClose={() => setOpenRemover(false)} />
      )}

      {openNew && (
        <OcDialog
          ocId={editingId}
          empresas={empresas}
          onClose={() => { setOpenNew(false); setEditingId(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["ocs_tecido"] }); }}
          onDelete={() => {
            const oc = ocs.find((o) => o.id === editingId);
            if (oc) { setOpenNew(false); setEditingId(null); setDeleting(oc); }
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir OC?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. A OC "{deleting?.numero_pedido || "sem número"}" e seus itens serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleting && deleteMut.mutate(deleting)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MobileActionBar>
        {tab !== "rolos" && (
          <Button className="ml-auto" onClick={() => { setEditingId(null); setOpenNew(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nova OC
          </Button>
        )}
        {tab === "rolos" && (
          <>
            <Button variant="outline" onClick={() => setOpenRemover(true)}>
              <Minus className="h-4 w-4 mr-1" /> Metragem
            </Button>
            <Button className="ml-auto" onClick={() => setOpenRolo(true)}>
              <Plus className="h-4 w-4 mr-1" /> Novo Rolo
            </Button>
          </>
        )}
      </MobileActionBar>
    </div>
  );
}

// Colab (spec 2026-08-03): mapeamento OC-crua → Draft/ItemDraft extraído como função
// PURA (era feito inline dentro do queryFn) para servir tanto a semeadura (1ª carga)
// quanto o "fresh" do merge 3-vias (refetch/Realtime) — mesma forma, sem duplicar regra.
function draftFromOc(oc: any): Draft {
  return {
    numero_pedido: oc.numero_pedido ?? "",
    responsavel_id: oc.responsavel_id,
    responsavel_nome: oc.responsavel_nome ?? "",
    empresa_id: oc.empresa_id,
    representante_id: (oc as any).representante_id ?? null,
    data_pedido: oc.data_pedido ?? "",
    data_prevista_entrega: oc.data_prevista_entrega ?? "",
    prazo_pagamento: oc.prazo_pagamento ?? "",
    quantidade_prazos: oc.quantidade_prazos ?? 1,
    observacoes_entrega: oc.observacoes_entrega ?? "",
    observacoes_defeitos: oc.observacoes_defeitos ?? "",
    data_entrega: oc.data_entrega ?? "",
    anexo_pedido_url: oc.anexo_pedido_url,
    modelo_sugerido_url: oc.modelo_sugerido_url,
    nf_url: oc.nf_url,
    nfs: (((oc as any).nfs ?? []) as { url: string; data?: string }[]),
    parcelas_recebimento: (Array.isArray((oc as any).parcelas_recebimento) && (oc as any).parcelas_recebimento.length > 0)
      ? ((oc as any).parcelas_recebimento as { data: string; recebido: boolean }[])
      : [{ data: "", recebido: false }],
  };
}
// Colab round 4 — rótulos PT dos paths do Draft para o banner de resolução genérica de
// conflito. O merge compara TODAS as chaves do Draft, então qualquer campo pode conflitar
// (inclusive os SEM UI inline). Path sem rótulo → mostra o próprio path (fallback).
const ROTULO_CONFLITO: Record<string, string> = {
  numero_pedido: "Número do Pedido",
  empresa_id: "Fornecedor",
  representante_id: "Representante",
  responsavel_id: "Responsável",
  responsavel_nome: "Responsável",
  data_pedido: "Data do Pedido",
  data_prevista_entrega: "Data Prevista de Entrega",
  prazo_pagamento: "Prazo de Pagamento",
  quantidade_prazos: "Qtd. de prazos",
  observacoes_entrega: "Obs. de entrega",
  observacoes_defeitos: "Obs. de defeitos",
  data_entrega: "Data de entrega",
  anexo_pedido_url: "Anexo do pedido",
  modelo_sugerido_url: "Modelo sugerido",
  nf_url: "Nota fiscal",
  nfs: "Notas fiscais",
  parcelas_recebimento: "Parcelas de recebimento",
};
function rotuloConflito(path: string): string {
  if (path.startsWith("linha:")) return "Item (variante)";
  return ROTULO_CONFLITO[path] ?? path;
}

function itemsFromRows(its: unknown): ItemDraft[] {
  return ((its ?? []) as unknown as OCItem[]).map((i) => ({
    tempId: i.id,
    id: i.id,
    artigo_numero: (i.artigo_numero === 2 ? 2 : 1) as 1 | 2,
    artigo_id: i.artigo_id,
    variante_tecido_id: i.variante_tecido_id ?? "",
    quantidade_pedida: Number(i.quantidade_pedida ?? 0),
    quantidade_recebida: i.quantidade_recebida == null ? null : Number(i.quantidade_recebida),
    rendimento: (i as any).rendimento == null ? null : Number((i as any).rendimento),
    cancelado: !!(i as any).cancelado,
    preco: (i as any).preco == null ? null : Number((i as any).preco),
  }));
}

// Data-base do recebimento: a ÚLTIMA data das parcelas de entrega (fallback
// data_entrega do draft) — regra ÚNICA usada pelo save E pelo preview de parcelas.
function ultimaDataEntrega(draft: Draft): string {
  const parcelas = draft.parcelas_recebimento ?? [];
  return parcelas.length > 0
    ? [...parcelas].map((p) => p.data).filter(Boolean).sort().slice(-1)[0] ?? draft.data_entrega
    : draft.data_entrega;
}

type ParcelaPrevistaRow = { numero: number; vencimento: string; valor: number; paga: boolean };
// Preview das parcelas a pagar geradas ao marcar recebido — ESPELHO da regra do servidor
// (gerar_parcelas_oc_tecido / recalcular_parcelas, migração 20260619440000):
// dias = todos os números do prazo_pagamento; n = len(dias) (cap 24) ou quantidade_prazos;
// vencimento_i = base + dias[i] (fallback base + i*30), base = data de entrega (senão hoje);
// cota = round2(restante ÷ nº livres) e a ÚLTIMA a inserir absorve o resto do arredondamento;
// parcelas PAGAS são preservadas e o restante = total − Σ pagas só preenche os números livres.
function previewParcelas({
  prazoPagamento, quantidadePrazos, baseDataISO, totalReal, pagas,
}: {
  prazoPagamento: string;
  quantidadePrazos: number;
  baseDataISO: string;
  totalReal: number;
  pagas: { numero_parcela: number | null; valor: number | null; data_vencimento: string | null }[];
}): { rows: ParcelaPrevistaRow[]; geraNovas: boolean; pagoTotal: number } {
  const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
  const dias = (prazoPagamento ?? "").split(/[^0-9]+/).filter((t) => /^[0-9]+$/.test(t)).map(Number);
  const nParcelas = dias.length >= 1 ? Math.min(dias.length, 24) : Math.max(quantidadePrazos || 1, 1);
  const pagoTotal = round2(pagas.reduce((s, p) => s + Number(p.valor ?? 0), 0));
  const pagasByNumero = new Map(pagas.filter((p) => p.numero_parcela != null).map((p) => [p.numero_parcela as number, p]));
  const base = baseDataISO ? parseISO(baseDataISO) : new Date();
  const livres: number[] = [];
  for (let i = 1; i <= nParcelas; i++) if (!pagasByNumero.has(i)) livres.push(i);
  const restante = round2(totalReal - pagoTotal);
  const geraNovas = totalReal > 0 && restante > 0 && livres.length > 0;
  const cota = geraNovas ? round2(restante / livres.length) : 0;
  const rows: ParcelaPrevistaRow[] = [];
  let idx = 0;
  for (let i = 1; i <= nParcelas; i++) {
    const paga = pagasByNumero.get(i);
    if (paga) {
      rows.push({ numero: i, vencimento: paga.data_vencimento ?? "", valor: Number(paga.valor ?? 0), paga: true });
      continue;
    }
    if (!geraNovas) continue;
    idx += 1;
    const venc = addDays(base, dias[i - 1] ?? i * 30);
    const valor = idx === livres.length ? round2(restante - cota * (livres.length - 1)) : cota;
    rows.push({ numero: i, vencimento: formatDate(venc, "yyyy-MM-dd"), valor, paga: false });
  }
  // Pagas com número acima de n (prazo encurtou depois) continuam existindo — mostra também.
  for (const p of pagas) {
    const n = p.numero_parcela ?? 0;
    if (n > nParcelas) rows.push({ numero: n, vencimento: p.data_vencimento ?? "", valor: Number(p.valor ?? 0), paga: true });
  }
  rows.sort((a, b) => a.numero - b.numero);
  return { rows, geraNovas, pagoTotal };
}

// Confirmação "Marcar como recebido?" com PREVIEW das parcelas a pagar (antes de
// gerar o financeiro). Só o Confirmar dispara o fluxo real de marcar recebido.
function ConfirmarRecebimentoDialog({
  ocId, prazoPagamento, quantidadePrazos, baseDataISO, totalReal, pending, onCancel, onConfirm,
}: {
  ocId: string | null;
  prazoPagamento: string;
  quantidadePrazos: number;
  baseDataISO: string;
  totalReal: number;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Parcelas JÁ PAGAS da OC (sobrevivem ao desmarcar-recebido): o servidor as
  // preserva e redistribui só o restante — o preview espelha isso.
  const { data: pagas = [] } = useQuery({
    queryKey: ["oc-tecido-parcelas-pagas", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parcelas")
        .select("numero_parcela, valor, data_vencimento")
        .eq("oc_tecido_id", ocId!)
        .or("status.eq.pago,data_pagamento.not.is.null")
        .order("numero_parcela");
      if (error) throw error;
      return (data ?? []) as { numero_parcela: number | null; valor: number | null; data_vencimento: string | null }[];
    },
  });
  const { rows, pagoTotal } = previewParcelas({ prazoPagamento, quantidadePrazos, baseDataISO, totalReal, pagas });
  const total = rows.reduce((s, r) => s + r.valor, 0);
  return (
    <AlertDialog open onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Marcar como recebido?</AlertDialogTitle>
          <AlertDialogDescription>
            Isto registra a entrada e gera as contas a pagar no Financeiro conforme o prazo{" "}
            <b>{prazoPagamento || "—"}</b>.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {rows.length > 0 ? (
          <div className="max-h-64 overflow-y-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Parcela</th>
                  <th className="px-3 py-2 font-medium">Vencimento</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.numero} className="border-b last:border-0">
                    <td className="px-3 py-1.5 tabular-nums">{r.numero}/{rows.length}{r.paga ? " · paga" : ""}</td>
                    <td className="px-3 py-1.5 tabular-nums">{fmtDate(r.vencimento)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.valor)}</td>
                  </tr>
                ))}
                <tr className="bg-muted/40 font-semibold">
                  <td className="px-3 py-2" colSpan={2}>Total real</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtMoney(total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma parcela será gerada (OC sem valor real a pagar).</p>
        )}
        {pagoTotal > 0 && (
          <p className="text-xs text-muted-foreground">
            Parcelas já pagas ({fmtMoney(pagoTotal)}) são preservadas; o restante é redistribuído.
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            Confirmar recebimento
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Trilho de âncoras do form (só sm:+): 5 seções numeradas; itens travados (criação)
// mostram cadeado e não clicam.
type SecaoOc = { id: string; n: number; label: string; locked?: boolean };
function OcAnchorRail({ secoes, ativa, onIr }: { secoes: SecaoOc[]; ativa: string; onIr: (id: string) => void }) {
  return (
    <nav aria-label="Seções da OC" className="hidden w-40 shrink-0 flex-col gap-1 self-start sm:flex">
      {secoes.map((s) =>
        s.locked ? (
          <span
            key={s.id}
            title="Disponível após salvar"
            className="flex cursor-not-allowed select-none items-center gap-1.5 rounded-md px-3 py-2 text-sm text-muted-foreground/60"
          >
            <span className="tabular-nums">{s.n} ·</span> {s.label}
            <Lock className="ml-auto h-3.5 w-3.5" />
          </span>
        ) : (
          <button
            key={s.id}
            type="button"
            onClick={() => onIr(s.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
              ativa === s.id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground",
            )}
          >
            <span className="tabular-nums">{s.n} ·</span> {s.label}
          </button>
        ),
      )}
    </nav>
  );
}

function OcDialog({
  ocId, empresas, onClose, onSaved, onDelete,
}: {
  ocId: string | null;
  empresas: Empresa[];
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const isEdit = !!ocId;
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [originalItemIds, setOriginalItemIds] = useState<string[]>([]);
  const [status, setStatus] = useState<OCStatus>("encomendado");
  // Modo só-rolo: o recebimento é destrinchado em rolos (gera os rolos ao receber).
  const modoOcRolo = useModoOcRolo();
  const [rolosPorItem, setRolosPorItem] = useState<Record<string, RoloEntry[]>>({});
  const [tecido2Aberto, setTecido2Aberto] = useState(false);
  const [confirmUnmark, setConfirmUnmark] = useState(false);
  // Confirmação c/ preview de parcelas antes de marcar recebido (redesign ago/2026).
  const [confirmReceber, setConfirmReceber] = useState(false);
  // Confirmação da CASCATA de desmarcar variante (remove também as seguintes).
  const [confirmDesmarcar, setConfirmDesmarcar] = useState<{ n: 1 | 2; varId: string; afetadas: string[] } | null>(null);
  // Trilho de âncoras: seção ativa (scroll-spy simples no container de scroll).
  const [secAtiva, setSecAtiva] = useState("oc-sec-pedido");
  // Dispensa a etiqueta de lavagem POR TECIDO (keyed por artigo_id) no recebimento —
  // cada artigo da OC pode ter, ou não, etiqueta de lavagem.
  const [semEtiquetaPorArtigo, setSemEtiquetaPorArtigo] = useState<Record<string, boolean>>({});

  // Guarda de "alterações não salvas": compara o rascunho editável (cabeçalho + itens)
  // com um baseline. Re-baseline ao semear a OC (query async) e após salvar (markClean).
  const { dirty: changed, markClean, reset: resetBaseline } = useDirtySnapshot({ draft, items });

  // Colab (spec 2026-08-03) — piloto: rastreio do que EU editei (touched), o último
  // "fresh" visto do servidor (baseRef) e o rev otimista da OC (revRef), pra fazer
  // merge 3-vias no refetch/Realtime em vez de sobrescrever o rascunho às cegas.
  const touchedRef = useRef<Set<string>>(new Set());
  const touchedItemIdsRef = useRef<Set<string>>(new Set());
  const baseRef = useRef<{ draft: Draft; items: ItemDraft[] } | null>(null);
  const revRef = useRef<number | null>(null);
  const retryRef = useRef(false);
  // Guarda anti-duplo-clique do save: o ref é SÍNCRONO (isPending/disabled só atualizam no
  // re-render, então num clique-duplo rápido os dois passariam — e no INSERT criariam 2 OCs).
  // Declarado aqui (antes do `saveMutation`) porque o `onError` do retry P0409 também o usa.
  const savingRef = useRef(false);
  const [ultimoMerge, setUltimoMerge] = useState<{ atualizados: number; conflitos: Conflito[] } | null>(null);
  const [conflitos, setConflitos] = useState<Conflito[]>([]);
  // Espelho síncrono de `conflitos` p/ o retry do save (Step 5): ler `conflitos` (state)
  // logo após `await invalidateQueries(...)` arriscaria uma closure velha; o ref é sempre atual.
  const conflitosRef = useRef<Conflito[]>([]);
  const [campoFocado, setCampoFocado] = useState<string | null>(null);

  // Espelhos SEMPRE atualizados (toda render) de `draft`/`items` — o merge dentro do
  // `onError` do save (P0409, abaixo) roda depois de um `await` (janela de ~100-500ms em
  // que os campos NÃO ficam disabled). Se o merge lesse `draft`/`items` da closure do
  // clique em Salvar, uma tecla digitada durante essa janela entraria no state React mas
  // seria descartada em silêncio pelo `setDraft(md.valor)` estático — exatamente o que o
  // merge 3-vias deveria impedir. Ler o ref IMEDIATAMENTE antes do merge (bloco síncrono,
  // sem `await` no meio) garante que nenhuma tecla se perde.
  const draftLiveRef = useRef(draft);
  draftLiveRef.current = draft;
  const itemsLiveRef = useRef(items);
  itemsLiveRef.current = items;

  // Wrappers que DIFEREM prev→next e marcam o que mudou — os filhos continuam recebendo
  // a mesma assinatura (`typeof setDraft`/`typeof setItems`), zero mudança neles.
  const setDraftTracked: typeof setDraft = (upd) =>
    setDraft((prev) => {
      const next = typeof upd === "function" ? (upd as (p: Draft) => Draft)(prev) : upd;
      for (const k of Object.keys(next) as (keyof Draft)[])
        if (next[k] !== prev[k]) touchedRef.current.add(String(k));
      return next;
    });
  const setItemsTracked: typeof setItems = (upd) =>
    setItems((prev) => {
      const next = typeof upd === "function" ? (upd as (p: ItemDraft[]) => ItemDraft[])(prev) : upd;
      for (const n of next) {
        const p = prev.find((x) => x.id && x.id === n.id);
        if (n.id && (!p || JSON.stringify(p) !== JSON.stringify(n))) touchedItemIdsRef.current.add(n.id);
      }
      return next;
    });

  // Resolve um conflito de campo (cabeçalho) ou de linha (item): "usar o novo" aplica
  // `dele` no rascunho (linha ausente no servidor = item foi removido) e tira o campo/id
  // do `touched` (senão o próximo merge o trataria como editado por mim de novo); "manter
  // meu" só descarta o aviso — o valor local prevalece e SEGUE touched (será salvo).
  // Usa os setters CRUS (não os Tracked): a resolução já sabe exatamente o que aconteceu,
  // não precisa do heurístico de diff (que rodaria numa ordem não-determinística aqui).
  const resolverConflito = (c: Conflito, useDele: boolean) => {
    if (c.path.startsWith("linha:")) {
      const id = c.path.slice("linha:".length);
      if (useDele) {
        setItems((prev) => c.dele
          ? prev.map((it) => (it.id === id ? (c.dele as ItemDraft) : it))
          : prev.filter((it) => it.id !== id));
        touchedItemIdsRef.current.delete(id);
      }
    } else if (useDele) {
      setDraft((d) => ({ ...d, [c.path]: c.dele }));
      touchedRef.current.delete(c.path);
    }
    // `conflitosRef` é a fonte usada pelo retry do save (fora do ciclo de render) — precisa
    // ficar em sincronia com `conflitos` (state) em TODA atualização, não só na do merge.
    setConflitos((prev) => {
      const next = prev.filter((x) => x.path !== c.path);
      conflitosRef.current = next;
      return next;
    });
    // Cosmético (QA Task 7): o banner (`ultimoMerge`) mostrava a contagem de conflitos de
    // quando o merge rodou, sem refletir a resolução manual — o usuário resolvia um
    // conflito e o banner continuava dizendo "N em conflito" com N desatualizado.
    setUltimoMerge((prev) => {
      if (!prev) return prev;
      const conflitosRestantes = prev.conflitos.filter((x) => x.path !== c.path);
      if (conflitosRestantes.length === 0 && prev.atualizados === 0) return null;
      return { ...prev, conflitos: conflitosRestantes };
    });
  };
  // Resolução GENÉRICA a partir do banner (round 4): o banner só conhece o `path`; aqui
  // achamos o Conflito e delegamos ao mesmo `resolverConflito` da UI inline. Todo conflito
  // — inclusive em campos SEM UI própria (Fornecedor, Obs., parcelas…) — tem esta saída,
  // então o guard do save nunca deadlocka.
  const resolverPorPath = (path: string, escolha: "meu" | "dele") => {
    const c = conflitos.find((x) => x.path === path);
    if (c) resolverConflito(c, escolha === "dele");
  };

  const { presentes } = useColabRegistro({
    canal: ocId ? `colab:oc:${ocId}` : null,
    tabela: "ocs_tecido",
    registroId: ocId ?? null,
    onMudancaServidor: () => qc.invalidateQueries({ queryKey: ["oc-tecido", ocId] }),
    campoFocado,
  });
  const emConflito = (path: string) => conflitos.some((c) => c.path === path);
  const conflitoDe = (path: string) => conflitos.find((c) => c.path === path);
  const focadoPor = (path: string) => presentes.find((p) => p.campoFocado === path)?.nome;
  const conflitoLinha = (id: string | undefined) => (id ? conflitos.find((c) => c.path === `linha:${id}`) : undefined);

  const { data: ocQueryData } = useQuery({
    queryKey: ["oc-tecido", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      if (!ocId) return null;
      const { data: oc, error: e1 } = await supabase.from("ocs_tecido").select("*").eq("id", ocId).maybeSingle();
      if (e1) throw e1;
      const { data: its, error: e2 } = await supabase.from("ocs_tecido_itens").select("*").eq("oc_tecido_id", ocId);
      if (e2) throw e2;
      if (!oc) return { oc: null, its: its ?? [], items: [] as ItemDraft[], rolosPorItem: {} as Record<string, RoloEntry[]>, tecido2Aberto: false };

      const mapped = itemsFromRows(its);
      // Itens finais (após eventual recomputo por rolo abaixo) — vira o "fresh" do merge.
      let finalItems: ItemDraft[] = mapped;
      let rolosPorItem: Record<string, RoloEntry[]> = {};

      // Modo Só Rolo + OC recebida: recarrega o destrinchamento por rolo (cada rolo
      // é um ocs_tecido is_rolo vinculado por rolo_origem_item_id), com código e CQ,
      // p/ mostrar destrinchado (não o valor agregado) e permitir editar o CQ por rolo.
      if (modoOcRolo !== "oc" && oc.status === "recebido") {
        const itemIds = mapped.map((m) => m.id).filter((x): x is string => !!x);
        if (itemIds.length > 0) {
          const { data: rolosData } = await supabase
            .from("ocs_tecido")
            .select("id, rolo_codigo, rolo_origem_item_id, ocs_tecido_itens(id, quantidade_recebida, cancelado, cq_ok, cq_alerta_status, cq_observacao, estoque_tecido_baixas(quantidade), modelo_tecido_oc_links(id))")
            .eq("is_rolo" as never, true as never)
            .in("rolo_origem_item_id", itemIds)
            .order("rolo_codigo");
          const byOrigem: Record<string, RoloEntry[]> = {};
          for (const r of (rolosData ?? []) as any[]) {
            const it0 = (r.ocs_tecido_itens ?? [])[0];
            const key = r.rolo_origem_item_id as string;
            (byOrigem[key] = byOrigem[key] ?? []).push({
              qtd: it0?.quantidade_recebida != null ? String(it0.quantidade_recebida) : "",
              codigo: r.rolo_codigo,
              roloId: r.id,
              roloItemId: it0?.id,
              cq_ok: !!it0?.cq_ok,
              cq_alerta: (it0?.cq_alerta_status ?? "sem_alerta") === "alertado",
              cqStatus: it0?.cq_alerta_status ?? "sem_alerta",
              cancelado: !!it0?.cancelado,
              // "Em uso" = consumido no corte (baixa) OU selecionado em Desenvolvimento
              // (vínculo modelo_tecido_oc_links). Qualquer um dos dois trava edição.
              usado:
                ((it0?.estoque_tecido_baixas ?? []) as any[]).length > 0 ||
                ((it0?.modelo_tecido_oc_links ?? []) as any[]).length > 0,
              obs: it0?.cq_observacao ?? "",
            });
          }
          rolosPorItem = byOrigem;
        }
      } else if (modoOcRolo !== "oc") {
        // Encomendado: reconstrói o destrinchamento PLANEJADO salvo em rolos_planejados
        // (sem isso, salvar e reabrir o encomendado perdia os rolos digitados).
        const planned: Record<string, RoloEntry[]> = {};
        const recebidaByItem: Record<string, number> = {};
        for (const it of (its ?? []) as any[]) {
          const rp = (it as any).rolos_planejados;
          if (Array.isArray(rp) && rp.length > 0) {
            planned[it.id] = rp.map((r: any) => ({
              qtd: r?.qtd != null ? String(r.qtd) : (typeof r === "number" ? String(r) : ""),
              obs: r?.obs ?? "",
              cq_ok: !!r?.cq_ok,
              cq_alerta: !!r?.cq_alerta,
            }));
            const soma = rp.reduce((s: number, r: any) => s + (Number(r?.qtd) || 0), 0);
            if (soma > 0) recebidaByItem[it.id] = Math.round(soma * 100) / 100;
          }
        }
        if (Object.keys(planned).length > 0) {
          rolosPorItem = planned;
          // Recomputa a quantidade recebida do item a partir do planejamento (mantém
          // a validação de "marcar recebido" coerente ao reabrir).
          finalItems = mapped.map((i) => (i.id && recebidaByItem[i.id] != null) ? { ...i, quantidade_recebida: recebidaByItem[i.id] } : i);
        }
      }
      return {
        oc, its: its ?? [],
        items: finalItems,
        rolosPorItem,
        tecido2Aberto: mapped.some((m) => m.artigo_numero === 2),
      };
    },
  });

  // Colab (spec 2026-08-03): 1ª carga semeia como sempre; refetch (Realtime/foco de
  // janela) faz MERGE 3-vias em vez de sobrescrever o rascunho às cegas — sem isso, um
  // refetch descartava silenciosamente a edição em andamento do usuário (bug latente).
  useEffect(() => {
    if (!ocQueryData?.oc) return;
    const freshDraft = draftFromOc(ocQueryData.oc);
    const freshItems = ocQueryData.items;
    revRef.current = (ocQueryData.oc as any).rev ?? null;

    if (!baseRef.current) {
      // 1ª carga: seed normal (mesmo comportamento de antes do piloto).
      baseRef.current = { draft: freshDraft, items: freshItems };
      setDraft(freshDraft);
      setItems(freshItems);
      setStatus((ocQueryData.oc.status as OCStatus) ?? "encomendado");
      setOriginalItemIds(freshItems.map((m) => m.id).filter((x): x is string => !!x));
      if (ocQueryData.tecido2Aberto) setTecido2Aberto(true);
      if (Object.keys(ocQueryData.rolosPorItem).length > 0) setRolosPorItem(ocQueryData.rolosPorItem);
      touchedRef.current = new Set();
      touchedItemIdsRef.current = new Set();
      conflitosRef.current = [];
      setConflitos([]);
      // Re-baseline no MESMO tick com os valores semeados (o estado recém-setado ainda
      // está stale aqui). Assim uma OC recém-aberta não aparece como "não salva".
      resetBaseline({ draft: freshDraft, items: freshItems });
      return;
    }

    // Refetch: MERGE em vez de sobrescrever. Só re-seta draft/items quando algo de fato
    // mudou (atualizado ou em conflito) — evita churn de identidade que marcaria "dirty"
    // à toa quando o merge não alterou nada visível.
    const md = mergeDraft({ base: baseRef.current.draft, draft, fresh: freshDraft, touched: touchedRef.current });
    const ml = mergeLinhas({ base: baseRef.current.items, draft: items, fresh: freshItems, touchedIds: touchedItemIdsRef.current });
    const semResultado =
      md.atualizados.length === 0 && md.conflitos.length === 0 &&
      ml.atualizadas.length === 0 && ml.conflitos.length === 0;
    if (semResultado) {
      // Merge NO-OP (inclui o refetch que o onError do save P0409 já processou na mão,
      // logo abaixo — `baseRef` já bate com `fresh`): NÃO tocar em NENHUM state
      // (draft/items/conflitos/ultimoMerge). Conflitos já sinalizados na tela só podem
      // sumir por: resolução manual, um merge com resultado de verdade, o seed (1ª carga)
      // ou um save OK — nunca por um refetch que não achou nada de novo. Sem esse guard,
      // este efeito rodando LOGO APÓS o onError apagava em silêncio o conflito que o
      // onError acabou de detectar (achado do QA da Task 7).
      baseRef.current = { draft: freshDraft, items: freshItems };
      return;
    }
    if (md.atualizados.length > 0 || md.conflitos.length > 0) setDraft(md.valor);
    if (ml.atualizadas.length > 0 || ml.conflitos.length > 0) setItems(ml.linhas);
    const todosConflitos = [...md.conflitos, ...ml.conflitos];
    conflitosRef.current = todosConflitos;
    setConflitos(todosConflitos);
    setUltimoMerge({ atualizados: md.atualizados.length + ml.atualizadas.length, conflitos: todosConflitos });
    baseRef.current = { draft: freshDraft, items: freshItems };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ocQueryData]);

  const { data: artigos = [] } = useQuery({
    queryKey: ["artigos-by-empresa", draft.empresa_id],
    queryFn: async () => {
      let q = supabase.from("artigos").select("id, nome, empresa_id, preco, rendimento, unidade_medida").order("nome");
      if (draft.empresa_id) q = q.eq("empresa_id", draft.empresa_id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Artigo[];
    },
  });
  const artigoMap = useMemo(() => Object.fromEntries(artigos.map((a) => [a.id, a])), [artigos]);

  const artigoIds = useMemo(() => {
    const s = new Set<string>();
    items.forEach((i) => i.artigo_id && s.add(i.artigo_id));
    return Array.from(s);
  }, [items]);

  const { data: variantes = [] } = useQuery({
    queryKey: ["variantes-by-artigos", artigoIds],
    enabled: artigoIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("id, artigo_id, nome_variante, codigo_variante, preco, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("artigo_id", artigoIds);
      if (error) throw error;
      return (data ?? []) as unknown as Variante[]; // types.ts ainda sem variantes_tecido.preco
    },
  });
  const variantesByArtigo = useMemo(() => {
    const m: Record<string, Variante[]> = {};
    variantes.forEach((v) => { (m[v.artigo_id] ||= []).push(v); });
    // Ordena alfabético por COR BASE (primário) e, empatando, por COR APELIDO (secundário).
    const cmp = (a: Variante, b: Variante) => {
      const base = (a.cor?.nome ?? "").localeCompare(b.cor?.nome ?? "", "pt-BR", { numeric: true });
      if (base !== 0) return base;
      return (a.apelido?.nome ?? "").localeCompare(b.apelido?.nome ?? "", "pt-BR", { numeric: true });
    };
    for (const k in m) m[k].sort(cmp);
    return m;
  }, [variantes]);
  const varianteMap = useMemo(() => Object.fromEntries(variantes.map((v) => [v.id, v])), [variantes]);

  // Pré-preenche o preço de CADA item com o preço ATUAL da variante (cadastro) quando vier vazio —
  // vale p/ NOVA OC e ao EDITAR (encomendados/recebidos). Só toca o que está null; o usuário edita
  // se o preço desta compra for diferente. Roda quando as variantes/itens carregam.
  useEffect(() => {
    let houveMudanca = false;
    const next = items.map((i) => {
      if (i.preco == null && i.variante_tecido_id) {
        const p = varianteMap[i.variante_tecido_id]?.preco;
        if (p != null) { houveMudanca = true; return { ...i, preco: p }; }
      }
      return i;
    });
    if (!houveMudanca) return;
    setItems(next);
    // Ao EDITAR, o preenchimento de preço vindo do cadastro é normalização de carga
    // (não edição do usuário): re-baseline p/ a OC não nascer "não salva". Fora do
    // updater do setState (não pode ter efeito colateral dentro do reducer).
    if (isEdit) resetBaseline({ draft, items: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [varianteMap]);

  const itemsBy = (n: 1 | 2) => items.filter((i) => i.artigo_numero === n);
  const artigoIdFor = (n: 1 | 2) => itemsBy(n)[0]?.artigo_id ?? null;

  const setArtigo = (n: 1 | 2, artigoId: string) => {
    const rendimentoPadrao = artigoMap[artigoId]?.rendimento ?? null;
    setItemsTracked((prev) => [
      ...prev.filter((i) => i.artigo_numero !== n),
      {
        tempId: crypto.randomUUID(),
        artigo_numero: n,
        artigo_id: artigoId,
        variante_tecido_id: "",
        quantidade_pedida: 0,
        quantidade_recebida: null,
        rendimento: rendimentoPadrao,
        cancelado: false,
        preco: null,
      },
    ]);
  };

  const toggleVariante = (n: 1 | 2, varId: string, checked: boolean) => {
    const artigoId = artigoIdFor(n);
    if (!artigoId) return;
    setItemsTracked((prev) => {
      // Lista ordenada das variantes selecionadas para este tecido
      const selected = prev.filter((i) => i.artigo_numero === n && i.variante_tecido_id);
      const others = prev.filter((i) => i.artigo_numero !== n || !i.variante_tecido_id);
      if (!checked) {
        // Remover essa variante e todas as subsequentes (cascade)
        const idx = selected.findIndex((i) => i.variante_tecido_id === varId);
        if (idx < 0) return prev;
        const kept = selected.slice(0, idx);
        return [...others, ...kept];
      }
      if (selected.some((i) => i.variante_tecido_id === varId)) return prev;
      if (selected.length >= 10) { toast.error("Limite de 10 variantes por tecido"); return prev; }
      // Novas variantes herdam o rendimento já definido para este tecido (ou o
      // padrão do artigo), mantendo um único rendimento por tecido na OC.
      const rendimentoGrupo = prev.find((i) => i.artigo_numero === n)?.rendimento
        ?? artigoMap[artigoId]?.rendimento ?? null;
      return [
        ...others,
        ...selected,
        {
          tempId: crypto.randomUUID(),
          artigo_numero: n,
          artigo_id: artigoId,
          variante_tecido_id: varId,
          quantidade_pedida: 0,
          quantidade_recebida: null,
          rendimento: rendimentoGrupo,
          cancelado: false,
          // Default = preço ATUAL da variante (cadastro); editável (o preço real desta compra).
          preco: varianteMap[varId]?.preco ?? artigoMap[artigoId]?.preco ?? null,
        },
      ];
    });
  };

  // Desmarcar variante tem CASCATA (o toggle remove também as SEGUINTES do mesmo
  // tecido — a ordem das variantes é significativa). Antes era silenciosa; agora
  // pede confirmação QUANDO afeta outras variantes. Marcar segue direto.
  const requestToggleVariante = (n: 1 | 2, varId: string, checked: boolean) => {
    if (!checked) {
      const selected = itemsBy(n).filter((i) => i.variante_tecido_id);
      const idx = selected.findIndex((i) => i.variante_tecido_id === varId);
      const afetadas = idx >= 0 ? selected.slice(idx + 1) : [];
      if (afetadas.length > 0) {
        setConfirmDesmarcar({
          n,
          varId,
          afetadas: afetadas.map((i) => labelVariante(varianteMap[i.variante_tecido_id])),
        });
        return;
      }
    }
    toggleVariante(n, varId, checked);
  };

  const setQtd = (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number | null) => {
    setItemsTracked((prev) => prev.map((i) => i.tempId === tempId ? { ...i, [field]: v } : i));
  };
  const setPreco = (tempId: string, v: number | null) => {
    setItemsTracked((prev) => prev.map((i) => i.tempId === tempId ? { ...i, preco: v } : i));
  };
  // Preço do tecido (n) aplicado a TODAS as variantes daquele tecido na OC.
  const setPrecoAll = (n: 1 | 2, v: number | null) => {
    setItemsTracked((prev) => prev.map((i) => i.artigo_numero === n && i.variante_tecido_id ? { ...i, preco: v } : i));
  };
  // Rendimento é por tecido: aplica o valor a todos os itens do mesmo artigo_numero.
  const setRendimento = (n: 1 | 2, v: number | null) => {
    setItemsTracked((prev) => prev.map((i) => i.artigo_numero === n ? { ...i, rendimento: v } : i));
  };
  const toggleCancelado = (tempId: string, value: boolean) => {
    setItemsTracked((prev) => prev.map((i) => i.tempId === tempId ? { ...i, cancelado: value } : i));
  };

  // Valor da OC = preço do ITEM desta compra × qtd (fallback p/ o preço do cadastro do artigo
  // quando o item não tem preço) — conta única em shared (precoItem).
  const precoDe = (it: ItemDraft) => precoItem(it, artigoMap);
  const valorPrev = (it: ItemDraft) => precoDe(it) * it.quantidade_pedida;
  const valorReal = (it: ItemDraft) => precoDe(it) * (it.quantidade_recebida ?? 0);
  // Itens cancelados não entram nos totais (nem no valor_real_total persistido,
  // que alimenta as parcelas).
  const totalPrevisto = items.filter((i) => !i.cancelado).reduce((s, i) => s + valorPrev(i), 0);
  const totalReal = items.filter((i) => !i.cancelado).reduce((s, i) => s + valorReal(i), 0);
  // Box "TOTAL PREVISTO" vivo da seção Tecidos: metragem (kg→m via rendimento) + nº de variantes.
  const itensAtivos = items.filter((i) => !i.cancelado && i.variante_tecido_id);
  const metragemPrevista = itensAtivos.reduce((s, i) => s + metragemPedidaItem(i, artigoMap), 0);
  const numVariantes = itensAtivos.length;

  const handleSingleUpload = async (file: File, key: keyof Draft) => {
    try {
      const path = await uploadFile(file, key as string);
      setDraftTracked((d) => ({ ...d, [key]: path }));
      toast.success("Arquivo enviado");
    } catch (e: any) { toast.error(mensagemErro(e)); }
  };

  const saveMutation = useMutation({
    mutationFn: async (markReceived: boolean) => {
      // Colab (spec 2026-08-03, achado QA Task 7): com conflitos pendentes na tela, o save
      // NÃO pode passar — mesmo que `_rev_base` já esteja atualizado (o `onError` do P0409
      // avança `revRef` pra qualquer resultado de merge, inclusive quando sobra conflito, pra
      // manter `_rev_base` sempre correto no PRÓXIMO save). Sem este guard, um 2º clique em
      // "Salvar" com o conflito ainda destacado passaria a trava otimista (rev já bate) e
      // sobrescreveria a versão da outra pessoa em silêncio — o usuário tem que resolver
      // ("manter meu"/"usar o novo") em cada campo destacado antes de salvar de novo.
      if (conflitosRef.current.length > 0)
        throw new Error("Resolva os conflitos listados no aviso no topo antes de salvar.");
      if (!draft.data_prevista_entrega) throw new Error("Informe a Data Prevista de Entrega.");
      if (!draft.prazo_pagamento?.trim()) throw new Error("Informe o Prazo de Pagamento.");
      const selecionados = items.filter((i) => i.variante_tecido_id && i.artigo_id);
      if (selecionados.some((i) => !(Number(i.quantidade_pedida) > 0)))
        throw new Error("Informe a quantidade (maior que zero) de cada variante selecionada.");
      const parcelas = draft.parcelas_recebimento ?? [];
      // Regra única (também usada pelo preview de parcelas do confirmar-recebimento).
      const lastDate = ultimaDataEntrega(draft);
      const payload: any = {
        numero_pedido: draft.numero_pedido || null,
        responsavel_id: draft.responsavel_id,
        responsavel_nome: draft.responsavel_nome || null,
        empresa_id: draft.empresa_id,
        representante_id: draft.representante_id,
        data_pedido: draft.data_pedido || null,
        data_prevista_entrega: draft.data_prevista_entrega || null,
        prazo_pagamento: draft.prazo_pagamento || null,
        quantidade_prazos: draft.quantidade_prazos,
        observacoes_entrega: draft.observacoes_entrega || null,
        observacoes_defeitos: draft.observacoes_defeitos || null,
        anexo_pedido_url: draft.anexo_pedido_url,
        modelo_sugerido_url: draft.modelo_sugerido_url,
        nf_url: draft.nfs[0]?.url ?? null, // NF primária = primeira da lista (compat)
        data_entrega: markReceived ? (lastDate || null) : (draft.data_entrega || null),
        parcelas_recebimento: parcelas,
        valor_previsto_total: totalPrevisto,
        valor_real_total: totalReal,
        status: markReceived ? "recebido" : status,
      };

      // CRITICAL: salvar itens ANTES de atualizar o status para 'recebido',
      // pois o trigger gerar_parcelas_oc_tecido depende de valor_real_total/itens
      // no momento do UPDATE e tem proteção anti-duplicação.
      let ocIdLocal = ocId;
      const finalStatus: OCStatus = markReceived ? "recebido" : status;
      const validItems = items.filter((i) => i.variante_tecido_id && i.artigo_id);

      // Modo Só Rolo: persiste o destrinchamento PLANEJADO por item (sobrevive a
      // salvar/reabrir o encomendado). Ao receber, os rolos reais saem daqui.
      const roloPlan = (tempId: string) => {
        const arr = rolosPorItem[tempId];
        if (!arr) return null;
        const out = arr
          .map((e) => ({ q: Number(String(e.qtd).replace(",", ".")), e }))
          .filter((x) => x.q > 0)
          .map((x) => ({ qtd: x.q, obs: x.e.obs || null, cq_ok: !!x.e.cq_ok, cq_alerta: !!x.e.cq_alerta }));
        return out.length ? out : null;
      };
      // Soma dos rolos digitados (na unidade do artigo).
      const roloSoma = (tempId: string): number | null => {
        const arr = rolosPorItem[tempId];
        if (!arr) return null;
        const s = arr.reduce((acc, e) => acc + (Number(String(e.qtd).replace(",", ".")) || 0), 0);
        return s > 0 ? Math.round(s * 100) / 100 : null;
      };
      // Ao RECEBER no modo rolo/híbrido, a quantidade recebida do item = soma dos rolos.
      // Precisa ser gravada ANTES de criar_rolo (senão o saldo de origem é 0 e a
      // separação falha com "0 m disponíveis").
      const recebidaDe = (tempId: string, fallback: number | null) =>
        (modoOcRolo !== "oc" && markReceived) ? (roloSoma(tempId) ?? fallback) : fallback;

      // Save ATÔMICO: header + diff de itens (preserva cq_*) + recálculo de
      // parcelas numa ÚNICA transação (RPC salvar_oc_tecido). Acaba com a janela de falha
      // parcial das 6-8 chamadas que isto era no cliente.
      const itensPayload = validItems.map((i) => ({
        id: i.id ?? null,
        artigo_id: i.artigo_id,
        artigo_numero: i.artigo_numero,
        variante_tecido_id: i.variante_tecido_id,
        quantidade_pedida: i.quantidade_pedida,
        quantidade_recebida: recebidaDe(i.tempId, i.quantidade_recebida),
        rendimento: i.rendimento,
        cancelado: i.cancelado,
        preco: i.preco,
        rolos_planejados: modoOcRolo !== "oc" ? roloPlan(i.tempId) : null,
      }));
      const { data: savedOcId, error: saveErr } = await supabase.rpc("salvar_oc_tecido" as any, {
        _oc_id: isEdit ? ocId : null,
        _oc: payload,
        _itens: itensPayload,
        // Colab (spec 2026-08-03): trava otimista — se outra pessoa salvou entre a
        // última carga e agora, a RPC dá P0409 (tratado no onError abaixo).
        _rev_base: revRef.current,
      });
      if (saveErr) throw saveErr;
      ocIdLocal = savedOcId as string;

      // NFs (lista) — persistidas fora da RPC crítica de parcelas (NF não é invariante
      // financeiro). nf_url já foi salvo pela RPC como a primeira da lista.
      if (ocIdLocal) {
        const { error: nfErr } = await supabase.from("ocs_tecido").update({ nfs: draft.nfs } as any).eq("id", ocIdLocal);
        if (nfErr) throw nfErr;
      }

      // Modo só-rolo: gera os rolos a partir do destrinchamento. A RPC gerar_rolos_recebimento
      // cria TODOS numa transação (tudo-ou-nada) — sem rolos parciais se um estourar o saldo.
      // criar_rolo separa da OC recebida (baixa separacao_rolo) e converte kg→metros aqui.
      // Best-effort no fluxo: se falhar, a OC já está recebida (não bloqueia) e re-salvar gera.
      if (modoOcRolo !== "oc" && finalStatus === "recebido" && ocIdLocal && Object.keys(rolosPorItem).length > 0) {
        const { data: savedItems } = await supabase
          .from("ocs_tecido_itens").select("id, variante_tecido_id, artigo_id").eq("oc_tecido_id", ocIdLocal);
        const itemByVar = new Map((savedItems ?? []).map((it: any) => [it.variante_tecido_id, it]));
        const rolosPayload: any[] = [];
        for (const [tempId, rolls] of Object.entries(rolosPorItem)) {
          const di = items.find((x) => x.tempId === tempId);
          if (!di?.variante_tecido_id || di.cancelado) continue;
          const saved = itemByVar.get(di.variante_tecido_id);
          if (!saved) continue;
          const a = di.artigo_id ? artigoMap[di.artigo_id] : null;
          const isKg = a?.unidade_medida === "kg";
          const rend = Number(di.rendimento ?? a?.rendimento ?? 0);
          for (const entry of rolls) {
            if (entry.roloId) continue; // já existe (recarregado) — envia só os novos
            const qtd = Number(String(entry.qtd).replace(",", "."));
            if (!qtd || qtd <= 0) continue;
            rolosPayload.push({
              origem_item_id: saved.id,
              artigo_id: di.artigo_id,
              variante_tecido_id: di.variante_tecido_id,
              metragem: isKg && rend > 0 ? qtd * rend : qtd,
              obs: entry.obs || null,
              cq_ok: !!entry.cq_ok,
              cq_alerta: !!entry.cq_alerta,
            });
          }
        }
        if (rolosPayload.length > 0) {
          const { error: rErr } = await supabase.rpc("gerar_rolos_recebimento" as any, {
            _oc_id: ocIdLocal, _rolos: rolosPayload,
          });
          if (rErr) {
            console.warn("gerar rolos no recebimento:", rErr.message);
            toast.warning("OC recebida, mas nenhum rolo foi gerado: " + mensagemErro(rErr, "") + " Re-salve para gerar.");
          }
        }
      }
    },
    onSuccess: () => {
      toast.success("OC salva");
      // Colab: o que acabei de salvar já É o "base" atual — evita que o eco do Realtime
      // (nosso próprio UPDATE) apareça como "alguém atualizou N campos" no banner.
      baseRef.current = { draft, items };
      touchedRef.current = new Set();
      touchedItemIdsRef.current = new Set();
      conflitosRef.current = [];
      setConflitos([]);
      setUltimoMerge(null);
      markClean();
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
      qc.invalidateQueries({ queryKey: ["ocs_tecido_qtd_recebida"] });
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      qc.invalidateQueries({ queryKey: ["rolos"] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
      onSaved();
      onClose();
    },
    onError: async (e: any, markReceived) => {
      // Colab (spec 2026-08-03): conflito de versão — outra pessoa salvou entre a
      // última carga e agora. Busca o estado novo e roda o merge AQUI MESMO (síncrono,
      // não delega pro useEffect — ver comentário abaixo) e, se não sobrou nenhum
      // conflito de verdade (só campos que EU não toquei), tenta salvar de novo UMA
      // vez com o rev atualizado. Se sobrou conflito, para e deixa o usuário resolver
      // nos campos destacados.
      //
      // IMPORTANTE: por que o merge não pode esperar o useEffect. `await
      // invalidateQueries(...)` resolve quando o FETCH termina (microtask) — mas o
      // re-render que entrega o novo `ocQueryData` pro componente, e o useEffect que
      // lê `[ocQueryData]` e atualiza `revRef`/`conflitosRef`, só rodam depois (o efeito
      // é agendado como passive effect, macrotask). Se a gente confiasse nisso, o retry
      // abaixo leria `revRef.current` VELHO, reenviaria o MESMO `_rev_base` rejeitado e
      // cairia em P0409 de novo (com `retryRef` já true → toast genérico, sem nunca
      // corrigir nada). Por isso lemos o cache DIRETO (`getQueryData`, síncrono, já
      // populado pelo `refetchQueries` que acabou de resolver) e fazemos o merge aqui.
      //
      // IMPORTANTE #2: `draft`/`items` (o `draft`/`items` da closure, capturados na render
      // do clique em Salvar) NÃO servem de entrada pro merge — o `await` acima abre uma
      // janela em que o usuário pode continuar digitando (campos não ficam disabled); essa
      // tecla entra no state React mas não na closure velha. Por isso lemos
      // `draftLiveRef.current`/`itemsLiveRef.current` (espelhos atualizados TODA render, ver
      // acima) bem aqui, no bloco síncrono logo após o `await` — nenhuma tecla se perde.
      if (e?.code === "P0409" && !retryRef.current) {
        retryRef.current = true;
        savingRef.current = true;
        await qc.refetchQueries({ queryKey: ["oc-tecido", ocId] });
        const fresh = qc.getQueryData<typeof ocQueryData>(["oc-tecido", ocId]);
        if (fresh?.oc) {
          const freshDraft = draftFromOc(fresh.oc);
          const freshItems = fresh.items;
          const liveDraft = draftLiveRef.current;
          const liveItems = itemsLiveRef.current;
          const base = baseRef.current ?? { draft: freshDraft, items: freshItems };
          const md = mergeDraft({ base: base.draft, draft: liveDraft, fresh: freshDraft, touched: touchedRef.current });
          const ml = mergeLinhas({ base: base.items, draft: liveItems, fresh: freshItems, touchedIds: touchedItemIdsRef.current });
          if (md.atualizados.length > 0 || md.conflitos.length > 0) setDraft(md.valor);
          if (ml.atualizadas.length > 0 || ml.conflitos.length > 0) setItems(ml.linhas);
          const todosConflitos = [...md.conflitos, ...ml.conflitos];
          conflitosRef.current = todosConflitos;
          setConflitos(todosConflitos);
          setUltimoMerge({ atualizados: md.atualizados.length + ml.atualizadas.length, conflitos: todosConflitos });
          // Avança base/rev AQUI — quando o useEffect rodar em seguida (o refetch acima
          // também atualiza `ocQueryData`), ele vai ver base===fresh (mesmo dado) e o
          // merge dele vira no-op: nada é reaplicado em dobro.
          baseRef.current = { draft: freshDraft, items: freshItems };
          revRef.current = (fresh.oc as any).rev ?? null;
          if (todosConflitos.length === 0) {
            saveMutation.mutate(markReceived, { onSettled: () => { savingRef.current = false; retryRef.current = false; } });
            return;
          }
        }
        savingRef.current = false;
        retryRef.current = false;
        toast.error(mensagemErro(e, "Erro ao salvar"));
        return;
      }
      toast.error(mensagemErro(e, "Erro ao salvar"));
    },
  });

  const unmarkReceivedMut = useMutation({
    mutationFn: async () => {
      if (!ocId) return;
      // Atômico numa RPC: reverte rolos do recebimento (respeita o modo da loja; bloqueia se
      // algum rolo já em uso) + volta status p/ 'encomendado' + apaga parcelas não-pagas, tudo
      // numa txn (antes eram 2-3 escritas soltas que deixavam estado parcial em falha do meio).
      const { error } = await supabase.rpc("desmarcar_recebimento_oc" as any, { _tipo: "tecido", _oc_id: ocId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OC voltou para Encomendado.");
      setConfirmUnmark(false);
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
      qc.invalidateQueries({ queryKey: ["ocs_tecido_qtd_recebida"] });
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      qc.invalidateQueries({ queryKey: ["rolos"] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao desmarcar recebido.")),
  });

  // CQ por rolo: grava direto no item do rolo (ocs_tecido_itens.cq_*) e reflete no
  // estado local. Usado pelos toggles/observação de cada rolo recebido.
  const onRoloCq = async (roloItemId: string, patch: { cq_ok?: boolean; cq_alerta?: boolean; obs?: string }) => {
    const dbPatch: Record<string, any> = {};
    if (patch.cq_ok !== undefined) dbPatch.cq_ok = patch.cq_ok;
    if (patch.cq_alerta !== undefined) dbPatch.cq_alerta_status = patch.cq_alerta ? "alertado" : "sem_alerta";
    if (patch.obs !== undefined) dbPatch.cq_observacao = patch.obs || null;
    const { error } = await supabase.from("ocs_tecido_itens").update(dbPatch as any).eq("id", roloItemId);
    if (error) { toast.error(mensagemErro(error, "Erro ao salvar CQ do rolo")); return; }
    setRolosPorItem((prev) => {
      const next: Record<string, RoloEntry[]> = {};
      for (const [k, arr] of Object.entries(prev)) {
        next[k] = arr.map((e) => (e.roloItemId === roloItemId ? { ...e, ...patch } : e));
      }
      return next;
    });
  };

  // Recarrega a OC (refaz o destrinchamento + recalcula valores) após uma ação de rolo.
  const reloadOc = () => {
    qc.invalidateQueries({ queryKey: ["oc-tecido", ocId] });
    qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
    qc.invalidateQueries({ queryKey: ["ocs_tecido_qtd_recebida"] });
    qc.invalidateQueries({ queryKey: ["rolos"] });
    qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
    qc.invalidateQueries({ queryKey: ["cq-tecido"] });
  };
  // Cancelar / reabrir um rolo específico (recalcula a OC: recebido + valor real).
  const onRoloCancelar = async (roloId: string, cancel: boolean) => {
    const { error } = await supabase.rpc((cancel ? "cancelar_rolo" : "reabrir_rolo") as any, { _rolo_id: roloId });
    if (error) { toast.error(mensagemErro(error, "Erro ao cancelar/reabrir rolo")); return; }
    reloadOc();
  };
  // Ajustar a quantidade de um rolo já criado (recalcula a OC).
  const onRoloAjuste = async (roloId: string, novaQtd: number) => {
    const { error } = await supabase.rpc("ajustar_rolo" as any, { _rolo_id: roloId, _nova_qtd: novaQtd });
    if (error) { toast.error(mensagemErro(error, "Erro ao ajustar rolo")); return; }
    reloadOc();
  };

  // Recebimento só ao EDITAR uma OC já existente. Criar uma OC NÃO oferece
  // recebimento: a OC nasce "encomendada" e recebe-se depois, reabrindo-a.
  const canShowRecebimento = isEdit && (status === "encomendado" || status === "recebido");
  const isReadOnlyRecebimento = isEdit && status === "recebido";
  const artigoIdsForEtiqueta = useMemo(
    () => [artigoIdFor(1), artigoIdFor(2)].filter((x): x is string => !!x),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items],
  );
  const { data: etiquetaData } = useQuery({
    queryKey: ["artigos-etiquetas", artigoIdsForEtiqueta],
    enabled: artigoIdsForEtiqueta.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("id, etiqueta_lavagem_urls, sem_etiqueta_lavagem")
        .in("id", artigoIdsForEtiqueta);
      if (error) throw error;
      const urls: Record<string, string[]> = {};
      const sem: Record<string, boolean> = {};
      for (const r of (data ?? []) as any[]) {
        urls[r.id] = r.etiqueta_lavagem_urls ?? [];
        sem[r.id] = !!r.sem_etiqueta_lavagem;
      }
      return { urls, sem };
    },
  });
  const etiquetasByArtigo = etiquetaData?.urls ?? {};
  // Inicializa o flag "sem etiqueta" a partir do PERSISTIDO no artigo (edições locais
  // prevalecem, pois a persistência é imediata no toggle).
  useEffect(() => {
    if (etiquetaData?.sem) setSemEtiquetaPorArtigo((prev) => ({ ...etiquetaData.sem, ...prev }));
  }, [etiquetaData]);
  // Persiste o flag no artigo (a etiqueta é propriedade do tecido) + estado local.
  const onSemEtiqueta = async (artigoId: string, value: boolean) => {
    setSemEtiquetaPorArtigo((m) => ({ ...m, [artigoId]: value }));
    const { error } = await supabase.from("artigos").update({ sem_etiqueta_lavagem: value } as any).eq("id", artigoId);
    if (error) toast.error(mensagemErro(error, "Erro ao salvar etiqueta"));
  };

  const parcelas = draft.parcelas_recebimento ?? [];
  const todasParcelasOk =
    parcelas.length > 0 && parcelas.every((p) => !!p.data && p.recebido === true);
  const todasEtiquetasOk =
    artigoIdsForEtiqueta.length > 0 &&
    artigoIdsForEtiqueta.every(
      (id) => semEtiquetaPorArtigo[id] || (etiquetasByArtigo[id]?.length ?? 0) > 0,
    );
  // No modo rolo a quantidade recebida = soma dos rolos digitados (não depende do
  // quantidade_recebida do item estar sincronizado — ex.: ao reabrir o encomendado).
  const algumaQtdRecebida = modoOcRolo !== "oc"
    ? Object.values(rolosPorItem).some((arr) => arr.some((e) => Number(String(e.qtd).replace(",", ".")) > 0))
    : items.some((i) => (i.quantidade_recebida ?? 0) > 0);

  // Requisitos do "marcar recebido" — FONTE ÚNICA: alimenta o gate do botão, as
  // mensagens de falta (toast) E o checklist de badges da seção 4 (não duplicar regra).
  const requisitosRecebimento: { key: string; ok: boolean; rotulo: string; faltas: string[] }[] = [
    {
      key: "qtd",
      ok: algumaQtdRecebida,
      rotulo: algumaQtdRecebida ? "Qtd recebida" : "Falta qtd recebida",
      faltas: algumaQtdRecebida ? [] : ["Preencha a quantidade recebida de pelo menos uma variante."],
    },
    {
      key: "parcelas",
      ok: todasParcelasOk,
      rotulo: todasParcelasOk ? "Parcelas de entrega OK" : "Parcelas de entrega pendentes",
      faltas: todasParcelasOk
        ? []
        : parcelas.length === 0
          ? ["Defina a quantidade de parcelas de recebimento."]
          : [
              ...(!parcelas.every((p) => !!p.data) ? ["Preencha as datas de todas as parcelas de recebimento."] : []),
              ...(!parcelas.every((p) => p.recebido === true) ? ["Marque todas as parcelas como recebidas."] : []),
            ],
    },
    {
      key: "nf",
      ok: draft.nfs.length > 0,
      rotulo: draft.nfs.length > 0 ? "NF anexada" : "Falta NF",
      faltas: draft.nfs.length > 0 ? [] : ["Anexe ao menos uma nota fiscal (NF)."],
    },
    {
      key: "etiquetas",
      ok: todasEtiquetasOk,
      rotulo: todasEtiquetasOk ? "Etiquetas OK" : "Faltam etiquetas",
      faltas: todasEtiquetasOk ? [] : ["Anexe a etiqueta de lavagem de todos os tecidos."],
    },
  ];

  const canMarkReceived =
    isEdit && status === "encomendado" && requisitosRecebimento.every((r) => r.ok);

  const getMissingRequirements = (): string[] => requisitosRecebimento.flatMap((r) => r.faltas);

  const handleSave = () => {
    if (savingRef.current || saveMutation.isPending) return;
    savingRef.current = true;
    saveMutation.mutate(false, { onSettled: () => { savingRef.current = false; } });
  };

  const handleMarkReceived = () => {
    if (savingRef.current || saveMutation.isPending) return; // anti-duplo-clique (ref síncrono)
    if (!canMarkReceived) {
      const missing = getMissingRequirements();
      toast.error("Não é possível marcar como recebido:", {
        description: missing.join(" "),
      });
      return;
    }
    // Requisitos ok → confirmação com PREVIEW das parcelas antes de gerar o financeiro.
    setConfirmReceber(true);
  };
  // Só AQUI roda o fluxo real de marcar recebido (a ordem itens-antes-de-status
  // segue intacta dentro do saveMutation — comentário CRITICAL).
  const confirmarRecebimento = () => {
    if (savingRef.current || saveMutation.isPending) return;
    savingRef.current = true;
    saveMutation.mutate(true, { onSettled: () => { savingRef.current = false; setConfirmReceber(false); } });
  };

  // Trilho de âncoras (redesign ago/2026): seções numeradas 1..5. Na CRIAÇÃO, 4/5
  // aparecem com cadeado (disponíveis após salvar). No modo Só Rolo a seção 5 não
  // existe (o CQ é por rolo, dentro da 4) — some do trilho também.
  const secoes: SecaoOc[] = [
    { id: "oc-sec-pedido", n: 1, label: "Pedido" },
    { id: "oc-sec-tecidos", n: 2, label: "Tecidos" },
    { id: "oc-sec-anexos", n: 3, label: "Anexos" },
    ...(isEdit
      ? [
          ...(canShowRecebimento ? [{ id: "oc-sec-recebimento", n: 4, label: "Recebimento" }] : []),
          ...(ocId && modoOcRolo === "oc" ? [{ id: "oc-sec-cq", n: 5, label: "CQ" }] : []),
        ]
      : [
          { id: "oc-sec-recebimento", n: 4, label: "Recebimento", locked: true },
          { id: "oc-sec-cq", n: 5, label: "CQ", locked: true },
        ]),
  ];
  const irParaSecao = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setSecAtiva(id);
  };
  // OC ENCOMENDADA abre direto na seção 4 (dono, ago/2026): abrir o card dela é,
  // no fluxo real, registrar a chegada. 1× por abertura, após a seção montar.
  const pulouRecebimentoRef = useRef(false);
  useEffect(() => {
    if (pulouRecebimentoRef.current || !isEdit || status !== "encomendado" || !canShowRecebimento) return;
    const el = document.getElementById("oc-sec-recebimento");
    if (!el) return;
    pulouRecebimentoRef.current = true;
    requestAnimationFrame(() => irParaSecao("oc-sec-recebimento"));
  });
  // Scroll-spy simples: ativa = ÚLTIMA seção cujo topo já passou do topo do container.
  const onBodyScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const topo = e.currentTarget.getBoundingClientRect().top;
    let atual = secoes[0]?.id ?? "oc-sec-pedido";
    for (const s of secoes) {
      if (s.locked) continue;
      const el = document.getElementById(s.id);
      if (el && el.getBoundingClientRect().top - topo <= 40) atual = s.id;
    }
    if (atual !== secAtiva) setSecAtiva(atual);
  };

  // O OcDialog só monta quando aberto, logo `changed` já basta (sem gate por `open`).
  const dirty = changed;

  return (
    <>
    <OcModalShell isEdit={isEdit} onClose={onClose} dirty={dirty} discardMessage="Há alterações não salvas nesta OC de tecido.">
        <div className="shrink-0 space-y-1">
          <Breadcrumb items={[{ label: "Entrada e Saída" }, { label: "OC Tecido" }, { label: draft.numero_pedido || "OC" }]} />
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>{isEdit ? `OC ${draft.numero_pedido || ""}` : "Nova OC de Tecido"}</DialogTitle>
              <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
            </div>
          </DialogHeader>
          <ColabBanner
            presentes={presentes}
            ultimoMerge={ultimoMerge}
            conflitos={conflitos}
            onResolver={resolverPorPath}
            rotulo={rotuloConflito}
          />
        </div>

        <div className="flex min-h-0 gap-4">
          <OcAnchorRail secoes={secoes} ativa={secAtiva} onIr={irParaSecao} />
          <div
            className="min-w-0 flex-1 space-y-6 overflow-y-auto"
            onScroll={onBodyScroll}
            onFocusCapture={(e) => setCampoFocado((e.target as HTMLElement).dataset?.colabPath ?? null)}
            onBlurCapture={() => setCampoFocado(null)}
          >
          <OcTecidoForm
            draft={draft}
            setDraft={setDraftTracked}
            empresas={empresas}
            artigos={artigos}
            variantesByArtigo={variantesByArtigo}
            varianteMap={varianteMap}
            itemsBy={itemsBy}
            artigoIdFor={artigoIdFor}
            setArtigo={setArtigo}
            toggleVariante={requestToggleVariante}
            setQtd={setQtd}
            setPreco={setPreco}
            setPrecoAll={setPrecoAll}
            setRendimento={setRendimento}
            tecido2Aberto={tecido2Aberto}
            setTecido2Aberto={setTecido2Aberto}
            removeTecido2={() => {
              setItemsTracked((p) => p.filter((i) => i.artigo_numero !== 2));
              setTecido2Aberto(false);
            }}
            handleSingleUpload={handleSingleUpload}
            colab={{ emConflito, conflitoDe, focadoPor, onResolverConflito: resolverConflito, conflitoLinha }}
            criacao={!isEdit}
            totalPrevisto={totalPrevisto}
            metragemPrevista={metragemPrevista}
            numVariantes={numVariantes}
          />

          {/* Criação: Recebimento/CQ só existem depois de salvar — aviso explícito. */}
          {!isEdit && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                O <b>Recebimento</b> fica disponível depois de salvar a OC (salvou → reabra e registre a chegada).
              </span>
            </div>
          )}

          {canShowRecebimento && (
            <OcTecidoRecebimento
              draft={draft}
              setDraft={setDraftTracked}
              handleSingleUpload={handleSingleUpload}
              items={items}
              artigoMap={artigoMap}
              varianteMap={varianteMap}
              setQtd={setQtd}
              totalPrevisto={totalPrevisto}
              totalReal={totalReal}
              tecido2Aberto={tecido2Aberto}
              artigoId1={artigoIdFor(1)}
              artigoId2={artigoIdFor(2)}
              status={status}
              readOnly={isReadOnlyRecebimento}
              toggleCancelado={toggleCancelado}
              canCancel={status === "encomendado" && modoOcRolo === "oc"}
              modoRolo={modoOcRolo !== "oc" && (status === "encomendado" || status === "recebido")}
              rolos={rolosPorItem}
              setRolos={setRolosPorItem}
              onRoloCq={onRoloCq}
              onRoloCancelar={onRoloCancelar}
              onRoloAjuste={onRoloAjuste}
              semEtiquetaPorArtigo={semEtiquetaPorArtigo}
              setSemEtiquetaPorArtigo={setSemEtiquetaPorArtigo}
              onSemEtiqueta={onSemEtiqueta}
              etiquetasByArtigo={etiquetasByArtigo}
              requisitos={requisitosRecebimento}
            />
          )}

          {/* No modo Só Rolo o CQ é feito POR ROLO no destrinchamento acima — a seção
              de CQ por item da OC fica redundante. */}
          {isEdit && ocId && modoOcRolo === "oc" && (
            <section id="oc-sec-cq" className="scroll-mt-2">
              <OcCqSection ocId={ocId} />
            </section>
          )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 border-t bg-background -mx-6 -mb-6 px-6 py-3 max-md:-mx-4 max-md:-mb-4 max-md:px-4 max-md:shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <Button variant="outline" onClick={onClose} aria-label="Voltar">
            <ArrowLeft className="h-4 w-4 md:mr-1" />
            <span className="max-md:sr-only">Voltar</span>
          </Button>
          {isEdit && onDelete && status === "encomendado" && (
            <Button variant="destructive" onClick={onDelete} aria-label="Excluir">
              <Trash2 className="h-4 w-4 md:mr-1" />
              <span className="max-md:sr-only">Excluir</span>
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            {canShowRecebimento && (
              // Botão que alterna: marca quando encomendado, desmarca quando recebido.
              isReadOnlyRecebimento ? (
                <Button variant="outline" onClick={() => setConfirmUnmark(true)} disabled={unmarkReceivedMut.isPending}>
                  Desmarcar Recebido
                </Button>
              ) : (
                <Button variant="outline" onClick={handleMarkReceived} disabled={saveMutation.isPending}>
                  Marcar Recebido
                </Button>
              )
            )}
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              <Check className="h-4 w-4 mr-1" />
              Salvar
            </Button>
          </div>
        </div>
    </OcModalShell>

      <AlertDialog open={confirmUnmark} onOpenChange={setConfirmUnmark}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desmarcar como recebido?</AlertDialogTitle>
            <AlertDialogDescription>
              A OC voltará para "Encomendado" e os campos de recebimento
              poderão ser editados novamente. Parcelas geradas para esta OC
              que ainda não foram pagas serão removidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => unmarkReceivedMut.mutate()} disabled={unmarkReceivedMut.isPending}>
              Desmarcar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação da CASCATA de desmarcar variante (a ordem das variantes é
          significativa: desmarcar uma remove também as seguintes do mesmo tecido). */}
      <AlertDialog open={!!confirmDesmarcar} onOpenChange={(o) => !o && setConfirmDesmarcar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desmarcar variante?</AlertDialogTitle>
            <AlertDialogDescription>
              Pela ordem das variantes do tecido, desmarcar esta também remove as seguintes:{" "}
              <b>{confirmDesmarcar?.afetadas.join(", ")}</b>. As quantidades e preços digitados
              nessas variantes serão descartados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDesmarcar) toggleVariante(confirmDesmarcar.n, confirmDesmarcar.varId, false);
                setConfirmDesmarcar(null);
              }}
            >
              Desmarcar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmar recebimento com PREVIEW das parcelas (gera o financeiro só no Confirmar). */}
      {confirmReceber && (
        <ConfirmarRecebimentoDialog
          ocId={ocId}
          prazoPagamento={draft.prazo_pagamento}
          quantidadePrazos={draft.quantidade_prazos}
          baseDataISO={ultimaDataEntrega(draft)}
          totalReal={totalReal}
          pending={saveMutation.isPending}
          onCancel={() => setConfirmReceber(false)}
          onConfirm={confirmarRecebimento}
        />
      )}
    </>
  );
}
