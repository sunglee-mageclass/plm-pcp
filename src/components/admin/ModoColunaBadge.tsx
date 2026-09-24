import { Hand, Lock, LogIn, Zap } from "lucide-react";
import { descricaoModoColuna, rotuloModoColuna, type ModoColuna } from "@/lib/kanban-auto-ui";

// Cor por modo — mesmos tokens de tom que a etiqueta usava (`StatusBadge` tone info/neutral),
// aplicados agora ao ÍCONE em vez do fundo do chip.
const CLASSE_TOM: Record<ModoColuna, string> = {
  entrada: "text-[var(--tone-info-fg)]",
  automatica: "text-[var(--tone-info-fg)]",
  manual: "text-[var(--tone-neutral-fg)]",
  manual_sempre: "text-[var(--tone-neutral-fg)]",
};

/** Texto completo (rótulo + descrição) usado no `aria-label`/`title` — mesma informação que a
 *  etiqueta de texto mostrava antes de virar ícone. */
function textoCompleto(modo: ModoColuna): string {
  return `${rotuloModoColuna(modo)}: ${descricaoModoColuna(modo)}`;
}

/** Ícone (SÓ ícone, sem texto) de Entrada / Automática / Manual / Manual (sempre) de uma coluna
 *  do kanban (Config da Loja — F2, pedido do dono: etiquetas viram ícone). Mesmo mapa de ícones
 *  do quadro de Desenvolvimento (`ModoColunaIcone` em criacao.desenvolvimento.tsx): Zap=automática,
 *  Hand=manual. Aqui, mais granular (Entrada e Manual-sempre ganham ícone próprio): LogIn=entrada,
 *  Hand+Lock=manual (sempre, Reprovado). `aria-label`/`title` levam o texto completo de hoje. */
export function ModoColunaBadge({ modo }: { modo: ModoColuna | null }) {
  if (!modo) return null;
  const texto = textoCompleto(modo);
  const classe = `inline-flex shrink-0 items-center ${CLASSE_TOM[modo]}`;

  if (modo === "manual_sempre") {
    return (
      <span
        data-testid={`modo-coluna-${modo}`}
        role="img"
        aria-label={texto}
        title={texto}
        className={`${classe} gap-0.5`}
      >
        <Hand className="h-4 w-4" />
        <Lock className="h-3 w-3" />
      </span>
    );
  }

  const Icon = modo === "entrada" ? LogIn : modo === "automatica" ? Zap : Hand;
  return (
    <span
      data-testid={`modo-coluna-${modo}`}
      role="img"
      aria-label={texto}
      title={texto}
      className={classe}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}
