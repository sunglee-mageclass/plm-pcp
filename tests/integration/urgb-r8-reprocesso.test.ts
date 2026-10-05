// Urgentes R8b (plan-b Task 5, migration 20261103191000_urg_r8_titulo_sublinha_reprocesso): CORRECAO UNICA dos INTEGRAVEIS (P-303 A,
// Ruling 18) - so o titulo das sublinhas e refeito com a regra da 190000 (titulo do pai + cor antes do ultimo " | "): titulo-base = o
// do RETRATO (nunca o vivo); cor pela P-129 (retrato se o campo esta marcado, senao o cadastro VIVO); modo = escolha ATUAL da loja;
// TODO integravel ganha v=4 + rev + 1 Log (mesmo sem `titulo` marcado); INTEGRADOS INTOCADOS. Molde: I3c (20261030120000).
// A copia tem 0 integraveis: tudo e semeado DENTRO da txn revertida (a r8a e voltada na txn para marcar com retrato v=3, como antes
// do deploy, e reaplicada por aplicarArquivo). O teto (1000) e conferido por teste-FONTE (semear 1001 e caro demais). So na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import { aplicaUrgb, urgbViva, URGB_MIGS } from "./urgb-helpers";
import { aplicarArquivo } from "./mig-txn";
import {
  camposLoja,
  keywordsLoja,
  modeloInterno,
  padraoVivo,
  type Fixture,
} from "./integracao-helpers";
import { tituloSublinha } from "@/lib/integracao/titulo-sublinha";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BLOCO = URGB_MIGS.find((x) => x.id === "r8b")?.b;
const R8A = URGB_MIGS.find((x) => x.id === "r8a")?.b;
const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const MIG = "supabase/migrations/20261103191000_urg_r8_titulo_sublinha_reprocesso.sql";
const DOWN = "supabase/rollback/20261103191000_urg_r8_titulo_sublinha_reprocesso_down.sql";
const DROP = "supabase/rollback/20261103191000_urg_r8_titulo_sublinha_reprocesso_down_drop.sql";
const BKP = "public._bkp_r8_titulo_sublinha";
const LOCK = "LOCK TABLE public.integracao_produtos, public.integracao_linhas IN EXCLUSIVE MODE;";
const QUEM = "Sistema (título das sublinhas)";
const QUEM_VOLTA = "Sistema (volta título das sublinhas)";
const FORMATO = {
  partes: ["ref", "cor_base", "tamanho"],
  separadores: { "ref|cor_base": "-", "cor_base|tamanho": "-" },
};
const ler = (rel: string): string => readFileSync(ROOT + rel, "utf8");

type Linha = {
  tipo: string;
  ordem: number;
  variante_key?: string;
  valores: Record<string, string | null>;
};
type Retrato = { v: number; campos: string[]; linhas: Linha[] };
type Ip = {
  estado: string;
  retrato: Retrato | null;
  retrato_txt: string | null;
  assinatura: string | null;
  rev: number;
  linhas: string;
};

