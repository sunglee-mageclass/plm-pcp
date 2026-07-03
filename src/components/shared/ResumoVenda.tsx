import { brl } from "@/lib/format";

/**
 * Linha de resumo de vendas (poder de venda · markup médio real · nº de modelos).
 * Usada no cabeçalho geral e em cada cabeçalho de grupo (categoria / repetição) do
 * Planejamento e dos Lançamentos.
 */
export function ResumoVenda({
  poder,
  markupMedio,
  qtd,
  className,
}: {
  poder: number;
  markupMedio: number;
  qtd: number;
  className?: string;
}) {
  return (
    <div className={`text-xs text-muted-foreground flex items-center gap-2 flex-wrap ${className ?? ""}`}>
      <span>
        <span className="sm:hidden">PV:</span>
        <span className="hidden sm:inline">Poder de venda:</span>{" "}
        <strong className="text-foreground tabular-nums">{brl(poder)}</strong>
      </span>
      <span aria-hidden>·</span>
      <span>
        <span className="sm:hidden">M. Médio:</span>
        <span className="hidden sm:inline">Markup médio:</span>{" "}
        <strong className="text-foreground tabular-nums">{markupMedio > 0 ? markupMedio.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}</strong>
      </span>
      <span aria-hidden>·</span>
      <span><strong className="text-foreground tabular-nums">{qtd}</strong> {qtd === 1 ? "modelo" : "modelos"}</span>
    </div>
  );
}
