/** Integração + API — migration 3 (estados + log). Plano Task 3. Só na cópia (N3), txn revertida. */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import type { Client as ClientType } from "pg";
import { hasDb, withTx, comoUsuario, um, dbUrl } from "./db";
import { aplicarSql } from "./mig-txn";
import { CAMPOS_PADRAO, INVERSOS, LOCAL, MIG_TXN, T, U, aplica, camposLoja, comoUsuarioCom, keywordsLoja, ler, modeloInterno, prepara, semTravas } from "./integracao-helpers";

const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // loja com mais modelos na cópia (mesmo id da suíte 2)
const SSL = false; // cópia local, sem SSL — mesmo padrão de kanban-auto.test.ts/sku-previa.test.ts

async function assinatura(c: ClientType, id: string): Promise<string> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [id])).r.produtos[0].assinatura;
}
async function marcar(c: ClientType, id: string, ass?: string): Promise<any> {
  const a = ass ?? (await assinatura(c, id));
  return (await um<{ r: any }>(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text))) AS r`, [id, a])).r;
}
async function erro(c: ClientType, sql: string, params: unknown[]): Promise<{ code: string; message: string }> {
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

  it("desfazer: SÓ super admin, só integrado, motivo obrigatório; log leva o retrato antigo; apaga o espelho", async () => {
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
      // Minor #4 (revisão T3): desfazer também apaga o espelho (o teste original só afirmava isso p/ voltar).
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_linhas WHERE modelo_id = $1`, [m.id])).n).not.toBe("0");
      expect((await um<{ r: any }>(c, `SELECT public.integracao_desfazer($1, 'NCM errado enviado') AS r`, [m.id])).r).toEqual({ ok: true });
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_linhas WHERE modelo_id = $1`, [m.id])).n).toBe("0");
      const ip = await um<{ e: string; mot: string; integ: unknown }>(c,
        `SELECT estado AS e, desfeito_motivo AS mot, integrado_em AS integ FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id]);
      expect(ip).toEqual({ e: "nao_integravel", mot: "NCM errado enviado", integ: null });
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE modelo_id = $1 AND acao = 'desfazer'`, [m.id]);
      expect(log.d.motivo).toBe("NCM errado enviado");
      expect(log.d.retrato.linhas[0].valores.preco_custo).toBe("62.10");
    });
  });

  it("log por papel (N11): não-super não vê campos/chaves/config; retrato do log sem custo p/ quem não vê custos; tenant admin (vê custos) idem", async () => {
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
      // Minor #4 (revisão T3): N11 também para um TENANT ADMIN (vê custos — caminho diferente do usuário
      // com só a permissão `integracao`, que não vê custos). tenant_admin não é super: continua sem 'campos',
      // mas o retrato do 'desfazer' mantém o custo (não mascarado), já que ele PODE ver custos.
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce15", [["integracao", true, false]], { tenantAdmin: true });
      const a = (await um<{ r: any }>(c, `SELECT public.integracao_log_listar(1) AS r`)).r;
      expect(a.super).toBe(false);
      expect(a.linhas.map((l: any) => l.acao)).not.toContain("campos");
      const da = a.linhas.find((l: any) => l.acao === "desfazer");
      expect(da.detalhe.retrato.linhas[0].valores.preco_custo).toBe("62.10");
    });
  });

  it("Minor #1 (revisão T3): _integracao_mascarar não crasha com retrato JSON null (desfazer sem retrato prévio)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      // Estado inconsistente só alcançável por escrita direta (não pelo fluxo normal): 'integrado' sem retrato.
      await c.query(
        `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, retrato, integrado_em)
         VALUES ($1, $2, 'integrado', ARRAY['nome']::text[], NULL, now())`, [T, m.id]);
      expect((await um<{ r: any }>(c, `SELECT public.integracao_desfazer($1, 'motivo sem retrato') AS r`, [m.id])).r).toEqual({ ok: true });
      // detalhe.retrato grava jsonb_build_object(..., 'retrato', v_ip.retrato) — retrato SQL NULL vira JSON null.
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE modelo_id = $1 AND acao = 'desfazer'`, [m.id]);
      expect(log.d.retrato).toBeNull();
      // Usuário sem visão de custos lendo o log NÃO pode crashar em _integracao_mascarar('null'::jsonb).
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce16", [["integracao", true, false]]);
      const v = (await um<{ r: any }>(c, `SELECT public.integracao_log_listar(1) AS r`)).r;
      const d = v.linhas.find((l: any) => l.acao === "desfazer" && l.modelo_id === m.id);
      expect(d.detalhe.retrato).toBeNull();
    });
  });

  it.skipIf(!MIG_TXN)("Minor #2 (revisão T3): o pos-check do inverso 3 pega QUALQUER uma das 6 sobrando, não só integracao_marcar", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      // Remove o DROP de 1 das 6 funções (uma DIFERENTE de integracao_marcar, que um pos-check ingênuo de
      // "só checa 1" poderia enxergar sozinho) — mesmo padrão do Minor #7 da suíte de migration 2.
      const semDrop = ler(INVERSOS[2]).replace(
        /DROP FUNCTION IF EXISTS public\._integracao_quem\(\);\n/,
        "",
      );
      await expect(aplicarSql(c, semTravas(semDrop, "teste-minor2-t3"), "teste-minor2-t3")).rejects.toThrow(/funcao\(oes\) da migration 3 ainda existem/);
    });
  });

  it("Minor #3 (revisão T3): marcar recusa modelo_id duplicado no payload (P0001, nada marcado)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const a = await assinatura(c, m.id);
      const e = await erro(
        c,
        `SELECT public.integracao_marcar(jsonb_build_array(
           jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text),
           jsonb_build_object('modelo_id', $1::uuid, 'assinatura', 'outra-assinatura')))`,
        [m.id, a],
      );
      expect(e.code).toBe("P0001");
      expect(e.message).toMatch(/repetido/);
      // nada foi marcado: nem sequer uma linha de integracao_produtos foi criada pro modelo.
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id])).n).toBe("0");
    });
  });

  it("Minor #4 (revisão T3): título '(nada marcado)' — 2º item ruim aborta o 1º item bom em lote (atômico)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const bom = await modeloInterno(c);
      const ruim = await modeloInterno(c);
      const assBom = await assinatura(c, bom.id);
      // ruim: assinatura errada de propósito — dispara P0409 depois de bom já ter sido processado no loop
      // (ordem por m.id — usa 2 ids e verifica os dois papeis, não confia em qual vem primeiro).
      const [primeiro, segundo] = [bom.id, ruim.id].sort();
      const itens = [
        primeiro === bom.id
          ? { modelo_id: bom.id, assinatura: assBom }
          : { modelo_id: ruim.id, assinatura: "errada" },
        segundo === ruim.id
          ? { modelo_id: ruim.id, assinatura: "errada" }
          : { modelo_id: bom.id, assinatura: assBom },
      ];
      const e = await erro(
        c,
        `SELECT public.integracao_marcar($1::jsonb)`,
        [JSON.stringify(itens)],
      );
      expect(e.code).toBe("P0409");
      // "nada marcado": NEM o produto bom (que teria passado sozinho) foi marcado — o lote é atômico.
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_produtos WHERE modelo_id IN ($1, $2) AND estado <> 'nao_integravel'`,
        [bom.id, ruim.id])).n).toBe("0");
    });
  });

  it("Minor #4 (revisão T3): as 3 mensagens P0409 de marcar/voltar são ASCII em runtime (não só a 1ª)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const asciiRe = /^[\x20-\x7E]*$/;
      // 1) "ja esta %" (marcar de novo sobre integravel)
      const m1 = await modeloInterno(c);
      await marcar(c, m1.id);
      const e1 = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', 'x')))`, [m1.id]);
      expect(e1.code).toBe("P0409");
      expect(asciiRe.test(e1.message)).toBe(true);
      // 2) "mudou desde o resumo" (assinatura velha)
      const m2 = await modeloInterno(c);
      const a2 = await assinatura(c, m2.id);
      await c.query(`UPDATE public.modelos SET ncm = '6109.90.00' WHERE id = $1`, [m2.id]);
      const e2 = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [m2.id, a2]);
      expect(e2.code).toBe("P0409");
      expect(asciiRe.test(e2.message)).toBe(true);
      // 3) "esta %" (voltar de nao_integravel)
      const m3 = await modeloInterno(c);
      const e3 = await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m3.id]);
      expect(e3.code).toBe("P0409");
      expect(asciiRe.test(e3.message)).toBe(true);
    });
  });

  it("Minor #4 (revisão T3): marcar e log_listar sem a permissão 'integracao' são recusados (42501)", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      const a = await assinatura(c, m.id);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce17", []);
      const eMarcar = await erro(c, `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [m.id, a]);
      expect(eMarcar.code).toBe("42501");
      expect(eMarcar.message).toBe("Sem permissão para editar a Integração.");
      const eLog = await erro(c, `SELECT public.integracao_log_listar(1)`, []);
      expect(eLog.code).toBe("42501");
      expect(eLog.message).toBe("Sem permissão para ver a Integração.");
    });
  });

  it("Important #2 (revisão T3): tenant isolation — marcar/voltar/desfazer/log_listar ignoram produto de outra loja", async () => {
    await withTx(async (c) => {
      await prepara(c, 3);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      // 2 modelos JÁ existentes de outra loja (Ave Rara) na cópia — leitura/escrita tentada, nunca deveria valer.
      const foreignVoltar = "2ddfb3cf-8fb3-46ab-9ad7-e7319017a770";
      const foreignDesfazer = "5d10a1ef-b643-48f4-9340-700387f92c87";
      await c.query(
        `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, retrato, assinatura, marcado_em)
         VALUES ($1, $2, 'integravel', ARRAY['nome']::text[], jsonb_build_object('linhas', '[]'::jsonb), 'x', now())`,
        [AVE_RARA, foreignVoltar],
      );
      await c.query(
        `INSERT INTO public.integracao_linhas (tenant_id, loja_nome, modelo_id, tipo, ordem) VALUES ($1, 'Ave Rara', $2, 'produto', 0)`,
        [AVE_RARA, foreignVoltar],
      );
      await c.query(
        `INSERT INTO public.integracao_produtos (tenant_id, modelo_id, estado, campos, retrato, integrado_em)
         VALUES ($1, $2, 'integrado', ARRAY['nome']::text[], jsonb_build_object('linhas', '[]'::jsonb), now())`,
        [AVE_RARA, foreignDesfazer],
      );

      // marcar: "Produto não encontrado nesta loja." e nenhuma linha nova em integracao_produtos p/ esse id.
      const eMarcar = await erro(
        c,
        `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', 'x')))`,
        [foreignVoltar],
      );
      expect(eMarcar.message).toBe("Produto não encontrado nesta loja.");
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_produtos WHERE modelo_id = $1 AND tenant_id = $2`,
        [foreignVoltar, T])).n).toBe("0");

      // voltar: P0409 (o filtro por tenant faz o LEFT JOIN não achar a linha => estado 'nao_integravel' => P0409),
      // e a linha estrangeira PERMANECE integravel com o espelho intacto.
      const eVoltar = await erro(c, `SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [foreignVoltar]);
      expect(eVoltar.code).toBe("P0409");
      const foreignIp = await um<{ e: string; n: string }>(
        c,
        `SELECT ip.estado AS e, (SELECT count(*)::text FROM public.integracao_linhas l WHERE l.modelo_id = ip.modelo_id) AS n
           FROM public.integracao_produtos ip WHERE ip.modelo_id = $1`,
        [foreignVoltar],
      );
      expect(foreignIp).toEqual({ e: "integravel", n: "1" });

      // desfazer: P0001 (o filtro x.tenant_id = v_tenant faz NOT FOUND) e a linha estrangeira SEGUE integrado.
      const eDesfazer = await erro(c, `SELECT public.integracao_desfazer($1, 'tentativa cross-tenant')`, [foreignDesfazer]);
      expect(eDesfazer.code).toBe("P0001");
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [foreignDesfazer])).e)
        .toBe("integrado");

      // log_listar: nenhuma linha da OUTRA loja aparece (nem total nem linhas) — o log_listar do usuário T
      // não tem NADA além do que T já tinha (0, já que nenhuma ação de T rodou nesse teste).
      const meu = (await um<{ r: any }>(c, `SELECT public.integracao_log_listar(1) AS r`)).r;
      expect(meu.total).toBe(0);
      expect(meu.linhas).toEqual([]);
    });
  });

  it("Important #1 (revisão T3): marcar serializa com o MESMO advisory lock dos gravadores de SKU (sku_modelo:<id>)", async () => {
    const segunda = new Client({ connectionString: dbUrl()!, ssl: SSL });
    await segunda.connect();
    try {
      await withTx(async (c) => {
        await prepara(c, 3);
        await comoUsuario(c, U);
        await keywordsLoja(c, "k");
        const m = await modeloInterno(c);
        const a = await assinatura(c, m.id);

        // A 2ª conexão prende a MESMA chave que os gravadores de SKU usam de verdade
        // (_aplicar_skus_modelo_core/_gerar_skus_modelo_core/_salvar_sku_manual_core, conferido no read-only
        // da cópia: pg_advisory_xact_lock(hashtextextended('sku_modelo:' || _modelo_id::text, 0))) — simula
        // um Regerar/Salvar em andamento no exato instante em que marcar tentaria integrar o mesmo produto.
        await segunda.query("BEGIN");
        await segunda.query(`SELECT pg_advisory_xact_lock(hashtextextended('sku_modelo:' || $1::text, 0))`, [m.id]);

        // marcar deve ficar esperando o MESMO advisory lock — com lock_timeout curto, estoura 55P03 (mesmo
        // mecanismo/código de um lock de linha, ver comentário de kanban-auto.test.ts) em vez de prosseguir.
        await c.query("SET LOCAL lock_timeout = '300ms'");
        await c.query("SAVEPOINT trava_sku");
        let travou = false;
        try {
          await marcar(c, m.id, a);
        } catch (e: any) {
          travou = e.code === "55P03";
          await c.query("ROLLBACK TO SAVEPOINT trava_sku");
        }
        expect(travou).toBe(true);
        // nada foi marcado enquanto a 2ª conexão segurava a trava.
        expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_produtos WHERE modelo_id = $1 AND estado <> 'nao_integravel'`, [m.id])).n)
          .toBe("0");

        // solta a trava da 2ª conexão — agora marcar (com lock_timeout normal de novo) segue em frente.
        await segunda.query("ROLLBACK");
        await c.query("SET LOCAL lock_timeout = '500ms'");
        expect(await marcar(c, m.id, a)).toEqual({ marcados: 1 });
      });
    } finally {
      await segunda.end();
    }
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
