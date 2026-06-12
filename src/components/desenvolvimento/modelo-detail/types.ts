export const BUCKET = "modelos";

export type Opt = { id: string; nome: string };

export type TecidoBlock = {
  id?: string;
  tipo: "tecido" | "forro" | "entretela";
  numero: number;
  artigo_id: string | null;
  consumo: number;
  loss_percent: number;
  custo_previsto: number;
  variantes: (string | null)[];
  oc_links: (string | null)[];
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
        consumo: 0,
        loss_percent: 0,
        custo_previsto: 0,
        variantes: Array(10).fill(null),
      });
    }
  });
  return arr;
}

export function recomputeBlock(
  b: TecidoBlock,
  artigoMap: Record<string, { preco?: number | null }>,
): TecidoBlock {
  const preco = b.artigo_id ? Number(artigoMap[b.artigo_id]?.preco ?? 0) : 0;
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
