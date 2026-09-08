// #4d — Gestão de PAPÉIS (presets de permissão reutilizáveis POR LOJA), dentro de Gerenciar
// Usuários. Lista + Novo/Editar/Excluir; o editor de cada papel é o PapelEditor (mesma grade do
// PermissoesModal). tenantId = loja-alvo (própria loja no tenant_admin; loja ativa/selecionada no super).
import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { excluirPapel } from "@/lib/papeis.functions";
import { PapelEditor } from "@/components/admin/PermissoesModal";
import { Plus, Pencil, Trash2, ShieldHalf } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";

export type Papel = { id: string; nome: string; descricao: string | null; tenant_id: string };

export function usePapeis(tenantId: string | null | undefined) {
  return useQuery({
    queryKey: ["papeis", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("papeis")
        .select("id,nome,descricao,tenant_id")
        .eq("tenant_id", tenantId!) // enabled: !!tenantId garante presença em runtime
        .order("nome");
      if (error) throw error;
      return data as Papel[];
    },
  });
}

export function GerenciarPapeisDialog({
  tenantId, open, onClose,
}: { tenantId: string; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const callExcluir = useServerFn(excluirPapel);
  const { data: papeis = [], isLoading } = usePapeis(tenantId);
  const [editing, setEditing] = useState<{ id: string | null; nome: string; descricao: string | null } | null>(null);
  const [deleting, setDeleting] = useState<Papel | null>(null);

  const delMut = useMutation({
    mutationFn: (p: Papel) => callExcluir({ data: { id: p.id, tenant_id: tenantId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["papeis", tenantId] });
      toast.success("Papel excluído");
      setDeleting(null);
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <ShieldHalf className="h-5 w-5 text-primary" />
              <DialogTitle>Papéis da loja</DialogTitle>
            </div>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Papéis são conjuntos de permissões reutilizáveis. Vincule um usuário a um papel na
            coluna <strong>Papel</strong>; exceções por usuário sobrepõem o papel.
          </p>
          <div className="border rounded-md divide-y max-h-[50vh] overflow-y-auto">
            {isLoading ? (
              <p className="text-sm text-muted-foreground p-3">Carregando…</p>
            ) : papeis.length === 0 ? (
              <p className="text-sm text-muted-foreground p-3">Nenhum papel ainda. Crie o primeiro.</p>
            ) : (
              papeis.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.nome}</p>
                    {p.descricao && <p className="text-xs text-muted-foreground truncate">{p.descricao}</p>}
                  </div>
                  <Button size="iconSm" variant="ghost" title="Editar" aria-label="Editar papel"
                    onClick={() => setEditing({ id: p.id, nome: p.nome, descricao: p.descricao })}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="iconSm" variant="ghost" title="Excluir" aria-label="Excluir papel"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleting(p)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
          <div className="flex justify-end pt-2">
            <Button onClick={() => setEditing({ id: null, nome: "", descricao: null })}>
              <Plus className="h-4 w-4" /> Novo papel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {editing && (
        <PapelEditor
          papel={{ ...editing, tenant_id: tenantId }}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["papeis", tenantId] })}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir papel?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove o papel "{deleting?.nome}". Se houver usuários vinculados, a exclusão é
              bloqueada — troque o papel deles antes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive"
              onClick={() => deleting && delMut.mutate(deleting)} disabled={delMut.isPending}>
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Dropdown de papel de UM usuário (na tabela/linha). Vincula/desvincula via definir_papel_usuario.
import { definirPapelUsuario } from "@/lib/papeis.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SEM_PAPEL = "__sem__";

export function PapelSelect({
  userId, tenantId, papelId, onChanged,
}: {
  userId: string;
  tenantId: string;
  papelId: string | null;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const { data: papeis = [] } = usePapeis(tenantId);
  const callDefinir = useServerFn(definirPapelUsuario);
  const mut = useMutation({
    mutationFn: (novo: string | null) =>
      callDefinir({ data: { user_id: userId, papel_id: novo, tenant_id: tenantId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["loja", "users"] });
      toast.success("Papel do usuário atualizado");
      onChanged?.();
    },
    onError: (e: Error) => toast.error(mensagemErro(e)),
  });

  return (
    <Select
      value={papelId ?? SEM_PAPEL}
      onValueChange={(v) => mut.mutate(v === SEM_PAPEL ? null : v)}
      disabled={mut.isPending}
    >
      <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="Sem papel" /></SelectTrigger>
      <SelectContent>
        <SelectItem value={SEM_PAPEL}>Sem papel</SelectItem>
        {papeis.map((p) => (
          <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
