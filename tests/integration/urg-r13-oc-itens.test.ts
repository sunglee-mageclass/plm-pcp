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

  it("RLS: outra loja NAO ve os itens da OC de outra loja (tenant_select PERMISSIVE)", async () => {
    await withTx(async (c) => {
      const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
      const USER_AVE = "174518a5-569f-4954-9010-24204b345508"; // usuario da Ave Rara (loja != TENANT_TESTE)
      const { g, cat, emp } = await base(c);
      const p = await prod(c, { nome: uq("P"), grupo: g, cat, empresa: emp });
      const oc = await pedir(c, emp, [p]); // OC + 1 item em TENANT_TESTE
      // como postgres (bypass RLS) o item existe:
      expect(Number((await um<any>(c, `select count(*) n from public.ocs_p_acabado_itens where oc_id='${oc}'`)).n)).toBe(1);
      // agora como o PAPEL authenticated, com JWT de um usuario da OUTRA loja -> RLS filtra: 0 linhas visiveis.
      await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USER_AVE, role: "authenticated" })]);
      await c.query("SET LOCAL ROLE authenticated");
      const visiveisOutra = Number((await um<any>(c, `select count(*) n from public.ocs_p_acabado_itens where oc_id='${oc}'`)).n);
      // e o proprio get_user_tenant_id() da sessao e a Ave Rara (confirma que o JWT trocou de loja)
      const minhaLoja = (await um<any>(c, `select public.get_user_tenant_id()::text t`)).t;
      await c.query("RESET ROLE");
      expect(visiveisOutra, "a Ave Rara nao pode ver itens de OC da Loja Teste").toBe(0);
      expect(minhaLoja).toBe(AVE_RARA);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Catálogo das tabelas NOVAS de itens (R13): ACL, RLS e índices (inv. 9 / S2 "tabela nova de dinheiro: REVOKE na mesma migration" /
// S5 "anon sem nenhum privilégio de tabela em public"). Os testes de trava seg-s3a/b/d (que medem pg_locks na mesma txn do gancho)
// seguem a trava do gancho da R13 em `travaDeGanchoR13`; aqui fica a PROVA de que o catálogo novo é o correto.
(rodar ? describe : describe.skip)("R13 — catálogo das tabelas de itens: ACL (só SELECT p/ authenticated; anon nada), RLS e índices", () => {
  const ITENS: Array<{ tab: string; idx: string[]; parcial: { nome: string; col: string } }> = [
    { tab: "ocs_p_acabado_itens", idx: ["ocs_p_acabado_itens_pkey", "ocs_p_acabado_itens_oc_ordem_ux", "ocpa_itens_oc_idx", "ocpa_itens_produto_idx"],
      parcial: { nome: "ocpa_itens_produto_idx", col: "produto_acabado_id" } },
    { tab: "ocs_importado_itens", idx: ["ocs_importado_itens_pkey", "ocs_importado_itens_oc_ordem_ux", "oci_itens_oc_idx", "oci_itens_produto_idx"],
      parcial: { nome: "oci_itens_produto_idx", col: "produto_importado_id" } },
  ];

  it("ACL: authenticated só SELECT (nem coluna, nem TRUNCATE/REFERENCES/TRIGGER); anon nenhum privilégio; service_role escreve", async () => {
    await withTx(async (c) => {
      for (const { tab } of ITENS) {
        const t = `public.${tab}`;
        const priv = async (papel: string, p: string) => Boolean((await um<any>(c, `select has_table_privilege($1, $2, $3) as b`, [papel, t, p])).b);
        const colPriv = async (papel: string, p: string) => Boolean((await um<any>(c, `select has_any_column_privilege($1, $2, $3) as b`, [papel, t, p])).b);
        // authenticated: SELECT e mais nada (REVOKE de escrita na mesma migration — inv. 9/S2; S5 tira TRUNCATE/REFERENCES/TRIGGER)
        expect({ tab, sel: await priv("authenticated", "SELECT") }).toEqual({ tab, sel: true });
        for (const p of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"])
          expect({ tab, p, auth: await priv("authenticated", p) }).toEqual({ tab, p, auth: false });
        for (const p of ["INSERT", "UPDATE"]) expect({ tab, p, col: await colPriv("authenticated", p) }).toEqual({ tab, p, col: false });
        // anon: nada (S5) — nem SELECT, nem por coluna
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"])
          expect({ tab, p, anon: await priv("anon", p) }).toEqual({ tab, p, anon: false });
        expect({ tab, anonCol: await colPriv("anon", "SELECT") }).toEqual({ tab, anonCol: false });
        // service_role (RPCs DEFINER rodam como o dono; o papel de servico mantem o DML)
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect({ tab, p, svc: await priv("service_role", p) }).toEqual({ tab, p, svc: true });
      }
    });
  });

  it("RLS ligada com UMA policy tenant_select (PERMISSIVE, só SELECT, sem modgate); índices: pkey, UNIQUE(oc_id, ordem), por OC e parcial por produto", async () => {
    await withTx(async (c) => {
      for (const { tab, idx, parcial } of ITENS) {
        const rls = await um<any>(c, `select relrowsecurity as rls, relforcerowsecurity as forca from pg_class where oid = to_regclass($1)`, [`public.${tab}`]);
        expect({ tab, rls: rls.rls }).toEqual({ tab, rls: true });
        const pol = (await c.query(`select polname, polpermissive, polcmd from pg_policy where polrelid = to_regclass($1) order by 1`, [`public.${tab}`])).rows;
        expect({ tab, pol }).toEqual({ tab, pol: [{ polname: "tenant_select", polpermissive: true, polcmd: "r" }] });
        const ixs = (await c.query(`select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = $1`, [tab])).rows;
        expect({ tab, nomes: ixs.map((r: any) => r.indexname).sort() }).toEqual({ tab, nomes: [...idx].sort() });
        const def = (n: string) => ixs.find((r: any) => r.indexname === n)!.indexdef as string;
        expect(def(idx[1])).toMatch(/UNIQUE INDEX .* \(oc_id, ordem\)/);
        expect(def(parcial.nome)).toMatch(new RegExp(`\\(${parcial.col}\\) WHERE \\(${parcial.col} IS NOT NULL\\)`));
      }
    });
  });
});

// P-382 #3 (dono, out/2026): a validacao de grade negativa / Σ pedida <> qtd valia so no item EXISTENTE; o item AVULSO NOVO
// (sem id, sem do_produto — digitado a mao) so era validado pela tela. O servidor agora recusa tambem esse ramo (mesma mensagem/ERRCODE).
(rodar ? describe : describe.skip)("P-382 #3 — item avulso NOVO valida grade/Σ no servidor (PA)", () => {
  const avulso = (o: { qtd: number; grade: any }) => ({
    nome_produto: "Avulso P382", qtd_total: o.qtd, valor_unitario: 10, grade_proporcao: { P: 1, M: 1 }, variantes: [{ ordem: 0, peso: 1, qtd: o.qtd }],
    grade_detalhe: o.grade,
  });
  async function tentar(c: any, sp: string, id: string | null, emp: string, itens: any[], rev: number | null = null): Promise<string> {
    await c.query(`SAVEPOINT ${sp}`);
    let msg = "";
    try {
      await c.query(`select public.salvar_oc_p_acabado_itens($1, $2::jsonb, $3::jsonb, $4)`, [id, JSON.stringify({ empresa_id: emp }), JSON.stringify(itens), rev]);
    } catch (e: any) { msg = String(e?.message ?? ""); }
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    return msg;
  }

  it("OC nova com avulso: celula negativa recusa; Σ pedida <> qtd recusa; recebida/defeito negativos recusam", async () => {
    await withTx(async (c) => {
      const { emp } = await base(c);
      // Σ pedida = 3 + (-2) = 1 = qtd: so a NEGATIVA pode recusar (prova que a checagem de negativo roda sozinha)
      expect(await tentar(c, "sp1", null, emp, [avulso({ qtd: 1, grade: { "0": { P: { pedida: 3 }, M: { pedida: -2 } } } })]))
        .toMatch(/quantidades da grade nao podem ser negativas/);
      expect(await tentar(c, "sp1b", null, emp, [avulso({ qtd: 5, grade: { "0": { P: { pedida: 5, recebida: -1 } } } })]))
        .toMatch(/quantidades da grade nao podem ser negativas/);
      expect(await tentar(c, "sp1c", null, emp, [avulso({ qtd: 5, grade: { "0": { P: { pedida: 5, defeito: -1 } } } })]))
        .toMatch(/quantidades da grade nao podem ser negativas/);
      // Σ pedida (2) <> qtd (5)
      expect(await tentar(c, "sp2", null, emp, [avulso({ qtd: 5, grade: { "0": { P: { pedida: 2 } } } })]))
        .toMatch(/A soma da grade pedida \(2\) difere da quantidade total \(5\)/);
      // nada foi gravado pelas tentativas recusadas
      const n = (await um<any>(c, `select count(*)::int n from ocs_p_acabado_itens i join ocs_p_acabado o on o.id=i.oc_id where i.nome_produto='Avulso P382' and o.tenant_id='${TENANT_TESTE}'`)).n;
      expect(n).toBe(0);
    });
  });

  it("avulso NOVO numa OC que ja existe (add a um pedido) tambem valida; o item existente fica intacto", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 10, valor: 20 });
      const oc = await pedir(c, emp, [p1]);
      const existente = (await c.query(`select id, produto_acabado_id, qtd_total, valor_unitario, desconto_pct, grade_detalhe, variantes from ocs_p_acabado_itens where oc_id=$1`, [oc])).rows
        .map((r: any) => ({ id: r.id, produto_acabado_id: r.produto_acabado_id, qtd_total: Number(r.qtd_total), valor_unitario: Number(r.valor_unitario),
          desconto_pct: Number(r.desconto_pct), grade_detalhe: r.grade_detalhe, variantes: r.variantes }));
      const rev = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
      expect(await tentar(c, "sp3", oc, emp, [...existente, avulso({ qtd: 4, grade: { "0": { P: { pedida: 5 }, M: { pedida: -1 } } } })], rev))
        .toMatch(/quantidades da grade nao podem ser negativas/);
      expect(await tentar(c, "sp4", oc, emp, [...existente, avulso({ qtd: 4, grade: { "0": { P: { pedida: 1 } } } })], rev))
        .toMatch(/A soma da grade pedida \(1\) difere da quantidade total \(4\)/);
      expect(Number((await um<any>(c, `select count(*)::int n from ocs_p_acabado_itens where oc_id=$1`, [oc])).n)).toBe(1);
    });
  });

  it("avulso VALIDO ainda passa (Σ pedida = qtd; sem grade e qtd 0 como antes) e entra no total da OC", async () => {
    await withTx(async (c) => {
      const { emp } = await base(c);
      const rev = await um<any>(c, `select public.salvar_oc_p_acabado_itens(null, $1::jsonb, $2::jsonb, null) as id`, [
        JSON.stringify({ empresa_id: emp }),
        JSON.stringify([avulso({ qtd: 5, grade: { "0": { P: { pedida: 2 }, M: { pedida: 3 } } } }), { nome_produto: "Avulso vazio P382", qtd_total: 0, valor_unitario: 0 }]),
      ]);
      const itens = (await c.query(`select nome_produto, qtd_total from ocs_p_acabado_itens where oc_id=$1 order by ordem`, [rev.id])).rows;
      expect(itens.map((i: any) => [i.nome_produto, Number(i.qtd_total)])).toEqual([["Avulso P382", 5], ["Avulso vazio P382", 0]]);
      expect(Number((await um<any>(c, `select qtd_total from ocs_p_acabado where id=$1`, [rev.id])).qtd_total)).toBe(5);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// #16 (Onda 2): os campos de recebimento DO ITEM (NF, responsavel, data de entrega, devolucao, revisao, anexo da NF) gravam no
// SALVAR normal da OC, ANTES de marcar recebido. Receber continua ACAO SEPARADA (so ela muda status e materializa CAD/CQ).
(rodar ? describe : describe.skip)("#16 — recebimento do item grava no Salvar, sem receber (PA)", () => {
  const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
  const colab = async (c: any, tenant: string) =>
    (await um<any>(c, `insert into colaboradores (tenant_id, nome, tipo) values ($1,$2,'ITEST #16') returning id`, [tenant, uq("Recebedor")])).id as string;

  /** estado COMPLETO do item (como a tela manda) + os campos de recebimento do patch. */
  const estadoComRec = async (c: any, oc: string, rec: Record<string, any>) => {
    const r = (await c.query(`select id, produto_acabado_id, qtd_total, valor_unitario, desconto_pct, grade_detalhe, variantes from ocs_p_acabado_itens where oc_id=$1 order by ordem`, [oc])).rows;
    return r.map((x: any) => ({ id: x.id, produto_acabado_id: x.produto_acabado_id, qtd_total: Number(x.qtd_total), valor_unitario: Number(x.valor_unitario),
      desconto_pct: Number(x.desconto_pct), grade_detalhe: x.grade_detalhe, variantes: x.variantes, ...rec }));
  };
  const salvar = async (c: any, oc: string, emp: string, itens: any[]) => {
    const rev = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
    await c.query(`select public.salvar_oc_p_acabado_itens($1, $2::jsonb, $3::jsonb, $4)`, [oc, JSON.stringify({ empresa_id: emp }), JSON.stringify(itens), rev]);
  };
  const item = async (c: any, oc: string) =>
    um<any>(c, `select status, data_entrega::text as data_entrega, nota_fiscal, responsavel_recebimento_id, devolucao, revisao, anexo_nf_url, valor_unitario, qtd_total from ocs_p_acabado_itens where oc_id=$1`, [oc]);

  it("salvar NF/responsavel/data/devolucao/revisao/anexo SEM receber: ficam gravados; item e OC seguem encomendados; nada de CAD/CQ; cabecalho sem data de entrega", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, valor: 50 });
      const m1 = await comCard(c, p1);
      const oc = await pedir(c, emp, [p1]);
      const resp = await colab(c, TENANT_TESTE);
      const parcAntes = (await um<any>(c, `select coalesce(sum(valor),0)::text s from parcelas where oc_p_acabado_id=$1`, [oc])).s;

      await salvar(c, oc, emp, await estadoComRec(c, oc, {
        data_entrega: "2026-03-10", nota_fiscal: "NF-1234", responsavel_recebimento_id: resp, devolucao: "2 pecas", revisao: "ok", anexo_nf_url: "tenant/nf.pdf",
      }));

      const it = await item(c, oc);
      expect(it).toMatchObject({ data_entrega: "2026-03-10", nota_fiscal: "NF-1234", responsavel_recebimento_id: resp, devolucao: "2 pecas", revisao: "ok", anexo_nf_url: "tenant/nf.pdf" });
      // NAO recebeu: status do item e do cabecalho, sem CAD/CQ, sem data de entrega no cabecalho (so item RECEBIDO conta), parcelas iguais
      expect(it.status).toBe("encomendado");
      const cab = await um<any>(c, `select status, data_entrega from ocs_p_acabado where id=$1`, [oc]);
      expect(cab.status).toBe("encomendado");
      expect(cab.data_entrega).toBeNull();
      expect(Number((await um<any>(c, `select count(*) n from cad where modelo_id=$1`, [m1])).n)).toBe(0);
      expect(Number((await um<any>(c, `select count(*) n from controle_qualidade where cad_id in (select id from cad where modelo_id=$1)`, [m1])).n)).toBe(0);
      expect((await um<any>(c, `select coalesce(sum(valor),0)::text s from parcelas where oc_p_acabado_id=$1`, [oc])).s).toBe(parcAntes);
    });
  });

  it("chave AUSENTE mantem; vazio/null limpa; editar a NF e salvar de novo persiste", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp });
      const oc = await pedir(c, emp, [p1]);
      const resp = await colab(c, TENANT_TESTE);
      await salvar(c, oc, emp, await estadoComRec(c, oc, { data_entrega: "2026-03-10", nota_fiscal: "NF-1", responsavel_recebimento_id: resp, revisao: "r1", devolucao: "d1" }));

      // ausente (estado completo SEM as chaves de recebimento) = mantem tudo
      await salvar(c, oc, emp, await estadoComRec(c, oc, {}));
      expect(await item(c, oc)).toMatchObject({ data_entrega: "2026-03-10", nota_fiscal: "NF-1", responsavel_recebimento_id: resp, revisao: "r1", devolucao: "d1" });

      // editar a NF e salvar de novo: persiste (so ela muda)
      await salvar(c, oc, emp, await estadoComRec(c, oc, { nota_fiscal: "NF-2" }));
      expect(await item(c, oc)).toMatchObject({ data_entrega: "2026-03-10", nota_fiscal: "NF-2", responsavel_recebimento_id: resp, revisao: "r1" });

      // vazio/null limpa
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
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, valor: 50 });
      const m1 = await comCard(c, p1);
      const oc = await pedir(c, emp, [p1]);
      const resp = await colab(c, TENANT_TESTE);
      await salvar(c, oc, emp, await estadoComRec(c, oc, { data_entrega: "2026-03-10", nota_fiscal: "NF-PRE", responsavel_recebimento_id: resp }));
      expect(Number((await um<any>(c, `select count(*) n from cad where modelo_id=$1`, [m1])).n)).toBe(0);

      const rev = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
      const itId = (await um<any>(c, `select id from ocs_p_acabado_itens where oc_id=$1`, [oc])).id;
      // _dados SEM chaves item_*: o recebimento nao pode zerar o que o Salvar gravou
      await c.query(`select public.receber_item_oc_p_acabado($1, $2, '{}'::jsonb, $3::jsonb, $4)`, [oc, itId, JSON.stringify(await estadoComRec(c, oc, {})), rev]);
      const it = await item(c, oc);
      expect(it).toMatchObject({ status: "recebido", data_entrega: "2026-03-10", nota_fiscal: "NF-PRE", responsavel_recebimento_id: resp });
      expect(Number((await um<any>(c, `select count(*) n from cad where modelo_id=$1`, [m1])).n)).toBe(1);
      expect(Number((await um<any>(c, `select count(*) n from controle_qualidade where cad_id in (select id from cad where modelo_id=$1)`, [m1])).n)).toBe(1);
      const cab = await um<any>(c, `select status, data_entrega::text as data_entrega from ocs_p_acabado where id=$1`, [oc]);
      expect(cab).toMatchObject({ status: "recebido", data_entrega: "2026-03-10" });
    });
  });

  it("item JA recebido: editar NF/revisao e salvar persiste (valor/qtd seguem travados) e o status nao muda", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, valor: 50 });
      await comCard(c, p1);
      const oc = await pedir(c, emp, [p1]);
      const itId = (await um<any>(c, `select id from ocs_p_acabado_itens where oc_id=$1`, [oc])).id;
      const rev = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
      await c.query(`select public.receber_item_oc_p_acabado($1, $2, $3::jsonb, $4::jsonb, $5)`,
        [oc, itId, JSON.stringify({ item_data_entrega: "2026-03-10", item_nota_fiscal: "NF-A" }), JSON.stringify(await estadoComRec(c, oc, {})), rev]);
      expect((await item(c, oc)).status).toBe("recebido");

      await salvar(c, oc, emp, await estadoComRec(c, oc, { nota_fiscal: "NF-B", revisao: "revisado depois" }));
      expect(await item(c, oc)).toMatchObject({ status: "recebido", nota_fiscal: "NF-B", revisao: "revisado depois", data_entrega: "2026-03-10" });

      // valor segue travado (nao e o recebimento que destrava)
      await c.query(`SAVEPOINT sp`);
      let msg = "";
      try { await salvar(c, oc, emp, await estadoComRec(c, oc, { valor_unitario: 999 })); } catch (e: any) { msg = String(e?.message ?? ""); }
      await c.query(`ROLLBACK TO SAVEPOINT sp`);
      expect(msg).toMatch(/Item recebido/i);
    });
  });

  it("item NOVO (avulso, OC nova e OC existente; e do_produto) ja nasce com os campos de recebimento", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const resp = await colab(c, TENANT_TESTE);
      const avulso = { nome_produto: "Avulso #16", qtd_total: 4, valor_unitario: 10, grade_detalhe: { "0": { P: { pedida: 1 }, M: { pedida: 3 } } },
        nota_fiscal: "NF-NOVA", data_entrega: "2026-05-02", responsavel_recebimento_id: resp, revisao: "nova", devolucao: "nada", anexo_nf_url: "t/x.pdf" };
      const novo = (await um<any>(c, `select public.salvar_oc_p_acabado_itens(null, $1::jsonb, $2::jsonb, null) as id`, [JSON.stringify({ empresa_id: emp }), JSON.stringify([avulso])])).id;
      expect(await item(c, novo)).toMatchObject({ status: "encomendado", nota_fiscal: "NF-NOVA", data_entrega: "2026-05-02", responsavel_recebimento_id: resp, revisao: "nova", devolucao: "nada", anexo_nf_url: "t/x.pdf" });

      // OC existente: avulso novo + do_produto com os campos
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 5, valor: 20 });
      const oc = await pedir(c, emp, [await prod(c, { nome: "P0", grupo: g, cat, empresa: emp })]);
      const estado = await estadoComRec(c, oc, {});
      await salvar(c, oc, emp, [...estado,
        { produto_acabado_id: p1, do_produto: true, nota_fiscal: "NF-DOP", data_entrega: "2026-06-01" },
        { ...avulso, nome_produto: "Avulso 2 #16", nota_fiscal: "NF-AV2" }]);
      const linhas = (await c.query(`select nome_produto, nota_fiscal, data_entrega::text as d from ocs_p_acabado_itens where oc_id=$1 order by ordem`, [oc])).rows;
      expect(linhas.map((l: any) => l.nota_fiscal)).toEqual([null, "NF-DOP", "NF-AV2"]);
      expect(linhas[1].d).toBe("2026-06-01");
      expect(Number((await um<any>(c, `select count(*) n from ocs_p_acabado_itens where oc_id=$1 and status='recebido'`, [oc])).n)).toBe(0);
    });
  });

  it("responsavel de OUTRA loja e recusado (P0001, ASCII) e nada grava", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await base(c);
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp });
      const oc = await pedir(c, emp, [p1]);
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
      const p1 = await prod(c, { nome: "P1", grupo: g, cat, empresa: emp, qtd: 2, valor: 50 });
      const m1 = await comCard(c, p1);
      const oc = await pedir(c, emp, [p1]); // data_pedido 2026-02-01
      await salvar(c, oc, emp, await estadoComRec(c, oc, { data_entrega: "2026-03-10" }));
      const compra = async () => {
        const itens: any[] = (await um<any>(c, `select public._dashboard_leadtime_itens_core() as r`)).r.itens ?? [];
        return itens.find((i: any) => i.modelo_id === m1)?.duracoes?.compra;
      };
      expect(await compra()).toBeUndefined(); // gravou a data, mas NAO recebeu
      const rev = Number((await um<any>(c, `select rev from ocs_p_acabado where id=$1`, [oc])).rev);
      const itId = (await um<any>(c, `select id from ocs_p_acabado_itens where oc_id=$1`, [oc])).id;
      await c.query(`select public.receber_item_oc_p_acabado($1, $2, '{}'::jsonb, $3::jsonb, $4)`, [oc, itId, JSON.stringify(await estadoComRec(c, oc, {})), rev]);
      expect(Number(await compra())).toBe(37); // 2026-02-01 -> 2026-03-10
    });
  });
});
