// Conteúdo do Manual — módulos Financeiro e Dashboard.
// Formato "guia de uso" (passo a passo + fio do processo), molde da tela Atributos (cadastro.ts):
// para-que-serve = o fluxo (de onde nascem as contas / como se lê o painel) + como-usar com blocos
// { tipo: "passos", itens: [...] } + os campos. Fiel aos componentes (financeiro.tsx, dashboard.tsx).
import { p, type ConteudoTelas, type SecaoConteudoManual } from "./tipos";

/* ===================================================================== */
/* FINANCEIRO — a mesma tela, com quatro abas (Calendário, OCs, Serviços, */
/* Resumo). São telas de PAGAR e acompanhar vencimentos.                 */
/* ===================================================================== */

const FINANCEIRO_CALENDARIO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "O fio do Financeiro",
    intro: [
      p("As contas a pagar não são digitadas aqui: elas NASCEM sozinhas das Ordens de Compra (tecidos, aviamentos, insumos, produto acabado e importado) e dos serviços de confecção. Cada parcela de uma OC ou de um serviço com vencimento vira uma conta. O Financeiro é onde você PAGA essas contas e ACOMPANHA os vencimentos — não é onde você as cria."),
      p("O Calendário espalha essas contas pelos dias do mês: cada conta aparece no seu dia de vencimento, com uma marca de cor. É a visão de QUANDO o dinheiro sai."),
      p("O Financeiro é uma tela só, com quatro abas no topo: Calendário (esta, a visão por dia), OCs (as contas de compra), Serviços (a mão de obra) e Resumo (o fechamento). Você troca de aba no topo; o que você vê e pode mexer em cada uma depende das suas permissões."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar o Calendário",
    intro: [p("A tela abre no mês atual. Use as setas para andar entre os meses; cada dia mostra as contas que vencem nele, com a marca de cor da situação.")],
    campos: [
      { campo: "ver_mes", rotulo: "Como ver o que vence no mês", ajuda: [
        { tipo: "passos", itens: [
          "Abra a aba Calendário (ela é a aba padrão de quem tem a permissão).",
          "Use as setas para a esquerda/direita no topo para trocar de mês.",
          "Leia os dias: cada conta aparece no seu dia de vencimento, colorida pela situação (pago, vence breve, vencido, a vencer — ver a legenda abaixo).",
          "O \"hoje\" é calculado no fuso da sua loja, não no do seu aparelho — então \"vencido\" e \"vence breve\" batem com o relógio da loja.",
        ] },
      ] },
      { campo: "abrir_conta", rotulo: "Como abrir e pagar uma conta pelo dia", ajuda: [
        { tipo: "passos", itens: [
          "Clique numa conta do dia (ou no próprio dia, que abre a lista das contas dele).",
          "No detalhe você confere os dados, ajusta o vencimento, marca como paga e vê o comprovante.",
          "Marcar como paga segue o mesmo diálogo das OCs (data do pagamento + comprovante opcional) — ver a aba OCs.",
          "Uma conta de SERVIÇO clicada no Calendário leva você para a aba Serviços, onde ela é tratada (só com a permissão de Serviços).",
        ] },
      ] },
    ],
  },
  {
    id: "estados",
    titulo: "As marcas do dia (pago, vence breve, vencido, a vencer)",
    intro: [p("Cada conta aparece no seu dia de vencimento com uma marca de cor e um ícone. São quatro situações, sempre com o mesmo ícone na legenda, no detalhe do dia e nas tabelas das outras abas.")],
    campos: [
      { campo: "pago", rotulo: "Pago", ajuda: [p("A parcela já foi paga. O status \"pago\" é definido quando você marca a conta como paga — não vem sozinho.")] },
      { campo: "vence_breve", rotulo: "Vence em ≤ 3 dias", ajuda: [p("A conta ainda não foi paga e vence nos próximos 3 dias. É um realce dentro de \"a vencer\" — serve de alerta, não muda o status.")] },
      { campo: "vencido", rotulo: "Vencido", ajuda: [p("A conta não foi paga e a data de vencimento já passou. O dia de hoje é calculado no fuso da sua loja.")] },
      { campo: "a_vencer", rotulo: "A vencer", ajuda: [p("A conta ainda não foi paga e o vencimento é mais de 3 dias à frente.")] },
    ],
  },
];

