import { SkeletonTableRow } from "@/components/shared/Skeletons";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useRef, type MutableRefObject } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Store, Plus, Search, Upload, Pencil, RotateCcw, Trash2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { formatCNPJ } from "@/lib/format";
import { sanitizeStorageName } from "@/lib/storage-tenant";
import { supabase } from "@/integrations/supabase/client";
import { excluirLoja } from "@/lib/admin.functions";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { useSort, SortHead } from "@/components/shared/sort";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";

// Toggles de módulo (chaves batem com tenant_config.modules). Deriva de PAGES_CATALOG,
// mas DEDUPLICA por `gate ?? module`: PCP e Expedição & Logística são 2 ModuleDef que
// compartilham a MESMA flag de contratação `producao` (ver CLAUDE.md, bloco "PCP +
// Expedição") — sem o dedup, viravam 2 switches soltos (`pcp`/`expedicao`) que não
// batiam com nenhuma chave lida em lugar nenhum, e a flag real `producao` nunca
// aparecia (bug latente desde o split de jul/2026, corrigido aqui de passagem).
// `produto_acabado` não tem ModuleDef próprio no PAGES_CATALOG (é PageDef.gate dentro
// de criacao/entrada_saida) — entra à mão, igual aos outros 7 (decisão do dono, ago/2026:
// mora em Gerenciar Lojas junto dos demais, não mais em Config da Loja).
const MODULE_TOGGLES: { key: string; label: string }[] = (() => {
  const seen = new Set<string>();
  const out: { key: string; label: string }[] = [];
  for (const m of PAGES_CATALOG) {
    const key = m.gate ?? m.module;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: m.label });
  }
  out.push({ key: "produto_acabado", label: "Produto Acabado (Revenda)" });
  return out;
})();
// Descrição curta por módulo (o super_admin liga/desliga sabendo o que cada um faz).
const MODULE_DESC: Record<string, string> = {
  cadastro: "Materiais, fornecedores, atributos e colaboradores.",
  entrada_saida: "Ordens de compra de tecido/aviamento, rolos e estoque.",
  otb: "OTB — orçamento de coleção (Open To Buy) antes do Planejamento.",
  criacao: "Planejamento e Desenvolvimento (kanban) dos modelos.",
  producao: "CAD, Serviços, CQ, Direcionamento e Lançamentos.",
  financeiro: "Contas a pagar, calendário e resumo financeiro.",
  dashboard: "Painéis de coleção, estoque, produção, custos, comercial e leadtime.",
  produto_acabado: "Compra de produto pronto para revenda — Produto Acabado e OC P. Acabado.",
};
const MODULE_DEFAULTS: Record<string, boolean> = {
  ...Object.fromEntries(MODULE_TOGGLES.map((m) => [m.key, true])),
  otb: false, // opt-in
  produto_acabado: false, // opt-in — mesmo padrão do otb
};

function TenantLogo({ path, alt }: { path: string | null; alt: string }) {
  const url = useSignedUrl(path, "tenant-logos");
  if (!path) return <div className="h-8 w-8 rounded bg-muted" />;
  return url ? (
    <img src={url} alt={alt} className="h-8 w-8 rounded object-cover" />
  ) : (
    <div className="h-8 w-8 rounded bg-muted animate-pulse" />
  );
}

export const Route = createFileRoute("/_authenticated/admin/lojas")({
  component: LojasPage,
});

type Tenant = {
  id: string;
  nome: string;
  cnpj: string | null;
  logo_url: string | null;
  contato: string | null;
  ativo: boolean;
};

