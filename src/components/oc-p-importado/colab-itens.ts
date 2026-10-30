// [urg R13 T8] Colaboração em tempo real da OC de Produto Importado COM ITENS — merge 3-vias PURO (sem React/supabase).
// Espelho de `oc-p-acabado/colab-itens.ts` (T7): compõe SÓ o que já existe em `src/lib/colab/*` (não reinventa o merge):
//   - cabeçalho ........ `mergeDraft` (por campo tocado; as ETAPAS são UM campo grão-grosso: conflito = "o cronograma inteiro divergiu");
//   - itens ............ `mergeLinhas({removidasIds})` (por LINHA/id; linha que EU removi e o servidor não mexeu SEGUE removida; o servidor
//                         mexeu depois da base → conflito de linha `linha:<id>`);
//   - grade de cada item `mergeGradeGenerico` por CÉLULA (pedida/recebida/defeito), caminho `item:<id>:grade:<ordem>:<tam>:<campo>`.
// A linha que o `mergeLinhas` compara NÃO leva a grade (ver `ItemLinha`). O `status` do item e o landed REAL do item (derivado no servidor)
// não são do rascunho: seguem SEMPRE o servidor. O que é puro e idêntico ao Acabado (`tocadasDoItem`, `rotuloConflitoOc`) é reusado de lá.
import { mergeDraft, mergeLinhas, type Conflito } from "@/lib/colab/merge";
import { mergeGradeGenerico, type GradeGenerica } from "@/lib/colab/merge-grade-generico";
import { baseSemAvancarEmConflito } from "@/lib/colab/conflitos-pendentes";
import { tocadasDoItem, rotuloConflitoOc } from "@/components/oc-p-acabado/colab-itens";
import { CAMPOS_GRADE_IMP, linhaDeItem, type ItemLinha, type ItemOcImp } from "./itens";
import type { CabecalhoImpDraft, GradeDetalhe, OcImportadoStatus } from "./shared";

export { tocadasDoItem, rotuloConflitoOc };

/** O último estado visto do servidor, no formato que o merge consome. */
export type BaseOc = { draft: CabecalhoImpDraft; linhas: ItemLinha[]; grades: Record<string, GradeDetalhe> };

export function baseDe(draft: CabecalhoImpDraft, items: ReadonlyArray<ItemOcImp>): BaseOc {
  const salvos = items.filter((i) => i.id);
  return {
    draft,
    linhas: salvos.map(linhaDeItem),
    grades: Object.fromEntries(salvos.map((i) => [i.id as string, i.grade])),
  };
}

/** Base depois de um merge: o cabeçalho e as grades AVANÇAM para o fresh; as linhas em conflito mantêm a base antiga (ver conflitos-pendentes). */
export function baseAposMerge(
  antiga: BaseOc, fresh: { draft: CabecalhoImpDraft; items: ReadonlyArray<ItemOcImp> }, conflitos: ReadonlyArray<Conflito>,
): BaseOc {
  const nova = baseDe(fresh.draft, fresh.items);
  return { draft: nova.draft, linhas: baseSemAvancarEmConflito(antiga.linhas, nova.linhas, conflitos), grades: nova.grades };
}

export type EstadoOc = { draft: CabecalhoImpDraft; items: ItemOcImp[] };

export type ResultadoMergeOc = {
  draft: CabecalhoImpDraft;
  items: ItemOcImp[];
  conflitos: Conflito[];
  /** Nº de campos/linhas/células que mudaram por causa da outra pessoa (banner "Alguém salvou agora"). */
  atualizados: number;
  mudouDraft: boolean;
  mudouItens: boolean;
};

