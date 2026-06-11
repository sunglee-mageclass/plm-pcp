import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings, Plus, GripVertical, Trash2, Save } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

const DEFAULTS = {
  usa_pl: true,
  corte_interno: false,
  oficina_interna: false,
  oficina_posicao: "terceirizados" as "terceirizados" | "acabamento",
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
          <CardTitle>Fluxo de Produção</CardTitle>
          <CardDescription>Define como as etapas de fabricação são organizadas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            label="Usa PL?"
            description="Habilita o módulo de Planejamento."
            checked={cfg.usa_pl}
            onChange={(v) => setCfg({ ...cfg, usa_pl: v })}
          />
          <ToggleRow
            label="Corte interno?"
            description="Corte realizado dentro da loja."
            checked={cfg.corte_interno}
            onChange={(v) => setCfg({ ...cfg, corte_interno: v })}
          />
          <ToggleRow
            label="Oficina interna?"
            description="Costura realizada dentro da loja."
            checked={cfg.oficina_interna}
            onChange={(v) => setCfg({ ...cfg, oficina_interna: v })}
          />
          <div className="space-y-2">
            <Label>Posição da oficina</Label>
            <Select
              value={cfg.oficina_posicao}
              onValueChange={(v) =>
                setCfg({ ...cfg, oficina_posicao: v as ConfigState["oficina_posicao"] })
              }
            >
              <SelectTrigger className="w-full md:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="terceirizados">Terceirizados</SelectItem>
                <SelectItem value="acabamento">Acabamento</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

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
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div>
        <p className="font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
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
