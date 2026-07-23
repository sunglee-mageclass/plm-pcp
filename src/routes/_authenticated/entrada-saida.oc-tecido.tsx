import { useEffect, useMemo, useRef, useState } from "react";
import { fmtNum } from "@/lib/format";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scissors, Plus, Minus, ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";
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

import { OcTecidoList } from "@/components/oc-tecido/OcTecidoList";
import { RolosList, RoloDialog, RemoverMetragemDialog, AjustesList } from "@/components/oc-tecido/Rolos";
import { OcCqSection, alertaBadge } from "@/components/oc-tecido/CqTecido";
import { FilterButton } from "@/components/shared/filters";
import { useResponsavelFilter, SENTINEL_UUID } from "@/hooks/useResponsavelFilter";
import { OcTecidoForm } from "@/components/oc-tecido/OcTecidoForm";
import { OcTecidoRecebimento } from "@/components/oc-tecido/OcTecidoRecebimento";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { OcModalShell } from "@/components/shared/OcModalShell";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
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
  const respF = useResponsavelFilter();
  const [filterAlerta, setFilterAlerta] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OC | null>(null);

  const { data: ocs = [] } = useQuery({
    queryKey: ["ocs_tecido", tab, filterEmpresa, respF.tipo, respF.pessoaId, filterAlerta],
    queryFn: async () => {
      // Recebidos trazem o status de alerta dos itens (p/ badge na lista + filtro).
      const sel = tab === "recebido" ? "*, ocs_tecido_itens!oc_tecido_id(cq_alerta_status)" : "*";
      let q = supabase.from("ocs_tecido").select(sel).eq("status", tab).eq("is_rolo" as never, false as never).order("created_at", { ascending: false });
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
      const { error } = await supabase.from("ocs_tecido").delete().eq("id", oc.id);
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
            {/* Subtítulo contextual: explica p/ que serve cada aba (um usuário não entendeu Rolos). */}
            <p className="text-sm text-muted-foreground mt-1">
              {view === "rolos"
                ? "Estoque físico de rolos de tecido: cadastre rolos para ajustar seu inventário ou separe um rolo de uma OC."
                : "Ordens de compra de tecidos."}
            </p>
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
          empresas={empresas}
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
  // Dispensa a etiqueta de lavagem POR TECIDO (keyed por artigo_id) no recebimento —
  // cada artigo da OC pode ter, ou não, etiqueta de lavagem.
  const [semEtiquetaPorArtigo, setSemEtiquetaPorArtigo] = useState<Record<string, boolean>>({});

  // Guarda de "alterações não salvas": compara o rascunho editável (cabeçalho + itens)
  // com um baseline. Re-baseline ao semear a OC (query async) e após salvar (markClean).
  const { dirty: changed, markClean, reset: resetBaseline } = useDirtySnapshot({ draft, items });

  useQuery({
    queryKey: ["oc-tecido", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      if (!ocId) return null;
      const { data: oc, error: e1 } = await supabase.from("ocs_tecido").select("*").eq("id", ocId).maybeSingle();
      if (e1) throw e1;
      const { data: its, error: e2 } = await supabase.from("ocs_tecido_itens").select("*").eq("oc_tecido_id", ocId);
      if (e2) throw e2;
      let nextDraft: Draft | null = null;
      if (oc) {
        nextDraft = {
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
        setDraft(nextDraft);
        setStatus((oc.status as OCStatus) ?? "encomendado");
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
        preco: (i as any).preco == null ? null : Number((i as any).preco),
      }));
      setItems(mapped);
      // Itens finais (após eventual recomputo por rolo abaixo) que alimentam o baseline.
      let finalItems: ItemDraft[] = mapped;
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
          finalItems = mapped.map((i) => (i.id && recebidaByItem[i.id] != null) ? { ...i, quantidade_recebida: recebidaByItem[i.id] } : i);
          setItems(finalItems);
        }
      }
      // Re-baseline no MESMO tick com os valores semeados (o estado recém-setado ainda
      // está stale aqui). Assim uma OC recém-aberta não aparece como "não salva".
      if (nextDraft) resetBaseline({ draft: nextDraft, items: finalItems });
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
        .select("id, artigo_id, nome_variante, codigo_variante, preco, cor:cor_id(nome), apelido:cor_apelido_id(nome)")
        .in("artigo_id", artigoIds);
      if (error) throw error;
      return (data ?? []) as unknown as Variante[]; // types.ts ainda sem variantes_tecido.preco
    },
  });
  const variantesByArtigo = useMemo(() => {
    const m: Record<string, Variante[]> = {};
    variantes.forEach((v) => { (m[v.artigo_id] ||= []).push(v); });
    return m;
  }, [variantes]);
  const varianteMap = useMemo(() => Object.fromEntries(variantes.map((v) => [v.id, v])), [variantes]);

  // Pré-preenche o preço de CADA item com o preço ATUAL da variante (cadastro) quando vier vazio —
  // vale p/ NOVA OC e ao EDITAR (encomendados/recebidos). Só toca o que está null; o usuário edita
  // se o preço desta compra for diferente. Roda quando as variantes/itens carregam.
  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const next = prev.map((i) => {
        if (i.preco == null && i.variante_tecido_id) {
          const p = varianteMap[i.variante_tecido_id]?.preco;
          if (p != null) { changed = true; return { ...i, preco: p }; }
        }
        return i;
      });
      // Ao EDITAR, o preenchimento de preço vindo do cadastro é normalização de carga
      // (não edição do usuário): re-baseline p/ a OC não nascer "não salva".
      if (changed && isEdit) resetBaseline({ draft, items: next });
      return changed ? next : prev;
    });
  }, [varianteMap]);

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
        preco: null,
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
          // Default = preço ATUAL da variante (cadastro); editável (o preço real desta compra).
          preco: varianteMap[varId]?.preco ?? artigoMap[artigoId]?.preco ?? null,
        },
      ];
    });
  };

  const setQtd = (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number | null) => {
    setItems((prev) => prev.map((i) => i.tempId === tempId ? { ...i, [field]: v } : i));
  };
  const setPreco = (tempId: string, v: number | null) => {
    setItems((prev) => prev.map((i) => i.tempId === tempId ? { ...i, preco: v } : i));
  };
  // Preço do tecido (n) aplicado a TODAS as variantes daquele tecido na OC.
  const setPrecoAll = (n: 1 | 2, v: number | null) => {
    setItems((prev) => prev.map((i) => i.artigo_numero === n && i.variante_tecido_id ? { ...i, preco: v } : i));
  };
  // Rendimento é por tecido: aplica o valor a todos os itens do mesmo artigo_numero.
  const setRendimento = (n: 1 | 2, v: number | null) => {
    setItems((prev) => prev.map((i) => i.artigo_numero === n ? { ...i, rendimento: v } : i));
  };
  const toggleCancelado = (tempId: string, value: boolean) => {
    setItems((prev) => prev.map((i) => i.tempId === tempId ? { ...i, cancelado: value } : i));
  };

  // Valor da OC = preço do ITEM desta compra × qtd (fallback p/ o preço do cadastro do artigo
  // quando o item não tem preço). Reflete o preço por variante informado na OC.
  const precoDe = (it: ItemDraft) => it.preco ?? (it.artigo_id ? artigoMap[it.artigo_id]?.preco : null) ?? 0;
  const valorPrev = (it: ItemDraft) => precoDe(it) * it.quantidade_pedida;
  const valorReal = (it: ItemDraft) => precoDe(it) * (it.quantidade_recebida ?? 0);
  // Itens cancelados não entram nos totais (nem no valor_real_total persistido,
  // que alimenta as parcelas).
  const totalPrevisto = items.filter((i) => !i.cancelado).reduce((s, i) => s + valorPrev(i), 0);
  const totalReal = items.filter((i) => !i.cancelado).reduce((s, i) => s + valorReal(i), 0);

  const handleSingleUpload = async (file: File, key: keyof Draft) => {
    try {
      const path = await uploadFile(file, key as string);
      setDraft((d) => ({ ...d, [key]: path }));
      toast.success("Arquivo enviado");
    } catch (e: any) { toast.error(mensagemErro(e)); }
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

      // Save ATÔMICO: header + diff de itens (preserva cq_*/estoque_zerado) + recálculo de
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
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
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

  const canMarkReceived =
    isEdit &&
    status === "encomendado" &&
    algumaQtdRecebida &&
    todasParcelasOk &&
    todasEtiquetasOk &&
    draft.nfs.length > 0;

  const getMissingRequirements = (): string[] => {
    const missing: string[] = [];
    if (!algumaQtdRecebida) missing.push("Preencha a quantidade recebida de pelo menos uma variante.");
    if (parcelas.length === 0) {
      missing.push("Defina a quantidade de parcelas de recebimento.");
    } else {
      if (!parcelas.every((p) => !!p.data)) missing.push("Preencha as datas de todas as parcelas de recebimento.");
      if (!parcelas.every((p) => p.recebido === true)) missing.push("Marque todas as parcelas como recebidas.");
    }
    if (!todasEtiquetasOk) missing.push("Anexe a etiqueta de lavagem de todos os tecidos.");
    if (draft.nfs.length === 0) missing.push("Anexe ao menos uma nota fiscal (NF).");
    return missing;
  };

  // Guarda anti-duplo-clique: o ref é SÍNCRONO (isPending/disabled só atualizam no
  // re-render, então num clique-duplo rápido os dois passariam — e no INSERT criariam 2 OCs).
  const savingRef = useRef(false);
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
    savingRef.current = true;
    saveMutation.mutate(true, { onSettled: () => { savingRef.current = false; } });
  };

  // O OcDialog só monta quando aberto, logo `changed` já basta (sem gate por `open`).
  const dirty = changed;

  return (
    <>
    <OcModalShell isEdit={isEdit} onClose={onClose} dirty={dirty} discardMessage="Há alterações não salvas nesta OC de tecido.">
        <DialogHeader className="shrink-0">
          <DialogTitle>{isEdit ? `OC ${draft.numero_pedido || ""}` : "Nova OC de Tecido"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 min-h-0 overflow-y-auto">
          <OcTecidoForm
            draft={draft}
            setDraft={setDraft}
            empresas={empresas}
            artigos={artigos}
            variantesByArtigo={variantesByArtigo}
            varianteMap={varianteMap}
            itemsBy={itemsBy}
            artigoIdFor={artigoIdFor}
            setArtigo={setArtigo}
            toggleVariante={toggleVariante}
            setQtd={setQtd}
            setPreco={setPreco}
            setPrecoAll={setPrecoAll}
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
                <Button variant="secondary" onClick={handleMarkReceived} disabled={saveMutation.isPending}>
                  Marcar Recebido
                </Button>
              )
            )}
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
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
    </>
  );
}
