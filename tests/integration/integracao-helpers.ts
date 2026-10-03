/**
 * INTEGRAÇÃO + API — harness e fixtures das suítes de integração (Tasks 1–7 do plano
 * docs/superpowers/plans/2026-09-26-tela-integracao-api.md). Tudo em BEGIN…ROLLBACK (withTx): NADA é gravado.
 * Com INTEGRACAO_MIG_TXN=1, `prepara(c, n)` aplica as migrations 1..n DENTRO da txn (sem BEGIN/COMMIT e sem as 2 travas
 * SET LOCAL do arquivo — o transaction_timeout de 3 s limitaria o teste todo) — NUNCA `\i` (incidente 15/set). Sem a
 * variável, as migrations precisam JÁ estar aplicadas na CÓPIA (ensaio / copia.sh ida) e `prepara` só confere.
 * ⚠️ SÓ NA CÓPIA LOCAL (exigeBancoLocal): DDL em txn contra produção trava o app de todas as lojas (incidente 23/set).
 * Toda rodada destas suítes é janela N3 (o controlador avisa no painel; `n3.sh antes|depois`).
 */
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { aplicarSql, exigeBancoLocal } from "./mig-txn";
import { ehBancoLocal, um, TENANT_TESTE, USER_TESTE } from "./db";
import { voltaS1SePreciso } from "./seg-s1-helpers";

export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const MIG_TXN = process.env.INTEGRACAO_MIG_TXN === "1";
export const LOCAL = ehBancoLocal();
export const T = TENANT_TESTE;
export const U = USER_TESTE;
export const MIGRACOES = [
  "supabase/migrations/20261007100000_integracao_1_tabelas.sql",
  "supabase/migrations/20261007110000_integracao_2_retrato.sql",
  "supabase/migrations/20261007120000_integracao_3_estados.sql",
  "supabase/migrations/20261007130000_integracao_4_trava.sql",
  "supabase/migrations/20261007140000_integracao_5_salvar.sql",
  "supabase/migrations/20261007150000_integracao_6_api.sql",
] as const;
export const INVERSOS = [
  "supabase/rollback/20261007100000_integracao_1_tabelas_down.sql",
  "supabase/rollback/20261007110000_integracao_2_retrato_down.sql",
  "supabase/rollback/20261007120000_integracao_3_estados_down.sql",
  "supabase/rollback/20261007130000_integracao_4_trava_down.sql",
  "supabase/rollback/20261007140000_integracao_5_salvar_down.sql",
  "supabase/rollback/20261007150000_integracao_6_api_down.sql",
] as const;
/** Objeto-marca de cada migration (existe ⇔ aplicada). */
export const MARCAS = [
  "to_regclass('public.integracao_produtos') IS NOT NULL",
  "to_regprocedure('public._integracao_retrato_core(uuid,text[],jsonb)') IS NOT NULL",
  "to_regprocedure('public.integracao_marcar(jsonb)') IS NOT NULL",
  "to_regprocedure('public.fn_integracao_trava_modelos()') IS NOT NULL",
  "to_regprocedure('public.integracao_salvar(jsonb,jsonb)') IS NOT NULL",
  "to_regprocedure('public._integracao_ler(text,boolean,text,integer,text,text)') IS NOT NULL",
] as const;
export const LAYOUT = [
  "nome", "ref_sku", "preco_anterior", "preco_venda", "peso", "ncm", "preco_custo", "cor_base", "cor_apelido",
  "tamanho", "titulo", "descricao", "keywords", "metatag", "comprimento", "largura", "altura", "foto",
] as const;
export const CAMPOS_PADRAO = LAYOUT.slice(0, 17);
/** Release I3 (20261030110000): o layout ganha 19–21 (não obrigatórios) e o padrão marcado passa a 20 (1–17 + 19–21). */
export const OPCIONAIS_I3 = ["colecao", "categoria_tecido", "linha"] as const;
export const LAYOUT_I3 = [...LAYOUT, ...OPCIONAIS_I3] as const;
export const CAMPOS_PADRAO_I3 = [...LAYOUT.slice(0, 17), ...OPCIONAIS_I3] as const;
export const MD5_ANTES = {
  seed: "01bd241680e24fdb665ca8ae81a6a1a3",
  pa: "72c96c624de8f4530c862d8abb6a1283",
  imp: "5baca24d0de45b8c5f291fef39472238",
  impCore: "47584858f55524d18d326dfff00139e6",
} as const;

