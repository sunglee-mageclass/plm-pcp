import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wrench,
  Search,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Download,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/cadastro/servico")({
  component: () => (
    <RequirePermission page="cadastro_servico">
      <ServicoPage />
    </RequirePermission>
  ),
});

// Terceirizado now supports multiple categorias via terceirizado_categorias junction;
// see TerceirizadosMultiCatTab below.


type SectionKey = "empresa" | "representante" | "terceirizado";

const SECTIONS: {
  value: SectionKey;
  label: string;
  table: string;
  plural: string;
}[] = [
  { value: "empresa", label: "Empresa", table: "empresas", plural: "Empresas" },
  { value: "representante", label: "Representante", table: "representantes", plural: "Representantes" },
  { value: "terceirizado", label: "Terceirizado", table: "terceirizados", plural: "Terceirizados" },
];

function useItemCount(table: string) {
  return useQuery({
    queryKey: ["servico-count", table],
    queryFn: async () => {
      const { count, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(table as any)
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });
}

function ServicoPage() {
  const [selected, setSelected] = useState<SectionKey>("empresa");
  const selectedSection =
    SECTIONS.find((s) => s.value === selected) ?? SECTIONS[0];

  const { data: count, isLoading: countLoading } = useItemCount(
    selectedSection.table
  );

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Wrench className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Serviço</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Empresas, representantes e terceirizados.
          </p>
        </div>
      </header>

      {/* Mobile selector */}
      <div className="md:hidden">
        <Select value={selected} onValueChange={(v) => setSelected(v as SectionKey)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SECTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-6 rounded-lg border bg-card">
        {/* Sidebar */}
        <aside className="hidden md:block w-60 shrink-0 border-r py-4">
          <nav className="space-y-0.5">
            {SECTIONS.map((s) => {
              const active = s.value === selected;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSelected(s.value)}
                  className={cn(
                    "w-full text-left px-4 py-1.5 text-sm transition-colors border-l-2",
                    active
                      ? "bg-muted text-foreground font-medium border-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent"
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 border-b pb-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">
                {selectedSection.plural}
              </h2>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {countLoading
                ? "…"
                : `${count ?? 0} ${count === 1 ? "item" : "itens"}`}
            </Badge>
          </div>

          {selected === "empresa" && <EmpresasMultiCatTab />}
          {selected === "representante" && <RepresentantesTab />}
          {selected === "terceirizado" && <TerceirizadosMultiCatTab />}
        </div>
      </div>
    </div>
  );
}

// ============ Representantes ============

type Representante = {
  id: string;
  empresa_id: string | null;
  nome: string;
  cnpj: string | null;
  razao_social: string | null;
  logradouro: string | null;
  contato: string | null;
  observacoes: string | null;
};

type Empresa = { id: string; nome_fantasia: string };

const emptyForm = {
  id: null as string | null,
  empresa_id: "",
  nome: "",
  cnpj: "",
  razao_social: "",
  logradouro: "",
  contato: "",
  observacoes: "",
  novaEmpresa: "",
  novaEmpresaCategorias: [] as string[],
  modoNovaEmpresa: false,
};

function cleanCnpj(v: string) {
  return v.replace(/\D/g, "");
}

function formatCnpj(v: string) {
  const c = cleanCnpj(v).slice(0, 14);
  return c
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function RepresentantesTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [open, setOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Representante | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["representantes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("representantes")
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Representante[];
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome_fantasia")
        .order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as Empresa[];
    },
  });

  const { data: catsFornecedor = [] } = useQuery({
    queryKey: ["cat-fornecedor-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_fornecedor")
        .select("id, nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const empresasMap = useMemo(() => {
    const m = new Map<string, string>();
    empresas.forEach((e) => m.set(e.id, e.nome_fantasia));
    return m;
  }, [empresas]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.nome, r.contato, r.cnpj, r.empresa_id ? empresasMap.get(r.empresa_id) : ""]
        .map((x) => String(x ?? "").toLowerCase())
        .some((x) => x.includes(s)),
    );
  }, [rows, search, empresasMap]);

  const lookupCnpj = async () => {
    const cnpj = cleanCnpj(form.cnpj);
    if (cnpj.length !== 14) {
      toast.error("CNPJ deve ter 14 dígitos.");
      return;
    }
    setLookupLoading(true);
    try {
      const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
      if (!res.ok) throw new Error("CNPJ não encontrado.");
      const data = await res.json();
      const logradouroParts = [
        data.logradouro,
        data.numero,
        data.bairro,
        data.municipio,
        data.uf,
        data.cep,
      ].filter(Boolean);
      setForm((f) => ({
        ...f,
        razao_social: data.razao_social ?? data.nome ?? f.razao_social,
        logradouro: logradouroParts.join(", ") || f.logradouro,
      }));
      toast.success("Dados preenchidos.");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao buscar CNPJ.");
    } finally {
      setLookupLoading(false);
    }
  };

  const openCreate = () => {
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (r: Representante) => {
    setForm({
      id: r.id,
      empresa_id: r.empresa_id ?? "",
      nome: r.nome ?? "",
      cnpj: r.cnpj ?? "",
      razao_social: r.razao_social ?? "",
      logradouro: r.logradouro ?? "",
      contato: r.contato ?? "",
      observacoes: r.observacoes ?? "",
      novaEmpresa: "",
      novaEmpresaCategorias: [],
      modoNovaEmpresa: false,
    });
    setOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do representante.");

      let empresaId: string | null = form.empresa_id || null;

      if (form.modoNovaEmpresa) {
        const nome = form.novaEmpresa.trim();
        if (!nome) throw new Error("Informe o nome da nova empresa.");
        if (form.novaEmpresaCategorias.length === 0)
          throw new Error("Selecione ao menos uma categoria do fornecedor.");
        const { data: empresa, error: errE } = await supabase
          .from("empresas")
          .insert({ nome_fantasia: nome })
          .select("id")
          .single();
        if (errE) throw errE;
        empresaId = empresa.id;
        const { error: errLink } = await supabase
          .from("empresa_categorias_fornecedor")
          .insert(
            form.novaEmpresaCategorias.map((cid) => ({
              empresa_id: empresaId!,
              categoria_fornecedor_id: cid,
            })),
          );
        if (errLink) throw errLink;
      }

      const payload = {
        empresa_id: empresaId,
        nome: form.nome.trim(),
        cnpj: form.cnpj ? cleanCnpj(form.cnpj) : null,
        razao_social: form.razao_social || null,
        logradouro: form.logradouro || null,
        contato: form.contato || null,
        observacoes: form.observacoes || null,
      };

      if (form.id) {
        const { error } = await supabase
          .from("representantes")
          .update(payload)
          .eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("representantes").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Representante atualizado." : "Representante criado.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["representantes"] });
      qc.invalidateQueries({ queryKey: ["empresas-options"] });
      qc.invalidateQueries({ queryKey: ["attr", "empresas", ""] });
      qc.invalidateQueries({ queryKey: ["servico-count", "representantes"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar."),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("representantes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Excluído.");
      setDeleteRow(null);
      qc.invalidateQueries({ queryKey: ["representantes"] });
      qc.invalidateQueries({ queryKey: ["servico-count", "representantes"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir."),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar representantes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Empresa</TableHead>
              <TableHead>Representante</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead className="w-28 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Nenhum representante encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.empresa_id ? empresasMap.get(r.empresa_id) ?? "—" : "—"}</TableCell>
                  <TableCell>
                    <button
                      className="text-left hover:underline"
                      onClick={() => openEdit(r)}
                    >
                      {r.nome}
                    </button>
                  </TableCell>
                  <TableCell>{r.contato ?? "—"}</TableCell>
                  <TableCell>{r.cnpj ? formatCnpj(r.cnpj) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(r)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleteRow(r)}>
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
        <Badge variant="secondary">{filtered.length}</Badge> registro(s)
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar representante" : "Novo representante"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Empresa</Label>
              <div className="flex gap-2">
                {!form.modoNovaEmpresa ? (
                  <>
                    <Select
                      value={form.empresa_id}
                      onValueChange={(v) => setForm({ ...form, empresa_id: v })}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Selecione uma empresa…" />
                      </SelectTrigger>
                      <SelectContent>
                        {empresas.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.nome_fantasia}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setForm({ ...form, modoNovaEmpresa: true, empresa_id: "" })}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Nova
                    </Button>
                  </>
                ) : (
                  <div className="grid gap-2 flex-1 sm:grid-cols-2">
                    <Input
                      placeholder="Nome fantasia"
                      value={form.novaEmpresa}
                      onChange={(e) => setForm({ ...form, novaEmpresa: e.target.value })}
                    />
                    <CategoriasFornecedorMultiSelect
                      options={catsFornecedor}
                      value={form.novaEmpresaCategorias}
                      onChange={(v) => setForm({ ...form, novaEmpresaCategorias: v })}
                      placeholder="Categorias do fornecedor…"
                    />

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="sm:col-span-2 justify-self-start"
                      onClick={() => setForm({ ...form, modoNovaEmpresa: false })}
                    >
                      Cancelar nova empresa
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>CNPJ</Label>
                <div className="flex gap-2">
                  <Input
                    value={formatCnpj(form.cnpj)}
                    onChange={(e) => setForm({ ...form, cnpj: cleanCnpj(e.target.value) })}
                    placeholder="00.000.000/0000-00"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={lookupCnpj}
                    disabled={lookupLoading}
                  >
                    {lookupLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Nome do representante</Label>
                <Input
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Razão Social</Label>
                <Input
                  value={form.razao_social}
                  onChange={(e) => setForm({ ...form, razao_social: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Logradouro</Label>
                <Input
                  value={form.logradouro}
                  onChange={(e) => setForm({ ...form, logradouro: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Contato</Label>
                <Input
                  value={form.contato}
                  onChange={(e) => setForm({ ...form, contato: e.target.value })}
                  placeholder="Telefone, email…"
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Observações</Label>
                <Textarea
                  rows={3}
                  value={form.observacoes}
                  onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir representante?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{deleteRow?.nome}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteRow) deleteMut.mutate(deleteRow.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============ Categorias Fornecedor Multi-Select ============

type CatOption = { id: string; nome: string };

function CategoriasFornecedorMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Selecione categorias…",
}: {
  options: CatOption[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabels = options
    .filter((o) => value.includes(o.id))
    .map((o) => o.nome);

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
        >
          <span className="truncate text-left">
            {selectedLabels.length === 0
              ? placeholder
              : selectedLabels.length <= 2
                ? selectedLabels.join(", ")
                : `${selectedLabels.length} categorias`}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="max-h-64 overflow-y-auto space-y-1">
          {options.length === 0 ? (
            <div className="text-sm text-muted-foreground p-2">
              Nenhuma categoria cadastrada.
            </div>
          ) : (
            options.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={value.includes(o.id)}
                  onCheckedChange={() => toggle(o.id)}
                />
                <span className="text-sm">{o.nome}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============ Empresas (multi-categoria) ============

type EmpresaRow = {
  id: string;
  nome_fantasia: string;
};

function EmpresasMultiCatTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [deleteRow, setDeleteRow] = useState<EmpresaRow | null>(null);
  const [deleteUsage, setDeleteUsage] = useState<number | null>(null);

  const { data: empresas = [], isLoading } = useQuery({
    queryKey: ["empresas-multi"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome_fantasia")
        .order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as EmpresaRow[];
    },
  });

  const { data: catsFornecedor = [] } = useQuery({
    queryKey: ["cat-fornecedor-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_fornecedor")
        .select("id, nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as CatOption[];
    },
  });

  const { data: links = [] } = useQuery({
    queryKey: ["empresa-categorias-links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresa_categorias_fornecedor")
        .select("empresa_id, categoria_fornecedor_id");
      if (error) throw error;
      return (data ?? []) as { empresa_id: string; categoria_fornecedor_id: string }[];
    },
  });

  const linksByEmpresa = useMemo(() => {
    const m = new Map<string, string[]>();
    links.forEach((l) => {
      const arr = m.get(l.empresa_id) ?? [];
      arr.push(l.categoria_fornecedor_id);
      m.set(l.empresa_id, arr);
    });
    return m;
  }, [links]);

  const catsMap = useMemo(() => {
    const m = new Map<string, string>();
    catsFornecedor.forEach((c) => m.set(c.id, c.nome));
    return m;
  }, [catsFornecedor]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return empresas;
    return empresas.filter((e) =>
      e.nome_fantasia.toLowerCase().includes(s),
    );
  }, [empresas, search]);

  const resetForm = () => {
    setEditingId(null);
    setNome("");
    setCats([]);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (e: EmpresaRow) => {
    setEditingId(e.id);
    setNome(e.nome_fantasia);
    setCats(linksByEmpresa.get(e.id) ?? []);
    setOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const v = nome.trim();
      if (!v) throw new Error("Informe o nome fantasia.");
      if (cats.length === 0)
        throw new Error("Selecione ao menos uma categoria do fornecedor.");

      let empresaId = editingId;
      if (editingId) {
        const { error } = await supabase
          .from("empresas")
          .update({ nome_fantasia: v })
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("empresas")
          .insert({ nome_fantasia: v })
          .select("id")
          .single();
        if (error) throw error;
        empresaId = data.id;
      }

      // Reset junction
      const { error: delErr } = await supabase
        .from("empresa_categorias_fornecedor")
        .delete()
        .eq("empresa_id", empresaId!);
      if (delErr) throw delErr;

      const { error: insErr } = await supabase
        .from("empresa_categorias_fornecedor")
        .insert(
          cats.map((cid) => ({
            empresa_id: empresaId!,
            categoria_fornecedor_id: cid,
          })),
        );
      if (insErr) throw insErr;
    },
    onSuccess: () => {
      toast.success(editingId ? "Empresa atualizada." : "Empresa criada.");
      setOpen(false);
      resetForm();
      qc.invalidateQueries({ queryKey: ["empresas-multi"] });
      qc.invalidateQueries({ queryKey: ["empresa-categorias-links"] });
      qc.invalidateQueries({ queryKey: ["empresas-options"] });
      qc.invalidateQueries({ queryKey: ["servico-count", "empresas"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar."),
  });

  const startDelete = async (row: EmpresaRow) => {
    setDeleteRow(row);
    setDeleteUsage(null);
    let total = 0;
    const refs: { table: string; column: string }[] = [
      { table: "representantes", column: "empresa_id" },
      { table: "aviamentos", column: "empresa_id" },
      { table: "ocs_tecido", column: "empresa_id" },
      { table: "ocs_aviamento", column: "empresa_id" },
      { table: "parcelas", column: "empresa_id" },
      { table: "artigos", column: "empresa_id" },
    ];
    for (const r of refs) {
      const { count } = await supabase
        .from(r.table as any)
        .select("*", { count: "exact", head: true })
        .eq(r.column, row.id);
      total += count ?? 0;
    }
    setDeleteUsage(total);
  };

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("empresas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Excluído.");
      setDeleteRow(null);
      setDeleteUsage(null);
      qc.invalidateQueries({ queryKey: ["empresas-multi"] });
      qc.invalidateQueries({ queryKey: ["servico-count", "empresas"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir."),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar empresas…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome Fantasia</TableHead>
              <TableHead>Categorias do Fornecedor</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  Nenhuma empresa encontrada.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const ids = linksByEmpresa.get(row.id) ?? [];
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => openEdit(row)}
                      >
                        {row.nome_fantasia}
                      </button>
                    </TableCell>
                    <TableCell>
                      {ids.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {ids.map((cid) => (
                            <Badge key={cid} variant="secondary">
                              {catsMap.get(cid) ?? "—"}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(row)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => startDelete(row)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-muted-foreground">
        <Badge variant="secondary">{filtered.length}</Badge> registro(s)
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar empresa" : "Nova empresa"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Nome fantasia</Label>
              <Input
                autoFocus
                value={nome}
                onChange={(e) => setNome(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                Categorias do Fornecedor <span className="text-destructive">*</span>
              </Label>
              <CategoriasFornecedorMultiSelect
                options={catsFornecedor}
                value={cats}
                onChange={setCats}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteRow}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteRow(null);
            setDeleteUsage(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUsage === null ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verificando uso…
                </span>
              ) : deleteUsage > 0 ? (
                <>
                  Esta empresa está em uso em <strong>{deleteUsage}</strong> registro(s).
                  Deseja excluir mesmo assim?
                </>
              ) : (
                <>
                  Tem certeza que deseja excluir <strong>{deleteRow?.nome_fantasia}</strong>?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteRow) deleteMut.mutate(deleteRow.id);
              }}
              disabled={deleteUsage === null || deleteMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ============ Terceirizados (multi-categoria) ============

type TerceirizadoRow = {
  id: string;
  nome_responsavel: string;
};

function CategoriasTerceirizadoMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Selecione categorias…",
}: {
  options: CatOption[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabels = options.filter((o) => value.includes(o.id)).map((o) => o.nome);
  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between font-normal">
          <span className="truncate text-left">
            {selectedLabels.length === 0
              ? placeholder
              : selectedLabels.length <= 2
                ? selectedLabels.join(", ")
                : `${selectedLabels.length} categorias`}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="max-h-64 overflow-y-auto space-y-1">
          {options.length === 0 ? (
            <div className="text-sm text-muted-foreground p-2">Nenhuma categoria cadastrada.</div>
          ) : (
            options.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={value.includes(o.id)}
                  onCheckedChange={() => toggle(o.id)}
                />
                <span className="text-sm">{o.nome}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function TerceirizadosMultiCatTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [deleteRow, setDeleteRow] = useState<TerceirizadoRow | null>(null);
  const [deleteUsage, setDeleteUsage] = useState<number | null>(null);

  const { data: terceirizados = [], isLoading } = useQuery({
    queryKey: ["terceirizados-multi"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terceirizados")
        .select("id, nome_responsavel")
        .order("nome_responsavel");
      if (error) throw error;
      return (data ?? []) as TerceirizadoRow[];
    },
  });

  const { data: catsTerc = [] } = useQuery({
    queryKey: ["cat-terceirizado-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_terceirizado")
        .select("id, nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as CatOption[];
    },
  });

  const { data: links = [] } = useQuery({
    queryKey: ["terceirizado-categorias-links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terceirizado_categorias")
        .select("terceirizado_id, categoria_terceirizado_id");
      if (error) throw error;
      return (data ?? []) as { terceirizado_id: string; categoria_terceirizado_id: string }[];
    },
  });

  const linksByTerc = useMemo(() => {
    const m = new Map<string, string[]>();
    links.forEach((l) => {
      const arr = m.get(l.terceirizado_id) ?? [];
      arr.push(l.categoria_terceirizado_id);
      m.set(l.terceirizado_id, arr);
    });
    return m;
  }, [links]);

  const catsMap = useMemo(() => {
    const m = new Map<string, string>();
    catsTerc.forEach((c) => m.set(c.id, c.nome));
    return m;
  }, [catsTerc]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return terceirizados;
    return terceirizados.filter((t) => t.nome_responsavel.toLowerCase().includes(s));
  }, [terceirizados, search]);

  const resetForm = () => {
    setEditingId(null);
    setNome("");
    setCats([]);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = (t: TerceirizadoRow) => {
    setEditingId(t.id);
    setNome(t.nome_responsavel);
    setCats(linksByTerc.get(t.id) ?? []);
    setOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const v = nome.trim();
      if (!v) throw new Error("Informe o nome do responsável.");
      if (cats.length === 0)
        throw new Error("Selecione ao menos uma categoria do terceirizado.");

      let tercId = editingId;
      if (editingId) {
        const { error } = await supabase
          .from("terceirizados")
          .update({
            nome_responsavel: v,
            // Mantém a primeira categoria também na coluna legada para compatibilidade
            categoria_terceirizado_id: cats[0],
          })
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("terceirizados")
          .insert({ nome_responsavel: v, categoria_terceirizado_id: cats[0] })
          .select("id")
          .single();
        if (error) throw error;
        tercId = data.id;
      }

      const { error: delErr } = await supabase
        .from("terceirizado_categorias")
        .delete()
        .eq("terceirizado_id", tercId!);
      if (delErr) throw delErr;

      const { error: insErr } = await supabase
        .from("terceirizado_categorias")
        .insert(
          cats.map((cid) => ({
            terceirizado_id: tercId!,
            categoria_terceirizado_id: cid,
          })),
        );
      if (insErr) throw insErr;
    },
    onSuccess: () => {
      toast.success(editingId ? "Terceirizado atualizado." : "Terceirizado criado.");
      setOpen(false);
      resetForm();
      qc.invalidateQueries({ queryKey: ["terceirizados-multi"] });
      qc.invalidateQueries({ queryKey: ["terceirizado-categorias-links"] });
      qc.invalidateQueries({ queryKey: ["terceirizados-all"] });
      qc.invalidateQueries({ queryKey: ["servico-count", "terceirizados"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar."),
  });

  const startDelete = async (row: TerceirizadoRow) => {
    setDeleteRow(row);
    setDeleteUsage(null);
    let total = 0;
    const refs: { table: string; column: string }[] = [
      { table: "producao_terceirizados", column: "terceirizado_id" },
      { table: "producao_oficina", column: "terceirizado_id" },
      { table: "producao_acabamento", column: "terceirizado_id" },
    ];
    for (const r of refs) {
      const { count } = await supabase
        .from(r.table as any)
        .select("*", { count: "exact", head: true })
        .eq(r.column, row.id);
      total += count ?? 0;
    }
    setDeleteUsage(total);
  };

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("terceirizados").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Excluído.");
      setDeleteRow(null);
      setDeleteUsage(null);
      qc.invalidateQueries({ queryKey: ["terceirizados-multi"] });
      qc.invalidateQueries({ queryKey: ["servico-count", "terceirizados"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir."),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar terceirizados…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome do Responsável</TableHead>
              <TableHead>Categorias do Terceirizado</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  Nenhum terceirizado encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const ids = linksByTerc.get(row.id) ?? [];
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => openEdit(row)}
                      >
                        {row.nome_responsavel}
                      </button>
                    </TableCell>
                    <TableCell>
                      {ids.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {ids.map((cid) => (
                            <Badge key={cid} variant="secondary">
                              {catsMap.get(cid) ?? "—"}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(row)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => startDelete(row)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-muted-foreground">
        <Badge variant="secondary">{filtered.length}</Badge> registro(s)
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar terceirizado" : "Novo terceirizado"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Nome do responsável</Label>
              <Input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>
                Categorias do Terceirizado <span className="text-destructive">*</span>
              </Label>
              <CategoriasTerceirizadoMultiSelect
                options={catsTerc}
                value={cats}
                onChange={setCats}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteRow}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteRow(null);
            setDeleteUsage(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir terceirizado?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUsage === null ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verificando uso…
                </span>
              ) : deleteUsage > 0 ? (
                <>
                  Este terceirizado está em uso em <strong>{deleteUsage}</strong> registro(s).
                  Deseja excluir mesmo assim?
                </>
              ) : (
                <>
                  Tem certeza que deseja excluir <strong>{deleteRow?.nome_responsavel}</strong>?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleteRow) deleteMut.mutate(deleteRow.id);
              }}
              disabled={deleteUsage === null || deleteMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}


