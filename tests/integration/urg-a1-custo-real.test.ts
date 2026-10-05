// Urgentes R1 T5 (plan-a Task 5, Ruling A5) - custo REAL do insumo vinculado a UM tamanho rateado pela grade do CAD
// (20261103173000): em _custo_unitario_modelos_core, a soma de insumo do CTE `mat` (custo real do card INTERNO cortado) passa a
// multiplicar o consumo por _insumo_fator_custo(tamanho vinculado, mapa da grade do CAD, o MESMO total da coluna `grade`) - o card
// cortado nao mostra mais real > previsto por insumo vinculado. Insumo SEM vinculo = byte a byte o de hoje (diff-validado em TODAS
// as lojas da copia, no estado real e com todos os CADs "cortados" na txn). Ramos revenda/importado intocados (o custo_previsto da
// linha da revenda ja vem rateado pelo TS). Txn revertida; o bloco e aplicado DENTRO da txn por aplicaUrgA(c, "173000") (pula se ja
// vivo). So na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, ehBancoLocal, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaUrgA, urgAViva, URG_A_MIGS } from "./urg-a-helpers";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const bloco = () => URG_A_MIGS.find((x) => x.id === "173000")?.b;

const SIG = "public._custo_unitario_modelos_core(uuid[])";
const WRAPPER = "public.custo_unitario_modelos(uuid[])";
const ANTES = "4bf2770e4932d00914d5209a71ca6312"; // tabela de fatos do plan-a (05/out) = depois da R16 (20261026200000)

let seq = 0;
const suf = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
const depois = (): string => bloco()!.MD5[SIG]?.depois;
async function semBloco(c: Client): Promise<void> {
  if (await urgAViva(c, "173000")) await aplicarArquivo(c, bloco()!.down);
  await c.query("SET LOCAL transaction_timeout = 0");
  // o _down desliga check_function_bodies (SET LOCAL): a ida aplicada depois valida o corpo como no deploy (arquivo proprio)
  await c.query("SET LOCAL check_function_bodies = on");
}

type Custo = { previsto: number; real: number | null; confirmado: boolean; mao_obra_real: number; mao_obra_previsto: number };
async function custos(c: Client, ids: string[]): Promise<Record<string, Custo>> {
  const r = await um<{ j: Record<string, any> }>(c, `SELECT public._custo_unitario_modelos_core($1::uuid[]) AS j`, [ids]);
  const out: Record<string, Custo> = {};
  for (const [k, v] of Object.entries(r.j ?? {}))
    out[k] = {
      previsto: Number(v.previsto),
      real: v.real == null ? null : Number(v.real),
      confirmado: v.confirmado,
      mao_obra_real: Number(v.mao_obra_real),
      mao_obra_previsto: Number(v.mao_obra_previsto),
    };
  return out;
}

