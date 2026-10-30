// [urg R13 T7] O ITEM da OC de Produto Acabado (1 produto da OC, tabela `ocs_p_acabado_itens`) — lógica PURA (sem React/supabase).
//
// O produto saiu do cabeçalho: a OC tem N itens. Cada item tem seus campos de compra (nome/categoria/REF forn./composição/
// variantes/proporção/qtd/valor/desconto), a grade (`grade_detalhe`: pedida/recebida/defeito) e o recebimento DO PRODUTO.
//
// Contrato do servidor (migration 20261105100000, lido, não inventado):
//   - `salvar_oc_p_acabado_itens(_id,_dados,_itens,_rev_base)`: estado COMPLETO com diff por `id`; item sem `id` + `{produto_acabado_id,
//     do_produto:true}` = "Adicionar produto" (o servidor monta do produto); item sem `id` e sem `do_produto` = avulso digitado.
//     Item ausente = tirado. O UPDATE de um item NÃO grava os campos de recebimento (data/NF/responsável/devolução/revisão): esses
//     só entram em `receber_item_oc_p_acabado` (chaves `item_*` do `_dados`).
//   - `status` do item e do cabeçalho NÃO são do rascunho: seguem sempre o servidor.
import { cadeiaValores } from "@/lib/produto-acabado";
import { payloadDataNota } from "@/lib/nota-entrada";
import type { CabecalhoDraft, GradeDetalhe, OcPaStatus, VarianteDraft } from "./shared";
import type { ProdutoAcabadoSelecionado } from "./ProdutoAcabadoPicker";

/** Campos da célula da grade do Produto Acabado (diferente do CQ: enviada/cortada/recebida/defeito). */
export const CAMPOS_GRADE_PA = ["pedida", "recebida", "defeito"] as const;

export type ItemOcPa = {
  /** Chave estável de React: o `id` quando persistido; um temporário `novo-N` enquanto o item é novo. */
  tempId: string;
  /** Id do item no servidor (`null` = ainda não salvo). */
  id: string | null;
  /** Item PENDENTE vindo do picker "Adicionar produto": o servidor o monta do produto ao Salvar (só `{produto_acabado_id, do_produto}` vai). */
  doProduto: boolean;
  produto_acabado_id: string | null;
  nome_produto: string;
  grupo_id: string | null;
  categoria_id: string | null;
  subcategoria1_id: string | null;
  subcategoria2_id: string | null;
  ref_fornecedor: string;
  composicao: string;
  grade_proporcao: Record<string, number>;
  variantes: VarianteDraft[];
  qtd_total: number;
  valor_unitario: number;
  desconto_pct: number;
  /** `grade_detalhe` do item: {"<ordem>": {"<tam>": {pedida,recebida,defeito}}}. */
  grade: GradeDetalhe;
  /** Do servidor — só leitura (nunca vai no Salvar). */
  status: OcPaStatus;
  // Recebimento do produto (rascunho; só vai em `receber_item_oc_p_acabado`).
  data_entrega: string;
  nota_fiscal: string;
  responsavel_recebimento_id: string | null;
  devolucao: string;
  revisao: string;
  // Só exibição (do produto vinculado).
  produtoRef: string | null;
  fotoPath: string | null;
};

/** O item SEM a grade e sem o que é do servidor/exibição: é o que o `mergeLinhas` compara (a grade funde por CÉLULA à parte). */
export type ItemLinha = Omit<ItemOcPa, "grade" | "status" | "doProduto" | "produtoRef" | "fotoPath">;

let contador = 0;
export const novoTempId = (): string => `novo-${Date.now().toString(36)}-${++contador}`;

const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => Number(v) || 0;
const uuidOuNull = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

function normalizaVariantes(v: unknown): VarianteDraft[] {
  if (!Array.isArray(v)) return [];
  return v.map((x: any): VarianteDraft => ({
    ordem: num(x?.ordem),
    cor_id: uuidOuNull(x?.cor_id),
    cor_apelido_id: uuidOuNull(x?.cor_apelido_id),
    peso: num(x?.peso),
    qtd: num(x?.qtd),
  }));
}

