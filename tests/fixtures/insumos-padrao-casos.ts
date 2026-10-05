// Casos COMPARTILHADOS da lista "Insumos padrao" da loja (urg R2, tenant_config.insumos_padrao):
//   tests/integration/urg-a2-insumos-padrao.test.ts (T9, SQL, so na copia) -> public.salvar_config_loja (validacao + normalizacao)
//   tests/unit/insumos-padrao.test.ts               (T11, TS)                -> src/lib/insumos-padrao.ts (normalizarInsumosPadrao /
//                                                                                validarInsumosPadrao)
// Sem import de codigo do app (o teste SQL importa so este arquivo). Toda entrada e serializavel em JSON.
// Mudou a regra? Mude SQL, TS e AQUI.
// Regras fixadas aqui (o TS deve concordar):
//  - a lista e um ARRAY JSON (null/objeto/texto = recusa); no maximo 20 itens (= limite do editor de insumos do card; fix round 1
//    da T10 - era 50) - o limite e conferido ANTES dos itens.
//  - itens conferidos NA ORDEM; a 1a falha decide a mensagem; "item N" e 1-based.
//  - item = objeto JSON (null/texto/array = "formato invalido").
//  - etiqueta_id: texto no formato uuid com hifens (8-4-4-4-12, hex em qualquer caixa, sem espacos/chaves); ausente/null/outro
//    tipo/fora do formato = "insumo nao encontrado nesta loja". O SERVIDOR tambem exige que exista em etiquetas DA LOJA
//    (casos soServidor).
//  - cor_id: ausente, null ou "" (exato) = sem cor (null). Texto nao vazio = mesmo formato uuid ("  " e recusado); outro tipo
//    (numero, booleano, objeto) = recusa. O SERVIDOR tambem exige que exista em cores DA LOJA.
//  - consumo: NUMERO JSON (texto, mesmo "1.5", e recusado), 0 <= consumo <= 9999, no maximo 4 casas decimais (=
//    modelo_etiquetas.consumo numeric(10,4); "1.10" vale - conta o VALOR, nao a grafia). Ordem: tipo, faixa, casas.
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
  {
    nome: "consumo com 4 casas (o maximo)",
    entrada: [item(E1, null, 1.2345), item(E2, C2, 9998.9999)],
    esperado: [
      { etiqueta_id: E1, cor_id: null, consumo: 1.2345 },
      { etiqueta_id: E2, cor_id: C2, consumo: 9998.9999 },
    ],
  },
];

