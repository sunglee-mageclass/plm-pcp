/**
 * Linha de meta do modelo: `Coleção · Subcoleção · Lançamento N · Mês / Ano`.
 * Só entram as partes não-nulas — cada tela passa o subconjunto que quer (evita
 * repetir o que já é exibido no header). "Lançamento" é a nomenclatura nova do
 * antigo campo `semana` (ordinal 1..5). Retorna null se não há nada a mostrar.
 */
export function ModeloResumoMeta({
  colecao,
  subcolecao,
  lancamento,
  mesNome,
  anoNome,
  className = "",
}: {
  colecao?: string | null;
  subcolecao?: string | null;
  lancamento?: string | number | null;
  mesNome?: string | null;
  anoNome?: string | null;
  className?: string;
}) {
  const periodo = [mesNome, anoNome].filter(Boolean).join(" / ");
  const parts = [
    colecao || null,
    subcolecao || null,
    lancamento ? `Lançamento ${lancamento}` : null,
    periodo || null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <p className={`text-xs text-muted-foreground truncate ${className}`}>{parts.join(" · ")}</p>;
}
