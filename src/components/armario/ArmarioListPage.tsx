// F7 Armário · tela de LISTA de armários da loja, organizada por ANO/MÊS (dado próprio do armário, SEM relação com coleção).
// Com `?armario=` na URL renderiza a MONTAGEM (grade + dialog de variantes) no lugar da lista.
// Ano e Mês são OBRIGATÓRIOS ao criar; os filtros Ano/Mês encurtam a LISTA DE ARMÁRIOS pelo ano_id/mes_id do próprio armário.
// A ordem (arraste) é por PERÍODO (ano+mês): só dá para reordenar quando a lista visível é de um único período.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, GripVertical, LayoutGrid, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
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
import { useOpts } from "@/components/planejamento/modelo-shared";
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
import { useConfirmacao } from "@/components/shared/ConfirmarAcaoDialog";
import { textoDespublicarArmario, textoPublicarArmario } from "@/lib/confirmacoes-textos";
import { ArmarioMontagem } from "@/components/armario/ArmarioMontagem";

export type ArmarioSearch = { armario?: string };

type ArmarioRowData = {
  id: string; nome: string; status: ArmarioStatus; colunas: number; ordem: number; itens: number;
  ano_id: string | null; mes_id: string | null;
};

const STATUS_ROTULO: Record<ArmarioStatus, string> = { rascunho: "Rascunho", pronto: "Pronto", publicado: "Publicado" };
const STATUS_TOM: Record<ArmarioStatus, StatusTone> = { rascunho: "neutral", pronto: "info", publicado: "success" };
const ACAO_STATUS: Record<string, string> = {
  "rascunho>pronto": "Marcar como pronto",
  "pronto>rascunho": "Voltar para rascunho",
  "pronto>publicado": "Publicar",
  "publicado>pronto": "Despublicar",
};
const TRAVADO_DICA = "Armário publicado é somente leitura — despublique antes.";
const TRAVADO_DICA_EXCLUIR = "Armário publicado não pode ser excluído — despublique antes.";
const SEM_PERMISSAO_DICA = "Você não tem permissão para editar armários.";
const ITEM = "flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40";

