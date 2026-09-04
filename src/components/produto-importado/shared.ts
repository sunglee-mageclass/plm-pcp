// Tipos + helpers puros do rascunho (draft) do planejador Produto Importado (Fase 1 —
// TELA NAVEGÁVEL, sem persistência ainda). Espelha o padrão de
// `src/components/produto-acabado/shared.ts` (mesma família de telas), mas para a
// entidade NOVA `produtos_importados` (compra do exterior — moeda/câmbio/frete/etapas de
// pagamento; ver `src/lib/moeda.ts`, FONTE ÚNICA da aritmética consumida aqui).
//
// NADA de aritmética própria neste arquivo além de "moldar" o draft pros helpers de
// `moeda.ts` — a conta em si (custo landed, rateio por peso, cadeia de markup) mora lá.
import { ratearPorPeso, custoLanded, cadeiaMarkup, type EntradaLanded, type EtapaPagamento, type ResultadoLanded } from "@/lib/moeda";

export type VarianteImportadoDraft = {
  ordem: number;
  cor_id: string | null;
  cor_apelido_id: string | null;
  peso: number;
  qtd: number;
  /** true quando o usuário editou a qtd desta variante à mão — trava o rateio automático
   *  por peso NESTA variante (mesma ideia de `ehDistribuicaoProporcional`/preservar edição
   *  manual do Produto Acabado, mas por-variante aqui em vez de "tudo ou nada"). */
  _touched?: boolean;
};

export type EtapaImportadoDraft = {
  ordem: number;
  rotulo: string;
  base: "mercadoria" | "frete";
  percentual: number;
  data_vencimento: string | null;
  cotacao: number;
};

export type ProdutoImportadoDraft = {
  id?: string | null;
  nome: string;
  grupo_id: string | null;
  categoria_id: string | null;
  subcategoria1_id: string | null;
  subcategoria2_id: string | null;
  colecao_id: string | null;
  subcolecao: string | null;
  semana: string | null;
  empresa_id: string | null;
  representante_id: string | null;
  ref_fornecedor: string;
  /** REF real só existe depois de persistido (fase seguinte) — nasce null no draft local. */
  ref?: string | null;
  composicao: string;
  foto_url: string | null;
  data_pedido: string | null;
  data_prevista: string | null;
  data_entrega: string | null;
  /** peso/proporção por TAMANHO — mesma forma de `ProdutoDraft.grade_proporcao` (Produto Acabado). */
  grade_proporcao: Record<string, number>;
  qtd_total: number;
  /** moeda de compra (M1) — ex. RMB. */
  moeda_compra: string;
  /** moeda intermediária (M2) — ex. USD; null = cadeia DIRETA (M1 → BRL sem escala). */
  moeda_intermediaria: string | null;
  /** valor unitário do produto, na moeda M1. */
  valor_unitario_m1: number;
  /** cotação de referência M1→M2 (só exibição da seção 4 — a autoritativa por-etapa mora em `etapas`). */
  cotacao_ref: number;
  peso_kg: number;
  /** frete por peça, já em M2 (peso_kg × transporte_m2 vira `freteUnitarioM2` do landed). */
  transporte_m2: number;
  desconto_pct: number;
  /** cotação final ÚNICA M2→BRL (ou M1→BRL numa cadeia direta, cotação 1). */
  cotacao_final: number;
  markup_atacado: number | null;
  markup_varejo: number | null;
  variantes: VarianteImportadoDraft[];
  etapas: EtapaImportadoDraft[];
};

/** Draft novo com os defaults do design spec: RMB→USD, 1 variante vazia, 3 etapas
 *  (sinal 30% mercadoria, saldo 70% mercadoria, frete 100% frete) — cada Σ% já fecha
 *  100 por base, então `validarDraft` passa de cara num produto recém-criado. */
export function emptyDraft(colecaoId: string | null, subcolecao: string | null): ProdutoImportadoDraft {
  return {
    id: null,
    nome: "",
    grupo_id: null,
    categoria_id: null,
    subcategoria1_id: null,
    subcategoria2_id: null,
    colecao_id: colecaoId,
    subcolecao,
    semana: null,
    empresa_id: null,
    representante_id: null,
    ref_fornecedor: "",
    ref: null,
    composicao: "",
    foto_url: null,
    data_pedido: null,
    data_prevista: null,
    data_entrega: null,
    grade_proporcao: {},
    qtd_total: 0,
    moeda_compra: "RMB",
    moeda_intermediaria: "USD",
    valor_unitario_m1: 0,
    cotacao_ref: 0,
    peso_kg: 0,
    transporte_m2: 0,
    desconto_pct: 0,
    cotacao_final: 0,
    markup_atacado: null,
    markup_varejo: null,
    variantes: [{ ordem: 1, cor_id: null, cor_apelido_id: null, peso: 1, qtd: 0, _touched: false }],
    etapas: [
      { ordem: 1, rotulo: "Sinal", base: "mercadoria", percentual: 30, data_vencimento: null, cotacao: 0 },
      { ordem: 2, rotulo: "Saldo", base: "mercadoria", percentual: 70, data_vencimento: null, cotacao: 0 },
      { ordem: 3, rotulo: "Frete", base: "frete", percentual: 100, data_vencimento: null, cotacao: 1 },
    ],
  };
}

