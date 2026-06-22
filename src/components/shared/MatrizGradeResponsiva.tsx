import type { ReactNode } from "react";

/**
 * Matriz de grade responsiva (variante × tamanho).
 * - Desktop (md+): a tabela larga de sempre (Variante | tamanhos… | Total | extra).
 * - Mobile (<md): empilhada — um card por variante com os tamanhos em grade de
 *   chips tocáveis (some o scroll horizontal ilegível no chão de fábrica).
 *
 * Os dois layouts usam o MESMO `renderCell` (célula = display OU input), então
 * não há duplicação de lógica. A célula controla o próprio padding interno (o
 * `<td>`/chip é `p-0`), servindo tanto para exibição quanto para NumberInput.
 */
export function MatrizGradeResponsiva({
  tamanhos,
  variantes,
  renderCell,
  total,
  cellClass,
  extraHeader,
  renderExtra,
  emptyLabel = "Sem variantes.",
}: {
  tamanhos: string[];
  variantes: { num: number; label: string }[];
  renderCell: (num: number, tam: string) => ReactNode;
  total: (num: number) => ReactNode;
  cellClass?: (num: number, tam: string) => string;
  extraHeader?: string;
  renderExtra?: (num: number) => ReactNode;
  emptyLabel?: string;
}) {
  const colSpan = tamanhos.length + 2 + (extraHeader ? 1 : 0);
  return (
    <>
      {/* Desktop: tabela larga */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-muted/50">
              <th className="border px-2 py-1 text-left">Variante</th>
              {tamanhos.map((t) => <th key={t} className="border px-2 py-1 text-center w-16">{t}</th>)}
              <th className="border px-2 py-1 text-center w-20">Total</th>
              {extraHeader && <th className="border px-2 py-1 text-center">{extraHeader}</th>}
            </tr>
          </thead>
          <tbody>
            {variantes.length === 0 ? (
              <tr><td className="border px-2 py-2 text-muted-foreground" colSpan={colSpan}>{emptyLabel}</td></tr>
            ) : variantes.map(({ num, label }) => (
              <tr key={num}>
                <td className="border px-2 py-1">{label}</td>
                {tamanhos.map((t) => (
                  <td key={t} className={`border p-0 ${cellClass?.(num, t) ?? ""}`}>{renderCell(num, t)}</td>
                ))}
                <td className="border px-2 py-1 text-center font-semibold">{total(num)}</td>
                {extraHeader && <td className="border px-2 py-1">{renderExtra?.(num)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: empilhado por variante */}
      <div className="md:hidden space-y-3">
        {variantes.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">{emptyLabel}</p>
        ) : variantes.map(({ num, label }) => (
          <div key={num} className="rounded-lg border bg-card p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold">{label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">Total: <b className="text-foreground">{total(num)}</b></span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {tamanhos.map((t) => (
                <div key={t} className={`overflow-hidden rounded border ${cellClass?.(num, t) ?? ""}`}>
                  <div className="bg-muted/40 py-0.5 text-center text-[10px] font-medium text-muted-foreground">{t}</div>
                  {renderCell(num, t)}
                </div>
              ))}
            </div>
            {extraHeader && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{extraHeader}:</span>
                {renderExtra?.(num)}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
