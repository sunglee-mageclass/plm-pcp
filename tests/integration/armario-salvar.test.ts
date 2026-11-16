/**
 * F7 Armario - Task C2 (banco): RPC de ESCRITA `armario_salvar` + `_armario_salvar_core` (migration 20261202130000). BEGIN...ROLLBACK,
 * SO na copia local (A1 + A2 + C2 aplicadas DENTRO da txn pelo harness `aplicarArquivo` - sem BEGIN/COMMIT, NUNCA \i). Pinos:
 *  - cria cabecalho + itens EM ORDEM (ordem 1..N); salvar de novo = estado completo (reordena, remove, troca);
 *  - ACEITA lista vazia ('[]' / null) - nao recusa como a Camada C1; colunas mudadas NAO mexem na ordem dos itens;
 *  - RECUSA armario PUBLICADO (P0001 armario_publicado_travado), mesmo chamando como o papel do cliente;
 *  - RECUSA item SEM ponteiro (P0001 armario_item_sem_variante); ponteiro de outra origem / de outro produto / de outra loja = recusa;
 *  - snapshot de cor DERIVADO no servidor (cor errada no payload e ignorada) nas 3 origens; "cor removida" (ponteiro orfao de item ja
 *    gravado) preserva o snapshot e nao trava o salvar;
 *  - de-dup: mesma variante 2x = P0001 armario_item_duplicado; usuario SEM a pagina criacao_armario = 42501; modulo criacao desligado = 42501;
 *    sem login = 42501; ANTI-CROSS-TENANT (armario/colecao/modelo de outra loja = recusa);
 *  - anti-drift: _core sem EXECUTE para anon/authenticated/PUBLIC; wrapper so authenticated/service_role; rollback remove as 2 funcoes.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, semUsuario, semJwt, um, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const MIG = "supabase/migrations/20261202130000_armario_salvar.sql";
const DOWN = "supabase/rollback/20261202130000_armario_salvar_down.sql";
const U_COMUM = "f7c20000-0000-4000-8000-0000000000c1";
const WRAP = "public.armario_salvar(uuid,uuid,text,text,text,integer,text,jsonb)";
const CORE = "public._armario_salvar_core(uuid,uuid,text,text,text,integer,text,jsonb)";

async function aplica(c: Client): Promise<void> {
  await aplicarArquivo(c, "supabase/migrations/20261202100000_armario_tabelas.sql");
  await aplicarArquivo(c, "supabase/migrations/20261202110000_armario_trava_publicado.sql");
  await aplicarArquivo(c, MIG);
}

const id = async (c: Client, sql: string, p: unknown[] = []) => (await um<{ id: string }>(c, sql + " RETURNING id", p)).id;

interface Seed {
  outroTenant: string;
  colA: string; colOutra: string;
  cor1: string; cor2: string; cor3: string; ap1: string; ap2: string;
  mInt: string; mInt2: string; mRev: string; mImp: string; mOutroTenant: string;
  vt1: string; vt2: string; vtT2: string; vtSemCor: string; vtOutro: string;
  pav1: string; pav2: string; pavOutroProd: string; piv1: string;
}

async function semeia(c: Client): Promise<Seed> {
  const outroTenant = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 LIMIT 1", [T])).id;
  const colA = await id(c, `INSERT INTO public.colecoes (tenant_id, nome) VALUES ($1, 'Col F7 C2')`, [T]);
  const colOutra = await id(c, `INSERT INTO public.colecoes (tenant_id, nome) VALUES ($1, 'Col F7 C2 Outra')`, [outroTenant]);
  const cor = (n: string, t = T) => id(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, $2)`, [t, n]);
  const cor1 = await cor("Azul C2"), cor2 = await cor("Verde C2"), cor3 = await cor("Rosa C2");
  const ap = (n: string, base: string) => id(c, `INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id) VALUES ($1, $2, $3)`, [T, n, base]);
  const ap1 = await ap("Mar C2", cor1), ap2 = await ap("Ceu C2", cor1);

  const mod = (nome: string, origem: string, tenant = T) =>
    id(c, `INSERT INTO public.modelos (tenant_id, nome, origem, colecao_id, subcolecao) VALUES ($1, $2, $3, $4, 'Sub C2')`, [tenant, nome, origem, tenant === T ? colA : colOutra]);
  const vt = (cor: string | null, apel: string | null, tenant = T) =>
    id(c, `INSERT INTO public.variantes_tecido (tenant_id, cor_id, cor_apelido_id) VALUES ($1, $2, $3)`, [tenant, cor, apel]);
  const mt = (modelo: string, numero: number) => id(c, `INSERT INTO public.modelo_tecidos (modelo_id, numero, tipo) VALUES ($1, $2, 'tecido')`, [modelo, numero]);
  const link = (m: string, v: string, ordem: number) =>
    c.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, $3)`, [m, v, ordem]);

  const mInt = await mod("A Int C2", "interno");
  const vt1 = await vt(cor1, ap1), vt2 = await vt(cor2, null), vtSemCor = await vt(null, null), vtOutro = await vt(cor3, null);
  const t1 = await mt(mInt, 1);
  const t2 = await mt(mInt, 2);
  await link(t1, vt1, 1); await link(t1, vt2, 2); await link(t1, vtSemCor, 3);
  const vtT2 = await vt(cor3, ap2);
  await link(t2, vtT2, 1); // Tecido 2: NAO e variante oferecida
  const mInt2 = await mod("A2 Int C2", "interno");
  await link(await mt(mInt2, 1), vtOutro, 1);

  const mRev = await mod("B Rev C2", "revenda");
  const pa = await id(c, `INSERT INTO public.produtos_acabados (tenant_id, modelo_id, nome) VALUES ($1, $2, 'PA C2')`, [T, mRev]);
  const pav = (prod: string, ordem: number, corx: string | null, apel: string | null) =>
    id(c, `INSERT INTO public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id) VALUES ($1, $2, $3, $4, $5)`, [T, prod, ordem, corx, apel]);
  const pav1 = await pav(pa, 1, cor1, ap2), pav2 = await pav(pa, 2, cor2, null);
  const mRev2 = await mod("B2 Rev C2", "revenda");
  const pa2 = await id(c, `INSERT INTO public.produtos_acabados (tenant_id, modelo_id, nome) VALUES ($1, $2, 'PA2 C2')`, [T, mRev2]);
  const pavOutroProd = await pav(pa2, 1, cor3, null);

  const mImp = await mod("C Imp C2", "importado");
  const pi = await id(c, `INSERT INTO public.produtos_importados (tenant_id, modelo_id, nome) VALUES ($1, $2, 'PI C2')`, [T, mImp]);
  const piv1 = await id(c, `INSERT INTO public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id) VALUES ($1, $2, 1, $3, $4)`, [T, pi, cor1, ap1]);

  const mOutroTenant = await mod("X OutroTenant C2", "interno", outroTenant);
  return { outroTenant, colA, colOutra, cor1, cor2, cor3, ap1, ap2, mInt, mInt2, mRev, mImp, mOutroTenant, vt1, vt2, vtT2, vtSemCor, vtOutro, pav1, pav2, pavOutroProd, piv1 };
}

type Res = { ok: true; id: string } | { ok: false; code: string; msg: string };
/** Chama o wrapper como `authenticated` (PostgREST real). Sucesso PERSISTE na txn; erro volta ao savepoint. */
async function salva(
  c: Client, s: Seed, itens: unknown, o: { id?: string | null; nome?: string; colunas?: number | null; status?: string | null; colecao_id?: string | null; sub?: string } = {},
): Promise<Res> {
  await c.query("SAVEPOINT arm_s");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const r = await um<{ r: string }>(
      c,
      "SELECT public.armario_salvar($1, $2, $3, $4, $5, $6, $7, $8::jsonb) AS r",
      [o.id ?? null, o.colecao_id === undefined ? s.colA : o.colecao_id, "Col F7 C2", o.sub ?? "Sub C2", o.nome ?? "Arm C2", o.colunas === undefined ? 4 : o.colunas, o.status === undefined ? null : o.status, itens === undefined ? null : JSON.stringify(itens)],
    );
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT arm_s");
    return { ok: true, id: r.r };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT arm_s");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT arm_s");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
