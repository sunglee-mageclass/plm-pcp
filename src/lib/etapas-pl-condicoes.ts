// Catálogo PRÓPRIO do kanban PL (condições de produção). Espelho do shape de kanban-condicoes.ts,
// mas enxuto. O avaliador SQL (avaliar_condicoes_etapas_pl) tem um branch por key — anti-drift em
// tests/integration/kanban-pl-condicoes.test.ts.
export type CondicaoPL = { key: string; label: string; descricao?: string };
export const CONDICOES_PL: CondicaoPL[] = [
  { key: "peca_teste_aprovada", label: "Peça teste aprovada", descricao: "Toda linha que exige peça teste está aprovada (M.O. + peça teste)." },
  { key: "enviado_a_servicos", label: "Enviado a Serviços", descricao: "O modelo saiu da Explosão (cad.enviado_corte)." },
  { key: "materiais_separados", label: "Materiais separados", descricao: "TODOS os blocos de serviço do modelo têm a data de envio preenchida." },
  { key: "grade_cortada_retornou", label: "Grade cortada retornou", descricao: "TODOS os blocos relevantes têm alguma peça cortada retornada." },
  { key: "oficina_entregue", label: "Oficina entregue", descricao: "TODOS os blocos de oficina entregaram (data entregue + recebido)." },
  { key: "cq_liberado", label: "CQ liberado", descricao: "CQ Pré (e Pós, quando há) confirmado." },
  { key: "lancado", label: "Lançado", descricao: "O modelo foi lançado." },
];
export const CONDICAO_PL_BY_KEY = new Map(CONDICOES_PL.map((c) => [c.key, c]));
/** Requisitos satisfeitos? (todos em E). `satisfeitas` = mapa {key:bool} da RPC. */
export function requisitosOkPL(requisitos: string[] | undefined, satisfeitas: Record<string, boolean>): { ok: boolean; faltando: CondicaoPL[] } {
  const reqs = requisitos ?? [];
  const faltando = reqs.filter((k) => !satisfeitas[k]).map((k) => CONDICAO_PL_BY_KEY.get(k)).filter(Boolean) as CondicaoPL[];
  return { ok: faltando.length === 0, faltando };
}
