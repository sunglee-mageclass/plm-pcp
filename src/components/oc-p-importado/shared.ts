// Tipos + helpers puros da OC P. Importado. Espelha o padrão de src/components/oc-p-acabado/shared.ts (mesma família de telas —
// grade_detalhe jsonb {"<ordem>":{"<tam>":{"pedida","recebida","defeito"}}}, redistribuição por maior resto), com a DIFERENÇA de
// domínio: câmbio/etapas de pagamento em vez de prazo_pagamento/parcelas_entrega (ver `src/lib/moeda.ts`, fonte única da aritmética
// de conversão/custo landed, e `src/components/produto-importado/shared.ts`, mesmos tipos de VarianteImportadoDraft/
// EtapaImportadoDraft reaproveitados aqui no formato de OC).
//
// [urg R13 T8] O PRODUTO saiu do cabeçalho: a OC tem N itens (`ocs_importado_itens`, ver `./itens`). Aqui fica só o que é da OC
// INTEIRA: fornecedor, datas, moeda/cotações, as ETAPAS de pagamento (o cronograma da OC) e a Data da Nota de Entrada.
import { format } from "date-fns";
import { splitMaiorResto } from "@/lib/produto-acabado";
export { fmtMoney, fmtDate, uploadFile } from "@/components/oc-tecido/shared";

export type OcImportadoStatus = "encomendado" | "recebido";
export type OcImportadoTab = OcImportadoStatus | "estoque";

// Tamanhos-fallback (paridade com OC P. Acabado) — tenant sem tenant_config.tamanhos_grade
// ainda cai numa grade utilizável.
export const DEFAULT_TAMANHOS = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
// Size-key literal do grupo Acessórios (grade única, sem tamanho).
export const TAM_ACESSORIO = "UN";

export type CelulaGrade = { pedida: number; recebida: number; defeito: number };
// grade_detalhe: {"<ordem>": {"<tam>": {pedida,recebida,defeito}}} — contrato "estado
// completo por save" (mesmo padrão da OC P. Acabado): quem salva manda o objeto inteiro.
export type GradeDetalhe = Record<string, Record<string, CelulaGrade>>;

export type VarianteDraft = {
  ordem: number;
  cor_id: string | null;
  cor_apelido_id: string | null;
  peso: number;
  qtd: number;
};

/** Etapa de pagamento na OC (snapshot editável do cronograma do card — pode divergir depois
 *  de "Fazer pedido"). Mesmo shape de `EtapaImportadoDraft` (produto-importado/shared.ts). */
export type EtapaDraft = {
  ordem: number;
  rotulo: string;
  base: "mercadoria" | "frete";
  percentual: number;
  data_vencimento: string | null;
  cotacao: number;
};

/** Resumo de UM produto (item) da OC, como a lista (abas) o vê — vem do embed `itens:ocs_importado_itens(...)`. */
export type OcImpItemResumo = { id: string; ordem: number | null; nome_produto: string | null; status: OcImportadoStatus };

/** Uma linha da lista (abas Encomendadas/Recebidas). O produto saiu do cabeçalho (R13): vem dos ITENS.
 *  `valor_total_desconto` é a soma dos itens em M1 (a moeda da compra). */
export type OcImportadoRow = {
  id: string;
  numero: string | null;
  empresa_id: string | null;
  data_pedido: string | null;
  data_prevista: string | null;
  data_entrega: string | null;
  data_nota_entrada?: string | null;
  qtd_total: number | null;
  valor_total_desconto: number | null;
  moeda_compra: string | null;
  status: OcImportadoStatus;
  itens: OcImpItemResumo[];
};

/**
 * Rascunho do CABEÇALHO da OC (o que é da OC inteira). Cada produto é um ITEM (`ItemOcImp`, em `./itens`). O nº da OC é gerado
 * pelo servidor na criação e nunca muda — só exibição. As ETAPAS entram como array GRÃO-GROSSO (o servidor faz delete+reinsert;
 * sem chave estável): para o merge colaborativo o cronograma inteiro é UM campo.
 */