const okId = (r: Res): string => {
  if (!r.ok) throw new Error(`esperava passar: ${r.code} ${r.msg}`);
  return r.id;
};
const item = (modelo: string, o: { vt?: string | null; pv?: string | null; [k: string]: unknown } = {}) => {
  const { vt, pv, ...resto } = o;
  return { modelo_id: modelo, variante_tecido_id: vt ?? null, produto_variante_id: pv ?? null, ...resto };
};
const itens = async (c: Client, arm: string): Promise<any[]> =>
  (await c.query(`SELECT modelo_id, origem, variante_tecido_id, produto_variante_id, cor_id, cor_apelido_id, ordem FROM public.armario_itens WHERE armario_id = $1 ORDER BY ordem`, [arm])).rows;
const cab = async (c: Client, arm: string) => um<any>(c, `SELECT * FROM public.armarios WHERE id = $1`, [arm]);

async function usuarioComum(c: Client): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U_COMUM, `${U_COMUM}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'F7 comum', 'user')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [U_COMUM, T, `${U_COMUM}@teste`],
  );
}
async function perm(c: Client, pagina: string, editar: boolean): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]);
    await c.query(`INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, $4)`, [U_COMUM, T, pagina, editar]);
  });
}

describe.skipIf(!RODA)("Armario C2 - RPC armario_salvar", () => {
  it("cria cabecalho + itens EM ORDEM (3 origens); salvar de novo = estado completo (reordena/remove/troca); colunas nao mexem na ordem", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const a = okId(await salva(c, s, [item(s.mInt, { vt: s.vt1 }), item(s.mRev, { pv: s.pav1 }), item(s.mImp, { pv: s.piv1 }), item(s.mInt, { vt: s.vt2 })], { nome: "  Vitrine  ", colunas: 3 }));
      expect(await cab(c, a)).toMatchObject({ tenant_id: T, colecao_id: s.colA, colecao: "Col F7 C2", subcolecao: "Sub C2", nome: "Vitrine", colunas: 3, status: "rascunho", ordem: 1 });
      const r1 = await itens(c, a);
      expect(r1.map((x) => x.ordem)).toEqual([1, 2, 3, 4]);
      expect(r1.map((x) => x.origem)).toEqual(["interno", "revenda", "importado", "interno"]);
      expect(r1[0]).toMatchObject({ modelo_id: s.mInt, variante_tecido_id: s.vt1, produto_variante_id: null, cor_id: s.cor1, cor_apelido_id: s.ap1 });
      expect(r1[1]).toMatchObject({ modelo_id: s.mRev, variante_tecido_id: null, produto_variante_id: s.pav1, cor_id: s.cor1, cor_apelido_id: s.ap2 });
      expect(r1[2]).toMatchObject({ modelo_id: s.mImp, produto_variante_id: s.piv1, cor_id: s.cor1, cor_apelido_id: s.ap1 });
      expect(r1[3]).toMatchObject({ variante_tecido_id: s.vt2, cor_id: s.cor2, cor_apelido_id: null });

      // reordena (mesmos itens, outra ordem) + muda nome/colunas/status: mesmo armario (id), ordem dos itens = nova lista, 'colunas' so visual
      const a2 = okId(await salva(c, s, [item(s.mInt, { vt: s.vt2 }), item(s.mImp, { pv: s.piv1 }), item(s.mInt, { vt: s.vt1 }), item(s.mRev, { pv: s.pav1 })], { id: a, nome: "Vitrine 2", colunas: 8, status: "pronto" }));
      expect(a2).toBe(a);
      expect(await cab(c, a)).toMatchObject({ nome: "Vitrine 2", colunas: 8, status: "pronto", ordem: 1 });
      const r2 = await itens(c, a);
      expect(r2.map((x) => x.variante_tecido_id ?? x.produto_variante_id)).toEqual([s.vt2, s.piv1, s.vt1, s.pav1]);
      expect(r2.map((x) => x.ordem)).toEqual([1, 2, 3, 4]);

      // remove um + status/colunas NULL = mantem; ainda 1 armario so
      okId(await salva(c, s, [item(s.mRev, { pv: s.pav2 })], { id: a, colunas: null, status: null }));
      expect(await cab(c, a)).toMatchObject({ colunas: 8, status: "pronto" });
      expect((await itens(c, a)).map((x) => x.produto_variante_id)).toEqual([s.pav2]);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.armarios WHERE tenant_id = $1`, [T])).n).toBe("1");

      // 2o armario na mesma subcolecao vai pro fim (ordem 2); a mesma variante pode repetir em armarios DIFERENTES
      const b = okId(await salva(c, s, [item(s.mRev, { pv: s.pav2 })], { nome: "Outro" }));
      expect((await cab(c, b)).ordem).toBe(2);
    });
  });

  it("ACEITA lista vazia ([] e null) - cria vazio e esvazia um armario com itens", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const a = okId(await salva(c, s, []));
      expect(await itens(c, a)).toEqual([]);
      const b = okId(await salva(c, s, undefined, { nome: "Nulo" })); // _itens = NULL
      expect(await itens(c, b)).toEqual([]);
      okId(await salva(c, s, [item(s.mInt, { vt: s.vt1 })], { id: a }));
      expect(await itens(c, a)).toHaveLength(1);
      okId(await salva(c, s, [], { id: a }));
      expect(await itens(c, a)).toEqual([]);
      expect(txt(await salva(c, s, { modelo_id: s.mInt }))).toMatch(/^P0001 armario_itens_invalido:/); // nao-array
    });
  });

  it("RECUSA armario PUBLICADO (P0001) - cabecalho e itens - mesmo pelo wrapper; despublicado volta a editar", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const a = okId(await salva(c, s, [item(s.mInt, { vt: s.vt1 })], { status: "pronto" }));
      await semJwt(c, () => c.query(`UPDATE public.armarios SET status = 'publicado' WHERE id = $1`, [a]));
      const TRAV = /^P0001 armario_publicado_travado:/;
      expect(txt(await salva(c, s, [item(s.mInt, { vt: s.vt2 })], { id: a }))).toMatch(TRAV);
      expect(txt(await salva(c, s, [item(s.mInt, { vt: s.vt1 })], { id: a, nome: "Renomeado" }))).toMatch(TRAV);
      expect(txt(await salva(c, s, [], { id: a, status: "rascunho" }))).toMatch(TRAV);
      expect((await itens(c, a)).map((x) => x.variante_tecido_id)).toEqual([s.vt1]); // nada mudou
      expect(await cab(c, a)).toMatchObject({ nome: "Arm C2", status: "publicado" });
      // 'publicado' nao se grava pelo salvar (so pela acao de status)
      expect(txt(await salva(c, s, [], { status: "publicado", nome: "Novo" }))).toMatch(/^P0001 armario_status_invalido:/);
      // despublica (porta de fora) -> edita livre
      await semJwt(c, () => c.query(`UPDATE public.armarios SET status = 'pronto' WHERE id = $1`, [a]));
      okId(await salva(c, s, [item(s.mInt, { vt: s.vt2 })], { id: a }));
    });
  });

  it("RECUSA item SEM ponteiro; ponteiro de outra origem/produto/loja, sem cor ou do Tecido 2 = recusa; modelo de outra loja", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const e = (r: Res) => txt(r);
      expect(e(await salva(c, s, [item(s.mInt)]))).toMatch(/^P0001 armario_item_sem_variante:/);
      expect(e(await salva(c, s, [item(s.mInt, { vt: s.vt1 }), item(s.mRev)]))).toMatch(/^P0001 armario_item_sem_variante: item 2/);
      expect(e(await salva(c, s, [item(s.mRev, { vt: s.vt1 })]))).toMatch(/^P0001 armario_item_variante_invalida:/); // revenda com vt
      expect(e(await salva(c, s, [item(s.mInt, { pv: s.pav1 })]))).toMatch(/^P0001 armario_item_variante_invalida:/); // interno com pv
      expect(e(await salva(c, s, [item(s.mInt, { vt: s.vt1, pv: s.pav1 })]))).toMatch(/^P0001 armario_item_variante_invalida:/); // os 2
      expect(e(await salva(c, s, [item(s.mRev, { pv: s.pavOutroProd })]))).toMatch(/^P0001 armario_item_variante_invalida:/); // variante de OUTRO produto
      expect(e(await salva(c, s, [item(s.mInt, { vt: s.vtOutro })]))).toMatch(/^P0001 armario_item_variante_invalida:/); // vt de outro modelo
      expect(e(await salva(c, s, [item(s.mInt, { vt: s.vtT2 })]))).toMatch(/^P0001 armario_item_variante_invalida:/); // Tecido 2 nao e oferecido
      expect(e(await salva(c, s, [item(s.mInt, { vt: s.vtSemCor })]))).toMatch(/^P0001 armario_item_variante_invalida:/); // sem cor
      expect(e(await salva(c, s, [item(s.mInt, { vt: "11111111-1111-4111-8111-111111111111" })]))).toMatch(/^P0001 armario_item_variante_invalida:/); // inexistente
      expect(e(await salva(c, s, [item(s.mOutroTenant, { vt: s.vt1 })]))).toMatch(/^P0001 armario_item_modelo_invalido:/);
      expect(e(await salva(c, s, [{ modelo_id: "nao-e-uuid", variante_tecido_id: s.vt1 }]))).toMatch(/^P0001 armario_item_invalido:/);
      expect(e(await salva(c, s, [{ variante_tecido_id: s.vt1 }]))).toMatch(/^P0001 armario_item_invalido:/);
      // nada foi gravado pelas recusas
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.armarios WHERE tenant_id = $1`, [T])).n).toBe("0");
      // validacoes do cabecalho
      expect(e(await salva(c, s, [], { nome: "   " }))).toMatch(/^P0001 armario_nome_obrigatorio:/);
      expect(e(await salva(c, s, [], { colunas: 13 }))).toMatch(/^P0001 armario_colunas_invalidas:/);
      expect(e(await salva(c, s, [], { colunas: 0 }))).toMatch(/^P0001 armario_colunas_invalidas:/);
    });
  });

  it("snapshot de cor DERIVADO no servidor: cor/apelido/origem errados no payload sao ignorados (3 origens)", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const lixo = { cor_id: s.cor3, cor_apelido_id: s.ap2, origem: "importado" };
      const a = okId(await salva(c, s, [item(s.mInt, { vt: s.vt1, ...lixo }), item(s.mRev, { pv: s.pav2, ...lixo }), item(s.mImp, { pv: s.piv1, ...lixo })]));
      const r = await itens(c, a);
      expect(r[0]).toMatchObject({ origem: "interno", cor_id: s.cor1, cor_apelido_id: s.ap1 });
      expect(r[1]).toMatchObject({ origem: "revenda", cor_id: s.cor2, cor_apelido_id: null }); // apelido errado NAO vaza
      expect(r[2]).toMatchObject({ origem: "importado", cor_id: s.cor1, cor_apelido_id: s.ap1 });
    });
  });

  it("'cor removida': ponteiro orfao de item JA gravado preserva o snapshot e nao trava o salvar; item NOVO orfao e recusado", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const a = okId(await salva(c, s, [item(s.mInt, { vt: s.vt1 }), item(s.mRev, { pv: s.pav1 })]));
      // o cadastro muda depois: a cor da variante do revenda e removida (cor_id NULL) e a variante do interno sai do Tecido 1
      await semJwt(c, async () => {
        await c.query(`UPDATE public.produto_acabado_variantes SET cor_id = NULL, cor_apelido_id = NULL WHERE id = $1`, [s.pav1]);
        await c.query(`DELETE FROM public.modelo_tecido_variantes WHERE variante_tecido_id = $1`, [s.vt1]);
      });
      okId(await salva(c, s, [item(s.mRev, { pv: s.pav1 }), item(s.mInt, { vt: s.vt1 }), item(s.mInt, { vt: s.vt2 })], { id: a, nome: "Re-salvo" }));
      const r = await itens(c, a);
      expect(r.map((x) => x.ordem)).toEqual([1, 2, 3]);
      expect(r[0]).toMatchObject({ produto_variante_id: s.pav1, cor_id: s.cor1, cor_apelido_id: s.ap2 }); // snapshot preservado
      expect(r[1]).toMatchObject({ variante_tecido_id: s.vt1, cor_id: s.cor1, cor_apelido_id: s.ap1 });
      // item NOVO (outro armario) com o mesmo ponteiro orfao = recusa
      expect(txt(await salva(c, s, [item(s.mRev, { pv: s.pav1 })], { nome: "Novo" }))).toMatch(/^P0001 armario_item_variante_invalida:/);
    });
  });

  it("de-dup: mesma variante 2x no mesmo armario = recusa clara (P0001); em armarios diferentes pode", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      expect(txt(await salva(c, s, [item(s.mInt, { vt: s.vt1 }), item(s.mInt, { vt: s.vt2 }), item(s.mInt, { vt: s.vt1 })]))).toMatch(/^P0001 armario_item_duplicado: item 3/);
      expect(txt(await salva(c, s, [item(s.mRev, { pv: s.pav1 }), item(s.mRev, { pv: s.pav1 })]))).toMatch(/^P0001 armario_item_duplicado:/);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.armarios WHERE tenant_id = $1`, [T])).n).toBe("0");
      okId(await salva(c, s, [item(s.mInt, { vt: s.vt1 })], { nome: "A" }));
      okId(await salva(c, s, [item(s.mInt, { vt: s.vt1 })], { nome: "B" }));
    });
  });

  it("permissao: sem a pagina criacao_armario / so VER / outra pagina = 42501; com a pagina passa; admin passa; sem login e modulo desligado = 42501", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await usuarioComum(c);
      await c.query(`UPDATE public.users SET tenant_id = $1 WHERE id = $2`, [T, U_COMUM]);
      const SEM = "42501 sem_permissao_pagina: criacao_armario";
      await comoUsuario(c, U_COMUM);
      await semJwt(c, () => c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]));
      expect(txt(await salva(c, s, []))).toBe(SEM);
      await perm(c, "criacao_armario", false);
      expect(txt(await salva(c, s, []))).toBe(SEM);
      await perm(c, "criacao_planejamento", true);
      expect(txt(await salva(c, s, []))).toBe(SEM);
      await perm(c, "criacao_armario", true);
      okId(await salva(c, s, [item(s.mInt, { vt: s.vt1 })]));
      // modulo criacao desligado na loja (so o super admin muda a config; aqui como migration/JWT vazio)
      await semJwt(c, () => c.query(`UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || '{"criacao": false}'::jsonb WHERE tenant_id = $1`, [T]));
      expect(txt(await salva(c, s, []))).toMatch(/^42501 modulo_desligado: criacao/);
      await semJwt(c, () => c.query(`UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || '{"criacao": true}'::jsonb WHERE tenant_id = $1`, [T]));
      // admin da loja e super admin passam
      await semJwt(c, () => c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]));
      await semJwt(c, () => c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin') ON CONFLICT DO NOTHING`, [U_COMUM]));
      okId(await salva(c, s, [], { nome: "Admin" }));
      await comoUsuario(c);
      okId(await salva(c, s, [], { nome: "Super" }));
      // sem login
      await semUsuario(c);
      expect(txt(await salva(c, s, []))).toBe("42501 armario_nao_autenticado");
    });
  });

  it("ANTI-CROSS-TENANT: armario de outra loja, colecao de outra loja e modelo de outra loja = recusa; nada muda no armario alheio", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      const alheio = await id(c, `INSERT INTO public.armarios (tenant_id, colecao_id, subcolecao, nome) VALUES ($1, $2, 'Sub C2', 'Alheio')`, [s.outroTenant, s.colOutra]);
      await c.query(
        `INSERT INTO public.armario_itens (tenant_id, armario_id, modelo_id, origem, variante_tecido_id, cor_id, ordem) VALUES ($1, $2, $3, 'interno', $4, $5, 1)`,
        [s.outroTenant, alheio, s.mOutroTenant, s.vt1, s.cor1],
      );
      await comoUsuario(c);
      expect(txt(await salva(c, s, [], { id: alheio, nome: "Invadido" }))).toMatch(/^P0001 armario_nao_encontrado:/);
      expect(txt(await salva(c, s, [item(s.mInt, { vt: s.vt1 })], { id: alheio }))).toMatch(/^P0001 armario_nao_encontrado:/);
      expect(txt(await salva(c, s, [], { id: "22222222-2222-4222-8222-222222222222" }))).toMatch(/^P0001 armario_nao_encontrado:/);
      expect(txt(await salva(c, s, [], { colecao_id: s.colOutra }))).toMatch(/^P0001 armario_colecao_invalida:/);
      expect(txt(await salva(c, s, [item(s.mOutroTenant, { vt: s.vt1 })]))).toMatch(/^P0001 armario_item_modelo_invalido:/);
      expect(await cab(c, alheio)).toMatchObject({ nome: "Alheio", tenant_id: s.outroTenant });
      expect(await itens(c, alheio)).toHaveLength(1);
    });
  });

  it("anti-drift de ACL: _core sem EXECUTE p/ PUBLIC/anon/authenticated; wrapper so authenticated/service_role; ambos DEFINER search_path=public; down remove as 2", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const priv = async (fn: string, role: string) => (await um<{ p: boolean }>(c, `SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS p`, [role, fn])).p;
      for (const r of ["anon", "authenticated"]) expect(await priv(CORE, r), `core ${r}`).toBe(false);
      expect(await priv(WRAP, "anon")).toBe(false);
      expect(await priv(WRAP, "authenticated")).toBe(true);
      expect(await priv(WRAP, "service_role")).toBe(true);
      for (const fn of [CORE, WRAP]) {
        const p = await um<any>(c, `SELECT prosecdef, proconfig, (SELECT count(*) FROM aclexplode(proacl) a WHERE a.grantee = 0) AS publico FROM pg_proc WHERE oid = $1::regprocedure`, [fn]);
        expect(p.prosecdef).toBe(true);
        expect(p.proconfig).toEqual(["search_path=public"]);
        expect(Number(p.publico)).toBe(0);
      }
      // authenticated chamando o _core direto: negado pelo ACL
      await comoUsuario(c);
      await c.query("SAVEPOINT x");
      await c.query("SET LOCAL ROLE authenticated");
      await expect(c.query(`SELECT public._armario_salvar_core(NULL, NULL, NULL, 'x', 'n', 5, NULL, '[]'::jsonb)`)).rejects.toMatchObject({ code: "42501" });
      await c.query("ROLLBACK TO SAVEPOINT x");
      await c.query("RESET ROLE");
      // idempotente (reaplica) + down remove as 2
      await aplicarArquivo(c, MIG);
      await aplicarArquivo(c, DOWN);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_proc WHERE proname IN ('armario_salvar', '_armario_salvar_core')`)).n).toBe("0");
      await aplicarArquivo(c, DOWN); // idempotente
    });
  });
});
