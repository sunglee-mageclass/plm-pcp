export type TipoTec = "tecido" | "forro" | "entretela";

export type VarianteRow = {
  id?: string;
  variante_tecido_id: string | null;
  variante_nome?: string | null;
  variante_cor?: string | null;
  ordem: number;
  quantidade_folhas: number;
  metragem_planejada: number;
  metragem_enviada: number;
};

export type TecidoRow = {
  id?: string;
  numero: number;
  tipo: TipoTec;
  artigo_id: string | null;
  consumo_cad: number;
  loss_percent_cad: number;
  custo_cad: number;
  tamanho_folha: number;
  preco: number;
  artigo_nome?: string | null;
  etiqueta_lavagem_urls?: string[];
  variantes: VarianteRow[];
};

export type GradeRow = {
  id?: string;
  variante_numero: number;
  grades_planejadas: Record<string, number>;
  grades_reais: Record<string, number>;
  grade_total_planejada: number;
  grade_total_real: number;
};

export type AviamentoRow = {
  id?: string;
  numero: number;
  aviamento_id: string | null;
  aviamento_nome?: string | null;
  consumo: number;
  grade_total: number;
  quantidade_enviar: number;
  quantidade_separar: number;
};

export function calcCusto(consumo: number, loss: number, preco: number) {
  return Number((consumo * (1 + loss / 100) * preco).toFixed(2));
}

export const cellH: React.CSSProperties = {
  border: "1px solid #999",
  padding: "4px 6px",
  textAlign: "left",
  fontWeight: 600,
};
export const cell: React.CSSProperties = { border: "1px solid #999", padding: "4px 6px" };
