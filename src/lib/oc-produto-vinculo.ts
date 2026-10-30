// [urg R13 T6] A OC vista DO PRODUTO (Produto Acabado e Produto Importado) — lógica PURA (sem React, sem supabase).
//
// O produto não é mais o "dono" da OC: ele é UM ITEM de uma OC que pode ter vários (`ocs_*_itens`). O canvas e o card leem o item do
// produto com o cabeçalho da OC e a contagem de itens num embed só (`oc_item:…`) e usam este módulo para:
//   - adaptar o embed ao `OcVinculadaInfo` (+ `nProdutos`) que os cards já consomem (continua FORA do `chaveDirty`);
//   - os textos aprovados no mockup (chip "Na OC … (com N produtos)", "divide a OC com N", "Identidade travada…");
//   - a regra de desvincular (só OC de 1 produto) e a lista de OCs candidatas ao "Vincular OC existente"
//     (encomendadas, do MESMO fornecedor — PI: e da mesma moeda — que ainda não têm o produto).
// O servidor confere tudo de novo (`vincular_oc_*`); aqui só se evita oferecer o que ele recusaria.

export type FamiliaOc = "acabado" | "importado";

// ── Embed (o nome `oc_item` é o do plano §4 F-c; as colunas de valor diferem por família) ──────────────────────────────

/** Embed do PA — texto EXATO do plano. Vai dentro do `select` de `produtos_acabados`. */
export const EMBED_OC_ITEM_PA =
  "oc_item:ocs_p_acabado_itens(id,status,qtd_total,valor_unitario_real,grade_detalhe,valor_unitario,desconto_pct, oc:ocs_p_acabado(id,numero,status,empresa_id, itens:ocs_p_acabado_itens(count)))";

/** Embed do PI — espelho do PA (o valor de compra do item é `valor_unitario_m1`). Vai dentro do `select` de `produtos_importados`. */
export const EMBED_OC_ITEM_PI =
  "oc_item:ocs_importado_itens(id,status,qtd_total,valor_unitario_real,grade_detalhe,valor_unitario_m1,desconto_pct, oc:ocs_importado(id,numero,status,empresa_id, itens:ocs_importado_itens(count)))";

type Num = number | string | null | undefined;

/** Uma linha do embed `oc_item` (ESTE produto na OC) com o cabeçalho (to-one) e a contagem de itens da OC. */
export type OcItemEmbedRow = {
  id: string;
  status: string | null;
  qtd_total?: Num;
  valor_unitario_real?: Num;
  grade_detalhe?: unknown;
  valor_unitario?: Num;
  valor_unitario_m1?: Num;
  desconto_pct?: Num;
  oc?: {
    id: string;
    numero: string | null;
    status: string | null;
    empresa_id?: string | null;
    itens?: Array<{ count: number | string | null }> | null;
  } | null;
};

export type StatusOc = "encomendado" | "recebido";
const statusDe = (s: string | null | undefined): StatusOc => (s === "recebido" ? "recebido" : "encomendado");
const n0 = (v: Num): number => Number(v) || 0;

type GradeDetalheLivre = Record<string, Record<string, { pedida: number; recebida: number; defeito: number }>>;

/** A OC vinculada, no shape que os cards usam (PA: `OcVinculadaInfo`; PI: `OcImportadoInfo`). `status` é o do ITEM (do produto);
 *  `ocStatus`, o da OC inteira. `nProdutos` = quantos produtos a OC tem. */
export type OcProdutoInfo = {
  /** id da OC (cabeçalho). */
  id: string;
  numero: string | null;
  status: StatusOc;
  ocStatus: StatusOc;
  nProdutos: number;
  qtd_total: number;
  valor_unitario_real: number;
  grade_detalhe: GradeDetalheLivre;
  /** Valor de compra e desconto do ITEM (PI: o `valor_unitario_m1`). */
  valor_unitario: number;
  desconto_pct: number;
};

/**
 * Adaptador do embed `oc_item` → info da OC do produto. No máximo 1 item por produto (gatilho de 1 OC por produto); sem item (ou
 * sem cabeçalho legível) = sem OC. Contagem ausente = 1 (o produto está na OC, então há ao menos ele).
 */
export function ocInfoDeItens(rows: ReadonlyArray<OcItemEmbedRow> | OcItemEmbedRow | null | undefined, familia: FamiliaOc): OcProdutoInfo | null {
  const lista = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const item = lista.find((r) => r?.oc);
  if (!item || !item.oc) return null;
  const c = item.oc.itens?.[0]?.count;
  const contados = Number(c);
  const nProdutos = Number.isFinite(contados) && contados >= 1 ? contados : 1;
  return {
    id: item.oc.id,
    numero: item.oc.numero ?? null,
    status: statusDe(item.status),
    ocStatus: statusDe(item.oc.status),
    nProdutos,
    qtd_total: n0(item.qtd_total),
    valor_unitario_real: n0(item.valor_unitario_real),
    grade_detalhe: (item.grade_detalhe ?? {}) as GradeDetalheLivre,
    valor_unitario: n0(familia === "importado" ? item.valor_unitario_m1 : item.valor_unitario),
    desconto_pct: n0(item.desconto_pct),
  };
}

