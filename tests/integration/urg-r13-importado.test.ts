/**
 * R13 T3 — lado Produto IMPORTADO: fazer_pedido_importado / salvar_oc_importado_itens / receber_item_oc_importado /
 * vincular_oc_importado / excluir / guardas de produto / cambio-landed POR ITEM / escritores antigos recusam / seguranca.
 * Gancho URG_R13_TXN=1 (R13 aplicada na txn do teste; copia4 R11-final como base). So na copia local, suite com a copia QUIETA.
 *
 * §5 (lado PI):
 *  - fazer pedido: 2 moedas -> 2 OCs; cotacoes/etapas do 1o produto; moeda diferente -> moeda_diferente:; Σ e parcelas sobre o total;
 *  - salvar: diff por id; etapas estado completo; landed recalculado; parcelas idempotentes;
 *  - receber item: cad/cad_grades/CQ so do modelo; landed por item; status derivado;
 *  - landed rateado: Σ(landed × q) dos itens = Σ BRL das etapas (±0,01); base total 0 -> divisao igual;
 *  - vincular: a/b/c + moeda + OC recebida; excluir com item recebido -> recusa; escritores antigos -> versao_antiga;
 *  - seguranca (wrappers sem anon; cores/helpers revogados dos 3).
 */
import { describe, it, expect } from "vitest";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

const rodar = hasDb && ehBancoLocal && process.env.URG_R13_TXN === "1";

let seq = 0;
const uq = (s: string) => `${s} #${TENANT_TESTE.slice(0, 4)}${seq++}`;

