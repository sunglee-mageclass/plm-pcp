/** Integração + API — migration 6 (config, chaves, acessos, _integracao_ler/_confirmar). Plano Task 6. Só na cópia (N3). */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { CAMPOS_PADRAO, INVERSOS, LAYOUT, LOCAL, MIG_TXN, T, U, aplica, comoUsuarioCom, keywordsLoja, modeloInterno, prepara } from "./integracao-helpers";

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
async function marcar(c: Client, id: string): Promise<void> {
  const a = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [id])).r.produtos[0].assinatura;
  await c.query(`SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [id, a]);
}
async function chave(c: Client, nome = "ERP Teste"): Promise<{ id: string; chave: string; final: string }> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_chave_criar($1) AS r`, [nome])).r;
}
async function ler(c: Client, k: string, o: { incluir?: boolean; cursor?: string | null; limite?: number | null; modo?: string; ip?: string } = {}): Promise<any> {
  return (await um<{ r: any }>(c, `SELECT public._integracao_ler($1, $2, $3, $4, $5, $6) AS r`,
    [sha(k), o.incluir ?? false, o.cursor ?? null, o.limite ?? null, o.modo ?? "normal", o.ip ?? "203.0.113.10"])).r;
}
async function confirmar(c: Client, r: any): Promise<any> {
  const entrega = { produtos: r.produtos.map((p: any) => ({ modelo_id: p.modelo_id, assinatura: p.assinatura })), fotos_descartadas: 0, fotos_ausentes: 0 };
  return (await um<{ r: any }>(c, `SELECT public._integracao_confirmar($1, $2, $3::jsonb) AS r`, [r.chave_id, r.acesso_id, JSON.stringify(entrega)])).r;
}
async function msg(c: Client, sql: string, params: unknown[]): Promise<string> {
  await c.query("SAVEPOINT m");
  try { await c.query(sql, params); await c.query("RELEASE SAVEPOINT m"); return "PASSOU"; }
  catch (e: any) { await c.query("ROLLBACK TO SAVEPOINT m"); return `${e.code} ${e.message}`; }
}

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 6: configurações e chaves (SÓ super admin)", () => {
  it("campos: só super admin; ordem normalizada; rev (P0409 ASCII); desconhecido/vazio = P0001; log 'campos'", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce31", [["integracao", true, true]], { tenantAdmin: true });
      expect(await msg(c, `SELECT public.integracao_salvar_config($1::text[], 1)`, [["nome"]])).toBe("42501 Só o super admin pode fazer isto.");
      await comoUsuario(c, U);
      const r = (await um<{ r: any }>(c, `SELECT public.integracao_salvar_config($1::text[], 1) AS r`, [["foto", "nome", "ref_sku"]])).r;
      expect(r.campos).toEqual(["nome", "ref_sku", "foto"]);
      expect(r.rev).toBe(2);
      expect(await msg(c, `SELECT public.integracao_salvar_config($1::text[], 1)`, [["nome"]])).toBe("P0409 conflito_versao: a configuracao foi salva por outra pessoa");
      expect(await msg(c, `SELECT public.integracao_salvar_config($1::text[], 2)`, [["xyz"]])).toMatch(/^P0001 /);
      expect(await msg(c, `SELECT public.integracao_salvar_config($1::text[], 2)`, [[]])).toMatch(/^P0001 /);
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE tenant_id = $1 AND acao = 'campos' ORDER BY criado_em DESC LIMIT 1`, [T]);
      expect(log.d).toEqual({ antes: [...CAMPOS_PADRAO], depois: ["nome", "ref_sku", "foto"] });
    });
  });

  it("configurações da API: faixas (fora = P0001), log config_api antes/depois", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      expect(await msg(c, `SELECT public.integracao_salvar_config_api('{"limite_por_minuto": 601}'::jsonb, 1)`, [])).toMatch(/^P0001 .*1–600/);
      const r = (await um<{ r: any }>(c, `SELECT public.integracao_salvar_config_api('{"limite_por_minuto": 300, "validade_foto_dias": 30}'::jsonb, 1) AS r`)).r;
      expect(r.api).toEqual({ limite_por_minuto: 300, max_por_pagina: 50, validade_foto_dias: 30, bloqueio_tentativas: 10 });
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE tenant_id = $1 AND acao = 'config_api'`, [T]);
      expect(log.d.antes.limite_por_minuto).toBe(60);
      expect(log.d.depois.limite_por_minuto).toBe(300);
    });
  });

  it("chave: 'wish_live_' + 32, SÓ o SHA-256 guardado, log sem hash (N11/D32); revogar = chave passa a ser inválida", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      const k = await chave(c, "ERP Principal");
      expect(k.chave).toMatch(/^wish_live_[A-Za-z0-9_-]{32}$/);
      expect(k.final).toBe(k.chave.slice(-4));
      const db = await um<{ hash: string; final: string }>(c, `SELECT hash, final FROM public.integracao_chaves WHERE id = $1`, [k.id]);
      expect(db).toEqual({ hash: sha(k.chave), final: k.final });
      const log = await um<{ d: any }>(c, `SELECT detalhe AS d FROM public.integracao_log WHERE acao = 'chave_criar' AND tenant_id = $1`, [T]);
      expect(log.d).toEqual({ nome: "ERP Principal", final: k.final });
      expect(JSON.stringify((await um<{ r: any }>(c, `SELECT public.integracao_chaves_listar() AS r`)).r)).not.toContain(db.hash);
      await c.query(`SELECT public.integracao_chave_revogar($1)`, [k.id]);
      expect((await ler(c, k.chave)).status).toBe("chave_invalida");
    });
  });
});

