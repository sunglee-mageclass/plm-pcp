import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Plus, GripVertical, Trash2, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { TIMEZONE_OPTIONS } from "@/lib/timezone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/shared/NumberInput";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useTenantModules } from "@/hooks/useTenantModules";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";

export const Route = createFileRoute("/_authenticated/admin/configuracoes")({
  component: ConfiguracoesLojaPage,
});

const FIELD_LABEL_DEFAULTS: Record<string, string> = {
  colecao: "Coleção",
  ref: "REF",
  estilista: "Estilista",
  modelista: "Modelista",
  piloteiro: "Piloteiro",
  linha: "Linha",
};

// Campos personalizáveis que aparecem em cada módulo (chaves de campos_editaveis).
const MODULE_FIELD_KEYS: Record<string, string[]> = {
  cadastro: ["colecao", "ref", "linha"],
  criacao: ["colecao", "ref", "linha", "estilista", "modelista", "piloteiro"],
  producao: ["ref", "colecao", "linha"],
  entrada_saida: [],
  financeiro: [],
  dashboard: [],
};

const DEFAULTS = {
  timezone: "America/Sao_Paulo" as string,
  etapas_acabamento: ["Caseado", "Botão", "Passadoria"],
  tamanhos_grade: ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"],
  status_kanban: [
    "Em Modelagem",
    "Corte de Piloto I",
    "Corte de Piloto II",
    "Corte de Piloto III",
    "Em Pilotagem",
    "Prova de Roupa I",
    "Prova de Roupa II",
    "Prova de Roupa III",
    "Prova de Roupa IV",
    "Prova de Roupa V",
    "Em Ajuste",
    "Stand By",
    "Reprovado",
    "Aprovado",
  ],
  campos_editaveis: {} as Record<string, string>,
  estoque_critico_threshold: 0 as number,
  estoque_critico_aviamento: 0 as number,
  modo_baixa_estoque: "por_oc" as "por_oc" | "automatico",
};

type ConfigState = typeof DEFAULTS;

const MODULE_LABELS: { key: string; label: string }[] = [
  { key: "cadastro", label: "Cadastro" },
  { key: "criacao", label: "Criação" },
  { key: "entrada_saida", label: "Entrada e Saída" },
  { key: "producao", label: "Produção" },
  { key: "financeiro", label: "Financeiro" },
  { key: "dashboard", label: "Dashboard" },
];

