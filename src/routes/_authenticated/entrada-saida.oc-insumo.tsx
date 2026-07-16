import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ArrowLeft } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { empresaTemCategoria, ETIQUETA_TOKENS } from "@/lib/fornecedor-categoria";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { FornecedorSelect, type EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import { NfList } from "@/components/oc-tecido/NfList";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/shared/EmptyState";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { fmtNum } from "@/lib/format";
import { Package } from "lucide-react";

export const Route = createFileRoute("/_authenticated/entrada-saida/oc-insumo")({
  component: () => (
    <RequirePermission page="entrada_oc_insumo">
      <OcInsumoPage />
    </RequirePermission>
  ),
});

const BUCKET = "oc-aviamento"; // reusa o bucket p/ NF
async function uploadFile(file: File, prefix: string) {
  const { tenantPrefix, sanitizeStorageName } = await import("@/lib/storage-tenant");
  const tenant = await tenantPrefix();
  const path = `${tenant}/${prefix}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

type OCStatus = "encomendado" | "recebido";
type Variante = { id: string; tamanho: string | null; cor_id: string | null; cor_nome: string | null; preco: number | null };
type EtqOpt = { id: string; nome: string; preco: number | null; formato_tamanho: string; variantes: Variante[] };
type ItemDraft = {
  id?: string;
  etiqueta_id: string | null;
  variante_etiqueta_id: string | null;
  quantidade_pedida: number | null;
  quantidade_recebida: number | null;
  preco: number | null;
  cancelado: boolean;
};

const fmtTam = (t: string, formato: string) => {
  const [num, sig] = t.split("|");
  if (!sig) return t;
  if (formato === "numero") return num;
  if (formato === "letra") return sig;
  return `${sig} · ${num}`;
};
const varLabel = (v: Variante | undefined, formato: string) =>
  v ? ([v.cor_nome, v.tamanho ? fmtTam(v.tamanho, formato) : null].filter(Boolean).join(" · ") || "Único") : "—";

function OcInsumoPage() {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const [tab, setTab] = useState<OCStatus>("encomendado");
  const [openId, setOpenId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);

  const { data: ocs = [] } = useQuery({
    queryKey: ["ocs_etiqueta", tab],
    queryFn: async () => {
      const { data, error } = await supabase.from("ocs_etiqueta" as any).select("*").eq("status", tab).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const ocIds = useMemo(() => ocs.map((o) => o.id), [ocs]);
  const { data: totals = {} } = useQuery({
    queryKey: ["ocs-insumo-totals", ocIds],
    enabled: ocIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("ocs_etiqueta_itens" as any)
        .select("oc_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado").in("oc_etiqueta_id", ocIds);
      const m: Record<string, number> = {};
      for (const r of (data ?? []) as any[]) {
        if (r.cancelado) continue;
        const q = Number(r.quantidade_recebida ?? r.quantidade_pedida ?? 0);
        m[r.oc_etiqueta_id] = (m[r.oc_etiqueta_id] ?? 0) + q * Number(r.preco ?? 0);
      }
      return m;
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options", "insumo"],
    queryFn: async () => {
      const { data } = await supabase.from("empresas")
        .select("id,nome_fantasia,representantes(id, nome),empresa_categorias_fornecedor(categorias_fornecedor(nome))")
        .eq("tipo", "material").order("nome_fantasia");
      return ((data ?? []) as any[]).filter((e) => empresaTemCategoria(e, ETIQUETA_TOKENS))
        .map((e) => ({ id: e.id, nome_fantasia: e.nome_fantasia, representantes: e.representantes ?? [] })) as EmpresaFornecedor[];
    },
  });
  const empresaMap = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome_fantasia])), [empresas]);

  const { data: etiquetas = [] } = useQuery({
    queryKey: ["etiquetas-oc-insumo"],
    queryFn: async () => {
      const { data } = await supabase.from("etiquetas" as any)
        .select("id, nome, preco, formato_tamanho, variantes_etiqueta(id, tamanho, cor_id, preco, cor:cor_id(nome))").order("nome");
      return ((data ?? []) as any[]).map((e) => ({
        id: e.id, nome: e.nome, preco: e.preco, formato_tamanho: e.formato_tamanho ?? "ambos",
        variantes: (e.variantes_etiqueta ?? []).map((v: any) => ({ id: v.id, tamanho: v.tamanho, cor_id: v.cor_id, cor_nome: v.cor?.nome ?? null, preco: v.preco })),
      })) as EtqOpt[];
    },
  });

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex items-start gap-3">
        <Package className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">OC Insumo</h1>
          <p className="text-sm text-muted-foreground">Ordens de compra de insumos (etiquetas/tags), por variante.</p>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          <Button size="sm" variant={tab === "encomendado" ? "secondary" : "ghost"} onClick={() => setTab("encomendado")}>Encomendado</Button>
          <Button size="sm" variant={tab === "recebido" ? "secondary" : "ghost"} onClick={() => setTab("recebido")}>Recebido</Button>
        </div>
        <Button className="ml-auto max-sm:hidden" onClick={() => setOpenNew(true)} disabled={readOnly}><Plus className="h-4 w-4 mr-1" /> Nova OC</Button>
      </div>

      <Card className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nº Pedido</TableHead>
              <TableHead>Fornecedor</TableHead>
              <TableHead>Prazo</TableHead>
              <TableHead className="text-right">Valor</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ocs.length === 0 ? (
              <TableRow><TableCell colSpan={4} className="p-0"><EmptyState icon={Package} title="Nenhuma OC de insumo" description="Crie uma OC de insumo." className="border-0 bg-transparent" /></TableCell></TableRow>
            ) : ocs.map((o) => (
              <TableRow key={o.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setOpenId(o.id)}>
                <TableCell className="font-medium">{o.numero_pedido ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{o.empresa_id ? empresaMap.get(o.empresa_id) ?? "—" : "—"}</TableCell>
                <TableCell><OcPrazoBadge status={o.status} dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} /></TableCell>
                <TableCell className="text-right">R$ {fmtNum(Number((totals as any)[o.id] ?? 0))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <MobileActionBar>
        <Button className="ml-auto" onClick={() => setOpenNew(true)} disabled={readOnly}><Plus className="h-4 w-4 mr-1" /> Nova OC</Button>
      </MobileActionBar>

      {(openNew || openId) && (
        <Sheet open onOpenChange={(o) => { if (!o) { setOpenNew(false); setOpenId(null); } }}>
          <SheetContent className="w-full sm:w-[70vw] sm:max-w-[70vw] overflow-y-auto p-0 max-md:[&>button]:hidden">
            <OcDialog
              ocId={openId}
              empresas={empresas}
              etiquetas={etiquetas}
              onClose={() => { setOpenNew(false); setOpenId(null); }}
              onSaved={() => {
                ["ocs_etiqueta", "ocs-insumo-totals", "parcelas", "sidebar-badges"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
              }}
            />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}

function OcDialog({ ocId, empresas, etiquetas, onClose, onSaved }: {
  ocId: string | null;
  empresas: EmpresaFornecedor[];
  etiquetas: EtqOpt[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const readOnly = useReadOnly();
  const isEdit = !!ocId;
  const etqMap = useMemo(() => Object.fromEntries(etiquetas.map((e) => [e.id, e])), [etiquetas]);

  const [numero, setNumero] = useState("");
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [repId, setRepId] = useState<string | null>(null);
  const [dataPedido, setDataPedido] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dataPrevista, setDataPrevista] = useState("");
  const [dataEntrega, setDataEntrega] = useState("");
  const [prazo, setPrazo] = useState("");
  const [nfs, setNfs] = useState<{ url: string; data?: string }[]>([]);
  const [status, setStatus] = useState<OCStatus>("encomendado");
  const [items, setItems] = useState<ItemDraft[]>([]);
  const savingRef = useRef(false);

  useQuery({
    queryKey: ["oc-insumo", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      const oc = (await supabase.from("ocs_etiqueta" as any).select("*").eq("id", ocId).maybeSingle()).data as any;
      const its = (await supabase.from("ocs_etiqueta_itens" as any).select("*").eq("oc_etiqueta_id", ocId)).data as any[];
      if (oc) {
        setNumero(oc.numero_pedido ?? ""); setEmpresaId(oc.empresa_id); setRepId(oc.representante_id);
        setDataPedido(oc.data_pedido ?? ""); setDataPrevista(oc.data_prevista_entrega ?? ""); setDataEntrega(oc.data_entrega ?? "");
        setPrazo(oc.prazo_pagamento ?? ""); setNfs((oc.nfs ?? []) as any); setStatus((oc.status as OCStatus) ?? "encomendado");
        setItems(((its ?? []) as any[]).map((i) => ({
          id: i.id, etiqueta_id: i.etiqueta_id, variante_etiqueta_id: i.variante_etiqueta_id,
          quantidade_pedida: i.quantidade_pedida, quantidade_recebida: i.quantidade_recebida, preco: i.preco, cancelado: i.cancelado,
        })));
      }
      return oc ?? null;
    },
  });

  const addItem = () => setItems((p) => [...p, { etiqueta_id: null, variante_etiqueta_id: null, quantidade_pedida: null, quantidade_recebida: null, preco: null, cancelado: false }]);
  const updItem = (i: number, patch: Partial<ItemDraft>) => setItems((p) => p.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const rmItem = (i: number) => setItems((p) => p.filter((_, j) => j !== i));

  const save = useMutation({
    mutationFn: async (markReceived: boolean) => {
      const valid = items.filter((i) => i.etiqueta_id);
      const finalStatus: OCStatus = markReceived ? "recebido" : status;
      const payload = {
        numero_pedido: numero || null, empresa_id: empresaId, representante_id: repId,
        data_pedido: dataPedido || null, data_prevista_entrega: dataPrevista || null,
        data_entrega: markReceived ? (dataEntrega || format(new Date(), "yyyy-MM-dd")) : (dataEntrega || null),
        prazo_pagamento: prazo || null, quantidade_prazos: 1,
        nf_url: nfs[0]?.url ?? null, nfs, status: finalStatus,
      };
      const itensPayload = valid.map((i) => ({
        id: i.id ?? null, etiqueta_id: i.etiqueta_id, variante_etiqueta_id: i.variante_etiqueta_id,
        quantidade_pedida: i.quantidade_pedida, quantidade_recebida: markReceived ? (i.quantidade_recebida ?? i.quantidade_pedida) : i.quantidade_recebida,
        preco: i.preco, cancelado: i.cancelado,
      }));
      const { data: savedId, error } = await supabase.rpc("salvar_oc_etiqueta" as any, { _oc_id: isEdit ? ocId : null, _oc: payload, _itens: itensPayload });
      if (error) throw error;
      return savedId as string;
    },
    onSuccess: () => { toast.success("OC salva"); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
  });

  const desmarcar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("desmarcar_recebimento_oc_etiqueta" as any, { _oc_id: ocId });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("OC voltou para Encomendado."); onSaved(); onClose(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro")),
  });

  const doSave = (markReceived: boolean) => {
    if (savingRef.current || save.isPending) return;
    savingRef.current = true;
    save.mutate(markReceived, { onSettled: () => { savingRef.current = false; } });
  };

  return (
    <div className="p-4 sm:p-6 space-y-4 max-sm:pb-24">
      <button onClick={onClose} className="max-sm:hidden text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Voltar</button>
      <h2 className="text-xl font-bold">{isEdit ? "OC de Insumo" : "Nova OC de Insumo"}</h2>

      <div className="grid sm:grid-cols-2 gap-3">
        <div className="grid gap-1"><Label>Nº Pedido</Label><Input value={numero} onChange={(e) => setNumero(e.target.value)} disabled={readOnly} /></div>
        <div className="grid gap-1"><Label>Fornecedor</Label>
          <FornecedorSelect empresas={empresas} empresaId={empresaId} representanteId={repId} onChange={(emp, rep) => { setEmpresaId(emp); setRepId(rep); }} disabled={readOnly} placeholder="Sem fornecedor" />
        </div>
        <div className="grid gap-1"><Label>Data do Pedido</Label><DateField value={dataPedido} onChange={(e) => setDataPedido(e.target.value)} disabled={readOnly} /></div>
        <div className="grid gap-1"><Label>Data Prevista de Entrega</Label><DateField value={dataPrevista} onChange={(e) => setDataPrevista(e.target.value)} disabled={readOnly} /></div>
        <div className="grid gap-1"><Label>Prazo de Pagamento</Label><Input value={prazo} onChange={(e) => setPrazo(e.target.value)} placeholder="ex: 30/60/90" disabled={readOnly} /></div>
      </div>

      <Separator />
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Itens</h3>
        {!readOnly && <Button variant="outline" size="sm" onClick={addItem}><Plus className="h-4 w-4 mr-1" /> Adicionar insumo</Button>}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum item.</p>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => {
            const etq = it.etiqueta_id ? etqMap[it.etiqueta_id] : undefined;
            const vars = etq?.variantes ?? [];
            return (
              <Card key={i} className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Item {i + 1}</span>
                  {!readOnly && <Button size="iconSm" variant="ghost" onClick={() => rmItem(i)} aria-label="Remover"><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  <div className="grid gap-1"><Label className="text-xs">Insumo</Label>
                    <Select value={it.etiqueta_id ?? ""} onValueChange={(v) => updItem(i, { etiqueta_id: v, variante_etiqueta_id: null })} disabled={readOnly}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Insumo" /></SelectTrigger>
                      <SelectContent>{etiquetas.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1"><Label className="text-xs">Variante</Label>
                    <Select value={it.variante_etiqueta_id ?? "__none__"}
                      onValueChange={(v) => { const nv = v === "__none__" ? null : v; const vv = vars.find((x) => x.id === nv); updItem(i, { variante_etiqueta_id: nv, preco: it.preco ?? (vv?.preco ?? etq?.preco ?? null) }); }}
                      disabled={readOnly || vars.length === 0}>
                      <SelectTrigger className="h-8"><SelectValue placeholder={vars.length === 0 ? "Único" : "Variante"} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Único / sem variante</SelectItem>
                        {vars.map((v) => <SelectItem key={v.id} value={v.id}>{varLabel(v, etq?.formato_tamanho ?? "ambos")}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1"><Label className="text-xs">Qtd Pedida</Label>
                    <NumberInput type="number" step="0.01" placeholder="0,00" value={it.quantidade_pedida ?? ""} onChange={(e) => updItem(i, { quantidade_pedida: e.target.value === "" ? null : Number(e.target.value) })} disabled={readOnly} />
                  </div>
                  <div className="grid gap-1"><Label className="text-xs">Preço unit.</Label>
                    <NumberInput type="number" step="0.01" placeholder="0,00" value={it.preco ?? ""} onChange={(e) => updItem(i, { preco: e.target.value === "" ? null : Number(e.target.value) })} disabled={readOnly} />
                  </div>
                  {(status === "recebido" || isEdit) && (
                    <div className="grid gap-1"><Label className="text-xs">Qtd Recebida</Label>
                      <NumberInput type="number" step="0.01" placeholder="0,00" value={it.quantidade_recebida ?? ""} onChange={(e) => updItem(i, { quantidade_recebida: e.target.value === "" ? null : Number(e.target.value) })} disabled={readOnly} />
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {isEdit && (
        <>
          <Separator />
          <h3 className="font-semibold">Recebimento</h3>
          <NfList value={nfs} onChange={setNfs} uploadFn={(f) => uploadFile(f, "nf")} readOnly={readOnly} />
          {status === "recebido" && <Badge variant="secondary" className="mt-1">Recebida</Badge>}
        </>
      )}

      <div className="flex flex-wrap gap-2 justify-end pt-2">
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        {!readOnly && (
          <>
            <Button variant="secondary" onClick={() => doSave(false)} disabled={save.isPending}>Salvar</Button>
            {status === "encomendado" && <Button onClick={() => doSave(true)} disabled={save.isPending}>Salvar e Receber</Button>}
            {isEdit && status === "recebido" && <Button variant="outline" onClick={() => desmarcar.mutate()} disabled={desmarcar.isPending}>Desmarcar recebimento</Button>}
          </>
        )}
      </div>

      <MobileActionBar>
        <Button variant="outline" size="icon" className="mr-auto" onClick={onClose} aria-label="Voltar"><ArrowLeft className="h-4 w-4" /></Button>
        {!readOnly && <Button onClick={() => doSave(false)} disabled={save.isPending}>Salvar</Button>}
      </MobileActionBar>
    </div>
  );
}
