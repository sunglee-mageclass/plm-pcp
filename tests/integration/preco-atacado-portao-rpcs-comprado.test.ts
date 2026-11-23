// Portão das 3 RPCs de preço do COMPRADO (salvar_precos_fixo_produto_acabado, salvar_markups_produto_acabado,
// salvar_precos_fixo_produto_importado): editar o preço exige a PERMISSÃO DE PREÇO (varejo OU atacado, Editor) via _pode_editar_preco
// (migration 20261211100000) — admin/tenant_admin NÃO furam (só super_admin fura) e a página do produto SOZINHA não libera mais.
// SÓ na cópia local (DDL em txn revertida). O produto passado NÃO existe: o portão roda ANTES do núcleo, então
// "PASSOU o portão" = a recusa NÃO é sem_permissao_pagina (cai no nao_encontrado do núcleo); "barrou" = 42501 sem_permissao_pagina.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const MIG1 = "supabase/migrations/20261211100000_preco_permissao_atacado_gate_backfill.sql";
const DOWN1 = "supabase/rollback/20261211100000_preco_permissao_atacado_gate_backfill_down.sql";
const MIG = "supabase/migrations/20261211110000_preco_atacado_portao_rpcs_comprado.sql";
const DOWN = "supabase/rollback/20261211110000_preco_atacado_portao_rpcs_comprado_down.sql";
const T = TENANT_TESTE;
const FAKE = "00000000-0000-4000-8000-0000000000aa";

const MD5: Record<string, { antes: string; depois: string }> = {
  salvar_precos_fixo_produto_acabado: { antes: "815583deca5487c3c7b450d5e6db1bfc", depois: "f7cd5f6ed02bc7566d45e16b267a5788" },
  salvar_markups_produto_acabado: { antes: "1f266f1908cf4918b4a0a9d868565f92", depois: "644373572c1abb60f420793cfce70dd4" },
  salvar_precos_fixo_produto_importado: { antes: "a277b0dcc67cacf0658ba771cc8d87a7", depois: "dac8b020f7dd2afb8a667a2245d95562" },
};
/** A migration 2 depende do helper _pode_editar_preco (migration 1): aplica as duas, na ordem, na txn do teste. */
const aplicarAmbas = async (c: Client) => { await aplicarArquivo(c, MIG1); await aplicarArquivo(c, MIG); };

const CHAMADAS: { fn: string; pagina: string; sql: string }[] = [
  { fn: "salvar_precos_fixo_produto_acabado", pagina: "criacao_produto_acabado",
    sql: `SELECT public.salvar_precos_fixo_produto_acabado($1::uuid, true, 50, false, null)` },
  { fn: "salvar_markups_produto_acabado", pagina: "criacao_produto_acabado",
    sql: `SELECT public.salvar_markups_produto_acabado($1::uuid, 2, 3)` },
  { fn: "salvar_precos_fixo_produto_importado", pagina: "criacao_produto_importado",
    sql: `SELECT public.salvar_precos_fixo_produto_importado($1::uuid, true, 50, false, null)` },
];

async function tenta(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT pa_t");
  await c.query("SET LOCAL ROLE authenticated");
  try {
    await c.query(sql, params);
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    return `${er.code} ${er.message}`;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT pa_t");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT pa_t");
  }
}

