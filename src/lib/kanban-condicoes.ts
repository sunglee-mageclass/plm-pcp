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
  /** ARMADILHA: aviso âmbar exibido na config quando a condição TRAVA em certos cenários (ex.:
   *  requer estrutura opt-in que nem todo modelo tem). Ajuda o admin a não exigir algo que
   *  travaria o card pra sempre. Só apresentação — não afeta a avaliação. */
  aviso?: string;
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
  { key: "categoria_definida", label: "Categoria definida", modulo: "planejamento", secao: "s1", descricao: "Tem Categoria escolhida." },
  { key: "subcategoria1_definida", label: "Subcategoria 1 definida", modulo: "planejamento", secao: "s1", descricao: "Tem Subcategoria 1 escolhida." },
  { key: "subcategoria2_definida", label: "Subcategoria 2 definida", modulo: "planejamento", secao: "s1", descricao: "Tem Subcategoria 2 escolhida.", aviso: "Nem toda categoria usa a Subcategoria 2 — exigir aqui trava as que só usam a 1." },
  { key: "estilista_definido", label: "Estilista definido", modulo: "planejamento", secao: "s1", descricao: "Tem Estilista escolhido." },
  { key: "linha_definida", label: "Linha definida", modulo: "planejamento", secao: "s1", descricao: "Tem Linha escolhida (é a Linha que define o markup)." },
  { key: "colecao_preenchida", label: "Coleção preenchida", modulo: "planejamento", secao: "s1", descricao: "Tem Coleção preenchida." },
  { key: "tecido_planejado", label: "Tecido planejado (≥ 1)", modulo: "planejamento", descricao: "Tem ao menos 1 tecido no Tecido Planejado.", aviso: "Produto de revenda não tem tecido — não exija em fluxo de revenda." },
  { key: "ordem_criacao_enviada", label: "Ordem de Criação enviada", modulo: "planejamento", descricao: "A Ordem de Criação foi enviada (o modelo passou para o Desenvolvimento)." },
  { key: "preco_venda_preenchido", label: "Preço para venda preenchido", modulo: "planejamento", descricao: "Tem Preço para venda maior que zero." },
  { key: "data_lancamento_preenchida", label: "Data de Lançamento preenchida", modulo: "planejamento", descricao: "Tem Data de Lançamento preenchida." },
  { key: "lancado", label: "Lançado", modulo: "planejamento", descricao: "O modelo foi lançado (botão-foguete no Planejamento).", aviso: "Lançar move o card para a coluna final 'Lançado' — não use como requisito de entrada de outra coluna." },
  // A key `servico_aprovado` (histórica) É a APROVAÇÃO DE CUSTO/mão de obra, feita no card
  // do Planejamento (modelos.custo_terceirizados_aprovado). Módulo Planejamento; key mantida.
  // Aparece na §8 Custos do Sheet (badge de mão de obra). Ver as variantes servico_mo_* abaixo.
  { key: "servico_aprovado", label: "Aprovação de custo — aprovada", modulo: "planejamento", secao: "s5", descricao: "Toda a mão de obra foi aprovada (nenhuma pendente ou reprovada).", aviso: "Modelo sem mão de obra conta como liberado. Revenda não tem MO — sempre satisfaz." },
  { key: "servico_mo_decidido", label: "Aprovação de custo — decidida", modulo: "planejamento", secao: "s5", descricao: "Toda a mão de obra foi decidida — nenhuma pendente.", aviso: "Uma linha reprovada já conta como decidida (diferente de 'aprovada')." },
  { key: "servico_mo_preenchido", label: "Aprovação de custo — valor preenchido", modulo: "planejamento", secao: "s5", descricao: "Tem ao menos uma mão de obra com valor lançado.", aviso: "Só verifica se há valor — não garante que foi aprovada." },

  // ── Desenvolvimento ───────────────────────────────────────────
  { key: "modelista_definido", label: "Modelista definido", modulo: "desenvolvimento", secao: "s1", descricao: "Tem Modelista escolhido." },
  { key: "piloteiro_definido", label: "Piloteiro definido (≥ 1)", modulo: "desenvolvimento", secao: "s1", descricao: "Tem ao menos um Piloteiro escolhido." },
  { key: "data_desenho_tecnico", label: "Data do Desenho Técnico preenchida", modulo: "desenvolvimento", secao: "s1", descricao: "Tem Data do Desenho Técnico preenchida." },
  { key: "data_piloto1", label: "Data de Piloto I preenchida", modulo: "desenvolvimento", secao: "s1", descricao: "Tem Data de Piloto I preenchida." },
  { key: "data_piloto2", label: "Data de Piloto II preenchida", modulo: "desenvolvimento", secao: "s1", descricao: "Tem Data de Piloto II preenchida.", aviso: "Nem todo modelo tem 2ª pilotagem — exigir aqui trava os que fecham no Piloto I." },
  { key: "data_piloto3", label: "Data de Piloto III preenchida", modulo: "desenvolvimento", secao: "s1", descricao: "Tem Data de Piloto III preenchida.", aviso: "Nem todo modelo tem 3ª pilotagem — exigir aqui trava os que fecham antes." },
  { key: "data_aprovacao", label: "Data de Aprovação preenchida", modulo: "desenvolvimento", secao: "s1", descricao: "Tem Data de Aprovação preenchida." },
  { key: "grade_preenchida", label: "Grade preenchida", modulo: "desenvolvimento", secao: "s4", descricao: "A grade tem quantidade (soma das peças maior que zero)." },
  { key: "grade_todas_variantes", label: "Grade preenchida (todas as variantes)", modulo: "desenvolvimento", secao: "s4", descricao: "Todas as cores do tecido principal têm grade preenchida.", aviso: "Conta só as cores do tecido principal — mais exigente que 'Grade preenchida'." },
  { key: "tecido_com_variante", label: "Tecido com variante (≥ 1)", modulo: "desenvolvimento", secao: "s2", descricao: "Tem ao menos um tecido com uma cor escolhida." },
  { key: "aviamento_definido", label: "Aviamento definido (≥ 1)", modulo: "desenvolvimento", secao: "s3", descricao: "Tem ao menos um aviamento no modelo." },
  // Anexos (§9 do Sheet) — sub-seleções: a loja escolhe QUAIS anexos são exigidos.
  { key: "anexo_croqui", label: "Anexo: Croqui", modulo: "desenvolvimento", secao: "s6", descricao: "Tem o Croqui anexado." },
  { key: "desenho_tecnico_anexado", label: "Anexo: Desenho Técnico", modulo: "desenvolvimento", secao: "s6", descricao: "Tem o Desenho Técnico anexado." },
  { key: "anexo_modelo", label: "Anexo: Foto do Modelo", modulo: "desenvolvimento", secao: "s6", descricao: "Tem ao menos uma Foto do Modelo anexada." },
  { key: "ficha_medida_anexada", label: "Anexo: Ficha de Medida", modulo: "desenvolvimento", secao: "s6", descricao: "Tem a Ficha de Medida anexada." },
  { key: "enviado_cad", label: "Enviado à Explosão", modulo: "desenvolvimento", descricao: "O modelo foi enviado à Explosão.", aviso: "Revenda não passa pela Explosão — não exija em fluxo de revenda." },

  // ── CAD ───────────────────────────────────────────────────────
  // `cad_confirmado` (semântica "enviado ao corte") foi APOSENTADA (ago/2026, decisão do dono):
  // o marco correto é a seção "4. CAD" do card de Desenvolvimento (accordion `s-cad`,
  // CadTecidosSection) estar PREENCHIDA — não o envio ao corte (isso é responsabilidade de
  // Serviços/CQ downstream). Semântica nova = KEY NOVA (não reaproveitar `cad_confirmado`).
  // Predicado (ver comentário da migration `20260812150000` p/ a investigação completa): a
  // grade planejada É copiada do BOM pro `cad_grades` no MESMO instante que `enviado_cad` vira
  // true (ficaria redundante com aquela condição); os únicos campos que `enviar_modelo_para_cad`
  // deixa ZERADOS até entrada manual são `cad_tecidos.tamanho_folha` e
  // `cad_tecido_variantes.quantidade_folhas`/`metragem_planejada` — exatamente os campos que
  // `CadTecidosSection.tsx` deixa editar. `cad_preenchido` = ≥1 desses > 0.
  { key: "cad_preenchido", label: "CAD (Desenvolvimento) preenchido", modulo: "cad", descricao: "A seção CAD do card tem folhas ou metragem planejada preenchidas." },
  // "Saiu da Explosão" (set/2026): o botão "Enviar para PCP" da Explosão setou `cad.enviado_corte`.
  // É o marco DEPOIS de "Enviado à Explosão" (enviado_cad) — o modelo saiu da Explosão rumo aos
  // Serviços. Revenda SATISFAZ ao clicar Enviar para PCP (por isso NÃO entra em REVENDA_COND_NA).
  { key: "enviado_para_pcp", label: "Enviado para PCP", modulo: "cad", descricao: "O CAD foi enviado ao corte/PCP (saiu da Explosão).", aviso: "Revenda satisfaz ao clicar Enviar para PCP na Explosão." },
  // Metragem/qtd a separar preenchida na Explosão: tecido (metragem_enviada), aviamento
  // (quantidade_separar) OU etiqueta/insumo (cad_etiquetas.quantidade_enviar). ≥1 > 0.
  { key: "separar_enviar_preenchido", label: "Separar/Enviar preenchido", modulo: "cad", descricao: "Há metragem (tecido), qtd a separar (aviamento) ou qtd a enviar (etiqueta) preenchida na Explosão." },

  // ── Serviços ──────────────────────────────────────────────────
  { key: "servico_finalizado", label: "Serviços finalizados", modulo: "servicos", descricao: "Todos os serviços foram finalizados (entregues, com quantidade recebida ou defeito).", aviso: "Modelo sem serviço nunca satisfaz — use só depois do envio ao corte/Serviços." },
  // Grade Cortada (ago/2026): bloco-fonte de confecção (PL/Oficina, destrinchado) reportou
  // CORTADA > 0 em alguma célula do grade_detalhe. Opt-in: só faz sentido pra loja que usa a
  // quantidade detalhada por tamanho×variante — modelo sem bloco-fonte nunca satisfaz.
  { key: "grade_cortada_lancada", label: "Grade Cortada lançada", modulo: "servicos", descricao: "A confecção lançou quantidade cortada na grade.", aviso: "Só para quem usa quantidade detalhada por tamanho×cor — modelo sem grade detalhada nunca satisfaz." },

  // ── Controle de Qualidade ─────────────────────────────────────
  { key: "cq_confirmado", label: "CQ (Pré) confirmado", modulo: "cq", descricao: "O CQ Pré (até a costura) foi confirmado." },
  { key: "cq_pos_confirmado", label: "CQ Pós confirmado", modulo: "cq", descricao: "O CQ Pós (acabamento) foi confirmado.", aviso: "Modelo sem pós-costura nunca confirma o Pós — prefira 'CQ liberado (Pré + Pós)'." },
  // Espelha o gate único `cqLiberado()` (src/lib/cq-status.ts) já usado por Direcionamento/
  // Lançar/Lançamentos: Pré confirmado E (só se há serviço pós-costura ATIVO) Pós confirmado.
  // Preferir esta condição a `cq_pos_confirmado` sozinha — aquela nunca libera modelo sem
  // pós-costura (status_pos fica 'pendente' pra sempre nesse caso).
  { key: "cq_liberado", label: "CQ liberado (Pré + Pós)", modulo: "cq", descricao: "CQ Pré confirmado e, se houver acabamento, o Pós também. É o CQ seguro — não trava quem não tem acabamento." },

  // ── Direcionamento ────────────────────────────────────────────
  // Label alinhado ao badge "Separado"/toast "Direcionamento confirmado — Separado" da tela
  // (expedicao.direcionamento.$modeloId.tsx) — key `direcionamento_feito` MANTIDA, só rótulo.
  { key: "direcionamento_feito", label: "Direcionamento — separado", modulo: "direcionamento", descricao: "O Direcionamento foi confirmado — a peça foi separada por loja." },
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

