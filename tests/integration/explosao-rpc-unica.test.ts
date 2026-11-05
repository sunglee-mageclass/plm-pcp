// Explosão em RPC única (Onda 2): `salvar_explosao(_cad_id, _variantes, _aviamentos, _etiquetas, _rev_base, _enviar)` -> {cad_id, rev, deficit}.
// Substitui as 3 RPCs soltas do Salvar (metragem / aviamento a separar / insumo a enviar) e o "Enviar para PCP" (4 passos) por UMA txn.
// Migration: 20261110100000_explosao_rpc_unica.sql (Task 1). Aqui: o teste de INTEGRAÇÃO, tudo em txn revertida (BEGIN…ROLLBACK) na
// CÓPIA LOCAL — nada é gravado, sem DDL. Seed dentro da própria txn (padrão seg-s3b / deficit-corte-completar).
//
// Como o `rev` é medido (receita `salvaTopo`): as RPCs rodam no NÍVEL DE TOPO da txn (sem SAVEPOINT) nos caminhos de SUCESSO — dentro de
// um SAVEPOINT o xmin das linhas-filhas é uma sub-transação e o "1× por txn" do B2 (fn_colab_bump_cad_*) mediria o harness. O seed do CAD,
// porém, entra DENTRO de um SAVEPOINT já liberado: assim o `xmin` da linha `cad` NÃO é o xid de topo (como um CAD vindo de uma txn
// anterior em produção) e o primeiro UPDATE de uma filha sobe o `cad.rev` de verdade (se o CAD fosse inserido no topo, o gatilho o
// trataria como "já escrito por esta txn" e o delta mediria 0). Erros (P0409/42501/…) abortam a txn, então rodam em SAVEPOINT.
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, semUsuario, semJwt, um, dbUrl, TENANT_TESTE, USER_TESTE } from "./db";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const U_COMUM = "e7a0c1d0-0000-4000-8000-0000000000c2"; // usuário comum (não-admin) da Loja Teste, criado na txn
const RANDOM_CAD = "00000000-0000-4000-8000-0000000000ff";

type PgClient = Client;
type P = { v?: any[]; a?: any[]; e?: any[]; rev?: number | null; enviar?: boolean };
type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };

const SQL_RPC = `select public.salvar_explosao($1::uuid, $2::jsonb, $3::jsonb, $4::jsonb, $5::integer, $6::boolean) as r`;
const argsRpc = (cad: string, p: P) => [cad, JSON.stringify(p.v ?? []), JSON.stringify(p.a ?? []), JSON.stringify(p.e ?? []), p.rev ?? null, p.enviar ?? false];

/** Chama a RPC no NÍVEL DE TOPO (sucesso). `role` opcional: troca p/ o papel do PostgREST só durante a chamada. */
async function salvaTopo(c: PgClient, cad: string, p: P, role?: "authenticated"): Promise<any> {
  if (role) await c.query(`SET LOCAL ROLE ${role}`);
  try {
    return (await c.query(SQL_RPC, argsRpc(cad, p))).rows[0].r;
  } finally {
    if (role) await c.query("RESET ROLE");
  }
}
/** Roda `sql` num SAVEPOINT (erro volta ao savepoint e vira dado) opcionalmente como `role` (authenticated/anon). */
async function como(c: PgClient, role: "authenticated" | "anon" | null, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT erx");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT erx");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT erx");
    await c.query("RELEASE SAVEPOINT erx");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
const salvaErro = (c: PgClient, cad: string, p: P, role: "authenticated" | null = null) => como(c, role, SQL_RPC, argsRpc(cad, p));
function falha(r: Res): { code: string; msg: string } {
  if (r.ok) throw new Error("esperava ERRO, mas a RPC passou: " + JSON.stringify(r.rows));
  return r;
}

