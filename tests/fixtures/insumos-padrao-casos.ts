// Casos COMPARTILHADOS da lista "Insumos padrao" da loja (urg R2, tenant_config.insumos_padrao):
//   tests/integration/urg-a2-insumos-padrao.test.ts (T9, SQL, so na copia) -> public.salvar_config_loja (validacao + normalizacao)
//   tests/unit/insumos-padrao.test.ts               (T11, TS)                -> src/lib/insumos-padrao.ts (normalizarInsumosPadrao /
//                                                                                validarInsumosPadrao)
// Sem import de codigo do app (o teste SQL importa so este arquivo). Toda entrada e serializavel em JSON.
// Mudou a regra? Mude SQL, TS e AQUI.
// Regras fixadas aqui (o TS deve concordar):
//  - a lista e um ARRAY JSON (null/objeto/texto = recusa); no maximo 50 itens (o limite e conferido ANTES dos itens).
//  - itens conferidos NA ORDEM; a 1a falha decide a mensagem; "item N" e 1-based.
//  - item = objeto JSON (null/texto/array = "formato invalido").
//  - etiqueta_id: texto no formato uuid com hifens (8-4-4-4-12, hex em qualquer caixa, sem espacos/chaves); ausente/null/outro
//    tipo/fora do formato = "insumo nao encontrado nesta loja". O SERVIDOR tambem exige que exista em etiquetas DA LOJA
//    (casos soServidor).
//  - cor_id: ausente, null ou "" (exato) = sem cor (null). Texto nao vazio = mesmo formato uuid ("  " e recusado); outro tipo
//    (numero, booleano, objeto) = recusa. O SERVIDOR tambem exige que exista em cores DA LOJA.
//  - consumo: NUMERO JSON (texto, mesmo "1.5", e recusado), 0 <= consumo <= 9999.
//  - par (insumo, cor) repetido = recusa no 2o (comparado JA normalizado: caixa do uuid e "" x ausente nao contam).
//  - normalizado: [{etiqueta_id, cor_id, consumo}] na MESMA ordem, so essas 3 chaves; uuid canonico (minusculo); cor sem valor =
//    null; consumo numerico (o mesmo numero).
//  - mensagem do servidor = "Lista de insumos padrão inválida: " + motivo (P0001, 400). `motivo` abaixo e um TRECHO dela.

export type InsumoPadrao = { etiqueta_id: string; cor_id: string | null; consumo: number };

/** ids FIXOS: o teste SQL cria estes insumos/cores (txn revertida); E1/E2/C1/C2 na Loja Teste, *_OUTRA noutra loja. */
export const IP_IDS = {
  E1: "a9e10000-0000-4000-8000-000000000e01",
  E2: "a9e10000-0000-4000-8000-000000000e02",
  C1: "a9e10000-0000-4000-8000-000000000c01",
  C2: "a9e10000-0000-4000-8000-000000000c02",
  E_OUTRA: "a9e10000-0000-4000-8000-000000000e09",
  C_OUTRA: "a9e10000-0000-4000-8000-000000000c09",
  /** formato valido, nao existe em lugar nenhum */
  E_INEXISTENTE: "a9e10000-0000-4000-8000-000000000e0f",
} as const;

const { E1, E2, C1, C2, E_OUTRA, C_OUTRA, E_INEXISTENTE } = IP_IDS;

export const PREFIXO_ERRO_INSUMOS_PADRAO = "Lista de insumos padrão inválida: ";

export type CasoNormaliza = { nome: string; entrada: unknown; esperado: InsumoPadrao[] };
export type CasoRecusa = {
  nome: string;
  entrada: unknown;
  /** trecho da mensagem (depois do prefixo) */
  motivo: string;
  /** so o servidor sabe recusar (depende do cadastro da loja); o TS aceita a forma */
  soServidor?: true;
};

const item = (etiqueta_id: unknown, cor_id: unknown, consumo: unknown) => ({ etiqueta_id, cor_id, consumo });
const repete = (n: number, x: unknown) => Array.from({ length: n }, () => x);

export const CASOS_NORMALIZA: CasoNormaliza[] = [
  { nome: "lista vazia", entrada: [], esperado: [] },
  {
    nome: "um item com cor",
    entrada: [item(E1, C1, 1.5)],
    esperado: [{ etiqueta_id: E1, cor_id: C1, consumo: 1.5 }],
  },
  {
    nome: "cor ausente vira null",
    entrada: [{ etiqueta_id: E1, consumo: 2 }],
    esperado: [{ etiqueta_id: E1, cor_id: null, consumo: 2 }],
  },
  {
    nome: "cor \"\" vira null",
    entrada: [item(E1, "", 2)],
    esperado: [{ etiqueta_id: E1, cor_id: null, consumo: 2 }],
  },
  {
    nome: "cor null fica null",
    entrada: [item(E2, null, 0.25)],
    esperado: [{ etiqueta_id: E2, cor_id: null, consumo: 0.25 }],
  },
  {
    nome: "chaves extras saem",
    entrada: [{ id: "x", nome: "ETIQUETA", etiqueta_id: E1, cor_id: C2, consumo: 3, unidade: "un" }],
    esperado: [{ etiqueta_id: E1, cor_id: C2, consumo: 3 }],
  },
  {
    nome: "uuid em caixa alta vira minusculo",
    entrada: [item(E1.toUpperCase(), C1.toUpperCase(), 1)],
    esperado: [{ etiqueta_id: E1, cor_id: C1, consumo: 1 }],
  },
  {
    nome: "limites do consumo (0 e 9999) e ordem preservada",
    entrada: [item(E2, null, 9999), item(E1, null, 0)],
    esperado: [
      { etiqueta_id: E2, cor_id: null, consumo: 9999 },
      { etiqueta_id: E1, cor_id: null, consumo: 0 },
    ],
  },
  {
    nome: "mesmo insumo em cores diferentes e sem cor",
    entrada: [item(E1, C1, 1), item(E1, C2, 1), item(E1, null, 1), item(E2, C1, 1)],
    esperado: [
      { etiqueta_id: E1, cor_id: C1, consumo: 1 },
      { etiqueta_id: E1, cor_id: C2, consumo: 1 },
      { etiqueta_id: E1, cor_id: null, consumo: 1 },
      { etiqueta_id: E2, cor_id: C1, consumo: 1 },
    ],
  },
  {
    nome: "consumo com casas decimais",
    entrada: [item(E1, C1, 0.125)],
    esperado: [{ etiqueta_id: E1, cor_id: C1, consumo: 0.125 }],
  },
];

