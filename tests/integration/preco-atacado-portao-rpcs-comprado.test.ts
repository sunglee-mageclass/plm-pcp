// Portão das 3 RPCs de preço do COMPRADO (salvar_precos_fixo_produto_acabado, salvar_markups_produto_acabado,
// salvar_precos_fixo_produto_importado) ganha a chave EDITAR ATACADO (criacao_planejamento:preco_atacado), em OU com a página do produto e
// com preco_venda. SÓ na cópia local (DDL em txn revertida). O produto passado NÃO existe: o portão roda ANTES do núcleo, então
// "PASSOU o portão" = a recusa NÃO é sem_permissao_pagina (cai no nao_encontrado do núcleo); "barrou" = 42501 sem_permissao_pagina.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const MIG = "supabase/migrations/20261211110000_preco_atacado_portao_rpcs_comprado.sql";
const DOWN = "supabase/rollback/20261211110000_preco_atacado_portao_rpcs_comprado_down.sql";
const T = TENANT_TESTE;
const FAKE = "00000000-0000-4000-8000-0000000000aa";

const MD5: Record<string, { antes: string; depois: string }> = {
  salvar_precos_fixo_produto_acabado: { antes: "815583deca5487c3c7b450d5e6db1bfc", depois: "b842360d472acf66eb5b1dfe48427226" },
  salvar_markups_produto_acabado: { antes: "1f266f1908cf4918b4a0a9d868565f92", depois: "caa171cde24a682ebcabe2288426b95f" },
  salvar_precos_fixo_produto_importado: { antes: "a277b0dcc67cacf0658ba771cc8d87a7", depois: "442fb620618d50408253d6af4e880941" },
};

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
async function usuarioComum(c: Client, paginas: string[]): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U_COMUM, `${U_COMUM}@teste`]);
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'PA comum', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [U_COMUM, T, `${U_COMUM}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]);
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
          await aplicarArquivo(c, MIG);
          await usuarioComum(c, ["criacao_planejamento:preco_atacado"]);
          const r = await tenta(c, ch.sql, [FAKE]);
          expect(barrou(r)).toBe(false);
          expect(r).toMatch(/n[ãa]o encontrado/); // chegou ao núcleo (produto inexistente)
        });
      });
      it("sem NENHUMA das 3 chaves: 42501 sem_permissao_pagina (cita a chave de atacado)", async () => {
        await withTx(async (c) => {
          await aplicarArquivo(c, MIG);
          await usuarioComum(c, ["criacao_planejamento"]);
          const r = await tenta(c, ch.sql, [FAKE]);
          expect(barrou(r)).toBe(true);
          expect(r).toMatch(/criacao_planejamento:preco_atacado/);
        });
      });
      it("retrocompat: com a página do produto OU com preco_venda continua passando", async () => {
        await withTx(async (c) => {
          await aplicarArquivo(c, MIG);
          await usuarioComum(c, [ch.pagina]);
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(false);
          await usuarioComum(c, ["criacao_planejamento:preco_venda"]);
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(false);
        });
      });
      it("inverso: devolve o par — só editar-atacado volta a ser barrado; com preco_venda segue passando", async () => {
        await withTx(async (c) => {
          await aplicarArquivo(c, MIG);
          await aplicarArquivo(c, DOWN);
          await usuarioComum(c, ["criacao_planejamento:preco_atacado"]);
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(true);
          await usuarioComum(c, ["criacao_planejamento:preco_venda"]);
          expect(barrou(await tenta(c, ch.sql, [FAKE]))).toBe(false);
        });
      });
      it("md5: ida → depois; inverso → antes; só a linha do PERFORM muda; ACL intacta", async () => {
        await withTx(async (c) => {
          const pg = (id: string) => um<{ d: string }>(c, `SELECT pg_get_functiondef(('public.'||$1)::regproc) d`, [id]);
          const acl0 = (await um<{ a: string }>(c, `SELECT proacl::text a FROM pg_proc WHERE oid = ('public.'||$1)::regproc`, [ch.fn])).a;
          await aplicarArquivo(c, DOWN); // garante o estado "antes", mesmo se a ida já estiver na cópia
          expect(await md5De(c, ch.fn)).toBe(MD5[ch.fn].antes);
          const antes = (await pg(ch.fn)).d;
          await aplicarArquivo(c, MIG);
          expect(await md5De(c, ch.fn)).toBe(MD5[ch.fn].depois);
          const depois = (await pg(ch.fn)).d;
          const la = antes.split("\n"), ld = depois.split("\n");
          expect(ld.length).toBe(la.length);
          const dif = la.map((l, i) => [l, ld[i]]).filter(([a, b]) => a !== b);
          expect(dif.length).toBe(1);
          expect(dif[0][0]).toMatch(/_seg_exige_pagina\('[a-z_]+', 'criacao_planejamento:preco_venda'\);/);
          expect(dif[0][1]).toBe(dif[0][0].replace(/\);$/, ", 'criacao_planejamento:preco_atacado');"));
          expect((await um<{ a: string }>(c, `SELECT proacl::text a FROM pg_proc WHERE oid = ('public.'||$1)::regproc`, [ch.fn])).a).toBe(acl0);
          await aplicarArquivo(c, DOWN);
          expect(await md5De(c, ch.fn)).toBe(MD5[ch.fn].antes);
        });
      });
    });
  }
});