export const CASOS_RECUSA: CasoRecusa[] = [
  { nome: "null", entrada: null, motivo: "precisa ser uma lista" },
  { nome: "objeto", entrada: { etiqueta_id: E1 }, motivo: "precisa ser uma lista" },
  { nome: "texto", entrada: "[]", motivo: "precisa ser uma lista" },
  { nome: "21 itens", entrada: repete(21, item(E1, null, 1)), motivo: "no máximo 20 insumos (veio 21)" },
  // 20 = dentro do limite: a recusa e a do item repetido, nao a do tamanho
  { nome: "20 itens repetidos (limite inclusivo)", entrada: repete(20, item(E1, null, 1)), motivo: "item 2: insumo e cor repetidos (já no item 1)" },
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
  { nome: "consumo com 5 casas", entrada: [item(E1, null, 1.00001)], motivo: "item 1: consumo com no máximo 4 casas decimais" },
  { nome: "consumo minusculo (5a casa)", entrada: [item(E1, null, 0.00005)], motivo: "item 1: consumo com no máximo 4 casas decimais" },
  { nome: "acima de 9999 com 5 casas: a faixa decide antes", entrada: [item(E1, null, 9999.00001)], motivo: "item 1: consumo precisa ser um número de 0 a 9999" },
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

// ---------------------------------------------------------------------------------------------------------------------------
// CASOS_APLICAR (urg R2 T12, fix round 1) - a leitura TOLERANTE da lista CRUA que CRIA CARD. Espelha EXATAMENTE o helper do
// servidor `public._insumos_padrao_aplicar` (migration 20261103175000) e e a mesma regra do pre-preenchimento do "+ Novo" e do
// "Criar varios cards":
//   tests/unit/insumos-novo-dialog.test.ts  (TS, src/lib/insumos-padrao-normalizadores.ts -> normalizarInsumosPadraoParaCard)
//   (o teste SQL de _insumos_padrao_aplicar roda a MESMA lista: cria o catalogo CATALOGO_APLICAR numa loja, grava `entrada` em
//    tenant_config.insumos_padrao por UPDATE direto e confere que as linhas gravadas em modelo_etiquetas = `esperado`)
// Regras (a ordem e a do laco SQL):
//  - lista que nao e array => nada; le no MAXIMO 200 itens crus; PARA ao juntar 20 linhas validas;
//  - item que nao e objeto => pula; etiqueta_id que nao e TEXTO uuid => pula (nao e orfao); uuid que nao esta no catalogo da loja
//    (outra loja/apagado) => pula e conta como ORFAO (a contagem so existe no TS - a tela mostra o aviso ambar);
//  - consumo: NUMERO JSON 0..9999 com no maximo 4 casas, senao pula;
//  - cor: so vale TEXTO uuid presente nas variantes DO INSUMO (CATALOGO_APLICAR); qualquer outra coisa (ausente, null, "", numero,
//    booleano, texto fora do formato, cor removida/de outra loja) vira SEM cor - o item NAO e descartado;
//  - par (insumo, cor) repetido e conferido DEPOIS de resolver a cor (cor removida + "sem cor" do mesmo insumo = 1 linha so):
//    fica o 1o; uuid sai em minusculo; saida = [{etiqueta_id, cor_id, consumo}] na ordem da lista.
// ---------------------------------------------------------------------------------------------------------------------------

/** insumos extras (sem variantes) so para exercitar o teto de 20 linhas. */
export const E_MUITOS: string[] = Array.from({ length: 25 }, (_, i) => `a9e10000-0000-4000-8000-0000000f${String(i).padStart(4, "0")}`);

/** Catalogo da loja usado pelos CASOS_APLICAR: insumo -> cores das suas variantes. C_OUTRA/E_OUTRA/E_INEXISTENTE NAO estao aqui. */
export const CATALOGO_APLICAR: Record<string, string[]> = {
  [E1]: [C1, C2],
  [E2]: [],
  ...Object.fromEntries(E_MUITOS.map((id) => [id, [] as string[]])),
};

export type CasoAplicar = { nome: string; entrada: unknown; esperado: InsumoPadrao[]; /** so TS */ orfaos: number };

const lixo = (n: number) => Array.from({ length: n }, () => "x");

export const CASOS_APLICAR: CasoAplicar[] = [
  { nome: "nao e lista (null/objeto/texto) => nada", entrada: { etiqueta_id: E1, consumo: 1 }, esperado: [], orfaos: 0 },
  { nome: "lista vazia", entrada: [], esperado: [], orfaos: 0 },
  {
    nome: "cor removida do insumo + o mesmo insumo sem cor => UMA linha (resolve a cor ANTES de repetir)",
    entrada: [item(E1, IP_IDS.C_OUTRA, 1), item(E1, null, 2)],
    esperado: [{ etiqueta_id: E1, cor_id: null, consumo: 1 }],
    orfaos: 0,
  },
  {
    nome: "sem cor primeiro, cor removida depois => UMA linha (fica a 1a)",
    entrada: [item(E1, null, 2), item(E1, IP_IDS.C_OUTRA, 1)],
    esperado: [{ etiqueta_id: E1, cor_id: null, consumo: 2 }],
    orfaos: 0,
  },
  {
    nome: "cor_id que nao e uuid (texto/numero/booleano/objeto) => item entra SEM cor",
    entrada: [item(E1, "abc", 1), item(E2, 123, 2), item(E2, true, 3), item(E1, { a: 1 }, 4)],
    esperado: [
      { etiqueta_id: E1, cor_id: null, consumo: 1 },
      { etiqueta_id: E2, cor_id: null, consumo: 2 },
    ],
    orfaos: 0,
  },
  {
    nome: "cor existente no catalogo mas nao nas variantes DESTE insumo => sem cor",
    entrada: [item(E2, C1, 1), item(E1, C1, 2)],
    esperado: [
      { etiqueta_id: E2, cor_id: null, consumo: 1 },
      { etiqueta_id: E1, cor_id: C1, consumo: 2 },
    ],
    orfaos: 0,
  },
  {
    nome: "cor \"\" / ausente / null => sem cor; uuid em caixa alta vira minusculo",
    entrada: [item(E1, "", 1), item(E2.toUpperCase(), null, 2), item(E1.toUpperCase(), C2.toUpperCase(), 3)],
    esperado: [
      { etiqueta_id: E1, cor_id: null, consumo: 1 },
      { etiqueta_id: E2, cor_id: null, consumo: 2 },
      { etiqueta_id: E1, cor_id: C2, consumo: 3 },
    ],
    orfaos: 0,
  },
  {
    nome: "par repetido (inclusive caixa diferente) => fica o 1o",
    entrada: [item(E1, C1, 1), item(E1, C1, 2), item(E1.toUpperCase(), C1.toUpperCase(), 3), item(E1, C2, 4)],
    esperado: [
      { etiqueta_id: E1, cor_id: C1, consumo: 1 },
      { etiqueta_id: E1, cor_id: C2, consumo: 4 },
    ],
    orfaos: 0,
  },
  {
    nome: "insumo de outra loja / apagado => pulado e contado como orfao; os bons ficam na ordem",
    entrada: [item(E2, null, 1), item(E_OUTRA, null, 1), item(E1, C1, 2), item(E_INEXISTENTE, null, 3)],
    esperado: [
      { etiqueta_id: E2, cor_id: null, consumo: 1 },
      { etiqueta_id: E1, cor_id: C1, consumo: 2 },
    ],
    orfaos: 2,
  },
  {
    nome: "etiqueta_id fora do formato (nulo, numero, espacos, abc) => pulado, NAO e orfao",
    entrada: [item(null, null, 1), item(123, null, 1), item(` ${E1} `, null, 1), item("abc", null, 1), { cor_id: null, consumo: 1 }, item(E1, null, 5)],
    esperado: [{ etiqueta_id: E1, cor_id: null, consumo: 5 }],
    orfaos: 0,
  },
  {
    nome: "item que nao e objeto (texto/null/array) => pulado",
    entrada: ["x", null, [E1, null, 1], item(E1, null, 1)],
    esperado: [{ etiqueta_id: E1, cor_id: null, consumo: 1 }],
    orfaos: 0,
  },
  {
    nome: "consumo: 0, 9999 e 4 casas valem",
    entrada: [item(E1, null, 0), item(E2, null, 9999), item(E1, C1, 1.2345), item(E1, C2, 1.1)],
    esperado: [
      { etiqueta_id: E1, cor_id: null, consumo: 0 },
      { etiqueta_id: E2, cor_id: null, consumo: 9999 },
      { etiqueta_id: E1, cor_id: C1, consumo: 1.2345 },
      { etiqueta_id: E1, cor_id: C2, consumo: 1.1 },
    ],
    orfaos: 0,
  },
  {
    nome: "consumo invalido (negativo, > 9999, texto, null, ausente, booleano, 5 casas) => item pulado",
    entrada: [
      item(E1, null, -1), item(E1, null, 9999.0001), item(E1, null, "1.5"), item(E1, null, null), { etiqueta_id: E1 },
      item(E1, null, true), item(E1, null, 1.00001), item(E1, null, 0.00005), item(E2, null, 2),
    ],
    esperado: [{ etiqueta_id: E2, cor_id: null, consumo: 2 }],
    orfaos: 0,
  },
  {
    nome: "25 validos => so os 20 primeiros (para ao juntar 20)",
    entrada: E_MUITOS.map((id) => item(id, null, 1)),
    esperado: E_MUITOS.slice(0, 20).map((id) => ({ etiqueta_id: id, cor_id: null, consumo: 1 })),
    orfaos: 0,
  },
  {
    nome: "orfao DEPOIS do 20o valido nem e lido (nao conta)",
    entrada: [...E_MUITOS.slice(0, 20).map((id) => item(id, null, 1)), item(E_OUTRA, null, 1)],
    esperado: E_MUITOS.slice(0, 20).map((id) => ({ etiqueta_id: id, cor_id: null, consumo: 1 })),
    orfaos: 0,
  },
  {
    nome: "le no maximo 200 itens crus: valido na posicao 201 e ignorado",
    entrada: [...lixo(200), item(E1, null, 1)],
    esperado: [],
    orfaos: 0,
  },
  {
    nome: "valido na posicao 200 ainda entra",
    entrada: [...lixo(199), item(E1, null, 1)],
    esperado: [{ etiqueta_id: E1, cor_id: null, consumo: 1 }],
    orfaos: 0,
  },
  {
    nome: "chaves extras saem e a ordem da lista e mantida",
    entrada: [{ id: "x", nome: "ETQ", etiqueta_id: E2, cor_id: null, consumo: 3, unidade: "un" }, item(E1, C1, 1)],
    esperado: [
      { etiqueta_id: E2, cor_id: null, consumo: 3 },
      { etiqueta_id: E1, cor_id: C1, consumo: 1 },
    ],
    orfaos: 0,
  },
];
