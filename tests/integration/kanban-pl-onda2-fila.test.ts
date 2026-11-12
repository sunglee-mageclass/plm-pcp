/**
 * Kanban PL configuravel - Onda 2, Tasks 2/3/4/5 (fila + enfileiradores + gatilhos-fonte; processador no COMMIT;
 * aplicador + historico; e2e fila->processador->aplicador).
 *
 * SO BANCO; `etapas_pl_automatico` default false. Tudo em BEGIN...ROLLBACK (`withTx`) e SO na copia local
 * (`ehBancoLocal`): a migration 20261127110000_etapas_pl_fila.sql e aplicada no banco ANTES da suite (gate
 * `psql -f`), e cada teste roda contra o estado vivo numa txn revertida. O gatilho adiado so dispara no COMMIT;
 * dentro da txn revertida usamos `SET CONSTRAINTS ALL IMMEDIATE` para forca-lo (senao nao dispara e o teste e inutil).
 * NUNCA `\i` migration em txn de teste (incidente 15/set); DDL so na copia local (incidente 23/set).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, um, comoUsuario, ehBancoLocal, TENANT_TESTE } from "./db";

const T = TENANT_TESTE;

/** Acha um modelo da loja que tenha um bloco producao_terceirizados (via cad). Txn revertida. */
async function modeloComBlocoPt(c: Client): Promise<{ modeloId: string; ptId: string }> {
  const r = await c.query(
    `select m.id as modelo_id, pt.id as pt_id
       from modelos m
       join cad c on c.modelo_id = m.id
       join producao_terceirizados pt on pt.cad_id = c.id
      where m.tenant_id = $1
      order by m.id
      limit 1`,
    [T],
  );
  return { modeloId: r.rows[0].modelo_id as string, ptId: r.rows[0].pt_id as string };
}

async function poeNoPl(c: Client, modeloId: string, status = "peca_teste"): Promise<void> {
  await c.query(`update modelos set status_etapa_pl = $2 where id = $1`, [modeloId, status]);
}

async function naFila(c: Client, modeloId: string): Promise<number> {
  return Number(
    (await um<{ n: string }>(c, `select count(*)::text n from etapas_pl_recalculo_fila where modelo_id=$1`, [modeloId])).n,
  );
}

// ───────────────────────── Task 2 — fila + enfileiradores + gatilhos-fonte ─────────────────────────
describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 2 - fila (Task 2)", () => {
  it("chave ligada + modelo no PL: editar producao_terceirizados enfileira", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_automatico=true where tenant_id=$1`, [T]);
      const { modeloId, ptId } = await modeloComBlocoPt(c);
      await poeNoPl(c, modeloId);
      // edita um bloco de servico do modelo -> gatilho statement-level por cad_id enfileira
      await c.query(`update producao_terceirizados set ativo = coalesce(ativo, true) where id=$1`, [ptId]);
      expect(await naFila(c, modeloId)).toBe(1);
    });
  });

  it("chave desligada: nada enfileira", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_automatico=false where tenant_id=$1`, [T]);
      const { modeloId, ptId } = await modeloComBlocoPt(c);
      await poeNoPl(c, modeloId);
      await c.query(`update producao_terceirizados set ativo = coalesce(ativo, true) where id=$1`, [ptId]);
      expect(await naFila(c, modeloId)).toBe(0); // chave off -> fila vazia
    });
  });

  it("modelo FORA do PL (status_etapa_pl NULL): nao enfileira mesmo com chave ligada", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_automatico=true where tenant_id=$1`, [T]);
      const { modeloId, ptId } = await modeloComBlocoPt(c);
      await c.query(`update modelos set status_etapa_pl = NULL where id=$1`, [modeloId]);
      await c.query(`update producao_terceirizados set ativo = coalesce(ativo, true) where id=$1`, [ptId]);
      expect(await naFila(c, modeloId)).toBe(0); // nao esta no PL -> fora
    });
  });

  it("editar modelos.status_etapa_pl (entrar no PL) enfileira com chave ligada", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_automatico=true where tenant_id=$1`, [T]);
      const { modeloId } = await modeloComBlocoPt(c);
      await c.query(`update modelos set status_etapa_pl = NULL where id=$1`, [modeloId]);
      // zera a fila que o update acima possa ter gerado
      await c.query(`delete from etapas_pl_recalculo_fila where modelo_id=$1`, [modeloId]);
      await c.query(`update modelos set status_etapa_pl = 'peca_teste' where id=$1`, [modeloId]);
      expect(await naFila(c, modeloId)).toBe(1);
    });
  });

  it("fila REVOKE ALL dos 3 (sem SELECT para authenticated)", async () => {
    await withTx(async (c) => {
      const r = await um<{ sel: boolean }>(
        c,
        `select has_table_privilege('authenticated','public.etapas_pl_recalculo_fila','SELECT') sel`,
      );
      expect(r.sel).toBe(false);
    });
  });
});
