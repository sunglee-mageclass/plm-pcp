// Preço anterior e Título por VERSÃO (P-146..P-159; plano .superpowers/sdd/2026-09-30-preco-anterior/plan.md §1.5).
// Anti-drift: estes casos rodam nos DOIS lados —
//   • tests/unit/versao-anterior.test.ts (TS — src/lib/versao-anterior.ts): a partir da linha esperada do HELPER (null = sem
//     anterior), confere a composição TS (preço anterior / título automáticos);
//   • tests/integration/preco-titulo-versao.test.ts (SQL): monta a família na Loja Teste (txn revertida) e confere
//     public._modelo_versao_anterior, public._modelo_automaticos e o preco_anterior/título do RETRATO vivo.
// Mudou a regra? Mude o SQL (migration nova), o TS e estes casos.
export const LOJA_CASOS = "Loja Teste"; // = tenants.nome da Loja Teste (a integração confere/ajusta dentro da txn)

export type LinhaFamilia = {
  k: string; // chave simbólica (vira uuid na integração)
  versao: number;
  created_at: string; // ISO — controla o desempate de versões iguais
  nome: string;
  preco_venda: number | null;
  preco_anterior?: number | null;
  titulo_pagina?: string | null;
  base: string | null; // chave da raiz (modelo_base_id); null = raiz/órfã
  outraLoja?: boolean; // criada em OUTRA loja
  colecao?: string;
  origem?: "interno" | "revenda";
};
export type HelperEsperado = {
  anterior: string; // chave
  anterior_versao: number;
  anterior_preco: number | null;
  titulo_herdado: string | null;
  titulo_origem_versao: number | null;
} | null;
export type ComposicaoEsperada = {
  preco_auto: number | null;
  preco_fonte: "anterior" | "proprio";
  preco_versao: number | null;
  titulo_auto: string | null;
  titulo_fonte: "herdado" | "proprio";
  titulo_versao: number | null;
};
export type TsEsperado = {
  preco: { valor: number | null; fonte: "anterior" | "proprio"; versao: number | null; aguardando: boolean };
  titulo: { valor: string; fonte: "herdado" | "proprio"; versao: number | null; origemVersao: number | null };
};
/** O que o retrato vivo manda (campos preco_anterior + titulo marcados): texto do _integracao_num / título efetivo. */
export type RetratoEsperado = { preco_anterior: string | null; titulo: string | null; faltaPrecoAnterior: boolean };
export type CasoVersao = {
  nome: string;
  familia: LinhaFamilia[];
  alvo: string;
  helper: HelperEsperado;
  composicao: ComposicaoEsperada;
  ts: TsEsperado;
  retrato: RetratoEsperado;
};

const D = (dia: number) => `2026-09-${String(dia).padStart(2, "0")}T12:00:00Z`;
const L = LOJA_CASOS;
const semAnt = (preco: number | null, titulo: string): Pick<CasoVersao, "helper" | "composicao" | "ts"> => ({
  helper: null,
  composicao: { preco_auto: preco, preco_fonte: "proprio", preco_versao: null, titulo_auto: titulo || null, titulo_fonte: "proprio", titulo_versao: null },
  ts: {
    preco: { valor: preco != null && preco > 0 ? preco : null, fonte: "proprio", versao: null, aguardando: !(preco != null && preco > 0) },
    titulo: { valor: titulo, fonte: "proprio", versao: null, origemVersao: null },
  },
});
const comAnt = (
  anterior: string, versao: number, preco: number | null, titulo: string | null, origem: number | null,
): Pick<CasoVersao, "helper" | "composicao" | "ts"> => ({
  helper: { anterior, anterior_versao: versao, anterior_preco: preco, titulo_herdado: titulo, titulo_origem_versao: origem },
  composicao: { preco_auto: preco, preco_fonte: "anterior", preco_versao: versao, titulo_auto: titulo, titulo_fonte: "herdado", titulo_versao: versao },
  ts: {
    preco: { valor: preco, fonte: "anterior", versao, aguardando: preco === null },
    titulo: { valor: titulo ?? "", fonte: "herdado", versao, origemVersao: origem },
  },
});
const num = (v: number | null): string | null => (v != null && v > 0 ? v.toFixed(2) : null);
const ret = (preco: number | null, titulo: string | null): RetratoEsperado => ({
  preco_anterior: num(preco), titulo, faltaPrecoAnterior: num(preco) === null,
});

