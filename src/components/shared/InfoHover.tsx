import { Children, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * "i" discreto ao lado de um rótulo que mostra uma informação complementar ao passar o mouse — no lugar de texto
 * fixo embaixo do campo (dono, 25/set: "mensagem desnecessária… helper ao passar o mouse"). Mesmo visual do
 * `CondicaoInfo` (abre sem atraso, provider local). Diferença: aqui o conteúdo às vezes é o ÚNICO lugar onde a
 * informação aparece (ex.: por que a Origem está travada), então o "i" também abre com TOQUE/clique — o Tooltip
 * do Radix ignora toque (`pointerType === "touch"`) e fecha no `pointerdown`; por isso o `open` é controlado e o
 * clique alterna. Toque fora fecha (DismissableLayer do próprio Tooltip). Sem conteúdo = não renderiza nada.
 */
export function InfoHover({ ariaLabel, children, className }: { ariaLabel: string; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  if (Children.toArray(children).length === 0) return null;
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <button
            type="button"
            // preventDefault nos dois: o Radix pula os handlers dele (composeEventHandlers) — sem isso o pointerdown
            // do toque fecha e o clique fecha de novo; e, dentro de <label>/linha clicável, não dispara o pai.
            onPointerDown={(e) => e.preventDefault()}
            onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }}
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
