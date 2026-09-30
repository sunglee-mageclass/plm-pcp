// Predicado ÚNICO de "CQ liberado para downstream" (Direcionamento e Lançar).
// O CQ Pré confirmado libera sempre; quando o modelo tem serviço de acabamento
// (pós-costura) ativo, o Pós também precisa estar confirmado. Mantê-lo aqui evita
// as três telas (Direcionamento, Planejamento, Lançamentos) divergirem no gate.

type CqLike = { status?: string | null; status_pos?: string | null };
type TercLike = { ativo?: boolean | null; categorias_terceirizado?: { etapa?: string | null } | null };
type CadLike = {
  controle_qualidade?: CqLike[] | CqLike | null;
  producao_terceirizados?: TercLike[] | null;
} | null | undefined;

/** true quando o CQ do CAD está liberado p/ Direcionamento/Lançar (Pré confirmado
 *  + Pós confirmado se há serviço pós-costura ativo). */
export function cqLiberado(cad: CadLike): boolean {
  const cqRaw = cad?.controle_qualidade;
  const cq: CqLike | undefined = Array.isArray(cqRaw) ? cqRaw[0] : (cqRaw ?? undefined);
  if ((cq?.status ?? "pendente") !== "confirmado") return false;
  const tercs = (cad?.producao_terceirizados ?? []).filter((t) => t?.ativo !== false);
  const temPos = tercs.some((t) => (t?.categorias_terceirizado?.etapa ?? "ate_costura") === "pos_costura");
  return !temPos || (cq?.status_pos ?? "pendente") === "confirmado";
}

type CadComGradeReal = CadLike & {
  modelo_id?: string | null;
  cad_grades?: { grade_total_real?: number | string | null }[] | null;
};

/** Peças REAIS por modelo (Σ `cad_grades.grade_total_real`) contando SÓ os CADs com o CQ LIBERADO (`cqLiberado`).
 *  Fonte única do "Realizado" (Planejamento e Dashboard Comercial): a grade real só é autoritativa depois do CQ — antes
 *  dele ela nasce igual à planejada (salvar CAD) ou recebida − defeito com o CQ pendente (revenda). Modelo sem peça
 *  liberada fica FORA do mapa (quem lê trata ausência como 0). Contas certas item 7 (prod #1). */
export function pecasReaisLiberadas(rows: CadComGradeReal[] | null | undefined): Record<string, number> {
  const m: Record<string, number> = {};
  for (const row of rows ?? []) {
    if (!row?.modelo_id) continue;
    if (!cqLiberado(row)) continue;
    const soma = (row.cad_grades ?? []).reduce((s, g) => s + (Number(g?.grade_total_real ?? 0) || 0), 0);
    if (soma > 0) m[row.modelo_id] = (m[row.modelo_id] ?? 0) + soma;
  }
  return m;
}
