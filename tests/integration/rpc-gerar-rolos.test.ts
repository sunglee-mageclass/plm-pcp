import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE } from "./db";

// gerar_rolos_recebimento cria TODOS os rolos planejados numa transação (tudo-ou-nada):
// um batch que estoura o saldo de origem não pode deixar rolos parciais.
describe.skipIf(!hasDb)("gerar_rolos_recebimento — batch atômico", () => {
  it("cria todos os rolos; um batch que estoura o saldo não cria nenhum", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"entrada_saida":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const av = await um<{ art: string; var: string }>(
        c,
        `select a.id art, v.id var from artigos a join variantes_tecido v on v.artigo_id=a.id
         where a.tenant_id=$1 and a.unidade_medida<>'kg' limit 1`,
        [TENANT_TESTE],
      );
      const oc = await um<{ id: string }>(
        c,
        `insert into ocs_tecido (tenant_id,status,numero_pedido,data_pedido,data_entrega)
         values ($1,'recebido','ITEST-GR',current_date,current_date) returning id`,
        [TENANT_TESTE],
      );
      const it = await um<{ id: string }>(
        c,
        `insert into ocs_tecido_itens (oc_tecido_id,artigo_id,variante_tecido_id,quantidade_pedida,quantidade_recebida)
         values ($1,$2,$3,100,100) returning id`,
        [oc.id, av.art, av.var],
      );

      // 2 rolos de 30 (saldo 100) → cria 2, saldo 40
      const ok = JSON.stringify([
        { origem_item_id: it.id, artigo_id: av.art, variante_tecido_id: av.var, metragem: 30 },
        { origem_item_id: it.id, artigo_id: av.art, variante_tecido_id: av.var, metragem: 30 },
      ]);
      const n = await um<{ n: string }>(c, `select gerar_rolos_recebimento($1,$2::jsonb) n`, [oc.id, ok]);
      expect(Number(n.n)).toBe(2);
      const cnt = await um<{ c: string }>(c, `select count(*)::text c from ocs_tecido where is_rolo and rolo_origem_item_id=$1`, [it.id]);
      expect(Number(cnt.c)).toBe(2);

      // item saldo 40, batch [30,30]=60 → o 2º estoura → RAISE → NENHUM criado (o 1º rola back junto)
      const it2 = await um<{ id: string }>(
        c,
        `insert into ocs_tecido_itens (oc_tecido_id,artigo_id,variante_tecido_id,quantidade_pedida,quantidade_recebida)
         values ($1,$2,$3,40,40) returning id`,
        [oc.id, av.art, av.var],
      );
      const bad = JSON.stringify([
        { origem_item_id: it2.id, artigo_id: av.art, variante_tecido_id: av.var, metragem: 30 },
        { origem_item_id: it2.id, artigo_id: av.art, variante_tecido_id: av.var, metragem: 30 },
      ]);
      await c.query("savepoint sp");
      await expect(c.query(`select gerar_rolos_recebimento($1,$2::jsonb)`, [oc.id, bad])).rejects.toThrow();
      await c.query("rollback to savepoint sp");
      const cnt2 = await um<{ c: string }>(c, `select count(*)::text c from ocs_tecido where is_rolo and rolo_origem_item_id=$1`, [it2.id]);
      expect(Number(cnt2.c)).toBe(0); // tudo-ou-nada
    });
  });
});