function LojasPage() {
  const { isSuperAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const novaLojaRequestCloseRef = useRef<(() => void) | null>(null);
  const editLojaRequestCloseRef = useRef<(() => void) | null>(null);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [resetTarget, setResetTarget] = useState<Tenant | null>(null);
  const [resetConfirm, setResetConfirm] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Tenant | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  // Ativar/inativar a loja suspende/libera o acesso de todos os usuários dela.
  const [ativoTarget, setAtivoTarget] = useState<Tenant | null>(null);

  const { data: tenants = [], isLoading } = useQuery({
    queryKey: ["admin", "tenants"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenants")
        .select("id,nome,cnpj,logo_url,contato,ativo")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Tenant[];
    },
    enabled: isSuperAdmin,
  });

  const filtered = useMemo(
    () => tenants.filter((t) => t.nome.toLowerCase().includes(search.toLowerCase())),
    [tenants, search],
  );

  // Ordenação clicável: nome/CNPJ por texto, status pelo booleano cru (ativo).
  const { sorted, sortKey, sortDir, toggle } = useSort(filtered, {
    key: "nome",
    accessors: { status: (t) => t.ativo },
  });
  const sortState = { sortKey, sortDir, toggle };

  const toggleAtivo = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await supabase.from("tenants").update({ ativo }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      qc.invalidateQueries({ queryKey: ["tenant-switcher"] });
      toast.success("Loja atualizada");
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  // Reset = "como loja nova": zera os dados de negócio (RPC reset_loja, super_admin).
  const resetMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("reset_loja" as any, { _tenant_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      setResetTarget(null);
      setResetConfirm("");
      toast.success("Loja resetada — voltou ao estado inicial.");
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });
  // Exclusão definitiva da loja + todos os dados + contas auth (server fn excluirLoja,
  // super_admin): a RPC excluir_loja apaga os dados; a server fn ainda remove os auth.users.
  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      return await excluirLoja({ data: { tenant_id: id } });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      qc.invalidateQueries({ queryKey: ["tenant-switcher"] });
      setDeleteTarget(null);
      setDeleteConfirm("");
      const falhas = (res as { falhas?: string[] } | undefined)?.falhas?.length ?? 0;
      if (falhas > 0) {
        toast.warning(`Loja excluída, mas ${falhas} conta(s) de acesso não puderam ser removidas — verifique no painel de autenticação.`);
      } else {
        toast.success("Loja excluída.");
      }
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <Button asChild variant="ghost" size="sm" className="max-sm:hidden -ml-2 w-fit text-muted-foreground">
        <Link to="/admin"><ArrowLeft className="mr-1 h-4 w-4" /> Voltar ao Admin</Link>
      </Button>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Store className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Gerenciar Lojas</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Cadastre e administre todas as lojas do sistema.
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={(o) => { if (!o) { const rc = novaLojaRequestCloseRef.current; if (rc) rc(); else setOpen(false); } else setOpen(true); }}>
          <DialogTrigger asChild>
            <Button className="max-sm:hidden">
              <Plus className="h-4 w-4" /> Nova Loja
            </Button>
          </DialogTrigger>
          {/* Monta só quando aberto → campos e baseline do guarda nascem limpos a cada abertura. */}
          {open && <NovaLojaModal onClose={() => setOpen(false)} requestCloseRef={novaLojaRequestCloseRef} />}
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-8"
          placeholder="Pesquisar por nome…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="border rounded-lg">
        <Table className="card-table">
          <TableHeader>
            <TableRow>
              <TableHead>Logo</TableHead>
              <SortHead label="Nome" sortKey="nome" sortState={sortState} />
              <SortHead label="CNPJ" sortKey="cnpj" sortState={sortState} />
              <SortHead label="Status" sortKey="status" sortState={sortState} />
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonTableRow cols={5} />
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Nenhuma loja encontrada.</TableCell></TableRow>
            ) : (
              sorted.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <TenantLogo path={t.logo_url} alt={t.nome} />
                  </TableCell>
                  <TableCell data-label="Nome" className="font-medium">{t.nome}</TableCell>
                  <TableCell data-label="CNPJ" className="text-sm text-muted-foreground">{t.cnpj ?? "—"}</TableCell>
                  <TableCell data-label="Status">
                    {t.ativo ? (
                      <Badge className="bg-emerald-500 hover:bg-emerald-600">Ativa</Badge>
                    ) : (
                      <Badge variant="destructive">Inativa</Badge>
                    )}
                  </TableCell>
                  <TableCell data-label="Ações" className="text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="iconSm"
                        onClick={() => setEditingTenant(t)}
                        aria-label="Editar loja"
                        title="Editar loja"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        onClick={() => { setResetTarget(t); setResetConfirm(""); }}
                        aria-label="Resetar loja"
                        title="Resetar (zerar dados, manter loja)"
                      >
                        <RotateCcw className="h-4 w-4 text-amber-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="iconSm"
                        onClick={() => { setDeleteTarget(t); setDeleteConfirm(""); }}
                        aria-label="Excluir loja"
                        title="Excluir loja"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                      {/* Alvo de toque 44px envolvendo o Switch (o próprio é 20px). */}
                      <label className="inline-flex h-11 items-center px-1" title={t.ativo ? "Inativar loja" : "Ativar loja"}>
                        <Switch checked={t.ativo} onCheckedChange={() => setAtivoTarget(t)} aria-label={t.ativo ? "Inativar loja" : "Ativar loja"} />
                      </label>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Sheet open={!!editingTenant} onOpenChange={(o) => { if (!o) { const rc = editLojaRequestCloseRef.current; if (rc) rc(); else setEditingTenant(null); } }}>
        {editingTenant && (
          <EditarLojaModal key={editingTenant.id} tenant={editingTenant} onClose={() => setEditingTenant(null)} requestCloseRef={editLojaRequestCloseRef} />
        )}
      </Sheet>

      {/* Ativar/inativar loja: inativar suspende o acesso (RLS bloqueia tudo). */}
      <AlertDialog open={!!ativoTarget} onOpenChange={(o) => { if (!o) setAtivoTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {ativoTarget?.ativo ? "Inativar" : "Ativar"} a loja "{ativoTarget?.nome}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {ativoTarget?.ativo ? (
                <>Inativar <strong>suspende o acesso</strong> de todos os usuários desta loja —
                ninguém consegue ver ou alterar os dados dela enquanto estiver inativa. Os dados
                são preservados e voltam ao reativar.</>
              ) : (
                <>Ativar <strong>libera o acesso</strong> dos usuários desta loja novamente.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant={ativoTarget?.ativo ? "destructive" : "default"}
              onClick={(e) => {
                e.preventDefault();
                if (ativoTarget) toggleAtivo.mutate({ id: ativoTarget.id, ativo: !ativoTarget.ativo });
                setAtivoTarget(null);
              }}
              disabled={toggleAtivo.isPending}
            >
              {ativoTarget?.ativo ? "Inativar loja" : "Ativar loja"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset: zera os dados de negócio, mantém loja/usuários/config. Destrutivo e
          irreversível → confirma digitando o nome (igual excluir). */}
      <AlertDialog open={!!resetTarget} onOpenChange={(o) => { if (!o) { setResetTarget(null); setResetConfirm(""); } }}>
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Resetar a loja "{resetTarget?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="mb-1 block rounded bg-muted px-2 py-1 text-xs">
                {resetTarget?.nome}{resetTarget?.cnpj ? ` · ${resetTarget.cnpj}` : ""}
              </span>
              Apaga <strong>todos os dados de negócio</strong> (cadastro, desenvolvimento,
              OCs, CAD, CQ, produção, financeiro e estoque) e devolve a loja ao estado
              inicial. Mantém a loja, os usuários, as permissões e a configuração, e
              recria as categorias fixas (Corte/Oficina) e os 12 meses.
              <strong> Não pode ser desfeito.</strong> Para confirmar, digite o nome da loja:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={resetConfirm}
            onChange={(e) => setResetConfirm(e.target.value)}
            placeholder={resetTarget?.nome ?? ""}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={(e) => { e.preventDefault(); if (resetTarget) resetMut.mutate(resetTarget.id); }}
              disabled={resetMut.isPending || resetConfirm.trim() !== (resetTarget?.nome ?? "").trim()}
            >
              {resetMut.isPending ? "Resetando…" : "Resetar loja"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Exclusão: loja + todos os dados; confirma digitando o nome. */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteConfirm(""); } }}>
        <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a loja "{deleteTarget?.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove a loja e <strong>todos os seus dados e usuários</strong>, de forma
              permanente. <strong>Irreversível.</strong> Para confirmar, digite o nome da loja:
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={deleteTarget?.nome ?? ""}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => { e.preventDefault(); if (deleteTarget) deleteMut.mutate(deleteTarget.id); }}
              disabled={deleteMut.isPending || deleteConfirm.trim() !== (deleteTarget?.nome ?? "").trim()}
            >
              {deleteMut.isPending ? "Excluindo…" : "Excluir loja"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MobileActionBar>
        <Button asChild variant="outline" size="icon" aria-label="Voltar">
          <Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <Button className="ml-auto" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Nova Loja
        </Button>
      </MobileActionBar>
    </div>
  );
}

function NovaLojaModal({ onClose, requestCloseRef }: { onClose: () => void; requestCloseRef: MutableRefObject<(() => void) | null> }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [contato, setContato] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dirty = nome !== "" || cnpj !== "" || contato !== "" || logoFile !== null;
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });
  requestCloseRef.current = requestClose;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) {
      toast.error("Nome obrigatório");
      return;
    }
    setSubmitting(true);
    try {
      let logo_url: string | null = null;
      if (logoFile) {
        const path = `${crypto.randomUUID()}-${sanitizeStorageName(logoFile.name)}`;
        const { error: upErr } = await supabase.storage
          .from("tenant-logos")
          .upload(path, logoFile, { upsert: false });
        if (upErr) throw upErr;
        // Store only the storage path; signed URL is generated short-lived at render time.
        logo_url = path;
      }
      const { error } = await supabase
        .from("tenants")
        .insert({ nome: nome.trim(), cnpj: cnpj || null, contato: contato || null, logo_url, ativo: true });
      if (error) throw error;
      toast.success("Loja criada");
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      qc.invalidateQueries({ queryKey: ["tenant-switcher"] });
      onClose();
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="max-sm:[&>button]:hidden max-sm:!inset-0 max-sm:!h-[100dvh] max-sm:!max-h-[100dvh] max-sm:!w-full max-sm:!max-w-none max-sm:!translate-x-0 max-sm:!translate-y-0 max-sm:!rounded-none max-sm:!border-0 max-sm:!grid-rows-[1fr] max-sm:!overflow-hidden">
      <form onSubmit={onSubmit} className="max-sm:grid max-sm:grid-rows-[auto_minmax(0,1fr)_auto] max-sm:min-h-0 max-sm:min-w-0 max-sm:overflow-hidden">
        <DialogHeader className="max-sm:shrink-0">
          <div className="space-y-1">
            <Breadcrumb items={[{ label: "Admin" }, { label: "Gerenciar Lojas" }, { label: "Nova loja" }]} />
            <div className="flex items-center gap-2">
              <DialogTitle>Nova Loja</DialogTitle>
              <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4 py-4 max-sm:min-h-0 max-sm:min-w-0 max-sm:overflow-y-auto">
          <div>
            <Label htmlFor="nome">Nome *</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="cnpj">CNPJ</Label>
            <Input id="cnpj" value={cnpj} onChange={(e) => setCnpj(formatCNPJ(e.target.value))} inputMode="numeric" placeholder="00.000.000/0000-00" maxLength={18} />
          </div>
          <div>
            <Label htmlFor="contato">Contato</Label>
            <Input id="contato" value={contato} onChange={(e) => setContato(e.target.value)} maxLength={500} />
          </div>
          <div>
            <Label htmlFor="logo">Logo</Label>
            <div className="flex items-center gap-2">
              <Input
                id="logo"
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              />
              <Upload className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
        <div className="shrink-0 border-t bg-background p-3 flex items-center gap-2 max-sm:-mx-4 max-sm:-mb-4">
          <Button type="button" variant="outline" onClick={requestClose}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
          <Button type="submit" className="ml-auto" disabled={submitting}>{submitting ? "Salvando…" : "Salvar"}</Button>
        </div>
      </form>
      <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste cadastro de loja." />
    </DialogContent>
  );
}

