// Urgentes R5 (plan-b Task 3, migration 20261103185000_urg_r5_peca_foto_previsao): previsão de entrega da peça de foto.
// Coluna nova producao_terceirizados.peca_foto_previsao (date NULL); peca_foto_data passa a ser a data REAL (entregue).
// salvar_terceirizados grava a coluna: chave PRESENTE = grava ('' / null = NULL); chave AUSENTE = mantém o gravado (aba/site
// antigo não apaga a previsão — Ruling 3); INSERT sem a chave = NULL. O resto (portão S3b, C1/I2, _molde_tocado, estado completo
// só nas ATIVAS) segue igual. Txn revertida; o bloco é aplicado DENTRO da txn por aplicaUrgb(c, "r5") (pula se já vivo na cópia).
// Só na cópia local (DDL em txn contra produção trava o app — incidente 23/set).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, semJwt, um, TENANT_TESTE } from "./db";
import { aplicaUrgb, urgbViva, URGB_MIGS, md5UrgbSucessor } from "./urgb-helpers";
import { aplicarArquivo } from "./mig-txn";
import { montarPayloadEdicaoRapida } from "@/lib/servicos-payload";

const BLOCO = URGB_MIGS.find((x) => x.id === "r5")?.b;
const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SALVAR = "public.salvar_terceirizados(uuid,jsonb,text,jsonb)";
const MD5_ANTES = "fe2530878c26ae9a9680a7b1d02eca71"; // tabela de fatos do plan-b (= "depois" da Camada 160000)

type Linha = Record<string, unknown>;

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}

/** Linhas do CAD como o PostgREST as devolve (to_jsonb: datas em texto). */
async function linhasDoCad(c: Client, cad: string): Promise<Linha[]> {
  const { rows } = await c.query(
    `select to_jsonb(pt) j from producao_terceirizados pt where cad_id = $1 order by created_at, id`,
    [cad],
  );
  return rows.map((r) => r.j as Linha);
}
async function linha(c: Client, id: string): Promise<Linha> {
  return (await um<{ j: Linha }>(c, `select to_jsonb(pt) j from producao_terceirizados pt where id = $1`, [id])).j;
}

async function salvar(c: Client, cad: string, blocos: unknown, revBase: unknown, molde: string | null = null) {
  await c.query("SAVEPOINT rpc");
  try {
    await c.query(`select public.salvar_terceirizados($1, $2::jsonb, $3, $4::jsonb)`, [
      cad,
      JSON.stringify(blocos),
      molde,
      revBase === null ? null : JSON.stringify(revBase),
    ]);
    await c.query("RELEASE SAVEPOINT rpc");
    return { ok: true as const };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT rpc");
    await c.query("RELEASE SAVEPOINT rpc");
    const er = e as { code?: string; message?: string };
    return { ok: false as const, code: String(er.code ?? ""), msg: String(er.message ?? "") };
  }
}

/**
 * Aplica o bloco, entra como o super admin da Loja Teste e cria (como postgres, sem JWT) um CAD com 3 serviços: A (PL, peça de
 * foto com previsão 2026-10-10 e entregue 2026-10-12), B (PL, peça de foto só com previsão 2026-10-15) e I (INATIVO, previsão
 * 2026-11-01 — o estado completo nunca o toca).
 */
