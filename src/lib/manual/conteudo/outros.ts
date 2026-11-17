// Conteúdo do Manual — OTB, Integração, Exportar e Importar.
import { p, type ConteudoTelas, type SecaoConteudoManual } from "./tipos";

const OTB: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("O OTB (Open To Buy) é o orçamento da coleção, feito ANTES do Planejamento: você decide quanto quer comprar ou produzir numa coleção — por subcoleção, por semana e por categoria — e, mais tarde, cria os produtos no Planejamento mirando esse alvo."),
      p("O plano é um ALVO FIXO: depois de confirmado, você cria, edita e exclui produtos no Planejamento livremente, e o OTB não se ajusta sozinho. Ele apenas compara o que foi planejado com o que já virou card (o Realizado) e avisa quando você passou do combinado."),
      p("São dois jeitos de montar uma coleção, escolhidos ao criar: por Orçamento (quantidade por semana e categoria) ou por Poder de Venda (metas de venda por linha, de cima para baixo). É um módulo opcional — depende de a loja ter o OTB ligado."),
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
    id: "estados",
    titulo: "As três situações do produto",
    intro: [p("O ciclo que todo produto percorre antes de aparecer no programa externo. Mudar entre eles é a ação principal da aba Produtos.")],
    campos: [
      { campo: "nao_integravel", rotulo: "Não integrável", ajuda: [p("O produto ainda não foi liberado. Pode estar “Faltam dados” (vermelho — falta algum campo marcado) ou “Pronto para integrar” (âmbar — completo, só falta você marcar).")] },
      { campo: "integravel", rotulo: "Integrável", ajuda: [p("Você marcou o produto: ele está liberado e à espera de que a API o leia. Nesse estado, os campos marcados ficam TRAVADOS nas telas (Planejamento, cards, Plan. Tecido) para não divergir do que foi liberado.")] },
      { campo: "integrado", rotulo: "Integrado", ajuda: [p("A API já confirmou a entrega do produto. Para voltar atrás a partir de Integrado, só o super admin desfaz (com um motivo); de Integrável, você consegue “Voltar”.")] },
    ],
  },
  {
    id: "produtos",
    titulo: "Aba Produtos",
    intro: [p("A lista de produtos da loja com o estado de cada um e as ações para marcar, voltar e conferir. É a mão dupla da Integração: editar aqui também reflete no card do produto.")],
    campos: [
      { campo: "tabela", rotulo: "Tabela · Situação · Estado · Versão", ajuda: [p("A lista é ordenável por coluna e filtrável por Situação (integrados/não integrados), por Estado (faltam dados / pronto / integrável / integrado) e por Versão. Carrega até 500 produtos de uma vez.")] },
      { campo: "marcar", rotulo: "Marcar (Integrar)", ajuda: [p("Leva um produto “Pronto para integrar” para Integrável. É o que libera o produto para a API.")] },
      { campo: "voltar", rotulo: "Voltar", ajuda: [p("Devolve um produto Integrável para não integrável (destrava os campos). De Integrado só volta pelo super admin.")] },
      { campo: "exemplo", rotulo: "Ver resposta de exemplo", quando: "super admin", ajuda: [p("Mostra como a API responderia, com dados de exemplo, para conferir o formato antes de entregar de verdade.")] },
      { campo: "gerar_json", rotulo: "Gerar JSON (entrega manual)", ajuda: [p("Para quem entrega o arquivo à mão em vez de a API buscar: gera um arquivo .json com os produtos integráveis da lista atual, para baixar ou copiar. Gerar o arquivo conta como a integração.")] },
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
    titulo: "Para que serve",
    intro: [
      p("Exportar dados gera uma planilha (CSV ou Excel) com os produtos da loja: você escolhe o recorte, as colunas e o nível de detalhe, confere numa prévia e baixa o arquivo."),
      p("É útil para levar os produtos para fora do sistema — conferir em outra ferramenta, enviar a alguém ou alimentar outro programa."),
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
    titulo: "Para que serve",
    intro: [
      p("Importar Dados cadastra muitos itens de uma vez a partir de uma planilha: tecidos, aviamentos, insumos e produtos (e imagens em massa). Em vez de digitar item a item, você preenche o modelo de planilha e envia tudo junto."),
      p("O fluxo é sempre o mesmo: baixar o modelo → preencher → importar o arquivo → conferir a análise → confirmar. Nada é gravado até você Confirmar. A loja só oferece os tipos dos módulos que ela tem."),
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
    intro: [p("A gravação. Confirmar grava TODOS os tipos de uma vez, na ordem das dependências (tecido, depois aviamento, depois insumo), e mostra um relatório do que entrou. Até aqui, nada foi gravado.")],
  },
];

/** Telas dos módulos OTB, Integração, Exportar e Importar documentadas à mão. */
export const OUTROS_CONTEUDO: ConteudoTelas = {
  otb: OTB,
  integracao: INTEGRACAO,
  exportar_dados: EXPORTAR_DADOS,
  importar: IMPORTAR,
};
