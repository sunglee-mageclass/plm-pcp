/**
 * Urgentes R9 (plan-c: .superpowers/sdd/2026-10-05-urgentes/plan-c.md — Peça Teste) — os blocos de migration da frente, aplicados
 * DENTRO da transação do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — só na cópia local. Usado pelos testes urgc-*.test.ts, pelo
 * gancho `URGC_TXN=1` de `db.ts` e pela cadeia LIFO das urgentes (camada → urg-a → urgb → urgc): `voltaUrgbSePreciso` chama
 * `voltaUrgcSePreciso` PRIMEIRO, `dropUrgbSePreciso` chama `dropUrgcSePreciso` primeiro e `md5UrgbSucessor` continua em
 * `md5UrgcSucessor`. Frente por CIMA desta no kit: urgentes R11 (plan-r11, 199000..199400; `urgd-helpers.ts`) — cadeia
 * … → urgc → urgd: `voltaUrgc`/`voltaUrgcSePreciso` tiram a R11 PRIMEIRO, `dropUrgcSePreciso` roda o `dropUrgdSePreciso` primeiro e
 * `md5UrgcSucessor` continua em `md5UrgdSucessor`.
 *
 * Contrato do `urgc-dados.ts` GERADO por `mig/gerar-c.mjs` (um gerador para os blocos r9a/r9b/r9c; r9d/r9e = DMLs à mão da T4,
 * escritos à mão no mesmo JSON — o gerador preserva blocos que não gera — com `URGC_DADOS` no lugar da função sentinela:
 * vivo = "o `_down` tem efeito", pendente = "a ida tem trabalho"; ver o tipo `Bloco`):
 * `URGC_BLOCOS[bloco]` com `mig`/`down`/`drop` (sem `drop` = bloco sem objeto novo), `URGC_SENTINELA` (assinatura de função: bloco vivo = md5 dela = o "depois" — de
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

// [urg R11] frente sucessora (plan-r11): import dinâmico tolerante a ausência (igual urgb → urgc)
type Sucessora = {
  voltaSePreciso: (c: Client) => Promise<void>;
  dropSePreciso: (c: Client) => Promise<void>;
  md5Sucessor: (sig: string, pinado?: string) => string[];
  travaDeGancho: (t: { rel: string; mode: string }) => boolean;
};
const SUCESSORA: Sucessora | null = existsSync(`${ROOT}tests/integration/urgd-helpers.ts`)
  ? await import(/* @vite-ignore */ "./urgd-helpers.ts").then((m) => ({
      voltaSePreciso: m.voltaUrgdSePreciso as Sucessora["voltaSePreciso"],
      dropSePreciso: m.dropUrgdSePreciso as Sucessora["dropSePreciso"],
      md5Sucessor: m.md5UrgdSucessor as Sucessora["md5Sucessor"],
      travaDeGancho: m.travaDeGanchoUrgd as Sucessora["travaDeGancho"],
    }))
  : null;

export type UrgcId = "r9a" | "r9b" | "r9c" | "r9d" | "r9e";
const ORDEM: UrgcId[] = ["r9a", "r9b", "r9c", "r9d", "r9e"];

