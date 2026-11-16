/**
 * F7 Armario - Task C1 (banco): RPC de LEITURA `armario_variantes_disponiveis` (migration 20261202120000). BEGIN...ROLLBACK, SO na copia
 * local (A1 + A2 + C1 aplicadas DENTRO da txn pelo harness `aplicarArquivo` - sem BEGIN/COMMIT, NUNCA \i; nada e semeado de forma permanente).
 * Pinos:
 *  - as 3 ORIGENS compoem variantes: interno (Tecido 1 do BOM: so tipo 'tecido' numero 1), revenda (produto_acabado_variantes) e
 *    importado (produto_importado_variantes); ponteiro certo por origem (variante_tecido_id x produto_variante_id);
 *  - em_desenvolvimento: interno sem Tecido 1 / com variante sem cor; revenda sem produto (variantes = []);
 *  - filtro por subcolecao (texto) e por ROTULO de colecao (colecao_id OU texto livre); colecao de outra loja = [];
 *  - ja_em_outro: tupla de identidade igual em armario de OUTRA colecao (cross-colecao); exclui o armario atual (_armario_id);
 *    tupla diferente (outro cor_apelido) nao conta; itens de OUTRA loja nao contam;
 *  - isolamento por tenant: modelos de outra loja nao aparecem; sem login -> 42501; anon sem EXECUTE; authenticated executa.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, semUsuario, um, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUB = "Sub F7 C1";

async function aplica(c: Client): Promise<void> {
  await aplicarArquivo(c, "supabase/migrations/20261202100000_armario_tabelas.sql");
  await aplicarArquivo(c, "supabase/migrations/20261202110000_armario_trava_publicado.sql");
  await aplicarArquivo(c, "supabase/migrations/20261202120000_armario_variantes_disponiveis.sql");
}

const id = async (c: Client, sql: string, p: unknown[] = []) => (await um<{ id: string }>(c, sql + " RETURNING id", p)).id;

interface Seed {
  outroTenant: string;
  colA: string; colB: string; colOutra: string;
  cor1: string; cor2: string; ap1: string; ap2: string;
  mInt: string; mIntSemT1: string; mIntSemCor: string; mRev: string; mRevSemProd: string; mImp: string;
  vt1: string; vt2: string; pav1: string; piv1: string;
  mForaSub: string; mForaCol: string; mOutroTenant: string;
}

async function semeia(c: Client): Promise<Seed> {
  const outroTenant = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 LIMIT 1", [T])).id;
  const colA = await id(c, `INSERT INTO public.colecoes (tenant_id, nome) VALUES ($1, 'Col F7 A')`, [T]);
  const colB = await id(c, `INSERT INTO public.colecoes (tenant_id, nome) VALUES ($1, 'Col F7 B')`, [T]);
  const colOutra = await id(c, `INSERT INTO public.colecoes (tenant_id, nome) VALUES ($1, 'Col F7 A')`, [outroTenant]);
  const cor1 = await id(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'Azul F7')`, [T]);
  const cor2 = await id(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'Verde F7')`, [T]);
  const ap1 = await id(c, `INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id) VALUES ($1, 'Mar F7', $2)`, [T, cor1]);
  const ap2 = await id(c, `INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id) VALUES ($1, 'Ceu F7', $2)`, [T, cor1]);

  const mod = (nome: string, origem: string, o: { colecao_id?: string | null; colecao?: string | null; sub?: string | null; tenant?: string; foto?: string | null; desenho?: string | null; ref?: string | null } = {}) =>
    id(
      c,
      `INSERT INTO public.modelos (tenant_id, nome, origem, colecao_id, colecao, subcolecao, fotos_modelo, desenho_tecnico_url, ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [o.tenant ?? T, nome, origem, o.colecao_id ?? null, o.colecao ?? null, o.sub === undefined ? SUB : o.sub, o.foto ? [o.foto] : null, o.desenho ?? null, o.ref ?? null],
    );

  // INTERNO com Tecido 1 + 2 variantes (cor+apelido; cor), + Tecido 2 e Forro 1 (NAO entram)
  const mInt = await mod("A Int F7", "interno", { colecao_id: colA, foto: "modelos/foto-int.jpg", ref: "REF-INT" });
  const mt1 = await id(c, `INSERT INTO public.modelo_tecidos (modelo_id, numero, tipo) VALUES ($1, 1, 'tecido')`, [mInt]);
  const mt2 = await id(c, `INSERT INTO public.modelo_tecidos (modelo_id, numero, tipo) VALUES ($1, 2, 'tecido')`, [mInt]);
  const mtF = await id(c, `INSERT INTO public.modelo_tecidos (modelo_id, numero, tipo) VALUES ($1, 1, 'forro')`, [mInt]);
  const vt = (cor: string | null, ap: string | null) =>
    id(c, `INSERT INTO public.variantes_tecido (tenant_id, cor_id, cor_apelido_id) VALUES ($1, $2, $3)`, [T, cor, ap]);
  const vt1 = await vt(cor1, ap1);
  const vt2 = await vt(cor2, null);
  const vtOutro = await vt(cor2, ap2);
  const link = (mt: string, v: string, ordem: number) =>
    c.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, $3)`, [mt, v, ordem]);
  await link(mt1, vt2, 2); await link(mt1, vt1, 1); // fora de ordem de insercao: a RPC ordena por `ordem`
  await link(mt2, vtOutro, 1); await link(mtF, vtOutro, 1);

  // INTERNO sem Tecido 1 (so Tecido 2) -> em_desenvolvimento
  const mIntSemT1 = await mod("B IntSemT1 F7", "interno", { colecao_id: colA });
  const mt2b = await id(c, `INSERT INTO public.modelo_tecidos (modelo_id, numero, tipo) VALUES ($1, 2, 'tecido')`, [mIntSemT1]);
  await link(mt2b, vtOutro, 1);
  // INTERNO com Tecido 1 cuja variante nao tem cor -> em_desenvolvimento
  const mIntSemCor = await mod("C IntSemCor F7", "interno", { colecao_id: colA });
  const mt1c = await id(c, `INSERT INTO public.modelo_tecidos (modelo_id, numero, tipo) VALUES ($1, 1, 'tecido')`, [mIntSemCor]);
  await link(mt1c, await vt(null, null), 1);

  // REVENDA (colecao so pelo TEXTO livre = rotulo) com produto espelho: 2 variantes com cor + 1 sem cor (nao entra)
  const mRev = await mod("D Rev F7", "revenda", { colecao: "Col F7 A", desenho: "modelos/desenho-rev.png" });
  const pa = await id(c, `INSERT INTO public.produtos_acabados (tenant_id, modelo_id, nome) VALUES ($1, $2, 'PA F7')`, [T, mRev]);
  const pav = (ordem: number, cor: string | null, ap: string | null) =>
    id(c, `INSERT INTO public.produto_acabado_variantes (tenant_id, produto_acabado_id, ordem, cor_id, cor_apelido_id) VALUES ($1, $2, $3, $4, $5)`, [T, pa, ordem, cor, ap]);
  const pav1 = await pav(1, cor1, ap2);
  await pav(2, cor2, null);
  await pav(3, null, null);
  // REVENDA sem produto -> em_desenvolvimento
  const mRevSemProd = await mod("E RevSemProd F7", "revenda", { colecao_id: colA });

  // IMPORTADO com produto + 1 variante
  const mImp = await mod("F Imp F7", "importado", { colecao_id: colA });
  const pi = await id(c, `INSERT INTO public.produtos_importados (tenant_id, modelo_id, nome) VALUES ($1, $2, 'PI F7')`, [T, mImp]);
  const piv1 = await id(c, `INSERT INTO public.produto_importado_variantes (tenant_id, produto_importado_id, ordem, cor_id, cor_apelido_id) VALUES ($1, $2, 1, $3, $4)`, [T, pi, cor1, ap1]);

  // FORA do escopo: outra subcoleção, outra coleção, outro tenant (mesmo rotulo de colecao e subcolecao)
  const mForaSub = await mod("X ForaSub F7", "interno", { colecao_id: colA, sub: "Outra Sub" });
  const mForaCol = await mod("X ForaCol F7", "interno", { colecao_id: colB });
  const mOutroTenant = await mod("X OutroTenant F7", "interno", { tenant: outroTenant, colecao_id: colOutra });
  return { outroTenant, colA, colB, colOutra, cor1, cor2, ap1, ap2, mInt, mIntSemT1, mIntSemCor, mRev, mRevSemProd, mImp, vt1, vt2, pav1, piv1, mForaSub, mForaCol, mOutroTenant };
}

const chamar = async (c: Client, col: string | null, sub: string | null, arm: string | null = null): Promise<any[]> =>
  (await um<{ r: any[] }>(c, "SELECT public.armario_variantes_disponiveis($1, $2, $3) AS r", [col, sub, arm])).r;
const porModelo = (r: any[], m: string) => r.find((x) => x.modelo_id === m);

async function armarioComItem(c: Client, tenant: string, colecao: string | null, modelo: string, o: { vt?: string | null; pv?: string | null; cor?: string | null; ap?: string | null }, nome = "Arm X"): Promise<string> {
  const a = await id(c, `INSERT INTO public.armarios (tenant_id, colecao_id, subcolecao, nome) VALUES ($1, $2, 'Sub Qualquer', $3)`, [tenant, colecao, nome]);
  await c.query(
    `INSERT INTO public.armario_itens (tenant_id, armario_id, modelo_id, origem, variante_tecido_id, produto_variante_id, cor_id, cor_apelido_id, ordem)
     VALUES ($1, $2, $3, 'x', $4, $5, $6, $7, 1)`,
    [tenant, a, modelo, o.vt ?? null, o.pv ?? null, o.cor ?? null, o.ap ?? null],
  );
  return a;
}

describe.skipIf(!RODA)("Armario C1 - RPC armario_variantes_disponiveis", () => {
  it("as 3 origens compoem as variantes (ponteiro, cor, apelido, ordem); capa, ref e ordem dos cards", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const r = await chamar(c, s.colA, SUB);

      // so os modelos da colecao A + subcolecao SUB da loja (rotulo: colecao_id OU texto livre); ordenados por nome
      expect(r.map((x) => x.nome)).toEqual(["A Int F7", "B IntSemT1 F7", "C IntSemCor F7", "D Rev F7", "E RevSemProd F7", "F Imp F7"]);

      // INTERNO: Tecido 1 apenas (Tecido 2 e Forro 1 fora), ordem do slot, ponteiro = variante_tecido_id
      const i = porModelo(r, s.mInt);
      expect(i).toMatchObject({ nome: "A Int F7", ref: "REF-INT", foto_path: "modelos/foto-int.jpg", origem: "interno", em_desenvolvimento: false });
      expect(i.variantes).toEqual([
        { variante_tecido_id: s.vt1, produto_variante_id: null, cor_id: s.cor1, cor_apelido_id: s.ap1, cor_nome: "Azul F7", cor_apelido_nome: "Mar F7", ordem: 1, ja_em_outro: false, armarios_com: [] },
        { variante_tecido_id: s.vt2, produto_variante_id: null, cor_id: s.cor2, cor_apelido_id: null, cor_nome: "Verde F7", cor_apelido_nome: null, ordem: 2, ja_em_outro: false, armarios_com: [] },
      ]);

      // REVENDA: produto_acabado_variantes (a sem cor nao entra); ponteiro = produto_variante_id; capa = desenho tecnico; ref null (sem ref/ref_auto)
      const rv = porModelo(r, s.mRev);
      expect(rv).toMatchObject({ origem: "revenda", foto_path: "modelos/desenho-rev.png", em_desenvolvimento: false });
      expect(rv.variantes).toHaveLength(2);
      expect(rv.variantes[0]).toMatchObject({ variante_tecido_id: null, produto_variante_id: s.pav1, cor_id: s.cor1, cor_apelido_id: s.ap2, cor_nome: "Azul F7", cor_apelido_nome: "Ceu F7", ordem: 1 });
      expect(rv.variantes[1]).toMatchObject({ variante_tecido_id: null, cor_id: s.cor2, cor_apelido_id: null, ordem: 2 });

      // IMPORTADO: produto_importado_variantes
      const im = porModelo(r, s.mImp);
      expect(im).toMatchObject({ origem: "importado", em_desenvolvimento: false, foto_path: null });
      expect(im.variantes).toEqual([
        { variante_tecido_id: null, produto_variante_id: s.piv1, cor_id: s.cor1, cor_apelido_id: s.ap1, cor_nome: "Azul F7", cor_apelido_nome: "Mar F7", ordem: 1, ja_em_outro: false, armarios_com: [] },
      ]);
    });
  });

  it("em_desenvolvimento: interno sem Tecido 1, interno com variante sem cor e revenda sem produto -> variantes = []", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const r = await chamar(c, s.colA, SUB);
      for (const m of [s.mIntSemT1, s.mIntSemCor, s.mRevSemProd]) {
        const x = porModelo(r, m);
        expect(x.em_desenvolvimento).toBe(true);
        expect(x.variantes).toEqual([]);
      }
      expect(porModelo(r, s.mInt).em_desenvolvimento).toBe(false);
    });
  });

  it("ja_em_outro: tupla igual em armario de OUTRA colecao (cross-colecao); o armario atual nao conta; tupla diferente ou outra loja nao contam", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      // armario em OUTRA colecao (B) com a variante interna vt1 (tupla completa igual), e a revenda pav1 com apelido DIFERENTE (nao casa)
      const aOutra = await armarioComItem(c, T, s.colB, s.mInt, { vt: s.vt1, cor: s.cor1, ap: s.ap1 }, "Vitrine B");
      await armarioComItem(c, T, s.colB, s.mRev, { pv: s.pav1, cor: s.cor1, ap: s.ap1 }, "Vitrine B2"); // pav1 tem ap2 -> tupla diferente
      // armario de OUTRA loja com o importado (mesma tupla): nao conta
      await armarioComItem(c, s.outroTenant, null, s.mImp, { pv: s.piv1, cor: s.cor1, ap: s.ap1 }, "Alheio");
      // o importado no armario ATUAL (colecao A): nao conta contra si mesmo
      const aAtual = await armarioComItem(c, T, s.colA, s.mImp, { pv: s.piv1, cor: s.cor1, ap: s.ap1 }, "Vitrine A");

      let r = await chamar(c, s.colA, SUB, null);
      let i = porModelo(r, s.mInt);
      expect(i.variantes[0]).toMatchObject({ variante_tecido_id: s.vt1, ja_em_outro: true, armarios_com: [{ id: aOutra, nome: "Vitrine B" }] });
      expect(i.variantes[1]).toMatchObject({ variante_tecido_id: s.vt2, ja_em_outro: false, armarios_com: [] });
      expect(porModelo(r, s.mRev).variantes[0]).toMatchObject({ ja_em_outro: false, armarios_com: [] });
      // sem _armario_id: o importado ja esta no "Vitrine A" (so nesta loja; o da outra loja nao aparece)
      expect(porModelo(r, s.mImp).variantes[0]).toMatchObject({ ja_em_outro: true, armarios_com: [{ id: aAtual, nome: "Vitrine A" }] });

      // com _armario_id = o armario atual: o importado deixa de contar; o interno (em outro armario) continua
      r = await chamar(c, s.colA, SUB, aAtual);
      expect(porModelo(r, s.mImp).variantes[0]).toMatchObject({ ja_em_outro: false, armarios_com: [] });
      expect(porModelo(r, s.mInt).variantes[0].ja_em_outro).toBe(true);
      // com _armario_id = o armario que tem o interno: ele deixa de contar
      r = await chamar(c, s.colA, SUB, aOutra);
      i = porModelo(r, s.mInt);
      expect(i.variantes[0]).toMatchObject({ ja_em_outro: false, armarios_com: [] });
    });
  });

  it("filtro: _colecao_id de outra loja/inexistente = []; outra subcolecao so traz o seu; _colecao_id NULL = modelos sem rotulo", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      expect(await chamar(c, s.colOutra, SUB)).toEqual([]); // colecao de OUTRA loja (mesmo nome!)
      expect(await chamar(c, "00000000-0000-4000-8000-0000000000aa", SUB)).toEqual([]);
      const rSub = await chamar(c, s.colA, "Outra Sub");
      expect(rSub.map((x) => x.modelo_id)).toEqual([s.mForaSub]);
      const rB = await chamar(c, s.colB, SUB);
      expect(rB.map((x) => x.modelo_id)).toEqual([s.mForaCol]);
      // subcolecao nao encontrada
      expect(await chamar(c, s.colA, "Nao Existe")).toEqual([]);
      // _colecao_id NULL: so modelos sem rotulo de colecao (nenhum dos semeados na SUB)
      expect(await chamar(c, null, SUB)).toEqual([]);
    });
  });

  it("isolamento por tenant: o modelo da outra loja (mesmo rotulo de colecao e subcolecao) nunca aparece; sem login = 42501; anon sem EXECUTE; authenticated executa", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const todos = [
        ...(await chamar(c, s.colA, SUB)), ...(await chamar(c, s.colB, SUB)), ...(await chamar(c, s.colA, "Outra Sub")),
      ].map((x) => x.modelo_id);
      expect(todos).not.toContain(s.mOutroTenant);

      // como PAPEL authenticated (PostgREST real): executa e devolve o mesmo
      await c.query("SET LOCAL ROLE authenticated");
      const viaRole = (await um<{ r: any[] }>(c, "SELECT public.armario_variantes_disponiveis($1, $2, NULL) AS r", [s.colA, SUB])).r;
      await c.query("RESET ROLE");
      expect(viaRole).toHaveLength(6);

      // anon: sem EXECUTE (42501)
      await c.query("SAVEPOINT anon_t");
      await c.query("SET LOCAL ROLE anon");
      let cod = "";
      try { await chamar(c, s.colA, SUB); } catch (e) { cod = (e as { code?: string }).code ?? ""; }
      await c.query("ROLLBACK TO SAVEPOINT anon_t");
      await c.query("RESET ROLE");
      expect(cod).toBe("42501");

      // sem login (auth.uid() nulo): recusa ASCII 42501
      await semUsuario(c);
      await c.query("SAVEPOINT sem_login");
      let msg = "";
      let cod2 = "";
      try { await chamar(c, s.colA, SUB); } catch (e) { const er = e as { code?: string; message?: string }; cod2 = er.code ?? ""; msg = er.message ?? ""; }
      await c.query("ROLLBACK TO SAVEPOINT sem_login");
      expect(cod2).toBe("42501");
      expect(msg).toBe("armario_nao_autenticado");
    });
  });

  it("migration idempotente (2a aplicacao nao falha) e o down remove a funcao", async () => {
    await withTx(async (c) => {
      await aplica(c);
      await aplicarArquivo(c, "supabase/migrations/20261202120000_armario_variantes_disponiveis.sql");
      expect((await um<{ n: number }>(c, "SELECT count(*)::int n FROM pg_proc WHERE proname = 'armario_variantes_disponiveis'")).n).toBe(1);
      await aplicarArquivo(c, "supabase/rollback/20261202120000_armario_variantes_disponiveis_down.sql");
      expect((await um<{ n: number }>(c, "SELECT count(*)::int n FROM pg_proc WHERE proname = 'armario_variantes_disponiveis'")).n).toBe(0);
    });
  });
});
