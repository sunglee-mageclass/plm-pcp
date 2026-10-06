/**
 * Urgentes R9 (plan-c: .superpowers/sdd/2026-10-05-urgentes/plan-c.md — Peça Teste) — os blocos de migration da frente, aplicados
 * DENTRO da transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local. Usado pelos testes urgc-*.test.ts, pelo
 * gancho `URGC_TXN=1` de `db.ts` e pela cadeia LIFO das urgentes (camada → urg-a → urgb → urgc): `voltaUrgbSePreciso` chama
 * `voltaUrgcSePreciso` PRIMEIRO, `dropUrgbSePreciso` chama `dropUrgcSePreciso` primeiro e `md5UrgbSucessor` continua em
 * `md5UrgcSucessor`.
 *
 * Contrato do `urgc-dados.ts` GERADO por `mig/gerar-c.mjs` (um gerador para os blocos r9a/r9b/r9c; r9d/r9e = DMLs à mão da T4):
 * `URGC_BLOCOS[bloco]` com `mig`/`down`/`drop`, `URGC_SENTINELA` (assinatura de função: bloco vivo = md5 dela = o "depois" — de
 * `URGC_MD5` se redefinida, de `URGC_NOVAS` se criada pelo bloco), `URGC_MD5`/`URGC_ACL` (funções existentes redefinidas),
 * `URGC_NOVAS` (funções criadas), `URGC_NEUTRAS` (funções criadas que o `_down` NEUTRALIZA — md5 do texto neutro),
 * `URGC_GATILHOS` (md5 de `pg_get_triggerdef`; `antes` null = gatilho novo), `URGC_TABELAS`/`URGC_COLUNAS` (objetos novos que só o
 * `_down_drop` apaga) e `URGC_DROP_GUC` (GUC que o `_down_drop` exige = 'sim'). Registro por `existsSync`: um bloco só entra se o
 * arquivo de migration dele existir. Ordem do kit: 192000 (r9a) → 193000 (r9b) → 194000 (r9c) → 195000 (r9d) → 196000 (r9e); volta
 * LIFO pelos `_down` NEUTROS (tabela/coluna/gatilhos da r9a FICAM — só o `_down_drop` os remove).
 * ⚠️ `URGC_TXN=1` numa cópia SEM a r9a faz o ADD COLUMN / CREATE TABLE / CREATE TRIGGER dentro da txn do teste: AccessExclusive em
 * categorias_terceirizado e ShareRowExclusive em modelos/modelo_servico_mo/empresas/tenants ficam presas até o fim do teste —
 * teste com 2ª conexão que ESCREVE nessas tabelas dá 55P03 FALSO (medido: mod-2-regras "corrida: card em voo noutra sessão…").
 * Aplique a 192000 na cópia antes (mesma classe da nota da T4 em mod-helpers).
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

export type UrgcId = "r9a" | "r9b" | "r9c" | "r9d" | "r9e";
const ORDEM: UrgcId[] = ["r9a", "r9b", "r9c", "r9d", "r9e"];

export type UrgcGatilho = { tabela: string; nome: string; antes: string | null; depois: string };
type Bloco = {
  mig: string;
  down: string;
  drop: string;
  URGC_SENTINELA: string;
  URGC_MD5: Record<string, { antes: string; depois: string }>;
  URGC_ACL: Record<string, string>;
  URGC_NOVAS?: Record<string, string>; // funções CRIADAS pelo bloco: md5 de DEPOIS
  URGC_NEUTRAS?: Record<string, string>; // funções criadas que o _down NEUTRALIZA: md5 do texto neutro
  URGC_DEPS?: Record<string, string>; // funções FIXADAS (não redefinidas): md5 que a guarda da ida exige
  URGC_WRAPPERS?: string[]; // funções NOVAS que são wrapper (authenticated executa; o _down tira o EXECUTE)
  URGC_GATILHOS?: UrgcGatilho[];
  URGC_TABELAS?: string[];
  URGC_COLUNAS?: string[]; // "schema.tabela.coluna"
  URGC_DROP_GUC?: string;
};

const TODOS: Record<string, Bloco> = existsSync(`${ROOT}tests/integration/urgc-dados.ts`)
  ? ((await import(/* @vite-ignore */ "./urgc-dados.ts")) as { URGC_BLOCOS: Record<string, Bloco> }).URGC_BLOCOS
  : {};