function EditarLojaModal({ tenant, onClose, requestCloseRef }: { tenant: Tenant; onClose: () => void; requestCloseRef: MutableRefObject<(() => void) | null> }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(tenant.nome);
  const [cnpj, setCnpj] = useState(formatCNPJ(tenant.cnpj ?? ""));
  const [contato, setContato] = useState(tenant.contato ?? "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modules, setModules] = useState<Record<string, boolean>>(MODULE_DEFAULTS);
  const [confirmModules, setConfirmModules] = useState(false);

  // Módulos habilitados desta loja (tenant_config da loja editada; super_admin
  // lê/escreve via policy super_admin_all_tenant_config).
  const { data: cfgModules, isFetched: cfgFetched } = useQuery({
    queryKey: ["admin", "tenant-modules", tenant.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("tenant_config")
        .select("modules")
        .eq("tenant_id", tenant.id)
        .maybeSingle();
      return ((data as any)?.modules ?? null) as Record<string, boolean> | null;
    },
  });

  useEffect(() => {
    setNome(tenant.nome);
    setCnpj(formatCNPJ(tenant.cnpj ?? ""));
    setContato(tenant.contato ?? "");
    setLogoFile(null);
  }, [tenant]);

  useEffect(() => {
    // cadastro sempre ligado (base de dados de tudo).
    setModules({ ...MODULE_DEFAULTS, ...(cfgModules ?? {}), cadastro: true });
  }, [cfgModules, tenant.id]);

  // Mudou algum módulo em relação ao que está salvo? (desligar módulo esconde dados)
  const modulesChanged = (() => {
    const base: Record<string, boolean> = { ...MODULE_DEFAULTS, ...(cfgModules ?? {}), cadastro: true };
    return MODULE_TOGGLES.some((m) => !!base[m.key] !== !!modules[m.key]);
  })();

  const { dirty: fieldsDirty, markClean } = useDirtySnapshot({ nome, cnpj, contato });
  const dirty = fieldsDirty || logoFile !== null || modulesChanged;
  const { requestClose, confirm } = useUnsavedGuard({ dirty, onClose });
  requestCloseRef.current = requestClose;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) { toast.error("Nome obrigatório"); return; }
    // Trocar módulos afeta o que a loja inteira vê — confirma antes.
    if (modulesChanged) { setConfirmModules(true); return; }
    doSave();
  };

  const doSave = async () => {
    setSubmitting(true);
    try {
      let logo_url: string | null | undefined = undefined;
      if (logoFile) {
        const path = `${crypto.randomUUID()}-${sanitizeStorageName(logoFile.name)}`;
        const { error: upErr } = await supabase.storage
          .from("tenant-logos").upload(path, logoFile, { upsert: false });
        if (upErr) throw upErr;
        // Store storage path only; signed URLs are created short-lived at read time.
        logo_url = path;
      }
      // Save ATÔMICO (tenants + tenant_config numa txn no servidor): RPC salvar_loja.
      // _logo_url null = mantém a logo atual (COALESCE no servidor). _modules null = não
      // toca em modules — só envia quando a config JÁ foi carregada (senão o estado ainda
      // está nos MODULE_DEFAULTS e sobrescreveria a config real com defaults).
      const { error } = await supabase.rpc("salvar_loja" as any, {
        _id: tenant.id,
        _nome: nome.trim(),
        _cnpj: cnpj || null,
        _contato: contato || null,
        _logo_url: logo_url ?? null,
        _modules: cfgFetched ? ({ ...modules, cadastro: true } as any) : null,
      });
      if (error) throw error;
      toast.success("Loja atualizada");
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      qc.invalidateQueries({ queryKey: ["tenant-switcher"] });
      qc.invalidateQueries({ queryKey: ["admin", "tenant-modules", tenant.id] });
      qc.invalidateQueries({ queryKey: ["tenant_config", "modules"] });
      markClean();
      onClose();
    } catch (err) {
      toast.error(mensagemErro(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SheetContent side="right" className="flex w-full flex-col p-0 sm:w-[70vw] sm:max-w-[70vw] [&>button]:hidden">
      <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b p-3">
          <div className="space-y-1">
            <Breadcrumb items={[{ label: "Admin" }, { label: "Gerenciar Lojas" }, { label: nome || tenant.nome }]} />
            <div className="flex items-center gap-2">
              <DialogTitle className="text-xl font-bold">Editar Loja</DialogTitle>
              <UnsavedIndicator show={dirty} className="ml-auto shrink-0" />
            </div>
          </div>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <div>
            <Label htmlFor="edit-nome">Nome *</Label>
            <Input id="edit-nome" value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="edit-cnpj">CNPJ</Label>
            <Input id="edit-cnpj" value={cnpj} onChange={(e) => setCnpj(formatCNPJ(e.target.value))} inputMode="numeric" placeholder="00.000.000/0000-00" maxLength={18} />
          </div>
          <div>
            <Label htmlFor="edit-contato">Contato</Label>
            <Input id="edit-contato" value={contato} onChange={(e) => setContato(e.target.value)} maxLength={500} />
          </div>
          <div>
            <Label htmlFor="edit-logo">Logo {tenant.logo_url ? "(substituir)" : ""}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="edit-logo"
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
              />
              <Upload className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
          <div>
            <Label>Módulos habilitados</Label>
            <div className="mt-2 divide-y rounded-md border">
              {!cfgFetched ? (
                <p className="p-3 text-sm text-muted-foreground">Carregando módulos…</p>
              ) : (
                MODULE_TOGGLES.map((m) => {
                  const locked = m.key === "cadastro";
                  return (
                    <label key={m.key} className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0">
                        <span className="text-sm">
                          {m.label}
                          {locked && <span className="text-xs text-muted-foreground"> (sempre ativo)</span>}
                        </span>
                        {MODULE_DESC[m.key] && (
                          <span className="block text-xs text-muted-foreground">{MODULE_DESC[m.key]}</span>
                        )}
                      </span>
                      <Switch
                        checked={locked ? true : !!modules[m.key]}
                        disabled={locked}
                        onCheckedChange={(checked) =>
                          setModules((prev) => ({ ...prev, [m.key]: checked }))
                        }
                      />
                    </label>
                  );
                })
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Só os módulos ligados aparecem para a loja. Apenas Cadastro + Entrada e Saída = modo só-estoque.
            </p>
          </div>
        </div>
        <div className="shrink-0 border-t bg-background p-3 flex items-center gap-2">
          <Button type="button" variant="outline" onClick={requestClose}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
          <Button type="submit" className="ml-auto" disabled={submitting || !cfgFetched}>{submitting ? "Salvando…" : "Salvar"}</Button>
        </div>
      </form>

      {/* Confirmação: trocar módulos habilitados afeta o que a loja inteira enxerga. */}
      <AlertDialog open={confirmModules} onOpenChange={setConfirmModules}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alterar os módulos da loja "{tenant.nome}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Você mudou os <strong>módulos habilitados</strong>. Desligar um módulo
              <strong> esconde seções inteiras</strong> para todos os usuários da loja. Os
              dados não são apagados, mas ficam inacessíveis até religar. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); setConfirmModules(false); doSave(); }}
              disabled={submitting}
            >
              Salvar mesmo assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <UnsavedChangesGuard confirm={confirm} message="Há alterações não salvas neste cadastro de loja." />
    </SheetContent>
  );
}