/**
 * CASCATA de requisitos (set/2026) — para ENTRAR numa etapa, o card precisa cumprir os
 * requisitos de todas as etapas ANTERIORES (na ordem do board) + os próprios da etapa. Assim
 * o card não pula da etapa 1 pra 5 sem passar por 2/3/4.
 *
 * `requisitosEfetivos(statusKey, ordemColunas, requisitosPorStatus, excecoesPorStatus?)` =
 * UNIÃO (dedup) dos requisitos PRÓPRIOS de todas as colunas da posição 0 até a de `statusKey`
 * (inclusive), MENOS as exceções configuradas na etapa `statusKey` (herdados que o admin
 * desligou ali, com alerta). `statusKey` fora de `ordemColunas` → só o próprio (fallback seguro).
 *
 * A config guarda por etapa APENAS os requisitos próprios (incremental) — a herança é computada
 * aqui, então reordenar colunas recalcula sozinho e não há duplicação de dados.
 */
export function requisitosEfetivos(
  statusKey: string,
  ordemColunas: string[],
  requisitosPorStatus: Record<string, string[]> | undefined,
  excecoesPorStatus?: Record<string, string[]>,
): string[] {
  const reqs = requisitosPorStatus ?? {};
  const idx = ordemColunas.indexOf(statusKey);
  // Fora da ordem conhecida: só os próprios daquele status (não dá pra herdar sem posição).
  if (idx < 0) return [...new Set(reqs[statusKey] ?? [])];
  const acc = new Set<string>();
  for (let i = 0; i <= idx; i++) {
    for (const k of reqs[ordemColunas[i]] ?? []) acc.add(k);
  }
  // Exceções: herdados que o admin desligou NESTA etapa (nunca removem da etapa de origem —
  // valem só como "ignorar aqui"). Só faz sentido subtrair o que NÃO é próprio desta etapa,
  // mas subtrair direto é seguro: se fosse próprio, o admin o desmarcaria como próprio, não como exceção.
  const exc = excecoesPorStatus?.[statusKey] ?? [];
  const propriosDaEtapa = new Set(reqs[statusKey] ?? []);
  for (const k of exc) if (!propriosDaEtapa.has(k)) acc.delete(k);
  return [...acc];
}

