// Helpers puros de MOEDA e CÂMBIO — módulo Produtos Importados.
//
// Moeda/câmbio é dimensão NOVA no sistema (todo o resto é BRL implícito; `parcelas` é
// BRL-only; único formatador anterior = `brl()`). Este arquivo é a FONTE ÚNICA da
// aritmética de conversão + custo landed; o banco tem um espelho byte-a-byte
// (`_imp_custo_landed`, migration de Produtos Importados) para não divergir.
//
// CONVENÇÃO DE COTAÇÃO (travada — segue a planilha-print do dono):
// toda cotação é "quantos X valem 1 unidade da moeda de referência".
//   - cotação de ETAPA = M1 por 1 M2  (ex.: 6 RMB = 1 USD)  → converter M1→M2 DIVIDE.
//   - cotação FINAL     = BRL por 1 M2 (ex.: 5,5 R$ = 1 USD) → converter M2→BRL MULTIPLICA.
// As cotações das etapas de pagamento são M1→M2 (câmbio do dia de cada pagamento); a
// cotação final é ÚNICA, M2→BRL. Numa CADEIA DIRETA (sem M2), a etapa converte M1→BRL
// (mesma convenção: M1 por 1 BRL, DIVIDE) e a cotação final é 1.

/** Uma moeda selecionável. Lista fixa + code livre ("outra"). */
export type Moeda = { code: string; nome: string; simbolo: string };

/** Lista fixa de moedas (SSOT). "Adicionar moeda" = code livre digitado pelo usuário,
 *  não precisa estar aqui. RMB/USD/BRL/PYG cobrem os casos citados pelo dono. */
export const MOEDAS: Moeda[] = [
  { code: "BRL", nome: "Real", simbolo: "R$" },
  { code: "USD", nome: "Dólar americano", simbolo: "US$" },
  { code: "RMB", nome: "Yuan (RMB)", simbolo: "¥" },
  { code: "PYG", nome: "Guarani", simbolo: "₲" },
];

/** Símbolo de uma moeda (fallback: o próprio code). */
export function simboloMoeda(code: string | null | undefined): string {
  const c = (code ?? "").trim().toUpperCase();
  return MOEDAS.find((m) => m.code === c)?.simbolo ?? (c || "");
}

/** Formata um valor numa moeda arbitrária. Para BRL usa o mesmo locale do `brl()`;
 *  para as demais, símbolo + número pt-BR (milhar/decimais). Formatador ÚNICO de moeda
 *  estrangeira — NÃO usar toLocaleString solto nos componentes (regra anti-drift). */