for (const k of Object.keys(TODOS)) {
  if (!ORDEM.includes(k as UrgcId)) throw new Error(`urgc-helpers: bloco desconhecido em urgc-dados.ts: ${k}`);
}

// Relações que a IDA da 192000 trava (tabela nova + FKs + índices + coluna) — só aparecem na txn com `URGC_TXN=1` numa cópia SEM ela.
const URGC_IDA_TRAVA = [
  "public.categorias_terceirizado", "public.modelo_peca_teste_tentativas", "public.modelo_peca_teste_tentativas_pkey",
  "public.mpt_trilha_numero_ux", "public.mpt_legado_ux", "public.mpt_modelo_idx", "public.mpt_tenant_idx", "public.mpt_empresa_idx",
  "public.mpt_categoria_idx", "public.modelos", "public.modelo_servico_mo", "public.empresas", "public.tenants",
];
/**
 * Trava que é dos GANCHOS da R9, não da frente medida (para as medições de trava das frentes antigas que aceitam uma lista "de
 * gancho", como seg-s3a/seg-s3b). Estrito: SÓ o par medido da volta LIFO da 192000 (`_down`: CREATE OR REPLACE TRIGGER =
 * {categorias_terceirizado, ShareRowExclusiveLock}) e, SÓ com `URGC_TXN=1`, as relações da ida.
 */
export function travaDeGanchoUrgc(t: { rel: string; mode: string }): boolean {
  if (t.rel === "public.categorias_terceirizado" && t.mode === "ShareRowExclusiveLock") return true;
  return process.env.URGC_TXN === "1" && URGC_IDA_TRAVA.includes(t.rel);
}

/** Todos os blocos do contrato (com ou sem arquivo) — para o teste acusar "bloco ausente". */
export const URGC_BLOCOS: Record<string, Bloco> = TODOS;

/** Blocos cujo arquivo de migration existe no repositório, NA ORDEM do kit. */
export const URGC_MIGS: { id: UrgcId; b: Bloco }[] = ORDEM.filter(
  (id) => TODOS[id] && existsSync(ROOT + TODOS[id].mig),
).map((id) => ({ id, b: TODOS[id] }));

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig]);
  return (r.rows[0]?.m as string | null) ?? null;
}

