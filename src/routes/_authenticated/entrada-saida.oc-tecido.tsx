import { useEffect, useMemo, useState } from "react";
import { fmtNum } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scissors, Plus, Minus, ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";

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

import { OcTecidoList } from "@/components/oc-tecido/OcTecidoList";
import { RolosList, RoloDialog, RemoverMetragemDialog, AjustesList } from "@/components/oc-tecido/Rolos";
import { OcCqSection, alertaBadge } from "@/components/oc-tecido/CqTecido";
import { OcNfHistorico } from "@/components/oc-tecido/OcNfHistorico";
import { FilterButton } from "@/components/shared/filters";
import { OcTecidoForm } from "@/components/oc-tecido/OcTecidoForm";
import { OcTecidoRecebimento } from "@/components/oc-tecido/OcTecidoRecebimento";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { useModoOcRolo } from "@/hooks/useModoOcRolo";
import {
  emptyDraft, uploadFile,
  type Artigo, type Colab, type Draft, type Empresa, type ItemDraft,
  type OC, type OCItem, type OCStatus, type RoloEntry, type Variante,
} from "@/components/oc-tecido/shared";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/entrada-saida/oc-tecido")({
  component: () => (
    <RequirePermission page="entrada_oc_tecido">
      <OcTecidoPage />
    </RequirePermission>
  ),
});

function OcTecidoPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<"ocs" | "rolos">("ocs");
  const [openRolo, setOpenRolo] = useState(false);
  const [openRemover, setOpenRemover] = useState(false);
  const [tab, setTab] = useState<OCStatus>("encomendado");
  const [filterEmpresa, setFilterEmpresa] = useState<string>("all");
  const [filterResp, setFilterResp] = useState<string>("all");
  const [filterAlerta, setFilterAlerta] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OC | null>(null);

  const { data: ocs = [] } = useQuery({
    queryKey: ["ocs_tecido", tab, filterEmpresa, filterResp, filterAlerta],
    queryFn: async () => {
      // Recebidos trazem o status de alerta dos itens (p/ badge na lista + filtro).
      const sel = tab === "recebido" ? "*, ocs_tecido_itens!oc_tecido_id(cq_alerta_status)" : "*";
      let q = supabase.from("ocs_tecido").select(sel).eq("status", tab).eq("is_rolo" as never, false as never).order("created_at", { ascending: false });
      if (filterEmpresa !== "all") q = q.eq("empresa_id", filterEmpresa);
      if (filterResp !== "all") q = q.eq("responsavel_id", filterResp);
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome_fantasia, empresa_categorias_fornecedor!inner(categorias_fornecedor!inner(nome))")
        .in("empresa_categorias_fornecedor.categorias_fornecedor.nome", ["Tecido", "Forro", "Entretela"])
        .order("nome_fantasia");
      if (error) throw error;
      const seen = new Set<string>();
      const out: Empresa[] = [];
      for (const e of (data ?? []) as Array<{ id: string; nome_fantasia: string }>) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push({ id: e.id, nome_fantasia: e.nome_fantasia });
      }
      return out;
    },
  });

  const { data: estilistas = [] } = useQuery({
    queryKey: ["colab-estilistas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colaboradores").select("id, nome, tipo").eq("tipo", "estilista").order("nome");
      if (error) throw error;
      return (data ?? []) as Colab[];
    },
  });

  const empresaMap = useMemo(() => Object.fromEntries(empresas.map((e) => [e.id, e.nome_fantasia])), [empresas]);

  const deleteMut = useMutation({
    mutationFn: async (oc: OC) => {
      const { error } = await supabase.from("ocs_tecido").delete().eq("id", oc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OC excluída.");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir."),
  });

  const ocIds = useMemo(() => ocs.map((o) => o.id), [ocs]);
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

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Scissors className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h1 className="text-2xl font-bold truncate">OC de Tecido</h1>
            <p className="text-sm text-muted-foreground mt-1">Ordens de compra de tecidos.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">

          <div className="flex rounded-md border p-0.5">
            <Button size="sm" variant={view === "ocs" ? "secondary" : "ghost"} onClick={() => setView("ocs")}>OCs</Button>
            <Button size="sm" variant={view === "rolos" ? "secondary" : "ghost"} onClick={() => setView("rolos")}>Rolos</Button>
          </div>
          {view === "ocs" && (
            <>
              <FilterButton
                filters={[
                  { label: "Fornecedor", value: filterEmpresa, onChange: setFilterEmpresa, options: [{ id: "all", nome: "Todos" }, ...empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }))] },
                  ...(tab === "encomendado"
                    ? [{ label: "Responsável", value: filterResp, onChange: setFilterResp, options: [{ id: "all", nome: "Todos" }, ...estilistas.map((e) => ({ id: e.id, nome: e.nome }))] }]
                    : []),
                  ...(tab === "recebido"
                    ? [{ label: "Alerta", value: filterAlerta, onChange: setFilterAlerta, options: [
                        { id: "all", nome: "Todos" },
                        { id: "alertado", nome: "Alerta estilo" },
                        { id: "troca_pendente", nome: "Troca pendente" },
                        { id: "trocado", nome: "Trocado" },
                        { id: "estilo_ok", nome: "Estilo OK" },
                        { id: "devolucao", nome: "Devolução" },
                        { id: "cancelado", nome: "Cancelado" },
                      ] }]
                    : []),
                ]}
              />
              <Button className="max-sm:hidden" onClick={() => { setEditingId(null); setOpenNew(true); }}>
                <Plus className="h-4 w-4 mr-1" /> Nova OC
              </Button>
            </>
          )}
          {view === "rolos" && (
            <>
              <Button className="max-sm:hidden" variant="outline" onClick={() => setOpenRemover(true)}>
                <Minus className="h-4 w-4 mr-1" />
                <span className="sm:hidden">Metr.</span>
                <span className="hidden sm:inline">Metragem</span>
              </Button>
              <Button className="max-sm:hidden" onClick={() => setOpenRolo(true)}>
                <Plus className="h-4 w-4 mr-1" />
                <span className="sm:hidden">Rolo</span>
                <span className="hidden sm:inline">Novo Rolo</span>
              </Button>
            </>
          )}
        </div>
      </header>

      {view === "ocs" ? (
        <OcTecidoList
          tab={tab}
          setTab={setTab}
          filterEmpresa={filterEmpresa}
          setFilterEmpresa={setFilterEmpresa}
          filterResp={filterResp}
          setFilterResp={setFilterResp}
          empresas={empresas}
          estilistas={estilistas}
          ocs={ocs}
          empresaMap={empresaMap}
          onRowClick={(id) => { setEditingId(id); setOpenNew(true); }}
          onDelete={(oc) => setDeleting(oc)}
          qtdRecebidaByOc={qtdRecebidaByOc}
          alertaBadgeByOc={alertaBadgeByOc}
        />
      ) : (
        <div className="space-y-6">
          <RolosList />
          <AjustesList />
        </div>
      )}

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
          estilistas={estilistas}
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
            <AlertDialogAction onClick={() => deleting && deleteMut.mutate(deleting)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MobileActionBar>
        {view === "ocs" && (
          <Button className="ml-auto" onClick={() => { setEditingId(null); setOpenNew(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nova OC
          </Button>
        )}
        {view === "rolos" && (
          <>
            <Button variant="outline" onClick={() => setOpenRemover(true)}>
              <Minus className="h-4 w-4 mr-1" />
              <span className="sm:hidden">Metr.</span>
              <span className="hidden sm:inline">Metragem</span>
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

function OcDialog({
  ocId, empresas, estilistas, onClose, onSaved, onDelete,
}: {
  ocId: string | null;
  empresas: Empresa[];
  estilistas: Colab[];
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
  const [respMode, setRespMode] = useState<"select" | "text">("select");
  const [tecido2Aberto, setTecido2Aberto] = useState(false);
  const [confirmUnmark, setConfirmUnmark] = useState(false);
  // Dispensa a etiqueta de lavagem POR TECIDO (keyed por artigo_id) no recebimento —
  // cada artigo da OC pode ter, ou não, etiqueta de lavagem.
  const [semEtiquetaPorArtigo, setSemEtiquetaPorArtigo] = useState<Record<string, boolean>>({});

  useQuery({
    queryKey: ["oc-tecido", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      if (!ocId) return null;
      const { data: oc, error: e1 } = await supabase.from("ocs_tecido").select("*").eq("id", ocId).maybeSingle();
      if (e1) throw e1;
      const { data: its, error: e2 } = await supabase.from("ocs_tecido_itens").select("*").eq("oc_tecido_id", ocId);
      if (e2) throw e2;
      if (oc) {
        setDraft({
          numero_pedido: oc.numero_pedido ?? "",
          responsavel_id: oc.responsavel_id,
          responsavel_nome: oc.responsavel_nome ?? "",
          empresa_id: oc.empresa_id,
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
          parcelas_recebimento: (Array.isArray((oc as any).parcelas_recebimento) && (oc as any).parcelas_recebimento.length > 0)
            ? ((oc as any).parcelas_recebimento as { data: string; recebido: boolean }[])
            : [{ data: "", recebido: false }],
        });
        setStatus((oc.status as OCStatus) ?? "encomendado");
        setRespMode(oc.responsavel_id ? "select" : "text");
      }
      const mapped: ItemDraft[] = ((its ?? []) as unknown as OCItem[]).map((i) => ({
        tempId: i.id,
        id: i.id,
        artigo_numero: (i.artigo_numero === 2 ? 2 : 1) as 1 | 2,
        artigo_id: i.artigo_id,
        variante_tecido_id: i.variante_tecido_id ?? "",
        quantidade_pedida: Number(i.quantidade_pedida ?? 0),
        quantidade_recebida: i.quantidade_recebida == null ? null : Number(i.quantidade_recebida),
        rendimento: (i as any).rendimento == null ? null : Number((i as any).rendimento),
        cancelado: !!(i as any).cancelado,
      }));
      setItems(mapped);
      setOriginalItemIds(mapped.map((m) => m.id).filter((x): x is string => !!x));
      if (mapped.some((m) => m.artigo_numero === 2)) setTecido2Aberto(true);

      // Modo Só Rolo + OC recebida: recarrega o destrinchamento por rolo (cada rolo
      // é um ocs_tecido is_rolo vinculado por rolo_origem_item_id), com código e CQ,
      // p/ mostrar destrinchado (não o valor agregado) e permitir editar o CQ por rolo.
      if (modoOcRolo !== "oc" && oc?.status === "recebido") {
        const itemIds = mapped.map((m) => m.id).filter((x): x is string => !!x);
        if (itemIds.length > 0) {
          const { data: rolosData } = await supabase
            .from("ocs_tecido")
            .select("id, rolo_codigo, rolo_origem_item_id, ocs_tecido_itens(id, quantidade_recebida, cancelado, cq_ok, cq_alerta_status, cq_observacao, estoque_tecido_baixas(quantidade))")
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
              usado: ((it0?.estoque_tecido_baixas ?? []) as any[]).length > 0,
              obs: it0?.cq_observacao ?? "",
            });
          }
          if (Object.keys(byOrigem).length > 0) setRolosPorItem(byOrigem);
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
          setRolosPorItem(planned);
          // Recomputa a quantidade recebida do item a partir do planejamento (mantém
          // a validação de "marcar recebido" coerente ao reabrir).
          setItems((prev) => prev.map((i) => (i.id && recebidaByItem[i.id] != null) ? { ...i, quantidade_recebida: recebidaByItem[i.id] } : i));
        }
      }
      return oc;
    },
  });

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
        .select("id, artigo_id, nome_variante, codigo_variante")
        .in("artigo_id", artigoIds);
      if (error) throw error;
      return (data ?? []) as Variante[];
    },
  });
  const variantesByArtigo = useMemo(() => {
    const m: Record<string, Variante[]> = {};
    variantes.forEach((v) => { (m[v.artigo_id] ||= []).push(v); });
    return m;
  }, [variantes]);
  const varianteMap = useMemo(() => Object.fromEntries(variantes.map((v) => [v.id, v])), [variantes]);

  const itemsBy = (n: 1 | 2) => items.filter((i) => i.artigo_numero === n);
  const artigoIdFor = (n: 1 | 2) => itemsBy(n)[0]?.artigo_id ?? null;

  const setArtigo = (n: 1 | 2, artigoId: string) => {
    const rendimentoPadrao = artigoMap[artigoId]?.rendimento ?? null;
    setItems((prev) => [
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
      },
    ]);
  };

  const toggleVariante = (n: 1 | 2, varId: string, checked: boolean) => {
    const artigoId = artigoIdFor(n);
    if (!artigoId) return;
    setItems((prev) => {
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
        },
      ];
    });
  };

  const setQtd = (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number | null) => {
    setItems((prev) => prev.map((i) => i.tempId === tempId ? { ...i, [field]: v } : i));
  };
  // Rendimento é por tecido: aplica o valor a todos os itens do mesmo artigo_numero.
  const setRendimento = (n: 1 | 2, v: number | null) => {
    setItems((prev) => prev.map((i) => i.artigo_numero === n ? { ...i, rendimento: v } : i));
  };
  const toggleCancelado = (tempId: string, value: boolean) => {
    setItems((prev) => prev.map((i) => i.tempId === tempId ? { ...i, cancelado: value } : i));
  };

  const valorPrev = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    return (a?.preco ?? 0) * it.quantidade_pedida;
  };
  const valorReal = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    return (a?.preco ?? 0) * (it.quantidade_recebida ?? 0);
  };
  // Itens cancelados não entram nos totais (nem no valor_real_total persistido,
  // que alimenta as parcelas).
  const totalPrevisto = items.filter((i) => !i.cancelado).reduce((s, i) => s + valorPrev(i), 0);
  const totalReal = items.filter((i) => !i.cancelado).reduce((s, i) => s + valorReal(i), 0);

  const handleSingleUpload = async (file: File, key: keyof Draft) => {
    try {
      const path = await uploadFile(file, key as string);
      setDraft((d) => ({ ...d, [key]: path }));
      toast.success("Arquivo enviado");
    } catch (e: any) { toast.error(e.message); }
  };

  const saveMutation = useMutation({
    mutationFn: async (markReceived: boolean) => {
      if (!draft.data_prevista_entrega) throw new Error("Informe a Data Prevista de Entrega.");
      if (!draft.prazo_pagamento?.trim()) throw new Error("Informe o Prazo de Pagamento.");
      const selecionados = items.filter((i) => i.variante_tecido_id && i.artigo_id);
      if (selecionados.some((i) => !(Number(i.quantidade_pedida) > 0)))
        throw new Error("Informe a quantidade (maior que zero) de cada variante selecionada.");
      const parcelas = draft.parcelas_recebimento ?? [];
      const lastDate = parcelas.length > 0
        ? [...parcelas].map((p) => p.data).filter(Boolean).sort().slice(-1)[0] ?? draft.data_entrega
        : draft.data_entrega;
      const payload: any = {
        numero_pedido: draft.numero_pedido || null,
        responsavel_id: respMode === "select" ? draft.responsavel_id : null,
        responsavel_nome: respMode === "text" ? (draft.responsavel_nome || null) : null,
        empresa_id: draft.empresa_id,
        data_pedido: draft.data_pedido || null,
        data_prevista_entrega: draft.data_prevista_entrega || null,
        prazo_pagamento: draft.prazo_pagamento || null,
        quantidade_prazos: draft.quantidade_prazos,
        observacoes_entrega: draft.observacoes_entrega || null,
        observacoes_defeitos: draft.observacoes_defeitos || null,
        anexo_pedido_url: draft.anexo_pedido_url,
        modelo_sugerido_url: draft.modelo_sugerido_url,
        nf_url: draft.nf_url,
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
      const roloPlanPatch = (tempId: string) =>
        modoOcRolo !== "oc" ? { rolos_planejados: roloPlan(tempId) } : {};
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

      if (isEdit && ocIdLocal) {
        // Diff: UPDATE (com id), INSERT (sem id), DELETE só dos removidos.
        const currentIds = new Set(
          validItems.map((i) => i.id).filter((x): x is string => !!x),
        );
        const toDelete = originalItemIds.filter((id) => !currentIds.has(id));
        const toUpdate = validItems.filter((i) => i.id);
        const toInsert = validItems.filter((i) => !i.id);

        if (toDelete.length > 0) {
          const { error } = await supabase
            .from("ocs_tecido_itens").delete().in("id", toDelete);
          if (error) throw error;
        }
        for (const it of toUpdate) {
          const { error } = await supabase
            .from("ocs_tecido_itens")
            .update({
              artigo_id: it.artigo_id,
              artigo_numero: it.artigo_numero,
              variante_tecido_id: it.variante_tecido_id,
              quantidade_pedida: it.quantidade_pedida,
              quantidade_recebida: recebidaDe(it.tempId, it.quantidade_recebida),
              rendimento: it.rendimento,
              cancelado: it.cancelado,
              ...roloPlanPatch(it.tempId),
            } as any)
            .eq("id", it.id!);
          if (error) throw error;
        }
        if (toInsert.length > 0) {
          const { error } = await supabase
            .from("ocs_tecido_itens")
            .insert(toInsert.map((i) => ({
              oc_tecido_id: ocIdLocal,
              artigo_id: i.artigo_id,
              artigo_numero: i.artigo_numero,
              variante_tecido_id: i.variante_tecido_id,
              quantidade_pedida: i.quantidade_pedida,
              quantidade_recebida: recebidaDe(i.tempId, i.quantidade_recebida),
              rendimento: i.rendimento,
              cancelado: i.cancelado,
              ...roloPlanPatch(i.tempId),
            })) as any);
          if (error) throw error;
        }

        // 2) Depois UPDATE da OC (dispara o trigger já com itens/valor corretos)
        const { error } = await supabase.from("ocs_tecido").update(payload).eq("id", ocIdLocal);
        if (error) throw error;
      } else {
        // INSERT: forçar 'encomendado' para não disparar trigger; inserir itens;
        // se necessário, atualizar para 'recebido' depois.
        const insertPayload = { ...payload, status: "encomendado" };
        const { data, error } = await supabase.from("ocs_tecido").insert(insertPayload).select("id").single();
        if (error) throw error;
        ocIdLocal = data.id;

        if (validItems.length > 0) {
          const { error: itErr } = await supabase
            .from("ocs_tecido_itens")
            .insert(validItems.map((i) => ({
              oc_tecido_id: ocIdLocal,
              artigo_id: i.artigo_id,
              artigo_numero: i.artigo_numero,
              variante_tecido_id: i.variante_tecido_id,
              quantidade_pedida: i.quantidade_pedida,
              quantidade_recebida: recebidaDe(i.tempId, i.quantidade_recebida),
              rendimento: i.rendimento,
              cancelado: i.cancelado,
              ...roloPlanPatch(i.tempId),
            })) as any);
          if (itErr) throw itErr;
        }

        if (finalStatus === "recebido") {
          const { error: upErr } = await supabase
            .from("ocs_tecido")
            .update({ status: "recebido" })
            .eq("id", ocIdLocal);
          if (upErr) throw upErr;
        }
      }

      // Quando a OC fica recebida, recalcula as parcelas. O trigger
      // gerar_parcelas_oc_tecido NÃO regenera se já existir parcela (ex.: ao
      // re-receber depois de desmarcar mantendo uma parcela paga, as demais
      // somem). recalcular_parcelas preserva as pagas e recria as restantes.
      if (finalStatus === "recebido" && ocIdLocal) {
        const { error: recErr } = await supabase.rpc("recalcular_parcelas", {
          _oc_id: ocIdLocal,
          _tipo: "tecido",
        });
        // Best-effort: o status já foi gravado e o trigger já gera as parcelas
        // no primeiro recebimento. Não bloqueia o save se a RPC falhar (hoje
        // exige admin — ver prompt Lovable p/ liberar a qualquer membro do tenant).
        if (recErr) {
          console.warn("recalcular_parcelas (tecido) falhou:", recErr.message);
          toast.warning("OC salva, mas o recálculo de parcelas falhou — confira as contas a pagar desta OC.");
        }
      }

      // Modo só-rolo: gera os rolos a partir do destrinchamento. criar_rolo separa
      // da OC recebida (baixa separacao_rolo) e converte kg→metros — sem duplicar
      // estoque. Best-effort: se falhar, a OC já está recebida (não bloqueia).
      if (modoOcRolo !== "oc" && finalStatus === "recebido" && ocIdLocal && Object.keys(rolosPorItem).length > 0) {
        try {
          const { data: savedItems } = await supabase
            .from("ocs_tecido_itens").select("id, variante_tecido_id, artigo_id").eq("oc_tecido_id", ocIdLocal);
          const itemByVar = new Map((savedItems ?? []).map((it: any) => [it.variante_tecido_id, it]));
          for (const [tempId, rolls] of Object.entries(rolosPorItem)) {
            const di = items.find((x) => x.tempId === tempId);
            if (!di?.variante_tecido_id || di.cancelado) continue;
            const saved = itemByVar.get(di.variante_tecido_id);
            if (!saved) continue;
            const a = di.artigo_id ? artigoMap[di.artigo_id] : null;
            const isKg = a?.unidade_medida === "kg";
            const rend = Number(di.rendimento ?? a?.rendimento ?? 0);
            for (const entry of rolls) {
              if (entry.roloId) continue; // já existe (recarregado) — não recriar p/ não duplicar
              const qtd = Number(String(entry.qtd).replace(",", "."));
              if (!qtd || qtd <= 0) continue;
              const metros = isKg && rend > 0 ? qtd * rend : qtd;
              const { data: codigo } = await supabase.rpc("proximo_codigo_rolo" as any, { _artigo_id: di.artigo_id });
              const { data: novoRoloId, error: rErr } = await supabase.rpc("criar_rolo" as any, {
                _codigo: codigo, _artigo_id: di.artigo_id,
                _variantes: [{ variante_tecido_id: di.variante_tecido_id, metragem: metros }],
                _origem_item_id: saved.id,
              });
              if (rErr) throw rErr;
              // Aplica observação/CQ PLANEJADOS (entrados no encomendado) ao item do
              // rolo recém-criado.
              if (novoRoloId && (entry.obs || entry.cq_ok || entry.cq_alerta)) {
                await supabase.from("ocs_tecido_itens").update({
                  cq_observacao: entry.obs || null,
                  cq_ok: !!entry.cq_ok,
                  cq_alerta_status: entry.cq_alerta ? "alertado" : "sem_alerta",
                } as any).eq("oc_tecido_id", novoRoloId as any);
              }
            }
          }
        } catch (e: any) {
          console.warn("gerar rolos no recebimento:", e?.message);
          toast.warning("OC recebida, mas houve erro ao gerar os rolos: " + (e?.message ?? ""));
        }
      }
    },
    onSuccess: () => {
      toast.success("OC salva");
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
      qc.invalidateQueries({ queryKey: ["ocs_tecido_qtd_recebida"] });
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      qc.invalidateQueries({ queryKey: ["rolos"] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const unmarkReceivedMut = useMutation({
    mutationFn: async () => {
      if (!ocId) return;
      // Modo Só Rolo: reverte os rolos criados no recebimento ANTES de mudar o status,
      // numa transação (RPC) — senão ficam órfãos e re-receber duplica. Bloqueia se
      // algum rolo já estiver em uso (a OC fica recebida, sem efeito colateral).
      if (modoOcRolo !== "oc") {
        const { error: eRolo } = await supabase.rpc("reverter_rolos_oc" as any, { _oc_id: ocId });
        if (eRolo) throw eRolo;
      }
      const { error: e1 } = await supabase
        .from("ocs_tecido")
        .update({ status: "encomendado" })
        .eq("id", ocId);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("parcelas")
        .delete()
        .eq("oc_tecido_id", ocId)
        .neq("status", "pago")
        .is("data_pagamento", null);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("OC voltou para Encomendado.");
      setConfirmUnmark(false);
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
      qc.invalidateQueries({ queryKey: ["ocs_tecido_qtd_recebida"] });
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      qc.invalidateQueries({ queryKey: ["rolos"] });
      qc.invalidateQueries({ queryKey: ["estoque-tecidos"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao desmarcar recebido."),
  });

  // CQ por rolo: grava direto no item do rolo (ocs_tecido_itens.cq_*) e reflete no
  // estado local. Usado pelos toggles/observação de cada rolo recebido.
  const onRoloCq = async (roloItemId: string, patch: { cq_ok?: boolean; cq_alerta?: boolean; obs?: string }) => {
    const dbPatch: Record<string, any> = {};
    if (patch.cq_ok !== undefined) dbPatch.cq_ok = patch.cq_ok;
    if (patch.cq_alerta !== undefined) dbPatch.cq_alerta_status = patch.cq_alerta ? "alertado" : "sem_alerta";
    if (patch.obs !== undefined) dbPatch.cq_observacao = patch.obs || null;
    const { error } = await supabase.from("ocs_tecido_itens").update(dbPatch as any).eq("id", roloItemId);
    if (error) { toast.error(error.message ?? "Erro ao salvar CQ do rolo"); return; }
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
    if (error) { toast.error(error.message ?? "Erro ao cancelar/reabrir rolo"); return; }
    reloadOc();
  };
  // Ajustar a quantidade de um rolo já criado (recalcula a OC).
  const onRoloAjuste = async (roloId: string, novaQtd: number) => {
    const { error } = await supabase.rpc("ajustar_rolo" as any, { _rolo_id: roloId, _nova_qtd: novaQtd });
    if (error) { toast.error(error.message ?? "Erro ao ajustar rolo"); return; }
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
    if (error) toast.error(error.message ?? "Erro ao salvar etiqueta");
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

  const canMarkReceived =
    isEdit &&
    status === "encomendado" &&
    algumaQtdRecebida &&
    todasParcelasOk &&
    todasEtiquetasOk &&
    !!draft.nf_url;

  const getMissingRequirements = (): string[] => {
    const missing: string[] = [];
    if (!algumaQtdRecebida) missing.push("Preencha a quantidade recebida de pelo menos uma variante.");
    if (parcelas.length === 0) {
      missing.push("Defina a quantidade de parcelas de recebimento.");
    } else {
      if (!parcelas.every((p) => !!p.data)) missing.push("Preencha as datas de todas as parcelas de recebimento.");
      if (!parcelas.every((p) => p.recebido === true)) missing.push("Marque todas as parcelas como recebidas.");
    }
    if (!todasEtiquetasOk) missing.push("Anexe a etiqueta de lavagem de todos os artigos.");
    if (!draft.nf_url) missing.push("Anexe a nota fiscal (NF).");
    return missing;
  };

  const handleMarkReceived = () => {
    if (saveMutation.isPending) return; // evita duplo-clique duplicar itens/parcelas
    if (!canMarkReceived) {
      const missing = getMissingRequirements();
      toast.error("Não é possível marcar como recebido:", {
        description: missing.join(" "),
      });
      return;
    }
    saveMutation.mutate(true);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90dvh] overflow-y-auto max-md:w-screen max-md:max-w-none max-md:h-dvh max-md:max-h-dvh max-md:rounded-none max-md:border-0 max-md:p-4 max-md:pb-0 max-md:[&>button]:hidden">
        <DialogHeader>
          <DialogTitle>{isEdit ? `OC ${draft.numero_pedido || ""}` : "Nova OC de Tecido"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <OcTecidoForm
            draft={draft}
            setDraft={setDraft}
            respMode={respMode}
            setRespMode={setRespMode}
            empresas={empresas}
            estilistas={estilistas}
            artigos={artigos}
            variantesByArtigo={variantesByArtigo}
            varianteMap={varianteMap}
            itemsBy={itemsBy}
            artigoIdFor={artigoIdFor}
            setArtigo={setArtigo}
            toggleVariante={toggleVariante}
            setQtd={setQtd}
            setRendimento={setRendimento}
            tecido2Aberto={tecido2Aberto}
            setTecido2Aberto={setTecido2Aberto}
            removeTecido2={() => {
              setItems((p) => p.filter((i) => i.artigo_numero !== 2));
              setTecido2Aberto(false);
            }}
            handleSingleUpload={handleSingleUpload}
          />

          {canShowRecebimento && (
            <OcTecidoRecebimento
              draft={draft}
              setDraft={setDraft}
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
            />
          )}

          {/* No modo Só Rolo o CQ é feito POR ROLO no destrinchamento acima — a seção
              de CQ por item da OC fica redundante. */}
          {isEdit && ocId && modoOcRolo === "oc" && <OcCqSection ocId={ocId} />}
          {isEdit && ocId && <OcNfHistorico ocId={ocId} />}
        </div>

        <div className="flex items-center gap-2 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-4 max-md:border-t max-md:bg-background max-md:px-4 max-md:py-3 max-md:shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
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
                <Button variant="secondary" onClick={handleMarkReceived} disabled={saveMutation.isPending}>
                  Marcar Recebido
                </Button>
              )
            )}
            <Button onClick={() => saveMutation.mutate(false)} disabled={saveMutation.isPending}>
              Salvar
            </Button>
          </div>
        </div>
      </DialogContent>

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
    </Dialog>
  );
}
