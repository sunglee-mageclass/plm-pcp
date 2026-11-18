// Conteúdo do Manual — módulo ENTRADA E SAÍDA.
// Formato GUIA DE USO (como fazer, passo a passo, com o fio do processo) — molde da tela Atributos (cadastro.ts).
// Fiel às telas reais (OC Tecido/Aviamento/Insumo/P.Acabado/P.Importado, Explosão, Alertas, OS) e ao CLAUDE.md.
import { p, type ConteudoTelas, type SecaoConteudoManual } from "./tipos";

const EXPLOSAO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Onde a Explosão entra no processo",
    intro: [
      p("A Explosão é a ponte entre o planejamento e a produção. Quando um produto termina o Desenvolvimento e é Enviado à Explosão, ele chega aqui para ser “explodido”: o sistema mostra tudo o que aquele produto vai consumir — tecido, aviamentos e insumos — e você envia para o corte (PCP), baixando o estoque do que saiu."),
      p("É o ponto em que o material deixa de ser plano e vira produção: enviar para o PCP é o que efetiva o corte e manda o produto para os Serviços e o Controle de Qualidade. Sem passar por aqui, um produto de revenda nem chega ao CQ."),
      p("A lista mostra os produtos prontos para cortar: os que já saíram do Desenvolvimento e ainda não foram cortados, mais os de revenda que já tiveram a OC recebida. Clicar no produto abre o Sheet onde você faz o trabalho."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("O trabalho é sempre o mesmo: abrir o produto, conferir o que ele consome, ajustar o que de fato vai sair e enviar para o PCP. O que já foi cortado continua na lista e pode ser reaberto."),
    ],
    campos: [
      { campo: "enviar-corte", rotulo: "Como enviar um produto para o corte", ajuda: [
        { tipo: "passos", itens: [
          "Na lista, procure um produto “Aguardando” (ainda não cortado) e clique nele para abrir o Sheet.",
          "Confira os três blocos de consumo: Metragem de tecido, Aviamentos a separar e Insumos a enviar. A necessidade de cada um já vem calculada (consumo por peça × grade).",
          "Ajuste, se precisar, o quanto vai de fato sair — só a coluna “a enviar / a separar” é editável. O total de tecido aparece no botão “Enviar para PCP · X m”.",
          "Clique em “Enviar para PCP”. Numa única operação o sistema salva o que você preencheu e baixa o estoque. A partir daí o produto segue para os Serviços e o CQ.",
        ] },
      ] },
      { campo: "revenda", rotulo: "Enviar um produto de revenda", ajuda: [
        p("Produtos de revenda (peças prontas compradas) precisam passar pela Explosão para chegar ao CQ, mesmo quando não há nada a separar. Abra o produto e clique em “Enviar para PCP” — o botão libera mesmo sem metragem/aviamentos/insumos."),
        p("Para os produtos de fabricação própria, quando metragem, aviamentos e insumos estão todos zerados, aparece “Nada a separar” e o envio fica bloqueado (não há o que cortar)."),
      ] },
      { campo: "reprocessar", rotulo: "Completar um corte que faltou estoque", quando: "só admin da loja", ajuda: [
        p("Quando um corte é enviado mas faltou tecido para alguma variante, o produto fica marcado “Faltou estoque” e o déficit é registrado. Assim que o tecido chega, o sistema completa a baixa sozinho."),
        p("Para forçar isso, o admin da loja usa o botão “Reprocessar faltas”: ele completa o déficit dos cortes mais antigos com o tecido que entrou desde então. O estoque nunca fica negativo."),
      ] },
    ],
  },
  {
    id: "situacao",
    titulo: "Como ler a situação de cada produto",
    intro: [p("O estado na fila do corte, mostrado em cada linha e no topo do Sheet pela mesma regra (lista e detalhe nunca divergem).")],
    campos: [
      { campo: "aguardando", rotulo: "Aguardando", ajuda: [p("O produto ainda não foi enviado para o PCP (corte). É o que você precisa conferir e enviar.")] },
      { campo: "enviado", rotulo: "Enviado", ajuda: [p("O produto já foi cortado (enviado para o PCP) e o estoque já foi baixado. Continua na lista e pode ser reaberto para edição.")] },
      { campo: "faltou_estoque", rotulo: "Faltou estoque", ajuda: [p("O produto foi enviado, mas no último envio faltou tecido para alguma variante. O déficit fica registrado e é completado quando o tecido chegar.")] },
    ],
  },
  {
    id: "separar-enviar",
    titulo: "Os três blocos de consumo (referência)",
    intro: [p("Dentro do Sheet, três blocos mostram tudo o que o produto consome. A necessidade é sempre calculada pelo sistema; você só ajusta o quanto vai de fato sair.")],
    campos: [
      { campo: "metragem", rotulo: "Metragem", ajuda: [p("A metragem de tecido a enviar para o corte, por tecido. A necessidade é calculada; você ajusta a metragem que de fato vai sair. É dela que sai o total “Enviar para PCP · X m” do botão.")] },
      { campo: "aviamentos_separar", rotulo: "Aviamentos a separar", ajuda: [p("A quantidade de cada aviamento a separar, por cor. A necessidade é consumo por peça × grade; só o “a separar” é editável.")] },
      { campo: "insumos_enviar", rotulo: "Insumos a enviar", ajuda: [p("A quantidade de cada insumo (etiquetas, embalagens) a enviar. A necessidade é consumo por peça × grade (ou pelas peças do tamanho, quando o insumo é vinculado a um tamanho); só o “a enviar” é editável. Insumo vinculado a um tamanho mostra um aviso quando o tamanho está fora da grade.")] },
    ],
  },
];

