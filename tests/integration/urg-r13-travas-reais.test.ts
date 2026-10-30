/**
 * R13 — travas REAIS com 2 conexoes (§5.3; o que a T3 ruling T3-1 DEFERIU para a T4).
 *
 * ⚠️ DIFERENTE do urg-r13-travas.test.ts: aquele roda DENTRO da txn do teste (gancho URG_R13_TXN) e so prova por DIFERENCA de
 * pg_locks quais travas o pedido pega — a R13 nunca e COMMITada, entao uma 2a sessao nao ve a R13 nem ESPERA numa trava segurada
 * pela 1a. ESTE arquivo prova a CONTENCAO REAL entre 2 sessoes concorrentes: exige a R13 **COMMITADA** na copia4 e e gated por
 * `URG_R13_REAL=1` (NAO usa o gancho per-txn; cada cenario COMMITA a sua semente e a LIMPA no finally — a copia4 fica LIMPA).
 *
 * Cenarios (brief §5.3 / plano §5.3):
 *   1. dois `fazer_pedido` com o MESMO produto em paralelo -> o 2o ESPERA o FOR UPDATE e, quando o 1o commita, RECUSA "ja tem a OC"
 *      (pedido_recusado: ...: ja_tem_oc). PA e PI.
 *   2. dois `vincular` do MESMO produto em OCs diferentes -> 1 vence, o outro recusa (serializado pela trava do produto). PA e PI.
 *   3. Salvar da OC x vincular na MESMA OC -> SEM deadlock (ordem unica cabecalho -> produto nos dois). PA.
 *   4. dois pedidos com a MESMA sigla em paralelo -> numeros SEGUIDOS, sem 23505 (advisory lock por loja no numero). PA e PI.
 *
 * Receita de contencao: a conexao A abre uma txn e segura a trava (FOR UPDATE do produto, pelo proprio corpo da RPC ou por um
 * SELECT ... FOR UPDATE), a conexao B dispara a MESMA operacao e BLOQUEIA; medimos que B fica pendente (pg_stat_activity
 * wait_event = 'transactionid'/'tuple' OU pg_locks granted=false), soltamos A e aferimos o resultado de B.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { hasDb, ehBancoLocal, dbUrl, TENANT_TESTE, USER_TESTE } from "./db";

const URL = dbUrl();
// So roda quando pedido explicitamente E a R13 esta COMMITada (checado no beforeAll).
const ligado = hasDb && ehBancoLocal && process.env.URG_R13_REAL === "1";

let r13Commitada = false;

function novoClient(): Client {
  return new Client({ connectionString: URL!, ssl: false });
}

/** Abre uma conexao ja autenticada como o usuario da Loja Teste (JWT de SESSAO, nao txn-local — persiste entre statements). */
async function conectarComoUsuario(): Promise<Client> {
  const c = novoClient();
  await c.connect();
  await c.query("SELECT set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: USER_TESTE, role: "authenticated" }),
  ]);
  return c;
}

let seq = 0;
const uq = (s: string) => `${s} R13REAL ${Date.now().toString(36)}_${seq++}`;

// IDs criados (committed) para limpar no finally de cada cenario.
type Semente = { grupos: string[]; cats: string[]; emps: string[]; prodsPa: string[]; prodsPi: string[]; ocsPa: string[]; ocsPi: string[] };
function sementeVazia(): Semente {
  return { grupos: [], cats: [], emps: [], prodsPa: [], prodsPi: [], ocsPa: [], ocsPi: [] };
}

