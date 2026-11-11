// Exportar dados (Integracao > Exportar) — RPCs exportar_produtos / exportar_subcolecoes (+ _exportar_produtos_core).
// Migration 20261122100000_exportar_dados. SO na copia local (Docker 54422), cada caso em txn revertida (withTx): a migration,
// se a copia ainda nao a tem, e aplicada DENTRO da txn pelo harness (mig-txn, nunca \i). Semeia (Loja Teste, txn) 4 produtos
// numa colecao/subcolecao de teste — interno, revenda, importado e 1 interno REPROVADO — e confere recorte, niveis, campos,
// taxonomia por loja, limite, validacoes, portao e privilegios.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, semUsuario, um } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { LOCAL, T, U, modeloInterno, revenda, importado, comoUsuarioCom } from "./integracao-helpers";

const MIG = "supabase/migrations/20261122100000_exportar_dados.sql";
const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
const COL = "QA-EXP";
const SIG_EXP = "public.exportar_produtos(text,text,text[],text[],integer)";
const SIG_SUB = "public.exportar_subcolecoes(text)";
const SIG_CORE = "public._exportar_produtos_core(uuid,text,text,text[],text[],integer)";

type Linha = Record<string, any>;
type Ret = { colunas: string[]; total: number; niveis: Record<string, Linha[]> };

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

type Semente = { interno: string; revenda: string; importado: string; reprovado: string; refs: Record<string, string> };
/** 4 produtos em QA-EXP/R1 + 1 em QA-EXP/R2 + 1 em OUTRA colecao + 1 de OUTRA loja com o mesmo nome de colecao. */
async function semeia(c: Client): Promise<Semente> {
  await comoUsuario(c, U); // super admin da Loja Teste: as fixtures de preco passam pelo gatilho de preco de venda
  const i = await modeloInterno(c, { nome: "ZZ Blusa Interna" });
  const r = await revenda(c, { nome: "ZZ Bolsa Revenda" });
  const m = await importado(c, { nome: "ZZ Macacao Importado" });
  const x = await modeloInterno(c, { nome: "ZZ Vestido Reprovado" });
  const outraSub = await modeloInterno(c, { nome: "ZZ Outra Sub" });
  const outraCol = await modeloInterno(c, { nome: "ZZ Outra Colecao" });
  for (const f of [i, r, m, x]) {
    await c.query(`UPDATE public.modelos SET colecao = $2, subcolecao = 'R1' WHERE id = $1`, [f.id, COL]);
  }
  await c.query(`UPDATE public.modelos SET colecao = $2, subcolecao = 'R2' WHERE id = $1`, [outraSub.id, COL]);
  await c.query(`UPDATE public.modelos SET colecao = 'QA-OUTRA', subcolecao = 'R9' WHERE id = $1`, [outraCol.id]);
  await c.query(`UPDATE public.modelos SET status_planejamento = 'reprovado' WHERE id = $1`, [x.id]);
  // outra loja, mesma colecao/subcolecao: nunca pode aparecer
  await c.query(
    `INSERT INTO public.modelos (tenant_id, nome, ref, origem, colecao, subcolecao) VALUES ($1, 'ZZ De Outra Loja', 'XL00000001', 'interno', $2, 'R1')`,
    [AVE_RARA, COL],
  );
  return { interno: i.id, revenda: r.id, importado: m.id, reprovado: x.id, refs: { interno: i.ref, revenda: r.ref, importado: m.ref, reprovado: x.ref } };
}

async function exporta(c: Client, sub: string | null, campos: string[], niveis: string[], limite: number | null = null, col: string | null = COL): Promise<Ret> {
  return (await um<{ j: Ret }>(c, `SELECT public.exportar_produtos($1, $2, $3::text[], $4::text[], $5) AS j`, [col, sub, campos, niveis, limite])).j;
}
async function tenta(c: Client, sql: string, params: unknown[] = []): Promise<string> {
  await c.query("SAVEPOINT ex_t");
  try {
    await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT ex_t");
    return "PASSOU";
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("ROLLBACK TO SAVEPOINT ex_t");
    await c.query("RELEASE SAVEPOINT ex_t");
    return `${er.code} ${er.message}`;
  }
}

