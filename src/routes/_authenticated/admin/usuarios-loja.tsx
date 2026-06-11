import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { createStoreUser, savePermissions } from "@/lib/tenant-admin.functions";
import { PAGES_CATALOG, ALL_PAGE_KEYS } from "@/lib/permissions-catalog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/admin/usuarios-loja")({
  component: UsuariosLojaPage,
});

type LojaUser = {
  id: string;
  nome: string;
  email: string;
  role: string;
  ativo: boolean;
};

function UsuariosLojaPage() {
  const { isTenantAdmin, isSuperAdmin, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const [permUser, setPermUser] = useState<LojaUser | null>(null);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["loja", "users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id,nome,email,role,ativo")
        .order("nome");
      if (error) throw error;
      return data as LojaUser[];
    },
    enabled: isTenantAdmin || isSuperAdmin,
  });

  if (loading) return null;
  if (!isTenantAdmin && !isSuperAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Usuários da Minha Loja</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Crie usuários e configure quais páginas eles podem acessar.
            </p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> Novo Usuário</Button>
          </DialogTrigger>
          <NovoUsuarioModal onClose={() => setOpen(false)} />
        </Dialog>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Carregando…</TableCell></TableRow>
            ) : users.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Nenhum usuário.</TableCell></TableRow>
            ) : (
              users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.nome}</TableCell>
                  <TableCell className="text-sm">{u.email}</TableCell>
                  <TableCell><Badge variant="secondary">{u.role}</Badge></TableCell>
                  <TableCell>
                    {u.ativo
                      ? <Badge className="bg-emerald-500 hover:bg-emerald-600">Ativo</Badge>
                      : <Badge variant="destructive">Inativo</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setPermUser(u)}>
                      <ShieldCheck className="h-4 w-4" /> Permissões
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!permUser} onOpenChange={(v) => !v && setPermUser(null)}>
        {permUser && <PermissoesModal user={permUser} onClose={() => setPermUser(null)} />}
      </Dialog>
    </div>
  );
}

function NovoUsuarioModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const call = useServerFn(createStoreUser);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await call({ data: { nome, email, password } });
      toast.success("Usuário criado");
      qc.invalidateQueries({ queryKey: ["loja", "users"] });
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
            <Label htmlFor="pwd">Senha * (mín. 6)</Label>
            <Input id="pwd" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} maxLength={100} />
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

type PermState = Record<string, { pode_ver: boolean; pode_editar: boolean }>;

function PermissoesModal({ user, onClose }: { user: LojaUser; onClose: () => void }) {
  const call = useServerFn(savePermissions);
  const qc = useQueryClient();

  const { data: existing = [], isLoading } = useQuery({
    queryKey: ["loja", "perms", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_permissions")
        .select("pagina,pode_ver,pode_editar")
        .eq("user_id", user.id);
      if (error) throw error;
      return data as { pagina: string; pode_ver: boolean; pode_editar: boolean }[];
    },
  });

  const initial = useMemo<PermState>(() => {
    const base: PermState = {};
    for (const key of ALL_PAGE_KEYS) base[key] = { pode_ver: false, pode_editar: false };
    for (const p of existing) {
      base[p.pagina] = { pode_ver: !!p.pode_ver, pode_editar: !!p.pode_editar };
    }
    return base;
  }, [existing]);

  const [state, setState] = useState<PermState>(initial);
  const [submitting, setSubmitting] = useState(false);

  // Sync state when initial loads
  useMemo(() => setState(initial), [initial]);

  const toggle = (key: string, field: "pode_ver" | "pode_editar", v: boolean) => {
    setState((s) => {
      const next = { ...s, [key]: { ...s[key], [field]: v } };
      // Editar implica ver
      if (field === "pode_editar" && v) next[key].pode_ver = true;
      if (field === "pode_ver" && !v) next[key].pode_editar = false;
      return next;
    });
  };

  const onSave = async () => {
    setSubmitting(true);
    try {
      const perms = ALL_PAGE_KEYS
        .map((k) => ({ pagina: k, ...state[k] }))
        .filter((p) => p.pode_ver || p.pode_editar);
      await call({ data: { user_id: user.id, perms } });
      toast.success("Permissões salvas");
      qc.invalidateQueries({ queryKey: ["loja", "perms", user.id] });
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Permissões — {user.nome}</DialogTitle>
      </DialogHeader>
      <div className="space-y-6 py-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : (
          PAGES_CATALOG.map((m) => (
            <div key={m.module}>
              <h3 className="text-sm font-semibold mb-2">{m.label}</h3>
              <div className="border rounded-md divide-y">
                <div className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 text-xs text-muted-foreground bg-muted/40">
                  <span>Página</span>
                  <span className="text-center">Ver</span>
                  <span className="text-center">Editar</span>
                </div>
                {m.pages.map((p) => (
                  <div key={p.key} className="grid grid-cols-[1fr_80px_80px] gap-2 px-3 py-2 items-center">
                    <Label htmlFor={`${p.key}-ver`} className="text-sm font-normal cursor-pointer">{p.label}</Label>
                    <div className="flex justify-center">
                      <Checkbox
                        id={`${p.key}-ver`}
                        checked={state[p.key]?.pode_ver ?? false}
                        onCheckedChange={(v) => toggle(p.key, "pode_ver", !!v)}
                      />
                    </div>
                    <div className="flex justify-center">
                      <Checkbox
                        checked={state[p.key]?.pode_editar ?? false}
                        onCheckedChange={(v) => toggle(p.key, "pode_editar", !!v)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={onSave} disabled={submitting}>{submitting ? "Salvando…" : "Salvar"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
