// Urgentes R1 T4 (plan-a, migration 20261103172000_urg_r1_custo_fila_grade): mudar a GRADE do card (modelo_grades) enfileira o
// custo previsto dos cards INTERNOS que tem insumo vinculado a UM tamanho (o fator do custo = pecas do tamanho / total, Ruling A3),
// RESPEITANDO o congelado (card enviado ao corte nao move, Ruling A4 — o Salvar do Sheet regrava modelo_grades por DELETE+INSERT
// mesmo sem mudanca). 3 gatilhos de STATEMENT com transicao (um por evento) -> fn_custo_fila_grade() -> _custo_enfileirar(ids, true).
// Txn revertida; o bloco e aplicado DENTRO da txn por aplicaUrgA(c, "172000") (pula se ja vivo na copia). So na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, ehBancoLocal, TENANT_TESTE } from "./db";
import { aplicaUrgA, urgAViva, URG_A_MIGS } from "./urg-a-helpers";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const bloco = () => URG_A_MIGS.find((x) => x.id === "172000")?.b;
const FN = "public.fn_custo_fila_grade()";
const GATILHOS = [
  // nome, evento (bit do tgtype), tabela velha, tabela nova
  ["trg_custo_fila_grade_del", "DELETE", "antigas", null],
  ["trg_custo_fila_grade_ins", "INSERT", null, "novas"],
  ["trg_custo_fila_grade_upd", "UPDATE", "antigas", "novas"],
] as const;

let seq = 0;
const suf = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
async function zera(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}
/** Tira a 172000 de vez NESTA txn (neutraliza e apaga gatilhos + funcao) — estado "antes" da ida. */
async function semBloco(c: Client): Promise<void> {
  const b = bloco()!;
  if (await urgAViva(c, "172000")) await aplicarArquivo(c, b.down);
  if ((await md5Fn(c, FN)) !== null) await aplicarArquivo(c, b.drop);
  await zera(c);
}
async function imediato(c: Client): Promise<void> {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}
async function fila(c: Client): Promise<string[]> {
  return (await c.query(`SELECT modelo_id FROM public.custo_recalculo_fila ORDER BY modelo_id`)).rows.map((r) => r.modelo_id as string);
}
async function gatilhos(c: Client) {
  const { rows } = await c.query(
    `SELECT t.tgname AS nome,
            CASE WHEN (t.tgtype & 4) = 4 THEN 'INSERT' WHEN (t.tgtype & 8) = 8 THEN 'DELETE' WHEN (t.tgtype & 16) = 16 THEN 'UPDATE' END AS ev,
            (t.tgtype & 1) = 1 AS por_linha, (t.tgtype & 2) = 2 AS before, (t.tgtype & (4|8|16|32)) AS eventos,
            t.tgoldtable AS velha, t.tgnewtable AS nova, t.tgenabled AS hab, cardinality(t.tgattr::int2[]) AS nattr,
            t.tgqual IS NULL AS sem_when, t.tgfoid = to_regprocedure($1) AS fn
       FROM pg_trigger t
      WHERE t.tgrelid = 'public.modelo_grades'::regclass AND NOT t.tgisinternal AND t.tgname LIKE 'trg\\_custo\\_fila\\_grade\\_%'
      ORDER BY 1`,
    [FN],
  );
  return rows;
}
const LOCKS = `SELECT n.nspname || '.' || cl.relname AS rel, l.mode
                 FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
                WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')`;
