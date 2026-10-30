/**
 * R13 — fixtures anti-drift do pedido em lote (OC por fornecedor com VARIOS produtos).
 *
 *  - SIGLA do lote: espelho TS (`previewSiglaOcLote`) ⇄ SQL `_oc_lote_sigla(_empresa, _itens jsonb)`. Regra:
 *      fornecedor `norm3(nome_fantasia)` (ou 'FOR') + ( 'ACE' se TODOS acessorios | G1+C2 se todos mesmo grupo E mesma
 *      categoria | 'DIV' ). Com 1 item reproduz `previewNumeroOc` (fn_oc_p_acabado_numero). Testado no urg-r13-pedido.
 *  - MOTIVOS: os codigos que o SQL `_oc_produto_motivos('pa'|'pi', _produto)` emite sao um SUBCONJUNTO dos de
 *      `motivosForaDoPedido` (src/lib/pedido-oc-lote.ts) — o servidor confere so o que depende do DADO salvo (sem conflito
 *      de edicao nem validacao da familia, que sao do card). Este mapa fixa a correspondencia de codigos SQL -> TS.
 *
 * O teste de integracao (urg-r13-oc-itens / urg-r13-pedido) semeia produtos e compara o SQL com estes casos.
 */
import { ehGrupoAcessorio, norm3 } from "@/lib/produto-acabado";

// ───────────────────────── sigla do lote (espelho de _oc_lote_sigla) ─────────────────────────
export type ItemSigla = { grupoNome: string | null; categoriaNome: string | null; acessorio: boolean };

/** Espelho puro TS de `_oc_lote_sigla`. `fornecedorNome` = nome_fantasia da empresa; itens = os produtos da OC. */
export function previewSiglaOcLote(fornecedorNome: string | null, itens: readonly ItemSigla[]): string {
  let sig = norm3(fornecedorNome);
  if (sig === "") sig = "FOR";
  if (itens.length === 0) return sig + "DIV";
  if (itens.every((i) => i.acessorio)) return sig + "ACE";
  const g0 = itens[0].grupoNome ?? "";
  const c0 = itens[0].categoriaNome ?? "";
  const mesmoG = itens.every((i) => (i.grupoNome ?? "") === g0);
  const mesmoC = itens.every((i) => (i.categoriaNome ?? "") === c0);
  if (mesmoG && mesmoC) return sig + norm3(g0).slice(0, 1) + norm3(c0).slice(0, 2);
  return sig + "DIV";
}

export type CasoSigla = {
  nome: string;
  fornecedor: string | null;
  itens: ItemSigla[];
  esperado: string; // sufixo apos o fornecedor: 'ACE' | 'DIV' | '<G1><C2>'
};

// Siglas de fornecedor (3 letras, sem acento, maiusculo) usadas nos casos abaixo.
const FORN = "Beltrano Confeccoes"; // norm3 -> 'BEL'

export const CASOS_SIGLA: CasoSigla[] = [
  {
    nome: "todos acessorios -> ACE",
    fornecedor: FORN,
    itens: [
      { grupoNome: "Acessorios", categoriaNome: "Cinto", acessorio: true },
      { grupoNome: "Acessorios", categoriaNome: "Bolsa", acessorio: true },
    ],
    esperado: "BELACE",
  },
  {
    nome: "mesmo grupo e categoria -> G1+C2",
    fornecedor: FORN,
    itens: [
      { grupoNome: "Vestuario", categoriaNome: "Vestido", acessorio: false },
      { grupoNome: "Vestuario", categoriaNome: "Vestido", acessorio: false },
    ],
    esperado: "BELVVE",
  },
  {
    nome: "grupos/categorias diferentes -> DIV",
    fornecedor: FORN,
    itens: [
      { grupoNome: "Vestuario", categoriaNome: "Vestido", acessorio: false },
      { grupoNome: "Vestuario", categoriaNome: "Saia", acessorio: false },
    ],
    esperado: "BELDIV",
  },
  {
    nome: "1 item nao acessorio -> G1+C2 (igual ao previewNumeroOc)",
    fornecedor: FORN,
    itens: [{ grupoNome: "Vestuario", categoriaNome: "Blusa", acessorio: false }],
    esperado: "BELVBL",
  },
  {
    nome: "fornecedor sem letra -> FOR",
    fornecedor: "123",
    itens: [{ grupoNome: "Vestuario", categoriaNome: "Vestido", acessorio: false }],
    esperado: "FORVVE",
  },
  {
    nome: "mistura acessorio + nao-acessorio -> DIV (nem todos acessorios)",
    fornecedor: FORN,
    itens: [
      { grupoNome: "Acessorios", categoriaNome: "Cinto", acessorio: true },
      { grupoNome: "Vestuario", categoriaNome: "Vestido", acessorio: false },
    ],
    esperado: "BELDIV",
  },
];

// Sanidade dos espelhos: cada caso TS bate com o esperado (o SQL e conferido no teste de integracao).
export function conferirCasosSiglaTS(): { ok: boolean; falhas: string[] } {
  const falhas: string[] = [];
  for (const c of CASOS_SIGLA) {
    const got = previewSiglaOcLote(c.fornecedor, c.itens);
    if (got !== c.esperado) falhas.push(`${c.nome}: TS=${got} esperado=${c.esperado}`);
    // coerencia: o flag acessorio dos casos bate com ehGrupoAcessorio(nome)
    for (const i of c.itens) {
      if (ehGrupoAcessorio(i.grupoNome) !== i.acessorio) falhas.push(`${c.nome}: ehGrupoAcessorio(${i.grupoNome}) != ${i.acessorio}`);
    }
  }
  return { ok: falhas.length === 0, falhas };
}

// ───────────────────────── motivos (codigos SQL ⊆ TS) ─────────────────────────
/** Codigos que o SQL `_oc_produto_motivos` emite (ordem fixa) e o codigo TS de `motivosForaDoPedido` correspondente. */
export const MOTIVOS_SQL_PARA_TS: { sql: string; ts: string }[] = [
  { sql: "ja_tem_oc", ts: "ja_tem_oc" },
  { sql: "sem_nome", ts: "sem_nome" },
  { sql: "sem_fornecedor", ts: "sem_fornecedor" },
  { sql: "sem_quantidade", ts: "sem_quantidade" },
  { sql: "sem_variante", ts: "sem_variantes" }, // SQL singular, TS plural
  { sql: "soma_variantes", ts: "soma_nao_bate" },
  { sql: "grade_vazia", ts: "grade_vazia" },
  { sql: "sem_valor", ts: "sem_valor" },
];
