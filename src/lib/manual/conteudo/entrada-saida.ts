// Conteúdo do Manual — módulo ENTRADA E SAÍDA.
// Fiel às telas reais (OC Tecido/Aviamento/Insumo/P.Acabado/P.Importado, Explosão, Alertas, OS) e ao CLAUDE.md.
import { p, type ConteudoTelas, type SecaoConteudoManual } from "./tipos";

const EXPLOSAO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A Explosão é o ponto de passagem entre o planejamento e a produção: é aqui que você confere quanto cada produto vai consumir e envia o produto para o corte, baixando o estoque do que foi separado."),
      p("A lista mostra os produtos que já saíram do Desenvolvimento (Enviados à Explosão) e ainda não foram cortados, além dos de revenda que já tiveram a OC recebida. Clicando no produto, abre o Sheet onde você ajusta a metragem, o que separar e envia para o PCP."),
    ],
  },
  {
    id: "situacao",
    titulo: "Situação",
    intro: [p("O estado de cada produto na fila do corte, mostrado em cada linha e no topo do Sheet pela mesma regra (lista e detalhe nunca divergem).")],
    campos: [
      { campo: "aguardando", rotulo: "Aguardando", ajuda: [p("O produto ainda não foi enviado para o PCP (corte). É o que você precisa conferir e enviar.")] },
      { campo: "enviado", rotulo: "Enviado", ajuda: [p("O produto já foi cortado (enviado para o PCP) e o estoque já foi baixado. Continua na lista e pode ser reaberto para edição.")] },
      { campo: "faltou_estoque", rotulo: "Faltou estoque", ajuda: [p("O produto foi enviado, mas no último envio faltou tecido em estoque para alguma variante. O déficit fica registrado; quando o tecido chegar, o sistema completa a baixa sozinho (ou use o botão “Reprocessar faltas”).")] },
    ],
  },
  {
    id: "separar-enviar",
    titulo: "O que separar e enviar",
    intro: [p("Dentro do Sheet, três blocos mostram tudo o que o produto precisa consumir. A quantidade necessária é calculada pelo sistema (consumo por peça × grade); você só ajusta o quanto vai de fato sair e envia.")],
    campos: [
      { campo: "metragem", rotulo: "Metragem", ajuda: [p("A metragem de tecido a enviar para o corte, por tecido. A necessidade é calculada; você pode ajustar a metragem que de fato vai sair. É dela que sai o total “Enviar para PCP · X m” do botão.")] },
      { campo: "aviamentos_separar", rotulo: "Aviamentos a separar", ajuda: [p("A quantidade de cada aviamento a separar, por cor. A necessidade é consumo por peça × grade; só o “a separar” é editável.")] },
      { campo: "insumos_enviar", rotulo: "Insumos a enviar", ajuda: [p("A quantidade de cada insumo (etiquetas, embalagens) a enviar. A necessidade é consumo por peça × grade (ou pelas peças do tamanho, quando o insumo é vinculado a um tamanho); só o “a enviar” é editável. Insumo vinculado a um tamanho mostra um aviso quando o tamanho está fora da grade.")] },
    ],
  },
  {
    id: "acoes",
    titulo: "Enviar para PCP e reprocessar faltas",
    campos: [
      { campo: "enviar_pcp", rotulo: "Enviar para PCP", ajuda: [
        p("O botão que efetiva o corte: salva a metragem, o que separar e o que enviar, e baixa o estoque, tudo numa única operação. A partir daí o produto segue para os Serviços e o CQ."),
        p("Produtos de revenda são obrigados a passar pela Explosão para chegar ao CQ, mesmo sem nada a separar. Para os demais, “Nada a separar” bloqueia o envio quando metragem, aviamentos e insumos estão todos zerados."),
      ] },
      { campo: "reprocessar_faltas", rotulo: "Reprocessar faltas", quando: "só admin da loja", ajuda: [p("Completa o “Faltou estoque” dos cortes já enviados, usando o tecido que entrou no estoque desde então — só o déficit, do corte mais antigo. É um botão do admin da loja; o estoque nunca fica negativo.")] },
    ],
  },
];

