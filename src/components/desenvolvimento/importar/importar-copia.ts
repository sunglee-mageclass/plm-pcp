import { makeEmptyBlocks, type TecidoBlock, type AviamentoRow, type GradeRow, type ModeloEtiquetaRow } from "@/components/desenvolvimento/modelo-detail/types";

export type ModeloParaCopia = {
  observacoes_tecnicas: string;
  custos_adicionais: { descricao: string; valor: number }[];
  proporcoes: Record<string, number>;
  blocks: TecidoBlock[];
  aviamentos: AviamentoRow[];
  etiquetas: ModeloEtiquetaRow[];
  grades: GradeRow[];
};

export type ItemTecido = { artigo: boolean; consumo: boolean; variantes: boolean };
export type Selecao = {
  obsTecnica: boolean;
  tecidos: Record<TecidoBlock["tipo"], ItemTecido>;
  aviamentos: boolean;
  etiquetas: boolean;
  grade: boolean;
  custosAdicionais: boolean;
};
export type PatchCopia = {
  observacoes_tecnicas?: string;
  custos_adicionais?: { descricao: string; valor: number }[];
  proporcoes?: Record<string, number>;
  blocks?: TecidoBlock[];
  aviamentos?: AviamentoRow[];
  etiquetas?: ModeloEtiquetaRow[];
  grades?: GradeRow[];
};
export type ResultadoCopia = { patch: PatchCopia; campos: Set<string> };

export function gradeAplicavel(sel: Selecao): boolean {
  return (Object.keys(sel.tecidos) as TecidoBlock["tipo"][]).some((t) => sel.tecidos[t].variantes);
}

export function construirCopia(origem: ModeloParaCopia, _destinoBlocks: TecidoBlock[], sel: Selecao): ResultadoCopia {
  const patch: PatchCopia = {};
  const campos = new Set<string>();
  if (sel.obsTecnica) { patch.observacoes_tecnicas = origem.observacoes_tecnicas; campos.add("obs_tecnicas"); }
  if (sel.custosAdicionais) { patch.custos_adicionais = origem.custos_adicionais.map((c) => ({ ...c })); campos.add("custos_adicionais"); }
  if (sel.aviamentos) {
    patch.aviamentos = origem.aviamentos.map((r) => ({ aviamento_id: r.aviamento_id, consumo: r.consumo, loss_percent: r.loss_percent, custo_previsto: r.custo_previsto }));
    campos.add("aviamentos");
  }
  if (sel.etiquetas) {
    patch.etiquetas = origem.etiquetas.map((r) => ({ etiqueta_id: r.etiqueta_id, cor_id: r.cor_id, consumo: r.consumo, loss_percent: r.loss_percent, custo_previsto: r.custo_previsto }));
    campos.add("etiquetas");
  }
  if (sel.grade && gradeAplicavel(sel)) {
    patch.grades = origem.grades.map((g) => ({ variante_numero: g.variante_numero, grades: { ...g.grades }, grade_total: g.grade_total }));
    patch.proporcoes = { ...origem.proporcoes };
    campos.add("grade");
    campos.add("proporcoes");
  }
  return { patch, campos };
}
