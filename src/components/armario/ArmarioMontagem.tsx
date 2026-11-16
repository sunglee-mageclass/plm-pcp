// F7 Armário · Task D4 — tela de MONTAGEM do armário (?armario=<id>): grade 2D ORDENÁVEL + drop do dialog de variantes + Salvar.
//
// ORDEM × COLUNAS: a ordem é a lista 1D (índice 1-based = ordem de envio da API, lê-se E→D / cima→baixo). O nº de colunas
// só reflui o grid (inline `gridTemplateColumns`, é dado) — NUNCA reordena. Regras puras em `src/lib/armario/montagem.ts`.
//
// DND: UM `DndContext` envolve a grade E o <VariantesDialog> (o context atravessa o portal do Dialog não-modal).
//   · item da grade  -> `useSortable` (`grade:${chave}`, SortableContext + rectSortingStrategy) = reordenar;
//   · card do dialog -> `useDraggable` (`variante:${chave}`, data.tipo="variante") = inserir na posição do alvo / no fim;
//   · container      -> `useDroppable(GRADE_DROP_ID)` aceita soltar na grade vazia ou no vão após o último card.
// Colisão própria (`detectarColisao`): o container engloba todos os cards, então fora disso ele "roubaria" o closestCenter.
// Mobile/sem drag: o "+" do dialog chama `onAdicionar` (insere no fim).
import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, LockKeyhole, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, pointerWithin, useDroppable, useSensor, useSensors,
  type Active, type CollisionDetection, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Breadcrumb } from "@/components/shared/Breadcrumb";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { UnsavedIndicator } from "@/components/shared/UnsavedIndicator";
import { UnsavedChangesGuard, useUnsavedGuard } from "@/components/shared/UnsavedChangesGuard";
import { useReadOnly } from "@/components/RequirePermission";
import { ModeloThumb } from "@/components/plan-tecido/ModeloThumb";
import { VariantesDialog, VARIANTE_DRAG_PREFIXO, type VarianteItem } from "@/components/armario/VariantesDialog";
import { GRID_COLS_OPTIONS, useCompactCards } from "@/hooks/useGridCols";
import { useDirtySnapshot } from "@/hooks/useDirtySnapshot";
import { useIsMobile } from "@/hooks/use-mobile";
import { armarioTravado, type ArmarioStatus } from "@/lib/armario/status";
import { mensagemArmario } from "@/lib/armario/mensagem";
import { chaveVariante, rotuloVariante, type ArmarioOrigem } from "@/lib/armario/variante-chave";
import {
  GRADE_DROP_ID, chaveDoIdGrade, idItemGrade, inserirItem, itensParaSalvar, removerItem, resolverDragEnd, type MotivoSemMudanca,
} from "@/lib/armario/montagem";

/** Item da grade: o mesmo shape do dialog + `cor_removida` (ponteiro/cor sumiu do cadastro vivo). */
export type GradeItem = VarianteItem & { cor_removida?: boolean };

interface ArmarioRow {
  id: string; nome: string; status: ArmarioStatus; colunas: number;
  colecao_id: string | null; colecao: string | null; subcolecao: string;
}

const STATUS_ROTULO: Record<ArmarioStatus, string> = { rascunho: "Rascunho", pronto: "Pronto", publicado: "Publicado" };
const STATUS_TOM: Record<ArmarioStatus, StatusTone> = { rascunho: "neutral", pronto: "info", publicado: "success" };
const MSG_TRAVADO = "Armário publicado é somente leitura — despublique antes (na lista de armários).";
const MSG_SEM_PERMISSAO = "Você não tem permissão para editar armários.";
const MOTIVO_AVISO: Partial<Record<MotivoSemMudanca, string>> = {
  duplicado: "Essa variante já está na grade.",
};

const rotuloItem = (i: GradeItem) => rotuloVariante({ modelo_id: i.modelo_id, cor_nome: i.cor_nome, cor_apelido_nome: i.cor_apelido_nome, cor_removida: i.cor_removida });

// ── leitura ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const naoVazio = (s: string | null | undefined) => (s && s.trim() ? s : null);

