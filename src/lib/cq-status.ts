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
