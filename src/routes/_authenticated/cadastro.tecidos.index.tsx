import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Layers,
  Plus,
  Search,
  LayoutGrid,
  ImageOff,
  Loader2,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { brl } from "@/lib/format";

import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { useGridCols, GRID_COLS_OPTIONS, GRID_COLS_CLASS, useCompactCards } from "@/hooks/useGridCols";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { useReadOnly } from "@/components/RequirePermission";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
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
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { FilterButton, SearchToggle, AgrupamentoButton } from "@/components/shared/filters";
import { TecidoDetail } from "./cadastro.tecidos.$artigoId";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { EmptyState } from "@/components/shared/EmptyState";

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
  largura_estimada: number | null;
  created_at: string;
};

type Variante = { artigo_id: string; foto_url: string | null; created_at: string };
type Empresa = { id: string; nome_fantasia: string };
type Categoria = { id: string; nome: string };

// "a" · "a e b" · "a, b e c" (junção natural PT-BR p/ o aviso de campos faltando)
function listaPt(itens: string[]): string {
  if (itens.length <= 1) return itens.join("");
  return itens.slice(0, -1).join(", ") + " e " + itens[itens.length - 1];
}

const COLUMN_OPTIONS = GRID_COLS_OPTIONS;
const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "nome", label: "Nome (A-Z)" },
  { value: "preco", label: "Preço (menor)" },
  { value: "preco_desc", label: "Preço (maior)" },
  { value: "recente", label: "Mais recentes" },
];

