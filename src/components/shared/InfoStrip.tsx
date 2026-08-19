import { Fragment } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

// Tira de resumo (§K do ui-padroes.md): pares rótulo/valor sobre bg-muted, tabular-nums —
// para dado DERIVADO da própria tela (ex.: bruto→desconto→total→v.unit real de uma OC) ou
// para dado de OUTRA etapa (nunca um input travado — ver §K). `hi` destaca o item (ex.: o
// valor final da cadeia).
//
// Cabeçalho OPCIONAL (§K, campanha Planejamento ago/2026): `titulo` (rótulo do bloco) +
// `procedencia` (de onde o dado vem, ex.: "vem do Desenvolvimento") + `link` (atalho ⧉ que
// NAVEGA pra etapa dona via <Link> do TanStack Router). Sem nenhum deles, a tira renderiza
// só os pares — IDÊNTICA ao uso legado (Produto Acabado / OC P. Acabado), que passa só `itens`.
//
// `op` (opcional): operador mostrado ANTES do item ("+", "=", "→") p/ encadear a aritmética
// (materiais + mão de obra = custo). `badge` (opcional): selo curto inline após o rótulo
// (ex.: StatusBadge "previsto"). `compact`: menos padding, p/ caber dentro de uma seção de card.
// `hint` (opcional): sub-rótulo curto, mais claro que a legenda em caixa alta sozinha explica.
export type InfoStripItem = {
  label: React.ReactNode;
  valor: React.ReactNode;
  hi?: boolean;
  hint?: string;
  op?: string;
  badge?: React.ReactNode;
};

/** Atalho ⧉ (§K): navega pra ETAPA DONA do dado. `to` = rota do TanStack Router. */
export type InfoStripLink = {
  to: string;
  params?: Record<string, unknown>;
  search?: Record<string, unknown>;
  label: string;
};

export function InfoStrip({
  itens,
  titulo,
  procedencia,
  link,
  compact,
  className,
}: {
  itens: InfoStripItem[];
  titulo?: React.ReactNode;
  procedencia?: React.ReactNode;
  link?: InfoStripLink;
  compact?: boolean;
  className?: string;
}) {
  const temCabecalho = !!(titulo || procedencia || link);
  if (itens.length === 0 && !temCabecalho) return null;
  return (
    <div className={cn("rounded-md border bg-muted/40", compact ? "px-3 py-2.5" : "px-4 py-3", className)}>
      {temCabecalho && (
        <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          {titulo && (
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary">{titulo}</span>
          )}
          {procedencia && (
            <span className="text-[11px] font-medium text-muted-foreground">{procedencia}</span>
          )}
          {link && (
            <Link
              {...({ to: link.to, params: link.params, search: link.search } as any)}
              className="ml-auto inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-semibold text-primary hover:bg-muted max-md:min-h-11 max-md:px-3"
            >
              {link.label}
              <ExternalLink className="h-3 w-3 shrink-0" />
            </Link>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-baseline gap-x-[22px] gap-y-1.5">
        {itens.map((it, i) => (
          <Fragment key={i}>
            {it.op && (
              <span className="self-center text-sm font-bold text-muted-foreground" aria-hidden>
                {it.op}
              </span>
            )}
            <span className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {it.label}
                {it.hint && (
                  <span className="ml-1 font-normal normal-case tracking-normal text-muted-foreground/70">{it.hint}</span>
                )}
              </span>
              {it.badge}
              <span className={cn("tabular-nums", it.hi ? "text-base font-bold text-foreground" : "text-sm font-medium")}>
                {it.valor}
              </span>
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
