import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Pencil, Trash2, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Badge } from "@/components/ui/badge";
import { useReadOnly } from "@/components/RequirePermission";

export type UsageRef = { table: string; column: string };

export type ExtraSelect = {
  field: string; // column on this table
  label: string;
  from: string; // table to load options
  optionLabel: string; // column to display
  required?: boolean;
};

export type AttributeTabConfig = {
  table: string;
  nameField: string; // column treated as the "name"
  singular: string; // for messages: "cor", "ano"
  plural: string; // for headers
  usage: UsageRef[];
  extra?: ExtraSelect;
  fixedFilter?: { field: string; value: string };
};

type Row = Record<string, any>;

export function AttributeTab({
  config,
  onChanged,
}: {
  config: AttributeTabConfig;
  /** Chamado após criar/editar/excluir, p/ o pai atualizar contadores próprios. */
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExtra, setNewExtra] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [deleteUsage, setDeleteUsage] = useState<number | null>(null);

  const listKey = ["attr", config.table, config.fixedFilter?.value ?? ""];

  const { data: rows = [], isLoading } = useQuery({
    queryKey: listKey,
    queryFn: async () => {
      let q = supabase.from(config.table as any).select("*").order(config.nameField);
      if (config.fixedFilter) {
        q = q.eq(config.fixedFilter.field, config.fixedFilter.value);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const { data: extraOptions = [] } = useQuery({
    queryKey: ["attr-extra", config.extra?.from],
    enabled: !!config.extra,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(config.extra!.from as any)
        .select(`id, ${config.extra!.optionLabel}`)
        .order(config.extra!.optionLabel);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const extraMap = useMemo(() => {
    const m = new Map<string, string>();
    extraOptions.forEach((o) => m.set(o.id, o[config.extra!.optionLabel]));
    return m;
  }, [extraOptions, config.extra]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      String(r[config.nameField] ?? "").toLowerCase().includes(s),
    );
  }, [rows, search, config.nameField]);

  const createMut = useMutation({
    mutationFn: async () => {
      const v = newName.trim();
      if (!v) throw new Error("Preencha o nome.");
      const payload: Row = { [config.nameField]: v };
      if (config.extra) {
        if (config.extra.required && !newExtra) {
          throw new Error(`Selecione ${config.extra.label}.`);
        }
        payload[config.extra.field] = newExtra || null;
      }
      if (config.fixedFilter) {
        payload[config.fixedFilter.field] = config.fixedFilter.value;
      }
      const { error } = await supabase.from(config.table as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(`${config.singular} criado.`);
      setCreateOpen(false);
      setNewName("");
      setNewExtra("");
      qc.invalidateQueries({ queryKey: listKey });
      onChanged?.();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao criar."),
  });

  const updateMut = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      const v = value.trim();
      if (!v) throw new Error("Preencha o nome.");
      const { error } = await supabase
        .from(config.table as any)
        .update({ [config.nameField]: v })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Atualizado.");
      setEditingId(null);
      qc.invalidateQueries({ queryKey: listKey });
      onChanged?.();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao atualizar."),
  });

  const updateExtraMut = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      if (!config.extra) return;
      const { error } = await supabase
        .from(config.table as any)
        .update({ [config.extra.field]: value || null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      onChanged?.();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao atualizar."),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(config.table as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Excluído.");
      setDeleteRow(null);
      setDeleteUsage(null);
      qc.invalidateQueries({ queryKey: listKey });
      onChanged?.();
    },
    onError: (e: any) => toast.error(e.message ?? "Erro ao excluir."),
  });

  const startDelete = async (row: Row) => {
    setDeleteRow(row);
    setDeleteUsage(null);
    let total = 0;
    for (const ref of config.usage) {
      const { count } = await supabase
        .from(ref.table as any)
        .select("*", { count: "exact", head: true })
        .eq(ref.column, row.id);
      total += count ?? 0;
    }
    setDeleteUsage(total);
  };

  const startEdit = (row: Row) => {
    setEditingId(row.id);
    setEditValue(String(row[config.nameField] ?? ""));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={`Buscar ${config.plural.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={readOnly}>
          <Plus className="h-4 w-4 mr-1" />
          Novo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              {config.extra && <TableHead>{config.extra.label}</TableHead>}
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={config.extra ? 3 : 2} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={config.extra ? 3 : 2} className="text-center py-8 text-muted-foreground">
                  Nenhum {config.singular.toLowerCase()} encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {editingId === row.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") updateMut.mutate({ id: row.id, value: editValue });
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="h-8"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => updateMut.mutate({ id: row.id, value: editValue })}
                          disabled={updateMut.isPending}
                        >
                          <Check className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setEditingId(null)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-left hover:underline disabled:opacity-100 disabled:cursor-default disabled:no-underline"
                        onClick={() => startEdit(row)}
                        disabled={readOnly}
                      >
                        {row[config.nameField]}
                      </button>
                    )}
                  </TableCell>
                  {config.extra && (
                    <TableCell>
                      <Select
                        value={row[config.extra.field] ?? ""}
                        onValueChange={(v) => updateExtraMut.mutate({ id: row.id, value: v })}
                        disabled={readOnly}
                      >
                        <SelectTrigger className="h-8 w-56">
                          <SelectValue placeholder="—">
                            {row[config.extra.field] ? extraMap.get(row[config.extra.field]) ?? "—" : "—"}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {extraOptions.map((opt) => (
                            <SelectItem key={opt.id} value={opt.id}>
                              {opt[config.extra!.optionLabel]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => startEdit(row)} disabled={readOnly}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => startDelete(row)} disabled={readOnly}>
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

      {/* Create modal */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo {config.singular}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") createMut.mutate();
                }}
              />
            </div>
            {config.extra && (
              <div className="space-y-1.5">
                <Label>
                  {config.extra.label}
                  {config.extra.required && <span className="text-destructive"> *</span>}
                </Label>
                <Select value={newExtra} onValueChange={setNewExtra}>
                  <SelectTrigger>
                    <SelectValue placeholder={`Selecione ${config.extra.label.toLowerCase()}…`} />
                  </SelectTrigger>
                  <SelectContent>
                    {extraOptions.map((opt) => (
                      <SelectItem key={opt.id} value={opt.id}>
                        {opt[config.extra!.optionLabel]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              {createMut.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteRow}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteRow(null);
            setDeleteUsage(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {config.singular}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUsage === null ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verificando uso…
                </span>
              ) : deleteUsage > 0 ? (
                <>
                  Este item está em uso em <strong>{deleteUsage}</strong> registro(s).
                  Deseja excluir mesmo assim?
                </>
              ) : (
                <>
                  Tem certeza que deseja excluir <strong>{deleteRow?.[config.nameField]}</strong>?
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
