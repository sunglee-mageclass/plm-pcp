import { brl } from "@/lib/format";

/**
 * Linha de resumo de vendas com DOIS canais (atacado e varejo) — usada no cabeçalho das
 * subcoleções de Produto Acabado e Produto Importado (F4b, nov/2026, decisão do dono: poder de
 * venda E markup médio separados por canal, porque PA/PI têm preço de atacado e de varejo
 * diferentes). Espelha o `ResumoVenda` do Planejamento (que tem um canal só).
 *
 * Markup "—" quando não há nenhum produto com markup calculável naquele canal (sem custo ou sem
 * preço do canal); poder de venda do canal pode ser R$ 0,00 quando nenhum produto tem preço ali.
 */
export function ResumoVendaDuplo({
  poderVarejo,
  poderAtacado,
  markupVarejo,
  markupAtacado,
  qtd,
  className,
  veVarejo = true,
  veAtacado = true,
}: {
  poderVarejo: number;
  poderAtacado: number;
  markupVarejo: number;
  markupAtacado: number;
  qtd: number;
  className?: string;
  /** Permissão de preço (19/nov): VER varejo e VER atacado são chaves PRÓPRIAS e independentes. Sem uma delas, SÓ aquele canal (poder de
   *  venda + markup) mostra "—"; o outro canal e a contagem de produtos seguem. Default true = retrocompatível. */
  veVarejo?: boolean;
  veAtacado?: boolean;
}) {
  const fmtMk = (m: number) =>
    m > 0 ? m.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground ${className ?? ""}`}>
      <span>
        <span className="sm:hidden">PV varejo:</span>
        <span className="hidden sm:inline">Poder de venda (varejo):</span>{" "}
        <strong className="text-foreground tabular-nums">{veVarejo ? brl(poderVarejo) : "—"}</strong>
        {" "}<span className="text-muted-foreground">· markup</span>{" "}
        <strong className="text-foreground tabular-nums">{veVarejo ? fmtMk(markupVarejo) : "—"}</strong>
      </span>
      <span aria-hidden>·</span>
      <span>
        <span className="sm:hidden">PV atacado:</span>
        <span className="hidden sm:inline">Poder de venda (atacado):</span>{" "}
        <strong className="text-foreground tabular-nums">{veAtacado ? brl(poderAtacado) : "—"}</strong>
        {" "}<span className="text-muted-foreground">· markup</span>{" "}
        <strong className="text-foreground tabular-nums">{veAtacado ? fmtMk(markupAtacado) : "—"}</strong>
      </span>
      <span aria-hidden>·</span>
      <span>
        <strong className="text-foreground tabular-nums">{qtd}</strong> {qtd === 1 ? "produto" : "produtos"}
      </span>
    </div>
  );
}
