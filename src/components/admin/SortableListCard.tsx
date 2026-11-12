import { useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

/**
 * Lista ordenável de labels (arrastar, renomear, excluir, adicionar) — extraída de `admin/configuracoes.tsx` (Etapas PL, Task 7)
 * para ser reusada pelo card "Etapas PL" sem import circular com a rota. Comportamento INALTERADO (movido byte a byte).
 */
export function SortableListCard({
  title,
  description,
  items,
  onChange,
  placeholder,
  renderItemExtra,
  onItemRemoved,
  footer,
  topo,
}: {
  title: string;
  description?: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  renderItemExtra?: (label: string, index: number) => React.ReactNode;
  // Chamado ANTES de remover, com o item que está saindo — p/ limpar config derivada
  // (ex.: Envio à Explosão) que apontava pra essa linha.
  onItemRemoved?: (label: string, index: number) => void;
  // Conteúdo extra abaixo da lista (legenda/avisos do bloco).
  footer?: React.ReactNode;
  // Conteúdo no TOPO do card, antes do campo de adicionar (Status do Kanban: a chave "Kanban automático").
  topo?: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const ids = items.map((label, idx) => `${idx}::${label}`);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(items, oldIndex, newIndex));
  };

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (items.includes(v)) {
      toast.error("Item já existe.");
      return;
    }
    onChange([...items, v]);
    setDraft("");
  };

  const update = (index: number, value: string) => {
    const next = [...items];
    next[index] = value;
    onChange(next);
  };

  const remove = (index: number) => {
    onItemRemoved?.(items[index], index);
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        {topo}
        <div className="flex gap-2">
          <Input
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button type="button" onClick={add} variant="secondary">
            <Plus className="h-4 w-4 mr-1" /> Adicionar
          </Button>
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {items.map((label, idx) => (
                <SortableItem
                  key={ids[idx]}
                  id={ids[idx]}
                  value={label}
                  onChange={(v) => update(idx, v)}
                  onRemove={() => remove(idx)}
                  extra={renderItemExtra?.(label, idx)}
                />
              ))}
              {items.length === 0 && (
                <li className="text-sm text-muted-foreground italic">Nenhum item ainda.</li>
              )}
            </ul>
          </SortableContext>
        </DndContext>
        {footer}
      </CardContent>
    </Card>
  );
}

function SortableItem({
  id,
  value,
  onChange,
  onRemove,
  extra,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onRemove: () => void;
  extra?: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const trashButton = (
    <Button type="button" size="icon" variant="ghost" onClick={onRemove} aria-label="Excluir item">
      <Trash2 className="h-4 w-4 text-destructive" />
    </Button>
  );
  return (
    <li ref={setNodeRef} style={style} className="rounded-md border bg-card p-2">
      {/* `flex-wrap`: o card "Status do Kanban" fica estreito no grid de 2 colunas do desktop
          (~514px) mesmo a 1400px de viewport — o breakpoint `md:` dos botões extras é por
          VIEWPORT, não pelo container, então eles continuam lado a lado com o nome mesmo sem
          espaço. O nome tem prioridade: `flex-1 min-w-[9rem]` no Input garante uma largura
          mínima legível; sem espaço pros extras na mesma linha, eles quebram pra 2ª linha
          (em vez de espremer o nome a poucos px, cortando "Desenho Técnico" → "Dese"). */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="flex shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground touch-none hover:text-foreground max-md:min-h-11 max-md:min-w-10"
          {...attributes}
          {...listeners}
          aria-label="Arrastar"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 min-w-[9rem] flex-1 border-0 shadow-none focus-visible:ring-1 max-md:h-11"
        />
        {/* Sem ações extras (ex.: outras listas sem `extra`): Excluir fica sempre inline —
            só 1 botão, não precisa de 2ª linha no mobile. Com `extra` (Status do Kanban:
            Requisitos + Explosão + Excluir), a linha fica estreita demais no mobile p/ os
            3 controles de 44px ao lado do rótulo — desce pra 2ª linha (abaixo). */}
        {!extra && trashButton}
        {extra && <div className="hidden shrink-0 items-center gap-2 md:flex">{extra}{trashButton}</div>}
      </div>
      {extra && (
        <div className="mt-2 flex items-center justify-end gap-2 md:hidden">{extra}{trashButton}</div>
      )}
    </li>
  );
}
