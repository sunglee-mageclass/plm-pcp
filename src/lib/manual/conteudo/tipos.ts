// Tipos do CONTEÚDO à mão do Manual (compartilhados por todos os arquivos de conteúdo por módulo).
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

/** Uma SEÇÃO temática do Manual de uma tela (espelha uma área da tela). `id` vira a âncora
 *  `#secao-<id>` usada pela ajuda contextual. `intro` é o texto de abertura; `campos` os verbetes. */
export type SecaoConteudoManual = {
  id: string;
  titulo: string;
  intro?: Bloco[];
  campos?: CampoManual[];
  /** Componente VIVO embutido, renderizado pela `ManualPage` abaixo da intro (além/no lugar dos
   *  `campos`). `"requisitos-fases"` = `<RequisitosFasesPanel/>` (requisitos de entrada por fase,
   *  lidos da config real da loja). Mantenha a união pequena e tipada. */
  componente?: "requisitos-fases";
};

/** Mapa pageKey → seções de conteúdo à mão daquela tela. */
export type ConteudoTelas = Record<string, SecaoConteudoManual[]>;

/** Atalho para um bloco de parágrafo. */
export const p = (texto: string): Bloco => ({ tipo: "p", texto });

/** Atalho para um bloco de lista. */
export const lista = (itens: string[]): Bloco => ({ tipo: "lista", itens });
