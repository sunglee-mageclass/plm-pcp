import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
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
  Trash2,
  ChevronDown,
  ChevronRight,
  Save,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { corApelidoLabel } from "@/lib/variante";
import { brl } from "@/lib/format";
import { useFilterState } from "@/hooks/useFilterState";
import { empresaTemCategoria, AVIAMENTO_TOKENS } from "@/lib/fornecedor-categoria";
import { FornecedorSelect } from "@/components/shared/FornecedorSelect";

import { supabase } from "@/integrations/supabase/client";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { useGridCols, GRID_COLS_OPTIONS, GRID_COLS_CLASS, useCompactCards } from "@/hooks/useGridCols";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { useReadOnly } from "@/components/RequirePermission";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/StatusBadge";
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
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
import { FilterButton, SearchToggle, AgrupamentoButton } from "@/components/shared/filters";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { EmptyState } from "@/components/shared/EmptyState";
import { useUnsavedGuard, UnsavedChangesGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";

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
  codigo: string | null;
  codigo_nome: string;
  empresa_id: string | null;
  representante_id: string | null;
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
  ncm: string | null;
  cor_id: string | null;
  cor_apelido_id: string | null;
  cor: { nome: string } | null;
  cor_apelido: { nome: string } | null;
};

type Option = { id: string; nome: string };
type CorApelido = { id: string; nome: string; cor_base_id: string | null };
type VarianteCorRow = {
  aviamento_id: string;
  cor_id: string | null;
  cor_apelido_id: string | null;
  cor: { nome: string } | null;
  cor_apelido: { nome: string } | null;
  created_at: string;
};
type Empresa = { id: string; nome_fantasia: string; representantes?: { id: string; nome: string | null }[] | null };
type Subcategoria = { id: string; nome: string; categoria_aviamento_id: string };
// Variante montada no "+ Novo" antes de existir aviamento_id (staging).
type VarDraft = { cor_id: string; cor_apelido_id: string | null };

const COLUMN_OPTIONS = GRID_COLS_OPTIONS;
const SORT_OPTIONS = [
  { value: "codigo", label: "Código (A-Z)" },
  { value: "nome", label: "Nome (A-Z)" },
  { value: "preco", label: "Preço (menor)" },
  { value: "preco_desc", label: "Preço (maior)" },
  { value: "recente", label: "Mais recentes" },
];

const fmtBRL = (n: number | null | undefined) => (n != null ? brl(Number(n)) : "—");

