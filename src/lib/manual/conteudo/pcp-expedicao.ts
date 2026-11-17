// Conteúdo do Manual — módulos PCP e Expedição.
// Fiel às telas reais (Serviços, Oficina, Etapas PL, CQ, Direcionamento, Lançamentos) e às regras do CLAUDE.md.
import { p, type ConteudoTelas, type SecaoConteudoManual } from "./tipos";

const SERVICOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("Os Serviços são onde você acompanha a confecção terceirizada de um produto que já foi enviado à Explosão: cada serviço (corte, costura, acabamento…) com o fornecedor, o valor, a grade por tamanho × variante, as datas e a Ordem de Serviço (OS) impressa."),
      p("Os serviços aparecem em duas abas — Pré (até costura) e Pós (acabamento) — conforme a etapa de cada tipo de serviço. O produto fica “Finalizado” quando os serviços foram entregues e contados."),
    ],
  },
  {
    id: "lista",
    titulo: "Lista de Serviços",
    intro: [p("A tela de entrada: os produtos que já saíram da Explosão e estão em confecção. Cada linha mostra o produto, a situação e um atalho para abrir.")],
    campos: [
      { campo: "status", rotulo: "Status (Finalizado · Pré finalizado · …)", ajuda: [p("A situação dos serviços do produto. “Finalizado” = os serviços foram entregues e contados (recebido ou defeito); “Pré finalizado” = a costura acabou, mas falta o acabamento (pós). O selo de Peça Teste aparece ao lado quando o produto usa peça-teste.")] },
      { campo: "busca_filtros", rotulo: "Buscar · Filtrar · Imprimir Ficha Técnica", ajuda: [p("A busca encontra pela REF ou pelo nome; os filtros (coleção, mês, ano, status) afinam a lista. O botão de impressão abre a Ficha Técnica do produto.")] },
    ],
  },
  {
    id: "bloco-servico",
    titulo: "Bloco de serviço",
    intro: [p("Cada serviço do produto é um bloco: o fornecedor, o preço, as datas, a grade e o valor a pagar. O cabeçalho do bloco mostra a situação (pendente, em andamento ou finalizado) e o alerta de atraso quando a previsão passou.")],
    campos: [
      { campo: "responsavel", rotulo: "Responsável", ajuda: [p("Quem é o responsável pelo serviço dentro da sua equipe.")] },
      { campo: "empresa", rotulo: "Empresa · Representante (opcional)", ajuda: [p("O fornecedor do serviço: a empresa e, se for o caso, o representante dela. Se não houver empresa cadastrada para o tipo de serviço, a tela avisa — cadastre em Cadastro › Serviço.")] },
      { campo: "preco", rotulo: "Preço por metro/unidade", ajuda: [p("O valor combinado do serviço, por metro ou por peça. Multiplicado pela quantidade enviada, forma o custo bruto.")] },
      { campo: "qtd", rotulo: "Qtd Cortada (Σ grade) · Saldo a receber (Σ)", ajuda: [p("A quantidade cortada é a soma da grade; o saldo a receber é quanto ainda falta voltar. São calculados pelo sistema a partir da grade e do que já foi recebido.")] },
      { campo: "datas", rotulo: "Data Enviado · Data Prevista · Data Entregue", ajuda: [p("Quando o serviço foi enviado ao fornecedor, a previsão de volta e a data em que de fato voltou. A previsão sem entrega gera o alerta de atraso no cabeçalho.")] },
      { campo: "grade_detalhe", rotulo: "Grade por tamanho × variante (Enviada / Recebida / Defeito)", ajuda: [
        p("A quantidade por tamanho e por cor. A coluna “Enviada” já vem pré-preenchida da grade planejada; ajuste conforme o que foi enviado e depois recebido. Essa mesma grade é a base da “Grade Cortada” que o Controle de Qualidade usa."),
      ] },
      { campo: "valores", rotulo: "Desconto total · Multa total · Prazo de Pagamento · Custo Total", ajuda: [p("O desconto e a multa ajustam o valor a pagar; o prazo define as parcelas (que vão para o Financeiro); o Custo Total é o líquido do serviço. Ver valores é uma permissão à parte.")] },
      { campo: "observacao", rotulo: "Observação", ajuda: [p("Um texto livre sobre o serviço.")] },
      { campo: "nf", rotulo: "Notas Fiscais (NF de Saída · NF de Entrada)", quando: "módulo Etapas PL", ajuda: [p("Os números das notas de saída (ao enviar) e de entrada (ao receber). Aparecem quando a loja usa as Etapas PL.")] },
      { campo: "peca_foto", rotulo: "Peça de foto (Previsão de entrega · Data entregue)", quando: "módulo Etapas PL", ajuda: [p("O acompanhamento da peça para foto: a previsão de entrega e a data em que ela chegou. Previsão vencida sem a data entregue acende o alerta de atraso.")] },
      { campo: "imprimir_os", rotulo: "Imprimir OS", ajuda: [p("Gera a Ordem de Serviço do fornecedor — o documento com o que foi enviado, a grade e os dados do serviço.")] },
    ],
  },
  {
    id: "abas",
    titulo: "Abas Pré e Pós",
    intro: [p("Os serviços são separados em duas abas pela etapa do tipo de serviço.")],
    campos: [
      { campo: "pre", rotulo: "Pré (até costura)", ajuda: [p("Os serviços até a costura (corte, costura…).")] },
      { campo: "pos", rotulo: "Pós (acabamento)", ajuda: [p("Os serviços de acabamento depois da costura. Quando o produto “não tem acabamento”, a tela avisa e o produto é considerado Finalizado só com o Pré.")] },
    ],
  },
  {
    id: "resumo",
    titulo: "Resumo do produto",
    intro: [p("O cabeçalho da tela resume a situação dos serviços e o custo.")],
    campos: [
      { campo: "status_resumo", rotulo: "Status Pré · Status Pós · Status Geral", ajuda: [p("A situação de cada etapa e a geral. O produto só fica Finalizado quando o Pré (e o Pós, se houver) estão prontos.")] },
      { campo: "custo_resumo", rotulo: "Grade Total Geral · Custo real / peça · MO Aprovada (planejada)", ajuda: [p("A soma da grade, o custo real por peça (incluindo serviços) e a mão de obra já aprovada. Ver custos é uma permissão à parte — quem não a tem vê “—”.")] },
      { campo: "molde", rotulo: "Observação de Partes do Molde", ajuda: [p("As instruções de corte / partes do molde, usadas também na Oficina. É um texto compartilhado com a ficha de corte.")] },
    ],
  },
  {
    id: "peca-teste",
    titulo: "Peça Teste",
    intro: [p("A aba de acompanhamento das peças-teste do produto, por serviço: cada tentativa registra o fornecedor, as datas e a aprovação. A peça-teste movimenta só o estoque — não entra no custo, não gera conta a pagar.")],
  },
];

