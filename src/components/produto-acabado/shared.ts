// Tipos + helpers puros do planejador Produto Acabado (Task 6/8, revenda).
// Espelha o padrão de src/components/oc-p-acabado/shared.ts (mesma família de telas),
// mas para a entidade `produtos_acabados` (compra + variantes, SEM grade cor×tamanho —
// isso é só da OC, ver design spec §2: "tabela de variantes ... SÓ POR COR — sem
// tamanho aqui").
import { format } from "date-fns";
import { splitMaiorResto } from "@/lib/produto-acabado";

export type Opt = { id: string; nome: string };
export type CatOpt = Opt & { grupo_id: string | null };
export type SubOpt = Opt & { categoria_id: string | null };
export type CorApelidoOpt = Opt & { cor_base_id: string | null };

export type VarianteDraft = {
  ordem: number;
  cor_id: string | null;
  cor_apelido_id: string | null;
  peso: number;
  qtd: number;
};

export type CelulaGradeOc = { pedida: number; recebida: number; defeito: number };
export type GradeDetalheOc = Record<string, Record<string, CelulaGradeOc>>;

export type OcVinculadaInfo = {
  id: string;
  numero: string | null;
  status: "encomendado" | "recebido";
  qtd_total: number;
  valor_unitario_real: number;
  grade_detalhe: GradeDetalheOc;
};

export type ProdutoDraft = {
  id: string;
  nome: string;
  ref: string | null;
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
  composicao: string;
  grade_proporcao: Record<string, number>;
  qtd_total: number;
  valor_unitario: number;
  desconto_pct: number;
  insumos_total: number;
  modelo_id: string | null;
  variantes: VarianteDraft[];
  // Enriquecimento read-only (embeds) — nunca editados aqui:
  modeloPrecoVenda: number | null;
  modeloPrecoAtacado: number | null;
  modeloLinhaId: string | null;
  oc: OcVinculadaInfo | null;
};

/** Σ peças = Σ qtd de todas as variantes do produto. */
export function somaPecas(p: Pick<ProdutoDraft, "variantes">): number {
  return p.variantes.reduce((s, v) => s + (Number(v.qtd) || 0), 0);
}

/** Só os campos que a TELA edita (Compra & variantes) — usado como snapshot do dirty-guard,
 *  pra não disparar "não salvo" por causa de dado read-only que muda no refetch. */
export function chaveDirty(p: ProdutoDraft) {
  return {
    id: p.id,
    empresa_id: p.empresa_id,
    representante_id: p.representante_id,
    ref_fornecedor: p.ref_fornecedor,
    composicao: p.composicao,
    grade_proporcao: p.grade_proporcao,
    qtd_total: p.qtd_total,
    valor_unitario: p.valor_unitario,
    desconto_pct: p.desconto_pct,
    variantes: p.variantes,
  };
}

/** Redistribui qtd_total entre as variantes pelo peso de cada uma (maior resto) —
 *  espelha `redistribuir=true` de `salvar_produto_acabado`, calculado no cliente pra
 *  preview imediato (o usuário ainda precisa Salvar pra persistir). */
export function redistribuirVariantesPorPeso(variantes: VarianteDraft[], qtdTotal: number): VarianteDraft[] {
  const pesos = Object.fromEntries(variantes.map((v) => [String(v.ordem), v.peso]));
  const split = splitMaiorResto(qtdTotal, pesos);
  return variantes.map((v) => ({ ...v, qtd: split[String(v.ordem)] ?? 0 }));
}

/** Monta a grade_detalhe "pedida" de uma OC nova a partir das variantes do produto (Fazer
 *  pedido) — espelha `_pa_grade_variante`/`_split_maior_resto` do banco. Acessório = célula
 *  única "UN"; senão, cada variante é destrinchada pela proporção de tamanho do produto. */
export function gradePedidaDeVariantes(
  variantes: VarianteDraft[],
  gradeProporcao: Record<string, number>,
  acessorio: boolean,
): GradeDetalheOc {
  const out: GradeDetalheOc = {};
  for (const v of variantes) {
    const split = acessorio ? { UN: v.qtd } : splitMaiorResto(v.qtd, gradeProporcao);
    const linha: Record<string, CelulaGradeOc> = {};
    for (const [tam, pedida] of Object.entries(split)) linha[tam] = { pedida: Number(pedida) || 0, recebida: 0, defeito: 0 };
    out[String(v.ordem)] = linha;
  }
  return out;
}

/** Soma de um campo (pedida/recebida/defeito) através de toda a grade_detalhe de uma OC. */
export function somaGradeCampo(grade: GradeDetalheOc | null | undefined, campo: keyof CelulaGradeOc): number {
  if (!grade) return 0;
  let s = 0;
  for (const linha of Object.values(grade)) for (const cel of Object.values(linha)) s += Number(cel?.[campo] ?? 0);
  return s;
}

export function hojeISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function fmtMoney(v: number | null | undefined): string {
  const n = Number(v) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