const RE_TRAVAS = /^SET LOCAL (lock_timeout|transaction_timeout) = '[^']*';$/gm;
/** As 2 travas do arquivo (logo depois do BEGIN) saem da txn do teste. */
export function semTravas(sql: string, nome: string): string {
  const n = (sql.match(RE_TRAVAS) ?? []).length;
  if (n !== 2) throw new Error(`${nome}: esperado as 2 travas SET LOCAL (lock_timeout + transaction_timeout); achei ${n}`);
  return sql.replace(RE_TRAVAS, "-- [teste] trava do arquivo removida (a txn do teste tem as suas)");
}
export const ler = (rel: string): string => readFileSync(ROOT + rel, "utf8");
export async function aplica(c: Client, rel: string): Promise<void> {
  await aplicarSql(c, semTravas(ler(rel), rel), rel);
}
export type Ate = 1 | 2 | 3 | 4 | 5 | 6;
/** Só na cópia; timeouts; com MIG_TXN aplica 1..ate na txn; sempre confere as marcas 1..ate. */
export async function prepara(c: Client, ate: Ate): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  // LIFO: a 20261013100000 redefine funções da 2/6 E troca a assinatura de integracao_listar (P-130 A: + _limite) — reaplicar a 2
  // por cima dela criaria uma 2ª integracao_listar (chamada ambígua). Com ela na cópia, volta-a DENTRO da txn antes.
  if (MIG_TXN) await voltaNomeCorSePreciso(c);
  if (MIG_TXN) for (const rel of MIGRACOES.slice(0, ate)) await aplica(c, rel);
  for (let i = 0; i < ate; i++) {
    const r = await um<{ ok: boolean }>(c, `SELECT ${MARCAS[i]} AS ok`);
    if (!r.ok) throw new Error(`migration ${i + 1} ausente — rode com INTEGRACAO_MIG_TXN=1 (janela N3) ou aplique na cópia`);
  }
}
/**
 * LIFO — "Cor no nome das sublinhas" (20261013100000, P-126) redefine _integracao_retrato_core/_integracao_exemplo (Integração
 * 2/6) e _sku_config_normaliza/_skus_plano/_skus_matriz_ref_tipo (SKU 20261003/20261005/20261005110000) POR CIMA delas. Com ela
 * na cópia, as suítes que REAPLICAM uma dessas migrations na txn (modos *_MIG_TXN) voltam-na antes, DENTRO da txn, pelo inverso
 * dela (confirmação SET LOCAL; as 2 travas SET LOCAL do arquivo saem). Sem efeito quando ela não está aplicada.
 */
export const MIG_NOME_COR = "supabase/migrations/20261013100000_integracao_nome_sublinha_cor.sql";
export const INV_NOME_COR = "supabase/rollback/20261013100000_integracao_nome_sublinha_cor_down.sql";
export async function nomeCorViva(c: Client): Promise<boolean> {
  return (await um<{ ok: boolean }>(c,
    "SELECT to_regprocedure('public._integracao_nome_sublinha(text,text,text,text,text)') IS NOT NULL AS ok")).ok;
}
export async function voltaNomeCorSePreciso(c: Client): Promise<void> {
  // LIFO (R5 do G-plano da frente Preço anterior/Título por versão): a 20261018100000 redefine _integracao_retrato_core POR CIMA
  // desta — a guarda do inverso da 20261013100000 exige o retrato 4cd22e4b…, então a 20261018 (e a 20261018110000) volta ANTES.
  await voltaPrecoVersaoSePreciso(c);
  if (!(await nomeCorViva(c))) return;
  exigeBancoLocal();
  await c.query("SET LOCAL app.confirmo_voltar_cor_no_nome = 'sim'");
  await aplica(c, INV_NOME_COR);
  await c.query("SET LOCAL app.confirmo_voltar_cor_no_nome = ''");
}
/**
 * LIFO — "Preço anterior e Título por versão" (20261018100000, P-146..P-159) redefine _integracao_retrato_core (da 20261013100000)
 * e _replicar_cards_plan_tecido_core (da 20261014100000) POR CIMA delas; a "Versão de produto já integrado" (20261018110000, T5) é
 * uma RPC nova só-leitura. As guardas dos inversos da 20261013/20261014 exigem o texto de ANTES (4cd22e4b…/aaf3f2e4…): com a 20261018
 * na cópia, as suítes que voltam/reaplicam aquelas migrations na txn voltam ESTAS antes (T5 primeiro), DENTRO da txn, pelos
 * inversos (confirmação SET LOCAL; as 2 travas SET LOCAL do arquivo saem). Sem efeito quando não estão aplicadas.
 */