function AviamentosGallery() {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const [cols, setCols] = useGridCols("aviamentos");
  const gridRef = useRef<HTMLDivElement>(null);
  // No mobile, sempre mostra as informações do card (não compacta).
  const isMobile = useIsMobile();
  const compact = useCompactCards(gridRef, cols) && !isMobile;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("nome");
  const [groupByCat, setGroupByCat] = useState(false);
  const [groupBySub, setGroupBySub] = useState(false);
  const [groupByCorBase, setGroupByCorBase] = useState(false);
  const [groupByCorApelido, setGroupByCorApelido] = useState(false);
  const [groupByFornecedor, setGroupByFornecedor] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (path: string) =>
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(path)) n.delete(path); else n.add(path);
      return n;
    });
  const [fCat, setFCat] = useFilterState("cad-aviamentos", "Categoria", []);
  const [fSub, setFSub] = useFilterState("cad-aviamentos", "Subcategoria", []);
  const [fMat, setFMat] = useFilterState("cad-aviamentos", "Material", []);
  const [fLarg, setFLarg] = useFilterState("cad-aviamentos", "Intervalo Largura", []);
  const [fVaz, setFVaz] = useFilterState("cad-aviamentos", "Intervalo Vazado", []);
  const [fEmp, setFEmp] = useFilterState("cad-aviamentos", "Fornecedor", []);
  const [editing, setEditing] = useState<Aviamento | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleting, setDeleting] = useState<Aviamento | null>(null);

  const { data: aviamentos = [], isLoading } = useQuery({
    queryKey: ["aviamentos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aviamentos")
        .select(
          "id,codigo,codigo_nome,empresa_id,representante_id,categoria_aviamento_id,subcategoria_aviamento_id,material_aviamento_id,composicao,preco,intervalo_largura_id,largura_exata,intervalo_vazado_id,largura_exata_vazado,foto_url,observacoes,created_at,ncm,cor_id,cor_apelido_id,cor:cor_id(nome),cor_apelido:cor_apelido_id(nome)",
        );
      if (error) throw error;
      // `codigo` ainda não está no types.ts gerado (backlog de regenerar) → cast via unknown.
      return (data ?? []) as unknown as Aviamento[];
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options", "aviamento"],
    queryFn: async () => {
      // Fornecedores de material + representantes + categorias; casa por TOKEN flexível
      // no cliente (o nome da categoria varia por loja — ver @/lib/fornecedor-categoria).
      const { data, error } = await supabase
        .from("empresas")
        .select("id,nome_fantasia,representantes(id, nome),empresa_categorias_fornecedor(categorias_fornecedor(nome))")
        .eq("tipo", "material")
        .order("nome_fantasia");
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((e) => empresaTemCategoria(e, AVIAMENTO_TOKENS))
        .map((e) => ({ id: e.id as string, nome_fantasia: e.nome_fantasia as string, representantes: e.representantes ?? [] }));
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

  // Variantes de aviamento (cor base + apelido), fonte da cor exibida no card e no
  // agrupamento (o aviamento pode ter VÁRIAS cores — a single legada saiu do form).
  const { data: variantesRows = [] } = useQuery({
    queryKey: ["aviamentos-variantes"],
    queryFn: async () => {
      // variantes_aviamento ainda não está no types.ts gerado (backlog de regen) → cast.
      const { data, error } = await (supabase.from("variantes_aviamento" as any) as any)
        .select("aviamento_id,cor_id,cor_apelido_id,cor:cor_id(nome),cor_apelido:cor_apelido_id(nome),created_at")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as VarianteCorRow[];
    },
  });
  // aviamento_id -> lista de variantes (ordenada por created_at); a 1ª é a "representativa".
  const variantesPorAviamento = useMemo(() => {
    const m = new Map<string, VarianteCorRow[]>();
    for (const v of variantesRows) {
      const arr = m.get(v.aviamento_id) ?? [];
      arr.push(v);
      m.set(v.aviamento_id, arr);
    }
    return m;
  }, [variantesRows]);
  const primeiraVariante = (id: string) => variantesPorAviamento.get(id)?.[0] ?? null;

  const empresasMap = useMemo(
    () => new Map(empresas.map((e) => [e.id, e.nome_fantasia])),
    [empresas],
  );
  const catMap = useMemo(() => new Map(categorias.map((c) => [c.id, c.nome])), [categorias]);
  const subMap = useMemo(() => new Map(subcategorias.map((s) => [s.id, s.nome])), [subcategorias]);
  // Maps de cor derivados das VARIANTES (cada linha traz o nome embedado).
  const corBaseMap = useMemo(
    () => new Map(variantesRows.filter((v) => v.cor_id).map((v) => [v.cor_id!, v.cor?.nome ?? "—"])),
    [variantesRows],
  );
  const corApelidoMap = useMemo(
    () => new Map(variantesRows.filter((v) => v.cor_apelido_id).map((v) => [v.cor_apelido_id!, v.cor_apelido?.nome ?? "—"])),
    [variantesRows],
  );

  // Cascata Categoria→Subcategoria: opções de Subcategoria = união das subcategorias
  // das categorias marcadas (nenhuma marcada = todas).
  const subOptionsFiltro = useMemo(
    () => subcategorias.filter((s) => !fCat.length || fCat.includes(s.categoria_aviamento_id)),
    [subcategorias, fCat],
  );
  // Poda: ao mudar fCat, remove de fSub os ids que saíram da união (idempotente).
  useEffect(() => {
    const validos = new Set(subOptionsFiltro.map((o) => o.id));
    const podado = fSub.filter((id) => validos.has(id));
    if (podado.length !== fSub.length) setFSub(podado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fCat, subcategorias]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    let list = aviamentos.filter((a) => {
      if (fCat.length && !fCat.includes(a.categoria_aviamento_id ?? "")) return false;
      if (fSub.length && !fSub.includes(a.subcategoria_aviamento_id ?? "")) return false;
      if (fMat.length && !fMat.includes(a.material_aviamento_id ?? "")) return false;
      if (fLarg.length && !fLarg.includes(a.intervalo_largura_id ?? "")) return false;
      if (fVaz.length && !fVaz.includes(a.intervalo_vazado_id ?? "")) return false;
      if (fEmp.length && !fEmp.includes(a.empresa_id ?? "")) return false;
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
        case "codigo":
          return (a.codigo ?? "~").localeCompare(b.codigo ?? "~", "pt-BR", { numeric: true });
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
      // Best-effort: remove a foto do bucket p/ não deixar arquivo órfão por tenant.
      // (storage.remove não lança em erro de storage, então não bloqueia a exclusão.)
      if (a.foto_url) await supabase.storage.from("aviamentos").remove([a.foto_url]);
    },
    onSuccess: () => {
      toast.success("Aviamento excluído.");
      setDeleting(null);
      setEditing(null); // fecha o diálogo de edição (de onde a exclusão é disparada)
      qc.invalidateQueries({ queryKey: ["aviamentos"] });
      qc.invalidateQueries({ queryKey: ["aviamentos-variantes"] });
    },
    onError: (e: any) =>
      toast.error(e?.code === "23503" ? "Aviamento em uso (OC, modelo, CAD ou ordem de saída). Remova de lá antes." : mensagemErro(e, "Erro ao excluir.")),
  });


  // Card (reusado no grid liso e nos grupos).
  const renderCard = (a: Aviamento) => (
    <AviamentoCard
      key={a.id}
      aviamento={a}
      variantes={variantesPorAviamento.get(a.id) ?? []}
      categoria={a.categoria_aviamento_id ? catMap.get(a.categoria_aviamento_id) ?? null : null}
      fornecedor={a.empresa_id ? empresasMap.get(a.empresa_id) ?? null : null}
      onEdit={() => setEditing(a)}
      compact={compact}
      readOnly={readOnly}
    />
  );

  // Agrupamento (Categoria e/ou Subcategoria; aninha Categoria › Subcategoria).
  type Split = { key: string; nome: string; items: Aviamento[] };
  const splitBy = (items: Aviamento[], keyOf: (a: Aviamento) => string | null, nameOf: (k: string) => string): Split[] => {
    const map = new Map<string, Aviamento[]>();
    items.forEach((a) => { const k = keyOf(a) ?? "__none__"; (map.get(k) ?? map.set(k, []).get(k))!.push(a); });
    return Array.from(map.entries())
      .map(([k, its]) => ({ key: k, nome: nameOf(k), items: its }))
      .sort((x, y) => (x.key === "__none__" ? 1 : y.key === "__none__" ? -1 : x.nome.localeCompare(y.nome, "pt-BR")));
  };
  const byCat = (items: Aviamento[]) => splitBy(items, (a) => a.categoria_aviamento_id, (k) => (k === "__none__" ? "Sem categoria" : catMap.get(k) ?? "Sem categoria"));
  const bySub = (items: Aviamento[]) => splitBy(items, (a) => a.subcategoria_aviamento_id, (k) => (k === "__none__" ? "Sem subcategoria" : subMap.get(k) ?? "Sem subcategoria"));
  // Agrupa pela cor da 1ª variante (representativa) — o aviamento pode ter várias cores.
  const byCorBase = (items: Aviamento[]) => splitBy(items, (a) => primeiraVariante(a.id)?.cor_id ?? null, (k) => (k === "__none__" ? "Sem cor base" : corBaseMap.get(k) ?? "Sem cor base"));
  const byCorApelido = (items: Aviamento[]) => splitBy(items, (a) => primeiraVariante(a.id)?.cor_apelido_id ?? null, (k) => (k === "__none__" ? "Sem cor apelido" : corApelidoMap.get(k) ?? "Sem cor apelido"));
  const byFornecedor = (items: Aviamento[]) => splitBy(items, (a) => a.empresa_id, (k) => (k === "__none__" ? "Sem fornecedor" : empresasMap.get(k) ?? "Sem fornecedor"));
  const splitters = [
    groupByCat ? byCat : null,
    groupBySub ? bySub : null,
    groupByCorBase ? byCorBase : null,
    groupByCorApelido ? byCorApelido : null,
    groupByFornecedor ? byFornecedor : null,
  ].filter(Boolean) as ((i: Aviamento[]) => Split[])[];
  type Grupo = { key: string; nome: string; count: number; items?: Aviamento[]; subgroups?: Grupo[] };
  const buildGroups = (items: Aviamento[], depth: number): Grupo[] =>
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
          <Package className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="font-display text-xl font-semibold tracking-tight">Aviamentos</h1>
            <p className="text-sm text-muted-foreground">
              Galeria de aviamentos cadastrados.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">

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
          <AgrupamentoButton
            groups={[
              { label: "Categoria", active: groupByCat, onToggle: () => setGroupByCat((v) => !v) },
              { label: "Subcategoria", active: groupBySub, onToggle: () => setGroupBySub((v) => !v) },
              { label: "Cor base", active: groupByCorBase, onToggle: () => setGroupByCorBase((v) => !v) },
              { label: "Cor apelido", active: groupByCorApelido, onToggle: () => setGroupByCorApelido((v) => !v) },
              { label: "Fornecedor", active: groupByFornecedor, onToggle: () => setGroupByFornecedor((v) => !v) },
            ]}
          />
          <FilterButton
            screen="aviamentos"
            filters={[
              { label: "Categoria", value: fCat, onChange: setFCat, options: categorias },
              { label: "Subcategoria", value: fSub, onChange: setFSub, options: subOptionsFiltro },
              { label: "Material", value: fMat, onChange: setFMat, options: materiais },
              { label: "Intervalo Largura", value: fLarg, onChange: setFLarg, options: intervalos },
              { label: "Intervalo Vazado", value: fVaz, onChange: setFVaz, options: intervalos },
              { label: "Fornecedor", value: fEmp, onChange: setFEmp, options: empresas.map((e) => ({ id: e.id, nome: e.nome_fantasia })) },
            ]}
          />
          <Button onClick={() => setCreateOpen(true)} disabled={readOnly} className="max-sm:hidden">
            <Plus className="h-4 w-4 mr-1" /> Novo
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          <Badge variant="secondary">{filtered.length}</Badge> {filtered.length === 1 ? "aviamento" : "aviamentos"}
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
        aviamentos.length === 0 ? (
          <EmptyState
            icon={Package}
            title="Nenhum aviamento cadastrado"
            description="Cadastre o primeiro aviamento para começar a montar sua galeria."
            action={readOnly ? undefined : { label: "Novo aviamento", onClick: () => setCreateOpen(true) }}
          />
        ) : (
          <EmptyState
            icon={Search}
            title="Nenhum aviamento encontrado"
            description="Nenhum aviamento corresponde aos filtros aplicados."
            action={{
              label: "Limpar filtros",
              onClick: () => { setSearch(""); setSort("nome"); setFCat([]); setFSub([]); setFMat([]); setFLarg([]); setFVaz([]); setFEmp([]); },
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
            qc.invalidateQueries({ queryKey: ["aviamentos-variantes"] });
            setCreateOpen(false);
            setEditing(null);
          }}
          onDelete={() => editing && setDeleting(editing)}
          readOnly={readOnly}
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
            <AlertDialogAction
              onClick={() => deleting && deleteMut.mutate(deleting)}
              variant="destructive"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MobileActionBar>
        <Button onClick={() => setCreateOpen(true)} disabled={readOnly} className="ml-auto">
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </MobileActionBar>
    </div>
  );
}


function AviamentoCard({
  aviamento,
  variantes,
  categoria,
  fornecedor,
  onEdit,
  compact,
  readOnly,
}: {
  aviamento: Aviamento;
  variantes: VarianteCorRow[];
  categoria: string | null;
  fornecedor: string | null;
  onEdit: () => void;
  compact?: boolean;
  readOnly?: boolean;
}) {
  const url = useSignedUrl(aviamento.foto_url, "aviamentos");
  return (
    <div className="group relative">
      <button type="button" onClick={onEdit} className="block w-full text-left" aria-label={`Abrir ${aviamento.codigo_nome}`}>
        <Card className="overflow-hidden h-full transition-shadow group-hover:shadow-md">
          <div className="aspect-square bg-muted relative">
            {url ? (
              <img src={url} alt={aviamento.codigo_nome} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                <ImageOff className="h-10 w-10" />
              </div>
            )}
          </div>
          {!compact && (
          // Altura FIXA (224px) + flex-col + preço com mt-auto: TODOS os cards com a mesma
          // altura e preço no rodapé; 224px comporta título de até 3 linhas + código/NCM sem
          // raspar o preço (line-clamp-3). Este card é mais denso que o de Tecidos (204px).
          <div className="p-3 flex h-[224px] flex-col gap-1 overflow-hidden">
            {aviamento.codigo && (
              <p className="font-mono text-[11px] leading-none text-muted-foreground">{aviamento.codigo}</p>
            )}
            <h3 className="font-medium leading-tight line-clamp-3">{aviamento.codigo_nome}</h3>
            {(categoria || variantes.length > 0) && (
              <div className="flex flex-wrap gap-1">
                {categoria && <Badge variant="secondary" className="text-[10px]">{categoria}</Badge>}
                {variantes.slice(0, 3).map((v, i) => (
                  <Badge key={i} variant="outline" className="text-[10px]">
                    {v.cor?.nome ?? "—"}{v.cor_apelido?.nome ? ` · ${v.cor_apelido.nome}` : ""}
                  </Badge>
                ))}
                {variantes.length > 3 && (
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">+{variantes.length - 3}</Badge>
                )}
              </div>
            )}
            {(!categoria || !fornecedor) && (
              <StatusBadge tone="warning" className="w-full justify-start gap-1 normal-case tracking-normal">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span className="line-clamp-1">
                  {!categoria && !fornecedor
                    ? "Sem categoria e sem fornecedor"
                    : !categoria
                      ? "Sem categoria"
                      : "Sem fornecedor"}
                </span>
              </StatusBadge>
            )}
            <p className="text-xs text-muted-foreground line-clamp-1">{fornecedor ?? "—"}</p>
            {aviamento.ncm && (
              <p className="text-[11px] text-muted-foreground line-clamp-1">NCM {aviamento.ncm}</p>
            )}
            <p className="mt-auto text-sm font-semibold text-primary">{fmtBRL(aviamento.preco)}</p>
          </div>
          )}
        </Card>
      </button>
    </div>
  );
}

type FormState = {
  codigo_nome: string;
  empresa_id: string;
  representante_id: string;
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
  ncm: string;
  foto_url: string | null;
};

const emptyForm: FormState = {
  codigo_nome: "",
  empresa_id: "",
  representante_id: "",
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
  ncm: "",
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
  onDelete,
  readOnly,
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
  onDelete?: () => void;
  readOnly?: boolean;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  // Variantes em staging (só no "+ Novo"; no Sheet elas são persistidas ao vivo).
  const [stagedVars, setStagedVars] = useState<VarDraft[]>([]);
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Fotos enviadas nesta sessão e ainda não persistidas; removidas se o
  // usuário trocar a foto ou fechar o diálogo sem salvar (evita órfãos).
  const sessionUploads = useRef<string[]>([]);
  const savedRef = useRef(false);

  // Guarda de alterações não salvas (Case C: muitos campos, snapshot do objeto form).
  const { dirty: formChanged, markClean, reset: resetBaseline } = useDirtySnapshot(form);
  // No "+ Novo" as variantes em staging também sujam o form (guarda de não-salvo).
  const dirty = open && (formChanged || (!initial && stagedVars.length > 0));
  const closeAndCleanup = useCallback(() => {
    if (!savedRef.current && sessionUploads.current.length > 0) {
      const orphans = sessionUploads.current;
      sessionUploads.current = [];
      void supabase.storage.from("aviamentos").remove(orphans);
    }
    onOpenChange(false);
  }, [onOpenChange]);
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose: closeAndCleanup });
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
    setStagedVars([]);
    if (initial) {
      const next: FormState = {
        codigo_nome: initial.codigo_nome ?? "",
        empresa_id: initial.empresa_id ?? "",
        representante_id: initial.representante_id ?? "",
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
        ncm: initial.ncm ?? "",
        foto_url: initial.foto_url,
      };
      setForm(next);
      resetBaseline(next);
    } else {
      setForm(emptyForm);
      resetBaseline(emptyForm);
    }
    setLocalPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, [initial, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredSub = subcategorias.filter(
    (s) => !form.categoria_aviamento_id || s.categoria_aviamento_id === form.categoria_aviamento_id,
  );

  // O fornecedor salvo pode não estar entre os fornecedores da categoria "Aviamento" (ex.: a
  // categoria dele mudou depois). Busca o atual p/ garantir que apareça no Select (senão ficava
  // em branco mesmo com valor salvo).
  const { data: empresaInicial } = useQuery({
    queryKey: ["empresa-por-id", initial?.empresa_id],
    enabled: open && !!initial?.empresa_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("empresas")
        .select("id,nome_fantasia,representantes(id, nome)")
        .eq("id", initial!.empresa_id!)
        .maybeSingle();
      return data as Empresa | null;
    },
  });
  // Lista p/ o FornecedorSelect: fornecedores da categoria + o salvo (mesmo fora da
  // categoria), cada um com seus representantes.
  const empresasFornecedor = useMemo<Empresa[]>(() => {
    const list = [...empresas];
    if (empresaInicial && !list.some((e) => e.id === empresaInicial.id)) list.push(empresaInicial);
    return list;
  }, [empresas, empresaInicial]);

  // Cores já cadastradas: base (cores) + apelido (cores_apelido, vinculado à base).
  const { data: cores = [] } = useQuery({
    queryKey: ["cores-list"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.from("cores").select("id,nome").order("nome");
      if (error) throw error;
      return (data ?? []) as Option[];
    },
  });
  const { data: coresApelido = [] } = useQuery({
    queryKey: ["cores-apelido-list"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cores_apelido")
        .select("id,nome,cor_base_id")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as CorApelido[];
    },
  });
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
      toast.error(mensagemErro(e, "Falha no upload."));
    } finally {
      setUploading(false);
    }
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      // Nome é opcional — o identificador é o `codigo` automático.
      const nome = form.codigo_nome.trim();
      const payload = {
        codigo_nome: nome,
        empresa_id: form.empresa_id || null,
        representante_id: form.representante_id || null,
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
        ncm: form.ncm.trim() || null,
        foto_url: form.foto_url,
      };
      // ncm ainda não está no types.ts gerado (backlog) → cast.
      // Cor saiu do form: agora vive nas VARIANTES (variantes_aviamento). No Sheet
      // (editar) elas são persistidas ao vivo pela seção; no "+ Novo" ficam em staging
      // e são gravadas atomicamente aqui após criar o aviamento.
      if (initial) {
        const { error } = await supabase.from("aviamentos").update(payload as never).eq("id", initial.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("aviamentos")
          .insert(payload as never)
          .select("id")
          .single();
        if (error) throw error;
        const newId = (data as any)?.id as string;
        if (newId && stagedVars.length > 0) {
          const { error: vErr } = await supabase.rpc("salvar_variantes_aviamento" as any, {
            _aviamento_id: newId,
            _variantes: stagedVars.map((v) => ({ cor_id: v.cor_id, cor_apelido_id: v.cor_apelido_id })),
          });
          if (vErr) throw vErr;
        }
      }
    },
    onSuccess: () => {
      // Uploads desta sessão agora estão persistidos: não devem ser removidos.
      savedRef.current = true;
      sessionUploads.current = [];
      markClean();
      toast.success(initial ? "Aviamento atualizado." : "Aviamento criado.");
      onSaved();
    },
    onError: (e: any) =>
      toast.error(
        e?.code === "23505"
          ? "Este código já existe neste fornecedor."
          : mensagemErro(e, "Erro ao salvar."),
      ),
  });

  const handleOpenChange = (o: boolean) => {
    if (!o) requestClose();
    else onOpenChange(true);
  };

  const isSheet = !!initial;
  return (
    <ModalShell isSheet={isSheet} open={open} onOpenChange={handleOpenChange}>
        {isSheet ? (
          // Sheet (editar): cabeçalho sem botões de ação (ficam no rodapé sticky).
          <div className="shrink-0 border-b p-3 flex items-center gap-3">
            <DialogTitle className="text-xl font-bold">Editar Aviamento</DialogTitle>
            <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
          </div>
        ) : (
          <DialogHeader className="max-sm:shrink-0">
            <div className="flex items-center gap-2">
              <DialogTitle>Novo Aviamento</DialogTitle>
              <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
            </div>
          </DialogHeader>
        )}

        <fieldset disabled={readOnly} className={isSheet ? "flex-1 overflow-y-auto" : "contents"}>
        <div className={`grid gap-4 md:grid-cols-3 py-2 max-sm:min-h-0 max-sm:min-w-0 ${isSheet ? "p-4" : "max-sm:overflow-y-auto"}`}>
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
            <div className="md:col-span-2 flex flex-col gap-3 sm:flex-row">
              <Field label="Código" className="sm:w-48 sm:shrink-0">
                <Input
                  value={initial?.codigo ?? ""}
                  readOnly
                  disabled
                  placeholder="Gerado ao salvar"
                  className="font-mono"
                />
              </Field>
              <Field label="NCM" className="flex-1">
                <Input
                  value={form.ncm}
                  onChange={(e) => set("ncm", e.target.value)}
                  placeholder="Ex: 9606.22.00"
                  inputMode="numeric"
                />
              </Field>
            </div>
            <Field label="Nome" className="md:col-span-2">
              <Input
                value={form.codigo_nome}
                onChange={(e) => set("codigo_nome", e.target.value)}
                placeholder="Ex: Botão metal 12mm"
              />
            </Field>

            <Field label="Fornecedor">
              {/* Dropdown único: empresa (direto) OU empresa via representante. */}
              <FornecedorSelect
                empresas={empresasFornecedor}
                empresaId={form.empresa_id || null}
                representanteId={form.representante_id || null}
                onChange={(empresa_id, representante_id) =>
                  setForm((f) => ({ ...f, empresa_id: empresa_id ?? "", representante_id: representante_id ?? "" }))
                }
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

            <div className="md:col-span-2">
              <VariantesAviamentoSection
                aviamentoId={initial?.id}
                staged={stagedVars}
                onStagedChange={setStagedVars}
                cores={cores}
                coresApelido={coresApelido}
                readOnly={readOnly}
                precoAviamento={form.preco ? Number(form.preco) : null}
              />
            </div>

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
        </fieldset>

        {isSheet ? (
          // Sheet (editar): rodapé sticky com todos os botões — todos os tamanhos.
          <div className="shrink-0 border-t bg-background p-3 flex items-center gap-2 sm:justify-end">
            <Button variant="outline" onClick={requestClose}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
            {!readOnly && initial && onDelete && (
              <Button variant="destructive" onClick={() => onDelete()}>
                <Trash2 className="h-4 w-4 mr-1" /> Excluir
              </Button>
            )}
            {!readOnly && (
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                <Save className="h-4 w-4 mr-1" /> {saveMut.isPending ? "Salvando…" : "Salvar"}
              </Button>
            )}
          </div>
        ) : (
          <DialogFooter className="max-sm:shrink-0 max-sm:flex-row max-sm:items-center max-sm:border-t max-sm:bg-background max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3">
            <Button variant="outline" onClick={requestClose}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
            </Button>
            {!readOnly && (
              <Button className="ml-auto sm:ml-0" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Salvando…" : "Salvar"}
              </Button>
            )}
          </DialogFooter>
        )}
        <UnsavedChangesGuard
          confirm={confirm}
          message="Há alterações não salvas neste aviamento."
        />
    </ModalShell>
  );
}