const OC_TECIDO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A OC de Tecido é onde você registra os pedidos de compra de tecido para os fornecedores e dá entrada quando a mercadoria chega. É dela que o estoque de tecido é alimentado e que nascem as contas a pagar da compra."),
      p("A tela tem quatro abas: Recebidas, Encomendadas, Estoque e Rolos. Para abrir um pedido novo, use “Nova OC”; para editar um existente, clique na linha."),
    ],
  },
  {
    id: "pedido",
    titulo: "1. Pedido",
    intro: [p("Os dados de cabeçalho da compra: para quem, quando e como vai ser pago.")],
    campos: [
      { campo: "numero_pedido", rotulo: "Número do Pedido", quando: "automático se vazio", ajuda: [p("O número do pedido. Deixando em branco, o sistema sugere o próximo número da loja.")] },
      { campo: "fornecedor", rotulo: "Fornecedor", ajuda: [p("A empresa (ou o representante dela) que vende o tecido. A lista mostra os fornecedores de material casados com a categoria de tecido.")] },
      { campo: "responsavel", rotulo: "Responsável", ajuda: [p("Quem fez a compra.")] },
      { campo: "data_pedido", rotulo: "Data do Pedido", ajuda: [p("A data em que o pedido foi feito.")] },
      { campo: "data_prevista", rotulo: "Data Prevista de Entrega", quando: "obrigatório", ajuda: [p("A previsão de chegada do tecido. A tela avisa quando um pedido encomendado passa dessa data.")] },
      { campo: "prazo_pagamento", rotulo: "Prazo de Pagamento", quando: "obrigatório", ajuda: [
        p("Os prazos a pagar, em dias corridos, separados por barra — por exemplo “30/60/90” vira 3 parcelas a pagar."),
        p("Atenção: isto é o prazo das contas a pagar (financeiro), que não é a mesma coisa das entregas parceladas (recebimento)."),
      ] },
      { campo: "parcelas_pagar", rotulo: "Parcelas a pagar (derivado)", ajuda: [p("Quantas parcelas a pagar saem do prazo. É só leitura — vem do campo Prazo de Pagamento.")] },
      { campo: "entregas_parceladas", rotulo: "Entregas parceladas (qtd)", ajuda: [p("Em quantas entregas o tecido vai chegar. Cada entrega vira uma linha de parcela de recebimento, com data prevista.")] },
    ],
  },
  {
    id: "itens",
    titulo: "2. Itens do pedido (variantes)",
    intro: [p("Os tecidos comprados e suas cores. O Tecido 1 é o principal; o Tecido 2 é opcional.")],
    campos: [
      { campo: "tecido_variantes", rotulo: "Tecido · Variantes (cores)", ajuda: [p("Escolha o tecido e marque as variantes (cores) que entram neste pedido. Cada variante marcada vira um item com quantidade e preço.")] },
      { campo: "quantidade_preco", rotulo: "Quantidade pedida · Preço · Rendimento", ajuda: [
        p("A quantidade comprada e o preço por item. O preço do item tem prioridade sobre o do cadastro; há um atalho para aplicar o mesmo preço a todas as variantes."),
        p("Quando o tecido é comprado por quilo, o rendimento (metros por quilo) converte a quantidade recebida em metros — o estoque de tecido é sempre contado em metros."),
      ] },
    ],
  },
  {
    id: "anexos",
    titulo: "3. Anexos e Notas Fiscais",
    intro: [p("Os arquivos do pedido. As Notas Fiscais ficam aqui, fora da seção de Recebimento.")],
    campos: [
      { campo: "anexo_pedido", rotulo: "Anexo do Pedido · Modelo Sugerido", ajuda: [p("Arquivos de apoio do pedido (o PDF do pedido e um modelo sugerido).")] },
      { campo: "notas_fiscais", rotulo: "Notas Fiscais", ajuda: [p("As NFs da compra, anexadas como lista. Ficam travadas enquanto a OC não é salva.")] },
    ],
  },
  {
    id: "recebimento",
    titulo: "4. Recebimento",
    intro: [p("A entrada da mercadoria. Só aparece depois que a OC é salva. É aqui que a OC passa de “Encomendada” para “Recebida” e o estoque entra.")],
    campos: [
      { campo: "data_nota", rotulo: "Data da Nota de Entrada", ajuda: [
        p("A data da nota fiscal do fornecedor, no topo desta seção. É a partir dela que são contados os vencimentos das parcelas a pagar (Data da Nota + os dias de cada prazo)."),
        p("Continua editável mesmo com a OC já recebida. Sem a Nota, o vencimento cai numa data provisória (data de entrega ou do pedido).")] },
      { campo: "responsavel_receb", rotulo: "Responsável pelo recebimento", ajuda: [p("Quem conferiu a entrada.")] },
      { campo: "parcelas_receb", rotulo: "Parcelas de entrega · Recebida", ajuda: [p("Uma linha por entrega, com a data e a marca “Recebida”. Para marcar a OC como recebida, todas as parcelas precisam de data e de estar marcadas.")] },
      { campo: "qtd_recebida", rotulo: "Quantidade recebida por variante", ajuda: [p("O quanto chegou de cada cor. É daí que vem o estoque físico e o valor real da compra. Cada variante pode ter uma observação de recebimento (defeito, tonalidade).")] },
      { campo: "obs_defeitos", rotulo: "Observações sobre Defeitos", ajuda: [p("Um texto livre sobre problemas na entrega.")] },
      { campo: "marcar_recebido", rotulo: "Marcar / Desmarcar Recebido", ajuda: [p("O botão do rodapé confirma a entrada (o estoque entra e as parcelas a pagar são recalculadas). Desmarcar devolve a OC a “Encomendada”. Uma OC recebida nunca volta a encomendada pelo Salvar — só pelo “Desmarcar recebimento”.")] },
    ],
  },
  {
    id: "estoque",
    titulo: "Aba Estoque",
    intro: [p("A posição de estoque de cada tecido×variante (não lista OCs). Três números resumem a situação.")],
    campos: [
      { campo: "fisico", rotulo: "Físico Real", ajuda: [p("O estoque físico agora = Recebido − Baixa (consumo no corte/OS + ajustes). Nunca fica negativo.")] },
      { campo: "reservado", rotulo: "Reservado", ajuda: [p("A demanda que já reservou este tecido: produtos ainda não cortados (consumo × grade × perda) mais as Ordens de Saída abertas.")] },
      { campo: "previsto", rotulo: "Previsto", ajuda: [p("O saldo projetado = Físico Real + Previsto receber − Reservado. Pode ficar negativo (a reserva passou do disponível — um sinal legítimo).")] },
      { campo: "historico", rotulo: "Histórico", ajuda: [p("Por linha, abre um extrato só-leitura de toda a movimentação do item (recebimentos de OC, baixas de corte, separação de rolo, ajustes e OS).")] },
    ],
  },
  {
    id: "rolos",
    titulo: "Aba Rolos",
    intro: [p("Quem controla o tecido por rolo individual gerencia os rolos aqui. Um rolo é uma unidade física de estoque de uma única variante.")],
    campos: [
      { campo: "criar_rolo", rotulo: "Criar rolo", ajuda: [
        p("Monta um rolo a partir de uma OC/rolo de origem, para uma variante. O Código é sugerido automaticamente (formato com sequência, categoria e data) e pode ser editado; você pode informar Rua e Prateleira do endereçamento."),
        p("Separar um rolo é uma transferência (baixa reversível), não um consumo. Um rolo já consumido ou vinculado ao Desenvolvimento fica bloqueado para edição.")] },
    ],
  },
];

