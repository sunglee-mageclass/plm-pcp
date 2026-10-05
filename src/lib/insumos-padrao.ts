/**
 * Lista "Insumos padrao" da loja (urg R2, T11) - modulo PURO (zero React, zero Supabase).
 *
 * `tenant_config.insumos_padrao` e gravada SO por `salvar_config_loja` (compare-and-set por coluna). Este arquivo e o
 * ESPELHO TS da validacao/normalizacao da RPC (migration 20261103174000). A regra e fixada pela fixture compartilhada
 * `tests/fixtures/insumos-padrao-casos.ts` (o teste SQL e o teste TS leem os mesmos casos). Mudou a regra? Mude SQL, TS e a fixture.
 *
 *  - lista = ARRAY (outra coisa = recusa); no maximo 20 itens (= limite do editor de insumos do card), conferido ANTES dos itens;
 *  - item = objeto {etiqueta_id: uuid, cor_id: ausente|null|""|uuid, consumo: NUMERO 0..9999, ate 4 casas decimais};
 *  - itens conferidos na ordem, a 1a falha decide; par (insumo, cor) repetido = recusa no 2o (comparado ja normalizado);
 *  - normalizado = [{etiqueta_id, cor_id, consumo}] na mesma ordem, uuid minusculo, cor vazia = null.
 *
 * Duas funcoes de normalizacao com papeis diferentes:
 *  - `validarInsumosPadrao` (ESTRITA, = RPC): devolve a lista normalizada ou o motivo da recusa;
 *  - `normalizarInsumosPadrao` (TOLERANTE): o que a TELA le do servidor / serializa no payload. NUNCA lanca e nunca derruba a
 *    tela: nao-lista vira []; item que nao e objeto sai; id desconhecido fica (a tela mostra "Insumo removido" e a pessoa remove).
 *    Para entradas validas as duas dao o MESMO resultado.
 */

export type InsumoPadrao = { etiqueta_id: string; cor_id: string | null; consumo: number };

export const LIMITE_INSUMOS_PADRAO = 20;
export const CONSUMO_MAX_INSUMO_PADRAO = 9999;
export const CASAS_CONSUMO_INSUMO_PADRAO = 4;
export const PREFIXO_ERRO_INSUMOS_PADRAO = "Lista de insumos padrão inválida: ";

const UUID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** uuid no formato canonico -> minusculo; qualquer outro texto fica como veio. */
const canonicoSeUuid = (s: string): string => (UUID_RE.test(s) ? s.toLowerCase() : s);

/** `n` tem no maximo 4 casas decimais? (conta o VALOR: 1.10 vale). */
function ateQuatroCasas(n: number): boolean {
  return Number(n.toFixed(CASAS_CONSUMO_INSUMO_PADRAO)) === n;
}

/** Leitura TOLERANTE (ver cabecalho). Nunca lanca. */
export function normalizarInsumosPadrao(v: unknown): InsumoPadrao[] {
  if (!Array.isArray(v)) return [];
  const out: InsumoPadrao[] = [];
  for (const it of v) {
    if (!ehObjeto(it)) continue;
    const e = typeof it.etiqueta_id === "string" ? canonicoSeUuid(it.etiqueta_id) : "";
    const c = typeof it.cor_id === "string" && it.cor_id !== "" ? canonicoSeUuid(it.cor_id) : null;
    let q = 0;
    if (typeof it.consumo === "number" && Number.isFinite(it.consumo)) q = it.consumo;
    else if (typeof it.consumo === "string" && it.consumo.trim() !== "" && Number.isFinite(Number(it.consumo))) q = Number(it.consumo);
    out.push({ etiqueta_id: e, cor_id: c, consumo: q });
  }
  return out;
}

export type ResultadoValidacaoInsumosPadrao =
  | { ok: true; lista: InsumoPadrao[] }
  /** `motivo` = trecho da mensagem do servidor (depois do prefixo); `mensagem` = a mensagem inteira do servidor. */
  | { ok: false; motivo: string; mensagem: string };

const recusa = (motivo: string): ResultadoValidacaoInsumosPadrao => ({
  ok: false,
  motivo,
  mensagem: PREFIXO_ERRO_INSUMOS_PADRAO + motivo,
});

/**
 * Validacao ESTRITA, espelho da RPC (menos o que so o servidor sabe: o insumo/cor existir em etiquetas/cores DA LOJA - isso a
 * tela confere contra o catalogo em `diagnosticarLinhasInsumosPadrao`). Mesma ordem de conferencia e mesmas mensagens.
 */