// Editar (abrir card) = Sheet lateral (igual Planejamento); Novo (cadastrar) = Dialog
// centralizado. Sheet e Dialog do shadcn são o mesmo primitivo do Radix, então o
// DialogHeader/DialogTitle/DialogFooter internos funcionam nos dois.
function ModalShell({ isSheet, open, onOpenChange, children }: {
  isSheet: boolean;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  children: React.ReactNode;
}) {
  if (isSheet) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" size="editor" className="flex flex-col p-0 [&>button]:hidden">
          {children}
        </SheetContent>
      </Sheet>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!grid-rows-[auto_minmax(0,1fr)_auto] max-sm:!overflow-hidden">
        {children}
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

// ============= Variantes de aviamento (espelha "Cores e Variantes" do Tecido) =============

type VarAviamentoRow = { id: string; cor_id: string | null; cor_apelido_id: string | null };

function VariantesAviamentoSection({
  aviamentoId,
  staged,
  onStagedChange,
  cores,
  coresApelido,
  readOnly,
  precoAviamento,
}: {
  // Presente no Sheet (editar) → variantes ao vivo; ausente no "+ Novo" → staging.
  aviamentoId?: string;
  staged: VarDraft[];
  onStagedChange: (v: VarDraft[]) => void;
  cores: Option[];
  coresApelido: CorApelido[];
  readOnly?: boolean;
  precoAviamento: number | null;
}) {
  const qc = useQueryClient();
  const persisted = !!aviamentoId;
  const [addBase, setAddBase] = useState("");
  const [addApelido, setAddApelido] = useState("");
  const [removeTarget, setRemoveTarget] = useState<VarAviamentoRow | null>(null);

  const { data: dbVars = [] } = useQuery({
    queryKey: ["variantes-aviamento", aviamentoId],
    enabled: persisted,
    queryFn: async () => {
      const { data, error } = await (supabase.from("variantes_aviamento" as any) as any)
        .select("id,cor_id,cor_apelido_id,created_at")
        .eq("aviamento_id", aviamentoId!)
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as unknown as VarAviamentoRow[];
    },
  });

  const coresMap = useMemo(() => new Map(cores.map((c) => [c.id, c.nome])), [cores]);
  const apelidosMap = useMemo(() => new Map(coresApelido.map((a) => [a.id, a.nome])), [coresApelido]);
  const apelidoBase = useMemo(() => new Map(coresApelido.map((a) => [a.id, a.cor_base_id])), [coresApelido]);

  type Row = { key: string; cor_id: string | null; cor_apelido_id: string | null; persistedId?: string; stagedIndex?: number };
  const rows: Row[] = persisted
    ? dbVars.map((v) => ({ key: v.id, cor_id: v.cor_id, cor_apelido_id: v.cor_apelido_id, persistedId: v.id }))
    : staged.map((v, i) => ({ key: `s${i}`, cor_id: v.cor_id, cor_apelido_id: v.cor_apelido_id, stagedIndex: i }));

  const jaExiste = rows.some((r) => r.cor_id === addBase && (r.cor_apelido_id ?? null) === (addApelido || null));

  const addMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase.from("variantes_aviamento" as any) as any).insert({
        aviamento_id: aviamentoId,
        cor_id: addBase,
        cor_apelido_id: addApelido || null,
        preco: precoAviamento ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAddBase(""); setAddApelido("");
      qc.invalidateQueries({ queryKey: ["variantes-aviamento", aviamentoId] });
      qc.invalidateQueries({ queryKey: ["aviamentos-variantes"] });
    },
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Essa cor (com esse apelido) já existe neste aviamento." : mensagemErro(e, "Erro ao adicionar.")),
  });

  const removeMut = useMutation({
    mutationFn: async (v: VarAviamentoRow) => {
      const { error } = await supabase.rpc("excluir_variante_aviamento" as any, { _variante_id: v.id });
      if (error) throw error;
    },
    onSuccess: () => {
      setRemoveTarget(null);
      qc.invalidateQueries({ queryKey: ["variantes-aviamento", aviamentoId] });
      qc.invalidateQueries({ queryKey: ["aviamentos-variantes"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao remover.")),
  });

  const doAdd = () => {
    if (readOnly || !addBase || jaExiste) return;
    if (persisted) addMut.mutate();
    else {
      onStagedChange([...staged, { cor_id: addBase, cor_apelido_id: addApelido || null }]);
      setAddBase(""); setAddApelido("");
    }
  };
  const doRemove = (r: Row) => {
    if (persisted && r.persistedId) {
      setRemoveTarget({ id: r.persistedId, cor_id: r.cor_id, cor_apelido_id: r.cor_apelido_id });
    } else if (r.stagedIndex != null) {
      onStagedChange(staged.filter((_, i) => i !== r.stagedIndex));
    }
  };

  const apelidosDoBase = addBase ? coresApelido.filter((a) => a.cor_base_id === addBase) : coresApelido;
  const labelRow = (cor_id: string | null, cor_apelido_id: string | null) =>
    corApelidoLabel(
      cor_id ? coresMap.get(cor_id) ?? null : null,
      cor_apelido_id ? apelidosMap.get(cor_apelido_id) ?? null : null,
    );

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
      <div>
        <Label className="text-sm font-semibold">Cores e Variantes</Label>
        <p className="text-xs text-muted-foreground">
          Cada cor vira uma variante (cor base + apelido) — usada em OC, produção e estoque.
        </p>
      </div>

      {/* Adicionar variante — cor base ↔ apelido vinculados (apelido opcional). */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Cor base</Label>
          <Select
            value={addBase || undefined}
            onValueChange={(b) => { setAddBase(b); if (addApelido && apelidoBase.get(addApelido) !== b) setAddApelido(""); }}
            disabled={readOnly}
          >
            <SelectTrigger className="h-9"><SelectValue placeholder="Selecione a cor" /></SelectTrigger>
            <SelectContent>
              {cores.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex-1 space-y-1">
          <Label className="text-xs">Cor apelido</Label>
          <Select
            value={addApelido || undefined}
            onValueChange={(a) => { setAddApelido(a); const base = apelidoBase.get(a); if (base) setAddBase(base); }}
            disabled={readOnly}
          >
            <SelectTrigger className="h-9"><SelectValue placeholder={addBase ? "Selecione o apelido" : "Selecione a cor base"} /></SelectTrigger>
            <SelectContent>
              {apelidosDoBase.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.nome}{!addBase && a.cor_base_id ? ` · ${coresMap.get(a.cor_base_id) ?? ""}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="button" className="shrink-0" disabled={readOnly || !addBase || jaExiste || addMut.isPending} onClick={doAdd}>
          <Plus className="h-4 w-4 sm:mr-1" /><span className="max-sm:sr-only">Adicionar</span>
        </Button>
      </div>
      {jaExiste && <p className="text-xs text-amber-600">Essa cor (com esse apelido) já existe neste aviamento.</p>}
      {cores.length === 0 && <p className="text-xs text-muted-foreground italic">Cadastre cores em Atributos primeiro.</p>}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">Nenhuma variante criada ainda.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
              <span className="flex-1 text-sm">{labelRow(r.cor_id, r.cor_apelido_id)}</span>
              <Button variant="ghost" size="icon" aria-label="Remover variante" onClick={() => doRemove(r)} disabled={readOnly}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta cor?</AlertDialogTitle>
            <AlertDialogDescription>
              A cor <strong>{removeTarget ? labelRow(removeTarget.cor_id, removeTarget.cor_apelido_id) : ""}</strong>{" "}
              será removida do aviamento. A exclusão é bloqueada se a cor estiver em uso.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); if (removeTarget) removeMut.mutate(removeTarget); }} variant="destructive">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
