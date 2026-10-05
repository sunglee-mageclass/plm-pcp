// Casos COMPARTILHADOS do anti-drift "insumo vinculado a UM tamanho" (urg R1):
//   tests/unit/insumo-tamanho.test.ts          -> src/lib/insumo-tamanho.ts (TS)
//   tests/integration/... (T2, SQL, so na copia) -> public._estoque_etiqueta_core (ce_sem)
// Sem import de codigo do app (o teste SQL importa so este arquivo). Toda entrada e serializavel em JSON.
// Mudou a regra? Mude TS, SQL e AQUI.
// Regras fixadas aqui (o SQL deve concordar):
//  - "trim" = SO espacos ASCII (btrim(x)); tab/NBSP/quebra de linha NAO sao espaco. Vale para o tamanho
//    da variante e para o vinculo (vinculo "  " = sem vinculo; " 40|M " = "40|M").
//  - formato compara 'nenhum' exato (sem trim, sem caixa); formato null equivale a nao-'nenhum'.
//  - valor de celula conta se String(v) casa ^[0-9]+(\.[0-9]+)?$ ("07" ok, ".5"/"7."/"1,5" nao). Em JSON,
//    numero >= 1e21 ou < 1e-6 vira expoente no JS (rejeitado) e digitos planos no jsonb (aceito): irrelevante p/ pecas.
//  - fator = pecas / grade_total, SEM clamp: pode passar de 1 se as celulas somam mais que o total.
//  - total <= 0 => fator 1 (e fora = false), mesmo com celulas > 0; pecas continua sendo a celula.
//  - chave da grade e propriedade PROPRIA (nome como "constructor" nao herda nada).

export type CasoInsumoTamanho = {
  nome: string;
  info: {
    tamanho_vinculado: string | null;
    formato_tamanho: string | null;
    variantes: { tamanho: string | null }[];
  };
  linhas: { grades: Record<string, unknown> | null; grade_total: number | null }[];
  esperado: { efetivo: string | null; pecas: number; fator: number; fora: boolean };
  // true so quando o fator e fracao nao terminante (1/3): o teste compara com toBeCloseTo(..., 10).
  // Nos demais casos a comparacao e exata (toBe). No SQL: round(fator, 4) dos dois lados.
  fatorAproximado?: boolean;
};

const GRADE_4 = { "40|M": 16, "38|P": 16, "36|PP": 16, "42|G": 16 };

const GRADE_CANTOS = { "40|M": "07", "38|P": ".5", "36|PP": "1,5", "42|G": 7.5, "44|GG": "0" };