const ALERTAS_TECIDO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("Os Alertas de Tecido reúnem os tecidos que o Controle de Qualidade marcou para decisão do Estilo: resolver com Estilo OK, trocar por outro tecido ou cancelar."),
      p("Um alerta nasce quando, no CQ da OC, alguém liga o “Alertar estilo” em um item ou rolo. A tela tem as abas Pendentes e Resolvidos; cada cartão mostra o tecido, a variante, a origem (OC ou Rolo) e o status."),
    ],
  },
  {
    id: "acoes",
    titulo: "Decisões por alerta",
    campos: [
      { campo: "estilo_ok", rotulo: "Estilo OK", ajuda: [p("Resolve o alerta sem troca — o tecido fica como está. Em OC, recalcula valor e parcelas.")] },
      { campo: "trocar", rotulo: "Trocar variante / Trocar rolo", ajuda: [p("Abre o diálogo para substituir o tecido: escolha o tecido substituto, a variante e a metragem esperada. O original sai do estoque e do consumo; o substituto entra como “a receber”. Em seguida, use “Receber reposição” (com data e metragem) para concluir a troca, ou “Desfazer troca”.")] },
      { campo: "cancelar", rotulo: "Cancelar variante / Cancelar rolo", ajuda: [p("Tira a variante (ou o rolo) do estoque, do consumo e da previsão. Pede confirmação. Um rolo em uso fica bloqueado.")] },
      { campo: "reabrir", rotulo: "Reabrir", ajuda: [p("Na aba Resolvidos, devolve o alerta à fila de pendentes (pede confirmação). Uma troca já concluída não reabre.")] },
      { campo: "observacao", rotulo: "Observação", ajuda: [p("Um texto livre compartilhado com o CQ da OC. Para quem só vê a tela, os botões de ação somem e a observação vira apenas texto.")] },
    ],
  },
];

