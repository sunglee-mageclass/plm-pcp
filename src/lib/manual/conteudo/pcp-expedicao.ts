// Conteúdo do Manual — módulos PCP e Expedição.
// Guia de uso (passo a passo + fio do processo), fiel às telas reais
// (Serviços, Oficina, Etapas PL, CQ, Direcionamento, Lançamentos) e às regras do CLAUDE.md.
import { p, type ConteudoTelas, type SecaoConteudoManual } from "./tipos";

const SERVICOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Onde você controla a produção",
    intro: [
      p("Serviços é onde você acompanha a confecção de um produto depois que ele saiu da Explosão: cada serviço (corte, costura, acabamento…) com o fornecedor, o valor, a grade por tamanho × variante, as datas e a Ordem de Serviço (OS) impressa. É a primeira parada do fluxo de produção — depois dela vêm o Controle de Qualidade, o Direcionamento e os Lançamentos."),
      p("Os serviços ficam em duas abas — Pré (até a costura) e Pós (acabamento) — conforme a etapa de cada tipo de serviço. O produto fica “Finalizado” quando os serviços foram entregues e contados; só então ele segue para o CQ."),
      p("A tela de entrada é uma lista dos produtos em confecção. Clicar numa linha abre o produto num painel lateral, onde você preenche tudo e, se precisar, imprime a OS."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("O trabalho é por BLOCO de serviço: você adiciona um bloco para cada serviço do produto (um para a costura, outro para o acabamento, etc.), escolhe quem faz, informa o valor e as quantidades, e acompanha as datas."),
    ],
    campos: [
      { campo: "abrir", rotulo: "Encontrar e abrir um produto", ajuda: [
        { tipo: "passos", itens: [
          "Use a busca (por REF ou nome) ou o botão “Filtrar” (coleção, mês, ano, status, peça teste) para achar o produto.",
          "Clique na linha do produto — ele abre num painel lateral à direita.",
          "No topo do painel, escolha a aba “Pré (até costura)” ou “Pós (acabamento)”.",
        ] },
      ] },
      { campo: "adicionar-bloco", rotulo: "Adicionar e preencher um bloco de serviço", ajuda: [
        { tipo: "passos", itens: [
          "No card “Categorias do Serviço”, clique na categoria que você quer (ex.: Costura) — isso cria um bloco para ela. Pode adicionar mais de um.",
          "No bloco, escolha “Interno” (feito em casa, mostra Responsável) ou “PL” (terceirizado, mostra o fornecedor).",
          "Se for PL, escolha a Empresa e, se houver, o Representante, e informe o Preço por metro/unidade.",
          "Preencha a Qtd Enviada e as datas (Data Enviado · Data Prevista · Data Entregue).",
          "Quando as peças voltarem, informe a Qtd Recebida e a Qtd Defeito.",
          "Se precisar da quantidade por tamanho e cor, ligue “Quantidade por tamanho e variante” — os totais passam a ser a soma da grade, que você preenche célula a célula.",
        ] },
      ] },
      { campo: "imprimir-os", rotulo: "Imprimir a Ordem de Serviço", ajuda: [
        p("O botão “Imprimir OS” (no topo do painel) gera o documento do fornecedor — com o que foi enviado, a grade e os dados do serviço. O botão “Ficha Técnica” imprime a ficha do produto."),
      ] },
      { campo: "salvar", rotulo: "Salvar", ajuda: [
        p("Clique em “Salvar” na barra de baixo. Se você fechar o painel com algo pendente, o sistema pergunta “Descartar alterações?”. O botão “Voltar uma etapa” devolve o produto para a Explosão (pede confirmação; fica bloqueado se já há parcela paga)."),
      ] },
    ],
  },
  {
    id: "bloco-servico",
    titulo: "Campos de um bloco de serviço (referência)",
    intro: [p("Cada serviço do produto é um bloco: o fornecedor, o preço, as datas, a grade e o valor a pagar. O cabeçalho do bloco mostra a situação e o alerta de atraso quando a previsão passou sem entrega.")],
    campos: [
      { campo: "interno_pl", rotulo: "Interno · PL", ajuda: [p("“Interno” = feito na sua oficina (mostra o Responsável e esconde o fornecedor). “PL” = terceirizado (mostra Empresa e Representante).")] },
      { campo: "responsavel", rotulo: "Responsável", ajuda: [p("Quem é o responsável pelo serviço dentro da sua equipe (nos blocos Internos).")] },
      { campo: "empresa", rotulo: "Empresa · Representante (opcional)", ajuda: [p("O fornecedor do serviço: a empresa e, se for o caso, o representante dela. Trocar a empresa limpa o representante. Se não houver empresa cadastrada para o tipo de serviço, cadastre em Cadastro › Serviço.")] },
      { campo: "preco", rotulo: "Preço por metro/unidade", ajuda: [p("O valor combinado do serviço, por metro ou por peça. Multiplicado pela quantidade enviada, forma o custo bruto. Quando o preço entra sozinho pela aprovação da mão de obra no Planejamento, um selo “M.O. não aprovada” avisa enquanto a aprovação não acontece.")] },
      { campo: "qtd", rotulo: "Qtd Enviada · Qtd Recebida · Qtd Defeito", ajuda: [p("Quanto foi enviado, quanto voltou bom e quanto veio com defeito. Com “Quantidade por tamanho e variante” ligada, viram a soma da grade (Σ) e aparecem os campos “Qtd Cortada (Σ grade)” e “Saldo a receber (Σ)”.")] },
      { campo: "datas", rotulo: "Data Enviado · Data Prevista · Data Entregue", ajuda: [p("Quando o serviço foi enviado ao fornecedor, a previsão de volta e a data em que de fato voltou. A previsão sem entrega gera o alerta de atraso no cabeçalho.")] },
      { campo: "valores", rotulo: "Desconto total · Multa total · Prazo de Pagamento · Custo Total", ajuda: [p("O desconto e a multa ajustam o valor a pagar; o prazo (do fornecedor) define as parcelas que vão para o Financeiro; o Custo Total é o líquido (preço × enviada − desconto + multa). Ver valores é uma permissão à parte.")] },
      { campo: "observacao", rotulo: "Observação", ajuda: [p("Um texto livre sobre o serviço.")] },
      { campo: "nf", rotulo: "Notas Fiscais (NF de Saída · NF de Entrada)", quando: "serviço PL + módulo Etapas PL", ajuda: [p("Os números das notas de saída (ao enviar) e de entrada (ao receber). Aparecem nos serviços PL quando a loja usa as Etapas PL.")] },
      { campo: "peca_foto", rotulo: "Peça de foto (Previsão de entrega · Data entregue)", quando: "serviço PL + módulo Etapas PL", ajuda: [p("O acompanhamento da peça para foto: a previsão de entrega e a data em que ela chegou. Previsão vencida sem a data entregue acende o alerta de atraso.")] },
    ],
  },
  {
    id: "abas",
    titulo: "Abas Pré e Pós · Resumo",
    intro: [p("Os serviços são separados em duas abas pela etapa do tipo de serviço, e o cabeçalho resume a situação e o custo.")],
    campos: [
      { campo: "pre", rotulo: "Pré (até costura)", ajuda: [p("Os serviços até a costura (corte, costura…).")] },
      { campo: "pos", rotulo: "Pós (acabamento)", ajuda: [p("Os serviços de acabamento depois da costura. Se o produto “não tem acabamento” (marque o checkbox na aba Pós, quando não há blocos pós), ele é considerado Finalizado só com o Pré.")] },
      { campo: "status_resumo", rotulo: "Status Pré · Status Pós · Status Geral", ajuda: [p("A situação de cada etapa e a geral. O produto só fica Finalizado quando o Pré (e o Pós, se houver) estão prontos.")] },
      { campo: "custo_resumo", rotulo: "Custo real / peça · MO Aprovada (planejada)", ajuda: [p("O custo real por peça (incluindo serviços) e a mão de obra já aprovada. Ver custos é uma permissão à parte — quem não a tem vê “—”.")] },
      { campo: "molde", rotulo: "Observação de Partes do Molde", ajuda: [p("As instruções de corte / partes do molde, compartilhadas com a Oficina e a ficha de corte.")] },
    ],
  },
  {
    id: "peca-teste",
    titulo: "Peça Teste",
    intro: [p("O botão “Peça Teste”, no topo do painel, abre o acompanhamento das peças-teste do produto: cada tentativa registra o fornecedor, as datas e a aprovação, com Salvar próprio. A peça-teste movimenta só o estoque — não entra no custo, não gera conta a pagar.")],
  },
];

