import { cn } from "@/lib/utils";

interface UnsavedIndicatorProps {
  show: boolean;
  className?: string;
}

/**
 * Selo INLINE "● alterações não salvas" — PÍLULA âmbar (padrão Navy Trust v2, dono
 * ago/2026: fundo amarelo em TODAS as telas, como no mockup). Renderize no HEADER da
 * tela de edição, alinhado à direita (ex.: `className="ml-auto shrink-0"`), acima da
 * linha separadora. A confirmação de descarte fica no `<UnsavedChangesGuard>`.
 */
export function UnsavedIndicator({ show, className }: UnsavedIndicatorProps) {
  if (!show) return null;
  return (
    <span
      title="Há alterações não salvas"
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold",
        "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
        className,
      )}
    >
      <i className="h-[7px] w-[7px] shrink-0 rounded-full bg-amber-600 dark:bg-amber-400" aria-hidden />
      alterações não salvas
    </span>
  );
}
