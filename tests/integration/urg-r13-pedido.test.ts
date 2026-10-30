/**
 * R13 T2 — fazer_pedido_p_acabado (OC por fornecedor com VARIOS produtos). Gancho URG_R13_TXN=1 (a R13 e aplicada DENTRO da
 * txn do teste; a copia4 e R11-final como base). So na copia local, suite com a copia QUIETA.
 *
 * §5.2 (lado PA):
 *  - 3 produtos do mesmo fornecedor -> 1 OC; sigla ACE / G+C / DIV; Σ e parcelas sobre o total;
 *  - produto inelegivel -> nada criado (atomico);
 *  - outra loja -> P0002.
 */
import { describe, it, expect } from "vitest";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import { CASOS_SIGLA, previewSiglaOcLote } from "../fixtures/oc-lote-casos";

const rodar = hasDb && ehBancoLocal && process.env.URG_R13_TXN === "1";

// cria um produto acabado ELEGIVEL (nome, grupo, categoria, fornecedor, qtd>0, 1 variante com qtd=qtd, grade nao-vazia, valor>0)
async function criarProduto(
  c: any,
  o: { nome: string; grupo: string; cat: string; empresa: string; qtd?: number; valor?: number; acessorio?: boolean },
): Promise<string> {
  const qtd = o.qtd ?? 10;
  const dados: any = {
    nome: o.nome,
    grupo_id: o.grupo,
    categoria_id: o.cat,
    empresa_id: o.empresa,
    qtd_total: qtd,
    valor_unitario: o.valor ?? 20,
    grade_proporcao: o.acessorio ? {} : { UN: 1 },
  };
  const variantes = [{ ordem: 0, peso: 1, qtd, cor_id: null, cor_apelido_id: null }];
  const r = await um<any>(c, `select public.salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [
    JSON.stringify(dados),
    JSON.stringify(variantes),
  ]);
  return r.id as string;
}

(rodar ? describe : describe.skip)("R13 T2 — fazer_pedido_p_acabado", () => {
  it("3 produtos do mesmo fornecedor -> 1 OC; Σ e parcelas sobre o total", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = (await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem R13ped') returning id`)).id;
      const cat = (await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido R13ped') returning id`)).id;
      const emp = (await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${TENANT_TESTE}','Beltrano Confeccoes R13','material') returning id`)).id;
      const p1 = await criarProduto(c, { nome: "V1", grupo: g, cat, empresa: emp, qtd: 10, valor: 20 });
      const p2 = await criarProduto(c, { nome: "V2", grupo: g, cat, empresa: emp, qtd: 5, valor: 10 });
      const p3 = await criarProduto(c, { nome: "V3", grupo: g, cat, empresa: emp, qtd: 2, valor: 100 });

      const pedido = [{ empresa_id: emp, representante_id: null, data_pedido: "2026-02-01", data_prevista: "2026-03-01",
        prazo_pagamento: "30, 60", produto_ids: [p1, p2, p3] }];
      const out = (await um<any>(c, `select public.fazer_pedido_p_acabado($1::jsonb) as r`, [JSON.stringify(pedido)])).r;
      expect(Array.isArray(out)).toBe(true);
      expect(out.length).toBe(1);
      const ocId = out[0].oc_id;

      // 1 OC com 3 itens
      const nItens = Number((await um<any>(c, `select count(*) n from ocs_p_acabado_itens where oc_id=$1`, [ocId])).n);
      expect(nItens).toBe(3);

      // totais do cabecalho = Σ dos itens
      const cab = await um<any>(c, `select qtd_total, valor_bruto, valor_total_desconto, status from ocs_p_acabado where id=$1`, [ocId]);
      expect(Number(cab.qtd_total)).toBe(17);
      expect(Number(cab.valor_bruto)).toBe(10 * 20 + 5 * 10 + 2 * 100); // 450
      expect(cab.status).toBe("encomendado");

      // parcelas: "30, 60" => 2 parcelas, somando o total do cabecalho
      const parc = await c.query(`select count(*) n, coalesce(sum(valor),0) s from parcelas where oc_p_acabado_id=$1 and tipo_oc='p_acabado'`, [ocId]);
      expect(Number(parc.rows[0].n)).toBe(2);
      expect(Number(parc.rows[0].s)).toBeCloseTo(450, 2);
    });
  });

  it("sigla ACE / G+C / DIV conforme os itens", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const gfem = (await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestuario R13sig') returning id`)).id;
      const gace = (await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Acessorios R13sig') returning id`)).id;
      const cVes = (await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido R13sig') returning id`)).id;
      const cSaia = (await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Saia R13sig') returning id`)).id;
      const cCin = (await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Cinto R13sig') returning id`)).id;
      const emp = (await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${TENANT_TESTE}','Beltrano Confeccoes','material') returning id`)).id;

      // ACE: todos acessorios
      const a1 = await criarProduto(c, { nome: "A1", grupo: gace, cat: cCin, empresa: emp, acessorio: true });
      const a2 = await criarProduto(c, { nome: "A2", grupo: gace, cat: cCin, empresa: emp, acessorio: true });
      const outAce = (await um<any>(c, `select public.fazer_pedido_p_acabado($1::jsonb) as r`, [JSON.stringify([
        { empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [a1, a2] }])])).r;
      expect(String(outAce[0].numero)).toMatch(/^BELACE-\d{5}$/);

      // G+C: mesmo grupo e categoria
      const v1 = await criarProduto(c, { nome: "V1", grupo: gfem, cat: cVes, empresa: emp });
      const v2 = await criarProduto(c, { nome: "V2", grupo: gfem, cat: cVes, empresa: emp });
      const outGC = (await um<any>(c, `select public.fazer_pedido_p_acabado($1::jsonb) as r`, [JSON.stringify([
        { empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [v1, v2] }])])).r;
      expect(String(outGC[0].numero)).toMatch(/^BELVVE-\d{5}$/);

      // DIV: categorias diferentes
      const d1 = await criarProduto(c, { nome: "D1", grupo: gfem, cat: cVes, empresa: emp });
      const d2 = await criarProduto(c, { nome: "D2", grupo: gfem, cat: cSaia, empresa: emp });
      const outDiv = (await um<any>(c, `select public.fazer_pedido_p_acabado($1::jsonb) as r`, [JSON.stringify([
        { empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [d1, d2] }])])).r;
      expect(String(outDiv[0].numero)).toMatch(/^BELDIV-\d{5}$/);
    });
  });

  it("fixture sigla: SQL _oc_lote_sigla == espelho TS previewSiglaOcLote", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = (await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${TENANT_TESTE}','Beltrano Confeccoes','material') returning id`)).id;
      const empSem = (await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${TENANT_TESTE}','123','material') returning id`)).id;
      let uid = 0;
      // cria grupos/categorias UNICOS por NOME-BASE do caso (o nome que norm3/ehGrupoAcessorio enxerga mantem o prefixo),
      // com sufixo unico para nao colidir com o indice (tenant,nome). norm3 so pega as 3 primeiras letras alfabeticas.
      const grupoCache = new Map<string, string>();
      const catCache = new Map<string, string>();
      for (const caso of CASOS_SIGLA) {
        const itensJson: any[] = [];
        for (const it of caso.itens) {
          const gkey = `${caso.nome}|${it.grupoNome}`;
          const ckey = `${caso.nome}|${it.categoriaNome}`;
          if (!grupoCache.has(gkey)) {
            // o NOME base (it.grupoNome) vem primeiro: norm3/ehGrupoAcessorio enxergam o prefixo; o sufixo so desambigua.
            const nm = `${it.grupoNome} #${uid++}`;
            const gid = (await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}',$1) returning id`, [nm])).id;
            grupoCache.set(gkey, gid);
          }
          if (!catCache.has(ckey)) {
            const nm = `${it.categoriaNome} #${uid++}`;
            const cid = (await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}',$1) returning id`, [nm])).id;
            catCache.set(ckey, cid);
          }
          itensJson.push({ grupo_id: grupoCache.get(gkey), categoria_id: catCache.get(ckey) });
        }
        const empId = caso.fornecedor === "123" ? empSem : emp;
        const sqlSig = (await um<any>(c, `select public._oc_lote_sigla($1::uuid, $2::jsonb) as s`, [empId, JSON.stringify(itensJson)])).s;
        const tsSig = previewSiglaOcLote(caso.fornecedor, caso.itens);
        expect(sqlSig, `${caso.nome} (SQL vs esperado)`).toBe(caso.esperado);
        expect(tsSig, `${caso.nome} (TS vs esperado)`).toBe(caso.esperado);
      }
    });
  });

  it("produto inelegivel -> nada criado (atomico)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = (await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem R13inel') returning id`)).id;
      const cat = (await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido R13inel') returning id`)).id;
      const emp = (await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${TENANT_TESTE}','Beltrano R13inel','material') returning id`)).id;
      const bom = await criarProduto(c, { nome: "OK", grupo: g, cat, empresa: emp });
      // produto SEM valor (inelegivel: sem_valor)
      const ruim = await criarProduto(c, { nome: "SemValor", grupo: g, cat, empresa: emp, valor: 0 });
      const antes = Number((await um<any>(c, `select count(*) n from ocs_p_acabado where tenant_id='${TENANT_TESTE}'`)).n);
      await c.query(`SAVEPOINT sp_inel`);
      let msg = "";
      try {
        await c.query(`select public.fazer_pedido_p_acabado($1::jsonb)`, [JSON.stringify([
          { empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [bom, ruim] }])]);
      } catch (e: any) {
        msg = String(e?.message ?? "");
      }
      await c.query(`ROLLBACK TO SAVEPOINT sp_inel`); // txn segue usavel; o pedido inteiro nao gravou (atomico)
      expect(msg).toMatch(/pedido_recusado/);
      const depois = Number((await um<any>(c, `select count(*) n from ocs_p_acabado where tenant_id='${TENANT_TESTE}'`)).n);
      expect(depois).toBe(antes); // nada criado
    });
  });

  it("produto de OUTRA loja -> P0002 nao_encontrado", async () => {
    await withTx(async (c) => {
      // cria produto na Ave Rara mas pede como usuario da Loja Teste
      const outra = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // Ave Rara
      const g = (await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${outra}','Fem R13loja') returning id`)).id;
      const cat = (await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${outra}','Vestido R13loja') returning id`)).id;
      const emp = (await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${outra}','Beltrano R13loja','material') returning id`)).id;
      const pav = (await um<any>(c, `insert into produtos_acabados (tenant_id, nome, grupo_id, categoria_id, empresa_id, qtd_total, valor_unitario, grade_proporcao)
        values ('${outra}','X','${g}','${cat}','${emp}',10,20,'{"UN":1}'::jsonb) returning id`)).id;
      await c.query(`insert into produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, qtd) values ('${outra}','${pav}',0,10)`);
      await comoUsuario(c); // usuario da Loja Teste
      await expect(
        c.query(`select public.fazer_pedido_p_acabado($1::jsonb)`, [JSON.stringify([
          { empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [pav] }])]),
      ).rejects.toThrow(/nao_encontrado: produto/);
    });
  });
});