const APROVACAO_MO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "O portão do dinheiro da mão de obra",
    intro: [
      p("A Aprovação de mão de obra é a permissão (e a ação) de aprovar ou reprovar o custo da mão de obra de um produto, serviço por serviço. É um controle de dinheiro: enquanto a mão de obra não está aprovada, o produto não pode ser lançado."),
      p("Não é uma tela própria — os botões de aprovar/reprovar aparecem na mão de obra do produto, dentro do Sheet do Planejamento e nos cards de Produto Acabado/Importado. Quem não tem esta permissão vê os serviços, mas não aprova nem reprova."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar",
    intro: [
      p("Você decide cada serviço da mão de obra na própria linha, ali onde a mão de obra do produto é editada."),
    ],
    campos: [
      { campo: "aprovar-reprovar", rotulo: "Aprovar ou reprovar um serviço", ajuda: [
        { tipo: "passos", itens: [
          "Abra a mão de obra do produto (Sheet do Planejamento ou card de Produto Acabado/Importado).",
          "Na linha do serviço, clique em “Aprovar” para liberar o custo daquele serviço.",
          "Ou clique em “Reprovar” e informe o motivo — o serviço conta como decidido, mas mantém o produto fora do lançamento enquanto o custo não estiver aprovado.",
          "Com todos os serviços aprovados (e nada pendente), a mão de obra fica liberada e o produto pode ser lançado.",
        ] },
      ] },
      { campo: "reabre", rotulo: "Quando uma linha volta a pendente", ajuda: [
        p("Trocar o valor, o serviço ou o fornecedor de uma linha já decidida faz ela voltar sozinha a “pendente” — a tela avisa em âmbar antes de salvar. Voltar a pendente não exige esta permissão (apagar a linha, sim).")] },
    ],
  },
];

