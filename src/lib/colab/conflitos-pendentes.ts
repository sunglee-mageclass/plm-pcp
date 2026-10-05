// Conflitos de LINHA ainda sem resolução não podem sumir num merge seguinte (ex.: eco do Realtime de outra linha). Sem isto, a lista de
// conflitos era SUBSTITUÍDA a cada merge e a base de TODAS as linhas avançava: o conflito "removi X, o outro editou X" sumia, o Salvar
// destravava e apagava a edição da outra pessoa em silêncio. PURO, sem dependências de tela.
import type { Conflito, LinhaId } from "./merge";

/** Pendentes (ainda não resolvidos) + os recém-calculados. Mesmo `path` => vale o novo (dado mais fresco do servidor). */
export function juntarConflitos(pendentes: readonly Conflito[], novos: readonly Conflito[]): Conflito[] {
  const novosPaths = new Set(novos.map((c) => c.path));
  return [...pendentes.filter((c) => !novosPaths.has(c.path)), ...novos];
}

const idsEmConflito = (conflitos: readonly Conflito[]) =>
  new Set(conflitos.filter((c) => c.path.startsWith("linha:")).map((c) => c.path.slice("linha:".length)));

/**
 * Base das linhas depois de um merge: = `fresh`, EXCETO as linhas que seguem em conflito, que mantêm a base ANTIGA — assim o próximo
 * merge enxerga "o servidor mudou desde a base" e recalcula o conflito (com o valor mais novo), em vez de dá-lo por resolvido.
 */
export function baseSemAvancarEmConflito<R extends LinhaId>(
  baseAntiga: readonly R[],
  fresh: readonly R[],
  conflitos: readonly Conflito[],
): R[] {
  const ids = idsEmConflito(conflitos);
  if (ids.size === 0) return [...fresh];
  const antigas = new Map(baseAntiga.filter((r) => r.id).map((r) => [r.id as string, r]));
  const out = fresh.map((f) => (f.id && ids.has(f.id) ? (antigas.get(f.id) ?? f) : f));
  const noFresh = new Set(fresh.map((f) => f.id).filter(Boolean) as string[]);
  for (const id of ids) {
    const antiga = antigas.get(id);
    if (!noFresh.has(id) && antiga) out.push(antiga); // o servidor removeu a linha: a base antiga continua a "lembrar" dela
  }
  return out;
}

/** Resolução de UM conflito de linha ("manter meu" OU "usar o novo"): a base dessa linha passa a ser o que o servidor tem (`dele`). */
export function baseComLinhaResolvida<R extends LinhaId>(base: readonly R[], id: string, dele: R | null): R[] {
  const resto = base.filter((r) => r.id !== id);
  return dele ? [...resto, dele] : resto;
}
