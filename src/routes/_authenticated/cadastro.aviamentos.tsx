import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Package,
  Plus,
  Search,
  LayoutGrid,
  ImageOff,
  Loader2,
  Upload,
  Pencil,
  Trash2,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { useGridCols, GRID_COLS_OPTIONS, GRID_COLS_CLASS } from "@/hooks/useGridCols";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
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
import { FilterButton, SearchToggle } from "@/components/shared/filters";
import { ImagePreview } from "@/components/shared/ImagePreview";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/cadastro/aviamentos")({
  component: () => (
    <RequirePermission page="cadastro_aviamentos">
      <AviamentosGallery />
    </RequirePermission>
  ),
});

type Aviamento = {
  id: string;
  codigo_nome: string;
  empresa_id: string | null;
  categoria_aviamento_id: string | null;
  subcategoria_aviamento_id: string | null;
  material_aviamento_id: string | null;
  composicao: string | null;
  preco: number | null;
  intervalo_largura_id: string | null;
  largura_exata: number | null;
  intervalo_vazado_id: string | null;
  largura_exata_vazado: number | null;
  foto_url: string | null;
  observacoes: string | null;
  created_at: string;
};

type Option = { id: string; nome: string };
type Empresa = { id: string; nome_fantasia: string };
type Subcategoria = { id: string; nome: string; categoria_aviamento_id: string };

const COLUMN_OPTIONS = GRID_COLS_OPTIONS;
const SORT_OPTIONS = [
  { value: "nome", label: "Nome (A-Z)" },
  { value: "preco", label: "Preço (menor)" },
  { value: "preco_desc", label: "Preço (maior)" },
  { value: "recente", label: "Mais recentes" },
];

const fmtBRL = (n: number | null | undefined) =>
  n != null
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n))
    : "—";

