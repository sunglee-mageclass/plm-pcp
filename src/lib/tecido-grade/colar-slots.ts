// "Linhas" da grade, na ORDEM EM QUE APARECEM na tela, para o colar do Excel saber que linha vem depois de qual (PURO).
// Ordem: para cada tecido, a linha-PAI (cabeçalho) e as cores que já existem; em seguida as cores NOVAS dele ("+ cor"); no fim,
// os tecidos NOVOS. O cabeçalho só existe/edita na linha-pai; as cores só têm os campos da cor.
// Só entram tecidos que a tela mostra (cor nova de tecido filtrado para fora da lista fica invisível e fora da conta).
import type { ColunaGrade } from "./colunas";
import { chaveLinha, type LinhaGrade } from "./linhas";
import type { TecidoNovo } from "./linha-nova";

export type SlotColagem =
  // `pai` = a linha do cabeçalho do tecido (varianteId null; no tecido com cores é uma linha PRÓPRIA, antes das cores);
  // `temCores` só é lido na linha-pai (muda o motivo da recusa de um campo de cor).
  | { tipo: "existente"; chave: string; artigoId: string; varianteId: string | null; pai: boolean; temCores: boolean }
  | { tipo: "novo"; chave: string; grupoTmp: string; varTmp: string; editaCabecalho: boolean };

/** Chave do slot de uma cor NOVA (a mesma que a linha leva em `data-slot`). */
export const chaveSlotNovo = (varTmp: string): string => `novo:${varTmp}`;

/** Slots na ordem da tela. `linhas` = `montarLinhas` (cores de um tecido já vêm em sequência). */
export function montarSlots(linhas: Pick<LinhaGrade, "chave" | "artigoId" | "variantId">[], novos: TecidoNovo[]): SlotColagem[] {
  const slots: SlotColagem[] = [];
  const corNovaDe = new Map<string, TecidoNovo>();
  const tecidosNovos: TecidoNovo[] = [];
  for (const g of novos) {
    if (g.artigoAlvoId) corNovaDe.set(g.artigoAlvoId, g);
    else tecidosNovos.push(g);
  }
  const novosDoGrupo = (g: TecidoNovo): SlotColagem[] =>
    g.vars.map((v, i) => ({
      tipo: "novo" as const,
      chave: chaveSlotNovo(v.tmp),
      grupoTmp: g.tmp,
      varTmp: v.tmp,
      // cabeçalho só edita na 1ª cor de tecido NOVO; cor nova de tecido existente herda tudo
      editaCabecalho: !g.artigoAlvoId && i === 0,
    }));

  let artigoAtual: string | null = null;
  const fecha = () => {
    const g = artigoAtual ? corNovaDe.get(artigoAtual) : undefined;
    if (g) slots.push(...novosDoGrupo(g));
  };
  for (const l of linhas) {
    if (l.artigoId !== artigoAtual) {
      fecha();
      artigoAtual = l.artigoId;
      // tecido COM cores: a linha-pai (cabeçalho) vem antes da 1ª cor, com a chave do "tecido sem cor" (a mesma que a tela usa)
      if (l.variantId != null) {
        slots.push({ tipo: "existente", chave: chaveLinha(l.artigoId, null), artigoId: l.artigoId, varianteId: null, pai: true, temCores: true });
      }
    }
    // tecido SEM cores: a única linha dele já é a linha-pai
    slots.push({ tipo: "existente", chave: l.chave, artigoId: l.artigoId, varianteId: l.variantId, pai: l.variantId == null, temCores: false });
  }
  fecha();
  for (const g of tecidosNovos) slots.push(...novosDoGrupo(g));
  return slots;
}

/** `null` = a linha aceita a célula; texto = por que não (vai para o aviso). */
export function recusaDoSlot(slot: SlotColagem | undefined, col: Pick<ColunaGrade, "escopo">): string | null {
  if (!slot) return null;
  if (slot.tipo === "existente") {
    if (slot.pai) {
      if (col.escopo !== "variante") return null;
      return slot.temCores
        ? "As cores ficam nas linhas abaixo do tecido — cole na linha da cor"
        : "Este tecido ainda não tem cores — use o + para criar a cor antes de colar";
    }
    // linha de COR: só os campos da cor (o cabeçalho é da linha do tecido, e uma célula do cabeçalho colada aqui sobrescreveria o do pai)
    return col.escopo === "artigo" ? "Cabeçalho do tecido — cole na linha do tecido (a de cima)" : null;
  }
  return col.escopo === "artigo" && !slot.editaCabecalho ? "Cabeçalho herdado do tecido — cole na 1ª linha do tecido novo" : null;
}
