import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Guardas de máquina de estados do Alerta de Tecido (diagnóstico jul/2026):
// C2 = _aplicar_resolucao só aceita transição válida (troca/estilo_ok/cancelar só de 'alertado');
// C1 = _receber_reposicao_troca só recebe de troca PENDENTE (não re-recebe uma já 'trocado').
// Sem elas, duplo-clique/cache velho/retry corrompia estoque(#4) e valor/parcelas(#1).
describe.skipIf(!hasDb)("Alerta de Tecido — guardas de estado (C1/C2)", () => {
  it("troca 2× / receber 2× / estilo_ok em trocado são BLOQUEADOS; caminho feliz passa", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const av = await um<{ art: string; var: string } | undefined>(
        c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id where a.tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!emp || !av) return;

      const oc = { numero_pedido: "ITEST-AL", empresa_id: emp.id, data_prevista_entrega: "2026-07-01",
        prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [],
        valor_previsto_total: 100, valor_real_total: 100, status: "recebido" };
      const itens = [{ id: null, artigo_id: av.art, artigo_numero: 1, variante_tecido_id: av.var,
        quantidade_pedida: 100, quantidade_recebida: 100, rendimento: null, cancelado: false }];
      const ocId = (await um<{ id: string }>(c, `select public._salvar_oc_tecido_core(null,$1::jsonb,$2::jsonb) id`,
        [JSON.stringify(oc), JSON.stringify(itens)])).id;
      const itId = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id=$1`, [ocId])).id;
      await c.query(`update ocs_tecido_itens set cq_alerta_status='alertado' where id=$1`, [itId]);

      // troca (válida de 'alertado')
      await c.query(`select public._aplicar_resolucao_alerta_tecido_core($1,'troca',$2,$3,50)`, [itId, av.art, av.var]);
      const s1 = await um<{ st: string; n: string }>(c,
        `select cq_alerta_status st, (select count(*) from ocs_tecido_itens where substitui_item_id=$1) n from ocs_tecido_itens where id=$1`, [itId]);
      expect(s1.st).toBe("troca_pendente");
      expect(Number(s1.n)).toBe(1);

      // C2: troca de novo (de troca_pendente) → bloqueia
      await c.query("SAVEPOINT sp1");
      await expect(c.query(`select public._aplicar_resolucao_alerta_tecido_core($1,'troca',$2,$3,50)`, [itId, av.art, av.var]))
        .rejects.toThrow(/não está em alerta/i);
      await c.query("ROLLBACK TO SAVEPOINT sp1");

      // receber reposição (válida)
      await c.query(`select public._receber_reposicao_troca_core($1,'2026-07-10',50)`, [itId]);
      expect((await um<{ st: string }>(c, `select cq_alerta_status st from ocs_tecido_itens where id=$1`, [itId])).st).toBe("trocado");

      // C1: receber de novo → bloqueia (não infla valor/estoque)
      await c.query("SAVEPOINT sp2");
      await expect(c.query(`select public._receber_reposicao_troca_core($1,'2026-07-10',999)`, [itId]))
        .rejects.toThrow(/não está pendente/i);
      await c.query("ROLLBACK TO SAVEPOINT sp2");

      // C2: estilo_ok num já 'trocado' → bloqueia (não ressuscita no estoque)
      await c.query("SAVEPOINT sp3");
      await expect(c.query(`select public._aplicar_resolucao_alerta_tecido_core($1,'estilo_ok')`, [itId]))
        .rejects.toThrow(/não está em alerta/i);
      await c.query("ROLLBACK TO SAVEPOINT sp3");
    });
  });
});
