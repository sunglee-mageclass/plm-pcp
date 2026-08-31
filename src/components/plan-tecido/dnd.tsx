import type { ReactNode } from "react";
import { useDraggable, useDroppable, type DraggableAttributes } from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";

/** Props da ALÇA de arraste (o header do card) — espalhadas no elemento que inicia o drag. */
export type DragHandle = { attributes: DraggableAttributes; listeners: SyntheticListenerMap | undefined };

/** Lane (categoria) = zona onde se solta o card. id = `lane:${cid ?? "__sem__"}`.
 * `vertical` empilha o conteúdo (usado quando há 2º nível de agrupamento por nome do tecido:
 * cada sub-grupo de nome é uma linha horizontal própria). */
export function DroppableLane({ id, children, vertical }: { id: string; children: ReactNode; vertical?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`${vertical ? "flex flex-col gap-3" : "flex items-start gap-3 overflow-x-auto max-md:snap-x max-md:snap-mandatory"} rounded-lg pb-2 transition-shadow ${isOver ? "bg-primary/5 ring-2 ring-inset ring-primary/50" : ""}`}>
      {children}
    </div>
  );
}

/**
 * Card arrastável. O drag é iniciado pela ALÇA (o header do card) — passada via children(handle).
 * Assim o corpo (inputs/botões/dropdowns) segue 100% clicável; a distância de ativação (no sensor)
 * deixa o clique simples passar (ex.: recolher/expandir o card).
 */
export function DraggableCard({ id, children }: { id: string; children: (handle: DragHandle) => ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;
  return (
    <div ref={setNodeRef} style={style} className={`w-[360px] max-md:w-[85vw] shrink-0 max-md:snap-start ${isDragging ? "opacity-40" : ""}`}>
      {children({ attributes, listeners })}
    </div>
  );
}