export type UrgcGatilho = { tabela: string; nome: string; antes: string | null; depois: string };
type Bloco = {
  mig: string;
  down: string;
  drop?: string; // ausente = bloco sem objeto novo (r9c: só redefine função) — nada a apagar
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
  // bloco de DADOS (r9d/r9e = DMLs à mão da T4, padrão I3c/R8b — sem função sentinela): `backups` = tabelas que precisam existir
  // para as 2 consultas rodarem (ausente = bloco nunca rodou); `vivo` = SQL "o `_down` tem efeito" (`AS ok`); `pendente` = SQL
  // "a ida tem trabalho" (`AS ok`; só então o aplicaUrgc roda o arquivo — idempotente de qualquer jeito).
  URGC_DADOS?: { backups?: string[]; vivo: string; pendente: string };
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
// Relações que a volta LIFO da 196000 (r9e `_down`: devolve o switch PL) trava — SÓ LINHAS (RowExclusive/RowShare) de
// categorias_terceirizado (+ os 2 índices) e do backup _bkp_r9_exige_pl (o `_down` tira de lá o que devolveu). Medido (T4).
const URGC_VOLTA_DADOS_TRAVA = [
  "public.categorias_terceirizado", "public.categorias_terceirizado_pkey", "public.categorias_terceirizado_tenant_id_nome_key",
  "public._bkp_r9_exige_pl", "public._bkp_r9_exige_pl_pkey",
];
// Relações que a IDA das 2 DMLs (195000 r9d / 196000 r9e) trava — só aparecem na txn com `URGC_TXN=1` numa cópia SEM elas (medido, T4):
// linhas de permissões/usuários (r9d), backups novos (AccessExclusive: tabelas da própria migration), tentativas, blocos (FOR SHARE),
// categorias (switch PL) e a auditoria.
const URGC_IDA_DADOS_TRAVA = [
  ...URGC_VOLTA_DADOS_TRAVA, "public._bkp_r9_pt_legado", "public._bkp_r9_pt_legado_pkey", "public.audit_log",
  "public.user_permissions", "public.user_permissions_pkey", "public.user_permissions_user_id_pagina_key", "public.papel_permissoes",
  "public.papel_permissoes_pkey", "public.papel_permissoes_papel_id_pagina_key", "public.papel_permissoes_papel_idx", "public.users",
  "public.users_pkey", "public.users_papel_id_idx", "public.idx_users_tenant", "public.tenants", "public.tenants_pkey",
  "public.modelo_peca_teste_tentativas", "public.modelo_peca_teste_tentativas_pkey", "public.mpt_categoria_idx", "public.mpt_empresa_idx",
  "public.mpt_legado_ux", "public.mpt_modelo_idx", "public.mpt_tenant_idx", "public.mpt_trilha_numero_ux",
  "public.producao_terceirizados", "public.producao_terceirizados_pkey", "public.producao_terceirizados_mo_linha_idx",
  "public.idx_prod_terc_cad", "public.idx_prod_terc_empresa",
];
/**
 * Trava que é dos GANCHOS da R9, não da frente medida (para as medições de trava das frentes antigas que aceitam uma lista "de
 * gancho", como seg-s3a/seg-s3b). Estrito: SÓ o par medido da volta LIFO da 192000 (`_down`: CREATE OR REPLACE TRIGGER =
 * {categorias_terceirizado, ShareRowExclusiveLock}), o da 196000 (`_down`: só LINHAS — RowExclusive/RowShare — de
 * categorias_terceirizado e do backup do switch) e, SÓ com `URGC_TXN=1`, as relações da ida.
 */
export function travaDeGanchoUrgc(t: { rel: string; mode: string }): boolean {
  if (t.rel === "public.categorias_terceirizado" && t.mode === "ShareRowExclusiveLock") return true;
  if (URGC_VOLTA_DADOS_TRAVA.includes(t.rel) && (t.mode === "RowExclusiveLock" || t.mode === "RowShareLock")) return true;
  if (SUCESSORA?.travaDeGancho(t)) return true; // [urg R11] o gancho da R11 (URGD_TXN=1) por cima
  return process.env.URGC_TXN === "1" && (URGC_IDA_TRAVA.includes(t.rel) || URGC_IDA_DADOS_TRAVA.includes(t.rel));
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

async function sqlOk(c: Client, sql: string): Promise<boolean> {
  return (await c.query(sql)).rows[0]?.ok === true;
}
async function backupsExistem(c: Client, d: NonNullable<Bloco["URGC_DADOS"]>): Promise<boolean> {
  for (const t of d.backups ?? []) {
    if ((await c.query("SELECT to_regclass($1) IS NULL AS ok", [t])).rows[0]?.ok === true) return false;
  }
  return true;
}
/** Bloco de DADOS: vivo = os backups existem E o `_down` ainda tem efeito (o backup sozinho não conta: ele FICA depois do `_down`). */
async function dadosVivo(c: Client, d: NonNullable<Bloco["URGC_DADOS"]>): Promise<boolean> {
  return (await backupsExistem(c, d)) && (await sqlOk(c, d.vivo));
}
/** Bloco de DADOS: a ida tem trabalho = backup ausente (nunca rodou) OU a consulta `pendente`. */
async function dadosPendente(c: Client, d: NonNullable<Bloco["URGC_DADOS"]>): Promise<boolean> {
  return !(await backupsExistem(c, d)) || (await sqlOk(c, d.pendente));
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
  if (e.b.URGC_DADOS) return dadosVivo(c, e.b.URGC_DADOS);
  const s = e.b.URGC_SENTINELA;
  const atual = await md5Fn(c, s);
  return atual !== null && md5UrgcSucessor(s, depoisDaSentinela(e.b)).includes(atual);
}

/** Aplica os blocos que existem e ainda não estão vivos, NA ORDEM (idempotente); `ate` = último bloco a aplicar. */
export async function aplicaUrgc(c: Client, ate?: UrgcId): Promise<void> {
  exigeBancoLocal();
  for (const { id, b } of URGC_MIGS) {
    // bloco de DADOS: só roda com trabalho pendente (idempotente; evita escrita à toa em toda txn com URGC_TXN=1)
    const aplicar = b.URGC_DADOS ? await dadosPendente(c, b.URGC_DADOS) : !(await urgcViva(c, id));
    if (aplicar) await aplicarArquivo(c, b.mig);
    if (id === ate) break;
  }
  await zeraTimeouts(c);
}

/** Volta TODOS os blocos vivos, LIFO, pelos `_down` NEUTROS. */
export async function voltaUrgc(c: Client): Promise<void> {
  exigeBancoLocal();
  if (SUCESSORA) await SUCESSORA.voltaSePreciso(c); // LIFO: a R11 (por cima) sai antes
  for (const { id, b } of [...URGC_MIGS].reverse()) {
    if (await urgcViva(c, id)) await aplicarArquivo(c, b.down);
  }
  await zeraTimeouts(c);
}

/** LIFO: quem volta (ou reaplica) o plan-b ou qualquer release anterior dentro da txn tira esta frente antes. */
export async function voltaUrgcSePreciso(c: Client): Promise<void> {
  if (SUCESSORA) await SUCESSORA.voltaSePreciso(c); // LIFO: a R11 (por cima desta frente) sai antes, mesmo com esta frente fora
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

/** Aplica o `_down_drop` do bloco com a GUC de confirmação dele (`URGC_DROP_GUC`) ligada só durante o arquivo e restaurada depois. */
async function aplicarDrop(c: Client, b: Bloco, drop: string): Promise<void> {
  if (!b.URGC_DROP_GUC) {
    await aplicarArquivo(c, drop);
    return;
  }
  const ant = (await c.query("SELECT current_setting($1, true) AS v", [b.URGC_DROP_GUC])).rows[0]?.v ?? "";
  await c.query("SELECT set_config($1, 'sim', true)", [b.URGC_DROP_GUC]);
  try {
    await aplicarArquivo(c, drop);
  } finally {
    await c.query("SELECT set_config($1, $2, true)", [b.URGC_DROP_GUC, ant]);
  }
}

/**
 * LIFO dos `_down_drop`: quem testa o `_down_drop` (ou um inverso destrutivo) de uma frente ANTIGA roda isto antes — volta os
 * blocos e aplica o `_down_drop` de quem ainda tem objeto novo (função/tabela/coluna; DDL na txn do teste — só na cópia local). A
 * GUC de confirmação do bloco (`URGC_DROP_GUC`) é ligada só durante o arquivo e restaurada depois.
 */
export async function dropUrgcSePreciso(c: Client): Promise<void> {
  exigeBancoLocal();
  if (SUCESSORA) await SUCESSORA.dropSePreciso(c); // LIFO dos drops: os da R11 (FKs/tabelas que dependem desta frente) antes
  await voltaUrgcSePreciso(c);
  for (const { b } of [...URGC_MIGS].reverse()) {
    if (!b.drop || !(await existeAlgo(c, b))) continue;
    await aplicarDrop(c, b, b.drop);
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
  if (SUCESSORA) await SUCESSORA.dropSePreciso(c); // a R11 (FKs para a tabela de tentativas) é posterior a TODO bloco da R9
  const depois = ORDEM.slice(ORDEM.indexOf(bloco) + 1);
  for (const { id, b } of [...URGC_MIGS].reverse()) {
    if (!depois.includes(id) || !b.drop || !(await existeAlgo(c, b))) continue;
    await aplicarDrop(c, b, b.drop);
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
  // cadeia urgc -> urgd: o "depois" da R11 que sucede o último texto desta cadeia
  if (SUCESSORA) {
    const ultimo = out.length ? out[out.length - 1] : undefined;
    for (const m of SUCESSORA.md5Sucessor(k, ultimo)) if (!out.includes(m)) out.push(m);
  }
  return out;
}
