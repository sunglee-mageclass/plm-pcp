import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tag, Plus, Pencil, Trash2, Search, Loader2, X, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { NumberInput } from "@/components/shared/NumberInput";
import { FornecedorSelect, type EmpresaFornecedor } from "@/components/shared/FornecedorSelect";
import { empresaTemCategoria, ETIQUETA_TOKENS } from "@/lib/fornecedor-categoria";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { useSort, SortHead } from "@/components/shared/sort";
import { EmptyState } from "@/components/shared/EmptyState";
import { useAuth } from "@/hooks/useAuth";
import { fmtNum } from "@/lib/format";
import { useUnsavedGuard, UnsavedChangesGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";

export const Route = createFileRoute("/_authenticated/cadastro/etiquetas")({
  component: () => (
    <RequirePermission page="cadastro_etiquetas">
      <EtiquetasPage />
    </RequirePermission>
  ),
});

// Editor por COR: cada bloco é uma cor (ou "sem cor") com um preço e os tamanhos que
// existem naquela cor (checkbox). Sem tamanhos marcados = variante só da cor (sem tamanho).
type CorBlock = { cor_id: string; preco: number | null; tamanhos: string[] };
type Etiqueta = {
  id: string; nome: string; unidade: string; preco: number | null;
  empresa_id: string | null; representante_id: string | null; observacoes: string | null;
  formato_tamanho: string; n_variantes: number;
};

const UNIDADES = ["unidade", "metro", "rolo", "milheiro"];
const FORMATOS = [
  { value: "ambos", label: "Ambos (PPP · 34)" },
  { value: "numero", label: "Número (34)" },
  { value: "letra", label: "Letra (PPP)" },
  { value: "nenhum", label: "Nenhum (sem tamanho)" },
];
const DEFAULT_TAMANHOS = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
const SEM = "__none__";
// "38|P" -> conforme o formato da etiqueta: "P · 38" | "38" | "P".
const fmtTamanho = (t: string, formato = "ambos") => {
  const [num, sig] = t.split("|");
  if (!sig) return t;
  if (formato === "numero") return num;
  if (formato === "letra") return sig;
  return `${sig} · ${num}`;
};

function EtiquetasPage() {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const tenantId = useActiveTenantId();
  const { isAdmin } = useAuth();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Etiqueta | null>(null);
  const [deleteRow, setDeleteRow] = useState<Etiqueta | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const colCount = isAdmin ? 6 : 5;

  // form
  const [fNome, setFNome] = useState("");
  const [fUnidade, setFUnidade] = useState("unidade");
  const [fEmpresa, setFEmpresa] = useState<string | null>(null);
  const [fRep, setFRep] = useState<string | null>(null);
  const [fPreco, setFPreco] = useState<number | null>(null);
  const [fFormato, setFFormato] = useState("ambos");
  const [fObs, setFObs] = useState("");
  const [fBlocks, setFBlocks] = useState<CorBlock[]>([]);

  const { data: etiquetas = [], isLoading } = useQuery({
    queryKey: ["etiquetas-cadastro"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("etiquetas" as any)
        .select("id, nome, unidade, preco, empresa_id, representante_id, observacoes, formato_tamanho, variantes_etiqueta(id)")
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as any[]).map((e) => ({
        id: e.id, nome: e.nome, unidade: e.unidade ?? "unidade", preco: e.preco,
        empresa_id: e.empresa_id, representante_id: e.representante_id, observacoes: e.observacoes,
        formato_tamanho: e.formato_tamanho ?? "ambos", n_variantes: (e.variantes_etiqueta ?? []).length,
      })) as Etiqueta[];
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options", "etiqueta"],
    queryFn: async () => {
      // Fornecedores de material cuja categoria casa Insumo/Etiqueta/Tag (token flexível).
      const { data } = await supabase
        .from("empresas")
        .select("id,nome_fantasia,representantes(id, nome),empresa_categorias_fornecedor(categorias_fornecedor(nome))")
        .eq("tipo", "material")
        .order("nome_fantasia");
      return ((data ?? []) as any[])
        .filter((e) => empresaTemCategoria(e, ETIQUETA_TOKENS))
        .map((e) => ({
          id: e.id as string, nome_fantasia: e.nome_fantasia as string, representantes: e.representantes ?? [],
        })) as EmpresaFornecedor[];
    },
  });
  const empresasMap = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome_fantasia])), [empresas]);

  const { data: cores = [] } = useQuery({
    queryKey: ["cores-opts", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("cores").select("id, nome").order("nome");
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const corMap = useMemo(() => new Map(cores.map((c) => [c.id, c.nome])), [cores]);

  const { data: tamanhos = [] } = useQuery({
    queryKey: ["tenant-tamanhos-grade", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", tenantId).limit(1);
      const raw = (data ?? [])[0]?.tamanhos_grade as any;
      return (Array.isArray(raw) && raw.length > 0
        ? raw.map((x: any) => (typeof x === "string" ? x : (x?.nome ?? x?.label ?? String(x))))
        : DEFAULT_TAMANHOS) as string[];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return s ? etiquetas.filter((e) => e.nome.toLowerCase().includes(s)) : etiquetas;
  }, [etiquetas, search]);
  const { sorted, sortKey, sortDir, toggle } = useSort(filtered, { key: "nome" });
  const sortState = { sortKey, sortDir, toggle };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["etiquetas-cadastro"] });
    qc.invalidateQueries({ queryKey: ["etiquetas-opts"] });
  };

  // Snapshot do formulário para detecção de alterações (Case C — muitos campos + async).
  const formSnapshot = { nome: fNome, unidade: fUnidade, empresa: fEmpresa, rep: fRep, preco: fPreco, formato: fFormato, obs: fObs, blocks: fBlocks };
  const { dirty: snapshotDirty, markClean, reset: resetBaseline } = useDirtySnapshot(formSnapshot);
  const dirty = open && snapshotDirty;
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose: () => setOpen(false) });

  const resetForm = () => {
    setFNome(""); setFUnidade("unidade"); setFEmpresa(null); setFRep(null); setFPreco(null);
    setFFormato("ambos"); setFObs(""); setFBlocks([]);
  };
  const openCreate = () => {
    setEditing(null);
    resetForm();
    setOpen(true);
    // Baseline limpa (formulário vazio) para detecção de alterações.
    resetBaseline({ nome: "", unidade: "unidade", empresa: null, rep: null, preco: null, formato: "ambos", obs: "", blocks: [] });
  };
  const openEdit = async (e: Etiqueta) => {
    setEditing(e);
    setFNome(e.nome); setFUnidade(e.unidade); setFEmpresa(e.empresa_id); setFRep(e.representante_id);
    setFPreco(e.preco); setFFormato(e.formato_tamanho ?? "ambos"); setFObs(e.observacoes ?? ""); setFBlocks([]);
    setOpen(true);
    const { data } = await supabase.from("variantes_etiqueta" as any).select("tamanho, cor_id, preco").eq("etiqueta_id", e.id);
    // agrupa variantes por cor → blocos
    const byCor = new Map<string, CorBlock>();
    for (const v of (data ?? []) as any[]) {
      const key = v.cor_id ?? "";
      let b = byCor.get(key);
      if (!b) { b = { cor_id: key, preco: v.preco ?? null, tamanhos: [] }; byCor.set(key, b); }
      if (v.tamanho) b.tamanhos.push(v.tamanho);
      if (b.preco == null && v.preco != null) b.preco = v.preco;
    }
    const blocks = [...byCor.values()];
    setFBlocks(blocks);
    // Passa o valor completo (incluindo blocos recém carregados) como baseline —
    // não confiar no estado ainda-não-renderizado (stale no mesmo tick).
    resetBaseline({
      nome: e.nome, unidade: e.unidade, empresa: e.empresa_id, rep: e.representante_id,
      preco: e.preco, formato: e.formato_tamanho ?? "ambos", obs: e.observacoes ?? "", blocks,
    });
  };

  const usedCors = (except: number) => new Set(fBlocks.filter((_, j) => j !== except).map((b) => b.cor_id));
  const addBlock = () => setFBlocks((bs) => [...bs, { cor_id: "", preco: fPreco, tamanhos: [] }]);
  const updBlock = (i: number, patch: Partial<CorBlock>) => setFBlocks((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const rmBlock = (i: number) => setFBlocks((bs) => bs.filter((_, j) => j !== i));
  const toggleTamanho = (i: number, t: string) => setFBlocks((bs) => bs.map((b, j) => {
    if (j !== i) return b;
    const has = b.tamanhos.includes(t);
    return { ...b, tamanhos: has ? b.tamanhos.filter((x) => x !== t) : [...b.tamanhos, t] };
  }));
  const aplicarPrecoTodas = () => setFBlocks((bs) => bs.map((b) => ({ ...b, preco: fPreco })));

  const saveMut = useMutation({
    mutationFn: async () => {
      const nome = fNome.trim();
      if (!nome) throw new Error("Informe o nome da etiqueta.");
      // uma cor por bloco (não repetir cor)
      const seenCor = new Set<string>();
      for (const b of fBlocks) {
        if (seenCor.has(b.cor_id)) throw new Error("Há mais de um bloco para a mesma cor.");
        seenCor.add(b.cor_id);
      }
      // expande blocos → variantes (sem tamanho marcado = 1 variante só da cor)
      const variantes = fBlocks.flatMap((b) =>
        (b.tamanhos.length === 0 ? [null] : b.tamanhos).map((t) => ({
          tamanho: t, cor_id: b.cor_id || null, preco: b.preco,
        })),
      );
      const payload = {
        nome, unidade: fUnidade, empresa_id: fEmpresa, representante_id: fRep,
        preco: fPreco, formato_tamanho: fFormato, observacoes: fObs.trim() || null,
      };
      let etqId = editing?.id;
      if (editing) {
        const { error } = await supabase.from("etiquetas" as any).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("etiquetas" as any).insert(payload).select("id").single();
        if (error) throw error;
        etqId = (data as any).id;
      }
      // Substitui todas as variantes (nada referencia o id da variante nesta fase; o
      // trigger acerta etiquetas.preco = MAX das variantes ao inserir).
      if (editing) {
        const { error } = await supabase.from("variantes_etiqueta" as any).delete().eq("etiqueta_id", etqId);
        if (error) throw error;
      }
      if (variantes.length) {
        const { error } = await supabase.from("variantes_etiqueta" as any).insert(variantes.map((v) => ({ ...v, etiqueta_id: etqId })));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Etiqueta atualizada." : "Etiqueta criada.");
      markClean();
      setOpen(false); invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Etiqueta (ou variante) já existe." : mensagemErro(e, "Erro ao salvar.")),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("etiquetas" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Excluída."); setDeleteRow(null); invalidate(); },
    onError: (e: any) =>
      toast.error(e?.code === "23503" ? "Etiqueta em uso (CAD/modelo). Remova de lá antes." : mensagemErro(e, "Erro ao excluir.")),
  });

  const selectableIds = useMemo(() => sorted.map((e) => e.id), [sorted]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));
  const toggleOne = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const bulkDelete = async () => {
    setBulkBusy(true);
    let ok = 0, emUso = 0;
    for (const id of Array.from(selected)) {
      const { error } = await supabase.from("etiquetas" as any).delete().eq("id", id);
      if (error) emUso++; else ok++;
    }
    setBulkBusy(false); setBulkOpen(false); setSelected(new Set()); invalidate();
    if (ok > 0) toast.success(`${ok} excluída(s).${emUso > 0 ? ` ${emUso} em uso (não excluída(s)).` : ""}`);
    else toast.error(`Nenhuma excluída${emUso > 0 ? ` — ${emUso} em uso` : ""}.`);
  };

  const fornecedorLabel = (e: Etiqueta) => (e.empresa_id ? empresasMap.get(e.empresa_id) ?? "—" : "—");

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex items-start gap-3">
        <Tag className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Insumos</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro de tags / etiquetas com variantes por tamanho × cor, unidade, fornecedor e preço.
          </p>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar etiquetas…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        {isAdmin && selected.size > 0 && !readOnly && (
          <Button variant="destructive" onClick={() => setBulkOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Excluir ({selected.size})
          </Button>
        )}
        <Button onClick={openCreate} className="max-sm:hidden" disabled={readOnly}>
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {isAdmin && (
                <TableHead className="w-10">
                  {selectableIds.length > 0 && !readOnly && (
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todos" />
                  )}
                </TableHead>
              )}
              <SortHead label="Nome" sortKey="nome" sortState={sortState} />
              <SortHead label="Unidade" sortKey="unidade" sortState={sortState} />
              <TableHead>Fornecedor</TableHead>
              <TableHead className="text-right">Preço</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…
                </TableCell>
              </TableRow>
            ) : sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="p-0">
                  {etiquetas.length === 0 ? (
                    <EmptyState icon={Tag} title="Nenhuma etiqueta cadastrada"
                      description="Cadastre tags / etiquetas com variantes por tamanho × cor."
                      action={readOnly ? undefined : { label: "Nova etiqueta", onClick: openCreate }}
                      className="border-0 bg-transparent" />
                  ) : (
                    <EmptyState icon={Search} title="Nenhuma etiqueta encontrada"
                      description="Nenhuma etiqueta corresponde à busca atual."
                      action={{ label: "Limpar busca", onClick: () => setSearch("") }}
                      className="border-0 bg-transparent" />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((e) => (
                <TableRow key={e.id} data-state={selected.has(e.id) ? "selected" : undefined}>
                  {isAdmin && (
                    <TableCell className="w-10">
                      {!readOnly && <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggleOne(e.id)} aria-label="Selecionar" />}
                    </TableCell>
                  )}
                  <TableCell>
                    <button type="button" className="text-left hover:underline font-medium" onClick={() => openEdit(e)}>{e.nome}</button>
                    {e.n_variantes > 0 && <Badge variant="secondary" className="ml-2">{e.n_variantes} var.</Badge>}
                  </TableCell>
                  <TableCell className="capitalize">{e.unidade}</TableCell>
                  <TableCell className="text-muted-foreground">{fornecedorLabel(e)}</TableCell>
                  <TableCell className="text-right">{e.preco != null ? `R$ ${fmtNum(e.preco)}` : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(e)} aria-label="Editar"><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleteRow(e)} disabled={readOnly} aria-label="Excluir">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-muted-foreground">
        <Badge variant="secondary">{filtered.length}</Badge> {filtered.length === 1 ? "etiqueta" : "etiquetas"}
      </div>

      {/* Criar / editar. Regra 3: EDITAR = Sheet lateral (side=right, ~70vw); NOVO = Dialog
          central. Mesmo conteúdo interno (`modalConteudo`); a guarda de "não salvo" fica
          DENTRO do container (antes ficava fora e a msg ficava escondida). */}
      {(() => {
        const TitleTag = editing ? SheetTitle : DialogTitle;
        const modalConteudo = (
          <>
          <div className="shrink-0 border-b px-6 pt-6 pb-3">
            <div className="flex items-center gap-2">
              <TitleTag className="text-lg font-semibold">{editing ? "Editar etiqueta" : "Nova etiqueta"}</TitleTag>
              <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Nome</Label>
                <Input autoFocus value={fNome} onChange={(e) => setFNome(e.target.value)} placeholder="Ex: Etiqueta de composição" disabled={readOnly} />
              </div>
              <div className="space-y-1.5">
                <Label>Unidade</Label>
                <Select value={fUnidade} onValueChange={setFUnidade} disabled={readOnly}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNIDADES.map((u) => <SelectItem key={u} value={u} className="capitalize">{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Formato do tamanho</Label>
                <Select
                  value={fFormato}
                  onValueChange={(v) => { setFFormato(v); if (v === "nenhum") setFBlocks((bs) => bs.map((b) => ({ ...b, tamanhos: [] }))); }}
                  disabled={readOnly}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FORMATOS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Preço base (R$)</Label>
                <div className="flex items-center gap-2">
                  <NumberInput type="number" step="0.01" placeholder="0,00" value={fPreco ?? ""} onChange={(e) => setFPreco(e.target.value === "" ? null : Number(e.target.value))} disabled={readOnly} />
                  {fBlocks.length > 0 && !readOnly && (
                    <Button type="button" variant="link" className="px-0 h-auto shrink-0" onClick={aplicarPrecoTodas}>Aplicar a todas</Button>
                  )}
                </div>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Fornecedor</Label>
                <FornecedorSelect empresas={empresas} empresaId={fEmpresa} representanteId={fRep}
                  onChange={(emp, rep) => { setFEmpresa(emp); setFRep(rep); }} disabled={readOnly} placeholder="Sem fornecedor" />
              </div>
            </div>

            {/* Variantes por cor: escolhe a cor e marca os tamanhos (opcional). */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Variantes por cor</Label>
                {!readOnly && <Button type="button" variant="outline" size="sm" onClick={addBlock}><Plus className="h-4 w-4 mr-1" /> Cor</Button>}
              </div>
              {fBlocks.length === 0 ? (
                <p className="text-xs text-muted-foreground">Sem variantes. A etiqueta usa só o preço base.</p>
              ) : (
                <div className="space-y-3">
                  {fBlocks.map((b, i) => {
                    const used = usedCors(i);
                    return (
                      <div key={i} className="rounded-md border p-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Select value={b.cor_id || SEM} onValueChange={(val) => updBlock(i, { cor_id: val === SEM ? "" : val })} disabled={readOnly}>
                            <SelectTrigger className="flex-1"><SelectValue placeholder="Cor" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SEM} disabled={used.has("")}>Sem cor</SelectItem>
                              {cores.map((c) => <SelectItem key={c.id} value={c.id} disabled={used.has(c.id)}>{c.nome}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <NumberInput type="number" step="0.01" placeholder="0,00" className="w-24" value={b.preco ?? ""}
                            onChange={(e) => updBlock(i, { preco: e.target.value === "" ? null : Number(e.target.value) })} disabled={readOnly} />
                          {!readOnly && <Button type="button" size="icon" variant="ghost" onClick={() => rmBlock(i)} aria-label="Remover cor"><X className="h-4 w-4" /></Button>}
                        </div>
                        {fFormato !== "nenhum" && (
                          <>
                            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                              {tamanhos.map((t) => (
                                <label key={t} className="flex items-center gap-1.5 text-sm cursor-pointer">
                                  <Checkbox checked={b.tamanhos.includes(t)} onCheckedChange={() => toggleTamanho(i, t)} disabled={readOnly} />
                                  {fmtTamanho(t, fFormato)}
                                </label>
                              ))}
                            </div>
                            {b.tamanhos.length === 0 && <p className="text-[11px] text-muted-foreground">Sem tamanho marcado → variante única desta cor.</p>}
                          </>
                        )}
                      </div>
                    );
                  })}
                  <p className="text-xs text-muted-foreground">O preço base da etiqueta vira o maior preço entre as cores.</p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Input value={fObs} onChange={(e) => setFObs(e.target.value)} placeholder="Opcional" disabled={readOnly} />
            </div>
          </div>
          <div className="shrink-0 border-t bg-background px-6 py-3 flex items-center gap-2 sm:justify-end">
            <Button variant="outline" onClick={requestClose}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
            {!readOnly && (
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Salvando…" : "Salvar"}
              </Button>
            )}
          </div>
          {/* Guarda de descarte DENTRO do container (Sheet/Dialog) — a msg antes ficava
              fora do modal e o dono não a via. */}
          <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste cadastro de insumo." />
          </>
        );
        return editing ? (
          <Sheet open={open} onOpenChange={(o) => { if (!o) requestClose(); }}>
            <SheetContent
              side="right"
              size="editor"
              className="flex flex-col gap-0 p-0 max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!rounded-none max-sm:!border-0 max-sm:!overflow-hidden"
            >
              {modalConteudo}
            </SheetContent>
          </Sheet>
        ) : (
          <Dialog open={open} onOpenChange={(o) => { if (!o) requestClose(); }}>
            <DialogContent className="flex flex-col gap-0 p-0 sm:max-w-2xl max-h-[90vh] max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!overflow-hidden">
              {modalConteudo}
            </DialogContent>
          </Dialog>
        );
      })()}

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir etiqueta?</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja excluir <strong>{deleteRow?.nome}</strong>? As variantes também serão removidas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (deleteRow) delMut.mutate(deleteRow.id); }}
              variant="destructive">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkOpen} onOpenChange={(o) => { if (!o && !bulkBusy) setBulkOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selected.size} etiqueta(s)?</AlertDialogTitle>
            <AlertDialogDescription>Etiquetas em uso (CAD/modelo) são puladas. Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); bulkDelete(); }} disabled={bulkBusy}
              variant="destructive">
              {bulkBusy ? "Excluindo…" : `Excluir ${selected.size}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MobileActionBar>
        <Button onClick={openCreate} className="ml-auto" disabled={readOnly}><Plus className="h-4 w-4 mr-1" /> Novo</Button>
      </MobileActionBar>
    </div>
  );
}
