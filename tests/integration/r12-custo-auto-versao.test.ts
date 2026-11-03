/**
 * R12 (Onda 3) - Aprovar o custo automaticamente quando a versao nao ficar mais cara (toggle por loja).
 * Migration 20261106100000_r12_custo_auto_por_versao (brief: .superpowers/sdd/2026-11-03-r12/r12-banco-brief.md).
 *
 * SO na copia local (DATABASE_URL local, porta 54422), txn revertida (withTx): NADA e gravado. A migration precisa estar
 * APLICADA na copia (psql -v ON_ERROR_STOP=1 -f); sem ela a suite se auto-pula (nenhum DDL aqui - nunca \i em txn de teste).
 *   (a) toggle OFF = regra de hoje (M.O.)               (e) ordem dos gatilhos BEFORE + "no MESMO UPDATE"
 *   (b) toggle ON, custo <= anterior, M.O. so pendente   (f) versao 1 / sem anterior / custo NULL / loja isolada
 *   (c) toggle ON + M.O. REPROVADA                       (g) ACL dos helpers (REVOKE dos 3)
 *   (d) custo > anterior -> baixa -> libera -> sobe -> volta  (h) salvar_config_loja (coluna nova, CAS por coluna)
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, withTx as withTxBase, comoUsuario, um, dbUrl, ehBancoLocal, TENANT_TESTE } from "./db";

const T = TENANT_TESTE;
const COL = "aprovar_custo_auto_por_versao";

async function aplicada(): Promise<boolean> {
  if (!hasDb || !ehBancoLocal()) return false;
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    return (await c.query("SELECT to_regprocedure('public._mo_custo_auto_liberado(uuid)') IS NOT NULL AS ok")).rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const NA_COPIA = await aplicada();
const PRONTO = hasDb && ehBancoLocal() && NA_COPIA;

// ───────────────────────────────────────── helpers ─────────────────────────────────────────
/** Txn revertida COMO o usuario da loja de teste (aprovar/reprovar M.O. exige a permissao dele; o servidor tambem o enxerga). */
async function withTx(fn: (c: Client) => Promise<void>): Promise<void> {
  await withTxBase(async (c) => {
    await comoUsuario(c);
    await fn(c);
  });
}
async function setToggle(c: Client, on: boolean, tenant: string = T): Promise<void> {
  const r = await c.query(`UPDATE public.tenant_config SET ${COL} = $1 WHERE tenant_id = $2`, [on, tenant]);
  expect(r.rowCount, "a loja de teste precisa de tenant_config").toBe(1);
}

/** Roda como o SERVIDOR escreve custo_peca_previsto (GUC do processador de custo) e fecha a porta depois. */
async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query("SELECT set_config('app.custo_sistema', 'on', true)");
  try {
    return await fn();
  } finally {
    await c.query("SELECT set_config('app.custo_sistema', '', true)");
  }
}