function AviamentosGallery() {
  const qc = useQueryClient();
  const [cols, setCols] = useGridCols("aviamentos");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("nome");
  const [fCat, setFCat] = useState("all");
  const [fSub, setFSub] = useState("all");
  const [fMat, setFMat] = useState("all");
  const [fLarg, setFLarg] = useState("all");
  const [fVaz, setFVaz] = useState("all");
  const [fEmp, setFEmp] = useState("all");
  const [editing, setEditing] = useState<Aviamento | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<Aviamento | null>(null);

  const { data: aviamentos = [], isLoading } = useQuery({
    queryKey: ["aviamentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aviamentos")
        .select(
          "id,codigo_nome,empresa_id,categoria_aviamento_id,subcategoria_aviamento_id,material_aviamento_id,composicao,preco,intervalo_largura_id,largura_exata,intervalo_vazado_id,largura_exata_vazado,foto_url,observacoes,created_at",
        );
      if (error) throw error;
      return (data ?? []) as Aviamento[];
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options", "aviamento"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id,nome_fantasia,empresa_categorias_fornecedor!inner(categorias_fornecedor!inner(nome))")
        .eq("empresa_categorias_fornecedor.categorias_fornecedor.nome", "Aviamento")
        .order("nome_fantasia");
      if (error) throw error;
      const seen = new Set<string>();
      return ((data ?? []) as Empresa[]).filter((e) => {
        if (seen.has(e.id)) return false;
        seen.add(e.id);
        return true;
      });
    },
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ["cat-aviamento-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_aviamento")
        .select("id,nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Option[];
    },
  });

  const { data: subcategorias = [] } = useQuery({
    queryKey: ["subcat-aviamento-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subcategorias_aviamento")
        .select("id,nome,categoria_aviamento_id")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Subcategoria[];
    },
  });

  const { data: materiais = [] } = useQuery({
    queryKey: ["mat-aviamento-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("materiais_aviamento")
        .select("id,nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Option[];
    },
  });

  const { data: intervalos = [] } = useQuery({
    queryKey: ["intervalo-largura-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("intervalos_largura")
        .select("id,intervalo")
        .order("intervalo");
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id: r.id, nome: r.intervalo })) as Option[];
    },
  });

  const empresasMap = useMemo(
    () => new Map(empresas.map((e) => [e.id, e.nome_fantasia])),
    [empresas],
  );
  const catMap = useMemo(() => new Map(categorias.map((c) => [c.id, c.nome])), [categorias]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    let list = aviamentos.filter((a) => {
      if (fCat !== "all" && a.categoria_aviamento_id !== fCat) return false;
      if (fSub !== "all" && a.subcategoria_aviamento_id !== fSub) return false;
      if (fMat !== "all" && a.material_aviamento_id !== fMat) return false;
      if (fLarg !== "all" && a.intervalo_largura_id !== fLarg) return false;
      if (fVaz !== "all" && a.intervalo_vazado_id !== fVaz) return false;
      if (fEmp !== "all" && a.empresa_id !== fEmp) return false;
      if (s && !a.codigo_nome.toLowerCase().includes(s)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "preco":
          return (a.preco ?? 0) - (b.preco ?? 0);
        case "preco_desc":
          return (b.preco ?? 0) - (a.preco ?? 0);
        case "recente":
          return b.created_at.localeCompare(a.created_at);
        default:
          return a.codigo_nome.localeCompare(b.codigo_nome);
      }
    });
    return list;
  }, [aviamentos, fCat, fSub, fMat, fLarg, fVaz, fEmp, sort, search]);

  const deleteMut = useMutation({
    mutationFn: async (a: Aviamento) => {
      const { error } = await supabase.from("aviamentos").delete().eq("id", a.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Aviamento excluído.");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["aviamentos"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir."),
  });


  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Package className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Aviamentos</h1>
            <p className="text-sm text-muted-foreground">
              Galeria de aviamentos cadastrados.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SearchToggle value={search} onChange={setSearch} placeholder="Buscar por código/nome…" />
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-8 w-40 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FilterButton
            filters={[
              { label: "Categoria", value: fCat, onChange: (v) => { setFCat(v); setFSub("all"); }, options: [{ id: "all", nome: "Todas" }, ...categorias] },
              { label: "Subcategoria", value: fSub, onChange: setFSub, options: [{ id: "all", nome: "Todas" }, ...subcategorias.filter((s) => fCat === "all" || s.categoria_aviamento_id === fCat)] },
              { label: "Material", value: fMat, onChange: setFMat, options: [{ id: "all", nome: "Todos" }, ...materiais] },
              { label: "Intervalo Largura", value: fLarg, onChange: setFLarg, options: [{ id: "all", nome: "Todos" }, ...intervalos] },
              { label: "Intervalo Vazado", value: fVaz, onChange: setFVaz, options: [{ id: "all", nome: "Todos" }, ...intervalos] },
              { label: "Fornecedor", value: fEmp, onChange: setFEmp, options: [{ id: "all", nome: "Todos" }, ...empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }))] },
            ]}
          />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Novo Aviamento
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <LayoutGrid className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Colunas:</span>
        {COLUMN_OPTIONS.map((n) => (
          <Button
            key={n}
            size="sm"
            variant={cols === n ? "default" : "outline"}
            onClick={() => setCols(n)}
            className="h-7 w-9 px-0"
          >
            {n}
          </Button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          <Badge variant="secondary">{filtered.length}</Badge> aviamento(s)
        </span>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
          Carregando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          Nenhum aviamento cadastrado.
        </div>
      ) : (
        <div className={GRID_COLS_CLASS[cols]}>
          {filtered.map((a) => (
            <AviamentoCard
              key={a.id}
              aviamento={a}
              categoria={a.categoria_aviamento_id ? catMap.get(a.categoria_aviamento_id) ?? null : null}
              fornecedor={a.empresa_id ? empresasMap.get(a.empresa_id) ?? null : null}
              onEdit={() => setEditing(a)}
              onDelete={() => setDeleting(a)}
            />
          ))}
        </div>
      )}

      {(createOpen || editing) && (
        <AviamentoModal
          open={createOpen || !!editing}
          onOpenChange={(o) => {
            if (!o) {
              setCreateOpen(false);
              setEditing(null);
            }
          }}
          initial={editing}
          empresas={empresas}
          categorias={categorias}
          subcategorias={subcategorias}
          materiais={materiais}
          intervalos={intervalos}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["aviamentos"] });
            setCreateOpen(false);
            setEditing(null);
          }}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir aviamento?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O aviamento "{deleting?.codigo_nome}" será removido.
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


