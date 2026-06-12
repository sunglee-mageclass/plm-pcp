import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, Plus, KeyRound, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  createTenantUser, resetUserPassword, toggleUserAtivo,
} from "@/lib/admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

const ROLES = ["super_admin", "admin", "user"] as const;
const roleBadge = (role: string) => {
  if (role === "super_admin") return <Badge className="bg-amber-500 hover:bg-amber-600">Super Admin</Badge>;
  if (role === "admin") return <Badge className="bg-blue-500 hover:bg-blue-600">Admin</Badge>;
  return <Badge variant="secondary">Usuário</Badge>;
};

function UsuariosPage() {
  const { isSuperAdmin, loading } = useAuth();
  const qc = useQueryClient();
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [resetting, setResetting] = useState<AppUser | null>(null);

  const callToggle = useServerFn(toggleUserAtivo);
  const callReset = useServerFn(resetUserPassword);

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

  const toggle = useMutation({
    mutationFn: (v: { user_id: string; ativo: boolean }) => callToggle({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      toast.success("Status atualizado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (loading) return null;
  if (!isSuperAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Gerenciar Usuários</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Crie e administre usuários de todas as lojas.
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> Novo Usuário</Button>
          </DialogTrigger>
          <NovoUsuarioModal tenants={tenants} onClose={() => setOpen(false)} />
        </Dialog>
      </div>

      <div className="max-w-sm">
        <Label className="text-xs text-muted-foreground">Filtrar por loja</Label>
        <Select value={tenantFilter} onValueChange={setTenantFilter}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as lojas</SelectItem>
            {tenants.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Loja</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">Carregando…</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">Nenhum usuário encontrado.</TableCell></TableRow>
            ) : (
              filtered.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.nome}</TableCell>
                  <TableCell className="text-sm">{u.email}</TableCell>
                  <TableCell className="text-sm">{u.tenant_id ? tenantMap[u.tenant_id] ?? "—" : "—"}</TableCell>
                  <TableCell>{roleBadge(u.role)}</TableCell>
                  <TableCell>
                    {u.ativo
                      ? <Badge className="bg-emerald-500 hover:bg-emerald-600">Ativo</Badge>
                      : <Badge variant="destructive">Inativo</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setResetting(u)}>
                        <KeyRound className="h-4 w-4" />
                      </Button>
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
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent>
      <form onSubmit={onSubmit}>
        <DialogHeader><DialogTitle>Novo Usuário</DialogTitle></DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="nome">Nome *</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="email">Email *</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="password">Senha * (mín. 6)</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} maxLength={100} />
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
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="super_admin">Super Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={submitting}>{submitting ? "Salvando…" : "Criar"}</Button>
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
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent>
      <form onSubmit={onSubmit}>
        <DialogHeader>
          <DialogTitle>Redefinir senha — {user.nome}</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-2">
          <Label htmlFor="pwd">Nova senha (mín. 6)</Label>
          <Input id="pwd" type="password" minLength={6} maxLength={100} required value={pwd} onChange={(e) => setPwd(e.target.value)} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={submitting}>{submitting ? "Salvando…" : "Redefinir"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