let seq = 0;
async function novoModelo(
  c: Client,
  o: { versao?: number; base?: string | null; custo?: number | null; tenant?: string } = {},
): Promise<string> {
  const id = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelos (tenant_id, nome, versao, modelo_base_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [o.tenant ?? T, `R12 modelo ${++seq} ${Math.random().toString(36).slice(2, 8)}`, o.versao ?? 1, o.base ?? null],
    )
  ).id;
  if (o.custo !== undefined) await setCusto(c, id, o.custo);
  return id;
}
/** UPDATE de custo como o servidor (processador); devolve o flag que o MESMO UPDATE gravou. */
async function setCusto(c: Client, id: string, custo: number | null): Promise<boolean | null> {
  return comoSistema(c, async () => {
    const r = await c.query(
      `UPDATE public.modelos SET custo_peca_previsto = $2 WHERE id = $1 RETURNING custo_terceirizados_aprovado AS f`,
      [id, custo],
    );
    return r.rows[0].f as boolean | null;
  });
}
async function flag(c: Client, id: string): Promise<boolean | null> {
  return (await um<{ f: boolean | null }>(c, `SELECT custo_terceirizados_aprovado AS f FROM public.modelos WHERE id = $1`, [id])).f;
}
/** 1 linha de M.O. (serviço novo) no estado dado: true = aprovada, false = reprovada, null = pendente. */
async function addMo(c: Client, modeloId: string, aprovado: boolean | null): Promise<string> {
  const cat = await um<{ id: string }>(
    c,
    `INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa) VALUES ($1, $2, 'ate_costura') RETURNING id`,
    [T, `Serv R12 ${++seq} ${Math.random().toString(36).slice(2, 8)}`],
  );
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, aprovado)
       VALUES ($1, $2, $3, 10, $4) RETURNING id`,
      [T, modeloId, cat.id, aprovado],
    )
  ).id;
}
/** Família v1 (anterior) + v2 com os custos dados. Toggle LIGADO por padrão da chamada. */
async function familia(c: Client, custoV1: number | null, custoV2: number | null, toggle = true) {
  await setToggle(c, toggle);
  const v1 = await novoModelo(c, { versao: 1, custo: custoV1 });
  const v2 = await novoModelo(c, { versao: 2, base: v1, custo: custoV2 });
  return { v1, v2 };
}
/** Servico_aprovado do kanban (o avaliador SQL único) para o card (a txn ja roda como o usuario da loja). */
async function kanbanServicoAprovado(c: Client, id: string): Promise<boolean> {
  const r = await um<{ v: boolean }>(
    c,
    `SELECT (public.avaliar_condicoes_kanban(array[$1::uuid]) -> $1::text ->> 'servico_aprovado')::boolean AS v`,
    [id],
  );
  return r.v;
}

// ─────────────────────────────────────── (a) toggle OFF ───────────────────────────────────────
describe.skipIf(!PRONTO)("R12 (a) - toggle DESLIGADO = regra de hoje (so M.O.)", () => {
  it("custo menor que o anterior + M.O. pendente: NAO libera; todas aprovadas ou sem linha: libera", async () => {
    await withTx(async (c) => {
      const { v1, v2 } = await familia(c, 100, 50, false);
      const mo = await addMo(c, v2, null);
      expect(await flag(c, v2)).toBe(false);
      await comoSistema(c, () => c.query(`UPDATE public.modelos SET custo_peca_previsto = 10 WHERE id = $1`, [v2]));
      expect(await flag(c, v2)).toBe(false);
      await c.query(`UPDATE public.modelo_servico_mo SET aprovado = true WHERE id = $1`, [mo]);
      expect(await flag(c, v2)).toBe(true); // M.O. toda aprovada
      await c.query(`DELETE FROM public.modelo_servico_mo WHERE id = $1`, [mo]);
      expect(await flag(c, v2)).toBe(true); // sem linha nenhuma = liberada (como hoje)
      expect(await flag(c, v1)).toBe(true);
    });
  });

  it("o helper e o overload de 3 argumentos dizem false com o toggle desligado", async () => {
    await withTx(async (c) => {
      const { v2 } = await familia(c, 100, 50, false);
      expect((await um<{ a: boolean }>(c, `SELECT public._mo_custo_auto_liberado($1) AS a`, [v2])).a).toBe(false);
      expect((await um<{ a: boolean }>(c, `SELECT public._mo_custo_auto_liberado($1, 2, 1::numeric) AS a`, [v2])).a).toBe(false);
    });
  });
});

// ─────────────────────────────── (b) toggle ON, custo <= anterior ───────────────────────────────
describe.skipIf(!PRONTO)("R12 (b) - toggle LIGADO, versao > 1, custo <= anterior, M.O. so pendente", () => {
  it("custo menor: M.O. pendente libera pelo caminho novo; kanban servico_aprovado satisfaz", async () => {
    await withTx(async (c) => {
      const { v2 } = await familia(c, 100, 80);
      await addMo(c, v2, null);
      await addMo(c, v2, null);
      // o rollup repinta a cada linha de M.O.: o ultimo estado ja vem derivado
      expect(await flag(c, v2)).toBe(true);
      expect(await kanbanServicoAprovado(c, v2)).toBe(true);
    });
  });

  it("custo IGUAL ao anterior tambem libera (<=)", async () => {
    await withTx(async (c) => {
      const { v2 } = await familia(c, 100, 100);
      await addMo(c, v2, null);
      expect(await flag(c, v2)).toBe(true);
    });
  });

  it("pendente + aprovada misturadas: libera; o caminho de hoje (tudo aprovado) segue valendo (e um OU)", async () => {
    await withTx(async (c) => {
      const { v2 } = await familia(c, 100, 90);
      await addMo(c, v2, true);
      await addMo(c, v2, null);
      expect(await flag(c, v2)).toBe(true);
      // custo maior que o anterior + tudo aprovado: libera pelo caminho de hoje, sem o novo
      const { v2: v2b } = await familia(c, 100, 500);
      await addMo(c, v2b, true);
      expect(await flag(c, v2b)).toBe(true);
    });
  });

  it("o toggle e lido na proxima gravacao do card (ligar nao reavalia sozinho)", async () => {
    await withTx(async (c) => {
      const { v2 } = await familia(c, 100, 80, false);
      await addMo(c, v2, null);
      expect(await flag(c, v2)).toBe(false);
      await setToggle(c, true);
      expect(await flag(c, v2)).toBe(false); // nada re-derivou ainda
      await c.query(`UPDATE public.modelos SET nome = nome || ' ' WHERE id = $1`, [v2]);
      expect(await flag(c, v2)).toBe(true);
      await setToggle(c, false);
      await c.query(`UPDATE public.modelos SET nome = btrim(nome) WHERE id = $1`, [v2]);
      expect(await flag(c, v2)).toBe(false); // desligar tambem volta, na proxima gravacao
    });
  });
});

// ───────────────────────────────── (c) M.O. REPROVADA veta ─────────────────────────────────
describe.skipIf(!PRONTO)("R12 (c) - toggle LIGADO + M.O. REPROVADA", () => {
  it("custo <= anterior mas 1 reprovada (mesmo com outras pendentes/aprovadas): NAO libera", async () => {
    await withTx(async (c) => {
      const { v2 } = await familia(c, 100, 50);
      const reprovada = await addMo(c, v2, false);
      expect(await flag(c, v2)).toBe(false);
      await addMo(c, v2, null);
      await addMo(c, v2, true);
      expect(await flag(c, v2)).toBe(false);
      expect(await kanbanServicoAprovado(c, v2)).toBe(false);
      // a regra de hoje tambem nao libera, e o helper isolado confirma que o veto e DELE
      expect((await um<{ a: boolean }>(c, `SELECT public._mo_custo_auto_liberado($1) AS a`, [v2])).a).toBe(false);
      // sem reprovada (volta a pendente) -> libera pelo caminho novo; reprovar de novo -> veta de novo (rollup repinta)
      await c.query(`UPDATE public.modelo_servico_mo SET aprovado = NULL WHERE id = $1`, [reprovada]);
      expect(await flag(c, v2)).toBe(true);
      await c.query(`UPDATE public.modelo_servico_mo SET aprovado = false WHERE id = $1`, [reprovada]);
      expect(await flag(c, v2)).toBe(false);
    });
  });

  it("so a M.O. do PROPRIO card veta (reprovada em outro modelo da familia nao conta)", async () => {
    await withTx(async (c) => {
      const { v1, v2 } = await familia(c, 100, 50);
      await addMo(c, v1, false); // a anterior tem reprovada; a v2 so pendente
      await addMo(c, v2, null);
      expect(await flag(c, v2)).toBe(true);
    });
  });
});

// ──────────────────────────── (d) custo sobe/baixa: re-deriva no MESMO UPDATE ────────────────────────────
describe.skipIf(!PRONTO)("R12 (d) - custo maior nao libera; baixar o custo libera no mesmo UPDATE; subir volta a pendente", () => {
  it("v2 mais cara + pendente = false; UPDATE que baixa o custo ja devolve true (RETURNING do mesmo UPDATE)", async () => {
    await withTx(async (c) => {
      const { v2 } = await familia(c, 100, 150);
      await addMo(c, v2, null);
      expect(await flag(c, v2)).toBe(false);
      expect(await setCusto(c, v2, 100)).toBe(true); // igual: libera
      expect(await setCusto(c, v2, 101)).toBe(false); // sobe: volta a pendente sozinho
      expect(await setCusto(c, v2, 60)).toBe(true);
      expect(await flag(c, v2)).toBe(true);
      expect(await setCusto(c, v2, null)).toBe(false); // custo desconhecido: nunca libera pelo caminho novo
    });
  });

  it("o processador de custo de verdade (_custo_recalcular_modelos) re-deriva o flag do card", async () => {
    await withTx(async (c) => {
      const { v1, v2 } = await familia(c, null, null);
      await setCusto(c, v1, 100);
      await setCusto(c, v2, 500);
      await addMo(c, v2, null);
      expect(await flag(c, v2)).toBe(false);
      // card sem BOM: o recompute grava o custo calculado (0) pelo CAMINHO DO SERVIDOR (GUC ligada pelo proprio aplicador)
      await c.query(`SELECT public._custo_recalcular_modelos($1, ARRAY[$2]::uuid[])`, [T, v2]);
      const custo = (await um<{ c: string | null }>(c, `SELECT custo_peca_previsto AS c FROM public.modelos WHERE id = $1`, [v2])).c;
      expect(Number(custo)).toBeLessThanOrEqual(100);
      expect(await flag(c, v2)).toBe(true);
    });
  });

  it("escrita do CLIENTE no custo e revertida pelo gatilho de custo ANTES do flag: o flag nao enxerga o valor revertido", async () => {
    await withTx(async (c) => {
      const { v2 } = await familia(c, 100, 150);
      await addMo(c, v2, null);
      expect(await flag(c, v2)).toBe(false);
      // sem a GUC o trg_modelo_custo_derivado devolve o custo de antes (interno): baixar "na mao" nao libera
      await c.query(`UPDATE public.modelos SET custo_peca_previsto = 10 WHERE id = $1`, [v2]);
      expect(Number((await um<{ c: string }>(c, `SELECT custo_peca_previsto AS c FROM public.modelos WHERE id = $1`, [v2])).c)).toBe(150);
      expect(await flag(c, v2)).toBe(false);
    });
  });
});

// ───────────────────────────────── (e) ordem dos gatilhos BEFORE ─────────────────────────────────
describe.skipIf(!hasDb || !ehBancoLocal())("R12 (e) - ordem dos gatilhos BEFORE UPDATE de modelos", () => {
  it.skipIf(!PRONTO)("trg_modelo_custo_derivado dispara ANTES de trg_modelo_mo_flag (ordem alfabetica do Postgres)", async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        // BEFORE (tgtype & 2), ROW (& 1), UPDATE (& 16), ativos
        `SELECT tgname FROM pg_trigger
          WHERE tgrelid = 'public.modelos'::regclass AND NOT tgisinternal AND tgenabled <> 'D'
            AND (tgtype & 1) = 1 AND (tgtype & 2) = 2 AND (tgtype & 16) = 16`,
      );
      // o Postgres ordena por nome (strcmp byte a byte = collation C)
      const ordem = (rows.map((r) => r.tgname as string)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const iCusto = ordem.indexOf("trg_modelo_custo_derivado");
      const iFlag = ordem.indexOf("trg_modelo_mo_flag");
      expect(iCusto).toBeGreaterThanOrEqual(0);
      expect(iFlag).toBeGreaterThanOrEqual(0);
      expect(iCusto).toBeLessThan(iFlag);
      // nenhum outro BEFORE UPDATE que mexa em custo_peca_previsto pode vir DEPOIS do flag
      const depois = ordem.slice(iFlag + 1);
      for (const nome of depois) {
        const f = (await um<{ s: string }>(
          c,
          `SELECT p.prosrc AS s FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
            WHERE t.tgrelid = 'public.modelos'::regclass AND t.tgname = $1`,
          [nome],
        )).s;
        expect(f, `${nome} roda depois do flag e nao pode escrever o custo`).not.toMatch(/NEW\.custo_peca_previsto\s*:=/i);
      }
    });
  });

  it.skipIf(!PRONTO)("o gatilho do flag le a linha NOVA (versao e custo do NEW), nao a tabela", async () => {
    await withTx(async (c) => {
      const src = (await um<{ s: string }>(c, `SELECT prosrc AS s FROM pg_proc WHERE proname = 'fn_modelo_mo_flag_derivada'`)).s;
      expect(src).toMatch(/_mo_liberada\(NEW\.id, NEW\.versao, NEW\.custo_peca_previsto\)/);
    });
  });
});

// ───────────────────────── (f) versao 1 / sem anterior / NULL / loja isolada ─────────────────────────
describe.skipIf(!PRONTO)("R12 (f) - versao 1, sem anterior, custo NULL, outra loja: como hoje", () => {
  it("versao 1 com o toggle ligado: so a regra de hoje (pendente nao libera)", async () => {
    await withTx(async (c) => {
      await setToggle(c, true);
      const v1 = await novoModelo(c, { versao: 1, custo: 10 });
      await addMo(c, v1, null);
      expect(await flag(c, v1)).toBe(false);
    });
  });

  it("versao 2 sem versao anterior na familia (orfa): como hoje", async () => {
    await withTx(async (c) => {
      await setToggle(c, true);
      const orfa = await novoModelo(c, { versao: 2, custo: 10 });
      await addMo(c, orfa, null);
      expect(await flag(c, orfa)).toBe(false);
    });
  });

  it("custo NULL (da versao ou da anterior): nunca libera pelo caminho novo", async () => {
    await withTx(async (c) => {
      const a = await familia(c, 100, null);
      await addMo(c, a.v2, null);
      expect(await flag(c, a.v2)).toBe(false);
      const b = await familia(c, null, 10);
      await addMo(c, b.v2, null);
      expect(await flag(c, b.v2)).toBe(false);
    });
  });

  it("compara com a anterior ESTRITA (maior versao menor), nao com a primeira", async () => {
    await withTx(async (c) => {
      const { v1, v2 } = await familia(c, 50, 100);
      const v3 = await novoModelo(c, { versao: 3, base: v1, custo: 80 });
      await addMo(c, v3, null);
      expect(await flag(c, v3)).toBe(true); // 80 <= v2 (100), mesmo sendo > v1 (50)
      expect(await setCusto(c, v3, 120)).toBe(false); // 120 > v2
      expect(v2).toBeTruthy();
    });
  });

  it("o toggle e POR LOJA: ligado em outra loja nao vale para a loja de teste", async () => {
    await withTx(async (c) => {
      const outra = (await um<{ t: string | null }>(
        c, `SELECT tenant_id AS t FROM public.tenant_config WHERE tenant_id <> $1 LIMIT 1`, [T],
      )).t;
      if (!outra) return; // cópia sem 2ª loja: nada a provar
      await setToggle(c, false, T);
      await setToggle(c, true, outra);
      const v1 = await novoModelo(c, { versao: 1, custo: 100 });
      const v2 = await novoModelo(c, { versao: 2, base: v1, custo: 10 });
      await addMo(c, v2, null);
      expect(await flag(c, v2)).toBe(false);
    });
  });

  it("modelo inexistente: helper e _mo_liberada de 1 argumento se comportam (false / true), sem erro", async () => {
    await withTx(async (c) => {
      const nada = "00000000-0000-0000-0000-0000000000aa";
      expect((await um<{ a: boolean }>(c, `SELECT public._mo_custo_auto_liberado($1::uuid) AS a`, [nada])).a).toBe(false);
      expect((await um<{ a: boolean }>(c, `SELECT public._mo_liberada($1::uuid) AS a`, [nada])).a).toBe(true); // sem linha = liberada, como antes
    });
  });
});

// ───────────────────────────────────────── (g) ACL ─────────────────────────────────────────
describe.skipIf(!PRONTO)("R12 (g) - helpers com EXECUTE revogado de PUBLIC/anon/authenticated", () => {
  const FNS = [
    "public._mo_custo_auto_liberado(uuid)",
    "public._mo_custo_auto_liberado(uuid,integer,numeric)",
    "public._mo_liberada(uuid)",
    "public._mo_liberada(uuid,integer,numeric)",
  ];
  it("anon/authenticated sem EXECUTE, sem entrada de PUBLIC; DEFINER + STABLE + search_path=public", async () => {
    await withTx(async (c) => {
      for (const f of FNS) {
        const r = await um<{ anon: boolean; auth: boolean; acl: string | null; def: boolean; vol: string; cfg: string | null }>(
          c,
          `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                  has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                  p.proacl::text AS acl, p.prosecdef AS def, p.provolatile AS vol, array_to_string(p.proconfig, '|') AS cfg
             FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
          [f],
        );
        expect(r.anon, f).toBe(false);
        expect(r.auth, f).toBe(false);
        expect(r.acl ?? "", f).not.toMatch(/(^|[{,])=X\//); // PUBLIC
        expect(r.def, f).toBe(true);
        expect(r.vol, f).toBe("s");
        expect(r.cfg, f).toBe("search_path=public");
      }
    });
  });
});

