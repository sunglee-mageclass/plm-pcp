// Achados MÉDIOS — release R14 (Integração). Migration 20261024200000_integracao_sku_sublinhas_voltar.sql.
//   sku #3   SKU GRAVADO (não manual) ≠ PREVISTO (_skus_calc_ref_tipo.sku) → falta "SKU desatualizado — Regerar"
//            (muda só faltas/completo; o retrato e o marcador v=2 não mudam).
//   sku #10  integracao_listar: o "i" (retrato_difere) compara também as SUBLINHAS → chave 'sublinhas'.
//   sku #12  integracao_voltar / integracao_desfazer recalculam o preço do card pelo produto espelho (revenda/importado).
// Só na CÓPIA LOCAL, txn revertida (BEGIN…ROLLBACK): nada é gravado. Fixture ausente = FALHA (nunca passa calado).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { hasDb, withTx, comoUsuario, um } from "./db";
import {
  CAMPOS_PADRAO,
  LOCAL,
  U,
  camposLoja,
  importado,
  keywordsLoja,
  i3bViva,
  md5OuSucessorI3,
  modeloInterno,
  prepara,
  revenda,
  ROOT,
} from "./integracao-helpers";

type Ret = {
  retrato: {
    v: number;
    linhas: Array<{
      tipo: string;
      variante_key?: string;
      tamanho_key?: string;
      valores: Record<string, string | null>;
    }>;
  };
  faltas: Array<{ campo: string; texto: string }>;
  completo: boolean;
};

const MD5_DEPOIS = {
  "_integracao_retrato_core(uuid,text[],jsonb)": "bfcd6aba0a2f0ebd1a5908888f9c0568",
  "integracao_listar(text,jsonb,integer,integer)": "d2d3c9c55b3a6ce8b42d1842cab415f6",
  "integracao_voltar(uuid[])": "5e05bfc2b98e49b0bfd109bf0d344fff",
  "integracao_desfazer(uuid,text)": "5f6769022205743e27de52ceaca5b5bf",
  "_skus_calc_ref_tipo(uuid,text,text)": "ff2e575909f83fc0355fe20a049fd906",
} as const;

async function retrato(
  c: Client,
  id: string,
  campos: readonly string[] = CAMPOS_PADRAO,
): Promise<Ret> {
  return (
    await um<{ r: Ret }>(
      c,
      `SELECT public._integracao_retrato_core($1, $2::text[], (public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text)) AS r`,
      [id, campos],
    )
  ).r;
}
async function assinatura(c: Client, id: string): Promise<string> {
  return (
    await um<{ r: { produtos: Array<{ assinatura: string }> } }>(
      c,
      `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`,
      [id],
    )
  ).r.produtos[0].assinatura;
}
async function marcar(c: Client, id: string): Promise<void> {
  const r = await um<{ r: { marcados: number } }>(
    c,
    `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text))) AS r`,
    [id, await assinatura(c, id)],
  );
  expect(r.r).toEqual({ marcados: 1 });
}
async function erroDe(
  c: Client,
  sql: string,
  params: unknown[],
): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT e");
  try {
    await c.query(sql, params);
  } catch (e: unknown) {
    await c.query("ROLLBACK TO SAVEPOINT e");
    const pe = e as { code?: string; message?: string };
    return { code: String(pe.code), message: String(pe.message) };
  }
  throw new Error("esperava recusa, mas a chamada passou");
}
/** Os SKUs PREVISTOS do card (o que o Regerar gravaria). Sem previsto calculável = fixture inválida → FALHA. */
async function previstos(
  c: Client,
  id: string,
): Promise<Array<{ vk: string; tk: string; sku: string }>> {
  const { rows } = await c.query(
    `SELECT k.variante_key::text AS vk, k.tamanho_key AS tk, k.sku
       FROM public._skus_calc_ref_tipo($1, (SELECT ref FROM public.modelos WHERE id = $1), 'letra') k
      ORDER BY k.tamanho_ordem, k.tamanho_key`,
    [id],
  );
  if (rows.length !== 2 || rows.some((r) => !r.sku)) {
    throw new Error(
      `fixture: SKUs previstos não calculáveis na Loja Teste (Formato do SKU?): ${JSON.stringify(rows)}`,
    );
  }
  return rows;
}
async function gravarSku(c: Client, id: string, tk: string, sku: string, manual: boolean) {
  const r = await c.query(
    `UPDATE public.modelo_skus SET sku = $3, manual = $4 WHERE modelo_id = $1 AND tamanho_key = $2`,
    [id, tk, sku, manual],
  );
  if (r.rowCount !== 1) throw new Error(`fixture: SKU ${tk} do card ${id} não encontrado`);
}
const desatualizado = (r: Ret) => r.faltas.filter((f) => /SKU.*desatualizado/.test(f.texto));
async function listarDifere(c: Client, ref: string): Promise<string[]> {
  const l = await um<{ r: { produtos: Array<{ retrato_difere: string[] }> } }>(
    c,
    `SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1) AS r`,
    [ref],
  );
  if (l.r.produtos.length !== 1) throw new Error(`fixture: listar não achou o produto ${ref}`);
  return l.r.produtos[0].retrato_difere;
}
async function preco(c: Client, id: string): Promise<string | null> {
  return (
    await um<{ v: string | null }>(
      c,
      `SELECT preco_venda::text AS v FROM public.modelos WHERE id = $1`,
      [id],
    )
  ).v;
}

