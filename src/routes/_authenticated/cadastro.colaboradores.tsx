import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, Plus, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { AttributeTab, type AttributeTabConfig } from "@/components/attribute-tab";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/cadastro/colaboradores")({
  component: () => (
    <RequirePermission page="cadastro_colaboradores">
      <ColaboradoresPage />
    </RequirePermission>
  ),
});

type Tab = {
  key: string; // chave de seleção
  label: string;
  tipo: string; // colaboradores.tipo
  config: AttributeTabConfig;
  custom: boolean;
  typeId?: string; // tipos_colaborador.id (só nos custom)
  categoriaId?: string | null; // categoria_terceirizado vinculada (só nos custom)
  categoriaNome?: string | null;
};

// Tipos fixos: usados por outras telas (planejamento/CAD) pela string do tipo.
const BUILTIN_USAGE = [{ table: "ocs_tecido", column: "responsavel_id" }];
// Tipos custom: colaboradores podem ser responsáveis de serviços internos.
const CUSTOM_USAGE = [
  { table: "producao_terceirizados", column: "colaborador_id" },
  { table: "producao_oficina", column: "colaborador_id" },
];

const BUILTINS: Tab[] = [
  {
    key: "estilista", label: "Estilista", tipo: "estilista", custom: false,
    config: { table: "colaboradores", nameField: "nome", singular: "Estilista", plural: "Estilistas", usage: BUILTIN_USAGE, fixedFilter: { field: "tipo", value: "estilista" } },
  },
  {
    key: "modelista", label: "Modelista", tipo: "modelista", custom: false,
    config: { table: "colaboradores", nameField: "nome", singular: "Modelista", plural: "Modelistas", usage: BUILTIN_USAGE, fixedFilter: { field: "tipo", value: "modelista" } },
  },
  {
    key: "piloteiro", label: "Piloteiro", tipo: "piloteiro", custom: false,
    config: { table: "colaboradores", nameField: "nome", singular: "Piloteiro", plural: "Piloteiros", usage: BUILTIN_USAGE, fixedFilter: { field: "tipo", value: "piloteiro" } },
  },
];
const RESERVED = new Set(BUILTINS.map((b) => b.tipo.toLowerCase()));

