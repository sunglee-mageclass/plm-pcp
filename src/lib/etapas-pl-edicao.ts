/**
 * KANBAN PL (Etapas PL, Onda 3 / Task 7) — regras PURAS da edição do board na Config da Loja (zero React, zero Supabase).
 *
 * O board é guardado como LABELS (`etapas_pl_kanban`) e os requisitos por KEY derivada do label (`resolveStatusKey`).
 * Renomear uma coluna muda a key — no Dev isso deixa o requisito órfão; aqui `aplicarMudancaBoardPl` MIGRA os requisitos
 * junto (a 1ª coluna é a PORTA DE ENTRADA: perder o requisito dela no rename = ninguém mais entra no quadro).
 */
import { resolveStatusKey } from "./kanban-status";

/** Condições sugeridas como porta de entrada (só p/ texto/ajuda; NÃO restringem mais — dono liberou todas, 13/11). */
export const CONDICOES_ENTRADA_PL: readonly string[] = ["tem_peca_teste", "enviado_a_servicos"];

/** Nenhuma condição é bloqueada na config das Etapas PL (dono liberou a porta de entrada a todas, 13/11): a 1ª coluna
 *  aceita qualquer condição, como as demais. Mantido como função para o card não precisar mudar a assinatura. */
export function condicoesIndisponiveisPl(_primeiraColuna: boolean, _todasAsKeys: readonly string[], _requisitosAtuais: readonly string[]): string[] {
  return [];
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
 * Estado de uma coluna EM EDIÇÃO (do 1º caractere digitado até o blur): a key ORIGINAL dela, o requisito que ela tinha ali
 * (foto tirada na 1ª tecla) e a key que hoje guarda esse requisito no mapa (`atual`, null = nenhuma — label vazio ou nome
 * já usado por OUTRA coluna). Vive no chamador (um ref) entre as chamadas; `fecharEdicaoBoardPl` o descarta no blur.
 */
export type EdicaoColunaPl = { orig: string; reqs: string[] | undefined; atual: string | null };
export type EdicoesBoardPl = Record<number, EdicaoColunaPl>;

/**
 * Mudança do board (a lista de labels de `antes` para `depois`) → requisitos coerentes.
 *  - mesma lista em outra ORDEM (arraste), ADIÇÃO ou REMOÇÃO: os índices mudam, então as edições em curso zeram;
 *    arraste/adição não mexem nos requisitos; remoção apaga o da coluna removida, a menos que outra coluna ainda use a key;
 *  - RENOMEAR (mesmo tamanho, labels diferentes, não é permutação): o requisito da coluna acompanha o NOME NOVO, sempre
 *    a partir da key ORIGINAL dela (guardada na 1ª tecla — nunca da key do estado anterior, senão passar digitando por um nome
 *    de OUTRA coluna copiaria o requisito dessa outra). A cada tecla: tira o que a edição colocou na key anterior (só se for
 *    dela e nenhuma outra coluna usa a key), e põe o requisito original na key nova — a menos que outra coluna já a use (colisão
 *    transitória: nada é sobrescrito) ou o label esteja vazio (o requisito fica só na foto, até haver label de novo).
 * Nunca muta os argumentos.
 */
export function aplicarMudancaBoardPl(
  antes: readonly string[],
  depois: readonly string[],
  requisitos: Record<string, string[]>,
  edicoes: EdicoesBoardPl = {},
): { requisitos: Record<string, string[]>; origem: EdicoesBoardPl } {
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
  if (ordenado(antes) === ordenado(depois)) {
    // arraste: os índices mudaram de lugar, a edição em curso (se houver) não vale mais
    const mudouDeLugar = antes.some((l, i) => l !== depois[i]);
    return { requisitos: reqs, origem: mudouDeLugar ? {} : edicoes };
  }
  const novas: EdicoesBoardPl = { ...edicoes };
  for (let i = 0; i < depois.length; i++) {
    if (antes[i] === depois[i]) continue;
    const outraUsa = (k: string) => depois.some((l, j) => j !== i && keyDe(l) === k);
    const ed: EdicaoColunaPl = novas[i] ?? (() => {
      const orig = keyDe(antes[i]);
      return { orig, reqs: orig ? reqs[orig] : undefined, atual: orig || null };
    })();
    // 1) tira o que ESTA edição tinha posto (só o que é dela: key que nenhuma outra coluna usa)
    if (ed.atual && !outraUsa(ed.atual)) delete reqs[ed.atual];
    // 2) põe o requisito original na key nova
    const nova = keyDe(depois[i]);
    let atual: string | null = null;
    if (nova && ed.reqs && !outraUsa(nova)) {
      reqs[nova] = ed.reqs;
      atual = nova;
    }
    novas[i] = { orig: ed.orig, reqs: ed.reqs, atual };
  }
  return { requisitos: reqs, origem: novas };
}

/** Blur/commit da linha `indice`: a edição acabou — descarta a foto da key original (a próxima edição parte do que está salvo). */
export function fecharEdicaoBoardPl(edicoes: EdicoesBoardPl, indice: number): EdicoesBoardPl {
  if (!(indice in edicoes)) return edicoes;
  const { [indice]: _fora, ...resto } = edicoes;
  return resto;
}