const OC_P_ACABADO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A OC de Produto Acabado registra a compra de peças prontas de um fornecedor, para revender (você não fabrica). Uma mesma OC pode ter vários produtos, e cada produto é recebido e conferido separadamente."),
      p("A tela tem as abas Recebidas, Encomendadas e Estoque. Uma OC parcialmente recebida fica em Encomendadas até o último produto chegar."),
    ],
  },
  {
    id: "pedido",
    titulo: "1. Dados do pedido",
    intro: [p("O cabeçalho vale para a OC inteira (um único fornecedor por OC).")],
    campos: [
      { campo: "numero_pedido", rotulo: "Nº do pedido", quando: "automático se vazio", ajuda: [p("O número da OC. Em branco, é gerado automaticamente e não muda depois de criado.")] },
      { campo: "fornecedor", rotulo: "Fornecedor", ajuda: [p("A empresa (ou representante) que vende as peças. É o mesmo para todos os produtos da OC.")] },
      { campo: "datas", rotulo: "Data do pedido · Data prevista de entrega", ajuda: [p("Quando o pedido foi feito e a previsão de chegada.")] },
      { campo: "prazo", rotulo: "Prazo de pagamento · Parcelas a pagar (derivado)", ajuda: [p("Os prazos a pagar em dias (ex.: “30/60/90”), que derivam o número de parcelas a pagar. As parcelas saem do total da OC.")] },
    ],
  },
  {
    id: "produtos",
    titulo: "2. Produtos da OC",
    intro: [p("A lista de produtos comprados, em acordeão. Use “Item avulso” (em OC nova) ou “Adicionar produto” (produtos do fornecedor ainda sem OC).")],
    campos: [
      { campo: "identidade", rotulo: "Nome · Grupo · Categoria · Subcategorias · REF Fornecedor · Composição", ajuda: [p("A identidade de cada produto. No grupo Acessórios, as subcategorias somem (grade única).")] },
      { campo: "grade_variantes", rotulo: "Proporção de grade · Variantes · Grade pedida", ajuda: [p("A proporção por tamanho (peso), as variantes por cor (cor base, apelido, peso, quantidade) e a grade pedida destrinchada por cor×tamanho. “Redistribuir por peso” reparte a quantidade total pelos pesos.")] },
      { campo: "valores", rotulo: "Qtd total · Valor unitário · Desconto (%)", ajuda: [p("Os valores do produto. O sistema deriva o bruto, o desconto, o total com desconto e o valor unitário real.")] },
    ],
  },
  {
    id: "recebimento",
    titulo: "Recebimento por produto",
    intro: [p("Cada produto é recebido por conta própria, não a OC inteira.")],
    campos: [
      { campo: "receb_campos", rotulo: "Data de entrega · NF · Responsável · Revisão · Devolução", ajuda: [p("Os dados da entrada daquele produto, mais a grade recebida e a grade com defeito destrinchadas (que derivam a grade real).")] },
      { campo: "marcar_recebido", rotulo: "Marcar este produto como recebido", ajuda: [p("Confirma a entrada daquele produto. Atenção: os campos de recebimento editados antes de marcar não são gravados — só entram ao marcar.")] },
    ],
  },
  {
    id: "valores-parcelas",
    titulo: "3. Valores & parcelas da OC",
    campos: [
      { campo: "data_nota", rotulo: "Data da Nota de Entrada", ajuda: [p("A data da nota fiscal do fornecedor. As parcelas a pagar saem do total da OC e têm o vencimento contado a partir dela. Continua editável mesmo com a OC recebida.")] },
      { campo: "total_oc", rotulo: "Total da OC", ajuda: [p("A soma dos produtos (bruto, desconto e total com desconto por produto). É o valor que gera as parcelas a pagar.")] },
    ],
  },
];

