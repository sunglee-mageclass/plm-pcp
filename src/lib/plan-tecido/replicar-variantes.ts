// Replicação de VARIANTES por nome de tecido (Modo Plano / agrupamento por nome, set/2026).
//
// Quando o usuário adiciona/remove uma COR num material de um card, o CONJUNTO de cores (+ ordem)
// passa a ser compartilhado por todos os cards do MESMO nome de tecido na subcoleção. As PEÇAS
// (grade) continuam por card — a cor entra com grade 0 nos outros. Só o add/remove replica; editar a
// quantidade NÃO (é o `grade_total`, próprio de cada card).
//
// Puro/testável: recebe o material ANTES e DEPOIS da edição no card de origem + o material-alvo de
// outro slot, e devolve o material-alvo com as cores sincronizadas. O chamador (PlanTecidoSheet)
// itera os slots de mesmo nome e casa o material por (tipo, numero).
//
// POLÍTICA F1 (dono 06/nov): só a ADIÇÃO replica entre cards — remover/ocultar uma cor vale SÓ no card
// (ocultar = flag `oculta` por slot; não aparece como add nem remove). E a replicação NUNCA injeta em
// VAGA VAZIA (slot sem `modelo_id`): isso criava "Modelos" fantasmas. `replicarAdicaoNosSlots` aplica as duas.

import type { PtLinha, PtMaterial, PtSlot, PtVariante } from "./types";
import { varKey } from "./calc";

/** Diferença de conjunto de cores entre antes/depois de UM material (por varKey). */
export function difVariantes(antes: PtMaterial | undefined, depois: PtMaterial | undefined): {
  adicionadas: PtVariante[]; removidas: string[];   // removidas = varKeys
} {
  const keysAntes = new Set((antes?.variantes ?? []).map(varKey));
  const keysDepois = new Set((depois?.variantes ?? []).map(varKey));
  const adicionadas = (depois?.variantes ?? []).filter((v) => !keysAntes.has(varKey(v)));
  const removidas = [...keysAntes].filter((k) => !keysDepois.has(k));
  return { adicionadas, removidas };
}

/** Pool de artigos de um material (principal + substitutos efetivos) — usado p/ só replicar uma cor
 *  no material-alvo quando o ARTIGO dela pertence ao pool do alvo (evita cor divergente de artigo
 *  alheio quando dois cards têm o mesmo NOME de tecido mas artigo diferente). */
function poolDoMaterial(m: PtMaterial): Set<string> {
  const s = new Set<string>();
  if (m.artigo_id) s.add(m.artigo_id);
  for (const id of m.artigo_ids_extra ?? []) s.add(id);
  for (const v of m.variantes) if (v.variante_artigo_id) s.add(v.variante_artigo_id);
  return s;
}

/** Aplica add/remove de cores a UM material-alvo (de outro slot), sem tocar as peças das existentes.
 *  Cores adicionadas entram com grade 0 (peças por card). Renumera `ordem` 1..n ao final.
 *  Uma cor REAL (variante_artigo_id) só é adicionada se seu artigo pertence ao pool do alvo — assim
 *  não injeta variante de artigo alheio (cards de mesmo nome mas artigo diferente). Cores PLANEJADAS
 *  (sem artigo) replicam sempre (são só cor base+apelido). */
