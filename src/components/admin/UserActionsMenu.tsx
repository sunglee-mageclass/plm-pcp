import type { ComponentType } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent, PopoverClose } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type UserAction = {
  label: string;
  icon: ComponentType<{ className?: string }>;
  onClick: () => void;
  destructive?: boolean;
  /** Desenha uma divisória acima (separa o cluster destrutivo). */
  separatorBefore?: boolean;
};

/**
 * Menu "⋯" de ações de baixa frequência de uma linha de usuário. Cada item tem
 * ÍCONE + RÓTULO (reconhecimento > evocação) e fecha o popover ao clicar. As ações
 * destrutivas ficam separadas por divisória. Alvo de toque ~44px no trigger (size=icon).
 */
export function UserActionsMenu({ actions }: { actions: UserAction[] }) {
  if (actions.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Mais ações">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        {actions.map((a) => {
          const Icon = a.icon;
          return (
            <div key={a.label}>
              {a.separatorBefore && <div className="my-1 border-t" />}
              <PopoverClose asChild>
                <button
                  type="button"
                  onClick={a.onClick}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-2.5 text-left text-sm hover:bg-muted",
                    a.destructive && "text-destructive hover:bg-destructive/10",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {a.label}
                </button>
              </PopoverClose>
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
