/**
 * Urgentes R11 (plan-r11: .superpowers/sdd/2026-10-05-urgentes/plan-r11.md — mini explosão da Peça Teste) — os blocos de migration da
 * frente, aplicados DENTRO da transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local. Usado pelos testes
 * urgd-*.test.ts, pelo gancho `URGD_TXN=1` de `db.ts` e pela cadeia LIFO das urgentes (camada → urg-a → urgb → urgc → urgd):
 * `voltaUrgcSePreciso` chama `voltaUrgdSePreciso` PRIMEIRO, `dropUrgcSePreciso` chama `dropUrgdSePreciso` primeiro e
 * `md5UrgcSucessor` continua em `md5UrgdSucessor`. MESMO contrato do `urgc-helpers.ts`. Frente por CIMA desta no kit (onda 2): R13
 * (`urg-r13-helpers.ts`) — cadeia … → urgd → urg-r13: `voltaUrgdSePreciso` tira a R13 PRIMEIRO, `dropUrgdSePreciso`/`dropUrgdPosteriores`
 * rodam o `dropR13SePreciso` primeiro e `md5UrgdSucessor` continua em `md5R13Sucessor`.
 *
 * Contrato do `urgd-dados.ts` GERADO por `mig/gerar-d.mjs` (r11a e os blocos de função r11c..r11e) com os blocos escritos À MÃO no
 * MESMO JSON (o gerador preserva blocos que não gera): o r11b (199100, ALTER de `estoque_tecido_baixas`) não tem função sentinela —
 * `URGD_ESTADO` = { vivo: SQL "estado DEPOIS" (`AS ok`), pendente: SQL "a ida tem trabalho" (`AS ok`), downNoop: o `_down` é no-op
 * documentado (a coluna e os CHECKs largos ficam; só o `_down_drop` os tira) }. Bloco `downNoop` NÃO entra na volta LIFO (o `_down`
 * dele não muda nada) e continua "vivo" depois dela — `voltaUrgdSePreciso` decide só pelos outros blocos; o `dropUrgdSePreciso` o
 * remove (sem GUC; RECUSA com linha de peça teste no ledger do tecido — o ledger nunca se apaga).
 * Ordem do kit: 199000 (r11a) → 199100 (r11b) → 199200 (r11c) → 199300 (r11d) → 199400 (r11e); volta LIFO pelos `_down` NEUTROS.
 * ⚠️ `URGD_TXN=1` numa cópia SEM a r11a/r11b faz o CREATE TABLE (FKs) e o ALTER de `estoque_tecido_baixas` dentro da txn do teste:
 * ShareRowExclusive em tenants/modelos/tentativas/variantes/itens de OC/aviamentos/etiquetas/cores e AccessExclusive em
 * `estoque_tecido_baixas` ficam presas até o fim do teste — teste com 2ª conexão que ESCREVE nelas dá 55P03 FALSO. Aplique a 199000 e
 * a 199100 na cópia antes (mesma classe da nota de `urgc-helpers.ts`). Medido (passo 1.6): `seg-s3d` "trava medida" acusa o
 * ShareRowExclusive em `modelos` e as AccessExclusive das tabelas novas/`estoque_tecido_baixas` que a IDA do gancho segura (falso
 * vermelho; com a R11 aplicada na cópia, verde). As medições que aceitam lista "de gancho" (seg-s3a/s3b) usam `travaDeGanchoUrgd`
 * pela cadeia (`travaDeGanchoUrgc` consulta esta).
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// [onda 2 / R13] frente sucessora (OC por fornecedor com vários produtos): import dinâmico tolerante a ausência (igual urgc → urgd).
// A R13 expõe volta/drop/md5/trava de gancho como `...R13...` (a trava de gancho existe: a ida tem CREATE POLICY e prende auth/storage).
type Sucessora = {
  voltaSePreciso: (c: Client) => Promise<void>;
  dropSePreciso?: (c: Client) => Promise<void>;
  md5Sucessor: (sig: string, pinado?: string) => string[];
  travaDeGancho?: (t: { rel: string; mode: string }) => boolean;
};
const SUCESSORA: Sucessora | null = existsSync(`${ROOT}tests/integration/urg-r13-helpers.ts`)
  ? await import(/* @vite-ignore */ "./urg-r13-helpers.ts").then((m) => ({
      voltaSePreciso: m.voltaR13SePreciso as Sucessora["voltaSePreciso"],
      dropSePreciso: m.dropR13SePreciso as Sucessora["dropSePreciso"],
      md5Sucessor: m.md5R13Sucessor as Sucessora["md5Sucessor"],
      travaDeGancho: m.travaDeGanchoR13 as Sucessora["travaDeGancho"],
    }))
  : null;