function AviamentoCard({
  aviamento,
  categoria,
  fornecedor,
  onEdit,
  onDelete,
}: {
  aviamento: Aviamento;
  categoria: string | null;
  fornecedor: string | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const url = useSignedUrl(aviamento.foto_url, "aviamentos");
  return (
    <Card className="overflow-hidden h-full group">
      <div className="aspect-square bg-muted relative">
        {url ? (
          <>
            <img src={url} alt={aviamento.codigo_nome} className="w-full h-full object-cover" loading="lazy" />
            <ImagePreview src={url} alt={aviamento.codigo_nome}>
              <div className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/20 transition-colors">
                <ZoomIn className="h-8 w-8 text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow-md" />
              </div>
            </ImagePreview>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <ImageOff className="h-10 w-10" />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 p-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/60 to-transparent">
          <Button size="sm" variant="secondary" className="h-7 flex-1" onClick={onEdit}>
            <Pencil className="h-3 w-3 mr-1" /> Editar
          </Button>
          <Button size="sm" variant="destructive" className="h-7 w-7 p-0" onClick={onDelete}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div className="p-3 space-y-1">
        <h3 className="font-medium leading-tight line-clamp-1">{aviamento.codigo_nome}</h3>
        {(!categoria || !fornecedor) && (
          <div className="flex items-center gap-1 rounded bg-destructive px-2 py-1 text-[10px] font-medium text-destructive-foreground">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="line-clamp-1">
              {!categoria && !fornecedor
                ? "Sem categoria e sem fornecedor"
                : !categoria
                  ? "Sem categoria"
                  : "Sem fornecedor"}
            </span>
          </div>
        )}
        <p className="text-xs text-muted-foreground line-clamp-1">{categoria ?? "—"}</p>
        <p className="text-xs text-muted-foreground line-clamp-1">{fornecedor ?? "—"}</p>
        <p className="text-sm font-semibold text-primary">{fmtBRL(aviamento.preco)}</p>
      </div>
    </Card>
  );
}

type FormState = {
  codigo_nome: string;
  empresa_id: string;
  categoria_aviamento_id: string;
  subcategoria_aviamento_id: string;
  material_aviamento_id: string;
  composicao: string;
  preco: string;
  intervalo_largura_id: string;
  largura_exata: string;
  intervalo_vazado_id: string;
  largura_exata_vazado: string;
  observacoes: string;
  foto_url: string | null;
};

const emptyForm: FormState = {
  codigo_nome: "",
  empresa_id: "",
  categoria_aviamento_id: "",
  subcategoria_aviamento_id: "",
  material_aviamento_id: "",
  composicao: "",
  preco: "",
  intervalo_largura_id: "",
  largura_exata: "",
  intervalo_vazado_id: "",
  largura_exata_vazado: "",
  observacoes: "",
  foto_url: null,
};

function AviamentoModal({
  open,
  onOpenChange,
  initial,
  empresas,
  categorias,
  subcategorias,
  materiais,
  intervalos,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial: Aviamento | null;
  empresas: Empresa[];
  categorias: Option[];
  subcategorias: Subcategoria[];
  materiais: Option[];
  intervalos: Option[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Fotos enviadas nesta sessão e ainda não persistidas; removidas se o
  // usuário trocar a foto ou fechar o diálogo sem salvar (evita órfãos).
  const sessionUploads = useRef<string[]>([]);
  const savedRef = useRef(false);
  const signedUrl = useSignedUrl(form.foto_url, "aviamentos");
  const fotoUrl = localPreview ?? signedUrl;

  useEffect(() => {
    return () => {
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  useEffect(() => {
    sessionUploads.current = [];
    savedRef.current = false;
    if (initial) {
      setForm({
        codigo_nome: initial.codigo_nome ?? "",
        empresa_id: initial.empresa_id ?? "",
        categoria_aviamento_id: initial.categoria_aviamento_id ?? "",
        subcategoria_aviamento_id: initial.subcategoria_aviamento_id ?? "",
        material_aviamento_id: initial.material_aviamento_id ?? "",
        composicao: initial.composicao ?? "",
        preco: initial.preco != null ? String(initial.preco) : "",
        intervalo_largura_id: initial.intervalo_largura_id ?? "",
        largura_exata: initial.largura_exata != null ? String(initial.largura_exata) : "",
        intervalo_vazado_id: initial.intervalo_vazado_id ?? "",
        largura_exata_vazado:
          initial.largura_exata_vazado != null ? String(initial.largura_exata_vazado) : "",
        observacoes: initial.observacoes ?? "",
        foto_url: initial.foto_url,
      });
    } else {
      setForm(emptyForm);
    }
    setLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [initial, open]);

  const filteredSub = subcategorias.filter(
    (s) => !form.categoria_aviamento_id || s.categoria_aviamento_id === form.categoria_aviamento_id,
  );

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleUpload = async (file: File) => {
    setUploading(true);
    const preview = URL.createObjectURL(file);
    setLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return preview;
    });
    try {
      const { tenantPrefix } = await import("@/lib/storage-tenant");
      const tenant = await tenantPrefix();
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${tenant}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("aviamentos").upload(path, file, {
        cacheControl: "3600",
        upsert: false,
      });
      if (error) throw error;
      // Trocou a foto antes de salvar: remove o upload anterior desta sessão.
      const prev = form.foto_url;
      if (prev && sessionUploads.current.includes(prev)) {
        await supabase.storage.from("aviamentos").remove([prev]);
        sessionUploads.current = sessionUploads.current.filter((p) => p !== prev);
      }
      sessionUploads.current.push(path);
      set("foto_url", path);
      toast.success("Foto enviada.");
    } catch (e: any) {
      toast.error(e.message ?? "Falha no upload.");
    } finally {
      setUploading(false);
    }
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const nome = form.codigo_nome.trim();
      if (!nome) throw new Error("Informe o código/nome.");
      const payload = {
        codigo_nome: nome,
        empresa_id: form.empresa_id || null,
        categoria_aviamento_id: form.categoria_aviamento_id || null,
        subcategoria_aviamento_id: form.subcategoria_aviamento_id || null,
        material_aviamento_id: form.material_aviamento_id || null,
        composicao: form.composicao.trim() || null,
        preco: form.preco ? Number(form.preco) : null,
        intervalo_largura_id: form.intervalo_largura_id || null,
        largura_exata: form.largura_exata ? Number(form.largura_exata) : null,
        intervalo_vazado_id: form.intervalo_vazado_id || null,
        largura_exata_vazado: form.largura_exata_vazado ? Number(form.largura_exata_vazado) : null,
        observacoes: form.observacoes.trim() || null,
        foto_url: form.foto_url,
      };
      if (initial) {
        const { error } = await supabase.from("aviamentos").update(payload).eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("aviamentos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      // Uploads desta sessão agora estão persistidos: não devem ser removidos.
      savedRef.current = true;
      sessionUploads.current = [];
      toast.success(initial ? "Aviamento atualizado." : "Aviamento criado.");
      onSaved();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar."),
  });

  const handleOpenChange = (o: boolean) => {
    // Fechou sem salvar: remove fotos enviadas nesta sessão (órfãs).
    if (!o && !savedRef.current && sessionUploads.current.length > 0) {
      const orphans = sessionUploads.current;
      sessionUploads.current = [];
      void supabase.storage.from("aviamentos").remove(orphans);
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? "Editar Aviamento" : "Novo Aviamento"}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-3 py-2">
          <div className="md:col-span-1 space-y-2">
            <Label>Foto</Label>
            <div className="aspect-square bg-muted rounded-md overflow-hidden relative">
              {fotoUrl ? (
                <img src={fotoUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <ImageOff className="h-10 w-10" />
                </div>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Upload className="h-4 w-4 mr-1" />
              )}
              {form.foto_url ? "Trocar foto" : "Enviar foto"}
            </Button>
          </div>

          <div className="md:col-span-2 grid gap-3 md:grid-cols-2">
            <Field className="md:col-span-2" label="Código / Nome *">
              <Input
                value={form.codigo_nome}
                onChange={(e) => set("codigo_nome", e.target.value)}
                placeholder="Ex: BT-001 Botão metal 12mm"
              />
            </Field>

            <Field label="Fornecedor">
              <SelectField
                value={form.empresa_id}
                onChange={(v) => set("empresa_id", v)}
                options={empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }))}
                placeholder="Selecione"
              />
            </Field>
            <Field label="Preço (R$)">
              <NumberInput
                type="number"
                step="0.01"
                value={form.preco}
                onChange={(e) => set("preco", e.target.value)}
              />
            </Field>

            <Field label="Categoria">
              <SelectField
                value={form.categoria_aviamento_id}
                onChange={(v) => {
                  set("categoria_aviamento_id", v);
                  set("subcategoria_aviamento_id", "");
                }}
                options={categorias}
                placeholder="Selecione"
              />
            </Field>
            <Field label="Subcategoria">
              <SelectField
                value={form.subcategoria_aviamento_id}
                onChange={(v) => set("subcategoria_aviamento_id", v)}
                options={filteredSub}
                placeholder={form.categoria_aviamento_id ? "Selecione" : "Selecione a categoria"}
                disabled={!form.categoria_aviamento_id}
              />
            </Field>

            <Field label="Material">
              <SelectField
                value={form.material_aviamento_id}
                onChange={(v) => set("material_aviamento_id", v)}
                options={materiais}
                placeholder="Selecione"
              />
            </Field>
            <Field label="Composição">
              <Input
                value={form.composicao}
                onChange={(e) => set("composicao", e.target.value)}
              />
            </Field>

            <Field label="Intervalo Largura">
              <SelectField
                value={form.intervalo_largura_id}
                onChange={(v) => set("intervalo_largura_id", v)}
                options={intervalos}
                placeholder="Selecione"
              />
            </Field>
            <Field label="Largura Exata">
              <NumberInput
                type="number"
                step="0.01"
                value={form.largura_exata}
                onChange={(e) => set("largura_exata", e.target.value)}
              />
            </Field>

            <Field label="Intervalo Vazado">
              <SelectField
                value={form.intervalo_vazado_id}
                onChange={(v) => set("intervalo_vazado_id", v)}
                options={intervalos}
                placeholder="Selecione"
              />
            </Field>
            <Field label="Largura Exata Vazado">
              <NumberInput
                type="number"
                step="0.01"
                value={form.largura_exata_vazado}
                onChange={(e) => set("largura_exata_vazado", e.target.value)}
              />
            </Field>

            <Field className="md:col-span-2" label="Observações">
              <Textarea
                rows={3}
                value={form.observacoes}
                onChange={(e) => set("observacoes", e.target.value)}
              />
            </Field>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            {saveMut.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  className,
  label,
  children,
}: {
  className?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function SelectField({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ id: string; nome: string }>;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.nome}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
