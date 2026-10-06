// Urgentes R1 T3 (plan-a, migration 20261103171000_urg_r1_insumo_tamanho_consumidores): os 4 consumidores SQL de "consumo x
// grade" de insumo passam pelos helpers da 170000 — custo previsto (_custo_calcular, Ruling A3), fila do custo (fn_custo_fila_preco,
// Ruling A4), estoque de insumo da revenda (_estoque_etiqueta_core baixa_revenda) e a materializacao do recebimento da revenda
// (_receber_oc_p_acabado_core). Insumo SEM vinculo = byte a byte o de hoje (diff-validado em TODAS as lojas da copia).
// Txn revertida; o bloco e aplicado DENTRO da txn por aplicaUrgA(c, "171000") (pula se ja vivo na copia). So na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, ehBancoLocal, TENANT_TESTE } from "./db";
import { aplicaUrgA, urgAViva, URG_A_MIGS, zeraVinculosTamanhoNaTxn } from "./urg-a-helpers";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const bloco = () => URG_A_MIGS.find((x) => x.id === "171000")?.b;

const CUSTO = "public._custo_calcular(uuid,uuid[])";
const FILA = "public.fn_custo_fila_preco()";
const ESTOQUE = "public._estoque_etiqueta_core(uuid)";
const RECEBER = "public._receber_oc_p_acabado_core(uuid,jsonb,jsonb)";
const SIGS = [CUSTO, FILA, ESTOQUE, RECEBER];
// md5 de ANTES = tabela de fatos do plan-a (05/out); o "depois" vem do urg-a-dados.ts gerado
const ANTES: Record<string, string> = {
  [CUSTO]: "f9d87d6a1f9f307a7d83cf837730566c",
  [FILA]: "cd405a624d82e23f0ce8120472f04471",
  [ESTOQUE]: "28aa308d297cc18b653c6290a5b3b958",
  [RECEBER]: "3f2e2b31f6f28aaa35c9b13c1fb197be",
};

let seq = 0;
const suf = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
async function md5s(c: Client): Promise<Record<string, string | null>> {
  const o: Record<string, string | null> = {};
  for (const s of SIGS) o[s] = await md5Fn(c, s);
  return o;
}
const depois = (): Record<string, string> => Object.fromEntries(SIGS.map((s) => [s, bloco()!.MD5[s]?.depois]));
async function semBloco(c: Client): Promise<void> {
  if (await urgAViva(c, "171000")) await aplicarArquivo(c, bloco()!.down);
  await c.query("SET LOCAL transaction_timeout = 0");
  // o _down desliga check_function_bodies (SET LOCAL): a ida medida/aplicada depois valida o corpo como no deploy (arquivo proprio)
  await c.query("SET LOCAL check_function_bodies = on");
}
async function imediato(c: Client): Promise<void> {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}
async function fila(c: Client): Promise<string[]> {
  return (await c.query(`SELECT modelo_id FROM public.custo_recalculo_fila ORDER BY modelo_id`)).rows.map((r) => r.modelo_id as string);
}

