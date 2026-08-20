export const BUCKET = "modelos";

export type Opt = { id: string; nome: string };

/** Alocação de uma OC para uma variante (várias OCs podem cobrir uma variante). */
export type OcAlloc = { oc_tecido_item_id: string; quantidade_m: number; prioridade: number };

export type TecidoBlock = {
  id?: string;
  tipo: "tecido" | "forro" | "entretela";
  numero: number;
  artigo_id: string | null;
  /**
   * Artigos substitutos além do principal. Um tecido/forro pode ser feito de
   * mais de um artigo (quando um acaba, usa-se outro). As variantes podem vir
   * de qualquer um deles. Para tecido o conjunto vem dos tecidos planejados;
   * para forro é definido aqui no bloco. Derivado das variantes ao carregar.
   */
  artigoIdsExtra: string[];
  consumo: number;
  loss_percent: number;
  custo_previsto: number;
  variantes: (string | null)[];
  /**
   * Multiplicador de cobertura por variante (0..9), default 1. Em materiais
   * complementares (Tecido 2/3, Forro, Entretela), 1 variante pode atender N
   * cores: peças = grade(posição) × multiplicador. No Tecido 1 é sempre 1.
   */
  multiplicadores: number[];
  /** Por posição de variante (0..9): lista de OCs alocadas a ela. */
  oc_links: OcAlloc[][];
};

export type AviamentoRow = {
  id?: string;
  aviamento_id: string | null;
  /** Variante (cor base + apelido) escolhida do aviamento. Opcional — aviamento sem
   *  variantes fica null. Persistida em modelo_aviamentos.variante_aviamento_id (item 2). */
  variante_aviamento_id?: string | null;
  consumo: number;
  loss_percent: number;
  custo_previsto: number;
};

export type GradeRow = {
  variante_numero: number;
  grades: Record<string, number>;
  grade_total: number;
};

export const TIPOS: TecidoBlock["tipo"][] = ["tecido", "forro", "entretela"];

export const TIPO_LABEL: Record<TecidoBlock["tipo"], string> = {
  tecido: "Tecido",
  forro: "Forro",
  entretela: "Entretela",
};

export const STATUS_DESENV_OPTS = [
  { value: "novo", label: "Novo" },
  { value: "desenho_tecnico", label: "Desenho Técnico" },
  { value: "modelagem", label: "Modelagem" },
  { value: "piloto", label: "Piloto" },
  { value: "aprovado", label: "Aprovado" },
  { value: "reprovado", label: "Reprovado" },
];

export function makeEmptyBlocks(): TecidoBlock[] {
  const arr: TecidoBlock[] = [];
  TIPOS.forEach((t) => {
    for (let n = 1; n <= 3; n++) {
      arr.push({
        tipo: t,
        numero: n,
        artigo_id: null,
        artigoIdsExtra: [],
        consumo: 0,
        loss_percent: 0,
        custo_previsto: 0,
        variantes: Array(10).fill(null),
        multiplicadores: Array(10).fill(1),
        oc_links: Array.from({ length: 10 }, () => [] as OcAlloc[]),
      });
    }
  });
  return arr;
}

export function recomputeBlock(
  b: TecidoBlock,
  artigoMap: Record<string, { preco?: number | null; preco_por_metro?: number | null }>,
  varianteArtigoMap?: Record<string, string>,
  frozenPrecos?: Record<string, number>,
): TecidoBlock {
  // Consumo é sempre em metros; para tecido em kg o preço por metro é
  // preco_por_metro (= preco / rendimento). Usa-se preco_por_metro — igual ao
  // CAD — caindo para preco apenas quando ausente, evitando custo inflado.
  //
  // Um tecido/forro pode usar mais de um artigo (substitutos). Quando há
  // variantes de vários artigos, o custo usa o MAIOR preco_por_metro entre os
  // artigos efetivamente usados (cai para o artigo principal se nenhuma variante).
  const precoOf = (id: string) => {
    const a = artigoMap[id];
    return a ? Number(a.preco_por_metro ?? a.preco ?? 0) : 0;
  };
  const usados = new Set<string>();
  if (varianteArtigoMap) {
    for (const v of b.variantes) {
      const aid = v ? varianteArtigoMap[v] : undefined;
      if (aid) usados.add(aid);
    }
  }
  if (usados.size === 0 && b.artigo_id) usados.add(b.artigo_id);
  const artigoPreco = usados.size > 0 ? Math.max(...Array.from(usados).map(precoOf)) : 0;
  // Fase B: se há OC vinculada no Desenvolvimento p/ este tecido, o preço vem dela
  // (congela o custo — não segue mudança futura de preço do artigo). Senão, o do artigo.
  const frozen = frozenPrecos?.[`${b.tipo}|${b.numero}`];
  const preco = frozen != null ? Number(frozen) : artigoPreco;
  const custo = preco * (b.consumo || 0) * (1 + (b.loss_percent || 0) / 100);
  return { ...b, custo_previsto: Math.round(custo * 100) / 100 };
}