export type CabecalhoImpDraft = {
  numero: string;
  empresa_id: string | null;
  representante_id: string | null;
  data_pedido: string;
  data_prevista: string;
  // Câmbio (congelado no pedido — mesmos campos/semântica de produtos_importados/moeda.ts). É da OC inteira: todos os produtos
  // dela têm a MESMA moeda de compra/intermediária (o servidor recusa `moeda_diferente:`).
  moeda_compra: string;
  moeda_intermediaria: string | null;
  cotacao_ref: number;
  cotacao_final: number;
  // Etapas de pagamento (substitui prazo_pagamento/parcelas_entrega da revenda): estado completo por save.
  etapas: EtapaDraft[];
  // Data da Nota de Entrada (spec 2026-09-24): no Importado SÓ registro (vencimentos = etapas de câmbio).
  data_nota_entrada: string;
  anexo_pedido_url: string | null;
};

export function emptyCabecalho(): CabecalhoImpDraft {
  return {
    numero: "",
    empresa_id: null,
    representante_id: null,
    data_pedido: format(new Date(), "yyyy-MM-dd"),
    data_prevista: "",
    moeda_compra: "RMB",
    moeda_intermediaria: "USD",
    cotacao_ref: 0,
    cotacao_final: 0,
    etapas: [],
    data_nota_entrada: "",
    anexo_pedido_url: null,
  };
}

/** Redistribui qtd_total entre as variantes pelo peso de cada uma (maior resto) — espelha
 *  `_split_maior_resto` do banco (mesmo helper usado pela OC P. Acabado). */
export function redistribuirVariantesPorPeso(variantes: VarianteDraft[], qtdTotal: number): VarianteDraft[] {
  const pesos = Object.fromEntries(variantes.map((v) => [String(v.ordem), v.peso]));
  const split = splitMaiorResto(qtdTotal, pesos);
  return variantes.map((v) => ({ ...v, qtd: split[String(v.ordem)] ?? 0 }));
}

/** Soma de uma célula da grade num campo específico, por todas as chaves de tamanho. */
export function somaGrade(grade: GradeDetalhe, tamanhos: string[], campo: keyof CelulaGrade): number {
  let s = 0;
  for (const linha of Object.values(grade)) {
    for (const t of tamanhos) s += Number(linha?.[t]?.[campo] ?? 0);
  }
  return s;
}

/** Σ% de uma base (mercadoria/frete) nas etapas — espelha `somaPercentualPorBase`
 *  (produto-importado/shared.ts) e a validação do servidor (`_salvar_oc_importado_itens_core`). */
export function somaPercentualPorBase(etapas: EtapaDraft[], base: "mercadoria" | "frete"): number {
  return etapas.filter((e) => e.base === base).reduce((s, e) => s + (Number(e.percentual) || 0), 0);
}

/** Aplica a proporção de peso (grade_proporcao) sobre a qtd de UMA variante, célula "pedida" —
 *  MERGE POR CÉLULA (nunca replace de linha, mesmo cuidado documentado em oc-p-acabado/shared.ts):
 *  só as size-keys ATIVAS da proporção têm `pedida` recalculada; `recebida`/`defeito` de TODAS
 *  as células são PRESERVADOS intocados. Acessório: uma única chave "UN" = a qtd inteira. */
export function redistribuirPedida(
  variantes: VarianteDraft[],
  grade: GradeDetalhe,
  grade_proporcao: Record<string, number>,
  acessorio: boolean,
): GradeDetalhe {
  const next: GradeDetalhe = { ...grade };
  for (const v of variantes) {
    const key = String(v.ordem);
    const split = acessorio ? { [TAM_ACESSORIO]: v.qtd } : splitMaiorResto(v.qtd, grade_proporcao);
    const linha: Record<string, CelulaGrade> = { ...(next[key] ?? {}) };
    for (const [tam, pedida] of Object.entries(split)) {
      const atual = linha[tam] ?? { pedida: 0, recebida: 0, defeito: 0 };
      linha[tam] = { ...atual, pedida };
    }
    next[key] = linha;
  }
  return next;
}