export const CASOS_INSUMO_TAMANHO: CasoInsumoTamanho[] = [
  {
    nome: "sem vinculo: pecas = total, fator 1",
    info: { tamanho_vinculado: null, formato_tamanho: "letra", variantes: [] },
    linhas: [{ grades: GRADE_4, grade_total: 64 }],
    esperado: { efetivo: null, pecas: 64, fator: 1, fora: false },
  },
  {
    nome: "vinculado e presente na grade: so as pecas daquele tamanho",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: GRADE_4, grade_total: 64 }],
    esperado: { efetivo: "40|M", pecas: 16, fator: 0.25, fora: false },
  },
  {
    nome: "vinculado e ausente da grade com total > 0: zero pecas, fora da grade",
    info: { tamanho_vinculado: "44|GG", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: GRADE_4, grade_total: 64 }],
    esperado: { efetivo: "44|GG", pecas: 0, fator: 0, fora: true },
  },
  {
    nome: "grade vazia e total 0 (Ruling A3): pecas 0, fator 1, nao e fora",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: {}, grade_total: 0 }],
    esperado: { efetivo: "40|M", pecas: 0, fator: 1, fora: false },
  },
  {
    nome: "grades null e grade_total null: tratado como total 0",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: null, grade_total: null }],
    esperado: { efetivo: "40|M", pecas: 0, fator: 1, fora: false },
  },
  {
    nome: "sem linhas de grade e sem vinculo: pecas 0, fator 1",
    info: { tamanho_vinculado: null, formato_tamanho: "letra", variantes: [] },
    linhas: [],
    esperado: { efetivo: null, pecas: 0, fator: 1, fora: false },
  },
  {
    nome: "2 linhas de grade somando o mesmo tamanho (8+8)",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [] },
    linhas: [
      { grades: { "40|M": 8, "38|P": 8 }, grade_total: 16 },
      { grades: { "40|M": 8, "38|P": 8 }, grade_total: 16 },
    ],
    esperado: { efetivo: "40|M", pecas: 16, fator: 0.5, fora: false },
  },
  {
    nome: "valor decimal em texto (7.5)",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: { "40|M": "7.5", "38|P": "2.5" }, grade_total: 10 }],
    esperado: { efetivo: "40|M", pecas: 7.5, fator: 0.75, fora: false },
  },
  {
    nome: "valor nao numerico ('x') e ignorado: tamanho vinculado fica ausente",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: { "40|M": "x", "42|G": 10 }, grade_total: 10 }],
    esperado: { efetivo: "40|M", pecas: 0, fator: 0, fora: true },
  },
  {
    nome: "valor negativo (-3) e ignorado",
    info: { tamanho_vinculado: "38|P", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: { "38|P": -3, "42|G": 10 }, grade_total: 10 }],
    esperado: { efetivo: "38|P", pecas: 0, fator: 0, fora: true },
  },
  {
    nome: "valor null e ignorado; o vizinho valido conta",
    info: { tamanho_vinculado: "42|G", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: { "36|PP": null, "42|G": 10 }, grade_total: 10 }],
    esperado: { efetivo: "42|G", pecas: 10, fator: 1, fora: false },
  },
  {
    nome: "celula 0 na grade: tamanho presente mas sem pecas = fora",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: { "40|M": 0, "38|P": 16 }, grade_total: 16 }],
    esperado: { efetivo: "40|M", pecas: 0, fator: 0, fora: true },
  },
  {
    nome: "vinculo vazio ('') = sem vinculo",
    info: { tamanho_vinculado: "", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: GRADE_4, grade_total: 64 }],
    esperado: { efetivo: null, pecas: 64, fator: 1, fora: false },
  },
  {
    nome: "vinculo + formato 'letra' + variante com tamanho: efetivo null (pecas = total)",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "letra", variantes: [{ tamanho: "M" }] },
    linhas: [{ grades: GRADE_4, grade_total: 64 }],
    esperado: { efetivo: null, pecas: 64, fator: 1, fora: false },
  },
  {
    nome: "vinculo + formato 'nenhum' + variante com tamanho: o formato manda, vinculo vale",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [{ tamanho: "M" }] },
    linhas: [{ grades: GRADE_4, grade_total: 64 }],
    esperado: { efetivo: "40|M", pecas: 16, fator: 0.25, fora: false },
  },
  {
    nome: "vinculo + variante com tamanho so de espacos: vale",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "letra", variantes: [{ tamanho: "  " }, { tamanho: null }] },
    linhas: [{ grades: GRADE_4, grade_total: 64 }],
    esperado: { efetivo: "40|M", pecas: 16, fator: 0.25, fora: false },
  },
  {
    nome: "vinculo + formato null e sem variantes: vale",
    info: { tamanho_vinculado: "38|P", formato_tamanho: null, variantes: [] },
    linhas: [{ grades: GRADE_4, grade_total: 64 }],
    esperado: { efetivo: "38|P", pecas: 16, fator: 0.25, fora: false },
  },
  {
    nome: "total digitado diferente da soma das celulas: o fator usa o total",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: { "40|M": 10, "38|P": 10 }, grade_total: 40 }],
    esperado: { efetivo: "40|M", pecas: 10, fator: 0.25, fora: false },
  },
  {
    nome: "vinculo so de espacos ('  ') = sem vinculo",
    info: { tamanho_vinculado: "  ", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: GRADE_4, grade_total: 64 }],
    esperado: { efetivo: null, pecas: 64, fator: 1, fora: false },
  },
  {
    nome: "vinculo com espacos nas pontas (' 40|M ') = '40|M'",
    info: { tamanho_vinculado: " 40|M ", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: GRADE_4, grade_total: 64 }],
    esperado: { efetivo: "40|M", pecas: 16, fator: 0.25, fora: false },
  },
  {
    nome: "variante com tamanho so de TAB conta como TER tamanho (btrim so tira espaco): efetivo null",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "letra", variantes: [{ tamanho: "\t" }] },
    linhas: [{ grades: GRADE_4, grade_total: 64 }],
    esperado: { efetivo: null, pecas: 64, fator: 1, fora: false },
  },
  {
    nome: "celulas somam MAIS que grade_total: fator sem clamp (30/10 = 3)",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: { "40|M": 30, "38|P": 10 }, grade_total: 10 }],
    esperado: { efetivo: "40|M", pecas: 30, fator: 3, fora: false },
  },
  {
    nome: "grade_total 0 com celulas > 0: pecas = celula, fator 1, nao e fora",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: { "40|M": 10 }, grade_total: 0 }],
    esperado: { efetivo: "40|M", pecas: 10, fator: 1, fora: false },
  },
  {
    nome: "fracao nao terminante (16/48 = 1/3)",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: { "40|M": 16, "38|P": 32 }, grade_total: 48 }],
    esperado: { efetivo: "40|M", pecas: 16, fator: 1 / 3, fora: false },
    fatorAproximado: true,
  },
  {
    nome: "vinculo 'constructor' sem essa chave na grade: nao herda do prototipo (pecas 0, fora)",
    info: { tamanho_vinculado: "constructor", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: { "40|M": 10 }, grade_total: 10 }],
    esperado: { efetivo: "constructor", pecas: 0, fator: 0, fora: true },
  },
  {
    nome: "chave 'constructor' existente na grade e vinculada: soma normal",
    info: { tamanho_vinculado: "constructor", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: { constructor: 4, "40|M": 6 }, grade_total: 10 }],
    esperado: { efetivo: "constructor", pecas: 4, fator: 0.4, fora: false },
  },
  {
    nome: "celula numerica (string 07 e valida = 7) em 40|M",
    info: { tamanho_vinculado: "40|M", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: GRADE_CANTOS, grade_total: 20 }],
    esperado: { efetivo: "40|M", pecas: 7, fator: 0.35, fora: false },
  },
  {
    nome: "celula numerica (string .5 e invalida) em 38|P",
    info: { tamanho_vinculado: "38|P", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: GRADE_CANTOS, grade_total: 20 }],
    esperado: { efetivo: "38|P", pecas: 0, fator: 0, fora: true },
  },
  {
    nome: "celula numerica (string 1,5 e invalida) em 36|PP",
    info: { tamanho_vinculado: "36|PP", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: GRADE_CANTOS, grade_total: 20 }],
    esperado: { efetivo: "36|PP", pecas: 0, fator: 0, fora: true },
  },
  {
    nome: "celula numerica (numero JSON 7.5 e valido) em 42|G",
    info: { tamanho_vinculado: "42|G", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: GRADE_CANTOS, grade_total: 20 }],
    esperado: { efetivo: "42|G", pecas: 7.5, fator: 0.375, fora: false },
  },
  {
    nome: "celula numerica (string 0 e valida mas sem pecas: fora) em 44|GG",
    info: { tamanho_vinculado: "44|GG", formato_tamanho: "nenhum", variantes: [] },
    linhas: [{ grades: GRADE_CANTOS, grade_total: 20 }],
    esperado: { efetivo: "44|GG", pecas: 0, fator: 0, fora: true },
  },
];