const OFICINA: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "A ficha da sua oficina interna",
    intro: [
      p("A Oficina é onde você acompanha a confecção feita na sua oficina interna: o responsável, o preço por peça, as quantidades enviadas/recebidas, as datas e as observações do molde. É o equivalente aos Serviços, mas para a produção de casa."),
      p("A tela de entrada lista os produtos em oficina; clicar na REF ou no nome abre a ficha do produto (em página inteira) para você preencher e, se precisar, imprimir."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Você abre o produto, preenche quem executa, o preço e as quantidades, e salva."),
    ],
    campos: [
      { campo: "preencher", rotulo: "Preencher a ficha de oficina", ajuda: [
        { tipo: "passos", itens: [
          "Na lista, use a busca ou “Filtrar” (coleção, mês, ano) e clique na REF ou no nome do produto.",
          "Em “Oficina (responsável)”, escolha quem executa — a menos que a loja seja oficina interna (aí o selo “Oficina Interna” aparece e o campo some).",
          "Informe o Preço por Peça e as quantidades: Qtd Enviada, Qtd Recebida, Qtd Defeito.",
          "Preencha as datas (Data Enviado · Data Prevista · Data Entregue) e, se quiser, a Observação.",
          "Clique em “Salvar” na barra de baixo.",
        ] },
      ] },
      { campo: "imprimir", rotulo: "Imprimir a Ficha de Oficina", ajuda: [
        p("O botão “Imprimir Ficha de Oficina” (só no computador, habilitado quando a grade carrega) gera a ficha — com o modelo, a coleção, a grade por variante, as observações técnicas e as partes do molde.")] },
    ],
  },
  {
    id: "ficha",
    titulo: "Campos da ficha (referência)",
    intro: [p("Os dados da oficina para o produto.")],
    campos: [
      { campo: "oficina", rotulo: "Oficina (responsável)", ajuda: [p("Quem executa o serviço na oficina. Some quando a loja é oficina interna.")] },
      { campo: "preco", rotulo: "Preço por Peça · Custo Total", ajuda: [p("O valor por peça e o total do serviço (preço × qtd enviada). Ver valores é uma permissão à parte.")] },
      { campo: "quantidades", rotulo: "Qtd Enviada · Qtd Recebida · Qtd Defeito", ajuda: [p("Quantas peças foram enviadas à oficina, quantas voltaram boas e quantas vieram com defeito.")] },
      { campo: "datas", rotulo: "Data Enviado · Data Prevista · Data Entregue", ajuda: [p("Quando o serviço foi enviado, a previsão de volta e a data em que de fato voltou.")] },
      { campo: "observacoes", rotulo: "Observação · Observação de Partes do Molde", ajuda: [p("Um texto livre sobre o serviço e as instruções de corte / partes do molde (compartilhadas com os Serviços e a ficha de corte).")] },
    ],
  },
];

