/**
 * Kanban PL configuravel - Onda 2, Task 1 (cfg/ligado/derivar_lote do board PL).
 *
 * SO BANCO; `etapas_pl_automatico` default false. Tudo em BEGIN...ROLLBACK (`withTx`) e SO na copia local
 * (`ehBancoLocal`): a migration 20261127100000_etapas_pl_cfg.sql e aplicada no banco ANTES da suite
 * (pelo gate `psql -f`), e cada teste roda contra o estado vivo numa txn revertida. NUNCA `\i` migration em
 * txn de teste (incidente 15/set); DDL so na copia local (incidente 23/set).
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, um, comoUsuario, ehBancoLocal, TENANT_TESTE } from "./db";

const T = TENANT_TESTE;

/** Poe o primeiro modelo da loja NO PL (status_etapa_pl) e devolve o id. Txn revertida. */
async function umModeloNoPl(c: Client, status: string): Promise<string> {
  const r = await c.query(
    `update modelos set status_etapa_pl = $2
       where id = (select id from modelos where tenant_id = $1 order by id limit 1)
     returning id`,
    [T, status],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!hasDb || !ehBancoLocal())("Kanban PL Onda 2 - cfg/derivar", () => {
  it("_etapas_pl_cfg traz etapas_pl_automatico/kanban/requisitos", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(
        `update tenant_config set etapas_pl_automatico=true,
           etapas_pl_kanban='["Peça Teste","Oficina"]'::jsonb,
           etapas_pl_requisitos='{"oficina":["peca_teste_aprovada"]}'::jsonb
         where tenant_id=$1`,
        [T],
      );
      const r = (await um<{ cfg: any }>(c, `select _etapas_pl_cfg($1) cfg`, [T])).cfg;
      expect(r.etapas_pl_automatico).toBe(true);
      expect(r.etapas_pl_kanban).toEqual(["Peça Teste", "Oficina"]);
      expect(r.etapas_pl_requisitos).toEqual({ oficina: ["peca_teste_aprovada"] });
    });
  });

  it("_etapas_pl_ligado = etapas_pl_automatico", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set etapas_pl_automatico=false where tenant_id=$1`, [T]);
      expect((await um<{ l: boolean }>(c, `select _etapas_pl_ligado($1) l`, [T])).l).toBe(false);
      await c.query(`update tenant_config set etapas_pl_automatico=true where tenant_id=$1`, [T]);
      expect((await um<{ l: boolean }>(c, `select _etapas_pl_ligado($1) l`, [T])).l).toBe(true);
    });
  });

  it("_etapas_pl_derivar_lote: elegivel = status_etapa_pl IS NOT NULL (no PL)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(
        `update tenant_config set etapas_pl_automatico=true,
           etapas_pl_kanban='["Peça Teste","Oficina"]'::jsonb,
           etapas_pl_requisitos='{}'::jsonb
         where tenant_id=$1`,
        [T],
      );
      const mid = await umModeloNoPl(c, "peca_teste");
      const r = await um<{ elegivel: boolean; fluxo: string[]; status_atual: string; derivavel: boolean }>(
        c,
        `select elegivel, fluxo, status_atual, derivavel from _etapas_pl_derivar_lote($1, ARRAY[$2]::uuid[]) limit 1`,
        [T, mid],
      );
      expect(r.elegivel).toBe(true); // esta no PL
      expect(r.fluxo).toEqual(["peca_teste", "oficina"]); // board PL resolvido pela pura _kanban_fluxo
      expect(r.status_atual).toBe("peca_teste");
      expect(r.derivavel).toBe(true);
    });
  });

  it("_etapas_pl_derivar_lote: modelo FORA do PL (status_etapa_pl NULL) nao e elegivel", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(
        `update tenant_config set etapas_pl_automatico=true,
           etapas_pl_kanban='["Peça Teste","Oficina"]'::jsonb where tenant_id=$1`,
        [T],
      );
      const mid = (
        await c.query(
          `update modelos set status_etapa_pl = NULL
             where id = (select id from modelos where tenant_id = $1 order by id limit 1)
           returning id`,
          [T],
        )
      ).rows[0].id as string;
      const r = await um<{ elegivel: boolean; derivavel: boolean }>(
        c,
        `select elegivel, derivavel from _etapas_pl_derivar_lote($1, ARRAY[$2]::uuid[]) limit 1`,
        [T, mid],
      );
      expect(r.elegivel).toBe(false); // fora do PL
      expect(r.derivavel).toBe(false); // nao elegivel -> nao deriva
    });
  });

  it("internas sem EXECUTE para authenticated (invariante #9)", async () => {
    await withTx(async (c) => {
      const r = await um<{ cfg: boolean; lig: boolean; der: boolean }>(
        c,
        `select has_function_privilege('authenticated','public._etapas_pl_cfg(uuid)','EXECUTE') cfg,
                has_function_privilege('authenticated','public._etapas_pl_ligado(uuid)','EXECUTE') lig,
                has_function_privilege('authenticated','public._etapas_pl_derivar_lote(uuid,uuid[],jsonb)','EXECUTE') der`,
      );
      expect(r.cfg).toBe(false);
      expect(r.lig).toBe(false);
      expect(r.der).toBe(false);
    });
  });
});
