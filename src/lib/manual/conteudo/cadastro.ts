// Conteúdo do Manual — módulo CADASTRO.
// Fiel aos campos, placeholders e textos de ajuda das telas de Cadastro. Mesmo tom e estrutura do criacao.ts.
import { p, lista, type ConteudoTelas, type SecaoConteudoManual } from "./tipos";

const ATRIBUTOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("Atributos é onde você cadastra as listas de apoio que o resto do sistema usa: cores, meses, anos, categorias de todo tipo, linhas, grupos de produto e muito mais. Sempre que uma tela oferece um menu suspenso (a categoria de um tecido, a cor de uma variante, a linha de um produto), as opções saem daqui."),
      p("As listas ficam organizadas por grupo (Geral, Fornecedor, Tecido, Aviamento, Insumo, Produto e Serviço). Cada lista tem busca, um botão para adicionar e edição direto na linha. Antes de excluir, o sistema confere se o item está em uso — se estiver, pede para você remover os vínculos primeiro."),
    ],
  },
  {
    id: "geral",
    titulo: "Geral — Cores, Ano e Mês",
    intro: [p("As listas básicas usadas em todo o cadastro: as cores (base e apelido) das variantes, e os anos e meses do calendário.")],
    campos: [
      { campo: "cor_base", rotulo: "Cor base", ajuda: [
        p("As cores do sistema. Cada cor tem um Nome e uma Sigla SKU (opcional)."),
        p("A Sigla SKU é usada no SKU automático: use só letras e números, sem acento nem espaço (ela fica em maiúsculas). Em branco, a cor não tem sigla — e as linhas de SKU que dependem dela ficam bloqueadas até você cadastrar a sigla."),
      ] },
      { campo: "cor_apelido", rotulo: "Cor apelido", ajuda: [
        p("Um apelido comercial de uma cor (ex.: “Canela” para um tom de bege). Cada apelido pertence a uma Cor base — você escolhe a cor base e dá o Nome do apelido."),
        p("Também tem uma Sigla SKU própria (mesma regra da cor base: só letras e números, sem acento nem espaço, em maiúsculas), usada no SKU automático quando o formato da loja inclui o apelido."),
      ] },
      { campo: "ano", rotulo: "Ano", ajuda: [p("Os anos disponíveis no cadastro (ex.: para datar um tecido). Cada um tem só um Nome.")] },
      { campo: "mes", rotulo: "Mês", quando: "fixos", ajuda: [p("Os 12 meses do calendário. Eles são fixos: você pode renomear, mas não criar nem excluir. A ordem é sempre a cronológica.")] },
    ],
  },
  {
    id: "fornecedor",
    titulo: "Fornecedor — Categorias de fornecedor",
    intro: [p("As categorias que classificam as empresas fornecedoras de material (ex.: Tecido, Aviamento). O fornecedor de um tecido só aparece como opção quando a empresa está numa categoria compatível.")],
    campos: [
      { campo: "cat_fornecedor", rotulo: "Categoria de Fornecedor", ajuda: [
        p("Cada categoria tem um Nome e um estado Ativo."),
        p("Desligar o Ativo esconde a categoria de novos usos (não exclui nada — o que já usa a categoria continua). Algumas categorias são fixas e não podem ser renomeadas nem excluídas."),
      ] },
    ],
  },
  {
    id: "tecido",
    titulo: "Tecido — Categorias de tecido",
    intro: [p("As categorias que classificam os tecidos do catálogo (ex.: Malha, Plano). Aparecem no cadastro do tecido como classificação.")],
    campos: [
      { campo: "cat_tecido", rotulo: "Categoria de Tecido", ajuda: [p("Cada categoria tem só um Nome. É usada para classificar os tecidos e, em produtos comprados, para o campo “Categoria do tecido”.")] },
    ],
  },
  {
    id: "aviamento",
    titulo: "Aviamento — Categoria, Subcategoria, Material e Intervalo de Largura",
    intro: [p("As listas que classificam os aviamentos (zíperes, botões, linhas…) no catálogo.")],
    campos: [
      { campo: "cat_aviamento", rotulo: "Categoria de Aviamento", ajuda: [p("Classificação principal do aviamento. Cada categoria tem só um Nome.")] },
      { campo: "subcat_aviamento", rotulo: "Subcategoria de Aviamento", ajuda: [p("Um nível abaixo da categoria. Você escolhe a Categoria de Aviamento a que a subcategoria pertence e dá o Nome.")] },
      { campo: "mat_aviamento", rotulo: "Material de Aviamento", ajuda: [p("O material do aviamento (ex.: metal, plástico). Cada um tem só um Nome. É usado no cadastro do aviamento e, em produtos comprados do grupo Acessórios, para o campo “Material do aviamento”.")] },
      { campo: "intervalo_largura", rotulo: "Intervalo de Largura", ajuda: [p("As faixas de largura usadas no cadastro do aviamento. Cada uma tem só um Nome.")] },
    ],
  },
  {
    id: "insumo",
    titulo: "Insumo — Tipo de produto",
    intro: [p("Os tipos que classificam os insumos (etiquetas, embalagens…).")],
    campos: [
      { campo: "tipo_insumo", rotulo: "Tipo de produto", ajuda: [p("O tipo do insumo (ex.: Etiqueta, Cartão, Croqui). Cada um tem só um Nome. Os tipos iniciais do sistema podem ser renomeados, mas não excluídos.")] },
    ],
  },
  {
    id: "produto",
    titulo: "Produto — Grupo, Categoria, Subcategorias e Linha",
    intro: [p("A classificação dos produtos, em níveis encadeados (Grupo › Categoria › Subcategoria 1 · Subcategoria 2), mais as Linhas com os markups de preço.")],
    campos: [
      { campo: "grupo_produto", rotulo: "Grupo", ajuda: [p("O nível mais alto da classificação do produto (ex.: Vestuário, Acessórios). Cada grupo tem só um Nome. Abre as Categorias.")] },
      { campo: "cat_produto", rotulo: "Categoria de Produto", ajuda: [p("O 2º nível. Você escolhe o Grupo a que a categoria pertence e dá o Nome. Abre as Subcategorias.")] },
      { campo: "subcat1_produto", rotulo: "Subcategoria 1", ajuda: [
        p("O 3º nível. Você escolhe a Categoria (mostrada como “Grupo › Categoria”) e dá o Nome."),
        p("Fora do modo só-estoque, a Subcategoria 1 ganha também o campo SLA de Serviços (dias) — o prazo, em dias, usado no acompanhamento de tempo de produção."),
      ] },
      { campo: "subcat2_produto", rotulo: "Subcategoria 2", ajuda: [p("Um 4º nível opcional, por baixo da Categoria (mostrada como “Grupo › Categoria”). Nem toda categoria usa a Subcategoria 2. Tem só o Nome.")] },
      { campo: "linhas", rotulo: "Linha", ajuda: [
        p("As linhas de produto, cada uma com três markups por faixa (multiplicadores ×, não porcentagem): Mínimo, Ideal e Máximo."),
        p("O Ideal é o markup usado no cálculo do preço de venda sugerido; Mínimo e Máximo delimitam a faixa aceitável. A ordem tem de ser Mínimo ≤ Ideal ≤ Máximo."),
      ] },
    ],
  },
  {
    id: "grade_tamanhos",
    titulo: "Grade de Tamanhos",
    intro: [p("A grade de tamanhos da loja e as siglas de cada tamanho para o SKU. Só o administrador da loja edita.")],
    campos: [
      { campo: "tamanhos", rotulo: "Tamanhos da grade", ajuda: [p("A lista de tamanhos, no formato Número|Letra (ex.: 38|P). A ordem define as colunas das grades em todo o sistema. Dá para reordenar e remover.")] },
      { campo: "siglas_sku", rotulo: "Siglas no SKU", ajuda: [
        p("Cada lado do tamanho tem a sua sigla (o número e a letra, ex.: 34 → 34 · PPP → PPP). O SKU usa o lado escolhido no campo “Tamanho em” (Letra ou Número) do produto."),
        p("Tamanho sem sigla não gera SKU. O botão “Preencher vazias com o próprio tamanho” copia o tamanho para a sigla que estiver em branco. A grade única “UN” dos acessórios, sem sigla, sai sem o tamanho."),
      ] },
    ],
  },
  {
    id: "servico",
    titulo: "Serviço — Categorias de serviço",
    intro: [p("As categorias dos serviços de confecção (corte, costura, acabamento…). Só o administrador da loja vê esta lista.")],
    campos: [
      { campo: "cat_terceirizado", rotulo: "Categoria do Serviço", ajuda: [
        p("Cada categoria tem um Nome, uma Etapa (Até costura ou Pós costura), um Valor padrão (R$/peça) e um estado Ativo. Desligar o Ativo esconde o serviço de novos usos (não exclui)."),
        p("O interruptor “Exige peça teste” faz todo produto que tenha este serviço na mão de obra ganhar uma trilha na seção Peça Teste do card. Desligar não apaga tentativas já lançadas — elas ficam como histórico. Alguns serviços são fixos do sistema (Corte, Oficina e PL) e não podem ser renomeados nem excluídos."),
      ] },
    ],
  },
];

