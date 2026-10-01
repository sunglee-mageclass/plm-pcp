// Achados MÉDIOS — release R14, sku #18 (P-88 A). Migration 20261024210000_espelho_ref_ao_vincular.sql
// (+ correção única opcional 20261024210100_espelho_ref_correcao_unica.sql).
//   Vincular um produto comprado ao card (o Sheet cria o produto pela RPC e liga com `.update({modelo_id})`) leva a REF do
//   produto ao card — só se a REF do card está VAZIA e o card ainda NÃO foi à Explosão (enviado_cad). REF manual nunca é
//   sobrescrita. Sem loop com o espelho de nome/REF; nenhuma recusa nova.
// Só na CÓPIA LOCAL, txn revertida (BEGIN…ROLLBACK): nada é gravado. Fixture ausente = FALHA (nunca passa calado).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import { LOCAL, U, aplica } from "./integracao-helpers";

const T = TENANT_TESTE;
const SIG = "public.fn_espelho_ref_ao_vincular()";
const MD5_FN = "6baf719f2041243c7e340e618e5489f0";
const CORRECAO = "supabase/migrations/20261024210100_espelho_ref_correcao_unica.sql";
const TDEF = (tab: string) =>
  `CREATE TRIGGER trg_espelho_ref_ao_vincular AFTER UPDATE OF modelo_id ON public.${tab} FOR EACH ROW WHEN (((new.modelo_id IS NOT NULL) AND (old.modelo_id IS DISTINCT FROM new.modelo_id))) EXECUTE FUNCTION fn_espelho_ref_ao_vincular()`;

type Tipo = "PA" | "PI";
const TAB: Record<Tipo, string> = { PA: "produtos_acabados", PI: "produtos_importados" };
const ORIGEM: Record<Tipo, string> = { PA: "revenda", PI: "importado" };

async function categoria(c: Client): Promise<{ cat: string; grupo: string }> {
  const r = await um<{ cat: string; grupo: string } | undefined>(
    c,
    `SELECT c.id AS cat, c.grupo_id AS grupo FROM public.categorias_produto c JOIN public.grupos_produto g ON g.id = c.grupo_id
      WHERE c.tenant_id = $1 AND lower(g.nome) NOT LIKE '%acessor%' ORDER BY c.id LIMIT 1`,
    [T],
  );
  if (!r)
    throw new Error("fixture ausente: categoria (fora de Acessórios) com grupo na Loja Teste");
  return r;
}
/** Card comprado como o Sheet salva (origem revenda/importado, sem REF). */
async function card(c: Client, tipo: Tipo, campos: Record<string, unknown> = {}): Promise<string> {
  const k = await categoria(c);
  const cols: Record<string, unknown> = {
    tenant_id: T,
    nome: `R14 sku18 ${tipo} ${Math.random().toString(36).slice(2, 8)}`,
    origem: ORIGEM[tipo],
    categoria_principal_id: k.cat,
    ...campos,
  };
  const nomes = Object.keys(cols);
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelos (${nomes.join(", ")}) VALUES (${nomes.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      Object.values(cols),
    )
  ).id;
}
/** Produto criado pela MESMA RPC do Sheet (salvar_produto_acabado / salvar_produto_importado, sem vínculo). */
async function produtoPeloSheet(
  c: Client,
  tipo: Tipo,
  nome: string,
): Promise<{ id: string; ref: string }> {
  const k = await categoria(c);
  const dados = JSON.stringify({ nome, grupo_id: k.grupo, categoria_id: k.cat });
  const id =
    tipo === "PA"
      ? (
          await um<{ id: string }>(
            c,
            `SELECT public.salvar_produto_acabado(NULL, $1::jsonb, '[]'::jsonb) AS id`,
            [dados],
          )
        ).id
      : (
          await um<{ id: string }>(
            c,
            `SELECT public.salvar_produto_importado(NULL::uuid, $1::jsonb, '[]'::jsonb, '[]'::jsonb, NULL::integer) AS id`,
            [dados],
          )
        ).id;
  const ref = (
    await um<{ ref: string | null }>(c, `SELECT ref FROM public.${TAB[tipo]} WHERE id = $1`, [id])
  ).ref;
  if (!id || !ref) throw new Error(`fixture: produto ${tipo} sem id/REF depois da RPC do Sheet`);
  return { id, ref };
}
/** O `.update({modelo_id})` do Sheet: como `authenticated` (RLS ligada), via PostgREST. */
async function vincularComoSheet(
  c: Client,
  tipo: Tipo,
  produtoId: string,
  modeloId: string,
): Promise<void> {
  await c.query("SET LOCAL ROLE authenticated");
  try {
    const r = await c.query(`UPDATE public.${TAB[tipo]} SET modelo_id = $2 WHERE id = $1`, [
      produtoId,
      modeloId,
    ]);
    if (r.rowCount !== 1)
      throw new Error(`fixture: o UPDATE do vínculo (${tipo}) não pegou a linha (RLS?)`);
  } finally {
    await c.query("RESET ROLE");
  }
}
const refCard = async (c: Client, id: string) =>
  (await um<{ ref: string | null }>(c, `SELECT ref FROM public.modelos WHERE id = $1`, [id])).ref;

