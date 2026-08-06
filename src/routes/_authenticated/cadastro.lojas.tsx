import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Store, Plus, Pencil, Trash2, Search, Loader2, ArrowLeft, Lock } from "lucide-react";
import { toast } from "sonner";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useSort, SortHead } from "@/components/shared/sort";
import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";

export const Route = createFileRoute("/_authenticated/cadastro/lojas")({
  component: () => (
    <RequirePermission page="cadastro_lojas">
      <LojasPage />
    </RequirePermission>
  ),
});

type Loja = { id: string; nome: string; ativo: boolean; is_default: boolean; ordem: number | null };

function LojasPage() {
  const qc = useQueryClient();
  const pageReadOnly = useReadOnly();
  const { isTenantAdmin, isSuperAdmin } = useAuth();
  // Escrita em lojas_direcionamento exige tenant_admin/super_admin no banco (RLS de
  // escrita + excluir_loja_direcionamento) — quem tem canEdit da PÁGINA (permissão
  // explícita) mas não é admin da loja cairia num beco-sem-saída (formulário liberado,
  // Salvar/Excluir estourando erro de RLS). Trata como somente-leitura aqui também, com
  // aviso próprio (o banner genérico da RequirePermission só cobre o caso sem canEdit).
  const isAdminLoja = isTenantAdmin || isSuperAdmin;
  const readOnly = pageReadOnly || !isAdminLoja;
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Loja | null>(null);
  const [formNome, setFormNome] = useState("");
  const [formOrdem, setFormOrdem] = useState("");
  const [formAtivo, setFormAtivo] = useState(true);
  const [deleteRow, setDeleteRow] = useState<Loja | null>(null);

  const createDirty = createOpen && (formNome !== "" || formOrdem !== "");
  const editDirty =
    !!editing &&
    (formNome !== editing.nome ||
      formOrdem !== String(editing.ordem ?? "") ||
      formAtivo !== editing.ativo);
  const dirty = createDirty || editDirty;
  const { requestClose, confirm } = useUnsavedGuard({
    dirty,
    onClose: () => { setCreateOpen(false); setEditing(null); },
  });

  const { data: lojas = [], isLoading } = useQuery({
    queryKey: ["lojas-direcionamento"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("lojas_direcionamento" as any) as any)
        .select("id, nome, ativo, is_default, ordem")
        .order("is_default", { ascending: false })
        .order("ordem", { ascending: true, nullsFirst: false })
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as Loja[];
    },
  });

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return lojas;
    return lojas.filter((l) => l.nome.toLowerCase().includes(s));
  }, [lojas, search]);

  const { sorted, sortKey, sortDir, toggle } = useSort(filtered, { key: "ordem" });
  const sortState = { sortKey, sortDir, toggle };

  // Invalida a lista própria da tela E a query da tela de Direcionamento
  // (`["dir-lojas", tenantId]`, em expedicao.direcionamento.$modeloId.tsx) — prefixo
  // ["dir-lojas"] casa qualquer tenantId, sem precisar conhecê-lo aqui.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["lojas-direcionamento"] });
    qc.invalidateQueries({ queryKey: ["dir-lojas"] });
  };

  const openCreate = () => {
    setEditing(null); setFormNome(""); setFormOrdem(""); setFormAtivo(true); setCreateOpen(true);
  };
  const openEdit = (l: Loja) => {
    setCreateOpen(false); setEditing(l);
    setFormNome(l.nome); setFormOrdem(String(l.ordem ?? "")); setFormAtivo(l.ativo);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const nome = formNome.trim();
      if (!nome) throw new Error("Informe o nome da loja.");
      const ordem = formOrdem.trim() === "" ? null : Math.max(0, parseInt(formOrdem, 10) || 0);
      if (editing) {
        const { error } = await (supabase.from("lojas_direcionamento" as any) as any)
          .update({ nome, ordem, ativo: formAtivo })
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase.from("lojas_direcionamento" as any) as any)
          .insert({ nome, ordem, ativo: formAtivo });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Loja atualizada." : "Loja criada.");
      setCreateOpen(false); setEditing(null);
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Já existe uma loja com esse nome." : mensagemErro(e, "Erro ao salvar.")),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("excluir_loja_direcionamento" as any, { _loja_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Loja excluída.");
      setDeleteRow(null); setEditing(null);
      invalidate();
    },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  const formFields = (
    <div className="space-y-3 py-2">
      <div className="space-y-1.5">
        <Label>Nome</Label>
        <Input
          autoFocus
          value={formNome}
          onChange={(e) => setFormNome(e.target.value)}
          placeholder="Ex: Franquia Sul"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveMut.mutate(); } }}
          disabled={readOnly}
        />
      </div>
      <div className="space-y-1.5">
        <Label>Ordem</Label>
        <Input
          inputMode="numeric"
          value={formOrdem}
          onChange={(e) => setFormOrdem(e.target.value.replace(/\D/g, ""))}
          placeholder="Posição na lista (ex: 3)"
          disabled={readOnly}
        />
      </div>
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <Label>Ativa</Label>
          <p className="text-xs text-muted-foreground">
            Desativada some de direcionamentos novos; linhas já digitadas continuam visíveis.
          </p>
        </div>
        <Switch checked={formAtivo} onCheckedChange={setFormAtivo} disabled={readOnly} />
      </div>
    </div>
  );

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="flex items-start gap-3">
        <Store className="h-7 w-7 text-primary mt-0.5 shrink-0" />
        <div>
          <h1 className="text-2xl font-bold">Lojas</h1>
          <p className="text-sm text-muted-foreground">
            Destinos do Direcionamento (ex.: E-commerce, Loja Física, franquias).
          </p>
        </div>
      </header>

      {!pageReadOnly && !isAdminLoja && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <Lock className="h-4 w-4 shrink-0" />
          Apenas o administrador da loja pode editar.
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar lojas…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate} className="max-sm:hidden" disabled={readOnly}>
          <Plus className="h-4 w-4 mr-1" /> Nova
        </Button>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Nome" sortKey="nome" sortState={sortState} />
              <SortHead label="Ordem" sortKey="ordem" sortState={sortState} />
              <TableHead>Status</TableHead>
              <TableHead className="w-32 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Carregando…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  Nenhuma loja cadastrada.
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((l) => (
                <TableRow key={l.id} className={l.ativo ? "" : "opacity-60"}>
                  <TableCell>
                    <button type="button" className="text-left hover:underline" onClick={() => openEdit(l)}>
                      {l.nome}
                    </button>
                    {l.is_default && <Badge variant="secondary" className="ml-2 text-[10px]">Padrão</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{l.ordem ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={l.ativo ? "default" : "outline"}>{l.ativo ? "Ativa" : "Desativada"}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(l)} aria-label="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon" variant="ghost"
                      onClick={() => setDeleteRow(l)}
                      disabled={readOnly || l.is_default}
                      aria-label="Excluir"
                    >
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
        <Badge variant="secondary">{filtered.length}</Badge> loja(s)
      </div>

      {/* Novo = Dialog central (padrão do sistema) */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) requestClose(); }}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <DialogTitle>Nova loja</DialogTitle>
              <UnsavedIndicator show={createDirty} className="ml-auto shrink-0" />
            </div>
          </DialogHeader>
          {formFields}
          <DialogFooter>
            <Button variant="outline" onClick={requestClose}>Cancelar</Button>
            {!readOnly && (
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Salvando…" : "Salvar"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar = Sheet lateral com barra de ações no rodapé (padrão do sistema) */}
      <Sheet open={!!editing} onOpenChange={(o) => { if (!o) requestClose(); }}>
        <SheetContent side="right" className="w-full sm:w-[480px] sm:max-w-[480px] flex flex-col p-0">
          <div className="flex-1 overflow-y-auto p-6">
            <SheetHeader>
              <div className="flex items-center gap-2">
                <SheetTitle>Editar loja</SheetTitle>
                {editing?.is_default && <Badge variant="secondary" className="text-[10px]">Padrão</Badge>}
                <UnsavedIndicator show={editDirty} className="ml-auto shrink-0" />
              </div>
            </SheetHeader>
            {formFields}
          </div>
          <div className="shrink-0 border-t bg-background p-3 flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={requestClose} aria-label="Voltar">
              <ArrowLeft className="h-4 w-4 mr-1" />Voltar
            </Button>
            {!readOnly && editing && !editing.is_default && (
              <Button variant="destructive" onClick={() => setDeleteRow(editing)}>
                <Trash2 className="h-4 w-4 mr-1" /> Excluir
              </Button>
            )}
            {!readOnly && (
              <Button className="ml-auto" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                {saveMut.isPending ? "Salvando…" : "Salvar"}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <UnsavedChangesGuard confirm={confirm} />

      <AlertDialog open={!!deleteRow} onOpenChange={(o) => !o && setDeleteRow(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir loja?</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{deleteRow?.nome}</strong>? Lojas com linhas de
              direcionamento não podem ser excluídas — nesse caso, desative-a.
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
          <Plus className="h-4 w-4 mr-1" /> Nova
        </Button>
      </MobileActionBar>
    </div>
  );
}