export const MIG_PRECO_VERSAO = "supabase/migrations/20261018100000_preco_titulo_versao_anterior.sql";
export const INV_PRECO_VERSAO = "supabase/rollback/20261018100000_preco_titulo_versao_anterior_down.sql";
export const MIG_VERSAO_INTEGRADA = "supabase/migrations/20261018110000_integracao_versao_integrada.sql";
export const INV_VERSAO_INTEGRADA = "supabase/rollback/20261018110000_integracao_versao_integrada_down.sql";
export async function precoVersaoViva(c: Client): Promise<boolean> {
  return (await um<{ ok: boolean }>(c, "SELECT to_regprocedure('public._modelo_versao_anterior(uuid)') IS NOT NULL AS ok")).ok;
}
export async function versaoIntegradaViva(c: Client): Promise<boolean> {
  return (await um<{ ok: boolean }>(c, "SELECT to_regprocedure('public.integracao_versoes_integradas(uuid[])') IS NOT NULL AS ok")).ok;
}
/**
 * LIFO — achados MÉDIOS R14 (20261024200000: sku #3/#10/#12) redefine _integracao_retrato_core e integracao_listar POR CIMA da
 * 20261018100000 e da 20261013100000; as guardas dos inversos delas exigem os textos de ANTES (1cfaed33…/33e492d1…). Com a R14 na
 * cópia, as suítes que voltam/reaplicam aquelas migrations na txn voltam a R14 ANTES, DENTRO da txn (as 2 travas SET LOCAL do
 * arquivo saem; o statement_timeout de 5 s do arquivo é devolvido ao valor da txn). Sem efeito quando a R14 não está aplicada.
 */
export const INV_R14_INTEGRACAO = "supabase/rollback/20261024200000_integracao_sku_sublinhas_voltar_down.sql";
const R14_RETRATO_DEPOIS = "bfcd6aba0a2f0ebd1a5908888f9c0568";
/**
 * LIFO — LEVES L8 (20261028200000_revenda_insumo_preco) redefine _pa_recomputar_precos_modelo (que a volta da R14 confere,
 * 3782da3c), _salvar_produto_acabado_core (20261016/20261017 conferem e5473bb2) e _salvar_produto_importado_core (20261014,
 * 2f3a81d1). Com ela viva na cópia, as suítes que voltam aquelas migrations na txn voltam a L8 ANTES, DENTRO da txn, pelo
 * _down (neutraliza o gatilho e devolve os 3 textos; as 2 travas SET LOCAL saem; o statement_timeout do arquivo é
 * devolvido). Sem efeito quando a L8 não está aplicada.
 */
export const INV_L8 = "supabase/rollback/20261028200000_revenda_insumo_preco_down.sql";
const L8_GATILHO_DEPOIS = "ccd231e45d1e9a379b252e574c5cda5e"; // fn_preco_comprado_por_insumo() da ida
export async function voltaL8SePreciso(c: Client): Promise<void> {
  await voltaI3SePreciso(c); // LIFO: a I3a (20261030100000) redefine _salvar_produto_acabado/importado_core, que a volta da L8 confere
  const m = (await um<{ m: string | null }>(c,
    "SELECT md5(pg_get_functiondef(to_regprocedure('public.fn_preco_comprado_por_insumo()'))) AS m")).m;
  if (m !== L8_GATILHO_DEPOIS) return;
  exigeBancoLocal();
  const st = (await um<{ v: string }>(c, "SELECT current_setting('statement_timeout') AS v")).v;
  await aplica(c, INV_L8);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}
