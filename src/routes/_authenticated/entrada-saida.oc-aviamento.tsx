import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles, Plus, Upload, Trash2, ArrowLeft, Printer } from "lucide-react";
import { format, parseISO } from "date-fns";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { brl } from "@/lib/format";
import { empresaTemCategoria, AVIAMENTO_TOKENS } from "@/lib/fornecedor-categoria";
import { corApelidoLabel } from "@/lib/variante";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/shared/DateField";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AtrasadasBadge } from "@/components/shared/AtrasadasBadge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { OcModalShell } from "@/components/shared/OcModalShell";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
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
import { useEstoqueAviamentos, EstoqueAviamentosTable } from "@/components/oc-aviamento/EstoqueAviamentosTab";
import { FilterButton, SearchToggle } from "@/components/shared/filters";
import { printWithImages } from "@/lib/print";
import { OcPrazoBadge } from "@/components/shared/oc-prazo-badge";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { FornecedorSelect } from "@/components/shared/FornecedorSelect";
import { ResponsavelSelect } from "@/components/shared/ResponsavelSelect";
import { useFilterState } from "@/hooks/useFilterState";
import { useResponsavelFilter, SENTINEL_NOME } from "@/hooks/useResponsavelFilter";
import { NfList } from "@/components/oc-tecido/NfList";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useSort, SortHead } from "@/components/shared/sort";
export const Route = createFileRoute("/_authenticated/entrada-saida/oc-aviamento")({
  component: () => (
    <RequirePermission page="entrada_oc_aviamento">
      <OcAviamentoPage />
    </RequirePermission>
  ),
});

const BUCKET = "oc-aviamento";

type OCStatus = "encomendado" | "recebido";
type Empresa = {
  id: string;
  nome_fantasia: string;
  // Embed to-many (FK sem UNIQUE): representantes da empresa p/ o Select opcional.
  representantes?: { id: string; nome: string | null }[] | null;
};
type Colab = { id: string; nome: string; tipo: string };
// Variante de aviamento (cor base + cor apelido) embedada por aviamento p/ o 2º Select.
type AviamentoVariante = {
  id: string;
  nome_variante: string | null;
  codigo_variante: string | null;
  cor: { nome: string | null } | null;
  apelido: { nome: string | null } | null;
};
type Aviamento = {
  id: string;
  codigo_nome: string;
  empresa_id: string | null;
  preco: number | null;
  variantes: AviamentoVariante[];
};

/** Rótulo da variante do aviamento: "cor - cor apelido" (fonte única @/lib/variante),
 *  caindo p/ nome/código da variante quando não há cor. */
function varianteAviLabel(v: AviamentoVariante): string {
  const l = corApelidoLabel(v.cor?.nome, v.apelido?.nome);
  return l !== "—" ? l : (v.nome_variante || v.codigo_variante || "—");
}

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
  variante_aviamento_id: string | null;
  quantidade_pedida: number;
  quantidade_recebida: number | null;
  cancelado: boolean;
};