function TecidosGallery() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const [cols, setCols] = useGridCols("tecidos");
  const gridRef = useRef<HTMLDivElement>(null);
  // No mobile, sempre mostra as informações do card (não compacta).
  const isMobile = useIsMobile();
  const compact = useCompactCards(gridRef, cols) && !isMobile;
  const [search, setSearch] = useState("");
  const [empresaFilter, setEmpresaFilter] = useState<string>("all");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [sort, setSort] = useState<string>("nome");
  const [groupByCat, setGroupByCat] = useState(false);
  const [groupByForn, setGroupByForn] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (path: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path); else n.add(path);
      return n;
    });
  const [createOpen, setCreateOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: artigos = [], isLoading } = useQuery({
    queryKey: ["artigos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("artigos")
        .select("id,nome,empresa_id,categoria_tecido_id,preco,unidade_medida,largura_estimada,created_at");
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
    // chave própria "material" (não colide com o select de empresa do Representante) + só material.
    queryKey: ["empresas-options", "material"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id,nome_fantasia")
        .eq("tipo", "material")
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

  const categoriasMap = useMemo(
    () => new Map(categorias.map((c) => [c.id, c.nome])),
    [categorias],
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

  const categoriaNomesByArtigo = useMemo(() => {
    const m = new Map<string, string[]>();
    artigos.forEach((a) => {
      const ids = new Set<string>(catsByArtigo.get(a.id) ?? []);
      if (a.categoria_tecido_id) ids.add(a.categoria_tecido_id);
      const nomes = Array.from(ids)
        .map((id) => categoriasMap.get(id))
        .filter((n): n is string => !!n);
      m.set(a.id, nomes);
    });
    return m;
  }, [artigos, catsByArtigo, categoriasMap]);

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
    mutationFn: async (form: { nome: string; unidade_medida: string; ncm?: string }) => {
      const nome = form.nome.trim();
      if (!nome) throw new Error("Informe o nome.");
      // ncm ainda não está no types.ts gerado (backlog) → cast (mesmo padrão do aviamento).
      const { data, error } = await supabase
        .from("artigos")
        .insert({ nome, unidade_medida: form.unidade_medida, ncm: form.ncm?.trim() || null } as never)
        .select("id")
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      toast.success("Tecido criado.");
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ["artigos"] });
      setOpenId(id); // abre o detalhe no modal
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao criar.")),
  });

  // (A exclusão de tecido vive na tela de detalhe — cadastro.tecidos.$artigoId.)

  // Card (reusado no grid liso e nos grupos).
  const renderCard = (a: Artigo) => (
    <TecidoCard
      key={a.id}
      artigo={a}
      categorias={categoriaNomesByArtigo.get(a.id) ?? []}
      fornecedor={a.empresa_id ? empresasMap.get(a.empresa_id) ?? null : null}
      fotoPath={firstVarMap.get(a.id) ?? null}
      compact={compact}
      readOnly={readOnly}
      onOpen={() => setOpenId(a.id)}
    />
  );

  // Agrupamento. Categoria = MULTI-pertencimento (um tecido com várias categorias
  // aparece em cada grupo); Fornecedor = simples. Aninha Categoria › Fornecedor.
  type Split = { key: string; nome: string; items: Artigo[] };
  const sortSplits = (arr: Split[]) =>
    arr.sort((x, y) => (x.key === "__none__" ? 1 : y.key === "__none__" ? -1 : x.nome.localeCompare(y.nome, "pt-BR")));
  const byCategoria = (items: Artigo[]): Split[] => {
    const map = new Map<string, Artigo[]>();
    items.forEach((a) => {
      const ids = new Set<string>(catsByArtigo.get(a.id) ?? []);
      if (a.categoria_tecido_id) ids.add(a.categoria_tecido_id);
      const keys = ids.size ? Array.from(ids) : ["__none__"];
      keys.forEach((k) => { (map.get(k) ?? map.set(k, []).get(k))!.push(a); });
    });
    return sortSplits(Array.from(map.entries()).map(([k, its]) => ({
      key: k, nome: k === "__none__" ? "Sem categoria" : categoriasMap.get(k) ?? "Sem categoria", items: its,
    })));
  };
  const byFornecedor = (items: Artigo[]): Split[] => {
    const map = new Map<string, Artigo[]>();
    items.forEach((a) => { const k = a.empresa_id ?? "__none__"; (map.get(k) ?? map.set(k, []).get(k))!.push(a); });
    return sortSplits(Array.from(map.entries()).map(([k, its]) => ({
      key: k, nome: k === "__none__" ? "Sem fornecedor" : empresasMap.get(k) ?? "Sem fornecedor", items: its,
    })));
  };
  const splitters = [groupByCat ? byCategoria : null, groupByForn ? byFornecedor : null].filter(Boolean) as ((i: Artigo[]) => Split[])[];
  type Grupo = { key: string; nome: string; count: number; items?: Artigo[]; subgroups?: Grupo[] };
  const buildGroups = (items: Artigo[], depth: number): Grupo[] =>
    splitters[depth](items).map((g) => {
      const node: Grupo = { key: g.key, nome: g.nome, count: g.items.length };
      if (depth + 1 < splitters.length) node.subgroups = buildGroups(g.items, depth + 1);
      else node.items = g.items;
      return node;
    });
  const groups: Grupo[] | null = splitters.length ? buildGroups(filtered, 0) : null;

  const HEADER_CLS = ["text-lg font-semibold", "text-base font-semibold text-muted-foreground"];
  const renderGroup = (g: Grupo, depth: number, path: string) => {
    const isCollapsed = collapsed.has(path);
    return (
      <section key={g.key} className="space-y-3">
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleCollapse(path)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleCollapse(path); } }}
          className="flex cursor-pointer select-none items-center gap-2"
          aria-expanded={!isCollapsed}
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <h2 className={HEADER_CLS[Math.min(depth, HEADER_CLS.length - 1)]}>{g.nome}</h2>
          <span className="text-xs text-muted-foreground">({g.count})</span>
        </div>
        {!isCollapsed && (g.subgroups ? (
          <div className="space-y-4 border-l pl-3">{g.subgroups.map((sg) => renderGroup(sg, depth + 1, `${path}/${sg.key}`))}</div>
        ) : (
          <div className={GRID_COLS_CLASS[cols]}>{g.items!.map(renderCard)}</div>
        ))}
      </section>
    );
  };

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Layers className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">Tecidos</h1>
            <p className="text-sm text-muted-foreground">
              Galeria de artigos cadastrados.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">

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
          <AgrupamentoButton
            groups={[
              { label: "Categoria", active: groupByCat, onToggle: () => setGroupByCat((v) => !v) },
              { label: "Fornecedor", active: groupByForn, onToggle: () => setGroupByForn((v) => !v) },
            ]}
          />
          <FilterButton
            filters={[
              { label: "Fornecedor", value: empresaFilter, onChange: setEmpresaFilter, options: [{ id: "all", nome: "Todos" }, ...empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia }))] },
              { label: "Categoria", value: catFilter, onChange: setCatFilter, options: [{ id: "all", nome: "Todas" }, ...categorias] },
            ]}
          />
          <Button onClick={() => setCreateOpen(true)} disabled={readOnly} className="max-sm:hidden">
            <Plus className="h-4 w-4 mr-1" /> Novo
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          <Badge variant="secondary">{filtered.length}</Badge> {filtered.length === 1 ? "tecido" : "tecidos"}
        </span>
        <div className="hidden lg:flex items-center gap-1.5 ml-auto">
          <LayoutGrid className="h-4 w-4 text-muted-foreground" />
          <Label className="text-xs text-muted-foreground">Colunas</Label>
          <Select value={String(cols)} onValueChange={(v) => setCols(Number(v))}>
            <SelectTrigger className="h-8 w-16"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COLUMN_OPTIONS.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
          Carregando…
        </div>
      ) : filtered.length === 0 ? (
        artigos.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="Nenhum tecido cadastrado ainda"
            description="Cadastre o primeiro tecido para começar a montar sua galeria."
            action={readOnly ? undefined : { label: "Novo tecido", onClick: () => setCreateOpen(true) }}
          />
        ) : (
          <EmptyState
            icon={Search}
            title="Nenhum tecido encontrado"
            description="Nenhum tecido corresponde aos filtros aplicados."
            action={{
              label: "Limpar filtros",
              onClick: () => { setSearch(""); setEmpresaFilter("all"); setCatFilter("all"); setSort("nome"); },
            }}
          />
        )
      ) : groups ? (
        <div ref={gridRef} className="space-y-6">
          {groups.map((g) => renderGroup(g, 0, g.key))}
        </div>
      ) : (
        <div ref={gridRef} className={GRID_COLS_CLASS[cols]}>
          {filtered.map(renderCard)}
        </div>
      )}

      <CreateTecidoModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={(f) => createMut.mutate(f)}
        loading={createMut.isPending}
      />

      {/* Detalhe do tecido em SHEET lateral (igual Planejamento). Abrir card = ver/editar. */}
      <Sheet open={!!openId} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <SheetContent side="right" size="editor" className="p-0 [&>button]:hidden">
          <SheetTitle className="sr-only">Detalhes do tecido</SheetTitle>
          {openId && <TecidoDetail artigoId={openId} onClose={() => setOpenId(null)} embedded />}
        </SheetContent>
      </Sheet>

      <MobileActionBar>
        <Button onClick={() => setCreateOpen(true)} disabled={readOnly} className="ml-auto">
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </MobileActionBar>
    </div>
  );
}