const FINANCEIRO_PARCELAS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve a aba OCs",
    intro: [
      p("A aba OCs lista as parcelas a pagar das Ordens de Compra — tecidos, aviamentos, insumos, produto acabado e importado. É aqui que você quita as contas de COMPRA: vê o que vence, marca como pago e anexa o comprovante."),
      p("As parcelas chegam prontas da OC: quando a compra tem prazo (30/60/90…) e a Nota de Entrada, o sistema já distribui as parcelas e calcula os vencimentos. Você não digita parcela — você paga a que já existe."),
      p("Serviços de confecção têm aba própria (Serviços). Aqui só entram as parcelas das OCs."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar a aba OCs",
    intro: [p("A lista traz uma linha por parcela, com filtros (origem, fornecedor, status, período) no topo e os totais no rodapé. Pagar e desmarcar o pagamento são as duas ações centrais — e são permissão de EDIÇÃO do Financeiro (quem só tem a visão vê os valores, mas não mexe).")],
    campos: [
      { campo: "marcar_pago", rotulo: "Como marcar uma parcela como paga", ajuda: [
        { tipo: "passos", itens: [
          "Na linha da parcela, clique em \"Marcar pago\".",
          "No diálogo, confirme a data do pagamento (já vem preenchida com o dia de hoje, no fuso da loja).",
          "Se quiser, anexe o comprovante (imagem ou PDF) — é opcional e pode ser anexado depois também.",
          "Confirme. A parcela passa a \"pago\" e some das contas em aberto; a data do pagamento aparece na coluna Pagamento.",
        ] },
      ] },
      { campo: "comprovante_depois", rotulo: "Como anexar (ou trocar) o comprovante depois", ajuda: [
        { tipo: "passos", itens: [
          "Numa parcela já paga, clique no ícone de anexar na linha (ou no detalhe da parcela).",
          "Escolha o arquivo (imagem ou PDF). Se já havia um comprovante, o novo substitui o atual.",
          "Confirme. O comprovante-imagem abre ampliado ao clicar em \"Ver comprovante\".",
        ] },
      ] },
      { campo: "desmarcar", rotulo: "Como desmarcar um pagamento", ajuda: [
        { tipo: "passos", itens: [
          "Na linha (ou no detalhe), clique em \"Desmarcar\".",
          "Confirme no aviso \"Tem certeza?\" — desmarcar DESFAZ: a parcela volta a \"a pagar\" e a data do pagamento some.",
          "Atenção: numa parcela paga de uma OC de tecido CANCELADA, desmarcar fica bloqueado (a parcela sumiria da lista) — o botão explica o motivo.",
        ] },
      ] },
      { campo: "ajustar_vencimento", rotulo: "Como ajustar um vencimento à mão", ajuda: [
        { tipo: "passos", itens: [
          "Abra o detalhe da parcela (não paga — parcela paga não tem o vencimento editável).",
          "Edite a data de vencimento (é permissão do Financeiro).",
          "A partir daí essa data passa a ser RESPEITADA: recalcular as parcelas, mudar a Data da Nota ou o prazo não mexe mais nela — só as outras parcelas se ajustam. O valor não muda.",
          "Para voltar ao cálculo pela Nota + prazo, use \"Voltar ao cálculo automático\" no detalhe da parcela (confirme no aviso).",
        ] },
      ] },
    ],
  },
  {
    id: "colunas",
    titulo: "As colunas da lista",
    campos: [
      { campo: "status", rotulo: "Status (A pagar · Pago · Vencido)", ajuda: [p("A situação da parcela. \"Vencido\" e \"A pagar\" não são escolhidos à mão: saem da data de vencimento comparada com hoje. \"Pago\" aparece quando a conta é marcada como paga.")] },
      { campo: "vencimento", rotulo: "Vencimento", quando: "editável", ajuda: [
        p("A data em que a parcela vence. Por padrão é calculada pela OC: Data da Nota de Entrada mais o prazo do fornecedor; sem a Nota, vale a data de entrega ou do pedido."),
        p("Pode ser ajustada à mão (ver \"Como ajustar um vencimento\" acima). Parcela já paga não é editável."),
      ] },
      { campo: "provisoria", rotulo: "Vencimento provisório", quando: "quando falta a Nota", ajuda: [p("Quando a OC foi recebida mas ainda não tem a Data da Nota de Entrada, a parcela ganha a tag de vencimento provisório: a data mostrada é uma estimativa até a Nota chegar.")] },
      { campo: "valor", rotulo: "Valor", ajuda: [p("O valor da parcela. Não muda ao ajustar o vencimento.")] },
      { campo: "pagamento", rotulo: "Pagamento", ajuda: [p("A data em que a parcela foi paga, preenchida ao marcar como pago. Fica \"—\" enquanto a conta não foi paga.")] },
    ],
  },
];