export function validarInsumosPadrao(v: unknown): ResultadoValidacaoInsumosPadrao {
  if (!Array.isArray(v)) return recusa("precisa ser uma lista");
  if (v.length > LIMITE_INSUMOS_PADRAO) return recusa(`no máximo ${LIMITE_INSUMOS_PADRAO} insumos (veio ${v.length})`);
  const lista: InsumoPadrao[] = [];
  const pares: string[] = [];
  for (let i = 0; i < v.length; i++) {
    const n = i + 1;
    const it = v[i];
    if (!ehObjeto(it)) return recusa(`item ${n}: formato inválido`);
    const eRaw = it.etiqueta_id;
    if (typeof eRaw !== "string" || !UUID_RE.test(eRaw)) return recusa(`item ${n}: insumo não encontrado nesta loja`);
    const e = eRaw.toLowerCase();
    let c: string | null = null;
    const cRaw = it.cor_id;
    if (typeof cRaw === "string" && cRaw !== "") {
      if (!UUID_RE.test(cRaw)) return recusa(`item ${n}: cor não encontrada nesta loja`);
      c = cRaw.toLowerCase();
    } else if (cRaw !== undefined && cRaw !== null && typeof cRaw !== "string") {
      return recusa(`item ${n}: cor não encontrada nesta loja`);
    }
    const q = it.consumo;
    if (typeof q !== "number" || !Number.isFinite(q) || q < 0 || q > CONSUMO_MAX_INSUMO_PADRAO) {
      return recusa(`item ${n}: consumo precisa ser um número de 0 a ${CONSUMO_MAX_INSUMO_PADRAO}`);
    }
    if (!ateQuatroCasas(q)) return recusa(`item ${n}: consumo com no máximo ${CASAS_CONSUMO_INSUMO_PADRAO} casas decimais`);
    const par = `${e}|${c ?? ""}`;
    const antes = pares.indexOf(par);
    if (antes >= 0) return recusa(`item ${n}: insumo e cor repetidos (já no item ${antes + 1})`);
    pares.push(par);
    lista.push({ etiqueta_id: e, cor_id: c, consumo: q });
  }
  return { ok: true, lista };
}

// ── O que a TELA mostra por linha ─────────────────────────────────────────────────────────────────────────────────────

/** Insumo do cadastro da loja com as cores das suas variantes (catalogo do card). */
export type CatalogoInsumoPadrao = { id: string; nome: string; cores: { id: string; nome: string }[] };

export type ProblemaLinhaInsumoPadrao =
  | "sem_insumo" //        linha nova, insumo ainda nao escolhido
  | "insumo_removido" //   insumo nao existe mais no cadastro (ou id de outra loja / ruim)
  | "cor_removida" //      cor que nao e mais variante do insumo
  | "consumo_invalido" //  fora de 0..9999 ou mais de 4 casas
  | "duplicado"; //        mesmo insumo na mesma cor ja esta numa linha acima

export type DiagnosticoLinhaInsumoPadrao = { insumoNome: string | null; problema: ProblemaLinhaInsumoPadrao | null };

/**
 * Um diagnostico por linha (mesma ordem), contra o catalogo da loja. Prioridade: sem insumo > insumo removido > cor removida >
 * consumo invalido > duplicado. O que o servidor recusaria (orfao, repetido, consumo) aparece aqui para a pessoa corrigir ANTES
 * do Salvar (e, no caso do orfao, poder REMOVER a linha - sem isso a lista nunca mais poderia ser salva).
 */
export function diagnosticarLinhasInsumosPadrao(
  lista: readonly InsumoPadrao[],
  catalogo: readonly CatalogoInsumoPadrao[],
): DiagnosticoLinhaInsumoPadrao[] {
  const porId = new Map(catalogo.map((i) => [i.id, i]));
  const vistos = new Set<string>();
  return lista.map((l) => {
    if (l.etiqueta_id === "") return { insumoNome: null, problema: "sem_insumo" };
    const ins = porId.get(l.etiqueta_id);
    if (!ins) return { insumoNome: null, problema: "insumo_removido" };
    if (l.cor_id !== null && !ins.cores.some((c) => c.id === l.cor_id)) return { insumoNome: ins.nome, problema: "cor_removida" };
    if (!Number.isFinite(l.consumo) || l.consumo < 0 || l.consumo > CONSUMO_MAX_INSUMO_PADRAO || !ateQuatroCasas(l.consumo)) {
      return { insumoNome: ins.nome, problema: "consumo_invalido" };
    }
    const par = `${l.etiqueta_id}|${l.cor_id ?? ""}`;
    if (vistos.has(par)) return { insumoNome: ins.nome, problema: "duplicado" };
    vistos.add(par);
    return { insumoNome: ins.nome, problema: null };
  });
}

/** Texto PT do problema da linha (a tela e o toast do Salvar). */
export const TEXTO_PROBLEMA_INSUMO_PADRAO: Record<ProblemaLinhaInsumoPadrao, string> = {
  sem_insumo: "Escolha o insumo.",
  insumo_removido: "Insumo removido do cadastro — remova esta linha.",
  cor_removida: "Cor removida do insumo — troque a cor ou remova esta linha.",
  consumo_invalido: "Consumo de 0 a 9999, com no máximo 4 casas decimais.",
  duplicado: "Este insumo nesta cor já está na lista.",
};

/** Cor removida de um insumo que ficou SEM nenhuma cor: não há outra cor para escolher. */
export const TEXTO_COR_REMOVIDA_SEM_CORES = 'Cor removida do insumo — volte para "Sem cor" ou remova esta linha.';

/** Máscara do Consumo: corta o texto numérico (ponto decimal, como o NumberInput entrega) em 4 casas decimais. */
export function cortarCasasConsumo(texto: string): string {
  const i = texto.indexOf(".");
  return i < 0 ? texto : texto.slice(0, i + 1 + CASAS_CONSUMO_INSUMO_PADRAO);
}