// ─────────────────────────────── (h) salvar_config_loja ───────────────────────────────
type Erro = { code?: string; message: string; detail?: string };
async function tenta(c: Client, sql: string, params: any[] = []): Promise<{ erro: Erro | null; rows: any[] }> {
  await c.query("SAVEPOINT t_r12");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT t_r12");
    return { erro: null, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT t_r12");
    return { erro: { code: e.code, message: e.message, detail: e.detail }, rows: [] };
  }
}
const CHAMA = "SELECT public.salvar_config_loja($1::uuid, $2::jsonb, $3::jsonb, $4::boolean) AS r";
const salvar = (c: Client, mud: object, base: object) => tenta(c, CHAMA, [T, JSON.stringify(mud), JSON.stringify(base), null]);
async function usuarioLoja(c: Client, uid: string, tenantAdmin: boolean): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, T, `${uid}@teste`, `Teste r12 ${uid.slice(-2)}`],
  );
  if (tenantAdmin) await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin')`, [uid]);
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
}
const UID_ADMIN = "12121212-1212-4212-8212-121212121201";
const UID_COMUM = "12121212-1212-4212-8212-121212121202";
async function linhaCfg(c: Client): Promise<Record<string, any>> {
  return (await um<{ j: Record<string, any> }>(c, "SELECT to_jsonb(tc) AS j FROM public.tenant_config tc WHERE tc.tenant_id = $1", [T])).j;
}