/** Itens salvos do armário na ordem, com foto/nome/REF do modelo e nomes VIVOS das cores (cor sumida do cadastro = `cor_removida`). */
async function carregarItens(armarioId: string): Promise<GradeItem[]> {
  const { data, error } = await (supabase.from("armario_itens" as any) as any)
    .select("modelo_id, origem, variante_tecido_id, produto_variante_id, cor_id, cor_apelido_id, ordem, modelos(nome, ref, ref_auto, fotos_modelo, desenho_tecnico_url, croqui_url)")
    .eq("armario_id", armarioId)
    .order("ordem");
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const corIds = [...new Set(rows.map((r) => r.cor_id).filter(Boolean))] as string[];
  const apIds = [...new Set(rows.map((r) => r.cor_apelido_id).filter(Boolean))] as string[];
  const nomes = async (tabela: string, ids: string[]) => {
    const m = new Map<string, string>();
    if (!ids.length) return m;
    const r = await (supabase.from(tabela as any) as any).select("id, nome").in("id", ids);
    if (r.error) throw r.error;
    for (const c of (r.data ?? []) as { id: string; nome: string }[]) m.set(c.id, c.nome);
    return m;
  };
  const [cores, apelidos] = await Promise.all([nomes("cores", corIds), nomes("cores_apelido", apIds)]);
  return rows.map((r) => {
    const mo = r.modelos ?? {};
    const corNome = r.cor_id ? cores.get(r.cor_id) ?? null : null;
    const apNome = r.cor_apelido_id ? apelidos.get(r.cor_apelido_id) ?? null : null;
    const item: GradeItem = {
      chave: "",
      modelo_id: r.modelo_id, nome: mo.nome ?? "(produto removido)", ref: naoVazio(mo.ref) ?? naoVazio(mo.ref_auto),
      foto_path: naoVazio(mo.fotos_modelo?.[0]) ?? naoVazio(mo.desenho_tecnico_url) ?? naoVazio(mo.croqui_url),
      origem: (r.origem ?? "interno") as ArmarioOrigem,
      variante_tecido_id: r.variante_tecido_id ?? null, produto_variante_id: r.produto_variante_id ?? null,
      cor_id: r.cor_id ?? null, cor_apelido_id: r.cor_apelido_id ?? null,
      cor_nome: corNome, cor_apelido_nome: apNome, ja_em_outro: false, armarios_com: [],
      // cor_id gravada que não existe mais no cadastro (ou nunca houve cor) = ponteiro órfão
      cor_removida: !r.cor_id || corNome == null,
    };
    item.chave = chaveVariante(item);
    return item;
  });
}

// ── DnD ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Vindo do dialog: pointer em cima de um card da grade (insere ali) ou do container (fim). Reordenar: card mais próximo. */
const detectarColisao: CollisionDetection = (args) => {
  const itens = args.droppableContainers.filter((c) => chaveDoIdGrade(c.id) != null);
  if (String(args.active.id).startsWith(VARIANTE_DRAG_PREFIXO)) {
    const noCard = pointerWithin({ ...args, droppableContainers: itens });
    if (noCard.length) return noCard;
    return pointerWithin({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.id === GRADE_DROP_ID) });
  }
  const perto = closestCenter({ ...args, droppableContainers: itens });
  if (perto.length) return perto;
  return pointerWithin({ ...args, droppableContainers: args.droppableContainers.filter((c) => c.id === GRADE_DROP_ID) });
};

function CardConteudo({ item, indice, compacto }: { item: GradeItem; indice: number; compacto: boolean }) {
  const cor = rotuloItem(item);
  return (
    <>
      <span
        data-testid="grade-indice"
        className="absolute left-1.5 top-1.5 z-10 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold tabular-nums text-primary-foreground shadow"
      >
        {indice}
      </span>
      <ModeloThumb path={item.foto_path} className="aspect-square h-auto w-full" alt={item.nome} />
      {!compacto && (
        <div className="mt-1.5 min-w-0">
          <p className="truncate text-sm font-medium leading-tight" title={item.nome}>{item.nome}</p>
          <p className="truncate text-xs text-muted-foreground">{item.ref ? `REF ${item.ref}` : "sem REF"}</p>
          <p className={`truncate text-xs ${item.cor_removida ? "italic text-amber-700 dark:text-amber-300" : ""}`} title={cor}>{cor}</p>
        </div>
      )}
    </>
  );
}

