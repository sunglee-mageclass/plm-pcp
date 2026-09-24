// F3.3 — "Importar dados" no Sheet unificado: regras puras portadas do Dev (ModeloDetailPanel.tsx:2329-2332 — colunas
// do modelo; :2357-2377 — o que o AlertDialog avisa que será substituído). O diálogo em si é o do Dev, reusado sem
// modificar (src/components/desenvolvimento/importar/ImportarDadosDialog.tsx). Puro — planejamento-importar-ficha.test.ts.
import type { PatchCopia } from "@/components/desenvolvimento/importar/importar-copia";
import type { AviamentoRow, GradeRow, ModeloEtiquetaRow, TecidoBlock } from "@/components/desenvolvimento/modelo-detail/types";
import type { Draft } from "@/components/planejamento/modelo-shared";
import type { PatchBlocoCad } from "./ficha-cad";

/** Colunas de `modelos` que o Importar traz para o Draft (staging — o Salvar grava). */
export function camposDoPatchNoDraft(p: PatchCopia): Partial<Pick<Draft, "observacoes_tecnicas" | "custos_adicionais" | "proporcoes">> {
  const out: Partial<Pick<Draft, "observacoes_tecnicas" | "custos_adicionais" | "proporcoes">> = {};
  if (p.observacoes_tecnicas !== undefined) out.observacoes_tecnicas = p.observacoes_tecnicas;
  if (p.custos_adicionais !== undefined) out.custos_adicionais = p.custos_adicionais;
  if (p.proporcoes !== undefined) out.proporcoes = p.proporcoes;
  return out;
}

/** O que já tem valor e será substituído (lista do AlertDialog "Sobrescrever dados existentes?"). */
export function itensSobrescritos(p: PatchCopia, atual: {
  observacoesTecnicas: string; custosAdicionais: unknown[]; proporcoes: Record<string, number>;
  blocks: TecidoBlock[]; aviamentos: AviamentoRow[]; etiquetas: ModeloEtiquetaRow[]; grades: GradeRow[];
}, obsBloco: boolean): string[] {
  const out: string[] = [];
  if (p.observacoes_tecnicas !== undefined && (atual.observacoesTecnicas ?? "").trim()) out.push("Observações técnicas");
  if (p.custos_adicionais !== undefined && (atual.custosAdicionais ?? []).length) out.push("Custos adicionais");
  if (p.proporcoes !== undefined && Object.keys(atual.proporcoes ?? {}).length > 0) out.push("Proporções");
  if (p.grades !== undefined && atual.grades.some((g) => (g.grade_total ?? 0) > 0)) out.push("Grade");
  if (p.aviamentos !== undefined && atual.aviamentos.some((a) => a.aviamento_id)) out.push("Aviamentos");
  if (p.etiquetas !== undefined && atual.etiquetas.some((e) => e.etiqueta_id)) out.push("Insumos/Etiquetas");
  if (p.blocks !== undefined) {
    for (const nb of p.blocks) {
      const old = atual.blocks.find((b) => b.tipo === nb.tipo && b.numero === nb.numero);
      if (!old) continue;
      const mudouArtigo = !!old.artigo_id && nb.artigo_id !== old.artigo_id;
      const mudouConsumo = (old.consumo ?? 0) > 0 && nb.consumo !== old.consumo;
      const mudouVar = old.variantes.some((v) => v) && JSON.stringify(nb.variantes) !== JSON.stringify(old.variantes);
      if (mudouArtigo || mudouConsumo || mudouVar) out.push(`${nb.tipo === "tecido" ? "Tecido" : nb.tipo === "forro" ? "Forro" : "Entretela"} ${nb.numero}`);
    }
  }
  if (obsBloco) out.push("Observações (bloco)");
  return out;
}

/**
 * Fix pós-rebase (item 4) — o que o Importar leva ao CAD de UM bloco, POR CAMPO marcado no diálogo (as chaves de
 * `campos` são as de `construirCopia`, importar-copia.ts ~:67-73): `:artigo` → só `artigo_id`; `:consumo` → consumo E
 * %loss (o `:consumo` do Dev copia os dois); bloco marcado SÓ em `:variantes` → `null` (sem patch: consumo/%loss/artigo
 * do CAD ficam como estão — as variantes chegam ao CAD pelo `sincronizarCadComBlocos`, que roda na mudança dos blocos).
 * Antes (b4cb4e4) qualquer um dos 3 campos empurrava os TRÊS valores ao CAD.
 */
export function patchCadDoImport(
  b: Pick<TecidoBlock, "tipo" | "numero" | "consumo" | "loss_percent" | "artigo_id">, campos: ReadonlySet<string>,
): PatchBlocoCad | null {
  const p: PatchBlocoCad = {};
  if (campos.has(`tecido:${b.tipo}:${b.numero}:artigo`)) p.artigo_id = b.artigo_id;
  if (campos.has(`tecido:${b.tipo}:${b.numero}:consumo`)) { p.consumo = b.consumo; p.loss_percent = b.loss_percent; }
  return Object.keys(p).length > 0 ? p : null;
}
