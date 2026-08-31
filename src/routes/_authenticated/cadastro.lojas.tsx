import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Store, Plus, Trash2, Search, Loader2, Lock, GripVertical, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { mensagemErro } from "@/lib/erro-mensagem";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { MobileActionBar } from "@/components/shared/MobileActionBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RequirePermission, useReadOnly } from "@/components/RequirePermission";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Breadcrumb } from "@/components/shared/Breadcrumb";

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
  // explícita) mas não é admin da loja cairia num beco-sem-saída (edição liberada,
  // salvar estourando erro de RLS). Trata como somente-leitura aqui também, com aviso
  // próprio (o banner genérico da RequirePermission só cobre o caso sem canEdit).
  const isAdminLoja = isTenantAdmin || isSuperAdmin;
  const readOnly = pageReadOnly || !isAdminLoja;
  const [search, setSearch] = useState("");
  const [deleteRow, setDeleteRow] = useState<Loja | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  // Invalida a lista própria da tela E a query da tela de Direcionamento
  // (`["dir-lojas", tenantId]`, em expedicao.direcionamento.$modeloId.tsx) — prefixo
  // ["dir-lojas"] casa qualquer tenantId, sem precisar conhecê-lo aqui.
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["lojas-direcionamento"] });
    qc.invalidateQueries({ queryKey: ["dir-lojas"] });
  };

  const { data: lojas = [], isLoading } = useQuery({
    queryKey: ["lojas-direcionamento"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("lojas_direcionamento" as any) as any)
        .select("id, nome, ativo, is_default, ordem")
        .order("ordem", { ascending: true, nullsFirst: false })
        .order("nome");
      if (error) throw error;
      return ((data ?? []) as unknown) as Loja[];
    },
  });

  // A busca só FILTRA a exibição — arrastar (reordenar) é desabilitado enquanto há
  // busca ativa, senão o arrayMove operaria sobre a lista parcial e renumeraria errado.
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return lojas;
    return lojas.filter((l) => l.nome.toLowerCase().includes(s));
  }, [lojas, search]);
  const buscaAtiva = search.trim() !== "";
  const podeArrastar = !readOnly && !buscaAtiva;

  // Renumera a ordem no banco ao soltar (auto-save). Persiste TODAS as linhas afetadas
  // numa tacada (a ordem de cada uma vira seu índice na lista) — a fonte da verdade é a
  // posição visual. Otimista: reordena o cache já, reverte no erro.
  const reorderMut = useMutation({
    mutationFn: async (novaOrdem: Loja[]) => {
      const updates = novaOrdem
        .map((l, i) => ({ id: l.id, ordem: i }))
        .filter((u, i) => novaOrdem[i].ordem !== u.ordem); // só o que mudou
      for (const u of updates) {
        const { error } = await (supabase.from("lojas_direcionamento" as any) as any)
          .update({ ordem: u.ordem })
          .eq("id", u.id);
        if (error) throw error;
      }
    },
    onError: (e: any) => {
      invalidate(); // recarrega a ordem real do banco
      toast.error(mensagemErro(e, "Erro ao reordenar."));
    },
    onSuccess: () => invalidate(),
  });

  const onDragEnd = (ev: DragEndEvent) => {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const oldIndex = lojas.findIndex((l) => l.id === active.id);
    const newIndex = lojas.findIndex((l) => l.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const nova = arrayMove(lojas, oldIndex, newIndex);
    // Otimista: atualiza o cache com a nova ordem já normalizada (0..n).
    qc.setQueryData(["lojas-direcionamento"], nova.map((l, i) => ({ ...l, ordem: i })));
    reorderMut.mutate(nova);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Renomear inline (salva no blur/Enter). Otimista com reverter no erro.
  const renameMut = useMutation({
    mutationFn: async ({ id, nome }: { id: string; nome: string }) => {
      const { error } = await (supabase.from("lojas_direcionamento" as any) as any)
        .update({ nome })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Nome atualizado."); invalidate(); },
    onError: (e: any) => {
      invalidate();
      toast.error(e?.code === "23505" ? "Já existe uma loja com esse nome." : mensagemErro(e, "Erro ao salvar."));
    },
  });

  // Ativar/desativar inline (salva ao alternar o toggle).
  const toggleMut = useMutation({
    mutationFn: async ({ id, ativo }: { id: string; ativo: boolean }) => {
      const { error } = await (supabase.from("lojas_direcionamento" as any) as any)
        .update({ ativo })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, ativo }) => {
      // Otimista: reflete o toggle na hora (evita "pisca" enquanto a rede responde).
      qc.setQueryData(["lojas-direcionamento"], (old: Loja[] = []) =>
        old.map((l) => (l.id === id ? { ...l, ativo } : l)));
    },
    onSuccess: () => invalidate(),
    onError: (e: any) => { invalidate(); toast.error(mensagemErro(e, "Erro ao salvar.")); },
  });

  // Criar: sempre vai pro FIM (ordem = maior+1) e nasce ativa. Só o nome é pedido.
  const createMut = useMutation({
    mutationFn: async () => {
      const nome = novoNome.trim();
      if (!nome) throw new Error("Informe o nome da loja.");
      const maxOrdem = lojas.reduce((m, l) => Math.max(m, l.ordem ?? -1), -1);
      const { error } = await (supabase.from("lojas_direcionamento" as any) as any)
        .insert({ nome, ordem: maxOrdem + 1, ativo: true });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Loja criada."); setNovoNome(""); setAddOpen(false); invalidate(); },
    onError: (e: any) =>
      toast.error(e?.code === "23505" ? "Já existe uma loja com esse nome." : mensagemErro(e, "Erro ao criar.")),
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("excluir_loja_direcionamento" as any, { _loja_id: id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Loja excluída."); setDeleteRow(null); invalidate(); },
    onError: (e: any) => toast.error(mensagemErro(e, "Erro ao excluir.")),
  });

  return (
    <div className="container mx-auto p-3 sm:p-6 space-y-6 max-sm:pb-24">
      <header className="space-y-1">
        <Breadcrumb items={[{ label: "Cadastro" }, { label: "Lojas" }]} />
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Store className="h-7 w-7 text-primary mt-0.5 shrink-0" />
            <div>
              <h1 className="font-display text-xl font-semibold tracking-tight">Lojas</h1>
              <p className="text-sm text-muted-foreground">
                Destinos do Direcionamento (ex.: E-commerce, Loja Física, franquias).
                Arraste para reordenar; edite nome e status direto na lista.
              </p>
            </div>
          </div>
          {!readOnly && (
            <Button
              className="shrink-0 max-sm:hidden"
              onClick={() => { setNovoNome(""); setAddOpen(true); }}
            >
              <Plus className="h-4 w-4 mr-1" /> Adicionar loja
            </Button>
          )}
        </div>
      </header>

      {!pageReadOnly && !isAdminLoja && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <Lock className="h-4 w-4 shrink-0" />
          Apenas o administrador da loja pode editar.
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar lojas…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {buscaAtiva && !readOnly && (
        <p className="-mt-3 text-xs text-muted-foreground">
          Limpe a busca para reordenar arrastando.
        </p>
      )}

      <div className="rounded-lg border">
        <Table className="lojas-table">
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Nome</TableHead>
              <TableHead className="w-40">Status</TableHead>
              <TableHead className="w-16 text-right">Ações</TableHead>
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
                  {buscaAtiva ? "Nenhuma loja encontrada." : "Nenhuma loja cadastrada."}
                </TableCell>
              </TableRow>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
              >
                <SortableContext
                  items={filtered.map((l) => l.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {filtered.map((l) => (
                    <LojaRow
                      key={l.id}
                      loja={l}
                      readOnly={readOnly}
                      podeArrastar={podeArrastar}
                      onRename={(nome) => renameMut.mutate({ id: l.id, nome })}
                      onToggle={(ativo) => toggleMut.mutate({ id: l.id, ativo })}
                      onDelete={() => setDeleteRow(l)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="text-xs text-muted-foreground">
        <Badge variant="secondary">{filtered.length}</Badge> loja(s)
      </div>

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
              variant="destructive"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {!readOnly && (
        <MobileActionBar>
          <Button
            className="w-full"
            onClick={() => { setNovoNome(""); setAddOpen(true); }}
          >
            <Plus className="h-4 w-4 mr-1" /> Adicionar loja
          </Button>
        </MobileActionBar>
      )}

      <Dialog open={addOpen} onOpenChange={(o) => { if (!createMut.isPending) setAddOpen(o); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova loja</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="nova-loja-nome">Nome da loja</Label>
            <Input
              id="nova-loja-nome"
              autoFocus
              placeholder="Ex.: Loja Física"
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && novoNome.trim() && !createMut.isPending) {
                  e.preventDefault();
                  createMut.mutate();
                }
              }}
            />
          </div>
          <DialogFooter className="max-sm:flex-row max-sm:justify-start max-sm:space-x-2">
            <Button
              variant="outline"
              onClick={() => setAddOpen(false)}
              disabled={createMut.isPending}
              aria-label="Cancelar"
              className="max-sm:aspect-square max-sm:px-0"
            >
              <ArrowLeft className="h-4 w-4 sm:mr-1" />
              <span className="max-sm:sr-only">Cancelar</span>
            </Button>
            <Button
              onClick={() => createMut.mutate()}
              disabled={!novoNome.trim() || createMut.isPending}
              className="max-sm:flex-1"
            >
              {createMut.isPending ? "Criando…" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Linha arrastável, com nome editável inline e toggle de status ────────────────
function LojaRow({
  loja, readOnly, podeArrastar, onRename, onToggle, onDelete,
}: {
  loja: Loja;
  readOnly: boolean;
  podeArrastar: boolean;
  onRename: (nome: string) => void;
  onToggle: (ativo: boolean) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: loja.id, disabled: !podeArrastar });
  const style = { transform: CSS.Transform.toString(transform), transition };

  // Rascunho local do nome — commita no blur/Enter só se mudou.
  const [nome, setNome] = useState(loja.nome);
  const inputRef = useRef<HTMLInputElement>(null);
  // Se o valor do servidor mudar (ex.: outro usuário renomeou, ou rollback otimista),
  // reflete no campo desde que o usuário não esteja editando este campo agora.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setNome(loja.nome);
  }, [loja.nome]);

  const commitNome = () => {
    const v = nome.trim();
    if (!v) { setNome(loja.nome); return; } // vazio não salva; volta ao original
    if (v !== loja.nome) onRename(v);
  };

  return (
    <TableRow
      ref={setNodeRef}
      style={style}
      className={`${loja.ativo ? "" : "opacity-60"} ${isDragging ? "relative z-10 bg-muted" : ""}`}
    >
      <TableCell className="pr-0">
        <button
          type="button"
          className={`flex h-8 w-6 items-center justify-center text-muted-foreground ${podeArrastar ? "cursor-grab active:cursor-grabbing hover:text-foreground" : "cursor-not-allowed opacity-40"}`}
          aria-label="Arrastar para reordenar"
          {...attributes}
          {...listeners}
          disabled={!podeArrastar}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {readOnly ? (
            <span>{loja.nome}</span>
          ) : (
            <Input
              ref={inputRef}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onBlur={commitNome}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); inputRef.current?.blur(); }
                if (e.key === "Escape") { setNome(loja.nome); inputRef.current?.blur(); }
              }}
              className="h-8 w-full sm:max-w-xs"
              aria-label="Nome da loja"
            />
          )}
          {loja.is_default && <Badge variant="secondary" className="shrink-0 text-[10px]">Padrão</Badge>}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <Switch
            checked={loja.ativo}
            onCheckedChange={(v) => onToggle(v)}
            disabled={readOnly}
            aria-label={loja.ativo ? "Desativar loja" : "Ativar loja"}
          />
          {loja.ativo ? (
            <StatusBadge tone="success">Ativa</StatusBadge>
          ) : (
            <StatusBadge tone="neutral">Desativada</StatusBadge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="iconSm" variant="ghost"
          onClick={onDelete}
          disabled={readOnly || loja.is_default}
          aria-label="Excluir"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
