import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

// Padrões v3 §Q9: fórmula ÚNICA de tom, centralizada em src/styles.css como tokens
// --tone-<tom>-bg/-fg. O fundo mistura contra var(--card) (não mais contra transparent,
// que lavava no tema escuro e dependia do que estava atrás); o texto mistura contra
// var(--foreground) p/ contraste AA. Cada tema (:root / .dark) tem seus %.
const toneClasses: Record<StatusTone, string> = {
  success: "border-transparent bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]",
  warning: "border-transparent bg-[var(--tone-warning-bg)] text-[var(--tone-warning-fg)]",
  danger: "border-transparent bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]",
  info: "border-transparent bg-[var(--tone-info-bg)] text-[var(--tone-info-fg)]",
  neutral: "border-transparent bg-[var(--tone-neutral-bg)] text-[var(--tone-neutral-fg)]",
};

// `title`/`onClick`/demais atributos nativos passam por Omit+spread — cobre chips que
// hoje precisam de tooltip (title=) ou outro atributo do <div> sem precisar de wrapper.
// Extensão única (ago/2026, campanha StatusBadge): a migração dos ~105 badges à mão
// achou vários casos reais com `title=` no elemento cru — sem isso, viraria wrapper
// span redundante em cada um.
type Props = {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">;

export function StatusBadge({ tone, children, className, ...rest }: Props) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium uppercase tracking-wider text-[10px] px-2 py-0.5",
        toneClasses[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </Badge>
  );
}
