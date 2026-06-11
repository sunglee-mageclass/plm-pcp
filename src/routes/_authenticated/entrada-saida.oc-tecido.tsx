import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Scissors, Plus, Upload, Trash2, Search } from "lucide-react";
import { format, differenceInCalendarDays, parseISO } from "date-fns";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export const Route = createFileRoute("/_authenticated/entrada-saida/oc-tecido")({
  component: OcTecidoPage,
});

const BUCKET = "oc-tecido";

type OCStatus = "encomendado" | "recebido";

type Empresa = { id: string; nome_fantasia: string };
type Colab = { id: string; nome: string; tipo: string };
type Artigo = {
  id: string; nome: string; empresa_id: string | null;
  preco: number | null; rendimento: number | null;
  unidade_medida: string | null;
};
type Variante = {
  id: string; artigo_id: string;
  nome_variante: string | null; codigo_variante: string | null;
};
type OCItem = {
  id: string;
  oc_tecido_id: string | null;
  artigo_id: string | null;
  artigo_numero: number | null;
  variante_tecido_id: string | null;
  quantidade_pedida: number | null;
  quantidade_recebida: number | null;
};
type OC = {
  id: string;
  numero_pedido: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  empresa_id: string | null;
  data_pedido: string | null;
  data_prevista_entrega: string | null;
  data_entrega: string | null;
  prazo_pagamento: string | null;
  quantidade_prazos: number | null;
  modelo_sugerido_url: string | null;
  anexo_pedido_url: string | null;
  nf_url: string | null;
  etiqueta_lavagem_urls: string[] | null;
  observacoes_entrega: string | null;
  observacoes_defeitos: string | null;
  status: string | null;
  valor_previsto_total: number | null;
  valor_real_total: number | null;
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

function OcTecidoPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<OCStatus>("encomendado");
  const [filterEmpresa, setFilterEmpresa] = useState<string>("all");
  const [filterResp, setFilterResp] = useState<string>("all");
  const [openNew, setOpenNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: ocs = [] } = useQuery({
    queryKey: ["ocs_tecido", tab, filterEmpresa, filterResp],
    queryFn: async () => {
      let q = supabase.from("ocs_tecido").select("*").eq("status", tab).order("created_at", { ascending: false });
      if (filterEmpresa !== "all") q = q.eq("empresa_id", filterEmpresa);
      if (filterResp !== "all") q = q.eq("responsavel_id", filterResp);
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
  const colabMap = useMemo(() => Object.fromEntries(estilistas.map((e) => [e.id, e.nome])), [estilistas]);

  const valorPreviso = (oc: OC) => oc.valor_previsto_total ?? 0;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Scissors className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">OC de Tecido</h1>
            <p className="text-sm text-muted-foreground">Ordens de compra de tecidos.</p>
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
                  {estilistas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
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
                    <TableCell>{fmtMoney(valorPreviso(o))}</TableCell>
                    <TableCell><Badge variant="outline">Aguardando</Badge></TableCell>
                    <TableCell></TableCell>
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
                    <TableCell>{fmtMoney(o.valor_real_total)}</TableCell>
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
          empresaMap={empresaMap}
          colabMap={colabMap}
          onClose={() => { setOpenNew(false); setEditingId(null); }}
          onSaved={() => { qc.invalidateQueries({ queryKey: ["ocs_tecido"] }); }}
        />
      )}
    </div>
  );
}

/* ============ OC DIALOG ============ */

type Draft = {
  numero_pedido: string;
  responsavel_id: string | null;
  responsavel_nome: string;
  empresa_id: string | null;
  data_pedido: string;
  data_prevista_entrega: string;
  prazo_pagamento: string;
  quantidade_prazos: number;
  observacoes_entrega: string;
  observacoes_defeitos: string;
  data_entrega: string;
  anexo_pedido_url: string | null;
  modelo_sugerido_url: string | null;
  nf_url: string | null;
  etiqueta_lavagem_urls: string[];
};

type ItemDraft = {
  tempId: string;
  id?: string; // existing id
  artigo_numero: 1 | 2;
  artigo_id: string | null;
  variante_tecido_id: string;
  quantidade_pedida: number;
  quantidade_recebida: number | null;
};

function emptyDraft(): Draft {
  return {
    numero_pedido: "",
    responsavel_id: null,
    responsavel_nome: "",
    empresa_id: null,
    data_pedido: format(new Date(), "yyyy-MM-dd"),
    data_prevista_entrega: "",
    prazo_pagamento: "",
    quantidade_prazos: 1,
    observacoes_entrega: "",
    observacoes_defeitos: "",
    data_entrega: "",
    anexo_pedido_url: null,
    modelo_sugerido_url: null,
    nf_url: null,
    etiqueta_lavagem_urls: [],
  };
}

function OcDialog({
  ocId, empresas, estilistas, empresaMap, colabMap, onClose, onSaved,
}: {
  ocId: string | null;
  empresas: Empresa[];
  estilistas: Colab[];
  empresaMap: Record<string, string>;
  colabMap: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!ocId;
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [items, setItems] = useState<ItemDraft[]>([]);
  const [status, setStatus] = useState<OCStatus>("encomendado");
  const [respMode, setRespMode] = useState<"select" | "text">("select");
  const [tecido2Aberto, setTecido2Aberto] = useState(false);

  // Load existing
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
          etiqueta_lavagem_urls: oc.etiqueta_lavagem_urls ?? [],
        });
        setStatus((oc.status as OCStatus) ?? "encomendado");
        setRespMode(oc.responsavel_id ? "select" : "text");
      }
      const mapped: ItemDraft[] = (its ?? []).map((i: OCItem) => ({
        tempId: i.id,
        id: i.id,
        artigo_numero: (i.artigo_numero === 2 ? 2 : 1) as 1 | 2,
        artigo_id: i.artigo_id,
        variante_tecido_id: i.variante_tecido_id ?? "",
        quantidade_pedida: Number(i.quantidade_pedida ?? 0),
        quantidade_recebida: i.quantidade_recebida == null ? null : Number(i.quantidade_recebida),
      }));
      setItems(mapped);
      if (mapped.some((m) => m.artigo_numero === 2)) setTecido2Aberto(true);
      return oc;
    },
  });

  // Artigos filtered by empresa
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

  /* ---------- helpers tecido groups ---------- */
  const itemsBy = (n: 1 | 2) => items.filter((i) => i.artigo_numero === n);
  const artigoIdFor = (n: 1 | 2) => itemsBy(n)[0]?.artigo_id ?? null;

  const setArtigo = (n: 1 | 2, artigoId: string) => {
    setItems((prev) => [
      ...prev.filter((i) => i.artigo_numero !== n),
      {
        tempId: crypto.randomUUID(),
        artigo_numero: n,
        artigo_id: artigoId,
        variante_tecido_id: "",
        quantidade_pedida: 0,
        quantidade_recebida: null,
      },
    ]);
  };


  const toggleVariante = (n: 1 | 2, varId: string, checked: boolean) => {
    const artigoId = artigoIdFor(n);
    if (!artigoId) return;
    setItems((prev) => {
      const others = prev.filter((i) => !(i.artigo_numero === n && i.variante_tecido_id === varId));
      const placeholder = prev.find((i) => i.artigo_numero === n && !i.variante_tecido_id);
      const base = placeholder ? prev.filter((i) => i !== placeholder || i.artigo_numero !== n || i.variante_tecido_id) : prev;
      void base;
      if (!checked) return others;
      // limit 10 selected per artigo
      const selectedCount = prev.filter((i) => i.artigo_numero === n && i.variante_tecido_id).length;
      if (selectedCount >= 10) { toast.error("Limite de 10 variantes por tecido"); return prev; }
      return [
        ...others.filter((i) => i.artigo_numero !== n || i.variante_tecido_id),
        {
          tempId: crypto.randomUUID(),
          artigo_numero: n,
          artigo_id: artigoId,
          variante_tecido_id: varId,
          quantidade_pedida: 0,
          quantidade_recebida: null,
        },
      ];
    });
  };

  const setQtd = (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number) => {
    setItems((prev) => prev.map((i) => i.tempId === tempId ? { ...i, [field]: v } : i));
  };

  /* ---------- computed totals ---------- */
  const metragemPedida = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    if (!a) return 0;
    return a.unidade_medida === "kg" ? it.quantidade_pedida * Number(a.rendimento ?? 0) : it.quantidade_pedida;
  };
  const metragemRecebida = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    if (!a || it.quantidade_recebida == null) return 0;
    return a.unidade_medida === "kg" ? it.quantidade_recebida * Number(a.rendimento ?? 0) : it.quantidade_recebida;
  };
  const valorPrev = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    return (a?.preco ?? 0) * it.quantidade_pedida;
  };
  const valorReal = (it: ItemDraft) => {
    const a = it.artigo_id ? artigoMap[it.artigo_id] : null;
    return (a?.preco ?? 0) * (it.quantidade_recebida ?? 0);
  };
  const totalPrevisto = items.reduce((s, i) => s + valorPrev(i), 0);
  const totalReal = items.reduce((s, i) => s + valorReal(i), 0);

  /* ---------- upload helpers ---------- */
  const handleSingleUpload = async (file: File, key: keyof Draft) => {
    try {
      const path = await uploadFile(file, key as string);
      setDraft((d) => ({ ...d, [key]: path }));
      toast.success("Arquivo enviado");
    } catch (e: any) { toast.error(e.message); }
  };
  const handleEtiquetaUpload = async (file: File) => {
    try {
      const path = await uploadFile(file, "etiqueta");
      setDraft((d) => ({ ...d, etiqueta_lavagem_urls: [...d.etiqueta_lavagem_urls, path].slice(0, 2) }));
      toast.success("Etiqueta enviada");
    } catch (e: any) { toast.error(e.message); }
  };

  /* ---------- save ---------- */
  const saveMutation = useMutation({
    mutationFn: async (markReceived: boolean) => {
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
        etiqueta_lavagem_urls: draft.etiqueta_lavagem_urls,
        data_entrega: draft.data_entrega || null,
        valor_previsto_total: totalPrevisto,
        valor_real_total: totalReal,
        status: markReceived ? "recebido" : status,
      };

      let ocIdLocal = ocId;
      if (isEdit && ocIdLocal) {
        const { error } = await supabase.from("ocs_tecido").update(payload).eq("id", ocIdLocal);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("ocs_tecido").insert(payload).select("id").single();
        if (error) throw error;
        ocIdLocal = data.id;
      }

      // Items: simple strategy — delete all & reinsert
      if (ocIdLocal) {
        await supabase.from("ocs_tecido_itens").delete().eq("oc_tecido_id", ocIdLocal);
        const rows = items
          .filter((i) => i.variante_tecido_id && i.artigo_id)
          .map((i) => ({
            oc_tecido_id: ocIdLocal,
            artigo_id: i.artigo_id,
            artigo_numero: i.artigo_numero,
            variante_tecido_id: i.variante_tecido_id,
            quantidade_pedida: i.quantidade_pedida,
            quantidade_recebida: i.quantidade_recebida,
          }));
        if (rows.length > 0) {
          const { error } = await supabase.from("ocs_tecido_itens").insert(rows);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      toast.success("OC salva");
      qc.invalidateQueries({ queryKey: ["ocs_tecido"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  const canShowRecebimento = isEdit && status === "encomendado";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `OC ${draft.numero_pedido || ""}` : "Nova OC de Tecido"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* HEADER FIELDS */}
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
              <Input value={draft.prazo_pagamento} onChange={(e) => {
                const v = e.target.value;
                const parts = v.split(/[\/,\-\s]+/).filter((p) => p.trim() !== "" && !isNaN(Number(p)));
                const qtd = parts.length > 0 ? Math.max(1, Math.min(6, parts.length)) : 1;
                setDraft((d) => ({ ...d, prazo_pagamento: v, quantidade_prazos: qtd }));
              }} placeholder="Ex: 30/60/90" />
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

          {/* TECIDOS */}
          <Separator />
          <TecidoGroup
            n={1}
            artigos={artigos}
            artigoId={artigoIdFor(1)}
            onArtigoChange={(id) => setArtigo(1, id)}
            variantes={artigoIdFor(1) ? variantesByArtigo[artigoIdFor(1)!] ?? [] : []}
            items={itemsBy(1).filter((i) => i.variante_tecido_id)}
            toggleVariante={(vid, c) => toggleVariante(1, vid, c)}
            setQtd={setQtd}
            varianteMap={varianteMap}
          />

          {!tecido2Aberto ? (
            <Button variant="outline" onClick={() => setTecido2Aberto(true)}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar Tecido 2
            </Button>
          ) : (
            <>
              <TecidoGroup
                n={2}
                artigos={artigos}
                artigoId={artigoIdFor(2)}
                onArtigoChange={(id) => setArtigo(2, id)}
                variantes={artigoIdFor(2) ? variantesByArtigo[artigoIdFor(2)!] ?? [] : []}
                items={itemsBy(2).filter((i) => i.variante_tecido_id)}
                toggleVariante={(vid, c) => toggleVariante(2, vid, c)}
                setQtd={setQtd}
                varianteMap={varianteMap}
              />
              <Button variant="ghost" size="sm" onClick={() => {
                setItems((p) => p.filter((i) => i.artigo_numero !== 2));
                setTecido2Aberto(false);
              }}><Trash2 className="h-4 w-4 mr-1" /> Remover Tecido 2</Button>
            </>
          )}

          {/* UPLOADS */}
          <Separator />
          <div className="grid sm:grid-cols-2 gap-4">
            <FileField label="Anexo do Pedido" path={draft.anexo_pedido_url}
              onChange={(f) => handleSingleUpload(f, "anexo_pedido_url")}
              onClear={() => setDraft((d) => ({ ...d, anexo_pedido_url: null }))} />
            <FileField label="Modelo Sugerido" path={draft.modelo_sugerido_url}
              onChange={(f) => handleSingleUpload(f, "modelo_sugerido_url")}
              onClear={() => setDraft((d) => ({ ...d, modelo_sugerido_url: null }))} />
          </div>

          <div className="grid gap-1">
            <Label>Observações sobre Entrega</Label>
            <Textarea value={draft.observacoes_entrega} onChange={(e) => setDraft((d) => ({ ...d, observacoes_entrega: e.target.value }))} />
          </div>

          {/* RECEBIMENTO SECTION (existing encomendado) */}
          {canShowRecebimento && (
            <>
              <Separator />
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Recebimento</h3>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="grid gap-1">
                    <Label>Data da Entrega</Label>
                    <Input type="date" value={draft.data_entrega} onChange={(e) => setDraft((d) => ({ ...d, data_entrega: e.target.value }))} />
                  </div>
                  <FileField label="Nota Fiscal" path={draft.nf_url}
                    onChange={(f) => handleSingleUpload(f, "nf_url")}
                    onClear={() => setDraft((d) => ({ ...d, nf_url: null }))} />
                </div>

                <div className="grid gap-2">
                  <Label>Etiquetas de Lavagem (até 2)</Label>
                  <div className="flex flex-wrap gap-2">
                    {draft.etiqueta_lavagem_urls.map((p, i) => (
                      <Badge key={i} variant="secondary" className="gap-2">
                        {p.split("/").pop()}
                        <button onClick={() => setDraft((d) => ({ ...d, etiqueta_lavagem_urls: d.etiqueta_lavagem_urls.filter((_, j) => j !== i) }))}>
                          ×
                        </button>
                      </Badge>
                    ))}
                    {draft.etiqueta_lavagem_urls.length < 2 && (
                      <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-1.5 cursor-pointer hover:bg-accent">
                        <Upload className="h-4 w-4" /> Adicionar
                        <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && handleEtiquetaUpload(e.target.files[0])} />
                      </label>
                    )}
                  </div>
                </div>

                <div className="grid gap-1">
                  <Label>Observações sobre Defeitos</Label>
                  <Textarea value={draft.observacoes_defeitos} onChange={(e) => setDraft((d) => ({ ...d, observacoes_defeitos: e.target.value }))} />
                </div>

                {/* Per-variant qty recebida + computed */}
                <Card className="p-3">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tecido / Variante</TableHead>
                        <TableHead>Qtd Pedida</TableHead>
                        <TableHead>Qtd Recebida</TableHead>
                        <TableHead>Metr. Pedida</TableHead>
                        <TableHead>Metr. Recebida</TableHead>
                        <TableHead>Valor Prev.</TableHead>
                        <TableHead>Valor Real</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.filter((i) => i.variante_tecido_id).map((i) => {
                        const a = i.artigo_id ? artigoMap[i.artigo_id] : null;
                        const v = varianteMap[i.variante_tecido_id];
                        return (
                          <TableRow key={i.tempId}>
                            <TableCell>
                              <div className="text-sm">{a?.nome ?? "—"}</div>
                              <div className="text-xs text-muted-foreground">{v?.nome_variante ?? v?.codigo_variante ?? "—"}</div>
                            </TableCell>
                            <TableCell>{i.quantidade_pedida}</TableCell>
                            <TableCell>
                              <Input type="number" step="0.01" className="w-24"
                                value={i.quantidade_recebida ?? ""}
                                onChange={(e) => setQtd(i.tempId, "quantidade_recebida", Number(e.target.value))} />
                            </TableCell>
                            <TableCell>{metragemPedida(i).toFixed(2)}</TableCell>
                            <TableCell>{metragemRecebida(i).toFixed(2)}</TableCell>
                            <TableCell>{fmtMoney(valorPrev(i))}</TableCell>
                            <TableCell>{fmtMoney(valorReal(i))}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                  <div className="flex gap-6 justify-end mt-3 text-sm">
                    <div>Total Previsto: <b>{fmtMoney(totalPrevisto)}</b></div>
                    <div>Total Real: <b>{fmtMoney(totalReal)}</b></div>
                    <div>Mensagem: <Badge variant="outline">{mensagemEntrega(draft.data_prevista_entrega, draft.data_entrega)}</Badge></div>
                  </div>
                </Card>
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

/* ====== Tecido Group component ====== */

function TecidoGroup({
  n, artigos, artigoId, onArtigoChange, variantes, items, toggleVariante, setQtd, varianteMap,
}: {
  n: 1 | 2;
  artigos: Artigo[];
  artigoId: string | null;
  onArtigoChange: (id: string) => void;
  variantes: Variante[];
  items: ItemDraft[];
  toggleVariante: (vid: string, checked: boolean) => void;
  setQtd: (tempId: string, field: "quantidade_pedida" | "quantidade_recebida", v: number) => void;
  varianteMap: Record<string, Variante>;
}) {
  const [search, setSearch] = useState("");
  const filteredArtigos = artigos.filter((a) => a.nome.toLowerCase().includes(search.toLowerCase()));
  const selectedIds = new Set(items.map((i) => i.variante_tecido_id));

  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold">Tecido {n}</h4>
      </div>
      <div className="grid gap-1">
        <Label>Artigo</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input className="pl-8" placeholder="Pesquisar artigo…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select value={artigoId ?? ""} onValueChange={onArtigoChange}>
            <SelectTrigger className="w-72"><SelectValue placeholder="Selecionar artigo…" /></SelectTrigger>
            <SelectContent>
              {filteredArtigos.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {artigoId && (
        <>
          <div className="grid gap-1">
            <Label>Variantes (até 10)</Label>
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 max-h-56 overflow-y-auto border rounded-md p-2">
              {variantes.length === 0 && <div className="text-xs text-muted-foreground col-span-full">Sem variantes cadastradas.</div>}
              {variantes.map((v) => {
                const checked = selectedIds.has(v.id);
                return (
                  <label key={v.id} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={checked} onCheckedChange={(c) => toggleVariante(v.id, !!c)} />
                    <span>{v.nome_variante ?? v.codigo_variante ?? v.id.slice(0, 8)}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {items.length > 0 && (
            <div className="space-y-2">
              <Label>Quantidades</Label>
              {items.map((i) => {
                const v = varianteMap[i.variante_tecido_id];
                return (
                  <div key={i.tempId} className="flex items-center gap-3">
                    <span className="text-sm flex-1">{v?.nome_variante ?? v?.codigo_variante ?? "—"}</span>
                    <Input type="number" step="0.01" className="w-32"
                      value={i.quantidade_pedida}
                      onChange={(e) => setQtd(i.tempId, "quantidade_pedida", Number(e.target.value))} />
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ===== File field ===== */
function FileField({ label, path, onChange, onClear }: {
  label: string;
  path: string | null;
  onChange: (f: File) => void;
  onClear: () => void;
}) {
  return (
    <div className="grid gap-1">
      <Label>{label}</Label>
      {path ? (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="truncate max-w-[200px]">{path.split("/").pop()}</Badge>
          <Button size="sm" variant="ghost" onClick={onClear}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ) : (
        <label className="inline-flex items-center gap-2 text-sm border rounded-md px-3 py-2 cursor-pointer hover:bg-accent w-fit">
          <Upload className="h-4 w-4" /> Selecionar arquivo
          <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && onChange(e.target.files[0])} />
        </label>
      )}
    </div>
  );
}