// USER_TESTE é super admin (fura o portão): cria usuário COMUM da Loja Teste com as páginas dadas (ver+editar). Txn revertida.
const U_COMUM = "0b0b0b0b-0000-4000-8000-00000000a7a2";
async function usuarioComum(c: Client, paginas: string[], papel?: "tenant_admin" | "super_admin"): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U_COMUM, `${U_COMUM}@teste`]);
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'PA comum', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [U_COMUM, T, `${U_COMUM}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]);
    await c.query(`DELETE FROM public.user_roles WHERE user_id = $1 AND role IN ('tenant_admin','super_admin')`, [U_COMUM]);
    if (papel) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, $2::app_role) ON CONFLICT DO NOTHING`, [U_COMUM, papel]);
    await c.query(
      `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
       SELECT $1, $2, p, true, true FROM unnest($3::text[]) p`,
      [U_COMUM, T, paginas],
    );
    // As RPCs conferem o módulo da loja ANTES do portão: garante os dois ligados (txn revertida).
    await c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules,'{}'::jsonb) || '{"produto_acabado":true,"produto_importado":true}'::jsonb WHERE tenant_id = $1`,
      [T],
    );
  });
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U_COMUM, role: "authenticated" })]);
}

const barrou = (r: string) => r.startsWith("42501") && /sem_permissao_pagina/.test(r);
const md5De = async (c: Client, fn: string) =>
  (await um<{ m: string }>(c, `SELECT md5(pg_get_functiondef(('public.'||$1)::regproc)) m`, [fn])).m;

describe.skipIf(!RODA)("portão das RPCs de preço do comprado — editar atacado", () => {
  for (const ch of CHAMADAS) {
    describe(ch.fn, () => {
      it("SÓ editar-atacado (sem página do produto, sem preco_venda): passa o portão", async () => {
        await withTx(async (c) => {
          await aplicarAmbas(c);
          await usuarioComum(c, ["criacao_planejamento:preco_atacado"]);
          const r = await tenta(c, ch.sql, [FAKE]);
          expect(barrou(r)).toBe(false);
          expect(r).toMatch(/n[ãa]o encontrado/); // chegou ao núcleo (produto inexistente)
        });
      });
      it("com preco_venda (Editor) passa; SÓ com Leitor (pode_editar=false) de preço é barrado", async () => {
        await withTx(async (c) => {
          await aplicarAmbas(c);
          await usuarioComum(c, ["criacao_planejamento:preco_venda"]);
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(false);
          await semJwt(c, () => c.query(`UPDATE public.user_permissions SET pode_editar = false WHERE user_id = $1`, [U_COMUM]));
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(true);
        });
      });
      it("sem NENHUMA chave de preço: 42501 sem_permissao_pagina (cita varejo e atacado); a página do produto SOZINHA não libera o preço", async () => {
        await withTx(async (c) => {
          await aplicarAmbas(c);
          await usuarioComum(c, ["criacao_planejamento"]);
          const r = await tenta(c, ch.sql, [FAKE]);
          expect(barrou(r)).toBe(true);
          expect(r).toMatch(/criacao_planejamento:preco_venda\|criacao_planejamento:preco_atacado/);
          await usuarioComum(c, [ch.pagina]);
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(true);
        });
      });
      it("tenant_admin SEM permissão de preço NÃO fura (42501), mesmo com a página do produto; COM a permissão passa", async () => {
        await withTx(async (c) => {
          await aplicarAmbas(c);
          await usuarioComum(c, [], "tenant_admin");
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(true);
          await usuarioComum(c, [ch.pagina], "tenant_admin");
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(true);
          await usuarioComum(c, ["criacao_planejamento:preco_atacado"], "tenant_admin");
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(false);
          await usuarioComum(c, ["criacao_planejamento:preco_venda"], "tenant_admin");
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(false);
        });
      });
      it("super_admin passa sempre (fura), sem nenhuma linha de permissão", async () => {
        await withTx(async (c) => {
          await aplicarAmbas(c);
          await usuarioComum(c, [], "super_admin");
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(false);
        });
      });
      it("inverso: devolve o portão da S3d (página do produto OU preco_venda; furável por admin) — só editar-atacado volta a ser barrado", async () => {
        await withTx(async (c) => {
          await aplicarAmbas(c);
          await aplicarArquivo(c, DOWN);
          await usuarioComum(c, ["criacao_planejamento:preco_atacado"]);
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(true);
          await usuarioComum(c, ["criacao_planejamento:preco_venda"]);
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(false);
          await usuarioComum(c, [], "tenant_admin"); // portão antigo: admin fura
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(false);
          await aplicarArquivo(c, DOWN1); // helper dropado depois do down das RPCs
          expect((await um<{ h: string | null }>(c, `SELECT to_regprocedure('public._pode_editar_preco(text)')::text h`)).h).toBeNull();
        });
      });
      it("md5: ida → depois; inverso → antes; só a linha do PERFORM muda; ACL intacta", async () => {
        await withTx(async (c) => {
          const pg = (id: string) => um<{ d: string }>(c, `SELECT pg_get_functiondef(('public.'||$1)::regproc) d`, [id]);
          const acl0 = (await um<{ a: string }>(c, `SELECT proacl::text a FROM pg_proc WHERE oid = ('public.'||$1)::regproc`, [ch.fn])).a;
          await aplicarArquivo(c, MIG1); // helper
          await aplicarArquivo(c, DOWN); // garante o estado "antes", mesmo se a ida já estiver na cópia
          expect(await md5De(c, ch.fn)).toBe(MD5[ch.fn].antes);
          const antes = (await pg(ch.fn)).d;
          await aplicarArquivo(c, MIG);
          expect(await md5De(c, ch.fn)).toBe(MD5[ch.fn].depois);
          const depois = (await pg(ch.fn)).d;
          const la = antes.split("\n"), ld = depois.split("\n");
          expect(ld.length).toBe(la.length);
          const dif = la.map((l, i) => [l, ld[i]]).filter(([a, b]) => a !== b);
          // só o portão muda: 1 linha de comentário + 1 linha de código (a PERFORM da S3d vira o IF de _pode_editar_preco)
          expect(dif.length).toBe(2);
          expect(dif[1][0]).toMatch(/_seg_exige_pagina\('[a-z_]+', 'criacao_planejamento:preco_venda'\);/);
          expect(dif[1][1]).toMatch(/^  IF NOT \(public\._pode_editar_preco\('criacao_planejamento:preco_venda'\) OR public\._pode_editar_preco\('criacao_planejamento:preco_atacado'\)\) THEN RAISE EXCEPTION 'sem_permissao_pagina: /);
          expect(dif[1][1]).not.toMatch(/user_can_edit|_seg_exige_pagina/);
          expect((await um<{ a: string }>(c, `SELECT proacl::text a FROM pg_proc WHERE oid = ('public.'||$1)::regproc`, [ch.fn])).a).toBe(acl0);
          await aplicarArquivo(c, DOWN);
          expect(await md5De(c, ch.fn)).toBe(MD5[ch.fn].antes);
        });
      });
    });
  }
});
