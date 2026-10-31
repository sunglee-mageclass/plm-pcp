/**
 * R13 (OC por fornecedor com VARIOS produtos) — a migration da R13 aplicada DENTRO da transacao do teste (mig-txn: sem
 * BEGIN/COMMIT, nunca \i), SO na copia local. Usado pelo gancho `URG_R13_TXN=1` de `db.ts` e pelos testes urg-r13-*.test.ts.
 *
 * CADEIA (onda 2): camada → urg-a → urgb → urgc (R9) → urgd (R11) → **urg-r13 (topo)**. O predecessor desta frente é `urgd-helpers.ts`
 * (R11), que delega a ela: `voltaUrgdSePreciso` tira a R13 PRIMEIRO, `dropUrgdSePreciso` roda o `dropR13SePreciso` primeiro e
 * `md5UrgdSucessor` continua em `md5R13Sucessor` (as frentes abaixo herdam a cadeia por urgd → urgc → urgb → urg-a).
 *
 * ⚠️ PREMISSA (brief R13 T1): este gancho so APLICA e REVERTE o elo R13. A copia4 e R11-FINAL assada como BASE (R9/R11 ja vivem no
 * banco); no worktree da onda 2 os arquivos da R9/R11 tambem existem, mas `URG_R13_TXN=1` NAO os re-aplica (use URGC_TXN/URGD_TXN
 * se a copia nao os tiver). Ordem dos ganchos em db.ts: URGC -> URGD -> URG_R13.
 *
 * Sucessores md5: a R13 redefine 22 funcoes (T1 numero/guardas, T2 Produto Acabado + leitores, T3 Produto Importado). `md5R13Sucessor`
 * registra o md5 POS-R13 de cada uma como sucessor do pino antigo (via a cadeia urg-a -> urgb -> urgc -> urgd -> R13); os valores vem de
 * mig/md5-r13.txt (DEPOIS) e foram conferidos contra o texto VIVO da copia4 com a R13 aplicada na txn.
 */
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIG = "supabase/migrations/20261105100000_urg_r13_oc_itens.sql";
const DOWN = "supabase/rollback/20261105100000_urg_r13_oc_itens_down.sql";
const DROP = "supabase/rollback/20261105100000_urg_r13_oc_itens_down_drop.sql";

// sentinela: R13 viva = a tabela de itens existe E `fn_oc_p_acabado_numero()` ja NAO esta no texto de antes da R13 (passo 0:
// md5 23493539...). So a tabela nao serve: o `_down` NEUTRO deixa as tabelas, e a 2a volta LIFO (cadeia urgb -> urgc -> urgd -> R13
// chama `voltaR13SePreciso` mais de uma vez na mesma txn) tentaria o `_down` de novo e ele recusaria ("nao esta no DEPOIS").
const R13_FN_ANTES = "23493539af3e477595c10fa882a9be38";
async function r13Viva(c: Client): Promise<boolean> {
  const r = await c.query(
    "SELECT to_regclass('public.ocs_p_acabado_itens') IS NOT NULL AS tab, md5(pg_get_functiondef(to_regprocedure('public.fn_oc_p_acabado_numero()'))) AS m",
  );
  const row = r.rows[0];
  return !!row?.tab && row.m !== null && row.m !== R13_FN_ANTES;
}

async function zeraTimeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}

/** Aplica a R13 DENTRO da txn do teste (so se o arquivo existir e a R13 ainda nao estiver viva). */
export async function aplicaR13(c: Client): Promise<void> {
  exigeBancoLocal();
  if (!existsSync(ROOT + MIG)) return;
  if (!(await r13Viva(c))) await aplicarArquivo(c, MIG);
  await zeraTimeouts(c);
}

/** Volta a R13 (so o `_down` NEUTRO: devolve as 4 funcoes + o ponteiro; as tabelas de itens FICAM inertes). */
export async function voltaR13(c: Client): Promise<void> {
  exigeBancoLocal();
  if (await r13Viva(c)) await aplicarArquivo(c, DOWN);
  await zeraTimeouts(c);
}

/** LIFO: quem volta/reaplica a R11 ou qualquer release anterior dentro da txn tira a R13 antes. */
export async function voltaR13SePreciso(c: Client): Promise<void> {
  if (!(await r13Viva(c))) return;
  const st = (await c.query("SELECT current_setting('statement_timeout') AS v")).rows[0].v as string;
  await voltaR13(c);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}

/**
 * LIFO dos `_down_drop`: quem testa o `_down_drop` de uma frente ANTIGA (170000/Modularidade — cujas funcoes o extrato cita)
 * roda isto antes. O `_down_drop` da R13 so cai com as GUCs; aqui ligamos as 2 e dropamos as tabelas + funcoes novas.
 */
