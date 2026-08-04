// Colab (Task 3, spec 2026-08-04) — Nível A: merge 3-vias POR SLOT do Plan. Tecido. Ids são
// ESTÁVEIS depois do 1º save (a RPC salvar_plan_tecido preserva slot.id — migração
// 20260801120000), então dá pra achatar a árvore por slot.id e delegar ao `mergeLinhas`
// genérico (`@/lib/colab/merge`, PURO) tratando slot = "linha" da spec: compara o slot INTEIRO,
// incl. materiais/variantes, via `igual()` profundo — zero lógica de merge nova, só orquestração.
//
// Extraído do PlanTecidoSheet (revisão round 1) pra ser testável isoladamente — ver
// tests/unit/plan-tecido-colab-merge.test.ts. PURO: não depende de React/Supabase.
import { mergeLinhas, type Conflito } from "@/lib/colab/merge";
import type { PtArvore, PtLinha, PtSlot, PtSub } from "./types";

export function chaveBucket(subId: string | null, ln: { linha_id: string | null; categoria_id: string | null }): string {
  return `${subId ?? "__none__"}::${ln.linha_id ?? ""}|${ln.categoria_id ?? ""}`;
}

export function achatarSlots(arv: PtArvore): { bucket: string; slot: PtSlot }[] {
  const out: { bucket: string; slot: PtSlot }[] = [];
  for (const sub of arv.subcolecoes)
    for (const ln of sub.linhas)
      for (const slot of ln.slots)
        out.push({ bucket: chaveBucket(sub.subcolecao_id, ln), slot });
  return out;
}

function bucketDoSub(sub: { subcolecao_id: string | null }) {
  return sub.subcolecao_id ?? "__none__";
}

/**
 * Reconstrói a árvore em cima da FRESCA (ela já resolveu reposicionamento de modelo entre
 * subcoleção/linha via `mergeArvore`/`semearComModelos` — engine intocado, só consumido) e
 * substitui, posição por posição, o conteúdo de cada slot pelo resultado do merge (by id).
 */
export function mergeArvorePorSlot(o: {
  base: PtArvore; draft: PtArvore; fresh: PtArvore; touchedIds: ReadonlySet<string>;
}): { arvore: PtArvore; atualizados: number; conflitos: Conflito[] } {
  const baseFlat = achatarSlots(o.base).map((f) => f.slot);
  const draftFlatFull = achatarSlots(o.draft);
  const freshFlat = achatarSlots(o.fresh).map((f) => f.slot);
  const ml = mergeLinhas({ base: baseFlat, draft: draftFlatFull.map((f) => f.slot), fresh: freshFlat, touchedIds: o.touchedIds });
  const porId = new Map(ml.linhas.filter((s) => s.id).map((s) => [s.id as string, s]));
  const posicionados = new Set<string>();

  // Lanes locais (categorias_tecido) por subcoleção, da árvore LOCAL — CRÍTICO (achado de
  // revisão): uma lane criada localmente e ainda não salva não pode sumir por causa de um
  // merge concorrente. A remontagem parte só do `fresh`, que não a conhece — união por id.
  const catsLocalPorSub = new Map<string, string[]>();
  for (const s of o.draft.subcolecoes) catsLocalPorSub.set(bucketDoSub(s), s.categorias_tecido ?? []);

  const arvore: PtArvore = {
    ...o.fresh,
    subcolecoes: o.fresh.subcolecoes.map((sub) => ({
      ...sub,
      categorias_tecido: [...new Set([...(sub.categorias_tecido ?? []), ...(catsLocalPorSub.get(bucketDoSub(sub)) ?? [])])],
      linhas: sub.linhas.map((ln) => ({
        ...ln,
        slots: ln.slots.map((slot) => {
          if (!slot.id) return slot; // não deveria ocorrer no fresh (todo slot semeado tem id)
          const merged = porId.get(slot.id);
          if (!merged) return slot; // não deveria — todo slot do fresh está em ml.linhas (ver abaixo)
          posicionados.add(slot.id);
          return merged;
        }),
      })),
    })),
  };

  // Slots ÓRFÃOS (achado CRITICAL de revisão, round 1): tinham id, estavam no `draft` (tocados,
  // mantidos pelo `mergeLinhas` com conflito — `dele:null`), mas o bucket/linha deles NÃO existe
  // mais na árvore fresca (ex.: o OTB encolheu e a linha/categoria que os continha sumiu — afeta
  // slots SEM modelo vinculado, cuja posição é só o bucket de planejamento, não uma âncora viva
  // como `modelo_id`). Sem isto, o card some do canvas em silêncio E os botões do banner
  // ("manter meu"/"usar o novo") viram no-op (`findIndex` = -1 no componente). Reinserido na
  // posição ORIGINAL da árvore LOCAL; se essa posição (sub/linha) também não existir mais no
  // resultado, é recriada minimamente — só assim "manter meu" fica verdadeiro (o card reaparece
  // de fato, e "usar o novo" com `dele:null` tem o que remover).
  // Slots SEM id (novos, nunca salvos — na prática não ocorre: só nascem na semeadura, que fica
  // pausada enquanto `dirty`) caem no MESMO caminho: nunca têm posição na árvore fresca.
  const origemPorSlot = new Map(draftFlatFull.map((f) => [f.slot, f.bucket] as const));
  const reinserir = (slot: PtSlot) => {
    const bucket = origemPorSlot.get(slot) ?? chaveBucket(null, { linha_id: null, categoria_id: null });
    const [subKey, lnKey] = bucket.split("::");
    let sub = arvore.subcolecoes.find((s) => bucketDoSub(s) === subKey);
    if (!sub) {
      sub = { subcolecao_id: subKey === "__none__" ? null : subKey, ordem: arvore.subcolecoes.length, categorias_tecido: [], linhas: [] } as PtSub;
      arvore.subcolecoes.push(sub);
    }
    let ln = sub.linhas.find((l) => `${l.linha_id ?? ""}|${l.categoria_id ?? ""}` === lnKey);
    if (!ln) {
      const [linha_id, categoria_id] = lnKey.split("|");
      ln = { linha_id: linha_id || null, categoria_id: categoria_id || null, ordem: sub.linhas.length, slots: [] } as PtLinha;
      sub.linhas.push(ln);
    }
    ln.slots.push(slot);
  };
  for (const slot of ml.linhas) {
    if (!slot.id || !posicionados.has(slot.id)) reinserir(slot);
  }

  return { arvore, atualizados: ml.atualizadas.length, conflitos: ml.conflitos };
}