const FINANCEIRO_SERVICOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve a aba Serviços",
    intro: [
      p("A aba Serviços lista as contas a pagar dos serviços de confecção (terceirizados): a mão de obra das oficinas e prestadores. É onde essas parcelas são quitadas, separadas das compras (OCs)."),
      p("Uma parcela de serviço só entra no Financeiro depois que a etapa correspondente é CONCLUÍDA (o serviço passa pelo seu fluxo antes de virar conta a pagar — oficina, por exemplo, entra após o CQ). Ou seja: a conta nasce do serviço feito, você só paga."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar a aba Serviços",
    intro: [p("Funciona como a aba OCs, com os mesmos diálogos de pagar/desmarcar. Os filtros (fornecedor, status, período) encolhem a lista e os totais do rodapé junto.")],
    campos: [
      { campo: "marcar_pago", rotulo: "Como marcar um serviço como pago", ajuda: [
        { tipo: "passos", itens: [
          "Na linha da parcela do serviço, clique em \"Marcar pago\".",
          "Confirme a data do pagamento e, se quiser, anexe o comprovante (igual ao das OCs).",
          "Confirme. A parcela vira \"pago\".",
        ] },
      ] },
      { campo: "desmarcar", rotulo: "Como desmarcar o pagamento de um serviço", ajuda: [
        { tipo: "passos", itens: [
          "Clique em \"Desmarcar\" na linha ou no detalhe.",
          "Confirme no aviso \"Tem certeza?\" — a parcela volta a \"a pagar\".",
        ] },
      ] },
      { campo: "ajustar_vencimento", rotulo: "Como ajustar o vencimento à mão", ajuda: [
        { tipo: "passos", itens: [
          "Edite a data de vencimento de uma parcela não paga (permissão do Financeiro).",
          "A data ajustada passa a ser respeitada: mudar a entrega ou o prazo do serviço não mexe nela, só nas outras parcelas.",
          "Use \"Voltar ao automático\" para desfazer — a parcela ganha o selo \"ajustado à mão\" enquanto a data for manual.",
        ] },
      ] },
    ],
  },
  {
    id: "colunas",
    titulo: "As colunas da lista",
    campos: [
      { campo: "fornecedor", rotulo: "Fornecedor / Prestador", ajuda: [p("Quem presta o serviço. Serve de filtro para ver as contas de uma oficina específica.")] },
      { campo: "servico", rotulo: "Serviço · REF", ajuda: [p("O serviço e o produto (REF) a que a parcela se refere.")] },
      { campo: "vencimento", rotulo: "Vencimento", quando: "editável", ajuda: [p("A data em que a parcela vence, calculada pela entrega e pelo prazo do serviço. Pode ser ajustada à mão; parcela paga não é editável.")] },
      { campo: "valor", rotulo: "Valor", ajuda: [p("O valor da parcela do serviço.")] },
    ],
  },
  {
    id: "totais",
    titulo: "Totais do rodapé",
    intro: [p("No rodapé a aba mostra os totais do que está filtrado, separando Pago e A pagar, além do total geral. Os filtros (fornecedor, status, período) encolhem esses totais junto com a lista.")],
  },
];