function useColabCount(tipo: string) {
  return useQuery({
    queryKey: ["colab-count", tipo],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("colaboradores")
        .select("id", { count: "exact", head: true })
        .eq("tipo", tipo);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

function ColaboradoresPage() {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const [selectedKey, setSelectedKey] = useState<string>(BUILTINS[0].key);
  const [addOpen, setAddOpen] = useState(false);
  const [editTab, setEditTab] = useState<Tab | null>(null); // null = criando
  const [novoTipo, setNovoTipo] = useState("");
  const [novaCategoria, setNovaCategoria] = useState<string>("");
  const [delTab, setDelTab] = useState<Tab | null>(null);

  const openCreate = () => {
    setEditTab(null);
    setNovoTipo("");
    setNovaCategoria("");
    setAddOpen(true);
  };
  const openEdit = (tab: Tab) => {
    setEditTab(tab);
    setNovoTipo(tab.tipo);
    setNovaCategoria(tab.categoriaId ?? "");
    setAddOpen(true);
  };
  const submitType = () => {
    if (editTab) editType.mutate({ tab: editTab, nome: novoTipo, categoriaId: novaCategoria });
    else addType.mutate({ nome: novoTipo, categoriaId: novaCategoria });
  };

  const { data: tiposCustom = [] } = useQuery({
    queryKey: ["tipos-colaborador"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tipos_colaborador" as any)
        .select("id, nome, categoria_terceirizado_id")
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as {
        id: string;
        nome: string;
        categoria_terceirizado_id: string | null;
      }[];
    },
  });

  const { data: categorias = [] } = useQuery({
    queryKey: ["categorias_terceirizado", "colab"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_terceirizado")
        .select("id, nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });
  const catMap = useMemo(
    () => Object.fromEntries(categorias.map((c) => [c.id, c.nome])),
    [categorias],
  );

  const tabs: Tab[] = useMemo(() => {
    const custom = tiposCustom.map((t) => ({
      key: `custom:${t.id}`,
      label: t.nome,
      tipo: t.nome,
      custom: true,
      typeId: t.id,
      categoriaId: t.categoria_terceirizado_id ?? null,
      categoriaNome: t.categoria_terceirizado_id ? catMap[t.categoria_terceirizado_id] ?? null : null,
      config: {
        table: "colaboradores",
        nameField: "nome",
        singular: t.nome,
        plural: t.nome,
        usage: CUSTOM_USAGE,
        fixedFilter: { field: "tipo", value: t.nome },
      } as AttributeTabConfig,
    }));
    return [...BUILTINS, ...custom];
  }, [tiposCustom, catMap]);

  const selected = useMemo(
    () => tabs.find((t) => t.key === selectedKey) ?? tabs[0],
    [tabs, selectedKey],
  );

  const { data: count, isLoading: countLoading } = useColabCount(selected.tipo);

  const addType = useMutation({
    mutationFn: async ({ nome, categoriaId }: { nome: string; categoriaId: string }) => {
      const v = nome.trim();
      if (!v) throw new Error("Informe o nome do tipo.");
      if (RESERVED.has(v.toLowerCase()))
        throw new Error("Esse tipo já existe como tipo fixo.");
      const { data, error } = await supabase
        .from("tipos_colaborador" as any)
        .insert({ nome: v, categoria_terceirizado_id: categoriaId || null })
        .select("id")
        .single();
      if (error) throw error;
      return (data as any).id as string;
    },
    onSuccess: (id) => {
      setAddOpen(false);
      setNovoTipo("");
      setNovaCategoria("");
      qc.invalidateQueries({ queryKey: ["tipos-colaborador"] });
      setSelectedKey(`custom:${id}`);
      toast.success("Tipo criado.");
    },
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Tipo já existe." : mensagemErro(e, "Erro ao criar tipo.")),
  });

  const editType = useMutation({
    mutationFn: async ({ tab, nome, categoriaId }: { tab: Tab; nome: string; categoriaId: string }) => {
      const v = nome.trim();
      if (!v) throw new Error("Informe o nome do tipo.");
      if (RESERVED.has(v.toLowerCase()) && v.toLowerCase() !== tab.tipo.toLowerCase())
        throw new Error("Esse tipo já existe como tipo fixo.");
      // Renomeia o TIPO primeiro: se colidir com outro tipo (unique 23505), falha
      // ANTES de tocar nos colaboradores — assim eles não ficam apontando p/ um nome
      // de tipo inexistente (e sumindo da aba). Só depois propaga aos colaboradores.
      const { error } = await supabase
        .from("tipos_colaborador" as any)
        .update({ nome: v, categoria_terceirizado_id: categoriaId || null })
        .eq("id", tab.typeId!);
      if (error) throw error;
      if (v !== tab.tipo) {
        const { error: cErr } = await supabase
          .from("colaboradores")
          .update({ tipo: v })
          .eq("tipo", tab.tipo);
        if (cErr) throw cErr;
      }
    },
    onSuccess: () => {
      setAddOpen(false);
      setEditTab(null);
      setNovoTipo("");
      setNovaCategoria("");
      qc.invalidateQueries({ queryKey: ["tipos-colaborador"] });
      qc.invalidateQueries({ queryKey: ["colab-count"] });
      toast.success("Tipo atualizado.");
    },
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Tipo já existe." : mensagemErro(e, "Erro ao editar tipo.")),
  });

  const delType = useMutation({
    mutationFn: async (tab: Tab) => {
      const { count: used } = await supabase
        .from("colaboradores")
        .select("id", { count: "exact", head: true })
        .eq("tipo", tab.tipo);
      if ((used ?? 0) > 0)
        throw new Error(`Há ${used} colaborador(es) nesse tipo. Remova-os antes de excluir o tipo.`);
      const { error } = await supabase.from("tipos_colaborador" as any).delete().eq("id", tab.typeId!);
      if (error) throw error;
    },
    onSuccess: (_d, tab) => {
      setDelTab(null);
      if (selectedKey === tab.key) setSelectedKey(BUILTINS[0].key);
      qc.invalidateQueries({ queryKey: ["tipos-colaborador"] });
      toast.success("Tipo excluído.");
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir tipo.")),
  });

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex items-start gap-3">
        <Users className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Colaboradores</h1>
          <p className="text-sm text-muted-foreground">
            Pessoas envolvidas no processo, organizadas por tipo.
          </p>
        </div>
      </header>

      {/* Mobile selector */}
      <div className="md:hidden flex gap-2">
        <Select value={selectedKey} onValueChange={setSelectedKey}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {tabs.map((t) => (
              <SelectItem key={t.key} value={t.key}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="icon" onClick={openCreate} aria-label="Novo tipo" disabled={readOnly}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex gap-6 rounded-lg border bg-card">
        {/* Sidebar */}
        <aside className="hidden md:block w-60 shrink-0 border-r py-4">
          <div className="flex items-center justify-between px-4 pb-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tipos de Colaborador
            </span>
            {!readOnly && (
              <button
                type="button"
                onClick={openCreate}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Novo tipo"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
          <nav>
            <ul className="space-y-0.5">
              {tabs.map((t) => {
                const active = t.key === selectedKey;
                return (
                  <li key={t.key} className="group flex items-center">
                    <button
                      type="button"
                      onClick={() => setSelectedKey(t.key)}
                      className={cn(
                        "flex-1 text-left px-4 py-1.5 text-sm transition-colors border-l-2",
                        active
                          ? "bg-muted text-foreground font-medium border-primary"
                          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent",
                      )}
                    >
                      {t.label}
                    </button>
                    {t.custom && !readOnly && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEdit(t)}
                          className="px-1 text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-foreground"
                          aria-label={`Editar tipo ${t.label}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDelTab(t)}
                          className="px-2 text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive"
                          aria-label={`Excluir tipo ${t.label}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 border-b pb-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">{selected.config.plural}</h2>
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                {selected.custom
                  ? `Tipo personalizado${selected.categoriaNome ? ` · ${selected.categoriaNome}` : ""}`
                  : "Tipo fixo"}
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {countLoading ? "…" : `${count ?? 0} ${count === 1 ? "item" : "itens"}`}
            </Badge>
          </div>

          <AttributeTab
            key={selected.key}
            config={selected.config}
            onChanged={() => qc.invalidateQueries({ queryKey: ["colab-count", selected.tipo] })}
          />
        </div>
      </div>

      {/* Novo / editar tipo */}
      <Dialog
        open={addOpen}
        onOpenChange={(o) => {
          setAddOpen(o);
          if (!o) { setEditTab(null); setNovoTipo(""); setNovaCategoria(""); }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editTab ? "Editar tipo de colaborador" : "Novo tipo de colaborador"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Nome do tipo</Label>
              <Input
                autoFocus
                placeholder="Ex: Cortador"
                value={novoTipo}
                onChange={(e) => setNovoTipo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitType();
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Categoria de serviço (opcional)</Label>
              <Select value={novaCategoria || "none"} onValueChange={(v) => setNovaCategoria(v === "none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Sem categoria" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem categoria</SelectItem>
                  {categorias.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Usada para filtrar o responsável em serviços internos dessa categoria
                (ex.: Corte). Reaproveita as Categorias de Terceirizado.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button>
            {!readOnly && (
              <Button onClick={submitType} disabled={addType.isPending || editType.isPending}>
                {editTab
                  ? (editType.isPending ? "Salvando…" : "Salvar")
                  : (addType.isPending ? "Criando…" : "Criar")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!delTab} onOpenChange={(o) => !o && setDelTab(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir tipo?</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir o tipo <strong>{delTab?.label}</strong>? Só é possível se não houver
              colaboradores nesse tipo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (delTab) delType.mutate(delTab);
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
