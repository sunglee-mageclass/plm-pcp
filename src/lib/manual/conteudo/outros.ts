// Conteúdo do Manual — OTB, Integração, Exportar e Importar.
import { p, type ConteudoTelas, type SecaoConteudoManual } from "./tipos";

const OTB: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "O orçamento antes de planejar",
    intro: [
      p("O OTB (Open To Buy) é o orçamento da coleção, montado ANTES do Planejamento: aqui você decide quanto pretende comprar ou produzir numa coleção — por subcoleção, por lançamento e por categoria — e só depois, no Planejamento, cria os produtos mirando esse alvo. Pense no OTB como a META e no Planejamento como a execução dela."),
      p("O plano é um ALVO FIXO: depois de confirmado, você cria, edita e exclui produtos no Planejamento livremente, e o OTB não se mexe sozinho. Ele só conta quantos cards já viraram realidade (o Realizado) e avisa quando você passa do combinado."),
      p("Há dois jeitos de montar uma coleção, escolhidos na hora de criar: por Orçamento (quantidade por lançamento e categoria) ou por Poder de Venda (metas de venda por linha, de cima para baixo). É um módulo opcional — depende de a loja ter o OTB ligado. Só quem tem permissão de editar o OTB consegue gravar."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como montar o orçamento de uma coleção",
    intro: [
      p("O caminho é: criar a coleção escolhendo o tipo, lançar as quantidades (ou as metas), e Confirmar para fechar o plano. Depois é só acompanhar o Planejado × Realizado."),
    ],
    campos: [
      { campo: "criar", rotulo: "Criar a coleção e escolher o tipo", ajuda: [
        { tipo: "passos", itens: [
          "Na lista de coleções, clique em “Nova coleção”.",
          "No diálogo “Como você quer montar esta coleção?”, escolha “Por Orçamento” (subcoleções, lançamentos e categorias) ou “Por Poder de Venda” (herda um Padrão do mix e mira a meta de venda).",
          "O editor da coleção se abre no tipo escolhido.",
        ] },
      ] },
      { campo: "orcamento", rotulo: "Montar por Orçamento", ajuda: [
        { tipo: "passos", itens: [
          "Preencha a identidade: “Nome de Coleção”, “Ano”, “Mês” e o “Orçamento” (valor de custo-alvo).",
          "Clique em “Subcoleção” para dividir a coleção (ex.: “Praia”, “Festa”) — ou deixe sem subcoleção e informe os modelos pelos lançamentos da coleção.",
          "Em cada subcoleção, informe a quantidade de peças por lançamento (1 a 5). A soma dos lançamentos é o total planejado.",
          "Se quiser detalhar, clique no botão ao lado da quantidade do lançamento para abrir “Categorias da semana”, reparta a quantidade entre as categorias (a soma tem de fechar com a do lançamento) e clique em “Aplicar”. A distribuição pode ser parcial — o resto vira produtos sem categoria.",
          "Use o bloco “Não classificados” para selecionar cards sem subcoleção/lançamento e dar um destino de uma vez em “Atribuir”.",
          "Clique em “Salvar”.",
        ] },
      ] },
      { campo: "poder-venda", rotulo: "Montar por Poder de Venda", ajuda: [
        { tipo: "passos", itens: [
          "Antes, monte um “Padrão do mix” (botão na lista): por linha, defina o número de modelos, se é “à parte”, a profundidade de cor e a faixa de preço.",
          "Ao criar a coleção por Poder de Venda, ela herda esse padrão e distribui o número de modelos pelas subcoleções.",
          "Na árvore “Subcoleção ▸ Linha × Semana”, ajuste as quantidades e os atributos (profundidade, cores, preço) nos lançamentos 1 a 5 — tudo editável em cima do padrão.",
          "Defina a data de lançamento por semana (ou escolha a data e o sistema devolve a semana).",
          "Acompanhe o poder de venda e o “mix % real vs meta” enquanto edita, e Salve.",
        ] },
      ] },
      { campo: "confirmar", rotulo: "Confirmar e acompanhar", ajuda: [
        { tipo: "passos", itens: [
          "Clique em “Confirmar” para fechar o plano — a coleção passa de Rascunho a Confirmada.",
          "Confirmar NÃO cria, edita nem apaga nenhum produto: o plano vira só o alvo e o Planejamento segue livre.",
          "A partir daí, acompanhe o Realizado (contagem viva de cards) e os avisos de divergência quando passar do planejado.",
        ] },
      ] },
    ],
  },
  {
    id: "lista",
    titulo: "Lista de coleções",
    intro: [p("A tela de entrada: os cards das coleções planejadas, com busca, filtros e os botões para criar ou importar coleções.")],
    campos: [
      { campo: "busca", rotulo: "Buscar coleção ou subcoleção", ajuda: [p("Encontra pelo nome da coleção OU de uma subcoleção dentro dela.")] },
      { campo: "filtros", rotulo: "Ano · Mês", ajuda: [p("Reduzem a lista ao período que você quer ver.")] },
      { campo: "nova_colecao", rotulo: "Nova coleção", ajuda: [p("Cria uma coleção. Antes de abrir o editor, você escolhe o TIPO: Por Orçamento ou Por Poder de Venda — é essa escolha que define como a coleção é montada.")] },
      { campo: "importar", rotulo: "Importar coleções existentes", ajuda: [p("Traz para o OTB coleções que já existem na loja (pelos nomes já usados nos produtos), para você passar a planejá-las aqui.")] },
      { campo: "status_card", rotulo: "Rascunho · Confirmada", ajuda: [p("O selo do card mostra a situação da coleção: Rascunho enquanto você monta, Confirmada depois de fechar o plano. Confirmar não cria nem apaga produtos — só marca o plano como fechado.")] },
    ],
  },
  {
    id: "orcamento",
    titulo: "Coleção por Orçamento",
    intro: [p("No editor, a coleção se abre em subcoleções, cada uma com semanas e quantidades. É a conta de quantas peças você pretende por período.")],
    campos: [
      { campo: "identidade", rotulo: "Nome da coleção · Ano · Mês", ajuda: [p("A identidade da coleção no calendário comercial.")] },
      { campo: "subcolecoes", rotulo: "Subcoleções", quando: "opcional", ajuda: [p("Dividem a coleção (ex.: “Praia”, “Festa”). Sem subcoleção, você informa os modelos pelo lançamento da coleção; clique em “Subcoleção” para dividir.")] },
      { campo: "semanas", rotulo: "Semanas × quantidade", ajuda: [p("Por subcoleção, a quantidade planejada em cada semana (1 a 5). A soma das semanas é o total planejado daquela subcoleção.")] },
      { campo: "categorias_semana", rotulo: "Categorias da semana", quando: "opcional", ajuda: [
        p("O botão ao lado da quantidade da semana abre a distribuição por categoria: quanto daquela semana vai para cada categoria. A soma das categorias tem de fechar com a quantidade da semana."),
        p("A distribuição pode ser PARCIAL: o que você não classificar vira o “resto”, que gera produtos sem categoria."),
      ] },
      { campo: "nao_classificados", rotulo: "Não classificados", ajuda: [p("Um bloco com os produtos que ainda não têm subcoleção/semana definidas. Você pode selecioná-los e atribuir um destino de uma vez pelo botão “Atribuir”.")] },
    ],
  },
  {
    id: "poder-venda",
    titulo: "Coleção por Poder de Venda",
    intro: [p("O caminho de cima para baixo: você parte de um “Padrão do mix” (quantos modelos por linha, profundidade de cor, faixa de preço) e o sistema distribui as metas pelas subcoleções e semanas, sempre editável.")],
    campos: [
      { campo: "padrao_mix", rotulo: "Padrão do mix", ajuda: [p("Um modelo reutilizável da loja: por linha, o número de modelos, se a linha é “à parte” (ex.: Acessórios), a profundidade de cor e a faixa de preço. O markup vem do cadastro da Linha — ele não é copiado. Cada linha entra uma vez só no padrão.")] },
      { campo: "arvore_pv", rotulo: "Subcoleção ▸ Linha × Semana", ajuda: [p("A árvore editável: por linha de cada subcoleção, os atributos (profundidade, cores, preço) e as quantidades nas semanas 1 a 5. O número de modelos do padrão é distribuído entre as subcoleções e repartido nas semanas.")] },
      { campo: "a_parte", rotulo: "À parte (por linha)", ajuda: [p("Uma linha “à parte” conta 100% sozinha (não entra no mix das demais, que somam 100% entre si). É editável por linha na coleção.")] },
      { campo: "datas_semana", rotulo: "Data de lançamento por semana", ajuda: [p("Cada semana da subcoleção tem a sua data (seg–dom do mês/ano, derivada e editável). É de mão dupla: definir a data devolve a semana. Uma subcoleção nova nasce sem semanas selecionadas.")] },
      { campo: "poder_venda", rotulo: "Poder de venda · mix % real vs meta", ajuda: [p("O poder de venda é a soma, por linha, de preço médio × profundidade de cor × quantidade. O indicador “mix % real vs meta” compara a distribuição que você montou com a meta, respeitando as linhas à parte.")] },
    ],
  },
  {
    id: "realizado",
    titulo: "Planejado × Realizado",
    intro: [p("Depois de confirmada, a coleção vira um alvo fixo. O OTB conta ao vivo quantos cards já existem no Planejamento e compara com o plano.")],
    campos: [
      { campo: "realizado", rotulo: "Realizado", ajuda: [p("A contagem viva de cards que caem em cada parte do plano (coleção, subcoleção, categoria ou linha). Criar, editar ou excluir produtos no Planejamento atualiza esses números.")] },
      { campo: "divergencia", rotulo: "Divergência (passou do plano)", ajuda: [p("Quando o Realizado ultrapassa o planejado na coleção, a linha fica vermelha e o ícone do OTB na barra lateral ganha um aviso; partes internas estouradas aparecem em âmbar. É só aviso — nada é bloqueado.")] },
    ],
  },
  {
    id: "confirmar",
    titulo: "Confirmar coleção",
    intro: [p("Fechar o plano. Confirmar marca a coleção como Confirmada — e NÃO cria, edita nem apaga nenhum produto. A partir daí o plano é o alvo; o Planejamento segue livre.")],
  },
];

