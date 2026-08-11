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
  // Refino onda 2, item 1: campo EDITÁVEL — a trigger `fn_oc_p_acabado_numero` só gera
  // quando vazio (`new.numero is null or ''`); "" aqui vira NULL no payload (auto-gera
  // ao criar / mantém o valor atual ao editar), preenchido bypassa a geração.
  numero: string;
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
    numero: "",
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

/** Nº de parcelas a pagar DERIVADO do prazo de pagamento digitado — espelha
 *  BYTE-A-BYTE o parsing do trigger `gerar_parcelas_oc_p_acabado` (banco):
 *    `unnest(string_to_array(coalesce(prazo_pagamento,'30'), '/')) where t ~ '^[0-9]+$'`
 *  — separa só por "/", SEM trim (um token com espaço, ex. " 60", falha o regex ancorado
 *  igual no banco — NÃO tolerar espaço aqui seria uma divergência silenciosa do preview),
 *  cai em 1 quando nenhum token válido (mesmo fallback `array[30]` do trigger) e limita a
 *  24 (`least(array_length,24)`). Refino onda 2, item 2 — mostra a contagem ao lado do
 *  campo "Prazo de pagamento" (mesmo formato da OC Tecido, que deriva `quantidade_
 *  prazos`), mas com o parser PRÓPRIO da OC P. Acabado (o trigger daqui só reconhece "/"
 *  como separador — não vírgula/traço/espaço como o de tecido). */
export function contarParcelasPrazo(prazoPagamento: string): number {
  const tokens = (prazoPagamento ?? "").split("/").filter((t) => /^[0-9]+$/.test(t));
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
