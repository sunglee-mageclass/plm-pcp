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
const MIG_PERM = "supabase/migrations/20261201130000_exportar_dados_permissao.sql"; // portao proprio `exportar_dados` (substitui o da Integracao)
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
  // portao `exportar_dados` (frente "Exportar dados na sidebar"): os casos abaixo valem para o banco COM ele (como em producao depois do deploy)
  const temPerm = (await um<{ ok: boolean }>(c, `SELECT to_regprocedure('public._exportar_exige()') IS NOT NULL AS ok`)).ok;
  if (!temPerm) {
    try {
      await aplicarArquivo(c, MIG_PERM);
    } finally {
      await c.query("SET LOCAL transaction_timeout = 0");
      await c.query("SET LOCAL lock_timeout = '3s'");
    }
  }
}

type Semente = { interno: string; revenda: string; importado: string; reprovado: string; refs: Record<string, string>; cores: Record<string, { cor: string; apelido: string | null }> };
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
  return {
    interno: i.id, revenda: r.id, importado: m.id, reprovado: x.id,
    refs: { interno: i.ref, revenda: r.ref, importado: m.ref, reprovado: x.ref },
    cores: {
      interno: { cor: i.corId, apelido: i.apelidoId },
      revenda: { cor: r.corId, apelido: r.apelidoId },
      importado: { cor: m.corId, apelido: m.apelidoId },
    },
  };
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

  it("nivel 3: produto sem grade sai so com o pai; SKU nao gravado continua gerando as linhas filhas", async () => {
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
      expect(rv[1].tamanho).toBe("P");
    });
  });

  it("nivel 3: sem SKU gravado, ref_sku da linha filha = SKU PREVISTO (_skus_calc_ref_tipo), nao null; com gravado, o gravado vence", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      // gravado so para um tamanho: apaga o M da revenda (fica o P gravado e o M sem SKU gravado)
      await c.query(`DELETE FROM public.modelo_skus WHERE modelo_id = $1 AND tamanho_key IN (SELECT tamanho_key FROM public.modelo_skus WHERE modelo_id = $1 ORDER BY tamanho_key DESC LIMIT 1)`, [s.revenda]);
      const gravados = (await c.query(`SELECT tamanho_key, sku FROM public.modelo_skus WHERE modelo_id = $1`, [s.revenda])).rows;
      expect(gravados).toHaveLength(1);
      // o previsto, como a funcao o calcula (mesma entrada que a RPC usa)
      const prev = (
        await c.query(
          `SELECT k.tamanho_key, k.sku FROM public.modelos mo, public._skus_calc_ref_tipo(mo.id, mo.ref::text, coalesce(mo.tamanho_tipo, 'letra')) k
            WHERE mo.id = $1 ORDER BY k.variante_ordem NULLS LAST, k.variante_key, k.tamanho_ordem NULLS LAST, k.tamanho_key`,
          [s.revenda],
        )
      ).rows as { tamanho_key: string; sku: string | null }[];
      expect(prev).toHaveLength(2);
      expect(prev[0].sku).toBeTruthy();
      expect(prev[1].sku).toBeTruthy();
      await comoUsuario(c, U);
      const j = await exporta(c, "R1", ["nome", "ref_sku", "tamanho"], ["3"]);
      const rv = j.niveis["3"].filter((x) => x.nome === "ZZ Bolsa Revenda");
      expect(rv).toHaveLength(3);
      expect(rv[0].ref_sku).toBe(s.refs.revenda); // o pai segue sendo a REF
      for (const [idx, p] of prev.entries()) {
        const g = gravados.find((x: { tamanho_key: string }) => x.tamanho_key === p.tamanho_key);
        const esperado = g ? g.sku : p.sku; // gravado vence; sem gravado, o previsto
        expect(rv[idx + 1].ref_sku).toBe(esperado);
        expect(rv[idx + 1].ref_sku).not.toBeNull();
      }
      // as duas origens do valor foram exercitadas (1 gravado + 1 previsto)
      expect(prev.some((p) => gravados.some((g: { tamanho_key: string }) => g.tamanho_key === p.tamanho_key))).toBe(true);
      expect(prev.some((p) => !gravados.some((g: { tamanho_key: string }) => g.tamanho_key === p.tamanho_key))).toBe(true);
    });
  });

  /** Sigla (SKU) da cor base / do apelido de uma variante da semente. */
  async function siglas(c: Client, f: { cor: string; apelido: string | null }): Promise<{ base: string; apel: string | null }> {
    const base = (await um<{ s: string }>(c, `SELECT sigla_sku AS s FROM public.cores WHERE id = $1`, [f.cor])).s;
    const apel = f.apelido ? (await um<{ s: string }>(c, `SELECT sigla_sku AS s FROM public.cores_apelido WHERE id = $1`, [f.apelido])).s : null;
    return { base, apel };
  }
  async function formato(c: Client, cfg: unknown): Promise<void> {
    await c.query(`UPDATE public.tenant_config SET sku_config = $1::jsonb WHERE tenant_id = $2`, [cfg == null ? null : JSON.stringify(cfg), T]);
  }

  it("nivel 2: pai + 1 linha por variante de cor (tamanho vazio, ref_sku = SKU ATE A COR); niveis 1+2+3 de uma vez", async () => {
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
      // o pai segue sendo a REF; a sublinha de cor = SKU ate a cor (formato da Loja Teste: ref + cor_base + tamanho => REF+cor, sem tamanho)
      const sg = await siglas(c, s.cores.interno);
      expect(l2[i]).toMatchObject({ cor_base: null, tamanho: null, ref_sku: s.refs.interno });
      expect(l2[i + 1]).toMatchObject({ nome: "ZZ Blusa Interna", tamanho: null, ref_sku: `${s.refs.interno}${sg.base}` });
      expect(l2[i + 1].cor_base).toMatch(/^Branco /);
      // oraculo independente: o SKU previsto completo (_skus_calc_ref_tipo) = SKU ate a cor + a sigla do tamanho
      const prev = (await um<{ sku: string }>(c,
        `SELECT k.sku FROM public.modelos mo, public._skus_calc_ref_tipo(mo.id, mo.ref::text, 'letra') k WHERE mo.id = $1 ORDER BY k.tamanho_ordem LIMIT 1`, [s.interno])).sku;
      expect(prev.startsWith(l2[i + 1].ref_sku)).toBe(true);
      expect(prev.length).toBeGreaterThan(l2[i + 1].ref_sku.length);
      // nivel 3 INTACTO: continua o SKU gravado; nivel 1 = REF
      const l3 = j.niveis["3"];
      const i3 = l3.findIndex((x) => x.nome === "ZZ Blusa Interna");
      expect(l3[i3 + 1].ref_sku).toBe(`${s.refs.interno}-P`);
      // o pai do nivel 1 e o do nivel 3 sao a mesma linha
      expect(j.niveis["1"].find((x) => x.nome === "ZZ Blusa Interna")).toEqual(l2[i]);
    });
  });

  it("nivel 2 SKU ate a cor: segue o formato da loja menos o tamanho (cor+apelido, separadores, tamanho no meio, sem tamanho, sem formato); as 3 origens", async () => {
    await withTx(async (c) => {
      await viva(c);
      const s = await semeia(c);
      await comoUsuario(c, U);
      const ate = async (campos = ["nome", "ref_sku", "tamanho"]) => {
        const j = await exporta(c, "R1", campos, ["2"]);
        const por = (nome: string) => {
          const l = j.niveis["2"];
          const k = l.findIndex((x) => x.nome === nome);
          expect(l.filter((x) => x.nome === nome)).toHaveLength(2); // pai + 1 variante
          return { pai: l[k].ref_sku, cor: l[k + 1].ref_sku };
        };
        return { interno: por("ZZ Blusa Interna"), revenda: por("ZZ Bolsa Revenda"), importado: por("ZZ Macacao Importado") };
      };
      const sg = { interno: await siglas(c, s.cores.interno), revenda: await siglas(c, s.cores.revenda), importado: await siglas(c, s.cores.importado) };
      const T_SKU = { P: "OOP", M: "OOM" };
      await c.query(`UPDATE public.tenant_config SET tamanhos_sku = $1::jsonb WHERE tenant_id = $2`, [JSON.stringify(T_SKU), T]);

      // (a) cor_base + cor_apelido + tamanho, separador "-" entre REF e cor: REF-BASEAPEL (sem o tamanho)
      await formato(c, { partes: ["ref", "cor_base", "cor_apelido", "tamanho"], separadores: { "ref|cor_base": "-", "cor_base|cor_apelido": ".", "cor_apelido|tamanho": "_" } });
      // com cor_base E cor_apelido no formato a sigla do apelido (quando ha) entra apos a base
      let r = await ate();
      for (const k of ["interno", "revenda", "importado"] as const) {
        const f = s.cores[k];
        const esperado = `${s.refs[k]}-${sg[k].base}${f.apelido ? `.${sg[k].apel}` : ""}`;
        expect(r[k].cor).toBe(esperado);
        expect(r[k].pai).toBe(s.refs[k]); // o pai segue a REF
      }

      // (b) tamanho NO MEIO: o separador que o antecede some junto e o que o segue liga a parte anterior (REF-P.AZ -> REF.AZ)
      await formato(c, { partes: ["ref", "tamanho", "cor_base"], separadores: { "ref|tamanho": "-", "tamanho|cor_base": "." } });
      r = await ate();
      expect(r.interno.cor).toBe(`${s.refs.interno}.${sg.interno.base}`);
      expect(r.revenda.cor).toBe(`${s.refs.revenda}.${sg.revenda.base}`);

      // (c) formato SEM tamanho: o SKU ate a cor e o proprio SKU completo
      await formato(c, { partes: ["ref", "cor_base"], separadores: { "ref|cor_base": "-" } });
      r = await ate();
      expect(r.interno.cor).toBe(`${s.refs.interno}-${sg.interno.base}`);

      // (d) so tamanho no formato: nada sobra ate a cor => null
      await formato(c, { partes: ["tamanho"], separadores: {} });
      r = await ate();
      expect(r.interno.cor).toBeNull();

      // (e) loja SEM formato de SKU: null (como o previsto do nivel 3)
      await formato(c, null);
      r = await ate();
      expect(r.interno.cor).toBeNull();
      expect(r.revenda.cor).toBeNull();
      expect(r.interno.pai).toBe(s.refs.interno);

      // (f) falta a sigla da cor base: null (nao inventa SKU)
      await formato(c, { partes: ["ref", "cor_base", "tamanho"], separadores: {} });
      await c.query(`UPDATE public.cores SET sigla_sku = NULL WHERE id = $1`, [s.cores.interno.cor]);
      r = await ate();
      expect(r.interno.cor).toBeNull();
      expect(r.revenda.cor).toBe(`${s.refs.revenda}${sg.revenda.base}`);
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

  it("validacoes (P0001, ASCII) e portao: sem login e sem a permissao exportar_dados = 42501", async () => {
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
      // usuario da loja SEM a permissao exportar_dados
      await comoUsuarioCom(c, "0e5c0001-0000-4000-8000-00000000e001", [["criacao_planejamento", true, true]]);
      expect(await chama(`ARRAY['nome']`, `ARRAY['1']`)).toMatch(/^42501 /);
      expect(await tenta(c, `SELECT public.exportar_subcolecoes('${COL}')`)).toMatch(/^42501 /);
      // ...a permissao integracao NAO basta mais (portao proprio)
      await comoUsuarioCom(c, "0e5c0001-0000-4000-8000-00000000e003", [["integracao", true, true]]);
      expect(await chama(`ARRAY['nome']`, `ARRAY['1']`)).toMatch(/^42501 /);
      // ...e COM a permissao exportar_dados (ver), dada pelo super admin, passa
      await comoUsuarioCom(c, "0e5c0001-0000-4000-8000-00000000e002", [["exportar_dados", true, false]]);
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
