/**
 * KANBAN PL (Etapas PL, Onda 3) — espelho TS PURO da derivação do board PL no banco.
 *
 * O SQL do PL REUSA as puras compartilhadas com o Dev (`_kanban_fluxo`, `_kanban_derivar_puro`,
 * `_kanban_destino_drop_puro`, `_kanban_faltando_para`, `_kanban_coluna_manual` — ver migration 20261127100000/120000; board vazio =
 * fluxo VAZIO, 20261127150000) com
 * board ÚNICO (`etapas_pl_kanban`), requisitos `etapas_pl_requisitos`, EXCEÇÕES SEMPRE `{}` (sem revenda/comprado) e
 * `derivavel = (status_etapa_pl IS NOT NULL)` (= `_etapas_pl_derivar_lote`). Esta lib espelha ESSAS puras DELEGANDO às do Dev
 * em `kanban-auto.ts` (`statusDerivado`/`destinoDrop`/`faltandoPara`/`colunaManual`), que já são o espelho TS exato delas — assim
 * há UMA implementação TS por regra. Anti-drift TS×SQL: tests/integration/etapas-pl-derivacao-antidrift.test.ts
 * (fixtures tests/fixtures/etapas-pl-casos.ts). Ao mudar a regra, mudar o SQL, `kanban-auto.ts` e as fixtures juntos.
 *
 * Zero React, zero Supabase. Catálogo de condições do PL: `etapas-pl-condicoes.ts`.
 */
import {
  colunaManual, destinoDrop, faltandoPara, normKey, statusDerivado,
  type AcaoDrop, type DerivacaoInput,
} from "./kanban-auto";
import { normalizeKanbanStatuses, type KanbanStatus } from "./kanban-status";

/** Config do kanban PL (colunas de `tenant_config`): board cru, requisitos por etapa e a chave do modo automático. */
export type EtapasPlConfig = { board: string[]; requisitos: Record<string, string[]>; automatico: boolean };

/** Resultado da derivação (subconjunto de `Derivacao` do Dev: o PL não usa `entrada`/`primeiraFalha`). */
export type DerivacaoPl = { derivavel: boolean; alvo: string | null; resultado: string | null; fixado: boolean; faltando: string[] };

/** Ações = as do SQL (`_kanban_destino_drop_puro`): fixar | soltar | nada | bloquear_faltando | bloquear_ja_cumprida | fora_do_fluxo. */
export type DestinoDropPl = { acao: AcaoDrop; status: string | null; faltando: string[] };

function mapaListas(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
    }
  }
  return out;
}

/** Parse robusto de uma linha de `tenant_config` (tolera nulo, chave faltando, tipo errado). `board` guarda o jsonb cru
 *  (labels OU objetos — `boardEtapasPl` normaliza); não-array vira `[]`. */
export function lerEtapasPlConfig(row: any): EtapasPlConfig {
  return {
    board: Array.isArray(row?.etapas_pl_kanban) ? (row.etapas_pl_kanban as string[]) : [],
    requisitos: mapaListas(row?.etapas_pl_requisitos),
    automatico: row?.etapas_pl_automatico === true,
  };
}

/** Board PL normalizado (`normalizeKanbanStatuses`) e DEDUP por key (fica a 1ª ocorrência) — ≡ `_kanban_fluxo` do SQL.
 *  ⚠️ Board cru VAZIO/não-array = `[]` (INÉRCIA), NÃO o board padrão do Dev: ≡ a guarda de `_etapas_pl_derivar_lote` (migration
 *  20261127150000) — `normalizeKanbanStatuses([])` e a pura `_kanban_fluxo` cairiam nas 14 colunas do Dev. */
export function boardEtapasPl(cfg: EtapasPlConfig): { key: string; label: string }[] {
  if (!Array.isArray(cfg.board) || cfg.board.length === 0) return [];
  const vistos = new Set<string>();
  return normalizeKanbanStatuses(cfg.board)
    .filter((c: KanbanStatus) => {
      if (vistos.has(c.key)) return false;
      vistos.add(c.key);
      return true;
    })
    .map((c) => ({ key: c.key, label: c.label }));
}

/** Keys do fluxo PL, na ordem (dedup). */
export function fluxoEtapasPl(cfg: EtapasPlConfig): string[] {
  return boardEtapasPl(cfg).map((c) => c.key);
}

/** Requisitos PRÓPRIOS configurados na coluna (a herança da cascata é computada na derivação). */
export function reqsDaColuna(cfg: EtapasPlConfig, key: string): string[] {
  return cfg.requisitos[normKey(key)] ?? [];
}

/** Coluna SEM requisito próprio = manual; `reprovado` é SEMPRE manual (≡ `_kanban_coluna_manual`). */
export function colunaManualPl(cfg: EtapasPlConfig, key: string): boolean {
  return colunaManual(key, cfg.requisitos);
}

/** Entrada da pura do Dev para o PL: exceções SEMPRE `{}`; derivável = o produto está no PL (status não nulo). */
function entradaPl(cfg: EtapasPlConfig, statusAtual: string | null, satisfeitas: Record<string, boolean>): DerivacaoInput {
  return {
    fluxo: fluxoEtapasPl(cfg),
    reqs: cfg.requisitos,
    exc: {},
    cond: satisfeitas ?? {},
    status: statusAtual ?? null,
    derivavel: statusAtual !== null && statusAtual !== undefined,
  };
}

/** ≡ `_kanban_derivar_puro` (como `_etapas_pl_derivar_lote`). Caminha as colunas AUTOMÁTICAS na ordem e PARA na 1ª que falha:
 *  `alvo` = a última satisfeita antes (a 1ª coluna é o piso); `fixado` = status numa coluna MANUAL diferente da 1ª
 *  (`resultado` = o status); `faltando` = os requisitos efetivos não satisfeitos da 1ª que falhou. Status nulo (fora do PL)
 *  = não derivável (`alvo` null). Board vazio (fluxo `[]`) = inércia: `derivavel:false`, `alvo:null`, `resultado` = o status. */
export function derivarEtapaPl(cfg: EtapasPlConfig, statusAtual: string | null, satisfeitas: Record<string, boolean>): DerivacaoPl {
  const d = statusDerivado(entradaPl(cfg, statusAtual, satisfeitas));
  return { derivavel: d.derivavel, alvo: d.alvo, resultado: d.resultado, fixado: d.fixado, faltando: d.faltando };
}

/** ≡ `_kanban_destino_drop_puro` (tabela única de arraste, usada por `etapas_pl_mover`). */
export function destinoDropPl(
  cfg: EtapasPlConfig,
  statusAtual: string | null,
  para: string,
  satisfeitas: Record<string, boolean>,
): DestinoDropPl {
  const d = destinoDrop(entradaPl(cfg, statusAtual, satisfeitas), para);
  return { acao: d.acao, status: d.status, faltando: d.faltando };
}

/** ≡ `_kanban_faltando_para`: união (dedup, em ordem) dos requisitos efetivos NÃO satisfeitos das colunas automáticas da 1ª
 *  que falha até `key` (inclusive). Vazio quando nada falha, `key` fora do fluxo ou já atrás da posição derivada. */
export function faltandoParaPl(cfg: EtapasPlConfig, key: string, satisfeitas: Record<string, boolean>): string[] {
  return faltandoPara(entradaPl(cfg, "", satisfeitas), key);
}
