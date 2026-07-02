/**
 * FONTE ÚNICA DE VERDADE (SSOT) do catálogo de condições do motor de regras do kanban
 * (transição de status no Desenvolvimento).
 *
 * Cada condição é uma checagem BOOLEANA sobre o "projeto inteiro" de um modelo
 * (modelo + CAD + CQ + Serviços). A loja escolhe, por status, quais condições são
 * REQUISITO DE ENTRADA (todas em E/AND). Config guarda as chaves em
 * `tenant_config.status_kanban[i].requisitos`.
 *
 * ── COMO ADICIONAR UMA CONDIÇÃO (ou módulo) ──────────────────────────────────
 * 1) Acrescente aqui (key única + label + módulo).
 * 2) Compute a chave na RPC `avaliar_condicoes_kanban` (um branch por chave).
 * 3) O teste anti-drift (kanban-condicoes) FALHA se a RPC não devolver exatamente
 *    as chaves deste catálogo — ele é a rede de segurança contra esquecer o passo 2.
 * Mantenha CLAUDE.md e a memória do projeto em dia ao mexer aqui.
 */

export type CondicaoModulo = "planejamento" | "desenvolvimento" | "cad" | "servicos" | "cq" | "direcionamento";

export type Condicao = {
  key: string;
  label: string;
  modulo: CondicaoModulo;
  /** Dica do que a RPC checa (só documentação; a lógica real mora na RPC). */
  descricao?: string;
};

export const MODULOS: { key: CondicaoModulo; label: string }[] = [
  { key: "planejamento", label: "Planejamento" },
  { key: "desenvolvimento", label: "Desenvolvimento" },
  { key: "cad", label: "CAD" },
  { key: "servicos", label: "Serviços" },
  { key: "cq", label: "Controle de Qualidade" },
  { key: "direcionamento", label: "Direcionamento" },
];

export const CONDICOES: Condicao[] = [
  // ── Planejamento ──────────────────────────────────────────────
  { key: "categoria_definida", label: "Categoria definida", modulo: "planejamento", descricao: "categoria_principal_id não nulo" },
  { key: "subcategoria1_definida", label: "Subcategoria 1 definida", modulo: "planejamento" },
  { key: "subcategoria2_definida", label: "Subcategoria 2 definida", modulo: "planejamento" },
  { key: "estilista_definido", label: "Estilista definido", modulo: "planejamento" },
  { key: "linha_definida", label: "Linha definida", modulo: "planejamento" },
  { key: "colecao_preenchida", label: "Coleção preenchida", modulo: "planejamento" },
  { key: "tecido_planejado", label: "Tecido planejado (≥ 1)", modulo: "planejamento", descricao: "tecidos_planejados com ≥1 item" },
  { key: "ordem_criacao_enviada", label: "Ordem de Criação enviada", modulo: "planejamento" },
  { key: "preco_venda_preenchido", label: "Preço para venda preenchido", modulo: "planejamento" },
  { key: "data_lancamento_preenchida", label: "Data de Lançamento preenchida", modulo: "planejamento" },
  { key: "lancado", label: "Lançado", modulo: "planejamento" },

  // ── Desenvolvimento ───────────────────────────────────────────
  { key: "modelista_definido", label: "Modelista definido", modulo: "desenvolvimento" },
  { key: "piloteiro_definido", label: "Piloteiro definido (≥ 1)", modulo: "desenvolvimento" },
  { key: "data_desenho_tecnico", label: "Data do Desenho Técnico preenchida", modulo: "desenvolvimento" },
  { key: "data_piloto1", label: "Data de Piloto I preenchida", modulo: "desenvolvimento" },
  { key: "data_piloto2", label: "Data de Piloto II preenchida", modulo: "desenvolvimento" },
  { key: "data_piloto3", label: "Data de Piloto III preenchida", modulo: "desenvolvimento" },
  { key: "data_aprovacao", label: "Data de Aprovação preenchida", modulo: "desenvolvimento" },
  { key: "grade_preenchida", label: "Grade preenchida", modulo: "desenvolvimento", descricao: "soma de modelo_grades.grade_total > 0" },
  { key: "tecido_com_variante", label: "Tecido com variante (≥ 1)", modulo: "desenvolvimento" },
  { key: "aviamento_definido", label: "Aviamento definido (≥ 1)", modulo: "desenvolvimento" },
  { key: "desenho_tecnico_anexado", label: "Desenho Técnico anexado", modulo: "desenvolvimento" },
  { key: "ficha_medida_anexada", label: "Ficha de Medida anexada", modulo: "desenvolvimento" },
  { key: "enviado_cad", label: "Enviado ao CAD", modulo: "desenvolvimento" },

  // ── CAD ───────────────────────────────────────────────────────
  { key: "cad_confirmado", label: "CAD confirmado (enviado ao corte)", modulo: "cad" },

  // ── Serviços ──────────────────────────────────────────────────
  { key: "servico_aprovado", label: "Serviço aprovado (todos os blocos externos)", modulo: "servicos" },
  { key: "servico_finalizado", label: "Serviços finalizados", modulo: "servicos" },

  // ── Controle de Qualidade ─────────────────────────────────────
  { key: "cq_confirmado", label: "CQ (Pré) confirmado", modulo: "cq" },
  { key: "cq_pos_confirmado", label: "CQ Pós confirmado", modulo: "cq" },

  // ── Direcionamento ────────────────────────────────────────────
  { key: "direcionamento_feito", label: "Direcionamento feito", modulo: "direcionamento" },
];

export const CONDICAO_KEYS = CONDICOES.map((c) => c.key);
export const CONDICAO_BY_KEY = new Map(CONDICOES.map((c) => [c.key, c]));

/** Requisitos satisfeitos? (todos em E). `satisfeitas` = mapa {key: bool} da RPC. */
export function requisitosOk(requisitos: string[] | undefined, satisfeitas: Record<string, boolean>): {
  ok: boolean;
  faltando: Condicao[];
} {
  const reqs = requisitos ?? [];
  const faltando = reqs.filter((k) => !satisfeitas[k]).map((k) => CONDICAO_BY_KEY.get(k)).filter(Boolean) as Condicao[];
  return { ok: faltando.length === 0, faltando };
}
