// F7 Armário · Task D2 — tela de LISTA de armários da subcoleção (reordenável). A MONTAGEM (grade + dialog) é a D3/D4:
// com `?armario=` na URL esta tela mostra só o placeholder da montagem.
// Estado na URL (?colecao=&sub=&armario=): o `sub` é o NOME da subcoleção (é a chave que `armarios.subcolecao` guarda).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, GripVertical, LayoutGrid, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { useReadOnly } from "@/components/RequirePermission";
import { armarioTravado, transicaoValida, type ArmarioStatus } from "@/lib/armario/status";
import { mensagemArmario } from "@/lib/armario/mensagem";

export type ArmarioSearch = { colecao?: string; sub?: string; armario?: string };

type ArmarioRowData = { id: string; nome: string; status: ArmarioStatus; colunas: number; ordem: number; itens: number };
type Opcao = { id: string; nome: string };
type SubRow = { id: string; nome: string; ordem: number | null };

const STATUS_ROTULO: Record<ArmarioStatus, string> = { rascunho: "Rascunho", pronto: "Pronto", publicado: "Publicado" };
const STATUS_TOM: Record<ArmarioStatus, StatusTone> = { rascunho: "neutral", pronto: "info", publicado: "success" };
const ACAO_STATUS: Record<string, string> = {
  "rascunho>pronto": "Marcar como pronto",
  "pronto>rascunho": "Voltar para rascunho",
  "pronto>publicado": "Publicar",
  "publicado>pronto": "Despublicar",
};
const TRAVADO_DICA = "Armário publicado é somente leitura — despublique antes.";
const ITEM = "flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

