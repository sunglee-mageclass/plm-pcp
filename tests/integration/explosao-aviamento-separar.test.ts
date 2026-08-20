import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import type { Client } from "pg";

// "A separar/enviar" do AVIAMENTO editável por aviamento×variante (migration
// 20260820160000): _enviar_modelo_para_cad_core copia variante_aviamento_id, e a RPC
// salvar_explosao_aviamento_separar grava cad_aviamentos.quantidade_separar por grupo.
// Tudo em txn revertida (BEGIN…ROLLBACK) — nada é gravado.

const T = TENANT_TESTE;

/** cad da Loja Teste que tem ≥1 aviamento repetido (≥2 entradas do mesmo aviamento). */
async function cadComAviamentoRepetido(c: Client) {
  return um<{ cad_id: string; aviamento_id: string; n: number }>(
    c,
    `SELECT ca.cad_id, ca.aviamento_id, count(*)::int AS n
       FROM public.cad_aviamentos ca
       JOIN public.cad k ON k.id = ca.cad_id
      WHERE k.tenant_id = $1
      GROUP BY ca.cad_id, ca.aviamento_id
     HAVING count(*) >= 2
      LIMIT 1`,
    [T],
  );
}

/** Cria uma variante de aviamento (cor qualquer do tenant) e retorna seu id. */
async function novaVariante(c: Client, aviamentoId: string): Promise<string> {
  const cor = await um<{ id: string }>(c, `SELECT id FROM public.cores WHERE tenant_id = $1 LIMIT 1`, [T]);
  const v = await um<{ id: string }>(
    c,
    `INSERT INTO public.variantes_aviamento (tenant_id, aviamento_id, cor_id)
     VALUES ($1, $2, $3) RETURNING id`,
    [T, aviamentoId, cor.id],
  );
  return v.id;
}

