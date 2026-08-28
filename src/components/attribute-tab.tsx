import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Pencil, Trash2, Check, X, Loader2, ArrowLeft } from "lucide-react";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { useReadOnly } from "@/components/RequirePermission";
import { useSort, SortHead } from "@/components/shared/sort";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/useAuth";
import { useUnsavedGuard, UnsavedChangesGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";

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
  /** Renderiza a coluna/campo `extra` ANTES do Nome (lista E dialog de criação). Opt-in por atributo. */
  extraFirst?: boolean;
  /** Campo numérico opcional, editável inline (ex.: SLA de oficina em dias, markup). */
  extraNumber?: { field: string; label: string; placeholder?: string; step?: string };
  // Campo enum (select de opções fixas) por linha — ex.: etapa "Até costura"/"Pós costura".
  extraEnum?: { field: string; label: string; options: { value: string; label: string }[] };
  fixedFilter?: { field: string; value: string };
  /** Nomes fixos do sistema (case-insensitive) que NÃO podem ser editados/excluídos. */
  protectedNames?: string[];
  /** Conjunto FIXO (ex.: os 12 meses): não dá pra criar nem excluir, só renomear. */
  fixed?: boolean;
  /** Coluna de ordenação da lista e dos dropdowns (ex.: "ordem"). Default: nameField. */
  orderField?: string;
  /** Toggle booleano por linha (soft-hide). Coluna `field` bool NOT NULL. Ex.: ativo. */
  toggleField?: { field: string; label: string; hint?: string };
};

type Row = Record<string, any>;