const plural = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`;

export function ArmarioListPage({ search, onSearch }: { search: ArmarioSearch; onSearch: (next: ArmarioSearch) => void }) {
  const qc = useQueryClient();
  const readOnly = useReadOnly();

  // Rótulos de ano/mês (mesma fonte do Planejamento). meses ordenado por `ordem` (1..12).
  const { data: meses = [] } = useOpts("meses", "mes");
  const { data: anos = [] } = useOpts("anos", "ano");
  const anoMap = useMemo(() => new Map(anos.map((a) => [a.id, a.nome])), [anos]);
  const mesMap = useMemo(() => new Map(meses.map((m) => [m.id, m.nome])), [meses]);

  // Filtro de período (encurta a LISTA DE ARMÁRIOS pelo ano/mês do próprio armário). Vazio = todos.
  const [fAno, setFAno] = useState<string>("");
  const [fMes, setFMes] = useState<string>("");

  const { data: todos = [], isLoading, error: erroLista } = useQuery({
    queryKey: ["armarios"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("armarios" as any) as any)
        .select("id, nome, status, colunas, ordem, ano_id, mes_id, armario_itens(count)")
        .order("ano_id")
        .order("mes_id")
        .order("ordem");
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, nome: r.nome, status: r.status as ArmarioStatus, colunas: r.colunas, ordem: r.ordem,
        ano_id: r.ano_id ?? null, mes_id: r.mes_id ?? null,
        itens: Number(r.armario_itens?.[0]?.count ?? 0),
      })) as ArmarioRowData[];
    },
  });

  const lista = useMemo(
    () => todos
      .filter((a) => (!fAno || a.ano_id === fAno) && (!fMes || a.mes_id === fMes))
      .slice()
      // agrupa por período (como o servidor) e, dentro dele, segue a `ordem` (reflete o update otimista do arraste).
      .sort((x, y) => (x.ano_id ?? "").localeCompare(y.ano_id ?? "") || (x.mes_id ?? "").localeCompare(y.mes_id ?? "") || x.ordem - y.ordem),
    [todos, fAno, fMes],
  );
  // Reordenar é por PERÍODO: só liga quando a lista visível é de um único (ano, mês).
  const periodoUnico = useMemo(() => {
    if (lista.length === 0) return false;
    const a0 = lista[0];
    return lista.every((a) => a.ano_id === a0.ano_id && a.mes_id === a0.mes_id);
  }, [lista]);

  const invalidar = () => qc.invalidateQueries({ queryKey: ["armarios"] });
  const falha = (fallback: string) => (e: unknown) => { invalidar(); toast.error(mensagemArmario(e, fallback)); };
  const rpc = async (nome: string, args: Record<string, unknown>) => {
    const { data, error } = await (supabase.rpc as any)(nome, args);
    if (error) throw error;
    return data;
  };

  // ── mutações ────────────────────────────────────────────────────────────────────────────────────────────────────
  const criar = useMutation({
    mutationFn: ({ nome, anoId, mesId }: { nome: string; anoId: string; mesId: string }) =>
      rpc("armario_criar", { _ano_id: anoId, _mes_id: mesId, _nome: nome }),
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
  // Reordenar: manda a lista INTEIRA de ids do período na nova ordem. Otimista; reverte (refetch) no erro.
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
  // Publicar/Despublicar pedem confirmação (peso: libera/tira da API do e-commerce). Outras transições são leves: direto.
  const { pedir, dialog: confirmacaoDialog } = useConfirmacao(mudarStatus.isPending);
  const pedirStatus = (a: ArmarioRowData, novo: ArmarioStatus) => {
    const onConfirmar = () => mudarStatus.mutate({ id: a.id, novo });
    if (novo === "publicado") pedir({ ...textoPublicarArmario({ nome: a.nome }), onConfirmar });
    else if (a.status === "publicado" && novo === "pronto") pedir({ ...textoDespublicarArmario({ nome: a.nome }), onConfirmar });
    else onConfirmar();
  };

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
    // atualiza otimista só o período visível, mantendo os demais armários no cache
    qc.setQueryData<ArmarioRowData[]>(["armarios"], (prev) => {
      if (!prev) return prev;
      const porId = new Map(nova.map((a) => [a.id, a.ordem]));
      return prev.map((a) => (porId.has(a.id) ? { ...a, ordem: porId.get(a.id)! } : a));
    });
    reordenar.mutate(nova.map((a) => a.id));
  };

  // ── armário aberto: a montagem tem o próprio cabeçalho, Voltar e guarda de "não salvo" ──────────────────────────
  if (search.armario) {
    return <ArmarioMontagem armarioId={search.armario} onVoltar={() => onSearch({})} />;
  }

  const podeEditar = !readOnly;
  // Arrastar só quando: pode editar E a lista visível é de um único período (o servidor recusa ids de períodos diferentes).
  const podeReordenar = podeEditar && periodoUnico;

  return (
    <div className="space-y-4">
      <Breadcrumb items={[{ label: "Estilo & Engenharia", to: "/criacao" }, { label: "Armário" }]} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Armário</h1>
          <p className="text-sm text-muted-foreground">Planeje a vitrine do e-commerce, organizada por ano e mês.</p>
        </div>
        <Button onClick={() => setNovoAberto(true)} disabled={!podeEditar}>
          <Plus className="mr-1 h-4 w-4" /> Novo armário
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {/* Filtro de PERÍODO: encurta a LISTA DE ARMÁRIOS pelo ano/mês do próprio armário. */}
        <div className="min-w-[140px] space-y-1">
          <Label className="text-xs text-muted-foreground">Ano</Label>
          <Select value={fAno || "__todos__"} onValueChange={(v) => setFAno(v === "__todos__" ? "" : v)}>
            <SelectTrigger aria-label="Ano"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos__">Todos os anos</SelectItem>
              {anos.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-[160px] space-y-1">
          <Label className="text-xs text-muted-foreground">Mês</Label>
          <Select value={fMes || "__todos__"} onValueChange={(v) => setFMes(v === "__todos__" ? "" : v)}>
            <SelectTrigger aria-label="Mês"><SelectValue placeholder="Todos" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__todos__">Todos os meses</SelectItem>
              {meses.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando…</div>
      ) : erroLista ? (
        <p className="text-sm text-destructive">{mensagemArmario(erroLista, "Erro ao carregar os armários.")}</p>
      ) : lista.length === 0 ? (
        <EmptyState
          icon={LayoutGrid}
          title={fAno || fMes ? "Nenhum armário neste período" : "Nenhum armário ainda"}
          description="Crie o primeiro para começar a montar a vitrine (escolha o ano e o mês)."
          action={podeEditar ? { label: "Novo armário", onClick: () => setNovoAberto(true) } : undefined}
        />
      ) : (
        <>
          {!periodoUnico && podeEditar && (
            <p className="text-xs text-muted-foreground">
              Para reordenar arrastando, filtre por um único ano e mês.
            </p>
          )}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={lista.map((a) => a.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                {lista.map((a) => (
                  <ArmarioLinha
                    key={a.id}
                    a={a}
                    podeEditar={podeEditar}
                    podeReordenar={podeReordenar}
                    periodo={[a.mes_id ? mesMap.get(a.mes_id) : null, a.ano_id ? anoMap.get(a.ano_id) : null].filter(Boolean).join("/")}
                    editando={editandoId === a.id}
                    onAbrir={() => onSearch({ armario: a.id })}
                    onEditar={() => setEditandoId(a.id)}
                    onFimEdicao={() => setEditandoId(null)}
                    onRenomear={(nome) => renomear.mutate({ id: a.id, nome })}
                    onDuplicar={() => setDuplicando(a)}
                    onExcluir={() => setExcluindo(a)}
                    onStatus={(novo) => pedirStatus(a, novo)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}

      <NovoArmarioDialog
        open={novoAberto}
        anos={anos}
        meses={meses}
        anoInicial={fAno || undefined}
        mesInicial={fMes || undefined}
        pendente={criar.isPending}
        onConfirmar={(nome, anoId, mesId) => criar.mutate({ nome, anoId, mesId })}
        onFechar={() => setNovoAberto(false)}
      />
      <NomeDialog
        open={!!duplicando}
        titulo="Duplicar armário"
        descricao="A cópia leva as variantes e as colunas, nasce como rascunho e herda o ano/mês do original."
        inicial={duplicando ? `${duplicando.nome} (cópia)` : ""}
        confirmar="Duplicar"
        pendente={duplicar.isPending}
        onConfirmar={(n) => duplicando && duplicar.mutate({ id: duplicando.id, nome: n })}
        onFechar={() => setDuplicando(null)}
      />
      {confirmacaoDialog}
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

function ArmarioLinha({ a, podeEditar, podeReordenar, periodo, editando, onAbrir, onEditar, onFimEdicao, onRenomear, onDuplicar, onExcluir, onStatus }: {
  a: ArmarioRowData;
  podeEditar: boolean;
  podeReordenar: boolean;
  periodo: string;
  editando: boolean;
  onAbrir: () => void;
  onEditar: () => void;
  onFimEdicao: () => void;
  onRenomear: (nome: string) => void;
  onDuplicar: () => void;
  onExcluir: () => void;
  onStatus: (novo: ArmarioStatus) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: a.id, disabled: !podeReordenar });
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
  const subtitulo = `${plural(a.itens, "variante", "variantes")} · ${plural(a.colunas, "coluna", "colunas")}${periodo ? ` · ${periodo}` : ""}`;

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-testid="armario-linha"
      className={`flex items-center gap-3 rounded-lg border bg-card px-3 py-2 ${isDragging ? "relative z-10 bg-muted shadow-md" : ""}`}
    >
      <button
        type="button"
        className={`flex h-8 w-6 shrink-0 items-center justify-center text-muted-foreground ${podeReordenar ? "cursor-grab hover:text-foreground active:cursor-grabbing" : "cursor-not-allowed opacity-40"}`}
        aria-label="Arrastar para reordenar"
        title={podeReordenar ? undefined : "Filtre por um único ano e mês para reordenar."}
        disabled={!podeReordenar}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {editando ? (
        <div className="min-w-0 flex-1">
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
          <p className="text-xs text-muted-foreground">{subtitulo}</p>
        </div>
      ) : (
        // O BLOCO inteiro (nome + subtítulo) abre o armário. A alça de arraste e o menu ⋯ ficam FORA deste botão.
        <button
          type="button"
          onClick={onAbrir}
          className="group min-w-0 flex-1 text-left"
          title="Abrir armário"
        >
          <span className="block max-w-full truncate font-medium group-hover:underline">{a.nome}</span>
          <span className="block text-xs text-muted-foreground">{subtitulo}</span>
        </button>
      )}

      <StatusBadge tone={STATUS_TOM[a.status]}>{STATUS_ROTULO[a.status]}</StatusBadge>

      <Popover>
        <PopoverTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="Mais ações" title="Mais ações"><MoreHorizontal className="h-4 w-4" /></Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1">
          <PopoverClose asChild>
            <button type="button" className={ITEM} onClick={onEditar} disabled={bloqueiaEdicao} title={travado ? TRAVADO_DICA : !podeEditar ? SEM_PERMISSAO_DICA : undefined}>
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
            <button type="button" className={`${ITEM} text-destructive hover:bg-destructive/10`} onClick={onExcluir} disabled={bloqueiaEdicao} title={travado ? TRAVADO_DICA_EXCLUIR : !podeEditar ? SEM_PERMISSAO_DICA : undefined}>
              <Trash2 className="h-4 w-4 shrink-0" /> Excluir
            </button>
          </PopoverClose>
        </PopoverContent>
      </Popover>
    </li>
  );
}

type Opcao = { id: string; nome: string };

/** Diálogo de "Novo armário": nome + Ano + Mês (todos obrigatórios; Ano/Mês são o que organiza o armário). */
function NovoArmarioDialog({ open, anos, meses, anoInicial, mesInicial, pendente, onConfirmar, onFechar }: {
  open: boolean; anos: Opcao[]; meses: Opcao[]; anoInicial?: string; mesInicial?: string; pendente: boolean;
  onConfirmar: (nome: string, anoId: string, mesId: string) => void; onFechar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [anoId, setAnoId] = useState<string>("");
  const [mesId, setMesId] = useState<string>("");
  useEffect(() => {
    if (open) { setNome(""); setAnoId(anoInicial ?? ""); setMesId(mesInicial ?? ""); }
  }, [open, anoInicial, mesInicial]);
  const v = nome.trim();
  const valido = !!v && !!anoId && !!mesId;
  const confirmar = () => { if (valido && !pendente) onConfirmar(v, anoId, mesId); };
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo armário</DialogTitle>
          <DialogDescription>Nasce vazio e como rascunho. O ano e o mês organizam o armário.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="armario-nome">Nome do armário</Label>
            <Input
              id="armario-nome"
              autoFocus
              value={nome}
              maxLength={120}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Ano</Label>
              <Select value={anoId} onValueChange={setAnoId}>
                <SelectTrigger aria-label="Ano do armário"><SelectValue placeholder="Escolha o ano" /></SelectTrigger>
                <SelectContent>
                  {anos.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Mês</Label>
              <Select value={mesId} onValueChange={setMesId}>
                <SelectTrigger aria-label="Mês do armário"><SelectValue placeholder="Escolha o mês" /></SelectTrigger>
                <SelectContent>
                  {meses.map((m) => <SelectItem key={m.id} value={m.id}>{m.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={pendente}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!valido || pendente}>
            {pendente && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