const ETAPAS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "O quadro da produção PL",
    intro: [
      p("As Etapas são o quadro (kanban) da produção PL: um card por produto, em colunas que representam a etapa de cada um."),
      p("Quando aparece: é um módulo opcional (opt-in) — a tela Etapas só existe quando a loja liga as Etapas PL. Sem o módulo, a produção PL fica só na tela de Serviços, sem o quadro."),
      p("É onde você enxerga o andamento da produção e move os produtos pelas fases. Quando a loja usa o avanço automático, o card anda sozinho à medida que os serviços são concluídos; no modo manual, você move à mão."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Você acompanha o quadro, move os cards de etapa e clica num card para preencher os dados do serviço."),
    ],
    campos: [
      { campo: "mover", rotulo: "Mover um produto de etapa", ajuda: [
        { tipo: "passos", itens: [
          "No computador, arraste o card e solte na coluna de destino — a coluna válida fica tracejada em azul (“Solte aqui para mover”).",
          "No celular (ou no toque), use o menu “Mover para…” do card e escolha a coluna.",
          "Se a coluna ainda não pode receber o produto, ela aparece bloqueada (tracejado vermelho) com “Faltam: …” — veja a seção “Requisitos da fase”.",
        ] },
      ] },
      { campo: "editar", rotulo: "Preencher os dados de um card", ajuda: [
        { tipo: "passos", itens: [
          "Clique no card — ele abre o Sheet de Serviços (o mesmo de PCP › Serviços).",
          "Preencha ali as datas, notas, aprovação, peça de foto e os demais dados do serviço, e salve.",
        ] },
      ] },
      { campo: "organizar", rotulo: "Encontrar e organizar", ajuda: [
        p("A busca encontra pelo nome ou REF; o “Filtrar” afina por etapa, coleção, fornecedor e origem. “Recolher cards” deixa só nome + REF + alerta, e “Recolher colunas” / “Ordenar por” ajudam a enxergar o quadro cheio.")] },
    ],
  },
  {
    id: "requisitos-fase",
    titulo: "Requisitos da fase (o que falta para avançar)",
    intro: [
      p("Cada coluna pode exigir que algumas coisas estejam prontas antes de o produto entrar nela — por exemplo: mão de obra aprovada, grade preenchida, peça teste aprovada, enviado aos Serviços, materiais separados, grade cortada retornada, oficina entregue ou CQ liberado. Quem escolhe os requisitos de cada coluna é a loja, em Config da Loja › Etapas PL."),
      p("O quadro mostra o que cada coluna exige e, quando você tenta mover um produto para uma coluna que ele ainda não pode entrar, avisa “Faltam: …” e deixa essa coluna indisponível. Com o avanço automático ligado, o card anda sozinho assim que os requisitos são cumpridos; no modo manual, você move à mão e os requisitos valem como aviso."),
    ],
    componente: "requisitos-fases-pl",
  },
  {
    id: "editar-servico",
    titulo: "Editar os dados do serviço",
    intro: [p("O card em si não tem campos editáveis — ele serve para acompanhar e mover o produto. Para preencher datas, notas, aprovação, peça de foto e os demais dados, clique no card: abre o Sheet de Serviços (o mesmo de PCP › Serviços).")],
  },
];