// ───────────────────────────────────────────── fixture (como postgres, sem JWT) ─────────────────────────────────────────────
type Fx = {
  art: string; vA: string; vB: string; modelo: string; cad: string; ct: string; ctvA: string; ctvB: string;
  avi: string; aviRows: string[]; etq: string; oc: string;
};
/**
 * CAD da Loja Teste com 1 tecido (2 variantes: A com 30 m em estoque, B com 100 m), 1 aviamento em 2 entradas (numero 1 e 2, a separar 4
 * em cada), 1 insumo (a enviar 3) e metragem/folhas iniciais (7 / 2). Dentro de SAVEPOINT liberado (ver cabeçalho).
 */
async function fixture(c: PgClient): Promise<Fx> {
  await c.query("SAVEPOINT fx");
  const fx = await semJwt(c, async () => {
    const id = async (sql: string, p: any[]) => (await um<{ id: string }>(c, sql, p)).id;
    const art = await id(`insert into artigos (tenant_id, nome, unidade_medida) values ($1, 'ITEST SE tecido', 'metro') returning id`, [T]);
    const vt = (n: string) => id(`insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1, $2, $3) returning id`, [T, art, n]);
    const vA = await vt("SE-A");
    const vB = await vt("SE-B");
    // estoque: 1 OC recebida (data antiga) com 30 m da variante A e 100 m da B (saldo_oc_item_m = recebida - baixas)
    const oc = await id(
      `insert into ocs_tecido (tenant_id, status, numero_pedido, data_pedido, data_entrega) values ($1, 'recebido', 'ITEST-SE', '2026-01-01', '2026-01-01') returning id`, [T]);
    await c.query(
      `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, variante_tecido_id, quantidade_pedida, quantidade_recebida) values ($1,$2,$3,30,30), ($1,$2,$4,100,100)`,
      [oc, art, vA, vB]);
    const modelo = await id(`insert into modelos (tenant_id, nome) values ($1, 'ITEST-SE card') returning id`, [T]);
    const cad = await id(`insert into cad (tenant_id, modelo_id) values ($1, $2) returning id`, [T, modelo]);
    const ct = await id(`insert into cad_tecidos (cad_id, artigo_id, numero, tipo) values ($1, $2, 1, 'tecido') returning id`, [cad, art]);
    const ctv = (v: string, ordem: number) => id(
      `insert into cad_tecido_variantes (cad_tecido_id, variante_tecido_id, ordem, metragem_enviada, quantidade_folhas) values ($1,$2,$3,7,2) returning id`, [ct, v, ordem]);
    const ctvA = await ctv(vA, 1);
    const ctvB = await ctv(vB, 2);
    const avi = await id(`select id from aviamentos where tenant_id = $1 order by id limit 1`, [T]); // Loja Teste da cópia tem aviamentos
    const aviRows: string[] = [];
    for (const n of [1, 2]) {
      aviRows.push(await id(`insert into cad_aviamentos (cad_id, aviamento_id, numero, quantidade_separar) values ($1, $2, $3, 4) returning id`, [cad, avi, n]));
    }
    const etq = await id(`insert into cad_etiquetas (cad_id, quantidade_enviar) values ($1, 3) returning id`, [cad]);
    return { art, vA, vB, modelo, cad, ct, ctvA, ctvB, avi, aviRows, etq, oc };
  });
  await c.query("RELEASE SAVEPOINT fx");
  return fx;
}

type Estado = { ctv: Record<string, [number | null, number | null]>; avi: number[]; etq: number | null; rev: number; baixas: number; enviadoCorte: boolean };
/** Foto do que o Salvar toca (lida como postgres, fora de qualquer papel). */
async function estado(c: PgClient, fx: Fx): Promise<Estado> {
  const ctv = await c.query(
    `select id, metragem_enviada::float8 m, quantidade_folhas f from public.cad_tecido_variantes where cad_tecido_id = $1`, [fx.ct]);
  const avi = await c.query(`select quantidade_separar::float8 q from public.cad_aviamentos where cad_id = $1 order by numero`, [fx.cad]);
  const etq = await um<{ q: number | null }>(c, `select quantidade_enviar::float8 q from public.cad_etiquetas where id = $1`, [fx.etq]);
  const cad = await um<{ rev: number; enviado_corte: boolean | null }>(c, `select rev, enviado_corte from public.cad where id = $1`, [fx.cad]);
  const bx = await um<{ n: string }>(c, `select count(*)::text n from public.estoque_tecido_baixas where cad_id = $1`, [fx.cad]);
  return {
    ctv: Object.fromEntries(ctv.rows.map((r: any) => [r.id, [r.m, r.f]])),
    avi: avi.rows.map((r: any) => r.q),
    etq: etq.q,
    rev: cad.rev,
    baixas: Number(bx.n),
    enviadoCorte: !!cad.enviado_corte,
  };
}
/** `estado` sem o `rev` (p/ afirmar "nada gravou" independente do contador). */
const dados = ({ rev: _rev, ...resto }: Estado) => resto;

