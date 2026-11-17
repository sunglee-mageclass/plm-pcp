// Conteúdo do Manual — módulos Financeiro e Dashboard.
// Fiel aos InfoHover e aos comentários das telas (financeiro.tsx, dashboard.tsx) e ao catálogo de permissões.
import { p, type ConteudoTelas, type SecaoConteudoManual } from "./tipos";

/* ===================================================================== */
/* FINANCEIRO — a mesma tela, com quatro abas (Calendário, OCs, Serviços, */
/* Resumo).                                                              */
/* ===================================================================== */

const FINANCEIRO_CALENDARIO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("O Calendário mostra as contas a pagar espalhadas pelos dias do mês: cada conta é uma parcela de uma OC (compra) ou de um serviço de confecção que tem vencimento. É a visão de quando o dinheiro sai."),
      p("O Financeiro é uma tela só, com quatro abas: Calendário (esta), OCs, Serviços e Resumo. Você troca de aba no topo; o que você pode ver em cada uma depende das suas permissões."),
    ],
  },
  {
    id: "estados",
    titulo: "As marcas do dia (pago, vence breve, vencido, a vencer)",
    intro: [p("Cada parcela aparece no seu dia de vencimento com uma marca de cor e ícone. São quatro situações, sempre com o mesmo ícone na legenda, no popover do dia e nas tabelas.")],
    campos: [
      { campo: "pago", rotulo: "Pago", ajuda: [p("A parcela já foi paga. O status “pago” é definido quando você marca a conta como paga.")] },
      { campo: "vence_breve", rotulo: "Vence em ≤ 3 dias", ajuda: [p("A conta ainda não foi paga e vence nos próximos 3 dias. É um realce dentro de “a vencer” — serve de alerta, não muda o status.")] },
      { campo: "vencido", rotulo: "Vencido", ajuda: [p("A conta não foi paga e a data de vencimento já passou. O dia de hoje é calculado no fuso da sua loja, não no do aparelho.")] },
      { campo: "a_vencer", rotulo: "A vencer", ajuda: [p("A conta ainda não foi paga e o vencimento é mais de 3 dias à frente.")] },
    ],
  },
  {
    id: "abrir-conta",
    titulo: "Abrir uma conta do calendário",
    intro: [p("Clicar numa conta abre o detalhe dela, de onde você confere os dados, ajusta o vencimento, marca como paga e vê o comprovante. Serviços clicados no calendário pulam para a aba Serviços, onde são tratados.")],
  },
];