function TecidoCard({
  artigo,
  categorias,
  fornecedor,
  fotoPath,
  compact,
  readOnly,
  onOpen,
}: {
  artigo: Artigo;
  categorias: string[];
  fornecedor: string | null;
  fotoPath: string | null;
  compact?: boolean;
  readOnly?: boolean;
  onOpen: () => void;
}) {
  const url = useSignedUrl(fotoPath);
  const semCategoria = categorias.length === 0;
  const semFornecedor = !fornecedor;
  const semLargura = artigo.largura_estimada == null;
  const faltando = [
    semCategoria && "categoria",
    semFornecedor && "fornecedor",
    semLargura && "largura",
  ].filter(Boolean) as string[];
  return (
    <div className="group relative">
      <button type="button" onClick={onOpen} className="block w-full text-left">
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
          {!compact && (
          // Altura FIXA (204px) + flex-col + preço com mt-auto: TODOS os cards com a mesma
          // altura e preço no rodapé; 204px comporta título de até 3 linhas (line-clamp-3, sem cortar).
          <div className="p-3 flex h-[204px] flex-col gap-1 overflow-hidden">
            <h3 className="font-medium leading-tight line-clamp-3">{artigo.nome}</h3>
            {faltando.length > 0 && (
              <StatusBadge tone="warning" className="w-full justify-start gap-1 normal-case tracking-normal">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="line-clamp-1">Sem {listaPt(faltando)}</span>
              </StatusBadge>
            )}
            {categorias.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {categorias.map((c) => (
                  <Badge key={c} variant="secondary" className="text-[10px]">
                    {c}
                  </Badge>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground line-clamp-1">{fornecedor ?? "—"}</p>
            <p className="mt-auto text-sm font-semibold text-primary">
              {artigo.preco != null ? brl(Number(artigo.preco)) : "—"}
              <span className="text-xs text-muted-foreground font-normal">
                {" "}
                / {artigo.unidade_medida}
              </span>
            </p>
          </div>
          )}
        </Card>
      </button>
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
  onSubmit: (f: { nome: string; unidade_medida: string; ncm?: string }) => void;
  loading: boolean;
}) {
  const [nome, setNome] = useState("");
  const [unidade, setUnidade] = useState("metro");
  const [ncm, setNcm] = useState("");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setNome("");
          setUnidade("metro");
          setNcm("");
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
            <Label>Nome do tecido</Label>
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
          <div className="space-y-1.5">
            <Label>NCM</Label>
            <Input
              value={ncm}
              onChange={(e) => setNcm(e.target.value)}
              placeholder="Ex: 5208.11.00"
              inputMode="numeric"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Demais campos (fornecedor, preço, variantes…) podem ser preenchidos na próxima tela.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <ArrowLeft className="h-4 w-4 mr-1" />Voltar
          </Button>
          <Button onClick={() => onSubmit({ nome, unidade_medida: unidade, ncm })} disabled={loading}>
            {loading ? "Criando…" : "Criar e abrir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