export function fmtMoeda(valor: number | null | undefined, code: string | null | undefined, casas = 2): string {
  const v = Number(valor) || 0;
  const c = (code ?? "").trim().toUpperCase();
  if (c === "BRL" || c === "") {
    return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  const num = v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
  return `${simboloMoeda(c)} ${num}`;
}

// ————————————————————————————————————————————————————————————————————————————
// Conversão
// ————————————————————————————————————————————————————————————————————————————

/** M1 → M2 pela cotação da etapa (M1 por 1 M2). Cotação ≤ 0 → 0 (evita divisão inválida). */
export function m1ParaM2(valorM1: number, cotacaoEtapa: number): number {
  const cot = Number(cotacaoEtapa) || 0;
  if (cot <= 0) return 0;
  return (Number(valorM1) || 0) / cot;
}

/** M2 → BRL pela cotação final (BRL por 1 M2). */
export function m2ParaBrl(valorM2: number, cotacaoFinal: number): number {
  return (Number(valorM2) || 0) * (Number(cotacaoFinal) || 0);
}

// ————————————————————————————————————————————————————————————————————————————
// Custo landed (posto no Brasil)
// ————————————————————————————————————————————————————————————————————————————

/** Base de uma etapa de pagamento: sobre a mercadoria ou sobre o frete. */
export type BaseEtapa = "mercadoria" | "frete";

export type EtapaPagamento = {
  base: BaseEtapa;
  /** fração da base, em % (0..100). */
  percentual: number;
  /** cotação da etapa = M1 por 1 M2 (mercadoria). Para frete que já está em M2, use 1. */
  cotacao: number;
};

export type EntradaLanded = {
  /** preço unitário do produto na moeda de compra (M1). */
  valorUnitarioM1: number;
  /** quantidade total do pedido. */
  qtdTotal: number;
  /** frete por peça, já em M2 (peso_kg × transporte_m2). */
  freteUnitarioM2: number;
  /** desconto do pedido, em % (0..100), proporcional às duas bases. */
  descontoPct: number;
  /** etapas de pagamento (mercadoria e frete). Σ% deve fechar 100 POR BASE. */
  etapas: EtapaPagamento[];
  /** cotação final ÚNICA = BRL por 1 M2. Numa cadeia direta (M1→BRL nas etapas), use 1. */
  cotacaoFinal: number;
};

export type ResultadoLanded = {
  /** mercadoria líquida do pedido, em M2 (Σ etapas de mercadoria convertidas). */
  mercadoriaM2: number;
  /** frete líquido do pedido, em M2 (Σ etapas de frete). */
  freteM2: number;
  /** total do pedido em M2 (mercadoria + frete). */
  totalM2: number;
  /** custo landed do pedido em BRL (total M2 × cotação final). */
  totalBrl: number;
  /** custo landed UNITÁRIO em BRL (total BRL ÷ qtd total). */
  unitarioBrl: number;
};

/**
 * Custo landed do pedido a partir das etapas de pagamento.
 *
 * Mercadoria bruta (M1) = valorUnitarioM1 × qtdTotal; frete bruto (M2) = freteUnitarioM2 ×
 * qtdTotal. O desconto é aplicado PROPORCIONALMENTE às duas bases (×(1−d)), preservando a
 * fórmula do dono `real = bruto × (1−desconto)` e mantendo as bases separáveis.
 *
 * Cada etapa de MERCADORIA converte o seu pedaço (%×mercadoria_liq_M1) para M2 pela SUA
 * cotação (M1→M2, divide). Cada etapa de FRETE já está em M2 (dividido por 1). O total em
 * M2 vira BRL pela cotação final única. Quando todas as cotações de etapa são iguais, o
 * resultado degrada exatamente para a planilha (total_M2 × cotação_final).
 *
 * Robustez: se NÃO houver etapas de uma base, assume 100% dela na cotação de referência —
 * mercadoria usa a cotação da 1ª etapa de mercadoria disponível OU (na ausência total) a
 * conversão fica 0; frete sem etapa entra 100% em M2. Isso evita que um card recém-criado
 * (ainda sem etapas configuradas) mostre custo zero enganoso — mas a fonte AUTORITATIVA do
 * custo é sempre as etapas quando existem.
 */
export function custoLanded(e: EntradaLanded): ResultadoLanded {
  const qtd = Number(e.qtdTotal) || 0;
  const desc = 1 - (Number(e.descontoPct) || 0) / 100;
  const mercadoriaBrutaM1 = (Number(e.valorUnitarioM1) || 0) * qtd;
  const freteBrutoM2 = (Number(e.freteUnitarioM2) || 0) * qtd;
  const mercadoriaLiqM1 = mercadoriaBrutaM1 * desc;
  const freteLiqM2 = freteBrutoM2 * desc;

  const etapas = e.etapas ?? [];
  const etapasMerc = etapas.filter((x) => x.base === "mercadoria");
  const etapasFrete = etapas.filter((x) => x.base === "frete");

  let mercadoriaM2 = 0;
  if (etapasMerc.length > 0) {
    for (const et of etapasMerc) {
      const pedacoM1 = mercadoriaLiqM1 * ((Number(et.percentual) || 0) / 100);
      mercadoriaM2 += m1ParaM2(pedacoM1, et.cotacao);
    }
  }

  let freteM2 = 0;
  if (etapasFrete.length > 0) {
    // Etapa de frete já em M2: soma o pedaço da % (÷ cotação, default 1 → identidade).
    for (const et of etapasFrete) {
      const pedacoM2 = freteLiqM2 * ((Number(et.percentual) || 0) / 100);
      const cot = Number(et.cotacao) || 0;
      freteM2 += cot > 0 && cot !== 1 ? pedacoM2 / cot : pedacoM2;
    }
  } else {
    // Sem etapa de frete configurada: frete entra 100% em M2 (já está nessa moeda).
    freteM2 = freteLiqM2;
  }

  const totalM2 = mercadoriaM2 + freteM2;
  const totalBrl = m2ParaBrl(totalM2, e.cotacaoFinal);
  const unitarioBrl = qtd > 0 ? totalBrl / qtd : 0;
  return { mercadoriaM2, freteM2, totalM2, totalBrl, unitarioBrl };
}

// ————————————————————————————————————————————————————————————————————————————
// Rateio de variantes (divisão simples por peso; editável no componente)
// ————————————————————————————————————————————————————————————————————————————

/**
 * Distribui a quantidade total entre as variantes por PESO (proporção da cor), com
 * divisão simples arredondada — decisão do dono (NÃO Hamilton). `qtd_variante =
 * round((qtd_total ÷ Σpesos) × peso)`. Σpesos ≤ 0 → tudo 0. É só o preenchimento
 * AUTOMÁTICO; o componente permite editar cada variante e então recalcula
 * `qtd_total = Σ variantes` (bidirecional). Devolve na ordem das chaves recebidas.
 */
export function ratearPorPeso(qtdTotal: number, pesos: Record<string, number>): Record<string, number> {
  const chaves = Object.keys(pesos);
  const somaPesos = chaves.reduce((acc, k) => acc + (Number(pesos[k]) || 0), 0);
  const out: Record<string, number> = {};
  if (somaPesos <= 0) {
    for (const k of chaves) out[k] = 0;
    return out;
  }
  const unidade = (Number(qtdTotal) || 0) / somaPesos;
  for (const k of chaves) out[k] = Math.round(unidade * (Number(pesos[k]) || 0));
  return out;
}

// ————————————————————————————————————————————————————————————————————————————
// Cadeia de markup (custo → atacado → varejo) — espelha _imp_recomputar_precos_modelo
// ————————————————————————————————————————————————————————————————————————————

/** ATACADO = custo × markup_atacado; VAREJO = atacado × markup_varejo. Markup ≤ 0 → o
 *  preço correspondente não é calculado (0). Arredonda a 2 casas (como o banco). */
export function cadeiaMarkup(custoBrl: number, markupAtacado: number, markupVarejo: number): { atacado: number; varejo: number } {
  const custo = Number(custoBrl) || 0;
  const mkA = Number(markupAtacado) || 0;
  const mkV = Number(markupVarejo) || 0;
  const atacado = custo > 0 && mkA > 0 ? Math.round(custo * mkA * 100) / 100 : 0;
  const varejo = atacado > 0 && mkV > 0 ? Math.round(atacado * mkV * 100) / 100 : 0;
  return { atacado, varejo };
}
