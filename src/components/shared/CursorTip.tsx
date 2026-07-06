import { useRef, useState, type ReactNode, type MouseEvent } from "react";
import { createPortal } from "react-dom";

/**
 * Tooltip estilizado que SEGUE o cursor, sem o atraso do `title` nativo.
 *
 * Uso: `const { handlers, node } = useCursorTip(conteudo)` — espalhe `handlers` no
 * elemento-gatilho e renderize `{node}` no mesmo componente (ele vai por portal p/ o body).
 * Passe `null`/"" p/ desligar (aí não há listeners nem tooltip).
 *
 * Performance: a posição é escrita direto no DOM no `onMouseMove` (sem setState por
 * movimento → sem re-render do card). Só entra/sai do hover disparam render.
 */
export function useCursorTip(content: ReactNode) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const move = (e: MouseEvent) => {
    const el = ref.current;
    if (el) {
      el.style.left = `${e.clientX + 12}px`;
      el.style.top = `${e.clientY + 12}px`;
    }
  };

  const on = content != null && content !== "";
  const handlers = on
    ? {
        onMouseEnter: (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY }),
        onMouseMove: move,
        onMouseLeave: () => setPos(null),
      }
    : {};

  const node =
    on && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={ref}
            style={{ position: "fixed", left: pos.x + 12, top: pos.y + 12, zIndex: 60 }}
            className="pointer-events-none max-w-xs whitespace-pre-line rounded-md border bg-primary px-2 py-1 text-xs leading-snug text-primary-foreground shadow-md"
          >
            {content}
          </div>,
          document.body,
        )
      : null;

  return { handlers, node };
}