describe.skipIf(!PRONTO)("R12 (h) - salvar_config_loja grava o toggle (lista branca + compare-and-set por coluna)", () => {
  it("coluna nova: boolean NOT NULL DEFAULT false, authenticated le, anon nao", async () => {
    await withTx(async (c) => {
      const r = await um<{ t: string; nn: boolean; d: string; au: boolean; an: boolean }>(
        c,
        `SELECT a.atttypid::regtype::text AS t, a.attnotnull AS nn, pg_get_expr(d.adbin, d.adrelid) AS d,
                has_column_privilege('authenticated', 'public.tenant_config', $1, 'SELECT') AS au,
                has_column_privilege('anon', 'public.tenant_config', $1, 'SELECT') AS an
           FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
          WHERE a.attrelid = 'public.tenant_config'::regclass AND a.attname = $1`,
        [COL],
      );
      expect(r).toEqual({ t: "boolean", nn: true, d: "false", au: true, an: false });
      // toda loja existente nasce desligada (comportamento de hoje)
      const ligadas = (await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.tenant_config WHERE ${COL}`)).n;
      expect(Number(ligadas)).toBe(0);
    });
  });

  it("admin da loja liga e desliga; so a coluna enviada muda; retorno traz o valor", async () => {
    await withTx(async (c) => {
      await usuarioLoja(c, UID_ADMIN, true);
      const antes = await linhaCfg(c);
      expect(antes[COL]).toBe(false);
      const r = await salvar(c, { [COL]: true }, { [COL]: false });
      expect(r.erro).toBeNull();
      expect(r.rows[0].r.gravadas).toEqual([COL]);
      expect(r.rows[0].r.valores[COL]).toBe(true);
      const dep = await linhaCfg(c);
      expect(dep[COL]).toBe(true);
      expect(dep.timezone).toBe(antes.timezone);
      expect(dep.insumos_padrao).toEqual(antes.insumos_padrao);
      expect((await salvar(c, { [COL]: false }, { [COL]: true })).erro).toBeNull();
      expect((await linhaCfg(c))[COL]).toBe(false);
    });
  });

  it("compare-and-set: outra pessoa mudou -> P0409 conflito_versao com DETAIL da coluna; convergido passa", async () => {
    await withTx(async (c) => {
      await usuarioLoja(c, UID_ADMIN, true);
      await semJwtLigaToggle(c, true); // outra pessoa ligou
      const conf = await salvar(c, { [COL]: false }, { [COL]: false }); // eu li false, quero false... mas esta true
      expect(conf.erro?.code).toBe("P0409");
      expect(conf.erro?.message).toMatch(/^conflito_versao: config_loja$/);
      expect(conf.erro?.detail).toBe(COL);
      expect(/^[\x20-\x7E]*$/.test(conf.erro!.message)).toBe(true); // ASCII (5xx do PostgREST)
      expect((await linhaCfg(c))[COL]).toBe(true); // nada gravado
      const ok = await salvar(c, { [COL]: true }, { [COL]: false }); // convergiu para o mesmo valor
      expect(ok.erro).toBeNull();
    });
  });

  it("recusas: null, texto e numero (boolean obrigatorio); sem a base do campo", async () => {
    await withTx(async (c) => {
      await usuarioLoja(c, UID_ADMIN, true);
      for (const v of [null, "true", 1]) {
        const r = await salvar(c, { [COL]: v }, { [COL]: false });
        expect(r.erro?.code, JSON.stringify(v)).toBe("P0001");
        expect(r.erro?.message).toMatch(/verdadeiro ou falso/);
      }
      const sem = await salvar(c, { [COL]: true }, {});
      expect(sem.erro?.code).toBe("P0001");
      expect(sem.erro?.message).toMatch(/Falta o valor carregado/);
      expect((await linhaCfg(c))[COL]).toBe(false);
    });
  });

  it("usuario comum da loja (nao admin) nao grava (42501); campo desconhecido segue recusado", async () => {
    await withTx(async (c) => {
      await usuarioLoja(c, UID_COMUM, false);
      const r = await salvar(c, { [COL]: true }, { [COL]: false });
      expect(r.erro?.code).toBe("42501");
      await usuarioLoja(c, UID_ADMIN, true);
      const d = await salvar(c, { campo_inexistente_r12: true }, { campo_inexistente_r12: false });
      expect(d.erro?.code).toBe("P0001");
      expect(d.erro?.message).toMatch(/nao pode ser salvo|não pode ser salvo/);
    });
  });
});

/** Escrita de PREPARACAO como "outra pessoa" (sem JWT), restaurando os claims do admin. */
async function semJwtLigaToggle(c: Client, on: boolean): Promise<void> {
  const ant = (await um<{ v: string | null }>(c, "SELECT current_setting('request.jwt.claims', true) AS v")).v ?? "";
  await c.query("SELECT set_config('request.jwt.claims', '', true)");
  try {
    await c.query(`UPDATE public.tenant_config SET ${COL} = $1 WHERE tenant_id = $2`, [on, T]);
  } finally {
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [ant]);
  }
}

describe.runIf(hasDb && ehBancoLocal() && !NA_COPIA)("R12 - migration nao aplicada na copia", () => {
  it("AVISO: aplique supabase/migrations/20261106100000_r12_custo_auto_por_versao.sql (psql -f) na copia local para rodar esta suite", () => {
    expect(NA_COPIA).toBe(false);
  });
});
