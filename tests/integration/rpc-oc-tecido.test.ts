import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// salvar_oc_tecido ATÔMICO: antes o save eram 6-8 chamadas no cliente (janela de falha
// parcial). A RPC faz header + diff de itens + recálculo de parcelas numa transação, e o diff
// por id PRESERVA cq_*/estoque_zerado (campos que o save não toca). Chama o _core direto (a
// conexão é postgres, ignora o REVOKE). Tudo em BEGIN…ROLLBACK — nada grava.
describe.skipIf(!hasDb)("RPC salvar_oc_tecido (atômico)", () => {
  it("cria OC recebida (itens+parcelas) e edita preservando cq_ok/estoque_zerado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const av = await um<{ art: string; var: string } | undefined>(
        c,
        `select a.id as art, v.id as var from variantes_tecido v
         join artigos a on a.id = v.artigo_id where a.tenant_id = $1 limit 1`,
        [TENANT_TESTE],
      );
      if (!emp || !av) return; // sem dado adequado → auto-pula

      const oc = {
        numero_pedido: "ITEST-TEC", empresa_id: emp.id, data_prevista_entrega: "2026-07-01",
        prazo_pagamento: "30/60", quantidade_prazos: 2, parcelas_recebimento: [],
        valor_previsto_total: 500, valor_real_total: 500, status: "recebido",
      };
      const itens = [{
        id: null, artigo_id: av.art, artigo_numero: 1, variante_tecido_id: av.var,
        quantidade_pedida: 100, quantidade_recebida: 100, rendimento: null, cancelado: false,
      }];
      const ocId = (await um<{ id: string }>(
        c, `select public._salvar_oc_tecido_core(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify(oc), JSON.stringify(itens)],
      )).id;

      const r1 = await um<{ status: string; itens: string; np: string; tot: string }>(
        c,
        `select o.status,
                (select count(*) from ocs_tecido_itens where oc_tecido_id = o.id) itens,
                (select count(*) from parcelas where oc_tecido_id = o.id) np,
                (select coalesce(sum(valor),0) from parcelas where oc_tecido_id = o.id) tot
         from ocs_tecido o where o.id = $1`, [ocId],
      );
      expect(r1.status).toBe("recebido");
      expect(Number(r1.itens)).toBe(1);
      expect(Number(r1.np)).toBe(2);       // 2 prazos → 2 parcelas
      expect(Number(r1.tot)).toBe(500);

      // marca cq_ok + estoque_zerado (campos que o save NÃO toca) e edita a OC
      const itId = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id = $1`, [ocId])).id;
      await c.query(`update ocs_tecido_itens set cq_ok = true, estoque_zerado = true where id = $1`, [itId]);

      const oc2 = { ...oc, numero_pedido: "ITEST-TEC2", valor_previsto_total: 600, valor_real_total: 600 };
      const itens2 = [{
        id: itId, artigo_id: av.art, artigo_numero: 1, variante_tecido_id: av.var,
        quantidade_pedida: 120, quantidade_recebida: 120, rendimento: null, cancelado: false,
      }];
      await c.query(`select public._salvar_oc_tecido_core($1, $2::jsonb, $3::jsonb)`,
        [ocId, JSON.stringify(oc2), JSON.stringify(itens2)]);

      const r2 = await um<{ n: string; cq: boolean; ez: boolean; qp: string; tot: string }>(
        c,
        `select (select count(*) from ocs_tecido_itens where oc_tecido_id = $1) n,
                (select cq_ok from ocs_tecido_itens where id = $2) cq,
                (select estoque_zerado from ocs_tecido_itens where id = $2) ez,
                (select quantidade_pedida from ocs_tecido_itens where id = $2) qp,
                (select coalesce(sum(valor),0) from parcelas where oc_tecido_id = $1) tot`,
        [ocId, itId],
      );
      expect(Number(r2.n)).toBe(1);   // diff por id: mesmo item, não recriou
      expect(r2.cq).toBe(true);       // cq_ok PRESERVADO
      expect(r2.ez).toBe(true);       // estoque_zerado PRESERVADO
      expect(Number(r2.qp)).toBe(120);
      expect(Number(r2.tot)).toBe(600); // parcelas recalculadas p/ o novo valor
    });
  });
});
