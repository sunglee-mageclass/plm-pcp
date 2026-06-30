import { SkeletonTableRow } from "@/components/shared/Skeletons";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Users, Plus, ShieldCheck, LogOut, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { isEmail } from "@/lib/email";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { createStoreUser, deleteStoreUser } from "@/lib/tenant-admin.functions";
import { PermissoesModal } from "@/components/admin/PermissoesModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RoleBadge } from "@/components/shared/RoleBadge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useSort, SortHead } from "@/components/shared/sort";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

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
  const { isTenantAdmin, isSuperAdmin, loading, user } = useAuth();
  const qc = useQueryClient();
  const callDelete = useServerFn(deleteStoreUser);
  const [open, setOpen] = useState(false);
  const [permUser, setPermUser] = useState<LojaUser | null>(null);
  const [deleting, setDeleting] = useState<LojaUser | null>(null);

  const forceLogout = useMutation({
    mutationFn: async (user_id: string) => {
      const { error } = await supabase.rpc("forcar_logout" as any, { _user_id: user_id });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Logout forçado — o usuário cai no próximo refresh/reload."),
    onError: (e: Error) => toast.error(mensagemErro(e, "Erro ao forçar logout")),
  });
  const delMut = useMutation({
    mutationFn: (user_id: string) => callDelete({ data: { user_id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loja", "users"] });
      toast.success("Usuário excluído");
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["loja", "users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id,nome,email,role,ativo")
        .neq("role", "super_admin")
        .order("nome");
      if (error) throw error;
      return data as LojaUser[];
    },
    enabled: isTenantAdmin || isSuperAdmin,
  });

  const { sorted, sortKey, sortDir, toggle } = useSort(users, { key: "nome" });
  const s = { sortKey, sortDir, toggle };

  if (loading) return null;
  if (!isTenantAdmin && !isSuperAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <Users className="h-7 w-7 text-primary mt-0.5 shrink-0" />
          <div>
            <h1 className="text-2xl font-bold">Usuários da Minha Loja</h1>
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
        <Table className="card-table">
          <TableHeader>
            <TableRow>
              <SortHead label="Nome" sortKey="nome" sortState={s} />
              <SortHead label="Email" sortKey="email" sortState={s} />
              <SortHead label="Role" sortKey="role" sortState={s} />
              <SortHead label="Status" sortKey="ativo" sortState={s} />
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <SkeletonTableRow cols={5} />
            ) : sorted.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">Nenhum usuário.</TableCell></TableRow>
            ) : (
              sorted.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.nome}</TableCell>
                  <TableCell data-label="Email" className="text-sm">{u.email}</TableCell>
                  <TableCell data-label="Role"><RoleBadge role={u.role} /></TableCell>
                  <TableCell data-label="Status">
                    {u.ativo
                      ? <Badge className="bg-emerald-500 hover:bg-emerald-600">Ativo</Badge>
                      : <Badge variant="destructive">Inativo</Badge>}
                  </TableCell>
                  <TableCell data-label="Ações" className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="outline" onClick={() => setPermUser(u)}>
                        <ShieldCheck className="h-4 w-4" /> Permissões
                      </Button>
                      {user?.id !== u.id && (
                        <Button size="sm" variant="ghost" onClick={() => forceLogout.mutate(u.id)} disabled={forceLogout.isPending} title="Forçar logout">
                          <LogOut className="h-4 w-4" />
                        </Button>
                      )}
                      {user?.id !== u.id && (
                        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleting(u)} title="Excluir">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!permUser} onOpenChange={(v) => !v && setPermUser(null)}>
        {permUser && <PermissoesModal mode="tenant" user={permUser} onClose={() => setPermUser(null)} />}
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove "{deleting?.nome}" da sua loja. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleting && delMut.mutate(deleting.id)}
              disabled={delMut.isPending}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
    if (!isEmail(email)) {
      toast.error("E-mail inválido — use um endereço completo (ex.: nome@empresa.com).");
      return;
    }
    setSubmitting(true);
    try {
      await call({ data: { nome, email, password } });
      toast.success("Usuário criado");
      qc.invalidateQueries({ queryKey: ["loja", "users"] });
      onClose();
    } catch (err) {
      toast.error(mensagemErro(err));
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
            <Input id="nome" autoComplete="off" value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="email">Email *</Label>
            <Input id="email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} />
          </div>
          <div>
            <Label htmlFor="pwd">Senha * (mín. 6)</Label>
            <Input id="pwd" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} maxLength={100} />
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