describe.skipIf(!hasDb)("Explosão — a-separar do aviamento por variante", () => {
  it("salvar_explosao_aviamento_separar: valor cheio na menor numero, resto zera, Σ = valor", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const alvo = await cadComAviamentoRepetido(c);
      if (!alvo) return; // Loja Teste sem aviamento repetido → auto-skip

      const vid = await novaVariante(c, alvo.aviamento_id);
      // marca a variante nas entradas do grupo (simula item 2 / backfill).
      await c.query(
        `UPDATE public.cad_aviamentos SET variante_aviamento_id = $3
          WHERE cad_id = $1 AND aviamento_id = $2`,
        [alvo.cad_id, alvo.aviamento_id, vid],
      );

      await c.query(
        `SELECT public.salvar_explosao_aviamento_separar($1, $2::jsonb)`,
        [alvo.cad_id, JSON.stringify([{ aviamento_id: alvo.aviamento_id, variante_aviamento_id: vid, quantidade_separar: 77 }])],
      );

      const dist = await c.query(
        `SELECT numero, quantidade_separar FROM public.cad_aviamentos
          WHERE cad_id = $1 AND aviamento_id = $2 AND variante_aviamento_id = $3
          ORDER BY numero`,
        [alvo.cad_id, alvo.aviamento_id, vid],
      );
      const soma = dist.rows.reduce((s: number, r: any) => s + Number(r.quantidade_separar), 0);
      const naoZero = dist.rows.filter((r: any) => Number(r.quantidade_separar) !== 0);
      expect(soma).toBeCloseTo(77, 6); // Σ do grupo == valor editado
      expect(naoZero).toHaveLength(1); // só UMA entrada carrega o valor (menor numero)
      expect(Number(naoZero[0].quantidade_separar)).toBeCloseTo(77, 6);
      // a entrada carregada é a de MENOR numero do grupo.
      const menorNumero = Math.min(...dist.rows.map((r: any) => Number(r.numero)));
      expect(Number(naoZero[0].numero)).toBe(menorNumero);
    });
  });

  it("legado SEM variante (grupo variante NULL) é editável e grava certo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const alvo = await cadComAviamentoRepetido(c);
      if (!alvo) return;
      // zera a variante do grupo (legado sem variante).
      await c.query(
        `UPDATE public.cad_aviamentos SET variante_aviamento_id = NULL
          WHERE cad_id = $1 AND aviamento_id = $2`,
        [alvo.cad_id, alvo.aviamento_id],
      );
      await c.query(
        `SELECT public.salvar_explosao_aviamento_separar($1, $2::jsonb)`,
        [alvo.cad_id, JSON.stringify([{ aviamento_id: alvo.aviamento_id, variante_aviamento_id: null, quantidade_separar: 12 }])],
      );
      const soma = await um<{ s: string }>(
        c,
        `SELECT sum(quantidade_separar)::text AS s FROM public.cad_aviamentos
          WHERE cad_id = $1 AND aviamento_id = $2 AND variante_aviamento_id IS NULL`,
        [alvo.cad_id, alvo.aviamento_id],
      );
      expect(Number(soma.s)).toBeCloseTo(12, 6);
    });
  });

  it("grupo sem entrada no CAD → no-op (não cria linha)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const alvo = await cadComAviamentoRepetido(c);
      if (!alvo) return;
      const antes = await um<{ n: string }>(c, `SELECT count(*)::text AS n FROM public.cad_aviamentos WHERE cad_id = $1`, [alvo.cad_id]);
      await c.query(
        `SELECT public.salvar_explosao_aviamento_separar($1, $2::jsonb)`,
        [alvo.cad_id, JSON.stringify([{ aviamento_id: "00000000-0000-0000-0000-0000000000ff", quantidade_separar: 9 }])],
      );
      const depois = await um<{ n: string }>(c, `SELECT count(*)::text AS n FROM public.cad_aviamentos WHERE cad_id = $1`, [alvo.cad_id]);
      expect(depois.n).toBe(antes.n); // nada inserido
    });
  });

  it("_enviar_modelo_para_cad_core (fresh) copia variante_aviamento_id do BOM p/ o CAD", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // modelo da Loja Teste com aviamentos no BOM e status que passa o gate ('aprovado').
      const m = await um<{ id: string }>(
        c,
        `SELECT DISTINCT m.id FROM public.modelos m
           JOIN public.modelo_aviamentos ma ON ma.modelo_id = m.id
          WHERE m.tenant_id = $1 LIMIT 1`,
        [T],
      );
      if (!m) return;

      // aviamento do BOM p/ criar a variante e apontá-la.
      const bom = await um<{ aviamento_id: string }>(
        c,
        `SELECT aviamento_id FROM public.modelo_aviamentos WHERE modelo_id = $1 AND aviamento_id IS NOT NULL LIMIT 1`,
        [m.id],
      );
      if (!bom) return;
      const vid = await novaVariante(c, bom.aviamento_id);
      await c.query(`UPDATE public.modelo_aviamentos SET variante_aviamento_id = $2 WHERE modelo_id = $1 AND aviamento_id = $3`, [m.id, vid, bom.aviamento_id]);

      // força materialização do zero: apaga o CAD + dependentes NO ACTION (o resto cascateia)
      // e re-envia. Tudo revertido no ROLLBACK.
      const cadIds = `SELECT id FROM public.cad WHERE modelo_id = $1`;
      await c.query(`DELETE FROM public.estoque_tecido_baixas WHERE cad_id IN (${cadIds})`, [m.id]);
      await c.query(`DELETE FROM public.lancamentos WHERE cad_id IN (${cadIds})`, [m.id]);
      await c.query(`DELETE FROM public.cad WHERE modelo_id = $1`, [m.id]);
      await c.query(`UPDATE public.modelos SET status_desenvolvimento = 'aprovado' WHERE id = $1`, [m.id]);
      await c.query(`UPDATE public.tenant_config SET explosao_envio_status = NULL WHERE tenant_id = $1`, [T]);

      await c.query(`SELECT public._enviar_modelo_para_cad_core($1)`, [m.id]);

      const copiado = await um<{ n: string }>(
        c,
        `SELECT count(*)::text AS n FROM public.cad_aviamentos ca
           JOIN public.cad k ON k.id = ca.cad_id
          WHERE k.modelo_id = $1 AND ca.aviamento_id = $2 AND ca.variante_aviamento_id = $3`,
        [m.id, bom.aviamento_id, vid],
      );
      expect(Number(copiado.n)).toBeGreaterThanOrEqual(1); // a variante viajou p/ o CAD
    });
  });

  it("tenant isolation: não-super de outra loja não grava (RAISE Sem permissão)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); // super_admin fixa o tenant; depois trocamos o JWT p/ um não-super
      const alvo = await cadComAviamentoRepetido(c);
      if (!alvo) return;
      const outro = await um<{ id: string }>(
        c,
        `SELECT u.id FROM public.users u
          WHERE u.tenant_id <> $1 AND u.tenant_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role = 'super_admin')
          LIMIT 1`,
        [T],
      );
      if (!outro) return;
      await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: outro.id, role: "authenticated" })]);
      await c.query("SAVEPOINT sp");
      let erro: any;
      try {
        await c.query(`SELECT public.salvar_explosao_aviamento_separar($1, $2::jsonb)`, [
          alvo.cad_id,
          JSON.stringify([{ aviamento_id: alvo.aviamento_id, quantidade_separar: 1 }]),
        ]);
      } catch (e) {
        erro = e;
      }
      await c.query("ROLLBACK TO SAVEPOINT sp");
      expect(erro).toBeDefined();
      expect(String(erro.message)).toMatch(/Sem permissão/);
    });
  });
});
