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

export function recomputeAviamento(
  r: AviamentoRow,
  aviamentoMap: Record<string, { preco?: number | null }>,
): AviamentoRow {
  const preco = r.aviamento_id ? Number(aviamentoMap[r.aviamento_id]?.preco ?? 0) : 0;
  const custo = preco * (r.consumo || 0) * (1 + (r.loss_percent || 0) / 100);
  return { ...r, custo_previsto: Math.round(custo * 100) / 100 };
}
