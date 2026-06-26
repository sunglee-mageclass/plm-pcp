import { SkeletonTableRow } from "@/components/shared/Skeletons";
import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Store, Plus, Search, Upload, Pencil, RotateCcw, Trash2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSignedUrl } from "@/hooks/useSignedUrl";
import { PAGES_CATALOG } from "@/lib/permissions-catalog";
import { MobileActionBar } from "@/components/shared/MobileActionBar";

// Toggles de módulo (chaves batem com tenant_config.modules e PAGES_CATALOG).
const MODULE_TOGGLES = PAGES_CATALOG.map((m) => ({ key: m.module, label: m.label }));
const MODULE_DEFAULTS: Record<string, boolean> = Object.fromEntries(
  MODULE_TOGGLES.map((m) => [m.key, true]),
);

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
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [resetTarget, setResetTarget] = useState<Tenant | null>(null);
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
      toast.success("Loja resetada — voltou ao estado inicial.");
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });
  // Exclusão definitiva da loja + todos os dados (RPC excluir_loja, super_admin).
  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("excluir_loja" as any, { _tenant_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      qc.invalidateQueries({ queryKey: ["tenant-switcher"] });
      setDeleteTarget(null);
      setDeleteConfirm("");
      toast.success("Loja excluída.");
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6 max-sm:pb-24">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Store className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Gerenciar Lojas</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Cadastre e administre todas as lojas (tenants) do sistema.
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="max-sm:hidden">
              <Plus className="h-4 w-4" /> Nova Loja
            </Button>
          </DialogTrigger>
          <NovaLojaModal onClose={() => setOpen(false)} />
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
              <TableHead>Nome</TableHead>
              <TableHead>CNPJ</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonTableRow cols={5} />
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Nenhuma loja encontrada.</TableCell></TableRow>
            ) : (
              filtered.map((t) => (
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
                    <div className="inline-flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditingTenant(t)}
                        aria-label="Editar loja"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setResetTarget(t)}
                        aria-label="Resetar loja"
                        title="Resetar (zerar dados, manter loja)"
                      >
                        <RotateCcw className="h-4 w-4 text-amber-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => { setDeleteTarget(t); setDeleteConfirm(""); }}
                        aria-label="Excluir loja"
                        title="Excluir loja"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                      <Switch
                        checked={t.ativo}
                        onCheckedChange={() => setAtivoTarget(t)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!editingTenant} onOpenChange={(o) => !o && setEditingTenant(null)}>
        {editingTenant && (
          <EditarLojaModal tenant={editingTenant} onClose={() => setEditingTenant(null)} />
        )}
      </Dialog>

      {/* Ativar/inativar loja: inativar suspende o acesso (RLS bloqueia tudo). */}
      <AlertDialog open={!!ativoTarget} onOpenChange={(o) => { if (!o) setAtivoTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {ativoTarget?.ativo ? "Inativar" : "Ativar"} a loja “{ativoTarget?.nome}”?
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
              className={ativoTarget?.ativo ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
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

      {/* Reset: zera os dados de negócio, mantém loja/usuários/config. */}
      <AlertDialog open={!!resetTarget} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resetar a loja “{resetTarget?.nome}”?</AlertDialogTitle>
            <AlertDialogDescription>
              Apaga <strong>todos os dados de negócio</strong> (cadastro, desenvolvimento,
              OCs, CAD, CQ, produção, financeiro e estoque) e devolve a loja ao estado
              inicial. Mantém a loja, os usuários, as permissões e a configuração, e
              recria as categorias fixas (Corte/Oficina). <strong>Não pode ser desfeito.</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={(e) => { e.preventDefault(); if (resetTarget) resetMut.mutate(resetTarget.id); }}
              disabled={resetMut.isPending}
            >
              {resetMut.isPending ? "Resetando…" : "Resetar loja"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Exclusão: loja + todos os dados; confirma digitando o nome. */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) { setDeleteTarget(null); setDeleteConfirm(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir a loja “{deleteTarget?.nome}”?</AlertDialogTitle>
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); if (deleteTarget) deleteMut.mutate(deleteTarget.id); }}
              disabled={deleteMut.isPending || deleteConfirm.trim() !== deleteTarget?.nome}
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

function NovaLojaModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [contato, setContato] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
        const path = `${crypto.randomUUID()}-${logoFile.name}`;
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
          <DialogTitle>Nova Loja</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4 max-sm:min-h-0 max-sm:min-w-0 max-sm:overflow-y-auto">
          <div>
            <Label htmlFor="nome">Nome *</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="cnpj">CNPJ</Label>
            <Input id="cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} maxLength={18} />
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
        <DialogFooter className="max-sm:shrink-0 max-sm:flex-row max-sm:items-center max-sm:border-t max-sm:bg-background max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3">
          <Button type="button" variant="outline" className="max-sm:hidden" onClick={onClose}>Cancelar</Button>
          <Button type="button" variant="outline" size="icon" aria-label="Voltar" className="shrink-0 sm:hidden" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button type="submit" className="max-sm:ml-auto" disabled={submitting}>{submitting ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function EditarLojaModal({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(tenant.nome);
  const [cnpj, setCnpj] = useState(tenant.cnpj ?? "");
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
    setCnpj(tenant.cnpj ?? "");
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
        const path = `${crypto.randomUUID()}-${logoFile.name}`;
        const { error: upErr } = await supabase.storage
          .from("tenant-logos").upload(path, logoFile, { upsert: false });
        if (upErr) throw upErr;
        // Store storage path only; signed URLs are created short-lived at read time.
        logo_url = path;
      }
      const payload: { nome: string; cnpj: string | null; contato: string | null; logo_url?: string | null } = {
        nome: nome.trim(),
        cnpj: cnpj || null,
        contato: contato || null,
      };
      if (logo_url !== undefined) payload.logo_url = logo_url;
      const { error } = await supabase.from("tenants").update(payload).eq("id", tenant.id);
      if (error) throw error;
      // Módulos habilitados → tenant_config da loja (upsert; cadastro forçado on).
      // Só grava se os módulos JÁ foram carregados — senão o estado ainda está nos
      // MODULE_DEFAULTS (tudo on) e o save sobrescreveria a config real com defaults.
      if (cfgFetched) {
        const { error: cfgErr } = await supabase
          .from("tenant_config")
          .upsert(
            { tenant_id: tenant.id, modules: { ...modules, cadastro: true } } as any,
            { onConflict: "tenant_id" },
          );
        if (cfgErr) throw cfgErr;
      }
      toast.success("Loja atualizada");
      qc.invalidateQueries({ queryKey: ["admin", "tenants"] });
      qc.invalidateQueries({ queryKey: ["tenant-switcher"] });
      qc.invalidateQueries({ queryKey: ["admin", "tenant-modules", tenant.id] });
      qc.invalidateQueries({ queryKey: ["tenant_config", "modules"] });
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
          <DialogTitle>Editar Loja</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4 max-sm:min-h-0 max-sm:min-w-0 max-sm:overflow-y-auto">
          <div>
            <Label htmlFor="edit-nome">Nome *</Label>
            <Input id="edit-nome" value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="edit-cnpj">CNPJ</Label>
            <Input id="edit-cnpj" value={cnpj} onChange={(e) => setCnpj(e.target.value)} maxLength={18} />
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
            <div className="mt-2 space-y-2 rounded-md border p-3">
              {MODULE_TOGGLES.map((m) => {
                const locked = m.key === "cadastro";
                return (
                  <div key={m.key} className="flex items-center justify-between">
                    <span className="text-sm">
                      {m.label}
                      {locked && <span className="text-xs text-muted-foreground"> (sempre ativo)</span>}
                    </span>
                    <Switch
                      checked={locked ? true : !!modules[m.key]}
                      disabled={locked}
                      onCheckedChange={(checked) =>
                        setModules((prev) => ({ ...prev, [m.key]: checked }))
                      }
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Só os módulos ligados aparecem para a loja. Apenas Cadastro + Entrada e Saída = modo só-estoque.
            </p>
          </div>
        </div>
        <DialogFooter className="max-sm:shrink-0 max-sm:flex-row max-sm:items-center max-sm:border-t max-sm:bg-background max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3">
          <Button type="button" variant="outline" className="max-sm:hidden" onClick={onClose}>Cancelar</Button>
          <Button type="button" variant="outline" size="icon" aria-label="Voltar" className="shrink-0 sm:hidden" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button type="submit" className="max-sm:ml-auto" disabled={submitting}>{submitting ? "Salvando…" : "Salvar"}</Button>
        </DialogFooter>
      </form>

      {/* Confirmação: trocar módulos habilitados afeta o que a loja inteira enxerga. */}
      <AlertDialog open={confirmModules} onOpenChange={setConfirmModules}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alterar os módulos da loja “{tenant.nome}”?</AlertDialogTitle>
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
    </DialogContent>
  );
}