export const CASOS_VERSAO: readonly CasoVersao[] = [
  {
    nome: "1. v1 só — o próprio preço e o título do próprio Nome (P-147)",
    familia: [{ k: "a", versao: 1, created_at: D(1), nome: "BLUSA UM", preco_venda: 150, base: null }],
    alvo: "a", ...semAnt(150, `Blusa Um | ${L}`), retrato: ret(150, `Blusa Um | ${L}`),
  },
  {
    nome: "2. v2 com a v1 com preço — acompanha o preço da v1 (P-146)",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 200, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ALFA", preco_venda: 250, base: "a" },
    ],
    alvo: "b", ...comAnt("a", 1, 200, `Vestido Alfa | ${L}`, 1), retrato: ret(200, `Vestido Alfa | ${L}`),
  },
  {
    nome: "3. v2 com a v1 SEM preço — VAZIO/aguardando (P-158) e falta na Integração (P-159 A)",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: null, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ALFA", preco_venda: 300, base: "a" },
    ],
    alvo: "b", ...comAnt("a", 1, null, `Vestido Alfa | ${L}`, 1), retrato: ret(null, `Vestido Alfa | ${L}`),
  },
  {
    nome: "4. v2 com a v1 com preco_venda = 0 — VAZIO",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 0, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ALFA", preco_venda: 300, base: "a" },
    ],
    alvo: "b", ...comAnt("a", 1, null, `Vestido Alfa | ${L}`, 1), retrato: ret(null, `Vestido Alfa | ${L}`),
  },
  {
    nome: "5. buraco (v1, v3) — a v3 segue a v1",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "SAIA BETA", preco_venda: 180, base: null },
      { k: "c", versao: 3, created_at: D(3), nome: "SAIA BETA", preco_venda: 220, base: "a" },
    ],
    alvo: "c", ...comAnt("a", 1, 180, `Saia Beta | ${L}`, 1), retrato: ret(180, `Saia Beta | ${L}`),
  },
  {
    nome: "6. empate (duas v2) — vence a created_at mais nova",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "CALCA GAMA", preco_venda: 100, base: null },
      { k: "b1", versao: 2, created_at: D(2), nome: "CALCA GAMA", preco_venda: 110, base: "a" },
      { k: "b2", versao: 2, created_at: D(3), nome: "CALCA GAMA", preco_venda: 120, base: "a" },
      { k: "c", versao: 3, created_at: D(4), nome: "CALCA GAMA", preco_venda: 130, base: "a" },
    ],
    alvo: "c", ...comAnt("b2", 2, 120, `Calca Gama | ${L}`, 1), retrato: ret(120, `Calca Gama | ${L}`),
  },
  {
    nome: "7. número pulado (v2 -> v7)",
    familia: [
      { k: "a", versao: 2, created_at: D(1), nome: "TOP DELTA", preco_venda: 130, base: null },
      { k: "b", versao: 7, created_at: D(2), nome: "TOP DELTA", preco_venda: 140, base: "a" },
    ],
    alvo: "b", ...comAnt("a", 2, 130, `Top Delta | ${L}`, 2), retrato: ret(130, `Top Delta | ${L}`),
  },
  {
    nome: "8. órfã (raiz excluída -> base NULL) — sem anterior",
    familia: [{ k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ORFA", preco_venda: 140, base: null }],
    alvo: "b", ...semAnt(140, `Vestido Orfa | ${L}`), retrato: ret(140, `Vestido Orfa | ${L}`),
  },
  {
    nome: "9. cross-coleção — vale a família",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "BLUSA EPSILON", preco_venda: 160, base: null, colecao: "Inverno" },
      { k: "b", versao: 2, created_at: D(2), nome: "BLUSA EPSILON", preco_venda: 190, base: "a", colecao: "Verão" },
    ],
    alvo: "b", ...comAnt("a", 1, 160, `Blusa Epsilon | ${L}`, 1), retrato: ret(160, `Blusa Epsilon | ${L}`),
  },
  {
    nome: "10. modelo_base_id apontando para OUTRA loja — ignorado (sem anterior)",
    familia: [
      { k: "x", versao: 1, created_at: D(1), nome: "VESTIDO ALHEIO", preco_venda: 999, base: null, outraLoja: true },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ZETA", preco_venda: 170, base: "x" },
    ],
    alvo: "b", ...semAnt(170, `Vestido Zeta | ${L}`), retrato: ret(170, `Vestido Zeta | ${L}`),
  },
  {
    nome: "11. digitado vence (preço e título) — o automático continua o da anterior",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ALFA", preco_venda: 200, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ALFA", preco_venda: 250, base: "a", preco_anterior: 333, titulo_pagina: "Meu Titulo" },
    ],
    alvo: "b", ...comAnt("a", 1, 200, `Vestido Alfa | ${L}`, 1), retrato: ret(333, "Meu Titulo"),
  },
  {
    nome: "12. título recursivo — v1 digitado, v2 e v3 automáticos: a v3 herda o da v1 (origem 1)",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO ETA", preco_venda: 100, base: null, titulo_pagina: "Titulo da V1" },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO ETA", preco_venda: 200, base: "a" },
      { k: "c", versao: 3, created_at: D(3), nome: "VESTIDO ETA", preco_venda: 300, base: "a" },
    ],
    alvo: "c", ...comAnt("b", 2, 200, "Titulo da V1", 1), retrato: ret(200, "Titulo da V1"),
  },
  {
    nome: "13. v1 automático, v2 digitado, v3 automático — a v3 herda o da v2",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO TETA", preco_venda: 100, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO TETA", preco_venda: 200, base: "a", titulo_pagina: "Titulo da V2" },
      { k: "c", versao: 3, created_at: D(3), nome: "VESTIDO TETA", preco_venda: 300, base: "a" },
    ],
    alvo: "c", ...comAnt("b", 2, 200, "Titulo da V2", 2), retrato: ret(200, "Titulo da V2"),
  },
  {
    nome: "14. nenhum digitado — o calculado do NOME da v1 (família com nomes diferentes, F3)",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "OPVL1540 - VESTIDO GARDENIA", preco_venda: 598, base: null },
      { k: "b", versao: 2, created_at: D(2), nome: "OPVL1542 - VESTIDO ANDREIA", preco_venda: 498, base: "a" },
    ],
    alvo: "b", ...comAnt("a", 1, 598, `Opvl1540 - Vestido Gardenia | ${L}`, 1), retrato: ret(598, `Opvl1540 - Vestido Gardenia | ${L}`),
  },
  {
    nome: "15. título só com espaços = automático (na cadeia e no próprio card)",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "VESTIDO IOTA", preco_venda: 100, base: null, titulo_pagina: "Titulo V1" },
      { k: "b", versao: 2, created_at: D(2), nome: "VESTIDO IOTA", preco_venda: 200, base: "a", titulo_pagina: "   " },
      { k: "c", versao: 3, created_at: D(3), nome: "VESTIDO IOTA", preco_venda: 300, base: "a", titulo_pagina: "  " },
    ],
    alvo: "c", ...comAnt("b", 2, 200, "Titulo V1", 1), retrato: ret(200, "Titulo V1"),
  },
  {
    nome: "16. revenda (preco_venda gravado pelo recompute)",
    familia: [
      { k: "a", versao: 1, created_at: D(1), nome: "BOLSA KAPA", preco_venda: 89.9, base: null, origem: "revenda" },
      { k: "b", versao: 2, created_at: D(2), nome: "BOLSA KAPA", preco_venda: 99.9, base: "a", origem: "revenda" },
    ],
    alvo: "b", ...comAnt("a", 1, 89.9, `Bolsa Kapa | ${L}`, 1), retrato: ret(89.9, `Bolsa Kapa | ${L}`),
  },
  {
    nome: "17. v1 SEM preço de venda — vazio/'aguardando preço de venda' (M4) e falta na Integração",
    familia: [{ k: "a", versao: 1, created_at: D(1), nome: "BLUSA LAMBDA", preco_venda: null, base: null }],
    alvo: "a", ...semAnt(null, `Blusa Lambda | ${L}`), retrato: ret(null, `Blusa Lambda | ${L}`),
  },
];