const OC_TECIDO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Como você compra o tecido planejado",
    intro: [
      p("A OC de Tecido é onde você COMPRA o tecido: registra o pedido para o fornecedor e, quando a mercadoria chega, dá entrada. É por aqui que o estoque de tecido é alimentado e que nascem as contas a pagar da compra."),
      p("O fio é sempre o mesmo: você abre um pedido (encomendada), recebe quando o tecido chega (recebida) e, dali em diante, o estoque aparece na aba Estoque e alimenta o Planejamento, a Explosão e o corte. Quem controla tecido rolo a rolo gerencia os rolos numa aba à parte."),
      p("A tela tem quatro abas: Recebidas, Encomendadas, Estoque e Rolos. Esta é a OC mais completa do módulo — por isso tem seção de recebimento, Data da Nota (que define o vencimento das parcelas) e rolos."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Edita-se um pedido existente clicando na linha (abre num painel lateral); cria-se um novo em “Nova OC de Tecido”. As quatro tarefas abaixo cobrem o ciclo da compra."),
    ],
    campos: [
      { campo: "fazer-pedido", rotulo: "Como fazer um pedido de tecido", ajuda: [
        { tipo: "passos", itens: [
          "Clique em “Nova OC de Tecido”.",
          "Preencha o cabeçalho (seção 1): o Fornecedor, o Responsável, a Data do Pedido e a Data Prevista de Entrega. Deixe o Número do Pedido em branco para o sistema sugerir o próximo.",
          "Informe o Prazo de Pagamento em dias corridos separados por barra (ex.: “30/60/90” = 3 parcelas a pagar) e, se o tecido vier em etapas, quantas entregas parceladas.",
          "Nos Itens (seção 2), escolha o tecido e marque as variantes (cores). Para cada variante, informe a quantidade pedida e o preço; quando o tecido é comprado por quilo, informe o rendimento (m/kg).",
          "Se tiver, anexe o PDF do pedido (seção 3). Salve: a OC nasce como “Encomendada”.",
        ] },
      ] },
      { campo: "receber", rotulo: "Como receber uma OC (dar entrada no estoque)", ajuda: [
        p("A seção “4. Recebimento” só aparece depois que a OC foi salva. É nela que a OC passa de Encomendada para Recebida e o estoque entra."),
        { tipo: "passos", itens: [
          "Abra a OC e vá até a seção “4. Recebimento”.",
          "Preencha a Quantidade recebida por variante (o quanto chegou de cada cor) e, se for o caso, as observações de defeito/tonalidade.",
          "Em cada parcela de entrega, informe a data e marque “Recebida” — todas as parcelas precisam de data e de estar marcadas.",
          "Lance a Data da Nota de Entrada (veja a tarefa abaixo).",
          "Clique em “Marcar Recebido” no rodapé: o estoque entra e as parcelas a pagar são recalculadas. (“Desmarcar recebimento” devolve a OC a Encomendada — o Salvar comum nunca faz isso.)",
        ] },
      ] },
      { campo: "nota-parcelas", rotulo: "Como lançar a Data da Nota e as parcelas a pagar", ajuda: [
        p("A Data da Nota de Entrada é a data da nota fiscal do fornecedor. Ela é o ponto de partida do vencimento das contas a pagar: cada parcela vence na Data da Nota mais os dias do prazo (ex.: Nota em 10/01 + prazo 30 = vence 09/02)."),
        { tipo: "passos", itens: [
          "No topo da seção Recebimento, informe a Data da Nota de Entrada.",
          "As parcelas a pagar saem do Prazo de Pagamento que você digitou no pedido — o número de parcelas é derivado dele.",
          "Confira os vencimentos: cada um é a Data da Nota mais os dias corridos daquele prazo. Sem a Nota, o vencimento cai numa data provisória (data de entrega ou do pedido).",
        ] },
        p("Atenção: estas são as contas a pagar (financeiro), que não são a mesma coisa das entregas parceladas (recebimento). A Data da Nota continua editável mesmo com a OC já recebida."),
      ] },
      { campo: "criar-rolo", rotulo: "Como criar um rolo", quando: "controle por rolo", ajuda: [
        p("Quem controla o tecido por rolo individual gerencia os rolos na aba Rolos. Um rolo é uma unidade física de estoque de uma única variante."),
        { tipo: "passos", itens: [
          "Abra a aba Rolos e use “Criar rolo”.",
          "Escolha a OC/rolo de origem e a variante do rolo.",
          "O Código vem sugerido (formato com sequência, categoria e data); edite se quiser e informe Rua e Prateleira do endereçamento, se usar.",
          "Confirme. Separar um rolo depois é uma transferência (baixa reversível), não um consumo — um rolo já consumido ou vinculado ao Desenvolvimento fica bloqueado para edição.",
        ] },
      ] },
    ],
  },
  {
    id: "pedido",
    titulo: "1. Pedido (referência dos campos)",
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
    titulo: "2. Itens do pedido (referência)",
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
    titulo: "3. Anexos e Notas Fiscais (referência)",
    intro: [p("Os arquivos do pedido. As Notas Fiscais ficam aqui, fora da seção de Recebimento.")],
    campos: [
      { campo: "anexo_pedido", rotulo: "Anexo do Pedido · Modelo Sugerido", ajuda: [p("Arquivos de apoio do pedido (o PDF do pedido e um modelo sugerido).")] },
      { campo: "notas_fiscais", rotulo: "Notas Fiscais", ajuda: [p("As NFs da compra, anexadas como lista. Ficam travadas enquanto a OC não é salva.")] },
    ],
  },
  {
    id: "recebimento",
    titulo: "4. Recebimento (referência)",
    intro: [p("A entrada da mercadoria. Só aparece depois que a OC é salva.")],
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
    titulo: "Aba Estoque (referência)",
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
    titulo: "Aba Rolos (referência)",
    intro: [p("Um rolo é uma unidade física de estoque de uma única variante, controlada individualmente.")],
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
    titulo: "Onde o alerta nasce e para que serve",
    intro: [
      p("Os Alertas de Tecido são a fila de decisão do Estilo sobre tecidos que o Controle de Qualidade marcou. Quando, no CQ da OC, alguém liga o “Alertar estilo” em um item ou rolo, nasce um alerta aqui — pedindo que o Estilo decida o que fazer com aquele tecido."),
      p("A decisão tem três saídas: resolver com Estilo OK (fica como está), trocar por outro tecido, ou cancelar (tira do estoque). A tela tem as abas Pendentes e Resolvidos; cada cartão mostra o tecido, a variante, a origem (OC ou Rolo) e o status."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Trabalhe pela aba Pendentes: em cada cartão, tome uma das decisões abaixo. Para quem só vê a tela (sem permissão de editar), os botões somem e a observação fica apenas como texto."),
    ],
    campos: [
      { campo: "resolver-ok", rotulo: "Como resolver um alerta sem troca", ajuda: [
        { tipo: "passos", itens: [
          "Na aba Pendentes, encontre o cartão do tecido.",
          "Se o tecido está bom como está, clique em “Estilo OK”.",
          "O alerta sai da fila. Em alertas de OC, o valor e as parcelas são recalculados.",
        ] },
      ] },
      { campo: "trocar", rotulo: "Como trocar o tecido por outro", ajuda: [
        { tipo: "passos", itens: [
          "No cartão, clique em “Trocar variante” (ou “Trocar rolo”).",
          "No diálogo, escolha o tecido substituto, a variante e a metragem esperada. O tecido original sai do estoque e do consumo; o substituto entra como “a receber”.",
          "Quando o substituto chegar, use “Receber reposição” (com data e metragem) para concluir a troca — ou “Desfazer troca” para voltar atrás.",
        ] },
      ] },
      { campo: "cancelar", rotulo: "Como cancelar uma variante ou rolo", ajuda: [
        { tipo: "passos", itens: [
          "No cartão, clique em “Cancelar variante” (ou “Cancelar rolo”) e confirme.",
          "A variante (ou o rolo) sai do estoque, do consumo e da previsão. Um rolo em uso fica bloqueado para cancelamento.",
        ] },
      ] },
      { campo: "reabrir", rotulo: "Como reabrir um alerta resolvido", ajuda: [
        p("Na aba Resolvidos, o botão “Reabrir” devolve o alerta à fila de pendentes (pede confirmação). Uma troca já concluída não reabre."),
      ] },
    ],
  },
  {
    id: "acoes",
    titulo: "As decisões por alerta (referência)",
    campos: [
      { campo: "estilo_ok", rotulo: "Estilo OK", ajuda: [p("Resolve o alerta sem troca — o tecido fica como está. Em OC, recalcula valor e parcelas.")] },
      { campo: "trocar", rotulo: "Trocar variante / Trocar rolo", ajuda: [p("Substitui o tecido: escolha o substituto, a variante e a metragem esperada. O original sai; o substituto entra como “a receber”. Depois use “Receber reposição” ou “Desfazer troca”.")] },
      { campo: "cancelar", rotulo: "Cancelar variante / Cancelar rolo", ajuda: [p("Tira a variante (ou o rolo) do estoque, do consumo e da previsão. Pede confirmação. Um rolo em uso fica bloqueado.")] },
      { campo: "reabrir", rotulo: "Reabrir", ajuda: [p("Na aba Resolvidos, devolve o alerta à fila de pendentes (pede confirmação). Uma troca já concluída não reabre.")] },
      { campo: "observacao", rotulo: "Observação", ajuda: [p("Um texto livre compartilhado com o CQ da OC. Para quem só vê a tela, os botões de ação somem e a observação vira apenas texto.")] },
    ],
  },
];

