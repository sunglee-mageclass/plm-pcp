// Conteúdo do Manual — GUIA GERAL (transversal): trabalhar em equipe ao mesmo tempo.
// Ancorado no pageKey `manual` (a própria tela do Manual): a `ManualPage` mostra este conteúdo como o
// grupo "Guia geral" no topo do índice, para TODOS os logados (não depende de loja nem de permissão).
// ATENÇÃO: descreve só o que JÁ existe (atualização automática, anéis de presença, aviso de conflito).
// NÃO prometer co-edição ao vivo (ver o campo mudar enquanto o outro digita) — isso é futuro.
import { p, lista, type ConteudoTelas, type SecaoConteudoManual } from "./tipos";

const TRABALHAR_EM_EQUIPE: SecaoConteudoManual[] = [
  {
    id: "equipe-atualiza-sozinha",
    titulo: "A tela atualiza sozinha",
    intro: [
      p("O sistema é feito para várias pessoas trabalharem ao mesmo tempo, cada uma no seu computador. Quando outra pessoa salva o mesmo card ou a mesma tela que você está olhando, a sua tela muda sozinha, sem recarregar."),
      { tipo: "passos", itens: [
        "Você abre um card ou uma tela, como sempre.",
        "Outra pessoa da sua loja altera o mesmo registro e clica em Salvar.",
        "Alguns instantes depois, o que você vê já mostra o valor novo. Não precisa apertar F5 nem sair e voltar.",
      ] },
      p("Importante: a tela se atualiza quando a outra pessoa SALVA. Você não vê o que ela está digitando enquanto digita."),
    ],
  },
  {
    id: "equipe-quem-esta-editando",
    titulo: "Quem está editando o quê",
    intro: [
      p("Quando mais de uma pessoa está na mesma tela, o sistema mostra quem é quem. Aparecem bolinhas e anéis coloridos com o nome da pessoa:"),
      lista([
        "As bolinhas no topo da tela mostram quem está ali com você.",
        "O anel colorido em volta de um campo mostra em qual campo cada pessoa está mexendo naquele momento.",
        "Cada pessoa tem uma cor própria, sempre a mesma, para você reconhecer quem é de relance.",
        "Quando a pessoa sai do campo ou da tela, o anel some.",
      ]),
      p("Use isso a seu favor: se você vê o anel de alguém num campo, combine com a pessoa antes de mexer ali. Assim vocês não sobrescrevem o trabalho um do outro."),
    ],
  },
  {
    id: "equipe-mesmo-lugar",
    titulo: "Quando duas pessoas mexem no mesmo lugar",
    intro: [
      p("Se você e outra pessoa alteram o mesmo registro e ela salva antes de você, o sistema não deixa o trabalho de ninguém se perder. Ao tentar salvar, aparece o aviso “outra pessoa salvou”, com duas escolhas:"),
      { tipo: "passos", itens: [
        "Leia o aviso: ele diz que o registro mudou enquanto você editava.",
        "Clique em “Manter o meu” se o que você digitou é o que vale. Suas alterações seguem e são gravadas.",
        "Ou clique em “Usar o novo” para aceitar o que a outra pessoa salvou e descartar a sua alteração naquele ponto.",
      ] },
      p("Nada é apagado em silêncio: o sistema sempre pergunta antes de decidir qual versão fica. Se as alterações foram em campos diferentes, elas se juntam sem nenhum aviso."),
    ],
  },
];

export const COLABORACAO_CONTEUDO: ConteudoTelas = {
  manual: TRABALHAR_EM_EQUIPE,
};
