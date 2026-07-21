import { makeEmptyBlocks, type TecidoBlock, type AviamentoRow, type GradeRow, type ModeloEtiquetaRow } from "@/components/desenvolvimento/modelo-detail/types";

export type ModeloParaCopia = {
  observacoes_tecnicas: string;
  custos_adicionais: { descricao: string; valor: number }[];
  proporcoes: Record<string, number>;
  blocks: TecidoBlock[];
  aviamentos: AviamentoRow[];
  etiquetas: ModeloEtiquetaRow[];
  grades: GradeRow[];
  obsBlocoLinhas: { ordem: number | null; descricao: string | null; observacao: string | null }[];
};

export type ItemTecido = { artigo: boolean; consumo: boolean; variantes: boolean };
export type Selecao = {
  obsTecnica: boolean;
  tecidos: Record<TecidoBlock["tipo"], ItemTecido>;
  aviamentos: boolean;
  etiquetas: boolean;
  grade: boolean;
  custosAdicionais: boolean;
  obsBloco: boolean;
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
  }
  const tipos = Object.keys(sel.tecidos) as TecidoBlock["tipo"][];
  const algumTecido = tipos.some((t) => sel.tecidos[t].artigo || sel.tecidos[t].consumo || sel.tecidos[t].variantes);
  if (algumTecido) {
    const blocks = _destinoBlocks.map((b) => ({ ...b, variantes: [...b.variantes], multiplicadores: [...b.multiplicadores], oc_links: b.oc_links.map((l) => [...l]), artigoIdsExtra: [...b.artigoIdsExtra] }));
    for (const tipo of tipos) {
      const item = sel.tecidos[tipo];
      if (!item.artigo && !item.consumo && !item.variantes) continue;
      for (const orig of origem.blocks.filter((b) => b.tipo === tipo)) {
        const dest = blocks.find((b) => b.tipo === tipo && b.numero === orig.numero);
        if (!dest) continue;
        if (item.artigo) { dest.artigo_id = orig.artigo_id; dest.artigoIdsExtra = [...orig.artigoIdsExtra]; campos.add(`tecido:${tipo}:${orig.numero}:artigo`); }
        if (item.consumo) { dest.consumo = orig.consumo; dest.loss_percent = orig.loss_percent; campos.add(`tecido:${tipo}:${orig.numero}:consumo`); }
        if (item.variantes) {
          dest.variantes = [...orig.variantes];
          dest.multiplicadores = [...orig.multiplicadores];
          dest.oc_links = Array.from({ length: dest.variantes.length }, () => []); // sem OC-links
          campos.add(`tecido:${tipo}:${orig.numero}:variantes`);
        }
      }
    }
    patch.blocks = blocks;
  }
  return { patch, campos };
}
