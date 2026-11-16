/**
 * F7 Armario - Task C3 (banco): 6 RPCs de ciclo de vida (migration 20261202140000): armario_criar / renomear / excluir / duplicar /
 * reordenar / status. BEGIN...ROLLBACK, SO na copia local (A1 + A2 + C3 aplicadas DENTRO da txn pelo harness `aplicarArquivo` - sem
 * BEGIN/COMMIT, NUNCA \i). Todas chamadas como o papel `authenticated` + claims (PostgREST real). Pinos:
 *  - criar: vazio, rascunho, 5 colunas, ordem = fim da subcolecao (por loja+colecao+subcolecao); colecao de outra loja / nome vazio = recusa;
 *  - renomear: recusa publicado (P0001 armario_publicado_travado); nome vazio = recusa; despublicado renomeia;
 *  - excluir: apaga + itens por CASCADE; recusa publicado; outro armario intacto;
 *  - duplicar: cabecalho+colunas+TODOS os itens na mesma ordem (snapshot fiel); status do novo = rascunho (mesmo de publicado); fim da subcolecao;
 *    a origem nao muda; a mesma variante em 2 armarios (ok);
 *  - reordenar: renumera ordem = indice; PASSA com armario publicado na lista (e o publicado continua publicado); recusa id de outra loja
 *    (nada renumerado), id repetido, malformado, subcolecoes diferentes, nao-array; lista vazia = no-op;
 *  - status: as 4 transicoes validas + recusa de TODAS as invalidas (P0001 armario_status_invalido); publicado so sai pelo status;
 *  - permissao: sem a pagina criacao_armario / so VER / outra pagina = 42501 nas 6; modulo desligado = 42501; sem login = 42501;
 *  - ANTI-CROSS-TENANT em todas (armario alheio = P0001 armario_nao_encontrado e nada muda);
 *  - ACL: _core sem EXECUTE p/ anon/authenticated; down remove as 12 funcoes (idempotente).
 * A cobertura de seguranca transversal (todas as RPCs de escrita da frente) esta em armario-seguranca.test.ts.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, semUsuario, semJwt, um, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const MIG = "supabase/migrations/20261202140000_armario_crud.sql";
const DOWN = "supabase/rollback/20261202140000_armario_crud_down.sql";
const U_COMUM = "f7c30000-0000-4000-8000-0000000000c1";
const SUB = "Sub C3";
const NAO_EXISTE = "33333333-3333-4333-8333-333333333333";

async function aplica(c: Client): Promise<void> {
  await aplicarArquivo(c, "supabase/migrations/20261202100000_armario_tabelas.sql");
  await aplicarArquivo(c, "supabase/migrations/20261202110000_armario_trava_publicado.sql");
  await aplicarArquivo(c, MIG);
}

const id = async (c: Client, sql: string, p: unknown[] = []) => (await um<{ id: string }>(c, sql + " RETURNING id", p)).id;

interface Seed {
  outroTenant: string;
  colA: string; colB: string; colOutra: string;
  mod: string; mod2: string;
  cor1: string; cor2: string; ap1: string;
  vt1: string; vt2: string; vt3: string;
  alheio: string;
}

async function semeia(c: Client): Promise<Seed> {
  const outroTenant = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 LIMIT 1", [T])).id;
  const colA = await id(c, `INSERT INTO public.colecoes (tenant_id, nome) VALUES ($1, 'Col F7 C3 A')`, [T]);
  const colB = await id(c, `INSERT INTO public.colecoes (tenant_id, nome) VALUES ($1, 'Col F7 C3 B')`, [T]);
  const colOutra = await id(c, `INSERT INTO public.colecoes (tenant_id, nome) VALUES ($1, 'Col F7 C3 Outra')`, [outroTenant]);
  const cor = (n: string) => id(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, $2)`, [T, n]);
  const cor1 = await cor("Azul C3"), cor2 = await cor("Verde C3");
  const ap1 = await id(c, `INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id) VALUES ($1, 'Mar C3', $2)`, [T, cor1]);
  const mod = (nome: string) => id(c, `INSERT INTO public.modelos (tenant_id, nome, origem, colecao_id, subcolecao) VALUES ($1, $2, 'interno', $3, $4)`, [T, nome, colA, SUB]);
  const m1 = await mod("A C3"), m2 = await mod("B C3");
  const vt = (cr: string) => id(c, `INSERT INTO public.variantes_tecido (tenant_id, cor_id) VALUES ($1, $2)`, [T, cr]);
  const vt1 = await vt(cor1), vt2 = await vt(cor2), vt3 = await vt(cor1);
  const mOut = await id(c, `INSERT INTO public.modelos (tenant_id, nome, origem, colecao_id, subcolecao) VALUES ($1, 'X Outro C3', 'interno', $2, $3)`, [outroTenant, colOutra, SUB]);
  const alheio = await id(c, `INSERT INTO public.armarios (tenant_id, colecao_id, subcolecao, nome, ordem) VALUES ($1, $2, $3, 'Alheio', 1)`, [outroTenant, colOutra, SUB]);
  await c.query(
    `INSERT INTO public.armario_itens (tenant_id, armario_id, modelo_id, origem, variante_tecido_id, cor_id, ordem) VALUES ($1, $2, $3, 'interno', $4, $5, 1)`,
    [outroTenant, alheio, mOut, vt1, cor1],
  );
  return { outroTenant, colA, colB, colOutra, mod: m1, mod2: m2, cor1, cor2, ap1, vt1, vt2, vt3, alheio };
}

type Res = { ok: true; v: any } | { ok: false; code: string; msg: string };
/** Chama uma RPC como `authenticated` (PostgREST real). Sucesso PERSISTE na txn; erro volta ao savepoint. */
async function rpc(c: Client, sql: string, params: unknown[]): Promise<Res> {
  await c.query("SAVEPOINT arm_c3");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const r = await um<{ r: any }>(c, `SELECT ${sql} AS r`, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT arm_c3");
    return { ok: true, v: r.r };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT arm_c3");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT arm_c3");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
const criar = (c: Client, s: Seed, nome = "Arm C3", o: { col?: string | null; sub?: string } = {}) =>
  rpc(c, "public.armario_criar($1, $2, $3, $4)", [o.col === undefined ? s.colA : o.col, "Col F7 C3 A", o.sub ?? SUB, nome]);
const renomear = (c: Client, a: string, nome: string) => rpc(c, "public.armario_renomear($1, $2)", [a, nome]);
const excluir = (c: Client, a: string) => rpc(c, "public.armario_excluir($1)", [a]);
const duplicar = (c: Client, a: string, nome: string) => rpc(c, "public.armario_duplicar($1, $2)", [a, nome]);
const reordenar = (c: Client, ids: unknown) => rpc(c, "public.armario_reordenar($1::jsonb)", [JSON.stringify(ids)]);
const status = (c: Client, a: string, novo: string | null) => rpc(c, "public.armario_status($1, $2)", [a, novo]);

const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
const okV = (r: Res): string => {
  if (!r.ok) throw new Error(`esperava passar: ${r.code} ${r.msg}`);
  return r.v;
};
const cab = async (c: Client, a: string) => um<any>(c, `SELECT * FROM public.armarios WHERE id = $1`, [a]);
const itens = async (c: Client, a: string): Promise<any[]> =>
  (await c.query(`SELECT modelo_id, origem, variante_tecido_id, produto_variante_id, cor_id, cor_apelido_id, ordem FROM public.armario_itens WHERE armario_id = $1 ORDER BY ordem`, [a])).rows;
const ordens = async (c: Client, ids: string[]) =>
  (await c.query(`SELECT id, ordem FROM public.armarios WHERE id = ANY($1::uuid[])`, [ids])).rows.reduce((m: Record<string, number>, r: any) => ({ ...m, [r.id]: r.ordem }), {});
/** Seed direto (como migration/postgres) de um armario ja com itens e status. */
async function armarioCom(c: Client, s: Seed, nome: string, st: string, vts: string[], o: { col?: string; sub?: string; ordem?: number } = {}): Promise<string> {
  const a = await id(
    c,
    `INSERT INTO public.armarios (tenant_id, colecao_id, colecao, subcolecao, nome, colunas, status, ordem) VALUES ($1, $2, 'Col F7 C3 A', $3, $4, 7, 'rascunho', $5)`,
    [T, o.col ?? s.colA, o.sub ?? SUB, nome, o.ordem ?? 0],
  );
  let i = 0;
  for (const v of vts) {
    i++;
    await c.query(
      `INSERT INTO public.armario_itens (tenant_id, armario_id, modelo_id, origem, variante_tecido_id, cor_id, cor_apelido_id, ordem) VALUES ($1, $2, $3, 'interno', $4, $5, $6, $7)`,
      [T, a, i % 2 ? s.mod : s.mod2, v, s.cor1, i === 1 ? s.ap1 : null, i],
    );
  }
  if (st !== "rascunho") await c.query(`UPDATE public.armarios SET status = $2 WHERE id = $1`, [a, st]);
  return a;
}

async function usuarioComum(c: Client): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [U_COMUM, `${U_COMUM}@teste`]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'F7 comum C3', 'user')
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