export function AttributeTab({
  config,
  onChanged,
  onFilteredCount,
}: {
  config: AttributeTabConfig;
  /** Chamado após criar/editar/excluir, p/ o pai atualizar contadores próprios. */
  onChanged?: () => void;
  /** Reporta a contagem FILTRADA (após busca) — o cabeçalho mostra "X de Y itens". */
  onFilteredCount?: (n: number) => void;
}) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newExtra, setNewExtra] = useState<string>("");
  const [newExtraNum, setNewExtraNum] = useState<string>("");
  const [newEnum, setNewEnum] = useState<string>("");
  const { isAdmin } = useAuth(); // exclusão em massa é só p/ admin+ (tenant_admin ou super_admin)
  // Conjunto fixo (meses): sem criar/excluir/seleção em massa — só renomear.
  const showCheck = isAdmin && !config.fixed;
  const colCount = 2 + (showCheck ? 1 : 0) + (config.extra ? 1 : 0) + (config.extraNumber ? 1 : 0) + (config.extraEnum ? 1 : 0) + (config.toggleField ? 1 : 0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteRow, setDeleteRow] = useState<Row | null>(null);
  const [deleteUsage, setDeleteUsage] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set()); // seleção p/ exclusão em massa
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Guarda de alterações não salvas no diálogo "Novo …"
  const createDirty = createOpen && (newName !== "" || newExtra !== "" || newExtraNum !== "" || newEnum !== "");
  const { requestClose: requestCreateClose, confirm: createConfirm } = useUnsavedGuard({
    dirty: createDirty,
    onClose: () => setCreateOpen(false),
  });

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
      let q = supabase.from(config.table as any).select("*").order(config.orderField ?? config.nameField);
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

  // Reporta a contagem filtrada ao pai (cabeçalho "X de Y itens"). Ref p/ não depender
  // da identidade da callback (evita re-disparo a cada render).
  const onFilteredCountRef = useRef(onFilteredCount);
  onFilteredCountRef.current = onFilteredCount;
  useEffect(() => {
    onFilteredCountRef.current?.(filtered.length);
  }, [filtered.length]);

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
  // Conjunto fixo (meses): ordem cronológica estável pela coluna `orderField`, ignorando o
  // clique de ordenação — a listagem tem que sair sempre na ordem certa.
  const sorted = config.fixed && config.orderField
    ? [...filtered].sort((a, b) => Number(a[config.orderField!] ?? 0) - Number(b[config.orderField!] ?? 0))
    : sortState.sorted;

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
        const num = n === "" ? null : Number(n);
        if (num !== null && num < 0) throw new Error("O valor não pode ser negativo.");
        payload[config.extraNumber.field] = num;
      }
      if (config.extraEnum) {
        payload[config.extraEnum.field] = newEnum || config.extraEnum.options[0].value;
      }
      if (config.fixedFilter) {
        payload[config.fixedFilter.field] = config.fixedFilter.value;
      }
      // Semeia a ordem (senão cai no default 0 e a lista fica não-determinística):
      // próxima = maior ordem do tenant + 1.
      if (config.orderField) {
        const next = rows.reduce((mx, r) => Math.max(mx, Number(r[config.orderField!] ?? 0)), -1) + 1;
        payload[config.orderField] = next;
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
      const { data, error } = await supabase
        .from(config.table as any)
        .update({ [config.nameField]: v })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      // 0 linhas = RLS bloqueou (sem erro) → não minta "Atualizado".
      if (!data?.length) throw new Error("Sem permissão para editar este item.");
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
      const { data, error } = await supabase
        .from(config.table as any)
        .update({ [config.extra.field]: value || null })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Sem permissão para editar este item.");
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
      if (num !== null && num < 0) throw new Error("O valor não pode ser negativo.");
      const { data, error } = await supabase
        .from(config.table as any)
        .update({ [config.extraNumber.field]: num })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Sem permissão para editar este item.");
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
      const { data, error } = await supabase
        .from(config.table as any)
        .update({ [config.extraEnum.field]: value })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Sem permissão para editar este item.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      onChanged?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao atualizar.")),
  });

  const updateToggleMut = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      if (!config.toggleField) return;
      const { data, error } = await supabase
        .from(config.table as any)
        .update({ [config.toggleField.field]: value })
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) throw new Error("Sem permissão para editar este item.");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      onChanged?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao alterar")),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.from(config.table as any).delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Sem permissão para excluir este item.");
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
      const { count, error } = await supabase
        .from(ref.table as any)
        .select("*", { count: "exact", head: true })
        .eq(ref.column, row.id);
      // Não conseguiu verificar (tabela/rede) → trata como "em uso" p/ não apagar às cegas.
      total += error ? 1 : (count ?? 0);
    }
    setDeleteUsage(total);
  };

  // Exclusão em MASSA: só linhas não-protegidas; pula as em uso (conta config.usage) e reporta.
  const selectableIds = useMemo(() => sorted.filter((r) => !isProtected(r)).map((r) => r.id), [sorted, protectedSet]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));
  const toggleOne = (id: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const bulkDelete = async () => {
    setBulkBusy(true);
    let ok = 0, emUso = 0;
    for (const id of Array.from(selected)) {
      let usage = 0;
      for (const ref of config.usage) {
        const { count, error } = await supabase.from(ref.table as any).select("*", { count: "exact", head: true }).eq(ref.column, id);
        usage += error ? 1 : (count ?? 0);
      }
      if (usage > 0) { emUso++; continue; }
      // .select() p/ saber se realmente apagou: 0 linhas = RLS bloqueou (sem erro).
      const { data, error } = await supabase.from(config.table as any).delete().eq("id", id).select("id");
      if (error || !data?.length) { emUso++; continue; }
      ok++;
    }
    setBulkBusy(false);
    setBulkOpen(false);
    setSelected(new Set());
    qc.invalidateQueries({ queryKey: listKey });
    onChanged?.();
    if (ok > 0) toast.success(`${ok} excluído(s).${emUso > 0 ? ` ${emUso} em uso (não excluído(s)).` : ""}`);
    else toast.error(`Nenhum excluído${emUso > 0 ? ` — ${emUso} em uso` : ""}.`);
  };

  const startEdit = (row: Row) => {
    setEditingId(row.id);
    setEditValue(String(row[config.nameField] ?? ""));
  };

  // Sheet de edição mobile (lápis do card): TODOS os campos editáveis num único
  // formulário, save = 1 UPDATE atômico (desktop continua com edição inline por campo).
  const [sheetRow, setSheetRow] = useState<Row | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [sheetExtra, setSheetExtra] = useState("");
  const [sheetNum, setSheetNum] = useState("");
  const [sheetEnum, setSheetEnum] = useState("");
  const [sheetAtivo, setSheetAtivo] = useState(true);
  const openEditSheet = (row: Row) => {
    setSheetRow(row);
    setSheetName(String(row[config.nameField] ?? ""));
    setSheetExtra(config.extra ? (row[config.extra.field] ?? "") : "");
    setSheetNum(config.extraNumber && row[config.extraNumber.field] != null ? String(row[config.extraNumber.field]) : "");
    setSheetEnum(config.extraEnum ? String(row[config.extraEnum.field] ?? config.extraEnum.options[0].value) : "");
    setSheetAtivo(config.toggleField ? row[config.toggleField.field] !== false : true);
  };

  const sheetDirty = !!sheetRow && (
    sheetName !== String(sheetRow[config.nameField] ?? "") ||
    (!!config.extra && (sheetExtra || "") !== (sheetRow[config.extra.field] ?? "")) ||
    (!!config.extraNumber && sheetNum !== (sheetRow[config.extraNumber.field] != null ? String(sheetRow[config.extraNumber.field]) : "")) ||
    (!!config.extraEnum && sheetEnum !== String(sheetRow[config.extraEnum.field] ?? config.extraEnum.options[0].value)) ||
    (!!config.toggleField && sheetAtivo !== (sheetRow[config.toggleField.field] !== false))
  );
  const { requestClose: requestSheetClose, confirm: sheetConfirm } = useUnsavedGuard({
    dirty: sheetDirty,
    onClose: () => setSheetRow(null),
  });

  const sheetSaveMut = useMutation({
    mutationFn: async () => {
      if (!sheetRow) return;
      const v = sheetName.trim();
      if (!v) throw new Error("Preencha o nome.");
      const payload: Row = { [config.nameField]: v };
      if (config.extra) {
        if (config.extra.required && !sheetExtra) throw new Error(`Selecione ${config.extra.label}.`);
        payload[config.extra.field] = sheetExtra || null;
      }
      if (config.extraNumber) {
        const n = sheetNum.trim().replace(",", ".");
        const num = n === "" ? null : Number(n);
        if (num !== null && num < 0) throw new Error("O valor não pode ser negativo.");
        payload[config.extraNumber.field] = num;
      }
      if (config.extraEnum) payload[config.extraEnum.field] = sheetEnum || config.extraEnum.options[0].value;
      if (config.toggleField) payload[config.toggleField.field] = sheetAtivo;
      const { data, error } = await supabase.from(config.table as any).update(payload).eq("id", sheetRow.id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Sem permissão para editar este item.");
    },
    onSuccess: () => {
      toast.success("Atualizado.");
      setSheetRow(null);
      qc.invalidateQueries({ queryKey: listKey });
      onChanged?.();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao atualizar.")),
  });

  // Campo `extra` do dialog "Novo" — hoisted p/ poder ser renderizado antes OU depois
  // do Nome conforme `config.extraFirst` (mesmo conteúdo, só muda a posição).
  const extraField = config.extra && (
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
  );

  // Mesmo campo `extra`, versão do Sheet de edição mobile (sheetExtra/setSheetExtra).
  const sheetExtraField = config.extra && (
    <div className="space-y-1.5">
      <Label>
        {config.extra.label}
        {config.extra.required && <span className="text-destructive"> *</span>}
      </Label>
      <Select value={sheetExtra} onValueChange={setSheetExtra}>
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
  );

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
        {showCheck && selected.size > 0 && !readOnly && (
          <Button variant="destructive" onClick={() => setBulkOpen(true)}>
            <Trash2 className="h-4 w-4 mr-1" /> Excluir ({selected.size})
          </Button>
        )}
        {!config.fixed && (
          <Button className="max-sm:hidden" onClick={() => setCreateOpen(true)} disabled={readOnly}>
            <Plus className="h-4 w-4 mr-1" />
            Novo
          </Button>
        )}
      </div>

      <div className="rounded-lg border">
        <Table className="card-table card-table-atrib">
          <TableHeader>
            <TableRow>
              {showCheck && (
                <TableHead className="w-10">
                  {selectableIds.length > 0 && !readOnly && (
                    <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Selecionar todos" />
                  )}
                </TableHead>
              )}
              {config.extraFirst && config.extra && (
                <SortHead label={config.extra.label} sortKey={config.extra.field} sortState={sortState} className="w-64" />
              )}
              {config.fixed ? (
                <TableHead>Nome</TableHead>
              ) : (
                <SortHead label="Nome" sortKey={config.nameField} sortState={sortState} />
              )}
              {!config.extraFirst && config.extra && (
                <SortHead label={config.extra.label} sortKey={config.extra.field} sortState={sortState} className="w-64" />
              )}
              {config.extraNumber && (
                <SortHead label={config.extraNumber.label} sortKey={config.extraNumber.field} sortState={sortState} className="w-40" />
              )}
              {config.extraEnum && (
                <SortHead label={config.extraEnum.label} sortKey={config.extraEnum.field} sortState={sortState} className="w-44" />
              )}
              {config.toggleField && (
                <TableHead className="w-32">{config.toggleField.label}</TableHead>
              )}
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell data-label="card" colSpan={colCount} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell data-label="card" colSpan={colCount} className="text-center py-8 text-muted-foreground">
                  Nenhum {config.singular.toLowerCase()} encontrado.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((row) => {
                const extraCell = config.extra && (
                  <TableCell className="w-64">
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
                );
                // Sublinha do card mobile: Grupo/valores extra concatenados (§ plano 3.4).
                const subParts: string[] = [];
                if (config.extra && row[config.extra.field])
                  subParts.push(extraMap.get(row[config.extra.field]) ?? "—");
                if (config.extraEnum) {
                  const opt = config.extraEnum.options.find(
                    (o) => o.value === String(row[config.extraEnum!.field] ?? config.extraEnum!.options[0].value),
                  );
                  if (opt) subParts.push(opt.label);
                }
                if (config.extraNumber && row[config.extraNumber.field] != null && row[config.extraNumber.field] !== "")
                  subParts.push(`${config.extraNumber.label}: ${String(row[config.extraNumber.field]).replace(".", ",")}`);
                const sublinha = subParts.join(" · ");
                return (
                <TableRow key={row.id} data-state={selected.has(row.id) ? "selected" : undefined}>
                  {/* MOBILE: card de leitura — .card-table-atrib esconde as demais td; editar = lápis → Sheet */}
                  <TableCell data-label="card" className="md:hidden">
                    <div className="flex items-center gap-1">
                      {showCheck && (
                        <span
                          className="-ml-2 flex h-11 w-9 shrink-0 items-center justify-center"
                          onClick={() => { if (!isProtected(row) && !readOnly) toggleOne(row.id); }}
                        >
                          {!isProtected(row) && !readOnly && (
                            <Checkbox
                              checked={selected.has(row.id)}
                              onCheckedChange={() => toggleOne(row.id)}
                              onClick={(e) => e.stopPropagation()}
                              aria-label="Selecionar"
                            />
                          )}
                        </span>
                      )}
                      <div className="min-w-0 flex-1 py-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">{row[config.nameField]}</span>
                          {isProtected(row) && (
                            <Badge variant="secondary" className="shrink-0 text-[10px]">fixo</Badge>
                          )}
                          {config.toggleField && row[config.toggleField.field] === false && (
                            <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">Inativo</Badge>
                          )}
                        </div>
                        {/* Altura reservada p/ até 2 linhas (min-h) mesmo sem sublinha ou com só 1 linha —
                            todos os cards da MESMA lista saem com a mesma altura (uniformidade visual). */}
                        <div className="line-clamp-2 min-h-[2rem] text-xs leading-4 text-muted-foreground">
                          {sublinha}
                        </div>
                      </div>
                      {!isProtected(row) && (
                        <div className="flex shrink-0 items-center">
                          <Button size="icon" variant="ghost" aria-label="Editar"
                            onClick={() => openEditSheet(row)} disabled={readOnly}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {!config.fixed && (
                            <Button size="icon" variant="ghost" aria-label="Excluir"
                              onClick={() => startDelete(row)} disabled={readOnly}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  {showCheck && (
                    <TableCell className="w-10">
                      {!isProtected(row) && !readOnly && (
                        <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggleOne(row.id)} aria-label="Selecionar" />
                      )}
                    </TableCell>
                  )}
                  {config.extraFirst && extraCell}
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
                          className="h-8 max-md:h-11"
                        />
                        <Button
                          size="iconSm"
                          variant="ghost"
                          onClick={() => updateMut.mutate({ id: row.id, value: editValue })}
                          disabled={updateMut.isPending}
                        >
                          <Check className="h-4 w-4 text-green-600" />
                        </Button>
                        <Button size="iconSm" variant="ghost" onClick={() => setEditingId(null)}>
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
                  {!config.extraFirst && extraCell}
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
                  {config.toggleField && (
                    <TableCell>
                      <div className="flex items-center gap-2" title={config.toggleField.hint}>
                        <Switch
                          checked={row[config.toggleField.field] !== false}
                          onCheckedChange={(v) => updateToggleMut.mutate({ id: row.id, value: v })}
                          aria-label={config.toggleField.label}
                          disabled={readOnly || updateToggleMut.isPending}
                        />
                        <span className="text-xs text-muted-foreground">
                          {row[config.toggleField.field] !== false ? "Ativo" : "Inativo"}
                        </span>
                      </div>
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    {!isProtected(row) && (
                      <>
                        <Button size="iconSm" variant="ghost" onClick={() => startEdit(row)} disabled={readOnly}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {!config.fixed && (
                          <Button size="iconSm" variant="ghost" onClick={() => startDelete(row)} disabled={readOnly}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </>
                    )}
                  </TableCell>
                </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create modal */}
      <UnsavedChangesGuard confirm={createConfirm} message="Há dados não salvos no formulário de criação." />
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) requestCreateClose(); else setCreateOpen(true); }}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>Novo {config.singular}</DialogTitle>
              <UnsavedIndicator show={createDirty} className="ml-auto shrink-0" />
            </div>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {config.extraFirst && extraField}
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
            {!config.extraFirst && extraField}
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
            <Button variant="outline" onClick={requestCreateClose}>
              <ArrowLeft className="h-4 w-4 mr-1" />Voltar
            </Button>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              {createMut.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sheet de edição mobile (lápis do card de leitura) */}
      {sheetRow && (
        <Sheet open onOpenChange={(o) => { if (!o) requestSheetClose(); }}>
          <SheetContent side="right" size="editor" className="flex flex-col gap-0 p-0">
            <SheetHeader className="border-b p-4">
              <div className="flex items-center gap-2">
                <SheetTitle>Editar {config.singular}</SheetTitle>
                <UnsavedIndicator show={sheetDirty} className="ml-auto shrink-0" />
              </div>
              <SheetDescription className="sr-only">
                Editar os campos de {config.singular.toLowerCase()}.
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {config.extraFirst && config.extra && sheetExtraField}
              <div className="space-y-1.5">
                <Label>Nome</Label>
                <Input autoFocus value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
              </div>
              {!config.extraFirst && config.extra && sheetExtraField}
              {config.extraNumber && (
                <div className="space-y-1.5">
                  <Label>{config.extraNumber.label}</Label>
                  <Input type="number" inputMode="decimal" min={0} step={config.extraNumber.step ?? "0.5"}
                    value={sheetNum} onChange={(e) => setSheetNum(e.target.value)}
                    placeholder={config.extraNumber.placeholder} />
                </div>
              )}
              {config.extraEnum && (
                <div className="space-y-1.5">
                  <Label>{config.extraEnum.label}</Label>
                  <Select value={sheetEnum} onValueChange={setSheetEnum}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {config.extraEnum.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {config.toggleField && (
                <div className="flex items-center gap-2 pt-1" title={config.toggleField.hint}>
                  <Switch checked={sheetAtivo} onCheckedChange={setSheetAtivo} aria-label={config.toggleField.label} />
                  <span className="text-sm">{sheetAtivo ? "Ativo" : "Inativo"}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 border-t p-4">
              <Button variant="outline" onClick={requestSheetClose}>
                <ArrowLeft className="h-4 w-4 mr-1" />Voltar
              </Button>
              <Button className="ml-auto" onClick={() => sheetSaveMut.mutate()} disabled={sheetSaveMut.isPending}>
                {sheetSaveMut.isPending ? "Salvando…" : "Salvar"}
              </Button>
            </div>
            <UnsavedChangesGuard confirm={sheetConfirm} message="Há alterações não salvas." />
          </SheetContent>
        </Sheet>
      )}

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
                  Remova os vínculos antes de excluir.
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
              disabled={deleteUsage === null || (deleteUsage ?? 0) > 0 || deleteMut.isPending}
              variant="destructive"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Exclusão em massa (só admin — ver gate no render da coluna/checkbox). */}
      <AlertDialog open={bulkOpen} onOpenChange={(o) => { if (!o && !bulkBusy) setBulkOpen(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {selected.size} selecionado(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              Itens EM USO em outros registros são pulados (não excluídos). Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkBusy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); bulkDelete(); }}
              disabled={bulkBusy}
              variant="destructive"
            >
              {bulkBusy ? "Excluindo…" : `Excluir ${selected.size}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mobile: o "+ Novo" desce pra barra fixa, com o nome do atributo selecionado. */}
      {!config.fixed && (
        <MobileActionBar>
          <Button className="ml-auto" onClick={() => setCreateOpen(true)} disabled={readOnly}>
            <Plus className="h-4 w-4 mr-1" />
            Novo
          </Button>
        </MobileActionBar>
      )}
    </div>
  );
}