const FINANCEIRO_PARCELAS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A aba OCs lista as parcelas a pagar das Ordens de Compra — tecidos, aviamentos, insumos, produto acabado e importado. É a tela de quitar as contas de compra: ver o que vence, marcar como pago e anexar o comprovante."),
      p("Serviços de confecção têm aba própria (Serviços) — aqui só entram as parcelas das OCs."),
    ],
  },
  {
    id: "colunas",
    titulo: "As colunas da lista",
    campos: [
      { campo: "status", rotulo: "Status (A pagar · Pago · Vencido)", ajuda: [p("A situação da parcela. “Vencido” e “A pagar” não são escolhidos à mão: saem da data de vencimento comparada com hoje. “Pago” aparece quando a conta é marcada como paga.")] },
      { campo: "vencimento", rotulo: "Vencimento", quando: "editável", ajuda: [
        p("A data em que a parcela vence. Por padrão ela é calculada pela OC: Data da Nota de Entrada mais o prazo do fornecedor; sem a Nota, vale a data de entrega ou do pedido."),
        p("Você pode ajustar essa data à mão (é uma permissão do Financeiro). Uma parcela já paga não tem o vencimento editável."),
      ] },
      { campo: "provisoria", rotulo: "Vencimento provisório", quando: "quando falta a Nota", ajuda: [p("Quando a OC foi recebida mas ainda não tem a Data da Nota de Entrada, a parcela ganha uma tag de vencimento provisório: a data mostrada é uma estimativa até a Nota chegar.")] },
      { campo: "valor", rotulo: "Valor", ajuda: [p("O valor da parcela. Ele não muda ao ajustar o vencimento.")] },
      { campo: "pagamento", rotulo: "Pagamento", ajuda: [p("A data em que a parcela foi paga, preenchida ao marcar como pago. Fica “—” enquanto a conta não foi paga.")] },
    ],
  },
  {
    id: "pagar",
    titulo: "Marcar como pago e desmarcar",
    intro: [p("Pagar e desmarcar o pagamento são as duas ações centrais da aba. São permissão de edição do Financeiro — quem só tem a visão vê os valores mas não mexe.")],
    campos: [
      { campo: "marcar_pago", rotulo: "Marcar pago", ajuda: [p("Abre um diálogo onde você confirma a data do pagamento e, se quiser, anexa o comprovante. Ao confirmar, a parcela passa a “pago” e some das contas em aberto.")] },
      { campo: "comprovante", rotulo: "Comprovante", quando: "opcional", ajuda: [p("O comprovante do pagamento (imagem ou arquivo). Pode ser anexado na hora de pagar ou depois, pela conta já paga. O comprovante-imagem abre ampliado em lightbox.")] },
      { campo: "desmarcar", rotulo: "Desmarcar pago", ajuda: [
        p("Desfaz o pagamento: a parcela volta a “a pagar” e a data de pagamento some. A tela pede confirmação antes, porque é uma ação que desfaz."),
        p("Numa parcela paga de uma OC de tecido cancelada, desmarcar fica bloqueado (a parcela sumiria da lista) — o botão explica o motivo."),
      ] },
    ],
  },
  {
    id: "vencimento-manual",
    titulo: "Vencimento ajustado à mão",
    intro: [p("Quando você edita o vencimento de uma parcela à mão, essa data passa a ser respeitada: recalcular as parcelas, mudar a Data da Nota ou o prazo não mexe mais nela — só as outras parcelas se ajustam. Use “Voltar ao cálculo automático” no detalhe da parcela para desfazer e deixar a data acompanhar a Nota e o prazo de novo (o valor não muda).")],
  },
];

const FINANCEIRO_SERVICOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A aba Serviços lista as contas a pagar dos serviços de confecção (terceirizados): a mão de obra das oficinas e prestadores. É onde essas parcelas são quitadas, separadas das compras (OCs)."),
      p("Uma parcela de serviço só entra no financeiro depois que a etapa correspondente é concluída (o serviço passa pelo seu fluxo antes de virar conta a pagar).")],
  },
  {
    id: "colunas",
    titulo: "As colunas da lista",
    campos: [
      { campo: "fornecedor", rotulo: "Fornecedor / Prestador", ajuda: [p("Quem presta o serviço. Serve de filtro para ver as contas de uma oficina específica.")] },
      { campo: "servico", rotulo: "Serviço · REF", ajuda: [p("O serviço e o produto (REF) a que a parcela se refere.")] },
      { campo: "vencimento", rotulo: "Vencimento", quando: "editável", ajuda: [p("A data em que a parcela vence, calculada pela entrega e pelo prazo do serviço. Pode ser ajustada à mão (permissão do Financeiro); uma parcela paga não é editável.")] },
      { campo: "valor", rotulo: "Valor", ajuda: [p("O valor da parcela do serviço.")] },
    ],
  },
  {
    id: "pagar",
    titulo: "Marcar como pago e desmarcar",
    campos: [
      { campo: "marcar_pago", rotulo: "Marcar pago", ajuda: [p("Abre o diálogo de pagamento (data e comprovante), igual ao das OCs. Ao confirmar, a parcela vira “pago”.")] },
      { campo: "desmarcar", rotulo: "Desmarcar", ajuda: [p("Desfaz o pagamento do serviço: a parcela volta a “a pagar”. A tela pede confirmação antes, por ser uma ação que desfaz.")] },
    ],
  },
  {
    id: "vencimento-manual",
    titulo: "Vencimento ajustado à mão",
    intro: [p("Como nas OCs: uma data de vencimento ajustada à mão passa a ser respeitada — mudar a entrega ou o prazo do serviço não mexe nela, só nas outras parcelas. Use “Voltar ao cálculo automático” para desfazer.")],
  },
  {
    id: "totais",
    titulo: "Totais do rodapé",
    intro: [p("No rodapé a aba mostra os totais do que está filtrado: o total geral, o pago e o a pagar. Os filtros (fornecedor, status, período) encolhem esses totais junto com a lista.")],
  },
];

