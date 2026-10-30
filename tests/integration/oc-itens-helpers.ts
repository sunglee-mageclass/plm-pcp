/**
 * Helpers de teste para montar/salvar/receber uma OC de Produto Acabado (PA) ou Importado (PI) pelo contrato da R13
 * (OC por fornecedor com VARIOS produtos, cada um num ITEM em `ocs_p_acabado_itens` / `ocs_importado_itens`).
 *
 * Por que existe: ate a R13 o cabecalho da OC guardava UM produto (nome, valores, grade...) e os testes chamavam
 * `salvar_oc_p_acabado(id, dados_planos, grade)` / `receber_oc_p_acabado(...)`. A R13 RECUSA esses escritores de proposito
 * (`versao_antiga`). Estes helpers recebem o mesmo payload "plano" das fixtures antigas e o separam como o contrato novo manda:
 *   - chaves do CABECALHO (fornecedor, datas, prazo, Nota de Entrada, anexo; PI: moeda/cotacoes) -> `_dados`;
 *   - o resto (nome, produto, qtd, valores, desconto, grade...) -> o ITEM, enviado em `_itens` (ESTADO COMPLETO por save).
 * A intencao dos testes (prazo, parcelas, Nota, complemento, congelar preco...) e a mesma; muda so COMO a OC e montada.
 *
 * Todo save passa pelas RPCs REAIS novas: `salvar_oc_*_itens` e `receber_item_oc_*` (nada de INSERT cru nas tabelas de itens,
 * que o cliente nem escreve). OC de 1 item (o caso dos testes antigos): edicao = sobrepoe o patch no estado ATUAL do item.
 */
import { um } from "./db";

/** Chaves que moram no CABECALHO da OC de Produto Acabado (o resto do payload plano antigo e do item). */
export const CAB_PA = [
  "empresa_id", "representante_id", "data_pedido", "data_prevista", "prazo_pagamento", "parcelas_entrega", "data_nota_entrada",
  "anexo_pedido_url",
] as const;
/** Idem, OC de Produto Importado (as etapas de cambio vao em `_etapas`, nao aqui). */
export const CAB_PI = [
  "empresa_id", "representante_id", "data_pedido", "data_prevista", "data_nota_entrada", "anexo_pedido_url", "moeda_compra",
  "moeda_intermediaria", "cotacao_ref", "cotacao_final",
] as const;

/** Campos de RECEBIMENTO do item (plano antigo -> `item_*` do `_dados` de `receber_item_oc_*`). */
const RECEB: Record<string, string> = {
  data_entrega: "item_data_entrega",
  nota_fiscal: "item_nota_fiscal",
  responsavel_recebimento_id: "item_responsavel_recebimento_id",
  devolucao: "item_devolucao",
  revisao: "item_revisao",
};

/** Colunas do item que a tela devolve no ESTADO COMPLETO (o servidor re-deriva bruto/desconto/real). */
const ITEM_COLS_PA = [
  "id", "produto_acabado_id", "nome_produto", "grupo_id", "categoria_id", "subcategoria1_id", "subcategoria2_id", "ref_fornecedor",
  "composicao", "grade_proporcao", "grade_detalhe", "variantes", "qtd_total", "valor_unitario", "desconto_pct",
];
const ITEM_COLS_PI = [
  "id", "produto_importado_id", "nome_produto", "grupo_id", "categoria_id", "subcategoria1_id", "subcategoria2_id", "ref_fornecedor",
  "composicao", "grade_proporcao", "grade_detalhe", "variantes", "qtd_total", "valor_unitario_m1", "peso_kg", "transporte_m2",
  "desconto_pct",
];

type Fam = "pa" | "pi";
const CFG = {
  pa: { oc: "ocs_p_acabado", itens: "ocs_p_acabado_itens", cab: CAB_PA as readonly string[], cols: ITEM_COLS_PA },
  pi: { oc: "ocs_importado", itens: "ocs_importado_itens", cab: CAB_PI as readonly string[], cols: ITEM_COLS_PI },
};

