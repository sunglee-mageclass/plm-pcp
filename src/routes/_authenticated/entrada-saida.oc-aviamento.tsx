import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Plus, Upload, Trash2 } from "lucide-react";
import { format, differenceInCalendarDays, parseISO } from "date-fns";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_authenticated/entrada-saida/oc-aviamento")({
  component: OcAviamentoPage,
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
  aviamento_id: string;
  quantidade_pedida: number;
  quantidade_recebida: number | null;
};

function fmtMoney(v: number | null | undefined) {
  if (v == null || isNaN(v as number)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(parseISO(v), "dd/MM/yyyy"); } catch { return v; }
}
function mensagemEntrega(prevista?: string | null, entregue?: string | null) {
  if (!prevista || !entregue) return "—";
  const diff = differenceInCalendarDays(parseISO(entregue), parseISO(prevista));
  if (diff === 0) return "No prazo";
  if (diff > 0) return `Atrasado ${diff} dia${diff > 1 ? "s" : ""}`;
  return `Adiantado ${-diff} dia${-diff > 1 ? "s" : ""}`;
}
async function uploadFile(file: File, prefix: string) {
  const path = `${prefix}/${crypto.randomUUID()}-${file.name}`;
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
    queryKey: ["empresas-opt"],
    queryFn: async () => {
      const { data, error } = await supabase.from("empresas").select("id, nome_fantasia").order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as Empresa[];
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
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">OC de Aviamento</h1>
            <p className="text-sm text-muted-foreground">Ordens de compra de aviamentos.</p>
          </div>
        </div>
        <Button onClick={() => { setEditingId(null); setOpenNew(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Nova OC
        </Button>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as OCStatus)}>
        <TabsList>
          <TabsTrigger value="encomendado">Encomendados</TabsTrigger>
          <TabsTrigger value="recebido">Recebidos</TabsTrigger>
        </TabsList>

        <Card className="p-4 mt-4 flex flex-wrap gap-3 items-end">
          <div className="grid gap-1">
            <Label className="text-xs">Fornecedor</Label>
            <Select value={filterEmpresa} onValueChange={setFilterEmpresa}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {empresas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome_fantasia}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {tab === "encomendado" && (
            <div className="grid gap-1">
              <Label className="text-xs">Responsável</Label>
              <Select value={filterResp} onValueChange={setFilterResp}>
                <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {estilistas.map((e) => <SelectItem key={e.id} value={e.nome}>{e.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </Card>

        <TabsContent value="encomendado" className="mt-4">
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº Pedido</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Data Prevista</TableHead>
                  <TableHead>Valor Previsto</TableHead>
                  <TableHead>Mensagem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ocs.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhuma OC encomendada.</TableCell></TableRow>
                )}
                {ocs.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => { setEditingId(o.id); setOpenNew(true); }}>
                    <TableCell className="font-medium">{o.numero_pedido ?? "—"}</TableCell>
                    <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                    <TableCell>{fmtDate(o.data_prevista_entrega)}</TableCell>
                    <TableCell>{fmtMoney(itemsByOC[o.id]?.previsto ?? 0)}</TableCell>
                    <TableCell><Badge variant="outline">Aguardando</Badge></TableCell>
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
                  <TableHead>Valor Real</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ocs.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhuma OC recebida.</TableCell></TableRow>
                )}
                {ocs.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => { setEditingId(o.id); setOpenNew(true); }}>
                    <TableCell className="font-medium">{o.numero_pedido ?? "—"}</TableCell>
                    <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                    <TableCell>{fmtDate(o.data_entrega)}</TableCell>
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
    </div>
  );
}

/* ============= DIALOG ============= */

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
  const [status, setStatus] = useState<OCStatus>("encomendado");
  const [respMode, setRespMode] = useState<"select" | "text">("select");

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
        });
        setStatus((oc.status as OCStatus) ?? "encomendado");
        const matchEst = estilistas.find((e) => e.nome === oc.responsavel_nome);
        setRespMode(matchEst ? "select" : "text");
        if (matchEst) setDraft((d) => ({ ...d, responsavel_id: matchEst.id }));
      }
      setItems((its ?? []).map((i: any) => ({
        tempId: i.id,
        aviamento_id: i.aviamento_id,
        quantidade_pedida: Number(i.quantidade_pedida ?? 0),
        quantidade_recebida: i.quantidade_recebida == null ? null : Number(i.quantidade_recebida),
      })));
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
    setItems((p) => [...p, { tempId: crypto.randomUUID(), aviamento_id: "", quantidade_pedida: 0, quantidade_recebida: null }]);
  };
  const removeItem = (tempId: string) =>
    setItems((p) => {
      const idx = p.findIndex((i) => i.tempId === tempId);
      if (idx < 0) return p;
      // Remove o item e todos os subsequentes (cascade)
      return p.slice(0, idx);
    });
  const updateItem = (tempId: string, patch: Partial<ItemDraft>) =>
    setItems((p) => p.map((i) => i.tempId === tempId ? { ...i, ...patch } : i));

  const valorPrev = (i: ItemDraft) => Number(aviMap[i.aviamento_id]?.preco ?? 0) * i.quantidade_pedida;
  const valorReal = (i: ItemDraft) => Number(aviMap[i.aviamento_id]?.preco ?? 0) * (i.quantidade_recebida ?? 0);
  const totalPrev = items.reduce((s, i) => s + valorPrev(i), 0);
  const totalReal = items.reduce((s, i) => s + valorReal(i), 0);

  const handleNF = async (file: File) => {
    try {
      const path = await uploadFile(file, "nf");
      setDraft((d) => ({ ...d, nf_url: path }));
      toast.success("NF enviada");
    } catch (e: any) { toast.error(e.message); }
  };

  const saveMutation = useMutation({
    mutationFn: async (markReceived: boolean) => {
      const payload: any = {
        numero_pedido: draft.numero_pedido || null,
        responsavel_nome: respMode === "select"
          ? (draft.responsavel_id ? (estilistas.find((e) => e.id === draft.responsavel_id)?.nome ?? null) : null)
          : (draft.responsavel_nome || null),
        empresa_id: draft.empresa_id,
        data_pedido: draft.data_pedido || null,
        data_prevista_entrega: draft.data_prevista_entrega || null,
        data_entrega: draft.data_entrega || null,
        prazo_pagamento: draft.prazo_pagamento || null,
        quantidade_prazos: draft.quantidade_prazos,
        nf_url: draft.nf_url,
        status: markReceived ? "recebido" : status,
      };

      let ocIdLocal = ocId;
      if (isEdit && ocIdLocal) {
        const { error } = await supabase.from("ocs_aviamento").update(payload).eq("id", ocIdLocal);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("ocs_aviamento").insert(payload).select("id").single();
        if (error) throw error;
        ocIdLocal = data.id;
      }

      if (ocIdLocal) {
        await supabase.from("ocs_aviamento_itens").delete().eq("oc_aviamento_id", ocIdLocal);
        const rows = items
          .filter((i) => i.aviamento_id)
          .map((i) => ({
            oc_aviamento_id: ocIdLocal,
            aviamento_id: i.aviamento_id,
            quantidade_pedida: i.quantidade_pedida,
            quantidade_recebida: i.quantidade_recebida,
          }));
        if (rows.length > 0) {
          const { error } = await supabase.from("ocs_aviamento_itens").insert(rows);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success("OC salva");
      qc.invalidateQueries({ queryKey: ["ocs_aviamento"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const canShowRecebimento = isEdit && status === "encomendado";
  const canMarkReceived =
    canShowRecebimento &&
    !!draft.data_entrega &&
    items.some((i) => (i.quantidade_recebida ?? 0) > 0);

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
              <Label>Prazo de Pagamento</Label>
              <Input value={draft.prazo_pagamento} onChange={(e) => setDraft((d) => ({ ...d, prazo_pagamento: e.target.value }))} placeholder="Ex: 30/60/90" />
            </div>

            <div className="grid gap-1">
              <Label>Data do Pedido</Label>
              <Input type="date" value={draft.data_pedido} onChange={(e) => setDraft((d) => ({ ...d, data_pedido: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label>Data Prevista de Entrega</Label>
              <Input type="date" value={draft.data_prevista_entrega} onChange={(e) => setDraft((d) => ({ ...d, data_prevista_entrega: e.target.value }))} />
            </div>

            <div className="grid gap-1">
              <Label>Qtd de Prazos (1-6)</Label>
              <Input type="number" min={1} max={6} value={draft.quantidade_prazos}
                onChange={(e) => setDraft((d) => ({ ...d, quantidade_prazos: Math.max(1, Math.min(6, Number(e.target.value) || 1)) }))} />
            </div>
          </div>

          <Separator />

          {/* AVIAMENTOS */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">Aviamentos (até 10)</h4>
              <Button size="sm" variant="outline" onClick={addItem} disabled={items.length >= 10}>
                <Plus className="h-4 w-4 mr-1" /> Adicionar
              </Button>
            </div>

            {items.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum aviamento adicionado.</p>
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
                  <TableRow key={i.tempId}>
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
                      <Input type="number" step="0.01" value={i.quantidade_pedida}
                        onChange={(e) => updateItem(i.tempId, { quantidade_pedida: Number(e.target.value) })} />
                    </TableCell>
                    {canShowRecebimento && (
                      <TableCell>
                        <Input type="number" step="0.01" value={i.quantidade_recebida ?? ""}
                          onChange={(e) => updateItem(i.tempId, { quantidade_recebida: e.target.value === "" ? null : Number(e.target.value) })} />
                      </TableCell>
                    )}
                    <TableCell className="text-sm">{fmtMoney(valorPrev(i))}</TableCell>
                    {canShowRecebimento && <TableCell className="text-sm">{fmtMoney(valorReal(i))}</TableCell>}
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => removeItem(i.tempId)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
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
                  <Label>Data da Entrega</Label>
                  <Input type="date" value={draft.data_entrega} onChange={(e) => setDraft((d) => ({ ...d, data_entrega: e.target.value }))} />
                </div>
                <div className="grid gap-1">
                  <Label>Nota Fiscal</Label>
                  {draft.nf_url ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="truncate max-w-[200px]">{draft.nf_url.split("/").pop()}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => setDraft((d) => ({ ...d, nf_url: null }))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
                      <Upload className="h-4 w-4" /> Selecionar arquivo
                      <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && handleNF(e.target.files[0])} />
                    </label>
                  )}
                </div>
              </div>
              <div className="text-sm">
                Mensagem: <Badge variant="outline">{mensagemEntrega(draft.data_prevista_entrega, draft.data_entrega)}</Badge>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          {canShowRecebimento && (
            <Button variant="secondary" onClick={() => saveMutation.mutate(true)} disabled={saveMutation.isPending}>
              Marcar como Recebido
            </Button>
          )}
          <Button onClick={() => saveMutation.mutate(false)} disabled={saveMutation.isPending}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