/** Σ qtd de todas as variantes (mesma ideia de `somaPecas`, Produto Acabado) — usada pro
 *  modo BIDIRECIONAL: editar a qtd de 1 variante recalcula `qtd_total` = Σ variantes. */
export function qtdTotalDeVariantes(variantes: VarianteImportadoDraft[]): number {
  return variantes.reduce((s, v) => s + (Number(v.qtd) || 0), 0);
}

/** Aplica `ratearPorPeso(qtd_total, pesos)` às variantes NÃO-touched do draft — as
 *  `_touched` (o usuário editou a qtd à mão) preservam o valor atual. Devolve a lista de
 *  variantes atualizada (não muta `draft`). Se TODAS estiverem touched, devolve como está
 *  (nada a ratear). */
export function recalcVariantesPorPeso(draft: Pick<ProdutoImportadoDraft, "variantes" | "qtd_total">): VarianteImportadoDraft[] {
  const { variantes, qtd_total } = draft;
  const naoTouched = variantes.filter((v) => !v._touched);
  if (naoTouched.length === 0) return variantes;
  // Qtd disponível pro rateio automático = total menos o que já foi fixado manualmente.
  const qtdTouched = variantes.filter((v) => v._touched).reduce((s, v) => s + (Number(v.qtd) || 0), 0);
  const qtdParaRatear = Math.max(0, (Number(qtd_total) || 0) - qtdTouched);
  const pesos = Object.fromEntries(naoTouched.map((v) => [String(v.ordem), v.peso]));
  const rateado = ratearPorPeso(qtdParaRatear, pesos);
  return variantes.map((v) => (v._touched ? v : { ...v, qtd: rateado[String(v.ordem)] ?? 0 }));
}

/** Monta a `EntradaLanded` do draft e chama `custoLanded` (moeda.ts) — NÃO reimplementa a
 *  conta aqui, só molda o shape. `freteUnitarioM2` = peso_kg × transporte_m2 (seção 5). */
export function custoDoDraft(draft: ProdutoImportadoDraft): ResultadoLanded {
  const etapas: EtapaPagamento[] = draft.etapas.map((e) => ({ base: e.base, percentual: e.percentual, cotacao: e.cotacao }));
  const entrada: EntradaLanded = {
    valorUnitarioM1: draft.valor_unitario_m1,
    qtdTotal: draft.qtd_total,
    freteUnitarioM2: (Number(draft.peso_kg) || 0) * (Number(draft.transporte_m2) || 0),
    descontoPct: draft.desconto_pct,
    etapas,
    cotacaoFinal: draft.cotacao_final,
  };
  return custoLanded(entrada);
}

/** Cadeia de markup (custo → atacado → varejo) a partir do `unitarioBrl` calculado por
 *  `custoDoDraft` — mesma fonte única `cadeiaMarkup` do moeda.ts. */
export function precosDoDraft(draft: ProdutoImportadoDraft, resultado?: ResultadoLanded): { atacado: number; varejo: number } {
  const unitarioBrl = (resultado ?? custoDoDraft(draft)).unitarioBrl;
  return cadeiaMarkup(unitarioBrl, draft.markup_atacado ?? 0, draft.markup_varejo ?? 0);
}

/** Σ% por base (mercadoria/frete) das etapas de pagamento. */
export function somaPercentualPorBase(etapas: EtapaImportadoDraft[], base: "mercadoria" | "frete"): number {
  return etapas.filter((e) => e.base === base).reduce((s, e) => s + (Number(e.percentual) || 0), 0);
}

/** Resumo agregado de uma lista de drafts (barra de resumo do planejador). Tudo em BRL
 *  landed × quantidade — o "poder de compra/venda" da coleção. Custos e preços vêm da mesma
 *  fonte única (custoDoDraft/precosDoDraft → moeda.ts). */
