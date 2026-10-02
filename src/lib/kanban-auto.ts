/**
 * KANBAN AUTOMÁTICO (F1, set/2026) — espelho TS PURO do motor do banco.
 *
 * Regras normativas: docs/superpowers/plans/2026-09-22-kanban-automatico-f1-banco.md §3.
 * ⚠️ ESPELHO EXATO de `_kanban_derivar_puro` / `_kanban_destino_drop_puro` / `_kanban_fluxo` /
 * `_kanban_status_gate` (migration 20260930130000). O anti-drift (tests/integration/kanban-auto.test.ts)
 * roda as MESMAS fixtures (tests/fixtures/kanban-auto-casos.ts) nos dois lados. Ao mudar aqui, mudar lá.
 *
 * Zero React, zero Supabase. Reusa `requisitosEfetivos` (cascata) e o catálogo de `kanban-condicoes.ts`.
 */
import { CONDICAO_BY_KEY, requisitosEfetivos } from "./kanban-condicoes";
import { normalizeKanbanStatuses, type KanbanStatus } from "./kanban-status";
import { ehOrigemComprada } from "./origem";
import { lerRevendaConfig } from "./revenda-config";
import { ehReprovadoNoGate } from "./reprovado";

export type KanbanAutoConfig = {
  kanban_automatico: boolean;
  /** `tenant_config.status_kanban` cru (jsonb) — normalizado por `boardDaLoja`. */
  status_kanban: unknown;
  kanban_requisitos: Record<string, string[]>;
  kanban_requisitos_excecoes: Record<string, string[]>;
  revenda_kanban_colunas: string[];
  revenda_kanban_requisitos: Record<string, string[]>;
};

export type DerivacaoInput = {
  /** keys do fluxo do modelo, na ordem, já DEDUP (ver fluxoDoModelo) */
  fluxo: string[];
  reqs: Record<string, string[]>;
  exc: Record<string, string[]>;
  cond: Record<string, boolean>;
  status: string | null;
  derivavel: boolean;
};

export type Derivacao = {
  derivavel: boolean;
  entrada: string | null;
  alvo: string | null;
  resultado: string | null;
  fixado: boolean;
  primeiraFalha: string | null;
  faltando: string[];
};

export type AcaoDrop = "fixar" | "soltar" | "nada" | "bloquear_faltando" | "bloquear_ja_cumprida" | "fora_do_fluxo";
export type DestinoDrop = { acao: AcaoDrop; status: string | null; faltando: string[] };

export type ModeloKanban = {
  origem?: string | null;
  status_desenvolvimento?: string | null;
  ordem_criacao_enviada?: boolean | null;
  lancado?: boolean | null;
};

/** Mesma normalização do SQL: lower(btrim(coalesce(x,''))). */
export function normKey(s: string | null | undefined): string {
  return String(s ?? "").trim().toLowerCase();
}

function mapaListas(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
    }
  }
  return out;
}

/** Parse robusto do `tenant_config` cru (tolera nulo, chave faltando, tipo errado). */
export function lerKanbanAutoConfig(tc: any): KanbanAutoConfig {
  const rc = lerRevendaConfig(tc);
  return {
    kanban_automatico: tc?.kanban_automatico === true,
    status_kanban: tc?.status_kanban ?? null,
    kanban_requisitos: mapaListas(tc?.kanban_requisitos),
    kanban_requisitos_excecoes: mapaListas(tc?.kanban_requisitos_excecoes),
    revenda_kanban_colunas: rc.colunas,
    revenda_kanban_requisitos: rc.requisitos,
  };
}

/** Board da loja normalizado (`normalizeKanbanStatuses`) e DEDUP por key (fica a 1ª ocorrência) — ≡ `_kanban_fluxo(cfg,false)`. */
export function boardDaLoja(cfg: KanbanAutoConfig): KanbanStatus[] {
  const vistos = new Set<string>();
  return normalizeKanbanStatuses(cfg.status_kanban).filter((c) => {
    if (vistos.has(c.key)) return false;
    vistos.add(c.key);
    return true;
  });
}

/** Fluxo do modelo: interno = board; comprado = board ∩ revenda_kanban_colunas ([] = todas) — ≡ `_kanban_fluxo(cfg, comprado)`. */
export function fluxoDoModelo(origem: string | null | undefined, cfg: KanbanAutoConfig): KanbanStatus[] {
  const board = boardDaLoja(cfg);
  if (!ehOrigemComprada(origem)) return board;
  const permitidas = cfg.revenda_kanban_colunas;
  if (permitidas.length === 0) return board;
  return board.filter((c) => permitidas.includes(c.key));
}