// ───────────────────────────────────────── usuário comum + portões (módulo / página) ─────────────────────────────────────────
async function usuarioComum(c: PgClient, paginas: [string, boolean][]): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U_COMUM, `${U_COMUM}@teste`]);
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'SE comum', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [U_COMUM, T, `${U_COMUM}@teste`]);
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]);
    for (const [pagina, editar] of paginas) {
      await c.query(
        `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, $4)`,
        [U_COMUM, T, pagina, editar]);
    }
  });
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U_COMUM, role: "authenticated" })]);
}
/** Liga/desliga um módulo da Loja Teste (como manutenção: com JWT só o super admin muda `modules`). */
async function modulo(c: PgClient, chave: string, ligado: boolean): Promise<void> {
  await semJwt(c, () => c.query(
    `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || jsonb_build_object($2::text, $3::boolean) WHERE tenant_id = $1`,
    [T, chave, ligado]));
}
async function modulosLigados(c: PgClient): Promise<void> {
  for (const m of ["criacao", "entrada_saida", "producao"]) await modulo(c, m, true);
}
const EDITA_EXPLOSAO: [string, boolean][] = [["producao_explosao", true]];

// Valores novos usados nos casos (fixture parte de: metragem 7 / folhas 2 em A e B; aviamento 4+4; insumo 3).
const V_NOVO = (fx: Fx) => [
  { id: fx.ctvA, metragem_enviada: 12.5, quantidade_folhas: 3 },
  { id: fx.ctvB, metragem_enviada: 9 }, // sem folhas: mantém as 2 (COALESCE)
];
const A_NOVO = (fx: Fx) => [{ aviamento_id: fx.avi, quantidade_separar: 9 }];
const E_NOVO = (fx: Fx) => [{ id: fx.etq, quantidade_enviar: 6 }];