export type UrgdId = "r11a" | "r11b" | "r11c" | "r11d" | "r11e";
const ORDEM: UrgdId[] = ["r11a", "r11b", "r11c", "r11d", "r11e"];

export type UrgdGatilho = { tabela: string; nome: string; antes: string | null; depois: string };
type Bloco = {
  mig: string;
  down: string;
  drop?: string; // ausente = bloco sem objeto novo — nada a apagar
  URGD_SENTINELA: string;
  URGD_MD5: Record<string, { antes: string; depois: string }>;
  URGD_ACL: Record<string, string>;
  URGD_NOVAS?: Record<string, string>; // funções CRIADAS pelo bloco: md5 de DEPOIS
  URGD_NEUTRAS?: Record<string, string>; // funções criadas que o _down NEUTRALIZA: md5 do texto neutro
  URGD_DEPS?: Record<string, string>; // funções FIXADAS (não redefinidas): md5 que a guarda da ida exige
  URGD_WRAPPERS?: string[];
  URGD_GATILHOS?: UrgdGatilho[];
  URGD_TABELAS?: string[];
  URGD_COLUNAS?: string[]; // "schema.tabela.coluna"
  URGD_DROP_GUC?: string;
  // bloco de DADOS (DML à mão, padrão I3c/R8b): ver urgc-helpers
  URGD_DADOS?: { backups?: string[]; vivo: string; pendente: string };
  // bloco de ESTADO (DDL à mão, r11b): vivo = estado DEPOIS; pendente = a ida tem trabalho; downNoop = o _down não muda nada
  URGD_ESTADO?: { vivo: string; pendente: string; downNoop?: boolean };
};

const TODOS: Record<string, Bloco> = existsSync(`${ROOT}tests/integration/urgd-dados.ts`)
  ? ((await import(/* @vite-ignore */ "./urgd-dados.ts")) as { URGD_BLOCOS: Record<string, Bloco> }).URGD_BLOCOS
  : {};
for (const k of Object.keys(TODOS)) {
  if (!ORDEM.includes(k as UrgdId)) throw new Error(`urgd-helpers: bloco desconhecido em urgd-dados.ts: ${k}`);
}

// Relações que a IDA da 199000/199100 trava (MEDIDO, passo 1.6 — tabelas novas + índices + referenciadas pelas FKs + o ledger do
// tecido) — só aparecem na txn com `URGD_TXN=1` numa cópia SEM elas.
const URGD_IDA_TRAVA = [
  "public.modelo_peca_teste_mini", "public.modelo_peca_teste_mini_pkey", "public.mptm_modelo_idx", "public.mptm_tenant_idx",
  "public.modelo_peca_teste_mini_linhas", "public.modelo_peca_teste_mini_linhas_pkey", "public.mptml_chave_ux", "public.mptml_tenant_idx",
  "public.estoque_peca_teste_baixas", "public.estoque_peca_teste_baixas_pkey", "public.epb_tenant_familia_idx", "public.epb_tentativa_idx",
  "public.epb_aviamento_idx", "public.epb_etiqueta_idx", "public.tenants", "public.modelos", "public.modelo_peca_teste_tentativas",
  "public.variantes_tecido", "public.variantes_aviamento", "public.ocs_tecido_itens", "public.aviamentos", "public.etiquetas",
  "public.cores", "public.estoque_tecido_baixas", "public.etb_peca_teste_idx",
];
/**
 * Trava que é dos GANCHOS da R11, não da frente medida (para as medições de trava das frentes antigas que aceitam uma lista "de
 * gancho", como seg-s3a/seg-s3b). A volta LIFO da R11 (`_down` da 199000 = CREATE OR REPLACE FUNCTION; `_down` da 199100 = no-op) é
 * SÓ catálogo: nada a excluir. SÓ com `URGD_TXN=1`, as relações da ida.
 */
export function travaDeGanchoUrgd(t: { rel: string; mode: string }): boolean {
  if (SUCESSORA?.travaDeGancho?.(t)) return true; // [R13] o gancho da R13 (URG_R13_TXN=1) por cima
  return process.env.URGD_TXN === "1" && URGD_IDA_TRAVA.includes(t.rel);
}

/** Todos os blocos do contrato (com ou sem arquivo) — para o teste acusar "bloco ausente". */
export const URGD_BLOCOS: Record<string, Bloco> = TODOS;