function CardGrade({
  item, indice, compacto, travado, onRemover,
}: { item: GradeItem; indice: number; compacto: boolean; travado: boolean; onRemover: (chave: string) => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging, isOver } = useSortable({
    id: idItemGrade(item.chave), data: { tipo: "grade" }, disabled: travado,
  });
  return (
    <div
      ref={setNodeRef}
      data-testid="grade-card"
      data-chave={item.chave}
      data-indice={indice}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`relative rounded-lg border bg-card p-2 ${isDragging ? "z-20 opacity-40" : ""} ${isOver && !isDragging ? "ring-2 ring-primary/60" : ""}`}
    >
      <div
        data-testid="grade-alca"
        {...(travado ? {} : attributes)}
        {...(travado ? {} : listeners)}
        className={travado ? "cursor-default" : "cursor-grab active:cursor-grabbing"}
      >
        <CardConteudo item={item} indice={indice} compacto={compacto} />
      </div>
      <Button
        type="button" size="iconSm" variant="secondary" disabled={travado}
        aria-label={`Remover ${item.nome} ${rotuloItem(item)}`}
        className="absolute right-1.5 top-1.5 z-10 h-6 w-6"
        onClick={() => onRemover(item.chave)}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function ZonaGrade({ travado, children }: { travado: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: GRADE_DROP_ID, disabled: travado });
  return (
    <div
      ref={setNodeRef}
      data-testid="armario-grade-zona"
      className={`min-h-[260px] rounded-lg border-2 border-dashed p-3 transition-colors ${isOver ? "border-primary/60 bg-primary/5" : "border-border"}`}
    >
      {children}
    </div>
  );
}

// ── editor (monta só depois que armário + itens chegaram: o estado local nasce dos dados salvos) ────────────────────────

