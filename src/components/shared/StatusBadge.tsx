import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const toneClasses: Record<StatusTone, string> = {
  success:
    "border-transparent bg-[color:color-mix(in_oklab,var(--color-success)_15%,transparent)] text-[color:var(--color-success)]",
  warning:
    "border-transparent bg-[color:color-mix(in_oklab,var(--color-warning)_20%,transparent)] text-[color:color-mix(in_oklab,var(--color-warning)_70%,black_30%)]",
  danger:
    "border-transparent bg-[color:color-mix(in_oklab,var(--color-destructive)_15%,transparent)] text-[color:var(--color-destructive)]",
  info:
    "border-transparent bg-primary/10 text-primary",
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