/** Blocos cujo arquivo de migration existe no repositório, NA ORDEM do kit. */
export const URGD_MIGS: { id: UrgdId; b: Bloco }[] = ORDEM.filter(
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

async function sqlOk(c: Client, sql: string): Promise<boolean> {
  return (await c.query(sql)).rows[0]?.ok === true;
}
async function backupsExistem(c: Client, d: NonNullable<Bloco["URGD_DADOS"]>): Promise<boolean> {
  for (const t of d.backups ?? []) {
    if ((await c.query("SELECT to_regclass($1) IS NULL AS ok", [t])).rows[0]?.ok === true) return false;
  }
  return true;
}

/** md5 de "depois" da sentinela do bloco (redefinida → URGD_MD5; criada → URGD_NOVAS). */
function depoisDaSentinela(b: Bloco): string {
  const s = b.URGD_SENTINELA;
  const m = b.URGD_MD5[s]?.depois ?? b.URGD_NOVAS?.[s];
  if (!m) throw new Error(`urgd-helpers: sentinela ${s} sem md5 de depois no bloco`);
  return m;
}

/**
 * O bloco está vivo NESTA txn? Bloco de função: md5 da sentinela = "depois" (OU o de um bloco POSTERIOR que a redefine por cima, pela
 * cadeia `md5UrgdSucessor`); depois do `_down` NEUTRO a sentinela tem o texto neutro → false. Bloco de ESTADO (r11b): o SQL `vivo`
 * (estado DEPOIS — continua true depois do `_down`, que é no-op). Bloco de DADOS: backups existem E o `_down` ainda tem efeito.
 * Bloco sem arquivo = false.
 */
export async function urgdViva(c: Client, bloco: UrgdId): Promise<boolean> {
  const e = URGD_MIGS.find((x) => x.id === bloco);
  if (!e) return false;
  if (e.b.URGD_ESTADO) return sqlOk(c, e.b.URGD_ESTADO.vivo);
  if (e.b.URGD_DADOS) return (await backupsExistem(c, e.b.URGD_DADOS)) && (await sqlOk(c, e.b.URGD_DADOS.vivo));
  const s = e.b.URGD_SENTINELA;
  const atual = await md5Fn(c, s);
  return atual !== null && md5UrgdSucessor(s, depoisDaSentinela(e.b)).includes(atual);
}

/** A ida do bloco tem trabalho? (estado/dados: o SQL `pendente`; função: não está viva). */
async function pendente(c: Client, id: UrgdId, b: Bloco): Promise<boolean> {
  if (b.URGD_ESTADO) return sqlOk(c, b.URGD_ESTADO.pendente);
  if (b.URGD_DADOS) return !(await backupsExistem(c, b.URGD_DADOS)) || (await sqlOk(c, b.URGD_DADOS.pendente));
  return !(await urgdViva(c, id));
}

/** Aplica os blocos que existem e ainda não estão vivos, NA ORDEM (idempotente); `ate` = último bloco a aplicar. */
export async function aplicaUrgd(c: Client, ate?: UrgdId): Promise<void> {
  exigeBancoLocal();
  for (const { id, b } of URGD_MIGS) {
    if (await pendente(c, id, b)) await aplicarArquivo(c, b.mig);
    if (id === ate) break;
  }
  await zeraTimeouts(c);
}

/** Volta TODOS os blocos vivos, LIFO, pelos `_down` NEUTROS (o bloco `downNoop` fica: o `_down` dele não muda nada). */
export async function voltaUrgd(c: Client): Promise<void> {
  exigeBancoLocal();
  if (SUCESSORA) await SUCESSORA.voltaSePreciso(c); // LIFO: a R13 (por cima) sai antes dos `_down` da R11 (igual voltaUrgc → R11)
  // o _down da r11c (199200) RECUSA sem esta GUC quando o ledger novo tem linhas (Ruling 16); em teste/manutenção a volta é
  // intencional. Setada LOCAL (restaurada no fim da txn do teste); só a r11c a lê.
  const antGuc = (await c.query("SELECT current_setting('app.confirmo_volta_estoque_peca_teste', true) AS v")).rows[0]?.v ?? "";
  await c.query("SELECT set_config('app.confirmo_volta_estoque_peca_teste', 'sim', true)");
  try {
    for (const { id, b } of [...URGD_MIGS].reverse()) {
      if (b.URGD_ESTADO?.downNoop) continue;
      if (await urgdViva(c, id)) await aplicarArquivo(c, b.down);
    }
  } finally {
    await c.query("SELECT set_config('app.confirmo_volta_estoque_peca_teste', $1, true)", [antGuc]);
  }
  await zeraTimeouts(c);
}

/** LIFO: quem volta (ou reaplica) a R9 ou qualquer release anterior dentro da txn tira esta frente antes. */
export async function voltaUrgdSePreciso(c: Client): Promise<void> {
  if (SUCESSORA) await SUCESSORA.voltaSePreciso(c); // LIFO: a R13 (por cima desta frente) sai antes, mesmo com esta frente fora
  let viva = false;
  for (const { id, b } of URGD_MIGS) if (!b.URGD_ESTADO?.downNoop && (await urgdViva(c, id))) viva = true;
  if (!viva) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaUrgd(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

async function existeAlgo(c: Client, b: Bloco): Promise<boolean> {
  for (const sig of Object.keys(b.URGD_NOVAS ?? {})) if ((await md5Fn(c, sig)) !== null) return true;
  for (const t of b.URGD_TABELAS ?? []) {
    if ((await c.query("SELECT to_regclass($1) IS NOT NULL AS ok", [t])).rows[0]?.ok === true) return true;
  }
  for (const col of b.URGD_COLUNAS ?? []) {
    const [sch, tab, nome] = col.split(".");
    const r = await c.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3",
      [sch, tab, nome],
    );
    if (r.rowCount) return true;
  }
  return false;
}

/** Aplica o `_down_drop` do bloco com a GUC de confirmação dele (`URGD_DROP_GUC`) ligada só durante o arquivo e restaurada depois. */
async function aplicarDrop(c: Client, b: Bloco, drop: string): Promise<void> {
  if (!b.URGD_DROP_GUC) {
    await aplicarArquivo(c, drop);
    return;
  }
  const ant = (await c.query("SELECT current_setting($1, true) AS v", [b.URGD_DROP_GUC])).rows[0]?.v ?? "";
  await c.query("SELECT set_config($1, 'sim', true)", [b.URGD_DROP_GUC]);
  try {
    await aplicarArquivo(c, drop);
  } finally {
    await c.query("SELECT set_config($1, $2, true)", [b.URGD_DROP_GUC, ant]);
  }
}

/**
 * LIFO dos `_down_drop`: quem testa o `_down_drop` (ou um inverso destrutivo) de uma frente ANTIGA roda isto antes — volta os
 * blocos e aplica o `_down_drop` de quem ainda tem objeto novo (função/tabela/coluna; DDL na txn do teste — só na cópia local).
 */
export async function dropUrgdSePreciso(c: Client): Promise<void> {
  exigeBancoLocal();
  if (SUCESSORA?.dropSePreciso) await SUCESSORA.dropSePreciso(c); // LIFO dos drops: os da R13 (tabelas de itens que citam esta cadeia) antes
  await voltaUrgdSePreciso(c);
  for (const { b } of [...URGD_MIGS].reverse()) {
    if (!b.drop || !(await existeAlgo(c, b))) continue;
    await aplicarDrop(c, b, b.drop);
  }
  await zeraTimeouts(c);
}

/**
 * LIFO dos `_down_drop` DENTRO da frente: antes de testar o `_down_drop` de um bloco, roda o `_down_drop` dos blocos POSTERIORES a
 * ele que ainda têm objeto novo. Exige os `_down` já rodados. DDL na txn do teste — só na cópia local.
 */
export async function dropUrgdPosteriores(c: Client, bloco: UrgdId): Promise<void> {
  exigeBancoLocal();
  if (SUCESSORA?.dropSePreciso) await SUCESSORA.dropSePreciso(c); // a R13 é posterior a TODO bloco da R11
  const depois = ORDEM.slice(ORDEM.indexOf(bloco) + 1);
  for (const { id, b } of [...URGD_MIGS].reverse()) {
    if (!depois.includes(id) || !b.drop || !(await existeAlgo(c, b))) continue;
    // o `_down_drop` de um bloco com wrapper (r11d) RECUSA enquanto o wrapper não está no NEUTRO: roda o `_down` dele antes.
    if (!b.URGD_ESTADO?.downNoop && (await urgdViva(c, id))) await aplicarArquivo(c, b.down);
    await aplicarDrop(c, b, b.drop);
  }
}

/**
 * md5 pinado por suíte antiga: o pinado + os "depois" desta frente que o sucedem (cadeia pelos blocos, na ordem: um bloco só entra
 * se o "antes" dele já está na lista). Sem `pinado`: todos os "depois" da função nos blocos existentes.
 */
export function md5UrgdSucessor(sig: string, pinado?: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const out: string[] = pinado ? [pinado] : [];
  for (const { b } of URGD_MIGS) {
    const s = b.URGD_MD5[k];
    if (!s) continue;
    if (!pinado || out.includes(s.antes)) out.push(s.depois);
  }
  // cadeia urgd -> urg-r13: o "depois" da R13 que sucede o último texto desta cadeia
  if (SUCESSORA) {
    const ultimo = out.length ? out[out.length - 1] : undefined;
    for (const m of SUCESSORA.md5Sucessor(k, ultimo)) if (!out.includes(m)) out.push(m);
  }
  return out;
}