async function cenario(c: Client) {
  await c.query("SET LOCAL statement_timeout = '60s'");
  await aplicaUrgb(c, "r5");
  await comoUsuario(c);
  return semJwt(c, async () => {
    const m = (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1, 'R5 peca foto') returning id`, [T])).id;
    const cad = (await um<{ id: string }>(c, `insert into cad (tenant_id, modelo_id) values ($1, $2) returning id`, [T, m])).id;
    const cat = async (nome: string) =>
      (await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome) values ($1, $2) returning id`, [T, nome])).id;
    const emp = (await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id = $1 order by id limit 1`, [T]))?.id ?? null;
    const serv = async (nome: string, ativo: boolean, foto: boolean, prev: string | null, real: string | null) =>
      (
        await um<{ id: string }>(
          c,
          `insert into producao_terceirizados (cad_id, tenant_id, ativo, categoria_terceirizado_id, interno, empresa_id,
             preco_metro_unidade, quantidade_enviada, quantidade_recebida, quantidade_defeito, observacao, numero_parcelas,
             peca_foto, peca_foto_data, peca_foto_previsao)
           values ($1, $2, $3, $4, false, $5, 7, 10, 0, 0, 'obs', 1, $6, $7, $8) returning id`,
          [cad, T, ativo, await cat(`${nome} R5`), emp, foto, real, prev],
        )
      ).id;
    return {
      cad,
      a: await serv("Costura", true, true, "2026-10-10", "2026-10-12"),
      b: await serv("Lavanderia", true, true, "2026-10-15", null),
      i: await serv("Bordado", false, true, "2026-11-01", null),
    };
  });
}

/** Payload de estado completo das linhas ATIVAS (o que o sheet manda), com `mexe` por cima no bloco `id`. */
function payload(linhas: Linha[], id: string, mexe: (b: Record<string, unknown>) => void) {
  const ativas = linhas.filter((r) => r.ativo !== false);
  const blocos = ativas.map((r) => {
    const b: Record<string, unknown> = { ...r };
    delete b.peca_foto_previsao; // cliente ANTIGO: nunca manda a chave (o teste a põe por cima quando quer)
    if (r.id === id) mexe(b);
    return b;
  });
  const revBase = Object.fromEntries(ativas.map((r) => [r.id as string, Number(r.rev ?? 0)]));
  return { blocos, revBase };
}

describe.skipIf(!RODA)("urg R5 — previsão de entrega da peça de foto (producao_terceirizados.peca_foto_previsao)", () => {
  it("estrutura: bloco r5 em urgb-dados.ts; md5 DEPOIS; coluna date nullable sem default; ACL igual; privilégios da coluna", async () => {
    expect(BLOCO, "bloco r5 em urgb-dados.ts").toBeDefined();
    expect(BLOCO!.mig).toBe("supabase/migrations/20261103185000_urg_r5_peca_foto_previsao.sql");
    expect(BLOCO!.URGB_SENTINELA).toBe(SALVAR);
    expect(BLOCO!.URGB_MD5[SALVAR].antes).toBe(MD5_ANTES);
    expect(Object.keys(BLOCO!.URGB_MD5)).toEqual([SALVAR]);
    await withTx(async (c) => {
      await aplicaUrgb(c, "r5");
      expect(await urgbViva(c, "r5")).toBe(true);
      expect(md5UrgbSucessor(SALVAR, BLOCO!.URGB_MD5[SALVAR].depois)).toContain(await md5Fn(c, SALVAR));
      const col = await um<{ t: string; n: string; d: string | null; cm: string | null }>(
        c,
        `SELECT data_type AS t, is_nullable AS n, column_default AS d,
                col_description('public.producao_terceirizados'::regclass, ordinal_position::int) AS cm
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'producao_terceirizados' AND column_name = 'peca_foto_previsao'`,
      );
      expect({ t: col.t, n: col.n, d: col.d }).toEqual({ t: "date", n: "YES", d: null });
      expect(col.cm).toMatch(/previsao/i);
      // sem GRANT: a tela grava pela RPC; o cliente só LÊ a tabela (S3b); anon nem lê (S5)
      const pv = await um<{ u: boolean; i: boolean; s: boolean; a: boolean }>(
        c,
        `SELECT has_column_privilege('authenticated', 'public.producao_terceirizados', 'peca_foto_previsao', 'UPDATE') AS u,
                has_column_privilege('authenticated', 'public.producao_terceirizados', 'peca_foto_previsao', 'INSERT') AS i,
                has_column_privilege('authenticated', 'public.producao_terceirizados', 'peca_foto_previsao', 'SELECT') AS s,
                has_column_privilege('anon', 'public.producao_terceirizados', 'peca_foto_previsao', 'SELECT') AS a`,
      );
      expect(pv).toEqual({ u: false, i: false, s: true, a: false });
      const p = await um<{ acl: string; sd: boolean; cfg: string; anon: boolean; auth: boolean; pub: boolean }>(
        c,
        `SELECT coalesce(p.proacl::text, '') acl, p.prosecdef sd, coalesce(array_to_string(p.proconfig, '|'), '') cfg,
                has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
                exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0) pub
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
        [SALVAR],
      );
      expect(p).toEqual({ acl: BLOCO!.URGB_ACL[SALVAR], sd: true, cfg: "search_path=public", anon: false, auth: true, pub: false });
      // o resto do texto ficou: portão S3b, estado vazio, I2, _molde_tocado, estado completo só nas ATIVAS
      const d = (await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) d", [SALVAR])).d;
      for (const t of [
        "PERFORM public._seg_exige_pagina('producao_terceirizados', 'producao_etapas');",
        "estado_vazio_recusado",
        "conflito_versao: um servico removido foi alterado ou criado por outra pessoa",
        "_molde_tocado",
        "DELETE FROM public.producao_terceirizados WHERE cad_id = _cad_id AND ativo IS TRUE AND NOT (id = ANY(v_ids));",
        "peca_foto_previsao = CASE WHEN b ? 'peca_foto_previsao' THEN NULLIF(b->>'peca_foto_previsao','')::date ELSE peca_foto_previsao END",
      ])
        expect(d, t).toContain(t);
    });
  });

  it("(a) UPDATE com a chave grava; '' zera; null zera; as outras colunas da peça de foto seguem o payload", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      let base = await linhasDoCad(c, s.cad);
      let p = payload(base, s.a, (b) => {
        b.peca_foto_previsao = "2026-10-20";
        b.peca_foto_data = "2026-10-21";
      });
      expect(await salvar(c, s.cad, p.blocos, p.revBase)).toEqual({ ok: true });
      let a = await linha(c, s.a);
      expect([a.peca_foto, a.peca_foto_previsao, a.peca_foto_data]).toEqual([true, "2026-10-20", "2026-10-21"]);
      expect((await linha(c, s.b)).peca_foto_previsao).toBe("2026-10-15"); // B veio sem a chave = mantém

      base = await linhasDoCad(c, s.cad);
      p = payload(base, s.a, (b) => (b.peca_foto_previsao = ""));
      expect(await salvar(c, s.cad, p.blocos, p.revBase)).toEqual({ ok: true });
      a = await linha(c, s.a);
      expect([a.peca_foto_previsao, a.peca_foto_data]).toEqual([null, "2026-10-21"]);

      // null explícito (a tela manda null quando o campo está vazio) = NULL também
      await semJwt(c, () => c.query(`update producao_terceirizados set peca_foto_previsao = '2026-10-25' where id = $1`, [s.b]));
      base = await linhasDoCad(c, s.cad);
      p = payload(base, s.b, (b) => (b.peca_foto_previsao = null));
      expect(await salvar(c, s.cad, p.blocos, p.revBase)).toEqual({ ok: true });
      expect((await linha(c, s.b)).peca_foto_previsao).toBeNull();
    });
  });

  it("(b) chave AUSENTE mantém o gravado (aba/site antigo), mesmo mudando peca_foto/peca_foto_data; inativo intocado", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const iAntes = await linha(c, s.i);
      const base = await linhasDoCad(c, s.cad);
      const p = payload(base, s.a, (b) => {
        b.peca_foto = false;
        b.peca_foto_data = null;
      });
      expect(p.blocos.every((b) => !("peca_foto_previsao" in b))).toBe(true);
      expect(await salvar(c, s.cad, p.blocos, p.revBase)).toEqual({ ok: true });
      const a = await linha(c, s.a);
      expect([a.peca_foto, a.peca_foto_data, a.peca_foto_previsao]).toEqual([false, null, "2026-10-10"]);
      expect((await linha(c, s.b)).peca_foto_previsao).toBe("2026-10-15");
      expect(await linha(c, s.i)).toEqual(iAntes); // estado completo só nas ATIVAS: o inativo nem é tocado
      // _rev_base null (compat/manutenção) e sem a chave: mantém também
      const base2 = await linhasDoCad(c, s.cad);
      const p2 = payload(base2, s.b, (b) => (b.observacao = "sem base"));
      expect(await salvar(c, s.cad, p2.blocos, null)).toEqual({ ok: true });
      expect((await linha(c, s.b)).peca_foto_previsao).toBe("2026-10-15");
    });
  });

  it("(c) INSERT sem a chave = NULL; com a chave grava; com '' = NULL", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const base = await linhasDoCad(c, s.cad);
      const p = payload(base, "-", () => undefined);
      const novo = (extra: Record<string, unknown>) => ({
        categoria_terceirizado_id: base[0].categoria_terceirizado_id,
        interno: false,
        empresa_id: base[0].empresa_id,
        preco_metro_unidade: 3,
        peca_foto: true,
        peca_foto_data: null,
        observacao: `novo ${JSON.stringify(extra)}`,
        ...extra,
      });
      const blocos = [
        ...p.blocos,
        novo({}),
        novo({ peca_foto_previsao: "2026-12-01" }),
        novo({ peca_foto_previsao: "" }),
      ];
      expect(await salvar(c, s.cad, blocos, p.revBase)).toEqual({ ok: true });
      const novos = (
        await c.query(
          `select observacao, peca_foto_previsao::text p from producao_terceirizados
            where cad_id = $1 and observacao like 'novo %' order by observacao collate "C"`,
          [s.cad],
        )
      ).rows;
      expect(novos).toEqual([
        { observacao: 'novo {"peca_foto_previsao":""}', p: null },
        { observacao: 'novo {"peca_foto_previsao":"2026-12-01"}', p: "2026-12-01" },
        { observacao: "novo {}", p: null },
      ]);
    });
  });

  it("(d) edição rápida (montarPayloadEdicaoRapida): com a chave a coluna volta byte a byte; sem a chave (front de hoje) mantém", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      // 1) payload da edição rápida com a chave levada de volta à mão em CADA bloco (o que a T7 fará no blocoParaPayload)
      let base = await linhasDoCad(c, s.cad);
      const r1 = montarPayloadEdicaoRapida({ linhas: base, blocoId: s.a, campo: "pt_data_entrada", valor: "2026-10-06" });
      const comChave = r1._blocos.map((b) => ({
        ...b,
        peca_foto_previsao: base.find((r) => r.id === b.id)!.peca_foto_previsao,
      }));
      expect(await salvar(c, s.cad, comChave, r1._rev_base)).toEqual({ ok: true });
      let depois = await linhasDoCad(c, s.cad);
      const sem = (r: Linha, ...k: string[]) => Object.fromEntries(Object.entries(r).filter(([x]) => !["rev", ...k].includes(x)));
      for (const r of base) {
        const d = depois.find((x) => x.id === r.id)!;
        if (r.id === s.a) {
          expect(sem(d, "pt_data_entrada"), "A").toEqual(sem(r, "pt_data_entrada"));
          expect(d.pt_data_entrada).toBe("2026-10-06");
        } else expect(sem(d), String(r.id)).toEqual(sem(r));
      }
      expect(depois.map((r) => r.peca_foto_previsao)).toEqual(base.map((r) => r.peca_foto_previsao));
      // 2) payload SEM a chave (cliente antigo / front antes da T7): a previsão fica
      base = depois;
      const r2 = montarPayloadEdicaoRapida({ linhas: base, blocoId: s.b, campo: "data_enviado", valor: "2026-10-07" });
      const semChave = r2._blocos.map((b) => {
        const x: Record<string, unknown> = { ...b };
        delete x.peca_foto_previsao;
        return x;
      });
      expect(await salvar(c, s.cad, semChave, r2._rev_base)).toEqual({ ok: true });
      depois = await linhasDoCad(c, s.cad);
      const prev = (id: string) => depois.find((r) => r.id === id)!.peca_foto_previsao;
      expect([prev(s.a), prev(s.b), prev(s.i)]).toEqual(["2026-10-10", "2026-10-15", "2026-11-01"]);
      expect(depois.find((r) => r.id === s.b)!.data_enviado).toBe("2026-10-07");
    });
  });

  it("(e) C1/I2 seguem: remover serviço salvo por outra pessoa = P0409 (nada muda); estado vazio = estado_vazio_recusado", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const base = await linhasDoCad(c, s.cad);
      // outra pessoa salvou B depois da carga (rev sobe)
      await semJwt(c, () => c.query(`update producao_terceirizados set peca_foto_previsao = '2026-10-30' where id = $1`, [s.b]));
      const p = payload(base, s.a, (b) => (b.peca_foto_previsao = "2026-10-11"));
      const semB = p.blocos.filter((b) => b.id !== s.b);
      const r = await salvar(c, s.cad, semB, p.revBase);
      expect(r.ok).toBe(false);
      expect(r).toMatchObject({ code: "P0409" });
      expect((await linha(c, s.a)).peca_foto_previsao).toBe("2026-10-10");
      expect((await linha(c, s.b)).peca_foto_previsao).toBe("2026-10-30");
      const v = await salvar(c, s.cad, [], {});
      expect(v).toMatchObject({ ok: false, code: "P0001" });
      expect((v as { msg: string }).msg).toMatch(/^estado_vazio_recusado: servicos 2$/);
      expect((await linhasDoCad(c, s.cad)).length).toBe(3);
    });
  });

  it("(f) ida idempotente; _down = ANTES (2x no-op) e a coluna FICA inerte; ida de novo; _down_drop recusa viva e remove depois; guarda", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '120s'");
      await aplicaUrgb(c, "r5");
      expect(BLOCO).toBeDefined();
      const b = BLOCO!;
      const depois = b.URGB_MD5[SALVAR].depois;
      const acl = async () => (await um<{ a: string }>(c, "SELECT coalesce(proacl::text,'') a FROM pg_proc WHERE oid = to_regprocedure($1)", [SALVAR])).a;
      const temCol = async () =>
        (await um<{ n: number }>(c, `SELECT count(*)::int n FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'producao_terceirizados' AND column_name = 'peca_foto_previsao'`)).n === 1;
      expect(await md5Fn(c, SALVAR)).toBe(depois);
      await aplicarArquivo(c, b.mig); // idempotente
      expect(await md5Fn(c, SALVAR)).toBe(depois);
      expect(await acl()).toBe(b.URGB_ACL[SALVAR]);
      // _down_drop com o bloco vivo = recusa (nada muda)
      await c.query("SAVEPOINT dd");
      await expect(aplicarArquivo(c, b.drop)).rejects.toMatchObject({ code: "P0001" });
      await c.query("ROLLBACK TO SAVEPOINT dd");
      expect(await temCol()).toBe(true);
      // volta neutra 2x
      await aplicarArquivo(c, b.down);
      await aplicarArquivo(c, b.down);
      expect(await md5Fn(c, SALVAR)).toBe(MD5_ANTES);
      expect(await acl()).toBe(b.URGB_ACL[SALVAR]);
      expect(await temCol()).toBe(true);
      expect(await urgbViva(c, "r5")).toBe(false);
      // com a volta, a chave é ignorada (texto de ANTES): a coluna fica inerte
      await comoUsuario(c);
      const s = await cenario_semAplicar(c);
      const base = await linhasDoCad(c, s.cad);
      const p = payload(base, s.a, (x) => (x.peca_foto_previsao = "2027-01-01"));
      expect(await salvar(c, s.cad, p.blocos, p.revBase)).toEqual({ ok: true });
      expect((await linha(c, s.a)).peca_foto_previsao).toBe("2026-10-10");
      // ida de novo
      await aplicarArquivo(c, b.mig);
      expect(await md5Fn(c, SALVAR)).toBe(depois);
      // guarda: texto mexido = recusa (P0001) na ida e na volta
      const def = (await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) d", [SALVAR])).d;
      await c.query(def.replace("BEGIN\n", "BEGIN\n  -- mexida\n"));
      for (const arq of [b.mig, b.down]) {
        await c.query("SAVEPOINT g");
        await expect(aplicarArquivo(c, arq)).rejects.toMatchObject({ code: "P0001" });
        await c.query("ROLLBACK TO SAVEPOINT g");
      }
      await c.query(def);
      // _down + _down_drop: a coluna sai; _down_drop de novo = no-op; ida recria
      await aplicarArquivo(c, b.down);
      await aplicarArquivo(c, b.drop);
      expect(await temCol()).toBe(false);
      await aplicarArquivo(c, b.drop);
      await aplicarArquivo(c, b.mig);
      expect(await temCol()).toBe(true);
      expect(await md5Fn(c, SALVAR)).toBe(depois);
    });
  });
});

/** Mesmo CAD do `cenario`, sem (re)aplicar o bloco (para o caso da volta neutra). */
async function cenario_semAplicar(c: Client) {
  return semJwt(c, async () => {
    const m = (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1, 'R5 volta') returning id`, [T])).id;
    const cad = (await um<{ id: string }>(c, `insert into cad (tenant_id, modelo_id) values ($1, $2) returning id`, [T, m])).id;
    const cat = (await um<{ id: string }>(c, `insert into categorias_terceirizado (tenant_id, nome) values ($1, 'Volta R5') returning id`, [T])).id;
    const a = (
      await um<{ id: string }>(
        c,
        `insert into producao_terceirizados (cad_id, tenant_id, ativo, categoria_terceirizado_id, interno, numero_parcelas,
           peca_foto, peca_foto_previsao) values ($1, $2, true, $3, false, 1, true, '2026-10-10') returning id`,
        [cad, T, cat],
      )
    ).id;
    return { cad, a };
  });
}