export const CASOS_RECUSA: CasoRecusa[] = [
  { nome: "null", entrada: null, motivo: "precisa ser uma lista" },
  { nome: "objeto", entrada: { etiqueta_id: E1 }, motivo: "precisa ser uma lista" },
  { nome: "texto", entrada: "[]", motivo: "precisa ser uma lista" },
  { nome: "51 itens", entrada: repete(51, item(E1, null, 1)), motivo: "no máximo 50 insumos (veio 51)" },
  // 50 = dentro do limite: a recusa e a do item repetido, nao a do tamanho
  { nome: "50 itens repetidos (limite inclusivo)", entrada: repete(50, item(E1, null, 1)), motivo: "item 2: insumo e cor repetidos (já no item 1)" },
  { nome: "item texto", entrada: ["x"], motivo: "item 1: formato inválido" },
  { nome: "item null", entrada: [null], motivo: "item 1: formato inválido" },
  { nome: "item array", entrada: [[E1, null, 1]], motivo: "item 1: formato inválido" },
  { nome: "insumo ausente", entrada: [{ cor_id: null, consumo: 1 }], motivo: "item 1: insumo não encontrado nesta loja" },
  { nome: "insumo null", entrada: [item(null, null, 1)], motivo: "item 1: insumo não encontrado nesta loja" },
  { nome: "insumo fora do formato", entrada: [item("abc", null, 1)], motivo: "item 1: insumo não encontrado nesta loja" },
  { nome: "insumo com espacos", entrada: [item(` ${E1} `, null, 1)], motivo: "item 1: insumo não encontrado nesta loja" },
  { nome: "insumo numero", entrada: [item(123, null, 1)], motivo: "item 1: insumo não encontrado nesta loja" },
  {
    nome: "insumo de OUTRA loja",
    entrada: [item(E_OUTRA, null, 1)],
    motivo: "item 1: insumo não encontrado nesta loja",
    soServidor: true,
  },
  {
    nome: "insumo inexistente",
    entrada: [item(E_INEXISTENTE, null, 1)],
    motivo: "item 1: insumo não encontrado nesta loja",
    soServidor: true,
  },
  { nome: "cor numero", entrada: [item(E1, 5, 1)], motivo: "item 1: cor não encontrada nesta loja" },
  { nome: "cor fora do formato", entrada: [item(E1, "azul", 1)], motivo: "item 1: cor não encontrada nesta loja" },
  { nome: "cor so espacos", entrada: [item(E1, "  ", 1)], motivo: "item 1: cor não encontrada nesta loja" },
  {
    nome: "cor de OUTRA loja",
    entrada: [item(E1, C_OUTRA, 1)],
    motivo: "item 1: cor não encontrada nesta loja",
    soServidor: true,
  },
  { nome: "consumo negativo", entrada: [item(E1, null, -1)], motivo: "item 1: consumo precisa ser um número de 0 a 9999" },
  { nome: "consumo acima de 9999", entrada: [item(E1, null, 9999.001)], motivo: "item 1: consumo precisa ser um número de 0 a 9999" },
  { nome: "consumo texto", entrada: [item(E1, null, "abc")], motivo: "item 1: consumo precisa ser um número de 0 a 9999" },
  { nome: "consumo texto numerico", entrada: [item(E1, null, "1.5")], motivo: "item 1: consumo precisa ser um número de 0 a 9999" },
  { nome: "consumo null", entrada: [item(E1, null, null)], motivo: "item 1: consumo precisa ser um número de 0 a 9999" },
  { nome: "consumo ausente", entrada: [{ etiqueta_id: E1 }], motivo: "item 1: consumo precisa ser um número de 0 a 9999" },
  { nome: "consumo booleano", entrada: [item(E1, null, true)], motivo: "item 1: consumo precisa ser um número de 0 a 9999" },
  { nome: "falha no 2o item diz item 2", entrada: [item(E1, null, 1), item(E2, null, -2)], motivo: "item 2: consumo precisa ser um número de 0 a 9999" },
  { nome: "par repetido", entrada: [item(E1, C1, 1), item(E1, C1, 2)], motivo: "item 2: insumo e cor repetidos (já no item 1)" },
  {
    nome: "repetido sem cor (ausente x \"\")",
    entrada: [item(E2, C1, 1), { etiqueta_id: E1, consumo: 1 }, item(E1, "", 2)],
    motivo: "item 3: insumo e cor repetidos (já no item 2)",
  },
  {
    nome: "repetido com caixa diferente",
    entrada: [item(E1, C1, 1), item(E1.toUpperCase(), C1.toUpperCase(), 1)],
    motivo: "item 2: insumo e cor repetidos (já no item 1)",
  },
];