const OC_P_IMPORTADO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A OC de Produto Importado registra a compra de peças prontas de um fornecedor estrangeiro, em moeda estrangeira, com cotações de câmbio e um cronograma de pagamento por etapas. Como no Produto Acabado, uma OC pode ter vários produtos, recebidos um a um."),
      p("A tela tem as abas Recebidas, Encomendadas e Estoque. A lista mostra os valores na moeda de compra; o custo em reais (landed) é calculado pelo sistema."),
    ],
  },
  {
    id: "pedido",
    titulo: "1. Dados do pedido",
    campos: [
      { campo: "cabecalho", rotulo: "Nº do pedido · Fornecedor · Datas", ajuda: [p("O cabeçalho da OC: número (automático se vazio), fornecedor único e as datas do pedido e da previsão de entrega. Aqui não há prazo/parcelas — o pagamento é por etapas.")] },
    ],
  },
  {
    id: "moedas",
    titulo: "2. Moedas & câmbio",
    intro: [p("As moedas valem para a OC inteira — todos os produtos na mesma moeda de compra.")],
    campos: [
      { campo: "moeda_compra", rotulo: "Moeda de compra", ajuda: [p("A moeda em que você paga o fornecedor. É possível adicionar uma moeda nova pelo código.")] },
      { campo: "moeda_intermediaria", rotulo: "Moeda intermediária", ajuda: [p("Uma moeda intermediária no câmbio, quando houver; escolha “Direta (sem M2)” se não se aplica.")] },
      { campo: "cotacoes", rotulo: "Cotação de ref. · Cotação para R$", ajuda: [p("A cotação de referência (entre as moedas) e a cotação final para reais (rótulo dinâmico pela moeda, ex.: “Cotação US$→R$”).")] },
    ],
  },
  {
    id: "produtos",
    titulo: "3. Produtos da OC",
    intro: [p("A lista de produtos, em acordeão, com a mesma identidade e grade do Produto Acabado. A diferença está nos valores de importação.")],
    campos: [
      { campo: "valores_import", rotulo: "Valor unit. · Peso (kg) · Transporte · Desconto (%)", ajuda: [p("Os valores de importação, cada um com o seu rótulo de moeda. O sistema deriva o valor do produto, o valor do transporte (peso × transporte), o bruto, o total com desconto e o valor unitário real.")] },
      { campo: "landed", rotulo: "Custo landed unit. (R$)", ajuda: [p("O custo unitário em reais, já com câmbio e etapas. É só leitura — calculado pelo sistema ao salvar ou receber.")] },
      { campo: "recebimento", rotulo: "Recebimento por produto", ajuda: [p("Cada produto é recebido separadamente (data, NF, responsável, grade recebida e com defeito). Os campos só são gravados ao “Marcar este produto como recebido”.")] },
    ],
  },
  {
    id: "etapas",
    titulo: "4. Etapas de pagamento & valores",
    intro: [p("No importado, as parcelas a pagar saem das etapas do cronograma (uma por etapa), não de um prazo em dias.")],
    campos: [
      { campo: "etapa", rotulo: "Etapa (Rótulo · base · % · vencimento · cotação)", ajuda: [p("Cada etapa tem um rótulo, uma base (Mercadoria ou Frete), um percentual, uma data de vencimento e uma cotação própria. As somas de percentual de mercadoria e de frete precisam fechar 100%. Até 5 etapas.")] },
      { campo: "data_nota", rotulo: "Data da Nota de Entrada", ajuda: [p("Aqui a Nota é só registro — os vencimentos seguem as etapas de câmbio, não a data da Nota.")] },
      { campo: "totais", rotulo: "Total da OC · Landed médio (R$/pç)", ajuda: [p("Os totais da OC e o custo landed médio por peça, em reais, calculados pelo sistema.")] },
    ],
  },
];

