// Reforço de segurança S6, fix round B1 — retry automático do P0409 da OC Tecido.
// O `onError` do P0409 relê o servidor, faz o merge 3-vias e salva de novo NA MESMA HORA (sem re-render no meio). Se o
// `mutationFn` lesse `draft`/`items`/`status` da closure do render do clique, o retry mandaria o estado de ANTES do merge:
// o status velho (OC recebida voltando a encomendada — recusada pelo servidor desde a S6) e os campos que SÓ o outro
// usuário mudou com o valor antigo (perda de dado calada). Receita do fix 2419d0f: o merge sai daqui (puro) e o resultado
// vai para os refs ao vivo (`draftLiveRef`/`itemsLiveRef`/`statusLiveRef`), que o `mutationFn` lê no começo de cada ciclo.
import { mergeDraft, mergeLinhas, type Conflito, type LinhaId } from "@/lib/colab/merge";

export type EstadoOcSalvar<D, I, S> = { draft: D; items: I[]; status: S };

/** Merge do retry do P0409: meus campos tocados ficam, os do servidor que eu não toquei chegam, o status é o do servidor. */
export function mesclarParaRetryP0409<D extends Record<string, any>, I extends LinhaId, S>(o: {
  base: { draft: D; items: I[] };
  live: { draft: D; items: I[] };
  fresh: { draft: D; items: I[]; status: S };
  touched: ReadonlySet<string>;
  touchedIds: ReadonlySet<string>;
}): {
  estado: EstadoOcSalvar<D, I, S>;
  conflitos: Conflito[];
  atualizados: number;
  mudouDraft: boolean;
  mudouItens: boolean;
} {
  const md = mergeDraft({ base: o.base.draft, draft: o.live.draft, fresh: o.fresh.draft, touched: o.touched });
  const ml = mergeLinhas({ base: o.base.items, draft: o.live.items, fresh: o.fresh.items, touchedIds: o.touchedIds });
  return {
    // status NÃO é campo do rascunho (P-236 = D7 A): sempre o do servidor
    estado: { draft: md.valor, items: ml.linhas, status: o.fresh.status },
    conflitos: [...md.conflitos, ...ml.conflitos],
    atualizados: md.atualizados.length + ml.atualizadas.length,
    mudouDraft: md.atualizados.length > 0 || md.conflitos.length > 0,
    mudouItens: ml.atualizadas.length > 0 || ml.conflitos.length > 0,
  };
}
