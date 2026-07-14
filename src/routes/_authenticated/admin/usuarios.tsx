import { SkeletonTableRow } from "@/components/shared/Skeletons";
import { filtroAtivoClass } from "@/components/shared/filters";
import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, Plus, KeyRound, ShieldCheck, ArrowLeft, Pencil, Trash2, LogOut } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  createTenantUser, updateUser, deleteUser, resetUserPassword, toggleUserAtivo,
} from "@/lib/admin.functions";
import { isEmail } from "@/lib/email";
import { PermissoesModal } from "@/components/admin/PermissoesModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { RoleBadge } from "@/components/shared/RoleBadge";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { useSort, SortHead } from "@/components/shared/sort";

export const Route = createFileRoute("/_authenticated/admin/usuarios")({
  component: UsuariosPage,
});

type AppUser = {
  id: string;
  nome: string;
  email: string;
  tenant_id: string | null;
  role: string;
  ativo: boolean;
};
type Tenant = { id: string; nome: string };

const ROLES = ["super_admin", "admin", "tenant_admin", "user"] as const;

function UsuariosPage() {
  const { isSuperAdmin, loading, user } = useAuth();
  const qc = useQueryClient();
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState<AppUser | null>(null);
  const [permUser, setPermUser] = useState<AppUser | null>(null);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [deleting, setDeleting] = useState<AppUser | null>(null);

  const callToggle = useServerFn(toggleUserAtivo);
  const callReset = useServerFn(resetUserPassword);
  const callDelete = useServerFn(deleteUser);

  const { data: tenants = [] } = useQuery({
    queryKey: ["admin", "tenants-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("id,nome").order("nome");
      if (error) throw error;
      return data as Tenant[];
    },
    enabled: isSuperAdmin,
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id,nome,email,tenant_id,role,ativo")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AppUser[];
    },
    enabled: isSuperAdmin,
  });

  const tenantMap = useMemo(
    () => Object.fromEntries(tenants.map((t) => [t.id, t.nome])),
    [tenants],
  );
  const filtered = useMemo(
    () => users.filter((u) => tenantFilter === "all" || u.tenant_id === tenantFilter),
    [users, tenantFilter],
  );
  const sortAccessors = useMemo(
    () => ({ loja: (u: AppUser) => (u.tenant_id ? tenantMap[u.tenant_id] ?? "" : "") }),
    [tenantMap],
  );
  const { sorted, sortKey, sortDir, toggle: sortToggle } = useSort(filtered, {
    key: "nome",
    accessors: sortAccessors,
  });
  const sortState = { sortKey, sortDir, toggle: sortToggle };

  const toggle = useMutation({
    mutationFn: (v: { user_id: string; ativo: boolean }) => callToggle({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success("Status atualizado");
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const del = useMutation({
    mutationFn: (user_id: string) => callDelete({ data: { user_id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success("Usuário excluído");
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const forceLogout = useMutation({
    mutationFn: async (user_id: string) => {
      const { error } = await supabase.rpc("forcar_logout" as any, { _user_id: user_id });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Logout forçado — o usuário cai no próximo refresh/reload."),
    onError: (e: Error) => toast.error(mensagemErro(e, "Erro ao forçar logout")),
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
          <Users className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Gerenciar Usuários</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Crie e administre usuários de todas as lojas.
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="max-sm:hidden"><Plus className="h-4 w-4" /> Novo Usuário</Button>
          </DialogTrigger>
          <NovoUsuarioModal tenants={tenants} onClose={() => setOpen(false)} />
        </Dialog>
      </div>

      <div className="max-w-sm">
        <Label className="text-xs text-muted-foreground">Filtrar por loja</Label>
        <Select value={tenantFilter} onValueChange={setTenantFilter}>
          <SelectTrigger className={filtroAtivoClass(tenantFilter !== "all")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as lojas</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg">
        <Table className="card-table">
          <TableHeader>
            <TableRow>
              <SortHead label="Nome" sortKey="nome" sortState={sortState} />
              <SortHead label="Email" sortKey="email" sortState={sortState} />
              <SortHead label="Loja" sortKey="loja" sortState={sortState} />
              <SortHead label="Role" sortKey="role" sortState={sortState} />
              <SortHead label="Status" sortKey="ativo" sortState={sortState} />
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonTableRow cols={6} />
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">Nenhum usuário encontrado.</TableCell></TableRow>
            ) : (
              sorted.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.nome}</TableCell>
                  <TableCell data-label="Email" className="text-sm">{u.email}</TableCell>
                  <TableCell data-label="Loja" className="text-sm">{u.tenant_id ? tenantMap[u.tenant_id] ?? "—" : "—"}</TableCell>
                  <TableCell data-label="Role"><RoleBadge role={u.role} /></TableCell>
                  <TableCell data-label="Status">
                    {u.ativo
                      ? <StatusBadge tone="success">Ativo</StatusBadge>
                      : <StatusBadge tone="danger">Inativo</StatusBadge>}
                  </TableCell>
                  <TableCell data-label="Ações" className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(u)} title="Editar">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      {u.tenant_id && u.role !== "super_admin" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPermUser(u)}
                          title="Permissões"
                        >
                          <ShieldCheck className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setResetting(u)} title="Redefinir senha">
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      {u.role !== "super_admin" && (
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(u)} title="Excluir">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      {user?.id !== u.id && (
                        <Button size="sm" variant="ghost" onClick={() => forceLogout.mutate(u.id)} disabled={forceLogout.isPending} title="Forçar logout">
                          <LogOut className="h-4 w-4" />
                        </Button>
                      )}
                      <Switch
                        checked={u.ativo}
                        onCheckedChange={(c) => toggle.mutate({ user_id: u.id, ativo: c })}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!resetting} onOpenChange={(v) => !v && setResetting(null)}>
        {resetting && (
          <ResetSenhaModal
            user={resetting}
            onClose={() => setResetting(null)}
            call={callReset}
          />
        )}
      </Dialog>

      <Dialog open={!!permUser} onOpenChange={(v) => !v && setPermUser(null)}>
        {permUser && (
          <PermissoesModal
            mode="super"
            user={{ id: permUser.id, nome: permUser.nome, tenant_id: permUser.tenant_id, role: permUser.role }}
            onClose={() => setPermUser(null)}
          />
        )}
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        {editing && <EditUsuarioModal tenants={tenants} user={editing} onClose={() => setEditing(null)} />}
      </Dialog>

      <Dialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        {deleting && (
          <DialogContent>
            <DialogHeader><DialogTitle>Excluir usuário</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground py-2">
              Excluir <strong>{deleting.nome}</strong> ({deleting.email})? Remove o acesso de vez.
              O histórico de auditoria é preservado (mostra o nome de quem agiu).
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(null)}>Cancelar</Button>
              <Button variant="destructive" onClick={() => del.mutate(deleting.id)} disabled={del.isPending}>
                {del.isPending ? "Excluindo…" : "Excluir"}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      <MobileActionBar>
        <Button asChild variant="outline" size="icon" aria-label="Voltar">
          <Link to="/admin"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <Button className="ml-auto" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Novo Usuário
        </Button>
      </MobileActionBar>
    </div>
  );
}

function NovoUsuarioModal({
  tenants, onClose,
}: { tenants: Tenant[]; onClose: () => void }) {
  const qc = useQueryClient();
  const call = useServerFn(createTenantUser);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState<string>("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("user");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) {
      toast.error("E-mail inválido — use um endereço completo (ex.: nome@empresa.com).");
      return;
    }
    if (!tenantId) {
      toast.error("Selecione uma loja");
      return;
    }
    setSubmitting(true);
    try {
      await call({ data: { nome, email, password, tenant_id: tenantId, role } });
      toast.success("Usuário criado");
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
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
        <DialogHeader className="max-sm:shrink-0"><DialogTitle>Novo Usuário</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4 max-sm:min-h-0 max-sm:min-w-0 max-sm:overflow-y-auto">
          <div>
            <Label htmlFor="nome">Nome *</Label>
            <Input id="nome" autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="email">Email *</Label>
            <Input id="email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="password">Senha * (mín. 6)</Label>
            <Input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} maxLength={100} />
          </div>
          <div>
            <Label>Loja *</Label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Role *</Label>
            <Select value={role} onValueChange={(v) => setRole(v as (typeof ROLES)[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Usuário</SelectItem>
                <SelectItem value="tenant_admin">Admin da Loja</SelectItem>
                <SelectItem value="super_admin">Super Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="max-sm:shrink-0 max-sm:flex-row max-sm:items-center max-sm:border-t max-sm:bg-background max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3">
          <Button type="button" variant="outline" className="max-sm:hidden" onClick={onClose}>Cancelar</Button>
          <Button type="button" variant="outline" size="icon" aria-label="Voltar" className="shrink-0 sm:hidden" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button type="submit" className="max-sm:ml-auto" disabled={submitting}>{submitting ? "Salvando…" : "Criar"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function EditUsuarioModal({
  tenants, user, onClose,
}: { tenants: Tenant[]; user: AppUser; onClose: () => void }) {
  const qc = useQueryClient();
  const call = useServerFn(updateUser);
  const [nome, setNome] = useState(user.nome);
  const [email, setEmail] = useState(user.email);
  const [tenantId, setTenantId] = useState<string>(user.tenant_id ?? "");
  const [role, setRole] = useState<(typeof ROLES)[number]>(user.role as (typeof ROLES)[number]);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEmail(email)) {
      toast.error("E-mail inválido — use um endereço completo (ex.: nome@empresa.com).");
      return;
    }
    if (role !== "super_admin" && !tenantId) {
      toast.error("Selecione uma loja");
      return;
    }
    setSubmitting(true);
    try {
      await call({ data: { user_id: user.id, nome, email, role, tenant_id: role === "super_admin" ? null : tenantId } });
      toast.success("Usuário atualizado");
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
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
        <DialogHeader className="max-sm:shrink-0"><DialogTitle>Editar usuário</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4 max-sm:min-h-0 max-sm:min-w-0 max-sm:overflow-y-auto">
          <div>
            <Label htmlFor="edit-nome">Nome *</Label>
            <Input id="edit-nome" autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="edit-email">Email *</Label>
            <Input id="edit-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label>Loja {role !== "super_admin" ? "*" : ""}</Label>
            <Select value={tenantId} onValueChange={setTenantId} disabled={role === "super_admin"}>
              <SelectTrigger><SelectValue placeholder={role === "super_admin" ? "Global (super admin)" : "Selecione…"} /></SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Role *</Label>
            <Select value={role} onValueChange={(v) => setRole(v as (typeof ROLES)[number])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">Usuário</SelectItem>
                <SelectItem value="tenant_admin">Admin da Loja</SelectItem>
                <SelectItem value="super_admin">Super Admin</SelectItem>
              </SelectContent>
            </Select>
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

function ResetSenhaModal({
  user, onClose, call,
}: {
  user: AppUser;
  onClose: () => void;
  call: (args: { data: { user_id: string; new_password: string } }) => Promise<unknown>;
}) {
  const [pwd, setPwd] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await call({ data: { user_id: user.id, new_password: pwd } });
      toast.success("Senha redefinida");
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
          <DialogTitle>Redefinir senha — {user.nome}</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-2 max-sm:min-h-0 max-sm:min-w-0 max-sm:overflow-y-auto">
          <Label htmlFor="pwd">Nova senha (mín. 6)</Label>
          <Input id="pwd" type="password" autoComplete="new-password" minLength={6} maxLength={100} required value={pwd} onChange={(e) => setPwd(e.target.value)} />
        </div>
        <DialogFooter className="max-sm:shrink-0 max-sm:flex-row max-sm:items-center max-sm:border-t max-sm:bg-background max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3">
          <Button type="button" variant="outline" className="max-sm:hidden" onClick={onClose}>Cancelar</Button>
          <Button type="button" variant="outline" size="icon" aria-label="Voltar" className="shrink-0 sm:hidden" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button type="submit" className="max-sm:ml-auto" disabled={submitting}>{submitting ? "Salvando…" : "Redefinir"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