const APROVACAO_MO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A Aprovação de mão de obra é a permissão (e a ação) de aprovar ou reprovar o custo da mão de obra de um produto, serviço por serviço. É um controle de dinheiro: enquanto a mão de obra não está aprovada, o produto não pode ser lançado."),
      p("Não é uma tela própria — os botões aparecem na mão de obra do produto (no Sheet do Planejamento e nos cards de Produto Acabado/Importado). Quem não tem esta permissão vê os serviços, mas não aprova nem reprova."),
    ],
  },
  {
    id: "aprovar-reprovar",
    titulo: "Aprovar e reprovar por serviço",
    intro: [p("Cada serviço da mão de obra é decidido na própria linha.")],
    campos: [
      { campo: "aprovar", rotulo: "Aprovar", ajuda: [p("Aprova o custo daquele serviço. Com todos os serviços aprovados (e nada pendente), a mão de obra fica liberada e o produto pode ser lançado.")] },
      { campo: "reprovar", rotulo: "Reprovar", ajuda: [p("Reprova o custo do serviço e pede um motivo. Um serviço reprovado conta como decidido, mas mantém o produto fora do lançamento enquanto o custo não estiver aprovado.")] },
      { campo: "reabre", rotulo: "Volta a pendente ao mudar o valor", ajuda: [p("Trocar o valor, o serviço ou o fornecedor de uma linha já decidida faz ela voltar a “pendente” — a tela avisa em âmbar antes de salvar. Voltar a pendente não exige esta permissão.")] },
    ],
  },
];