const FINANCEIRO_RESUMO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve o Resumo",
    intro: [
      p("O Resumo é a visão de FECHAMENTO: soma o que você deve e o que já pagou, juntando as parcelas de OCs e de serviços num só lugar — totais a pagar, pago e vencido, com um gráfico por mês de vencimento para você ver em que meses o caixa aperta."),
      p("É uma tela de LEITURA (não se paga por aqui — isso é nas abas OCs e Serviços). Serve para enxergar o conjunto."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como ler o Resumo",
    intro: [p("Escolha o recorte no topo e leia os totais e o gráfico. No celular, o Resumo abre com as contagens e as próximas parcelas (as não pagas mais urgentes primeiro).")],
    campos: [
      { campo: "filtrar", rotulo: "Como filtrar o que entra no Resumo", ajuda: [
        { tipo: "passos", itens: [
          "Use o seletor de origem no topo para escolher que contas entram: só as de um tipo de OC (Tecidos, Aviamentos, Insumos, Produto Acabado, Produto Importado), só as de Serviços, ou todas.",
          "Afine ainda por fornecedor, mês e intervalo de datas.",
          "Os totais e o gráfico encolhem junto com o filtro — serve para olhar o investimento por tipo separadamente.",
        ] },
      ] },
      { campo: "ler_grafico", rotulo: "Como ler o gráfico por mês", ajuda: [p("O gráfico distribui os valores por mês de vencimento, separando pago, a pagar e vencido — você vê em que meses as contas se concentram.")] },
    ],
  },
  {
    id: "totais",
    titulo: "Os totais",
    campos: [
      { campo: "a_pagar", rotulo: "A pagar", ajuda: [p("A soma das parcelas em aberto que ainda não venceram, dentro do filtro.")] },
      { campo: "pago", rotulo: "Pago", quando: "conta pelo vencimento", ajuda: [
        p("A soma das parcelas pagas cujo VENCIMENTO cai no período filtrado."),
        p("Atenção: o Dashboard conta o pago pela data do PAGAMENTO, por isso os dois totais podem não bater — não é erro, é critério diferente."),
      ] },
      { campo: "vencido", rotulo: "Vencido", ajuda: [p("A soma das parcelas não pagas cujo vencimento já passou.")] },
    ],
  },
];

/* ===================================================================== */
/* DASHBOARD — abas por gestor + as permissões de DADOS ("Dados: …").     */
/* As abas por gestor são painéis de LEITURA: o Manual explica COMO LER.  */
/* ===================================================================== */

const DASHBOARD_DESENVOLVIMENTO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "O que a aba Desenvolvimento mostra",
    intro: [
      p("A aba Desenvolvimento é o painel do gestor de Criação — uma tela de LEITURA. Ela abre com a \"Ação de hoje\": o que está travado contra o prazo (SLA), o que está em atenção, o que já está pronto para lançar e qual é o maior gargalo — e sugere o que destravar primeiro."),
      p("Mostra também os produtos por etapa do quadro (kanban) e o funil da coleção. As listas longas viram top-N (os primeiros do ranking); clicar num item leva ao Desenvolvimento para ver o detalhe."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como ler esta aba",
    intro: [
      p("Comece pela \"Ação de hoje\" no topo: ela responde \"o que eu faço agora?\". Depois desça para os produtos por etapa e o funil."),
      p("Filtre por Coleção (e Subcoleção) no topo para focar numa coleção. Clique num cartão/linha para abrir aquele produto no Desenvolvimento. Os números dependem das permissões de Dados: Coleção e Dados: Produção (ver abaixo)."),
    ],
  },
];