async function limpar(c: Client, s: Semente): Promise<void> {
  // ordem: OCs (cascade itens) -> produtos -> atributos. Tudo da Loja Teste, criado por este teste.
  for (const id of s.ocsPa) await c.query("DELETE FROM public.ocs_p_acabado WHERE id = $1", [id]).catch(() => {});
  for (const id of s.ocsPi) await c.query("DELETE FROM public.ocs_importado WHERE id = $1", [id]).catch(() => {});
  // apaga QUALQUER OC que tenha nascido vinculada a estes produtos (via item), para nao deixar lixo
  for (const id of s.prodsPa)
    await c.query("DELETE FROM public.ocs_p_acabado WHERE id IN (SELECT oc_id FROM public.ocs_p_acabado_itens WHERE produto_acabado_id = $1)", [id]).catch(() => {});
  for (const id of s.prodsPi)
    await c.query("DELETE FROM public.ocs_importado WHERE id IN (SELECT oc_id FROM public.ocs_importado_itens WHERE produto_importado_id = $1)", [id]).catch(() => {});
  for (const id of s.prodsPa) await c.query("DELETE FROM public.produtos_acabados WHERE id = $1", [id]).catch(() => {});
  for (const id of s.prodsPi) await c.query("DELETE FROM public.produtos_importados WHERE id = $1", [id]).catch(() => {});
  for (const id of s.emps) await c.query("DELETE FROM public.empresas WHERE id = $1", [id]).catch(() => {});
  for (const id of s.cats) await c.query("DELETE FROM public.categorias_produto WHERE id = $1", [id]).catch(() => {});
  for (const id of s.grupos) await c.query("DELETE FROM public.grupos_produto WHERE id = $1", [id]).catch(() => {});
}

async function baseComuns(c: Client, s: Semente): Promise<{ g: string; cat: string; emp: string }> {
  const g = (await c.query("INSERT INTO grupos_produto (tenant_id, nome) VALUES ($1,$2) RETURNING id", [TENANT_TESTE, uq("Fem")])).rows[0].id;
  const cat = (await c.query("INSERT INTO categorias_produto (tenant_id, nome) VALUES ($1,$2) RETURNING id", [TENANT_TESTE, uq("Vestido")])).rows[0].id;
  const emp = (await c.query("INSERT INTO empresas (tenant_id, nome_fantasia, tipo) VALUES ($1,$2,'material') RETURNING id", [TENANT_TESTE, uq("Beltrano")])).rows[0].id;
  s.grupos.push(g); s.cats.push(cat); s.emps.push(emp);
  return { g, cat, emp };
}

async function prodPA(c: Client, s: Semente, o: { nome: string; g: string; cat: string; emp: string }): Promise<string> {
  const dados = { nome: o.nome, grupo_id: o.g, categoria_id: o.cat, empresa_id: o.emp, qtd_total: 10, valor_unitario: 20, grade_proporcao: { UN: 1 } };
  const id = (await c.query("SELECT public.salvar_produto_acabado(null, $1::jsonb, $2::jsonb) AS id", [JSON.stringify(dados), JSON.stringify([{ ordem: 0, qtd: 10 }])])).rows[0].id;
  s.prodsPa.push(id);
  return id;
}

async function prodPI(c: Client, s: Semente, o: { nome: string; g: string; cat: string; emp: string }): Promise<string> {
  const id = (await c.query(
    `INSERT INTO produtos_importados (tenant_id, nome, grupo_id, categoria_id, empresa_id, qtd_total, valor_unitario_m1, grade_proporcao, moeda_compra, moeda_intermediaria, cotacao_final)
     VALUES ($1,$2,$3,$4,$5,10,20,'{"UN":1}'::jsonb,'RMB','USD',0.8) RETURNING id`, [TENANT_TESTE, o.nome, o.g, o.cat, o.emp])).rows[0].id;
  await c.query("INSERT INTO produto_importado_variantes (tenant_id, produto_importado_id, ordem, qtd) VALUES ($1,$2,0,10)", [TENANT_TESTE, id]);
  await c.query("INSERT INTO produto_importado_etapas (tenant_id, produto_importado_id, ordem, rotulo, base, percentual, cotacao) VALUES ($1,$2,1,'M','mercadoria',100,0.8)", [TENANT_TESTE, id]);
  s.prodsPi.push(id);
  return id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Espera ate `pid` ficar BLOQUEADO (lock nao concedido) visto de uma 3a conexao observadora, ou estourar o timeout. */
async function esperarBloqueio(obs: Client, pid: number, ms = 4000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const r = await obs.query(
      `SELECT 1 FROM pg_locks WHERE pid = $1 AND NOT granted
         UNION ALL
       SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock' LIMIT 1`, [pid]);
    if (r.rows.length > 0) return true;
    await sleep(50);
  }
  return false;
}

beforeAll(async () => {
  if (!ligado) return;
  const c = novoClient();
  await c.connect();
  try {
    r13Commitada = !!(await c.query("SELECT to_regclass('public.ocs_p_acabado_itens') IS NOT NULL AS ok")).rows[0]?.ok;
  } finally {
    await c.end();
  }
  if (!r13Commitada) throw new Error("URG_R13_REAL=1 exige a R13 COMMITada na copia4 (aplique a migration antes de rodar)");
});