const OFICINA: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A Oficina é onde você acompanha a confecção feita na sua oficina interna: o responsável, o preço por peça, as quantidades enviadas/recebidas, as datas e as observações do molde. É o equivalente aos Serviços, mas para a produção de casa."),
      p("A lista mostra os produtos em oficina; clicar num produto abre a ficha para preencher e, se precisar, imprimir."),
    ],
  },
  {
    id: "ficha",
    titulo: "Ficha da oficina",
    intro: [p("Os dados da oficina para o produto. Quando é oficina interna, um selo indica.")],
    campos: [
      { campo: "oficina", rotulo: "Oficina (responsável)", ajuda: [p("Quem executa o serviço na oficina.")] },
      { campo: "preco", rotulo: "Preço por Peça · Custo Total", ajuda: [p("O valor por peça e o total do serviço. Ver valores é uma permissão à parte.")] },
      { campo: "quantidades", rotulo: "Qtd Enviada · Qtd Recebida · Qtd Defeito", ajuda: [p("Quantas peças foram enviadas à oficina, quantas voltaram boas e quantas vieram com defeito.")] },
      { campo: "datas", rotulo: "Data Enviado · Data Prevista · Data Entregue", ajuda: [p("Quando o serviço foi enviado, a previsão de volta e a data em que de fato voltou.")] },
      { campo: "observacoes", rotulo: "Observação · Observação de Partes do Molde", ajuda: [p("Um texto livre sobre o serviço e as instruções de corte / partes do molde (compartilhadas com os Serviços e a ficha de corte).")] },
      { campo: "imprimir", rotulo: "Imprimir Ficha de Oficina", ajuda: [p("Gera a ficha da oficina — com o modelo, a coleção, a grade por variante, as observações técnicas e as partes do molde.")] },
    ],
  },
];

const ETAPAS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("As Etapas são o quadro (kanban) da produção PL: um card por produto, em colunas que representam a etapa de cada um. É um módulo opcional (depende de a loja ligar as Etapas PL)."),
      p("É onde você vê o andamento da produção e move os produtos pelas fases. Quando a loja usa o avanço automático, o card anda sozinho à medida que os serviços são concluídos."),
    ],
  },
  {
    id: "quadro",
    titulo: "O quadro (colunas e cards)",
    intro: [p("As colunas são as etapas que a loja configurou; cada card é um produto.")],
    campos: [
      { campo: "card", rotulo: "Card do produto", ajuda: [p("Mostra o produto (nome, REF, foto) e a situação. O cabeçalho acende o alerta de atraso quando um serviço ou a peça de foto do produto está atrasado.")] },
      { campo: "mover", rotulo: "Mover para…", ajuda: [p("Move o card de etapa — arrastando no computador ou pelo menu “Mover para…” no toque. A coluna que ainda não pode receber o card fica indisponível.")] },
      { campo: "busca", rotulo: "Pesquisar · Ordenar · Recolher cards", ajuda: [p("A busca encontra pelo nome ou REF; a ordenação e o “Recolher cards” (só nome + REF + alerta) ajudam a enxergar o quadro cheio.")] },
    ],
  },
  {
    id: "edicao-rapida",
    titulo: "Edição rápida do card",
    intro: [p("Alguns dados do serviço podem ser preenchidos direto no card, sem abrir os Serviços: datas de saída, entrada e envio e a aprovação. A edição rápida salva junto todos os serviços do produto, para não apagar os demais.")],
  },
];

