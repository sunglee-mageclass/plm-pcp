import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapPin, Plus, Pencil, Trash2, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { RequirePermission } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/cadastro/destinos")({
  component: () => (
    <RequirePermission page="cadastro_destinos">
      <DestinosPage />
    </RequirePermission>
  ),
});

type Destino = { id: string; nome: string };

function DestinosPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Destino | null>(null);
  const [formNome, setFormNome] = useState("");
  const [deleteRow, setDeleteRow] = useState<Destino | null>(null);

  const { data: destinos = [], isLoading } = useQuery({
    queryKey: ["destinos-saida"],
    queryFn: async () => {
      const { data, error } = await supabase.from("destinos_saida" as any).select("id, nome").order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as Destino[];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return destinos;
    return destinos.filter((d) => d.nome.toLowerCase().includes(s));
  }, [destinos, search]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["destinos-saida"] });

  const openCreate = () => { setEditing(null); setFormNome(""); setOpen(true); };
  const openEdit = (d: Destino) => { setEditing(d); setFormNome(d.nome); setOpen(true); };

  const saveMut = useMutation({
    mutationFn: async () => {
      const v = formNome.trim();
      if (!v) throw new Error("Informe o nome do destino.");
      if (editing) {
        const { error } = await supabase.from("destinos_saida" as any).update({ nome: v }).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("destinos_saida" as any).insert({ nome: v });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Destino atualizado." : "Destino criado.");
      setOpen(false);
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Destino já existe." : e.message ?? "Erro ao salvar."),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("destinos_saida" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Excluído.");
      setDeleteRow(null);
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.code === "23503" ? "Destino em uso em alguma Ordem de Saída. Remova de lá antes." : e.message ?? "Erro ao excluir."),
  });

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6">
      <header className="flex items-center gap-3">
        <MapPin className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Destinos</h1>
          <p className="text-sm text-muted-foreground">
            Para onde a Ordem de Saída foi enviada (ex.: Novidade, Repetição, Devolução).
          </p>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar destinos…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">
                  Nenhum destino cadastrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((d) => (
                <TableRow key={d.id}>
                  <TableCell>
                    <button type="button" className="text-left hover:underline" onClick={() => openEdit(d)}>
                      {d.nome}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(d)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleteRow(d)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
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

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar destino" : "Novo destino"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                autoFocus
                value={formNome}
                onChange={(e) => setFormNome(e.target.value)}
                placeholder="Ex: Novidade"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveMut.mutate(); } }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir destino?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{deleteRow?.nome}</strong>?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); if (deleteRow) delMut.mutate(deleteRow.id); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