const INTEGRACAO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A Integração organiza os produtos que o programa externo (ERP ou e-commerce) vai ler pela API: você escolhe quais produtos estão prontos, confere os dados e marca-os para serem entregues. É assim que a loja controla o que sai para a loja virtual, sem que nada vaze por engano."),
      p("A tela é feita de abas. Produtos e Log ficam para o admin da loja (com a permissão de Integração dada pelo super admin); Campos da API, API e Manual da API são só do super admin. Cada produto caminha por três situações: não integrável → integrável → integrado."),
      p("Esta tela é usada no computador — no celular ela não aparece. Há uma aba “Manual da API” AQUI DENTRO, com a documentação técnica da API (endereços, parâmetros, exemplos); este Manual geral explica a tela, não repete aquela documentação."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como marcar um produto como integrável",
    intro: [
      p("A ação do dia a dia mora na aba Produtos: você confere a lista, acha o que está pronto e o marca para a API. As demais abas (Campos da API, API, Log) são do super admin e preparam/acompanham a integração."),
    ],
    campos: [
      { campo: "marcar", rotulo: "Deixar um produto integrável", ajuda: [
        { tipo: "passos", itens: [
          "Abra a aba “Produtos”. A lista carrega os produtos da loja com a Situação, o Estado e a Versão de cada um (ela abre em “Não integrados”).",
          "Use o filtro por Estado para achar os prontos: “Faltam dados” (vermelho — falta algum campo marcado, o produto ainda não pode ser marcado), “Pronto para integrar” (âmbar — completo), “Integrável” e “Integrado”.",
          "Se faltar algum dado, edite as células da linha (é rascunho) e clique em “Salvar” — só depois de salvo e completo o produto fica “Pronto para integrar”.",
          "Ligue o interruptor da coluna “Integrável” na linha (ou marque vários e use “Integrar selecionados”). Confirme no diálogo “Integrar produtos”, em “Tenho certeza — integrar”.",
          "Uma vez integrável, os campos marcados ficam TRAVADOS nas outras telas (Planejamento, cards, Plan. Tecido), para não divergir do que foi liberado. Ele fica à espera de a API o ler.",
          "Para desfazer enquanto ainda está Integrável, desligue o interruptor “Integrável” e confirme em “Voltar para não integrável”. De Integrado só o super admin volta, pelo “⋯” da linha → “Desfazer integração” (com um motivo obrigatório).",
        ] },
      ] },
      { campo: "entregar", rotulo: "Entregar à mão com Gerar JSON", ajuda: [
        { tipo: "passos", itens: [
          "Quando a entrega é manual (em vez de a API buscar), selecione os produtos e clique em “Gerar JSON” na barra de seleção.",
          "Confirme em “Tenho certeza — gerar JSON”: abre a janela “JSON gerado” com o conteúdo.",
          "Use “Copiar” ou “Baixar arquivo (.json)”. Gerar o JSON conta como a integração — os Integráveis passam a Integrado.",
          "A aba “Log” registra quem integrou, voltou ou desfez (e os reprocessos do sistema) para acompanhar.",
        ] },
      ] },
    ],
  },
  {
    id: "estados",
    titulo: "As três situações do produto",
    intro: [p("O ciclo que todo produto percorre antes de aparecer no programa externo. Mudar entre eles é a ação principal da aba Produtos.")],
    campos: [
      { campo: "nao_integravel", rotulo: "Não integrável", ajuda: [p("O produto ainda não foi liberado. Pode estar “Faltam dados” (vermelho — falta algum campo marcado) ou “Pronto para integrar” (âmbar — completo, só falta ligar o interruptor “Integrável”).")] },
      { campo: "integravel", rotulo: "Integrável", ajuda: [p("Você ligou o interruptor “Integrável”: o produto está liberado e à espera de que a API o leia. Nesse estado, os campos marcados ficam TRAVADOS nas telas (Planejamento, cards, Plan. Tecido) para não divergir do que foi liberado.")] },
      { campo: "integrado", rotulo: "Integrado", ajuda: [p("A API já confirmou a entrega do produto. Para voltar atrás a partir de Integrado, só o super admin desfaz (com um motivo); de Integrável, você consegue “Voltar”.")] },
    ],
  },
  {
    id: "produtos",
    titulo: "Aba Produtos",
    intro: [p("A lista de produtos da loja com o estado de cada um e as ações para editar, integrar e voltar. É a mão dupla da Integração: editar aqui também reflete no card do produto. Edições são rascunho até o “Salvar” do rodapé.")],
    campos: [
      { campo: "tabela", rotulo: "Tabela · Situação · Estado · Versão", ajuda: [p("A lista é ordenável por coluna e filtrável por Situação (não integrados / integrados / todos), por Estado (faltam dados / pronto / integrável / integrado) e por Versão. Há busca por Nome ou REF.")] },
      { campo: "marcar", rotulo: "Interruptor “Integrável”", ajuda: [p("Na coluna “Integrável” de cada linha, o interruptor leva um produto “Pronto para integrar” para Integrável (ou marque vários e use “Integrar selecionados”); confirma-se no diálogo “Integrar produtos”. É o que libera o produto para a API. Enquanto faltam dados, o interruptor fica desabilitado.")] },
      { campo: "voltar", rotulo: "Voltar · Desfazer integração", ajuda: [p("Desligar o interruptor “Integrável” devolve um produto Integrável para não integrável (destrava os campos). De Integrado só o super admin volta, pelo “⋯” da linha → “Desfazer integração”, com um motivo.")] },
      { campo: "gerar_json", rotulo: "Gerar JSON (entrega manual)", ajuda: [p("Para quem entrega o arquivo à mão em vez de a API buscar: na barra de seleção, gera um arquivo .json com os produtos selecionados, para baixar ou copiar. Gerar o arquivo conta como a integração (os Integráveis passam a Integrado).")] },
    ],
  },
  {
    id: "campos",
    titulo: "Aba Campos da API",
    intro: [p("Só super admin. Define QUAIS campos a API entrega e quais deles travam o produto quando ele vira integrável. A escolha vale para toda a loja.")],
    campos: [
      { campo: "layout", rotulo: "Lista de campos", ajuda: [p("Os campos na ordem fixa em que saem na API. Marcar/desmarcar um campo do núcleo pede confirmação, e Salvar pede “Confirmar mudança”. Campo não marcado não trava nem é entregue.")] },
    ],
  },
  {
    id: "api",
    titulo: "Aba API",
    intro: [p("Só super admin. As chaves de acesso e as configurações da API: por onde o programa externo se autentica e lê os produtos.")],
    campos: [
      { campo: "codigo_loja", rotulo: "Código da loja", ajuda: [p("O código (parâmetro “loja”) que toda chamada da API precisa informar. Tem botão para Copiar e um exemplo de chamada pronto.")] },
      { campo: "chaves", rotulo: "Chaves · Nova chave", ajuda: [p("As chaves de acesso (Bearer) que a API exige. Você cria uma Nova chave e pode revogar as que não usa mais.")] },
      { campo: "acessos", rotulo: "Acessos recentes", ajuda: [p("O histórico recente de chamadas, incluindo tentativas de “Loja não autorizada” (chave válida tentando ler outra loja).")] },
    ],
  },
  {
    id: "log",
    titulo: "Aba Log",
    intro: [p("O histórico de ações da Integração: marcou, voltou, desfez, e as mudanças feitas pelo próprio sistema (ex.: reprocessos). Quem não é super admin vê só as ações de produto.")],
  },
];