export async function voltaR14IntegracaoSePreciso(c: Client): Promise<void> {
  await voltaI3SePreciso(c); // LIFO: a I3b (20261030110000) redefine _integracao_retrato_core POR CIMA da R14
  const m = (await um<{ m: string | null }>(c,
    "SELECT md5(pg_get_functiondef(to_regprocedure('public._integracao_retrato_core(uuid,text[],jsonb)'))) AS m")).m;
  if (m !== R14_RETRATO_DEPOIS) return;
  exigeBancoLocal();
  await voltaL8SePreciso(c); // LIFO: a L8 (20261028200000) redefine _pa_recomputar_precos_modelo, que a volta da R14 confere
  const st = (await um<{ v: string }>(c, "SELECT current_setting('statement_timeout') AS v")).v;
  await aplica(c, INV_R14_INTEGRACAO);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}
/**
 * LIFO — achados LEVES L3 sku #5 (20261027120000) redefine _skus_plano/_skus_matriz_ref_tipo (e o gatilho do SKU) POR CIMA da
 * 20261013100000 (release 4), cujo inverso exige os textos de ANTES (4c19c6a4…/95309506…). Com a L3 na cópia, as suítes que
 * voltam/reaplicam a 20261013100000 na txn voltam a L3 sku ANTES, DENTRO da txn (as 2 travas SET LOCAL do arquivo saem; o
 * statement_timeout de 5 s do arquivo é devolvido ao valor da txn). Sem efeito quando a L3 não está aplicada.
 */
export const INV_L3_SKU = "supabase/rollback/20261027120000_sku_replica_familia_down.sql";
const L3_SKUS_PLANO_DEPOIS = "5980345a105818b26329c8a4e594fee2";
export async function voltaL3SkuSePreciso(c: Client): Promise<void> {
  const m = (await um<{ m: string | null }>(c,
    "SELECT md5(pg_get_functiondef(to_regprocedure('public._skus_plano(uuid,text,text,jsonb,text)'))) AS m")).m;
  if (m !== L3_SKUS_PLANO_DEPOIS) return;
  exigeBancoLocal();
  const st = (await um<{ v: string }>(c, "SELECT current_setting('statement_timeout') AS v")).v;
  await aplica(c, INV_L3_SKU);
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}
export async function voltaPrecoVersaoSePreciso(c: Client): Promise<void> {
  await voltaI3SePreciso(c); // LIFO: a Release I3 (20261030100000..120000) é a mais nova de todas
  await voltaL3SkuSePreciso(c); // LIFO: a L3 sku (20261027120000) volta antes de tudo (a mais nova)
  await voltaR14IntegracaoSePreciso(c); // LIFO: a R14 (20261024200000) volta antes da 20261018
  if (await versaoIntegradaViva(c)) {
    exigeBancoLocal();
    await aplica(c, INV_VERSAO_INTEGRADA);
  }
  if (!(await precoVersaoViva(c))) return;
  exigeBancoLocal();
  await c.query("SET LOCAL app.confirmo_voltar_preco_versao = 'sim'");
  await aplica(c, INV_PRECO_VERSAO);
  await c.query("SET LOCAL app.confirmo_voltar_preco_versao = ''");
}
/**
 * LIFO — Release I3 (Integração: Coleção / Categoria do Tecido Principal / Linha + Categoria do tecido / Material do aviamento
 * nos produtos PA/PI; plano .superpowers/sdd/2026-10-02-integracao-3-campos/plan.md). I3a (20261030100000) redefine
 * _salvar_produto_*_core, _replicar_produtos_*_core e _limpar_produto_*_core POR CIMA da L8 / Tamanho em nos cards; I3b
 * (20261030110000) redefine _integracao_retrato_core (R14), _integracao_exemplo (release 4) e mais 6 da Integração; I3c
 * (20261030120000) é a correção única (configs + integráveis). Com elas na cópia, as suítes que voltam/reaplicam migrations
 * anteriores na txn voltam a I3 ANTES (C → B → A), DENTRO da txn (as 2 travas SET LOCAL do arquivo saem). Sem efeito quando
 * não estão aplicadas. Com I3_TXN=1, `withTx` (db.ts) APLICA a I3 na txn de todo teste (ensaio do estado "depois" sem tocar a cópia).
 */