function normalizaProporcao(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === "object") for (const [k, n] of Object.entries(v as Record<string, unknown>)) out[k] = num(n);
  return out;
}

/** Linha de `ocs_p_acabado_itens` (com o embed opcional `produto:produto_acabado_id(ref, modelo:modelo_id(fotos_modelo))`) → item do rascunho. */
export function itemDeRow(row: any): ItemOcPa {
  const id = String(row.id);
  return {
    tempId: id,
    id,
    doProduto: false,
    produto_acabado_id: uuidOuNull(row.produto_acabado_id),
    nome_produto: str(row.nome_produto),
    grupo_id: uuidOuNull(row.grupo_id),
    categoria_id: uuidOuNull(row.categoria_id),
    subcategoria1_id: uuidOuNull(row.subcategoria1_id),
    subcategoria2_id: uuidOuNull(row.subcategoria2_id),
    ref_fornecedor: str(row.ref_fornecedor),
    composicao: str(row.composicao),
    grade_proporcao: normalizaProporcao(row.grade_proporcao),
    variantes: normalizaVariantes(row.variantes),
    qtd_total: num(row.qtd_total),
    valor_unitario: num(row.valor_unitario),
    desconto_pct: num(row.desconto_pct),
    grade: (row.grade_detalhe && typeof row.grade_detalhe === "object" ? row.grade_detalhe : {}) as GradeDetalhe,
    status: row.status === "recebido" ? "recebido" : "encomendado",
    data_entrega: str(row.data_entrega),
    nota_fiscal: str(row.nota_fiscal),
    responsavel_recebimento_id: uuidOuNull(row.responsavel_recebimento_id),
    devolucao: str(row.devolucao),
    revisao: str(row.revisao),
    produtoRef: row.produto?.ref ?? null,
    fotoPath: row.produto?.modelo?.fotos_modelo?.[0] ?? null,
  };
}

/** Linhas do servidor na ordem da OC. */
export const itensDeRows = (rows: ReadonlyArray<any> | null | undefined): ItemOcPa[] =>
  [...(rows ?? [])].sort((a, b) => num(a.ordem) - num(b.ordem)).map(itemDeRow);

/** Item AVULSO em branco ("Novo pedido" sem produto do cadastro). */
export function itemAvulsoVazio(): ItemOcPa {
  return {
    tempId: novoTempId(), id: null, doProduto: false, produto_acabado_id: null, nome_produto: "",
    grupo_id: null, categoria_id: null, subcategoria1_id: null, subcategoria2_id: null,
    ref_fornecedor: "", composicao: "", grade_proporcao: {}, variantes: [], qtd_total: 0, valor_unitario: 0, desconto_pct: 0,
    grade: {}, status: "encomendado", data_entrega: "", nota_fiscal: "", responsavel_recebimento_id: null, devolucao: "", revisao: "",
    produtoRef: null, fotoPath: null,
  };
}

/** Item PENDENTE a partir do picker: mostra o que o servidor vai montar (nome/qtd/valor), mas só `{produto_acabado_id, do_produto}` é enviado. */
export function itemDoProduto(p: ProdutoAcabadoSelecionado): ItemOcPa {
  return {
    ...itemAvulsoVazio(),
    doProduto: true,
    produto_acabado_id: p.id,
    nome_produto: p.nome,
    grupo_id: p.grupo_id, categoria_id: p.categoria_id, subcategoria1_id: p.subcategoria1_id, subcategoria2_id: p.subcategoria2_id,
    ref_fornecedor: p.ref_fornecedor ?? "", composicao: p.composicao ?? "",
    grade_proporcao: p.grade_proporcao, variantes: p.variantes,
    qtd_total: p.qtd_total, valor_unitario: p.valor_unitario, desconto_pct: p.desconto_pct,
    produtoRef: p.ref, fotoPath: p.fotoPath,
  };
}