async function locks(c: Client): Promise<Set<string>> {
  return new Set((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`));
}
async function novasTravas(c: Client, antes: Set<string>): Promise<string[]> {
  return [...(await locks(c))].filter((k) => !antes.has(k)).sort();
}

/** Insumo (preco 1) + card interno com grade {40|M: 4, 38|P: 4} (total 8) e o insumo no BOM (consumo 2); opcionalmente cortado. */
async function cenario(c: Client) {
  const s = suf();
  const etq = async (vinculo: string | null) =>
    (await um<{ id: string }>(c, `INSERT INTO etiquetas (tenant_id, nome, preco, tamanho_vinculado) VALUES ($1, $2, 1, $3) RETURNING id`,
      [T, `URG-A1G ${vinculo ?? "livre"} ${s}`, vinculo])).id;
  const vinc = await etq("40|M");
  const livre = await etq(null);
  const card = async (insumo: string, cortado: boolean, origem = "interno") => {
    const m = (await um<{ id: string }>(c, `INSERT INTO modelos (tenant_id, nome, origem) VALUES ($1, $2, $3) RETURNING id`,
      [T, `URG-A1G card ${suf()}`, origem])).id;
    await c.query(`INSERT INTO modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, 1, '{"40|M": 4, "38|P": 4}'::jsonb, 8)`, [m]);
    await c.query(`INSERT INTO modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, consumo) VALUES ($1, $2, $3, 2)`, [T, m, insumo]);
    if (cortado) await c.query(`INSERT INTO cad (tenant_id, modelo_id, enviado_corte) VALUES ($1, $2, true)`, [T, m]);
    return m;
  };
  return { vinc, livre, card };
}
async function custoLinha(c: Client, m: string): Promise<number> {
  return Number((await um<{ v: string }>(c, `SELECT custo_previsto AS v FROM modelo_etiquetas WHERE modelo_id = $1`, [m])).v);
}

describe.skipIf(!RODA)("urg R1 T4 — fila do custo ao mudar a GRADE (172000)", () => {
  it("o bloco 172000 existe: funcao NOVA (depois + neutro), _down volta (neutraliza), _down_drop separado (gerado por mig/gerar-a1.mjs)", () => {
    const b = bloco();
    expect(b).toBeTruthy();
    expect(b!.volta).toBe(true);
    expect(b!.sentinela).toBe(FN);
    expect(b!.MD5).toEqual({});
    expect(Object.keys(b!.NOVAS)).toEqual([FN]);
    expect(b!.NOVAS[FN]).toMatch(/^[0-9a-f]{32}$/);
    expect(b!.NEUTRO?.[FN]).toMatch(/^[0-9a-f]{32}$/);
    expect(b!.NEUTRO?.[FN]).not.toBe(b!.NOVAS[FN]);
    expect(b!.drop).toMatch(/_down_drop\.sql$/);
  });

  it("aplicada: funcao DEFINER/search_path/EXECUTE revogado; 3 gatilhos AFTER de STATEMENT com transicao (um por evento); 2x nao muda; _down neutraliza (gatilhos ficam); reaplica", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await semBloco(c);
      expect(await md5Fn(c, FN)).toBeNull();
      expect(await gatilhos(c)).toEqual([]);
      await aplicaUrgA(c, "172000");
      expect(await md5Fn(c, FN)).toBe(b!.NOVAS[FN]);
      const meta = await um(c,
        `SELECT p.prosecdef AS sd, array_to_string(p.proconfig, '|') AS cfg, p.provolatile::text AS vol, coalesce(p.proacl::text, '') AS acl,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0) AS pub
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [FN]);
      expect(meta).toEqual({ sd: true, cfg: "search_path=public", vol: "v", acl: "{postgres=X/postgres,service_role=X/postgres}",
        anon: false, auth: false, pub: false });
      const esperado = GATILHOS.map(([nome, ev, velha, nova]) => ({
        nome, ev, por_linha: false, before: false, eventos: { INSERT: 4, DELETE: 8, UPDATE: 16 }[ev], velha, nova, hab: "O", nattr: 0,
        sem_when: true, fn: true,
      }));
      expect(await gatilhos(c)).toEqual(esperado);
      await aplicarArquivo(c, b!.mig);
      await aplicarArquivo(c, b!.mig);
      await zera(c);
      expect(await md5Fn(c, FN)).toBe(b!.NOVAS[FN]);
      expect(await gatilhos(c)).toEqual(esperado);
      await aplicarArquivo(c, b!.down);
      await aplicarArquivo(c, b!.down); // idempotente
      await zera(c);
      expect(await md5Fn(c, FN)).toBe(b!.NEUTRO![FN]);
      expect(await urgAViva(c, "172000")).toBe(false);
      expect(await gatilhos(c)).toEqual(esperado); // ficam, inertes
      const neutra = await um<{ src: string; anon: boolean; auth: boolean }>(c,
        `SELECT p.prosrc AS src, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [FN]);
      expect([neutra.anon, neutra.auth]).toEqual([false, false]);
      // o texto neutro nao cita a coluna nem os helpers da 170000 (o _down_drop dela varre o prosrc)
      expect(neutra.src).not.toMatch(/tamanho_vinculado|_insumo_|_grade_mapa_/);
      await aplicarArquivo(c, b!.mig); // re-aplicar depois da volta
      await zera(c);
      expect(await md5Fn(c, FN)).toBe(b!.NOVAS[FN]);
      expect(await gatilhos(c)).toEqual(esperado);
    });
  });

  it("guarda: funcao com texto inesperado = P0001 na ida e no _down; _down_drop recusa com a funcao viva; gatilho de mesmo nome em outra funcao recusa", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgA(c, "172000");
      await c.query(`SAVEPOINT s`);
      await c.query(`CREATE OR REPLACE FUNCTION public.fn_custo_fila_grade() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
                     SET search_path TO 'public' AS $f$ BEGIN RETURN NULL; END $f$`);
      await expect(aplicarArquivo(c, b!.mig)).rejects.toThrow(/urg_r1_172000: .*fn_custo_fila_grade/);
      await expect(aplicarArquivo(c, b!.down)).rejects.toThrow(/urg_r1_172000_down: .*fn_custo_fila_grade/);
      await expect(aplicarArquivo(c, b!.drop)).rejects.toThrow(/urg_r1_172000_down_drop: .*fn_custo_fila_grade/);
      await c.query(`ROLLBACK TO SAVEPOINT s`);
      await expect(aplicarArquivo(c, b!.drop)).rejects.toThrow(/urg_r1_172000_down_drop: .*neutro/);
      await c.query(`ROLLBACK TO SAVEPOINT s`);
      await c.query(`CREATE OR REPLACE TRIGGER trg_custo_fila_grade_ins AFTER INSERT ON public.modelo_grades
                     REFERENCING NEW TABLE AS novas FOR EACH STATEMENT EXECUTE FUNCTION public.fn_kanban_fila_por_modelo()`);
      await expect(aplicarArquivo(c, b!.mig)).rejects.toThrow(/urg_r1_172000: .*trg_custo_fila_grade_ins/);
      await c.query(`ROLLBACK TO SAVEPOINT s`);
      expect(await md5Fn(c, FN)).toBe(b!.NOVAS[FN]);
    });
  });

  it("fila: mudar a grade enfileira SO o card interno NAO cortado com insumo vinculado; custo vai ao fator novo; sem mudanca/sem vinculo/cortado/revenda/app.custo_sistema = nada", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "172000");
      const { vinc, livre, card } = await cenario(c);
      const A = await card(vinc, false); // interno + vinculado
      const B = await card(livre, false); // interno sem vinculo
      const C = await card(vinc, true); // interno + vinculado, CORTADO
      const R = await card(vinc, false, "revenda"); // revenda (o previsto vem de outro ramo)
      const todos = [A, B, C, R];
      await imediato(c);
      expect(await fila(c)).toEqual([]);
      expect([await custoLinha(c, A), await custoLinha(c, B), await custoLinha(c, C)]).toEqual([1, 2, 1]); // 1 x 2 x 4/8; livre cheio

      await c.query(`UPDATE modelo_grades SET grades = '{"40|M": 6, "38|P": 2}'::jsonb WHERE modelo_id = ANY ($1::uuid[])`, [todos]);
      expect(await fila(c)).toEqual([A]);
      await imediato(c);
      expect([await custoLinha(c, A), await custoLinha(c, B), await custoLinha(c, C)]).toEqual([1.5, 2, 1]); // C congelado

      // UPDATE sem mudanca de verdade: nada
      await c.query(`UPDATE modelo_grades SET grades = grades, grade_total = grade_total WHERE modelo_id = ANY ($1::uuid[])`, [todos]);
      expect(await fila(c)).toEqual([]);
      // so o total muda: enfileira (o fator divide pelo total)
      await c.query(`UPDATE modelo_grades SET grade_total = 12 WHERE modelo_id = $1`, [A]);
      expect(await fila(c)).toEqual([A]);
      await imediato(c);
      expect(await custoLinha(c, A)).toBe(1); // 2 x 6/12

      // DELETE (grade vazia => fator 1) e INSERT
      await c.query(`DELETE FROM modelo_grades WHERE modelo_id = ANY ($1::uuid[])`, [todos]);
      expect(await fila(c)).toEqual([A]);
      await imediato(c);
      expect(await custoLinha(c, A)).toBe(2);
      await c.query(`INSERT INTO modelo_grades (modelo_id, variante_numero, grades, grade_total)
                     SELECT x, 1, '{"40|M": 2, "38|P": 6}'::jsonb, 8 FROM unnest($1::uuid[]) x`, [todos]);
      expect(await fila(c)).toEqual([A]);
      await imediato(c);
      expect([await custoLinha(c, A), await custoLinha(c, C)]).toEqual([0.5, 1]);

      // como o Salvar do Sheet: DELETE + 1 INSERT por variante, mesma grade — o card nao cortado entra 1x; o cortado nunca
      for (const m of [A, B, C, R]) {
        await c.query(`DELETE FROM modelo_grades WHERE modelo_id = $1`, [m]);
        await c.query(`INSERT INTO modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, 1, '{"40|M": 2}'::jsonb, 2)`, [m]);
        await c.query(`INSERT INTO modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, 2, '{"38|P": 6}'::jsonb, 6)`, [m]);
      }
      expect(await fila(c)).toEqual([A]);
      await imediato(c);
      expect([await custoLinha(c, A), await custoLinha(c, C)]).toEqual([0.5, 1]);

      // o proprio aplicador escrevendo (app.custo_sistema = on): nada
      await c.query(`SELECT set_config('app.custo_sistema', 'on', true)`);
      await c.query(`UPDATE modelo_grades SET grades = '{"40|M": 8}'::jsonb WHERE modelo_id = $1 AND variante_numero = 1`, [A]);
      expect(await fila(c)).toEqual([]);
      await c.query(`SELECT set_config('app.custo_sistema', '', true)`);

      // vinculo limpo (fila do preco ja recalcula) => a grade deixa de enfileirar
      await c.query(`UPDATE etiquetas SET tamanho_vinculado = NULL WHERE id = $1`, [vinc]);
      await imediato(c);
      await c.query(`UPDATE modelo_grades SET grades = '{"40|M": 3}'::jsonb WHERE modelo_id = $1 AND variante_numero = 1`, [A]);
      expect(await fila(c)).toEqual([]);
    });
  });

  it("caminho real: salvar_cad_completo (Sheet) com grade nova enfileira o card e o custo do insumo vinculado vai ao fator novo", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "172000");
      const { vinc, card } = await cenario(c);
      const A = await card(vinc, false);
      await c.query(`UPDATE public.modelos SET ordem_criacao_enviada = true WHERE id = $1`, [A]);
      await imediato(c);
      expect(await fila(c)).toEqual([]);
      await comoUsuario(c);
      // Tecido 1 com 2 variantes (ordem 1 e 2): sem ele o Salvar poda a grade inteira (_poda_variantes_cad), como na tela
      const artigo = await c.query(
        `SELECT vt.artigo_id AS id FROM variantes_tecido vt JOIN artigos a ON a.id = vt.artigo_id AND a.tenant_id = $1
          GROUP BY vt.artigo_id HAVING count(*) >= 2 ORDER BY 1 LIMIT 1`, [T]);
      expect(artigo.rows.length).toBe(1);
      const vars = (await c.query(`SELECT id FROM variantes_tecido WHERE artigo_id = $1 ORDER BY id LIMIT 2`, [artigo.rows[0].id]))
        .rows.map((r) => r.id as string);
      const tecidos = [{ artigo_id: artigo.rows[0].id, numero: 1, tipo: "tecido",
        variantes: [{ variante_tecido_id: vars[0], ordem: 1 }, { variante_tecido_id: vars[1], ordem: 2 }] }];
      const salva = async (grades: unknown[]) =>
        c.query(`SELECT salvar_cad_completo($1, $2::jsonb, $3::jsonb, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, NULL, NULL)`,
          [A, JSON.stringify(tecidos), JSON.stringify(grades)]);
      await salva([{ variante_numero: 1, grades: { "40|M": 3, "38|P": 1 }, grade_total: 4 }]);
      expect(await fila(c)).toEqual([A]);
      await imediato(c);
      expect(await custoLinha(c, A)).toBe(1.5); // 2 x 3/4
      // mesmo Salvar, mesma grade: o card entra de novo (DELETE+INSERT) e o valor nao muda
      await salva([{ variante_numero: 1, grades: { "40|M": 3, "38|P": 1 }, grade_total: 4 }]);
      expect(await fila(c)).toEqual([A]);
      await imediato(c);
      expect(await custoLinha(c, A)).toBe(1.5);
      await salva([{ variante_numero: 1, grades: { "40|M": 1, "38|P": 3 }, grade_total: 4 }, { variante_numero: 2, grades: { "38|P": 4 }, grade_total: 4 }]);
      expect(await fila(c)).toEqual([A]);
      await imediato(c);
      expect(await custoLinha(c, A)).toBe(0.25); // 2 x 1/8
    });
  });

  it("tempestade? maior loja da copia, com os vinculos legados ligados: cada Salvar (DELETE+INSERT da grade) enfileira no MAXIMO o proprio card; cortado nunca", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '300s'");
      await aplicaUrgA(c, "172000");
      const loja = (await um<{ id: string; nome: string; n: string }>(c,
        `SELECT t.id, t.nome, count(*) AS n FROM public.modelos m JOIN public.tenants t ON t.id = m.tenant_id GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 1`));
      // liga os vinculos legados elegiveis (T2b) SEM enfileirar (app.custo_sistema = on), so para medir o gatilho da grade
      await c.query(`SELECT set_config('app.custo_sistema', 'on', true)`);
      await c.query(`UPDATE public.etiquetas e SET tamanho_vinculado = l.valor
                       FROM public._urg_r1_tamanho_legado_lista() l WHERE l.elegivel AND e.id = l.etiqueta_id`);
      await c.query(`SELECT set_config('app.custo_sistema', '', true)`);
      expect(await fila(c)).toEqual([]);
      // 1 card cortado com insumo vinculado (na copia nenhum esta): o Salvar dele nao pode enfileirar
      const cortar = await c.query(
        `SELECT m.id FROM public.modelos m
          WHERE m.tenant_id = $1 AND m.origem = 'interno'
            AND EXISTS (SELECT 1 FROM public.modelo_grades g WHERE g.modelo_id = m.id)
            AND EXISTS (SELECT 1 FROM public.modelo_etiquetas me JOIN public.etiquetas e ON e.id = me.etiqueta_id
                         WHERE me.modelo_id = m.id AND e.tamanho_vinculado IS NOT NULL)
          ORDER BY m.id LIMIT 1`, [loja.id]);
      expect(cortar.rows.length).toBe(1);
      const cortado = cortar.rows[0].id as string;
      await c.query(`SELECT set_config('app.custo_sistema', 'on', true)`);
      const temCad = await c.query(`UPDATE public.cad SET enviado_corte = true WHERE modelo_id = $1 RETURNING id`, [cortado]);
      if (!temCad.rows.length) await c.query(`INSERT INTO public.cad (tenant_id, modelo_id, enviado_corte) VALUES ($1, $2, true)`, [loja.id, cortado]);
      await c.query(`SELECT set_config('app.custo_sistema', '', true)`);
      await c.query(`DELETE FROM public.custo_recalculo_fila`); // o corte pode ter enfileirado; aqui so interessa o gatilho da grade
      const esperado = (await c.query(
        `SELECT m.id FROM public.modelos m
          WHERE m.tenant_id = $1 AND m.origem = 'interno'
            AND EXISTS (SELECT 1 FROM public.modelo_grades g WHERE g.modelo_id = m.id)
            AND EXISTS (SELECT 1 FROM public.modelo_etiquetas me JOIN public.etiquetas e ON e.id = me.etiqueta_id
                         WHERE me.modelo_id = m.id AND nullif(btrim(e.tamanho_vinculado), '') IS NOT NULL)
            AND NOT EXISTS (SELECT 1 FROM public.cad cd WHERE cd.modelo_id = m.id AND cd.enviado_corte)
          ORDER BY m.id`, [loja.id])).rows.map((r) => r.id as string);
      const cards = (await c.query(
        `SELECT DISTINCT g.modelo_id AS id FROM public.modelo_grades g JOIN public.modelos m ON m.id = g.modelo_id
          WHERE m.tenant_id = $1 ORDER BY 1`, [loja.id])).rows.map((r) => r.id as string);
      let maxPorSalvar = 0;
      let ms = 0;
      for (const m of cards) {
        const antes = (await fila(c)).length;
        const t0 = performance.now();
        // como o Salvar do Sheet: apaga e reinsere a grade, 1 INSERT por variante
        const { rows } = await c.query(`DELETE FROM public.modelo_grades WHERE modelo_id = $1 RETURNING variante_numero, grades, grade_total`, [m]);
        for (const r of rows) {
          await c.query(`INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, $2, $3::jsonb, $4)`,
            [m, r.variante_numero, JSON.stringify(r.grades), r.grade_total]);
        }
        ms += performance.now() - t0;
        maxPorSalvar = Math.max(maxPorSalvar, (await fila(c)).length - antes);
      }
      const f = await fila(c);
      expect(maxPorSalvar).toBeLessThanOrEqual(1);
      expect(f).toEqual(esperado);
      expect(f).not.toContain(cortado);
      expect(f.length).toBeGreaterThan(0);
      console.log(`[urg-a1-fila-grade] loja ${loja.nome}: ${loja.n} modelos, ${cards.length} com grade; Salvar de TODOS -> ${f.length} na fila ` +
        `(max ${maxPorSalvar} por Salvar; cortado pulado); ${(ms / cards.length).toFixed(2)} ms por Salvar (DELETE+INSERTs, com os gatilhos)`);
    });
  }, 600_000);

  it("travas (por DIFERENCA): ida = ShareRowExclusive SO em modelo_grades (nada em auth/storage/realtime), tambem ao reaplicar; _down = nenhuma; _down_drop medido", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    // R6: so as travas NOVAS contam. Se a txn ja segura a ShareRowExclusive de modelo_grades (gancho URG_A_TXN, ou o bloco aplicado
    // nesta mesma txn porque a copia ainda nao o tem), a medicao nao e possivel aqui: registra e segue (a copia com a 172000 mede).
    const SRE = "public.modelo_grades|ShareRowExclusiveLock";
    await withTx(async (c) => {
      await semBloco(c);
      const antes = await locks(c);
      await aplicarArquivo(c, b!.mig);
      await zera(c);
      const ida = await novasTravas(c, antes);
      expect(ida.filter((k) => /^(auth|storage|realtime)\./.test(k))).toEqual([]);
      const fortes = ida.filter((k) => !k.startsWith("information_schema.") && !k.endsWith("|AccessShareLock"));
      if (antes.has(SRE)) {
        expect(fortes).toEqual([]);
        console.log("[urg-a1-fila-grade] travas da ida: txn ja segurava a ShareRowExclusive (gancho) - medicao na copia");
      } else {
        expect(fortes).toEqual([SRE]);
        console.log(`[urg-a1-fila-grade] travas da ida: ${ida.join(", ")}`);
      }
    });
    await withTx(async (c) => {
      await aplicaUrgA(c, "172000"); // reaplicar com os gatilhos ja existentes (CREATE OR REPLACE TRIGGER)
      const antes = await locks(c);
      await aplicarArquivo(c, b!.mig);
      await zera(c);
      const re = await novasTravas(c, antes);
      expect(re.filter((k) => /^(auth|storage|realtime)\./.test(k))).toEqual([]);
      const fortes = re.filter((k) => !k.startsWith("information_schema.") && !k.endsWith("|AccessShareLock"));
      if (antes.has(SRE)) {
        expect(fortes).toEqual([]);
        console.log("[urg-a1-fila-grade] travas ao reaplicar: o bloco foi aplicado nesta txn - medicao so com a 172000 na copia");
      } else {
        expect(fortes).toEqual([SRE]);
        console.log(`[urg-a1-fila-grade] travas ao reaplicar: ${re.join(", ")}`);
      }
    });
    await withTx(async (c) => {
      await aplicaUrgA(c, "172000");
      let antes = await locks(c);
      await aplicarArquivo(c, b!.down);
      await zera(c);
      expect(await novasTravas(c, antes)).toEqual([]);
      antes = await locks(c);
      await aplicarArquivo(c, b!.drop);
      await zera(c);
      const drop = await novasTravas(c, antes);
      expect(drop).toContain("public.modelo_grades|AccessExclusiveLock");
      expect(drop.filter((k) => !/^(public\.modelo_grades|auth\.|storage\.|realtime\.|information_schema\.)/.test(k))).toEqual([]);
      console.log(`[urg-a1-fila-grade] travas do _down_drop (${drop.length}): ${drop.join(", ")}`);
    });
  });

  it("_down_drop: com a funcao NEUTRA apaga os 3 gatilhos e a funcao; idempotente; a ida recria tudo", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgA(c, "172000");
      await aplicarArquivo(c, b!.down);
      await aplicarArquivo(c, b!.drop);
      await aplicarArquivo(c, b!.drop); // idempotente
      await zera(c);
      expect(await md5Fn(c, FN)).toBeNull();
      expect(await gatilhos(c)).toEqual([]);
      await aplicarArquivo(c, b!.mig);
      await zera(c);
      expect(await md5Fn(c, FN)).toBe(b!.NOVAS[FN]);
      expect((await gatilhos(c)).map((g) => g.nome)).toEqual(GATILHOS.map((g) => g[0]));
    });
  });
});