function separar(dados: Record<string, any>, cab: readonly string[]) {
  const c: Record<string, any> = {};
  const item: Record<string, any> = {};
  const receb: Record<string, any> = {};
  for (const [k, v] of Object.entries(dados ?? {})) {
    if (k === "numero") { c.numero = v; continue; } // P-382: o nº da OC e gerado por padrao, mas EDITAVEL (vem no `_dados`)
    if (cab.includes(k)) c[k] = v;
    else if (k in RECEB) receb[RECEB[k]] = v;
    else item[k] = v;
  }
  return { cab: c, item, receb };
}

/** Cabecalho atual da OC no formato do `_dados` (datas em texto YYYY-MM-DD). */
async function cabecalhoAtual(c: any, fam: Fam, ocId: string): Promise<Record<string, any>> {
  const cfg = CFG[fam];
  const sel = cfg.cab
    .map((k) => (k.startsWith("data_") ? `${k}::text as ${k}` : k))
    .join(", ");
  const r = await c.query(`select ${sel} from ${cfg.oc} where id = $1`, [ocId]);
  return { ...(r.rows[0] ?? {}) };
}

/** Estado COMPLETO dos itens da OC (ordem), no formato que `salvar_oc_*_itens` espera. */
export async function itensEstado(c: any, fam: Fam, ocId: string): Promise<Array<Record<string, any>>> {
  const cfg = CFG[fam];
  const r = await c.query(`select ${cfg.cols.join(", ")} from ${cfg.itens} where oc_id = $1 order by ordem`, [ocId]);
  return r.rows.map((row: any) => ({ ...row }));
}

async function itemUnico(c: any, fam: Fam, ocId: string, itemId?: string) {
  const itens = await itensEstado(c, fam, ocId);
  if (itemId) return { itens, alvo: itens.find((i) => i.id === itemId)! };
  if (itens.length !== 1) throw new Error(`helper: OC ${ocId} tem ${itens.length} itens — informe o itemId`);
  return { itens, alvo: itens[0] };
}

// ───────────────────────────────── Produto Acabado ─────────────────────────────────

/**
 * Cria (id=null) ou edita (id) uma OC de PA de 1 item pelo contrato novo (`salvar_oc_p_acabado_itens`).
 * `dados` e o payload plano das fixtures antigas; `grade` (quando passada, mesmo `{}`) substitui o `grade_detalhe` do item.
 * Devolve o id da OC. Em edicao sobrepoe o patch no cabecalho e no item ATUAIS (estado completo).
 */
export async function ocPaSalvar(c: any, id: string | null, dados: Record<string, any>, grade?: any, opts?: { itemId?: string; rev?: number | null }): Promise<string> {
  const { cab, item } = separar(dados, CAB_PA);
  if (grade !== undefined) item.grade_detalhe = grade;
  let header = cab;
  let itens: Array<Record<string, any>>;
  if (id) {
    header = { ...(await cabecalhoAtual(c, "pa", id)), ...cab };
    const { itens: todos, alvo } = await itemUnico(c, "pa", id, opts?.itemId);
    itens = todos.map((i) => (i.id === alvo.id ? { ...i, ...item } : i));
  } else {
    itens = [item];
  }
  const rev = opts && "rev" in opts ? opts.rev : null;
  const r = await um<{ id: string }>(
    c,
    `select public.salvar_oc_p_acabado_itens($1, $2::jsonb, $3::jsonb, $4) as id`,
    [id, JSON.stringify(header), JSON.stringify(itens), rev],
  );
  return r.id;
}

/**
 * Recebe UM item da OC de PA (`receber_item_oc_p_acabado`): salva o estado completo e recebe. `grade` = grade_detalhe do item
 * com recebida/defeito (quando omitida, vale a gravada). Devolve o jsonb da RPC ({cad_id, item_id, total_real}).
 */