/**
 * Remove APENAS a variante na posição `vIdx` de um bloco, deslocando as
 * posteriores uma posição para cima (splice) — NÃO cascateia (não zera as
 * seguintes). Mantém o array com o mesmo comprimento (cauda preenchida com
 * null / 1 / []), pois `variantes`/`multiplicadores`/`oc_links` são acoplados
 * POR POSIÇÃO (a posição vira `modelo_tecido_variantes.ordem`) e o render exige
 * contiguidade (uma posição vazia no meio esconderia as seguintes — a raiz do
 * bug do "remover a variante do meio some com as posteriores").
 */
export function removerVarianteDoBloco(b: TecidoBlock, vIdx: number): TecidoBlock {
  const len = b.variantes.length;
  const variantes = [...b.variantes];
  const multiplicadores = [...(b.multiplicadores ?? [])];
  while (multiplicadores.length < len) multiplicadores.push(1);
  const oc_links = (b.oc_links ?? []).map((a) => [...(a ?? [])]);
  while (oc_links.length < len) oc_links.push([]);
  variantes.splice(vIdx, 1); variantes.push(null);
  multiplicadores.splice(vIdx, 1); multiplicadores.push(1);
  oc_links.splice(vIdx, 1); oc_links.push([]);
  return { ...b, variantes, multiplicadores, oc_links };
}

/**
 * Remapeia `modelo_grades` após remover a variante de número `numeroRemovido`
 * (1-based, = posição+1 no Tecido 1): descarta a grade dessa variante e
 * DECREMENTA o `variante_numero` das de número maior, para que a grade SIGA a
 * variante (a grade da antiga v3 vira v2), casando com a renumeração do bloco.
 */
export function remapGradesAposRemocao(grades: GradeRow[], numeroRemovido: number): GradeRow[] {
  return grades
    .filter((g) => g.variante_numero !== numeroRemovido)
    .map((g) => (g.variante_numero > numeroRemovido ? { ...g, variante_numero: g.variante_numero - 1 } : g))
    .sort((a, b) => a.variante_numero - b.variante_numero);
}

export function recomputeAviamento(
  r: AviamentoRow,
  aviamentoMap: Record<string, { preco?: number | null }>,
): AviamentoRow {
  const preco = r.aviamento_id ? Number(aviamentoMap[r.aviamento_id]?.preco ?? 0) : 0;
  const custo = preco * (r.consumo || 0) * (1 + (r.loss_percent || 0) / 100);
  return { ...r, custo_previsto: Math.round(custo * 100) / 100 };
}

// ── Etiquetas no BOM do modelo (escolhe etiqueta + cor; tamanho explode no CAD) ──
export type EtiquetaVarInfo = { cor_id: string | null; cor_nome: string | null; preco: number | null };
export type EtiquetaInfo = { id: string; nome: string; formato_tamanho: string; preco: number | null; variantes: EtiquetaVarInfo[] };

export type ModeloEtiquetaRow = {
  id?: string;
  etiqueta_id: string | null;
  cor_id: string | null;
  consumo: number;
  loss_percent: number;
  custo_previsto: number;
};

/** Preço da etiqueta na cor escolhida: MAX das variantes daquela cor; senão o preço base. */
export function precoEtiquetaCor(etq: EtiquetaInfo | undefined, corId: string | null): number {
  if (!etq) return 0;
  const vs = (etq.variantes ?? []).filter((v) => (v.cor_id ?? null) === (corId ?? null));
  const max = vs.reduce((m, v) => Math.max(m, Number(v.preco ?? 0)), 0);
  return max > 0 ? max : Number(etq.preco ?? 0);
}

export function recomputeEtiqueta(r: ModeloEtiquetaRow, etiquetaMap: Record<string, EtiquetaInfo>): ModeloEtiquetaRow {
  const etq = r.etiqueta_id ? etiquetaMap[r.etiqueta_id] : undefined;
  const preco = precoEtiquetaCor(etq, r.cor_id);
  const custo = preco * (r.consumo || 0) * (1 + (r.loss_percent || 0) / 100);
  return { ...r, custo_previsto: Math.round(custo * 100) / 100 };
}

/** Cores distintas da etiqueta (p/ o dropdown de cor no BOM). */
export function coresDaEtiqueta(etq: EtiquetaInfo | undefined): Opt[] {
  if (!etq) return [];
  const seen = new Map<string, string>();
  for (const v of etq.variantes ?? []) if (v.cor_id) seen.set(v.cor_id, v.cor_nome ?? "—");
  return Array.from(seen.entries()).map(([id, nome]) => ({ id, nome }));
}