const COLABORADORES: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("Colaboradores é onde você cadastra as pessoas envolvidas no processo, organizadas por tipo (ex.: Modelista, Piloteiro, Cortador). Esses nomes aparecem depois como opções nas telas que registram quem fez o quê — no Desenvolvimento, na Produção e nos serviços."),
      p("Há tipos fixos do sistema e tipos que você mesmo cria. Em cada tipo, você adiciona as pessoas daquele papel."),
    ],
  },
  {
    id: "tipos",
    titulo: "Tipos de colaborador",
    intro: [p("A coluna da esquerda lista os tipos. Você pode criar um tipo novo, renomear ou excluir os que criou (os fixos não).")],
    campos: [
      { campo: "nome_tipo", rotulo: "Nome do tipo", quando: "obrigatório", ajuda: [p("O nome do tipo de colaborador (ex.: Cortador). É como o grupo aparece na lista.")] },
      { campo: "categoria_servico", rotulo: "Categoria de serviço", quando: "opcional", ajuda: [p("Liga o tipo de colaborador a uma categoria de serviço, quando faz sentido. Pode ficar sem categoria.")] },
    ],
  },
  {
    id: "pessoas",
    titulo: "Pessoas do tipo",
    intro: [p("Dentro de cada tipo, você adiciona e edita as pessoas daquele papel. Cada pessoa tem o seu nome e aparece nas telas que pedem esse colaborador.")],
  },
];

