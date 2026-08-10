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

export type OcPaRow = {
  id: string;
  numero: string | null;
  nome_produto: string;
  produto_acabado_id: string | null;
  empresa_id: string | null;
  data_pedido: string | null;
  data_prevista: string | null;
  data_entrega: string | null;
  qtd_total: number | null;
  valor_total_desconto: number | null;
  status: OcPaStatus;
};

export type Draft = {
  nome_produto: string;
  produto_acabado_id: string | null;
  grupo_id: string | null;
  categoria_id: string | null;
  subcategoria1_id: string | null;
  subcategoria2_id: string | null;
  empresa_id: string | null;
  representante_id: string | null;
  ref_fornecedor: string;
  composicao: string;
  data_pedido: string;
  data_prevista: string;
  prazo_pagamento: string;
  parcelas_entrega: number;
  grade_proporcao: Record<string, number>;
  variantes: VarianteDraft[];
  qtd_total: number;
  valor_unitario: number;
  desconto_pct: number;
  // Recebimento (seção 4 — locked até salvar).
  data_entrega: string;
  nota_fiscal: string;
  responsavel_recebimento_id: string | null;
  devolucao: string;
  revisao: string;
  anexo_pedido_url: string | null;
  anexo_nf_url: string | null;
};

export function emptyDraft(): Draft {
  return {
    nome_produto: "",
    produto_acabado_id: null,
    grupo_id: null,
    categoria_id: null,
    subcategoria1_id: null,
    subcategoria2_id: null,
    empresa_id: null,
    representante_id: null,
    ref_fornecedor: "",
    composicao: "",
    data_pedido: format(new Date(), "yyyy-MM-dd"),
    data_prevista: "",
    prazo_pagamento: "30",
    parcelas_entrega: 1,
    grade_proporcao: {},
    variantes: [],
    qtd_total: 0,
    valor_unitario: 0,
    desconto_pct: 0,
    data_entrega: "",
    nota_fiscal: "",
    responsavel_recebimento_id: null,
    devolucao: "",
    revisao: "",
    anexo_pedido_url: null,
    anexo_nf_url: null,
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

/** Soma de uma célula da grade num campo específico, por todas as chaves de tamanho. */
export function somaGrade(grade: GradeDetalhe, tamanhos: string[], campo: keyof CelulaGrade): number {
  let s = 0;
  for (const linha of Object.values(grade)) {
    for (const t of tamanhos) s += Number(linha?.[t]?.[campo] ?? 0);
  }
  return s;
}

/** Aplica a proporção de peso (grade_proporcao) sobre a qtd de UMA variante, célula "pedida" —
 *  espelha `_pa_grade_variante`/`_split_maior_resto` do banco (maior resto), sem tocar
 *  recebida/defeito já digitados. Acessório: uma única chave "UN" = a qtd inteira. */
export function redistribuirPedida(
  variantes: VarianteDraft[],
  grade: GradeDetalhe,
  grade_proporcao: Record<string, number>,
  acessorio: boolean,
): GradeDetalhe {
  const next: GradeDetalhe = {};
  for (const v of variantes) {
    const key = String(v.ordem);
    const split = acessorio ? { [TAM_ACESSORIO]: v.qtd } : splitMaiorResto(v.qtd, grade_proporcao);
    const linhaAtual = grade[key] ?? {};
    const linha: Record<string, CelulaGrade> = {};
    for (const [tam, pedida] of Object.entries(split)) {
      const atual = linhaAtual[tam] ?? { pedida: 0, recebida: 0, defeito: 0 };
      linha[tam] = { ...atual, pedida };
    }
    next[key] = linha;
  }
  return next;
}
