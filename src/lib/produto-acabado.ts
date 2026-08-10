// Helpers puros do módulo Produto Acabado / Revenda.
//
// Espelham lógica que TAMBÉM existe no banco (migrations 20260807140000/150000/170000)
// — mantidos aqui pra o front poder mostrar PREVIEWS (ex.: sigla de REF/nº de OC antes
// de salvar) sem round-trip ao servidor. Regras espelhadas de:
//   - `_norm3(text)` / `_grupo_eh_acessorio(uuid)` (normalização de sigla)
//   - `_split_maior_resto(int, jsonb)` (método do maior resto / Hamilton)
//   - `fn_produto_acabado_ref()` / `fn_oc_p_acabado_numero()` (siglas de REF/nº OC)
//   - `salvar_oc_p_acabado` (cadeia de valores bruto → desconto → unitário real)
// O NÚMERO sequencial (contador por tenant) sempre vem do banco — as funções de
// preview aqui devolvem só a SIGLA.

const DIACRITICOS = /[\u0300-\u036f]/g;

/** Normaliza: remove acento, mantém só letras A-Z, maiúsculo, 3 primeiras — espelha
 *  o helper SQL `_norm3(text)` (translate + regexp_replace + substr + upper). */
function norm3(s: string | null | undefined): string {
  const semAcento = (s ?? "").normalize("NFD").replace(DIACRITICOS, "");
  const soLetras = semAcento.replace(/[^A-Za-z]/g, "");
  return soLetras.slice(0, 3).toUpperCase();
}

/** true se o nome do grupo indica "acessório" (grade única, REF/nº-OC no formato de
 *  acessório) — mesma normalização (sem acento, minúsculo) + substring de `_grupo_eh_acessorio`. */
export function ehGrupoAcessorio(nomeGrupo: string | null | undefined): boolean {
  const norm = (nomeGrupo ?? "").normalize("NFD").replace(DIACRITICOS, "").toLowerCase();
  return norm.includes("acessor");
}

/**
 * Método do maior resto (Hamilton) — espelha `_split_maior_resto(_total int, _pesos jsonb)`.
 *
 * Caso degenerado (Σ dos pesos POSITIVOS = 0 — todos os pesos são 0 ou negativos):
 * TODAS as chaves passam a valer peso 1 (split igualitário por maior resto), o que
 * preserva Σ resultado = total. Caso normal (Σ > 0): pesos originais mantidos —
 * chave com peso ≤ 0 entre pesos positivos continua recebendo 0. Desempate do maior
 * resto: fração desc, depois chave asc (mesma ordem do `row_number() over (order by
 * frac desc, key asc)` do banco).
 */
export function splitMaiorResto(total: number, pesos: Record<string, number>): Record<string, number> {
  const chaves = Object.keys(pesos);
  if (chaves.length === 0) return {};

  const somaPositiva = chaves.reduce((s, k) => s + (pesos[k] > 0 ? pesos[k] : 0), 0);
  const pesosEfetivos: Record<string, number> = {};
  for (const k of chaves) pesosEfetivos[k] = somaPositiva > 0 ? pesos[k] : 1;

  const somaEfetiva = chaves.reduce((s, k) => s + (pesosEfetivos[k] > 0 ? pesosEfetivos[k] : 0), 0);

  const base: Record<string, number> = {};
  const frac: Record<string, number> = {};
  let somaBase = 0;
  for (const k of chaves) {
    const p = pesosEfetivos[k];
    if (somaEfetiva > 0 && p > 0) {
      const exato = (total * p) / somaEfetiva;
      const b = Math.floor(exato);
      base[k] = b;
      frac[k] = exato - b;
    } else {
      base[k] = 0;
      frac[k] = 0;
    }
    somaBase += base[k];
  }
  const resto = total - somaBase;

  const ranqueado = [...chaves].sort((a, b) => {
    if (frac[b] !== frac[a]) return frac[b] - frac[a]; // maior fração primeiro
    return a < b ? -1 : a > b ? 1 : 0; // desempate: chave asc
  });

  const resultado: Record<string, number> = {};
  ranqueado.forEach((k, idx) => {
    resultado[k] = base[k] + (idx < resto ? 1 : 0);
  });
  return resultado;
}

/**
 * Cadeia de valores de compra: bruto → total com desconto → unitário real.
 * Espelha os derivados de `ocs_p_acabado` (`salvar_oc_p_acabado`):
 *   bruto = qtd × valorUnit
 *   totalDesc = bruto × (1 − descontoPct/100)
 *   unitReal = totalDesc / qtd (0 se qtd ≤ 0)
 */
export function cadeiaValores(
  qtd: number,
  valorUnit: number,
  descontoPct: number,
): { bruto: number; totalDesc: number; unitReal: number } {
  const arred = (v: number) => Math.round(v * 100) / 100;
  const bruto = arred(qtd * valorUnit);
  const totalDesc = arred(bruto * (1 - descontoPct / 100));
  const unitReal = qtd > 0 ? arred(totalDesc / qtd) : 0;
  return { bruto, totalDesc, unitReal };
}

/**
 * Preview da SIGLA da REF do produto — o número sequencial vem do banco
 * (`_produto_acabado_ref_next`). Espelha `fn_produto_acabado_ref()`:
 *   não-acessório: 2 letras do grupo + 1 da categoria + 2 da subcategoria1
 *   acessório:     2 letras do grupo + 3 da categoria
 */
export function previewRefProduto(grupo: string, categoria: string, sub1: string | null, acessorio: boolean): string {
  if (acessorio) {
    return norm3(grupo).slice(0, 2) + norm3(categoria);
  }
  return norm3(grupo).slice(0, 2) + norm3(categoria).slice(0, 1) + norm3(sub1).slice(0, 2);
}

/**
 * Preview da SIGLA do número da OC — o contador sequencial + '-' vem do banco
 * (`fn_oc_p_acabado_numero`). Fornecedor sem letra alfabética alguma → 'FOR'.
 * Espelha o trigger: 3 letras do fornecedor + (1 grupo + 2 categoria | 'ACE').
 */
export function previewNumeroOc(fornecedor: string, grupo: string, categoria: string, acessorio: boolean): string {
  let sig = norm3(fornecedor);
  if (sig === "") sig = "FOR";
  if (acessorio) return sig + "ACE";
  return sig + norm3(grupo).slice(0, 1) + norm3(categoria).slice(0, 2);
}
