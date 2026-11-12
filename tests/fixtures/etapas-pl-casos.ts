/**
 * FIXTURES COMPARTILHADAS do Kanban PL (Onda 3, Task 4). Usadas por:
 *   - tests/integration/etapas-pl-derivacao-antidrift.test.ts → `_kanban_derivar_puro` / `_kanban_destino_drop_puro` (SQL)
 *                                                                 ≡ `derivarEtapaPl` / `destinoDropPl` (TS, src/lib/etapas-pl-config.ts)
 * Os dois lados recebem o MESMO input (board cru + requisitos + status + condições satisfeitas) e devolvem o MESMO resultado.
 * O board PL REUSA as puras do SQL do Dev (`_kanban_fluxo`/`_kanban_derivar_puro`/`_kanban_destino_drop_puro`) com exceções `{}` e
 * `derivavel = (status IS NOT NULL)` (= `_etapas_pl_derivar_lote`). Modelo: tests/fixtures/kanban-auto-casos.ts.
 */
export type ArrastePlEsperado = {
  para: string;
  acao: "fixar" | "soltar" | "nada" | "bloquear_faltando" | "bloquear_ja_cumprida" | "fora_do_fluxo";
  status: string | null;
  faltando: string[];
};
export type CasoDerivacaoPl = {
  nome: string;
  /** `tenant_config.etapas_pl_kanban` cru (labels ou objetos). */
  board: unknown;
  /** `tenant_config.etapas_pl_requisitos` (key da etapa → keys de condição). */
  requisitos: Record<string, string[]>;
  /** `modelos.status_etapa_pl` (null = fora do PL). */
  status: string | null;
  /** mapa {condição: bool} que o avaliador SQL devolve. */
  satisfeitas: Record<string, boolean>;
  esperado: { derivavel: boolean; alvo: string | null; resultado: string | null; fixado: boolean; faltando: string[] };
  arrastes?: ArrastePlEsperado[];
};

// Board PL de fábrica (o seed da Onda 2/3): keys = peca_teste · separacao_de_materiais · retorno_de_grade_de_corte · oficina · finalizacao.
export const BOARD_PL = ["Peça Teste", "Separação de Materiais", "Retorno de Grade de Corte", "Oficina", "Finalização"];
export const REQS_PL: Record<string, string[]> = {
  peca_teste: ["tem_peca_teste"],
  separacao_de_materiais: ["enviado_a_servicos", "materiais_separados"],
  retorno_de_grade_de_corte: ["grade_cortada_retornou"],
  oficina: ["oficina_entregue"],
  finalizacao: ["cq_liberado", "lancado"],
};

function caso(nome: string, c: Partial<CasoDerivacaoPl> & Pick<CasoDerivacaoPl, "esperado">): CasoDerivacaoPl {
  return { nome, board: BOARD_PL, requisitos: REQS_PL, status: "peca_teste", satisfeitas: {}, ...c };
}

