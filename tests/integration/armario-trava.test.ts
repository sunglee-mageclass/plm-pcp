/**
 * F7 Armario - Task A2 (banco): gatilho de trava "publicado" (migration 20261202110000). BEGIN...ROLLBACK, SO na copia local
 * (A1 + A2 aplicadas DENTRO da txn pelo harness `aplicarArquivo` - sem BEGIN/COMMIT, NUNCA \i). Pinos:
 *  - como `authenticated` (PostgREST real, SET LOCAL ROLE + JWT): armario PUBLICADO recusa UPDATE de nome/colunas/ordem, DELETE e
 *    I/U/D de item (P0001 armario_publicado_travado);
 *  - a DESPUBLICACAO (UPDATE status publicado->pronto, NADA mais) PASSA; junto de outra coluna, ou para rascunho/publicado, e recusada;
 *  - depois de despublicar, edita livre; rascunho/pronto editam livre (armario e itens); pronto->publicado (publicar) passa;
 *  - mover item de/para armario publicado e recusado;
 *  - so morde o CLIENTE: sem papel (postgres/migration), service_role e funcao SECURITY DEFINER passam; CASCADE de armario nao publicado passa;
 *  - idempotente e rollback (down) remove triggers + funcao.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const A1 = "supabase/migrations/20261202100000_armario_tabelas.sql";
const MIG = "supabase/migrations/20261202110000_armario_trava_publicado.sql";
const DOWN = "supabase/rollback/20261202110000_armario_trava_publicado_down.sql";
const T = TENANT_TESTE;
const TRAVADO = /^P0001 armario_publicado_travado:/;

async function prepara(c: Client): Promise<{ modelo: string }> {
  await aplicarArquivo(c, A1);
  await aplicarArquivo(c, MIG);
  const modelo = (await um<{ id: string }>(c, "SELECT id FROM public.modelos LIMIT 1")).id;
  await comoUsuario(c); // JWT do dono da Loja Teste (tenant ativo = T)
  return { modelo };
}

/** Roda `sql` como o papel pedido numa savepoint (a escrita e desfeita); devolve "PASSOU" ou "<code> <message>". */
async function tenta(c: Client, sql: string, params: unknown[] = [], papel: string | null = "authenticated"): Promise<string> {
  await c.query("SAVEPOINT arm_t");
  if (papel) await c.query(`SET LOCAL ROLE ${papel}`);
  try {
    await c.query(sql, params);
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    return `${er.code} ${er.message}`;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT arm_t");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT arm_t");
  }
}

async function armario(c: Client, status: string, nome = "A"): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.armarios (tenant_id, subcolecao, nome, status) VALUES ($1, 'Sub X', $2, $3) RETURNING id`,
      [T, nome, status],
    )
  ).id;
}
async function item(c: Client, arm: string, modelo: string, ordem = 1): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.armario_itens (tenant_id, armario_id, modelo_id, origem, ordem, produto_variante_id) VALUES ($1, $2, $3, 'cad', $4, gen_random_uuid()) RETURNING id`,
      [T, arm, modelo, ordem],
    )
  ).id;
}
const setStatus = async (c: Client, arm: string, s: string) => void (await c.query("UPDATE public.armarios SET status = $2 WHERE id = $1", [arm, s]));

