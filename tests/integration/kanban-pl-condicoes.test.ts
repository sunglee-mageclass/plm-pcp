/**
 * Kanban PL configurável — Onda 1, bloco C: avaliador SQL `avaliar_condicoes_etapas_pl(_ids)`.
 * Cada modelo da loja recebe as 8 keys do catálogo TS (CONDICOES_PL). ANTI-DRIFT: as keys que o
 * SQL devolve == as keys do catálogo (branch no SQL ⇄ key no TS).
 *
 * Tudo em BEGIN…ROLLBACK (`withTx`) e SÓ na cópia local (`ehBancoLocal`): a migration
 * `20261126110000_kanban_pl_avaliador.sql` é aplicada no banco ANTES da suíte (gate `psql -f`).
 * `comoUsuario(c)` = o dono (super admin) da Loja Teste: passa o `_exige_modulos('producao','etapas_pl')`
 * e o `user_can_view` (admins furam) → o wrapper devolve o mapa real, não `{}`.
 */
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, ehBancoLocal, TENANT_TESTE } from "./db";
import { CONDICOES_PL } from "@/lib/etapas-pl-condicoes";

describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL — avaliador (bloco C)", () => {
  // Semeia (txn revertida, role de dono/postgres) um modelo SEM M.O. e depois UMA linha de M.O. numa categoria
  // exige_peca_teste, NAO aprovada (aprovado null). Devolve o id do modelo.
  async function modeloComTrilhaNaoAprovada(sql: import("pg").Client): Promise<string> {
    const m = (await sql.query(`select id from modelos where tenant_id=$1 limit 1`, [TENANT_TESTE])).rows;
    const id = m[0].id as string;
    await sql.query(`delete from modelo_servico_mo where modelo_id=$1`, [id]);
    const cat = (
      await sql.query(
        `insert into categorias_terceirizado (tenant_id, nome, exige_peca_teste) values ($1, $2, true) returning id`,
        [TENANT_TESTE, `Cond ${Math.random().toString(36).slice(2)}`],
      )
    ).rows[0].id as string;
    await sql.query(
      `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor) values ($1,$2,$3,0)`,
      [TENANT_TESTE, id, cat],
    );
    return id;
  }
  it("tem_peca_teste: trilha existe (aprovada ou nao) => true; peca_teste_aprovada => false quando nao aprovada", async () => {
    await withTx(async (sql) => {
      const id = await modeloComTrilhaNaoAprovada(sql);
      await comoUsuario(sql);
      const r = (await sql.query(`select avaliar_condicoes_etapas_pl(array[$1]::uuid[]) as mapa`, [id])).rows;
      const doModelo = (r[0].mapa as Record<string, Record<string, boolean>>)[id];
      expect(doModelo.tem_peca_teste).toBe(true);
      expect(doModelo.peca_teste_aprovada).toBe(false);
    });
  });
  it("tem_peca_teste: sem trilha => false (e peca_teste_aprovada vacuamente true)", async () => {
    await withTx(async (sql) => {
      const m = (await sql.query(`select id from modelos where tenant_id=$1 limit 1`, [TENANT_TESTE])).rows;
      await sql.query(`delete from modelo_servico_mo where modelo_id=$1`, [m[0].id]);
      await comoUsuario(sql);
      const r = (await sql.query(`select avaliar_condicoes_etapas_pl(array[$1]::uuid[]) as mapa`, [m[0].id])).rows;
      const doModelo = (r[0].mapa as Record<string, Record<string, boolean>>)[m[0].id];
      expect(doModelo.tem_peca_teste).toBe(false);
      expect(doModelo.peca_teste_aprovada).toBe(true);
    });
  });
  it("avaliar_condicoes_etapas_pl devolve mapa com TODAS as keys do catálogo por modelo", async () => {
    await withTx(async (sql) => {
      await comoUsuario(sql);
      // use um modelo_id real da loja de teste (padrão dos testes vizinhos de kanban/peça teste)
      const m = (await sql.query(`select id from modelos where tenant_id=$1 limit 1`, [TENANT_TESTE])).rows;
      const r = (await sql.query(`select avaliar_condicoes_etapas_pl(array[$1]::uuid[]) as mapa`, [m[0].id])).rows;
      const mapa = r[0].mapa as Record<string, Record<string, boolean>>;
      const doModelo = mapa[m[0].id] ?? {};
      for (const c of CONDICOES_PL) expect(doModelo).toHaveProperty(c.key);
    });
  });
  it("anti-drift: toda key do catálogo TS tem branch no SQL e vice-versa", async () => {
    await withTx(async (sql) => {
      await comoUsuario(sql);
      const m = (await sql.query(`select id from modelos where tenant_id=$1 limit 1`, [TENANT_TESTE])).rows;
      const r = (await sql.query(`select avaliar_condicoes_etapas_pl(array[$1]::uuid[]) as mapa`, [m[0].id])).rows;
      const keysSql = Object.keys((r[0].mapa as any)[m[0].id] ?? {}).sort();
      const keysTs = CONDICOES_PL.map((c) => c.key).sort();
      expect(keysSql).toEqual(keysTs);
    });
  });
});
