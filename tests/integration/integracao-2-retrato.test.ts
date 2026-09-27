/** Integração + API — migration 2 (retrato/leituras). Plano Task 2. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um } from "./db";
import {
  CAMPOS_PADRAO, INVERSOS, LAYOUT, LOCAL, MIG_TXN, T, U, aplica, camposLoja, comoUsuarioCom, keywordsLoja, modeloInterno, prepara, revenda,
} from "./integracao-helpers";

const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // loja com mais modelos na cópia (medição)
type Ret = { retrato: { v: number; campos: string[]; linhas: Array<{ tipo: string; ordem: number; valores: Record<string, string | null>; fotos: string[] }> };
  faltas: Array<{ campo: string; texto: string }>; completo: boolean; meta: unknown[]; variantes_chaves: string[] | null };
async function retrato(c: any, id: string, campos: readonly string[] = CAMPOS_PADRAO): Promise<Ret> {
  return (await um<{ r: Ret }>(c,
    `SELECT public._integracao_retrato_core($1, $2::text[], (public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text)) AS r`,
    [id, campos])).r;
}

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 2: retrato", () => {
  it("interno completo: ordem fixa, formatos (D4), sublinhas P/M com SKU gravado, custo previsto, metatag = descrição", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "moda feminina, roupas");
      const m = await modeloInterno(c);
      const r = await retrato(c, m.id);
      expect(r.completo).toBe(true);
      expect(r.faltas).toEqual([]);
      expect(r.retrato.campos).toEqual([...CAMPOS_PADRAO]);
      expect(r.retrato.linhas.map((l) => l.tipo)).toEqual(["produto", "variante", "variante"]);
      const p = r.retrato.linhas[0].valores;
      expect(Object.keys(p)).toEqual(expect.arrayContaining([...CAMPOS_PADRAO]));
      expect(p).toMatchObject({
        ref_sku: m.ref, preco_anterior: "179.90", preco_venda: "159.90", peso: "0.220", ncm: "6109.10.00", preco_custo: "62.10",
        cor_base: null, cor_apelido: null, tamanho: null, titulo: "Blusa Brisa Manga Longa",
        descricao: "Blusa em viscose, manga longa.", metatag: "Blusa em viscose, manga longa.", keywords: "moda feminina, roupas",
        comprimento: "68", largura: "42", altura: "2",
      });
      const [s1, s2] = r.retrato.linhas.slice(1);
      expect(s1.valores.nome).toBe(`${p.nome} P`);
      expect(s1.valores.ref_sku).toBe(`${m.ref}-P`);
      expect(s1.valores.tamanho).toBe("P");
      expect(s1.valores.cor_base).toMatch(/^Branco /);
      expect(s1.valores.cor_apelido).toMatch(/^Off-white /);
      expect(s1.valores.preco_venda).toBe("159.90");
      expect(s2.valores.tamanho).toBe("M");
      expect(r.retrato.linhas[0].fotos).toEqual([]); // foto não marcada no padrão
      expect(r.variantes_chaves).toBeNull(); // interno
    });
  });

  it("faltas: marcado vazio vira falta com o rótulo; 0 não conta; estimado não conta (D8)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, null);
      const m = await modeloInterno(c);
      await c.query(`UPDATE public.modelos SET ncm = '  ', peso_kg = 0, custo_peca_previsto = 0 WHERE id = $1`, [m.id]);
      const r = await retrato(c, m.id);
      expect(r.completo).toBe(false);
      expect(r.faltas).toEqual(expect.arrayContaining([
        { campo: "ncm", texto: "NCM" }, { campo: "peso", texto: "Peso" }, { campo: "keywords", texto: "Keywords" },
        { campo: "preco_custo", texto: "Preço de custo (o estimado não conta)" },
      ]));
    });
  });

  it("cor sem apelido = VAZIO e NÃO é falta (P-74 A); SKU faltando e 0 sublinhas são faltas", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const a = await modeloInterno(c, { semApelido: true });
      const ra = await retrato(c, a.id);
      expect(ra.retrato.linhas[1].valores.cor_apelido).toBeNull();
      expect(ra.completo).toBe(true);
      const b = await modeloInterno(c, { semSku: true });
      const rb = await retrato(c, b.id);
      expect(rb.faltas.find((f) => f.campo === "ref_sku")?.texto).toMatch(/^2 variantes sem SKU \(ex\.: Branco .+, tam\. P\)$/);
      await c.query(`DELETE FROM public.modelo_grades WHERE modelo_id = $1`, [b.id]);
      const rc = await retrato(c, b.id);
      expect(rc.faltas).toEqual(expect.arrayContaining([{ campo: "variantes", texto: "variantes cor × tamanho" }]));
      expect(rc.retrato.linhas).toHaveLength(1);
    });
  });

  it("Foto marcada: fotos só na linha do produto; caminho fora de <tenant>/ = 'foto de outra loja' (nota 7)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c, { fotos: [`${T}/fotos_modelo/a.jpg`, `${T}/fotos_modelo/b.jpg`] });
      const r = await retrato(c, m.id, LAYOUT);
      expect(r.retrato.linhas[0].fotos).toEqual([`${T}/fotos_modelo/a.jpg`, `${T}/fotos_modelo/b.jpg`]);
      expect(r.retrato.linhas[1].fotos).toEqual([]);
      expect("foto" in r.retrato.linhas[0].valores).toBe(false);
      await c.query(`UPDATE public.modelos SET fotos_modelo = ARRAY['00000000-0000-0000-0000-000000000001/x.jpg'] WHERE id = $1`, [m.id]);
      expect((await retrato(c, m.id, LAYOUT)).faltas).toEqual(expect.arrayContaining([{ campo: "foto", texto: "foto de outra loja" }]));
      await c.query(`UPDATE public.modelos SET fotos_modelo = '{}' WHERE id = $1`, [m.id]);
      expect((await retrato(c, m.id, LAYOUT)).faltas).toEqual(expect.arrayContaining([{ campo: "foto", texto: "Foto do Modelo" }]));
    });
  });

  it("revenda: custo = unitário da OC/cadastro (40.00); variantes_chaves = conjunto cor+apelido do espelho", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await revenda(c);
      const r = await retrato(c, m.id);
      expect(r.retrato.linhas[0].valores.preco_custo).toBe("40.00");
      const k = await um<{ k: string }>(c, `SELECT public._sku_variante_key($1, $2)::text AS k`, [m.corId, m.apelidoId]);
      expect(r.variantes_chaves).toEqual([k.k]);
    });
  });

  it("assinatura = HMAC (64 hex), estável, muda com o dado e ≠ sha256 simples do retrato (nota 6)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const q = `SELECT public._integracao_assinar(public._integracao_retrato_core($1, $2::text[],
                   public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text) -> 'retrato') AS a,
                 encode(extensions.digest((public._integracao_retrato_core($1, $2::text[],
                   public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text) -> 'retrato')::text, 'sha256'), 'hex') AS h`;
      const a1 = await um<{ a: string; h: string }>(c, q, [m.id, CAMPOS_PADRAO]);
      expect(a1.a).toMatch(/^[0-9a-f]{64}$/);
      expect(a1.a).not.toBe(a1.h);
      expect((await um<{ a: string }>(c, q, [m.id, CAMPOS_PADRAO])).a).toBe(a1.a);
      await c.query(`UPDATE public.modelos SET ncm = '6109.90.00' WHERE id = $1`, [m.id]);
      expect((await um<{ a: string }>(c, q, [m.id, CAMPOS_PADRAO])).a).not.toBe(a1.a);
    });
  });
});

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 2: RPCs de leitura", () => {
  it("previa: sem permissão = 42501; com ver e sem custos = custo mascarado e MESMA assinatura do super", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const sup = await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id]);
      expect(sup.r.produtos[0].retrato.linhas[0].valores.preco_custo).toBe("62.10");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce01", []);
      await c.query("SAVEPOINT a");
      await expect(c.query(`SELECT public.integracao_previa(ARRAY[$1::uuid])`, [m.id])).rejects.toThrow(/Sem permissão para ver a Integração/);
      await c.query("ROLLBACK TO SAVEPOINT a");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce02", [["integracao", true, false]]);
      const v = await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [m.id]);
      for (const l of v.r.produtos[0].retrato.linhas) expect(l.valores.preco_custo).toBeNull();
      expect(v.r.produtos[0].assinatura).toBe(sup.r.produtos[0].assinatura);
      expect(v.r.pode_ver_custos).toBe(false);
      expect(v.r.precisa_ver_custos).toBe(true);
    });
  });

  it("listar: Não integrados por padrão; reprovado some; busca por REF; gates do card campo a campo (D24)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const rep = await modeloInterno(c);
      await c.query(`UPDATE public.modelos SET status_planejamento = 'reprovado' WHERE id = $1`, [rep.id]);
      const l = await um<{ r: any }>(c, `SELECT public.integracao_listar(NULL, jsonb_build_object('busca', $1::text), 1) AS r`, [m.ref]);
      expect(l.r.total).toBe(1);
      expect(l.r.produtos[0]).toMatchObject({ modelo_id: m.id, estado: "nao_integravel", completo: true, origem: "interno" });
      expect(l.r.produtos[0].raw).toMatchObject({ ref: m.ref, preco_venda: 159.9, ncm: "6109.10.00", tamanho_tipo: "letra" });
      expect(l.r.pode).toMatchObject({ editar: true, super: true, keywords: true });
      const lr = await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1) AS r`, [rep.ref]);
      expect(lr.r.total).toBe(0);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce03", [["integracao", true, true]]);
      const g = (await um<{ r: any }>(c, `SELECT public.integracao_listar(NULL, jsonb_build_object('busca', $1::text), 1) AS r`, [m.ref])).r.produtos[0].gates;
      expect(g.compartilhado).toEqual({ ok: false, motivo: "Precisa da permissão de editar o Planejamento (ou o Desenvolvimento antes do envio à Explosão)." });
      expect(g.planejamento).toEqual({ ok: false, motivo: "Precisa da permissão de editar o Planejamento." });
      expect(g.preco).toEqual({ ok: false, motivo: "Precisa da permissão de preço de venda." });
      expect(g.ref).toEqual({ ok: false, motivo: "Precisa da permissão de editar o Desenvolvimento." });
      expect(g.keywords).toEqual({ ok: false, motivo: "Só o admin da loja muda as Keywords." });
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce04", [["integracao", true, true], ["criacao_planejamento", true, true],
        ["criacao_planejamento:preco_venda", true, true], ["criacao_desenvolvimento", true, true]]);
      const g2 = (await um<{ r: any }>(c, `SELECT public.integracao_listar(NULL, jsonb_build_object('busca', $1::text), 1) AS r`, [m.ref])).r.produtos[0].gates;
      expect(g2.compartilhado.ok && g2.planejamento.ok && g2.preco.ok && g2.sku.ok).toBe(true);
      expect(g2.ref.ok).toBe(false);
      expect(g2.ref.motivo).toMatch(/^A REF aparece a partir da etapa ".+" do kanban\.$/);
    });
  });

  it("config_ler: campos para quem vê; bloco api SÓ para super admin", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      const s = (await um<{ r: any }>(c, `SELECT public.integracao_config_ler() AS r`)).r;
      expect(s.campos).toEqual([...CAMPOS_PADRAO]);
      expect(s.layout).toEqual([...LAYOUT]);
      expect(s.api).toEqual({ limite_por_minuto: 60, max_por_pagina: 50, validade_foto_dias: 7, bloqueio_tentativas: 10 });
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce05", [["integracao", true, false]]);
      expect((await um<{ r: any }>(c, `SELECT public.integracao_config_ler() AS r`)).r.api).toBeNull();
      expect((await um<{ r: any }>(c, `SELECT public.integracao_estado_modelos(ARRAY[]::uuid[]) AS r`)).r).toEqual({});
    });
  });

  it("desempenho: listar (página de 50) e previa (50) na maior loja da cópia em < 3 s cada", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await comoUsuario(c, U);
      await c.query(`UPDATE public.users SET tenant_id = $1 WHERE id = $2`, [AVE_RARA, U]);
      let t0 = Date.now();
      const l = await um<{ r: any }>(c, `SELECT public.integracao_listar('todos', '{}'::jsonb, 1) AS r`);
      const tl = Date.now() - t0;
      const ids = l.r.produtos.map((p: any) => p.modelo_id);
      t0 = Date.now();
      await c.query(`SELECT public.integracao_previa($1::uuid[])`, [ids]);
      const tp = Date.now() - t0;
      console.log(`[medição] integracao_listar 50 = ${tl} ms · integracao_previa ${ids.length} = ${tp} ms`);
      expect(ids.length).toBe(50);
      expect(tl).toBeLessThan(3000);
      expect(tp).toBeLessThan(3000);
    });
  });

  it.skipIf(!MIG_TXN)("inverso 2 desfaz a 2 (as 15 funções somem; tabelas da 1 ficam)", async () => {
    await withTx(async (c) => {
      await prepara(c, 2);
      await aplica(c, INVERSOS[1]);
      const r = await um<{ n: string; t: boolean }>(c,
        `SELECT (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                  AND proname IN ('_integracao_rotulos','_integracao_cfg','_integracao_num','_integracao_mascarar',
                    '_integracao_retrato_core','_integracao_assinar','_integracao_gate','_integracao_gates','_integracao_base',
                    '_integracao_exige','_integracao_exige_super','integracao_previa','integracao_listar',
                    'integracao_estado_modelos','integracao_config_ler')) AS n,
                to_regclass('public.integracao_produtos') IS NOT NULL AS t`);
      expect(r).toEqual({ n: "0", t: true });
    });
  });
});
