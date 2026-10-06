/**
 * Urgentes R1b (20261103198000, correcao unica do "a enviar" dos insumos vinculados a UM tamanho) — o bloco aplicado/voltado DENTRO da
 * transacao do teste (mig-txn: sem BEGIN/COMMIT, nunca \i) — so na copia local. Fica POR CIMA do plan-b (urgb, 180000..191000) na
 * cadeia LIFO: `voltaUrgbSePreciso` chama `voltaUrgR1bSePreciso` PRIMEIRO. Motivo: as 2 funcoes da 198000 citam os helpers da 170000
 * (`_insumo_tamanho_de`, `_insumo_pecas`, `_grade_mapa_cad`) e a coluna `tamanho_vinculado`; o `_down_drop` da 170000 varre o prosrc e
 * recusa enquanto elas estiverem no texto de DEPOIS. O `_down` da 198000 as NEUTRALIZA (texto sem os helpers) e nao toca dado quando
 * o backup nao tem gravacao pendente. Contrato (md5/arquivos) em `urg-r1b-dados.ts` (GERADO).
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";
import { URG_R1B } from "./urg-r1b-dados";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const R1B_EXISTE = existsSync(ROOT + URG_R1B.mig);

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  const r = await c.query("SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig]);
  return (r.rows[0]?.m as string | null) ?? null;
}

async function zeraTimeouts(c: Client): Promise<void> {
  // As migrations fazem SET LOCAL transaction_timeout (vale para a txn INTEIRA do teste) — devolve ao normal do teste.
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

/** O bloco esta vivo NESTA txn? (as 2 funcoes no texto de DEPOIS). */
export async function urgR1bViva(c: Client): Promise<boolean> {
  if (!R1B_EXISTE) return false;
  return (
    (await md5Fn(c, URG_R1B.PREVIA)) === URG_R1B.DEPOIS[URG_R1B.PREVIA] &&
    (await md5Fn(c, URG_R1B.RODAR)) === URG_R1B.DEPOIS[URG_R1B.RODAR]
  );
}

/** Aplica a ida se ainda nao esta viva (idempotente). */
export async function aplicaUrgR1b(c: Client): Promise<void> {
  exigeBancoLocal();
  if (R1B_EXISTE && !(await urgR1bViva(c))) await aplicarArquivo(c, URG_R1B.mig);
  await zeraTimeouts(c);
}

/** LIFO: quem volta a frente de baixo (plan-b, plan-a, Camada…) tira esta antes — o `_down` NEUTRO (funcoes ficam, sem os helpers). */
export async function voltaUrgR1bSePreciso(c: Client): Promise<void> {
  if (!R1B_EXISTE) return;
  let viva = false;
  for (const sig of [URG_R1B.PREVIA, URG_R1B.RODAR])
    if ((await md5Fn(c, sig)) === URG_R1B.DEPOIS[sig]) viva = true;
  if (!viva) return;
  exigeBancoLocal();
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0]
    .v as string;
  await aplicarArquivo(c, URG_R1B.down);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
  await zeraTimeouts(c);
}