const FINANCEIRO_RESUMO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("O Resumo soma o que você deve e o que já pagou, juntando as parcelas de OCs e de serviços num só lugar. É a visão de fechamento: totais a pagar, pago e vencido, com um gráfico por mês de vencimento."),
      p("Os totais seguem os filtros de origem (Tecidos, Aviamentos, Insumos, Produto Acabado, Produto Importado, Serviços ou todos), fornecedor, mês e intervalo de datas."),
    ],
  },
  {
    id: "totais",
    titulo: "Os totais",
    campos: [
      { campo: "a_pagar", rotulo: "A pagar", ajuda: [p("A soma das parcelas em aberto que ainda não venceram, dentro do filtro.")] },
      { campo: "pago", rotulo: "Pago", quando: "conta pelo vencimento", ajuda: [
        p("A soma das parcelas pagas cujo VENCIMENTO cai no período filtrado."),
        p("O Dashboard conta o pago pela data do PAGAMENTO, por isso os dois totais podem não bater — não é erro, é critério diferente."),
      ] },
      { campo: "vencido", rotulo: "Vencido", ajuda: [p("A soma das parcelas não pagas cujo vencimento já passou.")] },
    ],
  },
  {
    id: "grafico",
    titulo: "Gráfico por mês e próximas contas",
    intro: [p("O gráfico distribui os valores por mês de vencimento, separando pago, a pagar e vencido, para você ver em que meses o caixa aperta. No celular, o Resumo abre com as contagens e as próximas parcelas (as não pagas mais urgentes primeiro).")],
  },
  {
    id: "origem",
    titulo: "Filtro por origem",
    intro: [p("O seletor de origem (no topo) escolhe que contas entram no gráfico e nos totais: só as de um tipo de OC, só as de serviço, ou todas. Serve para olhar o investimento por tipo separadamente.")],
  },
];

/* ===================================================================== */
/* DASHBOARD — abas por gestor + as permissões de DADOS ("Dados: …").    */
/* ===================================================================== */

const DASHBOARD_DESENVOLVIMENTO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A aba Desenvolvimento é o painel do gestor de Criação. Abre com a “Ação de hoje” — o que está travado contra o prazo (SLA), o que está em atenção, o que está pronto para lançar e qual é o maior gargalo — e sugere o que destravar primeiro."),
      p("Mostra também os produtos por etapa do quadro (kanban) e o funil da coleção. As listas longas viram top-N; clicar leva ao Desenvolvimento para ver o detalhe."),
    ],
  },
];

const DASHBOARD_PRODUCAO_QUALIDADE: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A aba Produção & Qualidade é o painel do gestor de PCP. Abre com a “Ação de hoje” — CQ pendente, Direcionamento a fazer, entregas no prazo e defeito médio — e segue com o WIP na rua por idade, o ranking de oficinas e a meta da coleção."),
      p("As contagens de CQ e Direcionamento espelham exatamente o que as telas de CQ e Direcionamento mostram, para o painel bater com a operação."),
    ],
  },
];

const DASHBOARD_COMERCIAL_COLECAO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A aba Comercial & Coleção é o painel do gestor comercial. Abre com o resultado da coleção — poder de venda, margem, lucro e ticket — e detalha por linha: poder de venda (planejado × realizado) e margem contra a faixa cadastrada."),
      p("A matemática é a mesma do preço efetivo (custo → markup → venda). Precisa das permissões de Dados: Custos e Dados: Comercial para preencher os números."),
    ],
  },
];

const DASHBOARD_CUSTO_FINANCEIRO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A aba Custo & Financeiro é o painel do gestor de controladoria. Abre com a “Ação de hoje” — a pagar em aberto e vencendo em 30 dias, estoque parado em R$, investido em matéria-prima e % pago — e compara custo previsto × real nos produtos mais divergentes, além do a pagar dos próximos meses."),
      p("O “pago” aqui conta pela data do pagamento (o Resumo do Financeiro conta pelo vencimento), então os dois podem divergir."),
    ],
  },
];

