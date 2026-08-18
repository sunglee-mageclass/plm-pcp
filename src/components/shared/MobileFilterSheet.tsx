import { useState, type ReactNode } from "react";
import { Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * Chip "Filtros (N)" + bottom sheet com rodapé fixo Limpar · Aplicar (padrão mobile do
 * projeto). FONTE ÚNICA do chrome de filtro mobile: o corpo é `children` LIVRE (campos de
 * filtro reais — selects, chips, DateFields…). O `MobileFilterBar` do dashboard é só uma
 * CASCA fina em cima deste (monta período + selects como children) — antes os dois duplicavam
 * o mesmo chrome quase verbatim. Os filtros aplicam ao vivo (onChange dos próprios campos);
 * "Aplicar" só fecha; "Limpar" chama onClear. Alvos ≥ 44px. Use `md:hidden` no wrapper (o
 * desktop mantém seu `FilterButton`).
 */
export function MobileFilterSheet({
  activeCount, onClear, children, className, title = "Filtros",
}: {
  activeCount: number;
  onClear: () => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-primary bg-primary/10 px-4 text-[13px] font-semibold text-primary"
      >
        <Filter className="h-4 w-4" aria-hidden /> {title}
        {activeCount > 0 && (
          <span className="rounded-full bg-primary px-2 text-[11px] font-bold tabular-nums text-primary-foreground">{activeCount}</span>
        )}
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className={cn("flex max-h-[85vh] flex-col gap-0 rounded-t-2xl p-0")}>
          <SheetHeader className="shrink-0 p-4 pb-2 pr-12 text-left">
            <SheetTitle className="text-base">{title}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">{children}</div>
          <div className="flex shrink-0 gap-2 border-t p-3">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={onClear}>Limpar</Button>
            <Button type="button" className="h-11 flex-1" onClick={() => setOpen(false)}>Aplicar</Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