/**
 * Requisitos HERDADOS de uma etapa (os que vêm das etapas anteriores, não os próprios) — usado
 * pela UI de config pra mostrar quais requisitos são herdados (marcados com selo de origem) vs
 * próprios (editáveis). Devolve `{key, origem}` onde `origem` = a 1ª etapa (na ordem) que exige a key.
 */
export function requisitosHerdados(
  statusKey: string,
  ordemColunas: string[],
  requisitosPorStatus: Record<string, string[]> | undefined,
): { key: string; origem: string }[] {
  const reqs = requisitosPorStatus ?? {};
  const idx = ordemColunas.indexOf(statusKey);
  if (idx <= 0) return [];
  const propriosDaEtapa = new Set(reqs[statusKey] ?? []);
  const vistos = new Map<string, string>(); // key → 1ª etapa que a exige
  for (let i = 0; i < idx; i++) {
    for (const k of reqs[ordemColunas[i]] ?? []) if (!vistos.has(k)) vistos.set(k, ordemColunas[i]);
  }
  // Herdado = veio de etapa anterior E não é próprio desta etapa (se for próprio, conta como próprio).
  return [...vistos.entries()].filter(([k]) => !propriosDaEtapa.has(k)).map(([key, origem]) => ({ key, origem }));
}

/**
 * REGRESSÃO automática (Fase 2, set/2026) — dado o status ATUAL do card, a ordem do board, os
 * requisitos por coluna (+ exceções) e o mapa de condições satisfeitas, devolve a coluna-ALVO
 * para onde o card deve VOLTAR se um requisito de etapa anterior deixou de ser cumprido:
 * a PRIMEIRA coluna (na ordem) cujos requisitos EFETIVOS (cascata) incluem alguma condição não
 * satisfeita. Só regride se o card está À FRENTE dessa coluna — senão devolve null (nada a fazer).
 *
 * ⚠️ ESSA lógica é ESPELHADA MANUALMENTE em SQL em `_kanban_regredir_modelo` (migration
 * 20260906120000) — o trigger no banco faz o move real no evento. Este helper é o SSOT
 * testável em TS (`tests/unit/kanban-regressao.test.ts`); o espelho SQL é validado por teste
 * transacional no banco (não roda no Vitest). Ao mudar QUALQUER um dos dois, atualize o outro
 * e re-rode os dois testes — não há trava automática de drift SQL↔TS.
 */
