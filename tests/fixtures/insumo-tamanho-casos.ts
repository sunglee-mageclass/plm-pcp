// Casos COMPARTILHADOS do anti-drift "insumo vinculado a UM tamanho" (urg R1):
//   tests/unit/insumo-tamanho.test.ts          -> src/lib/insumo-tamanho.ts (TS)
//   tests/integration/... (T2, SQL, so na copia) -> public._estoque_etiqueta_core (ce_sem)
// Sem import de codigo do app (o teste SQL importa so este arquivo). Toda entrada e serializavel em JSON.
// Mudou a regra? Mude TS, SQL e AQUI.

export type CasoInsumoTamanho = {
  nome: string;
  info: {
    tamanho_vinculado: string | null;
    formato_tamanho: string | null;
    variantes: { tamanho: string | null }[];
  };
  linhas: { grades: Record<string, unknown> | null; grade_total: number | null }[];
  esperado: { efetivo: string | null; pecas: number; fator: number; fora: boolean };
};

const GRADE_4 = { "40|M": 16, "38|P": 16, "36|PP": 16, "42|G": 16 };

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
    nome: "2 variantes somando o mesmo tamanho (8+8)",
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
];