const DASHBOARD_LEADTIME: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A aba Leadtime mostra quanto tempo cada produto leva em cada etapa — as médias por fase nos cartões e o detalhamento por item na tabela —, para encontrar onde o processo demora."),
      p("Um filtro global (coleção, subcoleção, semana) move os cartões e a tabela juntos. Traz ainda o SLA por prestador de serviço: tempo médio, atrasos, entregas e taxa de defeito."),
    ],
  },
];

/* --- As seis permissões de DADOS ("Dados: …"): não são telas próprias --- */
// Rótulo "Dados: …" no editor de permissões. Cada uma libera os NÚMEROS de uma ou mais abas.

const DADOS_INTRO =
  "Esta não é uma tela: é uma permissão de DADOS do Dashboard. Ela controla QUAIS números aparecem nas abas por gestor. Sem ela, a aba abre, mas o gráfico que depende desses dados fica vazio ou sem permissão — mesmo com a aba liberada.";

const DASHBOARD_COLECAO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Dados: Coleção",
    intro: [p(DADOS_INTRO), p("Alimenta o funil e os números de coleção da aba Desenvolvimento.")],
  },
];

const DASHBOARD_ESTOQUE: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Dados: Estoque",
    intro: [p(DADOS_INTRO), p("Permissão de dados de estoque do Dashboard. Fica listada junto de Custo & Financeiro (vizinha do estoque parado), mas hoje nenhuma aba consome esses números diretamente.")],
  },
];

const DASHBOARD_PRODUCAO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Dados: Produção",
    intro: [p(DADOS_INTRO), p("Alimenta os números de produção das abas Desenvolvimento e Produção & Qualidade (kanban, WIP, ranking de oficinas).")],
  },
];

const DASHBOARD_FINANCEIRO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Dados: Financeiro",
    intro: [p(DADOS_INTRO), p("Alimenta os números financeiros da aba Custo & Financeiro (a pagar, investido, % pago).")],
  },
];

const DASHBOARD_CUSTOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Dados: Custos",
    intro: [
      p(DADOS_INTRO),
      p("Alimenta os números de custo das abas Comercial & Coleção e Custo & Financeiro. Junto com Dados: Comercial, também libera ver o custo no card do produto, fora do Dashboard."),
    ],
  },
];

const DASHBOARD_COMERCIAL: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Dados: Comercial",
    intro: [
      p(DADOS_INTRO),
      p("Alimenta os números comerciais (poder de venda, margem, lucro, ticket) da aba Comercial & Coleção. Junto com Dados: Custos, também libera ver o custo no card do produto, fora do Dashboard."),
    ],
  },
];

/** Telas dos módulos Financeiro e Dashboard documentadas à mão. */
export const FINANCEIRO_DASHBOARD_CONTEUDO: ConteudoTelas = {
  financeiro_calendario: FINANCEIRO_CALENDARIO,
  financeiro_parcelas: FINANCEIRO_PARCELAS,
  financeiro_servicos: FINANCEIRO_SERVICOS,
  financeiro_resumo: FINANCEIRO_RESUMO,
  dashboard_desenvolvimento: DASHBOARD_DESENVOLVIMENTO,
  dashboard_producao_qualidade: DASHBOARD_PRODUCAO_QUALIDADE,
  dashboard_comercial_colecao: DASHBOARD_COMERCIAL_COLECAO,
  dashboard_custo_financeiro: DASHBOARD_CUSTO_FINANCEIRO,
  dashboard_leadtime: DASHBOARD_LEADTIME,
  dashboard_colecao: DASHBOARD_COLECAO,
  dashboard_estoque: DASHBOARD_ESTOQUE,
  dashboard_producao: DASHBOARD_PRODUCAO,
  dashboard_financeiro: DASHBOARD_FINANCEIRO,
  dashboard_custos: DASHBOARD_CUSTOS,
  dashboard_comercial: DASHBOARD_COMERCIAL,
};