const CQ: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("O Controle de Qualidade (CQ) é onde você confere as peças que voltaram da produção: conta o que foi recebido e o que veio com defeito, por cor e por tamanho, e registra conserto, lavagem e destino do defeito."),
      p("Tem duas abas dentro do produto — Pré (costura) e Pós (acabamento). Confirmar o CQ libera o produto para o Direcionamento e para o Lançamento."),
    ],
  },
  {
    id: "lista",
    titulo: "Lista de Controle de Qualidade",
    intro: [p("Os produtos que saíram da produção e aguardam conferência. Cada linha leva ao CQ do produto.")],
  },
  {
    id: "pre",
    titulo: "Pré (costura)",
    intro: [p("A conferência da costura: o recebimento por cor e tamanho, os defeitos e a grade real que segue para o Direcionamento.")],
    campos: [
      { campo: "etapas", rotulo: "1. Recebimento · 2. Conserto · 3. Lavagem · 4. Defeito", ajuda: [p("As etapas da conferência, por cor e tamanho. No Recebimento você conta o que voltou; no Defeito registra o que veio ruim e para onde vai (2º lote ou cancelado); Conserto e Lavagem acompanham quando a peça passa por elas.")] },
      { campo: "grade_real", rotulo: "Grade Real", ajuda: [p("A grade que de fato vale = Recebimento − Defeito, por cor e tamanho (mínimo 0). É ela que segue para o Direcionamento e alimenta o custo real.")] },
      { campo: "grade_cortada", rotulo: "Grade Cortada", quando: "só leitura", ajuda: [p("A grade cortada vinda dos Serviços/PCP, mostrada para conferência. Só é editável lá — aqui aparece para você comparar.")] },
      { campo: "campos_gerais", rotulo: "Peças Incompletas · Peças Faltantes · Peças sem Etiqueta", ajuda: [p("Contagens gerais do lote, fora da grade: peças incompletas, faltantes e sem etiqueta.")] },
      { campo: "observacoes", rotulo: "Observações do Controle de Qualidade", ajuda: [p("Um texto livre sobre a conferência.")] },
      { campo: "confirmar", rotulo: "Confirmar Controle de Qualidade", ajuda: [p("Fecha o CQ Pré com a grade real contada. Não dá para confirmar com a soma da grade zerada (sem peça contada). Desmarcar reabre a conferência (e rebaixa o Pós, se já estava confirmado).")] },
      { campo: "voltar_servicos", rotulo: "Voltar este modelo para Serviços", ajuda: [p("Devolve o produto para os Serviços (ex.: faltou algo na produção). Pede confirmação.")] },
      { campo: "oficina", rotulo: "Oficina — desconto / multa", ajuda: [p("Abre o ajuste de desconto e multa da oficina a partir do CQ, mostrando o custo bruto e o líquido.")] },
    ],
  },
  {
    id: "pos",
    titulo: "Pós (acabamento)",
    intro: [p("A conferência do acabamento, por serviço pós-costura. Usa a mesma grade real do Pré (só para exibir) e não a altera.")],
    campos: [
      { campo: "grade_pos", rotulo: "Grade real (do CQ Pré)", ajuda: [p("A grade real que veio do Pré, mostrada para referência. O Pós não reconta a grade — só acompanha os serviços de acabamento.")] },
      { campo: "servicos_pos", rotulo: "Serviços pós (Enviado · Prevista · Entregue)", ajuda: [p("Por serviço de acabamento, as datas de envio, previsão e entrega.")] },
      { campo: "observacoes_pos", rotulo: "Observações do CQ Pós", ajuda: [p("Um texto livre sobre a conferência do acabamento.")] },
      { campo: "confirmar_pos", rotulo: "Confirmar CQ Pós", ajuda: [p("Fecha o CQ Pós. Também não confirma com a soma zerada. É preciso o Pós confirmado (quando há serviço de acabamento ativo) para o produto ficar liberado.")] },
    ],
  },
];