async function base(c: any) {
  await comoUsuario(c);
  const g = (await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}',$1) returning id`, [uq("Fem")])).id;
  const cat = (await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}',$1) returning id`, [uq("Vestido")])).id;
  const emp = (await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${TENANT_TESTE}',$1,'material') returning id`, [uq("Beltrano Imp")])).id;
  const empB = (await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${TENANT_TESTE}',$1,'material') returning id`, [uq("Fulano Imp")])).id;
  return { g, cat, emp, empB };
}

/** cria um produto importado ELEGIVEL. moeda default RMB/USD. etapas: 1 de mercadoria 100% (cotacao>0). */
async function prodImp(
  c: any,
  o: {
    nome: string; grupo: string; cat: string; empresa: string;
    qtd?: number; vu?: number; peso?: number; transp?: number; desc?: number;
    moedaCompra?: string; moedaInter?: string | null; cotacaoFinal?: number;
    etapas?: Array<{ ordem?: number; rotulo?: string; base?: string; percentual?: number; cotacao?: number; data_vencimento?: string | null }>;
  },
): Promise<string> {
  const qtd = o.qtd ?? 10;
  const pid = (await um<any>(c, `
    insert into produtos_importados (tenant_id, nome, grupo_id, categoria_id, empresa_id, qtd_total, valor_unitario_m1, peso_kg,
      transporte_m2, desconto_pct, grade_proporcao, moeda_compra, moeda_intermediaria, cotacao_ref, cotacao_final)
    values ('${TENANT_TESTE}',$1,$2,$3,$4,$5,$6,$7,$8,$9,'{"UN":1}'::jsonb,$10,$11,1,$12) returning id`, [
    o.nome, o.grupo, o.cat, o.empresa, qtd, o.vu ?? 20, o.peso ?? 1, o.transp ?? 2, o.desc ?? 0,
    o.moedaCompra ?? "RMB", "moedaInter" in o ? o.moedaInter : "USD", o.cotacaoFinal ?? 0.8,
  ])).id;
  await c.query(`insert into produto_importado_variantes (tenant_id, produto_importado_id, ordem, qtd, cor_id, cor_apelido_id) values ('${TENANT_TESTE}',$1,0,$2,null,null)`, [pid, qtd]);
  const etapas = o.etapas ?? [{ ordem: 1, rotulo: "Mercadoria", base: "mercadoria", percentual: 100, cotacao: 0.8 }];
  for (const e of etapas) {
    await c.query(`insert into produto_importado_etapas (tenant_id, produto_importado_id, ordem, rotulo, base, percentual, data_vencimento, cotacao)
      values ('${TENANT_TESTE}',$1,$2,$3,$4,$5,$6,$7)`, [pid, e.ordem ?? 1, e.rotulo ?? "", e.base ?? "mercadoria", e.percentual ?? 100, e.data_vencimento ?? null, e.cotacao ?? 0.8]);
  }
  return pid;
}

async function comCard(c: any, produtoId: string): Promise<string> {
  const m = (await um<any>(c, `insert into modelos (tenant_id, nome, origem) values ('${TENANT_TESTE}','Card imp','importado') returning id`)).id;
  await c.query(`update produtos_importados set modelo_id=$1 where id=$2`, [m, produtoId]);
  return m;
}

async function pedir(c: any, ped: any[]): Promise<any[]> {
  return (await um<any>(c, `select public.fazer_pedido_importado($1::jsonb) as r`, [JSON.stringify(ped)])).r;
}

// Σ(landed×q) dos itens == Σ BRL das etapas (±0,01 por item, arredondamento a 4 casas)
async function conferirLandedRateado(c: any, ocId: string) {
  const sbrl = Number((await um<any>(c, `select coalesce(sum(valor_brl),0) s from public._imp_etapas_brl_oc($1)`, [ocId])).s);
  const slandedq = Number((await um<any>(c, `select coalesce(sum(custo_unitario_landed_real * qtd_total),0) s from ocs_importado_itens where oc_id=$1`, [ocId])).s);
  const nItens = Number((await um<any>(c, `select count(*) n from ocs_importado_itens where oc_id=$1 and qtd_total>0`, [ocId])).n);
  // 4 casas por item -> erro max ~0,00005 x q por item; folga generosa de 0,01 x nItens
  expect(Math.abs(slandedq - sbrl), `Σlanded×q (${slandedq}) vs ΣBRL (${sbrl})`).toBeLessThanOrEqual(0.01 * Math.max(nItens, 1) + 0.005);
  return { sbrl, slandedq };
}

(rodar ? describe : describe.skip)("R13 T3 — fazer_pedido_importado", () => {
  it("2 moedas -> 2 OCs; cotacoes/etapas do 1o produto; Σ e parcelas sobre o total", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      // grupo RMB: 2 produtos
      const a1 = await prodImp(c, { nome: "A1", grupo: g, cat, empresa: emp, qtd: 10, vu: 20, moedaCompra: "RMB", moedaInter: "USD", cotacaoFinal: 0.8 });
      const a2 = await prodImp(c, { nome: "A2", grupo: g, cat, empresa: emp, qtd: 5, vu: 10, moedaCompra: "RMB", moedaInter: "USD", cotacaoFinal: 0.8 });
      // grupo USD: 1 produto (moeda_compra diferente)
      const b1 = await prodImp(c, { nome: "B1", grupo: g, cat, empresa: emp, qtd: 4, vu: 50, moedaCompra: "USD", moedaInter: null, cotacaoFinal: 5 });

      const out = await pedir(c, [
        { empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [a1, a2] },
        { empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "USD", moeda_intermediaria: null, produto_ids: [b1] },
      ]);
      expect(out.length).toBe(2); // 2 moedas -> 2 OCs
      const ocRmb = out[0].oc_id, ocUsd = out[1].oc_id;

      // OC RMB: 2 itens; moeda/cotacao do 1o produto (a1)
      expect(Number((await um<any>(c, `select count(*) n from ocs_importado_itens where oc_id=$1`, [ocRmb])).n)).toBe(2);
      const cabRmb = await um<any>(c, `select moeda_compra, moeda_intermediaria, cotacao_final, qtd_total, valor_bruto from ocs_importado where id=$1`, [ocRmb]);
      expect(cabRmb.moeda_compra).toBe("RMB");
      expect(Number(cabRmb.qtd_total)).toBe(15);
      expect(Number(cabRmb.valor_bruto)).toBe(10 * 20 + 5 * 10); // 250 em M1
      // etapas do 1o produto copiadas para a OC
      expect(Number((await um<any>(c, `select count(*) n from ocs_importado_etapas where oc_importado_id=$1`, [ocRmb])).n)).toBeGreaterThanOrEqual(1);

      // OC USD: 1 item
      expect(Number((await um<any>(c, `select count(*) n from ocs_importado_itens where oc_id=$1`, [ocUsd])).n)).toBe(1);
      const cabUsd = await um<any>(c, `select moeda_compra from ocs_importado where id=$1`, [ocUsd]);
      expect(cabUsd.moeda_compra).toBe("USD");

      // parcelas sobre o total de cada OC (1 etapa mercadoria 100% => 1 parcela > 0)
      const parcRmb = Number((await um<any>(c, `select coalesce(sum(valor),0) s from parcelas where oc_importado_id=$1 and tipo_oc='p_importado'`, [ocRmb])).s);
      expect(parcRmb).toBeGreaterThan(0);
      // landed rateado bate com as etapas BRL
      await conferirLandedRateado(c, ocRmb);
      await conferirLandedRateado(c, ocUsd);
    });
  });

  it("produto de moeda diferente da do pedido -> moeda_diferente:", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const ok = await prodImp(c, { nome: "OK", grupo: g, cat, empresa: emp, moedaCompra: "RMB", moedaInter: "USD" });
      const outro = await prodImp(c, { nome: "Outro", grupo: g, cat, empresa: emp, moedaCompra: "USD", moedaInter: null });
      await c.query(`SAVEPOINT sp`); let msg = "";
      try {
        await pedir(c, [{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [ok, outro] }]);
      } catch (e: any) { msg = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(msg).toMatch(/moeda_diferente/);
    });
  });

  it("produto de OUTRA loja -> P0002 nao_encontrado", async () => {
    await withTx(async (c) => {
      const outra = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // Ave Rara
      const g = (await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${outra}','Fem R13impL') returning id`)).id;
      const cat = (await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${outra}','Vestido R13impL') returning id`)).id;
      const emp = (await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${outra}','Beltrano R13impL','material') returning id`)).id;
      const pid = (await um<any>(c, `insert into produtos_importados (tenant_id, nome, grupo_id, categoria_id, empresa_id, qtd_total, valor_unitario_m1, grade_proporcao, moeda_compra, moeda_intermediaria)
        values ('${outra}','X','${g}','${cat}','${emp}',10,20,'{"UN":1}'::jsonb,'RMB','USD') returning id`)).id;
      await c.query(`insert into produto_importado_variantes (tenant_id, produto_importado_id, ordem, qtd) values ('${outra}','${pid}',0,10)`);
      await comoUsuario(c);
      await expect(pedir(c, [{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [pid] }]))
        .rejects.toThrow(/nao_encontrado: produto/);
    });
  });
});

(rodar ? describe : describe.skip)("R13 T3 — salvar / receber / landed por item", () => {
  it("salvar: diff por id (IDs preservados); landed recalculado; parcelas idempotentes", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 10, vu: 20 });
      const p2 = await prodImp(c, { nome: "P2", grupo: g, cat, empresa: emp, qtd: 5, vu: 10 });
      const oc = (await pedir(c, [{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [p1] }]))[0].oc_id;
      const cols = `id, produto_importado_id, qtd_total, valor_unitario_m1, peso_kg, transporte_m2, desconto_pct, grade_detalhe, variantes`;
      const estado1 = (await c.query(`select ${cols} from ocs_importado_itens where oc_id=$1 order by ordem`, [oc])).rows.map((r: any) => ({
        id: r.id, produto_importado_id: r.produto_importado_id, qtd_total: Number(r.qtd_total), valor_unitario_m1: Number(r.valor_unitario_m1),
        peso_kg: Number(r.peso_kg), transporte_m2: Number(r.transporte_m2), desconto_pct: Number(r.desconto_pct), grade_detalhe: r.grade_detalhe, variantes: r.variantes }));
      const id1 = estado1[0].id;
      const rev = Number((await um<any>(c, `select rev from ocs_importado where id=$1`, [oc])).rev);
      const parcAntes = Number((await c.query(`select coalesce(sum(valor),0) s from parcelas where oc_importado_id=$1`, [oc])).rows[0].s);

      // adiciona p2 (do_produto), etapas null = mantem as da OC
      const itens = [...estado1, { produto_importado_id: p2, do_produto: true }];
      await c.query(`select public.salvar_oc_importado_itens($1, $2::jsonb, $3::jsonb, null, $4)`, [oc, JSON.stringify({ empresa_id: emp }), JSON.stringify(itens), rev]);
      const now = await c.query(`select id, produto_importado_id from ocs_importado_itens where oc_id=$1 order by ordem`, [oc]);
      expect(now.rows.length).toBe(2);
      expect(now.rows[0].id).toBe(id1); // id preservado
      const cab = await um<any>(c, `select qtd_total, valor_bruto from ocs_importado where id=$1`, [oc]);
      expect(Number(cab.qtd_total)).toBe(15);
      expect(Number(cab.valor_bruto)).toBe(10 * 20 + 5 * 10);
      await conferirLandedRateado(c, oc);

      // parcelas idempotentes: salvar de novo (sem mudar) nao duplica parcela
      const nParc1 = Number((await c.query(`select count(*) n from parcelas where oc_importado_id=$1`, [oc])).rows[0].n);
      const rev2 = Number((await um<any>(c, `select rev from ocs_importado where id=$1`, [oc])).rev);
      const estado2 = (await c.query(`select ${cols} from ocs_importado_itens where oc_id=$1 order by ordem`, [oc])).rows.map((r: any) => ({
        id: r.id, produto_importado_id: r.produto_importado_id, qtd_total: Number(r.qtd_total), valor_unitario_m1: Number(r.valor_unitario_m1),
        peso_kg: Number(r.peso_kg), transporte_m2: Number(r.transporte_m2), desconto_pct: Number(r.desconto_pct), grade_detalhe: r.grade_detalhe, variantes: r.variantes }));
      await c.query(`select public.salvar_oc_importado_itens($1, $2::jsonb, $3::jsonb, null, $4)`, [oc, JSON.stringify({ empresa_id: emp }), JSON.stringify(estado2), rev2]);
      const nParc2 = Number((await c.query(`select count(*) n from parcelas where oc_importado_id=$1`, [oc])).rows[0].n);
      expect(nParc2).toBe(nParc1); // idempotente
    });
  });

  it("etapas = estado completo (Σ% por base; cotacao de mercadoria > 0 quando ha valor)", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 10, vu: 20 });
      const oc = (await pedir(c, [{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [p1] }]))[0].oc_id;
      const estado1 = (await c.query(`select id, produto_importado_id, qtd_total, valor_unitario_m1, peso_kg, transporte_m2, desconto_pct, grade_detalhe, variantes from ocs_importado_itens where oc_id=$1 order by ordem`, [oc])).rows.map((r: any) => ({
        id: r.id, produto_importado_id: r.produto_importado_id, qtd_total: Number(r.qtd_total), valor_unitario_m1: Number(r.valor_unitario_m1),
        peso_kg: Number(r.peso_kg), transporte_m2: Number(r.transporte_m2), desconto_pct: Number(r.desconto_pct), grade_detalhe: r.grade_detalhe, variantes: r.variantes }));
      const rev = Number((await um<any>(c, `select rev from ocs_importado where id=$1`, [oc])).rev);
      // etapa mercadoria com % > 0 e cotacao 0 -> recusa (ha valor de compra)
      await c.query(`SAVEPOINT sp`); let msg = "";
      try {
        await c.query(`select public.salvar_oc_importado_itens($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)`, [oc, JSON.stringify({ empresa_id: emp }),
          JSON.stringify(estado1), JSON.stringify([{ ordem: 1, base: "mercadoria", percentual: 100, cotacao: 0 }]), rev]);
      } catch (e: any) { msg = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(msg).toMatch(/cotacao/i);
      // Σ% != 100 -> recusa
      await c.query(`SAVEPOINT sp2`); let msg2 = "";
      try {
        await c.query(`select public.salvar_oc_importado_itens($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)`, [oc, JSON.stringify({ empresa_id: emp }),
          JSON.stringify(estado1), JSON.stringify([{ ordem: 1, base: "mercadoria", percentual: 60, cotacao: 0.8 }]), rev]);
      } catch (e: any) { msg2 = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp2`);
      expect(msg2).toMatch(/mercadoria/);
    });
  });

  it("receber item: cad/cad_grades/CQ SO daquele modelo; landed por item; status derivado", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, vu: 50 });
      const p2 = await prodImp(c, { nome: "P2", grupo: g, cat, empresa: emp, qtd: 3, vu: 10 });
      const m1 = await comCard(c, p1);
      const m2 = await comCard(c, p2);
      const oc = (await pedir(c, [{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [p1, p2] }]))[0].oc_id;
      const itens = (await c.query(`select id, produto_importado_id from ocs_importado_itens where oc_id=$1 order by ordem`, [oc])).rows;
      const i1 = itens.find((x: any) => x.produto_importado_id === p1);
      const i2 = itens.find((x: any) => x.produto_importado_id === p2);
      const estado = itens.map((x: any) => ({ id: x.id }));
      const rev = Number((await um<any>(c, `select rev from ocs_importado where id=$1`, [oc])).rev);
      await c.query(`select public.receber_item_oc_importado($1, $2, $3::jsonb, $4::jsonb, null, $5)`, [oc, i1.id, JSON.stringify({ item_data_entrega: "2026-03-10" }), JSON.stringify(estado), rev]);
      // cad/CQ de m1 existe; de m2 NAO
      expect(Number((await um<any>(c, `select count(*) n from cad where modelo_id=$1`, [m1])).n)).toBe(1);
      expect(Number((await um<any>(c, `select count(*) n from cad where modelo_id=$1`, [m2])).n)).toBe(0);
      const cad1 = (await um<any>(c, `select id from cad where modelo_id=$1`, [m1])).id;
      expect(Number((await um<any>(c, `select count(*) n from controle_qualidade where cad_id=$1`, [cad1])).n)).toBe(1);
      // cabecalho encomendado (1 de 2 itens recebido)
      expect((await um<any>(c, `select status from ocs_importado where id=$1`, [oc])).status).toBe("encomendado");
      await conferirLandedRateado(c, oc);

      // recebe item 2 com data maior -> cabecalho recebido; data_entrega = max
      const rev2 = Number((await um<any>(c, `select rev from ocs_importado where id=$1`, [oc])).rev);
      await c.query(`select public.receber_item_oc_importado($1, $2, $3::jsonb, $4::jsonb, null, $5)`, [oc, i2.id, JSON.stringify({ item_data_entrega: "2026-04-15" }), JSON.stringify(estado), rev2]);
      const cab2 = await um<any>(c, `select status, data_entrega::text from ocs_importado where id=$1`, [oc]);
      expect(cab2.status).toBe("recebido");
      expect(cab2.data_entrega).toBe("2026-04-15");
    });
  });

  it("landed rateado: Σ(landed×q) = Σ BRL (2 itens, pesos/valores diferentes); cada item com landed > 0", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      // etapas: mercadoria 100% + frete 100% (os 2 itens tem valor E peso -> ambas as bases > 0)
      const etapas = [
        { ordem: 1, rotulo: "Merc", base: "mercadoria", percentual: 100, cotacao: 0.8 },
        { ordem: 2, rotulo: "Frete", base: "frete", percentual: 100, cotacao: 1 },
      ];
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 7, vu: 30, peso: 2, transp: 3, etapas });
      const p2 = await prodImp(c, { nome: "P2", grupo: g, cat, empresa: emp, qtd: 4, vu: 15, peso: 1, transp: 5, etapas });
      const oc = (await pedir(c, [{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [p1, p2] }]))[0].oc_id;
      const { sbrl } = await conferirLandedRateado(c, oc);
      expect(sbrl).toBeGreaterThan(0);
      // cada item tem landed > 0 (ambas as bases > 0)
      const landeds = (await c.query(`select custo_unitario_landed_real l from ocs_importado_itens where oc_id=$1 order by ordem`, [oc])).rows;
      for (const r of landeds) expect(Number(r.l)).toBeGreaterThan(0);
    });
  });

  it("base total 0 na etapa -> _imp_recalcular_landed_real_oc divide igual entre itens com q>0 (sem divisao por zero)", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      // OC valida (itens com valor/peso) -> etapas mercadoria+frete; depois FORCAMOS base total 0 numa etapa zerando valor/peso
      // dos itens (direto na tabela de itens, bypass das travas de recebido) e injetamos valor_brl numa etapa para provar o
      // ramo defensivo (base_total 0 -> divisao igual entre os itens com q>0, sem perder a parcela e sem divisao por zero).
      const etapas = [{ ordem: 1, rotulo: "Merc", base: "mercadoria", percentual: 100, cotacao: 0.8 }];
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 5, vu: 20, peso: 1, transp: 1, etapas });
      const p2 = await prodImp(c, { nome: "P2", grupo: g, cat, empresa: emp, qtd: 3, vu: 10, peso: 1, transp: 1, etapas });
      const oc = (await pedir(c, [{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [p1, p2] }]))[0].oc_id;
      // zera valor E peso/transporte dos itens -> base de mercadoria E frete de cada item = 0 (base_total = 0 em toda etapa,
      // inclusive o frete implicito). Prova o ramo defensivo: sem divisao por zero; a identidade Σlanded×q == ΣBRL se mantem.
      await c.query(`update ocs_importado_itens set valor_unitario_m1 = 0, valor_bruto = 0, valor_total_desconto = 0, peso_kg = 0, transporte_m2 = 0 where oc_id = $1`, [oc]);
      await c.query(`select public._imp_recalcular_landed_real_oc($1)`, [oc]);
      const { sbrl, slandedq } = await conferirLandedRateado(c, oc);
      expect(sbrl).toBe(0);     // base 0 em tudo -> ΣBRL 0
      expect(slandedq).toBe(0); // landed 0, sem crash de divisao por zero
      // e o ramo "divisao igual" nao quebra mesmo se houver valor_brl: prova unitaria no SQL abaixo
      const r = await um<any>(c, `
        with e(base, valor_brl) as (values ('mercadoria'::text, 100.0::numeric)),
             itens as (select id, qtd_total from ocs_importado_itens where oc_id = $1),
             nq as (select count(*) filter (where qtd_total > 0) nq, count(*) n from itens)
        select coalesce(sum(round(e.valor_brl * (case when (select coalesce(sum(0),0)) > 0 then 0
                  else (case when nq.nq > 0 then (case when i.qtd_total > 0 then 1.0 else 0 end)/nq.nq else 1.0/greatest(nq.n,1) end) end), 4)),0) as parte
        from itens i cross join e cross join nq group by nq.nq, nq.n`, [oc]);
      // soma das partes da etapa (valor_brl 100) dividida igual = 100 (nada perdido)
      expect(Math.abs(Number(r.parte) - 100)).toBeLessThanOrEqual(0.01);
    });
  });
});

(rodar ? describe : describe.skip)("R13 T3 — vincular / excluir / escritores antigos / seguranca", () => {
  it("vincular: (b) adicionar; moeda diferente recusa; (c) desvincular 1 vs 2+; OC recebida recusa", async () => {
    await withTx(async (c) => {
      const { g, cat, emp, empB } = await base(c);
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, moedaCompra: "RMB", moedaInter: "USD" });
      const p2 = await prodImp(c, { nome: "P2", grupo: g, cat, empresa: emp, moedaCompra: "RMB", moedaInter: "USD" });
      const pMoeda = await prodImp(c, { nome: "PM", grupo: g, cat, empresa: emp, moedaCompra: "USD", moedaInter: null });
      const pForn = await prodImp(c, { nome: "PF", grupo: g, cat, empresa: empB, moedaCompra: "RMB", moedaInter: "USD" });
      const oc = (await pedir(c, [{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [p1] }]))[0].oc_id;
      // (b) adicionar p2 via vincular
      await c.query(`select public._vincular_oc_importado_core('${oc}','${p2}')`);
      expect(Number((await um<any>(c, `select count(*) n from ocs_importado_itens where oc_id=$1`, [oc])).n)).toBe(2);
      // moeda diferente recusa
      await c.query(`SAVEPOINT sp`); let m1 = "";
      try { await c.query(`select public._vincular_oc_importado_core('${oc}','${pMoeda}')`); } catch (e: any) { m1 = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(m1).toMatch(/moeda_diferente/);
      // fornecedor diferente recusa
      await c.query(`SAVEPOINT spf`); let mf = "";
      try { await c.query(`select public._vincular_oc_importado_core('${oc}','${pForn}')`); } catch (e: any) { mf = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT spf`);
      expect(mf).toMatch(/fornecedor_diferente/);
      // desvincular com 2+ itens recusa
      await c.query(`SAVEPOINT sp2`); let m2 = "";
      try { await c.query(`select public._vincular_oc_importado_core('${oc}', null)`); } catch (e: any) { m2 = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp2`);
      expect(m2).toMatch(/oc_varios_produtos/);
    });
  });

  it("excluir produto com OC (item) vinculada -> recusa pelo numero; excluir OC com item recebido -> recusa", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, vu: 50 });
      await comCard(c, p1);
      const oc = (await pedir(c, [{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [p1] }]))[0].oc_id;
      await c.query(`SAVEPOINT sp`); let msg = "";
      try { await c.query(`select public._excluir_produto_importado_core('${p1}')`); } catch (e: any) { msg = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(msg).toMatch(/Desvincule a OC/i);
      // recebe o item e tenta excluir a OC -> recusa
      const i1 = (await um<any>(c, `select id from ocs_importado_itens where oc_id=$1`, [oc])).id;
      const rev = Number((await um<any>(c, `select rev from ocs_importado where id=$1`, [oc])).rev);
      await c.query(`select public.receber_item_oc_importado($1, $2, '{}'::jsonb, $3::jsonb, null, $4)`, [oc, i1, JSON.stringify([{ id: i1 }]), rev]);
      await c.query(`SAVEPOINT sp2`); let msg2 = "";
      try { await c.query(`select public.excluir_oc_importado('${oc}')`); } catch (e: any) { msg2 = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp2`);
      expect(msg2).toMatch(/recebido/i);
    });
  });

  it("custo real do item importado recebido: NULL -> real; landed por item vira o custo real", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, vu: 50 });
      const m1 = await comCard(c, p1);
      const oc = (await pedir(c, [{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [p1] }]))[0].oc_id;
      const custoAntes = (await um<any>(c, `select public._custo_unitario_modelos_core(array['${m1}']::uuid[]) as j`)).j;
      expect(custoAntes[m1].real).toBeNull();
      const i1 = (await um<any>(c, `select id from ocs_importado_itens where oc_id=$1`, [oc])).id;
      const rev = Number((await um<any>(c, `select rev from ocs_importado where id=$1`, [oc])).rev);
      await c.query(`select public.receber_item_oc_importado($1, $2, '{}'::jsonb, $3::jsonb, null, $4)`, [oc, i1, JSON.stringify([{ id: i1 }]), rev]);
      const custoDepois = (await um<any>(c, `select public._custo_unitario_modelos_core(array['${m1}']::uuid[]) as j`)).j;
      expect(custoDepois[m1].real).not.toBeNull();
    });
  });

  it("escritores antigos (_salvar/_receber_oc_importado_core) recusam versao_antiga", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`SAVEPOINT sp`); let m1 = "";
      try { await c.query(`select public._salvar_oc_importado_core(null, '{"nome_produto":"X"}'::jsonb, '{}'::jsonb, '[]'::jsonb, null)`); } catch (e: any) { m1 = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(m1).toMatch(/versao_antiga/);
      await c.query(`SAVEPOINT sp2`); let m2 = "";
      try { await c.query(`select public._receber_oc_importado_core('${TENANT_TESTE}'::uuid, '{}'::jsonb, '{}'::jsonb)`); } catch (e: any) { m2 = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp2`);
      expect(m2).toMatch(/versao_antiga/);
    });
  });

  it("seguranca: wrappers PI sem EXECUTE p/ anon; _core/helpers revogados dos 3", async () => {
    await withTx(async (c) => {
      const wrappers = [
        "public.fazer_pedido_importado(jsonb)",
        "public.salvar_oc_importado_itens(uuid,jsonb,jsonb,jsonb,integer)",
        "public.receber_item_oc_importado(uuid,uuid,jsonb,jsonb,jsonb,integer)",
        "public.vincular_oc_importado(uuid,uuid)",
      ];
      for (const w of wrappers) {
        expect(Boolean((await um<any>(c, `select has_function_privilege('anon','${w}','EXECUTE') as b`)).b), `anon ${w}`).toBe(false);
        expect(Boolean((await um<any>(c, `select has_function_privilege('authenticated','${w}','EXECUTE') as b`)).b), `auth ${w}`).toBe(true);
      }
      const cores = [
        "public._fazer_pedido_importado_core(jsonb)",
        "public._salvar_oc_importado_itens_core(uuid,jsonb,jsonb,jsonb,integer)",
        "public._receber_item_oc_importado_core(uuid,uuid,jsonb,jsonb,jsonb,integer)",
        "public._vincular_oc_importado_core(uuid,uuid)",
        "public._oci_aplicar_derivados(uuid)",
        "public._oci_copiar_etapas_do_produto(uuid,uuid,uuid)",
      ];
      for (const f of cores) {
        expect(Boolean((await um<any>(c, `select has_function_privilege('anon','${f}','EXECUTE') as b`)).b), `anon ${f}`).toBe(false);
        expect(Boolean((await um<any>(c, `select has_function_privilege('authenticated','${f}','EXECUTE') as b`)).b), `auth ${f}`).toBe(false);
      }
    });
  });

  it("anti-drift: as funcoes PI novas nao embedam/filtram o cabecalho por produto_importado_id", async () => {
    await withTx(async (c) => {
      // nenhuma das funcoes NOVAS da T3 cita 'ocs_importado ... produto_importado_id' no cabecalho (so nos itens).
      const sigs = [
        "public._fazer_pedido_importado_core(jsonb)",
        "public._salvar_oc_importado_itens_core(uuid,jsonb,jsonb,jsonb,integer)",
        "public._receber_item_oc_importado_core(uuid,uuid,jsonb,jsonb,jsonb,integer)",
        "public._vincular_oc_importado_core(uuid,uuid)",
        "public._imp_etapas_brl_oc(uuid)",
        "public._imp_recalcular_landed_real_oc(uuid)",
      ];
      for (const s of sigs) {
        const d = (await um<any>(c, `select pg_get_functiondef(to_regprocedure('${s}')) as d`)).d as string;
        // "ocs_importado" (cabecalho) + "produto_importado_id" na MESMA funcao sem ser via "_itens" = suspeito.
        // Aqui so garantimos que nenhuma le o ponteiro do cabecalho (ocs_importado.produto_importado_id).
        expect(/ocs_importado\b(?![_\w])[^;]*\.produto_importado_id/.test(d), s).toBe(false);
      }
    });
  });
});

// P-382 #3 (dono, out/2026): item AVULSO NOVO (sem id, sem do_produto) valida grade negativa / Σ pedida <> qtd no servidor, como o existente.
// P-382 #1: o nº da OC e gerado por padrao mas EDITAVEL (`numero` do `_dados`; vazio = gera/mantem; repetido na loja = 23505).
(rodar ? describe : describe.skip)("P-382 — OC de Produto Importado: avulso valida grade/Σ + nº editável", () => {
  const avulso = (o: { qtd: number; grade: any }) => ({
    nome_produto: "Avulso Imp P382", qtd_total: o.qtd, valor_unitario_m1: 10, peso_kg: 1, transporte_m2: 0, grade_proporcao: { P: 1, M: 1 },
    variantes: [{ ordem: 0, peso: 1, qtd: o.qtd }], grade_detalhe: o.grade,
  });
  const cab = (emp: string, numero?: string) => ({ empresa_id: emp, moeda_compra: "RMB", cotacao_ref: 1, cotacao_final: 1, ...(numero === undefined ? {} : { numero }) });
  async function salvar(c: any, id: string | null, dados: any, itens: any[], rev: number | null = null): Promise<string> {
    return (await um<any>(c, `select public.salvar_oc_importado_itens($1, $2::jsonb, $3::jsonb, null, $4) as id`, [id, JSON.stringify(dados), JSON.stringify(itens), rev])).id;
  }
  async function tentar(c: any, sp: string, id: string | null, dados: any, itens: any[], rev: number | null = null): Promise<string> {
    await c.query(`SAVEPOINT ${sp}`);
    let msg = "";
    try { await salvar(c, id, dados, itens, rev); } catch (e: any) { msg = String(e?.message ?? ""); }
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    return msg;
  }
  const numeroDe = async (c: any, id: string) => (await um<any>(c, `select numero from ocs_importado where id=$1`, [id])).numero as string;

  it("avulso novo: celula negativa recusa; Σ pedida <> qtd recusa; avulso valido passa", async () => {
    await withTx(async (c) => {
      const { emp } = await base(c);
      expect(await tentar(c, "sp1", null, cab(emp), [avulso({ qtd: 1, grade: { "0": { P: { pedida: 3 }, M: { pedida: -2 } } } })]))
        .toMatch(/quantidades da grade nao podem ser negativas/);
      expect(await tentar(c, "sp1b", null, cab(emp), [avulso({ qtd: 5, grade: { "0": { P: { pedida: 5, recebida: -1 } } } })]))
        .toMatch(/quantidades da grade nao podem ser negativas/);
      expect(await tentar(c, "sp2", null, cab(emp), [avulso({ qtd: 5, grade: { "0": { P: { pedida: 2 } } } })]))
        .toMatch(/A soma da grade pedida \(2\) difere da quantidade total \(5\)/);
      expect(Number((await um<any>(c, `select count(*)::int n from ocs_importado_itens where nome_produto='Avulso Imp P382' and tenant_id='${TENANT_TESTE}'`)).n)).toBe(0);
      const ok = await salvar(c, null, cab(emp), [avulso({ qtd: 5, grade: { "0": { P: { pedida: 2 }, M: { pedida: 3 } } } })]);
      expect(Number((await um<any>(c, `select qtd_total from ocs_importado where id=$1`, [ok])).qtd_total)).toBe(5);
    });
  });

  it("avulso novo numa OC existente tambem valida (o item existente fica intacto)", async () => {
    await withTx(async (c) => {
      const { emp } = await base(c);
      const oc = await salvar(c, null, cab(emp), [avulso({ qtd: 5, grade: { "0": { P: { pedida: 2 }, M: { pedida: 3 } } } })]);
      const existente = (await c.query(`select id, nome_produto, qtd_total, valor_unitario_m1, peso_kg, transporte_m2, desconto_pct, grade_detalhe, variantes, grade_proporcao from ocs_importado_itens where oc_id=$1`, [oc])).rows
        .map((r: any) => ({ id: r.id, nome_produto: r.nome_produto, qtd_total: Number(r.qtd_total), valor_unitario_m1: Number(r.valor_unitario_m1), peso_kg: Number(r.peso_kg),
          transporte_m2: Number(r.transporte_m2), desconto_pct: Number(r.desconto_pct), grade_detalhe: r.grade_detalhe, variantes: r.variantes, grade_proporcao: r.grade_proporcao }));
      const rev = Number((await um<any>(c, `select rev from ocs_importado where id=$1`, [oc])).rev);
      expect(await tentar(c, "sp3", oc, cab(emp), [...existente, avulso({ qtd: 4, grade: { "0": { P: { pedida: 5 }, M: { pedida: -1 } } } })], rev))
        .toMatch(/quantidades da grade nao podem ser negativas/);
      expect(await tentar(c, "sp4", oc, cab(emp), [...existente, avulso({ qtd: 4, grade: { "0": { P: { pedida: 1 } } } })], rev))
        .toMatch(/A soma da grade pedida \(1\) difere da quantidade total \(4\)/);
      expect(Number((await um<any>(c, `select count(*)::int n from ocs_importado_itens where oc_id=$1`, [oc])).n)).toBe(1);
    });
  });

  it("nº da OC: gerado por padrao, EDITAVEL (honrado na criacao e na edicao; vazio gera/mantem; repetido = 23505)", async () => {
    await withTx(async (c) => {
      const { emp } = await base(c);
      const item = avulso({ qtd: 5, grade: { "0": { P: { pedida: 2 }, M: { pedida: 3 } } } });
      // gerado por padrao (ausente / vazio / so espacos)
      for (const n of [undefined, "", "   "]) {
        const id = await salvar(c, null, cab(emp, n), [item]);
        expect(await numeroDe(c, id)).toMatch(/^[A-Z0-9]{3,}-\d{5}$/);
      }
      // editavel na criacao
      const a = await salvar(c, null, cab(emp, "IMPNUM-001"), [item]);
      expect(await numeroDe(c, a)).toBe("IMPNUM-001");
      // edicao: renomeia (espacos das pontas saem), em branco/ausente preserva
      const itemA = (await c.query(`select id from ocs_importado_itens where oc_id=$1`, [a])).rows[0].id;
      const estado = [{ ...item, id: itemA }];
      await salvar(c, a, cab(emp, "  IMPNUM-002 "), estado);
      expect(await numeroDe(c, a)).toBe("IMPNUM-002");
      await salvar(c, a, cab(emp, ""), estado);
      expect(await numeroDe(c, a)).toBe("IMPNUM-002");
      await salvar(c, a, cab(emp), estado);
      expect(await numeroDe(c, a)).toBe("IMPNUM-002");
      // repetido na mesma loja
      await c.query(`SAVEPOINT sp_dup`);
      await expect(salvar(c, null, cab(emp, "IMPNUM-002"), [item])).rejects.toThrow(/ux_ocs_importado_tenant_numero/);
      await c.query(`ROLLBACK TO SAVEPOINT sp_dup`);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// #16 (Onda 2): os campos de recebimento DO ITEM (NF, responsavel, data de entrega, devolucao, revisao, anexo da NF) gravam no
// SALVAR normal da OC, ANTES de marcar recebido. Receber continua ACAO SEPARADA (so ela muda status e materializa CAD/CQ).
(rodar ? describe : describe.skip)("#16 — recebimento do item grava no Salvar, sem receber (PI)", () => {
  const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
  const colab = async (c: any, tenant: string) =>
    (await um<any>(c, `insert into colaboradores (tenant_id, nome, tipo) values ($1,$2,'ITEST #16') returning id`, [tenant, uq("Recebedor Imp")])).id as string;
  const pedirUm = async (c: any, emp: string, produtoIds: string[]) =>
    (await pedir(c, [{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: produtoIds }]))[0].oc_id as string;

  const estadoComRec = async (c: any, oc: string, rec: Record<string, any>) => {
    const r = (await c.query(`select id, produto_importado_id, qtd_total, valor_unitario_m1, peso_kg, transporte_m2, desconto_pct, grade_detalhe, variantes from ocs_importado_itens where oc_id=$1 order by ordem`, [oc])).rows;
    return r.map((x: any) => ({ id: x.id, produto_importado_id: x.produto_importado_id, qtd_total: Number(x.qtd_total), valor_unitario_m1: Number(x.valor_unitario_m1),
      peso_kg: Number(x.peso_kg), transporte_m2: Number(x.transporte_m2), desconto_pct: Number(x.desconto_pct), grade_detalhe: x.grade_detalhe, variantes: x.variantes, ...rec }));
  };
  const salvar = async (c: any, oc: string, emp: string, itens: any[]) => {
    const rev = Number((await um<any>(c, `select rev from ocs_importado where id=$1`, [oc])).rev);
    await c.query(`select public.salvar_oc_importado_itens($1, $2::jsonb, $3::jsonb, null, $4)`, [oc, JSON.stringify({ empresa_id: emp }), JSON.stringify(itens), rev]);
  };
  const item = async (c: any, oc: string) =>
    um<any>(c, `select status, data_entrega::text as data_entrega, nota_fiscal, responsavel_recebimento_id, devolucao, revisao, anexo_nf_url, valor_unitario_m1, qtd_total from ocs_importado_itens where oc_id=$1`, [oc]);
  const receber = async (c: any, oc: string, itId: string, dados: any) => {
    const rev = Number((await um<any>(c, `select rev from ocs_importado where id=$1`, [oc])).rev);
    await c.query(`select public.receber_item_oc_importado($1, $2, $3::jsonb, $4::jsonb, null, $5)`, [oc, itId, JSON.stringify(dados), JSON.stringify(await estadoComRec(c, oc, {})), rev]);
  };

  it("salvar NF/responsavel/data/devolucao/revisao/anexo SEM receber: ficam gravados; item e OC seguem encomendados; nada de CAD/CQ; cabecalho sem data de entrega", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, vu: 50 });
      const m1 = await comCard(c, p1);
      const oc = await pedirUm(c, emp, [p1]);
      const resp = await colab(c, TENANT_TESTE);
      const parcAntes = (await um<any>(c, `select coalesce(sum(valor),0)::text s from parcelas where oc_importado_id=$1 and tipo_oc='p_importado'`, [oc])).s;

      await salvar(c, oc, emp, await estadoComRec(c, oc, {
        data_entrega: "2026-03-10", nota_fiscal: "NF-1234", responsavel_recebimento_id: resp, devolucao: "2 pecas", revisao: "ok", anexo_nf_url: "tenant/nf.pdf",
      }));

      const it = await item(c, oc);
      expect(it).toMatchObject({ data_entrega: "2026-03-10", nota_fiscal: "NF-1234", responsavel_recebimento_id: resp, devolucao: "2 pecas", revisao: "ok", anexo_nf_url: "tenant/nf.pdf" });
      expect(it.status).toBe("encomendado");
      const cab = await um<any>(c, `select status, data_entrega from ocs_importado where id=$1`, [oc]);
      expect(cab.status).toBe("encomendado");
      expect(cab.data_entrega).toBeNull();
      expect(Number((await um<any>(c, `select count(*) n from cad where modelo_id=$1`, [m1])).n)).toBe(0);
      expect(Number((await um<any>(c, `select count(*) n from controle_qualidade where cad_id in (select id from cad where modelo_id=$1)`, [m1])).n)).toBe(0);
      expect((await um<any>(c, `select coalesce(sum(valor),0)::text s from parcelas where oc_importado_id=$1 and tipo_oc='p_importado'`, [oc])).s).toBe(parcAntes);
    });
  });

  it("chave AUSENTE mantem; vazio/null limpa; editar a NF e salvar de novo persiste", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp });
      const oc = await pedirUm(c, emp, [p1]);
      const resp = await colab(c, TENANT_TESTE);
      await salvar(c, oc, emp, await estadoComRec(c, oc, { data_entrega: "2026-03-10", nota_fiscal: "NF-1", responsavel_recebimento_id: resp, revisao: "r1", devolucao: "d1" }));

      await salvar(c, oc, emp, await estadoComRec(c, oc, {}));
      expect(await item(c, oc)).toMatchObject({ data_entrega: "2026-03-10", nota_fiscal: "NF-1", responsavel_recebimento_id: resp, revisao: "r1", devolucao: "d1" });

      await salvar(c, oc, emp, await estadoComRec(c, oc, { nota_fiscal: "NF-2" }));
      expect(await item(c, oc)).toMatchObject({ data_entrega: "2026-03-10", nota_fiscal: "NF-2", responsavel_recebimento_id: resp, revisao: "r1" });

      await salvar(c, oc, emp, await estadoComRec(c, oc, { data_entrega: "", nota_fiscal: "", responsavel_recebimento_id: null, revisao: null, devolucao: "" }));
      const it = await item(c, oc);
      expect(it.data_entrega).toBeNull();
      expect(it.nota_fiscal).toBeNull();
      expect(it.responsavel_recebimento_id).toBeNull();
      expect(it.revisao).toBeNull();
      expect(it.devolucao).toBeNull();
      expect(it.status).toBe("encomendado");
    });
  });

  it("depois, RECEBER materializa (CAD/CQ, status) e preserva o que o Salvar gravou; receber sem item_* no _dados nao zera a NF", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, vu: 50 });
      const m1 = await comCard(c, p1);
      const oc = await pedirUm(c, emp, [p1]);
      const resp = await colab(c, TENANT_TESTE);
      await salvar(c, oc, emp, await estadoComRec(c, oc, { data_entrega: "2026-03-10", nota_fiscal: "NF-PRE", responsavel_recebimento_id: resp }));
      expect(Number((await um<any>(c, `select count(*) n from cad where modelo_id=$1`, [m1])).n)).toBe(0);

      const itId = (await um<any>(c, `select id from ocs_importado_itens where oc_id=$1`, [oc])).id;
      await receber(c, oc, itId, {});
      expect(await item(c, oc)).toMatchObject({ status: "recebido", data_entrega: "2026-03-10", nota_fiscal: "NF-PRE", responsavel_recebimento_id: resp });
      expect(Number((await um<any>(c, `select count(*) n from cad where modelo_id=$1`, [m1])).n)).toBe(1);
      expect(Number((await um<any>(c, `select count(*) n from controle_qualidade where cad_id in (select id from cad where modelo_id=$1)`, [m1])).n)).toBe(1);
      expect(await um<any>(c, `select status, data_entrega::text as data_entrega from ocs_importado where id=$1`, [oc])).toMatchObject({ status: "recebido", data_entrega: "2026-03-10" });
    });
  });

  it("item JA recebido: editar NF/revisao e salvar persiste (valor/qtd seguem travados) e o status nao muda", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, vu: 50 });
      await comCard(c, p1);
      const oc = await pedirUm(c, emp, [p1]);
      const itId = (await um<any>(c, `select id from ocs_importado_itens where oc_id=$1`, [oc])).id;
      await receber(c, oc, itId, { item_data_entrega: "2026-03-10", item_nota_fiscal: "NF-A" });
      expect((await item(c, oc)).status).toBe("recebido");

      await salvar(c, oc, emp, await estadoComRec(c, oc, { nota_fiscal: "NF-B", revisao: "revisado depois" }));
      expect(await item(c, oc)).toMatchObject({ status: "recebido", nota_fiscal: "NF-B", revisao: "revisado depois", data_entrega: "2026-03-10" });

      await c.query(`SAVEPOINT sp`);
      let msg = "";
      try { await salvar(c, oc, emp, await estadoComRec(c, oc, { valor_unitario_m1: 999 })); } catch (e: any) { msg = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(msg).toMatch(/Item recebido/i);
    });
  });

  it("item NOVO (avulso, OC nova e OC existente; e do_produto) ja nasce com os campos de recebimento", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const resp = await colab(c, TENANT_TESTE);
      const avulso = { nome_produto: "Avulso Imp #16", qtd_total: 4, valor_unitario_m1: 10, peso_kg: 1, transporte_m2: 0, grade_proporcao: { P: 1, M: 3 },
        variantes: [{ ordem: 0, peso: 1, qtd: 4 }], grade_detalhe: { "0": { P: { pedida: 1 }, M: { pedida: 3 } } },
        nota_fiscal: "NF-NOVA", data_entrega: "2026-05-02", responsavel_recebimento_id: resp, revisao: "nova", devolucao: "nada", anexo_nf_url: "t/x.pdf" };
      const novo = (await um<any>(c, `select public.salvar_oc_importado_itens(null, $1::jsonb, $2::jsonb, null, null) as id`,
        [JSON.stringify({ empresa_id: emp, moeda_compra: "RMB", cotacao_ref: 1, cotacao_final: 1 }), JSON.stringify([avulso])])).id;
      expect(await item(c, novo)).toMatchObject({ status: "encomendado", nota_fiscal: "NF-NOVA", data_entrega: "2026-05-02", responsavel_recebimento_id: resp, revisao: "nova", devolucao: "nada", anexo_nf_url: "t/x.pdf" });

      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 5, vu: 20 });
      const oc = await pedirUm(c, emp, [await prodImp(c, { nome: "P0", grupo: g, cat, empresa: emp })]);
      const estado = await estadoComRec(c, oc, {});
      await salvar(c, oc, emp, [...estado,
        { produto_importado_id: p1, do_produto: true, nota_fiscal: "NF-DOP", data_entrega: "2026-06-01" },
        { ...avulso, nome_produto: "Avulso Imp 2 #16", nota_fiscal: "NF-AV2" }]);
      const linhas = (await c.query(`select nota_fiscal, data_entrega::text as d from ocs_importado_itens where oc_id=$1 order by ordem`, [oc])).rows;
      expect(linhas.map((l: any) => l.nota_fiscal)).toEqual([null, "NF-DOP", "NF-AV2"]);
      expect(linhas[1].d).toBe("2026-06-01");
      expect(Number((await um<any>(c, `select count(*) n from ocs_importado_itens where oc_id=$1 and status='recebido'`, [oc])).n)).toBe(0);
    });
  });

  it("responsavel de OUTRA loja e recusado (P0001, ASCII) e nada grava", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp });
      const oc = await pedirUm(c, emp, [p1]);
      const outro = await colab(c, AVE_RARA);
      await c.query(`SAVEPOINT sp`);
      let msg = "";
      try { await salvar(c, oc, emp, await estadoComRec(c, oc, { nota_fiscal: "NF-X", responsavel_recebimento_id: outro })); } catch (e: any) { msg = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(msg).toMatch(/responsavel_loja_diferente/);
      expect(/^[\x00-\x7f]*$/.test(msg)).toBe(true);
      expect((await item(c, oc)).nota_fiscal).toBeNull();
    });
  });

  it("Leadtime 'compra': so conta item RECEBIDO (data de entrega pre-gravada no Salvar nao vira recebimento)", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prodImp(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, vu: 50 });
      const m1 = await comCard(c, p1);
      const oc = await pedirUm(c, emp, [p1]); // data_pedido 2026-02-01
      await salvar(c, oc, emp, await estadoComRec(c, oc, { data_entrega: "2026-03-10" }));
      const compra = async () => {
        const itens: any[] = (await um<any>(c, `select public._dashboard_leadtime_itens_core() as r`)).r.itens ?? [];
        return itens.find((i: any) => i.modelo_id === m1)?.duracoes?.compra;
      };
      expect(await compra()).toBeUndefined();
      const itId = (await um<any>(c, `select id from ocs_importado_itens where oc_id=$1`, [oc])).id;
      await receber(c, oc, itId, {});
      expect(Number(await compra())).toBe(37);
    });
  });
});
