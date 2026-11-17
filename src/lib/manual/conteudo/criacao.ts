// Conteúdo do Manual — módulo CRIAÇÃO (Estilo & Engenharia).
// Fiel aos InfoHover do Sheet, ao mapeamento (§17) e às regras do CLAUDE.md.
import { p, type ConteudoTelas, type SecaoConteudoManual } from "./tipos";

const PLANEJAMENTO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("O Planejamento de Produto é onde cada produto nasce e é preparado: identidade, preço, ficha de materiais (BOM), grade, corte e mão de obra. O produto é um card que avança pelas fases do quadro à medida que fica completo, até ser lançado."),
      p("Esta mesma tela (o “Sheet”) edita tudo o que antes ficava no Desenvolvimento. As seções que aparecem dependem da origem do produto (interno, revenda ou importado) e dos módulos que a sua loja usa."),
    ],
  },
  {
    id: "info",
    titulo: "Informações Gerais do Produto",
    intro: [p("A identidade do produto: quem desenhou, como ele entra na loja, nome, classificação e os dados que vão para a página do e-commerce.")],
    campos: [
      { campo: "status", rotulo: "Status", ajuda: [p("A situação do produto no planejamento. O card muda de coluna no quadro conforme avança; este campo mostra onde ele está.")] },
      { campo: "estilista", rotulo: "Estilista", quando: "opcional", ajuda: [p("Quem desenhou o produto. Pode ficar em branco (“— Nenhum —”).")] },
      { campo: "origem", rotulo: "Origem", ajuda: [
        p("Define como o produto entra na loja: Interno (você fabrica), Revenda (compra pronto para revender) ou Importado. Começa em Interno."),
        p("Algumas origens podem aparecer travadas — por exemplo, Importado só existe se a loja tem o módulo, e trocar de origem depois que o produto já tem dados pode ser bloqueado. O “i” ao lado do campo explica o motivo quando isso acontece."),
      ] },
      { campo: "nome", rotulo: "Nome do Modelo", quando: "obrigatório", ajuda: [p("O nome do produto. É a base de vários automáticos: a REF, o Título para a página e os SKUs partem dele. O mesmo produto também pode ser editado no Desenvolvimento.")] },
      { campo: "versao", rotulo: "Versão", quando: "obrigatório", ajuda: [p("O número da versão do produto (começa em 1). Da versão 2 em diante, o card ganha um selo “↻ v2” — é uma releitura do mesmo produto, que herda alguns automáticos da versão anterior (como o Título e o Preço anterior).")] },
      { campo: "ncm", rotulo: "NCM do Produto", quando: "opcional", ajuda: [p("O código fiscal (NCM) do produto, se você usa. É um campo livre: digite só números e pontos. Não há tabela nem sugestão — fica anotado como você escrever. Em branco, fica sem NCM.")] },
      { campo: "taxonomia", rotulo: "Grupo · Categoria · Subcategoria 1 · Subcategoria 2", ajuda: [
        p("A classificação do produto, em até quatro níveis encadeados: o Grupo abre as Categorias, a Categoria abre as Subcategorias."),
        p("Trocar o Grupo limpa a Categoria e as subcategorias; trocar a Categoria reseta as subcategorias. As opções mostradas são sempre as do nível acima. Nem toda categoria usa a Subcategoria 2."),
      ] },
      { campo: "titulo_pagina", rotulo: "Título para a página", quando: "automático se vazio", ajuda: [
        p("É o título que o produto terá na página do e-commerce. Deixando em branco, o sistema preenche sozinho: na versão 1, o Nome do Modelo em Iniciais Maiúsculas + “ | ” + o nome da loja; da versão 2 em diante, herda o título da versão anterior enquanto ninguém editar."),
        p("Se você digitar um título diferente, ele fica fixo (manual). Para voltar ao automático, apague o campo ou clique no botão “↺” ao lado."),
      ] },
      { campo: "descricao_produto", rotulo: "Descrição do produto", quando: "opcional", ajuda: [p("Um texto livre com a descrição do produto. É um campo do Planejamento — não aparece na Ficha Técnica.")] },
      { campo: "medidas", rotulo: "Peso (kg) · Comprimento · Largura · Altura (cm)", quando: "opcional", ajuda: [p("As medidas físicas do produto, úteis para frete e logística no e-commerce. Em branco, a medida fica vazia (não conta como zero). O peso aceita 3 casas decimais; as medidas, 2.")] },
    ],
  },
  {
    id: "colecao",
    titulo: "Coleção",
    intro: [p("Onde o produto se encaixa no calendário comercial. Se a loja usa o OTB, Coleção e Subcoleção viram listas (as coleções planejadas); sem OTB, são texto livre.")],
    campos: [
      { campo: "colecao", rotulo: "Coleção · Subcoleção · Semana", ajuda: [p("A coleção, a subcoleção e a semana do produto. Com o OTB ligado, você escolhe de uma lista; sem OTB, digita. A Data de Lançamento não fica aqui — ela está na seção Lançamento.")] },
    ],
  },
  {
    id: "desenvolvimento",
    titulo: "Desenvolvimento (equipe e cronograma)",
    intro: [p("A equipe e as datas do produto. São os campos que antes ficavam na tela de Desenvolvimento e hoje são editados aqui mesmo.")],
    campos: [
      { campo: "modelista", rotulo: "Modelista", ajuda: [p("Quem fez a modelagem do produto.")] },
      { campo: "piloteiros", rotulo: "Piloteiro(s)", ajuda: [p("Quem costurou a(s) peça(s)-piloto. Pode haver mais de um.")] },
      { campo: "datas_dev", rotulo: "Datas (Desenho Técnico · Piloto I/II/III · Aprovação)", quando: "opcional", ajuda: [p("As datas do cronograma de desenvolvimento. Nem todo produto passa por 2ª ou 3ª pilotagem — preencha só as que se aplicam.")] },
    ],
  },
  {
    id: "codigos",
    titulo: "Códigos (REF e SKU)",
    intro: [p("Os códigos do produto: a REF (referência) e os SKUs por cor e tamanho, usados no e-commerce e no estoque.")],
    campos: [
      { campo: "ref", rotulo: "REF", ajuda: [p("A referência do produto. É gerada automaticamente pelo sistema e só aparece a partir da etapa que a loja configura (em Config da Loja). Antes dessa etapa, o campo ainda não é mostrado nem editável.")] },
      { campo: "tamanho_tipo", rotulo: "Tamanho em (Letra ou Número)", quando: "obrigatório", ajuda: [p("Define se os tamanhos do produto são por letra (P, M, G) ou por número (38, 40, 42). Nasce em Letra; troque para Número se o produto usa numeração. É o mesmo valor do Plan. Tecido, Produto Acabado e Importado — mudar aqui reflete lá. Em Acessórios, não aparece (a grade é única).")] },
      { campo: "skus", rotulo: "Tabela de SKUs · botão Regerar", ajuda: [
        p("A lista de SKUs, um por cor × tamanho, montada pelo Formato de SKU que a loja configurou. O botão “Regerar” não grava na hora: mostra uma prévia; os SKUs só são gravados quando você Salva o card."),
        p("Se faltar a sigla de uma cor ou de um tamanho, a linha correspondente fica bloqueada até a sigla ser cadastrada."),
      ] },
      { campo: "regerar_ref", rotulo: "Regerar REF", quando: "só produto interno", ajuda: [p("Recalcula a REF pelo Formato atual da loja (reaproveitando o número). É uma prévia no rascunho — a REF nova só é gravada quando você Salva. REF digitada à mão pede confirmação antes de ser trocada.")] },
    ],
  },
  {
    id: "bom",
    titulo: "Ficha de materiais (Tecidos, Aviamentos, Insumos e Grade)",
    intro: [p("O que o produto consome: tecidos (e forros/entretelas), aviamentos, insumos e a grade de quantidades por cor e tamanho. É a partir daqui que o custo e a necessidade de compra são calculados.")],
    campos: [
      { campo: "tecidos", rotulo: "Tecidos / Forros / Entretelas", ajuda: [p("Os tecidos do produto. Ao escolher um tecido, o card mostra o preço por metro e o estoque (físico e disponível) — disponível negativo (reservado maior que o físico) aparece em vermelho. O Tecido 1 é o principal: é dele que saem as cores do produto.")] },
      { campo: "aviamentos", rotulo: "Aviamentos", ajuda: [p("Os aviamentos do produto (zíperes, botões, linhas…), com o consumo de cada um.")] },
      { campo: "insumos", rotulo: "Insumos", ajuda: [p("Insumos como etiquetas e embalagens. Um insumo pode ser vinculado a um tamanho específico — nesse caso ele conta só nas peças daquele tamanho.")] },
      { campo: "grade", rotulo: "Grade", ajuda: [p("As quantidades por cor × tamanho. A soma da grade é a quantidade de peças do produto e alimenta o custo e a necessidade de tecido.")] },
      { campo: "grade_por_fase", rotulo: "Grade por fase (Programada · CAD · PCP · CQ)", ajuda: [p("A Programada é a meta oficial, congelada quando a Ordem de Criação foi enviada — mudar a grade planejada depois não altera a Programada. As outras colunas mostram a grade em cada etapa: CAD (planejada no corte), PCP (cortada) e CQ (real, recebida menos defeito). A fase que diferir da Programada fica em destaque.")] },
    ],
  },
  {
    id: "cad",
    titulo: "CAD (corte)",
    intro: [p("Os dados de corte do produto. A maioria é preenchida depois de Enviar à Explosão, na tela do PCP.")],
    campos: [
      { campo: "cad", rotulo: "Tamanho da folha · Qtd Folhas · Metragem Planejada", ajuda: [p("Os dados do encaixe/corte. São preenchidos após o produto ser enviado à Explosão — até lá, ficam zerados.")] },
    ],
  },
  {
    id: "custos",
    titulo: "Preço e Custos",
    intro: [p("Os preços e custos do produto. O custo é calculado pelo sistema a partir da ficha de materiais e da mão de obra; o preço de venda é definido por você (ou sugerido pelo markup da Linha).")],
    campos: [
      { campo: "preco_anterior", rotulo: "Preço anterior", quando: "automático se vazio", ajuda: [
        p("O preço do produto antes desta versão — usado no e-commerce para mostrar “de / por”. Deixando em branco, o sistema usa o preço de venda da versão anterior. Se a versão anterior ainda não tem preço, o campo fica vazio (“aguardando preço da vN”)."),
        p("Qualquer valor digitado fixa o campo; o botão “↺” volta ao automático."),
      ] },
      { campo: "preco_venda", rotulo: "Preço de venda", ajuda: [p("O preço de venda (varejo) do produto. Nasce vazio, com o valor sugerido pelo markup como dica. É um requisito para lançar. Editar o preço de venda é uma permissão à parte — nem todo usuário a tem.")] },
      { campo: "custos", rotulo: "Custos (estimado e real)", ajuda: [p("O custo do produto, calculado pelo sistema: materiais + mão de obra. Enquanto o produto não é cortado, vale o estimado; depois, o real. Ver custos e preços é uma permissão — quem não a tem vê “—” no lugar dos valores.")] },
    ],
  },
  {
    id: "preco_venda",
    titulo: "Editar preço de venda",
    intro: [p("É a permissão específica para mexer no preço de venda (varejo) do produto, separada do resto do Preço. Quem tem só a visão de custos vê os valores, mas não edita o preço de venda sem esta permissão.")],
  },
  {
    id: "mao_obra",
    titulo: "Mão de obra",
    intro: [p("Os serviços de confecção do produto e seus valores. A mão de obra entra no custo e precisa estar aprovada para o produto ser lançado.")],
    campos: [
      { campo: "mo_linhas", rotulo: "Serviços (tipo · fornecedor · valor · aprovação)", ajuda: [
        p("Cada linha é um serviço: o tipo, o fornecedor, o valor e a decisão (aprovada, reprovada ou pendente). Aprovar ou reprovar é feito por linha e pode ser uma permissão à parte."),
        p("Trocar o valor, o serviço ou o fornecedor de uma linha já decidida faz ela voltar a “pendente” — a tela avisa em âmbar antes de salvar."),
      ] },
      { campo: "mo_liberado_auto", rotulo: "Custo liberado automaticamente", quando: "às vezes", ajuda: [p("Quando a versão não ficou mais cara que a anterior, o custo é liberado sem precisar aprovar a mão de obra — o produto pode ser lançado mesmo assim. O “i” na seção explica quando isso acontece.")] },
    ],
  },
  {
    id: "peca_teste",
    titulo: "Peça Teste",
    intro: [
      p("O acompanhamento das peças-teste do produto, por serviço: cada tentativa registra o fornecedor, as datas e a aprovação. Ver e lançar peças-teste é uma permissão à parte — o Leitor vê a seção, o Editor lança tentativas, datas e aprovação."),
      p("A peça teste só movimenta o estoque (tecidos, aviamentos e insumos). Não entra no custo do produto, não gera conta a pagar e não tem valor — é só controle."),
    ],
    campos: [
      { campo: "pt_fornecedor", rotulo: "Fornecedor da tentativa", ajuda: [p("O fornecedor de cada tentativa de peça teste. Depois que a peça é aprovada, o fornecedor fica travado. Se o tipo de serviço não tem fornecedor vinculado, a tela avisa — vincule em Cadastro › Serviço.")] },
    ],
  },
  {
    id: "anexos",
    titulo: "Anexos",
    intro: [p("Os arquivos do produto: croqui, desenho técnico, foto do modelo e ficha de medida. Alguns podem ser requisitos de fase, conforme a loja configurar.")],
  },
  {
    id: "lancamento",
    titulo: "Lançamento",
    intro: [p("A etapa final: definir a data e lançar o produto.")],
    campos: [
      { campo: "data_lancamento", rotulo: "Data de Lançamento", ajuda: [p("A data em que o produto é lançado. Preencha antes de lançar.")] },
      { campo: "lancar", rotulo: "Lançar / Cancelar Lançamento", ajuda: [p("O botão-foguete lança o produto. Para lançar, é preciso ter a Data de Lançamento, a mão de obra aprovada e — nas lojas que usam Produção — o CQ liberado. Se faltar algo, o botão mostra “Para lançar, falta:” com a lista. Lançado, o produto vai para a coluna final e aparece em Lançamentos.")] },
    ],
  },
  {
    id: "acoes",
    titulo: "Ações do card (rodapé e menu ⋯)",
    intro: [p("As ações que não são campos, na barra de baixo e no menu “⋯”.")],
    campos: [
      { campo: "enviar_explosao", rotulo: "Enviar à Explosão", ajuda: [p("Envia o produto para o corte/estoque. A partir daí, os campos vindos do Desenvolvimento ficam travados (o botão “Editar” os destrava de novo). Se faltar algum requisito, o “i” ao lado mostra o que falta.")] },
      { campo: "menu_mais", rotulo: "Menu ⋯ (Duplicar · Importar dados · Ficha Técnica · Cancelar Ordem)", ajuda: [p("Duplicar cria uma cópia (ou nova versão) do produto; Importar dados copia a ficha de outro produto como rascunho; Ficha Técnica abre a impressão; Cancelar Ordem devolve o produto ao planejamento.")] },
      { campo: "trava_integracao", rotulo: "Trava da Integração", quando: "quando integrado", ajuda: [p("Quando o produto é marcado na Integração, os campos marcados ficam travados para não divergir do que já foi enviado ao e-commerce. BOM, CAD, grade de produção, custos e PCP continuam editáveis. Para destravar, o super admin desfaz a integração.")] },
      { campo: "excluir", rotulo: "Excluir", ajuda: [p("Apaga o produto. Fica travado se o produto é integrável ou integrado — nesse caso é preciso desfazer a integração antes (ação do super admin).")] },
    ],
  },
];

