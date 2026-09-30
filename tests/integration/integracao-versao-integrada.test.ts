/**
 * INTEGRAÇÃO › "Versão de produto já integrado" (P-156 C + R7; T5 da frente Preço anterior/Título por versão) — migration
 * 20261018110000 (RPC só-leitura integracao_versoes_integradas). SÓ na cópia local; txn revertida (withTx): NADA é gravado.
 * Modos: sem VERSAO_INTEGRADA_MIG_TXN a migration precisa estar APLICADA na cópia; com VERSAO_INTEGRADA_MIG_TXN=1 o `prepara`
 * a volta (se viva) e reaplica o arquivo DENTRO da txn.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { Client as PgClient } from "pg";
import { hasDb, withTx, comoUsuario, dbUrl, um } from "./db";
import { exigeBancoLocal } from "./mig-txn";
import {
  CAMPOS_PADRAO, LOCAL, T, U, aplica, apelido, camposLoja, comoUsuarioCom, cor, ler, MIG_VERSAO_INTEGRADA, INV_VERSAO_INTEGRADA,
} from "./integracao-helpers";

const MIG = MIG_VERSAO_INTEGRADA;
const INV = INV_VERSAO_INTEGRADA;
const MIG_TXN = process.env.VERSAO_INTEGRADA_MIG_TXN === "1";
const SIG = "public.integracao_versoes_integradas(uuid[])";

async function jaAplicada(): Promise<boolean> {
  if (!hasDb || !LOCAL || MIG_TXN) return false;
  const c = new PgClient({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    return (await c.query(`SELECT to_regprocedure('${SIG}') IS NOT NULL AS ok`)).rows[0]?.ok === true;
  } finally {
    await c.end();
  }
}
const PRONTO = hasDb && LOCAL && (MIG_TXN || (await jaAplicada()));

async function prepara(c: Client): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  if (MIG_TXN) {
    if ((await um<{ ok: boolean }>(c, `SELECT to_regprocedure('${SIG}') IS NOT NULL AS ok`)).ok) await aplica(c, INV);
    await aplica(c, MIG);
  }
  if (!(await um<{ ok: boolean }>(c, `SELECT to_regprocedure('${SIG}') IS NOT NULL AS ok`)).ok) {
    throw new Error("migration 20261018110000 ausente — aplique na cópia ou rode com VERSAO_INTEGRADA_MIG_TXN=1");
  }
}
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT vi_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT vi_falha");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT vi_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}

// ─────────────────────────── fixtures: produto interno completo com N variantes (Tecido 1) ───────────────────────────
let seq = 0;
const suf = (): string => `${Date.now().toString(36)}${(seq++).toString(36)}`.toUpperCase();
type Var = { corId: string; apelidoId: string | null; vtId: string };
async function variante(c: Client, nome: string): Promise<Var> {
  const s = suf();
  const corId = await cor(c, `${nome} ${s}`, `C${s.slice(-3)}`);
  const apelidoId = await apelido(c, corId, `${nome} ap ${s}`, `A${s.slice(-3)}`);
  const artigo = (await um<{ id: string }>(c, "SELECT id FROM public.artigos WHERE tenant_id = $1 ORDER BY id LIMIT 1", [T])).id;
  const vtId = (await um<{ id: string }>(c,
    `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, cor_id, cor_apelido_id, nome_variante) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [T, artigo, corId, apelidoId, `Var ${s}`])).id;
  return { corId, apelidoId, vtId };
}
async function produto(c: Client, nome: string, vars: Var[], o: { versao?: number; base?: string | null } = {}): Promise<{ id: string; ref: string }> {
  const s = suf();
  const ref = `VIN${s}`;
  const id = (await um<{ id: string }>(c,
    `INSERT INTO public.modelos (tenant_id, nome, ref, origem, versao, modelo_base_id, preco_anterior, preco_venda, peso_kg, ncm,
                                 titulo_pagina, descricao_produto, comprimento_cm, largura_cm, altura_cm, custo_peca_previsto,
                                 tamanho_tipo, status_planejamento, fotos_modelo)
     VALUES ($1::uuid, $2, $3, 'interno', $4, $5, 179.90, 159.90, 0.220, '6109.10.00', 'Titulo Fixo', 'Descricao.', 68, 42, 2, 62.10,
             'letra', 'planejado', ARRAY[$1::text || '/fotos_modelo/vi.jpg']) RETURNING id`,
    [T, `${nome} ${s}`, ref, o.versao ?? 1, o.base ?? null])).id;
  const artigo = (await um<{ id: string }>(c, "SELECT id FROM public.artigos WHERE tenant_id = $1 ORDER BY id LIMIT 1", [T])).id;
  const mt = (await um<{ id: string }>(c,
    "INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo) VALUES ($1, $2, 1, 'tecido') RETURNING id", [id, artigo])).id;
  let ordem = 0;
  for (const v of vars) {
    ordem++;
    await c.query("INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, $3)", [mt, v.vtId, ordem]);
    await c.query(`INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, $2, '{"38|P": 2, "40|M": 3}', 5)`, [id, ordem]);
    for (const tam of ["38|P", "40|M"]) {
      await c.query(
        `INSERT INTO public.modelo_skus (tenant_id, modelo_id, variante_key, tamanho_key, sku, manual)
         VALUES ($1, $2, public._sku_variante_key($3, $4), $5, $6, true)`,
        [T, id, v.corId, v.apelidoId, tam, `${ref}-${ordem}-${tam.split("|")[1]}`]);
    }
  }
  return { id, ref };
}
async function marcar(c: Client, id: string): Promise<void> {
  const p = (await um<{ r: any }>(c, "SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r", [id])).r.produtos[0];
  if (!p.completo) throw new Error(`produto incompleto: ${JSON.stringify(p.faltas)}`);
  await c.query("SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))", [id, p.assinatura]);
}
async function integrado(c: Client, id: string): Promise<void> {
  await c.query("UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1", [id]);
}
const chave = (c: Client, v: Var) => um<{ k: string }>(c, "SELECT public._sku_variante_key($1, $2)::text AS k", [v.corId, v.apelidoId]).then((r) => r.k);
async function versoes(c: Client, ids: string[]): Promise<any[]> {
  return (await um<{ r: any[] }>(c, "SELECT public.integracao_versoes_integradas($1::uuid[]) AS r", [ids])).r;
}

describe.skipIf(!PRONTO)("integração — versão de produto já integrado (T5)", () => {
  it("v1 integrada + v2 com 1 cor nova e 1 que saiu → iguais/novas/saíram; nomes do RETRATO (cor marcada)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c, U);
      await camposLoja(c, CAMPOS_PADRAO);
      const [a, b, cc] = [await variante(c, "Preto"), await variante(c, "Branco"), await variante(c, "Azul")];
      const v1 = await produto(c, "Vestido V1", [a, b]);
      await marcar(c, v1.id);
      await integrado(c, v1.id);
      const v2 = await produto(c, "Vestido V2", [a, cc], { versao: 2, base: v1.id });
      const r = await versoes(c, [v2.id, v1.id]);
      expect(r.length, "só a v2 tem versão menor integrada").toBe(1);
      const x = r[0];
      expect(x.modelo_id).toBe(v2.id);
      expect(x.anterior_id).toBe(v1.id);
      expect(x.anterior_versao).toBe(1);
      expect(x.anterior_estado).toBe("integrado");
      expect(x.anterior_integrado_em).toBeTruthy();
      expect(x.iguais.map((v: any) => v.variante_key)).toEqual([await chave(c, a)]);
      expect(x.novas.map((v: any) => v.variante_key)).toEqual([await chave(c, cc)]);
      expect(x.sairam.map((v: any) => v.variante_key)).toEqual([await chave(c, b)]);
      // o que SAIU vem com o nome do RETRATO gravado (Cor base/Apelido marcados); para provar a fonte, renomeia a cor viva
      await c.query("UPDATE public.cores SET nome = 'Renomeada Viva' WHERE id = $1", [b.corId]);
      const y = (await versoes(c, [v2.id]))[0];
      expect(y.sairam[0].cor_nome).toMatch(/^Branco /);
      expect(y.sairam[0].apelido_nome).toMatch(/^Branco ap /);
      expect(y.novas[0].cor_nome).toMatch(/^Azul /);
    });
  });
  it("sem Cor base/Apelido marcados, os nomes da versão integrada vêm da matriz VIVA dela", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c, U);
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "cor_base" && k !== "cor_apelido"));
      const [a, b] = [await variante(c, "Verde"), await variante(c, "Rosa")];
      const v1 = await produto(c, "Blusa V1", [a, b]);
      await marcar(c, v1.id);
      const ret = (await um<{ r: any }>(c, "SELECT retrato AS r FROM public.integracao_produtos WHERE modelo_id = $1", [v1.id])).r;
      expect(ret.linhas[1].valores).not.toHaveProperty("cor_base");
      const v2 = await produto(c, "Blusa V2", [a], { versao: 2, base: v1.id });
      await c.query("UPDATE public.cores SET nome = 'Rosa Nova' WHERE id = $1", [b.corId]);
      const x = (await versoes(c, [v2.id]))[0];
      expect(x.anterior_estado).toBe("integravel");
      expect(x.sairam.length).toBe(1);
      expect(x.sairam[0].cor_nome).toBe("Rosa Nova"); // a matriz viva da vN
    });
  });
  it("v1 integrável + v2 integrada + v3 → mostra a v2 (a MAIS ALTA menor já integrada); v2 vê a v1", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c, U);
      await camposLoja(c, CAMPOS_PADRAO);
      const a = await variante(c, "Lilas");
      const v1 = await produto(c, "Saia V1", [a]);
      await marcar(c, v1.id);
      const v2 = await produto(c, "Saia V2", [a], { versao: 2, base: v1.id });
      await marcar(c, v2.id);
      await integrado(c, v2.id);
      const v3 = await produto(c, "Saia V3", [a], { versao: 3, base: v1.id });
      const r = await versoes(c, [v1.id, v2.id, v3.id]);
      const por = Object.fromEntries(r.map((x: any) => [x.modelo_id, x]));
      expect(Object.keys(por).sort()).toEqual([v2.id, v3.id].sort());
      expect(por[v3.id].anterior_id).toBe(v2.id);
      expect(por[v3.id].anterior_estado).toBe("integrado");
      expect(por[v2.id].anterior_id).toBe(v1.id);
      expect(por[v2.id].anterior_estado).toBe("integravel");
      expect(por[v3.id].iguais.length).toBe(1);
    });
  });
  it("sem permissão 'integracao' → recusa do _integracao_exige (42501); loja alheia não aparece; >500 → P0001 ASCII", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await comoUsuario(c, U);
      await camposLoja(c, CAMPOS_PADRAO);
      const a = await variante(c, "Ocre");
      const v1 = await produto(c, "Macacao V1", [a]);
      await marcar(c, v1.id);
      const v2 = await produto(c, "Macacao V2", [a], { versao: 2, base: v1.id });
      // loja alheia: o mesmo super admin em OUTRA loja não vê os ids desta
      const outra = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [T])).id;
      await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [outra, U]);
      expect(await versoes(c, [v2.id])).toEqual([]);
      await comoUsuario(c, U);
      expect((await versoes(c, [v2.id])).length).toBe(1);
      const muitos = Array.from({ length: 501 }, () => v2.id);
      const e = await falha(c, "SELECT public.integracao_versoes_integradas($1::uuid[])", [muitos]);
      expect(e.code).toBe("P0001");
      expect(e.message).toBe("versoes_integradas: limite de 500 ids");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-000000000b01", [["criacao_planejamento", true, true]]);
      const s = await falha(c, "SELECT public.integracao_versoes_integradas($1::uuid[])", [[v2.id]]);
      expect(s.code).toBe("42501");
    });
  });
  it("ACL: anon sem EXECUTE; authenticated com", async () => {
    await withTx(async (c) => {
      await prepara(c);
      expect((await um<{ ok: boolean }>(c, `SELECT has_function_privilege('anon', '${SIG}', 'EXECUTE') AS ok`)).ok).toBe(false);
      expect((await um<{ ok: boolean }>(c, `SELECT has_function_privilege('public', to_regprocedure('${SIG}'), 'EXECUTE') AS ok`)).ok).toBe(false);
      expect((await um<{ ok: boolean }>(c, `SELECT has_function_privilege('authenticated', '${SIG}', 'EXECUTE') AS ok`)).ok).toBe(true);
    });
  });
  it("ida → volta → ida dentro da txn (md5 conferido pelas guardas; reaplicar = no-op)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const md5 = async () => (await um<{ m: string | null }>(c, `SELECT md5(pg_get_functiondef(to_regprocedure('${SIG}'))) AS m`)).m;
      const depois = await md5();
      expect(ler(MIG)).toContain(`'${depois}'`);
      await aplica(c, INV);
      expect(await md5()).toBeNull();
      await expect(aplica(c, INV)).rejects.toThrow(/nao esta no texto da ida/);
      await aplica(c, MIG);
      expect(await md5()).toBe(depois);
      await aplica(c, MIG);
      expect(await md5()).toBe(depois);
    });
  });
  it("medição: 500 ids da maior loja com TODA família tendo a v1 integrada (pior caso) — tempo registrado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const loja = (await um<{ t: string }>(c,
        "SELECT tenant_id AS t FROM public.modelos GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 1")).t;
      await comoUsuario(c, U);
      await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [loja, U]);
      const { rows: v1s } = await c.query(
        "SELECT id FROM public.modelos WHERE tenant_id = $1 AND modelo_base_id IS NULL ORDER BY id LIMIT 250", [loja]);
      // v2 de cada v1 (cópia do BOM/grade pelo mesmo INSERT…SELECT do Replicar, sem o resto) + v1 "integrada" com o retrato vivo
      const ids: string[] = [];
      for (const { id } of v1s) {
        const v2 = (await um<{ id: string }>(c,
          `INSERT INTO public.modelos (tenant_id, nome, ref, versao, modelo_base_id, tamanho_tipo)
           SELECT tenant_id, nome, ref, 2, id, tamanho_tipo FROM public.modelos WHERE id = $1 RETURNING id`, [id])).id;
        await c.query(
          `WITH o AS (SELECT * FROM public.modelo_tecidos WHERE modelo_id = $1),
                n AS (INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo)
                      SELECT $2, artigo_id, numero, tipo, consumo FROM o ORDER BY o.numero, o.tipo, o.id RETURNING id, numero, tipo)
           INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem)
           SELECT n.id, mtv.variante_tecido_id, mtv.ordem FROM o JOIN n ON n.numero = o.numero AND n.tipo = o.tipo
             JOIN public.modelo_tecido_variantes mtv ON mtv.modelo_tecido_id = o.id`, [id, v2]);
        await c.query(
          "INSERT INTO public.modelo_grades (modelo_id, variante_numero, grades, grade_total) SELECT $2, variante_numero, grades, grade_total FROM public.modelo_grades WHERE modelo_id = $1",
          [id, v2]);
        await c.query(
          `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, retrato, integrado_em)
           SELECT $2, $1, 'integrado', $3::text[], public._integracao_retrato_core($1, $3::text[], '{}'::jsonb) -> 'retrato', now()
           ON CONFLICT DO NOTHING`, [id, loja, CAMPOS_PADRAO]);
        ids.push(v2, id);
      }
      // completa 500 com ids que não existem (o teto é por cardinalidade; a medição vale para 500 ids)
      const lista = [...ids, ...Array.from({ length: Math.max(0, 500 - ids.length) }, () => crypto.randomUUID())].slice(0, 500);
      expect(lista.length).toBe(500);
      const t0 = Date.now();
      const r = await versoes(c, lista);
      const ms = Date.now() - t0;
      // eslint-disable-next-line no-console
      console.log(`[T5] integracao_versoes_integradas: ${lista.length} ids, ${r.length} com versão integrada, ${ms} ms`);
      expect(r.length).toBeGreaterThan(0);
      expect(ms).toBeLessThan(15_000);
    });
  }, 180_000);
});