describe.skipIf(!hasDb || !LOCAL)("integracao — migration 6: as 2 fases da API", () => {
  it("ler → confirmar: entrega só integráveis, marca integrado (log 'integrado' com a chave); reler com incluir_integrados", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const k = await chave(c);
      const r1 = await ler(c, k.chave);
      expect(r1).toMatchObject({ status: "ok", modo: "normal", loja: { id: T }, proximo_cursor: null, validade_foto_dias: 7 });
      expect(r1.chaves_colunas).toEqual([...CAMPOS_PADRAO]);
      expect(r1.colunas[0]).toBe("Nome");
      const p = r1.produtos.find((x: any) => x.modelo_id === m.id);
      expect(p.linhas.map((l: any) => l.tipo)).toEqual(["produto", "variante", "variante"]);
      expect(p.linhas[0].valores).toHaveLength(17);
      expect(p.linhas[1].valores[1]).toBe(`${m.ref}-P`);
      expect((await um<{ s: string }>(c, `SELECT status AS s FROM public.integracao_acessos WHERE id = $1`, [r1.acesso_id])).s).toBe("reservado");
      const cf = await confirmar(c, r1);
      expect(cf.status).toBe("ok");
      expect(cf.confirmados.map((x: any) => x.modelo_id)).toContain(m.id);
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id])).e).toBe("integrado");
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_linhas WHERE modelo_id = $1 AND integrado_em IS NULL`, [m.id])).n).toBe("0");
      const log = await um<{ quem: string }>(c, `SELECT quem FROM public.integracao_log WHERE modelo_id = $1 AND acao = 'integrado'`, [m.id]);
      expect(log.quem).toBe(`Chave "ERP Teste" ····${k.final}`);
      const acc = await um<{ s: string; n: number }>(c, `SELECT status AS s, produtos_entregues AS n FROM public.integracao_acessos WHERE id = $1`, [r1.acesso_id]);
      expect(acc.s).toBe("ok");
      expect(acc.n).toBeGreaterThanOrEqual(1);
      expect((await ler(c, k.chave)).produtos.find((x: any) => x.modelo_id === m.id)).toBeUndefined();
      const r3 = await ler(c, k.chave, { incluir: true });
      const p3 = r3.produtos.find((x: any) => x.modelo_id === m.id);
      expect(p3.estado).toBe("integrado");
      expect(p3.integrado_em).not.toBeNull();
    });
  });

  it("paginação por PRODUTO (nunca parte um produto) e max_por_pagina respeitado", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await c.query(`UPDATE public.integracao_produtos SET estado = 'nao_integravel' WHERE tenant_id = $1`, [T]); // isola a loja de teste
      for (let i = 0; i < 3; i++) await marcar(c, (await modeloInterno(c)).id);
      const k = await chave(c);
      const a = await ler(c, k.chave, { limite: 2 });
      expect(a.produtos).toHaveLength(2);
      expect(a.pagina).toEqual({ limite: 2, maximo: 50 }); // D39 (P-89 A): tamanho usado + máximo da loja hoje
      expect(a.proximo_cursor).toEqual(expect.any(String));
      for (const p of a.produtos) expect(p.linhas).toHaveLength(3);
      const b = await ler(c, k.chave, { limite: 2, cursor: a.proximo_cursor });
      expect(b.produtos).toHaveLength(1);
      expect(b.proximo_cursor).toBeNull();
      await c.query(`UPDATE public.integracao_config SET max_por_pagina = 1 WHERE tenant_id = $1`, [T]);
      const d = await ler(c, k.chave, { limite: 50 });
      expect(d.produtos).toHaveLength(1);
      expect(d.pagina).toEqual({ limite: 1, maximo: 1 }); // pedido 50, cortado no máximo da loja
      expect((await ler(c, k.chave, { cursor: "%%%" })).status).toBe("parametro_invalido");
    });
  });

  it("limite POR CHAVE: N consultas em 60 s passam, a N+1 = limite_excedido (retry_after); o 429 não conta (V4/R7)", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      await c.query(`UPDATE public.integracao_config SET limite_por_minuto = 3 WHERE tenant_id = $1`, [T]);
      const k = await chave(c);
      for (let i = 0; i < 3; i++) expect((await ler(c, k.chave)).status).toBe("ok");
      const x = await ler(c, k.chave);
      expect(x.status).toBe("limite_excedido");
      expect(x.retry_after).toBeGreaterThan(0);
      expect((await ler(c, k.chave)).status).toBe("limite_excedido");
      const n = await um<{ a: string; g: string }>(c,
        `SELECT count(*) FILTER (WHERE agregado IS NULL) AS a, max(tentativas) FILTER (WHERE agregado IS NOT NULL) AS g
           FROM public.integracao_acessos WHERE chave_id = $1`, [k.id]);
      expect(n).toEqual({ a: "3", g: 2 });
    });
  });

  it("chave errada agrega por IP/minuto e BLOQUEIA chaves ERRADAS desse IP após N (D18/D19); a chave VÁLIDA do mesmo IP segue ok", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      await c.query(`UPDATE public.integracao_config SET bloqueio_tentativas = 3 WHERE tenant_id = $1`, [T]);
      const k = await chave(c);
      for (let i = 0; i < 3; i++) expect((await ler(c, `errada${i}`, { ip: "198.51.100.7" })).status).toBe("chave_invalida");
      const agg = await um<{ n: string; t: number }>(c,
        `SELECT count(*) AS n, max(tentativas) AS t FROM public.integracao_acessos WHERE agregado = 'inv:198.51.100.7'`);
      expect(agg).toEqual({ n: "1", t: 3 });
      const b = await ler(c, "errada9", { ip: "198.51.100.7" });
      expect(b.status).toBe("ip_bloqueado");
      expect(b.retry_after).toBeGreaterThan(0);
      expect((await ler(c, k.chave, { ip: "198.51.100.7" })).status).toBe("ok"); // D18: chave válida não é bloqueada por IP
      expect((await ler(c, "errada10", { ip: "198.51.100.8" })).status).toBe("chave_invalida");
    });
  });

  it("modo teste (P-82 A): só EXEMPLOS (nenhum modelo real), 2 páginas, registrado como teste e conta no limite; nada vira integrado", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      await c.query(`UPDATE public.integracao_config SET campos = $2::text[] WHERE tenant_id = $1`, [T, LAYOUT]);
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const k = await chave(c);
      const t1 = await ler(c, k.chave, { modo: "teste" });
      expect(t1.modo).toBe("teste");
      expect(t1.pagina).toEqual({ limite: 2, maximo: 50 }); // D39: no teste, páginas de exemplo de 2
      expect(t1.produtos.map((p: any) => p.modelo_id)).toEqual(["exemplo-0001", "exemplo-0002"]);
      expect(JSON.stringify(t1)).not.toContain(m.id);
      expect(t1.produtos[0].linhas[0].valores.at(-1)).toEqual(["exemplo"]);
      expect(t1.produtos[0].linhas[1].valores.at(-1)).toEqual([]);
      const t2 = await ler(c, k.chave, { modo: "teste", cursor: t1.proximo_cursor });
      expect(t2.produtos.map((p: any) => p.modelo_id)).toEqual(["exemplo-0003", "exemplo-0004"]);
      expect(t2.proximo_cursor).toBeNull();
      expect((await um<{ s: string }>(c, `SELECT status AS s FROM public.integracao_acessos WHERE id = $1`, [t1.acesso_id])).s).toBe("teste");
      const ac = (await um<{ r: any[] }>(c, `SELECT public.integracao_acessos_listar(10) AS r`)).r;
      expect(ac.find((a) => a.id === t1.acesso_id)).toMatchObject({ status: "teste", modo: "teste", exemplos: 2, chave: "ERP Teste" });
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id])).e).toBe("integravel");
      expect((await um<{ r: any }>(c, `SELECT public.integracao_exemplo() AS r`)).r.produtos[0].modelo_id).toBe("exemplo-0001");
      const antes = (await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_acessos WHERE chave_id = $1`, [k.id])).n;
      await c.query(`SELECT public.integracao_exemplo()`);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_acessos WHERE chave_id = $1`, [k.id])).n).toBe(antes);
    });
  });

  it("corrida voltar × entregar (§9): se o voltar vence, o confirmar NÃO marca; loja inativa = loja_inativa nas 2 fases", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await comoUsuario(c, U);
      await keywordsLoja(c, "k");
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const k = await chave(c);
      const r = await ler(c, k.chave);
      await c.query(`SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
      const cf = await confirmar(c, r);
      expect(cf.confirmados.map((x: any) => x.modelo_id)).not.toContain(m.id);
      expect((await um<{ e: string }>(c, `SELECT estado AS e FROM public.integracao_produtos WHERE modelo_id = $1`, [m.id])).e).toBe("nao_integravel");
      await c.query(`UPDATE public.tenants SET ativo = false WHERE id = $1`, [T]);
      expect((await ler(c, k.chave)).status).toBe("loja_inativa");
      expect((await confirmar(c, r)).status).toBe("loja_inativa");
    });
  });

  it("limpeza de 90 dias: só da loja pedida, só quem NÃO entregou (acessos que entregaram são permanentes — P-64 A)", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await c.query(`INSERT INTO public.integracao_acessos (tenant_id, ip, status, criado_em, produtos_entregues)
                     VALUES ($1, 'x', 'ok', now() - interval '100 days', 0), ($1, 'x', 'ok', now() - interval '100 days', 5),
                            ($1, 'x', 'ok', now() - interval '10 days', 0)`, [T]);
      expect((await um<{ n: number }>(c, `SELECT public._integracao_limpar($1) AS n`, [T])).n).toBe(1);
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_acessos WHERE tenant_id = $1 AND ip = 'x'`, [T])).n).toBe("2");
    });
  });

  it("ACL: as 3 da rota só p/ service_role; acessos/chaves/exemplo recusam não-super", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      for (const f of ["_integracao_ler(text,boolean,text,integer,text,text)", "_integracao_confirmar(uuid,uuid,jsonb)", "_integracao_limpar(uuid)"]) {
        const a = await um<any>(c, `SELECT has_function_privilege('service_role', 'public.${f}', 'EXECUTE') AS s,
          has_function_privilege('authenticated', 'public.${f}', 'EXECUTE') AS au, has_function_privilege('anon', 'public.${f}', 'EXECUTE') AS an,
          has_function_privilege('public', 'public.${f}', 'EXECUTE') AS p`);
        expect(a, f).toEqual({ s: true, au: false, an: false, p: false });
      }
      await comoUsuarioCom(c, "00000000-0000-4000-8000-00000000ce32", [["integracao", true, true]], { tenantAdmin: true });
      for (const sql of ["SELECT public.integracao_acessos_listar(10)", "SELECT public.integracao_chaves_listar()", "SELECT public.integracao_exemplo()",
        "SELECT public.integracao_chave_criar('x')"]) {
        expect(await msg(c, sql, [])).toBe("42501 Só o super admin pode fazer isto.");
      }
    });
  });

  it.skipIf(!MIG_TXN)("inverso 6 desfaz a 6 (13 funções somem)", async () => {
    await withTx(async (c) => {
      await prepara(c, 6);
      await aplica(c, INVERSOS[5]);
      const r = await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN (
        'integracao_salvar_config','integracao_salvar_config_api','integracao_chaves_listar','integracao_chave_criar','integracao_chave_revogar',
        'integracao_acessos_listar','integracao_exemplo','_integracao_exemplo','_integracao_colunas','_integracao_valores','_integracao_ler',
        '_integracao_confirmar','_integracao_limpar')`);
      expect(r.n).toBe("0");
    });
  });
});