function ConfiguracoesLojaPage() {
  const { user, isTenantAdmin, isSuperAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const { modules } = useTenantModules();
  const [cfg, setCfg] = useState<ConfigState>(DEFAULTS);

  const { data, isLoading } = useQuery({
    queryKey: ["tenant-config", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data: u } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", user!.id)
        .maybeSingle();
      const tenantId = u?.tenant_id;
      if (!tenantId) return { tenantId: null, cfg: null };
      const { data: row } = await supabase
        .from("tenant_config")
        .select("*")
        .eq("tenant_id", tenantId)
        .maybeSingle();
      return { tenantId, cfg: row };
    },
  });

  useEffect(() => {
    if (!data?.cfg) return;
    const r = data.cfg as any;
    setCfg({
      timezone: r.timezone ?? DEFAULTS.timezone,
      etapas_acabamento: Array.isArray(r.etapas_acabamento)
        ? r.etapas_acabamento
        : DEFAULTS.etapas_acabamento,
      tamanhos_grade: Array.isArray(r.tamanhos_grade)
        ? r.tamanhos_grade
        : DEFAULTS.tamanhos_grade,
      status_kanban: Array.isArray(r.status_kanban)
        ? r.status_kanban
        : DEFAULTS.status_kanban,
      campos_editaveis:
        r.campos_editaveis && typeof r.campos_editaveis === "object" && !Array.isArray(r.campos_editaveis)
          ? (r.campos_editaveis as Record<string, string>)
          : DEFAULTS.campos_editaveis,
      estoque_critico_threshold: Number(r.estoque_critico_threshold ?? 0) || 0,
      estoque_critico_aviamento: Number(r.estoque_critico_aviamento ?? 0) || 0,
      modo_baixa_estoque: r.modo_baixa_estoque ?? DEFAULTS.modo_baixa_estoque,
    });
  }, [data?.cfg]);

  const save = useMutation({
    mutationFn: async () => {
      if (!data?.tenantId) throw new Error("Loja não identificada para este usuário.");
      // campos_editaveis é gerenciado SÓ pela janela de Nomenclaturas — não inclui
      // aqui para não sobrescrever o que foi salvo lá.
      const { campos_editaveis: _ce, ...cfgRest } = cfg;
      const payload = { tenant_id: data.tenantId, ...cfgRest };
      const { error } = await supabase
        .from("tenant_config")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configurações salvas");
      // Invalida TODA leitura de config para refletir na hora. As leituras usam
      // prefixos divergentes (tenant_config, tenant-config-grade, cad-tenant-config-grade,
      // tenant-config-threshold, tenant-status-kanban, ft-tamanhos…), então casamos
      // por predicate em vez de prefixo único.
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return typeof k === "string" && (k.includes("tenant") || k.includes("tamanhos"));
        },
      });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  if (loading) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  if (!isTenantAdmin && !isSuperAdmin) return <Navigate to="/" />;

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-w-4xl">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Configurações da Loja</h1>
            <p className="text-sm text-muted-foreground">
              Parâmetros usados em todo o fluxo de produção.
            </p>
          </div>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending || isLoading}>
          <Save className="h-4 w-4 mr-2" />
          {save.isPending ? "Salvando…" : "Salvar alterações"}
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Impressão</CardTitle>
          <CardDescription>Personalize o layout das fichas (logo, campos e textos).</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link to="/admin/editor-impressao">Abrir editor de impressão — Ficha de Corte</Link>
          </Button>
        </CardContent>
      </Card>

      <ServicosCard tenantId={data?.tenantId ?? null} />

      <SortableListCard
        title="Acabamento"
        description="Etapas executadas após a costura."
        items={cfg.etapas_acabamento}
        onChange={(items) => setCfg({ ...cfg, etapas_acabamento: items })}
        placeholder="Ex: Caseado"
      />

      <SortableListCard
        title="Grade de Tamanhos"
        description="Use o formato Número|Sigla (ex: 38|P)."
        items={cfg.tamanhos_grade}
        onChange={(items) => setCfg({ ...cfg, tamanhos_grade: items })}
        placeholder="Ex: 38|P"
      />

      <SortableListCard
        title="Status do Kanban"
        description="Colunas exibidas no painel de criação."
        items={cfg.status_kanban}
        onChange={(items) => setCfg({ ...cfg, status_kanban: items })}
        placeholder="Ex: Em Modelagem"
      />

      <Card>
        <CardHeader>
          <CardTitle>Data e Hora</CardTitle>
          <CardDescription>
            Fuso horário da loja. Afeta o relógio do topo e as mensagens de
            prazo/atraso/adiantado das ordens de compra.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Fuso horário (GMT)</Label>
          <Select
            value={cfg.timezone}
            onValueChange={(v) => setCfg({ ...cfg, timezone: v })}
          >
            <SelectTrigger className="w-full md:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONE_OPTIONS.map((tz) => (
                <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Baixa de Estoque</CardTitle>
          <CardDescription>
            Como o tecido sai do estoque quando um CAD é enviado ao corte.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Modo de baixa</Label>
          <Select
            value={cfg.modo_baixa_estoque}
            onValueChange={(v) =>
              setCfg({ ...cfg, modo_baixa_estoque: v as ConfigState["modo_baixa_estoque"] })
            }
          >
            <SelectTrigger className="w-full md:w-96">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="por_oc">Por OC (respeita o vínculo modelo↔OC)</SelectItem>
              <SelectItem value="automatico">Automático (FIFO — estoque mais velho primeiro)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            "Por OC" baixa primeiro das OCs vinculadas no Desenvolvimento e usa FIFO no restante.
            "Automático" ignora os vínculos e consome sempre o lote mais antigo.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Módulos da loja</CardTitle>
          <CardDescription>
            Módulos habilitados para a sua loja. Para contratar ou desabilitar um módulo, fale com o suporte.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {MODULE_LABELS.map((m) => {
              const on = !!(modules as any)[m.key];
              return (
                <Badge key={m.key} variant={on ? "default" : "secondary"} className={on ? "" : "opacity-60"}>
                  {m.label}: {on ? "Ativo" : "Inativo"}
                </Badge>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nomenclaturas</CardTitle>
          <CardDescription>
            Renomeie as abas do menu (módulos e páginas) e os campos de cada módulo.
            Deixe em branco para manter o nome padrão.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NomesDasAbasDialog tenantId={data?.tenantId ?? null} modules={(data?.cfg as any)?.modules ?? {}} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alertas</CardTitle>
          <CardDescription>Limites para destacar itens críticos no estoque e no dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Tecido — alertar abaixo de (metros)</Label>
            <NumberInput
              type="number"
              min={0}
              step="0.01"
              className="w-full md:w-72"
              value={cfg.estoque_critico_threshold}
              onChange={(e) =>
                setCfg({ ...cfg, estoque_critico_threshold: Number(e.target.value) || 0 })
              }
            />
            <p className="text-xs text-muted-foreground">
              Vale para todo tecido em metros (tecido em kg é convertido para metros).
            </p>
          </div>
          <div className="space-y-2">
            <Label>Aviamento — alertar abaixo de (unidades)</Label>
            <NumberInput
              type="number"
              min={0}
              step="0.01"
              className="w-full md:w-72"
              value={cfg.estoque_critico_aviamento}
              onChange={(e) =>
                setCfg({ ...cfg, estoque_critico_aviamento: Number(e.target.value) || 0 })
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Itens com estoque igual ou abaixo do valor aparecem em vermelho.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function SortableListCard({
  title,
  description,
  items,
  onChange,
  placeholder,
}: {
  title: string;
  description?: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const ids = items.map((label, idx) => `${idx}::${label}`);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(items, oldIndex, newIndex));
  };

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (items.includes(v)) {
      toast.error("Item já existe.");
      return;
    }
    onChange([...items, v]);
    setDraft("");
  };

  const update = (index: number, value: string) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };

  const remove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" onClick={add} variant="secondary">
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {items.map((label, idx) => (
                <SortableItem
                  key={ids[idx]}
                  id={ids[idx]}
                  value={label}
                  onChange={(v) => update(idx, v)}
                  onRemove={() => remove(idx)}
                />
              ))}
              {items.length === 0 && (
                <li className="text-sm text-muted-foreground italic">Nenhum item ainda.</li>
              )}
            </ul>
          </SortableContext>
        </DndContext>
      </CardContent>
    </Card>
  );
}

function SortableItem({
  id,
  value,
  onChange,
  onRemove,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border bg-card p-2"
    >
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground touch-none"
        {...attributes}
        {...listeners}
        aria-label="Arrastar"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 border-0 shadow-none focus-visible:ring-1"
      />
      <Button type="button" size="icon" variant="ghost" onClick={onRemove}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </li>
  );
}

// Editor das nomenclaturas por módulo: nomes das abas (módulo + páginas) e dos
// campos. O usuário escolhe UM módulo por vez.
function NomesDasAbasDialog({ tenantId, modules }: { tenantId: string | null; modules: Record<string, boolean> }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tabs, setTabs] = useState<Record<string, string>>({});
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);
  const enabledModules = PAGES_CATALOG.filter((m) => modules[m.module] !== false);
  const [selModule, setSelModule] = useState<string>(enabledModules[0]?.module ?? "");

  const { data: current } = useQuery({
    queryKey: ["tenant_config", "nomenclaturas_edit"],
    enabled: open && !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tab_labels, campos_editaveis").eq("tenant_id", tenantId!).maybeSingle();
      return {
        tab_labels: ((data as any)?.tab_labels ?? {}) as Record<string, string>,
        campos_editaveis: ((data as any)?.campos_editaveis ?? {}) as Record<string, string>,
      };
    },
  });

  useEffect(() => {
    if (open && current && !hydrated) {
      setTabs(current.tab_labels);
      setCampos(current.campos_editaveis);
      if (!selModule && enabledModules[0]) setSelModule(enabledModules[0].module);
      setHydrated(true);
    }
    if (!open) setHydrated(false);
  }, [open, current, hydrated, enabledModules, selModule]);

  const mod = PAGES_CATALOG.find((m) => m.module === selModule);
  const fieldKeys = MODULE_FIELD_KEYS[selModule] ?? [];

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("Loja não identificada.");
      const cleanTabs: Record<string, string> = {};
      Object.entries(tabs).forEach(([k, v]) => { if (v && v.trim()) cleanTabs[k] = v.trim(); });
      const cleanCampos: Record<string, string> = {};
      Object.entries(campos).forEach(([k, v]) => { if (v && v.trim()) cleanCampos[k] = v.trim(); });
      // upsert (não update): loja sem linha de config não perde a gravação em silêncio.
      const { error } = await supabase
        .from("tenant_config")
        .upsert({ tenant_id: tenantId, tab_labels: cleanTabs, campos_editaveis: cleanCampos } as any, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Nomenclaturas salvas");
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey?.[0];
          return typeof k === "string" && (k.includes("tenant") || k.includes("tamanhos"));
        },
      });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" disabled={!tenantId}>
          <Settings className="h-4 w-4 mr-2" /> Editar nomenclaturas por módulo
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nomenclaturas</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[170px_1fr] items-center gap-2">
          <Label className="text-sm font-semibold">Módulo a editar</Label>
          <Select value={selModule} onValueChange={setSelModule}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {enabledModules.map((m) => <SelectItem key={m.module} value={m.module}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {mod && (
          <div className="space-y-4">
            {/* Nomes das abas (módulo + páginas) */}
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Nomes das abas (menu)</p>
              <div className="grid grid-cols-1 md:grid-cols-[170px_1fr] items-center gap-2">
                <Label className="text-sm">{mod.label} <span className="text-muted-foreground">(módulo)</span></Label>
                <Input placeholder={mod.label} value={tabs[mod.module] ?? ""} onChange={(e) => setTabs((t) => ({ ...t, [mod.module]: e.target.value }))} />
              </div>
              {mod.pages.map((p) => (
                <div key={p.key} className="grid grid-cols-1 md:grid-cols-[170px_1fr] items-center gap-2 md:pl-4">
                  <Label className="text-xs text-muted-foreground">{p.label}</Label>
                  <Input className="h-8" placeholder={p.label} value={tabs[p.key] ?? ""} onChange={(e) => setTabs((t) => ({ ...t, [p.key]: e.target.value }))} />
                </div>
              ))}
            </div>

            {/* Nomes de campos do módulo */}
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground">Nomes de campos</p>
              {fieldKeys.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Nenhum campo personalizável neste módulo.</p>
              ) : (
                fieldKeys.map((k) => (
                  <div key={k} className="grid grid-cols-1 md:grid-cols-[170px_1fr] items-center gap-2">
                    <Label className="text-xs text-muted-foreground">{FIELD_LABEL_DEFAULTS[k] ?? k}</Label>
                    <Input className="h-8" placeholder={FIELD_LABEL_DEFAULTS[k] ?? k} value={campos[k] ?? ""} onChange={(e) => setCampos((c) => ({ ...c, [k]: e.target.value }))} />
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">Em branco = nome padrão.</p>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            <Save className="h-4 w-4 mr-2" /> Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Categorias de Terceirizado (mesma lista usada em Cadastro → Serviço → Terceirizados).
// Mesmo padrão visual do card de Acabamento, mas persiste direto na tabela
// `categorias_terceirizado` (cada ação salva na hora, não depende do botão "Salvar").
function ServicosCard({ tenantId }: { tenantId: string | null }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { data: categorias = [], isLoading } = useQuery({
    queryKey: ["categorias_terceirizado", "config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_terceirizado")
        .select("id, nome, ordem")
        .order("ordem")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; nome: string; ordem: number }[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["categorias_terceirizado", "config"] });
    // Mesma lista consumida no cadastro de Terceirizados.
    qc.invalidateQueries({ queryKey: ["cat-terceirizado-options"] });
    qc.invalidateQueries({ queryKey: ["categorias_terceirizado"] });
  };

  const reorderMut = useMutation({
    mutationFn: async (ordered: { id: string }[]) => {
      await Promise.all(
        ordered.map((c, i) => supabase.from("categorias_terceirizado").update({ ordem: i } as any).eq("id", c.id)),
      );
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.message ?? "Erro ao reordenar."),
  });

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = categorias.findIndex((c) => c.id === active.id);
    const newIndex = categorias.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(categorias, oldIndex, newIndex);
    qc.setQueryData(["categorias_terceirizado", "config"], next); // otimista
    reorderMut.mutate(next);
  };

  const addMut = useMutation({
    mutationFn: async (nome: string) => {
      // tenant_id é preenchido pelo trigger set_tenant_id.
      const { error } = await supabase.from("categorias_terceirizado").insert({ nome, ordem: categorias.length } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      setDraft("");
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Categoria já existe." : e.message ?? "Erro ao adicionar."),
  });

  const renameMut = useMutation({
    mutationFn: async ({ id, nome }: { id: string; nome: string }) => {
      const { error } = await supabase
        .from("categorias_terceirizado")
        .update({ nome })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Categoria já existe." : e.message ?? "Erro ao renomear."),
  });

  const removeMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categorias_terceirizado").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) =>
      toast.error(
        e?.code === "23503"
          ? "Categoria em uso por terceirizados. Remova os vínculos antes."
          : e.message ?? "Erro ao excluir.",
      ),
  });

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (categorias.some((c) => c.nome.toLowerCase() === v.toLowerCase())) {
      toast.error("Categoria já existe.");
      return;
    }
    addMut.mutate(v);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Serviços</CardTitle>
        <CardDescription>Categorias dos serviços executados por terceirizados.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            placeholder="Ex: Estamparia"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            disabled={!tenantId}
          />
          <Button
            type="button"
            onClick={add}
            variant="secondary"
            disabled={!tenantId || addMut.isPending}
          >
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>

        {isLoading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground italic">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={categorias.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                {categorias.map((c) => (
                  <ServicoRow
                    key={c.id}
                    id={c.id}
                    nome={c.nome}
                    onRename={(nome) => renameMut.mutate({ id: c.id, nome })}
                    onRemove={() => removeMut.mutate(c.id)}
                  />
                ))}
                {categorias.length === 0 && (
                  <li className="text-sm text-muted-foreground italic">Nenhuma categoria ainda.</li>
                )}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>
  );
}

function ServicoRow({
  id,
  nome,
  onRename,
  onRemove,
}: {
  id: string;
  nome: string;
  onRename: (nome: string) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(nome);
  useEffect(() => setValue(nome), [nome]);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  const commit = () => {
    const v = value.trim();
    if (!v) {
      setValue(nome); // não permite vazio: reverte
      return;
    }
    if (v !== nome) onRename(v);
  };

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2 rounded-md border bg-card p-2">
      <button
        type="button"
        className="cursor-grab text-muted-foreground hover:text-foreground touch-none"
        {...attributes}
        {...listeners}
        aria-label="Arrastar"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="h-8 border-0 shadow-none focus-visible:ring-1"
      />
      <Button type="button" size="icon" variant="ghost" onClick={onRemove}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </li>
  );
}