async function zeraTimeouts(c: Client): Promise<void> {
  // As migrations fazem SET LOCAL transaction_timeout (vale para a txn INTEIRA do teste) — devolve ao normal do teste.
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

/** md5 de "depois" da sentinela do bloco (redefinida → URGC_MD5; criada → URGC_NOVAS). */
function depoisDaSentinela(b: Bloco): string {
  const s = b.URGC_SENTINELA;
  const m = b.URGC_MD5[s]?.depois ?? b.URGC_NOVAS?.[s];
  if (!m) throw new Error(`urgc-helpers: sentinela ${s} sem md5 de depois no bloco`);
  return m;
}

/**
 * O bloco está vivo NESTA txn? (md5 da sentinela = "depois" — OU o de um bloco POSTERIOR que a redefine por cima, pela cadeia
 * `md5UrgcSucessor`). Bloco sem arquivo = false. Depois do `_down` NEUTRO a sentinela tem o texto neutro → false.
 */
export async function urgcViva(c: Client, bloco: UrgcId): Promise<boolean> {
  const e = URGC_MIGS.find((x) => x.id === bloco);
  if (!e) return false;
  const s = e.b.URGC_SENTINELA;
  const atual = await md5Fn(c, s);
  return atual !== null && md5UrgcSucessor(s, depoisDaSentinela(e.b)).includes(atual);
}

/** Aplica os blocos que existem e ainda não estão vivos, NA ORDEM (idempotente); `ate` = último bloco a aplicar. */
export async function aplicaUrgc(c: Client, ate?: UrgcId): Promise<void> {
  exigeBancoLocal();
  for (const { id, b } of URGC_MIGS) {
    if (!(await urgcViva(c, id))) await aplicarArquivo(c, b.mig);
    if (id === ate) break;
  }
  await zeraTimeouts(c);
}

/** Volta TODOS os blocos vivos, LIFO, pelos `_down` NEUTROS. */
export async function voltaUrgc(c: Client): Promise<void> {
  exigeBancoLocal();
  for (const { id, b } of [...URGC_MIGS].reverse()) {
    if (await urgcViva(c, id)) await aplicarArquivo(c, b.down);
  }
  await zeraTimeouts(c);
}

/** LIFO: quem volta (ou reaplica) o plan-b ou qualquer release anterior dentro da txn tira esta frente antes. */
export async function voltaUrgcSePreciso(c: Client): Promise<void> {
  let viva = false;
  for (const { id } of URGC_MIGS) if (await urgcViva(c, id)) viva = true;
  if (!viva) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaUrgc(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

async function existeAlgo(c: Client, b: Bloco): Promise<boolean> {
  for (const sig of Object.keys(b.URGC_NOVAS ?? {})) if ((await md5Fn(c, sig)) !== null) return true;
  for (const t of b.URGC_TABELAS ?? []) {
    if ((await c.query("SELECT to_regclass($1) IS NOT NULL AS ok", [t])).rows[0]?.ok === true) return true;
  }
  for (const col of b.URGC_COLUNAS ?? []) {
    const [sch, tab, nome] = col.split(".");
    const r = await c.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3",
      [sch, tab, nome],
    );
    if (r.rowCount) return true;
  }
  return false;
}

/**
 * LIFO dos `_down_drop`: quem testa o `_down_drop` (ou um inverso destrutivo) de uma frente ANTIGA roda isto antes — volta os
 * blocos e aplica o `_down_drop` de quem ainda tem objeto novo (função/tabela/coluna; DDL na txn do teste — só na cópia local). A
 * GUC de confirmação do bloco (`URGC_DROP_GUC`) é ligada só durante o arquivo e restaurada depois.
 */
export async function dropUrgcSePreciso(c: Client): Promise<void> {
  exigeBancoLocal();
  await voltaUrgcSePreciso(c);
  for (const { b } of [...URGC_MIGS].reverse()) {
    if (!(await existeAlgo(c, b))) continue;
    if (b.URGC_DROP_GUC) {
      const ant = (await c.query("SELECT current_setting($1, true) AS v", [b.URGC_DROP_GUC])).rows[0]?.v ?? "";
      await c.query("SELECT set_config($1, 'sim', true)", [b.URGC_DROP_GUC]);
      try {
        await aplicarArquivo(c, b.drop);
      } finally {
        await c.query("SELECT set_config($1, $2, true)", [b.URGC_DROP_GUC, ant]);
      }
    } else {
      await aplicarArquivo(c, b.drop);
    }
  }
  await zeraTimeouts(c);
}

/**
 * LIFO dos `_down_drop` DENTRO da frente: antes de testar o `_down_drop` de um bloco, roda o `_down_drop` dos blocos POSTERIORES a
 * ele que ainda têm objeto novo (ex.: a 193000 cria funções que citam a tabela da 192000 — o `_down_drop` da 192000 recusa enquanto
 * elas existirem). Exige os `_down` já rodados (o `_down_drop` de cada bloco confere). DDL na txn do teste — só na cópia local.
 */
export async function dropUrgcPosteriores(c: Client, bloco: UrgcId): Promise<void> {
  exigeBancoLocal();
  const depois = ORDEM.slice(ORDEM.indexOf(bloco) + 1);
  for (const { id, b } of [...URGC_MIGS].reverse()) {
    if (!depois.includes(id) || !(await existeAlgo(c, b))) continue;
    if (b.URGC_DROP_GUC) {
      const ant = (await c.query("SELECT current_setting($1, true) AS v", [b.URGC_DROP_GUC])).rows[0]?.v ?? "";
      await c.query("SELECT set_config($1, 'sim', true)", [b.URGC_DROP_GUC]);
      try {
        await aplicarArquivo(c, b.drop);
      } finally {
        await c.query("SELECT set_config($1, $2, true)", [b.URGC_DROP_GUC, ant]);
      }
    } else {
      await aplicarArquivo(c, b.drop);
    }
  }
}

/**
 * md5 pinado por suíte antiga: o pinado + os "depois" desta frente que o sucedem (cadeia pelos blocos, na ordem: um bloco só entra
 * se o "antes" dele já está na lista). Sem `pinado`: todos os "depois" da função nos blocos existentes.
 */
export function md5UrgcSucessor(sig: string, pinado?: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const out: string[] = pinado ? [pinado] : [];
  for (const { b } of URGC_MIGS) {
    const s = b.URGC_MD5[k];
    if (!s) continue;
    if (!pinado || out.includes(s.antes)) out.push(s.depois);
  }
  return out;
}