const PLAN_TECIDO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("O Planejamento de Tecido é onde você planeja a compra de tecido de uma coleção inteira, ANTES de comprar: compara o que os produtos precisam (a necessidade) com o que você já tem (estoque e OCs a chegar) e mostra quanto falta comprar por cor."),
      p("Você começa escolhendo uma coleção na lista; cada card de coleção já adianta quantos modelos tem e um resumo (“a comprar X m”, “tecido coberto” ou “sem plano de tecido”). Ao abrir, o planejamento da coleção aparece organizado por tecido, com os produtos que o usam."),
    ],
  },
  {
    id: "lista",
    titulo: "Lista de coleções",
    intro: [p("A tela de entrada: os cards das coleções planejadas (as mesmas do OTB). É um módulo que depende do OTB estar ligado — sem coleções, o atalho leva você ao OTB para criar.")],
    campos: [
      { campo: "busca_filtros", rotulo: "Buscar · Ordenar · Filtros", ajuda: [p("A busca encontra pelo nome da coleção OU de uma subcoleção dentro dela. Os filtros (Mês, Ano, Status, Tipo) e a ordenação A–Z ajudam a achar a coleção certa. Tipo é Orçamento ou Poder de venda (vem do OTB); Status é Rascunho ou Confirmada.")] },
      { campo: "resumo_card", rotulo: "Resumo do card (modelos · a comprar)", ajuda: [p("Cada card mostra quantos modelos a coleção já tem e o resumo de tecido: “a comprar X m” (em vermelho) quando falta tecido, “tecido coberto” quando o estoque e as OCs cobrem, ou “sem plano de tecido” quando ainda não há necessidade calculada.")] },
    ],
  },
  {
    id: "coberturas",
    titulo: "Necessidade × estoque × OCs",
    intro: [p("Dentro da coleção, cada tecido mostra o que os produtos precisam dele e o que já está coberto. É a conta que diz quanto comprar: necessidade menos o que você já tem ou já pediu.")],
    campos: [
      { campo: "necessidade", rotulo: "Necessidade (PLAN)", ajuda: [p("Quanto de tecido os produtos da coleção consomem, por cor. É calculada a partir da ficha de materiais e da grade de cada produto. Produto reprovado sai da necessidade; o que já foi enviado ao corte continua contando.")] },
      { campo: "estoque", rotulo: "Estoque (EST) e a chegar", ajuda: [p("O que você já tem do tecido: o físico disponível mais o que está a chegar pelas OCs. A reserva de outras coleções que usam o mesmo tecido é descontada — por isso o EST pode ficar menor do que o físico puro.")] },
      { campo: "ocs", rotulo: "OCs vinculadas", ajuda: [p("As ordens de compra ligadas à coleção abatem a necessidade. Você pode ver a situação por OC — como a demanda se reparte entre as OCs vinculadas, na mesma ordem em que o corte as consome.")] },
      { campo: "comprar", rotulo: "A comprar (COMPR)", ajuda: [p("Quanto falta comprar = o que não está coberto por estoque nem por OC. É daqui que sai o botão de fazer o pedido do que falta.")] },
    ],
  },
  {
    id: "modo-plano",
    titulo: "Modo Plano",
    intro: [p("Uma visão alternativa, por nome de tecido (uma faixa por tecido), que mostra lado a lado EST · PLAN · SOB · COMPR por cor — “quanto tenho, quanto pretendo usar, quanto sobra, quanto comprar”.")],
    campos: [
      { campo: "est_plan_sob_compr", rotulo: "EST · PLAN · SOB · COMPR", ajuda: [
        p("Por cor do tecido: EST é o estoque (disponível + a chegar − reserva de outras coleções), PLAN é a necessidade do seu rascunho, SOB é o que sobra e COMPR é o que falta comprar (nunca negativo)."),
        p("O resumo recalcula AO VIVO enquanto você edita — mexer no consumo, nas cores ou na grade muda os números na hora, sem precisar salvar. O “i” ao lado do EST abre o detalhe das 3 parcelas (físico, a chegar e reservado por outras coleções)."),
      ] },
    ],
  },
  {
    id: "pedido",
    titulo: "Fazer pedido",
    intro: [p("O assistente que transforma o que falta (COMPR) em ordens de compra de tecido, agrupadas por fornecedor. A prévia é salva no servidor e é a mesma conta do resumo da coleção.")],
  },
  {
    id: "distribuir",
    titulo: "Distribuir por loja",
    intro: [p("No card de um produto, o dialog “Distribuir por loja” reparte a quantidade de peças entre as lojas, por cor e tamanho. A célula é calculada pela proporção, mas você pode corrigir à mão (vira “manual” até você voltar ao calculado). O resumo também aparece no Direcionamento.")],
    campos: [
      { campo: "distribuir", rotulo: "Distribuir por loja", quando: "só Tecido 1", ajuda: [p("Reparte por cor × loja × tamanho; o total por cor preenche a quantidade de peças do card. Um produto já Enviado à Explosão abre o dialog SÓ para leitura.")] },
    ],
  },
  {
    id: "replicar",
    titulo: "Replicar card(s)",
    intro: [p("Replica um ou mais produtos para outra coleção/subcoleção, copiando o essencial (tecido, medidas, NCM, “Tamanho em”). Título e Preço anterior NÃO são copiados — a cópia nasce com os dois no automático.")],
  },
];

