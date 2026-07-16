import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, ArrowLeft, Package, X } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { empresaTemCategoria, ETIQUETA_TOKENS } from "@/lib/fornecedor-categoria";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { FornecedorSelect, type EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import { ResponsavelSelect } from "@/components/shared/ResponsavelSelect";
import { FilterButton } from "@/components/shared/filters";
import { useResponsavelFilter, SENTINEL_NOME } from "@/hooks/useResponsavelFilter";
import { NfList } from "@/components/oc-tecido/NfList";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { fmtNum } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/entrada-saida/oc-insumo")({
  component: () => (
    <RequirePermission page="entrada_oc_insumo">
      <OcInsumoPage />
    </RequirePermission>
  ),
});

const BUCKET = "oc-aviamento";
async function uploadFile(file: File, prefix: string) {
  const { tenantPrefix, sanitizeStorageName } = await import("@/lib/storage-tenant");
  const tenant = await tenantPrefix();
  const path = `${tenant}/${prefix}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

type OCStatus = "encomendado" | "recebido";
type ParcelaRec = { data: string; recebido: boolean };
type Variante = { id: string; tamanho: string | null; cor_id: string | null; cor_nome: string | null; preco: number | null };
type EtqOpt = { id: string; nome: string; preco: number | null; formato_tamanho: string; variantes: Variante[] };
// linha de variante (checkbox + qtds + preço) dentro do bloco de um insumo
type VarRow = { itemId?: string; varianteId: string | null; corId: string | null; corNome: string | null; tamanho: string | null; label: string; incluido: boolean; qtdPedida: number | null; qtdRecebida: number | null; preco: number | null };
type Block = { etiquetaId: string; selectedCores: string[]; rows: VarRow[] };

const fmtMoney = (v: number | null | undefined) => `R$ ${fmtNum(Number(v ?? 0))}`;
const fmtDate = (v: string | null | undefined) => (v ? format(parseISO(v), "dd/MM/yyyy") : "—");
const fmtTam = (t: string, formato: string) => {
  const [num, sig] = t.split("|");
  if (!sig) return t;
  if (formato === "numero") return num;
  if (formato === "letra") return sig;
  return `${sig} · ${num}`;
};
const rowLabel = (v: Variante, formato: string) =>
  [v.cor_nome, v.tamanho ? fmtTam(v.tamanho, formato) : null].filter(Boolean).join(" · ") || "Único";
const coresOf = (etq?: EtqOpt) => {
  const m = new Map<string, string | null>();
  for (const v of etq?.variantes ?? []) if (v.cor_id) m.set(v.cor_id, v.cor_nome);
  return [...m].map(([id, nome]) => ({ id, nome: nome ?? "Cor" }));
};
const hasTam = (etq?: EtqOpt) => (etq?.variantes ?? []).some((v) => v.tamanho);

function OcInsumoPage() {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const [tab, setTab] = useState<OCStatus>("encomendado");
  const [filterEmpresa, setFilterEmpresa] = useState<string>("all");
  const respF = useResponsavelFilter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);

  const { data: ocs = [] } = useQuery({
    queryKey: ["ocs_etiqueta", tab, filterEmpresa, respF.tipo, respF.pessoaId],
    queryFn: async () => {
      let q = supabase.from("ocs_etiqueta" as any).select("*").eq("status", tab).order("created_at", { ascending: false });
      if (filterEmpresa !== "all") q = q.eq("empresa_id", filterEmpresa);
      if (respF.nomesFiltro) q = q.in("responsavel_nome", respF.nomesFiltro.length ? respF.nomesFiltro : [SENTINEL_NOME]);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });
  const ocIds = useMemo(() => ocs.map((o) => o.id), [ocs]);
  const { data: totals = {} } = useQuery({
    queryKey: ["ocs-insumo-totals", ocIds],
    enabled: ocIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("ocs_etiqueta_itens" as any).select("oc_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado").in("oc_etiqueta_id", ocIds);
      const m: Record<string, { previsto: number; real: number }> = {};
      for (const r of (data ?? []) as any[]) {
        if (r.cancelado) continue;
        const e = (m[r.oc_etiqueta_id] ??= { previsto: 0, real: 0 });
        e.previsto += Number(r.quantidade_pedida ?? 0) * Number(r.preco ?? 0);
        e.real += Number(r.quantidade_recebida ?? r.quantidade_pedida ?? 0) * Number(r.preco ?? 0);
      }
      return m;
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options", "insumo"],
    queryFn: async () => {
      const { data } = await supabase.from("empresas").select("id,nome_fantasia,representantes(id, nome),empresa_categorias_fornecedor(categorias_fornecedor(nome))").eq("tipo", "material").order("nome_fantasia");
      return ((data ?? []) as any[]).filter((e) => empresaTemCategoria(e, ETIQUETA_TOKENS)).map((e) => ({ id: e.id, nome_fantasia: e.nome_fantasia, representantes: e.representantes ?? [] })) as EmpresaFornecedor[];
    },
  });
  const empresaMap = useMemo(() => Object.fromEntries(empresas.map((e) => [e.id, e.nome_fantasia])), [empresas]);

  const { data: etiquetas = [] } = useQuery({
    queryKey: ["etiquetas-oc-insumo"],
    queryFn: async () => {
      const { data } = await supabase.from("etiquetas" as any).select("id, nome, preco, formato_tamanho, variantes_etiqueta(id, tamanho, cor_id, preco, cor:cor_id(nome))").order("nome");
      return ((data ?? []) as any[]).map((e) => ({
        id: e.id, nome: e.nome, preco: e.preco, formato_tamanho: e.formato_tamanho ?? "ambos",
        variantes: (e.variantes_etiqueta ?? []).map((v: any) => ({ id: v.id, tamanho: v.tamanho, cor_id: v.cor_id, cor_nome: v.cor?.nome ?? null, preco: v.preco })),
      })) as EtqOpt[];
    },
  });

  const invalidate = () => ["ocs_etiqueta", "ocs-insumo-totals", "parcelas", "sidebar-badges", "estoque_etiqueta"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const deleteMut = useMutation({
    mutationFn: async (oc: any) => { const { error } = await supabase.from("ocs_etiqueta" as any).delete().eq("id", oc.id); if (error) throw error; },
    onSuccess: () => { toast.success("OC excluída."); setDeleting(null); invalidate(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  const emptyMsg = tab === "encomendado" ? "Nenhuma OC encomendada." : "Nenhuma OC recebida.";

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex items-start gap-3">
        <Package className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">OC Insumo</h1>
          <p className="text-sm text-muted-foreground">Ordens de compra de insumos (etiquetas/tags), por variante.</p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as OCStatus)}>
        <div className="flex items-center gap-2 flex-wrap">
          <TabsList>
            <TabsTrigger value="encomendado">Encomendados</TabsTrigger>
            <TabsTrigger value="recebido">Recebidos</TabsTrigger>
          </TabsList>
          <div className="ml-auto flex items-center gap-2">
            <FilterButton filters={[
              { label: "Fornecedor", value: filterEmpresa, onChange: setFilterEmpresa, options: [{ id: "all", nome: "Todos" }, ...empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }))] },
              ...(tab === "encomendado" ? respF.filters : []),
            ]} />
            <Button className="max-sm:hidden" onClick={() => { setOpenId(null); setOpenNew(true); }} disabled={readOnly}><Plus className="h-4 w-4 mr-1" /> Nova OC</Button>
          </div>
        </div>

        <TabsContent value={tab} className="mt-4">
          {/* Mobile: cards */}
          <div className="space-y-2 sm:hidden">
            {ocs.length === 0 && <Card className="p-6 text-center text-sm text-muted-foreground">{emptyMsg}</Card>}
            {ocs.map((o) => (
              <Card key={o.id} className="p-3 cursor-pointer active:bg-muted/50" onClick={() => { setOpenNew(false); setOpenId(o.id); }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{o.numero_pedido ?? "—"}</span>
                    <OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status={o.status} />
                  </div>
                  <div className="text-sm text-muted-foreground truncate mt-0.5">{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {tab === "encomendado"
                      ? <>Prev. {fmtDate(o.data_prevista_entrega)} · {fmtMoney((totals as any)[o.id]?.previsto ?? 0)}</>
                      : <>Entrega {fmtDate(o.data_entrega)} · {fmtMoney((totals as any)[o.id]?.real ?? 0)}</>}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Desktop: tabela */}
          <Card className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nº Pedido</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>{tab === "encomendado" ? "Data Prevista" : "Data de Entrega"}</TableHead>
                  <TableHead>{tab === "encomendado" ? "Valor Previsto" : "Valor Real"}</TableHead>
                  <TableHead>Mensagem</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ocs.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{emptyMsg}</TableCell></TableRow>
                )}
                {ocs.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => { setOpenNew(false); setOpenId(o.id); }}>
                    <TableCell className="font-medium">{o.numero_pedido ?? "—"}</TableCell>
                    <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                    <TableCell>{fmtDate(tab === "encomendado" ? o.data_prevista_entrega : o.data_entrega)}</TableCell>
                    <TableCell>{fmtMoney((totals as any)[o.id]?.[tab === "encomendado" ? "previsto" : "real"] ?? 0)}</TableCell>
                    <TableCell><OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status={o.status} /></TableCell>
                    <TableCell className="w-10 py-0 text-right">
                      {o.status === "encomendado" && (
                        <Button size="iconSm" variant="ghost" className="text-muted-foreground hover:text-destructive" disabled={readOnly}
                          onClick={(e) => { e.stopPropagation(); setDeleting(o); }} aria-label="Excluir">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      <MobileActionBar>
        <Button className="ml-auto" onClick={() => { setOpenId(null); setOpenNew(true); }} disabled={readOnly}><Plus className="h-4 w-4 mr-1" /> Nova OC</Button>
      </MobileActionBar>

      {(openNew || openId) && (
        <OcDialog
          ocId={openId}
          empresas={empresas}
          etiquetas={etiquetas}
          onClose={() => { setOpenNew(false); setOpenId(null); }}
          onSaved={() => { invalidate(); setOpenNew(false); setOpenId(null); }}
          onDelete={() => { const oc = ocs.find((o) => o.id === openId); setOpenId(null); setOpenNew(false); if (oc) setDeleting(oc); }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir OC?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação não pode ser desfeita. A OC "{deleting?.numero_pedido || "sem número"}" e seus itens serão removidos.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleting && deleteMut.mutate(deleting)}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function OcDialog({ ocId, empresas, etiquetas, onClose, onSaved, onDelete }: {
  ocId: string | null; empresas: EmpresaFornecedor[]; etiquetas: EtqOpt[];
  onClose: () => void; onSaved: () => void; onDelete: () => void;
}) {
  const readOnly = useReadOnly();
  const isEdit = !!ocId;
  const etqMap = useMemo(() => Object.fromEntries(etiquetas.map((e) => [e.id, e])), [etiquetas]);

  const [numero, setNumero] = useState("");
  const [empresaId, setEmpresaId] = useState<string | null>(null);
  const [repId, setRepId] = useState<string | null>(null);
  const [respNome, setRespNome] = useState("");
  const [dataPedido, setDataPedido] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dataPrevista, setDataPrevista] = useState("");
  const [prazo, setPrazo] = useState("");
  const [qtdPrazos, setQtdPrazos] = useState(1);
  const [nfs, setNfs] = useState<{ url: string; data?: string }[]>([]);
  const [parcelas, setParcelas] = useState<ParcelaRec[]>([{ data: "", recebido: false }]);
  const [status, setStatus] = useState<OCStatus>("encomendado");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [addSel, setAddSel] = useState("");
  const [confirmUnmark, setConfirmUnmark] = useState(false);
  const savingRef = useRef(false);

  const canShowRecebimento = isEdit && (status === "encomendado" || status === "recebido");
  const isReadOnlyRecebimento = isEdit && status === "recebido";

  const mkBlock = (etq: EtqOpt): Block => ({
    etiquetaId: etq.id,
    selectedCores: [],
    rows: etq.variantes.length > 0
      ? etq.variantes.map((v) => ({ varianteId: v.id, corId: v.cor_id, corNome: v.cor_nome, tamanho: v.tamanho, label: rowLabel(v, etq.formato_tamanho), incluido: false, qtdPedida: null, qtdRecebida: null, preco: v.preco ?? etq.preco ?? null }))
      : [{ varianteId: null, corId: null, corNome: null, tamanho: null, label: "Único", incluido: true, qtdPedida: null, qtdRecebida: null, preco: etq.preco ?? null }],
  });

  useQuery({
    queryKey: ["oc-insumo", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      const oc = (await supabase.from("ocs_etiqueta" as any).select("*").eq("id", ocId).maybeSingle()).data as any;
      const its = ((await supabase.from("ocs_etiqueta_itens" as any).select("*").eq("oc_etiqueta_id", ocId)).data ?? []) as any[];
      if (oc) {
        setNumero(oc.numero_pedido ?? ""); setEmpresaId(oc.empresa_id); setRepId(oc.representante_id);
        setDataPedido(oc.data_pedido ?? ""); setDataPrevista(oc.data_prevista_entrega ?? "");
        setPrazo(oc.prazo_pagamento ?? ""); setQtdPrazos(oc.quantidade_prazos ?? 1); setNfs((oc.nfs ?? []) as any);
        setParcelas(Array.isArray(oc.parcelas_recebimento) && oc.parcelas_recebimento.length > 0 ? oc.parcelas_recebimento : [{ data: "", recebido: false }]);
        setStatus((oc.status as OCStatus) ?? "encomendado");
        setRespNome(oc.responsavel_nome ?? "");
        // agrupa itens por insumo → blocos (todas as variantes; marca as compradas); cores selecionadas = as usadas
        const byEtq = new Map<string, any[]>();
        for (const it of its) { const a = byEtq.get(it.etiqueta_id) ?? []; a.push(it); byEtq.set(it.etiqueta_id, a); }
        const bs: Block[] = [];
        for (const [etqId, itsE] of byEtq) {
          const etq = etqMap[etqId];
          const rows: VarRow[] = [];
          const semVar = itsE.find((it) => !it.variante_etiqueta_id);
          if (semVar) rows.push({ itemId: semVar.id, varianteId: null, corId: null, corNome: null, tamanho: null, label: "Único", incluido: true, qtdPedida: semVar.quantidade_pedida, qtdRecebida: semVar.quantidade_recebida, preco: semVar.preco });
          for (const v of etq?.variantes ?? []) {
            const item = itsE.find((it) => it.variante_etiqueta_id === v.id);
            rows.push({ itemId: item?.id, varianteId: v.id, corId: v.cor_id, corNome: v.cor_nome, tamanho: v.tamanho, label: rowLabel(v, etq!.formato_tamanho), incluido: !!item, qtdPedida: item?.quantidade_pedida ?? null, qtdRecebida: item?.quantidade_recebida ?? null, preco: item?.preco ?? v.preco ?? etq?.preco ?? null });
          }
          const selectedCores = [...new Set(rows.filter((r) => r.incluido && r.corId).map((r) => r.corId as string))];
          bs.push({ etiquetaId: etqId, selectedCores, rows });
        }
        setBlocks(bs);
      }
      return oc ?? null;
    },
  });

  const addInsumo = (id: string) => {
    setAddSel("");
    if (!id || blocks.some((b) => b.etiquetaId === id)) return;
    const etq = etqMap[id];
    if (etq) setBlocks((bs) => [...bs, mkBlock(etq)]);
  };
  const rmBlock = (bi: number) => setBlocks((bs) => bs.filter((_, j) => j !== bi));
  const updRow = (bi: number, ri: number, patch: Partial<VarRow>) =>
    setBlocks((bs) => bs.map((b, j) => (j === bi ? { ...b, rows: b.rows.map((r, k) => (k === ri ? { ...r, ...patch } : r)) } : b)));
  const toggleCor = (bi: number, corId: string, checked: boolean) =>
    setBlocks((bs) => bs.map((b, j) => {
      if (j !== bi) return b;
      const etq = etqMap[b.etiquetaId];
      const sizes = hasTam(etq); // sem tamanho: selecionar a cor já inclui a variante única daquela cor
      const selectedCores = checked ? [...b.selectedCores, corId] : b.selectedCores.filter((c) => c !== corId);
      const rows = b.rows.map((r) => (r.corId === corId ? { ...r, incluido: checked ? (sizes ? r.incluido : true) : false } : r));
      return { ...b, selectedCores, rows };
    }));

  const disponiveis = etiquetas.filter((e) => !blocks.some((b) => b.etiquetaId === e.id));
  const derivedEntrega = parcelas.length > 0 ? ([...parcelas].map((p) => p.data).filter(Boolean).sort().slice(-1)[0] ?? "") : "";
  const todasParcelasOk = parcelas.length > 0 && parcelas.every((p) => !!p.data && p.recebido === true);

  const getMissing = () => {
    const m: string[] = [];
    if (parcelas.length === 0) m.push("Defina a quantidade de parcelas de recebimento");
    if (!parcelas.every((p) => !!p.data)) m.push("Preencha as datas de todas as parcelas de recebimento");
    if (!parcelas.every((p) => p.recebido === true)) m.push("Marque todas as parcelas como recebidas");
    if (!blocks.some((b) => b.rows.some((r) => r.incluido))) m.push("Selecione ao menos uma variante");
    return m;
  };

  const save = useMutation({
    mutationFn: async (markReceived: boolean) => {
      const finalStatus: OCStatus = markReceived ? "recebido" : status;
      const itens = blocks.flatMap((b) => {
        const etq = etqMap[b.etiquetaId];
        const noColors = coresOf(etq).length === 0;
        return b.rows
          .filter((r) => r.incluido && (noColors || r.corId == null || b.selectedCores.includes(r.corId)))
          .map((r) => ({
            id: r.itemId ?? null, etiqueta_id: b.etiquetaId, variante_etiqueta_id: r.varianteId,
            quantidade_pedida: r.qtdPedida, quantidade_recebida: markReceived ? (r.qtdRecebida ?? r.qtdPedida) : r.qtdRecebida,
            preco: r.preco, cancelado: false,
          }));
      });
      const lastDate = parcelas.map((p) => p.data).filter(Boolean).sort().slice(-1)[0] ?? null;
      const payload = {
        numero_pedido: numero || null, responsavel_nome: respNome || null, empresa_id: empresaId, representante_id: repId,
        data_pedido: dataPedido || null, data_prevista_entrega: dataPrevista || null,
        data_entrega: finalStatus === "recebido" ? lastDate : null,
        prazo_pagamento: prazo || null, quantidade_prazos: qtdPrazos, nf_url: nfs[0]?.url ?? null, nfs,
        parcelas_recebimento: parcelas, status: finalStatus,
      };
      const { error } = await supabase.rpc("salvar_oc_etiqueta" as any, { _oc_id: isEdit ? ocId : null, _oc: payload, _itens: itens });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("OC salva"); onSaved(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
  });
  const unmark = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc("desmarcar_recebimento_oc_etiqueta" as any, { _oc_id: ocId }); if (error) throw error; },
    onSuccess: () => { toast.success("OC voltou para Encomendado."); setConfirmUnmark(false); onSaved(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro")),
  });
  const doSave = (markReceived: boolean) => {
    if (savingRef.current || save.isPending) return;
    if (markReceived && !todasParcelasOk) {
      const miss = getMissing();
      toast.error("Não é possível marcar como recebido", { description: miss.length ? miss.join(" • ") : undefined });
      return;
    }
    savingRef.current = true;
    save.mutate(markReceived, { onSettled: () => { savingRef.current = false; } });
  };
  const setNumParcelas = (n: number) => {
    const q = Math.max(1, Math.min(24, n || 1));
    setParcelas((prev) => Array.from({ length: q }, (_, i) => prev[i] ?? { data: "", recebido: false }));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[92vh] flex flex-col gap-0 p-0 max-sm:[&>button]:hidden">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-2">
          <DialogTitle>{isEdit ? `OC ${numero || "Insumo"}` : "Nova OC de Insumo"}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-6 py-2 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="grid gap-1"><Label>Número do Pedido</Label><Input value={numero} onChange={(e) => setNumero(e.target.value)} disabled={readOnly} /></div>
            <div className="grid gap-1"><Label>Fornecedor</Label>
              <FornecedorSelect empresas={empresas} empresaId={empresaId} representanteId={repId} onChange={(emp, rep) => { setEmpresaId(emp); setRepId(rep); }} disabled={readOnly} placeholder="Sem fornecedor" />
            </div>
            <div className="grid gap-1"><Label>Responsável</Label>
              <ResponsavelSelect nome={respNome} onChange={(n) => setRespNome(n ?? "")} disabled={readOnly} />
            </div>
            <div className="grid gap-1"><Label>Prazo de Pagamento</Label>
              <Input value={prazo} placeholder="Ex: 30/60/90" disabled={readOnly}
                onChange={(e) => { const v = e.target.value; const parts = v.split("/").map((s) => s.trim()).filter(Boolean); setPrazo(v); setQtdPrazos(Math.max(1, Math.min(6, parts.length || 1))); }} />
            </div>
            <div className="grid gap-1"><Label>Data do Pedido</Label><DateField value={dataPedido} onChange={(e) => setDataPedido(e.target.value)} disabled={readOnly} /></div>
            <div className="grid gap-1"><Label>Data Prevista de Entrega</Label><DateField value={dataPrevista} onChange={(e) => setDataPrevista(e.target.value)} disabled={readOnly} /></div>
            <div className="grid gap-1"><Label>Qtd. Parcelas de Recebimento</Label>
              <NumberInput type="number" integer min={1} max={24} value={parcelas.length || 1} onChange={(e) => setNumParcelas(parseInt(e.target.value, 10))} disabled={isReadOnlyRecebimento || readOnly} />
            </div>
          </div>

          <Separator />
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold">Insumos</h3>
            {!isReadOnlyRecebimento && (
              <Select value={addSel} onValueChange={addInsumo} disabled={readOnly}>
                <SelectTrigger className="h-8 w-56 max-sm:w-44"><SelectValue placeholder="Adicionar insumo…" /></SelectTrigger>
                <SelectContent>
                  {disponiveis.length === 0 ? <div className="p-2 text-xs text-muted-foreground">Todos adicionados.</div>
                    : disponiveis.map((e) => <SelectItem key={e.id} value={e.id}>{e.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          {blocks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Adicione um insumo, escolha as cores e marque as variantes desta OC.</p>
          ) : blocks.map((b, bi) => {
            const etq = etqMap[b.etiquetaId];
            const cores = coresOf(etq);
            const showQtdReceb = canShowRecebimento;
            const visibleRows = b.rows.map((r, ri) => ({ r, ri })).filter(({ r }) => cores.length === 0 || r.corId == null || b.selectedCores.includes(r.corId));
            return (
              <Card key={b.etiquetaId} className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{etq?.nome ?? "—"}</span>
                  {!isReadOnlyRecebimento && <Button size="iconSm" variant="ghost" onClick={() => rmBlock(bi)} aria-label="Remover insumo"><X className="h-4 w-4" /></Button>}
                </div>

                {cores.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    <span className="text-xs text-muted-foreground self-center">Cores:</span>
                    {cores.map((c) => (
                      <label key={c.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                        <Checkbox checked={b.selectedCores.includes(c.id)} onCheckedChange={(v) => toggleCor(bi, c.id, !!v)} disabled={isReadOnlyRecebimento} />
                        {c.nome}
                      </label>
                    ))}
                  </div>
                )}

                {visibleRows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{cores.length > 0 ? "Selecione uma ou mais cores acima." : "—"}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs border">
                      <thead className="bg-muted/50"><tr>
                        <th className="px-2 py-1 w-8"></th>
                        <th className="px-2 py-1 text-left">Variante</th>
                        <th className="px-2 py-1">Qtd Pedida</th>
                        {showQtdReceb && <th className="px-2 py-1">Qtd Recebida</th>}
                        <th className="px-2 py-1">Preço unit.</th>
                      </tr></thead>
                      <tbody>
                        {visibleRows.map(({ r, ri }) => (
                          <tr key={ri} className="border-t">
                            <td className="px-2 py-1 text-center">
                              <Checkbox checked={r.incluido} onCheckedChange={(v) => updRow(bi, ri, { incluido: !!v })} disabled={isReadOnlyRecebimento} />
                            </td>
                            <td className="px-2 py-1">{r.label}</td>
                            <td className="px-2 py-1">
                              <NumberInput type="number" className="max-md:w-24" placeholder="0,00" value={r.qtdPedida ?? ""} onChange={(e) => updRow(bi, ri, { qtdPedida: e.target.value === "" ? null : Number(e.target.value) })} disabled={!r.incluido || isReadOnlyRecebimento} />
                            </td>
                            {showQtdReceb && (
                              <td className="px-2 py-1">
                                <NumberInput type="number" className="max-md:w-24" placeholder="0,00" value={r.qtdRecebida ?? ""} onChange={(e) => updRow(bi, ri, { qtdRecebida: e.target.value === "" ? null : Number(e.target.value) })} disabled={!r.incluido || readOnly} />
                              </td>
                            )}
                            <td className="px-2 py-1">
                              <NumberInput type="number" className="max-md:w-24" placeholder="0,00" value={r.preco ?? ""} onChange={(e) => updRow(bi, ri, { preco: e.target.value === "" ? null : Number(e.target.value) })} disabled={!r.incluido || isReadOnlyRecebimento} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            );
          })}

          {isEdit && (
            <>
              <Separator />
              <h3 className="font-semibold">Recebimento</h3>
              <NfList value={nfs} onChange={setNfs} uploadFn={(f) => uploadFile(f, "nf")} readOnly={readOnly} />
              <div className="grid gap-2">
                <Label className="text-sm">Parcelas de Recebimento</Label>
                {parcelas.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Defina a quantidade de parcelas no campo acima.</p>
                ) : (
                  <div className="space-y-2">
                    {parcelas.map((p, idx) => (
                      <div key={idx} className="flex items-center gap-3 rounded-md border p-2">
                        <span className="text-xs font-medium w-20">Parcela {idx + 1}</span>
                        <DateField className="flex-1 max-w-[200px]" value={p.data} disabled={isReadOnlyRecebimento}
                          onChange={(e) => setParcelas((arr) => arr.map((x, j) => (j === idx ? { ...x, data: e.target.value } : x)))} />
                        <label className="flex items-center gap-2 text-xs">
                          <Checkbox checked={p.recebido} disabled={isReadOnlyRecebimento}
                            onCheckedChange={(c) => setParcelas((arr) => arr.map((x, j) => (j === idx ? { ...x, recebido: !!c } : x)))} />
                          Recebida
                        </label>
                      </div>
                    ))}
                  </div>
                )}
                <div className="text-sm"><OcPrazoBadge dataPrevista={dataPrevista} dataEntrega={derivedEntrega} status={status} /></div>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0 border-t bg-background px-6 py-3">
          <Button variant="outline" onClick={onClose} aria-label="Voltar"><ArrowLeft className="h-4 w-4 md:mr-1" /><span className="max-md:sr-only">Voltar</span></Button>
          {isEdit && status === "encomendado" && !readOnly && (
            <Button variant="destructive" onClick={onDelete} aria-label="Excluir"><Trash2 className="h-4 w-4 md:mr-1" /><span className="max-md:sr-only">Excluir</span></Button>
          )}
          <div className="ml-auto flex gap-2">
            {canShowRecebimento && (
              isReadOnlyRecebimento
                ? <Button variant="outline" onClick={() => setConfirmUnmark(true)} disabled={unmark.isPending}>Desmarcar Recebido</Button>
                : <Button variant="secondary" onClick={() => doSave(true)} disabled={save.isPending}>Marcar Recebido</Button>
            )}
            {!isReadOnlyRecebimento && <Button onClick={() => doSave(false)} disabled={save.isPending}>Salvar</Button>}
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={confirmUnmark} onOpenChange={setConfirmUnmark}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desmarcar recebimento?</AlertDialogTitle>
            <AlertDialogDescription>A OC volta para Encomendado e as parcelas não pagas são removidas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); unmark.mutate(); }}>Desmarcar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