export async function dropR13SePreciso(c: Client): Promise<void> {
  exigeBancoLocal();
  await voltaR13SePreciso(c);
  if ((await c.query("SELECT to_regclass('public.ocs_p_acabado_itens') IS NOT NULL AS ok")).rows[0]?.ok) {
    await c.query("SET LOCAL app.confirmo_apagar_itens_oc_r13 = 'sim'");
    await c.query("SET LOCAL app.confirmo_apagar_backup_r13 = 'sim'");
    await aplicarArquivo(c, DROP);
  }
  await zeraTimeouts(c);
}

/** md5 que a R13 deixa (sucessor dos pinos antigos). A R13 redefine 22 funcoes (md5 ANTES -> DEPOIS em mig/md5-r13.txt); o pino de
 * qualquer teste de frente ANTERIOR sobre uma delas passa a aceitar tambem o DEPOIS da R13 — o pino segue sendo GUARD (so esse texto
 * exato passa; nenhum numero foi trocado "no olho"). Cada valor abaixo foi CONFERIDO contra o `pg_get_functiondef` VIVO da copia4 com a
 * R13 aplicada na txn (22/22 iguais ao DEPOIS do md5-r13.txt). Os leitores compartilhados (`_custo_unitario_modelos_core` pino 173000,
 * `_estoque_extrato_insumo_core` pino 177000, `_dashboard_leadtime_itens_core`) sobem pela cadeia urg-a -> urgb -> urgc -> urgd -> aqui. */
const R13_SUCESSOR: Record<string, string> = {
  // T1 — numero com advisory lock + guardas de vinculo do cabecalho
  "public.fn_oc_p_acabado_numero()": "03e778c0069e6ea85c1f607d7bb55e02",
  "public.fn_oc_importado_numero()": "84012d0b0d93f2f642e8d943b56b67b1",
  "public.enforce_oc_pa_vinculo_unico()": "6a1cc63439c2987525a777fd9f37e2da",
  "public.enforce_oc_importado_vinculo_unico()": "1911cb571aa7cf977903dee0744a26b6",
  // T2 — Produto Acabado (escritores recusam, vincular/excluir/guardas de produto) + leitores PA+PI
  "public._salvar_oc_p_acabado_core(uuid,jsonb,jsonb,integer)": "2db79beeb9f0cbc51b2a77598de1e59a",
  "public._receber_oc_p_acabado_core(uuid,jsonb,jsonb)": "125a50b41e8524e0a849bb5b26a5013f",
  "public._vincular_oc_p_acabado_core(uuid,uuid)": "68df0a0954571d756a62f3e3c570893b",
  "public._excluir_oc_p_acabado_core(uuid)": "3366d7a394ac49a29223457f697abc0b",
  "public._excluir_produto_acabado_core(uuid)": "d70fee664f13dbe2dab96ebe73b94551",
  "public._limpar_produto_acabado_core(uuid)": "da3d5e8e14c3609fc97f9e73bc8db08d",
  "public._salvar_produto_acabado_core(uuid,jsonb,jsonb)": "43a9ec5e03ddd9d85e016cb1ca516843",
  "public._custo_unitario_modelos_core(uuid[])": "81de3239233d2efb3565ed3c5ce8cfb3", // pino 173000
  "public._dashboard_leadtime_itens_core(uuid,text,text)": "2f563c9fcf2587abd3d5442e647f59ee",
  "public._estoque_extrato_insumo_core(uuid,uuid)": "227331479ecf99b9e39eeca40bbf4512", // pino 177000
  "public.fn_modelo_espelho_categoria()": "2e0c70f661e42610e87da2b934dec962",
  // T3 — Produto Importado
  "public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)": "386051cfffa78f354555cc05721f6cf6",
  "public._receber_oc_importado_core(uuid,jsonb,jsonb)": "7f2c60f6e863450b149304c9dde6e5d3",
  "public._excluir_oc_importado_core(uuid)": "edf21a91a5c17830550111db37e18172",
  "public._excluir_produto_importado_core(uuid)": "44472997492c854cdbc88fc76febc89a",
  "public._limpar_produto_importado_core(uuid)": "d863544b621523cf9c1d4532b4909759",
  "public._imp_etapas_brl_oc(uuid)": "18301e31b0f01b31cb6158afc9556ef3",
  "public._imp_recalcular_landed_real_oc(uuid)": "d9d8b3f88aadc5b30bfae20646d612a6",
};
export function md5R13Sucessor(sig: string, pinado?: string): string[] {
  const k = sig.startsWith("public.") ? sig : `public.${sig}`;
  const out: string[] = pinado ? [pinado] : [];
  const d = R13_SUCESSOR[k];
  if (d && (!pinado || out.length)) if (!out.includes(d)) out.push(d);
  return out;
}

