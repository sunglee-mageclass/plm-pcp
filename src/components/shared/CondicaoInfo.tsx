import { Info, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Ícone "i" de informação com tooltip explicativo de uma condição do kanban.
 *
 * Motivação (dono, set/2026): os requisitos precisam ser CLAROS, sem gerar dúvida — e "muito
 * texto não significa claro". Em vez de despejar a explicação como texto solto embaixo de cada
 * requisito (parede de texto), a explicação vem sob demanda: um "i" discreto ao lado do rótulo
 * abre um tooltip no hover com a descrição curta + o aviso de armadilha (se houver).
 *
 * Desktop-hover apenas (decisão do dono): sem handlers de toque. No mobile o "i" simplesmente
 * não abre nada. Segue o padrão local de TooltipProvider do sistema (cada tooltip embrulha o
 * seu, como em MoListaSection) — não há provider global no root.
 *
 * Renderiza `null` quando não há nem descrição nem aviso (nada a explicar).
 */
export function CondicaoInfo({ descricao, aviso }: { descricao?: string; aviso?: string }) {
  if (!descricao && !aviso) return null;
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            // não togglar o requisito ao clicar no "i" (fica dentro de <label>/linha clicável)
            onClick={(e) => e.preventDefault()}
            className="inline-flex shrink-0 items-center text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
            aria-label="O que é este requisito?"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] space-y-1.5">
          {descricao && <p className="text-xs leading-snug">{descricao}</p>}
          {aviso && (
            <p className="flex items-start gap-1 text-xs leading-snug text-amber-200">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{aviso}</span>
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
