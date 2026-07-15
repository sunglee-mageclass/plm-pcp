import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Backlog do audit de saúde (jul/2026) — 4 guardas de servidor:
//  A) baixar_os idempotente (não re-baixa OS já baixada);
//  B) desmarcar_recebimento_oc atômico (status + parcelas numa txn; preserva parcela paga);
//  C) modelo_etapas_afetadas usa modelos.lancado (tabela lancamentos aposentada);
//  D) CQ Pós espelha o Pré: bloqueia Σ=0 no confirmar + deriva grade_total no servidor.
describe.skipIf(!hasDb)("Backlog audit de saúde — guardas de servidor", () => {
  it("A) baixar_os: OS já baixada não re-baixa (idempotência)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!emp) return;
      const avi = (await um<{ id: string }>(
        c, `insert into aviamentos(tenant_id,codigo_nome,empresa_id) values ($1,'ITEST-REBX',$2) returning id`,
        [TENANT_TESTE, emp.id])).id;
      const oc = { numero_pedido: "X", empresa_id: emp.id, data_prevista_entrega: "2026-07-01",
        prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [], status: "recebido" };
      await c.query(`select public._salvar_oc_aviamento_core(null,$1::jsonb,$2::jsonb)`,
        [JSON.stringify(oc), JSON.stringify([{ id: null, aviamento_id: avi, quantidade_pedida: 10, quantidade_recebida: 10, cancelado: false }])]);
      const os = (await um<{ id: string }>(c, `select public.salvar_os('aviamento', null, $1::jsonb, $2::jsonb) id`,
        [JSON.stringify({ responsavel: "t" }), JSON.stringify([{ itemId: avi, reserva: 4 }])])).id;
      const it = (await um<{ id: string }>(c, `select id from ordens_saida_aviamento_itens where ordem_saida_id=$1`, [os])).id;

      await c.query(`select public.baixar_os('aviamento',$1,$2::jsonb)`, [os, JSON.stringify({ [it]: 3 })]);
      // segunda baixa → BLOQUEADA
      await c.query("SAVEPOINT sp");
      await expect(c.query(`select public.baixar_os('aviamento',$1,$2::jsonb)`, [os, JSON.stringify({ [it]: 9 })]))
        .rejects.toThrow(/já baixada/i);
      await c.query("ROLLBACK TO SAVEPOINT sp");
      // baixa original intacta
      expect(Number((await um<{ b: string }>(c, `select baixa b from ordens_saida_aviamento_itens where id=$1`, [it])).b)).toBe(3);
    });
  });

  it("B) desmarcar_recebimento_oc (tecido): volta p/ encomendado, apaga não-pagas, preserva paga", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const av = await um<{ art: string; var: string } | undefined>(
        c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id where a.tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!emp || !av) return;

      const oc = { numero_pedido: "ITEST-DESM", empresa_id: emp.id, data_prevista_entrega: "2026-07-01",
        prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [],
        valor_previsto_total: 100, valor_real_total: 100, status: "recebido" };
      const itens = [{ id: null, artigo_id: av.art, artigo_numero: 1, variante_tecido_id: av.var,
        quantidade_pedida: 100, quantidade_recebida: 100, rendimento: null, cancelado: false }];
      const ocId = (await um<{ id: string }>(c, `select public._salvar_oc_tecido_core(null,$1::jsonb,$2::jsonb) id`,
        [JSON.stringify(oc), JSON.stringify(itens)])).id;

      // parcela paga (deve sobreviver) + garante que há não-paga
      const pagaId = (await um<{ id: string }>(c,
        `insert into parcelas (oc_tecido_id, tipo_oc, numero_parcela, valor, data_vencimento, status, data_pagamento)
         values ($1,'tecido',99,50,'2026-08-01','pago','2026-07-15') returning id`, [ocId])).id;
      const naoPagasAntes = Number((await um<{ n: string }>(c,
        `select count(*) n from parcelas where oc_tecido_id=$1 and status<>'pago' and data_pagamento is null`, [ocId])).n);
      expect(naoPagasAntes).toBeGreaterThan(0);

      await c.query(`select public._desmarcar_recebimento_oc_core('tecido',$1)`, [ocId]);

      expect((await um<{ s: string }>(c, `select status s from ocs_tecido where id=$1`, [ocId])).s).toBe("encomendado");
      // não-pagas sumiram
      expect(Number((await um<{ n: string }>(c,
        `select count(*) n from parcelas where oc_tecido_id=$1 and status<>'pago' and data_pagamento is null`, [ocId])).n)).toBe(0);
      // paga preservada
      expect(Number((await um<{ n: string }>(c, `select count(*) n from parcelas where id=$1`, [pagaId])).n)).toBe(1);
    });
  });

  it("C) modelo_etapas_afetadas: 'lancamentos' segue modelos.lancado (não a tabela aposentada)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string } | undefined>(c,
        `select m.id from modelos m where m.tenant_id=$1 and exists(select 1 from cad where modelo_id=m.id) limit 1`, [TENANT_TESTE]);
      if (!m) return;

      await c.query(`update modelos set lancado=true where id=$1`, [m.id]);
      expect((await um<{ v: boolean }>(c, `select (public.modelo_etapas_afetadas($1)->>'lancamentos')::boolean v`, [m.id])).v).toBe(true);
      await c.query(`update modelos set lancado=false where id=$1`, [m.id]);
      expect((await um<{ v: boolean }>(c, `select (public.modelo_etapas_afetadas($1)->>'lancamentos')::boolean v`, [m.id])).v).toBe(false);
    });
  });

  it("D) CQ Pós: confirmar com Σ=0 bloqueia; grade_total é derivado do mapa (ignora escalar do cliente)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await um<{ cad: string; pt: string } | undefined>(c,
        `select cq.cad_id cad, (select id from producao_terceirizados where cad_id=cq.cad_id limit 1) pt
           from controle_qualidade cq
          where cq.tenant_id=$1 and cq.status='confirmado' and exists(select 1 from producao_terceirizados pt where pt.cad_id=cq.cad_id)
          limit 1`, [TENANT_TESTE]);
      if (!f) return;

      // Σ=0 no confirmar → bloqueia
      const itensZero = JSON.stringify([{ producao_terceirizado_id: f.pt, variante_numero: 1, etapa: "acabamento", grades: {} }]);
      await c.query("SAVEPOINT sp0");
      await expect(c.query(`select public._salvar_cq_pos_core($1,'{}'::jsonb,$2::jsonb,true)`, [f.cad, itensZero]))
        .rejects.toThrow(/conte ao menos uma peça/i);
      await c.query("ROLLBACK TO SAVEPOINT sp0");

      // grade_total DERIVADO: cliente mente 999, mapa soma 5 → grava 5
      const itens = JSON.stringify([{ producao_terceirizado_id: f.pt, variante_numero: 1, etapa: "acabamento",
        grades: { P: 2, M: 3 }, grade_total: 999 }]);
      await c.query(`select public._salvar_cq_pos_core($1,'{}'::jsonb,$2::jsonb,false)`, [f.cad, itens]);
      const gt = Number((await um<{ g: string }>(c,
        `select grade_total g from cq_pos_variantes v
           join controle_qualidade cq on cq.id=v.controle_qualidade_id
          where cq.cad_id=$1 and v.variante_numero=1 and v.etapa='acabamento' limit 1`, [f.cad])).g);
      expect(gt).toBe(5);
    });
  });
});