/** Requisitos/exceções que valem para o modelo (comprado: requisitos próprios e SEM exceções). */
export function reqsDoModelo(
  origem: string | null | undefined,
  cfg: KanbanAutoConfig,
): { reqs: Record<string, string[]>; exc: Record<string, string[]> } {
  return ehOrigemComprada(origem)
    ? { reqs: cfg.revenda_kanban_requisitos, exc: {} }
    : { reqs: cfg.kanban_requisitos, exc: cfg.kanban_requisitos_excecoes };
}

/** Coluna SEM requisito próprio = manual. `reprovado` é SEMPRE manual (regra fixa). */
export function colunaManual(col: string, reqs: Record<string, string[]>): boolean {
  const k = normKey(col);
  return k === "reprovado" || (reqs[k] ?? []).length === 0;
}

/** Requisitos configurados em `reprovado` são ignorados na cascata. */
export function semReprovado(reqs: Record<string, string[]>): Record<string, string[]> {
  const { reprovado: _r, ...resto } = reqs;
  return resto;
}

/** ≡ `_kanban_derivar_puro`. Caminha as colunas AUTOMÁTICAS na ordem e PARA na primeira que falha. */
export function statusDerivado(input: DerivacaoInput): Derivacao {
  const fluxo = input.fluxo;
  const st = normKey(input.status);
  if (fluxo.length === 0 || !input.derivavel) {
    return { derivavel: false, entrada: fluxo[0] ?? null, alvo: null, resultado: input.status ?? null, fixado: false, primeiraFalha: null, faltando: [] };
  }
  const reqs = semReprovado(input.reqs);
  const entrada = fluxo[0];
  let alvo = entrada;
  let primeiraFalha: string | null = null;
  let faltando: string[] = [];
  for (const col of fluxo) {
    if (colunaManual(col, input.reqs)) continue;
    const efetivos = requisitosEfetivos(col, fluxo, reqs, input.exc);
    faltando = efetivos.filter((k) => !input.cond[k]);
    if (faltando.length > 0) { primeiraFalha = col; break; }
    alvo = col;
  }
  if (!primeiraFalha) faltando = [];
  const fixado = st !== "" && fluxo.includes(st) && st !== entrada && colunaManual(st, input.reqs);
  return { derivavel: true, entrada, alvo, resultado: fixado ? st : alvo, fixado, primeiraFalha, faltando };
}

/** Monta o input da derivação a partir do modelo + config + mapa de condições do core. */
export function entradaParaDerivacao(modelo: ModeloKanban, cfg: KanbanAutoConfig, cond: Record<string, boolean>): DerivacaoInput {
  const { reqs, exc } = reqsDoModelo(modelo.origem, cfg);
  return {
    fluxo: fluxoDoModelo(modelo.origem, cfg).map((c) => c.key),
    reqs,
    exc,
    cond: cond ?? {},
    status: modelo.status_desenvolvimento ?? null,
    derivavel: modelo.ordem_criacao_enviada === true && modelo.lancado !== true,
  };
}

export function derivarModelo(modelo: ModeloKanban, cfg: KanbanAutoConfig, cond: Record<string, boolean>): Derivacao {
  return statusDerivado(entradaParaDerivacao(modelo, cfg, cond));
}

/** ≡ `_kanban_faltando_para`: união (dedup, em ordem) dos efetivos NÃO satisfeitos das colunas AUTOMÁTICAS
 *  de `primeiraFalha` até `para` (inclusive). Com exceção, `para` sozinho pode estar satisfeito e ainda faltar algo antes. */
export function faltandoPara(input: DerivacaoInput, para: string): string[] {
  const d = statusDerivado(input);
  if (!d.derivavel || !d.primeiraFalha) return [];
  const fluxo = input.fluxo;
  const ini = fluxo.indexOf(d.primeiraFalha);
  const fim = fluxo.indexOf(normKey(para));
  if (ini < 0 || fim < 0 || fim < ini) return [];
  const reqs = semReprovado(input.reqs);
  const out: string[] = [];
  for (let i = ini; i <= fim; i++) {
    const col = fluxo[i];
    if (colunaManual(col, input.reqs)) continue;
    for (const k of requisitosEfetivos(col, fluxo, reqs, input.exc)) {
      if (!input.cond[k] && !out.includes(k)) out.push(k);
    }
  }
  return out;
}