const PRODUTO_ACABADO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("O Produto Acabado (Revenda) é onde você planeja produtos que compra prontos de um fornecedor para revender — você não fabrica. O planejamento é por coleção e subcoleção, num canvas de cards, igual ao Plan. Tecido."),
      p("Cada produto de revenda tem um card espelho no Planejamento, então ele também aparece no quadro de produtos e segue o fluxo de cores, grade e lançamento. É um módulo opcional (depende de a loja ter Produto Acabado e OTB ligados)."),
    ],
  },
  {
    id: "identidade",
    titulo: "Identidade do produto",
    intro: [p("O nome, a classificação e os dados do produto comprado. A REF é gerada automaticamente quando o produto é criado.")],
    campos: [
      { campo: "nome", rotulo: "Nome", ajuda: [p("O nome do produto de revenda. É copiado para o card espelho no Planejamento.")] },
      { campo: "taxonomia", rotulo: "Grupo · Categoria · Subcategoria 1 · Subcategoria 2", ajuda: [p("A classificação, em até quatro níveis. No grupo Acessórios, a grade é única (“UN”, sem tamanho) e algumas regras mudam.")] },
      { campo: "categoria_tecido", rotulo: "Categoria do tecido / Material do aviamento", quando: "pelo grupo", ajuda: [p("Um campo informativo que depende do grupo: Acessórios mostra “Material do aviamento”; os demais, “Categoria do tecido”. É usado pela Integração com o e-commerce.")] },
      { campo: "ref_fornecedor", rotulo: "Ref. Fornecedor", quando: "opcional", ajuda: [p("O código do produto no catálogo do fornecedor, para você se achar na hora do pedido.")] },
      { campo: "composicao", rotulo: "Composição", quando: "opcional", ajuda: [p("A composição do produto (ex.: 100% algodão). É texto livre.")] },
      { campo: "tamanho_tipo", rotulo: "Tamanho em (Letra ou Número)", ajuda: [p("Define se os tamanhos são por letra (P, M, G) ou por número. É o mesmo valor do Planejamento — mudar aqui reflete lá. Em Acessórios, não aparece (a grade é única).")] },
    ],
  },
  {
    id: "variantes-grade",
    titulo: "Variantes e grade",
    intro: [p("As cores do produto e a proporção da grade (quantas peças por cor e tamanho). É a base da quantidade e do pedido.")],
    campos: [
      { campo: "variantes", rotulo: "Variantes (cores)", ajuda: [p("As cores do produto comprado. Cada variante pode ter cor base e cor apelido.")] },
      { campo: "grade_proporcao", rotulo: "Proporção da grade · Quantidade total", ajuda: [p("A proporção por tamanho e a quantidade total. O sistema distribui a quantidade pelos tamanhos pela proporção informada.")] },
    ],
  },
  {
    id: "precos",
    titulo: "Preços e custo",
    intro: [p("O produto de revenda tem preço de atacado e de varejo, cada um por markup ou por valor fixo. O custo vem do valor de compra. Ver custos e preços é uma permissão à parte.")],
    campos: [
      { campo: "markups", rotulo: "Markup Atacado · Markup Varejo", ajuda: [p("O multiplicador que calcula o preço a partir do custo. Editar o markup limpa o valor fixo daquele canal.")] },
      { campo: "fixos", rotulo: "Valor atacado · Valor varejo", ajuda: [p("O preço fixo (quando você digita o preço direto em vez de usar o markup). Mexer no markup do mesmo canal apaga o fixo.")] },
    ],
  },
  {
    id: "oc",
    titulo: "Pedido e OC",
    intro: [p("A compra do produto pronto vira uma Ordem de Compra de Produto Acabado. Uma OC pode reunir vários produtos do mesmo fornecedor, mas cada produto fica em uma OC por vez.")],
    campos: [
      { campo: "fornecedor", rotulo: "Fornecedor", ajuda: [p("A empresa (ou o representante dela) de quem você compra. O assistente “Fazer pedido” agrupa os produtos por fornecedor e cria as OCs de uma vez.")] },
      { campo: "fazer_pedido", rotulo: "Fazer pedido · Na OC", ajuda: [p("O rodapé “Fazer pedido” abre o assistente para pedir os produtos da subcoleção que ainda não têm OC. Um produto que já está numa OC mostra em qual (e com quantos outros produtos a divide).")] },
    ],
  },
  {
    id: "status",
    titulo: "Status do produto",
    intro: [p("Enquanto o produto de revenda não vira um card no quadro, você marca a situação dele direto no planejamento.")],
    campos: [
      { campo: "status", rotulo: "Status (Pendente / Reprovado)", quando: "sem card", ajuda: [p("O seletor Pendente/Reprovado aparece só enquanto o produto não tem card no Planejamento. Com card, quem manda é a etapa do quadro (o selo da etapa aparece no lugar). “Criar card” recusa produto reprovado — avisa e pula os reprovados do lote.")] },
    ],
  },
];

