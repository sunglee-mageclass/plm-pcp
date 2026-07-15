import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Fase B — o custo do tecido de um MODELO segue o preço da OC VINCULADA no Desenvolvimento
// (modelo_tecido_oc_links → ocs_tecido_itens.preco), e NÃO o preço atual do artigo. Assim,
// mudar o preço do artigo (uma OC futura) não mexe no custo de um produto já desenvolvido.
// Tudo em BEGIN…ROLLBACK.
describe.skipIf(!hasDb)("Custo congelado pela OC vinculada (Fase B)", () => {
  it("preço do tecido segue a OC vinculada e CONGELA mesmo mudando o preço do artigo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      // Artigo em METRO (preco_por_metro = preco) p/ a asserção não depender do rendimento.
      const av = await um<{ art: string; var: string } | undefined>(
        c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id
            where a.tenant_id=$1 and a.unidade_medida='metro' limit 1`, [TENANT_TESTE]);
      const mod = await um<{ id: string } | undefined>(c, `select id from modelos where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!emp || !av || !mod) return;

      // OC com o item a R$ 50 (Fase A grava ocs_tecido_itens.preco).
      const oc = { numero_pedido: "ITEST-FASEB", empresa_id: emp.id, data_prevista_entrega: "2026-08-01",
        prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [], status: "encomendado" };
      const itens = [{ id: null, artigo_id: av.art, artigo_numero: 1, variante_tecido_id: av.var,
        quantidade_pedida: 100, quantidade_recebida: 0, cancelado: false, preco: 50 }];
      const ocId = (await um<{ id: string }>(c, `select public._salvar_oc_tecido_core(null,$1::jsonb,$2::jsonb) id`,
        [JSON.stringify(oc), JSON.stringify(itens)])).id;
      const ocItem = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id=$1`, [ocId])).id;

      // Vincula esse item ao Tecido 1 (ordem 9 p/ não colidir com dados reais) do modelo.
      await c.query(
        `insert into modelo_tecido_oc_links (tenant_id, modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade)
         values ($1,$2,'tecido',1,9,$3,$4,10,1)`,
        [TENANT_TESTE, mod.id, av.var, ocItem]);

      // Mapa do front: tecido|1 = 50 (preço da OC vinculada, por metro).
      const mapa = (await um<{ m: any }>(c, `select public.precos_tecido_congelado($1) m`, [mod.id])).m as Record<string, number>;
      expect(Number(mapa["tecido|1"])).toBe(50);

      // Helper por-metro: 50 (OC vinculada).
      const ppm = async (numero: number) =>
        Number((await um<{ p: string }>(c, `select public._preco_tecido_por_metro($1,'tecido',$2,$3) p`, [mod.id, numero, av.art])).p);
      expect(await ppm(1)).toBe(50);

      // Agora o preço do ARTIGO muda para 999 (simula OC futura / reajuste no cadastro).
      await c.query(`update artigos set preco=999, preco_por_metro=999 where id=$1`, [av.art]);

      // CONGELADO: o tecido vinculado continua 50 (segue a OC, não o artigo).
      expect(await ppm(1)).toBe(50);
      // Sem vínculo (numero 2): cai no preço ATUAL do artigo (999).
      expect(await ppm(2)).toBe(999);
    });
  });

  it("sem vínculo de OC, o preço do tecido é o do artigo (comportamento anterior)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const av = await um<{ art: string } | undefined>(
        c, `select a.id art from artigos a where a.tenant_id=$1 and a.unidade_medida='metro' limit 1`, [TENANT_TESTE]);
      const mod = await um<{ id: string } | undefined>(c, `select id from modelos where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!av || !mod) return;
      await c.query(`update artigos set preco=123, preco_por_metro=123 where id=$1`, [av.art]);
      const ppm = Number((await um<{ p: string }>(c, `select public._preco_tecido_por_metro($1,'tecido',7,$2) p`, [mod.id, av.art])).p);
      expect(ppm).toBe(123); // fallback = preço atual do artigo
    });
  });
});
