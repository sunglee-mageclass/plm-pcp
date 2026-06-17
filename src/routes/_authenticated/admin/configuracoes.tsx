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
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

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

const DEFAULTS = {
  usa_pl: true,
  corte_interno: false,
  oficina_interna: false,
  oficina_posicao: "terceirizados" as "terceirizados" | "acabamento",
  timezone: "America/Sao_Paulo" as string,
  formato_mes: "numeral" as "numeral" | "descrito" | "numeral_descrito",
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
  modo_baixa_estoque: "por_oc" as "por_oc" | "automatico",
};

type ConfigState = typeof DEFAULTS;

function ConfiguracoesLojaPage() {
  const { user, isTenantAdmin, isSuperAdmin, loading } = useAuth();
  const qc = useQueryClient();
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
      usa_pl: r.usa_pl ?? DEFAULTS.usa_pl,
      corte_interno: r.corte_interno ?? DEFAULTS.corte_interno,
      oficina_interna: r.oficina_interna ?? DEFAULTS.oficina_interna,
      oficina_posicao: r.oficina_posicao ?? DEFAULTS.oficina_posicao,
      timezone: r.timezone ?? DEFAULTS.timezone,
      formato_mes: r.formato_mes ?? DEFAULTS.formato_mes,
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
      modo_baixa_estoque: r.modo_baixa_estoque ?? DEFAULTS.modo_baixa_estoque,
    });
  }, [data?.cfg]);

  const save = useMutation({
    mutationFn: async () => {
      if (!data?.tenantId) throw new Error("Loja não identificada para este usuário.");
      const payload = { tenant_id: data.tenantId, ...cfg };
      const { error } = await supabase
        .from("tenant_config")
        .upsert(payload, { onConflict: "tenant_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Configurações salvas");
      qc.invalidateQueries({ queryKey: ["tenant-config"] });
      // Reads espalhados pelo app usam a chave ["tenant_config", ...]
      // (relógio, fuso, oficina_posicao, etc.) — invalida para refletir na hora.
      qc.invalidateQueries({ queryKey: ["tenant_config"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao salvar"),
  });

  if (loading) return <div className="p-6 text-muted-foreground">Carregando…</div>;
  if (!isTenantAdmin && !isSuperAdmin) return <Navigate to="/" />;

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-4xl">
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
          <CardTitle>Exibição</CardTitle>
          <CardDescription>Como datas e meses aparecem no sistema.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Formato de mês</Label>
          <Select
            value={cfg.formato_mes}
            onValueChange={(v) =>
              setCfg({ ...cfg, formato_mes: v as ConfigState["formato_mes"] })
            }
          >
            <SelectTrigger className="w-full md:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="numeral">Numeral (01, 02, 03…)</SelectItem>
              <SelectItem value="descrito">Descrito (Janeiro, Fevereiro…)</SelectItem>
              <SelectItem value="numeral_descrito">Numeral + Descrito (01 - Janeiro)</SelectItem>
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
          <CardTitle>Nomes de Campos</CardTitle>
          <CardDescription>
            Personalize como rótulos aparecem no sistema (ex: trocar "Coleção" por "Drop").
            Deixe em branco para manter o nome padrão.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(FIELD_LABEL_DEFAULTS).map(([key, padrao]) => (
            <div key={key} className="grid grid-cols-1 md:grid-cols-[200px_1fr] items-center gap-2">
              <Label className="text-sm text-muted-foreground">{padrao}</Label>
              <Input
                placeholder={padrao}
                value={cfg.campos_editaveis[key] ?? ""}
                onChange={(e) =>
                  setCfg({
                    ...cfg,
                    campos_editaveis: { ...cfg.campos_editaveis, [key]: e.target.value },
                  })
                }
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alertas</CardTitle>
          <CardDescription>Limites para destacar itens críticos no estoque e no dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label>Alertar quando estoque ficar abaixo de (metros/unidades)</Label>
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
            Itens com estoque igual ou abaixo desse valor aparecem em vermelho.
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

// Categorias de Terceirizado (mesma lista usada em Cadastro → Serviço → Terceirizados).
// Mesmo padrão visual do card de Acabamento, mas persiste direto na tabela
// `categorias_terceirizado` (cada ação salva na hora, não depende do botão "Salvar").
function ServicosCard({ tenantId }: { tenantId: string | null }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");

  const { data: categorias = [], isLoading } = useQuery({
    queryKey: ["categorias_terceirizado", "config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_terceirizado")
        .select("id, nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["categorias_terceirizado", "config"] });
    // Mesma lista consumida no cadastro de Terceirizados.
    qc.invalidateQueries({ queryKey: ["cat-terceirizado-options"] });
  };

  const addMut = useMutation({
    mutationFn: async (nome: string) => {
      // tenant_id é preenchido pelo trigger set_tenant_id.
      const { error } = await supabase.from("categorias_terceirizado").insert({ nome });
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
          <ul className="space-y-2">
            {categorias.map((c) => (
              <ServicoRow
                key={c.id}
                nome={c.nome}
                onRename={(nome) => renameMut.mutate({ id: c.id, nome })}
                onRemove={() => removeMut.mutate(c.id)}
              />
            ))}
            {categorias.length === 0 && (
              <li className="text-sm text-muted-foreground italic">Nenhuma categoria ainda.</li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ServicoRow({
  nome,
  onRename,
  onRemove,
}: {
  nome: string;
  onRename: (nome: string) => void;
  onRemove: () => void;
}) {
  const [value, setValue] = useState(nome);
  useEffect(() => setValue(nome), [nome]);

  const commit = () => {
    const v = value.trim();
    if (!v) {
      setValue(nome); // não permite vazio: reverte
      return;
    }
    if (v !== nome) onRename(v);
  };

  return (
    <li className="flex items-center gap-2 rounded-md border bg-card p-2">
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