describe.skipIf(!hasDb)("R14 sku #18 — objetos (20261024210000)", () => {
  it("função com o texto da migration, sem EXECUTE p/ PUBLIC/anon/authenticated; gatilhos nas 2 tabelas, ligados, com a definição", async () => {
    await withTx(async (c) => {
      const f = await um<{ m: string | null; a: boolean; u: boolean; p: boolean }>(
        c,
        `SELECT CASE WHEN to_regprocedure($1) IS NULL THEN NULL ELSE md5(pg_get_functiondef(to_regprocedure($1))) END AS m,
                coalesce(has_function_privilege('anon', to_regprocedure($1), 'EXECUTE'), true) a,
                coalesce(has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE'), true) u,
                EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                         WHERE p.oid = to_regprocedure($1) AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') p`,
        [SIG],
      );
      expect(f).toEqual({ m: MD5_FN, a: false, u: false, p: false });
      for (const tab of ["produtos_acabados", "produtos_importados"]) {
        const t = await um<{ d: string | null }>(
          c,
          `SELECT pg_get_triggerdef(t.oid) AS d FROM pg_trigger t
            WHERE t.tgname = 'trg_espelho_ref_ao_vincular' AND t.tgrelid = to_regclass('public.' || $1) AND t.tgenabled = 'O'`,
          [tab],
        );
        expect(t?.d ?? null, tab).toBe(TDEF(tab));
      }
    });
  });
});

describe.skipIf(!hasDb || !LOCAL)("R14 sku #18 — vincular leva a REF ao card (P-88 A)", () => {
  for (const tipo of ["PA", "PI"] as const) {
    it(`${tipo}: produto criado pelo Sheet + vínculo .update({modelo_id}) como authenticated → o card sem REF recebe a REF do produto; o produto não muda (sem loop)`, async () => {
      await withTx(async (c) => {
        await comoUsuario(c, U);
        const mid = await card(c, tipo);
        expect(await refCard(c, mid)).toBeNull();
        const p = await produtoPeloSheet(c, tipo, `R14 sku18 ${tipo} prod`);
        const antes = await um<{ rev: number; ref: string }>(
          c,
          `SELECT rev, ref FROM public.${TAB[tipo]} WHERE id = $1`,
          [p.id],
        );
        await vincularComoSheet(c, tipo, p.id, mid);
        expect(await refCard(c, mid)).toBe(p.ref);
        const depois = await um<{ rev: number; ref: string }>(
          c,
          `SELECT rev, ref FROM public.${TAB[tipo]} WHERE id = $1`,
          [p.id],
        );
        expect(depois.ref).toBe(antes.ref);
        expect(depois.rev).toBe(antes.rev + 1); // só o UPDATE do vínculo (o espelho card→produto não regrava)
      });
    });
  }

  it("NÃO copia: card já enviado à Explosão; card com REF manual; card de OUTRO produto trocando de vínculo não perde a REF", async () => {
    await withTx(async (c) => {
      await comoUsuario(c, U);
      const enviado = await card(c, "PA", { enviado_cad: true });
      const p1 = await produtoPeloSheet(c, "PA", "R14 sku18 enviado");
      await vincularComoSheet(c, "PA", p1.id, enviado);
      expect(await refCard(c, enviado)).toBeNull();

      const manual = await card(c, "PI", { ref: "MANUAL-R14" });
      const p2 = await produtoPeloSheet(c, "PI", "R14 sku18 manual");
      await vincularComoSheet(c, "PI", p2.id, manual);
      expect(await refCard(c, manual)).toBe("MANUAL-R14");
    });
  });

  it("vínculo que NÃO muda (UPDATE de outra coluna / mesmo modelo_id) não mexe no card; desvincular (NULL) não mexe", async () => {
    await withTx(async (c) => {
      await comoUsuario(c, U);
      const mid = await card(c, "PA");
      const p = await produtoPeloSheet(c, "PA", "R14 sku18 nao muda");
      await vincularComoSheet(c, "PA", p.id, mid);
      expect(await refCard(c, mid)).toBe(p.ref);
      await c.query(`UPDATE public.modelos SET ref = NULL WHERE id = $1`, [mid]); // simula card sem REF já vinculado
      await c.query(
        `UPDATE public.produtos_acabados SET modelo_id = modelo_id, qtd_total = coalesce(qtd_total, 0) WHERE id = $1`,
        [p.id],
      );
      expect(await refCard(c, mid)).toBeNull();
      await c.query(`UPDATE public.produtos_acabados SET modelo_id = NULL WHERE id = $1`, [p.id]);
      expect(await refCard(c, mid)).toBeNull();
    });
  });
});