export function aplicarDifNoMaterial(
  alvo: PtMaterial,
  dif: { adicionadas: PtVariante[]; removidas: string[] },
): PtMaterial {
  const removidas = new Set(dif.removidas);
  const jaTem = new Set(alvo.variantes.map(varKey));
  const pool = poolDoMaterial(alvo);
  // remove as cores removidas
  const mantidas = alvo.variantes.filter((v) => !removidas.has(varKey(v)));
  // adiciona as novas que o alvo ainda não tem, com grade ZERADA (peças são por card). Filtra as de
  // artigo que não está no pool do alvo (não vira divergente por artigo alheio).
  const novas: PtVariante[] = dif.adicionadas
    .filter((v) => !jaTem.has(varKey(v)) && !removidas.has(varKey(v)) && (!v.variante_artigo_id || pool.has(v.variante_artigo_id)))
    .map((v) => ({
      variante_tecido_id: v.variante_tecido_id,
      variante_artigo_id: v.variante_artigo_id ?? null,
      cor_id: v.cor_id ?? null,
      cor_apelido_id: v.cor_apelido_id ?? null,
      label: v.label,
      cor_nome: v.cor_nome ?? null,
      multiplicador: 1,
      grades: {},
      grade_total: 0,
      ordem: 0,
    }));
  if (novas.length === 0 && mantidas.length === alvo.variantes.length) return alvo; // nada mudou
  const variantes = [...mantidas, ...novas].map((v, i) => ({ ...v, ordem: i + 1 }));
  return { ...alvo, variantes };
}

/** Casa o material de mesmo papel entre dois slots por (tipo, numero) — o eixo estável de um material
 *  ("Tecido 1", "Forro 2"). Retorna o índice no `alvo.materiais` ou -1. */
export function indiceMaterialCorrespondente(alvoMateriais: PtMaterial[], ref: PtMaterial): number {
  return alvoMateriais.findIndex((m) => m.tipo === ref.tipo && m.numero === ref.numero);
}

/** Slot que tem card de verdade (modelo_id não-nulo). Vaga vazia (sem modelo) NÃO participa da replicação,
 *  nem como origem nem como alvo — senão a cor/peças virariam "Modelo" fantasma (F1, vagas-fantasma). */
export const slotTemCard = (s: PtSlot): boolean => !!s.modelo_id;

/** Replica a ADIÇÃO de cores feita no card de origem (`depois` vs `antes`) nos OUTROS slots do mesmo nome de
 *  tecido da subcoleção (`linhas`, já clonada — é mutada no lugar). Política F1: SÓ adições (nunca remoção/
 *  ocultação) e SÓ entre slots com card (modelo_id não-nulo). `nomeDe` = nome de tecido do slot (agrupamento).
 *  `origemNaArvore` é o slot de origem JÁ gravado na árvore (identidade por referência, para pulá-lo).
 *  Retorna quantos slots-alvo mudaram. */
export function replicarAdicaoNosSlots(
  linhas: PtLinha[],
  origemNaArvore: PtSlot,
  antes: PtSlot,
  depois: PtSlot,
  nomeDe: (s: PtSlot) => string,
): number {
  if (!slotTemCard(origemNaArvore)) return 0;
  const nomeAlvo = nomeDe(depois);
  if (nomeAlvo === "Sem tecido" || nomeDe(antes) !== nomeAlvo) return 0; // trocou de tecido: outro grupo
  const difs = depois.materiais.map((mNovo) => {
    const mAntigo = antes.materiais.find((x) => x.tipo === mNovo.tipo && x.numero === mNovo.numero);
    const d = difVariantes(mAntigo, mNovo);
    return { ref: mNovo, dif: { adicionadas: d.adicionadas, removidas: [] as string[] } };
  }).filter(({ dif }) => dif.adicionadas.length > 0);
  if (difs.length === 0) return 0;
  let n = 0;
  for (const ln of linhas) for (let k = 0; k < ln.slots.length; k++) {
    const alvoSlot = ln.slots[k];
    if (alvoSlot === origemNaArvore) continue;
    if (!slotTemCard(alvoSlot)) continue; // VAGA VAZIA: nunca recebe réplica
    if (nomeDe(alvoSlot) !== nomeAlvo) continue;
    let mudou = false;
    const materiais = alvoSlot.materiais.slice();
    for (const { ref, dif } of difs) {
      const idx = indiceMaterialCorrespondente(materiais, ref);
      if (idx < 0) continue; // o alvo não tem esse material (tipo+numero) — não força
      const novoMat = aplicarDifNoMaterial(materiais[idx], dif);
      if (novoMat !== materiais[idx]) { materiais[idx] = novoMat; mudou = true; }
    }
    if (mudou) { ln.slots[k] = { ...alvoSlot, materiais }; n++; }
  }
  return n;
}