const OC_AVIAMENTO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A OC de Aviamento registra os pedidos de compra de aviamentos (zíperes, botões, linhas…) aos fornecedores e dá entrada quando a mercadoria chega. É dela que o estoque de aviamento é alimentado."),
      p("A tela tem as abas Recebidos, Encomendados e Estoque. Para um pedido novo, use o botão de nova OC; para editar, clique na linha."),
    ],
  },
  {
    id: "pedido",
    titulo: "1. Pedido",
    campos: [
      { campo: "numero_pedido", rotulo: "Número do Pedido", quando: "automático se vazio", ajuda: [p("O número do pedido. Em branco, o sistema sugere o próximo.")] },
      { campo: "fornecedor", rotulo: "Fornecedor", ajuda: [p("A empresa (ou representante) que vende o aviamento.")] },
      { campo: "responsavel", rotulo: "Responsável", ajuda: [p("Quem fez a compra.")] },
      { campo: "prazo_pagamento", rotulo: "Prazo de Pagamento", quando: "obrigatório", ajuda: [p("Os prazos a pagar em dias, por exemplo “30/60/90”. É o prazo das contas a pagar, diferente das parcelas de recebimento.")] },
      { campo: "datas", rotulo: "Data do Pedido · Data Prevista de Entrega", quando: "entrega obrigatória", ajuda: [p("A data do pedido e a previsão de chegada.")] },
      { campo: "parcelas_receb", rotulo: "Qtd. Parcelas de Recebimento", ajuda: [p("Em quantas entregas o aviamento vai chegar. Gera as linhas de parcela de recebimento, com data.")] },
    ],
  },
  {
    id: "aviamentos",
    titulo: "2. Aviamentos",
    intro: [p("Os itens comprados, numa tabela (até 10; use “Adicionar”).")],
    campos: [
      { campo: "itens", rotulo: "Aviamento · Qtd Pedida · Preço (un.) · Valor Prev.", ajuda: [p("Cada linha é um aviamento com a quantidade pedida e o preço unitário. Quando o aviamento tem cores, a variante é escolhida por item. Depois de receber, aparecem “Qtd Recebida” e “Valor Real”; o rodapé soma Total Previsto e Total Real.")] },
    ],
  },
  {
    id: "anexos",
    titulo: "3. Anexos",
    intro: [p("As Notas Fiscais da compra (lista de uploads). Ficam travadas até a OC ser salva.")],
  },
  {
    id: "recebimento",
    titulo: "4. Recebimento",
    intro: [p("A entrada da mercadoria. Só aparece depois de salvar a OC.")],
    campos: [
      { campo: "data_nota", rotulo: "Data da Nota de Entrada", ajuda: [p("A data da nota fiscal do fornecedor, base do vencimento das parcelas a pagar (Data da Nota + os dias do prazo). Continua editável mesmo com a OC recebida.")] },
      { campo: "parcelas", rotulo: "Parcelas de Recebimento · Recebida", ajuda: [p("Uma linha por entrega, com data e a marca “Recebida”. A “Data da Entrega” (última parcela recebida) é derivada e só leitura.")] },
      { campo: "marcar_recebido", rotulo: "Marcar / Desmarcar Recebido", ajuda: [p("O botão do rodapé confirma a entrada (precisa de todas as parcelas com data e marcadas). Desmarcar volta a OC para “Encomendado” e remove as parcelas não pagas (pede confirmação).")] },
    ],
  },
  {
    id: "estoque",
    titulo: "Aba Estoque",
    intro: [p("A posição de estoque de aviamento, por aviamento×variante (cor + apelido). Mostra o físico, o reservado e o previsto — não lista OCs.")],
  },
];