// ── Textos (mockup R13 aprovado) ────────────────────────────────────────────────────────────────────────────────────

/** O chip do card: "Na OC BELDIV-00123 (com 3 produtos)" · OC de 1 produto: "Na OC BELDIV-00123 (1 produto)". */
export const textoChipOc = (numero: string | null | undefined, nProdutos: number): string =>
  `Na OC ${numero || "—"} (${nProdutos <= 1 ? "1 produto" : `com ${nProdutos} produtos`})`;

/** Seção 3: com quem o produto divide a OC. OC de 1 produto = sem texto. */
export const textoDivideOc = (nProdutos: number): string | null =>
  nProdutos <= 1 ? null : `Este produto divide a OC com ${nProdutos - 1} outro${nProdutos - 1 === 1 ? "" : "s"}.`;

export const TEXTO_IDENTIDADE_TRAVADA = "Identidade travada enquanto estiver na OC.";
export const TEXTO_TIRAR_DA_OC = "Para tirar da OC, abra a OC (só enquanto encomendada e se ainda não recebido).";
/** Desvincular numa OC de 2+ produtos: o servidor recusa (`oc_varios_produtos`); a tela nem oferece. */
export const TEXTO_ABRA_A_OC = "Abra a OC para tirar o produto.";
export const TEXTO_VINCULAR_SO_MESMO_FORNECEDOR = "Vincular só lista OCs encomendadas do mesmo fornecedor.";
export const TEXTO_VINCULAR_SO_MESMO_FORNECEDOR_E_MOEDA = "Vincular só lista OCs encomendadas do mesmo fornecedor e da mesma moeda.";

/** Desvincular direto (botão) só vale em OC de 1 produto — em 2+ o produto sai pela tela da OC. */
export const podeDesvincularDireto = (nProdutos: number): boolean => nProdutos <= 1;

/** Identidade (fornecedor/grupo/categoria…) do produto fica travada enquanto ele está numa OC (o nº da OC deriva dela). */
export const identidadeTravada = (oc: unknown): boolean => !!oc;

// ── "Vincular OC existente": quem aparece na lista ──────────────────────────────────────────────────────────────────────

/** Uma OC candidata, como a query do diálogo a devolve (cabeçalho + itens com o produto de cada um). */
export type OcCandidata = {
  id: string;
  numero: string | null;
  status: string | null;
  empresa_id: string | null;
  representante_id?: string | null;
  moeda_compra?: string | null;
  moeda_intermediaria?: string | null;
  itens?: Array<{ produto_acabado_id?: string | null; produto_importado_id?: string | null; nome_produto?: string | null }> | null;
};

export type ProdutoParaVincular = {
  id: string;
  empresaId: string | null;
  /** Só importado (como o servidor: sem moeda_compra = 'RMB'; intermediária vazia = nenhuma). */
  moedaCompra?: string | null;
  moedaIntermediaria?: string | null;
};

export const moedaCompraEfetiva = (m: string | null | undefined): string => (m && m.trim() ? m : "RMB");
export const moedaIntermediariaEfetiva = (m: string | null | undefined): string | null => (m && m.trim() ? m : null);

/**
 * OCs que o "Vincular OC existente" oferece para o produto: ENCOMENDADAS (OC recebida não aceita produto novo), do MESMO fornecedor
 * (empresa) e — no Importado — da MESMA moeda (compra e intermediária), que ainda NÃO têm este produto. Sem fornecedor no produto =
 * nenhuma (o servidor recusaria `fornecedor_diferente`).
 */
export function ocsParaVincular(ocs: ReadonlyArray<OcCandidata>, produto: ProdutoParaVincular, familia: FamiliaOc): OcCandidata[] {
  if (!produto.empresaId) return [];
  return ocs.filter((o) => {
    if (o.status !== "encomendado") return false;
    if (o.empresa_id !== produto.empresaId) return false;
    if (familia === "importado") {
      if (moedaCompraEfetiva(o.moeda_compra) !== moedaCompraEfetiva(produto.moedaCompra)) return false;
      if (moedaIntermediariaEfetiva(o.moeda_intermediaria) !== moedaIntermediariaEfetiva(produto.moedaIntermediaria)) return false;
    }
    const jaTem = (o.itens ?? []).some((it) => (it.produto_acabado_id ?? it.produto_importado_id) === produto.id);
    return !jaTem;
  });
}

/** "Bella Malhas" · "Bella Malhas · Rep" — o MESMO rótulo do `FornecedorSelect` (empresa direto ou via representante). */
export function nomeDoFornecedor(
  empresas: ReadonlyArray<{ id: string; nome_fantasia: string; representantes?: ReadonlyArray<{ id: string; nome: string | null }> | null }>,
  empresaId: string | null | undefined,
  representanteId: string | null | undefined,
): { fornecedorNome: string; empresaNome: string | null } {
  const e = empresas.find((x) => x.id === empresaId);
  if (!e) return { fornecedorNome: "", empresaNome: null };
  const r = representanteId ? (e.representantes ?? []).find((x) => x?.id === representanteId) : null;
  return { fornecedorNome: r ? `${e.nome_fantasia} · ${r.nome ?? "—"}` : e.nome_fantasia, empresaNome: e.nome_fantasia };
}
