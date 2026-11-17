// Conteúdo À MÃO do Manual de uso (por tela), fiel ao comportamento real do sistema: aproveita os
// textos de InfoHover já escritos no Sheet, o mapeamento (§17) e as regras documentadas no CLAUDE.md.
// A `ManualPage` prefere este conteúdo quando a tela o tem; senão cai no esqueleto automático
// (description do catálogo + sub-permissões). Cada campo é um verbete: nome em negrito + ajuda.
import type { Bloco } from "@/components/shared/manual/tipos";

/** A ajuda à mão de UM campo de uma tela (verbete: rótulo em negrito + blocos de ajuda). */
export type CampoManual = {
  /** Identificador do campo (estável; vira a `key` do React). */
  campo: string;
  /** Rótulo legível (o subtítulo do verbete). */
  rotulo: string;
  /** Blocos de ajuda do campo (texto/passos/lista/tabela/imagem…). */
  ajuda: Bloco[];
  /** Quando esse campo se aplica (1 linha discreta ao lado do rótulo; ex.: "obrigatório"). */
  quando?: string;
};

/** Uma SEÇÃO temática do Manual de uma tela (espelha uma área do Sheet). `id` vira a âncora
 *  `#secao-<id>` usada pela ajuda contextual. `intro` é o texto de abertura; `campos` os verbetes. */
export type SecaoConteudoManual = {
  id: string;
  titulo: string;
  intro?: Bloco[];
  campos?: CampoManual[];
};

/** Mapa pageKey → seções de conteúdo à mão daquela tela. */
export type ConteudoTelas = Record<string, SecaoConteudoManual[]>;

const p = (texto: string): Bloco => ({ tipo: "p", texto });

// ─────────────────────────────────────────────────────────────────────────────
// PLANEJAMENTO DE PRODUTO (`criacao_planejamento`) — o Sheet unificado, área por área.
// ─────────────────────────────────────────────────────────────────────────────
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

/** Conteúdo à mão por tela. As telas sem entrada aqui usam só o esqueleto automático. */
export const CONTEUDO_TELAS: ConteudoTelas = {
  criacao_planejamento: PLANEJAMENTO,
};

/** Seções de conteúdo à mão de uma tela (ou `[]` se ainda não houver). PURO. */
export function conteudoDaTela(pageKey: string): SecaoConteudoManual[] {
  return CONTEUDO_TELAS[pageKey] ?? [];
}
