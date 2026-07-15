import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// HIGH (audit de saúde jul/2026): RolosList.excluir fazia `delete()` cru em ocs_tecido, e a
// cadeia de FK (ocs_tecido → ocs_tecido_itens → estoque_tecido_baixas, tudo ON DELETE CASCADE)
// apagava o LEDGER de estoque em silêncio p/ um rolo já consumido no corte ou vinculado no Dev.
// FIX: excluir_rolo/_excluir_rolo_core com o mesmo guard de cancelar/ajustar/trocar (_rolo_em_uso).
// Prova: rolo NÃO em uso é excluído; rolo COM baixa no próprio item é BLOQUEADO (ledger preservado).
describe.skipIf(!hasDb)("Exclusão de rolo — guarda _rolo_em_uso (invariante #4/#5)", () => {
  it("rolo livre é excluído; rolo com baixa no item é bloqueado (ledger não some)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const av = await um<{ art: string; var: string } | undefined>(
        c,
        `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id where a.tenant_id=$1 limit 1`,
        [TENANT_TESTE],
      );
      if (!av) return;

      // Cria um rolo AVULSO (sem origem) via o core real — gera ocs_tecido(is_rolo) + item.
      const variantes = JSON.stringify([{ variante_tecido_id: av.var, metragem: 50 }]);
      const rolo = (
        await um<{ id: string }>(c, `select public._criar_rolo_core('ITEST-ROLO',$1::uuid,$2::jsonb) id`, [av.art, variantes])
      ).id;
      const roloItem = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id=$1`, [rolo])).id;

      // (1) Rolo livre: _rolo_em_uso=false → excluir apaga o rolo.
      await c.query("SAVEPOINT sp_livre");
      expect((await um<{ u: boolean }>(c, `select public._rolo_em_uso($1) u`, [rolo])).u).toBe(false);
      await c.query(`select public._excluir_rolo_core($1)`, [rolo]);
      expect(Number((await um<{ n: string }>(c, `select count(*) n from ocs_tecido where id=$1`, [rolo])).n)).toBe(0);
      await c.query("ROLLBACK TO SAVEPOINT sp_livre");

      // (2) Rolo COM baixa no próprio item (simula consumo no corte): _rolo_em_uso=true → BLOQUEIA.
      await c.query(
        `insert into estoque_tecido_baixas (tenant_id, cad_id, oc_tecido_item_id, variante_tecido_id, quantidade, origem)
         values ($1, null, $2, $3, 10, 'ajuste')`,
        [TENANT_TESTE, roloItem, av.var],
      );
      expect((await um<{ u: boolean }>(c, `select public._rolo_em_uso($1) u`, [rolo])).u).toBe(true);

      await c.query("SAVEPOINT sp_uso");
      await expect(c.query(`select public._excluir_rolo_core($1)`, [rolo])).rejects.toThrow(/já em uso/i);
      await c.query("ROLLBACK TO SAVEPOINT sp_uso");

      // O ledger continua lá (não foi cascateado): a exclusão foi barrada.
      expect(
        Number((await um<{ n: string }>(c, `select count(*) n from estoque_tecido_baixas where oc_tecido_item_id=$1`, [roloItem])).n),
      ).toBe(1);
    });
  });
});
