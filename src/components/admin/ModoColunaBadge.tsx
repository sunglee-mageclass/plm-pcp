import { ArrowRight, Hand, Zap } from "lucide-react";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { descricaoModoColuna, rotuloModoColuna, type ModoColuna } from "@/lib/kanban-auto-ui";

/** Etiqueta Entrada / Automática / Manual / Manual (sempre) de uma coluna do kanban (Config da Loja — F2). */
export function ModoColunaBadge({ modo }: { modo: ModoColuna | null }) {
  if (!modo) return null;
  const Icon = modo === "entrada" ? ArrowRight : modo === "automatica" ? Zap : Hand;
  return (
    <StatusBadge
      tone={modo === "entrada" || modo === "automatica" ? "info" : "neutral"}
      data-testid={`modo-coluna-${modo}`}
      title={descricaoModoColuna(modo)}
      className="shrink-0 gap-1 normal-case tracking-normal"
    >
      <Icon className="h-3 w-3" />
      {rotuloModoColuna(modo)}
    </StatusBadge>
  );
}
