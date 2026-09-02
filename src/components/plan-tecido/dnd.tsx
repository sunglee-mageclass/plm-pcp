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
 * Prefixa o id do CORPO da lane (`lane:…`/`mixlane:…`) para o id do HEADER droppable
 * (`lanehdr:…`/`mixlanehdr:…`). Ids DISTINTOS de propósito: se header e corpo usassem o MESMO id,
 * o @dnd-kit (Map keyed por id) deixaria o corpo — montado depois — "ganhar" o slot; ao RECOLHER,
 * o unmount do corpo DESREGISTRARIA a entrada e o header (que não re-registra, dep `[id]` imutável)
 * pararia de aceitar drop após 1 ciclo abrir→fechar. Com ids próprios, os ciclos de vida ficam
 * desacoplados. O `handleDragEnd` traduz `*hdr:` de volta ao id do corpo. */
export function idHeaderDaLane(idCorpo: string): string {
  return idCorpo.startsWith("mixlane:") ? `mixlanehdr:${idCorpo.slice(8)}`
    : idCorpo.startsWith("lane:") ? `lanehdr:${idCorpo.slice(5)}`
    : `hdr:${idCorpo}`;
}

/**
 * Cabeçalho de lane que TAMBÉM é zona de drop, com id PRÓPRIO (`lanehdr:…`/`mixlanehdr:…`) derivado
 * do id do corpo. Sempre montado (fica FORA do `{!laneRecolhida && …}`), então aceita soltar um card
 * numa lane RECOLHIDA (a lane permanece fechada; o card entra e o contador sobe). Só aplica `ref` +
 * className (nenhum listener) → o botão chevron/toggle e o X seguem 100% clicáveis; o drop só dispara
 * no fim do arraste. Realça (âmbar) enquanto um card paira por cima (`isOver`).
 * `idCorpo` = o MESMO id passado à `DroppableLane` do corpo (`lane:…`/`mixlane:…`). */
export function DroppableLaneHeader({ idCorpo, children }: { idCorpo: string; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: idHeaderDaLane(idCorpo) });
  return (
    <div ref={setNodeRef} className={`rounded-md transition-colors ${isOver ? "bg-primary/10 ring-2 ring-inset ring-primary/50" : ""}`}>
      {children}
    </div>
  );
}

/**
 * Card arrastável. O drag é iniciado pela ALÇA (o header do card) — passada via children(handle).
 * Assim o corpo (inputs/botões/dropdowns) segue 100% clicável; a distância de ativação (no sensor)
 * deixa o clique simples passar (ex.: recolher/expandir o card).
 */
export function DraggableCard({ id, children, esmaecido }: { id: string; children: (handle: DragHandle) => ReactNode; esmaecido?: boolean }) {
  const { setNodeRef, attributes, listeners, transform, isDragging } = useDraggable({ id });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined;
  // `isDragging` = o card segurado; `esmaecido` = companheiro de uma seleção múltipla em arraste
  // (some junto, reforçando "movendo vários"). Mesma opacidade nos dois.
  return (
    <div ref={setNodeRef} style={style} className={`w-[360px] max-md:w-[85vw] shrink-0 max-md:snap-start transition-opacity ${isDragging || esmaecido ? "opacity-40" : ""}`}>
      {children({ attributes, listeners })}
    </div>
  );
}