export const MIG_I3A = "supabase/migrations/20261030100000_produto_categoria_tecido_material.sql";
export const INV_I3A = "supabase/rollback/20261030100000_produto_categoria_tecido_material_down.sql";
export const MIG_I3B = "supabase/migrations/20261030110000_integracao_3_campos.sql";
export const INV_I3B = "supabase/rollback/20261030110000_integracao_3_campos_down.sql";
export const MIG_I3C = "supabase/migrations/20261030120000_integracao_3_campos_reprocesso.sql";
export const INV_I3C = "supabase/rollback/20261030120000_integracao_3_campos_reprocesso_down.sql";
/** md5 "depois" que marcam cada etapa viva (gerados por .superpowers/sdd/2026-10-02-integracao-3-campos/mig/gerar.mjs). */
export const I3A_TENANT_DEPOIS = "b868561c6e3f04574589e6ad49b03fb4"; // fn_produto_cat_material_tenant() da ida
export const I3A_TENANT_NEUTRA = "9484dc06ee6aaf871308dc2745a7068a"; // a mesma, neutralizada pelo inverso
export const I3B_RETRATO_DEPOIS = "8a5275cf8c145f88e23c5158c22fdfc6"; // _integracao_retrato_core da I3b
/** Sucessores aceitos pelos pins de md5 das suítes antigas: o "depois" da I3 de cada função que ela redefine. */
export const I3_SUCESSOR: Record<string, string> = {
  "_salvar_produto_acabado_core(uuid,jsonb,jsonb)": "9299a1d71336c2126435dec903de4952",
  "_salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)": "f28985c19fe5efa4f08011137e20f51f",
  "_replicar_produtos_acabados_core(uuid,uuid,uuid,uuid[])": "9fcdf99eb192cd938809dd159fc6d446",
  "_replicar_produtos_importados_core(uuid,uuid,uuid,uuid[])": "a2bd975c6a8c8b65e37b057911845639",
  "_limpar_produto_acabado_core(uuid)": "153ebd8d87b1050479e73d9c93a826f1",
  "_limpar_produto_importado_core(uuid)": "466d486e4e7503a0cf437713372f2d22",
  "_integracao_layout()": "480106c786ff534affe98e2374c8ce49",
  "_integracao_rotulos()": "53453ee707edde3b1c41b81386149ec5",
  "_integracao_cfg(uuid)": "db865044a6b9f875c8c920b82f6b9974",
  "_integracao_retrato_core(uuid,text[],jsonb)": I3B_RETRATO_DEPOIS,
  "_integracao_valores(integracao_linhas,text[],text[])": "7d094ada6982728a4dfdc96077d51367",
  "_integracao_exemplo(text[],integer)": "8882ce651fe5f13a44c60751692da40e",
  "integracao_marcar(jsonb)": "b4400251395251b80a458eb11524d172",
  "integracao_config_ler()": "62b81b3853de66118baef1748866b0dd",
};
/** Aceita o md5 pinado OU o sucessor da I3 (assinatura com ou sem "public."). */
export function md5OuSucessorI3(sig: string, pinado: string): string[] {
  const s = I3_SUCESSOR[sig.replace(/^public\./, "")];
  return s ? [pinado, s] : [pinado];
}
async function md5De(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
export async function i3aViva(c: Client): Promise<boolean> {
  return (await md5De(c, "public.fn_produto_cat_material_tenant()")) === I3A_TENANT_DEPOIS;
}
export async function i3bViva(c: Client): Promise<boolean> {
  return (await md5De(c, "public._integracao_retrato_core(uuid,text[],jsonb)")) === I3B_RETRATO_DEPOIS;
}
/** Layout / padrão VIVOS (com ou sem a I3b na cópia). */
export async function layoutVivo(c: Client): Promise<readonly string[]> {
  return (await i3bViva(c)) ? LAYOUT_I3 : LAYOUT;
}
export async function padraoVivo(c: Client): Promise<readonly string[]> {
  return (await i3bViva(c)) ? CAMPOS_PADRAO_I3 : CAMPOS_PADRAO;
}
async function comTimeoutPreservado(c: Client, fn: () => Promise<void>): Promise<void> {
  const st = (await um<{ v: string }>(c, "SELECT current_setting('statement_timeout') AS v")).v;
  await fn();
  await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
}
export async function voltaI3SePreciso(c: Client): Promise<void> {
  await voltaS1SePreciso(c); // LIFO: a S1 (20261031*) redefine funções que as voltas mais antigas conferem — sai primeiro
  if (await i3bViva(c)) {
    exigeBancoLocal();
    await comTimeoutPreservado(c, async () => {
      if ((await um<{ ok: boolean }>(c, "SELECT to_regclass('public._bkp_i3c_reprocesso') IS NOT NULL AS ok")).ok) await aplica(c, INV_I3C);
      await aplica(c, INV_I3B);
    });
  }
  if (await i3aViva(c)) {
    exigeBancoLocal();
    await comTimeoutPreservado(c, () => aplica(c, INV_I3A));
  }
}
/** Aplica a I3 inteira (A → B → C) na txn, pulando o que já está vivo (a C é idempotente). */
export async function aplicaI3(c: Client): Promise<void> {
  exigeBancoLocal();
  await comTimeoutPreservado(c, async () => {
    if (!(await i3aViva(c))) await aplica(c, MIG_I3A);
    if (!(await i3bViva(c))) await aplica(c, MIG_I3B);
    await aplica(c, MIG_I3C);
  });
}
/** Dispara os gatilhos ADIADOS (a txn do teste nunca faz COMMIT) e volta ao modo adiado. */
export async function imediato(c: Client): Promise<void> {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}
export async function DEF(c: Client, sig: string): Promise<string> {
  return (await um<{ d: string }>(c, `SELECT pg_get_functiondef('public.${sig}'::regprocedure) AS d`)).d;
}

// ─────────────────────────── usuários ───────────────────────────
export type Perm = [pagina: string, ver: boolean, editar: boolean];
/**
 * Usuário novo da Loja Teste (txn), com as permissões dadas; vira o JWT da txn.
 * ⚠️ Delta 7 (`trg_integracao_perm_user`, `20261008100000`): uma linha `user_permissions.pagina LIKE 'integracao%'`
 * só é gravada quando o JWT no momento do INSERT é de um SUPER ADMIN — de qualquer outro chamador o gatilho
 * devolve RETURN NULL (a escrita é ignorada em silêncio, sem erro). Por isso as linhas de permissão são
 * inseridas com o JWT trocado para USER_TESTE (super admin na cópia local — confirmado em user_roles) e SÓ
 * DEPOIS o JWT volta a ser o `uid` alvo, espelhando `concedePeloSuper` de integracao-permissao-super.test.ts.
 * Sem delta 7 aplicado (ou permissões que não são 'integracao%') isto é um no-op a mais, inócuo.
 */
export async function comoUsuarioCom(c: Client, uid: string, perms: Perm[], o: { tenantAdmin?: boolean } = {}): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, T, `${uid}@teste`, `Teste ${uid.slice(-4)}`],
  );
  if (o.tenantAdmin) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin')`, [uid]);
  if (perms.length > 0) {
    const jwtAntes = (await c.query(`SELECT current_setting('request.jwt.claims', true) AS j`)).rows[0].j as string | null;
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USER_TESTE, role: "authenticated" })]);
    for (const [pagina, ver, editar] of perms) {
      await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, $4, $5)`,
        [uid, T, pagina, ver, editar],
      );
    }
    // restaura o JWT anterior (se havia) antes de setar o do `uid` alvo — não deixa a chamada "vazar" o super admin.
    await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [jwtAntes ?? ""]);
  }
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: "authenticated" })]);
}

// ─────────────────────────── fixtures (Loja Teste, dentro da txn) ───────────────────────────
let seq = 0;
const sufixo = (): string => `${Date.now().toString(36)}${(seq++).toString(36)}`.toUpperCase();
export async function cor(c: Client, nome: string, sigla: string): Promise<string> {
  return (await um<{ id: string }>(c,
    `INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, $2, $3) RETURNING id`, [T, nome, sigla])).id;
}
export async function apelido(c: Client, corId: string, nome: string, sigla: string): Promise<string> {
  return (await um<{ id: string }>(c,
    `INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id, sigla_sku) VALUES ($1, $2, $3, $4) RETURNING id`,
    [T, nome, corId, sigla])).id;
}
export async function keywordsLoja(c: Client, texto: string | null): Promise<void> {
  await c.query(`UPDATE public.tenant_config SET keywords = $1 WHERE tenant_id = $2`, [texto, T]);
}
export async function camposLoja(c: Client, campos: readonly string[]): Promise<void> {
  await c.query(`UPDATE public.integracao_config SET campos = $1::text[] WHERE tenant_id = $2`, [campos, T]);
}
export type Fixture = { id: string; ref: string; corId: string; apelidoId: string | null; produtoId: string | null };
export type ModeloOpts = { nome?: string; semApelido?: boolean; semSku?: boolean; fotos?: string[]; origem?: "interno" | "revenda" | "importado" };

/**
 * Contas certas C1 (20261019300000): o custo previsto do INTERNO é derivado no servidor — um UPDATE de
 * `custo_peca_previsto` sem a GUC de transação `app.custo_sistema='on'` é devolvido ao valor de antes, e todo INSERT/edição
 * de BOM/M.O. põe o card na fila de recálculo (processada no COMMIT/`SET CONSTRAINTS ALL IMMEDIATE`). As fixtures gravam o
 * custo "como o servidor": liga a GUC (o gatilho deixa passar e nada entra na fila) e RESTAURA o valor anterior no fim.
 * Sem a migration aplicada a GUC é inócua.
 */
export async function comoCustoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  const ant = (await um<{ v: string | null }>(c, `SELECT current_setting('app.custo_sistema', true) AS v`)).v ?? "";
  await c.query(`SELECT set_config('app.custo_sistema', 'on', true)`);
  try {
    return await fn();
  } finally {
    await c.query(`SELECT set_config('app.custo_sistema', $1, true)`, [ant]);
  }
}

async function colunasCompletas(c: Client, id: string, o: ModeloOpts): Promise<void> {
  // Reforço de segurança S1 (B1b): preco_venda de COMPRADO só muda pelo recálculo do servidor — a fixture escreve direto,
  // então liga a GUC do recálculo (sem efeito sem a S1) e devolve o valor de antes.
  const antPreco = (await um<{ v: string | null }>(c, "SELECT current_setting('app.preco_comprado_sistema', true) AS v")).v ?? "";
  await c.query("SELECT set_config('app.preco_comprado_sistema', 'on', true)");
  await c.query(
    `UPDATE public.modelos SET preco_anterior = 179.90, preco_venda = 159.90, peso_kg = 0.220, ncm = '6109.10.00',
            titulo_pagina = 'Blusa Brisa Manga Longa', descricao_produto = 'Blusa em viscose, manga longa.',
            comprimento_cm = 68, largura_cm = 42, altura_cm = 2, custo_peca_previsto = 62.10, tamanho_tipo = 'letra',
            status_planejamento = 'planejado', fotos_modelo = $2::text[]
      WHERE id = $1`,
    [id, o.fotos ?? [`${T}/fotos_modelo/integracao-teste.jpg`]],
  );
  await c.query("SELECT set_config('app.preco_comprado_sistema', $1, true)", [antPreco]);
}
async function gradeESkus(c: Client, id: string, ref: string, corId: string, apelidoId: string | null, o: ModeloOpts): Promise<void> {
  await c.query(`INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, 1, '{"38|P": 2, "40|M": 3}', 5)`, [id]);
  if (o.semSku) return;
  for (const tam of ["38|P", "40|M"]) {
    await c.query(
      `INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual)
       VALUES ($1, $2, public._sku_variante_key($3, $4), $5, $6, true)`,
      [T, id, corId, apelidoId, tam, `${ref}-${tam.split("|")[1]}`],
    );
  }
}
/** Produto INTERNO completo nos 17 campos (Tecido 1 com 1 variante cor+apelido; grade P/M; 2 SKUs gravados). */
export async function modeloInterno(c: Client, o: ModeloOpts = {}): Promise<Fixture> {
  // C1: o card inteiro nasce "como o servidor" (custo 62,10 fica; nada entra na fila de custo) — ver comoCustoSistema
  return comoCustoSistema(c, () => modeloInternoSemFila(c, o));
}
async function modeloInternoSemFila(c: Client, o: ModeloOpts): Promise<Fixture> {
  const s = sufixo();
  const ref = `ITG${s}`;
  const corId = await cor(c, `Branco ${s}`, `B${s.slice(-2)}`);
  const apelidoId = o.semApelido ? null : await apelido(c, corId, `Off-white ${s}`, `O${s.slice(-2)}`);
  const id = (await um<{ id: string }>(c,
    `INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, $2, $3, 'interno') RETURNING id`,
    [T, o.nome ?? `Blusa Brisa ${s}`, ref])).id;
  await colunasCompletas(c, id, o);
  const artigo = (await um<{ id: string }>(c, `SELECT id FROM public.artigos WHERE tenant_id = $1 ORDER BY id LIMIT 1`, [T])).id;
  const vt = (await um<{ id: string }>(c,
    `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id, cor_apelido_id, nome_variante) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [T, artigo, corId, apelidoId, `Var ${s}`])).id;
  const mt = (await um<{ id: string }>(c,
    `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 1, 'tecido') RETURNING id`, [id, artigo])).id;
  await c.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, 1)`, [mt, vt]);
  await gradeESkus(c, id, ref, corId, apelidoId, o);
  return { id, ref, corId, apelidoId, produtoId: null };
}
/** REVENDA completa: produtos_acabados (ref própria, valor 40) + variante + card espelho + grade + SKUs. */
export async function revenda(c: Client, o: ModeloOpts = {}): Promise<Fixture> {
  const s = sufixo();
  const ref = `RVD${s}`;
  const nome = o.nome ?? `Bolsa Areia ${s}`;
  const corId = await cor(c, `Bege ${s}`, `G${s.slice(-2)}`);
  const apelidoId = o.semApelido ? null : await apelido(c, corId, `Areia ${s}`, `A${s.slice(-2)}`);
  const produtoId = (await um<{ id: string }>(c,
    `INSERT INTO public.produtos_acabados (tenant_id, nome, ref, valor_unitario, desconto_pct, qtd_total, markup_varejo)
     VALUES ($1, $2, $3, 40, 0, 5, 3) RETURNING id`, [T, nome, ref])).id;
  const id = (await um<{ id: string }>(c,
    `INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, $2, $3, 'revenda') RETURNING id`, [T, nome, ref])).id;
  await colunasCompletas(c, id, o);
  await c.query(`UPDATE public.produtos_acabados SET modelo_id = $2 WHERE id = $1`, [produtoId, id]);
  await c.query(
    `INSERT INTO public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
     VALUES ($1, $2, 1, $3, $4, 1, 5)`, [T, produtoId, corId, apelidoId]);
  await gradeESkus(c, id, ref, corId, apelidoId, o);
  return { id, ref, corId, apelidoId, produtoId };
}
/** IMPORTADO completo (o custo landed depende das cotações — as suítes que olham custo usam interno/revenda). */
export async function importado(c: Client, o: ModeloOpts = {}): Promise<Fixture> {
  const s = sufixo();
  const ref = `IMP${s}`;
  const nome = o.nome ?? `Macacão Tramonto ${s}`;
  const corId = await cor(c, `Azul ${s}`, `Z${s.slice(-2)}`);
  const apelidoId = o.semApelido ? null : await apelido(c, corId, `Cobalto ${s}`, `C${s.slice(-2)}`);
  const produtoId = (await um<{ id: string }>(c,
    `INSERT INTO public.produtos_importados (tenant_id, nome, ref, moeda_compra, valor_unitario_m1, cotacao_ref, cotacao_final, qtd_total, markup_varejo)
     VALUES ($1, $2, $3, 'USD', 10, 1, 5, 5, 3) RETURNING id`, [T, nome, ref])).id;
  const id = (await um<{ id: string }>(c,
    `INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, $2, $3, 'importado') RETURNING id`, [T, nome, ref])).id;
  await colunasCompletas(c, id, o);
  await c.query(`UPDATE public.produtos_importados SET modelo_id = $2 WHERE id = $1`, [produtoId, id]);
  await c.query(
    `INSERT INTO public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id, peso, qtd)
     VALUES ($1, $2, 1, $3, $4, 1, 5)`, [T, produtoId, corId, apelidoId]);
  await gradeESkus(c, id, ref, corId, apelidoId, o);
  return { id, ref, corId, apelidoId, produtoId };
}