async function timeouts(c: Client): Promise<void> {
  // a migration faz SET LOCAL transaction_timeout (valeria para a txn INTEIRA do teste)
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
}
async function falha(
  c: Client,
  fn: () => Promise<unknown>,
): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT r8b_falha");
  try {
    await fn();
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT r8b_falha");
    const er = e as { code?: string; message?: string };
    return { code: String(er.code ?? ""), message: String(er.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT r8b_falha");
  throw new Error("esperava erro");
}
async function skuConfig(c: Client, modo: "cor_base" | "cor_apelido"): Promise<void> {
  await c.query("UPDATE public.tenant_config SET sku_config = $2::jsonb WHERE tenant_id = $1", [
    T,
    JSON.stringify({ ...FORMATO, cor_no_nome: modo }),
  ]);
}
async function marcar(c: Client, id: string): Promise<void> {
  const a = (
    await um<{ r: { produtos: { assinatura: string }[] } }>(
      c,
      "SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r",
      [id],
    )
  ).r.produtos[0].assinatura;
  await c.query(
    "SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))",
    [id, a],
  );
}
async function ip(c: Client, id: string): Promise<Ip> {
  return um<Ip>(
    c,
    `SELECT p.estado, p.retrato, p.retrato::text AS retrato_txt, p.assinatura, p.rev,
            coalesce((SELECT string_agg(il::text, '|' ORDER BY il.ordem) FROM public.integracao_linhas il WHERE il.modelo_id = p.modelo_id), '') AS linhas
       FROM public.integracao_produtos p WHERE p.modelo_id = $1`,
    [id],
  );
}
async function titulosApi(c: Client, id: string): Promise<[string, string | null][]> {
  const { rows } = await c.query(
    "SELECT tipo, titulo FROM public.integracao_linhas WHERE modelo_id = $1 ORDER BY ordem",
    [id],
  );
  return rows.map((r) => [r.tipo as string, r.titulo as string | null]);
}
const variantes = (r: Retrato): Linha[] => r.linhas.filter((l) => l.tipo === "variante");
/** O retrato sem o que o reprocesso pode mudar (v e o titulo das sublinhas) - o resto tem de ficar byte a byte igual. */
const semTituloSub = (r: Retrato): string =>
  JSON.stringify({
    ...r,
    v: 0,
    linhas: r.linhas.map((l) =>
      l.tipo === "variante"
        ? {
            ...l,
            valores: Object.fromEntries(Object.entries(l.valores).filter(([k]) => k !== "titulo")),
          }
        : l,
    ),
  });
async function assinar(c: Client, r: unknown): Promise<string> {
  return (
    await um<{ a: string }>(c, "SELECT public._integracao_assinar($1::jsonb) AS a", [
      JSON.stringify(r),
    ])
  ).a;
}
/** Troca o retrato gravado (e as colunas da API) "como se" tivesse sido marcado assim - assinatura refeita (HMAC). */
async function gravaRetrato(c: Client, id: string, r: Retrato): Promise<void> {
  await c.query(
    "UPDATE public.integracao_produtos SET retrato = $2::jsonb, assinatura = public._integracao_assinar($2::jsonb) WHERE modelo_id = $1",
    [id, JSON.stringify(r)],
  );
  for (const l of r.linhas) {
    await c.query(
      "UPDATE public.integracao_linhas SET titulo = $3, cor_base = $4, cor_apelido = $5 WHERE modelo_id = $1 AND ordem = $2",
      [
        id,
        l.ordem,
        l.valores.titulo ?? null,
        l.valores.cor_base ?? null,
        l.valores.cor_apelido ?? null,
      ],
    );
  }
}
async function logs(
  c: Client,
  id: string,
  reprocesso: string,
): Promise<{ acao: string; quem: string; detalhe: Record<string, unknown> }[]> {
  return (
    await c.query(
      "SELECT acao, quem, detalhe FROM public.integracao_log WHERE modelo_id = $1 AND detalhe ->> 'reprocesso' = $2 ORDER BY criado_em",
      [id, reprocesso],
    )
  ).rows;
}
const nLog = async (c: Client): Promise<number> =>
  (await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.integracao_log")).n;
async function comNotices<R>(
  c: Client,
  fn: () => Promise<R>,
): Promise<{ r: R; notices: string[] }> {
  const notices: string[] = [];
  const h = (n: { message?: string }) => notices.push(String(n.message ?? ""));
  c.on("notice", h);
  try {
    return { r: await fn(), notices };
  } finally {
    c.removeListener("notice", h);
  }
}

describe("urg R8b — arquivos do reprocesso (estatico, sem banco)", () => {
  it("bloco r8b em urgb-dados.ts (reprocesso, sentinela = backup) e os 3 arquivos gerados", () => {
    expect(BLOCO, "bloco r8b em urgb-dados.ts").toBeDefined();
    expect(BLOCO!.mig).toBe(MIG);
    expect(BLOCO!.down).toBe(DOWN);
    expect(BLOCO!.drop).toBe(DROP);
    expect(BLOCO!.URGB_SENTINELA).toBe(BKP);
    expect(BLOCO!.URGB_MD5).toEqual({});
    expect(BLOCO!.URGB_REPROCESSO?.backup).toBe(BKP);
  });

  it("ida/volta: 1 BEGIN/1 COMMIT, travas 500ms/30s, o MESMO LOCK EXCLUSIVE (produtos+linhas), sem DROP, RAISE so ASCII", () => {
    for (const rel of [MIG, DOWN, DROP]) {
      const t = ler(rel);
      expect(
        t.split("\n").find((l) => !l.startsWith("--")),
        rel,
      ).toBe("SET client_encoding = 'UTF8';");
      expect(t.match(/^BEGIN;$/gm)?.length, rel).toBe(1);
      expect(t.match(/^COMMIT;$/gm)?.length, rel).toBe(1);
      expect(t, rel).toMatch(
        /^BEGIN;\nSET LOCAL lock_timeout = '500ms';\nSET LOCAL transaction_timeout = '30s';$/m,
      );
      for (const m of t.matchAll(/RAISE (?:EXCEPTION|NOTICE) '([^']*)'/g))
        expect(
          [...m[1]].every((ch) => ch.charCodeAt(0) < 128),
          `${rel}: ${m[1]}`,
        ).toBe(true);
    }
    for (const rel of [MIG, DOWN]) {
      expect(ler(rel), rel).toContain(LOCK);
      const codigo = ler(rel)
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n");
      expect(codigo, rel).not.toMatch(/\bDROP\b/);
      expect(ler(rel), rel).not.toContain("integracao_config IN");
    }
    expect(ler(DROP)).toContain(`DROP TABLE IF EXISTS ${BKP};`);
  });

  it("teto 1000: na guarda (antes do LOCK) E reconferido sob o LOCK; mesma contagem (integraveis com v<>4)", () => {
    const t = ler(MIG);
    const iLock = t.indexOf(LOCK);
    expect(iLock).toBeGreaterThan(0);
    const conta = "WHERE p.estado = 'integravel' AND p.retrato ->> 'v' IS DISTINCT FROM '4'";
    const antes = t.slice(0, iLock);
    const depois = t.slice(iLock);
    for (const parte of [antes, depois]) {
      expect(parte).toContain(conta);
      expect(parte).toMatch(
        /IF v_n > 1000 THEN\n\s+RAISE EXCEPTION 'r8b: % integraveis a reprocessar[^']*\(teto 1000\)/,
      );
    }
    expect(depois.indexOf("DO $teto$")).toBeLessThan(depois.indexOf("CREATE TABLE IF NOT EXISTS"));
  });

  it("guarda exige a 190000 (md5 DEPOIS do retrato/listar + helper) e as dependencias fixadas; backup com RLS + REVOKE ALL", () => {
    const t = ler(MIG);
    expect(R8A, "bloco r8a").toBeDefined();
    for (const sig of [
      "public._integracao_retrato_core(uuid,text[],jsonb)",
      "public.integracao_listar(text,jsonb,integer,integer)",
    ]) {
      expect(t).toContain(`('${sig}', '${R8A!.URGB_MD5[sig].depois}')`);
    }
    const helper = "public._integracao_titulo_sublinha(text,text,text,text)";
    expect(t).toContain(`('${helper}', '${R8A!.URGB_NOVAS![helper]}')`);
    for (const dep of [
      "_integracao_assinar(jsonb)",
      "_integracao_logar(uuid,text,uuid,jsonb,text)",
      "_integracao_cor_no_nome(jsonb)",
      "_sku_variante_key(uuid,uuid)",
    ]) {
      expect(t).toMatch(
        new RegExp(`\\('public\\.${dep.replace(/[()[\]]/g, "\\$&")}', '[0-9a-f]{32}'\\)`),
      );
    }
    expect(t).toContain(`ALTER TABLE ${BKP} ENABLE ROW LEVEL SECURITY;`);
    expect(t).toContain(
      `REVOKE ALL ON TABLE ${BKP} FROM PUBLIC, anon, authenticated, service_role;`,
    );
    expect(t).not.toMatch(/CREATE POLICY/);
  });
});

describe.skipIf(!RODA)("urg R8b — reprocesso unico dos integraveis (banco, txn revertida)", () => {
  /**
   * Cenario do deploy: a r8a e voltada NA TXN (retrato v=3, como hoje em producao), 4 integraveis + 1 integrado sao marcados,
   * a r8a volta a ida (190000) e depois vem a 191000.
   *   A: titulo + cor_base + cor_apelido marcados (cor do RETRATO; o retrato gravado tem cores "do retrato" != cadastro)
   *   B: titulo marcado, cores NAO marcadas (cor do cadastro VIVO - renomeada depois da marcacao); titulo-base adulterado no retrato
   *   C: titulo NAO marcado (so v=4 + rev + Log)
   *   E: como A, mas VOLTADO entre a ida e a volta (relatado pelo _down)
   *   D: INTEGRADO (intocado)
   * Modo: marcado em 'cor_base'; a loja troca para 'cor_apelido' ANTES da 191000 (vale a escolha ATUAL).
   */
  async function cenario(c: Client) {
    await timeouts(c);
    await aplicaUrgb(c, "r8a");
    await timeouts(c);
    if (await urgbViva(c, "r8b")) await aplicarArquivo(c, DOWN); // estado de antes (a copia tem 0 integraveis: nunca)
    await comoUsuario(c);
    await keywordsLoja(c, "k");
    await skuConfig(c, "cor_base");
    await aplicarArquivo(c, R8A!.down); // retrato v=3 (o texto de ANTES da 190000; o helper fica)
    await timeouts(c);
    const padrao = await padraoVivo(c);
    const semCor = padrao.filter((x) => x !== "cor_base" && x !== "cor_apelido");
    const semTitulo = padrao.filter((x) => x !== "titulo");
    const fx: Record<"A" | "B" | "C" | "D" | "E", Fixture> = {} as never;
    for (const [k, campos, titulo] of [
      ["A", padrao, "Vestido Suelen | Ave Rara"],
      ["B", semCor, "Blusa Brisa | Loja B"],
      ["C", semTitulo, "Saia Marola | Loja C"],
      ["D", padrao, "Saia Integrada | Loja D"],
      ["E", padrao, "Vestido Voltado | Loja E"],
    ] as const) {
      fx[k] = await modeloInterno(c);
      await c.query("UPDATE public.modelos SET titulo_pagina = $2 WHERE id = $1", [
        fx[k].id,
        titulo,
      ]);
      await camposLoja(c, campos);
      await marcar(c, fx[k].id);
    }
    await c.query(
      "UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1",
      [fx.D.id],
    );
    for (const k of ["A", "B", "C", "D", "E"] as const)
      expect((await ip(c, fx[k].id)).retrato!.v, k).toBe(3);
    // A: o retrato gravado tem cores "do retrato" (a API ja entregou essas) - P-129: com o campo marcado, vale a do RETRATO
    const ra = (await ip(c, fx.A.id)).retrato!;
    for (const l of variantes(ra))
      l.valores = { ...l.valores, cor_base: "Cor Do Retrato", cor_apelido: "Apelido Do Retrato" };
    await gravaRetrato(c, fx.A.id, ra);
    // B: titulo-base do RETRATO (nunca o vivo): o produto do retrato diz outra coisa que o cadastro
    const rb = (await ip(c, fx.B.id)).retrato!;
    rb.linhas[0].valores = { ...rb.linhas[0].valores, titulo: "Titulo Do Retrato | Loja B" };
    await gravaRetrato(c, fx.B.id, rb);
    // B: cores NAO marcadas -> cadastro VIVO, renomeado depois da marcacao
    await c.query("UPDATE public.cores SET nome = 'Cor Viva B' WHERE id = $1", [fx.B.corId]);
    await c.query("UPDATE public.cores_apelido SET nome = 'Apelido Vivo B' WHERE id = $1", [
      fx.B.apelidoId,
    ]);
    // a 190000 volta (ida) e a loja passa a usar o Apelido no nome (escolha ATUAL)
    await aplicarArquivo(c, R8A!.mig);
    await timeouts(c);
    await skuConfig(c, "cor_apelido");
    return fx;
  }

  it("(a) ida: A/B com sublinhas '<titulo do retrato> <cor> | <loja>'; C so v=4; rev+1, 1 Log cada, assinatura valida; integrado intocado; idempotente", async () => {
    await withTx(async (c) => {
      const fx = await cenario(c);
      const antes = Object.fromEntries(
        await Promise.all(
          (["A", "B", "C", "D", "E"] as const).map(async (k) => [k, await ip(c, fx[k].id)]),
        ),
      );
      const titulosAntes = await titulosApi(c, fx.A.id);
      const n0 = await nLog(c);
      expect(await urgbViva(c, "r8b")).toBe(false);
      const { notices } = await comNotices(c, () => aplicarArquivo(c, MIG));
      await timeouts(c);
      expect(notices.join("\n")).toMatch(/r8b: 4 integravel\(is\) reprocessado\(s\)/);
      expect(await urgbViva(c, "r8b")).toBe(true);

      const esperado: Record<"A" | "B", string> = {
        A: "Vestido Suelen Apelido Do Retrato | Ave Rara",
        B: "Titulo Do Retrato Apelido Vivo B | Loja B",
      };
      expect(
        tituloSublinha("Titulo Do Retrato | Loja B", "Cor Viva B", "Apelido Vivo B", "cor_apelido"),
      ).toBe(esperado.B);
      for (const k of ["A", "B", "C", "E"] as const) {
        const a = antes[k] as Ip;
        const p = await ip(c, fx[k].id);
        expect(p.estado, k).toBe("integravel");
        expect(p.retrato!.v, k).toBe(4);
        expect(p.rev, k).toBe(a.rev + 1);
        expect(p.assinatura, k).toBe(await assinar(c, p.retrato));
        expect(p.assinatura, k).not.toBe(a.assinatura);
        // o resto do retrato byte a byte igual (so v e o titulo das sublinhas mudam)
        expect(semTituloSub(p.retrato!), k).toBe(semTituloSub(a.retrato!));
        const lg = await logs(c, fx[k].id, "titulo_sublinhas_cor");
        expect(lg, k).toHaveLength(1);
        expect(lg[0], k).toMatchObject({
          acao: "editar",
          quem: QUEM,
          detalhe: {
            cor_no_nome: "cor_apelido",
            assinatura_antes: a.assinatura,
            assinatura_depois: p.assinatura,
          },
        });
      }
      for (const k of ["A", "B"] as const) {
        const p = await ip(c, fx[k].id);
        const herdado = (antes[k] as Ip).retrato!.linhas[0].valores.titulo;
        expect(
          variantes(p.retrato!).map((l) => l.valores.titulo),
          k,
        ).toEqual([esperado[k], esperado[k]]);
        expect(p.retrato!.linhas[0].valores.titulo, k).toBe(herdado); // o produto nao muda
        expect(await titulosApi(c, fx[k].id), k).toEqual(
          p.retrato!.linhas.map((l) => [l.tipo, l.valores.titulo]),
        );
        expect((await logs(c, fx[k].id, "titulo_sublinhas_cor"))[0].detalhe, k).toMatchObject({
          sublinhas: 2,
          // antes = o titulo GRAVADO da 1a sublinha (v=3 herdava o do produto; em B o produto do retrato foi adulterado depois)
          exemplo: {
            antes: variantes((antes[k] as Ip).retrato!)[0].valores.titulo,
            depois: esperado[k],
          },
        });
      }
      expect(titulosAntes.slice(1).every(([, t]) => t === "Vestido Suelen | Ave Rara")).toBe(true); // v=3 herdava o do produto
      // C: titulo nao marcado - so v=4 (Ruling 18); sublinhas sem a chave; API intocada
      const pc = await ip(c, fx.C.id);
      for (const l of pc.retrato!.linhas) expect(Object.keys(l.valores)).not.toContain("titulo");
      expect(pc.linhas).toBe((antes.C as Ip).linhas);
      expect((await logs(c, fx.C.id, "titulo_sublinhas_cor"))[0].detalhe).toMatchObject({
        sublinhas: 0,
        exemplo: null,
      });
      // D (integrado) byte a byte igual
      expect(await ip(c, fx.D.id)).toEqual(antes.D);
      expect(await logs(c, fx.D.id, "titulo_sublinhas_cor")).toEqual([]);
      expect((await nLog(c)) - n0).toBe(4);
      // backup: 4 linhas (A, B, C, E), RLS sem policy, ilegivel por anon/authenticated/service_role
      const bk = await um<{
        n: number;
        rls: boolean;
        pol: number;
        anon: boolean;
        auth: boolean;
        srv: boolean;
      }>(
        c,
        `SELECT (SELECT count(*)::int FROM ${BKP} WHERE modelo_id = ANY($1::uuid[])) AS n,
                (SELECT relrowsecurity FROM pg_class WHERE oid = '${BKP}'::regclass) AS rls,
                (SELECT count(*)::int FROM pg_policy WHERE polrelid = '${BKP}'::regclass) AS pol,
                has_table_privilege('anon', '${BKP}', 'SELECT') AS anon,
                has_table_privilege('authenticated', '${BKP}', 'SELECT') AS auth,
                has_table_privilege('service_role', '${BKP}', 'SELECT') AS srv`,
        [[fx.A.id, fx.B.id, fx.C.id, fx.E.id]],
      );
      expect(bk).toEqual({ n: 4, rls: true, pol: 0, anon: false, auth: false, srv: false });
      const b0 = await um<{ t: unknown }>(
        c,
        `SELECT titulos_antes AS t FROM ${BKP} WHERE modelo_id = $1`,
        [fx.A.id],
      );
      expect(b0.t).toEqual(titulosAntes.slice(1).map(([, t], i) => ({ ordem: i + 1, titulo: t })));
      // idempotente: reaplicar = 0 reprocessados, 0 Log
      const n1 = await nLog(c);
      const a1 = await ip(c, fx.A.id);
      const r2 = await comNotices(c, () => aplicarArquivo(c, MIG));
      await timeouts(c);
      expect(r2.notices.join("\n")).toMatch(/r8b: 0 integravel\(is\) reprocessado\(s\)/);
      expect(await nLog(c)).toBe(n1);
      expect(await ip(c, fx.A.id)).toEqual(a1);
    });
  });

  it("(b) _down: devolve retrato/assinatura/titulos da API (rev+1, 1 Log cada); RELATA quem foi voltado; idempotente; _down_drop so depois; ida de novo", async () => {
    await withTx(async (c) => {
      const fx = await cenario(c);
      const antes = Object.fromEntries(
        await Promise.all(
          (["A", "B", "C", "D"] as const).map(async (k) => [k, await ip(c, fx[k].id)]),
        ),
      );
      await aplicarArquivo(c, MIG);
      await timeouts(c);
      // _down_drop com integravel reprocessado RECUSA (o backup e a unica copia do antes)
      const e = await falha(c, () => aplicarArquivo(c, DROP));
      expect(e.code).toBe("P0001");
      expect(e.message).toMatch(/r8b_down_drop: 4 integravel\(is\) ainda reprocessado\(s\)/);
      // E e VOLTADO entre a ida e a volta (fica e e relatado)
      await c.query("SELECT public.integracao_voltar(ARRAY[$1::uuid])", [fx.E.id]);
      const e1 = await ip(c, fx.E.id);
      const n0 = await nLog(c);
      const { notices } = await comNotices(c, () => aplicarArquivo(c, DOWN));
      await timeouts(c);
      const txt = notices.join("\n");
      expect(txt).toContain(`r8b_volta: modelo ${fx.E.id} ficou como esta`);
      expect(txt).toMatch(/r8b_volta: 3 integravel\(is\) devolvido\(s\); 1 relatado\(s\)/);
      for (const k of ["A", "B", "C"] as const) {
        const a = antes[k] as Ip;
        const p = await ip(c, fx[k].id);
        expect(p.retrato_txt, k).toBe(a.retrato_txt);
        expect(p.assinatura, k).toBe(a.assinatura);
        expect(p.rev, k).toBe(a.rev + 2);
        expect(p.linhas, k).toBe(a.linhas); // titulos da API de antes (e o resto da linha)
        const lg = await logs(c, fx[k].id, "titulo_sublinhas_cor_volta");
        expect(lg, k).toHaveLength(1);
        expect(lg[0], k).toMatchObject({
          acao: "editar",
          quem: QUEM_VOLTA,
          detalhe: {
            assinatura_antes: (await logs(c, fx[k].id, "titulo_sublinhas_cor"))[0].detalhe
              .assinatura_depois,
            assinatura_depois: a.assinatura,
          },
        });
      }
      expect(await ip(c, fx.E.id)).toEqual(e1);
      expect(await ip(c, fx.D.id)).toEqual(antes.D);
      expect((await nLog(c)) - n0).toBe(3);
      expect(await urgbViva(c, "r8b")).toBe(false);
      // volta de novo = no-op
      await aplicarArquivo(c, DOWN);
      await timeouts(c);
      expect((await nLog(c)) - n0).toBe(3);
      expect((await ip(c, fx.A.id)).rev).toBe((antes.A as Ip).rev + 2);
      // o backup FICA depois do _down; o _down_drop agora passa
      expect(
        (
          await um<{ n: number }>(
            c,
            `SELECT count(*)::int AS n FROM ${BKP} WHERE modelo_id = ANY($1::uuid[])`,
            [[fx.A.id, fx.E.id]],
          )
        ).n,
      ).toBe(2);
      await aplicarArquivo(c, DROP);
      await timeouts(c);
      expect(
        (await um<{ t: string | null }>(c, `SELECT to_regclass('${BKP}')::text AS t`)).t,
      ).toBeNull();
      // ida de novo (ida -> volta -> ida): recria o backup e reprocessa A/B/C de novo (o retrato voltou a v=3)
      await aplicarArquivo(c, MIG);
      await timeouts(c);
      for (const k of ["A", "B", "C"] as const)
        expect((await ip(c, fx[k].id)).retrato!.v, k).toBe(4);
      expect(await urgbViva(c, "r8b")).toBe(true);
    });
  });

  it("(c) guardas: sem a 190000 viva RECUSA; variante da sublinha sumida do cadastro (cor nao marcada) = RAISE; nada muda", async () => {
    await withTx(async (c) => {
      const fx = await cenario(c);
      await aplicarArquivo(c, R8A!.down);
      await timeouts(c);
      const e1 = await falha(c, () => aplicarArquivo(c, MIG));
      expect(e1.code).toBe("P0001");
      expect(e1.message).toMatch(
        /^r8b: public\._integracao_retrato_core\(uuid,text\[\],jsonb\) com texto inesperado .* exige a 20261103190000/,
      );
      await aplicarArquivo(c, R8A!.mig);
      await timeouts(c);
      // B (cores nao marcadas) com a variante do retrato fora do cadastro
      const rb = (await ip(c, fx.B.id)).retrato!;
      for (const l of variantes(rb)) l.variante_key = "00000000-0000-0000-0000-0000000000b8";
      await gravaRetrato(c, fx.B.id, rb);
      const b0 = await ip(c, fx.B.id);
      const e2 = await falha(c, () => aplicarArquivo(c, MIG));
      expect(e2.code).toBe("P0001");
      expect(e2.message).toMatch(
        new RegExp(
          `^r8b: variante da sublinha nao encontrada no cadastro \\(modelo ${fx.B.id}, ordem 1\\)`,
        ),
      );
      expect(await ip(c, fx.B.id)).toEqual(b0);
      expect((await ip(c, fx.A.id)).retrato!.v).toBe(3);
    });
  });

  it("(d) trava MEDIDA: EXCLUSIVE em integracao_produtos/linhas (como a I3c, sem a config); nada em auth/storage/realtime", async () => {
    await withTx(async (c) => {
      await cenario(c);
      const q = `SELECT n.nspname || '.' || k.relname || '|' || l.mode AS x
                   FROM pg_locks l JOIN pg_class k ON k.oid = l.relation JOIN pg_namespace n ON n.oid = k.relnamespace
                  WHERE l.pid = pg_backend_pid() AND l.granted ORDER BY 1`;
      const antes = new Set((await c.query(q)).rows.map((r) => r.x as string));
      const t0 = Date.now();
      await aplicarArquivo(c, MIG);
      const ms = Date.now() - t0;
      await timeouts(c);
      const novos = (await c.query(q)).rows.map((r) => r.x as string).filter((x) => !antes.has(x));
      console.log(
        `[r8b] trava medida (${ms} ms, 4 integraveis): ${novos.filter((x) => !x.startsWith("pg_catalog.") && !x.includes("_pkey|") && !x.includes("idx_")).join(", ")}`,
      );
      expect(novos).toContain("public.integracao_produtos|ExclusiveLock");
      expect(novos).toContain("public.integracao_linhas|ExclusiveLock");
      expect(
        novos.filter(
          (x) =>
            x.startsWith("public.integracao_config|") &&
            x !== "public.integracao_config|AccessShareLock",
        ),
      ).toEqual([]);
      expect(novos.filter((x) => /^(auth|storage|realtime)\./.test(x))).toEqual([]);
    });
  });

  it("(e) trava MEDIDA do _down_drop: so o proprio backup (sem FK); nada em auth/storage/realtime nem nas tabelas da Integracao", async () => {
    await withTx(async (c) => {
      await timeouts(c);
      await aplicaUrgb(c); // r8a + r8b (pula o que ja esta vivo); o backup passa a existir nesta txn
      await timeouts(c);
      if (await urgbViva(c, "r8b")) await aplicarArquivo(c, DOWN);
      await timeouts(c);
      const q = `SELECT n.nspname || '.' || k.relname || '|' || l.mode AS x
                   FROM pg_locks l JOIN pg_class k ON k.oid = l.relation JOIN pg_namespace n ON n.oid = k.relnamespace
                  WHERE l.pid = pg_backend_pid() AND l.granted ORDER BY 1`;
      const antes = new Set((await c.query(q)).rows.map((r) => r.x as string));
      await aplicarArquivo(c, DROP);
      await timeouts(c);
      const novos = (await c.query(q)).rows.map((r) => r.x as string).filter((x) => !antes.has(x));
      console.log(
        `[r8b] trava medida do _down_drop: ${novos.filter((x) => !x.startsWith("pg_catalog.") && !x.startsWith("pg_toast.")).join(", ")}`,
      );
      expect(novos.filter((x) => /^(auth|storage|realtime)\./.test(x))).toEqual([]);
      expect(novos.filter((x) => /^public\.integracao_\w+\|(?!AccessShareLock)/.test(x))).toEqual(
        [],
      );
      expect(
        (await um<{ t: string | null }>(c, `SELECT to_regclass('${BKP}')::text AS t`)).t,
      ).toBeNull();
    });
  });
});
