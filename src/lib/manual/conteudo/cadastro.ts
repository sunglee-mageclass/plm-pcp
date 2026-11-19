// Conteúdo do Manual — módulo CADASTRO.
// Fiel aos campos, placeholders e textos de ajuda das telas de Cadastro. Mesmo tom e estrutura do criacao.ts.
import { p, lista, type ConteudoTelas, type SecaoConteudoManual } from "./tipos";

const ATRIBUTOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Por onde tudo começa",
    intro: [
      p("Atributos é o primeiro passo do sistema. Aqui você monta as listas que todo o resto vai usar: as cores, as categorias, as linhas, os grupos de produto, os tamanhos. Sempre que uma tela, mais adiante, oferecer um menu suspenso — a cor de uma variante, a categoria de um tecido, a linha de um produto — as opções vêm daqui."),
      p("Por isso vale preencher os Atributos antes de cadastrar tecidos, aviamentos e produtos: sem as listas prontas, você trava na frente por falta de opção para escolher. Pense neste cadastro como o alfabeto da sua loja — depois de tê-lo, você consegue “escrever” o resto."),
      p("As listas ficam separadas em abas por assunto: Geral, Fornecedor, Tecido, Aviamento, Insumo, Produto e Serviço. Algumas abas (Produto, Serviço e os Tamanhos) são do administrador da loja."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("A tela funciona igual em todas as abas: uma lista com busca no topo e, em cada linha, o item cadastrado."),
    ],
    campos: [
      { campo: "adicionar", rotulo: "Adicionar um item", ajuda: [
        { tipo: "passos", itens: [
          "Escolha a aba do que você quer cadastrar (ex.: Geral › Cor base).",
          "Clique em “Novo” (ou “Adicionar”).",
          "Preencha o Nome e os campos que a lista pedir (por exemplo, a Sigla SKU de uma cor, ou a Cor base de um apelido).",
          "Confirme. O item já aparece na lista e passa a ser oferecido nas telas que usam aquela opção.",
        ] },
      ] },
      { campo: "editar", rotulo: "Editar ou renomear", ajuda: [
        p("Clique no lápis da linha para editar ali mesmo (nome e os campos extras). Salve na própria linha. Renomear um item muda o rótulo em todos os lugares que já o usam — o vínculo é mantido."),
      ] },
      { campo: "excluir", rotulo: "Excluir", ajuda: [
        p("Use o ícone de excluir da linha. Antes de apagar, o sistema confere se o item está em uso; se estiver, ele avisa e não deixa excluir — remova os vínculos primeiro. Itens fixos do sistema (como os 12 meses, ou os serviços Corte/Oficina/PL) não podem ser excluídos, só renomeados."),
      ] },
      { campo: "ordem", rotulo: "A ordem de cadastrar", ajuda: [
        p("Algumas listas dependem de outras — cadastre de cima para baixo: primeiro o Grupo, depois a Categoria (que pertence a um grupo), depois a Subcategoria (que pertence a uma categoria). O mesmo vale para a Cor base antes da Cor apelido. A lista mostra o “pai” antes do item (ex.: Grupo › Categoria) para você se situar."),
      ] },
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
      { campo: "subcat_tecido", rotulo: "Subcategoria de Tecido", ajuda: [p("Um nível abaixo da categoria de tecido. Você escolhe a Categoria de Tecido a que a subcategoria pertence e dá o Nome.")] },
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
    titulo: "Quem faz o quê",
    intro: [
      p("Colaboradores é a agenda das pessoas que trabalham na sua produção — a estilista, a modelista, o piloteiro, o cortador. Você cadastra cada pessoa dentro de um tipo (o papel dela), e esse nome passa a aparecer, mais adiante, nas telas que registram quem fez cada etapa: no card do produto (equipe e cronograma), na Produção e nos serviços internos."),
      p("Pense nela como o passo que vem logo depois dos Atributos: com as pessoas cadastradas aqui, quando você for montar um produto, já encontra a sua equipe pronta nos menus — não precisa digitar nome à mão nem correr o risco de grafar diferente a cada vez."),
      p("A tela tem a lista de tipos à esquerda (Estilista, Modelista e Piloteiro já vêm prontos; você cria os outros, como Cortador) e, à direita, as pessoas do tipo selecionado."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Primeiro escolha (ou crie) o tipo na coluna da esquerda; depois adicione as pessoas daquele papel na lista da direita."),
    ],
    campos: [
      { campo: "criar_tipo", rotulo: "Criar um tipo de colaborador", ajuda: [
        { tipo: "passos", itens: [
          "Na coluna da esquerda, clique no “+” ao lado de “Tipos de Colaborador” (no celular, use “Novo tipo” na barra de baixo).",
          "Dê o Nome do tipo (ex.: “Cortador”).",
          "Se fizer sentido, escolha uma Categoria de serviço — ela faz esse tipo ser oferecido como responsável nos serviços internos daquela categoria (ex.: Corte). Pode deixar sem categoria.",
          "Clique em “Criar”. O tipo novo aparece na lista e já fica selecionado.",
        ] },
      ] },
      { campo: "adicionar_pessoa", rotulo: "Adicionar uma pessoa ao tipo", ajuda: [
        { tipo: "passos", itens: [
          "Selecione o tipo na coluna da esquerda (ex.: Modelista).",
          "Na lista da direita, clique em “Novo”.",
          "Digite o nome da pessoa e salve.",
          "A pessoa passa a aparecer nos menus das telas que pedem esse papel (equipe do produto, serviços…).",
        ] },
      ] },
      { campo: "editar_excluir", rotulo: "Editar ou excluir", ajuda: [
        { tipo: "passos", itens: [
          "Para renomear uma pessoa: clique no lápis da linha, ajuste o nome e confirme ali mesmo.",
          "Para excluir uma pessoa: use o ícone de lixeira da linha. Se a pessoa estiver em uso em algum registro, o sistema avisa e não exclui.",
          "Para renomear ou excluir um tipo que você criou: passe o mouse sobre o tipo na coluna da esquerda e use os ícones de lápis/lixeira (no celular, o menu “⋯”). Um tipo só é excluído se não houver nenhuma pessoa dentro dele — remova as pessoas antes.",
          "Os tipos fixos (Estilista, Modelista, Piloteiro) não podem ser renomeados nem excluídos.",
        ] },
      ] },
    ],
  },
  {
    id: "tipos",
    titulo: "Tipos de colaborador (referência)",
    intro: [p("A coluna da esquerda lista os tipos. Estilista, Modelista e Piloteiro são fixos; os demais você cria, renomeia e exclui.")],
    campos: [
      { campo: "nome_tipo", rotulo: "Nome do tipo", quando: "obrigatório", ajuda: [p("O nome do tipo de colaborador (ex.: Cortador). É como o grupo aparece na lista.")] },
      { campo: "categoria_servico", rotulo: "Categoria de serviço", quando: "opcional", ajuda: [p("Liga o tipo a uma categoria de serviço (reaproveita as Categorias de Serviço). Com isso, essas pessoas aparecem como responsável nos serviços internos daquela categoria. Pode ficar sem categoria.")] },
    ],
  },
];

const FORNECEDORES: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "De quem você compra",
    intro: [
      p("Fornecedores é a lista de quem te vende material (tecido, aviamento, insumo) e de quem presta serviço de confecção. Todo lugar onde você escolhe “de quem comprar” — a Ordem de Compra de tecido, de aviamento, de insumo, e a mão de obra do produto — oferece as empresas cadastradas aqui."),
      p("Vale cadastrar o fornecedor antes de usá-lo numa compra: a empresa só aparece como opção na tela certa quando está com o tipo e a categoria combinando (uma empresa de Material com categoria de tecido só surge no fornecedor de tecido, e assim por diante)."),
      p("A tela tem duas abas. A Empresa é o fornecedor em si. O Representante é a pessoa que representa uma empresa — ao comprar, você pode escolher a empresa direto ou um dos representantes dela, e a compra fica registrada no par empresa + representante."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Comece pela aba Empresa (o representante precisa de uma empresa já cadastrada para se vincular)."),
    ],
    campos: [
      { campo: "cadastrar_empresa", rotulo: "Cadastrar uma empresa fornecedora", ajuda: [
        { tipo: "passos", itens: [
          "Na aba Empresa, clique em “Nova empresa”.",
          "Escolha o Tipo: Material (vende tecido/aviamento/insumo) ou Serviço (presta confecção). Isso decide quais categorias ela usa.",
          "Preencha o Nome fantasia (obrigatório).",
          "Marque as Categorias (uma ou mais): em empresa de Material são as Categorias do Fornecedor; em empresa de Serviço, as Categorias de Serviço. É o que faz a empresa aparecer no lugar certo das compras.",
          "Se quiser, informe o Prazo de Pagamento (ex.: 30/60/90) — ele alimenta as parcelas a pagar das compras dessa empresa.",
          "Opcional: digite o CNPJ e clique em “Buscar” para preencher razão social, endereço e contato pela Receita. Salve.",
        ] },
      ] },
      { campo: "cadastrar_representante", rotulo: "Cadastrar um representante", ajuda: [
        { tipo: "passos", itens: [
          "Vá para a aba Representante e clique em “Novo representante”.",
          "Escolha a Empresa vinculada — uma empresa já cadastrada (ou crie uma na hora pelo próprio campo).",
          "Digite o nome do representante.",
          "Opcional: CNPJ (com o botão “Buscar”), endereço, telefone, e-mail e contato. Salve.",
        ] },
      ] },
      { campo: "editar_excluir", rotulo: "Editar ou excluir", ajuda: [
        { tipo: "passos", itens: [
          "Para editar: clique no registro na lista para abrir o editor, ajuste e salve.",
          "Para excluir um: use o ícone de excluir da linha; para excluir vários, marque as caixas e use “Excluir (N)”.",
          "Empresa ou representante EM USO em pedidos/serviços/representantes NÃO é excluído — o sistema avisa e pula esses.",
          "Ao editar uma empresa, o Tipo (Material/Serviço) fica travado se ela já tem categorias — remova as categorias antes de trocar o tipo.",
        ] },
      ] },
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
    titulo: "O catálogo dos seus tecidos",
    intro: [
      p("Tecidos é o guarda-roupa de matéria-prima da sua loja: cada tecido com as suas cores (as variantes), o fornecedor, o preço e as fotos. Quando você monta a ficha de materiais de um produto, os tecidos que aparecem para escolher saem daqui — por isso vale cadastrá-los antes de começar a desenvolver as peças."),
      p("O fluxo tem duas partes. Primeiro você cria o tecido com o essencial (nome, unidade de medida, NCM). Em seguida, no editor que abre, completa o resto: categorias, fornecedor, preço e, principalmente, as cores. Cada cor é uma variante — e são essas variantes que viram as opções de cor do produto na ficha de materiais."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Criar um tecido são dois momentos: o cadastro rápido e, logo depois, o editor onde você preenche os detalhes e as cores."),
    ],
    campos: [
      { campo: "criar_tecido", rotulo: "Cadastrar um tecido", ajuda: [
        { tipo: "passos", itens: [
          "Clique em “Novo tecido”.",
          "Dê o Nome do tecido (obrigatório; ex.: “Linho 100% premium”).",
          "Escolha a Unidade de medida — Metro ou Kg. Quando for Kg, o editor vai pedir o rendimento (m/kg) para calcular o preço por metro.",
          "Se quiser, digite o NCM. Clique em “Criar e abrir”: o tecido é criado e o editor se abre para você continuar.",
        ] },
      ] },
      { campo: "completar_tecido", rotulo: "Completar os dados e cadastrar as cores", ajuda: [
        { tipo: "passos", itens: [
          "No editor, na área Informações, escolha o Fornecedor (empresa direto ou um representante), as Categorias do Tecido, e preencha largura, composição, mês/ano e o Preço.",
          "Dica: o botão “Aplicar a todas” copia o preço do tecido para todas as cores de uma vez.",
          "Na área “Cores e Variantes”, escolha a Cor base e a Cor apelido e clique em “Adicionar”. Repita para cada cor do tecido. (Se não houver cores para escolher, cadastre-as antes em Atributos.)",
          "Em cada cor você pode informar Nome comercial, Código, um Preço próprio, Endereços de estoque e uma Foto.",
          "Clique em “Salvar” — um único Salvar grava o tecido e todas as cores juntas.",
        ] },
      ] },
      { campo: "excluir_tecido", rotulo: "Excluir um tecido ou uma cor", ajuda: [
        { tipo: "passos", itens: [
          "Para excluir uma cor: use o ícone de excluir na linha da variante dentro do editor.",
          "Para excluir o tecido inteiro: abra o editor e use o botão “Excluir”.",
          "Antes de apagar, o sistema confere o uso (em OC, estoque, produto, CAD, ordem) e bloqueia se o tecido/cor estiver em uso — remova os vínculos primeiro.",
        ] },
      ] },
    ],
  },
  {
    id: "novo",
    titulo: "Novo tecido (referência)",
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
    titulo: "Zíperes, botões e companhia",
    intro: [
      p("Aviamentos é o catálogo dos itens que acompanham o tecido na peça: zíperes, botões, linhas, elásticos. Assim como os tecidos, eles aparecem na ficha de materiais dos produtos — então cadastre-os antes de montar as peças que os usam."),
      p("Cada aviamento tem a sua identidade (código, nome), o fornecedor, o preço e a classificação (categoria, subcategoria, material); e, quando faz sentido, pode ter variantes por cor (cor base + apelido), no mesmo esquema do tecido."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Cadastrar um aviamento é preencher a ficha dele e, se precisar, as cores."),
    ],
    campos: [
      { campo: "criar_aviamento", rotulo: "Cadastrar um aviamento", ajuda: [
        { tipo: "passos", itens: [
          "Clique em “Novo aviamento”.",
          "Dê o Nome (ex.: “Botão metal 12mm”). O Código pode ficar em branco — aí o sistema gera um automático; se preencher e o código já existir, a tela avisa.",
          "Escolha o Fornecedor (empresa ou representante) e informe o Preço.",
          "Classifique: Categoria (abre a Subcategoria), Material e Composição. Preencha as larguras e observações se precisar.",
          "Clique em “Salvar”.",
        ] },
      ] },
      { campo: "adicionar_cores", rotulo: "Adicionar cores (variantes)", ajuda: [
        { tipo: "passos", itens: [
          "Na área “Cores e Variantes” do aviamento, escolha a Cor base e, se houver, a Cor apelido.",
          "Clique em “Adicionar”. Repita para cada cor.",
          "As cores vêm de Atributos — se faltar alguma opção, cadastre-a lá antes.",
          "No cadastro de um aviamento novo, as cores ficam em rascunho e são gravadas quando você Salva; ao editar um já existente, cada cor é salva na hora.",
        ] },
      ] },
      { campo: "editar_excluir", rotulo: "Editar ou excluir", ajuda: [
        { tipo: "passos", itens: [
          "Para editar: clique no aviamento na lista, ajuste os campos ou as cores e salve.",
          "Para excluir: abra o aviamento e confirme a exclusão. Um aviamento em uso (em OC, produto, estoque) não é excluído.",
        ] },
      ] },
    ],
  },
  {
    id: "dados",
    titulo: "Dados do aviamento (referência)",
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
    titulo: "Etiquetas, embalagens e afins",
    intro: [
      p("Insumos é o catálogo dos itens que entram no produto além do tecido e do aviamento: etiquetas, embalagens, cartões, croquis. Eles também aparecem na ficha de materiais — você escolhe o insumo e informa o consumo de cada um — então cadastre-os antes de montar as peças."),
      p("Cada insumo tem identidade (nome, tipo), unidade, fornecedor e preço. Pode ter variantes por cor e por tamanho e, num caso especial, ser vinculado a UM tamanho só (ex.: uma etiqueta que vai apenas nas peças M)."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Cadastrar um insumo é preencher a ficha dele; os tamanhos e as cores só entram quando a peça precisa deles."),
    ],
    campos: [
      { campo: "criar_insumo", rotulo: "Cadastrar um insumo", ajuda: [
        { tipo: "passos", itens: [
          "Clique em “Nova etiqueta”.",
          "Dê o Nome (obrigatório; ex.: “Etiqueta de composição”).",
          "Escolha o Tipo de produto (ex.: Etiqueta, Cartão) — você pode criar um tipo novo ali mesmo pelo campo.",
          "Defina a Unidade (unidade, metro, rolo ou milheiro), o Fornecedor (opcional) e o Preço base.",
          "Salve.",
        ] },
      ] },
      { campo: "cores", rotulo: "Adicionar variantes por cor", ajuda: [
        { tipo: "passos", itens: [
          "Na área “Variantes por cor”, clique em “Cor” para adicionar um bloco.",
          "Escolha a cor (ou “Sem cor”). Cada cor pode ter um preço próprio; o botão “Aplicar a todas” copia o preço base para todas.",
          "Se o formato de tamanho não for “Nenhum”, marque os tamanhos que existem naquela cor. Sem tamanho marcado, a variante vale só para a cor.",
          "Sem nenhuma variante, o insumo usa só o preço base.",
        ] },
      ] },
      { campo: "vincular_tamanho", rotulo: "Vincular a um único tamanho", ajuda: [
        { tipo: "passos", itens: [
          "Use quando o insumo entra só nas peças de UM tamanho (ex.: etiqueta de tamanho M).",
          "Isso só está disponível para insumo SEM tamanho nas variantes (formato “Nenhum” ou nenhum tamanho marcado).",
          "Ligue o interruptor “Vincular a um tamanho” e escolha o tamanho. Se ligar sem escolher o tamanho, o Salvar fica bloqueado.",
          "Com o vínculo ativo, na Explosão a quantidade passa a ser consumo × peças desse tamanho, e o custo por peça é rateado.",
        ] },
      ] },
      { campo: "editar_excluir", rotulo: "Editar ou excluir", ajuda: [
        { tipo: "passos", itens: [
          "Para editar: clique no insumo na lista, ajuste e salve.",
          "Para excluir um: use o ícone de excluir da linha; para vários, marque as caixas e use “Excluir (N)”. Insumo em uso não é excluído.",
        ] },
      ] },
    ],
  },
  {
    id: "dados",
    titulo: "Dados do insumo (referência)",
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
    titulo: "Para onde a saída vai",
    intro: [
      p("Destinos é a lista de para onde uma Ordem de Saída foi enviada (ex.: Novidade, Repetição, Devolução). Ela é usada no modo só-estoque: ao registrar uma saída, você marca o destino escolhendo um desses nomes."),
      p("É um cadastro simples — cada destino tem só um nome. Vale deixar os destinos prontos aqui para que, na hora de lançar a saída, eles já estejam disponíveis para escolher."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("A tela é uma lista com busca no topo e um botão “Novo”."),
    ],
    campos: [
      { campo: "adicionar", rotulo: "Adicionar, editar ou excluir um destino", ajuda: [
        { tipo: "passos", itens: [
          "Clique em “Novo”, digite o Nome do destino (ex.: “Novidade”) e salve.",
          "Para renomear: clique no nome na lista (ou no lápis da linha), ajuste e salve.",
          "Para excluir: use o ícone de excluir da linha e confirme.",
          "Um destino em uso em alguma Ordem de Saída não é excluído — remova-o de lá antes.",
        ] },
      ] },
      { campo: "nome", rotulo: "Nome", quando: "obrigatório", ajuda: [p("O nome do destino (ex.: “Novidade”).")] },
    ],
  },
];

const LOJAS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para onde a produção é distribuída",
    intro: [
      p("Lojas é a lista de destinos do Direcionamento — os lugares por onde a sua produção é repartida (ex.: E-commerce, Loja Física, franquias). Quando a Grade Real de um produto é distribuída, ela é dividida entre estas lojas, uma linha por loja."),
      p("Deixe essas lojas cadastradas antes de usar o Direcionamento: é delas que saem as colunas digitáveis na hora de repartir a grade. Só o administrador da loja edita esta tela."),
      p("A tela tem duas partes: a lista das lojas (nome, status, ordem) no topo e, abaixo, a “Base por linha e quantidade”, que pré-preenche a distribuição automática usada pelo Plan. Tecido."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Você gerencia as lojas direto na lista — adicionar, renomear, ligar/desligar e reordenar."),
    ],
    campos: [
      { campo: "adicionar_loja", rotulo: "Adicionar e gerenciar lojas", ajuda: [
        { tipo: "passos", itens: [
          "Clique em “Adicionar loja”, digite o Nome (ex.: “Loja Física”) e confirme.",
          "Para renomear: edite o nome direto na linha.",
          "Use o interruptor da linha para deixar a loja Ativa ou Desativada — só lojas ativas recebem novas linhas no Direcionamento.",
          "Arraste a linha pela alça para reordenar (limpe a busca antes: com busca ativa, o arrastar fica desabilitado).",
          "Para excluir: use o ícone de excluir da linha. A loja marcada como Padrão não pode ser excluída.",
        ] },
      ] },
      { campo: "base_por_linha", rotulo: "Definir a base por linha e quantidade", ajuda: [
        { tipo: "passos", itens: [
          "Na seção “Base por linha e quantidade”, escolha uma linha de produto.",
          "Em “Adicionar quantidade”, informe uma quantidade de peças — o sistema cria uma coluna de Base por loja ativa para essa quantidade.",
          "Preencha a Base de cada loja para aquela quantidade.",
          "No “Distribuir por loja” do Plan. Tecido, quando a quantidade de uma cor coincidir com uma cadastrada aqui, a Base de cada loja é preenchida com estes valores (sem coincidência, a Base fica 0).",
        ] },
      ] },
      { campo: "nome", rotulo: "Nome da loja", quando: "obrigatório", ajuda: [p("O nome da loja de direcionamento (ex.: “Loja Física”). Edite direto na linha.")] },
      { campo: "status", rotulo: "Status (Ativa / Desativada)", ajuda: [p("Liga ou desliga a loja. Só lojas ativas recebem novas linhas no Direcionamento. Uma loja é marcada como Padrão e não pode ser excluída.")] },
    ],
  },
  {
    id: "base_linha",
    titulo: "Base por linha e quantidade (referência)",
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