const PRODUTO_IMPORTADO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("O Produto Importado é onde você planeja produtos que compra do exterior — como a revenda, mas com cotação de moeda e etapas de pagamento (mercadoria, frete, impostos). O planejamento é por coleção e subcoleção, num canvas de cards."),
      p("Como na revenda, cada produto importado tem um card espelho no Planejamento. É um módulo opcional (depende de a loja ter Produto Importado ligado)."),
    ],
  },
  {
    id: "identidade",
    titulo: "Identidade do produto",
    intro: [p("Nome, classificação e dados do produto importado. A REF é gerada automaticamente.")],
    campos: [
      { campo: "nome", rotulo: "Nome", ajuda: [p("O nome do produto importado. É copiado para o card espelho no Planejamento.")] },
      { campo: "taxonomia", rotulo: "Grupo · Categoria · Subcategoria 1 · Subcategoria 2", ajuda: [p("A classificação, em até quatro níveis. Em Acessórios a grade é única (“UN”).")] },
      { campo: "categoria_tecido", rotulo: "Categoria do tecido / Material do aviamento", quando: "pelo grupo", ajuda: [p("Campo informativo que muda com o grupo (Acessórios mostra “Material do aviamento”; os demais, “Categoria do tecido”); usado pela Integração.")] },
      { campo: "ref_composicao", rotulo: "Ref. Fornecedor · Composição", quando: "opcional", ajuda: [p("O código do produto no fornecedor e a composição (texto livre).")] },
      { campo: "tamanho_tipo", rotulo: "Tamanho em (Letra ou Número)", ajuda: [p("Define se os tamanhos são por letra ou por número. É o mesmo valor do Planejamento. Escondido em Acessórios.")] },
    ],
  },
  {
    id: "variantes-grade",
    titulo: "Variantes e grade",
    intro: [p("As cores e a proporção da grade do produto importado.")],
    campos: [
      { campo: "variantes", rotulo: "Variantes (cores)", ajuda: [p("As cores do produto, cada uma com cor base e cor apelido.")] },
      { campo: "grade_proporcao", rotulo: "Proporção da grade · Quantidade total", ajuda: [p("A proporção por tamanho e a quantidade total; o sistema reparte a quantidade pelos tamanhos.")] },
    ],
  },
  {
    id: "moeda-cotacao",
    titulo: "Moeda e cotação",
    intro: [p("O que diferencia o importado: o valor de compra é em outra moeda, e você registra a cotação para converter em reais.")],
    campos: [
      { campo: "moedas", rotulo: "Moeda de compra · Moeda intermediária", ajuda: [p("A moeda em que você paga o fornecedor (ex.: RMB) e, se houver, a moeda intermediária do câmbio.")] },
      { campo: "cotacoes", rotulo: "Cotação de referência · Cotação final", ajuda: [p("A cotação de referência (usada para prever o custo) e a cotação final (a efetiva). O preço do importado é tratado como preço fixo, convertido pela cotação.")] },
      { campo: "valor_unitario", rotulo: "Valor unitário (M1) · Transporte · Desconto", ajuda: [p("O valor unitário da mercadoria na moeda de compra, o transporte e o desconto — as parcelas que, com as cotações, compõem o custo em reais.")] },
    ],
  },
  {
    id: "etapas",
    titulo: "Etapas de pagamento",
    intro: [p("O pagamento do importado é dividido em etapas (mercadoria, frete, impostos…), cada uma com a sua base, percentual, vencimento e cotação. É daqui que saem as parcelas a pagar.")],
    campos: [
      { campo: "etapas", rotulo: "Etapas (base · percentual · vencimento · cotação)", ajuda: [p("Cada etapa é uma parte do pagamento: sobre qual base incide, o percentual, quando vence e com que cotação. Um produto novo nasce com as etapas padrão.")] },
    ],
  },
  {
    id: "precos",
    titulo: "Preços",
    intro: [p("Como na revenda, atacado e varejo por markup ou valor fixo. Ver preços é uma permissão à parte.")],
    campos: [
      { campo: "markups", rotulo: "Markup Atacado · Markup Varejo", ajuda: [p("O multiplicador do preço. Editar o markup limpa o valor fixo do mesmo canal.")] },
      { campo: "fixos", rotulo: "Valor atacado · Valor varejo", ajuda: [p("O preço fixo digitado direto; mexer no markup do mesmo canal o apaga.")] },
    ],
  },
];

