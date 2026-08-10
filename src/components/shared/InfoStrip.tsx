import { cn } from "@/lib/utils";

// Tira de resumo (§K do ui-padroes.md): pares rótulo/valor sobre bg-muted, tabular-nums —
// para dado DERIVADO da própria tela (ex.: bruto→desconto→total→v.unit real de uma OC) ou
// para dado de OUTRA tela (nunca um input travado — ver §K). `hi` destaca o item (ex.: o
// valor final da cadeia).
export type InfoStripItem = { label: string; valor: React.ReactNode; hi?: boolean };

export function InfoStrip({ itens, className }: { itens: InfoStripItem[]; className?: string }) {
  if (itens.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-[22px] gap-y-1.5 rounded-md border bg-muted/40 px-4 py-3", className)}>
      {itens.map((it, i) => (
        <span key={i} className="flex items-baseline gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{it.label}</span>
          <span className={cn("tabular-nums", it.hi ? "text-base font-bold text-foreground" : "text-sm font-medium")}>
            {it.valor}
          </span>
        </span>
      ))}
    </div>
  );
}
