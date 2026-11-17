// Agregador do CONTEÚDO à mão do Manual. Os tipos vivem em `conteudo/tipos.ts`; cada MÓDULO tem seu
// próprio arquivo em `conteudo/<modulo>.ts` (assim várias pessoas/ondas escrevem sem colidir). Aqui
// só juntamos tudo num mapa pageKey → seções. A `ManualPage` lê por `conteudoDaTela(pageKey)`.
export type { CampoManual, SecaoConteudoManual, ConteudoTelas } from "./conteudo/tipos";
import type { SecaoConteudoManual, ConteudoTelas } from "./conteudo/tipos";
import { CRIACAO_CONTEUDO } from "./conteudo/criacao";

/** Todos os módulos de conteúdo, juntos. Acrescente o import + o spread ao documentar um módulo. */
export const CONTEUDO_TELAS: ConteudoTelas = {
  ...CRIACAO_CONTEUDO,
};

/** Seções de conteúdo à mão de uma tela (ou `[]` se ainda não houver). PURO. */
export function conteudoDaTela(pageKey: string): SecaoConteudoManual[] {
  return CONTEUDO_TELAS[pageKey] ?? [];
}