const TRAV = /^P0001 armario_publicado_travado:/;
const NAO_ACHOU = /^P0001 armario_nao_encontrado:/;

describe.skipIf(!RODA)("Armario C3 - RPCs CRUD de ciclo de vida", () => {
  it("criar: vazio, rascunho, 5 colunas, tenant da loja; ordem = FIM da subcolecao (por colecao+sub); validacoes", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const a = okV(await criar(c, s, "  Vitrine  "));
      expect(await cab(c, a)).toMatchObject({ tenant_id: T, colecao_id: s.colA, colecao: "Col F7 C3 A", subcolecao: SUB, nome: "Vitrine", colunas: 5, status: "rascunho", ordem: 1 });
      expect(await itens(c, a)).toEqual([]);
      const b = okV(await criar(c, s, "Segundo"));
      const d = okV(await criar(c, s, "Terceiro"));
      expect(await ordens(c, [a, b, d])).toEqual({ [a]: 1, [b]: 2, [d]: 3 });
      // outra subcolecao e outra colecao tem fila propria; fim = max+1 (mesmo com buraco)
      expect((await cab(c, okV(await criar(c, s, "Outra sub", { sub: "Sub Outra C3" })))).ordem).toBe(1);
      expect((await cab(c, okV(await criar(c, s, "Outra col", { col: s.colB })))).ordem).toBe(1);
      await semJwt(c, () => c.query(`DELETE FROM public.armarios WHERE id = $1`, [b]));
      expect((await cab(c, okV(await criar(c, s, "Quarto")))).ordem).toBe(4);
      // sem colecao_id: aceita (sem colecao); texto da colecao cai no nome quando nao vem
      const sc = okV(await rpc(c, "public.armario_criar(NULL, NULL, $1, $2)", ["Sub sem col C3", "Sem col"]));
      expect(await cab(c, sc)).toMatchObject({ colecao_id: null, colecao: null, ordem: 1 });
      const cn = okV(await rpc(c, "public.armario_criar($1, NULL, $2, $3)", [s.colB, SUB, "Col do banco"]));
      expect((await cab(c, cn)).colecao).toBe("Col F7 C3 B");
      // validacoes
      expect(txt(await criar(c, s, "   "))).toMatch(/^P0001 armario_nome_obrigatorio:/);
      expect(txt(await criar(c, s, "X", { col: s.colOutra }))).toMatch(/^P0001 armario_colecao_invalida:/);
      expect(txt(await criar(c, s, "X", { col: NAO_EXISTE }))).toMatch(/^P0001 armario_colecao_invalida:/);
    });
  });

  it("renomear: troca o nome (trim); recusa publicado e nome vazio; despublicado renomeia; mantem itens/ordem/status", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const a = await armarioCom(c, s, "Velho", "pronto", [s.vt1, s.vt2], { ordem: 3 });
      expect(okV(await renomear(c, a, "  Novo  "))).toBe(""); // void
      expect(await cab(c, a)).toMatchObject({ nome: "Novo", status: "pronto", ordem: 3, colunas: 7 });
      expect(await itens(c, a)).toHaveLength(2);
      expect(txt(await renomear(c, a, "   "))).toMatch(/^P0001 armario_nome_obrigatorio:/);
      expect(txt(await renomear(c, a, null as any))).toMatch(/^P0001 armario_nome_obrigatorio:/);
      await semJwt(c, () => c.query(`UPDATE public.armarios SET status = 'publicado' WHERE id = $1`, [a]));
      expect(txt(await renomear(c, a, "Tentativa"))).toMatch(TRAV);
      expect((await cab(c, a)).nome).toBe("Novo");
      okV(await status(c, a, "pronto")); // despublica
      okV(await renomear(c, a, "Voltou"));
      expect((await cab(c, a)).nome).toBe("Voltou");
    });
  });

  it("excluir: apaga o armario e os itens (CASCADE); outro armario intacto; recusa publicado; 2a exclusao = nao encontrado", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const a = await armarioCom(c, s, "Apagar", "pronto", [s.vt1, s.vt2]);
      const b = await armarioCom(c, s, "Fica", "rascunho", [s.vt1]);
      expect(okV(await excluir(c, a))).toBe(""); // void
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.armarios WHERE id = $1`, [a])).n).toBe("0");
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.armario_itens WHERE armario_id = $1`, [a])).n).toBe("0");
      expect(await itens(c, b)).toHaveLength(1);
      expect(txt(await excluir(c, a))).toMatch(NAO_ACHOU);
      // publicado: recusa (mesma regra do gatilho A2) - despublica e exclui
      const p = await armarioCom(c, s, "Pub", "publicado", [s.vt1]);
      expect(txt(await excluir(c, p))).toMatch(TRAV);
      expect(await itens(c, p)).toHaveLength(1);
      okV(await status(c, p, "pronto"));
      okV(await excluir(c, p));
    });
  });

  it("duplicar: copia cabecalho(colunas)+TODOS os itens na MESMA ordem (snapshot fiel); novo = rascunho no FIM da subcolecao; origem intacta; publicado pode ser copiado", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const a = await armarioCom(c, s, "Original", "pronto", [s.vt2, s.vt1, s.vt3], { ordem: 1 });
      await armarioCom(c, s, "Vizinho", "rascunho", [], { ordem: 2 });
      const n = okV(await duplicar(c, a, "  Copia  "));
      expect(n).not.toBe(a);
      expect(await cab(c, n)).toMatchObject({ tenant_id: T, colecao_id: s.colA, colecao: "Col F7 C3 A", subcolecao: SUB, nome: "Copia", colunas: 7, status: "rascunho", ordem: 3 });
      const orig = await itens(c, a), copia = await itens(c, n);
      expect(copia).toEqual(orig); // mesma ordem, ponteiros, snapshot de cor/apelido
      expect(copia.map((x) => x.variante_tecido_id)).toEqual([s.vt2, s.vt1, s.vt3]);
      expect(copia.map((x) => x.ordem)).toEqual([1, 2, 3]);
      expect(copia[0].cor_apelido_id).toBe(s.ap1);
      // origem NAO mudou (status/itens/nome)
      expect(await cab(c, a)).toMatchObject({ nome: "Original", status: "pronto", ordem: 1 });
      expect(await itens(c, a)).toHaveLength(3);
      // copia do PUBLICADO: nasce rascunho (editavel), o publicado segue publicado
      await semJwt(c, () => c.query(`UPDATE public.armarios SET status = 'publicado' WHERE id = $1`, [a]));
      const n2 = okV(await duplicar(c, a, "Copia 2"));
      expect(await cab(c, n2)).toMatchObject({ status: "rascunho", ordem: 4 });
      expect(await itens(c, n2)).toHaveLength(3);
      expect((await cab(c, a)).status).toBe("publicado");
      // armario vazio duplica vazio
      const v = await armarioCom(c, s, "Vazio", "rascunho", []);
      expect(await itens(c, okV(await duplicar(c, v, "Vazio 2")))).toEqual([]);
      expect(txt(await duplicar(c, a, "  "))).toMatch(/^P0001 armario_nome_obrigatorio:/);
    });
  });

  it("reordenar: renumera ordem = indice; PASSA com armario PUBLICADO na lista (continua publicado); lista vazia = no-op; subconjunto renumera so os recebidos", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const a = await armarioCom(c, s, "A", "rascunho", [s.vt1], { ordem: 1 });
      const b = await armarioCom(c, s, "B", "publicado", [s.vt2], { ordem: 2 });
      const d = await armarioCom(c, s, "D", "pronto", [], { ordem: 3 });
      expect(okV(await reordenar(c, [d, a, b]))).toBe(""); // void
      expect(await ordens(c, [a, b, d])).toEqual({ [d]: 1, [a]: 2, [b]: 3 });
      // o publicado NAO e tocado alem da ordem
      expect(await cab(c, b)).toMatchObject({ nome: "B", status: "publicado", colunas: 7, ordem: 3 });
      expect(await itens(c, b)).toHaveLength(1);
      // so o publicado na lista (1 elemento)
      okV(await reordenar(c, [b]));
      expect((await cab(c, b)).ordem).toBe(1);
      // vazio = no-op
      okV(await reordenar(c, []));
      expect(await ordens(c, [a, d])).toEqual({ [a]: 2, [d]: 1 });
      // depois de reordenar, o "fim" de criar respeita o max
      expect((await cab(c, okV(await criar(c, s, "Novo")))).ordem).toBe(3);
    });
  });

  it("reordenar: recusa id de outra loja (nada renumerado), inexistente, repetido, malformado, nao-texto, subcolecoes diferentes e nao-array", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const a = await armarioCom(c, s, "A", "rascunho", [], { ordem: 1 });
      const b = await armarioCom(c, s, "B", "rascunho", [], { ordem: 2 });
      const outraSub = await armarioCom(c, s, "OutraSub", "rascunho", [], { ordem: 9, sub: "Sub Outra C3" });
      const outraCol = await armarioCom(c, s, "OutraCol", "rascunho", [], { ordem: 8, col: s.colB });
      expect(txt(await reordenar(c, [b, s.alheio, a]))).toMatch(NAO_ACHOU);
      expect(txt(await reordenar(c, [b, NAO_EXISTE]))).toMatch(NAO_ACHOU);
      expect(await ordens(c, [a, b])).toEqual({ [a]: 1, [b]: 2 }); // nada renumerado
      expect((await cab(c, s.alheio)).ordem).toBe(1);
      expect(txt(await reordenar(c, [a, b, a]))).toMatch(/^P0001 armario_ids_invalido:.*repete/);
      expect(txt(await reordenar(c, [a, "nao-e-uuid"]))).toMatch(/^P0001 armario_ids_invalido:/);
      expect(txt(await reordenar(c, [a, 5]))).toMatch(/^P0001 armario_ids_invalido:/);
      expect(txt(await reordenar(c, [a, outraSub]))).toMatch(/^P0001 armario_ids_invalido:.*subcolecao/);
      expect(txt(await reordenar(c, [a, outraCol]))).toMatch(/^P0001 armario_ids_invalido:.*subcolecao/);
      expect(txt(await reordenar(c, { a }))).toMatch(/^P0001 armario_ids_invalido:/);
      expect(txt(await rpc(c, "public.armario_reordenar(NULL)", []))).toMatch(/^P0001 armario_ids_invalido:/);
      expect(await ordens(c, [a, b, outraSub, outraCol])).toEqual({ [a]: 1, [b]: 2, [outraSub]: 9, [outraCol]: 8 });
    });
  });

  it("status: 4 transicoes validas; TODAS as invalidas recusadas (P0001 armario_status_invalido); publicado so sai pelo status", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const a = await armarioCom(c, s, "S", "rascunho", [s.vt1]);
      const st = async () => (await cab(c, a)).status;
      const INV = /^P0001 armario_status_invalido:/;
      okV(await status(c, a, "pronto")); expect(await st()).toBe("pronto");
      okV(await status(c, a, "rascunho")); expect(await st()).toBe("rascunho");
      okV(await status(c, a, "pronto"));
      okV(await status(c, a, "publicado")); expect(await st()).toBe("publicado");
      okV(await status(c, a, "pronto")); expect(await st()).toBe("pronto");
      // matriz completa das invalidas
      const todos = ["rascunho", "pronto", "publicado"];
      const validas = new Set(["rascunho>pronto", "pronto>rascunho", "pronto>publicado", "publicado>pronto"]);
      for (const de of todos) {
        for (const para of [...todos, "arquivado", "", "PRONTO"]) {
          await semJwt(c, () => c.query(`UPDATE public.armarios SET status = $2 WHERE id = $1`, [a, de]));
          if (validas.has(`${de}>${para}`)) continue;
          expect(txt(await status(c, a, para)), `${de} -> ${para}`).toMatch(INV);
          expect(await st(), `${de} -> ${para} nao muda`).toBe(de);
        }
        await semJwt(c, () => c.query(`UPDATE public.armarios SET status = $2 WHERE id = $1`, [a, de]));
        expect(txt(await status(c, a, null)), `${de} -> null`).toMatch(INV);
      }
      // publicado: itens e cabecalho travados (gatilho A2 morde o cliente direto), mas o status destrava
      await semJwt(c, () => c.query(`UPDATE public.armarios SET status = 'publicado' WHERE id = $1`, [a]));
      expect(txt(await status(c, a, "rascunho"))).toMatch(INV); // nao pula direto p/ rascunho
      okV(await status(c, a, "pronto"));
      expect(txt(await status(c, NAO_EXISTE, "pronto"))).toMatch(NAO_ACHOU);
    });
  });

  it("permissao: sem a pagina criacao_armario / so VER / outra pagina = 42501 nas 6; com a pagina passa; admin passa; modulo desligado e sem login = 42501", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      const a = await armarioCom(c, s, "P", "rascunho", [s.vt1]);
      const b = await armarioCom(c, s, "Q", "rascunho", []);
      await usuarioComum(c);
      await c.query(`UPDATE public.users SET tenant_id = $1 WHERE id = $2`, [T, U_COMUM]);
      const SEM = "42501 sem_permissao_pagina: criacao_armario";
      await comoUsuario(c, U_COMUM);
      await semJwt(c, () => c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]));
      // as 6 RPCs em SEQUENCIA (mesma conexao; cada `rpc` usa savepoint)
      const seq = async (fns: (() => Promise<Res>)[]) => { const r: Res[] = []; for (const f of fns) r.push(await f()); return r; };
      const fns = () => [
        () => criar(c, s, "Via perm"), () => renomear(c, b, "X"), () => duplicar(c, a, "Dup"),
        () => reordenar(c, [a, b]), () => status(c, b, "pronto"), () => excluir(c, b),
      ];
      expect((await seq(fns())).map(txt)).toEqual(Array(6).fill(SEM));
      await perm(c, "criacao_armario", false);
      expect((await seq(fns())).map(txt)).toEqual(Array(6).fill(SEM));
      await perm(c, "criacao_planejamento", true);
      expect((await seq(fns())).map(txt)).toEqual(Array(6).fill(SEM));
      // nada mudou com as recusas
      expect(await cab(c, b)).toMatchObject({ nome: "Q", status: "rascunho" });
      await perm(c, "criacao_armario", true);
      expect((await seq(fns())).map((r) => r.ok)).toEqual(Array(6).fill(true));
      // modulo criacao desligado na loja
      const d = await armarioCom(c, s, "D", "rascunho", []);
      await semJwt(c, () => c.query(`UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || '{"criacao": false}'::jsonb WHERE tenant_id = $1`, [T]));
      expect((await seq([() => criar(c, s, "Z"), () => renomear(c, d, "Z"), () => duplicar(c, d, "Z"), () => reordenar(c, [d]), () => status(c, d, "pronto"), () => excluir(c, d)])).map(txt))
        .toEqual(Array(6).fill("42501 modulo_desligado: criacao"));
      await semJwt(c, () => c.query(`UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || '{"criacao": true}'::jsonb WHERE tenant_id = $1`, [T]));
      // admin da loja passa sem linha de permissao
      await semJwt(c, () => c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [U_COMUM]));
      await semJwt(c, () => c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin') ON CONFLICT DO NOTHING`, [U_COMUM]));
      okV(await criar(c, s, "Admin"));
      // sem login
      await semUsuario(c);
      expect((await seq(fns())).map(txt)).toEqual(Array(6).fill("42501 armario_nao_autenticado"));
    });
  });

  it("ANTI-CROSS-TENANT: armario de outra loja = nao encontrado em renomear/excluir/duplicar/status; nada muda no armario alheio", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      expect(txt(await renomear(c, s.alheio, "Invadido"))).toMatch(NAO_ACHOU);
      expect(txt(await excluir(c, s.alheio))).toMatch(NAO_ACHOU);
      expect(txt(await duplicar(c, s.alheio, "Roubado"))).toMatch(NAO_ACHOU);
      expect(txt(await status(c, s.alheio, "pronto"))).toMatch(NAO_ACHOU);
      expect(txt(await reordenar(c, [s.alheio]))).toMatch(NAO_ACHOU);
      expect(txt(await criar(c, s, "X", { col: s.colOutra }))).toMatch(/^P0001 armario_colecao_invalida:/);
      expect(await cab(c, s.alheio)).toMatchObject({ nome: "Alheio", status: "rascunho", ordem: 1, tenant_id: s.outroTenant });
      expect(await itens(c, s.alheio)).toHaveLength(1);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.armarios WHERE nome = 'Roubado'`)).n).toBe("0");
    });
  });

  it("ACL: _core sem EXECUTE p/ anon/authenticated/PUBLIC; wrapper so authenticated/service_role; DEFINER search_path=public; core direto negado; reaplica idempotente; down remove as 12", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const W = ["armario_criar(uuid,text,text,text)", "armario_renomear(uuid,text)", "armario_excluir(uuid)", "armario_duplicar(uuid,text)", "armario_reordenar(jsonb)", "armario_status(uuid,text)"].map((x) => `public.${x}`);
      const C = ["_armario_criar_core(uuid,text,text,text)", "_armario_renomear_core(uuid,text)", "_armario_excluir_core(uuid)", "_armario_duplicar_core(uuid,text)", "_armario_reordenar_core(jsonb)", "_armario_status_core(uuid,text)"].map((x) => `public.${x}`);
      const priv = async (fn: string, role: string) => (await um<{ p: boolean }>(c, `SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS p`, [role, fn])).p;
      for (const fn of C) for (const r of ["anon", "authenticated"]) expect(await priv(fn, r), `${fn} ${r}`).toBe(false);
      for (const fn of W) {
        expect(await priv(fn, "anon"), fn).toBe(false);
        expect(await priv(fn, "authenticated"), fn).toBe(true);
        expect(await priv(fn, "service_role"), fn).toBe(true);
      }
      for (const fn of [...W, ...C]) {
        const p = await um<any>(c, `SELECT prosecdef, proconfig, (SELECT count(*) FROM aclexplode(proacl) a WHERE a.grantee = 0) AS publico FROM pg_proc WHERE oid = $1::regprocedure`, [fn]);
        expect(p.prosecdef, fn).toBe(true);
        expect(p.proconfig, fn).toEqual(["search_path=public"]);
        expect(Number(p.publico), fn).toBe(0);
      }
      // authenticated chamando um _core direto: negado pelo ACL
      await comoUsuario(c);
      for (const q of [
        `SELECT public._armario_criar_core(NULL, NULL, 'x', 'n')`, `SELECT public._armario_excluir_core('${NAO_EXISTE}')`,
        `SELECT public._armario_status_core('${NAO_EXISTE}', 'pronto')`, `SELECT public._armario_reordenar_core('[]'::jsonb)`,
      ]) {
        await c.query("SAVEPOINT x");
        await c.query("SET LOCAL ROLE authenticated");
        await expect(c.query(q)).rejects.toMatchObject({ code: "42501" });
        await c.query("ROLLBACK TO SAVEPOINT x");
        await c.query("RESET ROLE");
      }
      await aplicarArquivo(c, MIG); // idempotente
      await aplicarArquivo(c, DOWN);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_proc WHERE proname ~ '^_?armario_(criar|renomear|excluir|duplicar|reordenar|status)'`)).n).toBe("0");
      await aplicarArquivo(c, DOWN); // idempotente
    });
  });
});