const OC_P_ACABADO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Como você compra peças prontas para revender",
    intro: [
      p("A OC de Produto Acabado é como você COMPRA peças prontas de um fornecedor para revender — você não fabrica. Diferente da OC de Tecido, uma mesma OC pode ter vários produtos, e cada produto é recebido e conferido separadamente."),
      p("O fio: você abre a OC com um fornecedor e os produtos, recebe produto a produto conforme chegam, e cada produto recebido vira estoque de revenda pronto para seguir. A tela tem as abas Recebidas, Encomendadas e Estoque — uma OC parcialmente recebida fica em Encomendadas até o último produto chegar."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Edita-se uma OC clicando na linha; cria-se uma nova pelo botão de nova OC. As tarefas abaixo cobrem o ciclo da compra de revenda."),
    ],
    campos: [
      { campo: "fazer-pedido", rotulo: "Como fazer um pedido com vários produtos", ajuda: [
        { tipo: "passos", itens: [
          "Abra uma OC nova. Preencha o cabeçalho (seção 1): o Fornecedor (único para a OC inteira), as datas e o Prazo de Pagamento.",
          "Na seção “Produtos da OC”, acrescente os produtos: “Item avulso” para um produto novo da hora, ou “Adicionar produto” para escolher produtos do fornecedor que ainda não têm OC.",
          "Para cada produto, informe a identidade (nome, grupo, categoria, REF do fornecedor, composição), a proporção de grade, as variantes por cor e a grade pedida por cor×tamanho.",
          "Informe os valores do produto (quantidade total, valor unitário, desconto). O sistema deriva o bruto, o total com desconto e o valor unitário real.",
          "Salve. A OC nasce Encomendada; os produtos ficam aguardando recebimento.",
        ] },
      ] },
      { campo: "receber-produto", rotulo: "Como receber um produto da OC", ajuda: [
        p("No Produto Acabado, cada produto é recebido por conta própria — não a OC inteira de uma vez."),
        { tipo: "passos", itens: [
          "Abra a OC e expanda o produto que chegou.",
          "Preencha os dados de entrada daquele produto: data de entrega, NF, responsável, a grade recebida e a grade com defeito (que derivam a grade real), e revisão/devolução se houver.",
          "Clique em “Marcar este produto como recebido”. Atenção: os campos de recebimento só são gravados ao marcar — editá-los sem marcar não persiste.",
          "Repita para os demais produtos. A OC só sai de Encomendadas quando o último produto é recebido.",
        ] },
      ] },
      { campo: "nota-parcelas", rotulo: "Como lançar a Data da Nota e as parcelas", ajuda: [
        p("As parcelas a pagar saem do total da OC (soma dos produtos) e o vencimento é contado a partir da Data da Nota de Entrada."),
        { tipo: "passos", itens: [
          "Na seção “Valores & parcelas da OC”, informe a Data da Nota de Entrada (continua editável mesmo com a OC recebida).",
          "O Prazo de Pagamento do cabeçalho deriva o número de parcelas; os vencimentos contam a partir da Data da Nota.",
          "Confira o Total da OC — é a soma dos produtos (bruto, desconto e total com desconto) e é o valor que gera as parcelas.",
        ] },
      ] },
    ],
  },
  {
    id: "pedido",
    titulo: "1. Dados do pedido (referência)",
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
    titulo: "2. Produtos da OC (referência)",
    intro: [p("A lista de produtos comprados, em acordeão. Use “Item avulso” (em OC nova) ou “Adicionar produto” (produtos do fornecedor ainda sem OC).")],
    campos: [
      { campo: "identidade", rotulo: "Nome · Grupo · Categoria · Subcategorias · REF Fornecedor · Composição", ajuda: [p("A identidade de cada produto. No grupo Acessórios, as subcategorias somem (grade única).")] },
      { campo: "grade_variantes", rotulo: "Proporção de grade · Variantes · Grade pedida", ajuda: [p("A proporção por tamanho (peso), as variantes por cor (cor base, apelido, peso, quantidade) e a grade pedida destrinchada por cor×tamanho. “Redistribuir por peso” reparte a quantidade total pelos pesos.")] },
      { campo: "valores", rotulo: "Qtd total · Valor unitário · Desconto (%)", ajuda: [p("Os valores do produto. O sistema deriva o bruto, o desconto, o total com desconto e o valor unitário real.")] },
    ],
  },
  {
    id: "recebimento",
    titulo: "Recebimento por produto (referência)",
    intro: [p("Cada produto é recebido por conta própria, não a OC inteira.")],
    campos: [
      { campo: "receb_campos", rotulo: "Data de entrega · NF · Responsável · Revisão · Devolução", ajuda: [p("Os dados da entrada daquele produto, mais a grade recebida e a grade com defeito destrinchadas (que derivam a grade real).")] },
      { campo: "marcar_recebido", rotulo: "Marcar este produto como recebido", ajuda: [p("Confirma a entrada daquele produto. Atenção: os campos de recebimento editados antes de marcar não são gravados — só entram ao marcar.")] },
    ],
  },
  {
    id: "valores-parcelas",
    titulo: "3. Valores & parcelas da OC (referência)",
    campos: [
      { campo: "data_nota", rotulo: "Data da Nota de Entrada", ajuda: [p("A data da nota fiscal do fornecedor. As parcelas a pagar saem do total da OC e têm o vencimento contado a partir dela. Continua editável mesmo com a OC recebida.")] },
      { campo: "total_oc", rotulo: "Total da OC", ajuda: [p("A soma dos produtos (bruto, desconto e total com desconto por produto). É o valor que gera as parcelas a pagar.")] },
    ],
  },
];

