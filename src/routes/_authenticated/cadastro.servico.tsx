import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Wrench,
  Search,
  Plus,
  Pencil,
  Trash2,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { formatCNPJ } from "@/lib/format";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronsUpDown } from "lucide-react";
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

import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { useSort, SortHead } from "@/components/shared/sort";
export const Route = createFileRoute("/_authenticated/cadastro/servico")({
  component: () => (
    <RequirePermission page="cadastro_servico">
      <ServicoPage />
    </RequirePermission>
  ),
});

// Empresas agora englobam material E serviço (reestrutura "serviço vira empresa"):
// um GATILHO no banco espelha empresa(servico) → terceirizados. O front SÓ mexe em
// empresas / empresa_categorias_servico / empresa_categorias_fornecedor.


type SectionKey = "empresa" | "representante";

const SECTIONS: {
  value: SectionKey;
  label: string;
  table: string;
  plural: string;
}[] = [
  { value: "empresa", label: "Empresa", table: "empresas", plural: "Empresas" },
  { value: "representante", label: "Representante", table: "representantes", plural: "Representantes" },
];

function useItemCount(table: string) {
  return useQuery({
    queryKey: ["servico-count", table],
    queryFn: async () => {
      const { count, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(table as any)
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });
}

/** Reporta ao pai a contagem filtrada (cabeçalho "X de Y itens"), ref-estável (não
 *  re-dispara a cada render). Usado pelos 3 sub-componentes de lista. */
function useReportFiltered(n: number, cb?: (n: number) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => {
    ref.current?.(n);
  }, [n]);
}

function ServicoPage() {
  const visibleSections = SECTIONS;
  const [selected, setSelected] = useState<SectionKey>("empresa");
  const selectedSection =
    visibleSections.find((s) => s.value === selected) ?? visibleSections[0];

  const { data: count, isLoading: countLoading } = useItemCount(
    selectedSection.table
  );
  // Contagem FILTRADA (busca) reportada pelo sub-componente; reseta ao trocar de seção.
  const [filteredN, setFilteredN] = useState<number | null>(null);
  useEffect(() => setFilteredN(null), [selected]);

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex items-start gap-3">
        <Wrench className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Fornecedores</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Empresas (material e serviço) e representantes.
          </p>
        </div>
      </header>

      {/* Mobile selector */}
      <div className="md:hidden">
        <Select value={selected} onValueChange={(v) => setSelected(v as SectionKey)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {visibleSections.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-6 rounded-lg border bg-card">
        {/* Sidebar */}
        <aside className="hidden md:block w-60 shrink-0 border-r py-4">
          <nav className="space-y-0.5">
            {visibleSections.map((s) => {
              const active = s.value === selected;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSelected(s.value)}
                  className={cn(
                    "w-full text-left px-4 py-1.5 text-sm transition-colors border-l-2",
                    active
                      ? "bg-muted text-foreground font-medium border-primary"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border-transparent"
                  )}
                >
                  {s.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 border-b pb-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold truncate">
                {selectedSection.plural}
              </h2>
            </div>
            <Badge variant="secondary" className="shrink-0">
              {countLoading
                ? "…"
                : `${filteredN ?? count ?? 0} de ${count ?? 0} ${(count ?? 0) === 1 ? selectedSection.label.toLowerCase() : selectedSection.plural.toLowerCase()}`}
            </Badge>
          </div>

          {selected === "empresa" && <EmpresasMultiCatTab onFilteredCount={setFilteredN} />}
          {selected === "representante" && <RepresentantesTab onFilteredCount={setFilteredN} />}
        </div>
      </div>
    </div>
  );
}

// ============ Representantes ============

type Representante = {
  id: string;
  empresa_id: string | null;
  nome: string;
  cnpj: string | null;
  razao_social: string | null;
  logradouro: string | null;
  cep: string | null;
  municipio: string | null;
  uf: string | null;
  telefone: string | null;
  email: string | null;
  situacao_cadastral: string | null;
  contato: string | null;
  observacoes: string | null;
};

type Empresa = { id: string; nome_fantasia: string; tipo?: string };

const emptyForm = {
  id: null as string | null,
  empresa_id: "",
  nome: "",
  cnpj: "",
  razao_social: "",
  logradouro: "",
  cep: "",
  municipio: "",
  uf: "",
  telefone: "",
  email: "",
  situacao_cadastral: "",
  contato: "",
  observacoes: "",
  novaEmpresa: "",
  novaEmpresaCategorias: [] as string[],
  modoNovaEmpresa: false,
};

function cleanCnpj(v: string) {
  return v.replace(/\D/g, "");
}

// Situação cadastral "saudável" = ATIVA (Receita). Qualquer outra (BAIXADA, INAPTA,
// SUSPENSA, NULA) merece alerta antes de operar com o fornecedor.
function isSituacaoAtiva(s: string | null | undefined) {
  return (s ?? "").toUpperCase().includes("ATIV");
}

// ============ Campos fiscais compartilhados (Representante × Empresa) ============

/** Subconjunto dos campos fiscais preenchidos por CNPJ, compartilhado entre o
 *  editor de Representante e o de Empresa. */
type FiscalFields = {
  cnpj: string;
  razao_social: string;
  logradouro: string;
  cep: string;
  municipio: string;
  uf: string;
  telefone: string;
  email: string;
  situacao_cadastral: string;
  contato: string;
  observacoes: string;
};

/** Busca dados na BrasilAPI (Receita) e devolve os campos fiscais preenchidos,
 *  mantendo os valores atuais (`prev`) quando a API não trouxer o campo. */
async function lookupCnpjFields(cnpjRaw: string, prev: FiscalFields): Promise<FiscalFields> {
  const cnpj = cleanCnpj(cnpjRaw);
  if (cnpj.length !== 14) throw new Error("CNPJ deve ter 14 dígitos.");
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (!res.ok) throw new Error("CNPJ não encontrado.");
  const data = await res.json();
  // Rua/número/bairro vão no "logradouro"; CEP/município/UF em campos próprios.
  const ruaParts = [data.logradouro, data.numero, data.complemento, data.bairro].filter(Boolean);
  // Telefone da empresa: ddd_telefone_1 vem como dígitos (ex.: "1140044828").
  const telBruto = String(data.ddd_telefone_1 ?? "").replace(/\D/g, "");
  const telFmt = telBruto.length >= 10
    ? `(${telBruto.slice(0, 2)}) ${telBruto.slice(2, telBruto.length - 4)}-${telBruto.slice(-4)}`
    : telBruto;
  return {
    ...prev,
    razao_social: data.razao_social ?? data.nome ?? prev.razao_social,
    logradouro: ruaParts.join(", ") || prev.logradouro,
    cep: (data.cep ? String(data.cep).replace(/\D/g, "").replace(/^(\d{5})(\d)/, "$1-$2") : "") || prev.cep,
    municipio: data.municipio ?? prev.municipio,
    uf: data.uf ?? prev.uf,
    telefone: telFmt || prev.telefone,
    email: (data.email ?? "").toLowerCase() || prev.email,
    situacao_cadastral: data.descricao_situacao_cadastral ?? data.situacao_cadastral ?? prev.situacao_cadastral,
  };
}

/** Campos fiscais reutilizados no editor de Representante e de Empresa: CNPJ +
 *  botão "Buscar" (Receita via BrasilAPI), razão social, situação cadastral (badge),
 *  endereço, contato e observações. O `nomeSlot` permite ao chamador injetar o campo
 *  de nome (representante/empresa) ao lado do CNPJ na mesma grade. */
function EmpresaFiscalFields({
  value,
  onChange,
  nomeSlot,
}: {
  value: FiscalFields;
  onChange: (patch: Partial<FiscalFields>) => void;
  nomeSlot?: ReactNode;
}) {
  const [lookupLoading, setLookupLoading] = useState(false);

  const doLookup = async () => {
    setLookupLoading(true);
    try {
      const next = await lookupCnpjFields(value.cnpj, value);
      onChange(next);
      toast.success("Dados preenchidos.");
    } catch (e: any) {
      toast.error(mensagemErro(e, "Erro ao buscar CNPJ."));
    } finally {
      setLookupLoading(false);
    }
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>CNPJ</Label>
        <div className="flex gap-2">
          <Input
            value={formatCNPJ(value.cnpj)}
            onChange={(e) => onChange({ cnpj: cleanCnpj(e.target.value) })}
            placeholder="00.000.000/0000-00"
          />
          <Button
            type="button"
            variant="secondary"
            className="shrink-0"
            onClick={doLookup}
            disabled={lookupLoading}
            title="Buscar dados da empresa pelo CNPJ (Receita)"
          >
            {lookupLoading ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Search className="h-4 w-4 mr-1" />
            )}
            {lookupLoading ? "Buscando…" : "Buscar"}
          </Button>
        </div>
      </div>
      {nomeSlot}
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Razão Social</Label>
        <Input
          value={value.razao_social}
          onChange={(e) => onChange({ razao_social: e.target.value })}
        />
      </div>
      {value.situacao_cadastral && (
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Situação cadastral</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={isSituacaoAtiva(value.situacao_cadastral)
              ? "bg-emerald-500 hover:bg-emerald-500"
              : "bg-red-500 hover:bg-red-500"}>
              {value.situacao_cadastral}
            </Badge>
            {!isSituacaoAtiva(value.situacao_cadastral) && (
              <span className="text-xs text-red-600">
                Empresa não está ATIVA na Receita — confira antes de operar.
              </span>
            )}
          </div>
        </div>
      )}
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Logradouro</Label>
        <Input
          value={value.logradouro}
          onChange={(e) => onChange({ logradouro: e.target.value })}
          placeholder="Rua, número, bairro"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <div className="grid grid-cols-[1.2fr_2fr_0.8fr] gap-2">
          <div className="space-y-1.5">
            <Label>CEP</Label>
            <Input value={value.cep} onChange={(e) => onChange({ cep: e.target.value })} placeholder="00000-000" />
          </div>
          <div className="space-y-1.5">
            <Label>Município</Label>
            <Input value={value.municipio} onChange={(e) => onChange({ municipio: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>UF</Label>
            <Input value={value.uf} onChange={(e) => onChange({ uf: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} />
          </div>
        </div>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Telefone da empresa</Label>
            <Input value={value.telefone} onChange={(e) => onChange({ telefone: e.target.value })} placeholder="(00) 0000-0000" />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail da empresa</Label>
            <Input type="email" value={value.email} onChange={(e) => onChange({ email: e.target.value })} placeholder="empresa@dominio.com" />
          </div>
        </div>
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Contato</Label>
        <Input
          value={value.contato}
          onChange={(e) => onChange({ contato: e.target.value })}
          placeholder="Pessoa de contato, telefone, e-mail…"
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Observações</Label>
        <Textarea
          rows={3}
          value={value.observacoes}
          onChange={(e) => onChange({ observacoes: e.target.value })}
        />
      </div>
    </div>
  );
}

function RepresentantesTab({ onFilteredCount }: { onFilteredCount?: (n: number) => void }) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [open, setOpen] = useState(false);
  const [deleteRow, setDeleteRow] = useState<Representante | null>(null);
  const [deleteUsage, setDeleteUsage] = useState<number | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["representantes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("representantes")
        .select("*")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as Representante[];
    },
  });

  const { data: empresas = [] } = useQuery({
    queryKey: ["empresas-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome_fantasia, tipo")
        .order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as Empresa[];
    },
  });

  const { data: catsFornecedor = [] } = useQuery({
    queryKey: ["cat-fornecedor-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_fornecedor")
        .select("id, nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as { id: string; nome: string }[];
    },
  });

  const empresasMap = useMemo(() => {
    const m = new Map<string, string>();
    empresas.forEach((e) => m.set(e.id, e.nome_fantasia));
    return m;
  }, [empresas]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      [r.nome, r.contato, r.cnpj, r.empresa_id ? empresasMap.get(r.empresa_id) : ""]
        .map((x) => String(x ?? "").toLowerCase())
        .some((x) => x.includes(s)),
    );
  }, [rows, search, empresasMap]);
  useReportFiltered(filtered.length, onFilteredCount);

  const sort = useSort(filtered, {
    key: "nome",
    accessors: {
      empresa: (r: Representante) =>
        r.empresa_id ? empresasMap.get(r.empresa_id) ?? "" : "",
    },
  });

  const openCreate = () => {
    setForm(emptyForm);
    setOpen(true);
  };

  const openEdit = (r: Representante) => {
    setForm({
      id: r.id,
      empresa_id: r.empresa_id ?? "",
      nome: r.nome ?? "",
      cnpj: r.cnpj ?? "",
      razao_social: r.razao_social ?? "",
      logradouro: r.logradouro ?? "",
      cep: r.cep ?? "",
      municipio: r.municipio ?? "",
      uf: r.uf ?? "",
      telefone: r.telefone ?? "",
      email: r.email ?? "",
      situacao_cadastral: r.situacao_cadastral ?? "",
      contato: r.contato ?? "",
      observacoes: r.observacoes ?? "",
      novaEmpresa: "",
      novaEmpresaCategorias: [],
      modoNovaEmpresa: false,
    });
    setOpen(true);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form.nome.trim()) throw new Error("Informe o nome do representante.");

      let empresaId: string | null = form.empresa_id || null;

      if (form.modoNovaEmpresa) {
        const nome = form.novaEmpresa.trim();
        if (!nome) throw new Error("Informe o nome da nova empresa.");
        if (form.novaEmpresaCategorias.length === 0)
          throw new Error("Selecione ao menos uma categoria do fornecedor.");
        // Cria a empresa (material) + categorias atomicamente via RPC.
        const { data: newId, error: errE } = await supabase.rpc("set_empresa_categorias" as any, {
          _empresa: { tipo: "material", nome_fantasia: nome },
          _cats: form.novaEmpresaCategorias,
        });
        if (errE) throw errE;
        empresaId = newId as string;
      }

      const payload = {
        empresa_id: empresaId,
        nome: form.nome.trim(),
        cnpj: form.cnpj ? cleanCnpj(form.cnpj) : null,
        razao_social: form.razao_social || null,
        logradouro: form.logradouro || null,
        cep: form.cep || null,
        municipio: form.municipio || null,
        uf: form.uf || null,
        telefone: form.telefone || null,
        email: form.email || null,
        situacao_cadastral: form.situacao_cadastral || null,
        contato: form.contato || null,
        observacoes: form.observacoes || null,
      };

      if (form.id) {
        const { error } = await supabase
          .from("representantes")
          .update(payload)
          .eq("id", form.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("representantes").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(form.id ? "Representante atualizado." : "Representante criado.");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["representantes"] });
      qc.invalidateQueries({ queryKey: ["empresas-options"] });
      qc.invalidateQueries({ queryKey: ["attr", "empresas", ""] });
      qc.invalidateQueries({ queryKey: ["servico-count", "representantes"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar.")),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("representantes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Excluído.");
      setDeleteRow(null);
      qc.invalidateQueries({ queryKey: ["representantes"] });
      qc.invalidateQueries({ queryKey: ["servico-count", "representantes"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  // Antes de excluir, conta uso do representante nos pedidos (FK NO ACTION → excluir em
  // uso daria erro cru; melhor bloquear e avisar, como no editor de Empresa).
  const startDelete = async (row: Representante) => {
    setDeleteRow(row);
    setDeleteUsage(null);
    const refs = [
      { table: "ocs_tecido", column: "representante_id" },
      { table: "ocs_aviamento", column: "representante_id" },
      { table: "producao_terceirizados", column: "representante_id" },
    ] as const;
    let total = 0;
    for (const r of refs) {
      const { count } = await supabase
        .from(r.table as any)
        .select("*", { count: "exact", head: true })
        .eq(r.column, row.id);
      total += count ?? 0;
    }
    setDeleteUsage(total);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar representantes…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate} disabled={readOnly} className="max-sm:hidden">
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table className="card-table">
          <TableHeader>
            <TableRow>
              <SortHead label="Empresa" sortKey="empresa" sortState={sort} />
              <SortHead label="Representante" sortKey="nome" sortState={sort} />
              <SortHead label="Contato" sortKey="contato" sortState={sort} />
              <SortHead label="CNPJ" sortKey="cnpj" sortState={sort} />
              <TableHead className="w-28 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  Nenhum representante encontrado.
                </TableCell>
              </TableRow>
            ) : (
              sort.sorted.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.empresa_id ? empresasMap.get(r.empresa_id) ?? "—" : "—"}</TableCell>
                  <TableCell data-label="Representante">
                    <button
                      className="text-left hover:underline"
                      onClick={() => openEdit(r)}
                    >
                      {r.nome}
                    </button>
                  </TableCell>
                  <TableCell data-label="Contato">{r.contato ?? "—"}</TableCell>
                  <TableCell data-label="CNPJ">{r.cnpj ? formatCNPJ(r.cnpj) : "—"}</TableCell>
                  <TableCell data-label="Ações" className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(r)} aria-label="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => startDelete(r)} disabled={readOnly} aria-label="Excluir">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>


      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!grid-rows-[auto_minmax(0,1fr)_auto] max-sm:!overflow-hidden">
          <DialogHeader className="max-sm:shrink-0">
            <DialogTitle>{form.id ? "Editar representante" : "Novo representante"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2 max-sm:min-h-0 max-sm:overflow-y-auto">
            <div className="space-y-1.5">
              <Label>Empresa</Label>
              <div className="flex gap-2">
                {!form.modoNovaEmpresa ? (
                  <>
                    <Select
                      value={form.empresa_id}
                      onValueChange={(v) => setForm({ ...form, empresa_id: v })}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Selecione uma empresa…" />
                      </SelectTrigger>
                      <SelectContent>
                        {empresas.map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.nome_fantasia}
                            {e.tipo === "servico" ? " (Serviço)" : e.tipo === "material" ? " (Material)" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setForm({ ...form, modoNovaEmpresa: true, empresa_id: "" })}
                    >
                      <Plus className="h-4 w-4 mr-1" /> Nova
                    </Button>
                  </>
                ) : (
                  <div className="grid gap-2 flex-1 sm:grid-cols-2">
                    <Input
                      placeholder="Nome fantasia"
                      value={form.novaEmpresa}
                      onChange={(e) => setForm({ ...form, novaEmpresa: e.target.value })}
                    />
                    <CategoriasMultiSelect
                      options={catsFornecedor}
                      value={form.novaEmpresaCategorias}
                      onChange={(v) => setForm({ ...form, novaEmpresaCategorias: v })}
                      placeholder="Categorias do fornecedor…"
                    />

                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="sm:col-span-2 justify-self-start"
                      onClick={() => setForm({ ...form, modoNovaEmpresa: false })}
                    >
                      Cancelar nova empresa
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <EmpresaFiscalFields
              value={form}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
              nomeSlot={
                <div className="space-y-1.5">
                  <Label>Nome do representante</Label>
                  <Input
                    value={form.nome}
                    onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  />
                </div>
              }
            />
          </div>

          <DialogFooter className="max-sm:shrink-0 max-sm:flex-row max-sm:items-center max-sm:border-t max-sm:bg-background max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            {!readOnly && (
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Salvando…" : "Salvar"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => { if (!o) { setDeleteRow(null); setDeleteUsage(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir representante?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUsage === null ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verificando uso…
                </span>
              ) : deleteUsage > 0 ? (
                <>
                  <strong>{deleteRow?.nome}</strong> está em uso em <strong>{deleteUsage}</strong> registro(s)
                  (OC de tecido/aviamento ou serviço) e não pode ser excluído.
                </>
              ) : (
                <>
                  Tem certeza que deseja excluir <strong>{deleteRow?.nome}</strong>?
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
              disabled={deleteUsage === null || deleteUsage > 0 || deleteMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MobileActionBar>
        <Button onClick={openCreate} disabled={readOnly} className="ml-auto">
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </MobileActionBar>
    </div>
  );
}

// ============ Categorias Multi-Select (material E serviço) ============

type CatOption = { id: string; nome: string };

function CategoriasMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Selecione categorias…",
}: {
  options: CatOption[];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabels = options
    .filter((o) => value.includes(o.id))
    .map((o) => o.nome);

  const toggle = (id: string) => {
    if (value.includes(id)) onChange(value.filter((v) => v !== id));
    else onChange([...value, id]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
        >
          <span className="truncate text-left">
            {selectedLabels.length === 0
              ? placeholder
              : selectedLabels.length <= 2
                ? selectedLabels.join(", ")
                : `${selectedLabels.length} categorias`}
          </span>
          <ChevronsUpDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <div className="max-h-64 overflow-y-auto space-y-1">
          {options.length === 0 ? (
            <div className="text-sm text-muted-foreground p-2">
              Nenhuma categoria cadastrada.
            </div>
          ) : (
            options.map((o) => (
              <label
                key={o.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
              >
                <Checkbox
                  checked={value.includes(o.id)}
                  onCheckedChange={() => toggle(o.id)}
                />
                <span className="text-sm">{o.nome}</span>
              </label>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============ Empresas (material E serviço, type-aware) ============

type EmpresaTipo = "material" | "servico";

type EmpresaRow = {
  id: string;
  nome_fantasia: string;
  tipo: EmpresaTipo;
  cnpj: string | null;
};

type CatTercOption = { id: string; nome: string; etapa: string };

/** Estado do editor de empresa: campos fiscais + tipo + categorias. */
const emptyEmpresaForm = {
  tipo: "material" as EmpresaTipo,
  nome_fantasia: "",
  cnpj: "",
  razao_social: "",
  logradouro: "",
  cep: "",
  municipio: "",
  uf: "",
  telefone: "",
  email: "",
  situacao_cadastral: "",
  contato: "",
  observacoes: "",
  cats: [] as string[],
};

function EmpresasMultiCatTab({ onFilteredCount }: { onFilteredCount?: (n: number) => void }) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const [search, setSearch] = useState("");
  const [tipoFilter, setTipoFilter] = useState<"todos" | EmpresaTipo>("todos");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof emptyEmpresaForm>(emptyEmpresaForm);
  const [deleteRow, setDeleteRow] = useState<EmpresaRow | null>(null);
  const [deleteUsage, setDeleteUsage] = useState<number | null>(null);

  const { data: empresas = [], isLoading } = useQuery({
    queryKey: ["empresas-multi"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresas")
        .select("id, nome_fantasia, tipo, cnpj")
        .order("nome_fantasia");
      if (error) throw error;
      return (data ?? []) as EmpresaRow[];
    },
  });

  const { data: catsFornecedor = [] } = useQuery({
    queryKey: ["cat-fornecedor-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_fornecedor")
        .select("id, nome")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as CatOption[];
    },
  });

  const { data: catsServico = [] } = useQuery({
    queryKey: ["cat-terceirizado-options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categorias_terceirizado")
        .select("id, nome, etapa")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as CatTercOption[];
    },
  });

  const { data: linksForn = [] } = useQuery({
    queryKey: ["empresa-categorias-links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresa_categorias_fornecedor")
        .select("empresa_id, categoria_fornecedor_id");
      if (error) throw error;
      return (data ?? []) as { empresa_id: string; categoria_fornecedor_id: string }[];
    },
  });

  const { data: linksServ = [] } = useQuery({
    queryKey: ["empresa-categorias-servico-links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("empresa_categorias_servico")
        .select("empresa_id, categoria_terceirizado_id");
      if (error) throw error;
      return (data ?? []) as { empresa_id: string; categoria_terceirizado_id: string }[];
    },
  });

  const fornByEmpresa = useMemo(() => {
    const m = new Map<string, string[]>();
    linksForn.forEach((l) => {
      const arr = m.get(l.empresa_id) ?? [];
      arr.push(l.categoria_fornecedor_id);
      m.set(l.empresa_id, arr);
    });
    return m;
  }, [linksForn]);

  const servByEmpresa = useMemo(() => {
    const m = new Map<string, string[]>();
    linksServ.forEach((l) => {
      const arr = m.get(l.empresa_id) ?? [];
      arr.push(l.categoria_terceirizado_id);
      m.set(l.empresa_id, arr);
    });
    return m;
  }, [linksServ]);

  const catsFornMap = useMemo(() => {
    const m = new Map<string, string>();
    catsFornecedor.forEach((c) => m.set(c.id, c.nome));
    return m;
  }, [catsFornecedor]);

  const catsServMap = useMemo(() => {
    const m = new Map<string, CatTercOption>();
    catsServico.forEach((c) => m.set(c.id, c));
    return m;
  }, [catsServico]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return empresas.filter((e) => {
      if (tipoFilter !== "todos" && e.tipo !== tipoFilter) return false;
      if (!s) return true;
      return (
        e.nome_fantasia.toLowerCase().includes(s) ||
        (e.cnpj ?? "").toLowerCase().includes(s)
      );
    });
  }, [empresas, search, tipoFilter]);
  useReportFiltered(filtered.length, onFilteredCount);

  const sort = useSort(filtered, { key: "nome_fantasia" });

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyEmpresaForm);
  };

  const openCreate = () => {
    resetForm();
    setOpen(true);
  };

  const openEdit = async (e: EmpresaRow) => {
    setEditingId(e.id);
    // Traz os campos fiscais completos da empresa (a lista só tem os essenciais).
    const { data, error } = await supabase
      .from("empresas")
      .select(
        "nome_fantasia, tipo, cnpj, razao_social, logradouro, cep, municipio, uf, telefone, email, situacao_cadastral, contato, observacoes",
      )
      .eq("id", e.id)
      .single();
    if (error) {
      toast.error(mensagemErro(error, "Erro ao carregar empresa."));
      return;
    }
    const tipo = (data.tipo as EmpresaTipo) ?? "material";
    setForm({
      tipo,
      nome_fantasia: data.nome_fantasia ?? "",
      cnpj: data.cnpj ?? "",
      razao_social: data.razao_social ?? "",
      logradouro: data.logradouro ?? "",
      cep: data.cep ?? "",
      municipio: data.municipio ?? "",
      uf: data.uf ?? "",
      telefone: data.telefone ?? "",
      email: data.email ?? "",
      situacao_cadastral: data.situacao_cadastral ?? "",
      contato: data.contato ?? "",
      observacoes: data.observacoes ?? "",
      cats: (tipo === "servico" ? servByEmpresa.get(e.id) : fornByEmpresa.get(e.id)) ?? [],
    });
    setOpen(true);
  };

  // Em EDIÇÃO travamos o tipo se a empresa já tem categorias vinculadas (trocar tipo
  // limpa as categorias e trocaria a junction).
  const editingHasCats = !!editingId && form.cats.length > 0;

  const saveMut = useMutation({
    mutationFn: async () => {
      const nome = form.nome_fantasia.trim();
      if (!nome) throw new Error("Informe o nome fantasia.");
      if (form.cats.length === 0)
        throw new Error(
          form.tipo === "servico"
            ? "Selecione ao menos uma categoria de serviço."
            : "Selecione ao menos uma categoria do fornecedor.",
        );

      // Upsert da empresa + sincronização das duas junctions numa transação só
      // (RPC atômica). CNPJ NÃO é obrigatório (serviço interno / PF pode não ter).
      const { error } = await supabase.rpc("set_empresa_categorias" as any, {
        _empresa: {
          id: editingId,
          tipo: form.tipo,
          nome_fantasia: nome,
          cnpj: form.cnpj ? cleanCnpj(form.cnpj) : null,
          razao_social: form.razao_social || null,
          logradouro: form.logradouro || null,
          cep: form.cep || null,
          municipio: form.municipio || null,
          uf: form.uf || null,
          telefone: form.telefone || null,
          email: form.email || null,
          situacao_cadastral: form.situacao_cadastral || null,
          contato: form.contato || null,
          observacoes: form.observacoes || null,
        },
        _cats: form.cats,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editingId ? "Empresa atualizada." : "Empresa criada.");
      setOpen(false);
      resetForm();
      qc.invalidateQueries({ queryKey: ["empresas-multi"] });
      qc.invalidateQueries({ queryKey: ["empresa-categorias-links"] });
      qc.invalidateQueries({ queryKey: ["empresa-categorias-servico-links"] });
      qc.invalidateQueries({ queryKey: ["empresas-options"] });
      qc.invalidateQueries({ queryKey: ["servico-count", "empresas"] });
      // Atualiza o seletor de empresa de serviço da Produção.
      qc.invalidateQueries({ queryKey: ["empresas-servico-sel"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao salvar.")),
  });

  const startDelete = async (row: EmpresaRow) => {
    setDeleteRow(row);
    setDeleteUsage(null);
    let total = 0;
    const refs: { table: string; column: string; value: string }[] = [
      { table: "representantes", column: "empresa_id", value: row.id },
      { table: "aviamentos", column: "empresa_id", value: row.id },
      { table: "ocs_tecido", column: "empresa_id", value: row.id },
      { table: "ocs_aviamento", column: "empresa_id", value: row.id },
      { table: "parcelas", column: "empresa_id", value: row.id },
      { table: "artigos", column: "empresa_id", value: row.id },
      // empresa de serviço em uso na Produção (por empresa_id — fonte única).
      { table: "producao_terceirizados", column: "empresa_id", value: row.id },
    ];
    for (const r of refs) {
      const { count } = await supabase
        .from(r.table as any)
        .select("*", { count: "exact", head: true })
        .eq(r.column, r.value);
      total += count ?? 0;
    }
    setDeleteUsage(total);
  };

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("empresas").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Excluído.");
      setDeleteRow(null);
      setDeleteUsage(null);
      qc.invalidateQueries({ queryKey: ["empresas-multi"] });
      qc.invalidateQueries({ queryKey: ["servico-count", "empresas"] });
      qc.invalidateQueries({ queryKey: ["empresas-servico-sel"] });
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar empresas…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={tipoFilter} onValueChange={(v) => setTipoFilter(v as "todos" | EmpresaTipo)}>
          <SelectTrigger className="w-36 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos</SelectItem>
            <SelectItem value="material">Material</SelectItem>
            <SelectItem value="servico">Serviço</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={openCreate} disabled={readOnly} className="max-sm:hidden">
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table className="card-table">
          <TableHeader>
            <TableRow>
              <SortHead label="Nome Fantasia" sortKey="nome_fantasia" sortState={sort} />
              <TableHead className="w-28">Tipo</TableHead>
              <TableHead>Categorias</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                  Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  Nenhuma empresa encontrada.
                </TableCell>
              </TableRow>
            ) : (
              sort.sorted.map((row) => {
                const isServ = row.tipo === "servico";
                const catIds = (isServ ? servByEmpresa.get(row.id) : fornByEmpresa.get(row.id)) ?? [];
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => openEdit(row)}
                      >
                        {row.nome_fantasia}
                      </button>
                    </TableCell>
                    <TableCell data-label="Tipo">
                      <Badge variant={isServ ? "default" : "secondary"}>
                        {isServ ? "Serviço" : "Material"}
                      </Badge>
                    </TableCell>
                    <TableCell data-label="Categorias">
                      {catIds.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {catIds.map((cid) => {
                            if (isServ) {
                              const c = catsServMap.get(cid);
                              return (
                                <Badge key={cid} variant="secondary" className="gap-1">
                                  {c?.nome ?? "—"}
                                  {c && (
                                    <span className="text-[10px] opacity-70">
                                      {c.etapa === "pos_costura" ? "Pós" : "Pré"}
                                    </span>
                                  )}
                                </Badge>
                              );
                            }
                            return (
                              <Badge key={cid} variant="secondary">
                                {catsFornMap.get(cid) ?? "—"}
                              </Badge>
                            );
                          })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell data-label="Ações" className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(row)} aria-label="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => startDelete(row)} disabled={readOnly} aria-label="Excluir">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>


      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!grid-rows-[auto_minmax(0,1fr)_auto] max-sm:!overflow-hidden">
          <DialogHeader className="max-sm:shrink-0">
            <DialogTitle>{editingId ? "Editar empresa" : "Nova empresa"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 max-sm:min-h-0 max-sm:overflow-y-auto">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <Select
                  value={form.tipo}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, tipo: v as EmpresaTipo, cats: [] }))
                  }
                  disabled={editingHasCats}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="material">Material</SelectItem>
                    <SelectItem value="servico">Serviço</SelectItem>
                  </SelectContent>
                </Select>
                {editingHasCats && (
                  <p className="text-xs text-muted-foreground">
                    Tipo travado — remova as categorias para poder trocar (trocar o tipo limpa as categorias).
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>
                  Nome fantasia <span className="text-destructive">*</span>
                </Label>
                <Input
                  autoFocus
                  value={form.nome_fantasia}
                  onChange={(e) => setForm((f) => ({ ...f, nome_fantasia: e.target.value }))}
                />
              </div>
            </div>

            <EmpresaFiscalFields
              value={form}
              onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            />

            <div className="space-y-1.5">
              <Label>
                {form.tipo === "servico" ? "Categorias de Serviço" : "Categorias do Fornecedor"}{" "}
                <span className="text-destructive">*</span>
              </Label>
              {form.tipo === "servico" ? (
                <CategoriasMultiSelect
                  options={catsServico.map((c) => ({
                    id: c.id,
                    nome: `${c.nome} (${c.etapa === "pos_costura" ? "Pós" : "Pré"})`,
                  }))}
                  value={form.cats}
                  onChange={(v) => setForm((f) => ({ ...f, cats: v }))}
                  placeholder="Categorias de serviço…"
                />
              ) : (
                <CategoriasMultiSelect
                  options={catsFornecedor}
                  value={form.cats}
                  onChange={(v) => setForm((f) => ({ ...f, cats: v }))}
                />
              )}
            </div>
          </div>
          <DialogFooter className="max-sm:shrink-0 max-sm:flex-row max-sm:items-center max-sm:border-t max-sm:bg-background max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            {!readOnly && (
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Salvando…" : "Salvar"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteRow}
        onOpenChange={(o) => {
          if (!o) {
            setDeleteRow(null);
            setDeleteUsage(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUsage === null ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Verificando uso…
                </span>
              ) : deleteUsage > 0 ? (
                <>
                  Esta empresa está em uso em <strong>{deleteUsage}</strong> registro(s) e não pode
                  ser excluída. Remova-a dos pedidos/serviços antes.
                </>
              ) : (
                <>
                  Tem certeza que deseja excluir <strong>{deleteRow?.nome_fantasia}</strong>?
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
              disabled={deleteUsage === null || deleteUsage > 0 || deleteMut.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MobileActionBar>
        <Button onClick={openCreate} disabled={readOnly} className="ml-auto">
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </MobileActionBar>
    </div>
  );
}

