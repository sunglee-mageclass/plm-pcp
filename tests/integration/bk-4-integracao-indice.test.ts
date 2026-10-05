// Frente Backend B4 — índice único parcial da Integração (desenho item 19; A2 review M1). Plano:
// .superpowers/sdd/2026-10-05-backend/plan.md §4 B4 (+ §0 K9). Migration À MÃO 20261103143000_bk_integracao_produto_unico (objeto
// novo): `integracao_linhas_produto_unico ON integracao_linhas (modelo_id) WHERE tipo = 'produto'` — 1 linha 'produto' por card (a
// API falha fechado se um produto não tiver EXATAMENTE 1). `_down` = no-op documentado; `_down_drop` = DROP INDEX (opcional).
// Cada caso em transação revertida (withTx) e SÓ na cópia local: migration/inversos aplicados DENTRO da txn (mig-txn/bk-helpers,
// nunca \i). Funciona nos 2 estados da cópia (com ou sem o índice já aplicado de verdade): quando o caso precisa do índice
// AUSENTE, o `_down_drop` roda dentro da txn (AccessExclusive em integracao_linhas até o ROLLBACK — só na cópia).
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, comoUsuario, dbUrl } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { aplicaBk, bkViva, voltaBk } from "./bk-helpers";
import { keywordsLoja, modeloInterno, T, U } from "./integracao-helpers";
import { mensagemErro, TEXTO_INTEGRACAO_PRODUTO_DUPLICADO } from "../../src/lib/erro-mensagem";

const RODA = hasDb && ehBancoLocal();
const MIG = "supabase/migrations/20261103143000_bk_integracao_produto_unico.sql";
const DOWN = "supabase/rollback/20261103143000_bk_integracao_produto_unico_down.sql";
const DROP = "supabase/rollback/20261103143000_bk_integracao_produto_unico_down_drop.sql";
const IDX = "integracao_linhas_produto_unico";
const DEF =
  "CREATE UNIQUE INDEX integracao_linhas_produto_unico ON public.integracao_linhas USING btree (modelo_id) WHERE (tipo = 'produto'::text)";

/** Formas (só o que o teste lê) das respostas JSON das RPCs da Integração. */
type ProdutoLido = { modelo_id: string; assinatura: string; linhas: { tipo: string }[] };
type Leitura = { status?: string; acesso_id: string; chave_id?: string; produtos: ProdutoLido[] };
type Confirmacao = { status?: string; novos?: number; confirmados: { modelo_id: string }[] };

