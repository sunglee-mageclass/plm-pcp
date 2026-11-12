/**
 * KANBAN PL (Etapas PL, Onda 3 / Task 7) — regras PURAS da edição do board na Config da Loja (zero React, zero Supabase).
 *
 * O board é guardado como LABELS (`etapas_pl_kanban`) e os requisitos por KEY derivada do label (`resolveStatusKey`).
 * Renomear uma coluna muda a key — no Dev isso deixa o requisito órfão; aqui `aplicarMudancaBoardPl` MIGRA os requisitos
 * junto (a 1ª coluna é a PORTA DE ENTRADA: perder o requisito dela no rename = ninguém mais entra no quadro).
 */
import { resolveStatusKey } from "./kanban-status";

/** Ruling do controlador: a 1ª coluna é a porta de entrada — só oferece condições de ENTRADA. */
export const CONDICOES_ENTRADA_PL: readonly string[] = ["tem_peca_teste", "enviado_a_servicos"];

/** Keys do catálogo que NÃO podem ser ADICIONADAS na coluna: na 1ª coluna, tudo que não é condição de entrada; nas demais, nada.
 *  Condição JÁ gravada na 1ª coluna (config antiga/API) fica editável, para dar para REMOVÊ-LA. */
export function condicoesIndisponiveisPl(primeiraColuna: boolean, todasAsKeys: readonly string[], requisitosAtuais: readonly string[]): string[] {
  if (!primeiraColuna) return [];
  const atuais = new Set(requisitosAtuais);
  return todasAsKeys.filter((k) => !CONDICOES_ENTRADA_PL.includes(k) && !atuais.has(k));
}

const keyDe = (label: string) => resolveStatusKey(label);

/** Labels do board cujas keys se repetem (a 2ª ocorrência é ignorada pelo servidor/`boardEtapasPl`). Vazio/espaço não conta. */
export function rotulosComChaveRepetidaPl(board: readonly string[]): string[] {
  const vistos = new Set<string>();
  const out: string[] = [];
  for (const label of board) {
    const k = keyDe(label);
    if (!k) continue;
    if (vistos.has(k)) out.push(label); else vistos.add(k);
  }
  return out;
}

/**
 * Mudança do board (a lista de labels de `antes` para `depois`) → requisitos coerentes.
 *  - mesma lista em outra ORDEM (arraste): requisitos intactos (a key não muda);
 *  - RENAME (mesmo tamanho, labels diferentes, não é permutação): o requisito da key antiga vai para a key nova.
 *    O campo é digitado tecla a tecla: com o label TEMPORARIAMENTE vazio a key é "" e o requisito fica guardado na key de origem
 *    (`origem[indice]`) até haver label de novo — o `origem` volta para o chamador, que o guarda entre as chamadas;
 *  - REMOÇÃO / ADIÇÃO (tamanho diferente): requisito da coluna removida é apagado, a menos que outra coluna ainda use a mesma key;
 *    `origem` zera (índices mudaram).
 * Nunca muta os argumentos. Destino já ocupado por OUTRA coluna não é sobrescrito.
 */
export function aplicarMudancaBoardPl(
  antes: readonly string[],
  depois: readonly string[],
  requisitos: Record<string, string[]>,
  origem: Record<number, string> = {},
): { requisitos: Record<string, string[]>; origem: Record<number, string> } {
  const reqs: Record<string, string[]> = { ...requisitos };
  if (antes.length !== depois.length) {
    const restantes = new Set(depois.map(keyDe));
    for (const label of antes) {
      const k = keyDe(label);
      if (k && !restantes.has(k)) delete reqs[k];
    }
    return { requisitos: reqs, origem: {} };
  }
  const ordenado = (l: readonly string[]) => [...l].sort().join("\u0000");
  if (ordenado(antes) === ordenado(depois)) return { requisitos: reqs, origem };
  const novaOrigem: Record<number, string> = { ...origem };
  for (let i = 0; i < depois.length; i++) {
    if (antes[i] === depois[i]) continue;
    const velha = novaOrigem[i] ?? keyDe(antes[i]);
    const nova = keyDe(depois[i]);
    if (!nova) { // label temporariamente vazio: nada migra, lembra de onde veio
      if (velha) novaOrigem[i] = velha;
      continue;
    }
    delete novaOrigem[i];
    if (!velha || velha === nova || !reqs[velha]) continue;
    const destinoOcupadoPorOutra = reqs[nova] && depois.some((l, j) => j !== i && keyDe(l) === nova);
    if (destinoOcupadoPorOutra) continue;
    reqs[nova] = reqs[velha];
    const velhaAindaUsada = depois.some((l, j) => j !== i && keyDe(l) === velha);
    if (!velhaAindaUsada) delete reqs[velha];
  }
  return { requisitos: reqs, origem: novaOrigem };
}