export function colunaRegressaoAlvo(
  statusAtual: string,
  ordemColunas: string[],
  requisitosPorStatus: Record<string, string[]> | undefined,
  satisfeitas: Record<string, boolean>,
  excecoesPorStatus?: Record<string, string[]>,
): string | null {
  const curIdx = ordemColunas.indexOf(statusAtual);
  if (curIdx < 0) return null; // status fora do board conhecido → não mexe
  for (let i = 0; i < ordemColunas.length; i++) {
    const efetivos = requisitosEfetivos(ordemColunas[i], ordemColunas, requisitosPorStatus, excecoesPorStatus);
    const falha = efetivos.some((k) => !satisfeitas[k]);
    if (falha) {
      // primeira coluna que falha = alvo; só regride se o card está à frente dela
      return curIdx > i ? ordemColunas[i] : null;
    }
  }
  return null;
}

/**
 * Fluxo de Revenda (ago/2026) — condições ESTRUTURALMENTE impossíveis para modelos
 * `origem==='revenda'` (nunca passam por tecido/CAD/explosão/serviços de confecção/grade
 * cortada — ver invariante #13 no CLAUDE.md). Usado só para ESMAECER essas opções no dialog
 * de configuração de requisitos por coluna (revenda nunca vai satisfazê-las, então exigi-las
 * travaria o card pra sempre). NÃO participa do catálogo `CONDICOES`/RPC — puramente uma lista
 * de exclusão consultada pela UI.
 */
export const REVENDA_COND_NA: string[] = [
  "tecido_planejado",
  "tecido_com_variante",
  "grade_todas_variantes",
  "cad_preenchido",
  "enviado_cad",
  "servico_finalizado",
  "grade_cortada_lancada",
];