export const CASOS_DERIVACAO_PL: CasoDerivacaoPl[] = [
  caso("1. fluxo todo automático, nada satisfeito → fica na 1ª (piso), falta a porta de entrada", {
    esperado: { derivavel: true, alvo: "peca_teste", resultado: "peca_teste", fixado: false, faltando: ["tem_peca_teste"] },
    arrastes: [
      { para: "peca_teste", acao: "nada", status: "peca_teste", faltando: [] },
      { para: "separacao_de_materiais", acao: "bloquear_faltando", status: "peca_teste", faltando: ["tem_peca_teste", "enviado_a_servicos", "materiais_separados"] },
      { para: "finalizacao", acao: "bloquear_faltando", status: "peca_teste", faltando: ["tem_peca_teste", "enviado_a_servicos", "materiais_separados", "grade_cortada_retornou", "oficina_entregue", "cq_liberado", "lancado"] },
      { para: "zzz", acao: "fora_do_fluxo", status: "peca_teste", faltando: [] },
    ],
  }),
  caso("2. só a porta de entrada → avança até a 1ª falha (Separação), que lista os 2 requisitos próprios", {
    satisfeitas: { tem_peca_teste: true },
    esperado: { derivavel: true, alvo: "peca_teste", resultado: "peca_teste", fixado: false, faltando: ["enviado_a_servicos", "materiais_separados"] },
    arrastes: [
      { para: "separacao_de_materiais", acao: "bloquear_faltando", status: "peca_teste", faltando: ["enviado_a_servicos", "materiais_separados"] },
      { para: "oficina", acao: "bloquear_faltando", status: "peca_teste", faltando: ["enviado_a_servicos", "materiais_separados", "grade_cortada_retornou", "oficina_entregue"] },
    ],
  }),
  caso("3. status atrasado (1ª) com Separação satisfeita → alvo avança; para na 'grade cortada'", {
    satisfeitas: { tem_peca_teste: true, enviado_a_servicos: true, materiais_separados: true },
    esperado: { derivavel: true, alvo: "separacao_de_materiais", resultado: "separacao_de_materiais", fixado: false, faltando: ["grade_cortada_retornou"] },
    arrastes: [
      { para: "separacao_de_materiais", acao: "soltar", status: "separacao_de_materiais", faltando: [] },
      { para: "peca_teste", acao: "bloquear_ja_cumprida", status: "peca_teste", faltando: [] },
      { para: "retorno_de_grade_de_corte", acao: "bloquear_faltando", status: "peca_teste", faltando: ["grade_cortada_retornou"] },
    ],
  }),
  caso("4. tudo satisfeito → última coluna automática, sem falta", {
    status: "oficina",
    satisfeitas: { tem_peca_teste: true, enviado_a_servicos: true, materiais_separados: true, grade_cortada_retornou: true, oficina_entregue: true, cq_liberado: true, lancado: true },
    esperado: { derivavel: true, alvo: "finalizacao", resultado: "finalizacao", fixado: false, faltando: [] },
    arrastes: [
      { para: "finalizacao", acao: "soltar", status: "finalizacao", faltando: [] },
      { para: "oficina", acao: "bloquear_ja_cumprida", status: "oficina", faltando: [] },
      { para: "peca_teste", acao: "bloquear_ja_cumprida", status: "oficina", faltando: [] },
    ],
  }),
  caso("5. cascata: Oficina entregue mas a Separação não → NÃO pula etapa (para na Separação)", {
    satisfeitas: { tem_peca_teste: true, oficina_entregue: true },
    esperado: { derivavel: true, alvo: "peca_teste", resultado: "peca_teste", fixado: false, faltando: ["enviado_a_servicos", "materiais_separados"] },
  }),
  caso("6. status órfão (fora do board) → não é fixado, resultado = posição derivada (cai na 1ª)", {
    status: "xpto_antigo",
    esperado: { derivavel: true, alvo: "peca_teste", resultado: "peca_teste", fixado: false, faltando: ["tem_peca_teste"] },
    arrastes: [{ para: "separacao_de_materiais", acao: "bloquear_faltando", status: "xpto_antigo", faltando: ["tem_peca_teste", "enviado_a_servicos", "materiais_separados"] }],
  }),
  caso("7. coluna MANUAL no meio (Stand By): card parado ali = fixado; o alvo derivado segue o fluxo", {
    board: ["Peça Teste", "Stand By", "Oficina"],
    requisitos: { peca_teste: ["tem_peca_teste"], oficina: ["oficina_entregue"] },
    status: "stand_by",
    satisfeitas: { tem_peca_teste: true },
    esperado: { derivavel: true, alvo: "peca_teste", resultado: "stand_by", fixado: true, faltando: ["oficina_entregue"] },
    arrastes: [
      { para: "stand_by", acao: "nada", status: "stand_by", faltando: [] },
      { para: "peca_teste", acao: "soltar", status: "peca_teste", faltando: [] },
      { para: "oficina", acao: "bloquear_faltando", status: "stand_by", faltando: ["oficina_entregue"] },
    ],
  }),
  caso("8. arrastar de uma coluna automática para a MANUAL = fixar", {
    board: ["Peça Teste", "Stand By", "Oficina"],
    requisitos: { peca_teste: ["tem_peca_teste"], oficina: ["oficina_entregue"] },
    status: "peca_teste",
    satisfeitas: { tem_peca_teste: true },
    esperado: { derivavel: true, alvo: "peca_teste", resultado: "peca_teste", fixado: false, faltando: ["oficina_entregue"] },
    arrastes: [{ para: "stand_by", acao: "fixar", status: "stand_by", faltando: [] }],
  }),
  caso("9. 1ª coluna SEM requisito (entrada manual): nada satisfeito → fica na 1ª, não é 'fixado'", {
    board: ["Entrada", "Em Análise", "Pronto"],
    requisitos: { em_analise: ["enviado_a_servicos"], pronto: ["lancado"] },
    status: "entrada",
    esperado: { derivavel: true, alvo: "entrada", resultado: "entrada", fixado: false, faltando: ["enviado_a_servicos"] },
    arrastes: [
      { para: "entrada", acao: "nada", status: "entrada", faltando: [] },
      { para: "pronto", acao: "bloquear_faltando", status: "entrada", faltando: ["enviado_a_servicos", "lancado"] },
    ],
  }),
  caso("10. board TODO manual (sem requisitos): derivação para na 1ª; card em outra coluna fica fixado", {
    board: ["Entrada", "Meio", "Fim"],
    requisitos: {},
    status: "fim",
    esperado: { derivavel: true, alvo: "entrada", resultado: "fim", fixado: true, faltando: [] },
    arrastes: [
      { para: "entrada", acao: "soltar", status: "entrada", faltando: [] },
      { para: "meio", acao: "fixar", status: "meio", faltando: [] },
    ],
  }),
  caso("11. board VAZIO → a pura cai no board padrão do Dev (1ª = em_modelagem), sem requisitos = manual", {
    board: [],
    requisitos: {},
    status: "em_modelagem",
    esperado: { derivavel: true, alvo: "em_modelagem", resultado: "em_modelagem", fixado: false, faltando: [] },
  }),
  caso("12. status NULL (produto fora do PL) → não derivável: sem alvo, resultado null", {
    status: null,
    esperado: { derivavel: false, alvo: null, resultado: null, fixado: false, faltando: [] },
    arrastes: [{ para: "oficina", acao: "fixar", status: "oficina", faltando: [] }],
  }),
  caso("13. Reprovado é SEMPRE manual: requisito configurado nele é ignorado; card em reprovado = fixado", {
    board: ["Peça Teste", "Oficina", "Reprovado"],
    requisitos: { peca_teste: ["tem_peca_teste"], oficina: ["oficina_entregue"], reprovado: ["cq_liberado"] },
    status: "reprovado",
    satisfeitas: { tem_peca_teste: true, oficina_entregue: true },
    esperado: { derivavel: true, alvo: "oficina", resultado: "reprovado", fixado: true, faltando: [] },
    arrastes: [{ para: "reprovado", acao: "nada", status: "reprovado", faltando: [] }],
  }),
  caso("14. board com label repetido e objeto + status com caixa/espaço → dedup por key e normalização do status", {
    board: ["Peça Teste", { key: "oficina", label: "Oficina" }, "Peça Teste", "Stand By"],
    requisitos: { peca_teste: ["tem_peca_teste"], oficina: ["oficina_entregue"] },
    status: "  Stand_By ",
    satisfeitas: { tem_peca_teste: true, oficina_entregue: true },
    esperado: { derivavel: true, alvo: "oficina", resultado: "stand_by", fixado: true, faltando: [] },
  }),
  caso("15. requisito de chave desconhecida nunca é satisfeito (mapa sem a chave = falso)", {
    board: ["Peça Teste", "Oficina"],
    requisitos: { peca_teste: ["tem_peca_teste"], oficina: ["condicao_que_nao_existe"] },
    status: "peca_teste",
    satisfeitas: { tem_peca_teste: true, condicao_que_nao_existe: false },
    esperado: { derivavel: true, alvo: "peca_teste", resultado: "peca_teste", fixado: false, faltando: ["condicao_que_nao_existe"] },
  }),
];