export async function ocPaReceber(c: any, ocId: string, dados: Record<string, any> = {}, grade?: any, opts?: { itemId?: string }): Promise<any> {
  const { cab, item, receb } = separar(dados, CAB_PA);
  if (grade !== undefined) item.grade_detalhe = grade;
  const header = { ...(await cabecalhoAtual(c, "pa", ocId)), ...cab, ...receb };
  const { itens, alvo } = await itemUnico(c, "pa", ocId, opts?.itemId);
  const estado = itens.map((i) => (i.id === alvo.id ? { ...i, ...item } : i));
  const rev = Number((await um<any>(c, `select rev from ocs_p_acabado where id = $1`, [ocId])).rev);
  const r = await um<{ v: any }>(
    c,
    `select public.receber_item_oc_p_acabado($1, $2, $3::jsonb, $4::jsonb, $5) as v`,
    [ocId, alvo.id, JSON.stringify(header), JSON.stringify(estado), rev],
  );
  return r.v;
}

// ───────────────────────────────── Produto Importado ─────────────────────────────────

/**
 * Cria/edita uma OC de PI de 1 item pelo contrato novo (`salvar_oc_importado_itens`). `etapas` undefined/null = mantem as da
 * OC (OC nova: nenhuma); array = estado completo das etapas de cambio. Devolve o id da OC.
 */
export async function ocImpSalvar(
  c: any,
  id: string | null,
  dados: Record<string, any>,
  grade?: any,
  etapas?: any[] | null,
  opts?: { itemId?: string; rev?: number | null; omitirCab?: string[] },
): Promise<string> {
  const { cab, item } = separar(dados, CAB_PI);
  if (grade !== undefined) item.grade_detalhe = grade;
  let header = cab;
  let itens: Array<Record<string, any>>;
  if (id) {
    header = { ...(await cabecalhoAtual(c, "pi", id)), ...cab };
    // `omitirCab`: chaves que ficam FORA do `_dados` (no PI, chave ausente = MANTEM; ex.: front antigo sem a Nota de Entrada)
    for (const k of opts?.omitirCab ?? []) delete header[k];
    const { itens: todos, alvo } = await itemUnico(c, "pi", id, opts?.itemId);
    itens = todos.map((i) => (i.id === alvo.id ? { ...i, ...item } : i));
  } else {
    itens = [item];
  }
  const rev = opts && "rev" in opts ? opts.rev : null;
  const r = await um<{ id: string }>(
    c,
    `select public.salvar_oc_importado_itens($1, $2::jsonb, $3::jsonb, $4::jsonb, $5) as id`,
    [id, JSON.stringify(header), JSON.stringify(itens), etapas == null ? null : JSON.stringify(etapas), rev],
  );
  return r.id;
}

/** Recebe UM item da OC de PI (`receber_item_oc_importado`). */
export async function ocImpReceber(c: any, ocId: string, dados: Record<string, any> = {}, grade?: any, etapas?: any[] | null, opts?: { itemId?: string }): Promise<any> {
  const { cab, item, receb } = separar(dados, CAB_PI);
  if (grade !== undefined) item.grade_detalhe = grade;
  const header = { ...(await cabecalhoAtual(c, "pi", ocId)), ...cab, ...receb };
  const { itens, alvo } = await itemUnico(c, "pi", ocId, opts?.itemId);
  const estado = itens.map((i) => (i.id === alvo.id ? { ...i, ...item } : i));
  const rev = Number((await um<any>(c, `select rev from ocs_importado where id = $1`, [ocId])).rev);
  const r = await um<{ v: any }>(
    c,
    `select public.receber_item_oc_importado($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6) as v`,
    [ocId, alvo.id, JSON.stringify(header), JSON.stringify(estado), etapas == null ? null : JSON.stringify(etapas), rev],
  );
  return r.v;
}