const OC_INSUMO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A OC de Insumo registra os pedidos de compra de insumos (etiquetas, embalagens…) aos fornecedores e registra a chegada. É dela que o estoque de insumo é alimentado."),
      p("A tela tem as abas Recebidos, Encomendados e Estoque."),
    ],
  },
  {
    id: "pedido",
    titulo: "1. Pedido",
    campos: [
      { campo: "numero_pedido", rotulo: "Número do Pedido", quando: "automático se vazio", ajuda: [p("O número do pedido.")] },
      { campo: "fornecedor", rotulo: "Fornecedor", ajuda: [p("A empresa (ou representante) que vende o insumo.")] },
      { campo: "responsavel", rotulo: "Responsável", ajuda: [p("Quem fez a compra.")] },
      { campo: "prazo_pagamento", rotulo: "Prazo de Pagamento", quando: "opcional", ajuda: [p("Os prazos a pagar em dias, por exemplo “30/60/90”. É o prazo das contas a pagar, diferente das parcelas de recebimento.")] },
      { campo: "datas", rotulo: "Data do Pedido · Data Prevista de Entrega", ajuda: [p("A data do pedido e a previsão de chegada.")] },
      { campo: "parcelas_receb", rotulo: "Qtd. Parcelas de Recebimento", ajuda: [p("Em quantas entregas o insumo vai chegar (de 1 a 24). Gera as linhas de parcela de recebimento.")] },
    ],
  },
  {
    id: "insumos",
    titulo: "2. Insumos",
    intro: [p("Os itens comprados, em blocos por insumo (botão para adicionar, X para remover).")],
    campos: [
      { campo: "itens", rotulo: "Insumo · Cores · Qtd Pedida · Preço (un.)", ajuda: [p("Dentro de cada bloco você escolhe as cores e preenche a tabela por variante (Cor / Tamanho) com a quantidade pedida e o preço unitário. Depois de receber, aparece a “Qtd Recebida”; há um marcador de inclusão por linha.")] },
    ],
  },
  {
    id: "anexos",
    titulo: "3. Anexos",
    intro: [p("As Notas Fiscais da compra (lista de uploads). Travadas até a OC ser salva.")],
  },
  {
    id: "recebimento",
    titulo: "4. Recebimento",
    intro: [p("A entrada da mercadoria. Só aparece depois de salvar a OC.")],
    campos: [
      { campo: "data_nota", rotulo: "Data da Nota de Entrada", ajuda: [p("A data da nota fiscal do fornecedor, base do vencimento das parcelas a pagar. Numa OC já recebida, é o único campo editável do Recebimento.")] },
      { campo: "parcelas", rotulo: "Parcelas de Recebimento · Recebida", ajuda: [p("Uma linha por entrega, com data e a marca “Recebida”, e um aviso de prazo (previsto × entrega). A entrega é derivada da última parcela.")] },
      { campo: "marcar_recebido", rotulo: "Marcar / Desmarcar Recebido", ajuda: [p("Confirma a entrada (todas as parcelas com data e marcadas). Desmarcar volta a OC para “Encomendado” e remove as parcelas não pagas (pede confirmação).")] },
    ],
  },
  {
    id: "estoque",
    titulo: "Aba Estoque",
    intro: [p("A posição de estoque de insumo (não lista OCs).")],
  },
];

