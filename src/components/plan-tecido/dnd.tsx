import type { ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";

/** Lane (categoria) = zona onde se solta o card. id = `lane:${cid ?? "__sem__"}`. */
export function DroppableLane({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`flex items-start gap-3 overflow-x-auto rounded-lg pb-2 transition-shadow ${isOver ? "bg-primary/5 ring-2 ring-inset ring-primary/50" : ""}`}>
      {children}
    </div>
  );
}

/** Card arrastável — a alça "mover" (grip) inicia o arraste; o resto do card fica clicável. */
export function DraggableCard({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;
  return (
    <div ref={setNodeRef} style={style} className={`relative w-[360px] shrink-0 ${isDragging ? "opacity-60" : ""}`}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute -top-2 left-1/2 z-10 flex -translate-x-1/2 cursor-grab touch-none items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[10px] text-muted-foreground shadow-sm hover:text-foreground active:cursor-grabbing"
        title="Arraste para outra categoria"
      >
        <GripVertical className="h-3 w-3" /> mover
      </button>
      {children}
    </div>
  );
}