const CQ: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "O controle de qualidade do recebimento",
    intro: [
      p("O Controle de Qualidade (CQ) é onde você confere as peças que voltaram da produção: conta o que foi recebido e o que veio com defeito, por cor e por tamanho, e registra conserto, lavagem e destino do defeito. Ele vem logo depois dos Serviços no fluxo."),
      p("Tem duas abas dentro do produto — Pré (costura) e Pós (acabamento). Confirmar o CQ libera o produto para o Direcionamento e para o Lançamento."),
      p("A tela de entrada lista os produtos que aguardam conferência (os que já saíram da produção). Clicar numa linha abre o CQ do produto num painel lateral."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Você conta o que voltou (por cor e tamanho), registra os defeitos, confere a Grade Real que o sistema calcula e confirma o CQ."),
    ],
    campos: [
      { campo: "conferir", rotulo: "Conferir e contar o recebimento", ajuda: [
        { tipo: "passos", itens: [
          "Clique na linha do produto e escolha a aba “Pré (costura)”.",
          "Em “1. Recebimento”, conte por variante e tamanho tudo que voltou da produção — inclusive as peças com defeito.",
          "Se passou por conserto ou lavagem, preencha as datas em “2. Conserto” e “3. Lavagem”.",
          "Em “4. Defeito”, registre o que veio ruim e para onde vai: “2º lote” (padrão) ou “Cancelado”.",
          "Confira a “Grade Real” (calculada = Recebimento − Defeito) — é ela que segue para o Direcionamento.",
          "Se quiser, informe Peças incompletas, faltantes e sem etiqueta.",
        ] },
      ] },
      { campo: "confirmar", rotulo: "Confirmar o CQ", ajuda: [
        { tipo: "passos", itens: [
          "Clique em “Confirmar Controle de Qualidade” (ou “Confirmar CQ Pós”, na aba Pós).",
          "Não dá para confirmar com a grade zerada (sem nenhuma peça contada) — é preciso contar ao menos uma peça.",
          "Confirmado, o produto é liberado para o Direcionamento (aparece lá e nos Lançamentos).",
          "Para reabrir, use “Editar” / “Desmarcar confirmação” (pede confirmação; desmarcar o Pré também rebaixa o Pós).",
        ] },
      ] },
      { campo: "voltar", rotulo: "Devolver para Serviços ou ajustar a oficina", ajuda: [
        p("O botão “Voltar uma etapa” devolve o produto para os Serviços (ex.: faltou algo na produção; pede confirmação). O botão “Oficina” abre o diálogo de desconto/multa da oficina, mostrando o custo bruto e o líquido.")] },
    ],
  },
  {
    id: "pre",
    titulo: "Pré (costura) — campos",
    intro: [p("A conferência da costura: o recebimento por cor e tamanho, os defeitos e a grade real que segue para o Direcionamento.")],
    campos: [
      { campo: "etapas", rotulo: "1. Recebimento · 2. Conserto · 3. Lavagem · 4. Defeito", ajuda: [p("As etapas da conferência, por cor e tamanho. No Recebimento você conta tudo que voltou (inclusive com defeito); no Defeito registra o que veio ruim e o destino (2º lote ou cancelado); Conserto e Lavagem acompanham as datas quando a peça passa por elas.")] },
      { campo: "grade_real", rotulo: "Grade Real", ajuda: [p("A grade que de fato vale = Recebimento − Defeito, por cor e tamanho (mínimo 0). É ela que segue para o Direcionamento e alimenta o custo real.")] },
      { campo: "grade_cortada", rotulo: "Grade Cortada", quando: "só leitura", ajuda: [p("A grade cortada vinda dos Serviços/PCP, mostrada para conferência (só editável lá). Um aviso em âmbar surge quando o Recebido é maior que o cortado.")] },
      { campo: "campos_gerais", rotulo: "Peças Incompletas · Peças Faltantes · Peças sem Etiqueta", ajuda: [p("Contagens gerais do lote, fora da grade.")] },
    ],
  },
  {
    id: "pos",
    titulo: "Pós (acabamento) — campos",
    intro: [p("A conferência do acabamento, por serviço pós-costura. Usa a mesma grade real do Pré (só para exibir) e não a altera.")],
    campos: [
      { campo: "grade_pos", rotulo: "Grade real (do CQ Pré)", ajuda: [p("A grade real que veio do Pré, mostrada para referência. O Pós não reconta a grade — só acompanha os serviços de acabamento.")] },
      { campo: "confirmar_pos", rotulo: "Confirmar CQ Pós", ajuda: [p("Fecha o CQ Pós. Também não confirma com a soma zerada. É preciso o Pós confirmado (quando há serviço de acabamento ativo) para o produto ficar liberado.")] },
    ],
  },
];