describe.skipIf(!hasDb || !LOCAL)("R14 sku #18 — correção única (20261024210100, opcional)", () => {
  it("card já vinculado sem REF (vínculo feito no INSERT) recebe a REF; enviado/manual ficam; rodar de novo = 0", async () => {
    await withTx(async (c) => {
      await comoUsuario(c, U);
      await c.query("SET LOCAL lock_timeout = '3s'");
      const alvo = await card(c, "PA");
      const enviado = await card(c, "PA", { enviado_cad: true });
      const manual = await card(c, "PI", { ref: "MANUAL-R14C" });
      const pa1 = await um<{ id: string }>(
        c,
        `INSERT INTO public.produtos_acabados (tenant_id, nome, ref, modelo_id) VALUES ($1, 'R14 c1', 'RVDR14C1', $2) RETURNING id`,
        [T, alvo],
      );
      await c.query(
        `INSERT INTO public.produtos_acabados (tenant_id, nome, ref, modelo_id) VALUES ($1, 'R14 c2', 'RVDR14C2', $2)`,
        [T, enviado],
      );
      await c.query(
        `INSERT INTO public.produtos_importados (tenant_id, nome, ref, modelo_id) VALUES ($1, 'R14 c3', 'IMPR14C3', $2)`,
        [T, manual],
      );
      if (!pa1.id) throw new Error("fixture: produto não criado");
      expect(await refCard(c, alvo)).toBeNull(); // o INSERT já vinculado não dispara o gatilho (UPDATE OF modelo_id)
      const avisos: string[] = [];
      const ouvir = (m: { message?: string }) => avisos.push(String(m.message));
      c.on("notice", ouvir);
      try {
        const st = (await um<{ v: string }>(c, "SELECT current_setting('statement_timeout') AS v"))
          .v;
        await aplica(c, CORRECAO);
        await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
        expect(await refCard(c, alvo)).toBe("RVDR14C1");
        expect(await refCard(c, enviado)).toBeNull();
        expect(await refCard(c, manual)).toBe("MANUAL-R14C");
        expect(avisos.some((a) => a.includes(alvo) && a.includes("RVDR14C1"))).toBe(true);
        const n1 = avisos.find((a) => /card\(s\) receberam a REF/.test(a));
        expect(n1).toBeTruthy();
        avisos.length = 0;
        await aplica(c, CORRECAO);
        await c.query("SELECT set_config('statement_timeout', $1, true)", [st]);
        expect(avisos.find((a) => /card\(s\) receberam a REF/.test(a))).toMatch(/: 0 card\(s\)/);
      } finally {
        c.off("notice", ouvir);
      }
    });
  });
});
