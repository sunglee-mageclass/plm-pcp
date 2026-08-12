/**
 * FONTE ÚNICA DE VERDADE (SSOT) do catálogo de condições do motor de regras do kanban
 * (transição de status no Desenvolvimento).
 *
 * Cada condição é uma checagem BOOLEANA sobre o "projeto inteiro" de um modelo
 * (modelo + CAD + CQ + Serviços). A loja escolhe, por status, quais condições são
 * REQUISITO DE ENTRADA (todas em E/AND). Config guarda as chaves em
 * `tenant_config.kanban_requisitos[status_key]` (coluna PRÓPRIA, separada de
 * `tenant_config.status_kanban` — que só guarda as colunas do board; não é campo aninhado nele).
 *
 * ── COMO ADICIONAR UMA CONDIÇÃO (ou módulo) ──────────────────────────────────
 * 1) Acrescente aqui (key única + label + módulo).
 * 2) Compute a chave na RPC `avaliar_condicoes_kanban` (um branch por chave).
 * 3) O teste anti-drift (kanban-condicoes) FALHA se a RPC não devolver exatamente
 *    as chaves deste catálogo — ele é a rede de segurança contra esquecer o passo 2.
 * Mantenha CLAUDE.md e a memória do projeto em dia ao mexer aqui.
 */

export type CondicaoModulo = "planejamento" | "desenvolvimento" | "cad" | "servicos" | "cq" | "direcionamento";

// Seção do Sheet de detalhe (Desenvolvimento) a que a condição pertence — usada para os SELOS
// de completude por seção (que refletem os requisitos configurados pela loja). Bate com o
// `value`/`data-acc` do accordion em ModeloDetailPanel. Condições sem `secao` só valem no kanban.
export type CondicaoSecao = "s1" | "prova" | "s2" | "s-cad" | "s3" | "s3e" | "s4" | "s5" | "s6";