const DESENVOLVIMENTO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("O Desenvolvimento é o quadro (kanban) dos produtos em desenvolvimento: um card por produto, em colunas que representam a etapa de cada um. É onde você acompanha o andamento e move os produtos pelas fases."),
      p("Clicar num card abre o MESMO editor do Planejamento (a ficha completa do produto: identidade, BOM, CAD, mão de obra, etc.). Ou seja: o quadro mostra onde cada produto está; a edição é a mesma do Planejamento, só aberta a partir do Desenvolvimento."),
    ],
  },
  {
    id: "quadro",
    titulo: "O quadro (colunas e cards)",
    intro: [p("As colunas são as etapas que a sua loja configurou (mais a coluna final “Lançado”). Cada card é um produto; ele avança quando cumpre os requisitos da próxima coluna.")],
    campos: [
      { campo: "colunas", rotulo: "Colunas (etapas)", ajuda: [p("Cada coluna é uma etapa do desenvolvimento, na ordem do fluxo da loja. A coluna “Lançado” é a final e aparece sempre. A coluna Reprovado nasce recolhida.")] },
      { campo: "mover", rotulo: "Mover o card · requisitos", ajuda: [p("Você move um card arrastando ou pelo menu “Mover para…”. A coluna que ainda não pode receber o card fica esmaecida — passe o mouse para ver o que falta (os requisitos de entrada daquela etapa).")] },
      { campo: "selo_etapa", rotulo: "Selo da etapa", ajuda: [p("O card mostra em que etapa está. Quando a loja usa o Kanban automático, o card avança sozinho à medida que cumpre os requisitos.")] },
      { campo: "abrir_card", rotulo: "Abrir o card (ficha)", ajuda: [p("Clicar no card abre a ficha completa do produto — o mesmo editor do Planejamento. As ações do quadro (arrastar, “Mover para…”) continuam valendo por fora da ficha.")] },
    ],
  },
];

