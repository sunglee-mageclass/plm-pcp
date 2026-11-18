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
      p("Quando mais de uma pessoa está na mesma tela, o sistema mostra quem é quem de dois jeitos:"),
      lista([
        "Uma faixa azul no topo da tela com o nome de cada pessoa, e o texto “também está nesta tela” (ou “também estão nesta tela”, se forem várias). O nome de cada pessoa aparece numa etiqueta na cor dela.",
        "Um anel colorido ao redor do campo em que a pessoa está mexendo naquele momento, com o nome dela. Assim você sabe em qual campo cada pessoa está, na hora.",
        "Cada pessoa tem uma cor própria, sempre a mesma: a etiqueta da faixa e o anel do campo têm a mesma cor, para você reconhecer quem é de relance.",
        "Quando a pessoa sai do campo ou da tela, o anel some.",
      ]),
      p("Use isso a seu favor: se você vê o anel de alguém num campo, combine com a pessoa antes de mexer ali. Assim vocês não sobrescrevem o trabalho um do outro."),
    ],
  },
  {
    id: "equipe-mesmo-lugar",
    titulo: "Quando duas pessoas mexem no mesmo lugar",
    intro: [
      p("Se você e outra pessoa alteram o mesmo campo, o sistema não deixa o trabalho de ninguém se perder. O aviso aparece quando a OUTRA pessoa salva (e não quando você clica em Salvar): uma faixa diz “Alguém salvou agora — N campo(s) atualizado(s) · M em conflito”."),
      lista([
        "Campos que só a outra pessoa mudou já se atualizam sozinhos na sua tela.",
        "Campos que vocês dois mudaram ficam “em conflito”: o sistema mostra o seu valor e o novo lado a lado e pede a sua escolha.",
      ]),
      { tipo: "passos", itens: [
        "Leia a faixa: ela diz quantos campos mudaram e quantos estão em conflito.",
        "Em cada conflito, clique em “manter meu” se o que você digitou é o que vale.",
        "Ou clique em “usar o novo” para aceitar o que a outra pessoa salvou e descartar a sua alteração naquele campo.",
        "Enquanto houver conflito pendente, o botão Salvar fica travado. Escolha uma opção em cada item e ele é liberado.",
      ] },
      p("Nada é apagado em silêncio: o sistema sempre pergunta antes de decidir qual versão fica."),
    ],
  },
];

export const COLABORACAO_CONTEUDO: ConteudoTelas = {
  manual: TRABALHAR_EM_EQUIPE,
};
