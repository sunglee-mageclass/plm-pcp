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

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    let list = artigos.filter((a) => {
      if (empresaFilter !== "all" && a.empresa_id !== empresaFilter) return false;
      if (catFilter !== "all" && a.categoria_tecido_id !== catFilter) return false;
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
  }, [artigos, empresaFilter, catFilter, sort, search]);

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
    </div>
  );
}

function TecidoCard({
  artigo,
  fornecedor,
  fotoPath,
}: {
  artigo: Artigo;
  fornecedor: string | null;
  fotoPath: string | null;
}) {
  const url = useSignedUrl(fotoPath);
  return (
    <Link
      to="/cadastro/tecidos/$artigoId"
      params={{ artigoId: artigo.id }}
      className="group"
    >
      <Card className="overflow-hidden h-full transition-shadow group-hover:shadow-md">
        <div className="aspect-square bg-muted relative">
          {url ? (
            <img
              src={url}
              alt={artigo.nome}
              className="w-full h-full object-cover"
              loading="lazy"
            />
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
