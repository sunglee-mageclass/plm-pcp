/** Integração + API — migration 3 (estados + log). Plano Task 3. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { CAMPOS_PADRAO, INVERSOS, LOCAL, MIG_TXN, T, U, aplica, camposLoja, comoUsuarioCom, keywordsLoja, modeloInterno, prepara } from "./integracao-helpers";

async function assinatura(c: Client, id: string): Promise<string> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [id])).r.produtos[0].assinatura;
}
async function marcar(c: Client, id: string, ass?: string): Promise<any> {
  const a = ass ?? (await assinatura(c, id));
  return (await um<{ r: any }>(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text))) AS r`, [id, a])).r;
}
async function erro(c: Client, sql: string, params: unknown[]): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT e");
  try {
    await c.query(sql, params);
    throw new Error("esperava erro");
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT e");
    return { code: e.code, message: e.message };
  }
}

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 3: estados", () => {
  it("marcar: integrável + retrato + espelho (1 produto + 2 sublinhas) + log 'integrar'; estado_modelos enxerga", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      expect(await marcar(c, m.id)).toEqual({ marcados: 1 });
      const ip = await um<{ estado: string; campos: string[]; ass: string; marcado: boolean }>(c,
        `SELECT estado, campos, assinatura AS ass, marcado_em IS NOT NULL AS marcado FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id]);
      expect(ip).toMatchObject({ estado: "integravel", campos: [...CAMPOS_PADRAO], marcado: true });
      const esp = await c.query(`SELECT tipo, ordem, ref_sku, tamanho, preco_venda, integrado_em FROM public.integracao_linhas WHERE modelo_id = $1 ORDER BY ordem`, [m.id]);
      expect(esp.rows.map((r) => [r.tipo, r.ordem, r.tamanho])).toEqual([["produto", 0, null], ["variante", 1, "P"], ["variante", 2, "M"]]);
      expect(esp.rows[1].ref_sku).toBe(`${m.ref}-P`);
      expect(esp.rows[0].preco_venda).toBe("159.90");
      const log = await um<{ acao: string; quem: string; d: any }>(c,
        `SELECT acao, quem, detalhe AS d FROM public.integracao_log WHERE modelo_id = $1`, [m.id]);
      expect(log).toMatchObject({ acao: "integrar", d: { campos: 17, sublinhas: 2 } });
      expect(log.quem).toMatch(/\(super admin\)$/);
      const est = (await um<{ r: any }>(c, `SELECT public.integracao_estado_modelos(ARRAY[$1::uuid]) AS r`, [m.id])).r;
      expect(est[m.id]).toMatchObject({ estado: "integravel", campos: [...CAMPOS_PADRAO] });
      const todos = (await um<{ r: any }>(c, `SELECT public.integracao_estado_modelos(NULL) AS r`)).r;
      expect(todos[m.id]).toMatchObject({ estado: "integravel" });
      expect(Object.values(todos).every((x: any) => ["integravel", "integrado"].includes(x.estado))).toBe(true);
    });
  });

  it("assinatura velha = P0409 integracao_mudou (ASCII); marcar de novo = P0409", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const a = await assinatura(c, m.id);
      await c.query(`UPDATE public.modelos SET ncm = '6109.90.00' WHERE id = $1`, [m.id]);
      const e = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [m.id, a]);
      expect(e.code).toBe("P0409");
      expect(e.message).toMatch(/^integracao_mudou: /);
      expect(/^[\x20-\x7E]*$/.test(e.message)).toBe(true);
      await marcar(c, m.id);
      const e2 = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', 'x')))`, [m.id]);
      expect(e2.code).toBe("P0409");
    });
  });

  it("incompleto e reprovado = P0001 (nada marcado)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, null);
      const m = await modeloInterno(c);
      const e = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
        [m.id, await assinatura(c, m.id)]);
      expect(e).toMatchObject({ code: "P0001" });
      expect(e.message).toMatch(/incompleto — faltam: Keywords/);
      await keywordsLoja(c, "k");
      await c.query(`UPDATE public.modelos SET status_desenvolvimento = 'reprovado' WHERE id = $1`, [m.id]);
      const e2 = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
        [m.id, await assinatura(c, m.id)]);
      expect(e2.message).toMatch(/reprovado/);
    });
  });

  it("P-75 A: com Preço de custo marcado só integra quem VÊ custos; sem custo marcado, integra", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce11", [["integracao", true, true]]);
      const a = await assinatura(c, m.id);
      const e = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [m.id, a]);
      expect(e).toMatchObject({ code: "42501" });
      expect(e.message).toMatch(/^integracao_sem_custo: /);
      await camposLoja(c, CAMPOS_PADRAO.filter((k) => k !== "preco_custo"));
      expect(await marcar(c, m.id)).toEqual({ marcados: 1 });
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce12", [["integracao", true, false]]);
      const e2 = await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
      expect(e2.message).toBe("Sem permissão para editar a Integração.");
    });
  });

  it("voltar: só de integrável (P-63 A), apaga o espelho, loga; em massa é atômico", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const a = await modeloInterno(c);
      const b = await modeloInterno(c);
      await marcar(c, a.id);
      const e = await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid, $2::uuid])`, [a.id, b.id]);
      expect(e.code).toBe("P0409");
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [a.id])).e).toBe("integravel");
      expect((await um<{ r: any }>(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid]) AS r`, [a.id])).r).toEqual({ voltaram: 1 });
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_linhas WHERE modelo_id = $1`, [a.id])).n).toBe("0");
      expect((await um<{ e: string; r: unknown }>(c, `SELECT estado AS e, retrato AS r FROM public.integracao_produtos WHERE modelo_id = $1`, [a.id])))
        .toEqual({ e: "nao_integravel", r: null });
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado' WHERE modelo_id = $1`, [a.id]);
      expect((await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [a.id])).message).toMatch(/^integracao_mudou: .* esta integrado$/);
    });
  });

  it("desfazer: SÓ super admin, só integrado, motivo obrigatório; log leva o retrato antigo", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      expect((await erro(c, `SELECT public.integracao_desfazer($1, 'motivo ok')`, [m.id])).message).toMatch(/Só um produto integrado/);
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1`, [m.id]);
      expect((await erro(c, `SELECT public.integracao_desfazer($1, ' x ')`, [m.id])).message).toBe("Informe o motivo (obrigatório).");
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce13", [["integracao", true, true]], { tenantAdmin: true });
      expect((await erro(c, `SELECT public.integracao_desfazer($1, 'NCM errado enviado')`, [m.id])).message).toBe("Só o super admin pode fazer isto.");
      await comoUsuario(c, U);
      expect((await um<{ r: any }>(c, `SELECT public.integracao_desfazer($1, 'NCM errado enviado') AS r`, [m.id])).r).toEqual({ ok: true });
      const ip = await um<{ e: string; mot: string; integ: unknown }>(c,
        `SELECT estado AS e, desfeito_motivo AS mot, integrado_em AS integ FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id]);
      expect(ip).toEqual({ e: "nao_integravel", mot: "NCM errado enviado", integ: null });
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE modelo_id = $1 AND acao = 'desfazer'`, [m.id]);
      expect(log.d.motivo).toBe("NCM errado enviado");
      expect(log.d.retrato.linhas[0].valores.preco_custo).toBe("62.10");
    });
  });

  it("log por papel (N11): não-super não vê campos/chaves/config; retrato do log sem custo p/ quem não vê custos", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      await c.query(`UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1`, [m.id]);
      await c.query(`SELECT public.integracao_desfazer($1, 'motivo do teste')`, [m.id]);
      await c.query(`INSERT INTO public.integracao_log (tenant_id, acao, quem, detalhe) VALUES ($1, 'campos', 'x', '{}')`, [T]);
      const sup = (await um<{ r: any }>(c, `SELECT public.integracao_log_listar(1) AS r`)).r;
      expect(sup.linhas.map((l: any) => l.acao)).toEqual(expect.arrayContaining(["campos", "desfazer", "integrar"]));
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce14", [["integracao", true, false]]);
      const v = (await um<{ r: any }>(c, `SELECT public.integracao_log_listar(1) AS r`)).r;
      expect(v.linhas.map((l: any) => l.acao)).not.toContain("campos");
      const d = v.linhas.find((l: any) => l.acao === "desfazer");
      for (const l of d.detalhe.retrato.linhas) expect(l.valores.preco_custo).toBeNull();
    });
  });

  it.skipIf(!MIG_TXN)("inverso 3 desfaz a 3 (6 funções somem)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await aplica(c, INVERSOS[2]);
      const r = await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('_integracao_quem','_integracao_logar','integracao_marcar','integracao_voltar','integracao_desfazer','integracao_log_listar')`);
      expect(r.n).toBe("0");
    });
  });
});
