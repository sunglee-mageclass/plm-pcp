// "Linhas" da grade de Aviamentos, na ORDEM EM QUE APARECEM na tela, para o colar do Excel saber que linha vem depois de qual (PURO).
// Ordem: para cada aviamento, a linha-PAI (cabeçalho) e as cores que já existem; em seguida as cores NOVAS dele ("+ cor"); no fim,
// os aviamentos NOVOS. O cabeçalho só existe/edita na linha-pai; as cores só têm os campos da cor.
// Espelha `src/lib/tecido-grade/colar-slots.ts`.
import type { ColunaGrade } from "./colunas";
import { chaveLinha, type LinhaGrade } from "./linhas";
import type { AviamentoNovo } from "./linha-nova";

export type SlotColagem =
  // `pai` = a linha do cabeçalho do aviamento (variantId null; no aviamento com cores é uma linha PRÓPRIA, antes das cores);
  // `temCores` só é lido na linha-pai (muda o motivo da recusa de um campo de cor).
  | {
      tipo: "existente";
      chave: string;
      aviamentoId: string;
      varianteId: string | null;
      pai: boolean;
      temCores: boolean;
    }
  | { tipo: "novo"; chave: string; grupoTmp: string; varTmp: string; editaCabecalho: boolean };

/** Chave do slot de uma cor NOVA (a mesma que a linha leva em `data-slot`). */
export const chaveSlotNovo = (varTmp: string): string => `novo:${varTmp}`;

/** Slots na ordem da tela. `linhas` = `montarLinhas` (cores de um aviamento já vêm em sequência). */
export function montarSlots(
  linhas: Pick<LinhaGrade, "chave" | "aviamentoId" | "variantId">[],
  novos: AviamentoNovo[],
): SlotColagem[] {
  const slots: SlotColagem[] = [];
  const corNovaDe = new Map<string, AviamentoNovo>();
  const aviamentosNovos: AviamentoNovo[] = [];
  for (const g of novos) {
    if (g.aviamentoAlvoId) corNovaDe.set(g.aviamentoAlvoId, g);
    else aviamentosNovos.push(g);
  }
  const novosDoGrupo = (g: AviamentoNovo): SlotColagem[] =>
    g.vars.map((v, i) => ({
      tipo: "novo" as const,
      chave: chaveSlotNovo(v.tmp),
      grupoTmp: g.tmp,
      varTmp: v.tmp,
      // cabeçalho só edita na 1ª cor de aviamento NOVO; cor nova de aviamento existente herda tudo
      editaCabecalho: !g.aviamentoAlvoId && i === 0,
    }));

  let atual: string | null = null;
  const fecha = () => {
    const g = atual ? corNovaDe.get(atual) : undefined;
    if (g) slots.push(...novosDoGrupo(g));
  };
  for (const l of linhas) {
    if (l.aviamentoId !== atual) {
      fecha();
      atual = l.aviamentoId;
      // aviamento COM cores: a linha-pai (cabeçalho) vem antes da 1ª cor, com a chave do "aviamento sem cor" (a mesma que a tela usa)
      if (l.variantId != null) {
        slots.push({
          tipo: "existente",
          chave: chaveLinha(l.aviamentoId, null),
          aviamentoId: l.aviamentoId,
          varianteId: null,
          pai: true,
          temCores: true,
        });
      }
    }
    // aviamento SEM cores: a única linha dele já é a linha-pai
    slots.push({
      tipo: "existente",
      chave: l.chave,
      aviamentoId: l.aviamentoId,
      varianteId: l.variantId,
      pai: l.variantId == null,
      temCores: false,
    });
  }
  fecha();
  for (const g of aviamentosNovos) slots.push(...novosDoGrupo(g));
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
        ? "As cores ficam nas linhas abaixo do aviamento — cole na linha da cor"
        : "Este aviamento ainda não tem cores — use o + para criar a cor antes de colar";
    }
    // linha de COR: só os campos da cor (o cabeçalho é da linha do aviamento, e uma célula do cabeçalho colada aqui sobrescreveria o do pai)
    return col.escopo === "aviamento"
      ? "Cabeçalho do aviamento — cole na linha do aviamento (a de cima)"
      : null;
  }
  return col.escopo === "aviamento" && !slot.editaCabecalho
    ? "Cabeçalho herdado do aviamento — cole na 1ª linha do aviamento novo"
    : null;
}
