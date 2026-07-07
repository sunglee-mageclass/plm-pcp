import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE } from "./db";

// "Desfazer troca" (aplicar_resolucao_alerta_tecido ação 'reabrir' numa troca PENDENTE) tem que
// desfazer a troca de verdade: remover o item substituto órfão + a entrada vazia do cronograma
// de recebimento, SEM dobrar o valor_previsto. E bloquear reabrir uma troca já RECEBIDA.
describe.skipIf(!hasDb)("Alerta de tecido — desfazer troca", () => {
  async function cenario(c: any, ped: string) {
    const av = await um<{ art: string; var: string }>(
      c,
      `select a.id art, v.id var from artigos a join variantes_tecido v on v.artigo_id=a.id
       where a.tenant_id=$1 and coalesce(a.preco,0)>0 limit 1`,
      [TENANT_TESTE],
    );
    const oc = await um<{ id: string }>(
      c,
      `insert into ocs_tecido (tenant_id, status, numero_pedido, data_pedido, data_entrega)
       values ($1,'recebido',$2,current_date,current_date) returning id`,
      [TENANT_TESTE, ped],
    );
    const item = await um<{ id: string }>(
      c,
      `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, cq_alerta_status)
       values ($1,$2,$3,100,100,'alertado') returning id`,
      [oc.id, av.art, av.var],
    );
    return { av, oc, item };
  }

  it("reabrir uma troca pendente remove o substituto/entrada e NÃO dobra o previsto", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { av, oc, item } = await cenario(c, "ITEST-TROCA");

      await c.query(`select aplicar_resolucao_alerta_tecido($1,'troca',$2,$3,100)`, [item.id, av.art, av.var]);
      const t = await um<{ subs: string; prev: string }>(
        c,
        `select (select count(*) from ocs_tecido_itens where substitui_item_id=$1) subs,
                (select valor_previsto_total::text from ocs_tecido where id=$2) prev`,
        [item.id, oc.id],
      );
      expect(Number(t.subs)).toBe(1); // substituto criado

      await c.query(`select aplicar_resolucao_alerta_tecido($1,'reabrir')`, [item.id]);
      const d = await um<{ subs: string; parc: string; status: string; prev: string }>(
        c,
        `select (select count(*) from ocs_tecido_itens where substitui_item_id=$1) subs,
                jsonb_array_length(coalesce((select parcelas_recebimento from ocs_tecido where id=$2),'[]'::jsonb))::text parc,
                (select cq_alerta_status from ocs_tecido_itens where id=$1) status,
                (select valor_previsto_total::text from ocs_tecido where id=$2) prev`,
        [item.id, oc.id],
      );
      expect(Number(d.subs)).toBe(0); // substituto removido
      expect(Number(d.parc)).toBe(0); // entrada vazia do cronograma removida
      expect(d.status).toBe("alertado"); // original reaberto
      expect(Number(d.prev)).toBe(Number(t.prev)); // previsto NÃO dobrou (1 item, igual ao da troca)
    });
  });

  it("bloqueia reabrir uma troca já recebida", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { av, item } = await cenario(c, "ITEST-TROCA2");
      await c.query(`select aplicar_resolucao_alerta_tecido($1,'troca',$2,$3,100)`, [item.id, av.art, av.var]);
      await c.query(`update ocs_tecido_itens set quantidade_recebida=100 where substitui_item_id=$1`, [item.id]);
      await expect(c.query(`select aplicar_resolucao_alerta_tecido($1,'reabrir')`, [item.id])).rejects.toThrow();
    });
  });
});
