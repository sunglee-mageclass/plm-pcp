// Tipo do CONTEÚDO à mão do Manual (campo a campo de cada tela), que as FATIAS de conteúdo preenchem.
// A ajuda de cada campo usa o `Bloco` REAL do motor compartilhado (p/passos/lista/codigo/tabela/faq/
// imagem) — a `ManualPage` renderiza cada campo como um verbete (nome em negrito + a ajuda).
import type { Bloco } from "@/components/shared/manual/tipos";

/** A ajuda à mão de UM campo de uma tela. */
export type CampoManual = {
  /** Identificador do campo na tela (ex.: nome do input / chave do modelo). */
  campo: string;
  /** Rótulo legível do campo (vira o subtítulo do verbete). */
  rotulo: string;
  /** Blocos de ajuda do campo (texto/passos/lista/tabela…). */
  ajuda: Bloco[];
  /** Quando esse campo/ajuda se aplica (condição opcional, 1 linha ao lado do rótulo). */
  quando?: string;
};

/** Mapa pageKey → campos documentados daquela tela. As fatias de conteúdo preenchem. */
export type CamposCatalogo = Record<string, CampoManual[]>;

// ─────────────────────────────────────────────────────────────────────────────
// CONTEÚDO À MÃO — por pageKey. Fiel ao comportamento real do sistema (InfoHover já escritos +
// mapeamento §17 + regras do Sheet). PILOTO: Planejamento de Produto, seção "Informações Gerais".
// ─────────────────────────────────────────────────────────────────────────────

/** Planejamento de Produto (`criacao_planejamento`) — AMOSTRA: seção "Informações Gerais do Produto".
 *  As demais seções (Códigos, Preço, BOM, CAD, Peça Teste…) entram nas próximas ondas de conteúdo. */
const PLANEJAMENTO_INFO_GERAIS: CampoManual[] = [
  {
    campo: "status",
    rotulo: "Status",
    ajuda: [{ tipo: "p", texto: "A situação do produto no planejamento. O card muda de coluna no quadro conforme avança; este campo mostra onde ele está." }],
  },
  {
    campo: "estilista",
    rotulo: "Estilista",
    quando: "opcional",
    ajuda: [{ tipo: "p", texto: "Quem desenhou o produto. Pode ficar em branco (“— Nenhum —”)." }],
  },
  {
    campo: "origem",
    rotulo: "Origem",
    ajuda: [
      { tipo: "p", texto: "Define como o produto entra na loja: Interno (você fabrica), Revenda (compra pronto para revender) ou Importado. Começa em Interno." },
      { tipo: "p", texto: "Algumas origens podem aparecer travadas — por exemplo, Importado só existe se a loja tem o módulo, e trocar de origem depois que o produto já tem dados pode ser bloqueado. O “i” ao lado do campo explica o motivo quando isso acontece." },
    ],
  },
  {
    campo: "nome",
    rotulo: "Nome do Modelo",
    quando: "obrigatório",
    ajuda: [{ tipo: "p", texto: "O nome do produto. É a base de outros campos automáticos: a REF, o Título para a página e os SKUs partem dele. O mesmo produto também é editável no Desenvolvimento." }],
  },
  {
    campo: "versao",
    rotulo: "Versão",
    quando: "obrigatório",
    ajuda: [{ tipo: "p", texto: "O número da versão do produto (começa em 1). A partir da versão 2, o card mostra um selo “↻ v2” — é uma repetição/releitura do mesmo produto, que herda alguns automáticos da versão anterior (como o Título e o Preço anterior)." }],
  },
  {
    campo: "ncm",
    rotulo: "NCM do Produto",
    quando: "opcional",
    ajuda: [{ tipo: "p", texto: "O código fiscal (NCM) do produto, se você usa. É um campo livre: digite só números e pontos. Não há tabela nem sugestão — é anotado como você escrever. Em branco, fica sem NCM." }],
  },
  {
    campo: "taxonomia",
    rotulo: "Grupo · Categoria · Subcategoria 1 · Subcategoria 2",
    ajuda: [
      { tipo: "p", texto: "A classificação do produto, em até quatro níveis que se encadeiam: o Grupo abre as Categorias, a Categoria abre as Subcategorias." },
      { tipo: "p", texto: "Trocar o Grupo limpa a Categoria e as subcategorias; trocar a Categoria reseta as subcategorias — as opções mostradas são sempre as que pertencem ao nível acima. Nem toda categoria usa a Subcategoria 2." },
    ],
  },
  {
    campo: "titulo_pagina",
    rotulo: "Título para a página",
    quando: "automático se vazio",
    ajuda: [
      { tipo: "p", texto: "É o título que o produto terá na página do e-commerce. Deixando em branco, o sistema preenche sozinho: na versão 1, usa o Nome do Modelo em Iniciais Maiúsculas + “ | ” + o nome da loja; da versão 2 em diante, herda o título da versão anterior enquanto ninguém editar." },
      { tipo: "p", texto: "Se você digitar um título diferente, ele fica fixo (manual). Para voltar ao automático, apague o campo ou clique no botão “↺” ao lado." },
    ],
  },
  {
    campo: "descricao_produto",
    rotulo: "Descrição do produto",
    quando: "opcional",
    ajuda: [{ tipo: "p", texto: "Um texto livre com a descrição do produto. É um campo do Planejamento — não aparece na Ficha Técnica." }],
  },
  {
    campo: "medidas",
    rotulo: "Peso (kg) · Comprimento · Largura · Altura (cm)",
    quando: "opcional",
    ajuda: [{ tipo: "p", texto: "As medidas físicas do produto, úteis para frete e logística no e-commerce. Em branco, a medida fica vazia (não conta como zero). O peso aceita 3 casas decimais; as medidas, 2." }],
  },
];

/** Preenchido por pageKey. PILOTO: Planejamento com a seção Informações Gerais. */
export const CAMPOS_CATALOGO: CamposCatalogo = {
  criacao_planejamento: PLANEJAMENTO_INFO_GERAIS,
};

/** Campos documentados de uma tela (ou `[]` se ainda não houver). PURO. */
export function camposDaTela(pageKey: string): CampoManual[] {
  return CAMPOS_CATALOGO[pageKey] ?? [];
}