describe.skipIf(!hasDb)("R14 Integração — md5 e ACL (20261024200000)", () => {
  it("as 4 funções estão com o texto da migration e _skus_calc_ref_tipo intocada", async () => {
    await withTx(async (c) => {
      for (const [sig, md5] of Object.entries(MD5_DEPOIS)) {
        const r = await um<{ m: string | null }>(
          c,
          `SELECT CASE WHEN to_regprocedure($1) IS NULL THEN NULL ELSE md5(pg_get_functiondef(to_regprocedure($1))) END AS m`,
          ["public." + sig],
        );
        expect(md5OuSucessorI3(sig, md5), sig).toContain(r.m); // Release I3b redefine o retrato POR CIMA desta (sucessor)
      }
    });
  });
  it("inv. #9: _integracao_retrato_core sem EXECUTE p/ PUBLIC/anon/authenticated; as 3 RPCs com authenticated e sem anon/PUBLIC", async () => {
    await withTx(async (c) => {
      const acl = async (sig: string) =>
        um<{ a: boolean; u: boolean; p: boolean }>(
          c,
          `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') a,
                  has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') u,
                  EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                           WHERE p.oid = $1::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') p`,
          ["public." + sig],
        );
      expect(await acl("_integracao_retrato_core(uuid,text[],jsonb)")).toEqual({
        a: false,
        u: false,
        p: false,
      });
      for (const sig of [
        "integracao_listar(text,jsonb,integer,integer)",
        "integracao_voltar(uuid[])",
        "integracao_desfazer(uuid,text)",
      ]) {
        expect(await acl(sig), sig).toEqual({ a: false, u: true, p: false });
      }
    });
  });
});

