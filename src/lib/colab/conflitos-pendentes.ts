// Conflitos de LINHA ainda sem resolução não podem sumir num merge seguinte (ex.: eco do Realtime de outra linha). Sem isto, a lista de
// conflitos era SUBSTITUÍDA a cada merge e a base de TODAS as linhas avançava: o conflito "removi X, o outro editou X" sumia, o Salvar
// destravava e apagava a edição da outra pessoa em silêncio. PURO, sem dependências de tela.
import type { Conflito, LinhaId } from "./merge";

const ehDeLinha = (c: Conflito) => c.path.startsWith("linha:");

/**
 * Pendentes (ainda não resolvidos) + os recém-calculados. Mesmo `path` => vale o novo (dado mais fresco do servidor).
 * Só os conflitos de CAMPO/GRADE ficam pendentes entre merges. Os de LINHA valem apenas pelo que o merge ATUAL recalculou: a base dessas
 * linhas é segurada (ver `baseSemAvancarEmConflito`), então todo conflito de linha que ainda vale reaparece em `novos`; um que não
 * reapareceu deixou de valer (o servidor apagou a linha, ou a outra pessoa reverteu) e "usar o novo" nele ressuscitaria linha
 * inexistente ou desfaria a reversão alheia.
 */
export function juntarConflitos(pendentes: readonly Conflito[], novos: readonly Conflito[]): Conflito[] {
  const novosPaths = new Set(novos.map((c) => c.path));
  return [...pendentes.filter((c) => !novosPaths.has(c.path) && !ehDeLinha(c)), ...novos];
}

/** Para os ramos "merge sem resultado": descarta os conflitos de linha pendentes (nenhum foi recalculado, logo nenhum vale mais). */
export const semConflitosDeLinha = (pendentes: readonly Conflito[]): Conflito[] => pendentes.filter((c) => !ehDeLinha(c));

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
  // Linha em conflito SEM base antiga (conflito "removida sem base"): continua SEM base — o próximo merge recalcula o conflito.
  const out = fresh.flatMap((f) => (f.id && ids.has(f.id) ? (antigas.has(f.id) ? [antigas.get(f.id) as R] : []) : [f]));
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

/**
 * "Usar o novo" numa linha que eu removi, quando já existe uma linha NOVA (sem id) equivalente: a do servidor ocupa o lugar dela e
 * herda o `tempId` — estados indexados por `tempId` (ex.: `rolosPorItem` da OC Tecido) não ficam órfãos.
 */
export function substituirLinhaNova<R extends { tempId: string }>(linhas: readonly R[], k: number, dele: R): R[] {
  return linhas.map((r, i) => (i === k ? { ...dele, tempId: r.tempId } : r));
}
