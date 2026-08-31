import { ChevronsDownUp, Rows3, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type RecolherMenuProps = {
  todasSecoesRecolhidas: boolean;
  todosRecolhidos: boolean;
  onToggleSecoes: () => void;
  onToggleCards: () => void;
};

/**
 * Menu "⋯" só-ícone que funde "Recolher seções" + "Recolher cards" (antes 2 Buttons
 * com texto longo que estouravam a barra no mobile). Mesma estética do AgrupamentoButton
 * vizinho (src/components/shared/filters.tsx) e do UserActionsMenu (Popover + lista de
 * <button> em PopoverClose). Só apresentação — os 2 states/handlers seguem no Sheet.
 */
export function RecolherMenu({ todasSecoesRecolhidas, todosRecolhidos, onToggleSecoes, onToggleCards }: RecolherMenuProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="px-2" aria-label="Recolher ou expandir" title="Recolher / expandir">
          <ChevronsDownUp className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        <PopoverClose asChild>
          <button
            type="button"
            onClick={onToggleSecoes}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent max-md:min-h-11"
          >
            <Rows3 className="h-4 w-4 text-muted-foreground" />
            {todasSecoesRecolhidas ? "Expandir seções" : "Recolher seções"}
          </button>
        </PopoverClose>
        <PopoverClose asChild>
          <button
            type="button"
            onClick={onToggleCards}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent max-md:min-h-11"
          >
            <Square className="h-4 w-4 text-muted-foreground" />
            {todosRecolhidos ? "Expandir cards" : "Recolher cards"}
          </button>
        </PopoverClose>
      </PopoverContent>
    </Popover>
  );
}