const EXPORTAR_DADOS: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Levar os produtos para fora",
    intro: [
      p("Exportar dados tira os produtos da loja numa planilha (CSV ou Excel): você escolhe o recorte, marca as colunas, decide o nível de detalhe, confere numa prévia e baixa o arquivo. É o jeito de levar o catálogo para fora do sistema — conferir em outra ferramenta, enviar a alguém ou alimentar outro programa."),
      p("É um item com permissão própria (“exportar dados”): só o super admin concede, e ela começa vazia. Quem não tem a permissão não vê o item."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como escolher colunas e níveis e baixar",
    intro: [
      p("Três decisões em sequência — o recorte, as colunas e o nível —, uma prévia para conferir e o Baixar. Enquanto você não escolhe uma coleção, nada é consultado e o Baixar fica desabilitado."),
    ],
    campos: [
      { campo: "montar", rotulo: "Montar e baixar o arquivo", ajuda: [
        { tipo: "passos", itens: [
          "Em “1. Recorte”, escolha a Coleção — uma específica ou “Todas as coleções” (a loja inteira). Com uma coleção escolhida, dá para afinar pela Subcoleção (com “Todas as coleções”, a subcoleção fica desabilitada).",
          "Em “2. Colunas”, marque os campos que viram colunas do arquivo. Campos de variante (cor, tamanho) só têm valor nas linhas de cor/tamanho — ficam vazios na linha do SKU pai.",
          "Em “3. Níveis”, escolha o detalhe: “SKU pai” (1 linha por produto), “Até cor” (pai + 1 linha por cor) ou “Até tamanho” (pai + 1 linha por cor × tamanho).",
          "Confira a prévia (as primeiras linhas do menor nível marcado).",
          "Clique em “Baixar”. Um nível só gera um CSV; dois ou três níveis geram um Excel com uma aba por nível. O arquivo baixado é completo, sem limite.",
        ] },
      ] },
    ],
  },
  {
    id: "recorte",
    titulo: "1. Recorte",
    intro: [p("Que produtos entram no arquivo.")],
    campos: [
      { campo: "colecao", rotulo: "Coleção", ajuda: [p("A coleção a exportar. Você pode escolher uma coleção específica OU “Todas as coleções” (a loja inteira). Enquanto nada é escolhido, nada é consultado e o botão Baixar fica desabilitado.")] },
      { campo: "subcolecao", rotulo: "Subcoleção", quando: "por coleção", ajuda: [p("Dentro da coleção escolhida, uma subcoleção ou “Todas”. Com “Todas as coleções”, a subcoleção fica desabilitada (ela é sempre de uma coleção).")] },
    ],
  },
  {
    id: "colunas",
    titulo: "2. Colunas",
    intro: [p("Quais campos viram colunas do arquivo, na ordem do catálogo.")],
    campos: [
      { campo: "colunas", rotulo: "Colunas do produto", ajuda: [p("Marque os campos que quer na planilha. Campos de variante (cor, tamanho) só têm valor nas linhas de cor e de tamanho — ficam vazios na linha do SKU pai.")] },
    ],
  },
  {
    id: "niveis",
    titulo: "3. Níveis",
    intro: [p("O nível de detalhe das linhas: até onde o produto é “aberto” no arquivo.")],
    campos: [
      { campo: "niveis", rotulo: "SKU pai · Até cor · Até tamanho", ajuda: [
        p("SKU pai = 1 linha por produto. Até cor = o pai e 1 linha por cor. Até tamanho = o pai e 1 linha por cor × tamanho."),
        p("Um nível só gera um arquivo CSV; dois ou três níveis geram um Excel com uma aba por nível."),
      ] },
    ],
  },
  {
    id: "previa-baixar",
    titulo: "Prévia e Baixar",
    intro: [p("Antes de baixar, uma prévia mostra as primeiras linhas do recorte (do menor nível marcado). O botão Baixar gera o arquivo completo, sem limite.")],
  },
];

