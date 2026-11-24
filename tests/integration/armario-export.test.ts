// Exportar itens do Armario em CSV — RPC exportar_armario (+ _exportar_armario_core). Migration 20261124100000_exportar_armario.
// SO na copia local (Docker 54422), cada caso em txn revertida (withTx): se a copia ainda nao tem a migration, ela e aplicada
// DENTRO da txn pelo harness (mig-txn, nunca \i). Semeia (Loja Teste, txn) 2 modelos com taxonomia, cores/apelido com sigla e 1 armario
// com 3 itens fora de ordem; confere ordem/1 linha por item, SKU ate a cor (sem tamanho), taxonomia, nome, loja sem formato,
// armario de outra loja e privilegios.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, semUsuario, um, TENANT_TESTE as T, USER_TESTE as U, ehBancoLocal } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { comoUsuarioCom } from "./integracao-helpers";

const LOCAL = ehBancoLocal();
const MIG = "supabase/migrations/20261124100000_exportar_armario.sql";
const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
const SIG_EXP = "public.exportar_armario(uuid)";
const SIG_CORE = "public._exportar_armario_core(uuid,uuid)";
const U_COMUM = "f7c40000-0000-4000-8000-0000000000e1";

type Linha = { sku_pai: string | null; grupo: string | null; categoria: string | null; subcategoria1: string | null; subcategoria2: string | null };
type Ret = { nome_armario: string; linhas: Linha[] };

/** RPCs vivas NESTA txn (se a copia ainda nao as tem, a ida roda dentro da txn). */
async function viva(c: Client): Promise<void> {
  const tem = (await um<{ ok: boolean }>(c, `SELECT to_regprocedure('${SIG_EXP}') IS NOT NULL AS ok`)).ok;
  if (!tem) {
    try {
      await aplicarArquivo(c, MIG);
    } finally {
      // a migration faz SET LOCAL transaction_timeout (valeria para a txn INTEIRA do teste)
      await c.query("SET LOCAL transaction_timeout = 0");
      await c.query("SET LOCAL lock_timeout = '3s'");
    }
  }
}

type Semente = {
  armario: string; nome: string;
  refA: string; refB: string;
  azul: { cor: string; sigla: string }; vermelho: { cor: string; sigla: string }; apelido: { id: string; sigla: string };
  taxo: { grupo: string; categoria: string; sub1: string; sub2: string };
  modeloA: string; modeloB: string;
  itens: { azul: string; apelido: string; vermelho: string }; // ids dos itens
};

let seq = 0;
const suf = (): string => `${Date.now().toString(36)}${(seq++).toString(36)}`.toUpperCase();

async function formato(c: Client, cfg: unknown): Promise<void> {
  await c.query(`UPDATE public.tenant_config SET sku_config = $1::jsonb WHERE tenant_id = $2`, [cfg == null ? null : JSON.stringify(cfg), T]);
}

/**
 * Armario da Loja Teste com 3 itens inseridos FORA de ordem (ordem 2, 0, 1):
 *   ordem 0 = modelo A + cor azul, ordem 1 = modelo B (sem taxonomia) + cor azul + apelido, ordem 2 = modelo A + cor vermelha.
 * Modelo A tem grupo/categoria/sub1/sub2; modelo B nao tem nenhuma. Formato do SKU da loja = ref + cor_base + tamanho (padrao dos casos).
 */