export function MontagemEditor({
  armario, inicial, onVoltar,
}: { armario: ArmarioRow; inicial: GradeItem[]; onVoltar: () => void }) {
  const qc = useQueryClient();
  const readOnlyPerm = useReadOnly();
  const isMobile = useIsMobile();
  const publicado = armarioTravado(armario.status);
  const travado = publicado || readOnlyPerm;

  const [itens, setItens] = useState<readonly GradeItem[]>(inicial);
  const [colunas, setColunas] = useState<number>(armario.colunas);
  const [dialogAberto, setDialogAberto] = useState(false);
  const [ativo, setAtivo] = useState<Active | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const compacto = useCompactCards(gridRef, colunas);

  // dirty = ordem/conteúdo (chaves) ou nº de colunas diferentes do último estado salvo/carregado.
  const { dirty, reset: marcarSalvo } = useDirtySnapshot({ chaves: itens.map((i) => i.chave), colunas });
  const guard = useUnsavedGuard({ dirty, blockNav: true });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const chavesNaGrade = useMemo(() => new Set(itens.map((i) => i.chave)), [itens]);
  const idsSortable = useMemo(() => itens.map((i) => idItemGrade(i.chave)), [itens]);
  const colunasEfetivas = isMobile ? Math.min(colunas, 2) : colunas; // mobile: no máx. 2 (a ordem é a do índice, não da coluna)

  // Lista corrente p/ os handlers (evita efeito colateral — toast — dentro de updater de setState).
  const itensRef = useRef<readonly GradeItem[]>(itens);
  itensRef.current = itens;

  const avisarTrava = useCallback(() => toast.warning(publicado ? MSG_TRAVADO : MSG_SEM_PERMISSAO), [publicado]);

  const inserir = useCallback((item: VarianteItem) => {
    if (travado) { avisarTrava(); return; }
    const prox = inserirItem(itensRef.current as GradeItem[], item as GradeItem);
    if (prox === itensRef.current) toast.info(MOTIVO_AVISO.duplicado!);
    else setItens(prox);
  }, [travado, avisarTrava]);

  const remover = useCallback((chave: string) => {
    if (travado) { avisarTrava(); return; }
    setItens((atual) => removerItem(atual, chave));
  }, [travado, avisarTrava]);

  const onDragEnd = useCallback((ev: DragEndEvent) => {
    setAtivo(null);
    const data = ev.active.data.current as { tipo?: string; item?: VarianteItem } | undefined;
    const chaveGrade = chaveDoIdGrade(ev.active.id);
    const origem = data?.tipo === "variante" && data.item
      ? ({ tipo: "variante", item: data.item as GradeItem } as const)
      : chaveGrade != null ? ({ tipo: "grade", chave: chaveGrade } as const) : null;
    if (!origem) return;
    if (travado) { avisarTrava(); return; }
    const r = resolverDragEnd<GradeItem>({ lista: itensRef.current as GradeItem[], origem, overId: ev.over ? String(ev.over.id) : null, travado });
    if (r.mudou) setItens(r.lista);
    else if (r.motivo && MOTIVO_AVISO[r.motivo]) toast.info(MOTIVO_AVISO[r.motivo]!);
  }, [travado, avisarTrava]);

  const salvar = useMutation({
    // O que vai é o ESTADO NO CLIQUE (variáveis): edições feitas com o save em voo continuam "sujas".
    mutationFn: async (v: { itens: readonly GradeItem[]; colunas: number }) => {
      const { data, error } = await (supabase.rpc as any)("armario_salvar", {
        _id: armario.id, _colecao_id: armario.colecao_id, _colecao: armario.colecao, _subcolecao: armario.subcolecao,
        _nome: armario.nome, _colunas: v.colunas, _status: armario.status, _itens: itensParaSalvar(v.itens),
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      toast.success("Armário salvo.");
      marcarSalvo({ chaves: v.itens.map((i) => i.chave), colunas: v.colunas });
      qc.invalidateQueries({ queryKey: ["armario-variantes-disponiveis"] }); // ja_em_outro mudou
      qc.invalidateQueries({ queryKey: ["armario", armario.id] });
      qc.invalidateQueries({ queryKey: ["armario-itens", armario.id] });
      qc.invalidateQueries({ queryKey: ["armarios", armario.colecao_id, armario.subcolecao] }); // nº de variantes/colunas na lista
    },
    onError: (e) => toast.error(mensagemArmario(e, "Erro ao salvar o armário.")),
  });

  const opcoesColunas = useMemo(() => [...new Set<number>([...GRID_COLS_OPTIONS, colunas])].sort((a, b) => a - b), [colunas]);
  const ativoItem = useMemo(() => {
    if (!ativo) return null;
    const d = ativo.data.current as { tipo?: string; item?: VarianteItem } | undefined;
    if (d?.tipo === "variante" && d.item) return { item: d.item as GradeItem, indice: null as number | null };
    const k = chaveDoIdGrade(ativo.id);
    const i = k == null ? -1 : itens.findIndex((x) => x.chave === k);
    return i >= 0 ? { item: itens[i], indice: i + 1 } : null;
  }, [ativo, itens]);

  return (
    <div className="space-y-4 pb-6">
      <Breadcrumb items={[
        { label: "Estilo & Engenharia", to: "/criacao" },
        { label: "Armário", onClick: onVoltar },
        { label: "Montagem" },
      ]} />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onVoltar}>
          <ArrowLeft className="mr-1 h-4 w-4" /> Voltar à lista
        </Button>
        <h2 className="min-w-0 truncate text-lg font-semibold" data-testid="armario-nome">{armario.nome}</h2>
        <StatusBadge tone={STATUS_TOM[armario.status]}>{STATUS_ROTULO[armario.status]}</StatusBadge>
        <UnsavedIndicator show={dirty} className="ml-auto" />
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <Button size="sm" variant="outline" disabled={travado} onClick={() => setDialogAberto(true)}>
          <Plus className="mr-1 h-4 w-4" /> Adicionar variantes
        </Button>
        <div className="flex items-center gap-2">
          <span id="armario-colunas-rotulo" className="text-sm text-muted-foreground">Colunas</span>
          <Select value={String(colunas)} disabled={travado} onValueChange={(v) => setColunas(Number(v))}>
            <SelectTrigger aria-labelledby="armario-colunas-rotulo" className="h-8 w-[72px]" data-testid="armario-colunas">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {opcoesColunas.map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground">
          {itens.length} {itens.length === 1 ? "variante" : "variantes"} · a ordem de envio é 1, 2, 3… da esquerda p/ a direita, de cima p/ baixo
        </span>
        <Button size="sm" className="ml-auto" disabled={travado || !dirty || salvar.isPending} onClick={() => salvar.mutate({ itens, colunas })}>
          {salvar.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Salvar
        </Button>
      </div>

      {travado && (
        <p role="status" data-testid="armario-travado" className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <LockKeyhole className="h-4 w-4 shrink-0" /> {publicado ? MSG_TRAVADO : MSG_SEM_PERMISSAO}
        </p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={detectarColisao}
        onDragStart={(e) => setAtivo(e.active)}
        onDragCancel={() => setAtivo(null)}
        onDragEnd={onDragEnd}
      >
        <ZonaGrade travado={travado}>
          {itens.length === 0 && (
            <EmptyState
              icon={Plus}
              title="Grade vazia"
              description={travado ? "Este armário não tem variantes." : "Use “Adicionar variantes” e arraste (ou toque no +) para montar a vitrine."}
            />
          )}
          <SortableContext items={idsSortable} strategy={rectSortingStrategy} disabled={travado}>
            <div
              ref={gridRef}
              data-testid="armario-grade"
              className="grid gap-4"
              style={{ gridTemplateColumns: `repeat(${colunasEfetivas}, minmax(0, 1fr))` }}
            >
              {itens.map((it, i) => (
                <CardGrade key={it.chave} item={it} indice={i + 1} compacto={compacto} travado={travado} onRemover={remover} />
              ))}
            </div>
          </SortableContext>
        </ZonaGrade>

        {dialogAberto && !travado && (
          <VariantesDialog
            colecaoId={armario.colecao_id}
            colecao={armario.colecao ?? ""}
            subcolecao={armario.subcolecao}
            armarioId={armario.id}
            onFechar={() => setDialogAberto(false)}
            onAdicionar={inserir}
            chavesNaGrade={chavesNaGrade}
          />
        )}

        <DragOverlay dropAnimation={null}>
          {ativoItem ? (
            <div className="relative w-[150px] rounded-lg border-2 border-primary bg-card p-2 shadow-lg">
              <CardConteudo item={ativoItem.item} indice={ativoItem.indice ?? itens.length + 1} compacto={false} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <UnsavedChangesGuard confirm={guard.confirm} message="Há alterações não salvas neste armário. Se sair agora, a ordem e as colunas editadas serão perdidas." />
    </div>
  );
}

// ── casca: carrega e delega ──────────────────────────────────────────────────────────────────────────────────────────────

export function ArmarioMontagem({ armarioId, onVoltar }: { armarioId: string; onVoltar: () => void }) {
  const armarioQ = useQuery({
    queryKey: ["armario", armarioId],
    queryFn: async (): Promise<ArmarioRow | null> => {
      const { data, error } = await (supabase.from("armarios" as any) as any)
        .select("id, nome, status, colunas, colecao_id, colecao, subcolecao")
        .eq("id", armarioId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ArmarioRow | null;
    },
  });
  const itensQ = useQuery({ queryKey: ["armario-itens", armarioId], queryFn: () => carregarItens(armarioId) });

  if (armarioQ.isError || itensQ.isError) {
    return (
      <div className="space-y-3">
        <Button variant="outline" size="sm" onClick={onVoltar}><ArrowLeft className="mr-1 h-4 w-4" /> Voltar à lista</Button>
        <p className="text-sm text-destructive">{mensagemArmario(armarioQ.error ?? itensQ.error, "Não foi possível carregar o armário.")}</p>
      </div>
    );
  }
  if (armarioQ.isLoading || itensQ.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando armário…</div>;
  }
  if (!armarioQ.data) {
    return (
      <div className="space-y-3">
        <Button variant="outline" size="sm" onClick={onVoltar}><ArrowLeft className="mr-1 h-4 w-4" /> Voltar à lista</Button>
        <p className="text-sm text-muted-foreground" data-testid="armario-inexistente">Armário não encontrado (já foi excluído ou é de outra loja).</p>
      </div>
    );
  }
  return <MontagemEditor key={armarioQ.data.id} armario={armarioQ.data} inicial={itensQ.data ?? []} onVoltar={onVoltar} />;
}