/**
 * Travas que sao do GANCHO da R13 (`URG_R13_TXN=1`), nao da frente medida — para as medicoes de trava (pg_locks) das frentes antigas
 * (seg-s3a/s3b/s3d), que rodam NA MESMA txn onde o gancho aplicou a ida da R13 e, depois, a volta LIFO (`_down` neutro). A txn do
 * gancho segura ate o fim do teste: (i) a ida — AccessExclusive/ShareRowExclusive nas tabelas/indices de OC e de itens e nas tabelas
 * das FKs novas (tenants, colaboradores, produtos_*) e, porque a migration tem `CREATE POLICY` nas 2 tabelas de itens, o hook
 * `supautils.policy_grants` pega AccessExclusive nas 23 tabelas de auth/storage/realtime (a R13 NAO e "so catalogo": ver o aviso do
 * kit — horario calmo); (ii) a volta — so travas de LINHA (RowShare/RowExclusive) nos cadastros que o `_down` consulta (FKs): essa vale
 * SEMPRE (a volta LIFO roda mesmo com a R13 commitada no banco, sem gancho); a (i) so com o gancho ligado.
 * Medido na copia4 (ida pelo gancho + volta) e na copia5 (R13 commitada, so a volta).
 */
const R13_IDA_REL = [
  "public._bkp_r13_oc_vinculo", "public.colaboradores", "public.colaboradores_pkey", "public.idx_oci_produto",
  "public.idx_ocpa_produto", "public.idx_pa_categoria_tecido", "public.idx_pa_material_aviamento", "public.idx_pa_modelo",
  "public.idx_pi_categoria_tecido", "public.idx_pi_material_aviamento", "public.idx_pi_modelo",
  "public.idx_produtos_acabados_mix", "public.idx_produtos_importados_mix", "public.oci_itens_oc_idx",
  "public.oci_itens_produto_idx", "public.ocpa_itens_oc_idx", "public.ocpa_itens_produto_idx", "public.ocs_importado",
  "public.ocs_importado_itens", "public.ocs_importado_itens_oc_ordem_ux", "public.ocs_importado_itens_pkey",
  "public.ocs_importado_pkey", "public.ocs_p_acabado", "public.ocs_p_acabado_itens", "public.ocs_p_acabado_itens_oc_ordem_ux",
  "public.ocs_p_acabado_itens_pkey", "public.ocs_p_acabado_pkey", "public.produtos_acabados", "public.produtos_acabados_pkey",
  "public.produtos_importados", "public.produtos_importados_pkey", "public.tenants", "public.tenants_pkey",
  "public.ux_ocs_importado_tenant_numero", "public.ux_ocs_p_acabado_tenant_numero",
];
const R13_VOLTA_LINHAS_REL = [
  "public.categorias_produto", "public.categorias_produto_pkey", "public.categorias_produto_tenant_id_nome_key",
  "public.empresas", "public.empresas_pkey", "public.grupos_produto", "public.grupos_produto_pkey",
  "public.grupos_produto_tenant_nome_key", "public.idx_categorias_produto_grupo", "public.idx_sub1_produto_categoria",
  "public.idx_sub2_produto_categoria", "public.subcat1_produto_tenant_cat_nome_key",
  "public.subcat2_produto_tenant_cat_nome_key", "public.subcategorias1_produto", "public.subcategorias1_produto_pkey",
  "public.subcategorias2_produto", "public.subcategorias2_produto_pkey",
];
export function travaDeGanchoR13(t: { rel: string; mode: string }): boolean {
  // (volta LIFO — SEMPRE que a R13 esta viva e algum `aplica*/volta*` das frentes de baixo a reverte NESTA txn, com ou sem gancho): o
  // `_down` NEUTRO so toca LINHAS (UPDATE do ponteiro/colunas legadas + FKs) — travas de linha nas tabelas/indices de OC e cadastros
  // consultados; medido na copia5 (R13 commitada): nenhuma trava de tabela.
  const linha = t.mode === "RowShareLock" || t.mode === "RowExclusiveLock";
  if (linha && (R13_IDA_REL.includes(t.rel) || R13_VOLTA_LINHAS_REL.includes(t.rel) || /^pg_toast\./.test(t.rel))) return true;
  // (ida — SO com o gancho): a ida aplicada NESTA txn
  if (process.env.URG_R13_TXN !== "1") return false;
  if (/^(auth|storage|realtime)\./.test(t.rel)) return true; // CREATE POLICY das tabelas de itens (hook supautils)
  if (/^(pg_temp_\d+|pg_toast_temp_\d+|pg_toast|pg_catalog)\./.test(t.rel)) return true; // temp tables do Passo 0/identidade da migration
  return R13_IDA_REL.includes(t.rel);
}
