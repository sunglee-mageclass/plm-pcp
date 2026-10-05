// urg R2 (T11 + T12) - os DOIS normalizadores da lista "Insumos padrao" da loja, num lugar so (ao lado de `insumos-padrao.ts`):
//  - `normalizarInsumosPadrao` (Config da Loja, T11): leitura tolerante que MANTEM ids desconhecidos (a tela mostra "Insumo
//    removido" e a pessoa remove). Reexportada de `insumos-padrao.ts` (a implementacao mora la).
//  - `normalizarInsumosPadraoParaCard` (T12): a leitura que CRIA CARD ("+ Novo" e "Criar varios cards"). Espelha EXATAMENTE o helper
//    SQL `public._insumos_padrao_aplicar` (migration 20261103175000) - a mesma regra roda la quando o SERVIDOR cria o card (Plan.
//    Tecido "Criar card(s)" e Importar dados). Anti-drift: `CASOS_APLICAR` em tests/fixtures/insumos-padrao-casos.ts (TS agora; o
//    teste SQL do helper roda a mesma fixture). Puro (sem React/Supabase). Nunca lanca.
import type { InsumoPadrao } from "./insumos-padrao";
export { normalizarInsumosPadrao } from "./insumos-padrao";
export type InsumoPadraoLinhaCard = InsumoPadrao;

/** = limite do editor de insumos do card e da RPC `salvar_insumos_iniciais` (e da lista da Config). */
export const LIMITE_INSUMOS_INICIAIS = 20;
/** o helper SQL le no maximo 200 itens crus (lista gigante gravada por UPDATE direto nao pesa em toda criacao de card). */
export const LIMITE_ITENS_CRUS_LISTA_PADRAO = 200;

const UUID = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;
const ehObjeto = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** Numero finito com no maximo `casas` casas decimais (conta o VALOR, nao a grafia: 1.10 vale). */
export function temNoMaximoCasas(n: number, casas: number): boolean {
  return Number(n.toFixed(casas)) === n;
}

/**
 * Lista CRUA da loja -> linhas do card (ver o cabecalho e `CASOS_APLICAR`). Ordem do laco SQL: para ao juntar 20 linhas; item nao
 * objeto / etiqueta_id nao-uuid => pula; uuid fora do catalogo => ORFAO (pula e conta); consumo fora de 0..9999 ou com > 4 casas =>
 * pula; cor que nao e texto uuid presente nas variantes do insumo => SEM cor (o item fica); repetido (insumo, cor JA RESOLVIDA) =>
 * fica o 1o. `catalogo`: insumo da loja -> suas variantes (qualquer objeto com `variantes[].cor_id`).
 */
export function normalizarInsumosPadraoParaCard(
  raw: unknown,
  catalogo: Record<string, { variantes: { cor_id: string | null }[] }>,
): { linhas: InsumoPadrao[]; orfaos: number } {
  if (!Array.isArray(raw)) return { linhas: [], orfaos: 0 };
  const linhas: InsumoPadrao[] = [];
  const vistos = new Set<string>();
  let orfaos = 0;
  for (const it of raw.slice(0, LIMITE_ITENS_CRUS_LISTA_PADRAO)) {
    if (linhas.length >= LIMITE_INSUMOS_INICIAIS) break;
    if (!ehObjeto(it)) continue;
    if (typeof it.etiqueta_id !== "string" || !UUID.test(it.etiqueta_id)) continue;
    const eid = it.etiqueta_id.toLowerCase();
    const etq = catalogo[eid];
    if (!etq) {
      orfaos += 1;
      continue;
    }
    const q = it.consumo;
    if (
      typeof q !== "number" ||
      !Number.isFinite(q) ||
      q < 0 ||
      q > 9999 ||
      !temNoMaximoCasas(q, 4)
    )
      continue;
    let cor: string | null = null;
    if (typeof it.cor_id === "string" && UUID.test(it.cor_id)) {
      const c = it.cor_id.toLowerCase();
      if ((etq.variantes ?? []).some((v) => (v.cor_id ?? "").toLowerCase() === c)) cor = c;
    }
    const chave = `${eid}|${cor ?? ""}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    linhas.push({ etiqueta_id: eid, cor_id: cor, consumo: q });
  }
  return { linhas, orfaos };
}