const DIRECIONAMENTO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("O Direcionamento é onde você reparte a grade real do produto entre as suas lojas — por exemplo, E-commerce e Loja Física — por cor e por tamanho. É o passo que decide para onde vai cada peça depois do Controle de Qualidade."),
      p("Cada loja do cadastro vira uma linha digitável. Para confirmar, a soma do que você distribuiu tem de bater com a grade real em cada tamanho, e o CQ precisa estar liberado."),
    ],
  },
  {
    id: "lista",
    titulo: "Lista de Direcionamento",
    intro: [p("Os produtos prontos para distribuir. Cada linha mostra a situação (Pendente ou Separado) e leva ao direcionamento do produto.")],
  },
  {
    id: "distribuir",
    titulo: "Distribuir entre lojas",
    intro: [p("Por variante (cor), uma linha por loja do cadastro. Você digita quanto vai para cada loja em cada tamanho; o total por tamanho tem de fechar com a Grade Real.")],
    campos: [
      { campo: "grade_real", rotulo: "Grade Real", ajuda: [p("O que voltou da recepção dos serviços, já sem os defeitos do CQ. É o total que você precisa distribuir entre as lojas.")] },
      { campo: "linhas_loja", rotulo: "Linha por loja", ajuda: [p("Uma linha para cada loja ativa (as desativadas só aparecem onde já tinham distribuição salva, esmaecidas). Digite a quantidade por tamanho de cada loja.")] },
      { campo: "preencher", rotulo: "Preencher pelo plano", ajuda: [p("Preenche o rascunho pela distribuição planejada onde ela bate com a Grade Real (as células preenchidas aparecem destacadas). É só um rascunho — nada é salvo até você Salvar.")] },
      { campo: "confirmar", rotulo: "Confirmar Direcionamento", ajuda: [p("Fecha a distribuição e marca o produto como “Separado”. Só confirma com a soma por tamanho igual à Grade Real e com o CQ liberado. Desmarcar volta para “Pendente” (pede confirmação).")] },
      { campo: "romaneio", rotulo: "Imprimir Romaneio", ajuda: [p("Gera o romaneio da distribuição — o documento com o que vai para cada loja.")] },
    ],
  },
];

const LANCAMENTOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("Os Lançamentos reúnem os produtos finalizados: aqueles com o Controle de Qualidade confirmado. É a vista final da produção — o que já pode ser lançado ou já foi."),
      p("Aqui você também acompanha o registro de foto das peças, variante por variante."),
    ],
  },
  {
    id: "lista",
    titulo: "Lista de produtos finalizados",
    intro: [p("Os produtos com CQ confirmado, com filtros e colunas ajustáveis.")],
    campos: [
      { campo: "filtros", rotulo: "Buscar · Lançado de / até · Ordenar · Colunas", ajuda: [p("A busca encontra pela REF ou nome; o período “Lançado de/até”, a ordenação e a escolha de colunas afinam a lista.")] },
      { campo: "fotografado", rotulo: "Fotografado por variante", ajuda: [p("Para cada cor do produto, você marca se ela já foi fotografada. O ícone de câmera no card mostra o progresso: sem foto, parcial (cinza) ou tudo pronto (verde).")] },
      { campo: "relacionado", rotulo: "Produto relacionado", ajuda: [p("Quando o produto faz parte de um conjunto, os produtos relacionados aparecem para referência.")] },
    ],
  },
];

/** Telas dos módulos PCP e Expedição documentadas à mão. */
export const PCP_EXPEDICAO_CONTEUDO: ConteudoTelas = {
  producao_terceirizados: SERVICOS,
  producao_servico_aprovacao: APROVACAO_MO,
  producao_oficina: OFICINA,
  producao_etapas: ETAPAS,
  producao_cq: CQ,
  producao_direcionamento: DIRECIONAMENTO,
  producao_lancamentos: LANCAMENTOS,
};