async function semeia(c: Client): Promise<Semente> {
  const s = suf();
  const refA = `ZAE${s}`;
  const refB = `ZBE${s}`;
  const grupo = `Grupo ${s}`;
  const categoria = `Categoria ${s}`;
  const sub1 = `Sub1 ${s}`;
  const sub2 = `Sub2 ${s}`;
  const g = (await um<{ id: string }>(c, `INSERT INTO public.grupos_produto (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [T, grupo])).id;
  const cat = (await um<{ id: string }>(c, `INSERT INTO public.categorias_produto (tenant_id, nome, grupo_id) VALUES ($1, $2, $3) RETURNING id`, [T, categoria, g])).id;
  const s1 = (await um<{ id: string }>(c, `INSERT INTO public.subcategorias1_produto (tenant_id, nome, categoria_id) VALUES ($1, $2, $3) RETURNING id`, [T, sub1, cat])).id;
  const s2 = (await um<{ id: string }>(c, `INSERT INTO public.subcategorias2_produto (tenant_id, nome, categoria_id) VALUES ($1, $2, $3) RETURNING id`, [T, sub2, cat])).id;
  const azul = (await um<{ id: string }>(c, `INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, $2, 'QZ') RETURNING id`, [T, `Azul ${s}`])).id;
  const vermelho = (await um<{ id: string }>(c, `INSERT INTO public.cores (tenant_id, nome, sigla_sku) VALUES ($1, $2, 'QW') RETURNING id`, [T, `Vermelho ${s}`])).id;
  const apel = (await um<{ id: string }>(c, `INSERT INTO public.cores_apelido (tenant_id, nome, cor_base_id, sigla_sku) VALUES ($1, $2, $3, 'QK') RETURNING id`, [T, `Marinho ${s}`, azul])).id;
  const mA = (await um<{ id: string }>(
    c,
    `INSERT INTO public.modelos (tenant_id, nome, ref, origem, categoria_principal_id, subcategoria1_id, subcategoria2_id)
     VALUES ($1, $2, $3, 'interno', $4, $5, $6) RETURNING id`,
    [T, `ZZ Armario Vestido ${s}`, refA, cat, s1, s2],
  )).id;
  const mB = (await um<{ id: string }>(
    c, `INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, $2, $3, 'interno') RETURNING id`, [T, `ZZ Armario Blusa ${s}`, refB],
  )).id;
  const nome = `Armario Verao ${s}`;
  const arm = (await um<{ id: string }>(c, `INSERT INTO public.armarios (tenant_id, nome) VALUES ($1, $2) RETURNING id`, [T, nome])).id;
  const item = async (modelo: string, origem: string, cor: string | null, apelido: string | null, ordem: number): Promise<string> =>
    (await um<{ id: string }>(
      c,
      `INSERT INTO public.armario_itens (tenant_id, armario_id, modelo_id, origem, cor_id, cor_apelido_id, ordem, variante_tecido_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, gen_random_uuid()) RETURNING id`,
      [T, arm, modelo, origem, cor, apelido, ordem],
    )).id;
  // inseridos fora de ordem de proposito
  const iVerm = await item(mA, "interno", vermelho, null, 2);
  const iAzul = await item(mA, "interno", azul, null, 0);
  const iApel = await item(mB, "interno", azul, apel, 1);
  // formato de SKU padrao dos casos: ref + cor_base + tamanho (com siglas de tamanho da loja, para provar que o tamanho NAO entra)
  await c.query(`UPDATE public.tenant_config SET tamanhos_sku = $1::jsonb WHERE tenant_id = $2`, [JSON.stringify({ P: "OOP", M: "OOM", PP: "OPP" }), T]);
  await formato(c, { partes: ["ref", "cor_base", "tamanho"], separadores: {} });
  return {
    armario: arm, nome, refA, refB,
    azul: { cor: azul, sigla: "QZ" }, vermelho: { cor: vermelho, sigla: "QW" }, apelido: { id: apel, sigla: "QK" },
    taxo: { grupo, categoria, sub1, sub2 },
    modeloA: mA, modeloB: mB,
    itens: { azul: iAzul, apelido: iApel, vermelho: iVerm },
  };
}

async function exporta(c: Client, id: string): Promise<Ret> {
  return (await um<{ j: Ret }>(c, `SELECT public.exportar_armario($1) AS j`, [id])).j;
}
async function tenta(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT ea_t");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT ea_t");
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("ROLLBACK TO SAVEPOINT ea_t");
    await c.query("RELEASE SAVEPOINT ea_t");
    return `${er.code} ${er.message}`;
  }
}

describe.skipIf(!hasDb || !LOCAL)("exportar armario — RPC exportar_armario / _exportar_armario_core", () => {
  it("1 linha por item, na ordem da vitrine (ordem do item, nao a de insercao); shape {nome_armario, linhas[5 chaves]}", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await comoUsuario(c, U);
      const j = await exporta(c, s.armario);
      expect(Object.keys(j).sort()).toEqual(["linhas", "nome_armario"]);
      expect(j.linhas).toHaveLength(3);
      for (const l of j.linhas) expect(Object.keys(l).sort()).toEqual(["categoria", "grupo", "sku_pai", "subcategoria1", "subcategoria2"]);
      // ordem 0 (modelo A azul), 1 (modelo B azul+apelido), 2 (modelo A vermelho); inseridos 2, 0, 1
      expect(j.linhas.map((l) => l.sku_pai)).toEqual([`${s.refA}QZ`, `${s.refB}QZ`, `${s.refA}QW`]);
      // armario vazio = linhas []
      const vazio = (await um<{ id: string }>(c, `INSERT INTO public.armarios (tenant_id, nome) VALUES ($1, 'Vazio') RETURNING id`, [T])).id;
      expect(await exporta(c, vazio)).toEqual({ nome_armario: "Vazio", linhas: [] });
    });
  });

  it("SKU pai = SKU ATE A COR, sem o tamanho (formato com tamanho: '1234AZ', nunca '1234AZPP'); segue o formato da loja (apelido, separadores, tamanho no meio, sem tamanho)", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await comoUsuario(c, U);
      const sku = async () => (await exporta(c, s.armario)).linhas.map((l) => l.sku_pai);

      // (a) ref + cor_base + tamanho => REF+cor; o tamanho nao entra
      let r = await sku();
      expect(r[0]).toBe(`${s.refA}${s.azul.sigla}`);
      expect(r[0]).not.toMatch(/OO|OPP|OOP|OOM/); // nenhuma sigla de tamanho
      // oraculo independente: o SKU completo previsto de um tamanho da mesma cor comeca pelo SKU pai e e mais longo
      const completo = (await um<{ sku: string }>(c, `SELECT public._sku_resolver(tc.sku_config, $1, jsonb_build_object('id', co.id, 'nome', co.nome, 'sigla', co.sigla_sku), NULL, 'P', 'letra', tc.tamanhos_sku) ->> 'sku' AS sku
        FROM public.tenant_config tc, public.cores co WHERE tc.tenant_id = $2 AND co.id = $3`, [s.refA, T, s.azul.cor])).sku;
      expect(completo).toBe(`${s.refA}${s.azul.sigla}OOP`);
      expect(completo.startsWith(r[0] as string)).toBe(true);

      // (b) cor_base + cor_apelido + tamanho com separadores: REF-BASE.APEL (sem o tamanho); item sem apelido sai so com a base
      await formato(c, { partes: ["ref", "cor_base", "cor_apelido", "tamanho"], separadores: { "ref|cor_base": "-", "cor_base|cor_apelido": ".", "cor_apelido|tamanho": "_" } });
      r = await sku();
      expect(r[0]).toBe(`${s.refA}-${s.azul.sigla}`); // item sem apelido
      expect(r[1]).toBe(`${s.refB}-${s.azul.sigla}.${s.apelido.sigla}`); // item com apelido
      expect(r[2]).toBe(`${s.refA}-${s.vermelho.sigla}`);

      // (c) so cor_apelido no formato (cor_no_nome nao interfere): o apelido; item sem apelido cai na cor base
      await formato(c, { partes: ["ref", "cor_apelido", "tamanho"], separadores: { "ref|cor_apelido": "_" } });
      r = await sku();
      expect(r[1]).toBe(`${s.refB}_${s.apelido.sigla}`);
      expect(r[0]).toBe(`${s.refA}_${s.azul.sigla}`);

      // (d) tamanho NO MEIO: o separador que o antecede some e o que o segue liga a parte anterior (REF-P.AZ -> REF.AZ)
      await formato(c, { partes: ["ref", "tamanho", "cor_base"], separadores: { "ref|tamanho": "-", "tamanho|cor_base": "." } });
      r = await sku();
      expect(r[0]).toBe(`${s.refA}.${s.azul.sigla}`);

      // (e) formato SEM tamanho: o SKU ate a cor e o proprio SKU
      await formato(c, { partes: ["ref", "cor_base"], separadores: { "ref|cor_base": "-" } });
      r = await sku();
      expect(r[0]).toBe(`${s.refA}-${s.azul.sigla}`);

      // (f) so tamanho no formato: nada sobra => null
      await formato(c, { partes: ["tamanho"], separadores: {} });
      r = await sku();
      expect(r).toEqual([null, null, null]);

      // (g) falta a sigla da cor base: null (nao inventa SKU); o item da outra cor segue
      await formato(c, { partes: ["ref", "cor_base", "tamanho"], separadores: {} });
      await c.query(`UPDATE public.cores SET sigla_sku = NULL WHERE id = $1`, [s.vermelho.cor]);
      r = await sku();
      expect(r[2]).toBeNull();
      expect(r[0]).toBe(`${s.refA}${s.azul.sigla}`);
    });
  });

  it("taxonomia do modelo do item: grupo / categoria / subcategoria 1 / subcategoria 2 (modelo sem taxonomia = null)", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await comoUsuario(c, U);
      const j = await exporta(c, s.armario);
      const taxo = { grupo: s.taxo.grupo, categoria: s.taxo.categoria, subcategoria1: s.taxo.sub1, subcategoria2: s.taxo.sub2 };
      expect(j.linhas[0]).toMatchObject(taxo);
      expect(j.linhas[2]).toMatchObject(taxo);
      expect(j.linhas[1]).toMatchObject({ grupo: null, categoria: null, subcategoria1: null, subcategoria2: null }); // modelo B
      // nome em branco/espacos vira null (nunca string vazia)
      await c.query(`UPDATE public.subcategorias2_produto SET nome = '   ' WHERE tenant_id = $1 AND nome = $2`, [T, s.taxo.sub2]);
      expect((await exporta(c, s.armario)).linhas[0].subcategoria2).toBeNull();
    });
  });

  it("nome do armario vem UMA vez no topo", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await comoUsuario(c, U);
      expect((await exporta(c, s.armario)).nome_armario).toBe(s.nome);
      await c.query(`UPDATE public.armarios SET nome = 'Outro nome' WHERE id = $1`, [s.armario]);
      expect((await exporta(c, s.armario)).nome_armario).toBe("Outro nome");
    });
  });

  it("loja SEM formato de SKU (partes [] ou sku_config nulo) => sku_pai null em todas as linhas; taxonomia segue", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await comoUsuario(c, U);
      for (const cfg of [{ partes: [], separadores: {}, cor_no_nome: "cor_base" }, null]) {
        await formato(c, cfg);
        const j = await exporta(c, s.armario);
        expect(j.linhas).toHaveLength(3);
        expect(j.linhas.map((l) => l.sku_pai)).toEqual([null, null, null]);
        expect(j.linhas[0].categoria).toBe(s.taxo.categoria);
      }
    });
  });

  it("armario de OUTRA loja ou inexistente = armario_nao_encontrado (mesmo erro, sem oraculo); item de modelo de outra loja nao vaza", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      const outro = (await um<{ id: string }>(c, `INSERT INTO public.armarios (tenant_id, nome) VALUES ($1, 'Da Ave Rara') RETURNING id`, [AVE_RARA])).id;
      const modeloOutro = (await um<{ id: string }>(
        c, `INSERT INTO public.modelos (tenant_id, nome, ref, origem) VALUES ($1, 'ZZ Modelo Ave Rara', 'XL00000042', 'interno') RETURNING id`, [AVE_RARA],
      )).id;
      // item "envenenado": armario da Loja Teste apontando para um modelo da outra loja
      await c.query(`INSERT INTO public.armario_itens (tenant_id, armario_id, modelo_id, origem, ordem, variante_tecido_id) VALUES ($1, $2, $3, 'interno', 9, gen_random_uuid())`, [T, s.armario, modeloOutro]);
      await comoUsuario(c, U);
      expect(await tenta(c, `SELECT public.exportar_armario($1)`, [outro])).toBe("P0001 armario_nao_encontrado");
      expect(await tenta(c, `SELECT public.exportar_armario($1)`, ["11111111-1111-4111-8111-111111111111"])).toBe("P0001 armario_nao_encontrado");
      expect(await tenta(c, `SELECT public.exportar_armario(NULL)`)).toBe("P0001 armario_nao_encontrado");
      // o armario proprio exporta so os 3 itens da propria loja
      expect((await exporta(c, s.armario)).linhas).toHaveLength(3);
      // _core: a loja vem por parametro e filtra tudo; loja nula/nil = exportar_armario_sem_loja
      expect(await tenta(c, `SELECT public._exportar_armario_core($1, $2)`, [AVE_RARA, s.armario])).toBe("P0001 armario_nao_encontrado");
      expect(await tenta(c, `SELECT public._exportar_armario_core($1, $2)`, [T, outro])).toBe("P0001 armario_nao_encontrado");
      expect(await tenta(c, `SELECT public._exportar_armario_core(NULL, $1)`, [s.armario])).toBe("P0001 exportar_armario_sem_loja");
      expect(await tenta(c, `SELECT public._exportar_armario_core('00000000-0000-0000-0000-000000000000', $1)`, [s.armario])).toBe("P0001 exportar_armario_sem_loja");
    });
  });

  it("portao do wrapper: sem login = 42501; sem VER criacao_armario = 42501 sem_permissao_pagina; so VER basta (nao exige editar)", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await semUsuario(c);
      expect(await tenta(c, `SELECT public.exportar_armario($1)`, [s.armario])).toBe("42501 armario_nao_autenticado");
      // usuario comum sem nenhuma permissao / com outra pagina
      await comoUsuarioCom(c, U_COMUM, []);
      expect(await tenta(c, `SELECT public.exportar_armario($1)`, [s.armario])).toBe("42501 sem_permissao_pagina: criacao_armario");
      await c.query(`INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'criacao_planejamento', true, true)`, [U_COMUM, T]);
      expect(await tenta(c, `SELECT public.exportar_armario($1)`, [s.armario])).toBe("42501 sem_permissao_pagina: criacao_armario");
      // so VER a pagina do Armario (sem editar) = exporta
      await c.query(`INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, 'criacao_armario', true, false)`, [U_COMUM, T]);
      const j = await exporta(c, s.armario);
      expect(j.linhas).toHaveLength(3);
      // de verdade, pelo papel authenticated (PostgREST): o wrapper e chamavel
      await c.query("SET LOCAL ROLE authenticated");
      expect(await tenta(c, `SELECT public.exportar_armario($1)`, [s.armario])).toBe("PASSOU");
      await c.query("RESET ROLE");
    });
  });

  it("EXECUTE: _core revogado de PUBLIC/anon/authenticated (chamar direto como authenticated = permission denied); wrapper so authenticated/service_role", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      const priv = async (fn: string, role: string) => (await um<{ p: boolean }>(c, `SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS p`, [role, fn])).p;
      expect(await priv(SIG_CORE, "anon")).toBe(false);
      expect(await priv(SIG_CORE, "authenticated")).toBe(false);
      const publicoCore = await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = $1::regprocedure AND a.grantee = 0`, [SIG_CORE]);
      expect(Number(publicoCore.n)).toBe(0); // nenhum grant PUBLIC
      expect(await priv(SIG_EXP, "anon")).toBe(false);
      expect(await priv(SIG_EXP, "authenticated")).toBe(true);
      expect(await priv(SIG_EXP, "service_role")).toBe(true);
      const publicoExp = await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = $1::regprocedure AND a.grantee = 0`, [SIG_EXP]);
      expect(Number(publicoExp.n)).toBe(0);
      // DEFINER + search_path nas duas
      for (const f of [SIG_CORE, SIG_EXP]) {
        const p = await um<{ prosecdef: boolean; proconfig: string[] }>(c, `SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure`, [f]);
        expect(p.prosecdef, f).toBe(true);
        expect(p.proconfig, f).toEqual(["search_path=public"]);
      }
      // de verdade, pelo papel: _core direto = permission denied (authenticated e anon)
      await comoUsuario(c, U);
      for (const papel of ["authenticated", "anon"]) {
        await c.query(`SET LOCAL ROLE ${papel}`);
        const msg = await tenta(c, `SELECT public._exportar_armario_core($1, $2)`, [T, s.armario]);
        await c.query("RESET ROLE");
        expect(msg, papel).toMatch(/^42501 permission denied/);
      }
      // anon nem o wrapper
      await c.query("SET LOCAL ROLE anon");
      expect(await tenta(c, `SELECT public.exportar_armario($1)`, [s.armario])).toMatch(/^42501 permission denied/);
      await c.query("RESET ROLE");
      // sem sobrecarga: 1 funcao de cada nome
      const n = await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('exportar_armario', '_exportar_armario_core')`);
      expect(Number(n.n)).toBe(2);
    });
  });
});
