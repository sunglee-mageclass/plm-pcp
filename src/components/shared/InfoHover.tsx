import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * "i" discreto ao lado de um rótulo que mostra uma informação complementar ao passar o mouse — no lugar de texto
 * fixo embaixo do campo (dono, 25/set: "mensagem desnecessária… helper ao passar o mouse"). Mesmo padrão do
 * `CondicaoInfo`: abre sem atraso, provider local, desktop-hover (sem handler de toque). `children` vazio = nada.
 */
export function InfoHover({ ariaLabel, children, className }: { ariaLabel: string; children: ReactNode; className?: string }) {
  if (children == null || children === false || children === "") return null;
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // dentro de <label>/linha clicável: não disparar a ação do pai
            onClick={(e) => e.preventDefault()}
            className={`inline-flex shrink-0 items-center rounded-full text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className ?? ""}`}
            aria-label={ariaLabel}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[280px] space-y-1.5 text-xs leading-snug">{children}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
