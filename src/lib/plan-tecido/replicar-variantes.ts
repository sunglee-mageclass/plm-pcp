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

import type { PtMaterial, PtVariante } from "./types";
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