const IMPORTAR: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Trazer dados em massa por planilha",
    intro: [
      p("Importar Dados cadastra muitos itens de uma vez a partir de uma planilha: tecidos, aviamentos, insumos e produtos (e imagens em massa). Em vez de digitar item a item, você preenche o modelo de planilha da loja e envia tudo junto."),
      p("O fio do processo é sempre o mesmo: baixar o modelo → preencher → importar o arquivo → conferir a análise → Confirmar. NADA é gravado até você Confirmar — até lá é tudo prévia. A loja só oferece os tipos dos módulos que ela tem ligados."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como baixar o modelo, preencher e importar",
    intro: [
      p("Quatro passos: pegar a planilha certa, preencher, subir para análise e Confirmar. A análise é a hora de resolver pendências antes de gravar."),
    ],
    campos: [
      { campo: "fluxo", rotulo: "Do modelo à gravação", ajuda: [
        { tipo: "passos", itens: [
          "Clique em “Baixar Modelo” para pegar a planilha vazia no formato esperado (uma aba por tipo: tecido, aviamento, insumo, produto).",
          "Preencha só as abas dos tipos que você vai importar e salve a planilha.",
          "Se for importar imagens em massa, clique em “Selecionar imagens” e escolha os arquivos (nomeados pelo produto/cor).",
          "Clique em “Importar planilha” e envie o arquivo. O sistema lê todas as abas presentes e separa o que é de cada tipo; abas vazias são ignoradas e tipos de módulo desligado ficam de fora com aviso.",
          "Confira a Área de análise, em abas por tipo: resolva as pendências (fornecedor, cor, categoria ou apelido que não existem) escolhendo o valor certo nos campos em vermelho ou mandando cadastrar antes; marque “Ignorar” nas linhas que não quer gravar.",
          "Havendo imagens, confira o match visual (as fotos são casadas pelo nome do arquivo e dá para trocar a correspondência à mão).",
          "Clique em “Confirmar importação” para gravar TODOS os tipos de uma vez, na ordem das dependências (tecido, depois aviamento, depois insumo). Só aqui o sistema grava, e mostra um relatório do que entrou.",
        ] },
      ] },
    ],
  },
  {
    id: "baixar-modelo",
    titulo: "1. Baixar o modelo",
    intro: [p("A planilha-modelo com uma aba por tipo (tecido, aviamento, insumo, produto) e as colunas certas. Preencha nas abas e salve.")],
    campos: [
      { campo: "baixar", rotulo: "Baixar Modelo", ajuda: [p("Gera a planilha vazia no formato esperado. Preencha só as abas dos tipos que você vai importar.")] },
    ],
  },
  {
    id: "importar-planilha",
    titulo: "2. Importar a planilha",
    intro: [p("Envie o arquivo preenchido. O sistema lê TODAS as abas presentes (uma por tipo) e separa o que é de cada tipo.")],
    campos: [
      { campo: "enviar", rotulo: "Importar planilha", ajuda: [p("Sobe o arquivo e o analisa. Abas vazias são ignoradas; dados de um tipo que a loja não tem (módulo desligado) ficam de fora, com aviso. Sem nenhuma aba com dados, o sistema pede para baixar o modelo e tentar de novo.")] },
    ],
  },
  {
    id: "analise",
    titulo: "3. Conferir a análise",
    intro: [p("A área de análise mostra, em abas por tipo, o que será importado e o que precisa de ajuste antes de gravar.")],
    campos: [
      { campo: "lookups", rotulo: "Pendências e lookups", ajuda: [p("Linhas que apontam para algo que não existe (fornecedor, cor, categoria, apelido) ficam pendentes: você escolhe o valor certo ou manda cadastrar antes. Itens podem ser ignorados do lote.")] },
      { campo: "fotos", rotulo: "Imagens", quando: "quando há fotos", ajuda: [p("As imagens enviadas junto são casadas pelo nome do arquivo; você pode corrigir a correspondência à mão no match visual.")] },
    ],
  },
  {
    id: "confirmar",
    titulo: "4. Confirmar",
    intro: [p("A gravação. “Confirmar importação” grava TODOS os tipos de uma vez, na ordem das dependências (tecido, depois aviamento, depois insumo), e mostra um relatório do que entrou (criados, complementados, pulados, com erro). Até aqui, nada foi gravado. O botão fica desabilitado enquanto houver pendências ou nada a importar.")],
  },
];

/** Telas dos módulos OTB, Integração, Exportar e Importar documentadas à mão. */
export const OUTROS_CONTEUDO: ConteudoTelas = {
  otb: OTB,
  integracao: INTEGRACAO,
  exportar_dados: EXPORTAR_DADOS,
  importar: IMPORTAR,
};
