import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Pencil, Trash2, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
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
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { useReadOnly } from "@/components/RequirePermission";
import { useSort, SortHead } from "@/components/shared/sort";

export type UsageRef = { table: string; column: string };

export type ExtraSelect = {
  field: string; // column on this table
  label: string;
  from: string; // table to load options
  optionLabel: string; // column to display
  // PostgREST select das opções (default: `id, ${optionLabel}`). Use p/ trazer um
  // embed do avô e compor o rótulo (ex.: "Grupo › Categoria").
  optionSelect?: string;
  // Compõe o texto exibido de cada opção (default: row[optionLabel]).
  optionLabelFn?: (row: Record<string, any>) => string;
  required?: boolean;
};

export type AttributeTabConfig = {
  table: string;
  nameField: string; // column treated as the "name"
  singular: string; // for messages: "cor", "ano"
  plural: string; // for headers
  usage: UsageRef[];
  extra?: ExtraSelect;
  /** Campo numérico opcional, editável inline (ex.: SLA de oficina em dias, markup). */
  extraNumber?: { field: string; label: string; placeholder?: string; step?: string };
  // Campo enum (select de opções fixas) por linha — ex.: etapa "Até costura"/"Pós costura".
  extraEnum?: { field: string; label: string; options: { value: string; label: string }[] };
  fixedFilter?: { field: string; value: string };
  /** Nomes fixos do sistema (case-insensitive) que NÃO podem ser editados/excluídos. */
  protectedNames?: string[];
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
  const [newExtraNum, setNewExtraNum] = useState<string>("");
  const [newEnum, setNewEnum] = useState<string>("");
  const colCount = 2 + (config.extra ? 1 : 0) + (config.extraNumber ? 1 : 0) + (config.extraEnum ? 1 : 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [deleteUsage, setDeleteUsage] = useState<number | null>(null);

  const listKey = ["attr", config.table, config.fixedFilter?.value ?? ""];

  // Itens fixos do sistema (ex.: Corte/Oficina) — não podem ser renomeados nem
  // excluídos (renomear "Oficina" quebraria a detecção ILIKE 'oficina', e a loja
  // ficaria sem o processo). Espelha os tipos fixos do cadastro de colaboradores.
  const protectedSet = useMemo(
    () => new Set((config.protectedNames ?? []).map((n) => n.toLowerCase())),
    [config.protectedNames],
  );
  const isProtected = (row: Row) => protectedSet.has(String(row[config.nameField] ?? "").toLowerCase());

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

  const extraLabel = (row: Row) =>
    config.extra?.optionLabelFn ? config.extra.optionLabelFn(row) : row[config.extra!.optionLabel];

  const { data: extraOptions = [] } = useQuery({
    queryKey: ["attr-extra", config.extra?.from, config.extra?.optionSelect ?? ""],
    enabled: !!config.extra,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(config.extra!.from as any)
        .select(config.extra!.optionSelect ?? `id, ${config.extra!.optionLabel}`)
        .order(config.extra!.optionLabel);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const extraMap = useMemo(() => {
    const m = new Map<string, string>();
    extraOptions.forEach((o) => m.set(o.id, extraLabel(o)));
    return m;
  }, [extraOptions, config.extra]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      String(r[config.nameField] ?? "").toLowerCase().includes(s),
    );
  }, [rows, search, config.nameField]);

  // Ordenação clicável: por Nome e pelos campos extra/extraNumber quando existirem.
  // A coluna "extra" exibe o rótulo mapeado (extraMap), então ordena por esse valor cru.
  const sortAccessors = useMemo(() => {
    const acc: Record<string, (row: Row) => unknown> = {};
    if (config.extra) {
      const field = config.extra.field;
      acc[field] = (row) => (row[field] ? extraMap.get(row[field]) ?? "" : "");
    }
    return acc;
  }, [config.extra, extraMap]);

  const sortState = useSort(filtered, { key: config.nameField, accessors: sortAccessors });
  const sorted = sortState.sorted;

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
      if (config.extraNumber) {
        const n = newExtraNum.trim().replace(",", ".");
        payload[config.extraNumber.field] = n === "" ? null : Number(n);
      }
      if (config.extraEnum) {
        payload[config.extraEnum.field] = newEnum || config.extraEnum.options[0].value;
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
      setNewExtraNum("");
      setNewEnum("");
      qc.invalidateQueries({ queryKey: listKey });
      onChanged?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao criar.")),
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
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao atualizar.")),
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
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao atualizar.")),
  });

  const updateExtraNumMut = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      if (!config.extraNumber) return;
      const n = value.trim().replace(",", ".");
      const num = n === "" ? null : Number(n);
      const { error } = await supabase
        .from(config.table as any)
        .update({ [config.extraNumber.field]: num })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      onChanged?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao atualizar.")),
  });

  const updateEnumMut = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      if (!config.extraEnum) return;
      const { error } = await supabase
        .from(config.table as any)
        .update({ [config.extraEnum.field]: value })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      onChanged?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao atualizar.")),
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
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
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
        <Button className="max-sm:hidden" onClick={() => setCreateOpen(true)} disabled={readOnly}>
          <Plus className="h-4 w-4 mr-1" />
          Novo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Nome" sortKey={config.nameField} sortState={sortState} />
              {config.extra && (
                <SortHead label={config.extra.label} sortKey={config.extra.field} sortState={sortState} />
              )}
              {config.extraNumber && (
                <SortHead label={config.extraNumber.label} sortKey={config.extraNumber.field} sortState={sortState} className="w-40" />
              )}
              {config.extraEnum && (
                <SortHead label={config.extraEnum.label} sortKey={config.extraEnum.field} sortState={sortState} className="w-44" />
              )}
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">
                  Nenhum {config.singular.toLowerCase()} encontrado.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((row) => (
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
                    ) : isProtected(row) ? (
                      <span className="inline-flex items-center gap-2">
                        {row[config.nameField]}
                        <Badge variant="secondary" className="text-[10px]">fixo</Badge>
                      </span>
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
                              {extraLabel(opt)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                  {config.extraNumber && (
                    <TableCell>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={config.extraNumber.step ?? "0.5"}
                        defaultValue={row[config.extraNumber.field] ?? ""}
                        placeholder={config.extraNumber.placeholder ?? "—"}
                        disabled={readOnly}
                        className="h-8 w-28"
                        onBlur={(e) => {
                          const cur = row[config.extraNumber!.field];
                          const nv = e.target.value.trim();
                          const same = (nv === "" && (cur === null || cur === undefined)) || String(cur ?? "") === nv;
                          if (!same) updateExtraNumMut.mutate({ id: row.id, value: nv });
                        }}
                      />
                    </TableCell>
                  )}
                  {config.extraEnum && (
                    <TableCell>
                      <Select
                        value={String(row[config.extraEnum.field] ?? config.extraEnum.options[0].value)}
                        onValueChange={(v) => updateEnumMut.mutate({ id: row.id, value: v })}
                        disabled={readOnly}
                      >
                        <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {config.extraEnum.options.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    {!isProtected(row) && (
                      <>
                        <Button size="icon" variant="ghost" onClick={() => startEdit(row)} disabled={readOnly}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => startDelete(row)} disabled={readOnly}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
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
                        {extraLabel(opt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {config.extraNumber && (
              <div className="space-y-1.5">
                <Label>{config.extraNumber.label}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={config.extraNumber.step ?? "0.5"}
                  value={newExtraNum}
                  onChange={(e) => setNewExtraNum(e.target.value)}
                  placeholder={config.extraNumber.placeholder}
                />
              </div>
            )}
            {config.extraEnum && (
              <div className="space-y-1.5">
                <Label>{config.extraEnum.label}</Label>
                <Select value={newEnum || config.extraEnum.options[0].value} onValueChange={setNewEnum}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {config.extraEnum.options.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
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

      {/* Mobile: o "+ Novo" desce pra barra fixa, com o nome do atributo selecionado. */}
      <MobileActionBar>
        <Button className="ml-auto" onClick={() => setCreateOpen(true)} disabled={readOnly}>
          <Plus className="h-4 w-4 mr-1" />
          Novo
        </Button>
      </MobileActionBar>
    </div>
  );
}
