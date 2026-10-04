/**
 * Regras do botão Lançar do Planejamento (Modularidade, P-252 A) — função PURA, usada pelo Sheet do Planejamento
 * (pré-checagem da mutation + tooltip do botão) e pelo foguete do card da lista.
 *
 * Espelho do servidor (`lancar_modelo`): o CQ liberado só é exigido quando a LOJA tem o módulo Produção (`cqExigido`
 * = `isModuleEnabled("producao")`). Mão de obra aprovada e Data de Lançamento valem sempre. O servidor re-valida tudo.
 */
export type EntradaLancar = {
  /** A loja tem o módulo Produção (só então o CQ liberado é exigido). */
  cqExigido: boolean;
  /** CQ Pré (e Pós, se houver acabamento) liberado — `cqLiberado()` de `@/lib/cq-status`. Ignorado sem `cqExigido`. */
  cqLiberado: boolean;
  /** Todas as linhas de mão de obra aprovadas (ou sem serviço). */
  moAprovada: boolean;
  /** Há Data de Lançamento preenchida. */
  temData: boolean;
  /** Linha de M.O. aprovada com valor alterado e ainda não salvo (o Salvar a reabre): o texto vira "salve antes". */
  moReabreAoSalvar?: boolean;
};

export const TEXTO_LANCAR_CQ = "Confirme o Controle de Qualidade (Pré e, se houver acabamento, o Pós).";
export const TEXTO_LANCAR_MO_REABRE = "Salve antes: a mão de obra alterada volta para pendente e precisa de nova aprovação.";
export const TEXTO_LANCAR_MO = "Aprove a mão de obra de todos os serviços (na seção Preço e Custos).";
export const TEXTO_LANCAR_DATA = "Preencha a Data de Lançamento.";

/** O que falta para poder Lançar (vazio = pode). Mesma ordem de sempre: CQ, mão de obra, data. */
export function bloqueiosLancar(e: EntradaLancar): string[] {
  const b: string[] = [];
  if (e.cqExigido && !e.cqLiberado) b.push(TEXTO_LANCAR_CQ);
  if (e.moReabreAoSalvar) b.push(TEXTO_LANCAR_MO_REABRE);
  else if (!e.moAprovada) b.push(TEXTO_LANCAR_MO);
  if (!e.temData) b.push(TEXTO_LANCAR_DATA);
  return b;
}

/** Texto curto "o que o Lançar exige" (dica do foguete do card): com Produção pede o CQ; sem ela só M.O. e data (P-252 A). */
export function textoLancarExige(cqExigido: boolean): string {
  return cqExigido
    ? "Disponível só com CQ liberado e mão de obra aprovada"
    : "Lançar exige a mão de obra aprovada e a data";
}

/**
 * Card "pronto para lançar" (filtro/foguete da lista): mão de obra aprovada e, só com Produção, o CQ liberado.
 * (A data é do campo ao lado do foguete: o servidor recusa sem ela.)
 */
export function prontoParaLancar(e: { cqExigido: boolean; cqLiberado: boolean; moAprovada: boolean }): boolean {
  return e.moAprovada && (!e.cqExigido || e.cqLiberado);
}
