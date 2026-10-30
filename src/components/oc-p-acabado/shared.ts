// Tipos + helpers puros da OC P. Acabado (revenda). Espelha o padrão de
// src/components/oc-tecido/shared.ts; reexporta fmtMoney/fmtDate/uploadFile de lá em
// vez de duplicar (mesmo bucket de Storage "oc-tecido" — nenhuma migration criou um
// bucket próprio pra este módulo nas Tasks 1-4, então reaproveita o existente com um
// prefixo de path próprio, como o resto do sistema faz por `tenantPrefix()`).
import { format } from "date-fns";
import { splitMaiorResto } from "@/lib/produto-acabado";
export { fmtMoney, fmtDate, uploadFile } from "@/components/oc-tecido/shared";

export type OcPaStatus = "encomendado" | "recebido";
export type OcPaTab = OcPaStatus | "estoque";

// Tamanhos-fallback (paridade com DEFAULT_TAMANHOS de expedicao.cq.$modeloId.tsx) —
// tenant sem tenant_config.tamanhos_grade ainda cai numa grade utilizável.
export const DEFAULT_TAMANHOS = ["34|PPP", "36|PP", "38|P", "40|M", "42|G", "44|GG"];
// Size-key literal do grupo Acessórios (grade única, sem tamanho) — espelha
// `_pa_grade_variante` no banco (`{"UN": qtd}`).
export const TAM_ACESSORIO = "UN";

export type CelulaGrade = { pedida: number; recebida: number; defeito: number };
// grade_detalhe: {"<ordem>": {"<tam>": {pedida,recebida,defeito}}} — contrato "estado
// completo por save" (Tasks 2-3): quem salva manda o objeto inteiro, sem merge no banco.
export type GradeDetalhe = Record<string, Record<string, CelulaGrade>>;

export type VarianteDraft = {
  ordem: number;
  cor_id: string | null;
  cor_apelido_id: string | null;
  peso: number;
  qtd: number;
};

/** Resumo de UM produto (item) da OC, como a lista (abas) o vê — vem do embed `itens:ocs_p_acabado_itens(...)`. */
export type OcPaItemResumo = { id: string; ordem: number | null; nome_produto: string | null; status: OcPaStatus };

/** Uma linha da lista (abas Encomendadas/Recebidas). O produto saiu do cabeçalho (R13): vem dos ITENS. */
export type OcPaRow = {
  id: string;
  numero: string | null;
  empresa_id: string | null;
  data_pedido: string | null;
  data_prevista: string | null;
  data_entrega: string | null;
  data_nota_entrada?: string | null;
  qtd_total: number | null;
  valor_total_desconto: number | null;
  status: OcPaStatus;
  itens: OcPaItemResumo[];
};

/**
 * Rascunho do CABEÇALHO da OC (o que é da OC inteira). O produto saiu daqui (R13, P-355): cada produto é um ITEM
 * (`ItemOcPa`, em `./itens`). O nº da OC é gerado pelo servidor na criação e nunca muda (P-361) — só exibição.
 */
export type CabecalhoDraft = {
  numero: string;
  empresa_id: string | null;
  representante_id: string | null;
  data_pedido: string;
  data_prevista: string;
  prazo_pagamento: string;
  parcelas_entrega: number;
  // Data da Nota de Entrada (spec 2026-09-24): base do vencimento — no cabeçalho, editável mesmo com a OC recebida.
  data_nota_entrada: string;
  anexo_pedido_url: string | null;
};

export function emptyCabecalho(): CabecalhoDraft {
  return {
    numero: "",
    empresa_id: null,
    representante_id: null,
    data_pedido: format(new Date(), "yyyy-MM-dd"),
    data_prevista: "",
    prazo_pagamento: "30",
    parcelas_entrega: 1,
    data_nota_entrada: "",
    anexo_pedido_url: null,
  };
}

/** Redistribui qtd_total entre as variantes pelo peso de cada uma (maior resto) —
 *  espelha o `redistribuir=true` de `salvar_produto_acabado`, mas calculado no
 *  cliente (a RPC da OC não redistribui: recebe `variantes` prontas). */
export function redistribuirVariantesPorPeso(variantes: VarianteDraft[], qtdTotal: number): VarianteDraft[] {
  const pesos = Object.fromEntries(variantes.map((v) => [String(v.ordem), v.peso]));
  const split = splitMaiorResto(qtdTotal, pesos);
  return variantes.map((v) => ({ ...v, qtd: split[String(v.ordem)] ?? 0 }));
}

/** Nº de parcelas a pagar DERIVADO do prazo de pagamento digitado — mesma regra do banco
 *  (R10 fin #9, `regexp_split_to_table(prazo, '[^0-9]+')` + `t ~ '^[0-9]+$'`): qualquer
 *  não-dígito separa ("30/60/90", "30, 60", "30 60 90"), cai em 1 quando nenhum número
 *  (ex.: "à vista", vazio — fallback `array[30]` do trigger) e limita a 24. */
export function contarParcelasPrazo(prazoPagamento: string): number {
  const tokens = (prazoPagamento ?? "").split(/[^0-9]+/).filter((t) => /^[0-9]+$/.test(t));
  const n = tokens.length > 0 ? tokens.length : 1;
  return Math.min(n, 24);
}

/** Soma de uma célula da grade num campo específico, por todas as chaves de tamanho. */
export function somaGrade(grade: GradeDetalhe, tamanhos: string[], campo: keyof CelulaGrade): number {
  let s = 0;
  for (const linha of Object.values(grade)) {
    for (const t of tamanhos) s += Number(linha?.[t]?.[campo] ?? 0);
  }
  return s;
}

/** Aplica a proporção de peso (grade_proporcao) sobre a qtd de UMA variante, célula "pedida" —
 *  espelha `_pa_grade_variante`/`_split_maior_resto` do banco (maior resto). MERGE POR CÉLULA,
 *  nunca replace de linha (achado CRITICAL do review, fix round 1): só as size-keys ATIVAS da
 *  proporção (as que saem do split) têm `pedida` recalculada — toda célula existente FORA do
 *  split (ex.: um tamanho digitado manualmente que não está mais na proporção) e os campos
 *  `recebida`/`defeito` de TODAS as células (dentro ou fora do split) são PRESERVADOS
 *  intocados. Sem isso, "Redistribuir por peso" apagava em silêncio dado já recebido — a soma
 *  ainda batia (Σ pedida das ativas = qtd_total), então o guard do servidor não pegava, e
 *  `receber_oc_p_acabado` derivava `grades_reais` desse estado incompleto. Acessório: uma
 *  única chave "UN" = a qtd inteira (mesma regra de merge). */
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