describe.skipIf(!hasDb || !LOCAL)(
  "R14 sku #3 — SKU gravado ≠ previsto vira falta (Regerar)",
  () => {
    it("automático igual ao previsto: completo; diferente: falta 'SKU desatualizado — Regerar' e marcar recusa; manual diferente: não é falta", async () => {
      await withTx(async (c) => {
        await prepara(c, 6);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        const m = await modeloInterno(c);
        const [p1, p2] = await previstos(c, m.id);
        await gravarSku(c, m.id, p1.tk, p1.sku, false);
        await gravarSku(c, m.id, p2.tk, p2.sku, false);
        const ok = await retrato(c, m.id);
        expect(desatualizado(ok)).toEqual([]);
        expect(ok.completo).toBe(true);

        await gravarSku(c, m.id, p1.tk, `X${p1.sku}`, false);
        const r = await retrato(c, m.id);
        expect(r.completo).toBe(false);
        const f = desatualizado(r);
        expect(f).toHaveLength(1);
        expect(f[0].campo).toBe("ref_sku");
        expect(f[0].texto).toMatch(/^1 SKU desatualizado — Regerar \(/);
        expect(f[0].texto).toContain(`X${p1.sku} -> ${p1.sku}`);
        // o retrato NÃO muda de forma: marcador v=2 e a sublinha leva o SKU GRAVADO (o previsto só alimenta a falta)
        expect(r.retrato.v).toBe((await i3bViva(c)) ? 3 : 2); // Release I3 (20261030110000) passa o marcador a 3; a forma é a mesma
        expect(r.retrato.linhas.map((l) => l.tipo)).toEqual(ok.retrato.linhas.map((l) => l.tipo));
        expect(r.retrato.linhas.find((l) => l.tamanho_key === p1.tk)?.valores.ref_sku).toBe(
          `X${p1.sku}`,
        );
        // consumidor de 'completo': marcar recusa (P0001, faltam dados)
        const e = await erroDe(
          c,
          `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
          [m.id, await assinatura(c, m.id)],
        );
        expect(e.code).toBe("P0001");
        expect(e.message).toMatch(/SKU desatualizado/);

        // à mão (manual) diferente do previsto NÃO é falta
        await gravarSku(c, m.id, p1.tk, `X${p1.sku}`, true);
        const man = await retrato(c, m.id);
        expect(desatualizado(man)).toEqual([]);
        expect(man.completo).toBe(true);
      });
    });

    it("REF trocada depois do SKU gerado: as 2 linhas automáticas ficam desatualizadas (contagem + exemplo); sem 'ref_sku' marcado não é falta", async () => {
      await withTx(async (c) => {
        await prepara(c, 6);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        const m = await modeloInterno(c);
        const [p1, p2] = await previstos(c, m.id);
        await gravarSku(c, m.id, p1.tk, p1.sku, false);
        await gravarSku(c, m.id, p2.tk, p2.sku, false);
        await c.query(`UPDATE public.modelos SET ref = ref || 'Z' WHERE id = $1`, [m.id]);
        const r = await retrato(c, m.id);
        const f = desatualizado(r);
        expect(f).toHaveLength(1);
        expect(f[0].texto).toMatch(/^2 SKUs desatualizados — Regerar \(ex\.: /);
        expect(r.completo).toBe(false);
        const semRef = await retrato(
          c,
          m.id,
          CAMPOS_PADRAO.filter((k) => k !== "ref_sku"),
        );
        expect(desatualizado(semRef)).toEqual([]);
      });
    });
  },
);

describe.skipIf(!hasDb || !LOCAL)(
  "R14 sku #10 — o 'i' compara as sublinhas (retrato_difere: 'sublinhas')",
  () => {
    it("cor renomeada (Branco → Off White): retrato_difere contém 'sublinhas' e nenhuma chave do produto", async () => {
      await withTx(async (c) => {
        await prepara(c, 6);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        const m = await modeloInterno(c);
        await marcar(c, m.id);
        expect(await listarDifere(c, m.ref)).toEqual([]);
        const r = await c.query(
          `UPDATE public.cores SET nome = 'Off White ' || left($1::text, 8) WHERE id = $1`,
          [m.corId],
        );
        expect(r.rowCount).toBe(1);
        expect(await listarDifere(c, m.ref)).toEqual(["sublinhas"]);
      });
    });

    it("produto difere só no NCM → 'ncm' sem 'sublinhas'; SKU de uma sublinha diferente ou sublinha a menos no retrato gravado → 'sublinhas'", async () => {
      await withTx(async (c) => {
        await prepara(c, 6);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        // o produto integrável está travado (NCM/SKU marcados): a diferença é simulada no RETRATO GRAVADO (o vivo fica igual)
        const m = await modeloInterno(c);
        await marcar(c, m.id);
        await c.query(
          `UPDATE public.integracao_produtos SET retrato = jsonb_set(retrato, '{linhas,0,valores,ncm}', '"0000.00.00"') WHERE modelo_id = $1`,
          [m.id],
        );
        expect(await listarDifere(c, m.ref)).toEqual(["ncm"]); // herdado nas sublinhas, mas comparado só na linha do produto
        await c.query(
          `UPDATE public.integracao_produtos SET retrato = jsonb_set(retrato, '{linhas,1,valores,ref_sku}', '"OUTRO-SKU"') WHERE modelo_id = $1`,
          [m.id],
        );
        expect(await listarDifere(c, m.ref)).toEqual(["ncm", "sublinhas"]);
        // conjunto: retrato gravado com UMA sublinha a menos (vivo tem 2)
        await c.query(
          `UPDATE public.integracao_produtos
            SET retrato = jsonb_set(retrato, '{linhas,0,valores,ncm}', to_jsonb((SELECT ncm FROM public.modelos WHERE id = $1)::text)) #- '{linhas,2}'
          WHERE modelo_id = $1`,
          [m.id],
        );
        const d = await listarDifere(c, m.ref);
        expect(d).toContain("sublinhas");
        expect(d).not.toContain("ncm");
      });
    });

    it("retrato gravado v=1 (nome da sublinha sem a cor): o nome da sublinha não acende 'sublinhas'; v=2 acende", async () => {
      await withTx(async (c) => {
        await prepara(c, 6);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        // só campos em que a cor entra SÓ pelo nome da sublinha (sem cor_base/cor_apelido marcados)
        await camposLoja(
          c,
          CAMPOS_PADRAO.filter((k) => k !== "cor_base" && k !== "cor_apelido"),
        );
        const m = await modeloInterno(c);
        await marcar(c, m.id);
        await c.query(
          `UPDATE public.cores SET nome = 'Off White ' || left($1::text, 8) WHERE id = $1`,
          [m.corId],
        );
        const v2 = await listarDifere(c, m.ref);
        const viva = await um<{ ok: boolean }>(
          c,
          `SELECT position('_integracao_nome_sublinha' in pg_get_functiondef('public._integracao_retrato_core(uuid,text[],jsonb)'::regprocedure)) > 0 AS ok`,
        );
        if (!viva.ok)
          throw new Error(
            "fixture: retrato_core sem a cor no nome da sublinha (release 4 ausente)",
          );
        expect(v2).toEqual(["sublinhas"]);
        await c.query(
          `UPDATE public.integracao_produtos SET retrato = jsonb_set(retrato, '{v}', '1') WHERE modelo_id = $1`,
          [m.id],
        );
        expect(await listarDifere(c, m.ref)).toEqual([]);
      });
    });
  },
);

describe.skipIf(!hasDb || !LOCAL)(
  "R14 sku #12 — voltar/desfazer recalculam o preço do card (revenda + importado)",
  () => {
    it("revenda: markup muda com o produto integrável (preço congelado pela trava) → Voltar recalcula (40 × 4 = 160,00)", async () => {
      await withTx(async (c) => {
        await prepara(c, 6);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        const m = await revenda(c);
        if (!m.produtoId) throw new Error("fixture: revenda sem produto");
        await marcar(c, m.id);
        const congelado = await preco(c, m.id);
        await c.query(`UPDATE public.produtos_acabados SET markup_varejo = 4 WHERE id = $1`, [
          m.produtoId,
        ]);
        await c.query(`SELECT public._pa_recomputar_precos_modelo($1)`, [m.produtoId]);
        expect(await preco(c, m.id)).toBe(congelado); // B1: travado, não anda
        expect(congelado).not.toBe("160.00");
        expect(
          (
            await um<{ r: unknown }>(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid]) AS r`, [
              m.id,
            ])
          ).r,
        ).toEqual({ voltaram: 1 });
        expect(await preco(c, m.id)).toBe("160.00");
      });
    });

    it("importado: idem pelo Desfazer (integrado → não integrável) — o preço passa a seguir o produto (recalcular de novo não muda nada)", async () => {
      await withTx(async (c) => {
        await prepara(c, 6);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        // custo landed do importado depende das cotações (helper): preco_custo fora dos campos
        await camposLoja(
          c,
          CAMPOS_PADRAO.filter((k) => k !== "preco_custo"),
        );
        const m = await importado(c);
        if (!m.produtoId) throw new Error("fixture: importado sem produto");
        await marcar(c, m.id);
        await c.query(
          `UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1`,
          [m.id],
        );
        const congelado = await preco(c, m.id);
        await c.query(`UPDATE public.produtos_importados SET markup_varejo = 7 WHERE id = $1`, [
          m.produtoId,
        ]);
        await c.query(`SELECT public._imp_recomputar_precos_modelo($1)`, [m.produtoId]);
        expect(await preco(c, m.id)).toBe(congelado);
        expect(
          (
            await um<{ r: unknown }>(
              c,
              `SELECT public.integracao_desfazer($1, 'teste R14 sku12') AS r`,
              [m.id],
            )
          ).r,
        ).toEqual({ ok: true });
        const depois = await preco(c, m.id);
        expect(depois).not.toBe(congelado);
        expect(depois).not.toBeNull();
        await c.query(`SELECT public._imp_recomputar_precos_modelo($1)`, [m.produtoId]);
        expect(await preco(c, m.id)).toBe(depois); // já estava na regra
      });
    });

    it("importado pelo Voltar e interno (sem espelho) pelo Voltar: interno fica como está", async () => {
      await withTx(async (c) => {
        await prepara(c, 6);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        // custo landed do importado depende das cotações (helper): preco_custo fora dos campos
        await camposLoja(
          c,
          CAMPOS_PADRAO.filter((k) => k !== "preco_custo"),
        );
        const imp = await importado(c);
        const int = await modeloInterno(c);
        if (!imp.produtoId) throw new Error("fixture: importado sem produto");
        await marcar(c, imp.id);
        await marcar(c, int.id);
        const congelado = await preco(c, imp.id);
        const precoInt = await preco(c, int.id);
        await c.query(`UPDATE public.produtos_importados SET markup_varejo = 7 WHERE id = $1`, [
          imp.produtoId,
        ]);
        await c.query(`SELECT public._imp_recomputar_precos_modelo($1)`, [imp.produtoId]);
        expect(await preco(c, imp.id)).toBe(congelado);
        await c.query(`SELECT public.integracao_voltar(ARRAY[$1::uuid, $2::uuid])`, [
          imp.id,
          int.id,
        ]);
        expect(await preco(c, imp.id)).not.toBe(congelado);
        expect(await preco(c, int.id)).toBe(precoInt);
      });
    });
  },
);

