import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Layers,
  Plus,
  Search,
  LayoutGrid,
  ImageOff,
  Loader2,
  Trash2,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
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

import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ImagePreview } from "@/components/shared/ImagePreview";
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
import { FilterButton, SearchToggle } from "@/components/shared/filters";

export const Route = createFileRoute("/_authenticated/cadastro/tecidos/")({
  component: TecidosGallery,
});

type Artigo = {
  id: string;
  nome: string;
  empresa_id: string | null;
  categoria_tecido_id: string | null;
  preco: number | null;
  unidade_medida: string;
  created_at: string;
};

type Variante = { artigo_id: string; foto_url: string | null; created_at: string };
type Empresa = { id: string; nome_fantasia: string };
type Categoria = { id: string; nome: string };

const COLUMN_OPTIONS = [2, 3, 4, 5];
const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "nome", label: "Nome (A-Z)" },
  { value: "preco", label: "Preço (menor)" },
  { value: "preco_desc", label: "Preço (maior)" },
  { value: "recente", label: "Mais recentes" },
];

function TecidosGallery() {
  const qc = useQueryClient();
  const [cols, setCols] = useState<number>(4);
  const [search, setSearch] = useState("");
  const [empresaFilter, setEmpresaFilter] = useState<string>("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [sort, setSort] = useState<string>("nome");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: artigos = [], isLoading } = useQuery({
    queryKey: ["artigos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("id,nome,empresa_id,categoria_tecido_id,preco,unidade_medida,created_at");
      if (error) throw error;
      return (data ?? []) as Artigo[];
    },
  });

  const { data: variantes = [] } = useQuery({
    queryKey: ["variantes-thumb"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("variantes_tecido")
        .select("artigo_id,foto_url,created_at")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as Variante[];
    },
  });

  const { data: artigoCatLinks = [] } = useQuery({
    queryKey: ["artigo-cats-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigo_categorias_tecido")
        .select("artigo_id, categoria_tecido_id");
      if (error) throw error;
      return (data ?? []) as { artigo_id: string; categoria_tecido_id: string }[];
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id,nome_fantasia")
        .order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as Empresa[];
    },
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ["cat-tecido-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_tecido")
        .select("id,nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Categoria[];
    },
  });

  const firstVarMap = useMemo(() => {
    const m = new Map<string, string | null>();
    variantes.forEach((v) => {
      if (!m.has(v.artigo_id)) m.set(v.artigo_id, v.foto_url);
    });
    return m;
  }, [variantes]);

  const empresasMap = useMemo(
    () => new Map(empresas.map((e) => [e.id, e.nome_fantasia])),
    [empresas],
  );

  const catsByArtigo = useMemo(() => {
    const m = new Map<string, Set<string>>();
    artigoCatLinks.forEach((l) => {
      const s = m.get(l.artigo_id) ?? new Set<string>();
      s.add(l.categoria_tecido_id);
      m.set(l.artigo_id, s);
    });
    return m;
  }, [artigoCatLinks]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    let list = artigos.filter((a) => {
      if (empresaFilter !== "all" && a.empresa_id !== empresaFilter) return false;
      if (catFilter !== "all") {
        const cs = catsByArtigo.get(a.id);
        const matches = (cs && cs.has(catFilter)) || a.categoria_tecido_id === catFilter;
        if (!matches) return false;
      }
      if (s && !a.nome.toLowerCase().includes(s)) return false;
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
          return a.nome.localeCompare(b.nome);
      }
    });
    return list;
  }, [artigos, empresaFilter, catFilter, sort, search, catsByArtigo]);

  const createMut = useMutation({
    mutationFn: async (form: { nome: string; unidade_medida: string }) => {
      const nome = form.nome.trim();
      if (!nome) throw new Error("Informe o nome.");
      const { data, error } = await supabase
        .from("artigos")
        .insert({ nome, unidade_medida: form.unidade_medida })
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      toast.success("Tecido criado.");
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ["artigos"] });
      // Redirect to detail
      window.location.href = `/cadastro/tecidos/${id}`;
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao criar."),
  });

  const [deleteRow, setDeleteRow] = useState<Artigo | null>(null);
  const [deleteUsage, setDeleteUsage] = useState<number | null>(null);

  const startDelete = async (a: Artigo) => {
    setDeleteRow(a);
    setDeleteUsage(null);
    let total = 0;
    const refs: { table: string; column: string }[] = [
      { table: "ocs_tecido_itens", column: "artigo_id" },
      { table: "modelo_tecidos", column: "artigo_id" },
      { table: "cad_tecidos", column: "artigo_id" },
    ];
    for (const r of refs) {
      const { count } = await supabase
        .from(r.table as any)
        .select("*", { count: "exact", head: true })
        .eq(r.column, a.id);
      total += count ?? 0;
    }
    setDeleteUsage(total);
  };

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      // Apaga variantes (FK sem cascade pode existir)
      await supabase.from("variantes_tecido").delete().eq("artigo_id", id);
      const { error } = await supabase.from("artigos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Tecido excluído.");
      setDeleteRow(null);
      setDeleteUsage(null);
      qc.invalidateQueries({ queryKey: ["artigos"] });
      qc.invalidateQueries({ queryKey: ["variantes-thumb"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir."),
  });

  const gridClass: Record<number, string> = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-2 md:grid-cols-3",
    4: "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
    5: "grid-cols-2 md:grid-cols-3 lg:grid-cols-5",
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Layers className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Tecidos</h1>
            <p className="text-sm text-muted-foreground">
              Galeria de artigos cadastrados.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <SearchToggle value={search} onChange={setSearch} placeholder="Buscar por nome…" />
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
              { label: "Fornecedor", value: empresaFilter, onChange: setEmpresaFilter, options: [{ id: "all", nome: "Todos" }, ...empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }))] },
              { label: "Categoria", value: catFilter, onChange: setCatFilter, options: [{ id: "all", nome: "Todas" }, ...categorias] },
            ]}
          />
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> Novo Tecido
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
          <Badge variant="secondary">{filtered.length}</Badge> tecido(s)
        </span>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
          Carregando…
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground">
          Nenhum tecido cadastrado ainda.
        </div>
      ) : (
        <div className={`grid gap-4 ${gridClass[cols]}`}>
          {filtered.map((a) => (
            <TecidoCard
              key={a.id}
              artigo={a}
              fornecedor={a.empresa_id ? empresasMap.get(a.empresa_id) ?? null : null}
              fotoPath={firstVarMap.get(a.id) ?? null}
              onDelete={() => startDelete(a)}
            />
          ))}
        </div>
      )}

      <CreateTecidoModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(f) => createMut.mutate(f)}
        loading={createMut.isPending}
      />

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
            <AlertDialogTitle>Excluir tecido?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUsage === null ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verificando uso…
                </span>
              ) : deleteUsage > 0 ? (
                <>
                  Este tecido está em uso em <strong>{deleteUsage}</strong> registro(s)
                  (OCs, modelos ou CADs). A exclusão pode falhar se houver vínculos
                  protegidos.
                </>
              ) : (
                <>
                  Tem certeza que deseja excluir <strong>{deleteRow?.nome}</strong>?
                  Todas as variantes serão removidas.
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

function TecidoCard({
  artigo,
  fornecedor,
  fotoPath,
  onDelete,
}: {
  artigo: Artigo;
  fornecedor: string | null;
  fotoPath: string | null;
  onDelete: () => void;
}) {
  const url = useSignedUrl(fotoPath);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete();
        }}
        className="absolute top-2 right-2 z-10 h-8 w-8 rounded-md bg-background/80 backdrop-blur-sm border flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive hover:text-destructive-foreground"
        aria-label="Excluir tecido"
        title="Excluir tecido"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      <Link
        to="/cadastro/tecidos/$artigoId"
        params={{ artigoId: artigo.id }}
        className="block"
      >
        <Card className="overflow-hidden h-full transition-shadow group-hover:shadow-md">
          <div className="aspect-square bg-muted relative">
            {url ? (
              <>
                <img
                  src={url}
                  alt={artigo.nome}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <ImagePreview src={url} alt={artigo.nome}>
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
          </div>
          <div className="p-3 space-y-1">
            <h3 className="font-medium leading-tight line-clamp-1">{artigo.nome}</h3>
            <p className="text-xs text-muted-foreground line-clamp-1">{fornecedor ?? "—"}</p>
            <p className="text-sm font-semibold text-primary">
              {artigo.preco != null
                ? new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  }).format(Number(artigo.preco))
                : "—"}
              <span className="text-xs text-muted-foreground font-normal">
                {" "}
                / {artigo.unidade_medida}
              </span>
            </p>
          </div>
        </Card>
      </Link>
    </div>
  );
}

function CreateTecidoModal({
  open,
  onOpenChange,
  onSubmit,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (f: { nome: string; unidade_medida: string }) => void;
  loading: boolean;
}) {
  const [nome, setNome] = useState("");
  const [unidade, setUnidade] = useState("metro");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setNome("");
          setUnidade("metro");
        }
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo Tecido</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Nome do artigo</Label>
            <Input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: Linho 100% premium"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Unidade de medida</Label>
            <Select value={unidade} onValueChange={setUnidade}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="metro">Metro</SelectItem>
                <SelectItem value="kg">Kg</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-xs text-muted-foreground">
            Demais campos (fornecedor, preço, variantes…) podem ser preenchidos na próxima tela.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => onSubmit({ nome, unidade_medida: unidade })} disabled={loading}>
            {loading ? "Criando…" : "Criar e abrir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
