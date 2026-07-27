import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { TableHead } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/** Ícone ⓘ com tooltip explicativo — irmão do botão de ordenação (não aninhado). */
function HeaderInfo({ tip }: { tip: ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 text-muted-foreground/70 hover:text-foreground focus-visible:outline-none focus-visible:text-foreground"
            aria-label="O que é esta coluna"
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] whitespace-normal text-left text-xs font-normal leading-snug">
          {tip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export type SortDir = "asc" | "desc";

/**
 * Ordenação reutilizável de listas/tabelas. Compara número-vs-número numericamente,
 * texto com `localeCompare` pt-BR (numeric), e joga nulos pro fim. Aceita um `accessor`
 * por chave p/ valores derivados (ex.: ordenar por uma data formatada pelo valor cru).
 *
 * const { sorted, sortKey, sortDir, toggle } = useSort(rows, { key: "nome" });
 */
export function useSort<T>(
  rows: T[],
  opts?: { key?: string | null; dir?: SortDir; accessors?: Record<string, (row: T) => unknown> },
) {
  const [sortKey, setSortKey] = useState<string | null>(opts?.key ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(opts?.dir ?? "asc");

  const toggle = (key: string) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const get = (row: T) =>
      opts?.accessors?.[sortKey] ? opts.accessors[sortKey](row) : (row as any)?.[sortKey];
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = get(a), bv = get(b);
      const aEmpty = av == null || av === "";
      const bEmpty = bv == null || bv === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1; // vazios por último
      if (bEmpty) return -1;
      const an = Number(av), bn = Number(bv);
      const numeric = !Number.isNaN(an) && !Number.isNaN(bn) && typeof av !== "boolean" && typeof bv !== "boolean";
      const cmp = numeric
        ? an - bn
        : String(av).localeCompare(String(bv), "pt-BR", { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir, opts]);

  return { sorted, sortKey, sortDir, toggle };
}

function Indicator({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronsUpDown className="h-3 w-3 opacity-40" />;
  return dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

type ThProps = {
  label: ReactNode; sortKey: string; sortState: { sortKey: string | null; sortDir: SortDir; toggle: (k: string) => void };
  className?: string; align?: "left" | "right" | "center";
  /** Se presente, mostra um ⓘ ao lado com tooltip explicativo (o que é + a conta). */
  tip?: ReactNode;
};

/** Cabeçalho clicável para tabelas em `<table>` cru (ex.: dashboards). */
export function SortTh({ label, sortKey, sortState, className, align = "left", tip }: ThProps) {
  const active = sortState.sortKey === sortKey;
  return (
    <th className={cn("select-none", className)}>
      <span className={cn("inline-flex items-center gap-1", align === "right" && "w-full flex-row-reverse", align === "center" && "w-full justify-center")}>
        <button
          type="button"
          onClick={() => sortState.toggle(sortKey)}
          className={cn("inline-flex items-center gap-1 hover:text-foreground",
            align === "right" && "flex-row-reverse")}
        >
          {label}
          <Indicator active={active} dir={sortState.sortDir} />
        </button>
        {tip && <HeaderInfo tip={tip} />}
      </span>
    </th>
  );
}

/** Cabeçalho clicável para o `<Table>` do shadcn (`<TableHead>`). */
export function SortHead({ label, sortKey, sortState, className, align = "left", tip }: ThProps) {
  const active = sortState.sortKey === sortKey;
  return (
    <TableHead className={cn("select-none", className)}>
      <span className={cn("inline-flex items-center gap-1", align === "right" && "w-full flex-row-reverse", align === "center" && "w-full justify-center")}>
        <button
          type="button"
          onClick={() => sortState.toggle(sortKey)}
          className={cn("inline-flex items-center gap-1 hover:text-foreground",
            align === "right" && "flex-row-reverse")}
        >
          {label}
          <Indicator active={active} dir={sortState.sortDir} />
        </button>
        {tip && <HeaderInfo tip={tip} />}
      </span>
    </TableHead>
  );
}
