import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Plus, Upload, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
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

import { RequirePermission } from "@/components/RequirePermission";
import { FilterButton } from "@/components/shared/filters";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
export const Route = createFileRoute("/_authenticated/entrada-saida/oc-aviamento")({
  component: () => (
    <RequirePermission page="entrada_oc_aviamento">
      <OcAviamentoPage />
    </RequirePermission>
  ),
});

const BUCKET = "oc-aviamento";

type OCStatus = "encomendado" | "recebido";
type Empresa = { id: string; nome_fantasia: string };
type Colab = { id: string; nome: string; tipo: string };
type Aviamento = { id: string; codigo_nome: string; empresa_id: string | null; preco: number | null };

type OC = {
  id: string;
  numero_pedido: string | null;
  responsavel_nome: string | null;
  empresa_id: string | null;
  data_pedido: string | null;
  data_prevista_entrega: string | null;
  data_entrega: string | null;
  prazo_pagamento: string | null;
  quantidade_prazos: number | null;
  nf_url: string | null;
  status: string | null;
};

type ItemDraft = {
  tempId: string;
  id?: string;
  aviamento_id: string;
  quantidade_pedida: number;
  quantidade_recebida: number | null;
  cancelado: boolean;
};

function fmtMoney(v: number | null | undefined) {
  if (v == null || isNaN(v as number)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(parseISO(v), "dd/MM/yyyy"); } catch { return v; }
}
async function uploadFile(file: File, prefix: string) {
  const { tenantPrefix } = await import("@/lib/storage-tenant");
  const tenant = await tenantPrefix();
  const path = `${tenant}/${prefix}/${crypto.randomUUID()}-${file.name}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

function OcAviamentoPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<OCStatus>("encomendado");
  const [filterEmpresa, setFilterEmpresa] = useState<string>("all");
  const [filterResp, setFilterResp] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OC | null>(null);

  const { data: ocs = [] } = useQuery({
    queryKey: ["ocs_aviamento", tab, filterEmpresa, filterResp],
    queryFn: async () => {
      let q = supabase.from("ocs_aviamento").select("*").eq("status", tab).order("created_at", { ascending: false });
      if (filterEmpresa !== "all") q = q.eq("empresa_id", filterEmpresa);
      if (filterResp !== "all") q = q.eq("responsavel_nome", filterResp);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OC[];
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-aviamento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome_fantasia, empresa_categorias_fornecedor!inner(categorias_fornecedor!inner(nome))")
        .eq("empresa_categorias_fornecedor.categorias_fornecedor.nome", "Aviamento")
        .order("nome_fantasia");
      if (error) throw error;
      const seen = new Set<string>();
      return ((data ?? []) as Array<{ id: string; nome_fantasia: string }>)
        .filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
        .map(({ id, nome_fantasia }) => ({ id, nome_fantasia })) as Empresa[];
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
      const { error } = await supabase.from("ocs_aviamento").delete().eq("id", oc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OC excluída.");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["ocs_aviamento"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir."),
  });

  // Compute valores per OC via separate query
  const ocIds = ocs.map((o) => o.id);
  const { data: itemsByOC = {} } = useQuery({
    queryKey: ["ocs-avi-totals", ocIds],
    enabled: ocIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ocs_aviamento_itens")
        .select("oc_aviamento_id, quantidade_pedida, quantidade_recebida, aviamento_id, aviamentos(preco)")
        .in("oc_aviamento_id", ocIds);
      if (error) throw error;
      const map: Record<string, { previsto: number; real: number }> = {};
      (data ?? []).forEach((r: any) => {
        const preco = Number(r.aviamentos?.preco ?? 0);
        const ocid = r.oc_aviamento_id;
        map[ocid] ||= { previsto: 0, real: 0 };
        map[ocid].previsto += Number(r.quantidade_pedida ?? 0) * preco;
        map[ocid].real += Number(r.quantidade_recebida ?? 0) * preco;
      });
      return map;
    },
  });

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight truncate">OC de Aviamento</h1>
            <p className="text-sm text-muted-foreground mt-1">Ordens de compra de aviamentos.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">

          <FilterButton
            filters={[
              { label: "Fornecedor", value: filterEmpresa, onChange: setFilterEmpresa, options: [{ id: "all", nome: "Todos" }, ...empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }))] },
              ...(tab === "encomendado"
                ? [{ label: "Responsável", value: filterResp, onChange: setFilterResp, options: [{ id: "all", nome: "Todos" }, ...estilistas.map((e) => ({ id: e.nome, nome: e.nome }))] }]
                : []),
            ]}
          />
          <Button onClick={() => { setEditingId(null); setOpenNew(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nova OC
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as OCStatus)}>
        <TabsList>
          <TabsTrigger value="encomendado">Encomendados</TabsTrigger>
          <TabsTrigger value="recebido">Recebidos</TabsTrigger>
        </TabsList>

        <TabsContent value="encomendado" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº Pedido</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead><span className="sm:hidden">Data Prev.</span><span className="hidden sm:inline">Data Prevista</span></TableHead>
                  <TableHead><span className="sm:hidden">Valor Prev.</span><span className="hidden sm:inline">Valor Previsto</span></TableHead>
                  <TableHead>Mensagem</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ocs.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma OC encomendada.</TableCell></TableRow>
                )}
                {ocs.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => { setEditingId(o.id); setOpenNew(true); }}>
                    <TableCell className="font-medium">{o.numero_pedido ?? "—"}</TableCell>
                    <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                    <TableCell>{fmtDate(o.data_prevista_entrega)}</TableCell>
                    <TableCell>{fmtMoney(itemsByOC[o.id]?.previsto ?? 0)}</TableCell>
                    <TableCell><OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status="encomendado" /></TableCell>
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); setDeleting(o); }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="recebido" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº Pedido</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Data Entrega</TableHead>
                  <TableHead>Mensagem</TableHead>
                  <TableHead>Valor Real</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ocs.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhuma OC recebida.</TableCell></TableRow>
                )}
                {ocs.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => { setEditingId(o.id); setOpenNew(true); }}>
                    <TableCell className="font-medium">{o.numero_pedido ?? "—"}</TableCell>
                    <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                    <TableCell>{fmtDate(o.data_entrega)}</TableCell>
                    <TableCell><OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status="recebido" /></TableCell>
                    <TableCell>{fmtMoney(itemsByOC[o.id]?.real ?? 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {openNew && (
        <OcDialog
          ocId={editingId}
          empresas={empresas}
          estilistas={estilistas}
          onClose={() => { setOpenNew(false); setEditingId(null); }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["ocs_aviamento"] })}
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
    </div>
  );
}

/* ============= DIALOG ============= */

type ParcelaRecebimento = { data: string; recebido: boolean };
type Draft = {
  numero_pedido: string;
  responsavel_nome: string;
  responsavel_id: string | null;
  empresa_id: string | null;
  data_pedido: string;
  data_prevista_entrega: string;
  data_entrega: string;
  prazo_pagamento: string;
  quantidade_prazos: number;
  nf_url: string | null;
  parcelas_recebimento: ParcelaRecebimento[];
};
function emptyDraft(): Draft {
  return {
    numero_pedido: "",
    responsavel_nome: "",
    responsavel_id: null,
    empresa_id: null,
    data_pedido: format(new Date(), "yyyy-MM-dd"),
    data_prevista_entrega: "",
    data_entrega: "",
    prazo_pagamento: "",
    quantidade_prazos: 1,
    nf_url: null,
    parcelas_recebimento: [{ data: "", recebido: false }],
  };
}

function OcDialog({
  ocId, empresas, estilistas, onClose, onSaved,
}: {
  ocId: string | null;
  empresas: Empresa[];
  estilistas: Colab[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!ocId;
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [originalItemIds, setOriginalItemIds] = useState<string[]>([]);
  const [status, setStatus] = useState<OCStatus>("encomendado");
  const [respMode, setRespMode] = useState<"select" | "text">("select");
  const [confirmUnmark, setConfirmUnmark] = useState(false);

  useQuery({
    queryKey: ["oc-avi", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      if (!ocId) return null;
      const { data: oc, error: e1 } = await supabase.from("ocs_aviamento").select("*").eq("id", ocId).maybeSingle();
      if (e1) throw e1;
      const { data: its, error: e2 } = await supabase.from("ocs_aviamento_itens").select("*").eq("oc_aviamento_id", ocId);
      if (e2) throw e2;
      if (oc) {
        setDraft({
          numero_pedido: oc.numero_pedido ?? "",
          responsavel_nome: oc.responsavel_nome ?? "",
          responsavel_id: null,
          empresa_id: oc.empresa_id,
          data_pedido: oc.data_pedido ?? "",
          data_prevista_entrega: oc.data_prevista_entrega ?? "",
          data_entrega: oc.data_entrega ?? "",
          prazo_pagamento: oc.prazo_pagamento ?? "",
          quantidade_prazos: oc.quantidade_prazos ?? 1,
          nf_url: oc.nf_url,
          parcelas_recebimento: (Array.isArray((oc as any).parcelas_recebimento) && (oc as any).parcelas_recebimento.length > 0)
            ? ((oc as any).parcelas_recebimento as ParcelaRecebimento[])
            : [{ data: "", recebido: false }],
        });
        setStatus((oc.status as OCStatus) ?? "encomendado");
        const matchEst = estilistas.find((e) => e.nome === oc.responsavel_nome);
        setRespMode(matchEst ? "select" : "text");
        if (matchEst) setDraft((d) => ({ ...d, responsavel_id: matchEst.id }));
      }
      const mapped: ItemDraft[] = (its ?? []).map((i: any) => ({
        tempId: i.id,
        id: i.id,
        aviamento_id: i.aviamento_id,
        quantidade_pedida: Number(i.quantidade_pedida ?? 0),
        quantidade_recebida: i.quantidade_recebida == null ? null : Number(i.quantidade_recebida),
        cancelado: !!i.cancelado,
      }));
      setItems(mapped);
      setOriginalItemIds(mapped.map((m) => m.id).filter((x): x is string => !!x));
      return oc;
    },
  });

  const { data: aviamentos = [] } = useQuery({
    queryKey: ["aviamentos-by-empresa", draft.empresa_id],
    queryFn: async () => {
      let q = supabase.from("aviamentos").select("id, codigo_nome, empresa_id, preco").order("codigo_nome");
      if (draft.empresa_id) q = q.eq("empresa_id", draft.empresa_id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Aviamento[];
    },
  });
  const aviMap = useMemo(() => Object.fromEntries(aviamentos.map((a) => [a.id, a])), [aviamentos]);

  const addItem = () => {
    if (items.length >= 10) { toast.error("Máximo de 10 aviamentos por OC"); return; }
    setItems((p) => [...p, { tempId: crypto.randomUUID(), aviamento_id: "", quantidade_pedida: 0, quantidade_recebida: null, cancelado: false }]);
  };
  const removeItem = (tempId: string) =>
    // Remove APENAS o item clicado (não há ordem/cascata entre aviamentos de uma OC).
    setItems((p) => p.filter((i) => i.tempId !== tempId));
  const updateItem = (tempId: string, patch: Partial<ItemDraft>) =>
    setItems((p) => p.map((i) => i.tempId === tempId ? { ...i, ...patch } : i));

  const valorPrev = (i: ItemDraft) => Number(aviMap[i.aviamento_id]?.preco ?? 0) * i.quantidade_pedida;
  const valorReal = (i: ItemDraft) => Number(aviMap[i.aviamento_id]?.preco ?? 0) * (i.quantidade_recebida ?? 0);
  // Itens cancelados não entram nos totais exibidos.
  const totalPrev = items.filter((i) => !i.cancelado).reduce((s, i) => s + valorPrev(i), 0);
  const totalReal = items.filter((i) => !i.cancelado).reduce((s, i) => s + valorReal(i), 0);

  const handleNF = async (file: File) => {
    try {
      const path = await uploadFile(file, "nf");
      setDraft((d) => ({ ...d, nf_url: path }));
      toast.success("NF enviada");
    } catch (e: any) { toast.error(e.message); }
  };

  const saveMutation = useMutation({
    mutationFn: async (markReceived: boolean) => {
      if (!draft.data_prevista_entrega) throw new Error("Informe a Data Prevista de Entrega.");
      if (!draft.prazo_pagamento?.trim()) throw new Error("Informe o Prazo de Pagamento.");
      const selecionados = items.filter((i) => i.aviamento_id);
      if (selecionados.some((i) => !(Number(i.quantidade_pedida) > 0)))
        throw new Error("Informe a quantidade (maior que zero) de cada aviamento.");
      const parcelas = draft.parcelas_recebimento ?? [];
      // Data de entrega = data da última parcela de recebimento (igual à OC Tecido).
      const lastDate = parcelas.length > 0
        ? [...parcelas].map((p) => p.data).filter(Boolean).sort().slice(-1)[0] ?? draft.data_entrega
        : draft.data_entrega;
      const payload: any = {
        numero_pedido: draft.numero_pedido || null,
        responsavel_nome: respMode === "select"
          ? (draft.responsavel_id ? (estilistas.find((e) => e.id === draft.responsavel_id)?.nome ?? null) : null)
          : (draft.responsavel_nome || null),
        empresa_id: draft.empresa_id,
        data_pedido: draft.data_pedido || null,
        data_prevista_entrega: draft.data_prevista_entrega || null,
        data_entrega: markReceived ? (lastDate || null) : (draft.data_entrega || null),
        prazo_pagamento: draft.prazo_pagamento || null,
        quantidade_prazos: draft.quantidade_prazos,
        nf_url: draft.nf_url,
        parcelas_recebimento: parcelas,
        status: markReceived ? "recebido" : status,
      };


      // CRITICAL: salvar itens ANTES de atualizar o status para 'recebido',
      // pois o trigger gerar_parcelas_oc_aviamento lê os itens no momento do UPDATE
      // e tem proteção anti-duplicação (parcelas erradas ficariam permanentes).
      let ocIdLocal = ocId;
      const finalStatus: OCStatus = markReceived ? "recebido" : status;
      const validItems = items.filter((i) => i.aviamento_id);

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
            .from("ocs_aviamento_itens").delete().in("id", toDelete);
          if (error) throw error;
        }
        for (const it of toUpdate) {
          const { error } = await supabase
            .from("ocs_aviamento_itens")
            .update({
              aviamento_id: it.aviamento_id,
              quantidade_pedida: it.quantidade_pedida,
              quantidade_recebida: it.quantidade_recebida,
              cancelado: it.cancelado,
            } as any)
            .eq("id", it.id!);
          if (error) throw error;
        }
        if (toInsert.length > 0) {
          const { error } = await supabase
            .from("ocs_aviamento_itens")
            .insert(toInsert.map((i) => ({
              oc_aviamento_id: ocIdLocal,
              aviamento_id: i.aviamento_id,
              quantidade_pedida: i.quantidade_pedida,
              quantidade_recebida: i.quantidade_recebida,
              cancelado: i.cancelado,
            })) as any);
          if (error) throw error;
        }

        // Depois atualizar a OC (dispara o trigger já com itens corretos)
        const { error } = await supabase.from("ocs_aviamento").update(payload).eq("id", ocIdLocal);
        if (error) throw error;
      } else {
        // INSERT: criar como 'encomendado' (não dispara trigger), inserir itens,
        // depois — se for o caso — atualizar para 'recebido'.
        const insertPayload = { ...payload, status: "encomendado" };
        const { data, error } = await supabase.from("ocs_aviamento").insert(insertPayload).select("id").single();
        if (error) throw error;
        ocIdLocal = data.id;

        if (validItems.length > 0) {
          const { error: itErr } = await supabase
            .from("ocs_aviamento_itens")
            .insert(validItems.map((i) => ({
              oc_aviamento_id: ocIdLocal,
              aviamento_id: i.aviamento_id,
              quantidade_pedida: i.quantidade_pedida,
              quantidade_recebida: i.quantidade_recebida,
              cancelado: i.cancelado,
            })) as any);
          if (itErr) throw itErr;
        }

        if (finalStatus === "recebido") {
          const { error: upErr } = await supabase
            .from("ocs_aviamento")
            .update({ status: "recebido" })
            .eq("id", ocIdLocal);
          if (upErr) throw upErr;
        }
      }

      // Quando a OC fica recebida, recalcula as parcelas. O trigger
      // gerar_parcelas_oc_aviamento NÃO regenera se já existir parcela (ex.: ao
      // re-receber depois de desmarcar mantendo uma parcela paga, as demais
      // somem). recalcular_parcelas preserva as pagas e recria as restantes.
      if (finalStatus === "recebido" && ocIdLocal) {
        const { error: recErr } = await supabase.rpc("recalcular_parcelas", {
          _oc_id: ocIdLocal,
          _tipo: "aviamento",
        });
        // Best-effort: o status já foi gravado e o trigger já gera as parcelas no
        // primeiro recebimento. Não bloqueia o save se a RPC falhar, mas AVISA — uma
        // falha aqui deixa as parcelas a pagar desatualizadas (não pode passar batido).
        if (recErr) {
          console.warn("recalcular_parcelas (aviamento) falhou:", recErr.message);
          toast.warning("OC salva, mas o recálculo de parcelas falhou — confira as contas a pagar desta OC.");
        }
      }
    },
    onSuccess: () => {
      toast.success("OC salva");
      qc.invalidateQueries({ queryKey: ["ocs_aviamento"] });
      qc.invalidateQueries({ queryKey: ["ocs-avi-totals"] });
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const unmarkReceivedMut = useMutation({
    mutationFn: async () => {
      if (!ocId) return;
      const { error: e1 } = await supabase
        .from("ocs_aviamento")
        .update({ status: "encomendado" })
        .eq("id", ocId);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("parcelas")
        .delete()
        .eq("oc_aviamento_id", ocId)
        .neq("status", "pago")
        .is("data_pagamento", null);
      if (e2) throw e2;
    },
    onSuccess: () => {
      toast.success("OC voltou para Encomendado.");
      setConfirmUnmark(false);
      qc.invalidateQueries({ queryKey: ["ocs_aviamento"] });
      qc.invalidateQueries({ queryKey: ["ocs-avi-totals"] });
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao desmarcar recebido."),
  });

  const canShowRecebimento = isEdit && (status === "encomendado" || status === "recebido");
  const isReadOnlyRecebimento = isEdit && status === "recebido";
  const parcelas = draft.parcelas_recebimento ?? [];
  const todasParcelasOk =
    parcelas.length > 0 && parcelas.every((p) => !!p.data && p.recebido === true);
  // Data de entrega derivada da última parcela de recebimento (não se digita à mão).
  const derivedEntrega = parcelas.length > 0
    ? ([...parcelas].map((p) => p.data).filter(Boolean).sort().slice(-1)[0] ?? "")
    : "";
  const canMarkReceived =
    canShowRecebimento &&
    !isReadOnlyRecebimento &&
    items.some((i) => (i.quantidade_recebida ?? 0) > 0) &&
    !!draft.nf_url &&
    todasParcelasOk;

  const getMissingRequirements = (): string[] => {
    const m: string[] = [];
    if (!items.some((i) => (i.quantidade_recebida ?? 0) > 0)) m.push("Preencha a quantidade recebida de pelo menos um aviamento");
    if (!draft.nf_url) m.push("Anexe a nota fiscal");
    if (parcelas.length === 0) {
      m.push("Defina a quantidade de parcelas de recebimento");
    } else {
      if (!parcelas.every((p) => !!p.data)) m.push("Preencha as datas de todas as parcelas de recebimento");
      if (!parcelas.every((p) => p.recebido === true)) m.push("Marque todas as parcelas como recebidas");
    }
    return m;
  };

  const handleMarkReceived = () => {
    if (saveMutation.isPending) return; // evita duplo-clique duplicar itens/parcelas
    if (!canMarkReceived) {
      const missing = getMissingRequirements();
      toast.error("Não é possível marcar como recebido", {
        description: missing.length ? missing.join(" • ") : undefined,
      });
      return;
    }
    saveMutation.mutate(true);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `OC ${draft.numero_pedido || ""}` : "Nova OC de Aviamento"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-1">
              <Label>Número do Pedido</Label>
              <Input value={draft.numero_pedido} onChange={(e) => setDraft((d) => ({ ...d, numero_pedido: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label>Fornecedor</Label>
              <Select value={draft.empresa_id ?? ""} onValueChange={(v) => setDraft((d) => ({ ...d, empresa_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome_fantasia}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1">
              <Label>Responsável</Label>
              <div className="flex gap-2">
                <Select value={respMode} onValueChange={(v) => setRespMode(v as any)}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="select">Estilista</SelectItem>
                    <SelectItem value="text">Livre</SelectItem>
                  </SelectContent>
                </Select>
                {respMode === "select" ? (
                  <Select value={draft.responsavel_id ?? ""} onValueChange={(v) => setDraft((d) => ({ ...d, responsavel_id: v }))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione…" /></SelectTrigger>
                    <SelectContent>
                      {estilistas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input className="flex-1" value={draft.responsavel_nome} onChange={(e) => setDraft((d) => ({ ...d, responsavel_nome: e.target.value }))} />
                )}
              </div>
            </div>

            <div className="grid gap-1">
              <Label>Prazo de Pagamento *</Label>
              <Input
                value={draft.prazo_pagamento}
                onChange={(e) => {
                  const v = e.target.value;
                  const parts = v.split("/").map((s) => s.trim()).filter(Boolean);
                  const q = Math.max(1, Math.min(6, parts.length || 1));
                  setDraft((d) => ({ ...d, prazo_pagamento: v, quantidade_prazos: q }));
                }}
                placeholder="Ex: 30/60/90"
              />
            </div>

            <div className="grid gap-1">
              <Label>Data do Pedido</Label>
              <Input type="date" value={draft.data_pedido} onChange={(e) => setDraft((d) => ({ ...d, data_pedido: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label>Data Prevista de Entrega *</Label>
              <Input type="date" value={draft.data_prevista_entrega} onChange={(e) => setDraft((d) => ({ ...d, data_prevista_entrega: e.target.value }))} />
            </div>


            <div className="grid gap-1">
              <Label>Qtd. Parcelas de Recebimento</Label>
              <NumberInput
                type="number"
                min={1}
                max={24}
                value={draft.parcelas_recebimento?.length || 1}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(24, Number(e.target.value) || 1));
                  setDraft((d) => {
                    const prev = d.parcelas_recebimento ?? [];
                    const next: ParcelaRecebimento[] = Array.from({ length: n }, (_, i) =>
                      prev[i] ?? { data: "", recebido: false },
                    );
                    return { ...d, parcelas_recebimento: next };
                  });
                }}
                disabled={isReadOnlyRecebimento}
              />
            </div>
          </div>

          <Separator />

          {/* AVIAMENTOS */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">Aviamentos (até 10)</h4>
              <Button size="sm" variant="outline" onClick={addItem} disabled={items.length >= 10 || isReadOnlyRecebimento || !draft.empresa_id}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            </div>

            {items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {!draft.empresa_id ? "Selecione o fornecedor acima para adicionar aviamentos." : "Nenhum aviamento adicionado."}
              </p>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aviamento</TableHead>
                  <TableHead className="w-32">Qtd Pedida</TableHead>
                  {canShowRecebimento && <TableHead className="w-32">Qtd Recebida</TableHead>}
                  <TableHead className="w-32">Valor Prev.</TableHead>
                  {canShowRecebimento && <TableHead className="w-32">Valor Real</TableHead>}
                  <TableHead className="w-10"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => (
                  <TableRow key={i.tempId} className={i.cancelado ? "opacity-50" : ""}>
                    <TableCell>
                      <Select value={i.aviamento_id} onValueChange={(v) => updateItem(i.tempId, { aviamento_id: v })}>
                        <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                        <SelectContent>
                          {aviamentos.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {a.codigo_nome} — {fmtMoney(Number(a.preco ?? 0))}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <NumberInput type="number" step="0.01" value={i.quantidade_pedida}
                        disabled={i.cancelado || isReadOnlyRecebimento}
                        onChange={(e) => updateItem(i.tempId, { quantidade_pedida: Number(e.target.value) })} />
                    </TableCell>
                    {canShowRecebimento && (
                      <TableCell>
                        <NumberInput type="number" step="0.01" value={i.quantidade_recebida ?? ""}
                          disabled={i.cancelado}
                          onChange={(e) => updateItem(i.tempId, { quantidade_recebida: e.target.value === "" ? null : Number(e.target.value) })} />
                      </TableCell>
                    )}
                    <TableCell className="text-sm">{fmtMoney(valorPrev(i))}</TableCell>
                    {canShowRecebimento && <TableCell className="text-sm">{fmtMoney(valorReal(i))}</TableCell>}
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {status === "encomendado" && (
                          <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Cancelar item">
                            <Checkbox
                              checked={i.cancelado}
                              onCheckedChange={(c) => updateItem(i.tempId, { cancelado: !!c })}
                            />
                            X
                          </label>
                        )}
                        {!isReadOnlyRecebimento && (
                          <Button size="icon" variant="ghost" onClick={() => removeItem(i.tempId)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex gap-6 justify-end text-sm">
              <div>Total Previsto: <b>{fmtMoney(totalPrev)}</b></div>
              {canShowRecebimento && <div>Total Real: <b>{fmtMoney(totalReal)}</b></div>}
            </div>
          </div>

          {canShowRecebimento && (
            <>
              <Separator />
              <h3 className="text-lg font-semibold">Recebimento</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="grid gap-1">
                  <Label>Data da Entrega <span className="text-xs text-muted-foreground">(última parcela recebida)</span></Label>
                  <Input type="date" value={draft.data_entrega || derivedEntrega} disabled readOnly />
                </div>
                <div className="grid gap-1">
                  <Label>Nota Fiscal</Label>
                  {draft.nf_url ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="truncate max-w-[200px]">{draft.nf_url.split("/").pop()}</Badge>
                      {!isReadOnlyRecebimento && (
                        <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, nf_url: null }))}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ) : (
                    <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
                      <Upload className="h-4 w-4" /> Selecionar arquivo
                      <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && handleNF(e.target.files[0])} />
                    </label>
                  )}
                </div>
              </div>

              <div className="grid gap-2">
                <Label className="text-sm">Parcelas de Recebimento</Label>
                {parcelas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Defina a quantidade de parcelas no campo acima.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {parcelas.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-3 rounded-md border p-2">
                        <span className="text-xs font-medium w-20">Parcela {idx + 1}</span>
                        <Input
                          type="date"
                          className="flex-1 max-w-[200px]"
                          value={p.data}
                          disabled={isReadOnlyRecebimento}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDraft((d) => {
                              const arr = [...(d.parcelas_recebimento ?? [])];
                              arr[idx] = { ...arr[idx], data: val };
                              return { ...d, parcelas_recebimento: arr };
                            });
                          }}
                        />
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox
                            checked={p.recebido}
                            disabled={isReadOnlyRecebimento}
                            onCheckedChange={(checked) => {
                              setDraft((d) => {
                                const arr = [...(d.parcelas_recebimento ?? [])];
                                arr[idx] = { ...arr[idx], recebido: !!checked };
                                return { ...d, parcelas_recebimento: arr };
                              });
                            }}
                          />
                          Recebida
                        </label>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="text-sm">
                <OcPrazoBadge dataPrevista={draft.data_prevista_entrega} dataEntrega={draft.data_entrega} status={status} />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          {canShowRecebimento && (
            // Botão único que alterna: marca quando encomendado, desmarca quando recebido.
            isReadOnlyRecebimento ? (
              <Button variant="outline" onClick={() => setConfirmUnmark(true)} disabled={unmarkReceivedMut.isPending}>
                Desmarcar Recebido
              </Button>
            ) : (
              <Button variant="secondary" onClick={handleMarkReceived} disabled={saveMutation.isPending}>
                Marcar como Recebido
              </Button>
            )
          )}
          <Button onClick={() => saveMutation.mutate(false)} disabled={saveMutation.isPending}>
            Salvar
          </Button>
        </DialogFooter>
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