const FORNECEDORES: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("Fornecedores é o cadastro das empresas de material e de serviço e dos seus representantes. É daqui que saem as opções de fornecedor nas ordens de compra (tecido, aviamento, insumo) e na mão de obra dos produtos."),
      p("Há dois tipos de registro: a Empresa (o fornecedor em si) e o Representante (alguém que representa uma empresa). Ao escolher um fornecedor numa compra, você pode comprar direto da empresa ou por um dos representantes dela."),
    ],
  },
  {
    id: "empresa",
    titulo: "Empresa",
    intro: [p("A empresa fornecedora. Pode ser de Material (vende tecido, aviamento, insumo) ou de Serviço (presta serviço de confecção).")],
    campos: [
      { campo: "tipo", rotulo: "Tipo (Material ou Serviço)", quando: "obrigatório", ajuda: [
        p("Define se a empresa fornece Material ou Serviço. Isso muda quais categorias ela usa: empresa de Material escolhe Categorias do Fornecedor; empresa de Serviço escolhe Categorias de Serviço."),
        p("Na edição, o Tipo fica travado se a empresa já tem categorias — para trocar, remova as categorias antes (trocar o tipo limpa as categorias)."),
      ] },
      { campo: "nome_fantasia", rotulo: "Nome fantasia", quando: "obrigatório", ajuda: [p("O nome da empresa. É como ela aparece nas listas e nos menus de fornecedor.")] },
      { campo: "categorias", rotulo: "Categorias do Fornecedor / de Serviço", quando: "obrigatório", ajuda: [p("As categorias da empresa (uma ou mais). Em empresa de Material são as Categorias do Fornecedor; em empresa de Serviço, as Categorias de Serviço. É o que faz a empresa aparecer como opção no lugar certo (ex.: o fornecedor do tecido só lista empresas de material com a categoria compatível).")] },
      { campo: "prazo_pagamento", rotulo: "Prazo de Pagamento", quando: "opcional", ajuda: [p("O prazo de pagamento padrão da empresa (ex.: 30/60/90). Alimenta a geração das parcelas a pagar nas compras dessa empresa.")] },
      { campo: "dados_fiscais", rotulo: "Dados fiscais (via CNPJ)", quando: "opcional", ajuda: [p("O CNPJ e os dados da empresa (razão social, endereço, contato, e-mail…). O botão “Buscar” ao lado do CNPJ preenche os dados pela Receita. Se a empresa não estiver ativa na Receita, a tela avisa.")] },
    ],
  },
  {
    id: "representante",
    titulo: "Representante",
    intro: [p("Uma pessoa que representa uma empresa. Ao comprar, você pode escolher a empresa direto ou um dos representantes dela — a compra fica registrada no par empresa + representante.")],
    campos: [
      { campo: "empresa_vinculada", rotulo: "Empresa vinculada", quando: "obrigatório", ajuda: [p("A empresa que este representante representa. Você escolhe uma empresa já cadastrada (ou cria uma na hora).")] },
      { campo: "nome_representante", rotulo: "Nome do representante", ajuda: [p("O nome da pessoa que representa a empresa.")] },
      { campo: "dados_fiscais_rep", rotulo: "Dados fiscais e contato", quando: "opcional", ajuda: [p("CNPJ, razão social, endereço, telefone, e-mail e contato do representante — os mesmos campos fiscais da empresa, com o botão “Buscar” pelo CNPJ.")] },
    ],
  },
];

const TECIDOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("Tecidos é o catálogo dos tecidos (artigos) da loja, cada um com as suas variantes de cor. É daqui que você escolhe os tecidos na ficha de materiais dos produtos, e é aqui que ficam o preço, o fornecedor e as fotos de cada tecido."),
      p("Você cria um tecido com os dados básicos e, na tela de edição, preenche o resto: categorias, preço, variantes de cor, endereços e foto."),
    ],
  },
  {
    id: "novo",
    titulo: "Novo tecido",
    intro: [p("Ao criar um tecido, você informa só o essencial — os demais campos ficam para a tela de edição.")],
    campos: [
      { campo: "nome", rotulo: "Nome do tecido", quando: "obrigatório", ajuda: [p("O nome do tecido (ex.: “Linho 100% premium”).")] },
      { campo: "unidade_medida", rotulo: "Unidade de medida", ajuda: [p("Define se o tecido é medido em Metro ou em Kg. Quando é Kg, a tela pede o rendimento para calcular o preço por metro.")] },
      { campo: "ncm", rotulo: "NCM", quando: "opcional", ajuda: [p("O código fiscal (NCM) do tecido. É um campo livre: digite só números e pontos (ex.: 5208.11.00).")] },
    ],
  },
  {
    id: "informacoes",
    titulo: "Informações do tecido",
    intro: [p("Os dados principais do tecido, na tela de edição.")],
    campos: [
      { campo: "fornecedor", rotulo: "Fornecedor", ajuda: [p("O fornecedor do tecido. Você escolhe a empresa direto ou um representante dela. A lista mostra as empresas de material compatíveis.")] },
      { campo: "largura", rotulo: "Largura Estimada (mtr)", quando: "opcional", ajuda: [p("A largura estimada do tecido, em metros.")] },
      { campo: "categorias", rotulo: "Categorias do Tecido", ajuda: [p("As categorias que classificam o tecido (uma ou mais), vindas de Atributos › Categoria de Tecido.")] },
      { campo: "composicao", rotulo: "Composição", quando: "opcional", ajuda: [p("A composição do tecido (ex.: “100% algodão”). Texto livre.")] },
      { campo: "mes_ano", rotulo: "Mês · Ano", quando: "opcional", ajuda: [p("O mês e o ano do tecido, quando você usa essa datação. Podem ficar em branco.")] },
      { campo: "preco", rotulo: "Preço", ajuda: [
        p("O preço do tecido, na unidade escolhida. O botão “Aplicar a todas” copia este preço para todas as variantes do tecido."),
        p("Quando a unidade é Kg, a tela pede o Rendimento (m/kg) e mostra o Preço por Metro calculado (preço ÷ rendimento)."),
      ] },
      { campo: "historico_precos", rotulo: "Histórico de Preços", ajuda: [p("O registro automático de cada alteração de preço do tecido. É só leitura.")] },
    ],
  },
  {
    id: "variantes",
    titulo: "Cores e Variantes",
    intro: [p("Cada variante é uma cor do tecido. É das variantes que saem as cores do produto na ficha de materiais.")],
    campos: [
      { campo: "cor", rotulo: "Cor base · Cor apelido", ajuda: [p("Para adicionar uma variante, escolha a Cor base e o apelido (vinculados) e clique em Adicionar. Se a cor (com esse apelido) já existir no tecido, a tela avisa. Se não houver cores disponíveis, cadastre-as antes em Atributos.")] },
      { campo: "variante_detalhe", rotulo: "Nome comercial · Código · Preço · Endereços · Foto", ajuda: [
        p("Cada variante pode ter um Nome comercial (opcional), um Código, um Preço próprio, Endereços de estoque e uma Foto."),
        p("Ao mudar o preço de uma variante, a tela avisa quantos produtos terão o custo recalculado — isso só vale quando você Salvar."),
      ] },
    ],
  },
];

const AVIAMENTOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("Aviamentos é o catálogo dos aviamentos da loja (zíperes, botões, linhas, elásticos…), cada um com as suas variantes de cor. É daqui que você escolhe os aviamentos na ficha de materiais dos produtos."),
      p("Cada aviamento tem a sua identidade, o preço, o fornecedor e a classificação; e pode ter variantes por cor (base + apelido).")],
  },
  {
    id: "dados",
    titulo: "Dados do aviamento",
    intro: [p("A identidade e a classificação do aviamento.")],
    campos: [
      { campo: "codigo", rotulo: "Código", quando: "automático se vazio", ajuda: [p("O código do aviamento. Deixando em branco, o sistema gera um automático.")] },
      { campo: "ncm", rotulo: "NCM", quando: "opcional", ajuda: [p("O código fiscal (NCM) do aviamento (ex.: 9606.22.00). Campo livre.")] },
      { campo: "nome", rotulo: "Nome", quando: "obrigatório", ajuda: [p("O nome do aviamento (ex.: “Botão metal 12mm”).")] },
      { campo: "fornecedor", rotulo: "Fornecedor", ajuda: [p("O fornecedor do aviamento. Você escolhe a empresa direto ou um representante dela.")] },
      { campo: "preco", rotulo: "Preço (R$)", ajuda: [p("O preço do aviamento.")] },
      { campo: "classificacao", rotulo: "Categoria · Subcategoria · Material · Composição", ajuda: [p("A classificação do aviamento, vinda de Atributos: a Categoria abre a Subcategoria; o Material e a Composição descrevem do que ele é feito.")] },
      { campo: "largura", rotulo: "Largura (intervalo e exata)", quando: "opcional", ajuda: [p("As medidas de largura do aviamento: o intervalo de largura e a largura exata — com os campos equivalentes para a versão vazada, quando se aplica.")] },
      { campo: "observacoes", rotulo: "Observações", quando: "opcional", ajuda: [p("Um texto livre com observações sobre o aviamento.")] },
    ],
  },
  {
    id: "variantes",
    titulo: "Cores e Variantes",
    intro: [p("As variantes de cor do aviamento, espelhando o padrão do tecido.")],
    campos: [
      { campo: "cor", rotulo: "Cor base · Cor apelido", ajuda: [p("Cada variante é uma cor: escolha a Cor base e o apelido (vinculados). As cores vêm de Atributos.")] },
    ],
  },
];

const INSUMOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("Insumos é o catálogo de etiquetas, embalagens e afins — itens que entram no produto além de tecido e aviamento. É daqui que você escolhe os insumos na ficha de materiais, com o consumo de cada um."),
      p("Cada insumo tem a sua identidade, unidade, fornecedor e preço, e pode ter variantes por cor e por tamanho.")],
  },
  {
    id: "dados",
    titulo: "Dados do insumo",
    intro: [p("A identidade e a classificação do insumo.")],
    campos: [
      { campo: "nome", rotulo: "Nome", quando: "obrigatório", ajuda: [p("O nome do insumo (ex.: “Etiqueta de composição”).")] },
      { campo: "tipo", rotulo: "Tipo de produto", quando: "opcional", ajuda: [p("O tipo que classifica o insumo (ex.: Etiqueta, Cartão), vindo de Atributos. Você pode criar um tipo novo na hora pelo próprio campo.")] },
      { campo: "unidade", rotulo: "Unidade", ajuda: [p("A unidade do insumo: unidade, metro, rolo ou milheiro.")] },
      { campo: "fornecedor", rotulo: "Fornecedor", quando: "opcional", ajuda: [p("O fornecedor do insumo. Você escolhe a empresa direto ou um representante dela. Pode ficar sem fornecedor.")] },
      { campo: "preco_base", rotulo: "Preço base (R$)", ajuda: [p("O preço do insumo. Quando há variantes por cor, cada cor pode ter o seu próprio preço — o botão “Aplicar a todas” copia o preço base para todas.")] },
    ],
  },
  {
    id: "tamanhos",
    titulo: "Tamanhos e vínculo a um tamanho",
    intro: [p("Como o insumo se relaciona com os tamanhos da grade do produto.")],
    campos: [
      { campo: "formato_tamanho", rotulo: "Formato dos tamanhos da grade", ajuda: [p("Define o formato dos tamanhos que o insumo usa na grade (letra P/M/G, número, ambos ou sem tamanho). Não é o tamanho físico do insumo.")] },
      { campo: "vincular_tamanho", rotulo: "Vincular a um tamanho", quando: "só insumo sem tamanho nas variantes", ajuda: [
        p("Use para o insumo que vai só nas peças de UM tamanho (ex.: etiqueta de tamanho M). Com o vínculo ligado, na Explosão a quantidade passa a ser consumo × peças desse tamanho, e o custo por peça é rateado."),
        p("Só vale para insumo sem tamanho nas variantes (formato “Nenhum” ou nenhum tamanho marcado). Ligado o interruptor, escolha o tamanho — senão o Salvar fica bloqueado."),
      ] },
    ],
  },
  {
    id: "variantes",
    titulo: "Variantes por cor",
    intro: [p("As variantes do insumo por cor e, se o formato permitir, por tamanho.")],
    campos: [
      { campo: "variantes_cor", rotulo: "Variantes por cor", quando: "opcional", ajuda: [
        p("Cada variante é uma cor (ou “Sem cor”) com um preço próprio. Sem nenhuma variante, o insumo usa só o preço base."),
        p("Quando o formato de tamanho não é “Nenhum”, você marca os tamanhos que existem em cada cor. Sem tamanho marcado, a variante é só da cor."),
      ] },
    ],
  },
];

const DESTINOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("Destinos é a lista de para onde a Ordem de Saída foi enviada (ex.: Novidade, Repetição, Devolução). É usada no modo só-estoque, para marcar o destino de uma saída."),
      p("Cada destino tem só um nome; você adiciona, renomeia e exclui pela lista.")],
    campos: [
      { campo: "nome", rotulo: "Nome", quando: "obrigatório", ajuda: [p("O nome do destino (ex.: “Novidade”).")] },
    ],
  },
];

const LOJAS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("Lojas é a lista de destinos do Direcionamento (ex.: E-commerce, Loja Física, franquias). Quando a Grade Real de um produto é distribuída, ela é repartida entre estas lojas — uma linha por loja."),
      p("Você adiciona lojas, renomeia e ativa/desativa direto na lista, e arrasta para reordenar. Só o administrador da loja edita.")],
    campos: [
      { campo: "nome", rotulo: "Nome da loja", quando: "obrigatório", ajuda: [p("O nome da loja de direcionamento (ex.: “Loja Física”). Edite direto na linha.")] },
      { campo: "status", rotulo: "Status (Ativa / Desativada)", ajuda: [p("Liga ou desliga a loja. Só lojas ativas recebem novas linhas no Direcionamento. Uma loja é marcada como Padrão e não pode ser excluída.")] },
    ],
  },
  {
    id: "base_linha",
    titulo: "Base por linha e quantidade",
    intro: [p("A configuração da distribuição automática por loja, usada pelo “Distribuir por loja” do Plan. Tecido.")],
    campos: [
      { campo: "base_linha", rotulo: "Base por linha e quantidade", ajuda: [p("Para cada linha de produto, você define uma base por loja em função da quantidade de peças. Na Distribuição por loja do Plan. Tecido, quando a quantidade de uma cor coincide com uma quantidade cadastrada aqui, a Base de cada loja é preenchida com estes valores. Sem quantidade igual, a Base fica 0.")] },
    ],
  },
];

/** Telas do módulo Cadastro documentadas à mão. */
export const CADASTRO_CONTEUDO: ConteudoTelas = {
  cadastro_atributos: ATRIBUTOS,
  cadastro_colaboradores: COLABORADORES,
  cadastro_servico: FORNECEDORES,
  cadastro_tecidos: TECIDOS,
  cadastro_aviamentos: AVIAMENTOS,
  cadastro_etiquetas: INSUMOS,
  cadastro_destinos: DESTINOS,
  cadastro_lojas: LOJAS,
};
