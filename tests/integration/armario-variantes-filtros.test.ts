/**
 * F7 Armario - Melhorias T4 (banco): `armario_variantes_disponiveis` devolve, POR MODELO, os campos dos filtros do dialog
 * (migration 20261203100000). BEGIN...ROLLBACK, SO na copia local (migrations do Armario + esta aplicadas DENTRO da txn pelo harness
 * `aplicarArquivo`; NUNCA \i). Pinos:
 *  - categoria/sub1/grupo (derivado via categoria)/linha/status/mes/ano corretos; eh_acessorio = true so p/ grupo Acessorios;
 *  - modelo sem classificacao -> campos null / eh_acessorio false (e a variante segue la);
 *  - isolamento por tenant: categoria/sub1/linha/mes/ano de OUTRA loja referenciados por um modelo da loja NAO vazam (null);
 *  - ADITIVO: o retorno SEM as chaves novas e identico ao da RPC anterior (20261202120000); assinatura/atributos/grants inalterados;
 *    o down restaura o corpo anterior; migration idempotente.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUB = "Sub F7 T4";
const MIG_C1 = "supabase/migrations/20261202120000_armario_variantes_disponiveis.sql";
const MIG_T4 = "supabase/migrations/20261203100000_armario_variantes_filtros.sql";
const DOWN_T4 = "supabase/rollback/20261203100000_armario_variantes_filtros_down.sql";
const NOVAS = [
  "categoria_principal_id", "categoria_nome", "subcategoria1_id", "subcategoria1_nome", "grupo_id", "grupo_nome",
  "eh_acessorio", "linha_id", "linha_nome", "status_planejamento", "mes_id", "mes_ordem", "ano_id", "ano",
];

async function aplicaBase(c: Client): Promise<void> {
  await aplicarArquivo(c, "supabase/migrations/20261202100000_armario_tabelas.sql");
  await aplicarArquivo(c, "supabase/migrations/20261202110000_armario_trava_publicado.sql");
  await aplicarArquivo(c, MIG_C1);
}
async function aplica(c: Client): Promise<void> {
  await aplicaBase(c);
  await aplicarArquivo(c, MIG_T4);
}

const id = async (c: Client, sql: string, p: unknown[] = []) => (await um<{ id: string }>(c, sql + " RETURNING id", p)).id;
const chamar = async (c: Client, col: string | null, sub: string | null): Promise<any[]> =>
  (await um<{ r: any[] }>(c, "SELECT public.armario_variantes_disponiveis($1, $2, NULL) AS r", [col, sub])).r;
const porModelo = (r: any[], m: string) => r.find((x) => x.modelo_id === m);
const md5Corpo = async (c: Client) =>
  (await um<{ m: string }>(c, "SELECT md5(prosrc) m FROM pg_proc WHERE oid = to_regprocedure('public.armario_variantes_disponiveis(uuid,text,uuid)')")).m;
const semNovas = (r: any[]) => r.map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !NOVAS.includes(k))));

interface Seed {
  col: string; cor: string; vt: string;
  grpRoupa: string; grpAce: string; catRoupa: string; catAce: string; sub1Roupa: string; sub1Ace: string;
  linha: string; mes: string; mesOrdem: number; ano: string;
  mRoupa: string; mAce: string; mNu: string; mVaza: string;
  outroTenant: string;
}

async function semeia(c: Client): Promise<Seed> {
  const outroTenant = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 LIMIT 1", [T])).id;
  const col = await id(c, `INSERT INTO public.colecoes (tenant_id, nome) VALUES ($1, 'Col F7 T4')`, [T]);
  const cor = await id(c, `INSERT INTO public.cores (tenant_id, nome) VALUES ($1, 'Azul T4')`, [T]);
  const vt = await id(c, `INSERT INTO public.variantes_tecido (tenant_id, cor_id, cor_apelido_id) VALUES ($1, $2, NULL)`, [T, cor]);

  const grpRoupa = await id(c, `INSERT INTO public.grupos_produto (tenant_id, nome) VALUES ($1, 'Vestuario T4')`, [T]);
  const grpAce = await id(c, `INSERT INTO public.grupos_produto (tenant_id, nome) VALUES ($1, 'Acessórios T4')`, [T]);
  const catRoupa = await id(c, `INSERT INTO public.categorias_produto (tenant_id, nome, grupo_id) VALUES ($1, 'Vestido T4', $2)`, [T, grpRoupa]);
  const catAce = await id(c, `INSERT INTO public.categorias_produto (tenant_id, nome, grupo_id) VALUES ($1, 'Bolsa T4', $2)`, [T, grpAce]);
  const sub1Roupa = await id(c, `INSERT INTO public.subcategorias1_produto (tenant_id, nome, categoria_id) VALUES ($1, 'Midi T4', $2)`, [T, catRoupa]);
  const sub1Ace = await id(c, `INSERT INTO public.subcategorias1_produto (tenant_id, nome, categoria_id) VALUES ($1, 'Tiracolo T4', $2)`, [T, catAce]);
  const linha = await id(c, `INSERT INTO public.linhas (tenant_id, nome) VALUES ($1, 'Linha Praia T4')`, [T]);
  // meses sao fixos por loja (unique tenant+ordem): usa um existente em vez de semear
  const mesRow = await um<{ id: string; ordem: number; mes: string }>(c, "SELECT id, ordem, mes FROM public.meses WHERE tenant_id = $1 ORDER BY ordem LIMIT 1", [T]);
  const mes = mesRow.id;
  const ano = await id(c, `INSERT INTO public.anos (tenant_id, ano) VALUES ($1, '2099')`, [T]);

  const mod = async (nome: string, o: Record<string, unknown> = {}) => {
    const m = await id(
      c,
      `INSERT INTO public.modelos (tenant_id, nome, origem, colecao_id, subcolecao, categoria_principal_id, subcategoria1_id, linha_id, status_planejamento, mes_id, ano_id)
       VALUES ($1, $2, 'interno', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [T, nome, col, SUB, o.cat ?? null, o.sub1 ?? null, o.linha ?? null, o.status ?? null, o.mes ?? null, o.ano ?? null],
    );
    const mt = await id(c, `INSERT INTO public.modelo_tecidos (modelo_id, numero, tipo) VALUES ($1, 1, 'tecido')`, [m]);
    await c.query(`INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, 1)`, [mt, vt]);
    return m;
  };
  const mRoupa = await mod("A Roupa T4", { cat: catRoupa, sub1: sub1Roupa, linha, status: "em_planejamento", mes, ano });
  const mAce = await mod("B Acessorio T4", { cat: catAce, sub1: sub1Ace });
  const mNu = await mod("C Nu T4");

  // categoria/sub1/linha/mes/ano de OUTRA loja referenciados por um modelo da loja (o DEFINER ignora RLS: o join tem que filtrar por tenant)
  const gO = await id(c, `INSERT INTO public.grupos_produto (tenant_id, nome) VALUES ($1, 'Grupo Alheio T4')`, [outroTenant]);
  const cO = await id(c, `INSERT INTO public.categorias_produto (tenant_id, nome, grupo_id) VALUES ($1, 'Cat Alheia T4', $2)`, [outroTenant, gO]);
  const sO = await id(c, `INSERT INTO public.subcategorias1_produto (tenant_id, nome, categoria_id) VALUES ($1, 'Sub Alheia T4', $2)`, [outroTenant, cO]);
  const lO = await id(c, `INSERT INTO public.linhas (tenant_id, nome) VALUES ($1, 'Linha Alheia T4')`, [outroTenant]);
  const meO = (await um<{ id: string }>(c, "SELECT id FROM public.meses WHERE tenant_id = $1 LIMIT 1", [outroTenant]))?.id
    ?? await id(c, `INSERT INTO public.meses (tenant_id, mes, ordem) VALUES ($1, 'Mes Alheio T4', 3)`, [outroTenant]);
  const aO = await id(c, `INSERT INTO public.anos (tenant_id, ano) VALUES ($1, '2098')`, [outroTenant]);
  const mVaza = await mod("D Vaza T4", { cat: cO, sub1: sO, linha: lO, mes: meO, ano: aO });

  return { col, cor, vt, grpRoupa, grpAce, catRoupa, catAce, sub1Roupa, sub1Ace, linha, mes, mesOrdem: mesRow.ordem, ano, mRoupa, mAce, mNu, mVaza, outroTenant };
}

describe.skipIf(!RODA)("Armario T4 - armario_variantes_disponiveis devolve campos dos filtros", () => {
  it("devolve categoria/sub1/grupo (via categoria)/linha/status/mes/ano corretos; eh_acessorio so p/ grupo Acessorios; sem classificacao = null/false", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const r = await chamar(c, s.col, SUB);
      expect(r.map((x) => x.nome)).toEqual(["A Roupa T4", "B Acessorio T4", "C Nu T4", "D Vaza T4"]);

      expect(porModelo(r, s.mRoupa)).toMatchObject({
        categoria_principal_id: s.catRoupa, categoria_nome: "Vestido T4",
        subcategoria1_id: s.sub1Roupa, subcategoria1_nome: "Midi T4",
        grupo_id: s.grpRoupa, grupo_nome: "Vestuario T4", eh_acessorio: false,
        linha_id: s.linha, linha_nome: "Linha Praia T4", status_planejamento: "em_planejamento",
        mes_id: s.mes, mes_ordem: s.mesOrdem, ano_id: s.ano, ano: "2099",
      });
      // Acessorios: grupo derivado da categoria; eh_acessorio true (acento no nome do grupo)
      expect(porModelo(r, s.mAce)).toMatchObject({
        categoria_nome: "Bolsa T4", subcategoria1_nome: "Tiracolo T4",
        grupo_id: s.grpAce, grupo_nome: "Acessórios T4", eh_acessorio: true,
        linha_id: null, linha_nome: null, status_planejamento: null, mes_id: null, mes_ordem: null, ano_id: null, ano: null,
      });
      // sem classificacao: tudo null, eh_acessorio false (nao null), variante segue no retorno
      const nu = porModelo(r, s.mNu);
      expect(nu).toMatchObject({
        categoria_principal_id: null, categoria_nome: null, subcategoria1_id: null, subcategoria1_nome: null,
        grupo_id: null, grupo_nome: null, eh_acessorio: false, linha_id: null, linha_nome: null, status_planejamento: null,
      });
      for (const k of NOVAS) expect(Object.keys(nu)).toContain(k);
      expect(nu.variantes).toHaveLength(1);
      expect(nu.variantes[0].variante_tecido_id).toBe(s.vt);
    });
  });

  it("isolamento por tenant: categoria/sub1/linha/mes/ano de OUTRA loja nao vazam (join filtrado pela loja do modelo)", async () => {
    await withTx(async (c) => {
      await aplica(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const m = porModelo(await chamar(c, s.col, SUB), s.mVaza);
      // os ids guardados no modelo seguem la (coluna do proprio modelo), mas nomes/derivados da outra loja ficam null
      expect(m.categoria_principal_id).not.toBeNull();
      expect(m).toMatchObject({
        categoria_nome: null, subcategoria1_nome: null, grupo_id: null, grupo_nome: null, eh_acessorio: false,
        linha_nome: null, mes_ordem: null, ano: null,
      });
      const txt = JSON.stringify(await chamar(c, s.col, SUB));
      for (const alheio of ["Cat Alheia T4", "Sub Alheia T4", "Linha Alheia T4", "Grupo Alheio T4", "2098"]) expect(txt).not.toContain(alheio);
    });
  });

  it("ADITIVO: sem as chaves novas o retorno e identico ao da RPC anterior; assinatura/atributos/grants inalterados", async () => {
    await withTx(async (c) => {
      await aplicaBase(c);
      const s = await semeia(c);
      await comoUsuario(c);
      const antes = await chamar(c, s.col, SUB);
      const oidAntes = (await um<{ o: string }>(c, "SELECT to_regprocedure('public.armario_variantes_disponiveis(uuid,text,uuid)')::oid::text o")).o;
      const md5Antes = await md5Corpo(c);
      const attrs = async () => um<any>(c, "SELECT prosecdef, provolatile, proconfig, prorettype::regtype::text rt, pg_get_function_identity_arguments(oid) args, proacl::text acl FROM pg_proc WHERE oid = to_regprocedure('public.armario_variantes_disponiveis(uuid,text,uuid)')");
      const attrAntes = await attrs();
      expect(antes.every((x) => NOVAS.every((k) => !(k in x)))).toBe(true);

      await aplicarArquivo(c, MIG_T4);
      const depois = await chamar(c, s.col, SUB);
      expect(semNovas(depois)).toEqual(antes);
      expect(depois.every((x) => NOVAS.every((k) => k in x))).toBe(true);
      expect(await md5Corpo(c)).not.toBe(md5Antes);
      // mesma funcao (CREATE OR REPLACE: mesmo oid), mesmos atributos e ACL
      expect((await um<{ o: string }>(c, "SELECT to_regprocedure('public.armario_variantes_disponiveis(uuid,text,uuid)')::oid::text o")).o).toBe(oidAntes);
      expect(await attrs()).toEqual(attrAntes);
      expect(attrAntes).toMatchObject({ prosecdef: true, provolatile: "s", proconfig: ["search_path=public"], rt: "jsonb" });
    });
  });

  it("guarda do md5: aplica no corpo do deploy; reaplicar e idempotente; corpo divergente aborta; o down restaura o corpo anterior; anon sem EXECUTE", async () => {
    await withTx(async (c) => {
      await aplicarArquivo(c, "supabase/migrations/20261202100000_armario_tabelas.sql");
      await aplicarArquivo(c, "supabase/migrations/20261202110000_armario_trava_publicado.sql");
      await aplicarArquivo(c, MIG_C1);
      const md5C1 = await md5Corpo(c);
      await aplicarArquivo(c, MIG_T4);
      const md5T4 = await md5Corpo(c);
      expect(md5T4).not.toBe(md5C1);
      await aplicarArquivo(c, MIG_T4); // idempotente
      expect(await md5Corpo(c)).toBe(md5T4);

      // privilegios apos a migration: anon sem EXECUTE, authenticated/service_role com
      const g = await um<any>(c, `SELECT has_function_privilege('anon', o, 'EXECUTE') anon, has_function_privilege('authenticated', o, 'EXECUTE') auth,
        has_function_privilege('service_role', o, 'EXECUTE') svc FROM (SELECT to_regprocedure('public.armario_variantes_disponiveis(uuid,text,uuid)') o) x`);
      expect(g).toEqual({ anon: false, auth: true, svc: true });

      await aplicarArquivo(c, DOWN_T4);
      expect(await md5Corpo(c)).toBe(md5C1);
      await aplicarArquivo(c, DOWN_T4); // idempotente
      expect(await md5Corpo(c)).toBe(md5C1);

      // corpo divergente (nem o do deploy, nem o novo) -> a guarda aborta sem sobrescrever
      await c.query(`CREATE OR REPLACE FUNCTION public.armario_variantes_disponiveis(_colecao_id uuid, _subcolecao text, _armario_id uuid DEFAULT NULL)
        RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN '[]'::jsonb; END; $f$`);
      await expect(aplicarArquivo(c, MIG_T4)).rejects.toThrow(/armario_filtros_dep/);
    });
  });
});
