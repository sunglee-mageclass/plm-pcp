import { cn } from "@/lib/utils";

interface UnsavedIndicatorProps {
  show: boolean;
  className?: string;
}

/**
 * Selo INLINE "● alterações não salvas" (âmbar). Renderize no HEADER da tela de
 * edição, alinhado à direita (ex.: `className="ml-auto shrink-0"`), acima da linha
 * separadora. A confirmação de descarte fica no `<UnsavedChangesGuard>`.
 */
export function UnsavedIndicator({ show, className }: UnsavedIndicatorProps) {
  if (!show) return null;
  return (
    <span
      title="Há alterações não salvas"
      className={cn("text-amber-600 text-xs whitespace-nowrap", className)}
    >
      ● alterações não salvas
    </span>
  );
}
