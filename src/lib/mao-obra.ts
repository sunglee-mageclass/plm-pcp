/**
 * MO por serviço — helpers puros (espelham a lógica do rollup no banco).
 * `aprovado`: null = pendente / true / false. A regra de LIBERAÇÃO é a mesma do
 * trigger `_mo_liberada`: liberada = nenhuma linha com aprovado ≠ true (sem linha = liberada).
 */
export type MoLinha = {
  categoria_terceirizado_id: string | null;
  nome?: string | null;
  valor?: number | null;
  aprovado: boolean | null;
  motivo_reprovacao?: string | null;
};

/** Liberada p/ lançar? = nenhuma linha pendente/reprovada. Vazio = true. */
export function moLiberada(linhas: MoLinha[]): boolean {
  return !linhas.some((l) => l.aprovado !== true);
}

export type EstadoMO = "sem_servico" | "reprovada" | "pendente" | "aprovada";

/** Estado de exibição do modelo derivado das linhas (para o badge 3-estados). */
export function estadoMO(linhas: MoLinha[]): EstadoMO {
  if (linhas.length === 0) return "sem_servico";
  if (linhas.some((l) => l.aprovado === false)) return "reprovada";
  if (linhas.some((l) => l.aprovado == null)) return "pendente";
  return "aprovada";
}

/** Σ dos valores das linhas APROVADAS (aprovado === true). */
export function somaAprovada(linhas: MoLinha[]): number {
  return linhas.reduce((s, l) => s + (l.aprovado === true ? Number(l.valor) || 0 : 0), 0);
}

/** Σ de todos os valores (planejado total). */
export function somaTotal(linhas: MoLinha[]): number {
  return linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);
}
