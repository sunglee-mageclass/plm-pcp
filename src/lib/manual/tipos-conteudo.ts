// Tipo do CONTEÚDO à mão do Manual (campo a campo de cada tela), que outras FATIAS preenchem.
// Esta fatia (A2) só DECLARA os tipos e expõe um catálogo VAZIO + o acessor — o conteúdo em si
// chega depois.
//
// ⚠️ `BlocoRef` aqui é um placeholder MÍNIMO: o motor real de Bloco virá do shared/manual que
// outro agente cria. Quando `@/components/shared/manual/tipos` existir, TROCAR `BlocoRef` por
// `import { type Bloco } from "@/components/shared/manual/tipos"` e usar `Bloco` no campo `ajuda`.
// NÃO importar de shared/manual AGORA (o arquivo pode ainda não existir — evita quebrar o build).

/** Placeholder de bloco de ajuda. Substituir por `Bloco` de `@/components/shared/manual/tipos`
 *  quando aquele módulo existir (ver comentário acima). */
export type BlocoRef =
  | { tipo: "p"; texto: string }
  | { tipo: "lista"; itens: string[] };

/** A ajuda à mão de UM campo de uma tela. */
export type CampoManual = {
  /** Identificador do campo na tela (ex.: nome do input / chave do modelo). */
  campo: string;
  /** Rótulo legível do campo. */
  rotulo: string;
  /** Blocos de ajuda (texto/lista). Vira `Bloco[]` quando o motor real existir. */
  ajuda: BlocoRef[];
  /** Quando esse campo/ajuda se aplica (condição opcional, texto livre). */
  quando?: string;
};

/** Mapa pageKey → campos documentados daquela tela. As fatias de conteúdo preenchem. */
export type CamposCatalogo = Record<string, CampoManual[]>;

/** VAZIO por ora — as fatias de conteúdo preenchem por pageKey. */
export const CAMPOS_CATALOGO: CamposCatalogo = {};

/** Campos documentados de uma tela (ou `[]` se ainda não houver). PURO. */
export function camposDaTela(pageKey: string): CampoManual[] {
  return CAMPOS_CATALOGO[pageKey] ?? [];
}
