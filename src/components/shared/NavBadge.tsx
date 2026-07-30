import { cn } from "@/lib/utils";

/**
 * Pílula de contagem de pendência (sidebar + hubs de setor). As cores vêm de
 * `BADGE_CLS` em `@/lib/nav` (SSOT) — vermelho atraso/erro, âmbar alerta, azul pronto.
 */
export function NavBadge({ n, className }: { n: number; className?: string }) {
  if (!n || n <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums",
        className,
      )}
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
