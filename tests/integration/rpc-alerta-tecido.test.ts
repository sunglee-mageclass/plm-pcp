import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE, ehBancoLocal } from "./db";
import { md5OuSucessorS2 } from "./seg-s2-helpers";

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

// ─────────────── Achados MÉDIOS R10, fin #4 (migration 20261020100000) ───────────────
// Resolver o alerta / receber a reposição refaziam o total da OC pelo preço do CADASTRO (artigos.preco) e ignoravam o
// preço NEGOCIADO do item (ocs_tecido_itens.preco). Agora: COALESCE(it.preco, a.preco, 0) — a mesma conta de precoItem
// (src/components/oc-tecido/shared.ts). Só na cópia local (ehBancoLocal).
describe.skipIf(!(hasDb && ehBancoLocal()))("Alerta de tecido — preço da compra (fin #4)", () => {
  type Parc = { n: number; valor: string };
  async function parcelas(c: any, oc: string): Promise<Parc[]> {
    return (
      await c.query(
        `select numero_parcela n, valor::numeric(14,2)::text valor from parcelas where oc_tecido_id = $1 order by 1`,
        [oc],
      )
    ).rows;
  }
  async function totais(c: any, oc: string) {
    return um<{ real: string; prev: string }>(
      c,
      `select valor_real_total::numeric(14,2)::text real, valor_previsto_total::numeric(14,2)::text prev from ocs_tecido where id = $1`,
      [oc],
    );
  }
  // OC recebida com 2 itens: A com preço NEGOCIADO (≠ cadastro) em alerta; B sem preço (cai no cadastro).
  async function cenario(c: any) {
    await comoUsuario(c);
    const av = await um<{ art: string; var: string; preco: string }>(
      c,
      `select a.id art, v.id var, a.preco::numeric(14,2)::text preco from artigos a join variantes_tecido v on v.artigo_id=a.id
        where a.tenant_id=$1 and coalesce(a.preco,0)>0 order by a.id, v.id limit 1`,
      [TENANT_TESTE],
    );
    const negociado = Math.round((Number(av.preco) + 3.21) * 100) / 100;
    const oc = await um<{ id: string }>(
      c,
      `insert into ocs_tecido (tenant_id, status, numero_pedido, data_pedido, data_entrega, prazo_pagamento, quantidade_prazos)
       values ($1,'recebido','ITEST-FIN4',current_date,current_date,'30/60',2) returning id`,
      [TENANT_TESTE],
    );
    const a = await um<{ id: string }>(
      c,
      `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, preco, cq_alerta_status)
       values ($1,$2,$3,100,100,$4,'alertado') returning id`,
      [oc.id, av.art, av.var, negociado],
    );
    await c.query(
      `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida, preco, cq_alerta_status)
       values ($1,$2,$3,50,50,null,'sem_alerta')`,
      [oc.id, av.art, av.var],
    );
    // total como o save da OC grava (precoItem): A pelo negociado, B pelo cadastro
    const real = Math.round((100 * negociado + 50 * Number(av.preco)) * 100) / 100;
    await c.query(`update ocs_tecido set valor_real_total = $2, valor_previsto_total = $2 where id = $1`, [oc.id, real]);
    await c.query(`select recalcular_parcelas($1,'tecido')`, [oc.id]);
    return { av, oc: oc.id, itemA: a.id, negociado, real };
  }

  it("migration: as 2 funções com o texto da 20261020100000; _core sem EXECUTE p/ anon/authenticated", async () => {
    await withTx(async (c) => {
      const r = await um<Record<string, unknown>>(
        c,
        `select md5(pg_get_functiondef('public._aplicar_resolucao_alerta_tecido_core(uuid,text,uuid,uuid,numeric)'::regprocedure)) a,
                md5(pg_get_functiondef('public._receber_reposicao_troca_core(uuid,date,numeric)'::regprocedure)) r,
                has_function_privilege('anon','public._aplicar_resolucao_alerta_tecido_core(uuid,text,uuid,uuid,numeric)','EXECUTE')
                  or has_function_privilege('authenticated','public._aplicar_resolucao_alerta_tecido_core(uuid,text,uuid,uuid,numeric)','EXECUTE')
                  or has_function_privilege('anon','public._receber_reposicao_troca_core(uuid,date,numeric)','EXECUTE')
                  or has_function_privilege('authenticated','public._receber_reposicao_troca_core(uuid,date,numeric)','EXECUTE') x`,
      );
      // Reforço de segurança S2 (C6): as 2 passam a chamar o _recalcular_parcelas_core direto — aceita o sucessor
      expect(md5OuSucessorS2("public._aplicar_resolucao_alerta_tecido_core(uuid,text,uuid,uuid,numeric)", "e16c604d1ce06fe77151118870c1257c"))
        .toContain(r.a);
      expect(md5OuSucessorS2("public._receber_reposicao_troca_core(uuid,date,numeric)", "95fa0b06c2a5835789c8d0c3d10a8eb5")).toContain(r.r);
      expect(r.x).toBe(false);
    });
  });

  it("estilo ok num item a preço negociado ≠ cadastro: o total e as parcelas NÃO mudam (item sem preço segue no cadastro)", async () => {
    await withTx(async (c) => {
      const { oc, itemA, real } = await cenario(c);
      const antes = await parcelas(c, oc);
      expect(antes.length).toBe(2);
      expect(antes.reduce((s, p) => s + Math.round(Number(p.valor) * 100), 0)).toBe(Math.round(real * 100));
      await c.query(`select aplicar_resolucao_alerta_tecido($1,'estilo_ok')`, [itemA]);
      expect(await totais(c, oc)).toEqual({ real: real.toFixed(2), prev: real.toFixed(2) });
      expect(await parcelas(c, oc)).toEqual(antes);
    });
  });

  it("cancelar o item negociado: o total fica só com o item sem preço (pelo cadastro)", async () => {
    await withTx(async (c) => {
      const { oc, itemA, av } = await cenario(c);
      await c.query(`select aplicar_resolucao_alerta_tecido($1,'cancelar')`, [itemA]);
      const so = (50 * Number(av.preco)).toFixed(2);
      expect(await totais(c, oc)).toEqual({ real: so, prev: so });
    });
  });

  it("troca + receber a reposição: o item B segue pelo cadastro, a reposição (sem preço) cai no cadastro; parcelas = total", async () => {
    await withTx(async (c) => {
      const { oc, itemA, av } = await cenario(c);
      await c.query(`select aplicar_resolucao_alerta_tecido($1,'troca',$2,$3,80)`, [itemA, av.art, av.var]);
      await c.query(`select receber_reposicao_troca($1, current_date, 80)`, [itemA]);
      const esperado = Math.round((50 + 80) * Number(av.preco) * 100) / 100;
      const t = await totais(c, oc);
      expect(t.real).toBe(esperado.toFixed(2));
      const ps = await parcelas(c, oc);
      expect(ps.reduce((s, p) => s + Math.round(Number(p.valor) * 100), 0)).toBe(Math.round(esperado * 100));
    });
  });

  it("reposição COM preço negociado gravado no item: receber usa o preço do item, não o do cadastro", async () => {
    await withTx(async (c) => {
      const { oc, itemA, av, negociado } = await cenario(c);
      await c.query(`select aplicar_resolucao_alerta_tecido($1,'troca',$2,$3,80)`, [itemA, av.art, av.var]);
      await c.query(`update ocs_tecido_itens set preco = $2 where substitui_item_id = $1`, [itemA, negociado]);
      await c.query(`select receber_reposicao_troca($1, current_date, 80)`, [itemA]);
      const esperado = Math.round((50 * Number(av.preco) + 80 * negociado) * 100) / 100;
      expect((await totais(c, oc)).real).toBe(esperado.toFixed(2));
    });
  });
});