const ARMARIO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("O Armário é onde você monta a vitrine do e-commerce de uma subcoleção: escolhe quais variantes (produto × cor) aparecem e em que ordem, arrastando-as para uma grade. É assim que a loja decide como os produtos se apresentam na loja virtual."),
      p("Você planeja por subcoleção e pode ter vários armários nela, em uma ordem que é a ordem em que a vitrine os mostra. É um módulo opcional (depende de a loja ter o Armário ligado)."),
    ],
  },
  {
    id: "lista",
    titulo: "Lista de armários",
    intro: [p("Escolha a coleção e a subcoleção para ver os armários dela. A lista é reordenável — a ordem aqui é a ordem na vitrine.")],
    campos: [
      { campo: "filtros", rotulo: "Ano · Mês · Coleção · Subcoleção", ajuda: [p("Os seletores que levam você até a subcoleção. Os armários aparecem na ordem em que a vitrine os mostra.")] },
      { campo: "novo", rotulo: "Novo armário · Duplicar", ajuda: [p("“Novo armário” cria um armário vazio para montar. Duplicar copia um armário existente — a cópia nasce como rascunho.")] },
    ],
  },
  {
    id: "montagem",
    titulo: "Montar a vitrine",
    intro: [p("Dentro de um armário, você arrasta variantes (produto × cor) para a grade e as organiza na ordem que quiser. O número de colunas controla o formato da grade.")],
    campos: [
      { campo: "variantes", rotulo: "Variantes disponíveis", ajuda: [p("A lista de variantes (produto × cor) da subcoleção que você pode arrastar para a grade. Uma variante cuja cor foi removida do cadastro aparece marcada em âmbar.")] },
      { campo: "grade", rotulo: "Grade · Colunas", ajuda: [p("A grade ordenada da vitrine. Arraste um item para outra posição para reordenar; o campo “Colunas” muda em quantas colunas a grade se dispõe. Salvar grava a ordem e o formato.")] },
    ],
  },
  {
    id: "status",
    titulo: "Status (rascunho → pronto → publicado)",
    intro: [p("O armário passa por três situações. Enquanto está em rascunho ou pronto, você edita; ao publicar, ele vai para a vitrine e fica somente leitura.")],
    campos: [
      { campo: "status", rotulo: "Rascunho · Pronto · Publicado", ajuda: [
        p("Rascunho é o armário em montagem; “Pronto” sinaliza que está fechado; Publicado é o que está no ar na vitrine. As transições são Marcar como pronto, Voltar para rascunho, Publicar e Despublicar."),
        p("Publicar e Despublicar pedem confirmação (ligam/desligam o armário na loja virtual). Armário publicado não é editável nem excluível — despublique antes."),
      ] },
    ],
  },
];

/** Telas do módulo Criação documentadas à mão. */
export const CRIACAO_CONTEUDO: ConteudoTelas = {
  criacao_planejamento: PLANEJAMENTO,
  criacao_plan_tecido: PLAN_TECIDO,
  criacao_produto_acabado: PRODUTO_ACABADO,
  criacao_produto_importado: PRODUTO_IMPORTADO,
  criacao_desenvolvimento: DESENVOLVIMENTO,
  criacao_armario: ARMARIO,
};
