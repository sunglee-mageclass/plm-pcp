// "Linhas" da grade, na ORDEM EM QUE APARECEM na tela, para o colar do Excel saber que linha vem depois de qual (PURO).
// Ordem: para cada tecido, as cores que já existem; em seguida as cores NOVAS dele ("+ cor"); no fim, os tecidos NOVOS.
// Só entram tecidos que a tela mostra (cor nova de tecido filtrado para fora da lista fica invisível e fora da conta).
import type { ColunaGrade } from "./colunas";
import type { LinhaGrade } from "./linhas";
import type { TecidoNovo } from "./linha-nova";

export type SlotColagem =
  | { tipo: "existente"; chave: string; artigoId: string; varianteId: string | null }
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
    }
    slots.push({ tipo: "existente", chave: l.chave, artigoId: l.artigoId, varianteId: l.variantId });
  }
  fecha();
  for (const g of tecidosNovos) slots.push(...novosDoGrupo(g));
  return slots;
}

/** `null` = a linha aceita a célula; texto = por que não (vai para o aviso). */
export function recusaDoSlot(slot: SlotColagem | undefined, col: Pick<ColunaGrade, "escopo">): string | null {
  if (!slot) return null;
  if (slot.tipo === "existente") {
    return slot.varianteId == null && col.escopo === "variante" ? "Este tecido ainda não tem cores — use o + para criar a cor antes de colar" : null;
  }
  return col.escopo === "artigo" && !slot.editaCabecalho ? "Cabeçalho herdado do tecido — cole na 1ª linha do tecido novo" : null;
}