type Res =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; code: string; msg: string; constraint?: string };
/** Roda `sql` num SAVEPOINT; erro volta ao savepoint (a txn segue usável). */
async function tenta(c: Client, sql: string, params: unknown[] = []): Promise<Res> {
  await c.query("SAVEPOINT bk4");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT bk4");
    return { ok: true, rows: r.rows };
  } catch (e) {
    const er = e as { code?: string; message?: string; constraint?: string };
    await c.query("ROLLBACK TO SAVEPOINT bk4");
    await c.query("RELEASE SAVEPOINT bk4");
    return {
      ok: false,
      code: String(er.code ?? ""),
      msg: String(er.message ?? ""),
      constraint: er.constraint,
    };
  }
}
/** aplicarArquivo que devolve "PASSOU" ou "<code> <message>" (o aplicarArquivo já volta ao savepoint dele). */
async function aplica(c: Client, rel: string): Promise<string> {
  try {
    await aplicarArquivo(c, rel);
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    return `${er.code} ${er.message}`;
  } finally {
    // as migrations fazem SET LOCAL transaction_timeout (valeria para a txn INTEIRA do teste)
    await c.query("SET LOCAL transaction_timeout = 0");
    await c.query("SET LOCAL lock_timeout = '3s'");
  }
}
async function defVivo(c: Client): Promise<string | null> {
  return (
    await um<{ d: string | null }>(
      c,
      `SELECT (SELECT pg_get_indexdef(i.indexrelid) FROM pg_index i WHERE i.indexrelid = to_regclass('public.${IDX}')) AS d`,
    )
  ).d;
}
async function valido(c: Client): Promise<boolean> {
  return (
    await um<{ v: boolean }>(
      c,
      `SELECT EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.${IDX}')
                AND indrelid = 'public.integracao_linhas'::regclass AND indisunique AND indisvalid AND indisready) AS v`,
    )
  ).v;
}
/** Índice ausente NESTA txn (se vivo, `_down_drop` dentro da txn). */
async function semIndice(c: Client): Promise<void> {
  if ((await defVivo(c)) !== null) expect(await aplica(c, DROP)).toBe("PASSOU");
  expect(await defVivo(c)).toBeNull();
}
async function marcar(c: Client, id: string): Promise<unknown> {
  const a = (
    await um<{ r: { produtos: ProdutoLido[] } }>(
      c,
      `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`,
      [id],
    )
  ).r.produtos[0].assinatura;
  return (
    await um<{ r: unknown }>(
      c,
      `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text))) AS r`,
      [id, a],
    )
  ).r;
}
async function linhas(c: Client, id: string): Promise<{ produto: number; variante: number }> {
  return um(
    c,
    `SELECT count(*) FILTER (WHERE tipo = 'produto')::int AS produto, count(*) FILTER (WHERE tipo = 'variante')::int AS variante
       FROM public.integracao_linhas WHERE modelo_id = $1`,
    [id],
  );
}
async function estado(c: Client, id: string): Promise<string | null> {
  return (
    (await c.query(`SELECT estado FROM public.integracao_produtos WHERE modelo_id = $1`, [id]))
      .rows[0]?.estado ?? null
  );
}
/** 2ª linha 'produto' do card (cópia da 1ª, ordem 99) — como postgres. */
const SQL_DUPLICA = `INSERT INTO public.integracao_linhas (tenant_id, loja_nome, modelo_id, tipo, ordem, nome)
  SELECT tenant_id, loja_nome, modelo_id, 'produto', 99, nome FROM public.integracao_linhas WHERE modelo_id = $1 AND tipo = 'produto'`;

async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaBk(c, "B4"); // idempotente (cópia já com o índice, ou BK_TXN=1: pula)
  expect(await bkViva(c, "B4")).toBe(true);
  await comoUsuario(c, U); // super admin da Loja Teste
  await keywordsLoja(c, "k");
}