describe.skipIf(!RODA)("salvar_explosao — RPC única atômica (txn revertida, cópia local)", () => {
  // ═════════════════════════════════════════════ 1 · atomicidade do Salvar ═════════════════════════════════════════════
  it("1. _enviar=false: UMA chamada grava metragem + aviamento + insumo; rev sobe EXATAMENTE +1; sem baixa; deficit=[]", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const fx = await fixture(c);
      await usuarioComum(c, EDITA_EXPLOSAO); // roda como o usuário comum, no papel authenticated (PostgREST real)
      const antes = await estado(c, fx);
      expect(antes.ctv[fx.ctvA]).toEqual([7, 2]);
      expect(antes.avi).toEqual([4, 4]);
      expect(antes.etq).toBe(3);

      const r = await salvaTopo(c, fx.cad, { v: V_NOVO(fx), a: A_NOVO(fx), e: E_NOVO(fx), rev: antes.rev }, "authenticated");

      const depois = await estado(c, fx);
      // as 3 seções gravaram na MESMA chamada
      expect(depois.ctv[fx.ctvA]).toEqual([12.5, 3]);
      expect(depois.ctv[fx.ctvB]).toEqual([9, 2]); // folhas ausentes no payload = mantém
      expect(depois.avi).toEqual([9, 0]); // cheio na MENOR numero do grupo, o resto zera (Σ = valor)
      expect(depois.etq).toBe(6);
      // rev: 1× por txn (B2) — header das filhas (ctv + avi + etq) soma UMA vez, não 4
      expect(depois.rev - antes.rev).toBe(1);
      // sem _enviar: nenhuma baixa e o CAD não é marcado como enviado ao corte
      expect(depois.baixas).toBe(0);
      expect(depois.enviadoCorte).toBe(false);
      expect(r).toEqual({ cad_id: fx.cad, rev: depois.rev, deficit: [] });
    });
  });

  it("1b. _rev_base correto passa; _rev_base NULL (legado) não confere; chamada só com o cad (defaults) é no-op", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const fx = await fixture(c);
      const s0 = await estado(c, fx);
      const r0 = (await c.query(`select public.salvar_explosao($1) as r`, [fx.cad])).rows[0].r; // só o cad
      expect(r0).toEqual({ cad_id: fx.cad, rev: s0.rev, deficit: [] }); // nenhum UPDATE -> rev não mexe
      expect(await estado(c, fx)).toEqual(s0);
      // _rev_base NULL: grava mesmo com o contador "à frente" de qualquer base
      const r1 = await salvaTopo(c, fx.cad, { e: E_NOVO(fx), rev: null });
      expect((await estado(c, fx)).etq).toBe(6);
      expect(r1.rev).toBe(s0.rev + 1);
      // _rev_base = rev atual: passa
      await salvaTopo(c, fx.cad, { e: [{ id: fx.etq, quantidade_enviar: 8 }], rev: r1.rev });
      expect((await estado(c, fx)).etq).toBe(8);
    });
  });

  // ═════════════════════════════════════════════ 2 · P0409 único ═════════════════════════════════════════════
  it("2a. _rev_base velho (cad.rev bumpado por outra escrita) -> P0409 conflito_versao e NADA grava em nenhuma das 3 seções", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const fx = await fixture(c);
      const base = (await estado(c, fx)).rev;
      // "outra pessoa" salvou o CAD depois que eu carreguei (UPDATE direto no cad = BEFORE UPDATE do rev)
      await c.query(`update public.cad set id = id where id = $1`, [fx.cad]);
      const meio = await estado(c, fx);
      expect(meio.rev).toBe(base + 1);

      const e = falha(await salvaErro(c, fx.cad, { v: V_NOVO(fx), a: A_NOVO(fx), e: E_NOVO(fx), rev: base }));
      expect(e.code).toBe("P0409");
      expect(e.msg).toMatch(/^conflito_versao/);
      expect(await estado(c, fx)).toEqual(meio); // nada gravou (inclui rev e baixas)

      // com o rev ATUAL a mesma carga passa (o P0409 era só o conflito)
      await salvaTopo(c, fx.cad, { v: V_NOVO(fx), a: A_NOVO(fx), e: E_NOVO(fx), rev: meio.rev });
      expect((await estado(c, fx)).avi).toEqual([9, 0]);
    });
  });

  it("2b. 'só mandei metragem, mas o rev mudou por aviamento alheio' -> P0409 (o rev é do CAD inteiro) e a metragem NÃO grava", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const fx = await fixture(c);
      const base = (await estado(c, fx)).rev;
      // OUTRA pessoa edita só o aviamento (filha) -> o gatilho B2 sobe o cad.rev
      await c.query(`update public.cad_aviamentos set quantidade_separar = 11 where id = $1`, [fx.aviRows[0]]);
      const meio = await estado(c, fx);
      expect(meio.rev).toBe(base + 1); // o aviamento alheio bumpou o rev do cad
      expect(meio.avi[0]).toBe(11);

      // eu mando SÓ metragem (aviamentos/etiquetas vazios) com a base velha
      const e = falha(await salvaErro(c, fx.cad, { v: V_NOVO(fx), rev: base }));
      expect(e.code).toBe("P0409");
      const depois = await estado(c, fx);
      expect(depois).toEqual(meio);
      expect(depois.ctv[fx.ctvA]).toEqual([7, 2]); // metragem intacta
      expect(depois.avi[0]).toBe(11); // aviamento alheio preservado (não houve lost-update)
    });
  });

  it("2c. cad inexistente -> P0002 nao_encontrado: cad; sem autenticação -> 42501", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const fx = await fixture(c);
      const e = falha(await salvaErro(c, RANDOM_CAD, {}));
      expect(e.code).toBe("P0002");
      expect(e.msg).toBe("nao_encontrado: cad");
      await semUsuario(c);
      const u = falha(await salvaErro(c, fx.cad, {}));
      expect(u.code).toBe("42501");
      expect(u.msg).toMatch(/Nao autenticado/);
    });
  });

  // ═════════════════════════════════════════════ 3 · seção vazia é no-op ═════════════════════════════════════════════
  it("3. seção vazia é no-op: _variantes:[] / _aviamentos:[] / _etiquetas:[] NÃO zeram o que já existe; cada seção sozinha só mexe nela", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const fx = await fixture(c);
      const s0 = await estado(c, fx);

      // tudo vazio: nada muda (nem rev: nenhum UPDATE)
      await salvaTopo(c, fx.cad, { v: [], a: [], e: [], rev: s0.rev });
      expect(await estado(c, fx)).toEqual(s0);

      // SÓ aviamento: metragem e insumo ficam
      await salvaTopo(c, fx.cad, { a: A_NOVO(fx), v: [], e: [] });
      const s1 = await estado(c, fx);
      expect(s1.avi).toEqual([9, 0]);
      expect(s1.ctv).toEqual(s0.ctv);
      expect(s1.etq).toBe(3);

      // SÓ insumo: metragem e aviamento (já editado) ficam
      await salvaTopo(c, fx.cad, { e: E_NOVO(fx), v: [], a: [] });
      const s2 = await estado(c, fx);
      expect(s2.etq).toBe(6);
      expect(s2.avi).toEqual([9, 0]);
      expect(s2.ctv).toEqual(s0.ctv);

      // SÓ metragem: aviamento e insumo ficam
      await salvaTopo(c, fx.cad, { v: V_NOVO(fx), a: [], e: [] });
      const s3 = await estado(c, fx);
      expect(s3.ctv[fx.ctvA]).toEqual([12.5, 3]);
      expect(s3.avi).toEqual([9, 0]);
      expect(s3.etq).toBe(6);
    });
  });

  // ═════════════════════════════════════════════ 4 · enviar (_enviar=true) ═════════════════════════════════════════════
  it("4. _enviar=true: grava as 3 seções + baixa o estoque na MESMA txn; deficit não vazio quando metragem > estoque; baixas origem='fifo'", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const fx = await fixture(c);
      const antes = await estado(c, fx);
      expect(antes.baixas).toBe(0);

      // A: 40 m enviados mas só 30 em estoque (faltam 10). B: 5 m de 100 em estoque (cobre).
      const v = [{ id: fx.ctvA, metragem_enviada: 40, quantidade_folhas: 4 }, { id: fx.ctvB, metragem_enviada: 5 }];
      const r = await salvaTopo(c, fx.cad, { v, a: A_NOVO(fx), e: E_NOVO(fx), rev: antes.rev, enviar: true });

      const depois = await estado(c, fx);
      // as 3 seções + a baixa na mesma chamada
      expect(depois.ctv[fx.ctvA]).toEqual([40, 4]);
      expect(depois.ctv[fx.ctvB]).toEqual([5, 2]);
      expect(depois.avi).toEqual([9, 0]);
      expect(depois.etq).toBe(6);
      expect(depois.enviadoCorte).toBe(true); // o _core marca o envio ao corte na mesma txn
      // retorno: deficit é array NÃO vazio (só a variante A faltou), e o rev devolvido é o final (pós-bump)
      expect(Array.isArray(r.deficit)).toBe(true);
      expect(r.deficit).toHaveLength(1);
      expect(Number(r.deficit[0].enviada)).toBe(40);
      expect(Number(r.deficit[0].baixada)).toBe(30);
      expect(Number(r.deficit[0].deficit)).toBe(10);
      expect(r.cad_id).toBe(fx.cad);
      expect(r.rev).toBe(depois.rev);
      // rev sobe (o salvar soma 1; o _core ainda faz UPDATEs diretos no cad: enviado_corte / deficit_corte) e vale o contador FINAL
      expect(depois.rev).toBeGreaterThan(antes.rev);
      // estoque_tecido_baixas ganhou linhas FIFO: 30 (A) + 5 (B)
      const bx = await c.query(
        `select variante_tecido_id v, origem, quantidade::float8 q from public.estoque_tecido_baixas where cad_id = $1 order by quantidade desc`, [fx.cad]);
      expect(bx.rows.map((x: any) => [x.v, x.origem, x.q])).toEqual([[fx.vA, "fifo", 30], [fx.vB, "fifo", 5]]);
      // déficit persistido no cad (mesma fonte do chip "Faltou estoque")
      const dc = await um<{ d: any }>(c, `select deficit_corte d from public.cad where id = $1`, [fx.cad]);
      expect(Number(dc.d[0].deficit)).toBe(10);
    });
  });

  it("4b. _enviar=true com estoque suficiente: deficit=[] e deficit_corte limpo; reenviar é idempotente (baixas regravadas, não dobradas)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const fx = await fixture(c);
      const v = [{ id: fx.ctvA, metragem_enviada: 20 }, { id: fx.ctvB, metragem_enviada: 5 }];
      const r1 = await salvaTopo(c, fx.cad, { v, enviar: true });
      expect(r1.deficit).toEqual([]);
      const s1 = await estado(c, fx);
      expect(s1.baixas).toBe(2);
      expect((await um<{ d: any }>(c, `select deficit_corte d from public.cad where id = $1`, [fx.cad])).d).toBeNull();
      const r2 = await salvaTopo(c, fx.cad, { enviar: true, rev: r1.rev }); // reenvio sem seções
      expect(r2.deficit).toEqual([]);
      expect((await estado(c, fx)).baixas).toBe(2);
    });
  });

  it("4c. _enviar=true com rev velho -> P0409 ANTES de gravar/baixar: nenhuma baixa, nada marcado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const fx = await fixture(c);
      const base = (await estado(c, fx)).rev;
      await c.query(`update public.cad set id = id where id = $1`, [fx.cad]);
      const meio = await estado(c, fx);
      const e = falha(await salvaErro(c, fx.cad, { v: V_NOVO(fx), a: A_NOVO(fx), e: E_NOVO(fx), rev: base, enviar: true }));
      expect(e.code).toBe("P0409");
      expect(await estado(c, fx)).toEqual(meio);
      expect(meio.baixas).toBe(0);
      expect(meio.enviadoCorte).toBe(false);
    });
  });

  // ═════════════════════════════════════════════ 5 · portões ═════════════════════════════════════════════
  it("5a. sem editar a página producao_explosao (só ver, ou sem a página) -> 42501 sem_permissao_pagina; nada grava", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const fx = await fixture(c);
      await modulosLigados(c);
      const s0 = await estado(c, fx);
      const carga: P = { v: V_NOVO(fx), a: A_NOVO(fx), e: E_NOVO(fx), enviar: true };

      await usuarioComum(c, [["producao_explosao", false]]); // só VÊ
      const e1 = falha(await salvaErro(c, fx.cad, carga, "authenticated"));
      expect(e1.code).toBe("42501");
      expect(e1.msg).toBe("sem_permissao_pagina: producao_explosao");

      await usuarioComum(c, [["producao_expedicao", true]]); // edita OUTRA página
      const e2 = falha(await salvaErro(c, fx.cad, carga, "authenticated"));
      expect(e2.code).toBe("42501");
      expect(e2.msg).toBe("sem_permissao_pagina: producao_explosao");

      expect(await estado(c, fx)).toEqual(s0);

      // com EDITAR passa (prova que o portão era o único impedimento)
      await usuarioComum(c, EDITA_EXPLOSAO);
      await salvaTopo(c, fx.cad, { e: E_NOVO(fx) }, "authenticated");
      expect((await estado(c, fx)).etq).toBe(6);
    });
  });

  it("5b. módulo entrada_saida desligado (usuário comum; super fura) -> 42501 modulo_desligado: entrada_saida; criacao desligado -> 42501", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const fx = await fixture(c);
      await modulosLigados(c);
      const s0 = await estado(c, fx);
      await usuarioComum(c, EDITA_EXPLOSAO); // tem a página: só o MÓDULO barra

      await modulo(c, "entrada_saida", false);
      const e1 = falha(await salvaErro(c, fx.cad, { v: V_NOVO(fx), a: A_NOVO(fx), e: E_NOVO(fx) }, "authenticated"));
      expect(e1.code).toBe("42501");
      expect(e1.msg).toBe("modulo_desligado: entrada_saida");

      await modulo(c, "entrada_saida", true);
      await modulo(c, "criacao", false);
      const e2 = falha(await salvaErro(c, fx.cad, { v: V_NOVO(fx) }, "authenticated"));
      expect(e2.code).toBe("42501");
      expect(e2.msg).toMatch(/criacao nao habilitado/);

      expect(await estado(c, fx)).toEqual(s0);

      // religado: passa
      await modulo(c, "criacao", true);
      await salvaTopo(c, fx.cad, { e: E_NOVO(fx) }, "authenticated");
      expect((await estado(c, fx)).etq).toBe(6);
    });
  });

  it("5c. cad de OUTRA loja: usuário comum -> 42501 Sem permissao para este CAD (nada grava); o super admin da plataforma passa", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await fixture(c); // garante o estado padrão da txn
      await modulosLigados(c);
      const alheio = await semJwt(c, async () => {
        const outra = (await um<{ id: string }>(c, `select id from public.tenants where id <> $1 order by id limit 1`, [T])).id;
        const m = (await um<{ id: string }>(c, `insert into public.modelos (tenant_id, nome) values ($1, 'ITEST-SE alheio') returning id`, [outra])).id;
        const cad = (await um<{ id: string }>(c, `insert into public.cad (tenant_id, modelo_id) values ($1, $2) returning id`, [outra, m])).id;
        const ct = (await um<{ id: string }>(c, `insert into public.cad_tecidos (cad_id, numero, tipo) values ($1, 1, 'tecido') returning id`, [cad])).id;
        const ctv = (await um<{ id: string }>(c, `insert into public.cad_tecido_variantes (cad_tecido_id, ordem, metragem_enviada) values ($1, 1, 7) returning id`, [ct])).id;
        return { cad, ctv, outra };
      });
      await usuarioComum(c, EDITA_EXPLOSAO);
      const e = falha(await salvaErro(c, alheio.cad, { v: [{ id: alheio.ctv, metragem_enviada: 99 }] }, "authenticated"));
      expect(e.code).toBe("42501");
      expect(e.msg).toBe("Sem permissao para este CAD");
      const m = await um<{ m: number }>(c, `select metragem_enviada::float8 m from public.cad_tecido_variantes where id = $1`, [alheio.ctv]);
      expect(m.m).toBe(7);

      // contraprova: o super admin atravessa lojas (is_super_admin) e grava no cad alheio
      await comoUsuario(c, USER_TESTE);
      await salvaTopo(c, alheio.cad, { v: [{ id: alheio.ctv, metragem_enviada: 99 }] });
      expect((await um<{ m: number }>(c, `select metragem_enviada::float8 m from public.cad_tecido_variantes where id = $1`, [alheio.ctv])).m).toBe(99);
    });
  });

  it("5d. anon não executa a RPC (permission denied); authenticated executa", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const fx = await fixture(c);
      const r = await salvaErro(c, fx.cad, {}, null);
      expect(r.ok).toBe(true); // postgres (sem papel) só p/ garantir que a chamada em si é válida
      await c.query("SAVEPOINT an");
      await c.query("SET LOCAL ROLE anon");
      let erro: any;
      try {
        await c.query(SQL_RPC, argsRpc(fx.cad, {}));
      } catch (e) {
        erro = e;
      }
      await c.query("ROLLBACK TO SAVEPOINT an");
      await c.query("RELEASE SAVEPOINT an");
      expect(erro?.code).toBe("42501");
      expect(String(erro?.message)).toMatch(/permission denied for function salvar_explosao/);
    });
  });

  // ═════════════════════════════════════════════ 6 · ACL dos _core ═════════════════════════════════════════════
  it("6. ACL: os 3 _core NÃO são executáveis por anon/authenticated/PUBLIC (nem na prática); salvar_explosao: anon não, authenticated/service_role sim", async () => {
    await withTx(async (c) => {
      const cores = [
        "public._salvar_explosao_metragem_core(uuid,jsonb)",
        "public._salvar_explosao_aviamento_separar_core(uuid,jsonb)",
        "public._salvar_explosao_etiqueta_enviar_core(uuid,jsonb)",
      ];
      for (const f of cores) {
        for (const papel of ["anon", "authenticated"]) {
          const p = await um<{ ok: boolean }>(c, `select has_function_privilege($1, $2, 'EXECUTE') ok`, [papel, f]);
          expect(p.ok, `${papel} executa ${f}`).toBe(false);
        }
        // PUBLIC (aclexplode grantee 0) também não pode ter
        const pub = await um<{ n: string }>(
          c,
          `select count(*)::text n from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'`, [f]);
        expect(Number(pub.n), `PUBLIC executa ${f}`).toBe(0);
      }
      // na prática: authenticated chamando o _core direto leva permission denied
      await comoUsuario(c);
      const direto = await como(c, "authenticated", `select public._salvar_explosao_metragem_core($1::uuid, '[]'::jsonb)`, [RANDOM_CAD]);
      const d = falha(direto);
      expect(d.code).toBe("42501");
      expect(d.msg).toMatch(/permission denied for function _salvar_explosao_metragem_core/);

      const rpc = "public.salvar_explosao(uuid,jsonb,jsonb,jsonb,integer,boolean)";
      const pr = async (papel: string) => (await um<{ ok: boolean }>(c, `select has_function_privilege($1, $2, 'EXECUTE') ok`, [papel, rpc])).ok;
      expect(await pr("anon")).toBe(false);
      expect(await pr("authenticated")).toBe(true);
      expect(await pr("service_role")).toBe(true);
    });
  });

  // ═════════════════════════════════════════════ 7 · 2 conexões (serialização) ═════════════════════════════════════════════
  it("7. duas conexões no MESMO cad: a 2ª ESPERA a 1ª (FOR UPDATE do _explosao_check_rev) — não há lost-update (lock_timeout 55P03)", async () => {
    // Sem COMMIT não dá p/ mostrar o P0409 PÓS-commit da 1ª (a 1ª só reverte). O que dá p/ provar em txn revertida é a SERIALIZAÇÃO: com a 1ª
    // txn aberta (segurando a linha do cad), a 2ª bloqueia no check de rev — se não bloqueasse, as duas leriam a mesma base e gravariam por cima.
    await withTx(async (c) => {
      await comoUsuario(c);
      const alvo = await um<{ id: string; rev: number }>(c, `select id, rev from public.cad where tenant_id = $1 order by id limit 1`, [T]);
      if (!alvo) throw new Error("fixture ausente: a Loja Teste da cópia não tem nenhum CAD"); // nunca passa vazio
      const base = alvo.rev;
      await salvaTopo(c, alvo.id, { rev: base }); // 1ª conexão: check_rev -> FOR UPDATE (sem escrever); segura o lock até o ROLLBACK

      const b = new Client({ connectionString: dbUrl()!, ssl: false });
      await b.connect();
      try {
        await b.query("BEGIN");
        await b.query("SET LOCAL lock_timeout = '600ms'");
        // super admin (não toca users.tenant_id, que a 1ª conexão está segurando)
        await b.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USER_TESTE, role: "authenticated" })]);
        await b.query("SAVEPOINT s2");
        let erro: any;
        try {
          await b.query(SQL_RPC, argsRpc(alvo.id, { rev: base }));
        } catch (e) {
          erro = e;
        }
        await b.query("ROLLBACK TO SAVEPOINT s2");
        expect(erro?.code).toBe("55P03"); // lock_not_available: ficou esperando a 1ª
      } finally {
        try { await b.query("ROLLBACK"); } catch { /* ignore */ }
        await b.end();
      }
    });
  });
});