/** O que o merge compara de um item (ver `ItemLinha`). */
export function linhaDeItem(i: ItemOcPa): ItemLinha {
  return {
    tempId: i.tempId, id: i.id, produto_acabado_id: i.produto_acabado_id, nome_produto: i.nome_produto,
    grupo_id: i.grupo_id, categoria_id: i.categoria_id, subcategoria1_id: i.subcategoria1_id, subcategoria2_id: i.subcategoria2_id,
    ref_fornecedor: i.ref_fornecedor, composicao: i.composicao, grade_proporcao: i.grade_proporcao, variantes: i.variantes,
    qtd_total: i.qtd_total, valor_unitario: i.valor_unitario, desconto_pct: i.desconto_pct,
    data_entrega: i.data_entrega, nota_fiscal: i.nota_fiscal, responsavel_recebimento_id: i.responsavel_recebimento_id,
    devolucao: i.devolucao, revisao: i.revisao,
  };
}

// ── Payloads (o único lugar que monta o que vai para as RPCs) ──────────────────────────────────────────────────────

/** `_dados` do Salvar: SÓ o cabeçalho (o nº da OC é do servidor e nunca muda). `data_nota_entrada` vai SEMPRE ("" limpa). */
export function cabecalhoParaPayload(d: CabecalhoDraft): Record<string, unknown> {
  return {
    empresa_id: d.empresa_id,
    representante_id: d.representante_id,
    data_pedido: d.data_pedido || null,
    data_prevista: d.data_prevista || null,
    prazo_pagamento: d.prazo_pagamento || null,
    parcelas_entrega: d.parcelas_entrega,
    data_nota_entrada: payloadDataNota(d.data_nota_entrada),
    anexo_pedido_url: d.anexo_pedido_url,
  };
}

/** Um item no `_itens` do Salvar. Pendente do picker = só `{produto_acabado_id, do_produto:true}` (o servidor monta). */
export function itemParaPayload(i: ItemOcPa): Record<string, unknown> {
  if (i.doProduto && !i.id) return { produto_acabado_id: i.produto_acabado_id, do_produto: true };
  return {
    ...(i.id ? { id: i.id } : {}),
    produto_acabado_id: i.produto_acabado_id,
    nome_produto: i.nome_produto,
    grupo_id: i.grupo_id,
    categoria_id: i.categoria_id,
    subcategoria1_id: i.subcategoria1_id,
    subcategoria2_id: i.subcategoria2_id,
    ref_fornecedor: i.ref_fornecedor || null,
    composicao: i.composicao || null,
    grade_proporcao: i.grade_proporcao,
    variantes: i.variantes,
    qtd_total: i.qtd_total,
    valor_unitario: i.valor_unitario,
    desconto_pct: i.desconto_pct,
    grade_detalhe: i.grade,
  };
}

export const itensParaPayload = (itens: ReadonlyArray<ItemOcPa>): Record<string, unknown>[] => itens.map(itemParaPayload);

/** `_dados` do Receber: o cabeçalho + as chaves `item_*` do produto que está sendo recebido. */
export function dadosDoRecebimento(d: CabecalhoDraft, item: ItemOcPa): Record<string, unknown> {
  return {
    ...cabecalhoParaPayload(d),
    item_data_entrega: item.data_entrega || null,
    item_nota_fiscal: item.nota_fiscal || null,
    item_responsavel_recebimento_id: item.responsavel_recebimento_id,
    item_devolucao: item.devolucao || null,
    item_revisao: item.revisao || null,
  };
}

// ── Totais (mesma conta do servidor: `cadeiaValores`) ──────────────────────────────────────────────────────────────

export function totaisDoItem(i: Pick<ItemOcPa, "qtd_total" | "valor_unitario" | "desconto_pct">) {
  const { bruto, totalDesc, unitReal } = cadeiaValores(i.qtd_total, i.valor_unitario, i.desconto_pct);
  return { pecas: i.qtd_total, bruto, desconto: Math.round((bruto - totalDesc) * 100) / 100, total: totalDesc, unitReal };
}

export function totaisDaOc(itens: ReadonlyArray<Pick<ItemOcPa, "qtd_total" | "valor_unitario" | "desconto_pct">>) {
  const arred = (v: number) => Math.round(v * 100) / 100;
  let pecas = 0, bruto = 0, total = 0;
  for (const it of itens) {
    const t = totaisDoItem(it);
    pecas += t.pecas; bruto += t.bruto; total += t.total;
  }
  return { pecas, bruto: arred(bruto), desconto: arred(bruto - total), total: arred(total) };
}