const descreve = ligado ? describe : describe.skip;

descreve("R13 travas REAIS §5.3 (2 conexoes; R13 COMMITada)", () => {
  it("PA: 2 fazer_pedido do MESMO produto em paralelo -> o 2o ESPERA o FOR UPDATE e RECUSA ja_tem_oc", async () => {
    const setup = await conectarComoUsuario();
    const s = sementeVazia();
    const a = await conectarComoUsuario();
    const b = await conectarComoUsuario();
    const obs = await conectarComoUsuario();
    try {
      const { g, cat, emp } = await baseComuns(setup, s);
      const pid = await prodPA(setup, s, { nome: uq("P"), g, cat, emp });
      const pedido = JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [pid] }]);

      const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p as number;

      // A: abre txn, segura o FOR UPDATE do produto (como o corpo da RPC faz) SEM commitar ainda.
      await a.query("BEGIN");
      await a.query("SELECT 1 FROM public.produtos_acabados WHERE id = $1 FOR UPDATE", [pid]);

      // B: dispara o fazer_pedido concorrente — BLOQUEIA no FOR UPDATE do produto segurado por A.
      const pB = b.query("SELECT public.fazer_pedido_p_acabado($1::jsonb) AS r", [pedido]);
      const bloqueou = await esperarBloqueio(obs, pidB);
      expect(bloqueou, "o 2o fazer_pedido tem de ESPERAR a trava do produto").toBe(true);

      // A: completa o pedido ELA MESMA e commita (A vence) -> o produto passa a ter OC.
      const rA = (await a.query("SELECT public.fazer_pedido_p_acabado($1::jsonb) AS r", [pedido])).rows[0].r;
      s.ocsPa.push(rA[0].oc_id);
      await a.query("COMMIT");

      // B: destrava, re-le os motivos, encontra a OC -> RECUSA.
      await expect(pB).rejects.toThrow(/pedido_recusado:.*ja_tem_oc/);
    } finally {
      await a.query("ROLLBACK").catch(() => {});
      await limpar(setup, s);
      await Promise.all([a.end(), b.end(), obs.end(), setup.end()]);
    }
  });

  it("PI: 2 fazer_pedido do MESMO produto em paralelo -> o 2o ESPERA e RECUSA ja_tem_oc", async () => {
    const setup = await conectarComoUsuario();
    const s = sementeVazia();
    const a = await conectarComoUsuario();
    const b = await conectarComoUsuario();
    const obs = await conectarComoUsuario();
    try {
      const { g, cat, emp } = await baseComuns(setup, s);
      const pid = await prodPI(setup, s, { nome: uq("P"), g, cat, emp });
      const pedido = JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [pid] }]);
      const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p as number;

      await a.query("BEGIN");
      await a.query("SELECT 1 FROM public.produtos_importados WHERE id = $1 FOR UPDATE", [pid]);
      const pB = b.query("SELECT public.fazer_pedido_importado($1::jsonb) AS r", [pedido]);
      expect(await esperarBloqueio(obs, pidB)).toBe(true);
      const rA = (await a.query("SELECT public.fazer_pedido_importado($1::jsonb) AS r", [pedido])).rows[0].r;
      s.ocsPi.push(rA[0].oc_id);
      await a.query("COMMIT");
      await expect(pB).rejects.toThrow(/pedido_recusado:.*ja_tem_oc/);
    } finally {
      await a.query("ROLLBACK").catch(() => {});
      await limpar(setup, s);
      await Promise.all([a.end(), b.end(), obs.end(), setup.end()]);
    }
  });

  it("PA: 2 vincular do MESMO produto em OCs diferentes -> 1 vence, o outro recusa (serializado)", async () => {
    const setup = await conectarComoUsuario();
    const s = sementeVazia();
    const a = await conectarComoUsuario();
    const b = await conectarComoUsuario();
    const obs = await conectarComoUsuario();
    try {
      const { g, cat, emp } = await baseComuns(setup, s);
      // produto avulso, SEM OC ainda; 2 OCs do mesmo fornecedor, cada uma com 1 outro produto (encomendadas).
      const alvo = await prodPA(setup, s, { nome: uq("Alvo"), g, cat, emp });
      const semente1 = await prodPA(setup, s, { nome: uq("Base1"), g, cat, emp });
      const semente2 = await prodPA(setup, s, { nome: uq("Base2"), g, cat, emp });
      const oc1 = (await setup.query("SELECT public.fazer_pedido_p_acabado($1::jsonb) AS r", [JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [semente1] }])])).rows[0].r[0].oc_id;
      const oc2 = (await setup.query("SELECT public.fazer_pedido_p_acabado($1::jsonb) AS r", [JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [semente2] }])])).rows[0].r[0].oc_id;
      s.ocsPa.push(oc1, oc2);

      const pidB = (await b.query("SELECT pg_backend_pid() AS p")).rows[0].p as number;
      // A segura o produto-alvo (como o vincular faz depois do cabecalho); B tenta vincular na OC2 e BLOQUEIA no produto.
      await a.query("BEGIN");
      await a.query("SELECT 1 FROM public.produtos_acabados WHERE id = $1 FOR UPDATE", [alvo]);
      const pB = b.query("SELECT public.vincular_oc_p_acabado($1,$2) AS r", [oc2, alvo]);
      expect(await esperarBloqueio(obs, pidB)).toBe(true);
      // A vincula o alvo na OC1 e commita (A vence).
      await a.query("SELECT public.vincular_oc_p_acabado($1,$2)", [oc1, alvo]);
      await a.query("COMMIT");
      // B destrava: o produto ja tem OC -> recusa (adicionar com motivos / ja_tem_oc).
      await expect(pB).rejects.toThrow(/pedido_recusado|ja_tem_oc|fornecedor_diferente|oc_produto/);
      // exatamente 1 item vinculado ao alvo (so a OC1), em 1 so OC.
      const n = (await setup.query("SELECT count(DISTINCT oc_id)::int AS n FROM public.ocs_p_acabado_itens WHERE produto_acabado_id = $1", [alvo])).rows[0].n;
      expect(n).toBe(1);
    } finally {
      await a.query("ROLLBACK").catch(() => {});
      await limpar(setup, s);
      await Promise.all([a.end(), b.end(), obs.end(), setup.end()]);
    }
  });

  it("PA: Salvar da OC x vincular na MESMA OC -> SEM deadlock (ordem unica cabecalho -> produto)", async () => {
    const setup = await conectarComoUsuario();
    const s = sementeVazia();
    const a = await conectarComoUsuario();
    const b = await conectarComoUsuario();
    try {
      const { g, cat, emp } = await baseComuns(setup, s);
      const base = await prodPA(setup, s, { nome: uq("Base"), g, cat, emp });
      const novo = await prodPA(setup, s, { nome: uq("Novo"), g, cat, emp });
      const oc = (await setup.query("SELECT public.fazer_pedido_p_acabado($1::jsonb) AS r", [JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [base] }])])).rows[0].r[0].oc_id;
      s.ocsPa.push(oc);
      const rev = (await setup.query("SELECT rev FROM public.ocs_p_acabado WHERE id = $1", [oc])).rows[0].rev as number;
      const itemId = (await setup.query("SELECT id FROM public.ocs_p_acabado_itens WHERE oc_id = $1 ORDER BY ordem LIMIT 1", [oc])).rows[0].id as string;

      // As duas operacoes pegam a MESMA ordem (cabecalho -> produto): nenhum ciclo. Disparadas concorrentes, ambas terminam
      // (uma espera a outra no cabecalho); nenhuma cai em 40P01 (deadlock_detected).
      await Promise.all([a.query("SET lock_timeout='6s'"), b.query("SET lock_timeout='6s'")]);
      const dados = JSON.stringify({ data_prevista: "2026-03-01" });
      const itens = JSON.stringify([{ id: itemId }]); // mantem o item existente (estado completo)
      const pSalvar = a.query("SELECT public.salvar_oc_p_acabado_itens($1,$2::jsonb,$3::jsonb,$4) AS r", [oc, dados, itens, rev]);
      const pVincular = b.query("SELECT public.vincular_oc_p_acabado($1,$2) AS r", [oc, novo]);
      const res = await Promise.allSettled([pSalvar, pVincular]);
      // Nenhuma das duas pode falhar por DEADLOCK (40P01). P0409 (rev) e aceitavel (serializacao otimista), deadlock NAO.
      for (const r of res) {
        if (r.status === "rejected") {
          expect(String(r.reason?.code ?? r.reason), `sem deadlock: ${r.reason}`).not.toBe("40P01");
          expect(String(r.reason), `sem deadlock: ${r.reason}`).not.toMatch(/deadlock/i);
        }
      }
      // pelo menos UMA concluiu (as duas pegam o cabecalho em serie).
      expect(res.some((r) => r.status === "fulfilled")).toBe(true);
    } finally {
      await limpar(setup, s);
      await Promise.all([a.end(), b.end(), setup.end()]);
    }
  });

  it("PA: 2 pedidos de MESMA sigla em PARALELO -> numeros SEGUIDOS, sem 23505 (advisory lock)", async () => {
    const setup = await conectarComoUsuario();
    const s = sementeVazia();
    const a = await conectarComoUsuario();
    const b = await conectarComoUsuario();
    try {
      const { g, cat, emp } = await baseComuns(setup, s);
      const p1 = await prodPA(setup, s, { nome: uq("A1"), g, cat, emp });
      const p2 = await prodPA(setup, s, { nome: uq("A2"), g, cat, emp });
      const mk = (pid: string) => JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", produto_ids: [pid] }]);
      // DISPARA os 2 pedidos ao MESMO tempo em conexoes diferentes: o advisory lock por loja no numero serializa o MAX+1.
      const [rA, rB] = await Promise.all([
        a.query("SELECT public.fazer_pedido_p_acabado($1::jsonb) AS r", [mk(p1)]),
        b.query("SELECT public.fazer_pedido_p_acabado($1::jsonb) AS r", [mk(p2)]),
      ]);
      const o1 = rA.rows[0].r[0]; const o2 = rB.rows[0].r[0];
      s.ocsPa.push(o1.oc_id, o2.oc_id);
      const n1 = Number(String(o1.numero).match(/(\d+)$/)![1]);
      const n2 = Number(String(o2.numero).match(/(\d+)$/)![1]);
      expect(String(o1.numero).replace(/\d+$/, "")).toBe(String(o2.numero).replace(/\d+$/, "")); // mesma sigla
      expect(Math.abs(n2 - n1)).toBe(1); // numeros SEGUIDOS (quem ganha o advisory primeiro leva o menor), sem colisao
    } finally {
      await limpar(setup, s);
      await Promise.all([a.end(), b.end(), setup.end()]);
    }
  });

  it("PI: 2 pedidos de MESMA sigla em PARALELO -> numeros SEGUIDOS, sem 23505", async () => {
    const setup = await conectarComoUsuario();
    const s = sementeVazia();
    const a = await conectarComoUsuario();
    const b = await conectarComoUsuario();
    try {
      const { g, cat, emp } = await baseComuns(setup, s);
      const p1 = await prodPI(setup, s, { nome: uq("B1"), g, cat, emp });
      const p2 = await prodPI(setup, s, { nome: uq("B2"), g, cat, emp });
      const mk = (pid: string) => JSON.stringify([{ empresa_id: emp, data_pedido: "2026-02-01", data_prevista: "2026-03-01", moeda_compra: "RMB", moeda_intermediaria: "USD", produto_ids: [pid] }]);
      const [rA, rB] = await Promise.all([
        a.query("SELECT public.fazer_pedido_importado($1::jsonb) AS r", [mk(p1)]),
        b.query("SELECT public.fazer_pedido_importado($1::jsonb) AS r", [mk(p2)]),
      ]);
      const o1 = rA.rows[0].r[0]; const o2 = rB.rows[0].r[0];
      s.ocsPi.push(o1.oc_id, o2.oc_id);
      const n1 = Number(String(o1.numero).match(/(\d+)$/)![1]);
      const n2 = Number(String(o2.numero).match(/(\d+)$/)![1]);
      expect(String(o1.numero).replace(/\d+$/, "")).toBe(String(o2.numero).replace(/\d+$/, ""));
      expect(Math.abs(n2 - n1)).toBe(1);
    } finally {
      await limpar(setup, s);
      await Promise.all([a.end(), b.end(), setup.end()]);
    }
  });
});