const OC_P_IMPORTADO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Como você compra peças prontas do exterior",
    intro: [
      p("A OC de Produto Importado é como você COMPRA peças prontas de um fornecedor estrangeiro: em moeda estrangeira, com cotações de câmbio e um cronograma de pagamento por etapas (não um prazo em dias). Como no Produto Acabado, uma OC pode ter vários produtos, recebidos um a um."),
      p("O fio é o mesmo da revenda, com a camada do câmbio: você define as moedas e cotações, lança os valores de importação (que o sistema converte para o custo em reais, o “landed”) e paga por etapas do cronograma. A tela tem as abas Recebidas, Encomendadas e Estoque; a lista mostra os valores na moeda de compra."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("O trabalho segue o do Produto Acabado, somando as moedas/câmbio e as etapas de pagamento. As tarefas abaixo cobrem o que é próprio do importado."),
    ],
    campos: [
      { campo: "fazer-pedido", rotulo: "Como fazer um pedido importado", ajuda: [
        { tipo: "passos", itens: [
          "Abra uma OC nova e preencha o cabeçalho (seção 1): número (automático se vazio), o fornecedor único e as datas. Aqui não há prazo/parcelas — o pagamento é por etapas.",
          "Em “Moedas & câmbio” (seção 2), escolha a Moeda de compra; se houver, a Moeda intermediária (ou “Direta (sem M2)”); e informe a cotação de referência e a cotação para R$.",
          "Nos Produtos (seção 3), acrescente os produtos com a mesma identidade e grade do Produto Acabado e informe os valores de importação: valor unitário, peso (kg), transporte e desconto — cada um com o seu rótulo de moeda.",
          "Monte as etapas de pagamento (seção 4) e salve. O custo landed por peça (em reais) é calculado pelo sistema.",
        ] },
      ] },
      { campo: "etapas", rotulo: "Como montar as etapas de pagamento", ajuda: [
        p("No importado, as parcelas a pagar saem das etapas do cronograma — uma parcela por etapa."),
        { tipo: "passos", itens: [
          "Na seção “Etapas de pagamento”, acrescente cada etapa (até 5).",
          "Em cada uma, informe o rótulo, a base (Mercadoria ou Frete), o percentual, a data de vencimento e a cotação própria da etapa.",
          "Feche os percentuais: a soma dos percentuais de mercadoria e a de frete precisam fechar 100% cada.",
        ] },
      ] },
      { campo: "receber-produto", rotulo: "Como receber um produto", ajuda: [
        p("Cada produto é recebido separadamente, como no Produto Acabado."),
        { tipo: "passos", itens: [
          "Abra a OC e expanda o produto que chegou.",
          "Preencha os dados da entrada (data, NF, responsável, grade recebida e grade com defeito).",
          "Clique em “Marcar este produto como recebido” — os campos de recebimento só são gravados ao marcar.",
        ] },
      ] },
    ],
  },
  {
    id: "pedido",
    titulo: "1. Dados do pedido (referência)",
    campos: [
      { campo: "cabecalho", rotulo: "Nº do pedido · Fornecedor · Datas", ajuda: [p("O cabeçalho da OC: número (automático se vazio), fornecedor único e as datas do pedido e da previsão de entrega. Aqui não há prazo/parcelas — o pagamento é por etapas.")] },
    ],
  },
  {
    id: "moedas",
    titulo: "2. Moedas & câmbio (referência)",
    intro: [p("As moedas valem para a OC inteira — todos os produtos na mesma moeda de compra.")],
    campos: [
      { campo: "moeda_compra", rotulo: "Moeda de compra", ajuda: [p("A moeda em que você paga o fornecedor. É possível adicionar uma moeda nova pelo código.")] },
      { campo: "moeda_intermediaria", rotulo: "Moeda intermediária", ajuda: [p("Uma moeda intermediária no câmbio, quando houver; escolha “Direta (sem M2)” se não se aplica.")] },
      { campo: "cotacoes", rotulo: "Cotação de ref. · Cotação para R$", ajuda: [p("A cotação de referência (entre as moedas) e a cotação final para reais (rótulo dinâmico pela moeda, ex.: “Cotação US$→R$”).")] },
    ],
  },
  {
    id: "produtos",
    titulo: "3. Produtos da OC (referência)",
    intro: [p("A lista de produtos, em acordeão, com a mesma identidade e grade do Produto Acabado. A diferença está nos valores de importação.")],
    campos: [
      { campo: "valores_import", rotulo: "Valor unit. · Peso (kg) · Transporte · Desconto (%)", ajuda: [p("Os valores de importação, cada um com o seu rótulo de moeda. O sistema deriva o valor do produto, o valor do transporte (peso × transporte), o bruto, o total com desconto e o valor unitário real.")] },
      { campo: "landed", rotulo: "Custo landed unit. (R$)", ajuda: [p("O custo unitário em reais, já com câmbio e etapas. É só leitura — calculado pelo sistema ao salvar ou receber.")] },
      { campo: "recebimento", rotulo: "Recebimento por produto", ajuda: [p("Cada produto é recebido separadamente (data, NF, responsável, grade recebida e com defeito). Os campos só são gravados ao “Marcar este produto como recebido”.")] },
    ],
  },
  {
    id: "etapas",
    titulo: "4. Etapas de pagamento & valores (referência)",
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
    titulo: "Como você compra os aviamentos",
    intro: [
      p("A OC de Aviamento é como você COMPRA aviamentos (zíperes, botões, linhas…): registra o pedido para o fornecedor e dá entrada quando a mercadoria chega. É dela que o estoque de aviamento é alimentado."),
      p("O fio é o mesmo das outras OCs: pedido (encomendado) → recebimento (recebido) → estoque. A tela tem as abas Recebidos, Encomendados e Estoque."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Edita-se uma OC clicando na linha; cria-se uma nova pelo botão de nova OC. As tarefas abaixo cobrem o ciclo da compra."),
    ],
    campos: [
      { campo: "fazer-pedido", rotulo: "Como fazer um pedido de aviamento", ajuda: [
        { tipo: "passos", itens: [
          "Abra uma OC nova e preencha o cabeçalho (seção 1): o Fornecedor, o Responsável, as datas e o Prazo de Pagamento em dias (ex.: “30/60/90”). Deixe o Número do Pedido em branco para o sistema sugerir.",
          "Informe a quantidade de parcelas de recebimento (em quantas entregas o aviamento vem).",
          "Na tabela de Aviamentos (seção 2, até 10 linhas; use “Adicionar”), escolha cada aviamento, a quantidade pedida e o preço unitário. Quando o aviamento tem cores, escolha a variante por item.",
          "Anexe as Notas Fiscais se já tiver (seção 3) e salve.",
        ] },
      ] },
      { campo: "receber", rotulo: "Como receber a OC", ajuda: [
        p("A seção “4. Recebimento” só aparece depois de salvar a OC."),
        { tipo: "passos", itens: [
          "Abra a OC e vá à seção Recebimento.",
          "Lance a Data da Nota de Entrada (base do vencimento das parcelas a pagar) e preencha as quantidades recebidas na tabela de aviamentos.",
          "Em cada parcela de recebimento, informe a data e marque “Recebida”.",
          "Clique em “Marcar Recebido”. Desmarcar volta a OC para Encomendado e remove as parcelas não pagas (pede confirmação).",
        ] },
      ] },
    ],
  },
  {
    id: "pedido",
    titulo: "1. Pedido (referência)",
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
    titulo: "2. Aviamentos (referência)",
    intro: [p("Os itens comprados, numa tabela (até 10; use “Adicionar”).")],
    campos: [
      { campo: "itens", rotulo: "Aviamento · Qtd Pedida · Preço (un.) · Valor Prev.", ajuda: [p("Cada linha é um aviamento com a quantidade pedida e o preço unitário. Quando o aviamento tem cores, a variante é escolhida por item. Depois de receber, aparecem “Qtd Recebida” e “Valor Real”; o rodapé soma Total Previsto e Total Real.")] },
    ],
  },
  {
    id: "anexos",
    titulo: "3. Anexos (referência)",
    intro: [p("As Notas Fiscais da compra (lista de uploads). Ficam travadas até a OC ser salva.")],
  },
  {
    id: "recebimento",
    titulo: "4. Recebimento (referência)",
    intro: [p("A entrada da mercadoria. Só aparece depois de salvar a OC.")],
    campos: [
      { campo: "data_nota", rotulo: "Data da Nota de Entrada", ajuda: [p("A data da nota fiscal do fornecedor, base do vencimento das parcelas a pagar (Data da Nota + os dias do prazo). Continua editável mesmo com a OC recebida.")] },
      { campo: "parcelas", rotulo: "Parcelas de Recebimento · Recebida", ajuda: [p("Uma linha por entrega, com data e a marca “Recebida”. A “Data da Entrega” (última parcela recebida) é derivada e só leitura.")] },
      { campo: "marcar_recebido", rotulo: "Marcar / Desmarcar Recebido", ajuda: [p("O botão do rodapé confirma a entrada (precisa de todas as parcelas com data e marcadas). Desmarcar volta a OC para “Encomendado” e remove as parcelas não pagas (pede confirmação).")] },
    ],
  },
  {
    id: "estoque",
    titulo: "Aba Estoque (referência)",
    intro: [p("A posição de estoque de aviamento, por aviamento×variante (cor + apelido). Mostra o físico, o reservado e o previsto — não lista OCs.")],
  },
];