/** Σ de um campo da grade do item (nas colunas de tamanho dadas). */
export function somaGradeItem(grade: GradeDetalhe, tamanhos: ReadonlyArray<string>, campo: "pedida" | "recebida" | "defeito"): number {
  let s = 0;
  for (const linha of Object.values(grade)) for (const t of tamanhos) s += Number(linha?.[t]?.[campo] ?? 0);
  return s;
}

// ── Rastreio do que EU editei (colaboração) ────────────────────────────────────────────────────────────────────────

export const pathCelulaItem = (id: string, ordem: string, tam: string, campo: string): string => `item:${id}:grade:${ordem}:${tam}:${campo}`;

/** Células de grade que mudaram entre `prev` e `next` (só itens já salvos — item novo não tem o que fundir). */
export function celulasTocadas(prev: ReadonlyArray<ItemOcPa>, next: ReadonlyArray<ItemOcPa>): string[] {
  const out: string[] = [];
  const antes = new Map(prev.filter((i) => i.id).map((i) => [i.id as string, i]));
  for (const n of next) {
    if (!n.id) continue;
    const p = antes.get(n.id);
    const ordens = new Set([...Object.keys(p?.grade ?? {}), ...Object.keys(n.grade)]);
    for (const ordem of ordens) {
      const tams = new Set([...Object.keys(p?.grade?.[ordem] ?? {}), ...Object.keys(n.grade[ordem] ?? {})]);
      for (const tam of tams) {
        for (const campo of CAMPOS_GRADE_PA) {
          const a = Number(p?.grade?.[ordem]?.[tam]?.[campo] ?? 0);
          const b = Number(n.grade[ordem]?.[tam]?.[campo] ?? 0);
          if (a !== b) out.push(pathCelulaItem(n.id, ordem, tam, campo));
        }
      }
    }
  }
  return out;
}

/** Itens (por id) cuja LINHA mudou, e ids REMOVIDOS (id persistido que sumiu). */
export function idsTocados(prev: ReadonlyArray<ItemOcPa>, next: ReadonlyArray<ItemOcPa>): string[] {
  const out: string[] = [];
  const antes = new Map(prev.filter((i) => i.id).map((i) => [i.id as string, i]));
  for (const n of next) {
    if (!n.id) continue;
    const p = antes.get(n.id);
    if (!p || JSON.stringify(linhaDeItem(p)) !== JSON.stringify(linhaDeItem(n))) out.push(n.id);
  }
  for (const p of prev) if (p.id && !next.some((n) => n.id === p.id)) out.push(p.id);
  return out;
}

// ── Regras de tela ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Antes de Salvar (a OC precisa de ao menos 1 produto; avulso precisa de nome). `null` = ok. */
export function erroDeItensParaSalvar(itens: ReadonlyArray<ItemOcPa>): string | null {
  if (itens.length === 0) return "Adicione ao menos um produto à OC.";
  const sem = itens.findIndex((i) => !i.doProduto && !i.nome_produto.trim());
  if (sem >= 0) return itens.length > 1 ? `Informe o nome do produto ${sem + 1}.` : "Informe o nome do produto.";
  return null;
}

/** "Marcar este produto como recebido": `null` = pode; senão o motivo (frase completa). `tamanhos` = colunas da grade do item. */
export function motivoNaoReceber(item: ItemOcPa, tamanhos: ReadonlyArray<string>): string | null {
  if (item.status === "recebido") return "Este produto já foi recebido.";
  if (!item.id || item.doProduto) return "Salve a OC para registrar o recebimento deste produto.";
  if (!item.produto_acabado_id) return "Este item não está ligado a um produto — vincule-o pelo Produto Acabado antes de receber.";
  if (!item.data_entrega) return "Preencha a data de entrega para marcar.";
  if (somaGradeItem(item.grade, tamanhos, "recebida") <= 0) return "Preencha a grade recebida para marcar.";
  return null;
}