describe.skipIf(!hasDb || !LOCAL)("exportar dados — RPC exportar_produtos / exportar_subcolecoes", () => {
  it("nivel 1: 1 linha por produto (as 3 origens), INCLUI o reprovado, so os campos pedidos, so a loja e a colecao/subcolecao pedidas", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await comoUsuario(c, U);
      const j = await exporta(c, "R1", ["nome", "ref_sku", "origem", "subcolecao", "preco_venda"], ["1"]);
      expect(j.colunas).toEqual(["nome", "ref_sku", "origem", "subcolecao", "preco_venda"]);
      expect(j.total).toBe(4);
      expect(Object.keys(j.niveis)).toEqual(["1"]);
      const l = j.niveis["1"];
      expect(l).toHaveLength(4); // 1 linha por produto
      // ordenado por nome; reprovado presente; origens das 3 familias
      expect(l.map((x) => x.nome)).toEqual(["ZZ Blusa Interna", "ZZ Bolsa Revenda", "ZZ Macacao Importado", "ZZ Vestido Reprovado"]);
      expect(l.map((x) => x.origem)).toEqual(["interno", "revenda", "importado", "interno"]);
      expect(l.find((x) => x.nome === "ZZ Vestido Reprovado")!.ref_sku).toBe(s.refs.reprovado);
      for (const x of l) {
        expect(Object.keys(x).sort()).toEqual(["nome", "origem", "preco_venda", "ref_sku", "subcolecao"]); // so os pedidos
        expect(x.subcolecao).toBe("R1");
        expect(x.preco_venda).toBe(159.9); // numero JSON, nao texto
      }
      // nada de outra loja / outra subcolecao / outra colecao
      expect(l.some((x) => ["ZZ De Outra Loja", "ZZ Outra Sub", "ZZ Outra Colecao"].includes(x.nome))).toBe(false);
      // sem subcolecao = a colecao inteira (R1 + R2), ainda sem outra loja/colecao
      const todos = await exporta(c, null, ["nome"], ["1"]);
      expect(todos.total).toBe(5);
      expect(todos.niveis["1"].map((x) => x.nome)).toContain("ZZ Outra Sub");
      expect(todos.niveis["1"].map((x) => x.nome)).not.toContain("ZZ De Outra Loja");
    });
  });

  it("campos: valores efetivos (preco, custo, titulo, medidas, NCM, descricao, extras da colecao) batem com as fontes", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await comoUsuario(c, U);
      const campos = ["nome", "preco_anterior", "preco_venda", "preco_atacado", "preco_custo", "peso", "ncm", "titulo", "descricao", "metatag",
        "comprimento", "largura", "altura", "colecao", "linha", "categoria_tecido", "origem", "foto", "keywords"];
      await c.query(`UPDATE public.modelos SET preco_atacado = 99.5 WHERE id = $1`, [s.interno]);
      const j = await exporta(c, "R1", campos, ["1"]);
      const x = j.niveis["1"].find((l) => l.nome === "ZZ Blusa Interna")!;
      expect(x).toMatchObject({
        preco_anterior: 179.9, preco_venda: 159.9, preco_atacado: 99.5, peso: 0.22, ncm: "6109.10.00", titulo: "Blusa Brisa Manga Longa",
        descricao: "Blusa em viscose, manga longa.", metatag: "Blusa em viscose, manga longa.", comprimento: 68, largura: 42, altura: 2, origem: "interno",
        colecao: COL, // texto livre, sem colecao no OTB
      });
      expect(x.foto).toBe(`${T}/fotos_modelo/integracao-teste.jpg`);
      // custo = a MESMA conta do retrato da Integracao (real se confirmado, senao previsto) — oracle independente
      const custo = (await um<{ c: any }>(c, `SELECT public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text AS c`, [s.interno])).c;
      const esperado = custo.confirmado ? custo.real : custo.previsto;
      expect(x.preco_custo).toBe(esperado == null || Number(esperado) <= 0 ? null : Number(Number(esperado).toFixed(2)));
      // extras: iguais a fonte unica _integracao_extras
      const ex = (await um<{ e: any }>(c, `SELECT public._integracao_extras($1) AS e`, [s.interno])).e;
      expect(x.linha).toBe(ex.linha);
      expect(x.categoria_tecido).toBe(ex.categoria_tecido);
    });
  });

  it("titulo e preco anterior VAZIOS no card saem pelo automatico (como o retrato da Integracao)", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await comoUsuario(c, U);
      await c.query(`UPDATE public.modelos SET titulo_pagina = NULL, preco_anterior = NULL WHERE id = $1`, [s.interno]);
      const auto = await um<{ t: string | null; p: string | null }>(c, `SELECT titulo_auto AS t, preco_auto::text AS p FROM public._modelo_automaticos($1)`, [s.interno]);
      const j = await exporta(c, "R1", ["nome", "titulo", "preco_anterior"], ["1"]);
      const x = j.niveis["1"].find((l) => l.nome === "ZZ Blusa Interna")!;
      expect(x.titulo).toBe(auto.t);
      expect(x.preco_anterior).toBe(auto.p == null ? null : Number(auto.p));
    });
  });

  it("taxonomia grupo/categoria/subcategorias por LOJA do modelo (id de outra loja = vazio)", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      const g = (await um<{ id: string }>(c, `INSERT INTO public.grupos_produto (tenant_id, nome) VALUES ($1, 'ZZ Grupo') RETURNING id`, [T])).id;
      const cat = (await um<{ id: string }>(c, `INSERT INTO public.categorias_produto (tenant_id, nome, grupo_id) VALUES ($1, 'ZZ Cat', $2) RETURNING id`, [T, g])).id;
      const s1 = (await um<{ id: string }>(c, `INSERT INTO public.subcategorias1_produto (tenant_id, nome, categoria_id) VALUES ($1, 'ZZ Sub1', $2) RETURNING id`, [T, cat])).id;
      const s2 = (await um<{ id: string }>(c, `INSERT INTO public.subcategorias2_produto (tenant_id, nome, categoria_id) VALUES ($1, 'ZZ Sub2', $2) RETURNING id`, [T, cat])).id;
      await c.query(`UPDATE public.modelos SET categoria_principal_id = $2, subcategoria1_id = $3, subcategoria2_id = $4 WHERE id = $1`, [s.interno, cat, s1, s2]);
      // o modelo da revenda aponta para categoria/sub1 de OUTRA loja (Ave Rara): tem de sair vazio
      const outra = await um<{ cat: string; s1: string }>(c,
        `SELECT cp.id AS cat, s.id AS s1 FROM public.categorias_produto cp JOIN public.subcategorias1_produto s ON s.categoria_id = cp.id AND s.tenant_id = cp.tenant_id
          WHERE cp.tenant_id = $1 LIMIT 1`, [AVE_RARA]);
      await c.query(`UPDATE public.modelos SET categoria_principal_id = $2, subcategoria1_id = $3 WHERE id = $1`, [s.revenda, outra.cat, outra.s1]);
      await comoUsuario(c, U);
      const j = await exporta(c, "R1", ["nome", "grupo", "categoria", "subcategoria1", "subcategoria2"], ["1"]);
      const a = j.niveis["1"].find((l) => l.nome === "ZZ Blusa Interna")!;
      expect(a).toMatchObject({ grupo: "ZZ Grupo", categoria: "ZZ Cat", subcategoria1: "ZZ Sub1", subcategoria2: "ZZ Sub2" });
      const b = j.niveis["1"].find((l) => l.nome === "ZZ Bolsa Revenda")!;
      expect(b).toMatchObject({ grupo: null, categoria: null, subcategoria1: null, subcategoria2: null });
    });
  });

  it("nivel 3: pai na 1a linha seguido de 1 linha por SKU cor x tamanho (SKU gravado); pai tem cor/tamanho vazios", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await comoUsuario(c, U);
      const j = await exporta(c, "R1", ["nome", "ref_sku", "cor_base", "cor_apelido", "tamanho"], ["3"]);
      const l = j.niveis["3"];
      expect(l).toHaveLength(12); // 4 produtos x (1 pai + 2 SKUs: P e M)
      // o grupo do interno: pai, depois P e M
      const i = l.findIndex((x) => x.nome === "ZZ Blusa Interna");
      expect(l[i]).toMatchObject({ ref_sku: s.refs.interno, cor_base: null, cor_apelido: null, tamanho: null });
      expect(l[i + 1]).toMatchObject({ nome: "ZZ Blusa Interna", ref_sku: `${s.refs.interno}-P`, tamanho: "P" });
      expect(l[i + 2]).toMatchObject({ nome: "ZZ Blusa Interna", ref_sku: `${s.refs.interno}-M`, tamanho: "M" });
      expect(l[i + 1].cor_base).toMatch(/^Branco /);
      expect(l[i + 1].cor_apelido).toMatch(/^Off-white /);
      // o grupo da revenda / importado / reprovado tambem trazem os 2 SKUs
      for (const [k, nome] of [["revenda", "ZZ Bolsa Revenda"], ["importado", "ZZ Macacao Importado"], ["reprovado", "ZZ Vestido Reprovado"]] as const) {
        const j0 = l.findIndex((x) => x.nome === nome && x.tamanho === null);
        expect(l[j0].ref_sku).toBe(s.refs[k]);
        expect(l[j0 + 1].ref_sku).toBe(`${s.refs[k]}-P`);
        expect(l[j0 + 2].ref_sku).toBe(`${s.refs[k]}-M`);
      }
    });
  });

  it("nivel 3: produto sem grade sai so com o pai; SKU nao gerado = ref_sku vazio na linha filha", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await c.query(`DELETE FROM public.modelo_grades WHERE modelo_id = $1`, [s.interno]);
      await c.query(`DELETE FROM public.modelo_skus WHERE modelo_id = $1`, [s.revenda]); // grade fica, SKU gravado nao
      await comoUsuario(c, U);
      const j = await exporta(c, "R1", ["nome", "ref_sku", "tamanho"], ["3"]);
      const l = j.niveis["3"];
      expect(l.filter((x) => x.nome === "ZZ Blusa Interna")).toHaveLength(1); // so o pai
      const rv = l.filter((x) => x.nome === "ZZ Bolsa Revenda");
      expect(rv).toHaveLength(3);
      expect(rv[1].ref_sku).toBeNull();
      expect(rv[1].tamanho).toBe("P");
    });
  });

  it("nivel 2: pai + 1 linha por variante de cor (tamanho vazio, REF herdada do pai); niveis 1+2+3 de uma vez", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await comoUsuario(c, U);
      const j = await exporta(c, "R1", ["nome", "ref_sku", "cor_base", "tamanho"], ["3", "1", "2"]);
      expect(Object.keys(j.niveis).sort()).toEqual(["1", "2", "3"]);
      expect(j.niveis["1"]).toHaveLength(4);
      expect(j.niveis["2"]).toHaveLength(8); // 4 pai + 4 variantes (1 cor por produto)
      expect(j.niveis["3"]).toHaveLength(12);
      const l2 = j.niveis["2"];
      const i = l2.findIndex((x) => x.nome === "ZZ Blusa Interna");
      expect(l2[i]).toMatchObject({ cor_base: null, tamanho: null, ref_sku: s.refs.interno });
      expect(l2[i + 1]).toMatchObject({ nome: "ZZ Blusa Interna", tamanho: null, ref_sku: s.refs.interno });
      expect(l2[i + 1].cor_base).toMatch(/^Branco /);
      // o pai do nivel 1 e o do nivel 3 sao a mesma linha
      expect(j.niveis["1"].find((x) => x.nome === "ZZ Blusa Interna")).toEqual(l2[i]);
    });
  });

  it("_limite = previa: limita os PRODUTOS (pai+filhos completos), total = produtos do recorte inteiro", async () => {
    await withTx(async (c) => {
      await viva(c);
      await semeia(c);
      await comoUsuario(c, U);
      const j = await exporta(c, "R1", ["nome", "tamanho"], ["3"], 2);
      expect(j.total).toBe(4);
      expect(j.niveis["3"]).toHaveLength(6); // 2 produtos x (pai + 2 SKUs)
      expect(new Set(j.niveis["3"].map((x) => x.nome)).size).toBe(2);
    });
  });

  it("exportar_subcolecoes: so as subcolecoes DAQUELA colecao (e da loja)", async () => {
    await withTx(async (c) => {
      await viva(c);
      await semeia(c);
      await comoUsuario(c, U);
      const a = (await um<{ j: string[] }>(c, `SELECT public.exportar_subcolecoes($1) AS j`, [COL])).j;
      expect(a).toEqual(["R1", "R2"]); // sem o R9 da outra colecao
      const b = (await um<{ j: string[] }>(c, `SELECT public.exportar_subcolecoes('QA-OUTRA') AS j`)).j;
      expect(b).toEqual(["R9"]);
      const vazio = (await um<{ j: string[] }>(c, `SELECT public.exportar_subcolecoes('QA-NAO-EXISTE') AS j`)).j;
      expect(vazio).toEqual([]);
    });
  });

  it("validacoes (P0001, ASCII) e portao: sem login e sem permissao de ver a Integracao = 42501", async () => {
    await withTx(async (c) => {
      await viva(c);
      await semeia(c);
      await comoUsuario(c, U);
      const chama = (campos: string, niveis: string, lim = "NULL") =>
        tenta(c, `SELECT public.exportar_produtos('${COL}', NULL, ${campos}::text[], ${niveis}::text[], ${lim})`);
      expect(await chama(`ARRAY['nome','inexistente']`, `ARRAY['1']`)).toMatch(/^P0001 exportar_campo_invalido: inexistente$/);
      expect(await chama(`ARRAY[]::text[]`, `ARRAY['1']`)).toMatch(/^P0001 exportar_campos_vazio$/);
      expect(await chama(`ARRAY['nome']`, `ARRAY['4']`)).toMatch(/^P0001 exportar_nivel_invalido: 4$/);
      expect(await chama(`ARRAY['nome']`, `ARRAY[]::text[]`)).toMatch(/^P0001 exportar_niveis_vazio$/);
      expect(await chama(`ARRAY['nome']`, `ARRAY['1']`, "0")).toMatch(/^P0001 exportar_limite_invalido$/);
      // mensagens so ASCII (5xx/PostgREST)
      for (const m of [await chama(`ARRAY['x']`, `ARRAY['1']`), await chama(`ARRAY['nome']`, `ARRAY['9']`)]) expect(m).toMatch(/^[\x20-\x7e]+$/);
      // sem login
      await semUsuario(c);
      expect(await chama(`ARRAY['nome']`, `ARRAY['1']`)).toMatch(/^42501 /);
      expect(await tenta(c, `SELECT public.exportar_subcolecoes('${COL}')`)).toMatch(/^42501 /);
      // usuario da loja SEM a permissao integracao
      await comoUsuarioCom(c, "0e5c0001-0000-4000-8000-00000000e001", [["criacao_planejamento", true, true]]);
      expect(await chama(`ARRAY['nome']`, `ARRAY['1']`)).toMatch(/^42501 /);
      expect(await tenta(c, `SELECT public.exportar_subcolecoes('${COL}')`)).toMatch(/^42501 /);
      // ...e COM a permissao integracao (ver) passa
      await comoUsuarioCom(c, "0e5c0001-0000-4000-8000-00000000e002", [["integracao", true, false]]);
      expect(await chama(`ARRAY['nome']`, `ARRAY['1']`)).toBe("PASSOU");
    });
  });

  it("privilegios: o _core NAO e executavel por anon/authenticated/PUBLIC; wrappers: authenticated sim, anon nao", async () => {
    await withTx(async (c) => {
      await viva(c);
      const p = async (role: string, sig: string) =>
        (await um<{ ok: boolean }>(c, `SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, sig])).ok;
      expect(await p("anon", SIG_CORE)).toBe(false);
      expect(await p("authenticated", SIG_CORE)).toBe(false);
      expect(await p("public", SIG_CORE)).toBe(false);
      expect(await p("anon", SIG_EXP)).toBe(false);
      expect(await p("anon", SIG_SUB)).toBe(false);
      expect(await p("authenticated", SIG_EXP)).toBe(true);
      expect(await p("authenticated", SIG_SUB)).toBe(true);
      expect(await p("service_role", SIG_EXP)).toBe(true);
      // as 3 sao DEFINER com search_path fixo
      const r = await c.query(
        `SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p WHERE p.oid = ANY (ARRAY[$1::regprocedure, $2::regprocedure, $3::regprocedure]::oid[]) ORDER BY 1`,
        [SIG_EXP, SIG_SUB, SIG_CORE],
      );
      expect(r.rows).toHaveLength(3);
      for (const f of r.rows) {
        expect(f.prosecdef).toBe(true);
        expect(f.proconfig).toEqual(["search_path=public"]);
      }
    });
  });

  it("o _core chamado SEM loja ou por papel authenticated e recusado", async () => {
    await withTx(async (c) => {
      await viva(c);
      await comoUsuario(c, U);
      expect(await tenta(c, `SELECT public._exportar_produtos_core(NULL, NULL, NULL, ARRAY['nome'], ARRAY['1'], NULL)`)).toMatch(/^P0001 exportar_sem_loja$/);
      await c.query("SET LOCAL ROLE authenticated");
      expect(await tenta(c, `SELECT public._exportar_produtos_core('${T}', NULL, NULL, ARRAY['nome'], ARRAY['1'], NULL)`)).toMatch(/^42501 /);
      await c.query("RESET ROLE");
    });
  });
});
