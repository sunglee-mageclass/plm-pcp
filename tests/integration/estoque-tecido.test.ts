import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// #1: fonte única _estoque_tecido_core (consumida pela tela de Estoque e pelo dashboard).
// Cenário controlado (BEGIN…ROLLBACK): OC recebida 100 → físico 100; OS baixada 30 → 70;
// cancelar o item → recebido sai, físico clampa em 0 (a OS baixa fica). Trava a definição.
describe.skipIf(!hasDb)("estoque_tecido (fonte canônica)", () => {
  it("recebido − OS baixada, com clamp e exclusão de item cancelado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const av = await um<{ art: string; var: string } | undefined>(
        c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id
            where a.tenant_id=$1 and coalesce(a.unidade_medida,'metro')<>'kg' limit 1`, [TENANT_TESTE]);
      if (!emp || !av) return;

      const rec = async () => Number((await um<{ m: string }>(c,
        `select coalesce(recebido_m,0) m from public._estoque_tecido_core($1) where variante_tecido_id=$2`, [TENANT_TESTE, av.var]))?.m ?? 0);
      const bx = async () => Number((await um<{ m: string }>(c,
        `select coalesce(baixa,0) m from public._estoque_tecido_core($1) where variante_tecido_id=$2`, [TENANT_TESTE, av.var]))?.m ?? 0);
      const rec0 = await rec();
      const bx0 = await bx();

      const oc = { numero_pedido: "ITEST-ETEC", empresa_id: emp.id, data_prevista_entrega: "2026-07-01",
        prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [],
        valor_previsto_total: 100, valor_real_total: 100, status: "recebido" };
      const itens = [{ id: null, artigo_id: av.art, artigo_numero: 1, variante_tecido_id: av.var,
        quantidade_pedida: 100, quantidade_recebida: 100, rendimento: null, cancelado: false }];
      const ocId = (await um<{ id: string }>(c, `select public._salvar_oc_tecido_core(null,$1::jsonb,$2::jsonb) id`,
        [JSON.stringify(oc), JSON.stringify(itens)])).id;
      const itId = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id=$1`, [ocId])).id;

      expect(await rec()).toBe(rec0 + 100); // OC recebida soma 100 no recebido

      // OS baixada de 30 → +30 na baixa
      const os = (await um<{ id: string }>(c, `insert into ordens_saida_tecido(tenant_id, baixado) values ($1,true) returning id`, [TENANT_TESTE])).id;
      await c.query(`insert into ordens_saida_tecido_itens(tenant_id, ordem_saida_id, variante_tecido_id, reserva, baixa) values ($1,$2,$3,0,30)`, [TENANT_TESTE, os, av.var]);
      expect(await bx()).toBe(bx0 + 30); // OS baixada entra na baixa

      // cancelar o item → o recebido dele (100) sai
      await c.query(`update ocs_tecido_itens set cancelado=true where id=$1`, [itId]);
      expect(await rec()).toBe(rec0); // recebido volta ao baseline

      // físico nunca negativo (clamp)
      const fis = Number((await um<{ f: string }>(c, `select coalesce(fisico,0) f from public._estoque_tecido_core($1) where variante_tecido_id=$2`, [TENANT_TESTE, av.var]))?.f ?? 0);
      expect(fis).toBeGreaterThanOrEqual(0);
    });
  });
});
