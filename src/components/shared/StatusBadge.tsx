import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

// Texto ESCURECIDO via color-mix com o foreground: no tema claro puxa pro escuro (AA) e no
// escuro o foreground é claro, então puxa pro claro — o mesmo mix serve aos dois temas.
// (Q2 do laudo UX: success puro dava 2,9:1 sobre o tint no claro; warning já tinha o fix.)
const toneClasses: Record<StatusTone, string> = {
  success:
    "border-transparent bg-[color:color-mix(in_oklab,var(--color-success)_15%,transparent)] text-[color:color-mix(in_oklab,var(--color-success)_62%,var(--color-foreground)_38%)]",
  warning:
    "border-transparent bg-[color:color-mix(in_oklab,var(--color-warning)_20%,transparent)] text-[color:color-mix(in_oklab,var(--color-warning)_46%,var(--color-foreground)_54%)]",
  danger:
    "border-transparent bg-[color:color-mix(in_oklab,var(--color-destructive)_15%,transparent)] text-[color:color-mix(in_oklab,var(--color-destructive)_66%,var(--color-foreground)_34%)]",
  info:
    "border-transparent bg-primary/10 text-[color:color-mix(in_oklab,var(--color-primary)_70%,var(--color-foreground)_30%)]",
  neutral:
    "border-transparent bg-muted text-muted-foreground",
};

type Props = {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
};

export function StatusBadge({ tone, children, className }: Props) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium uppercase tracking-wider text-[10px] px-2 py-0.5",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </Badge>
  );
}
