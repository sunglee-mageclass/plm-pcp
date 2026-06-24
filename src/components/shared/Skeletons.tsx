import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Linhas de tabela em carregamento — substitui o texto "Carregando…".
 * Renderiza `rows` <tr> com `cols` células (barras de larguras variadas).
 * Uso: dentro do <tbody>, no lugar da linha de "Carregando…".
 *   {isLoading ? <SkeletonTableRow cols={5} /> : data.map(...)}
 */
export function SkeletonTableRow({ cols, rows = 4 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3.5">
              <Skeleton className={cn("h-4", c === 0 ? "w-28" : c === cols - 1 ? "w-12" : "w-20")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Card em carregamento — para grids/galerias de cards. */
export function SkeletonCard() {
  return (
    <div className="rounded-lg border p-3 space-y-3">
      <Skeleton className="aspect-square w-full rounded-md" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}
