import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Item de uma OC com VÁRIOS produtos, em acordeão (R13, mockup superfície 3 · "Produtos da OC"). Genérico de propósito: a OC de
 * Produto Acabado (T7) e a de Importado (T8) usam o MESMO — só mudam o `titulo`/`subtitulo`/`selos` e o corpo (`children`).
 *
 * O cabeçalho inteiro é o botão (abre/fecha); o estado `aberto` mora em quem usa (a lista de itens sobrevive ao fechar). O corpo só é
 * montado ABERTO (a OC pode ter muitos produtos × grade; fechado não pesa).
 */
export function OcItemAcordeao({
  id, aberto, onToggle, thumb, titulo, subtitulo, selos, children, className, emConflito = false,
}: {
  /** id do DOM do item (âncora/teste). */
  id?: string;
  aberto: boolean;
  onToggle: () => void;
  thumb?: ReactNode;
  titulo: ReactNode;
  subtitulo?: ReactNode;
  /** Selos de situação à direita do cabeçalho (StatusBadge). */
  selos?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Tem conflito de colaboração neste item: borda de destaque. */
  emConflito?: boolean;
}) {
  const Chevron = aberto ? ChevronDown : ChevronRight;
  return (
    <div
      id={id}
      className={cn(
        "rounded-lg border bg-card",
        emConflito && "border-[var(--tone-warning-fg)]",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={aberto}
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-lg p-3 text-left hover:bg-muted/40 max-md:flex-wrap"
      >
        <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        {thumb}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{titulo}</div>
          {subtitulo && <div className="truncate text-xs text-muted-foreground">{subtitulo}</div>}
        </div>
        {selos && <div className="flex flex-wrap items-center justify-end gap-1 max-md:w-full max-md:justify-start">{selos}</div>}
      </button>
      {aberto && <div className="space-y-4 border-t p-3">{children}</div>}
    </div>
  );
}
