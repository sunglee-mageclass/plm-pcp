// Congelar ao EXCLUIR (P-154 A + rulings R1/R2/R3; plano .superpowers/sdd/2026-09-30-preco-anterior/plan.md §2.2).
// Rodam em tests/integration/preco-titulo-versao.test.ts (txn revertida): monta a família na Loja Teste, exclui e dispara o
// gatilho ADIADO (SET CONSTRAINTS ALL IMMEDIATE = o COMMIT), e confere o Preço anterior/Título GRAVADOS nas que sobram.
import { LOJA_CASOS, type LinhaFamilia } from "./versao-anterior-casos";

export type LinhaCongelar = LinhaFamilia & { integravel?: boolean; colecaoOtb?: "X" | "Y" };
export type CasoCongelar = {
  nome: string;
  familia: LinhaCongelar[];
  /** cada item = UM comando de exclusão com essas chaves */
  excluir: string[][];
  /** sql = DELETE como postgres · rls = DELETE ... WHERE id = ANY(...) sob JWT authenticated (o .delete().in(ids) do
   *  Planejamento) · otb = otb_excluir_colecao(coleção X) */
  via: "sql" | "rls" | "otb";
  /** o que fica GRAVADO nas versões que sobram (NULL = continua automático) */
  esperado: Record<string, { preco_anterior: number | null; titulo_pagina: string | null }>;
};

const L = LOJA_CASOS;
const D = (dia: number) => `2026-09-${String(dia).padStart(2, "0")}T12:00:00Z`;
const AUTO = { preco_anterior: null, titulo_pagina: null };

export const CASOS_CONGELAR: readonly CasoCongelar[] = [
  {
    nome: "raiz v1 (200) · v2 (400) · v3 — apaga a v1: v2 congela 200, v3 congela 400; títulos congelam o herdado (≠ o próprio)",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 200, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO BETA", preco_venda: 400, base: "a" },
      { k: "c", versao: 3, created_at: D(3), nome: "VESTIDO GAMA", preco_venda: 500, base: "a" },
    ],
    excluir: [["a"]], via: "sql",
    esperado: {
      b: { preco_anterior: 200, titulo_pagina: `Vestido Alfa | ${L}` },
      c: { preco_anterior: 400, titulo_pagina: `Vestido Alfa | ${L}` },
    },
  },
  {
    nome: "meio: v1 200, v2 400, v3 — apaga a v2: v3 congela 400 (passaria a ver 200); v1 intocada; título igual não congela",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 200, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ALFA", preco_venda: 400, base: "a" },
      { k: "c", versao: 3, created_at: D(3), nome: "VESTIDO ALFA", preco_venda: 500, base: "a" },
    ],
    excluir: [["b"]], via: "sql",
    esperado: { a: AUTO, c: { preco_anterior: 400, titulo_pagina: null } },
  },
  {
    nome: "topo: apaga a v3 — nada muda",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 200, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ALFA", preco_venda: 400, base: "a" },
      { k: "c", versao: 3, created_at: D(3), nome: "VESTIDO ALFA", preco_venda: 500, base: "a" },
    ],
    excluir: [["c"]], via: "sql",
    esperado: { a: AUTO, b: AUTO },
  },
  {
    nome: "v2 com Preço anterior/Título digitados, v3 auto — apaga a v2: v3 congela o preço de VENDA da v2 e o título dela",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 200, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ALFA", preco_venda: 400, base: "a", preco_anterior: 350, titulo_pagina: "Titulo da V2" },
      { k: "c", versao: 3, created_at: D(3), nome: "VESTIDO ALFA", preco_venda: 500, base: "a" },
    ],
    excluir: [["b"]], via: "sql",
    esperado: { a: AUTO, c: { preco_anterior: 400, titulo_pagina: "Titulo da V2" } },
  },
  {
    nome: "v1 sem preço (v2 aguardando) — apaga a v1: nada a congelar (P-158: o antes era NULL)",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: null, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ALFA", preco_venda: 300, base: "a" },
    ],
    excluir: [["a"]], via: "sql",
    esperado: { b: AUTO },
  },
  {
    nome: "antes = depois (v1 e v2 com o mesmo preço e nome) — apaga a v1: continua automático",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 300, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ALFA", preco_venda: 300, base: "a" },
    ],
    excluir: [["a"]], via: "sql",
    esperado: { b: AUTO },
  },
  {
    nome: "a versão que sobra está Integrável — não congela (R2) e a exclusão não recebe 42501",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 200, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO BETA", preco_venda: 400, base: "a", integravel: true },
    ],
    excluir: [["a"]], via: "sql",
    esperado: { b: AUTO },
  },
  {
    nome: "v1+v2 no MESMO comando sob RLS (.delete().in(ids)) — sem 'already modified'; v3 congela o da v2 de ANTES",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 200, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ALFA", preco_venda: 400, base: "a", titulo_pagina: "Titulo da V2" },
      { k: "c", versao: 3, created_at: D(3), nome: "VESTIDO GAMA", preco_venda: 500, base: "a" },
    ],
    excluir: [["a", "b"]], via: "rls",
    esperado: { c: { preco_anterior: 400, titulo_pagina: "Titulo da V2" } },
  },
  {
    nome: "otb_excluir_colecao com a família em 2 coleções — a da outra coleção congela",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 200, base: null, colecaoOtb: "X" },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO BETA", preco_venda: 400, base: "a", colecaoOtb: "Y" },
    ],
    excluir: [["a"]], via: "otb",
    esperado: { b: { preco_anterior: 200, titulo_pagina: `Vestido Alfa | ${L}` } },
  },
  {
    nome: "família inteira apagada — nada (pula as que sumiram), sem erro",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 200, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO BETA", preco_venda: 400, base: "a" },
    ],
    excluir: [["a", "b"]], via: "sql",
    esperado: {},
  },
  {
    nome: "loja B (modelo de outra loja apontando para a raiz) — não é anotada nem tocada",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 200, base: null },
      { k: "x", versao: 2, created_at: D(2), nome: "VESTIDO ALHEIO", preco_venda: 400, base: "a", outraLoja: true },
    ],
    excluir: [["a"]], via: "sql",
    esperado: { x: AUTO },
  },
];