const OS_TECIDO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A OS (Ordem de Saída) de Tecido serve para reservar e dar baixa no estoque de tecido manualmente, nas lojas que trabalham no modo só-estoque. É a forma de registrar uma saída de tecido sem passar pelo corte de um produto."),
      p("A lista tem busca e colunas de Nº, Responsável, datas, Destino, Reserva, Baixa e Status (Baixado / Não Baixado). Para uma OS nova, use “Nova OS”."),
    ],
  },
  {
    id: "form",
    titulo: "Dados da OS",
    campos: [
      { campo: "numero", rotulo: "Número", quando: "sugere o próximo", ajuda: [p("O número da OS; o sistema sugere o próximo da loja.")] },
      { campo: "responsavel", rotulo: "Responsável", ajuda: [p("Quem solicitou a saída (escolhido entre os estilistas).")] },
      { campo: "datas", rotulo: "Data da Solicitação · Data do Corte", ajuda: [p("As datas da solicitação e do corte.")] },
      { campo: "destino", rotulo: "Destino", quando: "opcional", ajuda: [p("Para onde o tecido vai (ou “Sem destino”).")] },
      { campo: "itens", rotulo: "Itens — reserva (metros)", ajuda: [p("Uma ou mais linhas de tecido×variante, cada uma com a quantidade a reservar, em metros. O tecido é sempre contado em metros, mesmo quando o cadastro é por quilo.")] },
      { campo: "observacao", rotulo: "Observação", quando: "opcional", ajuda: [p("Um texto livre sobre a saída.")] },
    ],
  },
  {
    id: "baixa",
    titulo: "Dar baixa",
    intro: [p("A reserva segura o estoque; a baixa é que efetiva a saída.")],
    campos: [
      { campo: "dar_baixa", rotulo: "Dar baixa", ajuda: [p("Abre o diálogo de baixa: confirme o “Utilizado” de cada item (já vem com a reserva). Ao baixar, a reserva sai e o estoque físico diminui pelo utilizado. Um valor acima do disponível é bloqueado. A trava de saldo é conferida no servidor.")] },
      { campo: "desmarcar_baixa", rotulo: "Desmarcar baixa", ajuda: [p("Reverte a baixa e restaura o estoque (pede confirmação). Enquanto a OS está baixada, a edição fica bloqueada.")] },
    ],
  },
];

const OS_AVIAMENTO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Para que serve",
    intro: [
      p("A OS (Ordem de Saída) de Aviamento serve para reservar e dar baixa no estoque de aviamento manualmente, nas lojas no modo só-estoque. Tem a mesma estrutura da OS de Tecido."),
      p("A lista tem busca, as mesmas colunas e o Status Baixado / Não Baixado. Para uma OS nova, use “Nova OS”."),
    ],
  },
  {
    id: "form",
    titulo: "Dados da OS",
    campos: [
      { campo: "cabecalho", rotulo: "Número · Responsável · Datas · Destino · Observação", ajuda: [p("O mesmo cabeçalho da OS de Tecido: número (sugerido), responsável, as datas de solicitação e corte, o destino e uma observação.")] },
      { campo: "itens", rotulo: "Itens — reserva (unidades)", ajuda: [p("Linhas de aviamento com a quantidade a reservar, em unidades. Quando o aviamento tem cores, escolha também a Variante (cor); um aviamento sem variantes cadastradas avisa para cadastrá-las.")] },
    ],
  },
  {
    id: "baixa",
    titulo: "Dar baixa",
    intro: [p("A baixa é por variante — cada aviamento×cor tem o seu saldo.")],
    campos: [
      { campo: "dar_baixa", rotulo: "Dar baixa", ajuda: [p("Confirme o “Utilizado” de cada item, em unidades. O disponível e o limite são por aviamento×variante; um valor acima do disponível é bloqueado. A trava de saldo é conferida no servidor.")] },
      { campo: "desmarcar_baixa", rotulo: "Desmarcar baixa", ajuda: [p("Reverte a baixa e restaura o estoque (pede confirmação).")] },
    ],
  },
];

/** Telas do módulo Entrada e Saída documentadas à mão. */
export const ENTRADA_SAIDA_CONTEUDO: ConteudoTelas = {
  producao_explosao: EXPLOSAO,
  entrada_oc_tecido: OC_TECIDO,
  entrada_alertas_tecido: ALERTAS_TECIDO,
  entrada_oc_p_acabado: OC_P_ACABADO,
  entrada_oc_p_importado: OC_P_IMPORTADO,
  entrada_oc_aviamento: OC_AVIAMENTO,
  entrada_oc_insumo: OC_INSUMO,
  entrada_os_tecido: OS_TECIDO,
  entrada_os_aviamento: OS_AVIAMENTO,
};
