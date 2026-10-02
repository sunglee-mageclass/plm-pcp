// P-207 A (L8) — etapas de pagamento do IMPORTADO (card do Produto Importado E OC de importado): fonte ÚNICA, pura.
// Espelha o servidor (`_salvar_produto_importado_core` / `_salvar_oc_importado_core`, 20261028200000):
//   etapa de MERCADORIA (base vazia = mercadoria) com % > 0 e cotação <= 0 é RECUSADA, mas SÓ quando a compra tem valor
//   (valor unitário M1 > 0 — Q2: produto recém-criado/sem valor salva os outros campos sem a cotação de referência).
//   A cotação da etapa de mercadoria divide o valor M1 → M2; com 0 o landed a ignorava e a parcela da OC saía 0 e era
//   pulada em silêncio (fin #10). Frete com 0/1 = identidade ("deixe 1 se o frete já está em R$").

export type EtapaImportado = {
  ordem: number;
  rotulo: string;
  base: "mercadoria" | "frete";
  percentual: number;
  data_vencimento: string | null;
  cotacao: number;
};

const ehMercadoria = (e: Pick<EtapaImportado, "base">) =>
  ((e.base as string | null | undefined) || "mercadoria") === "mercadoria";

/** Etapa NOVA: base mercadoria e a COTAÇÃO DE REFERÊNCIA (antes nascia com 0). `null` = já há 5 etapas. */
export function novaEtapaImportado<E extends EtapaImportado>(
  etapas: E[],
  cotacaoRef: number,
): EtapaImportado | null {
  if (etapas.length >= 5) return null;
  const ordem = etapas.length ? Math.max(...etapas.map((e) => e.ordem)) + 1 : 1;
  return {
    ordem,
    rotulo: "",
    base: "mercadoria",
    percentual: 0,
    data_vencimento: null,
    cotacao: Number(cotacaoRef) > 0 ? Number(cotacaoRef) : 0,
  };
}

/** Ao fixar a cotação de referência (blur do campo / etapas padrão injetadas), as etapas de MERCADORIA ainda SEM
 *  cotação (0) passam a ter a referência. Cotação própria (> 0) e frete não mudam. Mesmo array quando nada muda. */
export function etapasComCotacaoRef<E extends EtapaImportado>(
  etapas: E[],
  cotacaoRef: number,
): E[] {
  const ref = Number(cotacaoRef);
  if (!(ref > 0)) return etapas;
  if (!etapas.some((e) => ehMercadoria(e) && !(Number(e.cotacao) > 0))) return etapas;
  return etapas.map((e) =>
    ehMercadoria(e) && !(Number(e.cotacao) > 0) ? { ...e, cotacao: ref } : e,
  );
}

/** B3 — trocar a BASE de uma etapa: Frete → Mercadoria com a cotação "de frete" (1 ou 0, identidade) passa a ter a
 *  cotação de referência (senão a mercadoria converteria 1:1 em silêncio). Devolve o patch a aplicar. */
export function patchTrocaBase(
  e: Pick<EtapaImportado, "base" | "cotacao">,
  novaBase: "mercadoria" | "frete",
  cotacaoRef: number,
): Partial<EtapaImportado> {
  const ref = Number(cotacaoRef);
  if (
    novaBase === "mercadoria" &&
    e.base === "frete" &&
    [0, 1].includes(Number(e.cotacao) || 0) &&
    ref > 0
  ) {
    return { base: novaBase, cotacao: ref };
  }
  return { base: novaBase };
}

/** A etapa seria recusada no Salvar (mercadoria, % > 0, cotação <= 0, compra com valor > 0)? — p/ a borda vermelha. */
export function etapaSemCotacao(e: EtapaImportado, valorUnitarioM1: number): boolean {
  return (
    Number(valorUnitarioM1) > 0 &&
    ehMercadoria(e) &&
    Number(e.percentual) > 0 &&
    !(Number(e.cotacao) > 0)
  );
}

/** Mensagem PT do 1º caso recusado, ou `null`. MESMA regra do servidor (valor M1 > 0 E mercadoria % > 0 cotação <= 0). */
export function erroCotacaoEtapas(
  etapas: EtapaImportado[],
  valorUnitarioM1: number,
): string | null {
  const e = etapas.find((x) => etapaSemCotacao(x, valorUnitarioM1));
  if (!e) return null;
  const nome = e.rotulo?.trim() ? `"${e.rotulo.trim()}"` : `${e.ordem}`;
  return `Etapa ${nome} de mercadoria (${e.percentual}%) está sem cotação — informe a cotação (a de referência é o padrão).`;
}