const OC_INSUMO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Como você compra os insumos",
    intro: [
      p("A OC de Insumo é como você COMPRA insumos (etiquetas, embalagens…): registra o pedido para o fornecedor e registra a chegada. É dela que o estoque de insumo é alimentado."),
      p("O fio é o mesmo das outras OCs: pedido (encomendado) → recebimento (recebido) → estoque. A tela tem as abas Recebidos, Encomendados e Estoque."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Edita-se uma OC clicando na linha; cria-se uma nova pelo botão de nova OC. As tarefas abaixo cobrem o ciclo da compra."),
    ],
    campos: [
      { campo: "fazer-pedido", rotulo: "Como fazer um pedido de insumo", ajuda: [
        { tipo: "passos", itens: [
          "Abra uma OC nova e preencha o cabeçalho (seção 1): o Fornecedor, o Responsável, as datas e o Prazo de Pagamento em dias (opcional).",
          "Informe a quantidade de parcelas de recebimento (de 1 a 24).",
          "Na seção Insumos (seção 2, em blocos — um botão para adicionar, X para remover), escolha cada insumo, marque as cores e preencha a tabela por variante (Cor / Tamanho) com a quantidade pedida e o preço unitário.",
          "Anexe as Notas Fiscais se já tiver (seção 3) e salve.",
        ] },
      ] },
      { campo: "receber", rotulo: "Como receber a OC", ajuda: [
        p("A seção “4. Recebimento” só aparece depois de salvar a OC."),
        { tipo: "passos", itens: [
          "Abra a OC e vá à seção Recebimento.",
          "Lance a Data da Nota de Entrada (base do vencimento das parcelas a pagar) e preencha as quantidades recebidas por variante.",
          "Em cada parcela de recebimento, informe a data e marque “Recebida”.",
          "Clique em “Marcar Recebido”. Desmarcar volta a OC para Encomendado e remove as parcelas não pagas (pede confirmação).",
        ] },
      ] },
    ],
  },
  {
    id: "pedido",
    titulo: "1. Pedido (referência)",
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
    titulo: "2. Insumos (referência)",
    intro: [p("Os itens comprados, em blocos por insumo (botão para adicionar, X para remover).")],
    campos: [
      { campo: "itens", rotulo: "Insumo · Cores · Qtd Pedida · Preço (un.)", ajuda: [p("Dentro de cada bloco você escolhe as cores e preenche a tabela por variante (Cor / Tamanho) com a quantidade pedida e o preço unitário. Depois de receber, aparece a “Qtd Recebida”; há um marcador de inclusão por linha.")] },
    ],
  },
  {
    id: "anexos",
    titulo: "3. Anexos (referência)",
    intro: [p("As Notas Fiscais da compra (lista de uploads). Travadas até a OC ser salva.")],
  },
  {
    id: "recebimento",
    titulo: "4. Recebimento (referência)",
    intro: [p("A entrada da mercadoria. Só aparece depois de salvar a OC.")],
    campos: [
      { campo: "data_nota", rotulo: "Data da Nota de Entrada", ajuda: [p("A data da nota fiscal do fornecedor, base do vencimento das parcelas a pagar. Numa OC já recebida, é o único campo editável do Recebimento.")] },
      { campo: "parcelas", rotulo: "Parcelas de Recebimento · Recebida", ajuda: [p("Uma linha por entrega, com data e a marca “Recebida”, e um aviso de prazo (previsto × entrega). A entrega é derivada da última parcela.")] },
      { campo: "marcar_recebido", rotulo: "Marcar / Desmarcar Recebido", ajuda: [p("Confirma a entrada (todas as parcelas com data e marcadas). Desmarcar volta a OC para “Encomendado” e remove as parcelas não pagas (pede confirmação).")] },
    ],
  },
  {
    id: "estoque",
    titulo: "Aba Estoque (referência)",
    intro: [p("A posição de estoque de insumo (não lista OCs).")],
  },
];

