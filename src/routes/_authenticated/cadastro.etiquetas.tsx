import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tag, Plus, Pencil, Trash2, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
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
import { RequirePermission, useReadOnly } from "@/components/RequirePermission";

export const Route = createFileRoute("/_authenticated/cadastro/etiquetas")({
  component: () => (
    <RequirePermission page="cadastro_etiquetas">
      <EtiquetasPage />
    </RequirePermission>
  ),
});

type Etiqueta = { id: string; nome: string; tamanho: string | null };

// Mesma grade padrão usada no CAD/Configurações quando a loja ainda não salvou.
const DEFAULT_TAMANHOS = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];

// "38|P" -> "P · 38"
const fmtTamanho = (t: string) => {
  const [num, sig] = t.split("|");
  return sig ? `${sig} · ${num}` : t;
};

function EtiquetasPage() {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const tenantId = useActiveTenantId();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Etiqueta | null>(null);
  const [formNome, setFormNome] = useState("");
  const [formTamanho, setFormTamanho] = useState("");
  const [deleteRow, setDeleteRow] = useState<Etiqueta | null>(null);

  const { data: etiquetas = [], isLoading } = useQuery({
    queryKey: ["etiquetas-cadastro"],
    queryFn: async () => {
      const { data, error } = await supabase.from("etiquetas" as any).select("id, nome, tamanho").order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as Etiqueta[];
    },
  });

  // Tamanhos da grade configurada na loja; cai no padrão se ainda não houver config.
  const { data: tamanhos = [] } = useQuery({
    queryKey: ["tenant-tamanhos-grade", tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data } = await supabase.from("tenant_config").select("tamanhos_grade").eq("tenant_id", tenantId).limit(1);
      const raw = (data ?? [])[0]?.tamanhos_grade as any;
      const list = Array.isArray(raw) && raw.length > 0
        ? raw.map((x: any) => (typeof x === "string" ? x : (x?.nome ?? x?.label ?? String(x))))
        : DEFAULT_TAMANHOS;
      return list as string[];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return etiquetas;
    return etiquetas.filter((e) => e.nome.toLowerCase().includes(s));
  }, [etiquetas, search]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["etiquetas-cadastro"] });
    qc.invalidateQueries({ queryKey: ["etiquetas-opts"] }); // select do CAD
  };

  const openCreate = () => { setEditing(null); setFormNome(""); setFormTamanho(""); setOpen(true); };
  const openEdit = (e: Etiqueta) => { setEditing(e); setFormNome(e.nome); setFormTamanho(e.tamanho ?? ""); setOpen(true); };

  const saveMut = useMutation({
    mutationFn: async () => {
      const v = formNome.trim();
      if (!v) throw new Error("Informe o nome da etiqueta.");
      const payload = { nome: v, tamanho: formTamanho || null };
      if (editing) {
        const { error } = await supabase.from("etiquetas" as any).update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("etiquetas" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Etiqueta atualizada." : "Etiqueta criada.");
      setOpen(false);
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Etiqueta já existe." : mensagemErro(e, "Erro ao salvar.")),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("etiquetas" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Excluída.");
      setDeleteRow(null);
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.code === "23503" ? "Etiqueta em uso em algum CAD. Remova de lá antes." : mensagemErro(e, "Erro ao excluir.")),
  });

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex items-start gap-3">
        <Tag className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">TAG/Etiquetas</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro de tags / etiquetas. Atrele um tamanho para calcular a quantidade pela grade no CAD.
          </p>
        </div>
      </header>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar etiquetas…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate} className="max-sm:hidden" disabled={readOnly}>
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tamanho</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                  Nenhuma etiqueta encontrada.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <button type="button" className="text-left hover:underline" onClick={() => openEdit(e)}>
                      {e.nome}
                    </button>
                  </TableCell>
                  <TableCell>
                    {e.tamanho ? <Badge variant="secondary">{fmtTamanho(e.tamanho)}</Badge> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(e)} aria-label="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleteRow(e)} disabled={readOnly} aria-label="Excluir">
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

      {/* Criar / editar */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar etiqueta" : "Nova etiqueta"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                autoFocus
                value={formNome}
                onChange={(e) => setFormNome(e.target.value)}
                placeholder="Ex: Etiqueta de composição"
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveMut.mutate(); } }}
                disabled={readOnly}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tamanho (opcional)</Label>
              <Select value={formTamanho || "none"} onValueChange={(v) => setFormTamanho(v === "none" ? "" : v)} disabled={readOnly}>
                <SelectTrigger><SelectValue placeholder="Sem tamanho" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem tamanho</SelectItem>
                  {tamanhos.map((t) => <SelectItem key={t} value={t}>{fmtTamanho(t)}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Atrelado a um tamanho, a Qtd Planejada no CAD = consumo × grade desse tamanho.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            {!readOnly && (
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Salvando…" : "Salvar"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir etiqueta?</AlertDialogTitle>
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

      <MobileActionBar>
        <Button onClick={openCreate} className="ml-auto" disabled={readOnly}>
          <Plus className="h-4 w-4 mr-1" /> Novo
        </Button>
      </MobileActionBar>
    </div>
  );
}