/** ≡ `_kanban_destino_drop_puro`. Tabela única de arraste (plano §3), na MESMA ordem de avaliação do SQL. */
export function destinoDrop(input: DerivacaoInput, para: string): DestinoDrop {
  const fluxo = input.fluxo;
  const p = normKey(para);
  const st = normKey(input.status);
  const atual = input.status ?? null;
  const idxPara = fluxo.indexOf(p);
  if (idxPara < 0) return { acao: "fora_do_fluxo", status: atual, faltando: [] };
  const d = statusDerivado(input);
  if (!d.derivavel) return p === st ? { acao: "nada", status: atual, faltando: [] } : { acao: "fixar", status: p, faltando: [] };
  const alvo = d.alvo as string;
  const idxAlvo = fluxo.indexOf(alvo);
  if (p === d.entrada) {
    if (d.fixado) return { acao: "soltar", status: alvo, faltando: [] };
    if (idxAlvo === 0) return st === alvo ? { acao: "nada", status: atual, faltando: [] } : { acao: "soltar", status: alvo, faltando: [] };
    return { acao: "bloquear_ja_cumprida", status: atual, faltando: [] };
  }
  if (colunaManual(p, input.reqs)) return p === st ? { acao: "nada", status: atual, faltando: [] } : { acao: "fixar", status: p, faltando: [] };
  if (idxPara > idxAlvo) return { acao: "bloquear_faltando", status: atual, faltando: faltandoPara(input, p) };
  if (idxPara < idxAlvo) return d.fixado ? { acao: "soltar", status: alvo, faltando: [] } : { acao: "bloquear_ja_cumprida", status: atual, faltando: [] };
  if (d.fixado) return { acao: "soltar", status: alvo, faltando: [] };
  return st === alvo ? { acao: "nada", status: atual, faltando: [] } : { acao: "soltar", status: alvo, faltando: [] };
}

/** Mensagem PT-BR para o usuário (labels do catálogo). `null` quando a ação não bloqueia. */
export function mensagemDrop(d: DestinoDrop, para: string, fluxo: KanbanStatus[]): string | null {
  const labelCol = fluxo.find((c) => c.key === normKey(para))?.label ?? para;
  if (d.acao === "bloquear_faltando") {
    const labels = d.faltando.map((k) => CONDICAO_BY_KEY.get(k)?.label ?? k);
    const n = labels.length;
    return n === 1 ? `Falta 1 dado para completar: ${labels[0]}` : `Faltam ${n} dados para completar: ${labels.join(", ")}`;
  }
  if (d.acao === "bloquear_ja_cumprida") return `O card já cumpre "${labelCol}". Para segurá-lo numa etapa, use uma coluna manual.`;
  if (d.acao === "fora_do_fluxo") return `A etapa "${para}" não faz parte do fluxo deste modelo.`;
  return null;
}

/** ≡ `_kanban_status_gate`: status a usar nos gates por posição (Enviar à Explosão, revelar REF — decisão 10).
 *  Reprovado (Dev OU Planejamento, QUALQUER chave — leves L3 fix round 2) ⇒ `null`. Chave desligada ⇒ o status gravado.
 *  Chave ligada: card em `reprovado` ⇒ `null` = SEM posição para os gates (P-190 A,
 *  medios R14 kanban #7: Reprovado é exceção à decisão 10 — nunca revela a REF nem libera a Explosão, qualquer que seja a
 *  ordem do board; `podeEnviarExplosao`/`refCampoVisivel` tratam `statusGate: null` como "nada passa"); card não
 *  derivável ⇒ o status gravado; senão a posição DERIVADA (`alvo`). Fixture anti-drift TS×SQL: `GATE_CASOS`. */
export function statusParaGate(
  ligado: boolean,
  derivacao: Derivacao | null | undefined,
  statusAtual: string | null | undefined,
  /** Leves L3 fix round 1 (A1, P-213 A): reprovado = Dev OU Planejamento. Card REPROVADO NO PLANEJAMENTO ⇒ `null` (sem
   *  posição) em QUALQUER estado da chave (≡ `_kanban_status_gate` da 20261027140000). Ausente = regra de antes. */
  statusPlanejamento?: string | null,
): string | null {
  // Leves L3 fix round 2 (ruling do controlador, P-213 A + P-190 A): reprovado (Dev OU Planejamento) ⇒ SEM posição em
  // QUALQUER estado da chave (≡ `_kanban_status_gate` da 20261027140000).
  if (ehReprovadoNoGate(statusAtual, statusPlanejamento)) return null;
  if (!ligado) return statusAtual ?? null;
  if (!derivacao || !derivacao.derivavel || !derivacao.alvo) return statusAtual ?? null;
  return derivacao.alvo;
}
