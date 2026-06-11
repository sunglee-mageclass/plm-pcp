/**
 * Helper compartilhado para exibir nome de artigo com a unidade de medida.
 * Ex.: "Linho Premium [metro]" / "Malha Canelada [kg]".
 */
export function artigoLabel(
  a: { nome?: string | null; unidade_medida?: string | null } | null | undefined,
): string {
  if (!a?.nome) return "—";
  const u = (a.unidade_medida ?? "").trim();
  return u ? `${a.nome} [${u}]` : a.nome;
}

/** Sufixo curto para inputs de quantidade. "kg" → "kg", "metro" → "m". */
export function unidadeSufixo(unidade: string | null | undefined): string {
  const u = (unidade ?? "").trim().toLowerCase();
  if (!u) return "";
  if (u === "metro" || u === "metros" || u === "m") return "m";
  if (u === "kg" || u === "quilo" || u === "quilos") return "kg";
  return u;
}