describe.skipIf(!RODA)("Backend B4 — índice único parcial integracao_linhas_produto_unico", () => {
  it("2ª linha 'produto' do mesmo card = 23505 no índice (texto PT na tela); variantes e 'produto' de outro card passam", async () => {
    await withTx(async (c) => {
      await prepara(c);
      expect(await defVivo(c)).toBe(DEF);
      expect(await valido(c)).toBe(true);
      const a = await modeloInterno(c);
      const b = await modeloInterno(c);
      expect(await marcar(c, a.id)).toEqual({ marcados: 1 });
      expect(await marcar(c, b.id)).toEqual({ marcados: 1 });
      expect(await linhas(c, a.id)).toEqual({ produto: 1, variante: 2 });
      expect(await linhas(c, b.id)).toEqual({ produto: 1, variante: 2 });
      const r = await tenta(c, SQL_DUPLICA, [a.id]);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe("23505");
      expect(r.constraint).toBe(IDX);
      expect(r.msg).toBe(`duplicate key value violates unique constraint "${IDX}"`);
      // a tela recebe {code, message} do PostgREST: texto próprio em PT
      expect(mensagemErro({ code: r.code, message: r.msg }, "fb")).toBe(
        TEXTO_INTEGRACAO_PRODUTO_DUPLICADO,
      );
      // UPDATE que vira uma variante do card em 2ª 'produto' também é recusado
      const u = await tenta(
        c,
        `UPDATE public.integracao_linhas SET tipo = 'produto' WHERE modelo_id = $1 AND tipo = 'variante' AND ordem = 1`,
        [a.id],
      );
      expect(u.ok ? "PASSOU" : `${u.code} ${u.constraint}`).toBe(`23505 ${IDX}`);
      // o índice é PARCIAL: mais variantes do mesmo card passam
      const v = await tenta(
        c,
        `INSERT INTO public.integracao_linhas (tenant_id, loja_nome, modelo_id, tipo, ordem, nome)
         SELECT tenant_id, loja_nome, modelo_id, 'variante', 98, nome FROM public.integracao_linhas WHERE modelo_id = $1 AND tipo = 'produto'`,
        [a.id],
      );
      expect(v.ok ? "PASSOU" : `${v.code} ${v.msg}`).toBe("PASSOU");
      expect(await linhas(c, a.id)).toEqual({ produto: 1, variante: 3 });
      expect(await linhas(c, b.id)).toEqual({ produto: 1, variante: 2 });
    });
  });

  it("fluxos da Integração com o índice: marcar → voltar → marcar; Gerar JSON (ler/confirmar) → desfazer → marcar; API ler/confirmar", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modeloInterno(c);
      // marcar → voltar → marcar de novo (o espelho é apagado e refeito: sempre 1 'produto')
      expect(await marcar(c, m.id)).toEqual({ marcados: 1 });
      expect(await linhas(c, m.id)).toEqual({ produto: 1, variante: 2 });
      expect(
        (
          await um<{ r: unknown }>(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid]) AS r`, [
            m.id,
          ])
        ).r,
      ).toEqual({ voltaram: 1 });
      expect(await linhas(c, m.id)).toEqual({ produto: 0, variante: 0 });
      expect(await marcar(c, m.id)).toEqual({ marcados: 1 });
      expect(await linhas(c, m.id)).toEqual({ produto: 1, variante: 2 });
      // Gerar JSON: ler → confirmar (integrado; UPDATE integrado_em nas linhas)
      const g = (
        await um<{ r: Leitura }>(
          c,
          `SELECT public.integracao_gerar_json_ler($1::uuid[], $2::uuid) AS r`,
          [[m.id], T],
        )
      ).r;
      expect(g.produtos.map((p) => p.modelo_id)).toEqual([m.id]);
      const entregaG = {
        produtos: g.produtos.map((p) => ({ modelo_id: p.modelo_id, assinatura: p.assinatura })),
        fotos_descartadas: 0,
        fotos_ausentes: 0,
      };
      const cg = (
        await um<{ r: Confirmacao }>(
          c,
          `SELECT public.integracao_gerar_json_confirmar($1::uuid, $2::jsonb) AS r`,
          [g.acesso_id, JSON.stringify(entregaG)],
        )
      ).r;
      expect(cg.novos).toBe(1);
      expect(await estado(c, m.id)).toBe("integrado");
      expect(
        (
          await um<{ n: number }>(
            c,
            `SELECT count(*)::int AS n FROM public.integracao_linhas WHERE modelo_id = $1 AND integrado_em IS NULL`,
            [m.id],
          )
        ).n,
      ).toBe(0);
      expect(await linhas(c, m.id)).toEqual({ produto: 1, variante: 2 });
      // desfazer (super admin) → marcar de novo
      expect(
        (
          await um<{ r: unknown }>(c, `SELECT public.integracao_desfazer($1, 'teste B4') AS r`, [
            m.id,
          ])
        ).r,
      ).toEqual({ ok: true });
      expect(await linhas(c, m.id)).toEqual({ produto: 0, variante: 0 });
      expect(await estado(c, m.id)).toBe("nao_integravel");
      expect(await marcar(c, m.id)).toEqual({ marcados: 1 });
      expect(await linhas(c, m.id)).toEqual({ produto: 1, variante: 2 });
      // API (rota do Worker): _integracao_ler_loja → _integracao_confirmar (UPDATE integrado_em)
      const k = (
        await um<{ r: { chave: string } }>(c, `SELECT public.integracao_chave_criar($1) AS r`, [
          "ERP B4",
        ])
      ).r;
      const sha = (
        await um<{ h: string }>(c, `SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') AS h`, [
          k.chave,
        ])
      ).h;
      const api = (
        await um<{ r: Leitura }>(
          c,
          `SELECT public._integracao_ler_loja($1, $2::uuid, $3, $4, $5, $6, $7) AS r`,
          [sha, T, false, null, 500, "normal", "198.51.100.43-bk4"],
        )
      ).r;
      expect(api.status).toBe("ok");
      const p = api.produtos.find((x) => x.modelo_id === m.id);
      expect(p).toBeTruthy();
      // a API entrega EXATAMENTE 1 linha 'produto' por produto (é o que o índice garante)
      for (const x of api.produtos)
        expect(x.linhas.filter((l) => l.tipo === "produto")).toHaveLength(1);
      const entregaA = {
        produtos: api.produtos.map((x) => ({ modelo_id: x.modelo_id, assinatura: x.assinatura })),
        fotos_descartadas: 0,
        fotos_ausentes: 0,
      };
      const ca = (
        await um<{ r: Confirmacao }>(
          c,
          `SELECT public._integracao_confirmar($1, $2, $3::jsonb) AS r`,
          [api.chave_id, api.acesso_id, JSON.stringify(entregaA)],
        )
      ).r;
      expect(ca.status).toBe("ok");
      expect(ca.confirmados.map((x) => x.modelo_id)).toContain(m.id);
      expect(await estado(c, m.id)).toBe("integrado");
      expect(await linhas(c, m.id)).toEqual({ produto: 1, variante: 2 });
      // nenhum card da cópia (nem os desta txn) com 2 'produto'
      expect(
        (
          await um<{ n: number }>(
            c,
            `SELECT count(*)::int AS n FROM (SELECT modelo_id FROM public.integracao_linhas WHERE tipo = 'produto'
                GROUP BY modelo_id HAVING count(*) > 1) d`,
          )
        ).n,
      ).toBe(0);
    });
  });

  it("ida recusa (P0001 bk4_integracao_duplicada: N) com duplicata semeada na txn — nada muda; limpa a duplicata → cria", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const a = await modeloInterno(c);
      const b = await modeloInterno(c);
      await marcar(c, a.id);
      await marcar(c, b.id);
      await semIndice(c);
      expect((await tenta(c, SQL_DUPLICA, [a.id])).ok).toBe(true);
      expect((await tenta(c, SQL_DUPLICA, [b.id])).ok).toBe(true);
      expect(await aplica(c, MIG)).toBe(
        "P0001 bk4_integracao_duplicada: 2 cards com mais de 1 linha produto",
      );
      expect(await defVivo(c)).toBeNull();
      await c.query(
        `DELETE FROM public.integracao_linhas WHERE modelo_id = $1 AND tipo = 'produto' AND ordem = 99`,
        [b.id],
      );
      expect(await aplica(c, MIG)).toBe(
        "P0001 bk4_integracao_duplicada: 1 cards com mais de 1 linha produto",
      );
      expect(await defVivo(c)).toBeNull();
      await c.query(
        `DELETE FROM public.integracao_linhas WHERE modelo_id = $1 AND tipo = 'produto' AND ordem = 99`,
        [a.id],
      );
      expect(await aplica(c, MIG)).toBe("PASSOU");
      expect(await defVivo(c)).toBe(DEF);
      expect(await valido(c)).toBe(true);
    });
  });

  it("guarda: índice com o mesmo nome e outra definição → ida, _down e _down_drop recusam (P0001); nada muda", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await semIndice(c);
      await c.query(`CREATE UNIQUE INDEX ${IDX} ON public.integracao_linhas (modelo_id, ordem)`);
      const outro = await defVivo(c);
      expect(outro).not.toBe(DEF);
      expect(await aplica(c, MIG)).toBe(`P0001 bk4_indice_diferente: ${outro}`);
      expect(await aplica(c, DOWN)).toBe(
        `P0001 bk4_down: indice com outra definicao (${outro}) - outra frente mexeu`,
      );
      expect(await aplica(c, DROP)).toBe(
        `P0001 bk4_drop: indice com outra definicao (${outro}) - outra frente mexeu`,
      );
      expect(await defVivo(c)).toBe(outro);
    });
  });

  it("migration: travas vistas da 2ª sessão (ShareLock só em integracao_linhas), pós-condição, ida 2× / _down 2× (no-op) / _down_drop 2× / ida", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      // SEM aplicaBk("B4") antes: a ida tem de ser a 1ª coisa da txn a tocar integracao_linhas (senão o ShareLock já estaria
      // seguro e não apareceria como novo). Cópia com o índice (ou BK_TXN=1) = _down_drop antes (AccessExclusive já seguro).
      if ((await defVivo(c)) !== null) await semIndice(c);
      const pid = (await um<{ p: number }>(c, "SELECT pg_backend_pid() AS p")).p;
      // Travas vistas de FORA (2ª sessão), por OID; o nome é resolvido NESTA txn (o índice novo é invisível à 2ª sessão até o COMMIT).
      type Trava = { oid: number; mode: string };
      const b = new Client({ connectionString: dbUrl()!, ssl: false });
      await b.connect();
      const travas = async (): Promise<Trava[]> =>
        (
          await b.query(
            `SELECT l.relation::int AS oid, l.mode FROM pg_locks l
              WHERE l.pid = $1 AND l.granted AND l.locktype = 'relation'`,
            [pid],
          )
        ).rows;
      const k = (t: Trava) => `${t.oid}|${t.mode}`;
      let novas: Trava[] = [];
      let tabelaJaTravada = false;
      let ms = 0;
      try {
        const ini = await travas();
        const antes = new Set(ini.map(k));
        const oidTabela = (
          await um<{ o: number }>(c, "SELECT 'public.integracao_linhas'::regclass::oid::int AS o")
        ).o;
        tabelaJaTravada = ini.some((t) => t.oid === oidTabela);
        const t0 = performance.now();
        expect(await aplica(c, MIG)).toBe("PASSOU");
        ms = performance.now() - t0;
        novas = (await travas()).filter((t) => !antes.has(k(t)));
      } finally {
        await b.end();
      }
      const nomes = (
        await c.query(
          `SELECT x.oid::int AS oid, n.nspname AS nsp, cl.relname AS rel
             FROM unnest($1::oid[]) x(oid) LEFT JOIN pg_class cl ON cl.oid = x.oid LEFT JOIN pg_namespace n ON n.oid = cl.relnamespace`,
          [novas.map((t) => t.oid)],
        )
      ).rows as { oid: number; nsp: string | null; rel: string | null }[];
      const nome = (t: Trava) => {
        const r = nomes.find((x) => x.oid === t.oid);
        return `${r?.nsp}.${r?.rel}|${t.mode}`;
      };
      const ver = novas.map(nome).sort();
      console.log(
        `[B4 travas] ida dentro da txn em ${ms.toFixed(1)} ms (tabela já travada antes: ${tabelaJaTravada}); novas: ${ver.join(", ")}`,
      );
      expect(
        ver.filter((x) => /^(auth|storage|realtime|supabase_functions|graphql|vault)\./.test(x)),
      ).toEqual([]);
      // em public: ShareLock na tabela do espelho + AccessExclusive no PRÓPRIO índice novo (invisível aos outros até o COMMIT)
      const fortes = ver.filter((x) => x.startsWith("public.") && !x.endsWith("|AccessShareLock"));
      const esperado = [`public.${IDX}|AccessExclusiveLock`, "public.integracao_linhas|ShareLock"];
      if (tabelaJaTravada) expect(esperado).toEqual(expect.arrayContaining(fortes));
      else expect(fortes).toEqual(esperado);
      expect(ver.filter((x) => x.endsWith("|AccessExclusiveLock"))).toEqual([
        `public.${IDX}|AccessExclusiveLock`,
      ]);
      expect(
        ver.filter(
          (x) =>
            !x.startsWith("public.") && !x.startsWith("pg_catalog.") && !x.startsWith("pg_toast."),
        ),
      ).toEqual([]);
      expect(await defVivo(c)).toBe(DEF);
      expect(await valido(c)).toBe(true);
      expect(await aplica(c, MIG)).toBe("PASSOU"); // idempotente
      expect(await defVivo(c)).toBe(DEF);
      expect(await aplica(c, DOWN)).toBe("PASSOU"); // no-op: o índice fica
      expect(await aplica(c, DOWN)).toBe("PASSOU");
      expect(await defVivo(c)).toBe(DEF);
      expect(await aplica(c, DROP)).toBe("PASSOU");
      expect(await defVivo(c)).toBeNull();
      expect(await aplica(c, DROP)).toBe("PASSOU"); // já removido: nada a fazer
      expect(await aplica(c, DOWN)).toBe("PASSOU"); // _down sem o índice: só confere
      expect(await aplica(c, MIG)).toBe("PASSOU");
      expect(await defVivo(c)).toBe(DEF);
      expect(await valido(c)).toBe(true);
      // bk-helpers: o _down do B4 é no-op (downs: []) — voltaBk não tira o índice
      await voltaBk(c);
      expect(await bkViva(c, "B4")).toBe(true);
    });
  });

  it("reaplicar com o índice JÁ na cópia não pega trava em integracao_linhas (só quando a cópia tem o índice de verdade)", async () => {
    const b = new Client({ connectionString: dbUrl()!, ssl: false });
    await b.connect();
    let naCopia = false;
    try {
      naCopia = (await b.query(`SELECT to_regclass('public.${IDX}') IS NOT NULL AS v`)).rows[0]
        .v as boolean;
    } finally {
      await b.end();
    }
    if (!naCopia) {
      console.log(
        "[B4] cópia sem o índice aplicado: caso de reaplicação sem trava não se aplica nesta rodada",
      );
      return;
    }
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '60s'");
      const pid = (await um<{ p: number }>(c, "SELECT pg_backend_pid() AS p")).p;
      const s = new Client({ connectionString: dbUrl()!, ssl: false });
      await s.connect();
      try {
        const q = `SELECT l.mode FROM pg_locks l WHERE l.pid = $1 AND l.granted AND l.relation = 'public.integracao_linhas'::regclass`;
        const antes = (await s.query(q, [pid])).rows.map((r) => r.mode as string);
        expect(await aplica(c, MIG)).toBe("PASSOU");
        const depois = (await s.query(q, [pid])).rows.map((r) => r.mode as string);
        expect(depois.filter((m) => !antes.includes(m))).toEqual([]);
      } finally {
        await s.end();
      }
    });
  });

  it("lock_timeout: com escrita em voo na 2ª sessão a ida desiste em ~1,5 s (55P03, nada muda); com leitura em voo o _down_drop idem", async () => {
    // 2ª sessão abre uma txn que segura a trava ANTES da nossa txn tocar integracao_linhas.
    const s = new Client({ connectionString: dbUrl()!, ssl: false });
    await s.connect();
    try {
      const naCopia = (await s.query(`SELECT to_regclass('public.${IDX}') IS NOT NULL AS v`))
        .rows[0].v as boolean;
      await s.query("BEGIN");
      await s.query("SET LOCAL lock_timeout = '2s'");
      // ida (só dá para provar com a cópia SEM o índice): um integracao_marcar em voo = RowExclusive, que conflita com o ShareLock
      if (!naCopia && process.env.BK_TXN !== "1") {
        await s.query("LOCK TABLE public.integracao_linhas IN ROW EXCLUSIVE MODE");
        await withTx(async (c) => {
          await c.query("SET LOCAL statement_timeout = '60s'");
          expect(await defVivo(c)).toBeNull();
          const t0 = performance.now();
          const r = await aplica(c, MIG);
          const ms = performance.now() - t0;
          console.log(`[B4 lock_timeout] ida desistiu em ${ms.toFixed(0)} ms: ${r}`);
          expect(r).toMatch(/^55P03 /);
          expect(ms).toBeGreaterThan(1400);
          expect(ms).toBeLessThan(5000);
          expect(await defVivo(c)).toBeNull();
        });
        await s.query("ROLLBACK");
        await s.query("BEGIN");
      }
      // _down_drop: uma LEITURA em voo (AccessShare) já segura o DROP INDEX (AccessExclusive) — vale nos 2 estados da cópia
      await s.query("SELECT 1 FROM public.integracao_linhas LIMIT 1");
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '60s'");
        await aplicaBk(c, "B4");
        await c.query("SET LOCAL lock_timeout = '3s'");
        expect(await defVivo(c)).toBe(DEF);
        const t0 = performance.now();
        const r = await aplica(c, DROP);
        const ms = performance.now() - t0;
        console.log(`[B4 lock_timeout] _down_drop desistiu em ${ms.toFixed(0)} ms: ${r}`);
        expect(r).toMatch(/^55P03 /);
        expect(ms).toBeGreaterThan(1400);
        expect(ms).toBeLessThan(5000);
        expect(await defVivo(c)).toBe(DEF);
      });
    } finally {
      try {
        await s.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      await s.end();
    }
  });
});
