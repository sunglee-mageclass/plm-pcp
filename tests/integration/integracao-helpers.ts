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
  if (MIG_TXN) for (const rel of MIGRACOES.slice(0, ate)) await aplica(c, rel);
  for (let i = 0; i < ate; i++) {
    const r = await um<{ ok: boolean }>(c, `SELECT ${MARCAS[i]} AS ok`);
    if (!r.ok) throw new Error(`migration ${i + 1} ausente — rode com INTEGRACAO_MIG_TXN=1 (janela N3) ou aplique na cópia`);
  }
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

async function colunasCompletas(c: Client, id: string, o: ModeloOpts): Promise<void> {
  await c.query(
    `UPDATE public.modelos SET preco_anterior = 179.90, preco_venda = 159.90, peso_kg = 0.220, ncm = '6109.10.00',
            titulo_pagina = 'Blusa Brisa Manga Longa', descricao_produto = 'Blusa em viscose, manga longa.',
            comprimento_cm = 68, largura_cm = 42, altura_cm = 2, custo_peca_previsto = 62.10, tamanho_tipo = 'letra',
            status_planejamento = 'planejado', fotos_modelo = $2::text[]
      WHERE id = $1`,
    [id, o.fotos ?? [`${T}/fotos_modelo/integracao-teste.jpg`]],
  );
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
