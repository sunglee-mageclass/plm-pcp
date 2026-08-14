/**
 * Arredonda `n` para `decimals` casas decimais e retorna NÚMERO (não string) — para
 * CÁLCULO/precisão interna (custo unitário, quantidade a enviar/planejada…), nunca para
 * EXIBIÇÃO (isso é `fmtNum`/`fmtNumEdit`/`brl`/`fmtInt`/`fmtPct` em `src/lib/format.ts`).
 * Substitui o idiom `Number(x.toFixed(n))` espalhado pelo código (mesmo resultado — só
 * sai do componente pra cá, único lugar com `.toFixed` fora de exibição) e o `round2`
 * que já existia solto em `pcp.cad.$modeloId.tsx`.
 */
export function roundTo(n: number, decimals = 2): number {
  return Number((Number(n) || 0).toFixed(decimals));
}