const DIRECIONAMENTO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para onde cada peça vai",
    intro: [
      p("O Direcionamento é onde você reparte a grade real do produto entre as suas lojas — por exemplo, E-commerce e Loja Física — por cor e por tamanho. É o passo que decide o destino de cada peça depois do Controle de Qualidade."),
      p("Só aparecem aqui os produtos com o CQ liberado. Cada loja do cadastro vira uma linha digitável; para confirmar, a soma do que você distribuiu tem de bater com a grade real em cada tamanho."),
      p("A lista de entrada mostra os produtos prontos para distribuir, com a situação (Pendente ou Separado). Clicar numa linha abre o direcionamento do produto num painel lateral."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Você digita, por variante, quanto vai para cada loja em cada tamanho; o total por tamanho tem de fechar com a Grade Real."),
    ],
    campos: [
      { campo: "distribuir", rotulo: "Distribuir a grade entre as lojas", ajuda: [
        { tipo: "passos", itens: [
          "Clique na linha do produto para abrir o painel.",
          "Para cada variante (cor), digite a quantidade por tamanho de cada loja — há uma linha por loja ativa do cadastro.",
          "Atalho: o botão “Preencher pelo plano” preenche um rascunho pela distribuição planejada onde ela bate com a Grade Real (as células vindas do plano aparecem destacadas). Nada é salvo até você Salvar.",
          "Confira: o total por tamanho de todas as lojas tem de ser igual à Grade Real — o rodapé mostra a diferença.",
        ] },
      ] },
      { campo: "confirmar", rotulo: "Confirmar e imprimir o romaneio", ajuda: [
        { tipo: "passos", itens: [
          "Clique em “Confirmar Direcionamento”. Ele só confirma com a soma por tamanho igual à Grade Real e com o CQ liberado — senão o botão fica desabilitado, com aviso do tamanho que não fecha.",
          "Confirmado, o produto fica “Separado”. Para reabrir, use “Editar” / “Desmarcar” (pede confirmação).",
          "O botão “Imprimir Romaneio” gera o documento com o que vai para cada loja.",
        ] },
      ] },
    ],
  },
  {
    id: "distribuir-ref",
    titulo: "Campos da distribuição (referência)",
    intro: [p("Por variante (cor), uma linha por loja do cadastro.")],
    campos: [
      { campo: "grade_real", rotulo: "Grade Real", ajuda: [p("O que voltou da recepção dos serviços, já sem os defeitos do CQ. É o total que você precisa distribuir entre as lojas.")] },
      { campo: "linhas_loja", rotulo: "Linha por loja", ajuda: [p("Uma linha para cada loja ativa (as desativadas só aparecem onde já tinham distribuição salva, esmaecidas). Digite a quantidade por tamanho de cada loja.")] },
      { campo: "preencher", rotulo: "Preencher pelo plano", ajuda: [p("Preenche o rascunho pela distribuição planejada onde ela bate com a Grade Real. É só um rascunho — nada é salvo até você Salvar.")] },
      { campo: "romaneio", rotulo: "Imprimir Romaneio", ajuda: [p("Gera o romaneio da distribuição — o documento com o que vai para cada loja.")] },
    ],
  },
];

const LANCAMENTOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "A vista final da produção",
    intro: [
      p("Os Lançamentos reúnem os produtos finalizados: aqueles com o Controle de Qualidade confirmado. É a última parada do fluxo — o que já pode ser lançado ou já foi."),
      p("Aqui você também acompanha o registro de foto das peças, variante por variante, e enxerga o poder de venda do que está pronto."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("A tela é uma galeria de cards dos produtos finalizados. Você filtra/agrupa para enxergar o conjunto e marca, por variante, o que já foi fotografado."),
    ],
    campos: [
      { campo: "organizar", rotulo: "Encontrar e organizar", ajuda: [
        { tipo: "passos", itens: [
          "Use a busca (REF ou nome) para achar um produto.",
          "O botão “Filtrar” afina por grupo, coleção, categoria, linha, mês/ano, lançamento e pelo período “Lançado de / até”.",
          "“Agrupar” (Linha, Categoria, Subcategoria, Repetição) e “Ordenar por” / “Colunas” ajustam a vista.",
        ] },
      ] },
      { campo: "fotografar", rotulo: "Marcar o que já foi fotografado", ajuda: [
        { tipo: "passos", itens: [
          "Clique no card para abrir “Fotos por variante”.",
          "Em cada cor, clique no botão-câmera para marcar/desmarcar “Fotografada”.",
          "O ícone de câmera no card mostra o progresso: sem foto, parcial (cinza) ou tudo pronto (verde).",
        ] },
      ] },
    ],
  },
  {
    id: "lista-ref",
    titulo: "O card de lançamento (referência)",
    intro: [p("Cada card resume o produto finalizado e o seu poder de venda.")],
    campos: [
      { campo: "fotografado", rotulo: "Fotografado por variante", ajuda: [p("Para cada cor do produto, você marca se ela já foi fotografada. Quem não tem permissão de edição vê a tela, mas não altera as marcas.")] },
      { campo: "venda", rotulo: "Markup · Preço avulso · Poder de venda", ajuda: [p("O markup, o preço e o poder de venda (preço × grade) do produto, somados no resumo de venda por grupo e geral.")] },
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