export type ResumoImportado = { produtos: number; pecas: number; custoTotalBrl: number; atacadoTotalBrl: number; varejoTotalBrl: number };
export function resumoDrafts(drafts: ProdutoImportadoDraft[]): ResumoImportado {
  let pecas = 0, custoTotalBrl = 0, atacadoTotalBrl = 0, varejoTotalBrl = 0;
  for (const d of drafts) {
    const qtd = Number(d.qtd_total) || 0;
    const custo = custoDoDraft(d);
    const precos = precosDoDraft(d, custo);
    pecas += qtd;
    custoTotalBrl += custo.unitarioBrl * qtd;
    atacadoTotalBrl += precos.atacado * qtd;
    varejoTotalBrl += precos.varejo * qtd;
  }
  return { produtos: drafts.length, pecas, custoTotalBrl, atacadoTotalBrl, varejoTotalBrl };
}

/** Monta o payload `{dados, variantes, etapas}` esperado por `salvar_produto_importado`
 *  a partir do draft. `dados` só leva os escalares do produto (nada de `id`/`variantes`/
 *  `etapas`/`ref`/`_touched` — a RPC ignora chaves extras, mas mantemos o shape enxuto);
 *  datas já são string "YYYY-MM-DD" ou null no draft — passam direto. Markups vazios (0 ou
 *  null) viram `null` (a RPC trata `null` como "sem markup configurado", preservando o
 *  valor atual do modelo espelho em vez de zerar o preço). */
export function montarPayload(draft: ProdutoImportadoDraft): {
  dados: Record<string, unknown>;
  variantes: Omit<VarianteImportadoDraft, "_touched">[];
  etapas: EtapaImportadoDraft[];
} {
  const dados = {
    nome: draft.nome,
    // REF: só envia se o usuário digitou uma manual (senão null → o trigger gera a automática).
    ref: draft.ref || null,
    grupo_id: draft.grupo_id,
    categoria_id: draft.categoria_id,
    subcategoria1_id: draft.subcategoria1_id,
    subcategoria2_id: draft.subcategoria2_id,
    colecao_id: draft.colecao_id,
    subcolecao: draft.subcolecao,
    semana: draft.semana,
    empresa_id: draft.empresa_id,
    representante_id: draft.representante_id,
    ref_fornecedor: draft.ref_fornecedor || null,
    composicao: draft.composicao || null,
    grade_proporcao: draft.grade_proporcao,
    qtd_total: draft.qtd_total,
    foto_url: draft.foto_url,
    data_pedido: draft.data_pedido,
    data_prevista: draft.data_prevista,
    data_entrega: draft.data_entrega,
    moeda_compra: draft.moeda_compra,
    moeda_intermediaria: draft.moeda_intermediaria,
    valor_unitario_m1: draft.valor_unitario_m1,
    cotacao_ref: draft.cotacao_ref,
    peso_kg: draft.peso_kg,
    transporte_m2: draft.transporte_m2,
    desconto_pct: draft.desconto_pct,
    cotacao_final: draft.cotacao_final,
    markup_atacado: draft.markup_atacado || null,
    markup_varejo: draft.markup_varejo || null,
  };
  const variantes = draft.variantes.map(({ ordem, cor_id, cor_apelido_id, peso, qtd }) => ({ ordem, cor_id, cor_apelido_id, peso, qtd }));
  const etapas = draft.etapas.map(({ ordem, rotulo, base, percentual, data_vencimento, cotacao }) => ({ ordem, rotulo, base, percentual, data_vencimento, cotacao }));
  return { dados, variantes, etapas };
}

/** Validação client-side do draft — retorna a MENSAGEM do primeiro problema encontrado, ou
 *  `null` se está tudo certo. Regras (Fase 1): nome obrigatório; Σ% de mercadoria = 100;
 *  Σ% de frete = 100; qtd_total > 0. */
export function validarDraft(draft: ProdutoImportadoDraft): string | null {
  if (!draft.nome.trim()) return "Informe o nome do produto.";
  if (!(Number(draft.qtd_total) > 0)) return "Qtd total precisa ser maior que zero.";
  const somaMerc = somaPercentualPorBase(draft.etapas, "mercadoria");
  if (draft.etapas.some((e) => e.base === "mercadoria") && somaMerc !== 100) {
    return `Σ% das etapas de mercadoria (${somaMerc}%) precisa fechar 100%.`;
  }
  const somaFrete = somaPercentualPorBase(draft.etapas, "frete");
  if (draft.etapas.some((e) => e.base === "frete") && somaFrete !== 100) {
    return `Σ% das etapas de frete (${somaFrete}%) precisa fechar 100%.`;
  }
  return null;
}
