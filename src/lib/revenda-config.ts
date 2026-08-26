/**
 * Fluxo de Revenda (ago/2026) — FONTE ÚNICA DE VERDADE (SSOT) dos helpers PUROS de config
 * por-loja para modelos `origem==='revenda'` (ver invariante #13 no CLAUDE.md).
 *
 * Uma loja pode dar a Revenda um kanban/requisitos/campos-visíveis PRÓPRIOS, diferentes do
 * fluxo manufaturado normal. As 3 chaves vivem soltas em `tenant_config` (SEM migração de
 * schema — jsonb-friendly): `revenda_kanban_colunas`, `revenda_kanban_requisitos`,
 * `revenda_campos`.
 *
 * Este arquivo é consumido pelos 4 pontos de leitura (seções do Sheet de Desenvolvimento,
 * campos de "Info Básicas", o gate de `cadMissing` e `podeEntrar` do kanban) — TODOS devem
 * chamar os helpers daqui, nunca reimplementar a lógica (evita drift entre os 4 lugares).
 *
 * Zero React, zero Supabase — só lógica pura sobre o `tenant_config` já carregado.
 */

export type RevendaConfig = {
  /** Keys de colunas do kanban permitidas para revenda. [] = todas permitidas (sem trava). */
  colunas: string[];
  /** Requisitos (keys de `CONDICOES`) por coluna, só para revenda. Ausente = sem requisito (passa livre). */
  requisitos: Record<string, string[]>;
  /** Campo/seção key → visível para revenda. Ausente = default (ver REVENDA_CAMPOS_DEFAULT_OFF). */
  campos: Record<string, boolean>;
};

/**
 * As 12 chaves que nascem DESLIGADAS por padrão para Revenda (9 campos de "Info Básicas" +
 * 3 seções do Sheet que não fazem sentido pra peça comprada pronta — Prova/Ajustes na Prova,
 * seção 2 e a seção 4 "CAD"). Qualquer chave FORA desta lista nasce LIGADA por padrão.
 * "nome"/"s1" nunca entram aqui — são sempre visíveis, incondicionalmente.
 */
export const REVENDA_CAMPOS_DEFAULT_OFF: string[] = [
  "modelista_id",
  "piloteiro1_id",
  "piloteiro2_id",
  "piloteiro3_id",
  "data_piloto1",
  "data_piloto2",
  "data_piloto3",
  "data_desenho_tecnico",
  "data_aprovacao",
  "prova",
  "s2",
  "s-cad",
];

/** As 9 chaves de campo de "Info Básicas" configuráveis (para a UI de config da loja). */
export const REVENDA_CAMPO_KEYS: string[] = [
  "modelista_id",
  "piloteiro1_id",
  "piloteiro2_id",
  "piloteiro3_id",
  "data_piloto1",
  "data_piloto2",
  "data_piloto3",
  "data_desenho_tecnico",
  "data_aprovacao",
];

/** As chaves de seção do Sheet de Desenvolvimento (mesmas de `CondicaoSecao`, para a UI de config). */
export const REVENDA_SECAO_KEYS: string[] = ["s1", "prova", "s2", "s-cad", "s3", "s3e", "s4", "s5", "s6"];

/**
 * Campo/seção `key` aparece para um modelo de revenda? "nome" e "s1" são SEMPRE visíveis
 * (incondicional). Para as demais chaves: override explícito em `cfg.campos[key]` vence;
 * ausência de override usa o default (OFF para os 9+3 de `REVENDA_CAMPOS_DEFAULT_OFF`, ON
 * para qualquer outra chave).
 */
export function revendaCampoVisivel(cfg: RevendaConfig | null | undefined, key: string): boolean {
  if (key === "nome" || key === "s1") return true; // sempre
  const v = cfg?.campos?.[key];
  if (v === undefined) return !REVENDA_CAMPOS_DEFAULT_OFF.includes(key); // default: OFF p/ os 9+3, ON p/ o resto
  return v !== false;
}

/**
 * Coluna do kanban `colKey` é permitida para revenda? `cfg.colunas` vazio/ausente = TODAS
 * permitidas (sem trava por omissão — fallback documentado no plano).
 */
export function revendaColunaPermitida(cfg: RevendaConfig | null | undefined, colKey: string): boolean {
  const cols = cfg?.colunas ?? [];
  return cols.length === 0 || cols.includes(colKey); // [] = todas
}

/** Requisitos (keys de `CONDICOES`) configurados para revenda numa coluna. Ausente = []. */
export function revendaRequisitos(cfg: RevendaConfig | null | undefined, colKey: string): string[] {
  return cfg?.requisitos?.[colKey] ?? [];
}

/**
 * Monta um `RevendaConfig` normalizado a partir do `tenant_config` bruto (jsonb, `as any`
 * no chamador — types.ts ainda não tem as 3 chaves). Parse robusto: tolera `tc` nulo/
 * indefinido e cada uma das 3 chaves faltando, de tipo errado, ou parcialmente presente.
 */
export function lerRevendaConfig(tc: any): RevendaConfig {
  const colunasRaw = tc?.revenda_kanban_colunas;
  const colunas = Array.isArray(colunasRaw) ? colunasRaw.filter((x) => typeof x === "string") : [];

  const requisitosRaw = tc?.revenda_kanban_requisitos;
  const requisitos: Record<string, string[]> = {};
  if (requisitosRaw && typeof requisitosRaw === "object" && !Array.isArray(requisitosRaw)) {
    for (const [k, v] of Object.entries(requisitosRaw)) {
      if (Array.isArray(v)) requisitos[k] = v.filter((x) => typeof x === "string");
    }
  }

  const camposRaw = tc?.revenda_campos;
  const campos: Record<string, boolean> = {};
  if (camposRaw && typeof camposRaw === "object" && !Array.isArray(camposRaw)) {
    for (const [k, v] of Object.entries(camposRaw)) {
      if (typeof v === "boolean") campos[k] = v;
    }
  }

  return { colunas, requisitos, campos };
}
