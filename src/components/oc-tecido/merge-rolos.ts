// Realtime Onda 1, Task 4 — plano de rolos (`ocs_tecido_itens.rolos_planejados`) no merge colaborativo da OC Tecido (modo rolo).
// O plano mora na tela como `rolosPorItem` (Record<tempId, RoloEntry[]>; tempId = id do item para item carregado). Antes ele ficava
// FORA do merge: o refetch só o semeava na 1a carga e o Salvar mandava `rolos_planejados` de TODO item — null quando a minha tela não
// o tinha — apagando o plano que a outra pessoa salvou. Aqui cada item é um campo do merge 3-vias (base/live/fresh), igual aos demais.
// PURO, sem dependências de tela. Conflito de item: path `rolos:<itemId>` (resolvido como os demais, "manter meu"/"usar o novo").
import type { Conflito } from "@/lib/colab/merge";
import type { RoloEntry } from "./shared";

export type RolosPorItem = Record<string, RoloEntry[]>;

/** O que o Salvar grava em `rolos_planejados` (projeção estável: só rolos com qtd > 0; ruído de UI — linha em branco — não conta). */
export type PlanoRolo = { qtd: number; obs: string | null; cq_ok: boolean; cq_alerta: boolean };

export function planoDeRolos(arr: readonly RoloEntry[] | undefined | null): PlanoRolo[] {
  return (arr ?? [])
    .map((e) => ({ q: Number(String(e.qtd).replace(",", ".")), e }))
    .filter((x) => x.q > 0)
    .map((x) => ({ qtd: x.q, obs: x.e.obs || null, cq_ok: !!x.e.cq_ok, cq_alerta: !!x.e.cq_alerta }));
}

const iguais = (a: readonly RoloEntry[] | undefined, b: readonly RoloEntry[] | undefined) =>
  JSON.stringify(planoDeRolos(a)) === JSON.stringify(planoDeRolos(b));

/** Rolo JÁ criado (OC recebida) não é "plano": CQ/cancelar/ajustar do rolo existente seguem pelos caminhos próprios, fora deste merge (só a TRANSIÇÃO plano<->real entra). */
const temRoloReal = (...arrs: (readonly RoloEntry[] | undefined)[]) => arrs.some((a) => (a ?? []).some((e) => !!e.roloId || !!e.roloItemId));

export const caminhoConflitoRolos = (itemKey: string) => `rolos:${itemKey}`;

export function mesclarRolosPlanejados(o: { base: RolosPorItem; live: RolosPorItem; fresh: RolosPorItem }): {
  valor: RolosPorItem; conflitos: Conflito[]; atualizados: string[];
} {
  const valor: RolosPorItem = {};
  const conflitos: Conflito[] = [];
  const atualizados: string[] = [];
  const keys = new Set([...Object.keys(o.base), ...Object.keys(o.live), ...Object.keys(o.fresh)]);
  for (const k of keys) {
    const b = o.base[k]; const l = o.live[k]; const f = o.fresh[k];
    const manterMeu = () => { if (l !== undefined) valor[k] = l; };
    const realMeu = temRoloReal(l);
    const realDele = temRoloReal(f);
    if (realMeu !== realDele) {
      // TRANSIÇÃO plano <-> rolo real feita por OUTRA pessoa (recebeu / desmarcou o recebimento): o servidor manda. Manter o meu plano velho
      // depois de a OC ser recebida faria o Salvar (gerar_rolos_recebimento, não idempotente) criar rolo DUPLICADO no estoque.
      if (f !== undefined) valor[k] = f;
      atualizados.push(k);
      continue;
    }
    if (realMeu) { manterMeu(); continue; } // os dois com rolo real: CQ/cancelar/ajustar seguem pelos caminhos próprios, fora deste merge
    const euMexi = !iguais(l, b);
    const eleMexeu = !iguais(f, b);
    if (!eleMexeu) { manterMeu(); continue; }
    if (!euMexi) { // só o servidor mexeu: adota (inclusive quando ele limpou o plano do item)
      if (f !== undefined) valor[k] = f;
      atualizados.push(k);
      continue;
    }
    if (iguais(l, f)) { manterMeu(); continue; } // chegamos ao mesmo plano
    manterMeu(); // os dois mexeram, de formas diferentes: fica o meu, mas AVISA (não sobrescreve calado)
    conflitos.push({ path: caminhoConflitoRolos(k), meu: l ?? [], dele: f ?? [] });
  }
  return { valor, conflitos, atualizados };
}

/**
 * Base dos rolos depois de um merge: = `fresh`, EXCETO os itens que seguem em conflito, que mantêm a base ANTIGA — assim o próximo merge
 * enxerga "o servidor mudou desde a base" e recalcula o conflito (mesma lição das linhas: `baseSemAvancarEmConflito`).
 */
export function baseRolosSemAvancar(baseAntiga: RolosPorItem, fresh: RolosPorItem, conflitos: readonly Conflito[]): RolosPorItem {
  const ids = new Set(conflitos.filter((c) => c.path.startsWith("rolos:")).map((c) => c.path.slice("rolos:".length)));
  if (ids.size === 0) return { ...fresh };
  const out: RolosPorItem = { ...fresh };
  for (const id of ids) {
    if (baseAntiga[id] !== undefined) out[id] = baseAntiga[id];
    else delete out[id];
  }
  return out;
}

/** Resolução de UM conflito de rolos ("manter meu" OU "usar o novo"): a base do item passa a ser o que o servidor tem (`dele`). */
export function baseRolosComItemResolvido(base: RolosPorItem, itemKey: string, dele: readonly RoloEntry[] | null | undefined): RolosPorItem {
  const { [itemKey]: _antigo, ...resto } = base;
  return dele && dele.length > 0 ? { ...resto, [itemKey]: [...dele] } : resto;
}
