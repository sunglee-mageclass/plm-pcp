// "Linhas" da grade de Insumos, na ORDEM EM QUE APARECEM na tela, para o colar do Excel saber que linha vem depois de qual (PURO).
// Ordem: para cada insumo, a linha-PAI (cabeçalho) e as cores que já existem (menos as que a lixeira marcou para remover); em seguida
// as cores NOVAS dele ("+ cor"); no fim, os insumos NOVOS. O cabeçalho só existe/edita na linha-pai; as cores só têm os campos da cor.
// Espelha `src/lib/aviamento-grade/colar-slots.ts`.
import type { ColunaGrade } from "./colunas";
import { SEM_COR, type LinhaGrade } from "./linhas";
import type { InsumoNovo } from "./linha-nova";

export type SlotColagem =
  // `pai` = a linha do cabeçalho do insumo (corId null; no insumo com cores é uma linha PRÓPRIA, antes das cores);
  // `temCores` só é lido na linha-pai (muda o motivo da recusa de um campo de cor). `corId` = a cor da linha-filha na LEITURA do
  // servidor ("" = sem cor): o rascunho do insumo a encontra por ela.
  | {
      tipo: "existente";
      chave: string;
      insumoId: string;
      corId: string | null;
      pai: boolean;
      temCores: boolean;
    }
  | { tipo: "novo"; chave: string; grupoTmp: string; varTmp: string; editaCabecalho: boolean };

/** Chave do slot de uma cor NOVA (a mesma que a linha leva em `data-slot`). */
export const chaveSlotNovo = (varTmp: string): string => `novo:${varTmp}`;
/** Chave do slot da linha-PAI de um insumo cadastrado (a mesma que a linha leva em `data-slot`). */
export const chaveSlotPai = (insumoId: string): string => `${insumoId}:pai`;
/** Chave do slot de uma COR cadastrada ("" = sem cor). Distinta da do pai: a cor "sem cor" e o pai não podem se confundir. */
export const chaveSlotCor = (insumoId: string, corId: string | null): string =>
  `${insumoId}:cor:${corId || SEM_COR}`;

/**
 * Slots na ordem da tela. `linhas` = `montarLinhas` (cores de um insumo já vêm em sequência). `removidas` = `chaveSlotCor` das cores que a
 * lixeira marcou para remover (não são linhas da tela: o colar as pula).
 */
export function montarSlots(
  linhas: Pick<LinhaGrade, "insumoId" | "bloco">[],
  novos: InsumoNovo[],
  removidas: ReadonlySet<string> = new Set(),
): SlotColagem[] {
  const slots: SlotColagem[] = [];
  const corNovaDe = new Map<string, InsumoNovo>();
  const insumosNovos: InsumoNovo[] = [];
  for (const g of novos) {
    if (g.insumoAlvoId) corNovaDe.set(g.insumoAlvoId, g);
    else insumosNovos.push(g);
  }
  const novosDoGrupo = (g: InsumoNovo): SlotColagem[] =>
    g.blocos.map((b, i) => ({
      tipo: "novo" as const,
      chave: chaveSlotNovo(b.tmp),
      grupoTmp: g.tmp,
      varTmp: b.tmp,
      // cabeçalho só edita na 1ª cor de insumo NOVO; cor nova de insumo existente herda tudo
      editaCabecalho: !g.insumoAlvoId && i === 0,
    }));

  let atual: string | null = null;
  const fecha = () => {
    const g = atual ? corNovaDe.get(atual) : undefined;
    if (g) slots.push(...novosDoGrupo(g));
  };
  for (const l of linhas) {
    if (l.insumoId !== atual) {
      fecha();
      atual = l.insumoId;
      // insumo COM cores: a linha-pai (cabeçalho) vem antes da 1ª cor, com a chave do "insumo sem cor" (a mesma que a tela usa)
      if (l.bloco != null) {
        slots.push({
          tipo: "existente",
          chave: chaveSlotPai(l.insumoId),
          insumoId: l.insumoId,
          corId: null,
          pai: true,
          temCores: true,
        });
      }
    }
    if (l.bloco != null && removidas.has(chaveSlotCor(l.insumoId, l.bloco.cor_id))) continue;
    // insumo SEM cores: a única linha dele já é a linha-pai
    slots.push({
      tipo: "existente",
      chave: l.bloco ? chaveSlotCor(l.insumoId, l.bloco.cor_id) : chaveSlotPai(l.insumoId),
      insumoId: l.insumoId,
      corId: l.bloco ? l.bloco.cor_id : null,
      pai: l.bloco == null,
      temCores: false,
    });
  }
  fecha();
  for (const g of insumosNovos) slots.push(...novosDoGrupo(g));
  return slots;
}

/** `null` = a linha aceita a célula; texto = por que não (vai para o aviso). */
export function recusaDoSlot(
  slot: SlotColagem | undefined,
  col: Pick<ColunaGrade, "escopo">,
): string | null {
  if (!slot) return null;
  if (slot.tipo === "existente") {
    if (slot.pai) {
      if (col.escopo !== "variante") return null;
      return slot.temCores
        ? "As cores ficam nas linhas abaixo do insumo — cole na linha da cor"
        : "Este insumo ainda não tem cores — use o + para criar a cor antes de colar";
    }
    // linha de COR: só os campos da cor (o cabeçalho é da linha do insumo, e uma célula do cabeçalho colada aqui sobrescreveria o do pai)
    return col.escopo === "insumo"
      ? "Cabeçalho do insumo — cole na linha do insumo (a de cima)"
      : null;
  }
  return col.escopo === "insumo" && !slot.editaCabecalho
    ? "Cabeçalho herdado do insumo — cole na 1ª linha do insumo novo"
    : null;
}