describe.skipIf(!hasDb || !LOCAL)(
  "R14 fix round 1 — B4 (Voltar sem markup nem fixo) e B3 (prévia só-leitura do sku #3)",
  () => {
    it("revenda SEM markup e SEM preço fixo: Voltar recalcula e o preço de venda do card ZERA (NULL) — regra do recompute, aceita", async () => {
      await withTx(async (c) => {
        await prepara(c, 6);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        const m = await revenda(c);
        if (!m.produtoId) throw new Error("fixture: revenda sem produto");
        await marcar(c, m.id);
        await c.query(
          `UPDATE public.produtos_acabados SET markup_varejo = NULL, preco_varejo_fixo = NULL WHERE id = $1`,
          [m.produtoId],
        );
        expect(await preco(c, m.id)).toBe("159.90"); // congelado enquanto integrável
        await c.query(`SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
        expect(await preco(c, m.id)).toBeNull();
      });
    });

    it("supabase/consultas/r14_sku3_previa.sql: lista o produto com SKU desatualizado (vira 'Faltam dados') e conta o SKU previsto que colide com outro produto", async () => {
      await withTx(async (c) => {
        await prepara(c, 6);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        const sql = readFileSync(ROOT + "supabase/consultas/r14_sku3_previa.sql", "utf8");
        const m = await modeloInterno(c);
        const outro = await modeloInterno(c);
        const [p1, p2] = await previstos(c, m.id);
        await gravarSku(c, m.id, p1.tk, `X${p1.sku}`, false); // desatualizado
        await gravarSku(c, m.id, p2.tk, p2.sku, false); // em dia
        let linhas = (await c.query(sql)).rows.filter((r) => r.modelo_id === m.id);
        expect(linhas).toHaveLength(1);
        expect(linhas[0]).toMatchObject({ estado: "nao_integravel", vira_faltam_dados: true });
        expect([Number(linhas[0].n_desatualizados), Number(linhas[0].n_conflito)]).toEqual([1, 0]);
        // o SKU previsto da linha p1 passa a ser usado por OUTRO produto (à mão): o Regerar não resolve -> conflito
        const [o1] = await previstos(c, outro.id);
        await gravarSku(c, outro.id, o1.tk, p1.sku, true);
        linhas = (await c.query(sql)).rows.filter((r) => r.modelo_id === m.id);
        expect([Number(linhas[0].n_desatualizados), Number(linhas[0].n_conflito)]).toEqual([1, 1]);
        // a falta do retrato bate com a prévia
        const r = await retrato(c, m.id);
        expect(desatualizado(r)).toHaveLength(1);
        expect(r.faltas.filter((f) => !/SKU.*desatualizado/.test(f.texto))).toEqual([]);
      });
    });
  },
);