/** Card INTERNO cortado sintetico (Loja Teste) com os insumos dados; grade = linhas de cad_grades (vazio = sem grade). */
async function cortado(
  c: Client,
  s: string,
  grades: { real: Record<string, number> | null; plan: Record<string, number> }[],
): Promise<{ modelo: string; cad: string }> {
  const soma = (g: Record<string, number>) => Object.values(g).reduce((a, b) => a + b, 0);
  const m = await um<{ id: string }>(c, `INSERT INTO modelos (tenant_id, nome, origem) VALUES ($1, $2, 'interno') RETURNING id`, [
    T,
    `URG-A1R ${s}`,
  ]);
  const cad = await um<{ id: string }>(
    c,
    `INSERT INTO cad (tenant_id, modelo_id, enviado_corte, data_enviado_corte) VALUES ($1, $2, true, '2026-10-01') RETURNING id`,
    [T, m.id],
  );
  let n = 1;
  for (const g of grades) {
    await c.query(
      `INSERT INTO cad_grades (cad_id, variante_numero, grades_planejadas, grade_total_planejada, grades_reais, grade_total_real)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [cad.id, n++, JSON.stringify(g.plan), soma(g.plan), g.real ? JSON.stringify(g.real) : null, g.real ? soma(g.real) : null],
    );
  }
  return { modelo: m.id, cad: cad.id };
}
async function insumo(
  c: Client,
  s: string,
  nome: string,
  o: { preco: number; vinculo: string | null; tamanhoVariante?: { tam: string; preco: number } },
): Promise<string> {
  const id = (
    await um<{ id: string }>(c, `INSERT INTO etiquetas (tenant_id, nome, preco, tamanho_vinculado) VALUES ($1, $2, $3, $4) RETURNING id`, [
      T,
      `URG-A1R ${nome} ${s}`,
      o.preco,
      o.vinculo,
    ])
  ).id;
  if (o.tamanhoVariante) {
    await c.query(`INSERT INTO variantes_etiqueta (tenant_id, etiqueta_id, tamanho, preco) VALUES ($1, $2, $3, $4)`, [
      T,
      id,
      o.tamanhoVariante.tam,
      o.tamanhoVariante.preco,
    ]);
  }
  return id;
}
async function noCad(c: Client, cad: string, etiqueta: string, consumo: number): Promise<void> {
  await c.query(`INSERT INTO cad_etiquetas (cad_id, etiqueta_id, consumo) VALUES ($1, $2, $3)`, [cad, etiqueta, consumo]);
}
const LOCKS = `SELECT n.nspname || '.' || cl.relname AS rel, l.mode
                 FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
                WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')`;

describe.skipIf(!RODA)("urg R1 T5 — custo REAL do insumo vinculado rateado (173000)", () => {
  it("o bloco 173000 existe, redefine SO _custo_unitario_modelos_core (antes = tabela de fatos) e o _down volta (gerado por mig/gerar-a1.mjs)", () => {
    const b = bloco();
    expect(b).toBeTruthy();
    expect(b!.volta).toBe(true);
    expect(b!.sentinela).toBe(SIG);
    expect(Object.keys(b!.MD5)).toEqual([SIG]);
    expect(b!.MD5[SIG].antes).toBe(ANTES);
    expect(b!.MD5[SIG].depois).toMatch(/^[0-9a-f]{32}$/);
    expect(b!.NOVAS).toEqual({});
    expect(b!.drop).toBe("");
  });

  it("aplicada: md5 de depois; ACL/DEFINER/STABLE iguais; 2x na txn nao muda; _down 2x devolve o texto de antes; wrapper intocado", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await semBloco(c);
      expect(await md5Fn(c, SIG)).toBe(ANTES);
      const ACL = `SELECT p.prosecdef AS sd, coalesce(p.proacl::text, '') AS acl, array_to_string(p.proconfig, '|') AS cfg, p.provolatile::text AS vol
                     FROM pg_proc p WHERE p.oid = to_regprocedure($1)`;
      const meta0 = await um(c, ACL, [SIG]);
      expect(meta0).toEqual({ sd: true, acl: "{postgres=X/postgres,service_role=X/postgres}", cfg: "search_path=public", vol: "s" });
      const w0 = await md5Fn(c, WRAPPER);
      await aplicaUrgA(c, "173000");
      expect(await md5Fn(c, SIG)).toBe(depois());
      await aplicarArquivo(c, b!.mig);
      await aplicarArquivo(c, b!.mig); // idempotente
      await c.query("SET LOCAL transaction_timeout = 0");
      expect(await md5Fn(c, SIG)).toBe(depois());
      expect(await um(c, ACL, [SIG])).toEqual(meta0);
      for (const papel of ["anon", "authenticated"]) {
        expect({ papel, x: (await um<{ x: boolean }>(c, "SELECT has_function_privilege($1, $2, 'EXECUTE') AS x", [papel, SIG])).x })
          .toEqual({ papel, x: false });
      }
      // a tela segue pelo wrapper (mascara com '{}' sem _pode_ver_custos - invariante 12), que nao muda
      expect(await md5Fn(c, WRAPPER)).toBe(w0);
      expect((await um<{ x: boolean }>(c, "SELECT has_function_privilege('authenticated', $1, 'EXECUTE') AS x", [WRAPPER])).x).toBe(true);
      await aplicarArquivo(c, b!.down);
      await aplicarArquivo(c, b!.down); // idempotente
      await c.query("SET LOCAL transaction_timeout = 0");
      expect(await md5Fn(c, SIG)).toBe(ANTES);
      expect(await um(c, ACL, [SIG])).toEqual(meta0);
      await c.query("SET LOCAL check_function_bodies = on");
      await aplicarArquivo(c, b!.mig); // re-aplicar depois da volta
      await c.query("SET LOCAL transaction_timeout = 0");
      expect(await md5Fn(c, SIG)).toBe(depois());
    });
  });

  it("guarda: texto inesperado = P0001 na ida e no _down; ida sem os helpers da 170000 = P0001 (nada muda)", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgA(c, "173000");
      const outro = `CREATE OR REPLACE FUNCTION public._custo_unitario_modelos_core(_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql
                     STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN '{}'::jsonb; END $f$`;
      await c.query(`SAVEPOINT s`);
      await c.query(outro);
      await expect(aplicarArquivo(c, b!.mig)).rejects.toThrow(/urg_r1_173000: .*_custo_unitario_modelos_core/);
      await c.query(`ROLLBACK TO SAVEPOINT s`);
      await c.query(outro);
      await expect(aplicarArquivo(c, b!.down)).rejects.toThrow(/urg_r1_173000_down: .*_custo_unitario_modelos_core/);
      await c.query(`ROLLBACK TO SAVEPOINT s`);
      // helper da 170000 com outro texto: a ida recusa (o texto novo chama os 6 helpers)
      await c.query(`CREATE OR REPLACE FUNCTION public._insumo_fator_custo(_tam text, _mapa jsonb, _total numeric) RETURNS numeric
                     LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $f$ SELECT 1::numeric $f$`);
      await expect(aplicarArquivo(c, b!.mig)).rejects.toThrow(/urg_r1_173000: a 20261103170000/);
      await c.query(`ROLLBACK TO SAVEPOINT s`);
      expect(await md5Fn(c, SIG)).toBe(depois());
    });
  });

  it("LIFO: com a 173000 viva o inverso da R16 (20261026200000_down) e a re-aplicacao da R16 RECUSAM (P0001); depois do 173000_down o inverso da R16 passa", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    const R16_IDA = "supabase/migrations/20261026200000_custo_real_mo_prevista.sql";
    const R16_DOWN = "supabase/rollback/20261026200000_custo_real_mo_prevista_down.sql";
    await withTx(async (c) => {
      await aplicaUrgA(c, "173000");
      await expect(aplicarArquivo(c, R16_DOWN)).rejects.toThrow(/medios_r16_m7 \(volta\): .*_custo_unitario_modelos_core/);
      await expect(aplicarArquivo(c, R16_IDA)).rejects.toThrow(/medios_r16_m7: .*_custo_unitario_modelos_core/);
      await aplicarArquivo(c, b!.down);
      await c.query("SET LOCAL transaction_timeout = 0");
      expect(await md5Fn(c, SIG)).toBe(ANTES);
      await aplicarArquivo(c, R16_DOWN); // a volta da R16 (LIFO) passa
      expect(await md5Fn(c, SIG)).toBe("d26c7c9afb636f6ed26e66daf76e92ae");
    });
  });

  it("travas (por DIFERENCA): ida e _down so catalogo - nada em auth/storage/realtime, nenhuma trava de tabela alem de AccessShare", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await semBloco(c);
      const antes = new Set((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`));
      await aplicarArquivo(c, b!.mig);
      await c.query("SET LOCAL transaction_timeout = 0");
      const novas = (await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`).filter((k) => !antes.has(k));
      console.log(`[urg-a1-custo-real] travas novas da ida: ${novas.join(", ") || "(nenhuma)"}`);
      expect(novas.filter((k) => /^(auth|storage|realtime)\./.test(k))).toEqual([]);
      expect(novas.filter((k) => !k.endsWith("|AccessShareLock"))).toEqual([]);
      expect(novas.filter((k) => !k.startsWith("information_schema."))).toEqual([]);
    });
    await withTx(async (c) => {
      await aplicaUrgA(c, "173000");
      const antes = new Set((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`));
      await aplicarArquivo(c, b!.down);
      await c.query("SET LOCAL transaction_timeout = 0");
      expect((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`).filter((k) => !antes.has(k))).toEqual([]);
      expect(await md5Fn(c, SIG)).toBe(ANTES);
    });
  });

  it("card interno cortado, insumo vinculado 40|M com grade 16 de 64: o real cai preco x consumo x 0,75; fora da grade = 0; sem vinculo / tamanho proprio / grade vazia = o de hoje", async () => {
    await withTx(async (c) => {
      await semBloco(c);
      await comoUsuario(c);
      const s = suf();
      // grade do CAD: linha 1 com real (10 de 40 no 40|M), linha 2 so planejada (6 de 24) -> 16 de 64 = fator 0,25
      const a = await cortado(c, `a ${s}`, [
        { real: { "40|M": 10, "38|P": 30 }, plan: { "40|M": 12, "38|P": 28 } },
        { real: null, plan: { "40|M": 6, "38|P": 18 } },
      ]);
      const vinc = await insumo(c, s, "vinc", { preco: 2, vinculo: "40|M" });
      const livre = await insumo(c, s, "livre", { preco: 3, vinculo: null });
      const fora = await insumo(c, s, "fora", { preco: 4, vinculo: "44|GG" });
      const proprio = await insumo(c, s, "proprio", { preco: 1, vinculo: "40|M", tamanhoVariante: { tam: "P", preco: 5 } });
      await noCad(c, a.cad, vinc, 1.5);
      await noCad(c, a.cad, livre, 2);
      await noCad(c, a.cad, fora, 1);
      await noCad(c, a.cad, proprio, 1);
      // card cortado SEM grade no CAD: fator 1 (custo cheio, Ruling A3)
      const g = await cortado(c, `g ${s}`, []);
      await noCad(c, g.cad, vinc, 1.5);
      // card cortado com o 40|M ausente da grade: o vinculado conta 0
      const z = await cortado(c, `z ${s}`, [{ real: { "38|P": 8 }, plan: { "38|P": 8 } }]);
      await noCad(c, z.cad, vinc, 1.5);
      await noCad(c, z.cad, livre, 1);

      const ids = [a.modelo, g.modelo, z.modelo];
      const antes = await custos(c, ids);
      // hoje: cheio (L8: cada insumo do CAD UMA vez) = 2x1,5 + 3x2 + 4x1 + 5x1 = 18; g = 3; z = 3 + 3 = 6
      expect(antes[a.modelo].real).toBeCloseTo(18, 10);
      expect(antes[g.modelo].real).toBeCloseTo(3, 10);
      expect(antes[z.modelo].real).toBeCloseTo(6, 10);

      await aplicaUrgA(c, "173000");
      expect(await md5Fn(c, SIG)).toBe(depois());
      const dep = await custos(c, ids);
      // a: vinculado 2 x 1,5 x 0,25 = 0,75 (cai preco x consumo x 0,75 = 2,25); fora da grade 4 -> 0 (cai 4); livre 6 e tamanho
      // proprio (ignora o vinculo) 5 = os de hoje
      expect(antes[a.modelo].real! - dep[a.modelo].real!).toBeCloseTo(2 * 1.5 * 0.75 + 4 * 1, 10);
      expect(dep[a.modelo].real).toBeCloseTo(0.75 + 6 + 0 + 5, 10);
      expect(dep[g.modelo].real).toBeCloseTo(3, 10);
      expect(dep[z.modelo].real).toBeCloseTo(0 + 3, 10);
      // so o 'real' muda; previsto, M.O. e confirmado iguais
      for (const id of ids) {
        expect({ ...dep[id], real: 0 }).toEqual({ ...antes[id], real: 0 });
        expect(dep[id].confirmado).toBe(true);
      }
      // nunca acima do de hoje
      for (const id of ids) expect(dep[id].real!).toBeLessThanOrEqual(antes[id].real! + 1e-12);
    });
  });

  it("diff-validacao: insumo SEM vinculo = identico em TODAS as lojas (estado real e com todo CAD cortado); com os 18 vinculos legados so o 'real' de card com insumo vinculado muda, para menos", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '300s'");
      await semBloco(c);
      expect(await md5Fn(c, SIG)).toBe(ANTES);
      const n0 = (await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.etiquetas WHERE nullif(btrim(tamanho_vinculado), '') IS NOT NULL`)).n;
      expect(Number(n0)).toBe(0); // a copia nao tem vinculo gravado: TODO insumo e "sem vinculo"
      await comoUsuario(c);
      const tenants = (await c.query(`SELECT id FROM public.tenants ORDER BY id`)).rows.map((r) => r.id as string);
      const conta = async (sql: string) => Number((await um<{ n: string }>(c, sql)).n);
      // foto: por loja (o _core le a loja do JWT), _custo_unitario_modelos_core de TODOS os modelos da loja, 1 linha por modelo
      const foto = async (nome: string) => {
        await c.query(`CREATE TEMP TABLE ${nome} (tid uuid, mid text, v jsonb) ON COMMIT DROP`);
        for (const t of tenants) {
          await c.query(`UPDATE public.users SET tenant_id = $1 WHERE id = $2`, [t, USER_TESTE]);
          await c.query(
            `INSERT INTO ${nome} SELECT $1::uuid, j.key, j.value
               FROM jsonb_each(public._custo_unitario_modelos_core(
                      (SELECT coalesce(array_agg(m.id), '{}'::uuid[]) FROM public.modelos m WHERE m.tenant_id = $1::uuid))) j`,
            [t],
          );
        }
        await c.query(`UPDATE public.users SET tenant_id = $1 WHERE id = $2`, [T, USER_TESTE]);
      };
      const igual = async (a: string, b: string) => {
        expect({ a, n: await conta(`SELECT count(*) AS n FROM ${a}`) }).not.toEqual({ a, n: 0 });
        expect({ b, n: await conta(`SELECT count(*) AS n FROM ${b}`) }).toEqual({ b, n: await conta(`SELECT count(*) AS n FROM ${a}`) });
        // BYTE a byte: a linha inteira como texto (numeric do jsonb com a mesma escala, null = null), nos 2 sentidos
        expect({ a, b, falta: await conta(`SELECT count(*) AS n FROM (SELECT x::text FROM ${a} x EXCEPT ALL SELECT x::text FROM ${b} x) d`) })
          .toEqual({ a, b, falta: 0 });
        expect({ a, b, sobra: await conta(`SELECT count(*) AS n FROM (SELECT x::text FROM ${b} x EXCEPT ALL SELECT x::text FROM ${a} x) d`) })
          .toEqual({ a, b, sobra: 0 });
      };
      // 1) estado real da copia
      await foto("cu_real_antes");
      await aplicaUrgA(c, "173000");
      await c.query("SET LOCAL statement_timeout = '300s'");
      expect(await md5Fn(c, SIG)).toBe(depois());
      await foto("cu_real_depois");
      await igual("cu_real_antes", "cu_real_depois");
      // 2) todo CAD "enviado ao corte" na txn (sem disparar gatilhos: so a leitura do custo real importa) - TODO card com CAD passa
      //    pelo CTE mat (o insumo do CAD entra no real)
      await semBloco(c);
      await c.query("SET LOCAL statement_timeout = '300s'");
      await c.query("SET LOCAL session_replication_role = replica");
      const nCorte = (await c.query(`UPDATE public.cad SET enviado_corte = true, data_enviado_corte = coalesce(data_enviado_corte, now())
                                       WHERE NOT coalesce(enviado_corte, false)`)).rowCount;
      await c.query("SET LOCAL session_replication_role = origin");
      expect(nCorte).toBeGreaterThan(100);
      await foto("cu_corte_antes");
      await aplicaUrgA(c, "173000");
      await c.query("SET LOCAL statement_timeout = '300s'");
      const t0 = Date.now();
      await foto("cu_corte_depois");
      console.log(`[urg-a1-custo-real] foto de todas as lojas com todo CAD cortado (173000 viva): ${Date.now() - t0} ms`);
      await igual("cu_corte_antes", "cu_corte_depois");
      // 3) ensaio: os 18 vinculos legados elegiveis (T2b) ligados - SO o 'real' de card com insumo vinculado no CAD muda, e para menos
      await c.query(`UPDATE public.etiquetas e SET tamanho_vinculado = l.valor
                       FROM public._urg_r1_tamanho_legado_lista() l WHERE l.elegivel AND e.id = l.etiqueta_id`);
      await foto("cu_ligado");
      const MUDOU = `SELECT d.tid, d.mid, a.v AS va, d.v AS vd FROM cu_ligado d JOIN cu_corte_depois a ON a.tid = d.tid AND a.mid = d.mid
                      WHERE a.v IS DISTINCT FROM d.v`;
      expect(await conta(`SELECT count(*) AS n FROM cu_ligado`)).toBe(await conta(`SELECT count(*) AS n FROM cu_corte_depois`));
      const mudou = await conta(`SELECT count(*) AS n FROM (${MUDOU}) x`);
      console.log(`[urg-a1-custo-real] modelos com o real mudado pelos 18 vinculos: ${mudou}`);
      expect(mudou).toBeGreaterThan(0);
      // so a chave 'real' muda
      expect(await conta(`SELECT count(*) AS n FROM (${MUDOU}) x WHERE (x.va - 'real') IS DISTINCT FROM (x.vd - 'real')`)).toBe(0);
      // so card com insumo vinculado no CAD (o cad_conf: 1 CAD por modelo)
      expect(await conta(
        `SELECT count(*) AS n FROM (${MUDOU}) x
          WHERE NOT EXISTS (SELECT 1 FROM public.cad cd JOIN public.cad_etiquetas ce ON ce.cad_id = cd.id
                              JOIN public.etiquetas e ON e.id = ce.etiqueta_id
                             WHERE cd.modelo_id = x.mid::uuid AND nullif(btrim(e.tamanho_vinculado), '') IS NOT NULL)`,
      )).toBe(0);
      // nunca revenda/importado com produto espelho (ramos proprios intocados)
      expect(await conta(
        `SELECT count(*) AS n FROM (${MUDOU}) x
          WHERE EXISTS (SELECT 1 FROM public.produtos_acabados p WHERE p.modelo_id = x.mid::uuid)
             OR EXISTS (SELECT 1 FROM public.produtos_importados p WHERE p.modelo_id = x.mid::uuid)`,
      )).toBe(0);
      // para menos (real <= o de antes) e a diferenca = soma independente de consumo x preco x (1 - fator) por CAD
      expect(await conta(`SELECT count(*) AS n FROM (${MUDOU}) x WHERE (x.vd->>'real')::numeric > (x.va->>'real')::numeric`)).toBe(0);
      const errado = await conta(
        `WITH dif AS (SELECT x.mid::uuid AS mid, (x.va->>'real')::numeric - (x.vd->>'real')::numeric AS caiu FROM (${MUDOU}) x),
              conf AS (SELECT DISTINCT ON (cd.modelo_id) cd.modelo_id, cd.id AS cad_id FROM public.cad cd
                        WHERE cd.enviado_corte ORDER BY cd.modelo_id, cd.data_enviado_corte DESC NULLS LAST),
              esp AS (SELECT conf.modelo_id,
                             sum(coalesce(ce.consumo, 0)
                                 * coalesce(nullif((SELECT max(coalesce(ve.preco, 0)) FROM public.variantes_etiqueta ve
                                                     WHERE ve.etiqueta_id = ce.etiqueta_id AND ve.cor_id IS NOT DISTINCT FROM ce.cor_id), 0),
                                            (SELECT et.preco FROM public.etiquetas et WHERE et.id = ce.etiqueta_id), 0)
                                 * (1 - public._insumo_fator_custo(public._insumo_tamanho_de(ce.etiqueta_id),
                                                                    public._grade_mapa_cad(conf.cad_id, true),
                                                                    (SELECT coalesce(sum(coalesce(g.grade_total_real, g.grade_total_planejada, 0)), 0)
                                                                       FROM public.cad_grades g WHERE g.cad_id = conf.cad_id)))) AS caiu
                        FROM conf JOIN public.cad_etiquetas ce ON ce.cad_id = conf.cad_id
                       GROUP BY conf.modelo_id)
         SELECT count(*) AS n FROM dif FULL JOIN esp ON esp.modelo_id = dif.mid
          WHERE abs(coalesce(dif.caiu, 0) - coalesce(esp.caiu, 0)) > 1e-9`,
      );
      expect(errado).toBe(0);
    });
  }, 600_000);
});