export function mesclarOcItens(o: {
  base: BaseOc;
  live: EstadoOc;
  fresh: EstadoOc;
  touched: ReadonlySet<string>;
  touchedIds: ReadonlySet<string>;
  touchedGrade: ReadonlySet<string>;
}): ResultadoMergeOc {
  const md = mergeDraft({ base: o.base.draft, draft: o.live.draft, fresh: o.fresh.draft, touched: o.touched });

  const linhasLive = o.live.items.map(linhaDeItem);
  const linhasFresh = o.fresh.items.map(linhaDeItem);
  // `removidasIds = touchedIds`: id tocado que NÃO está mais no rascunho = removido por mim (mesmo idioma da OC Tecido).
  const ml = mergeLinhas({ base: o.base.linhas, draft: linhasLive, fresh: linhasFresh, touchedIds: o.touchedIds, removidasIds: o.touchedIds });

  // O mergeLinhas devolve as MESMAS referências que recebeu: dá para voltar da linha ao item completo.
  const deLive = new Map<ItemLinha, ItemOcImp>(linhasLive.map((l, i) => [l, o.live.items[i]]));
  const deFresh = new Map<ItemLinha, ItemOcImp>(linhasFresh.map((l, i) => [l, o.fresh.items[i]]));
  const liveId = new Map(o.live.items.filter((i) => i.id).map((i) => [i.id as string, i]));
  const freshId = new Map(o.fresh.items.filter((i) => i.id).map((i) => [i.id as string, i]));

  const conflitos: Conflito[] = [...md.conflitos, ...ml.conflitos];
  let celulasAtualizadas = 0;
  let celulasEmConflito = 0;
  let derivadoMudou = false;

  const items = ml.linhas.map((l): ItemOcImp => {
    const fonte = (deLive.get(l) ?? deFresh.get(l)) as ItemOcImp;
    if (!fonte.id) return fonte; // minha linha nova: fica como está
    const lv = liveId.get(fonte.id);
    const fr = freshId.get(fonte.id);
    if (!lv || !fr) return fonte; // linha nova do servidor (grade = a dele) ou linha que o servidor apagou e eu tinha tocado (a minha)
    const mg = mergeGradeGenerico({
      base: (o.base.grades[fonte.id] ?? {}) as unknown as GradeGenerica,
      meu: lv.grade as unknown as GradeGenerica,
      fresh: fr.grade as unknown as GradeGenerica,
      tocadas: tocadasDoItem(o.touchedGrade, fonte.id),
      campos: CAMPOS_GRADE_IMP,
    });
    celulasAtualizadas += mg.atualizados.length;
    celulasEmConflito += mg.conflitos.length;
    for (const c of mg.conflitos) conflitos.push({ ...c, path: `item:${fonte.id}:${c.path}` });
    if (fonte.status !== fr.status || fonte.custo_unitario_landed_real !== fr.custo_unitario_landed_real) derivadoMudou = true;
    // status/landed/REF/foto: SEMPRE do servidor.
    return {
      ...fonte, grade: mg.valor as unknown as GradeDetalhe, status: fr.status, custo_unitario_landed_real: fr.custo_unitario_landed_real,
      produtoRef: fr.produtoRef, fotoPath: fr.fotoPath,
    };
  });

  return {
    draft: md.valor,
    items,
    conflitos,
    atualizados: md.atualizados.length + ml.atualizadas.length + celulasAtualizadas,
    mudouDraft: md.atualizados.length > 0 || md.conflitos.length > 0,
    mudouItens: ml.atualizadas.length > 0 || ml.conflitos.length > 0 || celulasAtualizadas > 0 || celulasEmConflito > 0 || derivadoMudou,
  };
}

/**
 * Merge do RETRY do P0409 (receita 2419d0f): meus campos/linhas/células tocados ficam, os que só o outro mexeu chegam e o `status` da OC é o
 * do servidor. Quem chama grava `estado` nos refs ao vivo ANTES do `mutate` (o retry roda antes do re-render).
 */
export function mesclarParaRetryP0409Imp(o: {
  base: BaseOc;
  live: EstadoOc;
  fresh: EstadoOc & { status: OcImportadoStatus };
  touched: ReadonlySet<string>;
  touchedIds: ReadonlySet<string>;
  touchedGrade: ReadonlySet<string>;
}): ResultadoMergeOc & { estado: EstadoOc & { status: OcImportadoStatus } } {
  const r = mesclarOcItens(o);
  return { ...r, estado: { draft: r.draft, items: r.items, status: o.fresh.status } };
}

/**
 * Resolução de UM conflito de LINHA (`linha:<id>`), pura. `fresh` = o item como o servidor o tem agora (`null` = o servidor o apagou).
 *  - "manter meu": o servidor APAGOU o item que eu editei → o meu vira linha NOVA (sem id: mandar o id de uma linha que não existe daria
 *    `nao_encontrado: item`); nos demais casos nada muda no rascunho (a base da linha avança para o servidor, quem chama cuida).
 *  - "usar o novo": o item do servidor ocupa o lugar do meu (a GRADE continua a minha: ela funde por célula, à parte); se o servidor o
 *    apagou, sai do rascunho; se EU o removera, ele volta (e substitui a linha nova do MESMO produto, sem duplicar).
 * `limparToque` = tirar o id de `touchedIds` (o rascunho voltou a bater com o servidor naquela linha).
 */
export function resolverConflitoLinha(o: {
  items: ReadonlyArray<ItemOcImp>; id: string; escolha: "meu" | "dele"; fresh: ItemOcImp | null;
}): { items: ItemOcImp[]; limparToque: boolean } {
  const { items, id, escolha, fresh } = o;
  const local = items.find((i) => i.id === id);
  if (escolha === "meu") {
    if (local && !fresh) return { items: items.map((i) => (i.id === id ? { ...i, id: null, status: "encomendado", custo_unitario_landed_real: 0 } : i)), limparToque: true };
    return { items: [...items], limparToque: false };
  }
  if (!fresh) return { items: items.filter((i) => i.id !== id), limparToque: true };
  if (local) return { items: items.map((i) => (i.id === id ? { ...fresh, grade: i.grade } : i)), limparToque: true };
  const dup = items.findIndex((i) => !i.id && !!fresh.produto_importado_id && i.produto_importado_id === fresh.produto_importado_id);
  return { items: dup >= 0 ? items.map((r, k) => (k === dup ? { ...fresh, tempId: r.tempId } : r)) : [...items, fresh], limparToque: true };
}