describe.skipIf(!RODA)("Armario A2 - trava 'publicado' (gatilho so do cliente)", () => {
  it("PUBLICADO recusa (authenticated): UPDATE de nome/colunas/ordem, DELETE do armario e I/U/D de item", async () => {
    await withTx(async (c) => {
      const { modelo } = await prepara(c);
      const a = await armario(c, "rascunho");
      const outro = await armario(c, "rascunho", "B");
      const it1 = await item(c, a, modelo, 1);
      await item(c, outro, modelo, 1);
      await setStatus(c, a, "publicado"); // como postgres (migration/RPC): passa

      expect(await tenta(c, `UPDATE public.armarios SET nome = 'x' WHERE id = $1`, [a])).toMatch(TRAVADO);
      expect(await tenta(c, `UPDATE public.armarios SET colunas = 6 WHERE id = $1`, [a])).toMatch(TRAVADO);
      expect(await tenta(c, `UPDATE public.armarios SET ordem = 3 WHERE id = $1`, [a])).toMatch(TRAVADO);
      expect(await tenta(c, `DELETE FROM public.armarios WHERE id = $1`, [a])).toMatch(TRAVADO);
      // item: I/U/D
      expect(await tenta(c, `UPDATE public.armario_itens SET ordem = 9 WHERE id = $1`, [it1])).toMatch(TRAVADO);
      expect(await tenta(c, `DELETE FROM public.armario_itens WHERE id = $1`, [it1])).toMatch(TRAVADO);
      expect(
        await tenta(c, `INSERT INTO public.armario_itens (armario_id, modelo_id, origem, ordem, produto_variante_id) VALUES ($1, $2, 'cad', 2, gen_random_uuid())`, [a, modelo]),
      ).toMatch(TRAVADO);
      // mover item de um armario livre PARA o publicado, e DO publicado para o livre
      const itB = (await c.query(`SELECT id FROM public.armario_itens WHERE armario_id = $1`, [outro])).rows[0].id;
      expect(await tenta(c, `UPDATE public.armario_itens SET armario_id = $2 WHERE id = $1`, [itB, a])).toMatch(TRAVADO);
      expect(await tenta(c, `UPDATE public.armario_itens SET armario_id = $2 WHERE id = $1`, [it1, outro])).toMatch(TRAVADO);
      // o armario publicado nao mudou de nada
      const r = await um<any>(c, `SELECT nome, colunas, ordem, status FROM public.armarios WHERE id = $1`, [a]);
      expect(r).toEqual({ nome: "A", colunas: 5, ordem: 0, status: "publicado" });
      expect((await c.query(`SELECT 1 FROM public.armario_itens WHERE armario_id = $1`, [a])).rowCount).toBe(1);
      // a recusa e do gatilho (nao do RLS): o armario continua visivel ao cliente
      await c.query("SET LOCAL ROLE authenticated");
      expect((await c.query(`SELECT 1 FROM public.armarios WHERE id = $1`, [a])).rowCount).toBe(1);
      await c.query("RESET ROLE");
    });
  });

  it("DESPUBLICAR (status publicado->pronto, so isso) PASSA; com outra coluna junto, ou para outro status, e recusado; depois edita livre", async () => {
    await withTx(async (c) => {
      const { modelo } = await prepara(c);
      const a = await armario(c, "publicado");
      const it1 = await item(c, a, modelo, 1);

      expect(await tenta(c, `UPDATE public.armarios SET status = 'pronto' WHERE id = $1`, [a])).toBe("PASSOU");
      // junto de outra coluna: recusa
      expect(await tenta(c, `UPDATE public.armarios SET status = 'pronto', nome = 'x' WHERE id = $1`, [a])).toMatch(TRAVADO);
      expect(await tenta(c, `UPDATE public.armarios SET status = 'pronto', colunas = 7 WHERE id = $1`, [a])).toMatch(TRAVADO);
      // para outro status que nao 'pronto' (ou republicar sem mudar): recusa
      expect(await tenta(c, `UPDATE public.armarios SET status = 'rascunho' WHERE id = $1`, [a])).toMatch(TRAVADO);
      expect(await tenta(c, `UPDATE public.armarios SET status = 'publicado' WHERE id = $1`, [a])).toMatch(TRAVADO);
      // item continua travado ate de fato despublicar
      expect(await tenta(c, `UPDATE public.armario_itens SET ordem = 9 WHERE id = $1`, [it1])).toMatch(TRAVADO);

      // despublica de verdade (como cliente, persistindo) -> edita livre
      await c.query("SET LOCAL ROLE authenticated");
      await c.query(`UPDATE public.armarios SET status = 'pronto' WHERE id = $1`, [a]);
      await c.query(`UPDATE public.armarios SET nome = 'novo', colunas = 8 WHERE id = $1`, [a]);
      await c.query(`UPDATE public.armario_itens SET ordem = 9 WHERE id = $1`, [it1]);
      await c.query(`INSERT INTO public.armario_itens (armario_id, modelo_id, origem, ordem, produto_variante_id) VALUES ($1, $2, 'cad', 2, gen_random_uuid())`, [a, modelo]);
      await c.query(`DELETE FROM public.armario_itens WHERE id = $1`, [it1]);
      await c.query("RESET ROLE");
      const r = await um<any>(c, `SELECT nome, colunas, status FROM public.armarios WHERE id = $1`, [a]);
      expect(r).toEqual({ nome: "novo", colunas: 8, status: "pronto" });
    });
  });

  it("rascunho e pronto editam livre (armario e itens); pronto->publicado (publicar) passa e passa a travar", async () => {
    await withTx(async (c) => {
      const { modelo } = await prepara(c);
      for (const st of ["rascunho", "pronto"]) {
        const a = await armario(c, st, `L-${st}`);
        const i = await item(c, a, modelo, 1);
        expect(await tenta(c, `UPDATE public.armarios SET nome = 'z' WHERE id = $1`, [a])).toBe("PASSOU");
        expect(await tenta(c, `UPDATE public.armarios SET status = 'publicado' WHERE id = $1`, [a])).toBe("PASSOU");
        expect(await tenta(c, `UPDATE public.armario_itens SET ordem = 4 WHERE id = $1`, [i])).toBe("PASSOU");
        expect(await tenta(c, `INSERT INTO public.armario_itens (armario_id, modelo_id, origem, ordem, produto_variante_id) VALUES ($1, $2, 'cad', 2, gen_random_uuid())`, [a, modelo])).toBe("PASSOU");
        expect(await tenta(c, `DELETE FROM public.armario_itens WHERE id = $1`, [i])).toBe("PASSOU");
        expect(await tenta(c, `DELETE FROM public.armarios WHERE id = $1`, [a])).toBe("PASSOU");
      }
      // INSERT de armario novo (qualquer status inicial permitido pelo CHECK) nao e travado
      expect(await tenta(c, `INSERT INTO public.armarios (subcolecao, nome) VALUES ('S', 'novo')`)).toBe("PASSOU");
      // publicar de verdade e depois travar
      const a = await armario(c, "pronto", "P");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query(`UPDATE public.armarios SET status = 'publicado' WHERE id = $1`, [a]);
      await c.query("RESET ROLE");
      expect(await tenta(c, `UPDATE public.armarios SET nome = 'w' WHERE id = $1`, [a])).toMatch(TRAVADO);
    });
  });

  it("so morde o CLIENTE: sem papel (migration/psql), service_role e funcao SECURITY DEFINER passam no armario publicado", async () => {
    await withTx(async (c) => {
      const { modelo } = await prepara(c);
      const a = await armario(c, "publicado");
      const it1 = await item(c, a, modelo, 1); // sem papel: passou (INSERT em armario publicado)
      // sem papel e sem JWT (migration/psql)
      await c.query("SELECT set_config('request.jwt.claims', '', true)");
      expect(await tenta(c, `UPDATE public.armarios SET nome = 'm' WHERE id = $1`, [a], null)).toBe("PASSOU");
      expect(await tenta(c, `UPDATE public.armario_itens SET ordem = 5 WHERE id = $1`, [it1], null)).toBe("PASSOU");
      // service_role (Worker)
      expect(await tenta(c, `UPDATE public.armarios SET nome = 's' WHERE id = $1`, [a], "service_role")).toBe("PASSOU");
      expect(await tenta(c, `UPDATE public.armario_itens SET ordem = 6 WHERE id = $1`, [it1], "service_role")).toBe("PASSOU");
      expect(await tenta(c, `DELETE FROM public.armario_itens WHERE id = $1`, [it1], "service_role")).toBe("PASSOU");
      // anon (sem grant) continua recusado pelo privilegio, nao e liberado pelo gatilho
      expect(await tenta(c, `UPDATE public.armarios SET nome = 'x' WHERE id = $1`, [a], "anon")).toMatch(/^42501 /);

      // funcao SECURITY DEFINER (dono postgres), chamada por um cliente com JWT: passa (RPC confere o proprio estado)
      await c.query(`CREATE FUNCTION public._t_armario_def(p uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
                       AS $$ UPDATE public.armarios SET nome = 'via-rpc' WHERE id = p; $$`);
      await c.query(`GRANT EXECUTE ON FUNCTION public._t_armario_def(uuid) TO authenticated`);
      await comoUsuario(c);
      expect(await tenta(c, `SELECT public._t_armario_def($1)`, [a])).toBe("PASSOU");
      // e o mesmo UPDATE direto, como cliente, continua recusado
      expect(await tenta(c, `UPDATE public.armarios SET nome = 'direto' WHERE id = $1`, [a])).toMatch(TRAVADO);
    });
  });

  it("CASCADE: apagar armario NAO publicado leva os itens (como cliente); idempotente; a funcao nao e chamavel direto", async () => {
    await withTx(async (c) => {
      const { modelo } = await prepara(c);
      await aplicarArquivo(c, MIG); // 2a aplicacao nao falha
      const a = await armario(c, "pronto");
      await item(c, a, modelo, 1);
      await item(c, a, modelo, 2);
      expect(await tenta(c, `DELETE FROM public.armarios WHERE id = $1`, [a])).toBe("PASSOU");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query(`DELETE FROM public.armarios WHERE id = $1`, [a]);
      await c.query("RESET ROLE");
      expect((await c.query(`SELECT 1 FROM public.armario_itens WHERE armario_id = $1`, [a])).rowCount).toBe(0);
      expect(await tenta(c, `SELECT public.fn_armario_trava_publicado()`)).toMatch(/^42501 /);
      const trg = await c.query(
        `SELECT tgrelid::regclass::text t, tgname FROM pg_trigger WHERE tgname = 'trg_aaa_armario_trava' AND NOT tgisinternal ORDER BY 1`,
      );
      expect(trg.rows).toEqual([
        { t: "armario_itens", tgname: "trg_aaa_armario_trava" },
        { t: "armarios", tgname: "trg_aaa_armario_trava" },
      ]);
    });
  });

  it("rollback (down): remove os 2 triggers + a funcao; depois disso o cliente edita o publicado", async () => {
    await withTx(async (c) => {
      const { modelo } = await prepara(c);
      const a = await armario(c, "publicado");
      await item(c, a, modelo, 1);
      expect(await tenta(c, `UPDATE public.armarios SET nome = 'x' WHERE id = $1`, [a])).toMatch(TRAVADO);
      await aplicarArquivo(c, DOWN);
      expect((await c.query(`SELECT 1 FROM pg_trigger WHERE tgname = 'trg_aaa_armario_trava'`)).rowCount).toBe(0);
      expect((await c.query(`SELECT 1 FROM pg_proc WHERE proname = 'fn_armario_trava_publicado'`)).rowCount).toBe(0);
      expect(await tenta(c, `UPDATE public.armarios SET nome = 'x' WHERE id = $1`, [a])).toBe("PASSOU");
      await aplicarArquivo(c, DOWN); // idempotente
    });
  });
});
