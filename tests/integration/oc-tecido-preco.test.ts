import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Fase A — a OC "dita" o preço do tecido. Um item de OC com preço: (1) salva `preco` no item;
// (2) sincroniza `variantes_tecido.preco` no cadastro (novo "atual"), o que dispara o histórico
// da variante (loga 42). Tudo em BEGIN…ROLLBACK.
describe.skipIf(!hasDb)("OC de tecido dita o preço (Fase A)", () => {
  it("item com preço salva no item + sincroniza o preço da variante no cadastro (+histórico)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const av = await um<{ art: string; var: string } | undefined>(
        c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id where a.tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!emp || !av) return;

      // slate limpo no cadastro da variante (pra ver a sincronização + histórico do zero)
      await c.query(`update variantes_tecido set preco=null, historico_precos='[]'::jsonb where id=$1`, [av.var]);

      const oc = { numero_pedido: "ITEST-OCP", empresa_id: emp.id, data_prevista_entrega: "2026-08-01",
        prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [], status: "encomendado" };
      const itens = [{ id: null, artigo_id: av.art, artigo_numero: 1, variante_tecido_id: av.var,
        quantidade_pedida: 100, quantidade_recebida: 0, cancelado: false, preco: 42 }];
      const ocId = (await um<{ id: string }>(c, `select public._salvar_oc_tecido_core(null,$1::jsonb,$2::jsonb) id`,
        [JSON.stringify(oc), JSON.stringify(itens)])).id;

      // preço salvo NO item da OC
      expect(Number((await um<{ p: string }>(c, `select preco p from ocs_tecido_itens where oc_tecido_id=$1`, [ocId])).p)).toBe(42);
      // preço SINCRONIZADO no cadastro da variante
      expect(Number((await um<{ p: string }>(c, `select preco p from variantes_tecido where id=$1`, [av.var])).p)).toBe(42);
      // histórico da variante logou 42 (o novo "atual")
      const hist = (await um<{ h: any }>(c, `select historico_precos h from variantes_tecido where id=$1`, [av.var])).h as any[];
      expect(hist.map((x) => Number(x.preco))).toEqual([42]);
    });
  });

  it("cadastro reflete a OC MAIS RECENTE; editar uma OC antiga NÃO sobrescreve", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const av = await um<{ art: string; var: string } | undefined>(
        c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id where a.tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!emp || !av) return;
      await c.query(`update variantes_tecido set preco=null, historico_precos='[]'::jsonb where id=$1`, [av.var]);

      const mkOc = (numero: string, dataPedido: string, preco: number) => ({
        oc: { numero_pedido: numero, empresa_id: emp.id, data_pedido: dataPedido, data_prevista_entrega: "2026-12-01",
          prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [], status: "encomendado" },
        itens: [{ id: null, artigo_id: av.art, artigo_numero: 1, variante_tecido_id: av.var,
          quantidade_pedida: 100, quantidade_recebida: 0, cancelado: false, preco }],
      });
      const salvar = async (ocId: string | null, o: any) =>
        (await um<{ id: string }>(c, `select public._salvar_oc_tecido_core($1,$2::jsonb,$3::jsonb) id`,
          [ocId, JSON.stringify(o.oc), JSON.stringify(o.itens)])).id;
      const cadPreco = async () => Number((await um<{ p: string }>(c, `select preco p from variantes_tecido where id=$1`, [av.var])).p);

      const oldOc = await salvar(null, mkOc("OLD", "2026-01-01", 10));  // OC antiga, 10
      await salvar(null, mkOc("NEW", "2026-06-01", 20));                // OC recente, 20
      expect(await cadPreco()).toBe(20);                                // cadastro = a mais recente

      // edita a OC ANTIGA p/ 15 → cadastro segue 20 (a recente ganha)
      const oldItem = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id=$1`, [oldOc])).id;
      const edit = mkOc("OLD", "2026-01-01", 15);
      edit.itens[0].id = oldItem as any;
      await salvar(oldOc, edit);
      expect(await cadPreco()).toBe(20);
    });
  });
});
