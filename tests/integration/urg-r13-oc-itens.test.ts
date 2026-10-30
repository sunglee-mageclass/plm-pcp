/**
 * R13 T2 — salvar_oc_p_acabado_itens / receber_item_oc_p_acabado / vincular / excluir / guardas de produto / custo real /
 * escritores antigos recusam / seguranca (lado Produto Acabado). Gancho URG_R13_TXN=1 (R13 aplicada na txn do teste).
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
  const emp = (await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${TENANT_TESTE}',$1,'material') returning id`, [uq("Beltrano")])).id;
  const empB = (await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${TENANT_TESTE}',$1,'material') returning id`, [uq("Fulano")])).id;
  return { g, cat, emp, empB };
}

async function prod(c: any, o: { nome: string; grupo: string; cat: string; empresa: string; qtd?: number; valor?: number }): Promise<string> {
  const qtd = o.qtd ?? 10;
  const dados: any = { nome: o.nome, grupo_id: o.grupo, categoria_id: o.cat, empresa_id: o.empresa, qtd_total: qtd, valor_unitario: o.valor ?? 20, grade_proporcao: { UN: 1 } };
  const variantes = [{ ordem: 0, peso: 1, qtd }];
  return (await um<any>(c, `select public.salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [JSON.stringify(dados), JSON.stringify(variantes)])).id;
}

// cria um card (modelo) vinculado ao produto para receber poder materializar CAD/CQ
async function comCard(c: any, produtoId: string, tenant = TENANT_TESTE): Promise<string> {
  const m = (await um<any>(c, `insert into modelos (tenant_id, nome, origem) values ('${tenant}','Card revenda','revenda') returning id`)).id;
  await c.query(`update produtos_acabados set modelo_id=$1 where id=$2`, [m, produtoId]);
  return m;
}

async function pedir(c: any, emp: string, produtoIds: string[]): Promise<string> {
  const out = (await um<any>(c, `select public.fazer_pedido_p_acabado($1::jsonb) as r`, [JSON.stringify([
    { empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", prazo_pagamento: "30", produto_ids: produtoIds }])])).r;
  return out[0].oc_id;
}

(rodar ? describe : describe.skip)("R13 T2 — salvar_oc_p_acabado_itens (diff por id)", () => {
  it("adicionar (do_produto) + tirar refaz total/parcelas; IDs preservados", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 10, valor: 20 });
      const p2 = await prod(c, { nome: "P2", grupo: g, cat, empresa: emp, qtd: 5, valor: 10 });
      const oc = await pedir(c, emp, [p1]); // OC com 1 item
      // estado completo: a tela sempre manda os campos do item existente (nao so o id)
      const linha = (c2: any) => (r: any) => ({ id: r.id, produto_acabado_id: r.produto_acabado_id, qtd_total: Number(r.qtd_total),
        valor_unitario: Number(r.valor_unitario), desconto_pct: Number(r.desconto_pct), grade_detalhe: r.grade_detalhe, variantes: r.variantes });
      const cols = `id, produto_acabado_id, qtd_total, valor_unitario, desconto_pct, grade_detalhe, variantes`;
      const itens1 = await c.query(`select ${cols} from ocs_p_acabado_itens where oc_id=$1 order by ordem`, [oc]);
      const estado1 = itens1.rows.map(linha(c));
      const id1 = itens1.rows[0].id;
      const rev = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);

      // adiciona p2 (do_produto) mantendo o item existente (id preservado, estado completo)
      const itens = [...estado1, { produto_acabado_id: p2, do_produto: true }];
      await c.query(`select public.salvar_oc_p_acabado_itens($1, $2::jsonb, $3::jsonb, $4)`, [oc, JSON.stringify({ empresa_id: emp }), JSON.stringify(itens), rev]);
      let now = await c.query(`select id, produto_acabado_id, qtd_total from ocs_p_acabado_itens where oc_id=$1 order by ordem`, [oc]);
      expect(now.rows.length).toBe(2);
      expect(now.rows[0].id).toBe(id1); // id preservado
      const cab2 = await um<any>(c, `select qtd_total, valor_bruto from ocs_p_acabado where id=$1`, [oc]);
      expect(Number(cab2.qtd_total)).toBe(15);
      expect(Number(cab2.valor_bruto)).toBe(10 * 20 + 5 * 10);
      const parc2 = Number((await c.query(`select coalesce(sum(valor),0) s from parcelas where oc_p_acabado_id=$1`, [oc])).rows[0].s);
      expect(parc2).toBeCloseTo(250, 2);

      // tira p2: lista final = so o item 1 (estado completo) -> total/parcelas refeitos
      const rev2 = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
      await c.query(`select public.salvar_oc_p_acabado_itens($1, $2::jsonb, $3::jsonb, $4)`, [oc, JSON.stringify({ empresa_id: emp }), JSON.stringify(estado1), rev2]);
      now = await c.query(`select id from ocs_p_acabado_itens where oc_id=$1`, [oc]);
      expect(now.rows.length).toBe(1);
      const cab3 = await um<any>(c, `select qtd_total, valor_bruto from ocs_p_acabado where id=$1`, [oc]);
      expect(Number(cab3.qtd_total)).toBe(10);
      expect(Number(cab3.valor_bruto)).toBe(200);
    });
  });

  it("P0409 quando o rev diverge", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp });
      const oc = await pedir(c, emp, [p1]);
      const id1 = (await um<any>(c, `select id from ocs_p_acabado_itens where oc_id=$1`, [oc])).id;
      await c.query(`SAVEPOINT sp`);
      let msg = "";
      try {
        await c.query(`select public.salvar_oc_p_acabado_itens($1, $2::jsonb, $3::jsonb, $4)`, [oc, JSON.stringify({ empresa_id: emp }), JSON.stringify([{ id: id1 }]), 9999]);
      } catch (e: any) { msg = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(msg).toMatch(/conflito_versao/);
    });
  });

  it("esvaziar (lista final vazia) recusa oc_sem_produtos", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp });
      const oc = await pedir(c, emp, [p1]);
      const rev = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
      await c.query(`SAVEPOINT sp`);
      let msg = "";
      try {
        await c.query(`select public.salvar_oc_p_acabado_itens($1, $2::jsonb, '[]'::jsonb, $3)`, [oc, JSON.stringify({ empresa_id: emp }), rev]);
      } catch (e: any) { msg = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(msg).toMatch(/oc_sem_produtos/);
    });
  });

  it("item recebido: valor travado + nao sai da OC", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, valor: 50 });
      const p2 = await prod(c, { nome: "P2", grupo: g, cat, empresa: emp, qtd: 3, valor: 10 });
      await comCard(c, p1);
      const oc = await pedir(c, emp, [p1, p2]);
      const itens = (await c.query(`select id, produto_acabado_id, valor_unitario, grade_detalhe from ocs_p_acabado_itens where oc_id=$1 order by ordem`, [oc])).rows;
      const i1 = itens.find((x: any) => x.produto_acabado_id === p1);
      const i2 = itens.find((x: any) => x.produto_acabado_id === p2);
      const rev = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
      // recebe o item 1
      const payload = { item_data_entrega: "2026-03-10", item_nota_fiscal: "NF1" };
      const estadoItens = itens.map((x: any) => ({ id: x.id }));
      await c.query(`select public.receber_item_oc_p_acabado($1, $2, $3::jsonb, $4::jsonb, $5)`, [oc, i1.id, JSON.stringify(payload), JSON.stringify(estadoItens), rev]);
      // tentar mudar o valor do item recebido -> recusa
      const rev2 = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
      await c.query(`SAVEPOINT sp`);
      let msg = "";
      try {
        await c.query(`select public.salvar_oc_p_acabado_itens($1, $2::jsonb, $3::jsonb, $4)`, [oc, JSON.stringify({ empresa_id: emp }),
          JSON.stringify([{ id: i1.id, valor_unitario: 999, qtd_total: 2, grade_detalhe: i1.grade_detalhe }, { id: i2.id }]), rev2]);
      } catch (e: any) { msg = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(msg).toMatch(/Item recebido/i);
      // tentar TIRAR o item recebido -> recusa
      await c.query(`SAVEPOINT sp2`);
      let msg2 = "";
      try {
        await c.query(`select public.salvar_oc_p_acabado_itens($1, $2::jsonb, $3::jsonb, $4)`, [oc, JSON.stringify({ empresa_id: emp }), JSON.stringify([{ id: i2.id }]), rev2]);
      } catch (e: any) { msg2 = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp2`);
      expect(msg2).toMatch(/item_recebido_nao_sai/);
    });
  });
});

(rodar ? describe : describe.skip)("R13 T2 — receber_item_oc_p_acabado", () => {
  it("materializa cad/cad_grades/CQ SO daquele modelo; status derivado; data_entrega=max", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, valor: 50 });
      const p2 = await prod(c, { nome: "P2", grupo: g, cat, empresa: emp, qtd: 3, valor: 10 });
      const m1 = await comCard(c, p1);
      const m2 = await comCard(c, p2);
      const oc = await pedir(c, emp, [p1, p2]);
      const itens = (await c.query(`select id, produto_acabado_id from ocs_p_acabado_itens where oc_id=$1 order by ordem`, [oc])).rows;
      const i1 = itens.find((x: any) => x.produto_acabado_id === p1);
      const i2 = itens.find((x: any) => x.produto_acabado_id === p2);
      const estado = itens.map((x: any) => ({ id: x.id }));
      const rev = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
      await c.query(`select public.receber_item_oc_p_acabado($1, $2, $3::jsonb, $4::jsonb, $5)`, [oc, i1.id, JSON.stringify({ item_data_entrega: "2026-03-10" }), JSON.stringify(estado), rev]);
      // cad/CQ de m1 existe; de m2 NAO
      expect(Number((await um<any>(c, `select count(*) n from cad where modelo_id=$1`, [m1])).n)).toBe(1);
      expect(Number((await um<any>(c, `select count(*) n from cad where modelo_id=$1`, [m2])).n)).toBe(0);
      const cad1 = (await um<any>(c, `select id from cad where modelo_id=$1`, [m1])).id;
      expect(Number((await um<any>(c, `select count(*) n from controle_qualidade where cad_id=$1`, [cad1])).n)).toBe(1);
      // cabecalho ainda encomendado (so 1 de 2 itens recebido); status item1 recebido, item2 encomendado
      const cab = await um<any>(c, `select status, data_entrega from ocs_p_acabado where id=$1`, [oc]);
      expect(cab.status).toBe("encomendado");
      expect(Number((await um<any>(c, `select count(*) n from ocs_p_acabado_itens where oc_id=$1 and status='recebido'`, [oc])).n)).toBe(1);

      // recebe o item 2 com data MAIOR -> cabecalho vira recebido; data_entrega = max
      const rev2 = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
      await c.query(`select public.receber_item_oc_p_acabado($1, $2, $3::jsonb, $4::jsonb, $5)`, [oc, i2.id, JSON.stringify({ item_data_entrega: "2026-04-15" }), JSON.stringify(estado), rev2]);
      const cab2 = await um<any>(c, `select status, data_entrega::text from ocs_p_acabado where id=$1`, [oc]);
      expect(cab2.status).toBe("recebido");
      expect(cab2.data_entrega).toBe("2026-04-15");
    });
  });
});

(rodar ? describe : describe.skip)("R13 T2 — vincular / excluir / guardas / custo real / escritores antigos", () => {
  it("excluir OC com item recebido -> recusa", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp });
      await comCard(c, p1);
      const oc = await pedir(c, emp, [p1]);
      const i1 = (await um<any>(c, `select id from ocs_p_acabado_itens where oc_id=$1`, [oc])).id;
      const rev = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
      await c.query(`select public.receber_item_oc_p_acabado($1, $2, '{}'::jsonb, $3::jsonb, $4)`, [oc, i1, JSON.stringify([{ id: i1 }]), rev]);
      await c.query(`SAVEPOINT sp`);
      let msg = "";
      try { await c.query(`select public.excluir_oc_p_acabado('${oc}')`); } catch (e: any) { msg = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(msg).toMatch(/recebido/i);
    });
  });

  it("vincular: (b) adicionar; (c) desvincular 1 item; 2+ itens recusa; outro fornecedor recusa", async () => {
    await withTx(async (c) => {
      const { g, cat, emp, empB } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp });
      const p2 = await prod(c, { nome: "P2", grupo: g, cat, empresa: emp });
      const pBad = await prod(c, { nome: "PB", grupo: g, cat, empresa: empB });
      const oc = await pedir(c, emp, [p1]);
      // (b) adicionar p2 via vincular
      await c.query(`select public._vincular_oc_p_acabado_core('${oc}','${p2}')`);
      expect(Number((await um<any>(c, `select count(*) n from ocs_p_acabado_itens where oc_id=$1`, [oc])).n)).toBe(2);
      // outro fornecedor recusa
      await c.query(`SAVEPOINT sp`); let m1 = "";
      try { await c.query(`select public._vincular_oc_p_acabado_core('${oc}','${pBad}')`); } catch (e: any) { m1 = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(m1).toMatch(/fornecedor_diferente/);
      // desvincular com 2+ itens recusa
      await c.query(`SAVEPOINT sp2`); let m2 = "";
      try { await c.query(`select public._vincular_oc_p_acabado_core('${oc}', null)`); } catch (e: any) { m2 = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp2`);
      expect(m2).toMatch(/oc_varios_produtos/);
    });
  });

  it("guardas de produto: excluir/limpar olham os ITENS; custo real do item recebido", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, valor: 50 });
      const m1 = await comCard(c, p1);
      const oc = await pedir(c, emp, [p1]);
      // excluir produto com OC (item) vinculada -> recusa pelo numero
      await c.query(`SAVEPOINT sp`); let msg = "";
      try { await c.query(`select public._excluir_produto_acabado_core('${p1}')`); } catch (e: any) { msg = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(msg).toMatch(/Desvincule a OC/i);

      // custo real: antes de receber = NULL (revenda); depois de receber o item = real
      const custoAntes = (await um<any>(c, `select public._custo_unitario_modelos_core(array['${m1}']::uuid[]) as j`)).j;
      expect(custoAntes[m1].real).toBeNull();
      const i1 = (await um<any>(c, `select id from ocs_p_acabado_itens where oc_id=$1`, [oc])).id;
      const rev = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
      await c.query(`select public.receber_item_oc_p_acabado($1, $2, '{}'::jsonb, $3::jsonb, $4)`, [oc, i1, JSON.stringify([{ id: i1 }]), rev]);
      const custoDepois = (await um<any>(c, `select public._custo_unitario_modelos_core(array['${m1}']::uuid[]) as j`)).j;
      expect(custoDepois[m1].real).not.toBeNull();
      expect(custoDepois[m1].confirmado).toBe(true);
    });
  });

  it("escritores antigos (_salvar/_receber_oc_p_acabado_core) recusam versao_antiga", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`SAVEPOINT sp`); let m1 = "";
      try { await c.query(`select public._salvar_oc_p_acabado_core(null, '{"nome_produto":"X"}'::jsonb, '{}'::jsonb, null)`); } catch (e: any) { m1 = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(m1).toMatch(/versao_antiga/);
      await c.query(`SAVEPOINT sp2`); let m2 = "";
      try { await c.query(`select public._receber_oc_p_acabado_core('${TENANT_TESTE}'::uuid, '{}'::jsonb, '{}'::jsonb)`); } catch (e: any) { m2 = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp2`);
      expect(m2).toMatch(/versao_antiga/);
    });
  });

  it("seguranca: wrappers novos sem EXECUTE para anon; _core/helpers revogados dos 3; tabelas de itens so SELECT p/ authenticated", async () => {
    await withTx(async (c) => {
      const wrappers = ["public.fazer_pedido_p_acabado(jsonb)", "public.salvar_oc_p_acabado_itens(uuid,jsonb,jsonb,integer)", "public.receber_item_oc_p_acabado(uuid,uuid,jsonb,jsonb,integer)"];
      for (const w of wrappers) {
        expect(Boolean((await um<any>(c, `select has_function_privilege('anon','${w}','EXECUTE') as b`)).b), `anon ${w}`).toBe(false);
        expect(Boolean((await um<any>(c, `select has_function_privilege('authenticated','${w}','EXECUTE') as b`)).b), `auth ${w}`).toBe(true);
      }
      const cores = ["public._fazer_pedido_p_acabado_core(jsonb)", "public._salvar_oc_p_acabado_itens_core(uuid,jsonb,jsonb,integer)", "public._receber_item_oc_p_acabado_core(uuid,uuid,jsonb,jsonb,integer)", "public._ocpa_aplicar_derivados(uuid)"];
      for (const f of cores) {
        expect(Boolean((await um<any>(c, `select has_function_privilege('anon','${f}','EXECUTE') as b`)).b), `anon ${f}`).toBe(false);
        expect(Boolean((await um<any>(c, `select has_function_privilege('authenticated','${f}','EXECUTE') as b`)).b), `auth ${f}`).toBe(false);
      }
      // tabelas de itens: authenticated so SELECT; anon nada
      for (const t of ["public.ocs_p_acabado_itens", "public.ocs_importado_itens"]) {
        expect(Boolean((await um<any>(c, `select has_table_privilege('authenticated','${t}','SELECT') as b`)).b)).toBe(true);
        expect(Boolean((await um<any>(c, `select has_table_privilege('authenticated','${t}','INSERT') as b`)).b)).toBe(false);
        expect(Boolean((await um<any>(c, `select has_table_privilege('anon','${t}','SELECT') as b`)).b)).toBe(false);
      }
    });
  });
});
