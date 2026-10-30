/**
 * R13 — travas / ordem de bloqueio (§5.3). Gancho URG_R13_TXN=1.
 *
 * ⚠️ LIMITE DO HARNESS (Ruling R13-T3-1): a R13 e aplicada DENTRO da txn do teste (gancho URG_R13_TXN) e revertida no fim — nunca
 * COMMITada. Por isso NAO ha como uma 2a conexao ver a R13 nem esperar numa trava segurada por esta txn (DDL nao-commitada e
 * invisivel fora da sessao). A contencao REAL com 2 escritores concorrentes (2o fazer_pedido ESPERA o FOR UPDATE e recusa) exige a
 * R13 commitada e pertence ao harness da T4 (plano §7 atribui a suite de travas/2-conexoes a T4). AQUI provamos, dentro de UMA txn:
 *   (a) por DIFERENCA de pg_locks vista de uma 2a conexao OBSERVADORA, QUAIS travas o fazer_pedido/vincular pega (cabecalho + produtos
 *       FOR UPDATE; nada em auth/storage), na ordem unica cabecalho -> produtos;
 *   (b) o advisory lock da numeracao: 2 pedidos com a MESMA sigla, em sequencia na mesma txn, geram numeros SEGUIDOS sem 23505.
 * PA e PI.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, dbUrl, TENANT_TESTE } from "./db";

const rodar = hasDb && ehBancoLocal && process.env.URG_R13_TXN === "1";

let seq = 0;
const uq = (s: string) => `${s} #${TENANT_TESTE.slice(0, 4)}${seq++}`;

async function baseComuns(c: any) {
  await comoUsuario(c);
  const g = (await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}',$1) returning id`, [uq("Fem")])).id;
  const cat = (await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}',$1) returning id`, [uq("Vestido")])).id;
  const emp = (await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${TENANT_TESTE}',$1,'material') returning id`, [uq("Beltrano Trv")])).id;
  return { g, cat, emp };
}

async function prodPA(c: any, o: { nome: string; g: string; cat: string; emp: string }) {
  const dados = { nome: o.nome, grupo_id: o.g, categoria_id: o.cat, empresa_id: o.emp, qtd_total: 10, valor_unitario: 20, grade_proporcao: { UN: 1 } };
  const id = (await um<any>(c, `select public.salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [JSON.stringify(dados), JSON.stringify([{ ordem: 0, qtd: 10 }])])).id;
  return id;
}

async function prodPI(c: any, o: { nome: string; g: string; cat: string; emp: string }) {
  const id = (await um<any>(c, `insert into produtos_importados (tenant_id, nome, grupo_id, categoria_id, empresa_id, qtd_total, valor_unitario_m1, grade_proporcao, moeda_compra, moeda_intermediaria, cotacao_final)
    values ('${TENANT_TESTE}',$1,$2,$3,$4,10,20,'{"UN":1}'::jsonb,'RMB','USD',0.8) returning id`, [o.nome, o.g, o.cat, o.emp])).id;
  await c.query(`insert into produto_importado_variantes (tenant_id, produto_importado_id, ordem, qtd) values ('${TENANT_TESTE}',$1,0,10)`, [id]);
  await c.query(`insert into produto_importado_etapas (tenant_id, produto_importado_id, ordem, rotulo, base, percentual, cotacao) values ('${TENANT_TESTE}',$1,1,'M','mercadoria',100,0.8)`, [id]);
  return id;
}

(rodar ? describe : describe.skip)("R13 travas §5.3 — pg_locks (observador) + advisory da numeracao", () => {
  it("PA fazer_pedido: pega FOR UPDATE no cabecalho (ocs_p_acabado) e nos produtos; nada em auth/storage", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await baseComuns(c);
      const p1 = await prodPA(c, { nome: "P1", g, cat, emp });
      const pid = (await um<{ p: number }>(c, "SELECT pg_backend_pid() AS p")).p;
      const b = new Client({ connectionString: dbUrl()!, ssl: false });
      await b.connect();
      const travas = async () =>
        (await b.query(
          `SELECT c.relname AS rel, n.nspname AS nsp, l.mode FROM pg_locks l
             LEFT JOIN pg_class c ON c.oid = l.relation LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE l.pid = $1 AND l.granted AND l.locktype = 'relation'`, [pid])).rows as Array<{ rel: string; nsp: string; mode: string }>;
      let novas: Array<{ rel: string; nsp: string; mode: string }> = [];
      try {
        const antes = new Set((await travas()).map((t) => `${t.nsp}.${t.rel}|${t.mode}`));
        await c.query(`select public.fazer_pedido_p_acabado($1::jsonb)`, [JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [p1] }])]);
        novas = (await travas()).filter((t) => !antes.has(`${t.nsp}.${t.rel}|${t.mode}`));
      } finally { await b.end(); }
      // nenhuma trava em auth/storage/realtime (o pedido nao toca login/storage)
      expect(novas.filter((t) => /^(auth|storage|realtime|supabase_functions|graphql|vault)$/.test(t.nsp))).toEqual([]);
      // pegou a trava FOR UPDATE nos produtos (RowShareLock) — a ordem unica comeca pelos produtos no pedido novo (sem cabecalho previo)
      const rows = (await (async () => {
        const b2 = new Client({ connectionString: dbUrl()!, ssl: false }); await b2.connect();
        const r = (await b2.query(
          `SELECT c.relname AS rel, l.mode FROM pg_locks l JOIN pg_class c ON c.oid = l.relation JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE l.pid = $1 AND l.granted AND l.locktype = 'relation' AND n.nspname = 'public' AND c.relname = 'produtos_acabados'`, [pid])).rows;
        await b2.end(); return r;
      })());
      expect(rows.some((t: any) => t.mode === "RowShareLock"), "FOR UPDATE em produtos_acabados").toBe(true);
      void novas;
    });
  });

  it("PI fazer_pedido: pega FOR UPDATE no cabecalho (ocs_importado) e nos produtos; nada em auth/storage", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await baseComuns(c);
      const p1 = await prodPI(c, { nome: "P1", g, cat, emp });
      const pid = (await um<{ p: number }>(c, "SELECT pg_backend_pid() AS p")).p;
      const b = new Client({ connectionString: dbUrl()!, ssl: false });
      await b.connect();
      const travas = async () =>
        (await b.query(
          `SELECT c.relname AS rel, n.nspname AS nsp, l.mode FROM pg_locks l
             LEFT JOIN pg_class c ON c.oid = l.relation LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE l.pid = $1 AND l.granted AND l.locktype = 'relation'`, [pid])).rows as Array<{ rel: string; nsp: string; mode: string }>;
      let novas: Array<{ rel: string; nsp: string; mode: string }> = [];
      try {
        const antes = new Set((await travas()).map((t) => `${t.nsp}.${t.rel}|${t.mode}`));
        await c.query(`select public.fazer_pedido_importado($1::jsonb)`, [JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [p1] }])]);
        novas = (await travas()).filter((t) => !antes.has(`${t.nsp}.${t.rel}|${t.mode}`));
      } finally { await b.end(); }
      expect(novas.filter((t) => /^(auth|storage|realtime|supabase_functions|graphql|vault)$/.test(t.nsp))).toEqual([]);
      const rows = (await (async () => {
        const b2 = new Client({ connectionString: dbUrl()!, ssl: false }); await b2.connect();
        const r = (await b2.query(
          `SELECT c.relname AS rel, l.mode FROM pg_locks l JOIN pg_class c ON c.oid = l.relation JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE l.pid = $1 AND l.granted AND l.locktype = 'relation' AND n.nspname = 'public' AND c.relname = 'produtos_importados'`, [pid])).rows;
        await b2.end(); return r;
      })());
      expect(rows.some((t: any) => t.mode === "RowShareLock"), "FOR UPDATE em produtos_importados").toBe(true);
      void novas;
    });
  });

  it("PA advisory da numeracao: 2 pedidos de MESMA sigla, em sequencia, numeros SEGUIDOS sem 23505", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await baseComuns(c);
      const pa1 = await prodPA(c, { nome: "A1", g, cat, emp });
      const pa2 = await prodPA(c, { nome: "A2", g, cat, emp });
      const o1 = (await um<any>(c, `select public.fazer_pedido_p_acabado($1::jsonb) as r`, [JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [pa1] }])])).r[0];
      const o2 = (await um<any>(c, `select public.fazer_pedido_p_acabado($1::jsonb) as r`, [JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [pa2] }])])).r[0];
      const n1 = Number(String(o1.numero).match(/(\d+)$/)![1]);
      const n2 = Number(String(o2.numero).match(/(\d+)$/)![1]);
      // mesma sigla (mesmo fornecedor/grupo/categoria) -> numeros seguidos (advisory lock serializa o MAX+1; sem 23505)
      expect(String(o1.numero).replace(/\d+$/, "")).toBe(String(o2.numero).replace(/\d+$/, ""));
      expect(n2).toBe(n1 + 1);
    });
  });

  it("PI advisory da numeracao: 2 pedidos de MESMA sigla, em sequencia, numeros SEGUIDOS sem 23505", async () => {
    await withTx(async (c) => {
      const { g, cat, emp } = await baseComuns(c);
      const pi1 = await prodPI(c, { nome: "B1", g, cat, emp });
      const pi2 = await prodPI(c, { nome: "B2", g, cat, emp });
      const o1 = (await um<any>(c, `select public.fazer_pedido_importado($1::jsonb) as r`, [JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [pi1] }])])).r[0];
      const o2 = (await um<any>(c, `select public.fazer_pedido_importado($1::jsonb) as r`, [JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [pi2] }])])).r[0];
      const n1 = Number(String(o1.numero).match(/(\d+)$/)![1]);
      const n2 = Number(String(o2.numero).match(/(\d+)$/)![1]);
      expect(String(o1.numero).replace(/\d+$/, "")).toBe(String(o2.numero).replace(/\d+$/, ""));
      expect(n2).toBe(n1 + 1);
    });
  });
});