const OS_TECIDO: SecaoConteudoManual[] = [
  {
    id: "para-que-serve",
    titulo: "Como você dá saída de tecido sem um produto",
    intro: [
      p("A OS (Ordem de Saída) de Tecido é como você RESERVA e dá baixa no estoque de tecido à mão, nas lojas que trabalham no modo só-estoque. É a forma de registrar uma saída de tecido sem passar pelo corte de um produto."),
      p("O fio tem dois tempos: a reserva segura o estoque (o tecido fica apartado), e a baixa é que efetiva a saída (o físico diminui). A lista tem busca e colunas de Nº, Responsável, datas, Destino, Reserva, Baixa e Status (Baixado / Não Baixado)."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Cria-se uma OS em “Nova OS”; edita-se clicando na linha. Enquanto a OS está baixada, a edição fica bloqueada."),
    ],
    campos: [
      { campo: "criar", rotulo: "Como abrir uma OS (reservar)", ajuda: [
        { tipo: "passos", itens: [
          "Clique em “Nova OS”.",
          "Preencha o Responsável (um estilista), a Data da Solicitação e a Data do Corte, e o Destino se usar.",
          "Acrescente os itens: uma ou mais linhas de tecido×variante, cada uma com a quantidade a reservar, em metros (o tecido é sempre contado em metros).",
          "Salve. A reserva segura o estoque até você dar baixa.",
        ] },
      ] },
      { campo: "baixar", rotulo: "Como dar baixa (efetivar a saída)", ajuda: [
        { tipo: "passos", itens: [
          "Abra a OS e clique em “Dar baixa”.",
          "No diálogo, confirme o “Utilizado” de cada item — ele já vem preenchido com a reserva.",
          "Confirme. A reserva sai e o estoque físico diminui pelo utilizado. Um valor acima do disponível é bloqueado (a trava é conferida no servidor).",
          "Se precisar voltar atrás, use “Desmarcar baixa” (pede confirmação): a baixa é revertida e o estoque restaurado.",
        ] },
      ] },
    ],
  },
  {
    id: "form",
    titulo: "Dados da OS (referência)",
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
    titulo: "Dar baixa (referência)",
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
    titulo: "Como você dá saída de aviamento sem um produto",
    intro: [
      p("A OS (Ordem de Saída) de Aviamento é como você RESERVA e dá baixa no estoque de aviamento à mão, nas lojas no modo só-estoque. Tem a mesma estrutura da OS de Tecido — com a diferença de que a baixa é por variante (cada aviamento×cor tem o seu saldo)."),
      p("O fio é o mesmo: a reserva segura o estoque, a baixa efetiva a saída. A lista tem busca, as mesmas colunas e o Status Baixado / Não Baixado."),
    ],
  },
  {
    id: "como-usar",
    titulo: "Como usar esta tela",
    intro: [
      p("Cria-se uma OS em “Nova OS”; edita-se clicando na linha."),
    ],
    campos: [
      { campo: "criar", rotulo: "Como abrir uma OS (reservar)", ajuda: [
        { tipo: "passos", itens: [
          "Clique em “Nova OS”.",
          "Preencha o cabeçalho (igual ao da OS de Tecido): Responsável, as datas de solicitação e corte, o Destino e uma observação.",
          "Acrescente os itens: linhas de aviamento com a quantidade a reservar, em unidades. Quando o aviamento tem cores, escolha também a Variante (cor); um aviamento sem variantes cadastradas avisa para cadastrá-las.",
          "Salve. A reserva segura o estoque por aviamento×variante.",
        ] },
      ] },
      { campo: "baixar", rotulo: "Como dar baixa (efetivar a saída)", ajuda: [
        { tipo: "passos", itens: [
          "Abra a OS e clique em “Dar baixa”.",
          "Confirme o “Utilizado” de cada item, em unidades. O disponível e o limite são por aviamento×variante; um valor acima do disponível é bloqueado (trava conferida no servidor).",
          "Confirme. Para voltar atrás, use “Desmarcar baixa” (pede confirmação): a baixa é revertida e o estoque restaurado.",
        ] },
      ] },
    ],
  },
  {
    id: "form",
    titulo: "Dados da OS (referência)",
    campos: [
      { campo: "cabecalho", rotulo: "Número · Responsável · Datas · Destino · Observação", ajuda: [p("O mesmo cabeçalho da OS de Tecido: número (sugerido), responsável, as datas de solicitação e corte, o destino e uma observação.")] },
      { campo: "itens", rotulo: "Itens — reserva (unidades)", ajuda: [p("Linhas de aviamento com a quantidade a reservar, em unidades. Quando o aviamento tem cores, escolha também a Variante (cor); um aviamento sem variantes cadastradas avisa para cadastrá-las.")] },
    ],
  },
  {
    id: "baixa",
    titulo: "Dar baixa (referência)",
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