export function ArmarioListPage({ search, onSearch }: { search: ArmarioSearch; onSearch: (next: ArmarioSearch) => void }) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();
  const colecaoId = search.colecao;
  const sub = search.sub;

  const { data: colecoes = [] } = useQuery({
    queryKey: ["armario-colecoes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("colecoes").select("id, nome").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Opcao[];
    },
  });
  const { data: subs = [] } = useQuery({
    queryKey: ["colecao-subcolecoes", colecaoId],
    enabled: !!colecaoId,
    queryFn: async () => {
      const { data, error } = await supabase.from("colecao_subcolecoes" as any).select("id, nome, ordem").eq("colecao_id", colecaoId!).order("ordem");
      if (error) throw error;
      return (data ?? []) as unknown as SubRow[];
    },
  });

  const chave = useMemo(() => ["armarios", colecaoId, sub] as const, [colecaoId, sub]);
  const { data: lista = [], isLoading, error: erroLista } = useQuery({
    queryKey: chave,
    enabled: !!colecaoId && !!sub,
    queryFn: async () => {
      const { data, error } = await (supabase.from("armarios" as any) as any)
        .select("id, nome, status, colunas, ordem, armario_itens(count)")
        .eq("colecao_id", colecaoId!)
        .eq("subcolecao", sub!)
        .order("ordem");
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, nome: r.nome, status: r.status as ArmarioStatus, colunas: r.colunas, ordem: r.ordem,
        itens: Number(r.armario_itens?.[0]?.count ?? 0),
      })) as ArmarioRowData[];
    },
  });

  const invalidar = () => qc.invalidateQueries({ queryKey: ["armarios", colecaoId, sub] });
  const falha = (fallback: string) => (e: unknown) => { invalidar(); toast.error(mensagemArmario(e, fallback)); };
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    const { data, error } = await (supabase.rpc as any)(nome, args);
    if (error) throw error;
    return data;
  };

  // ── mutações ────────────────────────────────────────────────────────────────────────────────────────────────────
  const criar = useMutation({
    mutationFn: (nome: string) => {
      const colecao = colecoes.find((c) => c.id === colecaoId)?.nome ?? null;
      return rpc("armario_criar", { _colecao_id: colecaoId, _colecao: colecao, _subcolecao: sub, _nome: nome });
    },
    onSuccess: () => { toast.success("Armário criado."); invalidar(); setNovoAberto(false); },
    onError: falha("Erro ao criar o armário."),
  });
  const renomear = useMutation({
    mutationFn: ({ id, nome }: { id: string; nome: string }) => rpc("armario_renomear", { _id: id, _nome: nome }),
    onSuccess: invalidar,
    onError: falha("Erro ao renomear o armário."),
  });
  const duplicar = useMutation({
    mutationFn: ({ id, nome }: { id: string; nome: string }) => rpc("armario_duplicar", { _id: id, _novo_nome: nome }),
    onSuccess: () => { toast.success("Armário duplicado (nasce como rascunho)."); invalidar(); setDuplicando(null); },
    onError: falha("Erro ao duplicar o armário."),
  });
  const excluir = useMutation({
    mutationFn: (id: string) => rpc("armario_excluir", { _id: id }),
    onSuccess: () => { toast.success("Armário excluído."); invalidar(); setExcluindo(null); },
    onError: (e) => { setExcluindo(null); falha("Erro ao excluir o armário.")(e); },
  });
  const mudarStatus = useMutation({
    mutationFn: ({ id, novo }: { id: string; novo: ArmarioStatus }) => rpc("armario_status", { _id: id, _novo: novo }),
    onSuccess: invalidar,
    onError: falha("Erro ao mudar o status."),
  });
  // Reordenar: manda a lista INTEIRA de ids da subcoleção na nova ordem. Otimista; reverte (refetch) no erro.
  const reordenar = useMutation({
    mutationFn: (ids: string[]) => rpc("armario_reordenar", { _subcolecao_ids: ids }),
    onError: falha("Erro ao reordenar os armários."),
    onSuccess: invalidar,
  });

  // ── estado de diálogos / edição ─────────────────────────────────────────────────────────────────────────────────
  const [novoAberto, setNovoAberto] = useState(false);
  const [duplicando, setDuplicando] = useState<ArmarioRowData | null>(null);
  const [excluindo, setExcluindo] = useState<ArmarioRowData | null>(null);
  const [editandoId, setEditandoId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = (ev: DragEndEvent) => {
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    const de = lista.findIndex((a) => a.id === active.id);
    const para = lista.findIndex((a) => a.id === over.id);
    if (de < 0 || para < 0) return;
    const nova = arrayMove(lista, de, para).map((a, i) => ({ ...a, ordem: i + 1 }));
    qc.setQueryData(chave, nova);
    reordenar.mutate(nova.map((a) => a.id));
  };

  // ── armário aberto (D4 renderiza a montagem aqui) ───────────────────────────────────────────────────────────────
  if (search.armario) {
    return (
      <div className="space-y-4">
        <Breadcrumb items={[{ label: "Estilo & Engenharia", to: "/criacao" }, { label: "Armário", onClick: () => onSearch({ colecao: colecaoId, sub }) }, { label: "Montagem" }]} />
        <Button variant="outline" size="sm" onClick={() => onSearch({ colecao: colecaoId, sub })}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Voltar à lista
        </Button>
        <p className="text-muted-foreground" data-testid="armario-montagem-placeholder">Montagem em construção</p>
      </div>
    );
  }

  const subAtual = sub && subs.length > 0 && !subs.some((s) => s.nome === sub) ? undefined : sub; // sub da URL que não existe mais nesta coleção
  const podeEditar = !readOnly;

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Estilo & Engenharia", to: "/criacao" }, { label: "Armário" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Armário</h1>
          <p className="text-sm text-muted-foreground">Planeje a vitrine do e-commerce por subcoleção.</p>
        </div>
        <Button onClick={() => setNovoAberto(true)} disabled={!podeEditar || !colecaoId || !subAtual}>
          <Plus className="mr-1 h-4 w-4" /> Novo armário
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] space-y-1">
          <Label className="text-xs text-muted-foreground">Coleção</Label>
          <Select value={colecaoId ?? ""} onValueChange={(v) => onSearch({ colecao: v })}>
            <SelectTrigger aria-label="Coleção"><SelectValue placeholder="Escolha a coleção" /></SelectTrigger>
            <SelectContent>
              {colecoes.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[220px] space-y-1">
          <Label className="text-xs text-muted-foreground">Subcoleção</Label>
          <Select value={subAtual ?? ""} onValueChange={(v) => onSearch({ colecao: colecaoId, sub: v })} disabled={!colecaoId}>
            <SelectTrigger aria-label="Subcoleção"><SelectValue placeholder={colecaoId ? "Escolha a subcoleção" : "Escolha a coleção antes"} /></SelectTrigger>
            <SelectContent>
              {subs.map((s) => <SelectItem key={s.id} value={s.nome}>{s.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!colecaoId || !subAtual ? (
        <EmptyState icon={LayoutGrid} title="Escolha uma coleção e uma subcoleção" description="Os armários aparecem aqui, na ordem em que a vitrine os mostra." />
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
      ) : erroLista ? (
        <p className="text-sm text-destructive">{mensagemArmario(erroLista, "Erro ao carregar os armários.")}</p>
      ) : lista.length === 0 ? (
        <EmptyState icon={LayoutGrid} title="Nenhum armário nesta subcoleção" description="Crie o primeiro para começar a montar a vitrine."
          action={podeEditar ? { label: "Novo armário", onClick: () => setNovoAberto(true) } : undefined} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={lista.map((a) => a.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {lista.map((a) => (
                <ArmarioLinha
                  key={a.id}
                  a={a}
                  podeEditar={podeEditar}
                  editando={editandoId === a.id}
                  onAbrir={() => onSearch({ colecao: colecaoId, sub, armario: a.id })}
                  onEditar={() => setEditandoId(a.id)}
                  onFimEdicao={() => setEditandoId(null)}
                  onRenomear={(nome) => renomear.mutate({ id: a.id, nome })}
                  onDuplicar={() => setDuplicando(a)}
                  onExcluir={() => setExcluindo(a)}
                  onStatus={(novo) => mudarStatus.mutate({ id: a.id, novo })}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <NomeDialog
        open={novoAberto}
        titulo="Novo armário"
        descricao={`Nasce vazio e como rascunho, no fim da lista de ${sub ?? "subcoleção"}.`}
        inicial=""
        confirmar="Criar"
        pendente={criar.isPending}
        onConfirmar={(n) => criar.mutate(n)}
        onFechar={() => setNovoAberto(false)}
      />
      <NomeDialog
        open={!!duplicando}
        titulo="Duplicar armário"
        descricao="A cópia leva as variantes e as colunas, nasce como rascunho e vai para o fim da lista."
        inicial={duplicando ? `${duplicando.nome} (cópia)` : ""}
        confirmar="Duplicar"
        pendente={duplicar.isPending}
        onConfirmar={(n) => duplicando && duplicar.mutate({ id: duplicando.id, nome: n })}
        onFechar={() => setDuplicando(null)}
      />
      <AlertDialog open={!!excluindo} onOpenChange={(o) => { if (!o) setExcluindo(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir armário?</AlertDialogTitle>
            <AlertDialogDescription>
              {excluindo ? `“${excluindo.nome}” e as ${plural(excluindo.itens, "variante", "variantes")} dele serão excluídos. Não dá para desfazer.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); if (excluindo) excluir.mutate(excluindo.id); }}
              disabled={excluir.isPending}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ArmarioLinha({ a, podeEditar, editando, onAbrir, onEditar, onFimEdicao, onRenomear, onDuplicar, onExcluir, onStatus }: {
  a: ArmarioRowData;
  podeEditar: boolean;
  editando: boolean;
  onAbrir: () => void;
  onEditar: () => void;
  onFimEdicao: () => void;
  onRenomear: (nome: string) => void;
  onDuplicar: () => void;
  onExcluir: () => void;
  onStatus: (novo: ArmarioStatus) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: a.id, disabled: !podeEditar });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const travado = armarioTravado(a.status);
  const bloqueiaEdicao = !podeEditar || travado;

  const [nome, setNome] = useState(a.nome);
  useEffect(() => { if (!editando) setNome(a.nome); }, [a.nome, editando]);
  const commit = () => {
    const v = nome.trim();
    onFimEdicao();
    if (!v) { setNome(a.nome); return; }
    if (v !== a.nome) onRenomear(v);
  };

  const transicoes = (["rascunho", "pronto", "publicado"] as ArmarioStatus[]).filter((s) => transicaoValida(a.status, s));

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid="armario-linha"
      className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2 ${isDragging ? "relative z-10 bg-muted shadow-md" : ""}`}
    >
      <button
        type="button"
        className={`flex h-8 w-6 shrink-0 items-center justify-center text-muted-foreground ${podeEditar ? "cursor-grab hover:text-foreground active:cursor-grabbing" : "cursor-not-allowed opacity-40"}`}
        aria-label="Arrastar para reordenar"
        disabled={!podeEditar}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        {editando ? (
          <Input
            autoFocus
            value={nome}
            maxLength={120}
            aria-label="Nome do armário"
            onChange={(e) => setNome(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") { setNome(a.nome); onFimEdicao(); }
            }}
            className="h-8"
          />
        ) : (
          <button type="button" onClick={onAbrir} className="block max-w-full truncate text-left font-medium hover:underline" title="Abrir armário">
            {a.nome}
          </button>
        )}
        <p className="text-xs text-muted-foreground">
          {plural(a.itens, "variante", "variantes")} · {plural(a.colunas, "coluna", "colunas")}
        </p>
      </div>

      <StatusBadge tone={STATUS_TOM[a.status]}>{STATUS_ROTULO[a.status]}</StatusBadge>

      <Popover>
        <PopoverTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="Mais ações" title="Mais ações"><MoreHorizontal className="h-4 w-4" /></Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          <PopoverClose asChild>
            <button type="button" className={ITEM} onClick={onEditar} disabled={bloqueiaEdicao} title={travado ? TRAVADO_DICA : undefined}>
              <Pencil className="h-4 w-4 shrink-0" /> Renomear
            </button>
          </PopoverClose>
          <PopoverClose asChild>
            <button type="button" className={ITEM} onClick={onDuplicar} disabled={!podeEditar}>
              <Copy className="h-4 w-4 shrink-0" /> Duplicar
            </button>
          </PopoverClose>
          {podeEditar && transicoes.length > 0 && <div className="my-1 border-t" />}
          {podeEditar && transicoes.map((s) => (
            <PopoverClose asChild key={s}>
              <button type="button" className={ITEM} onClick={() => onStatus(s)}>
                <span className="w-4 shrink-0" /> {ACAO_STATUS[`${a.status}>${s}`]}
              </button>
            </PopoverClose>
          ))}
          <div className="my-1 border-t" />
          <PopoverClose asChild>
            <button type="button" className={`${ITEM} text-destructive hover:bg-destructive/10`} onClick={onExcluir} disabled={bloqueiaEdicao} title={travado ? TRAVADO_DICA : undefined}>
              <Trash2 className="h-4 w-4 shrink-0" /> Excluir
            </button>
          </PopoverClose>
        </PopoverContent>
      </Popover>
    </li>
  );
}

function NomeDialog({ open, titulo, descricao, inicial, confirmar, pendente, onConfirmar, onFechar }: {
  open: boolean; titulo: string; descricao: string; inicial: string; confirmar: string; pendente: boolean;
  onConfirmar: (nome: string) => void; onFechar: () => void;
}) {
  const [nome, setNome] = useState(inicial);
  useEffect(() => { if (open) setNome(inicial); }, [open, inicial]);
  const v = nome.trim();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>{descricao}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="armario-nome">Nome do armário</Label>
          <Input
            id="armario-nome"
            autoFocus
            value={nome}
            maxLength={120}
            onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && v && !pendente) onConfirmar(v); }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={pendente}>Cancelar</Button>
          <Button onClick={() => onConfirmar(v)} disabled={!v || pendente}>
            {pendente && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{confirmar}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