function fmtMoney(v: number | null | undefined) {
  if (v == null || isNaN(v as number)) return "—";
  return brl(v);
}
function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try { return format(parseISO(v), "dd/MM/yyyy"); } catch { return v; }
}
async function uploadFile(file: File, prefix: string) {
  const { tenantPrefix, sanitizeStorageName } = await import("@/lib/storage-tenant");
  const tenant = await tenantPrefix();
  const path = `${tenant}/${prefix}/${crypto.randomUUID()}-${sanitizeStorageName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

function OcAviamentoPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<OCStatus | "estoque">("recebido");
  const estoque = useEstoqueAviamentos(tab === "estoque"); // controles no header (contextual) + tabela
  const [filterEmpresa, setFilterEmpresa] = useFilterState("oc-aviamento", "Fornecedor", []);
  const respF = useResponsavelFilter("oc-aviamento");
  const [openNew, setOpenNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OC | null>(null);

  const { data: ocs = [] } = useQuery({
    queryKey: ["ocs_aviamento", tab, filterEmpresa.join(","), respF.tipo.join(","), respF.pessoaId.join(",")],
    enabled: tab !== "estoque", // a aba Estoque não lista OCs (mostra a posição de estoque)
    queryFn: async () => {
      let q = supabase.from("ocs_aviamento").select("*").eq("status", tab as OCStatus).order("created_at", { ascending: false });
      if (filterEmpresa.length) q = q.in("empresa_id", filterEmpresa);
      if (respF.nomesFiltro) q = q.in("responsavel_nome", respF.nomesFiltro.length ? respF.nomesFiltro : [SENTINEL_NOME]);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as OC[];
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-aviamento"],
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
        .filter((e) => empresaTemCategoria(e, AVIAMENTO_TOKENS))
        .map((e) => ({ id: e.id as string, nome_fantasia: e.nome_fantasia as string, representantes: e.representantes ?? [] })) as Empresa[];
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
      qc.invalidateQueries({ queryKey: ["oc-avi"] });
      qc.invalidateQueries({ queryKey: ["estoque-aviamentos"] });
      qc.invalidateQueries({ queryKey: ["dash-estoque"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  // Compute valores per OC via separate query. useMemo p/ a ref do array ser estável
  // (é dep da queryKey ["ocs-avi-totals", ocIds]; recriar a cada render é frágil).
  const ocIds = useMemo(() => ocs.map((o) => o.id), [ocs]);
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

  // Ordenação clicável. Empresa e valores são derivados (a célula exibe valor
  // formatado), então ordenamos pelo valor CRU via accessors.
  const sortEncomendado = useSort(ocs, {
    accessors: {
      empresa: (o: OC) => (o.empresa_id ? empresaMap[o.empresa_id] ?? "" : ""),
      valor_previsto: (o: OC) => itemsByOC[o.id]?.previsto ?? 0,
    },
  });
  const sortRecebido = useSort(ocs, {
    accessors: {
      empresa: (o: OC) => (o.empresa_id ? empresaMap[o.empresa_id] ?? "" : ""),
      valor_real: (o: OC) => itemsByOC[o.id]?.real ?? 0,
    },
  });

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Sparkles className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold tracking-tight truncate">OC de Aviamento</h1>
            <p className="text-sm text-muted-foreground mt-1">Ordens de compra de aviamentos.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {tab === "estoque" ? (
            <>
              <SearchToggle value={estoque.search} onChange={estoque.setSearch} placeholder="Aviamento" />
              <Button variant="outline" size="sm" className="hidden md:inline-flex" onClick={() => printWithImages()}>
                <Printer className="h-4 w-4 mr-1" /> Imprimir
              </Button>
              <FilterButton filters={estoque.filtros} />
            </>
          ) : (
            <FilterButton
              filters={[
                { label: "Fornecedor", value: filterEmpresa, onChange: setFilterEmpresa, options: empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia })) },
                ...(tab === "encomendado" ? respF.filters : []),
              ]}
            />
          )}
          <Button className="max-sm:hidden" onClick={() => { setEditingId(null); setOpenNew(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nova OC
          </Button>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as OCStatus | "estoque")}>
        <TabsList>
          <TabsTrigger value="recebido">Recebidos</TabsTrigger>
          <TabsTrigger value="encomendado" className="relative">Encomendados<AtrasadasBadge chave="oc_aviamento_atrasada" /></TabsTrigger>
          <TabsTrigger value="estoque">Estoque</TabsTrigger>
        </TabsList>

        <TabsContent value="encomendado" className="mt-4">
          {/* Mobile: cards */}
          <div className="space-y-2 sm:hidden">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Ordenar por</span>
              <Select
                value={sortEncomendado.sortKey ?? ""}
                onValueChange={(v) => sortEncomendado.toggle(v)}
              >
                <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="numero_pedido">Nº Pedido</SelectItem>
                  <SelectItem value="empresa">Fornecedor</SelectItem>
                  <SelectItem value="data_prevista_entrega">Data Prevista</SelectItem>
                  <SelectItem value="valor_previsto">Valor Previsto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {ocs.length === 0 && (
              <Card className="p-6 text-center text-sm text-muted-foreground">Nenhuma OC encomendada.</Card>
            )}
            {sortEncomendado.sorted.map((o) => (
              <Card
                key={o.id}
                className="p-3 cursor-pointer active:bg-muted/50"
                onClick={() => { setEditingId(o.id); setOpenNew(true); }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{o.numero_pedido ?? "—"}</span>
                    <OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status="encomendado" />
                  </div>
                  <div className="text-sm text-muted-foreground truncate mt-0.5">
                    {o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Prev. {fmtDate(o.data_prevista_entrega)} · {fmtMoney(itemsByOC[o.id]?.previsto ?? 0)}
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
                  <SortHead label="Nº Pedido" sortKey="numero_pedido" sortState={sortEncomendado} />
                  <SortHead label="Fornecedor" sortKey="empresa" sortState={sortEncomendado} />
                  <SortHead label="Data Prevista" sortKey="data_prevista_entrega" sortState={sortEncomendado} />
                  <SortHead label="Valor Previsto" sortKey="valor_previsto" sortState={sortEncomendado} />
                  <TableHead>Mensagem</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ocs.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Nenhuma OC encomendada.</TableCell></TableRow>
                )}
                {sortEncomendado.sorted.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer" onClick={() => { setEditingId(o.id); setOpenNew(true); }}>
                    <TableCell className="font-medium">{o.numero_pedido ?? "—"}</TableCell>
                    <TableCell>{o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}</TableCell>
                    <TableCell>{fmtDate(o.data_prevista_entrega)}</TableCell>
                    <TableCell>{fmtMoney(itemsByOC[o.id]?.previsto ?? 0)}</TableCell>
                    <TableCell><OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status="encomendado" /></TableCell>
                    <TableCell className="w-10 py-0 text-right">
                      <Button
                        size="iconSm"
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
          {/* Mobile: cards */}
          <div className="space-y-2 sm:hidden">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Ordenar por</span>
              <Select
                value={sortRecebido.sortKey ?? ""}
                onValueChange={(v) => sortRecebido.toggle(v)}
              >
                <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="numero_pedido">Nº Pedido</SelectItem>
                  <SelectItem value="empresa">Fornecedor</SelectItem>
                  <SelectItem value="data_entrega">Data Entrega</SelectItem>
                  <SelectItem value="valor_real">Valor Real</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {ocs.length === 0 && (
              <Card className="p-6 text-center text-sm text-muted-foreground">Nenhuma OC recebida.</Card>
            )}
            {sortRecebido.sorted.map((o) => (
              <Card
                key={o.id}
                className="p-3 cursor-pointer active:bg-muted/50"
                onClick={() => { setEditingId(o.id); setOpenNew(true); }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{o.numero_pedido ?? "—"}</span>
                    <OcPrazoBadge dataPrevista={o.data_prevista_entrega} dataEntrega={o.data_entrega} status="recebido" />
                  </div>
                  <div className="text-sm text-muted-foreground truncate mt-0.5">
                    {o.empresa_id ? empresaMap[o.empresa_id] ?? "—" : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Entrega {fmtDate(o.data_entrega)} · {fmtMoney(itemsByOC[o.id]?.real ?? 0)}
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
                  <SortHead label="Nº Pedido" sortKey="numero_pedido" sortState={sortRecebido} />
                  <SortHead label="Fornecedor" sortKey="empresa" sortState={sortRecebido} />
                  <SortHead label="Data Entrega" sortKey="data_entrega" sortState={sortRecebido} />
                  <TableHead>Mensagem</TableHead>
                  <SortHead label="Valor Real" sortKey="valor_real" sortState={sortRecebido} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ocs.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Nenhuma OC recebida.</TableCell></TableRow>
                )}
                {sortRecebido.sorted.map((o) => (
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

        <TabsContent value="estoque" className="mt-4">
          <EstoqueAviamentosTable state={estoque} />
        </TabsContent>
      </Tabs>

      {openNew && (
        <OcDialog
          ocId={editingId}
          empresas={empresas}
          onClose={() => { setOpenNew(false); setEditingId(null); }}
          onSaved={() => qc.invalidateQueries({ queryKey: ["ocs_aviamento"] })}
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
            <AlertDialogAction variant="destructive" onClick={() => deleting && deleteMut.mutate(deleting)}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MobileActionBar>
        <Button className="ml-auto" onClick={() => { setEditingId(null); setOpenNew(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Nova OC
        </Button>
      </MobileActionBar>
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
  representante_id: string | null;
  data_pedido: string;
  data_prevista_entrega: string;
  data_entrega: string;
  prazo_pagamento: string;
  quantidade_prazos: number;
  nf_url: string | null;
  nfs: { url: string; data?: string }[]; // várias Notas Fiscais (nf_url = a primeira)
  parcelas_recebimento: ParcelaRecebimento[];
};
function emptyDraft(): Draft {
  return {
    numero_pedido: "",
    responsavel_nome: "",
    responsavel_id: null,
    empresa_id: null,
    representante_id: null,
    data_pedido: format(new Date(), "yyyy-MM-dd"),
    data_prevista_entrega: "",
    data_entrega: "",
    prazo_pagamento: "",
    quantidade_prazos: 1,
    nf_url: null,
    nfs: [],
    parcelas_recebimento: [{ data: "", recebido: false }],
  };
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
  const [confirmUnmark, setConfirmUnmark] = useState(false);

  // Guarda de "alterações não salvas": compara o rascunho editável (cabeçalho + itens)
  // com um baseline. Re-baseline ao semear a OC (query async) e após salvar (markClean).
  const { dirty: changed, markClean, reset: resetBaseline } = useDirtySnapshot({ draft, items });

  useQuery({
    queryKey: ["oc-avi", ocId],
    enabled: !!ocId,
    queryFn: async () => {
      if (!ocId) return null;
      const { data: oc, error: e1 } = await supabase.from("ocs_aviamento").select("*").eq("id", ocId).maybeSingle();
      if (e1) throw e1;
      const { data: its, error: e2 } = await supabase.from("ocs_aviamento_itens").select("*").eq("oc_aviamento_id", ocId);
      if (e2) throw e2;
      let nextDraft: Draft | null = null;
      if (oc) {
        nextDraft = {
          numero_pedido: oc.numero_pedido ?? "",
          responsavel_nome: oc.responsavel_nome ?? "",
          responsavel_id: null,
          empresa_id: oc.empresa_id,
          representante_id: (oc as any).representante_id ?? null,
          data_pedido: oc.data_pedido ?? "",
          data_prevista_entrega: oc.data_prevista_entrega ?? "",
          data_entrega: oc.data_entrega ?? "",
          prazo_pagamento: oc.prazo_pagamento ?? "",
          quantidade_prazos: oc.quantidade_prazos ?? 1,
          nf_url: oc.nf_url,
          nfs: (((oc as any).nfs ?? []) as { url: string; data?: string }[]),
          parcelas_recebimento: (Array.isArray((oc as any).parcelas_recebimento) && (oc as any).parcelas_recebimento.length > 0)
            ? ((oc as any).parcelas_recebimento as ParcelaRecebimento[])
            : [{ data: "", recebido: false }],
        };
        setDraft(nextDraft);
        setStatus((oc.status as OCStatus) ?? "encomendado");
      }
      const mapped: ItemDraft[] = (its ?? []).map((i: any) => ({
        tempId: i.id,
        id: i.id,
        aviamento_id: i.aviamento_id,
        variante_aviamento_id: i.variante_aviamento_id ?? null,
        quantidade_pedida: Number(i.quantidade_pedida ?? 0),
        quantidade_recebida: i.quantidade_recebida == null ? null : Number(i.quantidade_recebida),
        cancelado: !!i.cancelado,
      }));
      setItems(mapped);
      setOriginalItemIds(mapped.map((m) => m.id).filter((x): x is string => !!x));
      // Re-baseline no MESMO tick com os valores semeados (estado recém-setado está stale).
      if (nextDraft) resetBaseline({ draft: nextDraft, items: mapped });
      return oc;
    },
  });

  const { data: aviamentos = [] } = useQuery({
    queryKey: ["aviamentos-by-empresa", draft.empresa_id],
    queryFn: async () => {
      // Embed das variantes (cor base + cor apelido) p/ o 2º Select por item — espelha
      // o padrão do tecido em @/lib/variante (cor:cor_id / apelido:cor_apelido_id).
      let q = supabase
        .from("aviamentos")
        .select(
          "id, codigo_nome, empresa_id, preco, variantes:variantes_aviamento(id, nome_variante, codigo_variante, cor:cor_id(nome), apelido:cor_apelido_id(nome))",
        )
        .order("codigo_nome");
      if (draft.empresa_id) q = q.eq("empresa_id", draft.empresa_id);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as any[]).map((a) => ({
        id: a.id as string,
        codigo_nome: a.codigo_nome as string,
        empresa_id: a.empresa_id as string | null,
        preco: a.preco as number | null,
        variantes: (a.variantes ?? []) as AviamentoVariante[],
      })) as Aviamento[];
    },
  });
  const aviMap = useMemo(() => Object.fromEntries(aviamentos.map((a) => [a.id, a])), [aviamentos]);

  const addItem = () => {
    if (items.length >= 10) { toast.error("Máximo de 10 aviamentos por OC"); return; }
    setItems((p) => [...p, { tempId: crypto.randomUUID(), aviamento_id: "", variante_aviamento_id: null, quantidade_pedida: 0, quantidade_recebida: null, cancelado: false }]);
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

  // Guarda SÍNCRONA contra duplo-clique (isPending só atualiza no re-render; 2 cliques
  // rápidos disparam 2 saves = 2 OCs). Espelha o padrão da OC Tecido.
  const savingRef = useRef(false);

  const saveMutation = useMutation({
    mutationFn: async (markReceived: boolean) => {
      if (!draft.empresa_id) throw new Error("Informe o Fornecedor.");
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
      const ocPayload = {
        numero_pedido: draft.numero_pedido || null,
        responsavel_nome: draft.responsavel_nome || null,
        empresa_id: draft.empresa_id,
        representante_id: draft.representante_id,
        data_pedido: draft.data_pedido || null,
        data_prevista_entrega: draft.data_prevista_entrega || null,
        data_entrega: markReceived ? (lastDate || null) : (draft.data_entrega || null),
        prazo_pagamento: draft.prazo_pagamento || null,
        quantidade_prazos: draft.quantidade_prazos,
        nf_url: draft.nfs[0]?.url ?? null, // NF primária = primeira da lista (compat)
        parcelas_recebimento: parcelas,
        status: markReceived ? "recebido" : status,
      };
      const itensPayload = items
        .filter((i) => i.aviamento_id)
        .map((i) => ({
          id: i.id ?? null,
          aviamento_id: i.aviamento_id,
          variante_aviamento_id: i.variante_aviamento_id ?? null,
          quantidade_pedida: i.quantidade_pedida,
          quantidade_recebida: i.quantidade_recebida,
          cancelado: i.cancelado,
        }));

      // RPC transacional: diff de itens + OC + recálculo de parcelas numa ÚNICA transação.
      // Dentro da RPC os itens entram ANTES do status='recebido' (o trigger gerar_parcelas
      // lê os itens no UPDATE) e recalcular_parcelas roda no fim (preserva pagas). Acaba
      // com a janela de falha parcial das 6-8 chamadas que isto era no cliente.
      const { data: savedId, error } = await supabase.rpc("salvar_oc_aviamento" as any, {
        _oc_id: isEdit ? ocId : null,
        _oc: ocPayload,
        _itens: itensPayload,
      });
      if (error) throw error;
      // NFs (lista) — fora da RPC crítica de parcelas (nf_url já salvo como a primeira).
      const oid = isEdit ? ocId : ((savedId as string | null) ?? null);
      if (oid) {
        const { error: nfErr } = await supabase.from("ocs_aviamento").update({ nfs: draft.nfs } as any).eq("id", oid);
        if (nfErr) throw nfErr;
      }
    },
    onSuccess: () => {
      toast.success("OC salva");
      markClean();
      qc.invalidateQueries({ queryKey: ["ocs_aviamento"] });
      qc.invalidateQueries({ queryKey: ["ocs-avi-totals"] });
      qc.invalidateQueries({ queryKey: ["oc-avi"] });
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      qc.invalidateQueries({ queryKey: ["estoque-aviamentos"] });
      qc.invalidateQueries({ queryKey: ["dash-estoque"] });
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar")),
  });

  const unmarkReceivedMut = useMutation({
    mutationFn: async () => {
      if (!ocId) return;
      // Atômico numa RPC (antes: UPDATE status + DELETE parcelas soltos → estado parcial em falha).
      const { error } = await supabase.rpc("desmarcar_recebimento_oc" as any, { _tipo: "aviamento", _oc_id: ocId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("OC voltou para Encomendado.");
      setConfirmUnmark(false);
      qc.invalidateQueries({ queryKey: ["ocs_aviamento"] });
      qc.invalidateQueries({ queryKey: ["ocs-avi-totals"] });
      qc.invalidateQueries({ queryKey: ["oc-avi"] });
      qc.invalidateQueries({ queryKey: ["parcelas"] });
      qc.invalidateQueries({ queryKey: ["estoque-aviamentos"] });
      qc.invalidateQueries({ queryKey: ["dash-estoque"] });
      qc.invalidateQueries({ queryKey: ["sidebar-badges"] });
      onSaved();
      onClose();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao desmarcar recebido.")),
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
    draft.nfs.length > 0 &&
    todasParcelasOk;

  const getMissingRequirements = (): string[] => {
    const m: string[] = [];
    if (!items.some((i) => (i.quantidade_recebida ?? 0) > 0)) m.push("Preencha a quantidade recebida de pelo menos um aviamento");
    if (draft.nfs.length === 0) m.push("Anexe ao menos uma nota fiscal");
    if (parcelas.length === 0) {
      m.push("Defina a quantidade de parcelas de recebimento");
    } else {
      if (!parcelas.every((p) => !!p.data)) m.push("Preencha as datas de todas as parcelas de recebimento");
      if (!parcelas.every((p) => p.recebido === true)) m.push("Marque todas as parcelas como recebidas");
    }
    return m;
  };

  const handleSave = () => {
    if (savingRef.current || saveMutation.isPending) return; // guarda síncrona contra duplo-clique
    savingRef.current = true;
    saveMutation.mutate(false, { onSettled: () => { savingRef.current = false; } });
  };

  const handleMarkReceived = () => {
    if (savingRef.current || saveMutation.isPending) return; // guarda síncrona contra duplo-clique
    if (!canMarkReceived) {
      const missing = getMissingRequirements();
      toast.error("Não é possível marcar como recebido", {
        description: missing.length ? missing.join(" • ") : undefined,
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
    <OcModalShell isEdit={isEdit} onClose={onClose} dirty={dirty} discardMessage="Há alterações não salvas nesta OC de aviamento.">
        <div className="shrink-0 space-y-1">
          <Breadcrumb items={[{ label: "Entrada & Saída" }, { label: "OC Aviamento" }, { label: draft.numero_pedido || "OC" }]} />
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>{isEdit ? `OC ${draft.numero_pedido || ""}` : "Nova OC de Aviamento"}</DialogTitle>
              <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
            </div>
          </DialogHeader>
        </div>

        <div className="space-y-6 min-h-0 overflow-y-auto">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="grid gap-1">
              <Label>Número do Pedido</Label>
              <Input value={draft.numero_pedido} onChange={(e) => setDraft((d) => ({ ...d, numero_pedido: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label>Fornecedor</Label>
              {/* Dropdown único: empresa (direto) OU empresa via representante. Trocar de
                  EMPRESA limpa os itens (aviamentos são por empresa; itens de outra empresa
                  virariam órfãos). Trocar só o representante (mesma empresa) mantém os itens. */}
              <FornecedorSelect
                empresas={empresas}
                empresaId={draft.empresa_id}
                representanteId={draft.representante_id}
                onChange={(empresa_id, representante_id) => {
                  if (empresa_id !== draft.empresa_id) setItems([]);
                  setDraft((d) => ({ ...d, empresa_id, representante_id }));
                }}
              />
            </div>

            <div className="grid gap-1">
              <Label>Responsável</Label>
              <ResponsavelSelect nome={draft.responsavel_nome} onChange={(n) => setDraft((d) => ({ ...d, responsavel_nome: n ?? "" }))} />
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
              <DateField value={draft.data_pedido} onChange={(e) => setDraft((d) => ({ ...d, data_pedido: e.target.value }))} />
            </div>
            <div className="grid gap-1">
              <Label>Data Prevista de Entrega *</Label>
              <DateField value={draft.data_prevista_entrega} onChange={(e) => setDraft((d) => ({ ...d, data_prevista_entrega: e.target.value }))} />
            </div>


            <div className="grid gap-1">
              <Label>Qtd. Parcelas de Recebimento</Label>
              <NumberInput
                type="number"
                integer
                min={1}
                max={24}
                value={draft.parcelas_recebimento?.length || 1}
                onChange={(e) => {
                  const n = Math.max(1, Math.min(24, Math.trunc(Number(e.target.value)) || 1));
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

            <Table className="card-table">
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
                      <div className="space-y-1.5">
                        <Select
                          value={i.aviamento_id}
                          onValueChange={(v) => updateItem(i.tempId, { aviamento_id: v, variante_aviamento_id: null })}
                        >
                          <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                          <SelectContent>
                            {aviamentos.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.codigo_nome} — {fmtMoney(Number(a.preco ?? 0))}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {/* 2º Select: variantes (cor) do aviamento escolhido. Exibe a variante
                            COMPRADA quando editando. Aviamento SEM variantes cadastradas mostra uma
                            DICA (antes ocultava em silêncio e parecia que "não dava pra adicionar"
                            variante — dono ago/2026). */}
                        {(() => {
                          const vars = aviMap[i.aviamento_id]?.variantes ?? [];
                          if (!i.aviamento_id) return null;
                          if (vars.length === 0) return (
                            <p className="text-[11px] text-muted-foreground">Sem variantes — cadastre em Cadastro › Aviamentos.</p>
                          );
                          return (
                            <Select
                              value={i.variante_aviamento_id ?? ""}
                              onValueChange={(v) => updateItem(i.tempId, { variante_aviamento_id: v || null })}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Variante (cor)…" />
                              </SelectTrigger>
                              <SelectContent>
                                {vars.map((vr) => (
                                  <SelectItem key={vr.id} value={vr.id}>{varianteAviLabel(vr)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          );
                        })()}
                      </div>
                    </TableCell>
                    <TableCell data-label="Qtd Pedida">
                      <NumberInput type="number" step="0.01" placeholder="0" value={i.quantidade_pedida || undefined}
                        disabled={i.cancelado || isReadOnlyRecebimento}
                        onChange={(e) => updateItem(i.tempId, { quantidade_pedida: Number(e.target.value) })} />
                    </TableCell>
                    {canShowRecebimento && (
                      <TableCell data-label="Qtd Recebida">
                        <NumberInput type="number" step="0.01" value={i.quantidade_recebida ?? ""}
                          disabled={i.cancelado}
                          onChange={(e) => updateItem(i.tempId, { quantidade_recebida: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} />
                      </TableCell>
                    )}
                    <TableCell data-label="Valor Prev." className="text-sm">{fmtMoney(valorPrev(i))}</TableCell>
                    {canShowRecebimento && <TableCell data-label="Valor Real" className="text-sm">{fmtMoney(valorReal(i))}</TableCell>}
                    <TableCell data-label="Ações">
                      <div className="flex items-center gap-1">
                        {/* Cancelar item só faz sentido numa OC já existente (encomendada ou
                            recebida); na "Nova OC" não há o que cancelar dentro da própria ordem. */}
                        {isEdit && (
                          <label className="flex items-center gap-1 text-xs text-muted-foreground" title="Cancelar item">
                            <Checkbox
                              checked={i.cancelado}
                              onCheckedChange={(c) => updateItem(i.tempId, { cancelado: !!c })}
                            />
                            Cancelar
                          </label>
                        )}
                        {!isReadOnlyRecebimento && (
                          <Button size="iconSm" variant="ghost" onClick={() => removeItem(i.tempId)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="flex flex-wrap gap-x-6 gap-y-2 justify-end text-sm">
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
                  <DateField value={draft.data_entrega || derivedEntrega} disabled readOnly />
                </div>
              </div>

              <NfList
                value={draft.nfs}
                onChange={(nfs) => setDraft((d) => ({ ...d, nfs }))}
                uploadFn={(f) => uploadFile(f, "nf")}
                bucket="oc-aviamento"
                readOnly={isReadOnlyRecebimento}
              />

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
                        <DateField
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
            <AlertDialogAction variant="destructive" onClick={() => unmarkReceivedMut.mutate()} disabled={unmarkReceivedMut.isPending}>
              Desmarcar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