describe.skipIf(!RODA)("urg R1 T3 — consumidores SQL do insumo por tamanho (171000)", () => {
  it("o bloco 171000 existe, redefine as 4 funcoes (antes = tabela de fatos) e o _down volta (gerado por mig/gerar-a1.mjs)", () => {
    const b = bloco();
    expect(b).toBeTruthy();
    expect(b!.volta).toBe(true);
    expect(Object.fromEntries(SIGS.map((s) => [s, b!.MD5[s]?.antes]))).toEqual(ANTES);
    for (const s of SIGS) expect(b!.MD5[s].depois).toMatch(/^[0-9a-f]{32}$/);
  });

  it("aplicada: md5 de depois; ACL/DEFINER/search_path iguais aos de antes; 2x na txn nao muda; _down devolve os 4 textos de antes", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await semBloco(c);
      expect(await md5s(c)).toEqual(ANTES);
      const ACL = `SELECT p.prosecdef AS sd, coalesce(p.proacl::text, '') AS acl, array_to_string(p.proconfig, '|') AS cfg, p.provolatile::text AS vol
                     FROM pg_proc p WHERE p.oid = to_regprocedure($1)`;
      const meta0 = await Promise.all(SIGS.map((s) => um(c, ACL, [s])));
      await aplicaUrgA(c, "171000");
      expect(await md5s(c)).toEqual(depois());
      await aplicarArquivo(c, b!.mig);
      await aplicarArquivo(c, b!.mig);
      await c.query("SET LOCAL transaction_timeout = 0");
      expect(await md5s(c)).toEqual(depois());
      expect(await Promise.all(SIGS.map((s) => um(c, ACL, [s])))).toEqual(meta0);
      for (const s of SIGS) {
        for (const papel of ["anon", "authenticated"]) {
          expect({ s, papel, x: (await um<{ x: boolean }>(c, "SELECT has_function_privilege($1, $2, 'EXECUTE') AS x", [papel, s])).x })
            .toEqual({ s, papel, x: false });
        }
      }
      await aplicarArquivo(c, b!.down);
      await aplicarArquivo(c, b!.down); // idempotente
      await c.query("SET LOCAL transaction_timeout = 0");
      expect(await md5s(c)).toEqual(ANTES);
      expect(await Promise.all(SIGS.map((s) => um(c, ACL, [s])))).toEqual(meta0);
      await aplicarArquivo(c, b!.mig); // re-aplicar depois da volta
      await c.query("SET LOCAL transaction_timeout = 0");
      expect(await md5s(c)).toEqual(depois());
    });
  });

  it("guarda: funcao com texto inesperado = P0001 na ida e no _down (nada muda)", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgA(c, "171000");
      await c.query(`SAVEPOINT s`);
      await c.query(`CREATE OR REPLACE FUNCTION public.fn_custo_fila_preco() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
                     SET search_path TO 'public' AS $f$ BEGIN RETURN NULL; END $f$`);
      await expect(aplicarArquivo(c, b!.mig)).rejects.toThrow(/urg_r1_171000: .*fn_custo_fila_preco/);
      await c.query(`ROLLBACK TO SAVEPOINT s`);
      await c.query(`CREATE OR REPLACE FUNCTION public.fn_custo_fila_preco() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
                     SET search_path TO 'public' AS $f$ BEGIN RETURN NULL; END $f$`);
      await expect(aplicarArquivo(c, b!.down)).rejects.toThrow(/urg_r1_171000_down: .*fn_custo_fila_preco/);
      await c.query(`ROLLBACK TO SAVEPOINT s`);
      expect(await md5s(c)).toEqual(depois());
    });
  });

  it("travas (por DIFERENCA): ida so AccessShare (validacao do corpo SQL), nada em auth/storage/realtime; _down nenhuma", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await semBloco(c);
      const LOCKS = `SELECT n.nspname || '.' || cl.relname AS rel, l.mode
                       FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
                      WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')`;
      const antes = new Set((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`));
      await aplicarArquivo(c, b!.mig);
      await c.query("SET LOCAL transaction_timeout = 0");
      const novas = (await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`).filter((k) => !antes.has(k));
      expect(novas.filter((k) => /^(auth|storage|realtime)\./.test(k))).toEqual([]);
      expect(novas.filter((k) => !k.endsWith("|AccessShareLock") && !k.startsWith("information_schema."))).toEqual([]);
    });
    // o _down nao valida corpo (check_function_bodies off): nenhuma trava de tabela nova; e devolve o check_function_bodies so na txn
    await withTx(async (c) => {
      await aplicaUrgA(c, "171000");
      const LOCKS = `SELECT n.nspname || '.' || cl.relname AS rel, l.mode
                       FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
                      WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')`;
      const antes = new Set((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`));
      await aplicarArquivo(c, b!.down);
      await c.query("SET LOCAL transaction_timeout = 0");
      expect((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`).filter((k) => !antes.has(k))).toEqual([]);
      expect(await md5s(c)).toEqual(ANTES);
    });
  });

  it("diff-validacao: insumo SEM vinculo = identico — _estoque_etiqueta_core e _custo_calcular de TODAS as lojas antes x depois", async () => {
    await withTx(async (c) => {
      await zeraVinculosTamanhoNaTxn(c); // vinculo pre-existente na copia (QA) vira 'sem vinculo' so nesta txn
      await c.query("SET LOCAL statement_timeout = '300s'");
      await semBloco(c);
      expect(await md5s(c)).toEqual(ANTES);
      const n = (await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.etiquetas WHERE nullif(btrim(tamanho_vinculado), '') IS NOT NULL`)).n;
      expect(Number(n)).toBe(0); // a copia nao tem vinculo gravado: TODO insumo e "sem vinculo"
      const fotos = async (sufixo: string) => {
        await c.query(`CREATE TEMP TABLE est_${sufixo} ON COMMIT DROP AS
                         SELECT t.id AS tid, x.* FROM public.tenants t CROSS JOIN LATERAL public._estoque_etiqueta_core(t.id) x`);
        await c.query(`CREATE TEMP TABLE cus_${sufixo} ON COMMIT DROP AS
                         SELECT t.id AS tid, x.* FROM public.tenants t CROSS JOIN LATERAL public._custo_calcular(t.id, NULL) x`);
      };
      await fotos("antes");
      await aplicaUrgA(c, "171000");
      await c.query("SET LOCAL statement_timeout = '300s'");
      expect(await md5s(c)).toEqual(depois());
      await fotos("depois");
      const conta = async (sql: string) => Number((await um<{ n: string }>(c, sql)).n);
      for (const t of ["est", "cus"]) {
        expect({ t, n: await conta(`SELECT count(*) AS n FROM ${t}_antes`) }).not.toEqual({ t, n: 0 });
        expect({ t, n: await conta(`SELECT count(*) AS n FROM ${t}_depois`) }).toEqual({ t, n: await conta(`SELECT count(*) AS n FROM ${t}_antes`) });
        // BYTE a byte: a linha inteira como texto (numeric com a mesma escala, NULL = NULL), nos 2 sentidos
        expect({ t, falta: await conta(`SELECT count(*) AS n FROM (SELECT x::text FROM ${t}_antes x EXCEPT ALL SELECT x::text FROM ${t}_depois x) d`) })
          .toEqual({ t, falta: 0 });
        expect({ t, sobra: await conta(`SELECT count(*) AS n FROM (SELECT x::text FROM ${t}_depois x EXCEPT ALL SELECT x::text FROM ${t}_antes x) d`) })
          .toEqual({ t, sobra: 0 });
      }
      // ensaio: com os 18 vinculos legados ligados (T2b), SO mudam linhas de insumo vinculado (e o total dos cards que os usam)
      await c.query(`UPDATE public.etiquetas e SET tamanho_vinculado = l.valor
                       FROM public._urg_r1_tamanho_legado_lista() l WHERE l.elegivel AND e.id = l.etiqueta_id`);
      await fotos("ligado");
      // o ensaio e sensivel: com vinculo, o custo de cards internos muda (106 modelos na copia) e o teste ve a diferenca
      const mudouCusto = await conta(`SELECT count(*) AS n FROM (SELECT * FROM cus_ligado EXCEPT ALL SELECT * FROM cus_antes) d`);
      expect(mudouCusto).toBeGreaterThan(0);
      const fora = await conta(
        `SELECT count(*) AS n FROM (SELECT * FROM est_ligado EXCEPT ALL SELECT * FROM est_antes) d
          WHERE NOT EXISTS (SELECT 1 FROM public.etiquetas e WHERE e.id = d.etiqueta_id AND e.tamanho_vinculado IS NOT NULL)`);
      expect(fora).toBe(0);
      const foraCusto = await conta(
        `SELECT count(*) AS n FROM (SELECT * FROM cus_ligado EXCEPT ALL SELECT * FROM cus_antes) d
          WHERE NOT EXISTS (SELECT 1 FROM public.modelo_etiquetas me JOIN public.etiquetas e ON e.id = me.etiqueta_id
                             WHERE e.tamanho_vinculado IS NOT NULL
                               AND ((d.tabela = 'modelo_etiquetas' AND me.id = d.id) OR (d.tabela = 'modelos' AND me.modelo_id = d.id)))`);
      expect(foraCusto).toBe(0);
    });
  }, 600_000);

  it("revenda: OC recebida com grade real {40|M: 5, 38|P: 3} — a enviar = consumo x 5 (vinculado), 0 (fora da grade), consumo x 8 (sem vinculo); baixa idem antes e depois do Enviar para PCP", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "171000");
      await comoUsuario(c);
      const s = suf();
      const g = await um<{ id: string }>(c, `INSERT INTO grupos_produto (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [T, `Fem URG-A1C ${s}`]);
      const cat = await um<{ id: string }>(c, `INSERT INTO categorias_produto (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [T, `Vestido URG-A1C ${s}`]);
      const prod = await um<{ id: string }>(c, `SELECT salvar_produto_acabado(null, $1::jsonb, $2::jsonb) AS id`, [
        JSON.stringify({ nome: `Vestido URG-A1C ${s}`, grupo_id: g.id, categoria_id: cat.id, qtd_total: 16, grade_proporcao: { "40|M": 1, "38|P": 1 } }),
        JSON.stringify([{ ordem: 0, peso: 1, qtd: 8 }, { ordem: 1, peso: 1, qtd: 8 }]),
      ]);
      const modelo = (await um<{ id: string }>(c, `SELECT criar_card_produto_acabado($1) AS id`, [prod.id])).id;
      const cor = (await um<{ id: string }>(c, `INSERT INTO cores (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [T, `URG-A1C cor ${s}`])).id;
      const insumo = async (nome: string, vinculo: string | null, consumo: number, corId: string | null) => {
        const id = (await um<{ id: string }>(c,
          `INSERT INTO etiquetas (tenant_id, nome, tamanho_vinculado) VALUES ($1, $2, $3) RETURNING id`, [T, `URG-A1C ${nome} ${s}`, vinculo])).id;
        await c.query(`INSERT INTO modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, cor_id, consumo) VALUES ($1, $2, $3, $4, $5)`,
          [T, modelo, id, corId, consumo]);
        return id;
      };
      const vinc = await insumo("vinc", "40|M", 2, cor);
      const fora = await insumo("fora", "44|GG", 3, null);
      const livre = await insumo("livre", null, 1.5, null);
      const grade = { "0": { "40|M": { pedida: 5 }, "38|P": { pedida: 3 } }, "1": {} };
      const oc = await um<{ id: string }>(c, `SELECT salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) AS id`,
        [JSON.stringify({ nome_produto: `OC URG-A1C ${s}`, produto_acabado_id: prod.id }), JSON.stringify(grade)]);
      const rec = { "0": { "40|M": { pedida: 5, recebida: 6, defeito: 1 }, "38|P": { pedida: 3, recebida: 3, defeito: 0 } }, "1": {} };
      const r = await um<{ v: any }>(c, `SELECT receber_oc_p_acabado($1, '{}'::jsonb, $2::jsonb) AS v`, [oc.id, JSON.stringify(rec)]);
      expect(r.v.total_real).toBe(8);
      const cad = r.v.cad_id as string;
      const { rows: ce } = await c.query(
        `SELECT etiqueta_id, quantidade_planejada::float8 AS p, quantidade_enviar::float8 AS e FROM cad_etiquetas WHERE cad_id = $1`, [cad]);
      const porEtq = Object.fromEntries(ce.map((x) => [x.etiqueta_id, [x.p, x.e]]));
      expect(porEtq).toEqual({ [vinc]: [10, 10], [fora]: [0, 0], [livre]: [12, 12] });
      const baixa = async () => {
        const { rows } = await c.query(
          `SELECT x.etiqueta_id, x.tamanho, x.cor_nome, x.baixa::float8 AS b FROM public._estoque_etiqueta_core($1) x
            WHERE x.etiqueta_id = ANY ($2::uuid[]) ORDER BY x.etiqueta_id`, [T, [vinc, fora, livre]]);
        return Object.fromEntries(rows.map((x) => [x.etiqueta_id, [x.tamanho, x.cor_nome === null ? null : "cor", x.b]]));
      };
      // antes do "Enviar para PCP": baixa_revenda (pecas recebidas do tamanho vinculado; sem tamanho na chave)
      expect(await baixa()).toEqual({ [vinc]: [null, "cor", 10], [fora]: [null, null, 0], [livre]: [null, null, 12] });
      // depois do envio: vale o "a enviar" gravado (baixa_sem) — o mesmo numero, sem baixa em dobro
      await c.query(`UPDATE cad SET enviado_corte = true WHERE id = $1`, [cad]);
      expect(await baixa()).toEqual({ [vinc]: [null, "cor", 10], [fora]: [null, null, 0], [livre]: [null, null, 12] });
    });
  });

  it("fila do custo: vinculo/formato do insumo e tamanho da variante enfileiram o card interno NAO cortado (o cortado congela); nome nao enfileira", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "171000");
      await comoUsuario(c);
      const s = suf();
      const etq = (await um<{ id: string }>(c, `INSERT INTO etiquetas (tenant_id, nome, preco) VALUES ($1, $2, 1) RETURNING id`, [T, `URG-A1F ${s}`])).id;
      const card = async (cortado: boolean) => {
        const m = (await um<{ id: string }>(c, `INSERT INTO modelos (tenant_id, nome, origem) VALUES ($1, $2, 'interno') RETURNING id`,
          [T, `URG-A1F card ${suf()}`])).id;
        await c.query(`INSERT INTO modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, 1, '{"40|M": 4, "38|P": 4}'::jsonb, 8)`, [m]);
        await c.query(`INSERT INTO modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, consumo) VALUES ($1, $2, $3, 2)`, [T, m, etq]);
        if (cortado) await c.query(`INSERT INTO cad (tenant_id, modelo_id, enviado_corte) VALUES ($1, $2, true)`, [T, m]);
        return m;
      };
      const livre = await card(false);
      const cortado = await card(true);
      await imediato(c);
      expect(await fila(c)).toEqual([]);
      await c.query(`UPDATE etiquetas SET nome = nome || ' x' WHERE id = $1`, [etq]);
      expect(await fila(c)).toEqual([]);
      await c.query(`UPDATE etiquetas SET tamanho_vinculado = '40|M' WHERE id = $1`, [etq]);
      expect(await fila(c)).toEqual([livre]);
      await imediato(c);
      const custoLinha = async (m: string) =>
        Number((await um<{ v: string }>(c, `SELECT custo_previsto AS v FROM modelo_etiquetas WHERE modelo_id = $1`, [m])).v);
      expect([await custoLinha(livre), await custoLinha(cortado)]).toEqual([1, 2]); // 1 x 2 x 4/8; o cortado fica no cheio
      await c.query(`UPDATE etiquetas SET formato_tamanho = 'nenhum' WHERE id = $1`, [etq]);
      expect(await fila(c)).toEqual([livre]);
      await imediato(c);
      const v = (await um<{ id: string }>(c,
        `INSERT INTO variantes_etiqueta (tenant_id, etiqueta_id, tamanho, preco) VALUES ($1, $2, NULL, 1) RETURNING id`, [T, etq])).id;
      await imediato(c);
      expect(await fila(c)).toEqual([]);
      await c.query(`UPDATE variantes_etiqueta SET tamanho = tamanho WHERE id = $1`, [v]); // nada mudou
      expect(await fila(c)).toEqual([]);
      await c.query(`UPDATE etiquetas SET formato_tamanho = 'ambos' WHERE id = $1`, [etq]);
      await imediato(c);
      await c.query(`UPDATE variantes_etiqueta SET tamanho = 'P' WHERE id = $1`, [v]); // agora tem tamanho proprio: vinculo ignorado
      expect(await fila(c)).toEqual([livre]);
      await imediato(c);
      expect([await custoLinha(livre), await custoLinha(cortado)]).toEqual([2, 2]);
      expect(cortado).toBeTruthy();
    });
  });
});
