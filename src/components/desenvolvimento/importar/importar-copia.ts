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
  return { patch, campos };
}