const DASHBOARD_PRODUCAO_QUALIDADE: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "O que a aba Produção & Qualidade mostra",
    intro: [
      p("A aba Produção & Qualidade é o painel do gestor de PCP — tela de LEITURA. Abre com a \"Ação de hoje\": CQ pendente, Direcionamento a fazer, entregas no prazo e defeito médio."),
      p("Segue com o WIP na rua por idade (há quanto tempo cada lote está fora), o ranking de oficinas e a meta da coleção. As contagens de CQ e Direcionamento espelham exatamente o que as telas de CQ e Direcionamento mostram, para o painel bater com a operação."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como ler esta aba",
    intro: [
      p("Leia a \"Ação de hoje\" para saber o que priorizar (CQ e Direcionamento pendentes). O WIP por idade mostra o que está parado há mais tempo; o ranking de oficinas, quem entrega melhor."),
      p("Filtre por Coleção/Subcoleção para focar. Depende da permissão de Dados: Produção."),
    ],
  },
];

const DASHBOARD_COMERCIAL_COLECAO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "O que a aba Comercial & Coleção mostra",
    intro: [
      p("A aba Comercial & Coleção é o painel do gestor comercial — tela de LEITURA. Abre com o resultado da coleção (poder de venda, margem, lucro e ticket) e detalha por linha: poder de venda (planejado × realizado) e margem contra a faixa cadastrada."),
      p("A matemática é a mesma do preço efetivo (custo → markup → venda). Para os números aparecerem preenchidos, precisa das permissões de Dados: Custos e Dados: Comercial."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como ler esta aba",
    intro: [
      p("Leia o resultado geral da coleção no topo e, na tabela, compare por linha o planejado × realizado e a margem contra a faixa (Mínimo/Ideal/Máximo) cadastrada."),
      p("Filtre por Coleção e Subcoleção para olhar uma coleção de cada vez. Sem as permissões de Dados: Custos/Comercial, as colunas de números ficam vazias mesmo com a aba liberada."),
    ],
  },
];

const DASHBOARD_CUSTO_FINANCEIRO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "O que a aba Custo & Financeiro mostra",
    intro: [
      p("A aba Custo & Financeiro é o painel do gestor de controladoria — tela de LEITURA. Abre com a \"Ação de hoje\": a pagar em aberto e vencendo em 30 dias, estoque parado em R$, investido em matéria-prima e % pago."),
      p("Compara custo previsto × real nos produtos mais divergentes e mostra o a pagar dos próximos meses. Atenção: o \"pago\" aqui conta pela data do PAGAMENTO (o Resumo do Financeiro conta pelo VENCIMENTO), então os dois podem divergir — não é erro, é critério diferente."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como ler esta aba",
    intro: [
      p("Comece pela \"Ação de hoje\" (quanto vence em 30 dias, quanto está parado em estoque). Depois veja os produtos onde o custo real mais se afastou do previsto e o a pagar dos próximos meses."),
      p("Use o seletor de período no topo. Depende das permissões de Dados: Financeiro e Dados: Custos."),
    ],
  },
];

const DASHBOARD_LEADTIME: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "O que a aba Leadtime mostra",
    intro: [
      p("A aba Leadtime é uma tela de LEITURA: mostra quanto TEMPO cada produto leva em cada etapa — as médias por fase nos cartões e o detalhamento por item na tabela —, para encontrar onde o processo demora."),
      p("Traz ainda o SLA por prestador de serviço: tempo médio, atrasos, entregas e taxa de defeito."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como ler esta aba",
    intro: [
      p("Olhe as médias por fase nos cartões para achar a etapa mais lenta; desça para a tabela item × etapas para ver onde um produto específico parou."),
      p("Um filtro global (coleção, subcoleção, semana) move os cartões e a tabela JUNTOS — ajuste ali para comparar o mesmo recorte em toda a aba."),
    ],
  },
];

/* --- As seis permissões de DADOS ("Dados: …"): não são telas próprias --- */
// Rótulo "Dados: …" no editor de permissões. Cada uma libera os NÚMEROS de uma ou mais abas.

const DADOS_INTRO =
  "Esta não é uma tela: é uma permissão de DADOS do Dashboard. Ela controla QUAIS números aparecem nas abas por gestor. Sem ela, a aba abre, mas o gráfico/coluna que depende desses dados fica vazio ou sem permissão — mesmo com a aba liberada.";

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