export type Condicao = {
  key: string;
  label: string;
  modulo: CondicaoModulo;
  /** Seção do Sheet a que pertence (p/ o selo de completude). Ausente = só-kanban. */
  secao?: CondicaoSecao;
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
  { key: "categoria_definida", label: "Categoria definida", modulo: "planejamento", secao: "s1", descricao: "categoria_principal_id não nulo" },
  { key: "subcategoria1_definida", label: "Subcategoria 1 definida", modulo: "planejamento", secao: "s1" },
  { key: "subcategoria2_definida", label: "Subcategoria 2 definida", modulo: "planejamento", secao: "s1" },
  { key: "estilista_definido", label: "Estilista definido", modulo: "planejamento", secao: "s1" },
  { key: "linha_definida", label: "Linha definida", modulo: "planejamento", secao: "s1" },
  { key: "colecao_preenchida", label: "Coleção preenchida", modulo: "planejamento", secao: "s1" },
  { key: "tecido_planejado", label: "Tecido planejado (≥ 1)", modulo: "planejamento", descricao: "tecidos_planejados com ≥1 item" },
  { key: "ordem_criacao_enviada", label: "Ordem de Criação enviada", modulo: "planejamento" },
  { key: "preco_venda_preenchido", label: "Preço para venda preenchido", modulo: "planejamento" },
  { key: "data_lancamento_preenchida", label: "Data de Lançamento preenchida", modulo: "planejamento" },
  { key: "lancado", label: "Lançado", modulo: "planejamento" },
  // A key `servico_aprovado` (histórica) É a APROVAÇÃO DE CUSTO/mão de obra, feita no card
  // do Planejamento (modelos.custo_terceirizados_aprovado). Módulo Planejamento; key mantida.
  // Aparece na §8 Custos do Sheet (badge de mão de obra).
  { key: "servico_aprovado", label: "Aprovação de custo", modulo: "planejamento", secao: "s5", descricao: "custo_terceirizados_aprovado (derivado de modelo_servico_mo) = true" },

  // ── Desenvolvimento ───────────────────────────────────────────
  { key: "modelista_definido", label: "Modelista definido", modulo: "desenvolvimento", secao: "s1" },
  { key: "piloteiro_definido", label: "Piloteiro definido (≥ 1)", modulo: "desenvolvimento", secao: "s1" },
  { key: "data_desenho_tecnico", label: "Data do Desenho Técnico preenchida", modulo: "desenvolvimento", secao: "s1" },
  { key: "data_piloto1", label: "Data de Piloto I preenchida", modulo: "desenvolvimento", secao: "s1" },
  { key: "data_piloto2", label: "Data de Piloto II preenchida", modulo: "desenvolvimento", secao: "s1" },
  { key: "data_piloto3", label: "Data de Piloto III preenchida", modulo: "desenvolvimento", secao: "s1" },
  { key: "data_aprovacao", label: "Data de Aprovação preenchida", modulo: "desenvolvimento", secao: "s1" },
  { key: "grade_preenchida", label: "Grade preenchida", modulo: "desenvolvimento", secao: "s4", descricao: "soma de modelo_grades.grade_total > 0" },
  { key: "grade_todas_variantes", label: "Grade preenchida (todas as variantes)", modulo: "desenvolvimento", secao: "s4", descricao: "toda variante do Tecido 1 tem grade_total > 0" },
  { key: "tecido_com_variante", label: "Tecido com variante (≥ 1)", modulo: "desenvolvimento", secao: "s2" },
  { key: "aviamento_definido", label: "Aviamento definido (≥ 1)", modulo: "desenvolvimento", secao: "s3" },
  // Anexos (§9 do Sheet) — sub-seleções: a loja escolhe QUAIS anexos são exigidos.
  { key: "anexo_croqui", label: "Anexo: Croqui", modulo: "desenvolvimento", secao: "s6", descricao: "croqui_url preenchido" },
  { key: "desenho_tecnico_anexado", label: "Anexo: Desenho Técnico", modulo: "desenvolvimento", secao: "s6" },
  { key: "anexo_modelo", label: "Anexo: Foto do Modelo", modulo: "desenvolvimento", secao: "s6", descricao: "fotos_modelo com ≥1 item" },
  { key: "ficha_medida_anexada", label: "Anexo: Ficha de Medida", modulo: "desenvolvimento", secao: "s6" },
  { key: "enviado_cad", label: "Enviado à Explosão", modulo: "desenvolvimento" },

  // ── CAD ───────────────────────────────────────────────────────
  { key: "cad_confirmado", label: "CAD confirmado (enviado ao corte)", modulo: "cad" },

  // ── Serviços ──────────────────────────────────────────────────
  { key: "servico_finalizado", label: "Serviços finalizados", modulo: "servicos" },
  // Grade Cortada (ago/2026): bloco-fonte de confecção (PL/Oficina, destrinchado) reportou
  // CORTADA > 0 em alguma célula do grade_detalhe. Opt-in: só faz sentido pra loja que usa a
  // quantidade detalhada por tamanho×variante — modelo sem bloco-fonte nunca satisfaz.
  { key: "grade_cortada_lancada", label: "Grade Cortada lançada", modulo: "servicos", descricao: "bloco-fonte de confecção com cortada > 0 em alguma célula" },

  // ── Controle de Qualidade ─────────────────────────────────────
  { key: "cq_confirmado", label: "CQ (Pré) confirmado", modulo: "cq" },
  { key: "cq_pos_confirmado", label: "CQ Pós confirmado", modulo: "cq" },
  // Espelha o gate único `cqLiberado()` (src/lib/cq-status.ts) já usado por Direcionamento/
  // Lançar/Lançamentos: Pré confirmado E (só se há serviço pós-costura ATIVO) Pós confirmado.
  // Preferir esta condição a `cq_pos_confirmado` sozinha — aquela nunca libera modelo sem
  // pós-costura (status_pos fica 'pendente' pra sempre nesse caso).
  { key: "cq_liberado", label: "CQ liberado (Pré + Pós)", modulo: "cq", descricao: "Pré confirmado e, se há serviço pós-costura ativo, Pós também confirmado" },

  // ── Direcionamento ────────────────────────────────────────────
  { key: "direcionamento_feito", label: "Direcionamento feito", modulo: "direcionamento" },
];

/** Condições que alimentam o selo de uma seção do Sheet (mapa secao → condições). */
export const CONDICOES_POR_SECAO = CONDICOES.reduce((acc, c) => {
  if (c.secao) (acc[c.secao] ??= []).push(c);
  return acc;
}, {} as Record<string, Condicao[]>);

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
