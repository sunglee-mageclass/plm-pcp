// Switches EXTRAS do Cadastro › Atributos (`AttributeTabConfig.extraToggles`, urgentes R9: "Exige peça teste" na Categoria do
// Serviço). Lógica PURA — o `AttributeTab` só desenha. Diferença para o `toggleField` ("Ativo"): aqui o padrão é DESLIGADO
// (coluna booleana NOT NULL DEFAULT false), então "ligado" = `=== true` (nunca `!== false`), e o "Novo" também manda o campo.

export type ExtraToggle = {
  /** Coluna booleana da tabela do atributo. */
  field: string;
  label: string;
  /** Informação complementar (vira o "i" ao lado do rótulo — nunca texto fixo embaixo do campo). */
  hint?: string;
  /** Texto do selo/ao lado do Switch quando ligado e quando desligado (ex.: "Exige" / "Não exige"). */
  textoLigado: string;
  textoDesligado: string;
};

export type ExtraTogglesEstado = Record<string, boolean>;

/** Estado inicial do "Novo": tudo DESLIGADO. */
export function togglesPadrao(extras?: readonly ExtraToggle[]): ExtraTogglesEstado {
  return Object.fromEntries((extras ?? []).map((t) => [t.field, false]));
}

/** Estado de uma linha existente (coluna ausente/nula = desligado). */
export function togglesDaLinha(extras: readonly ExtraToggle[] | undefined, row: Record<string, unknown>): ExtraTogglesEstado {
  return Object.fromEntries((extras ?? []).map((t) => [t.field, row[t.field] === true]));
}

/** Campos que entram no payload do insert/update: um booleano por switch (estado ausente = false). Sem extras = `{}`. */
export function payloadExtraToggles(extras: readonly ExtraToggle[] | undefined, estado: ExtraTogglesEstado): Record<string, boolean> {
  return Object.fromEntries((extras ?? []).map((t) => [t.field, estado[t.field] === true]));
}

/** Algum switch difere do valor gravado na linha? (selo "não salvo" do Sheet). */
export function togglesMudaram(extras: readonly ExtraToggle[] | undefined, estado: ExtraTogglesEstado, row: Record<string, unknown>): boolean {
  return (extras ?? []).some((t) => (estado[t.field] === true) !== (row[t.field] === true));
}

/** Algum switch ligado? (o "Novo" só fica "sujo" se mexeram — padrão desligado não conta). */
export function algumToggleLigado(extras: readonly ExtraToggle[] | undefined, estado: ExtraTogglesEstado): boolean {
  return (extras ?? []).some((t) => estado[t.field] === true);
}

/** Rótulos dos switches LIGADOS de uma linha (sublinha do card mobile). */
export function rotulosTogglesLigados(extras: readonly ExtraToggle[] | undefined, row: Record<string, unknown>): string[] {
  return (extras ?? []).filter((t) => row[t.field] === true).map((t) => t.label);
}

export function textoDoToggle(t: ExtraToggle, ligado: boolean): string {
  return ligado ? t.textoLigado : t.textoDesligado;
}
