/**
 * Integração › Produtos › "Gerar JSON" (entrega MANUAL = integração; plano .superpowers/sdd/2026-10-04-gerar-json/plan.md,
 * §3 T1 + RULINGS §8). Migration 20261102100000 (2 RPCs NOVAS `integracao_gerar_json_ler`/`_confirmar` + CHECK de modo de
 * integracao_acessos ampliado com 'manual'; nenhuma função existente redefinida) e os 2 inversos (_down neutraliza,
 * _down_drop separado).
 * SÓ na cópia local (exigeBancoLocal); txn revertida (withTx): NADA é gravado. Funciona com a cópia NOS DOIS estados: sem a
 * migration (aplica o arquivo DENTRO da txn — sem BEGIN/COMMIT e sem as 2 travas SET LOCAL, NUNCA `\i`) ou com ela já aplicada
 * (idempotente). O ALTER TABLE do CHECK pega AccessExclusive em integracao_acessos até o fim de cada teste.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash, randomUUID } from "node:crypto";
import { hasDb, withTx, comoUsuario, semJwt, um } from "./db";
import { exigeBancoLocal } from "./mig-txn";
import { LOCAL, MARCAS, T, U, aplica, camposLoja, comoUsuarioCom, keywordsLoja, layoutVivo, modeloInterno, padraoVivo } from "./integracao-helpers";

const MIG = "supabase/migrations/20261102100000_integracao_gerar_json.sql";
const INV = "supabase/rollback/20261102100000_integracao_gerar_json_down.sql";
const INV_DROP = "supabase/rollback/20261102100000_integracao_gerar_json_down_drop.sql";
const FN_LER = "public.integracao_gerar_json_ler(uuid[],uuid)";
const FN_CONF = "public.integracao_gerar_json_confirmar(uuid,jsonb)";
const MD5 = {
  lerIda: "4cb3ccc80a10701e66d0ce9fb1e585ad",
  confIda: "e53973ef946a10dded322143f036508d",
  lerNeutra: "4b96da8c8d2b529d4fbcf99e52c1dc9f",
  confNeutra: "78ccc308fdfc2456b2fee148d0c61287",
} as const;
/** Dependências que a migration fixa (nenhuma pode mudar). */
const DEPS: Record<string, string> = {
  "public._integracao_ler(text,boolean,text,integer,text,text)": "1ac58b343e992fefe0062dac512e11eb",
  "public._integracao_confirmar(uuid,uuid,jsonb)": "ede617dcdca6fb562a63ed06c31b9914",
  "public._integracao_valores(integracao_linhas,text[],text[])": "7d094ada6982728a4dfdc96077d51367",
  "public._integracao_colunas(text[])": "6bc153aa8d1c205a927ed19b29c7dcda",
  "public._integracao_cfg(uuid)": "db865044a6b9f875c8c920b82f6b9974",
  "public._integracao_exige(boolean)": "8b908a5cf45d86e636a31f6284c5193e",
  "public._integracao_logar(uuid,text,uuid,jsonb,text)": "52b347ee02742906c19765c46e8cfec4",
  "public._integracao_quem()": "e5acdaffc65808965e4b295ae53406f2",
  "public._pode_ver_custos()": "dec16016064c55ab101c67e82e715681",
};
const CHK_ANTES = "CHECK ((modo = ANY (ARRAY['normal'::text, 'teste'::text])))";
const CHK_DEPOIS = "CHECK ((modo = ANY (ARRAY['normal'::text, 'teste'::text, 'manual'::text])))";
const OUTRA_LOJA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // uuid de outra loja (só como parâmetro _loja)
const SEM_EDITAR = "42501 Sem permissão para editar a Integração.";
const PARAM_INVALIDO = { status: "parametro_invalido", confirmados: [] };
// usuários de teste (criados na txn)
const U_VER = "00000000-0000-4000-8000-00000000a501"; // integracao só VER
const U_TA = "00000000-0000-4000-8000-00000000a502"; // tenant_admin SEM a permissão própria
const U_X = "00000000-0000-4000-8000-00000000a503"; // integracao editar + ver custos (outro usuário da mesma loja)
const U_Y = "00000000-0000-4000-8000-00000000a504"; // integracao editar, SEM ver custos
const U_Z = "00000000-0000-4000-8000-00000000a505"; // integracao editar + ver custos (perde entre as fases)

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
let seq = 0;
const ipNovo = (): string => `198.51.100.${(Date.now() + seq++) % 250}-gj-${seq}`;

async function md5Vivo(c: Client, fn: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [fn])).m;
}
async function prepara(c: Client): Promise<void> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  for (const m of MARCAS) {
    if (!(await um<{ ok: boolean }>(c, `SELECT ${m} AS ok`)).ok) throw new Error("Integração 1..6 ausente na cópia");
  }
  if (!(await um<{ ok: boolean }>(c,
    "SELECT to_regprocedure('public._integracao_ler_loja(text,uuid,boolean,text,integer,text,text)') IS NOT NULL AS ok")).ok) {
    throw new Error("Release A2 ausente na cópia");
  }
  await aplica(c, MIG);
  await comoUsuario(c, U);
  await keywordsLoja(c, "k");
}
async function marcar(c: Client, id: string): Promise<void> {
  const a = (await um<{ r: any }>(c, `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`, [id])).r.produtos[0].assinatura;
  await c.query(`SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`, [id, a]);
}
async function gerarLer(c: Client, ids: (string | null)[] | null, loja: string | null = T): Promise<any> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_gerar_json_ler($1::uuid[], $2::uuid) AS r`, [ids, loja])).r;
}
async function gerarConf(c: Client, acesso: string | null, entrega: unknown): Promise<any> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_gerar_json_confirmar($1::uuid, $2::jsonb) AS r`,
    [acesso, entrega === null ? null : JSON.stringify(entrega)])).r;
}
const entregaDe = (r: any, extra: Record<string, unknown> = {}) => ({
  produtos: r.produtos.map((p: any) => ({ modelo_id: p.modelo_id, assinatura: p.assinatura })),
  fotos_descartadas: 0, fotos_ausentes: 0, ...extra,
});
async function falha(c: Client, fn: () => Promise<unknown>): Promise<string> {
  await c.query("SAVEPOINT gj_falha");
  try {
    await fn();
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT gj_falha");
    return `${e.code} ${e.message}`;
  }
  await c.query("RELEASE SAVEPOINT gj_falha");
  return "PASSOU";
}
async function ip(c: Client, id: string): Promise<any> {
  return um(c, `SELECT estado, integrado_em, to_jsonb(integrado_em) AS integrado_em_j, integrado_chave_id, rev, assinatura, campos
                  FROM public.integracao_produtos WHERE modelo_id = $1`, [id]);
}
async function acesso(c: Client, id: string): Promise<any> {
  return um(c, `SELECT * FROM public.integracao_acessos WHERE id = $1`, [id]);
}
async function nManuais(c: Client): Promise<number> {
  return Number((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_acessos WHERE modo = 'manual'`)).n);
}
async function logsIntegrado(c: Client, id: string): Promise<any[]> {
  return (await c.query(`SELECT usuario_id, quem, detalhe FROM public.integracao_log
                          WHERE modelo_id = $1 AND acao = 'integrado' ORDER BY criado_em, id`, [id])).rows;
}
async function chave(c: Client, nome = "ERP GJ"): Promise<{ id: string; chave: string; final: string }> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_chave_criar($1) AS r`, [nome])).r;
}
async function lerLoja(c: Client, k: string, o: { incluir?: boolean; cursor?: string | null; limite?: number } = {}): Promise<any> {
  return (await um<{ r: any }>(c, `SELECT public._integracao_ler_loja($1, $2::uuid, $3, $4, $5, 'normal', $6) AS r`,
    [sha(k), T, o.incluir ?? false, o.cursor ?? null, o.limite ?? 500, ipNovo()])).r;
}
/** Percorre as páginas da API (keyset) até achar o produto; null = não está em página nenhuma. */
async function apiAcha(c: Client, k: string, id: string, incluir: boolean): Promise<{ r: any; p: any } | null> {
  let cursor: string | null = null;
  for (let i = 0; i < 50; i++) {
    const r = await lerLoja(c, k, { incluir, cursor });
    expect(r.status).toBe("ok");
    const p = r.produtos.find((x: any) => x.modelo_id === id);
    if (p) return { r, p };
    if (!r.proximo_cursor) return null;
    cursor = r.proximo_cursor;
  }
  throw new Error("paginas demais na API");
}
/** Por linha: tipo, loja_nome e o mapa chave→valor SÓ nas chaves do retrato do produto. */
function linhasPorChave(r: any, p: any, campos: string[]) {
  return p.linhas.map((l: any) => ({
    tipo: l.tipo,
    loja_nome: l.loja_nome,
    v: Object.fromEntries((r.chaves_colunas as string[]).map((k, i) => [k, l.valores[i]]).filter(([k]) => campos.includes(k as string))),
  }));
}
async function outraLojaId(c: Client): Promise<string> {
  return (await um<{ id: string }>(c, `SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1`, [T])).id;
}
async function cfgLoja(c: Client, set: string): Promise<void> {
  await c.query(`INSERT INTO public.integracao_config (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [T]);
  await c.query(`UPDATE public.integracao_config SET ${set} WHERE tenant_id = $1`, [T]);
}
async function teto(c: Client): Promise<number> {
  return Math.min(100, (await um<{ m: number }>(c, `SELECT (public._integracao_cfg($1)).max_por_pagina AS m`, [T])).m);
}

describe.skipIf(!hasDb || !LOCAL)("integracao — Gerar JSON (entrega manual = integração)", () => {
  it("1. integrável → integrado: reserva manual do usuário; confirmar integra, linhas com integrado_em, Log com a PESSOA, acesso ok", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await camposLoja(c, await padraoVivo(c));
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const antes = await ip(c, m.id);
      const r = await gerarLer(c, [m.id]);
      expect(r).toMatchObject({ status: "ok", modo: "manual", chave_id: null, tenant_id: T, loja: { id: T }, fora: [],
        proximo_cursor: null, pagina: { limite: 1, maximo: await teto(c) } });
      expect(typeof r.loja.nome).toBe("string");
      expect(r.validade_foto_dias).toBe((await um<{ v: number }>(c, `SELECT (public._integracao_cfg($1)).validade_foto_dias AS v`, [T])).v);
      expect(r.produtos.map((p: any) => p.modelo_id)).toEqual([m.id]);
      expect(r.produtos[0]).toMatchObject({ estado: "integravel", assinatura: antes.assinatura, integrado_em: null });
      expect(r.produtos[0].linhas.map((l: any) => l.tipo)).toEqual(["produto", "variante", "variante"]);
      expect(r.chaves_colunas).toEqual([...(await padraoVivo(c))]);
      const a0 = await acesso(c, r.acesso_id);
      const quem = (await um<{ q: string }>(c, `SELECT public._integracao_quem() AS q`)).q;
      expect(a0).toMatchObject({ tenant_id: T, chave_id: null, ip: null, modo: "manual", status: "reservado", agregado: null,
        detalhe: { usuario_id: U, quem, pedidos: 1, produtos: [m.id] } });
      const cf = await gerarConf(c, r.acesso_id, entregaDe(r));
      expect(cf).toMatchObject({ status: "ok", novos: 1, relidos: 0 });
      expect(cf.confirmados).toHaveLength(1);
      expect(cf.confirmados[0].modelo_id).toBe(m.id);
      const depois = await ip(c, m.id);
      expect(depois).toMatchObject({ estado: "integrado", integrado_chave_id: null, rev: antes.rev + 1 });
      expect(depois.integrado_em_j).toBe(cf.confirmados[0].integrado_em);
      const ln = await um<{ n: string; vazias: string }>(c, `SELECT count(*) AS n, count(*) FILTER (WHERE integrado_em IS NULL) AS vazias
                                                               FROM public.integracao_linhas WHERE modelo_id = $1`, [m.id]);
      expect(ln).toEqual({ n: "3", vazias: "0" });
      const logs = await logsIntegrado(c, m.id);
      expect(logs).toEqual([{ usuario_id: U, quem, detalhe: { manual: true, acesso_id: r.acesso_id, novo: true } }]);
      expect(quem).toMatch(/\(super admin\)$/);
      const a1 = await acesso(c, r.acesso_id);
      expect(a1).toMatchObject({ status: "ok", produtos_entregues: 1, linhas: 3,
        detalhe: { usuario_id: U, quem, pedidos: 1, produtos: [m.id], novos: 1, relidos: 0, fotos_descartadas: 0, fotos_ausentes: 0,
          confirmados: [m.id] } });
      expect(a1.concluido_em).not.toBeNull();
      // 2ª confirmação da MESMA reserva (retry): parametro_invalido, nada muda
      expect(await gerarConf(c, r.acesso_id, entregaDe(r))).toEqual(PARAM_INVALIDO);
      expect((await ip(c, m.id)).rev).toBe(antes.rev + 1);
      expect(await logsIntegrado(c, m.id)).toHaveLength(1);
    });
  });

  it("2. anti-drift com a API: para cada produto, valores por chave (só as do retrato), tipo e loja_nome das linhas IGUAIS aos de _integracao_ler_loja", async () => {
    await withTx(async (c) => {
      await prepara(c);
      // p: todos os campos do layout (inclusive Foto — lista de caminhos); q: sem preco_custo nem foto (união com null)
      await camposLoja(c, await layoutVivo(c));
      const p = await modeloInterno(c, { fotos: [`${T}/fotos_modelo/gj-a.jpg`, `${T}/fotos_modelo/gj-b.jpg`] });
      await marcar(c, p.id);
      await camposLoja(c, (await padraoVivo(c)).filter((x) => x !== "preco_custo"));
      const q = await modeloInterno(c);
      await marcar(c, q.id);
      const g = await gerarLer(c, [p.id, q.id]);
      expect(g.produtos.map((x: any) => x.modelo_id).sort()).toEqual([p.id, q.id].sort());
      expect(g.chaves_colunas).toEqual([...(await layoutVivo(c))]); // união na ordem do layout
      const k = await chave(c);
      for (const id of [p.id, q.id]) {
        const api = await apiAcha(c, k.chave, id, true);
        expect(api).not.toBeNull();
        const gp = g.produtos.find((x: any) => x.modelo_id === id);
        const campos = (await ip(c, id)).campos as string[];
        expect(linhasPorChave(g, gp, campos)).toEqual(linhasPorChave(api!.r, api!.p, campos));
        // formato dos objetos (M3): chaves do produto e de cada linha (produto/variante) = as da API
        expect(Object.keys(gp).sort()).toEqual(Object.keys(api!.p).sort());
        expect(gp.linhas.length).toBe(api!.p.linhas.length);
        gp.linhas.forEach((l: any, i: number) => expect(Object.keys(l).sort()).toEqual(Object.keys(api!.p.linhas[i]).sort()));
        // chaves de topo = as da API, mais `fora`
        expect(Object.keys(g).filter((k2) => k2 !== "fora").sort()).toEqual(Object.keys(api!.r).sort());
        expect({ e: gp.estado, a: gp.assinatura, i: gp.integrado_em }).toEqual({ e: api!.p.estado, a: api!.p.assinatura, i: api!.p.integrado_em });
        // fora do retrato do produto = null (D6), como na API
        for (const [i, k2] of (g.chaves_colunas as string[]).entries()) {
          if (!campos.includes(k2)) for (const l of gp.linhas) expect(l.valores[i]).toBeNull();
        }
      }
      const gp = g.produtos.find((x: any) => x.modelo_id === p.id);
      expect(gp.linhas[0].valores[(g.chaves_colunas as string[]).indexOf("foto")]).toEqual([`${T}/fotos_modelo/gj-a.jpg`, `${T}/fotos_modelo/gj-b.jpg`]);
    });
  });

  it("3. depois da entrega manual a API não entrega como novo; com incluir_integrados traz o integrado_em manual; _integracao_confirmar conta relido sem Log novo", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const r = await gerarLer(c, [m.id]);
      const cf = await gerarConf(c, r.acesso_id, entregaDe(r));
      expect(cf.novos).toBe(1);
      const k = await chave(c);
      expect(await apiAcha(c, k.chave, m.id, false)).toBeNull();
      const api = await apiAcha(c, k.chave, m.id, true);
      expect(api!.p.estado).toBe("integrado");
      expect(api!.p.integrado_em).toBe(cf.confirmados[0].integrado_em);
      const entrega = { produtos: [{ modelo_id: m.id, assinatura: api!.p.assinatura }], fotos_descartadas: 0, fotos_ausentes: 0 };
      const ca = (await um<{ r: any }>(c, `SELECT public._integracao_confirmar($1, $2, $3::jsonb) AS r`,
        [api!.r.chave_id, api!.r.acesso_id, JSON.stringify(entrega)])).r;
      expect(ca.status).toBe("ok");
      expect(ca.confirmados.map((x: any) => x.modelo_id)).toEqual([m.id]);
      expect((await acesso(c, api!.r.acesso_id)).detalhe).toMatchObject({ novos: 0, relidos: 1 });
      expect(await logsIntegrado(c, m.id)).toHaveLength(1);
      expect((await ip(c, m.id)).integrado_chave_id).toBeNull();
    });
  });

  it("4. não integrável (sem linha ou voltado) e integrável reprovado ficam no `fora`; só não elegíveis = sem reserva; integrado reprovado entra", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const semLinha = await modeloInterno(c, { nome: "AAA GJ sem linha" });
      const voltado = await modeloInterno(c, { nome: "BBB GJ voltado" });
      await marcar(c, voltado.id);
      await c.query(`SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [voltado.id]);
      const ok = await modeloInterno(c);
      await marcar(c, ok.id);
      const r = await gerarLer(c, [semLinha.id, ok.id, voltado.id]);
      expect(r.produtos.map((p: any) => p.modelo_id)).toEqual([ok.id]);
      expect(r.fora).toEqual([
        { modelo_id: semLinha.id, nome: "AAA GJ sem linha", ref: semLinha.ref, motivo: "nao_integravel" },
        { modelo_id: voltado.id, nome: "BBB GJ voltado", ref: voltado.ref, motivo: "nao_integravel" },
      ]);
      expect((await acesso(c, r.acesso_id)).detalhe.produtos).toEqual([ok.id]);
      expect(await ip(c, semLinha.id)).toBeUndefined();
      expect((await ip(c, voltado.id)).estado).toBe("nao_integravel");
      // só não elegíveis: nada reservado
      const n0 = await nManuais(c);
      const v = await gerarLer(c, [semLinha.id, voltado.id]);
      expect(v).toMatchObject({ status: "ok", modo: "manual", acesso_id: null, chave_id: null, produtos: [], colunas: [],
        chaves_colunas: [], proximo_cursor: null, pagina: { limite: 0, maximo: await teto(c) } });
      expect(v.fora).toHaveLength(2);
      expect(await nManuais(c)).toBe(n0);
      // integrável reprovado (Planejamento OU Desenvolvimento, mesma expressão do _integracao_ler) — gravado SEM claims
      const rep1 = await modeloInterno(c);
      const rep2 = await modeloInterno(c);
      await marcar(c, rep1.id);
      await marcar(c, rep2.id);
      await semJwt(c, async () => {
        await c.query(`UPDATE public.modelos SET status_planejamento = 'reprovado' WHERE id = $1`, [rep1.id]);
        await c.query(`UPDATE public.modelos SET status_desenvolvimento = ' Reprovado ' WHERE id = $1`, [rep2.id]);
      });
      const rr = await gerarLer(c, [rep1.id, rep2.id]);
      expect(rr.acesso_id).toBeNull();
      expect(rr.fora.map((f: any) => [f.modelo_id, f.motivo]).sort()).toEqual([[rep1.id, "reprovado"], [rep2.id, "reprovado"]].sort());
      expect((await ip(c, rep1.id)).estado).toBe("integravel");
      // integrado reprovado CONTINUA entrando (reexportação), como na API
      const cf = await gerarConf(c, r.acesso_id, entregaDe(r));
      expect(cf.novos).toBe(1);
      await semJwt(c, () => c.query(`UPDATE public.modelos SET status_planejamento = 'reprovado' WHERE id = $1`, [ok.id]));
      const ri = await gerarLer(c, [ok.id]);
      expect(ri.produtos.map((p: any) => [p.modelo_id, p.estado])).toEqual([[ok.id, "integrado"]]);
      expect(ri.fora).toEqual([]);
    });
  });

  it("5. permissão: só VER a Integração = 42501; tenant_admin SEM a permissão própria = 42501 (P-107 A); anon sem EXECUTE", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const n0 = await nManuais(c); // base: a cópia é compartilhada (a T3 deixa acessos manuais)
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      await comoUsuarioCom(c, U_VER, [["integracao", true, false]]);
      expect(await falha(c, () => gerarLer(c, [m.id]))).toBe(SEM_EDITAR);
      expect(await falha(c, () => gerarConf(c, randomUUID(), { produtos: [] }))).toBe(SEM_EDITAR);
      await comoUsuarioCom(c, U_TA, [], { tenantAdmin: true });
      expect(await falha(c, () => gerarLer(c, [m.id]))).toBe(SEM_EDITAR);
      expect(await falha(c, () => gerarConf(c, randomUUID(), { produtos: [] }))).toBe(SEM_EDITAR);
      for (const fn of [FN_LER, FN_CONF]) {
        const acl = await um<{ anon: boolean; auth: boolean }>(c,
          `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth`, [fn]);
        expect(acl).toEqual({ anon: false, auth: true });
      }
      await comoUsuario(c, U);
      const e = await falha(c, async () => {
        await c.query("SET LOCAL ROLE anon");
        await gerarLer(c, [m.id]);
      });
      expect(e).toMatch(/^42501 permission denied for function integracao_gerar_json_ler/);
      expect(await nManuais(c)).toBe(n0);
      expect((await ip(c, m.id)).estado).toBe("integravel");
    });
  });

  it("6. outra loja: id de outra loja ou _loja diferente = P0001 sem reservar; confirmar com reserva da API, de outra loja, de outro usuário, já ok ou velha = parametro_invalido", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const ok = await modeloInterno(c);
      const ok2 = await modeloInterno(c);
      await marcar(c, ok.id);
      await marcar(c, ok2.id);
      const n0 = await nManuais(c);
      const deOutra = (await um<{ id: string } | undefined>(c, `SELECT id FROM public.modelos WHERE tenant_id <> $1 ORDER BY id LIMIT 1`, [T]));
      if (deOutra) {
        expect(await falha(c, () => gerarLer(c, [ok.id, deOutra.id]))).toBe("P0001 gerar_json_loja: produto nao encontrado nesta loja");
      }
      expect(await falha(c, () => gerarLer(c, [ok.id, randomUUID()]))).toBe("P0001 gerar_json_loja: produto nao encontrado nesta loja");
      expect(await falha(c, () => gerarLer(c, [ok.id], OUTRA_LOJA))).toBe("P0001 gerar_json_loja_mudou: loja ativa diferente");
      expect(await falha(c, () => gerarLer(c, [ok.id], null))).toBe("P0001 gerar_json_loja_mudou: loja ativa diferente");
      expect(await nManuais(c)).toBe(n0);
      const ass = (await ip(c, ok.id)).assinatura;
      const entrega = { produtos: [{ modelo_id: ok.id, assinatura: ass }], fotos_descartadas: 0, fotos_ausentes: 0 };
      // (a) reserva da API (chave_id não nulo)
      const k = await chave(c);
      const api = await lerLoja(c, k.chave);
      expect(api.status).toBe("ok");
      expect(await gerarConf(c, api.acesso_id, entrega)).toEqual(PARAM_INVALIDO);
      expect((await acesso(c, api.acesso_id)).status).toBe("reservado");
      // (b) reserva manual de OUTRA loja (mesmo usuário no detalhe)
      const outra = await outraLojaId(c);
      const idOutra = (await um<{ id: string }>(c,
        `INSERT INTO public.integracao_acessos (tenant_id, chave_id, ip, modo, status, detalhe)
         VALUES ($1, NULL, NULL, 'manual', 'reservado', jsonb_build_object('usuario_id', $2::text, 'produtos', jsonb_build_array($3::text)))
         RETURNING id`, [outra, U, ok.id])).id;
      expect(await gerarConf(c, idOutra, entrega)).toEqual(PARAM_INVALIDO);
      expect((await acesso(c, idOutra)).status).toBe("reservado");
      // (c) reserva de OUTRO usuário da mesma loja
      await comoUsuarioCom(c, U_X, [["integracao", true, true], ["criacao_planejamento:custos", true, false]]);
      const rx = await gerarLer(c, [ok.id]);
      expect(rx.acesso_id).not.toBeNull();
      await comoUsuario(c, U);
      expect(await gerarConf(c, rx.acesso_id, entregaDe(rx))).toEqual(PARAM_INVALIDO);
      expect((await acesso(c, rx.acesso_id)).status).toBe("reservado");
      // (e) reserva VELHA (> 10 min)
      const rv = await gerarLer(c, [ok2.id]);
      await c.query(`UPDATE public.integracao_acessos SET criado_em = now() - interval '11 minutes' WHERE id = $1`, [rv.acesso_id]);
      expect(await gerarConf(c, rv.acesso_id, entregaDe(rv))).toEqual(PARAM_INVALIDO);
      expect((await acesso(c, rv.acesso_id)).status).toBe("reservado");
      expect((await ip(c, ok.id)).estado).toBe("integravel");
      expect((await ip(c, ok2.id)).estado).toBe("integravel");
      expect(await logsIntegrado(c, ok.id)).toHaveLength(0);
      // (d) já ok: a 1ª confirma, a 2ª não
      const r = await gerarLer(c, [ok.id]);
      expect((await gerarConf(c, r.acesso_id, entregaDe(r))).novos).toBe(1);
      expect(await gerarConf(c, r.acesso_id, entregaDe(r))).toEqual(PARAM_INVALIDO);
      // acesso inexistente / nulo
      expect(await gerarConf(c, randomUUID(), entrega)).toEqual(PARAM_INVALIDO);
      expect(await gerarConf(c, null, entrega)).toEqual(PARAM_INVALIDO);
    });
  });

  it("7. custo escondido (P-75 A por produto): sem ver custos o produto com preco_custo fica fora; sem o campo entra; quem vê custos recebe o valor; custo perdido entre as fases = não confirma", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const padrao = await padraoVivo(c);
      expect(padrao).toContain("preco_custo");
      await camposLoja(c, padrao);
      const pc = await modeloInterno(c);
      const pc2 = await modeloInterno(c);
      const pc3 = await modeloInterno(c);
      const pc4 = await modeloInterno(c);
      await marcar(c, pc.id);
      await marcar(c, pc2.id);
      await marcar(c, pc3.id);
      await marcar(c, pc4.id);
      // pc4 já INTEGRADO (por quem vê custos) — reexportar com preco_custo também exige ver custos
      const r4 = await gerarLer(c, [pc4.id]);
      expect((await gerarConf(c, r4.acesso_id, entregaDe(r4))).novos).toBe(1);
      await camposLoja(c, padrao.filter((x) => x !== "preco_custo"));
      const sc = await modeloInterno(c);
      await marcar(c, sc.id);
      // sem ver custos
      await comoUsuarioCom(c, U_Y, [["integracao", true, true]]);
      expect((await um<{ v: boolean }>(c, `SELECT public._pode_ver_custos() AS v`)).v).toBe(false);
      const ry = await gerarLer(c, [pc.id, sc.id]);
      expect(ry.produtos.map((p: any) => p.modelo_id)).toEqual([sc.id]);
      expect(ry.fora).toEqual([{ modelo_id: pc.id, nome: expect.any(String), ref: pc.ref, motivo: "sem_custo" }]);
      expect(ry.chaves_colunas).not.toContain("preco_custo");
      const cy = await gerarConf(c, ry.acesso_id, { ...entregaDe(ry), produtos: [...entregaDe(ry).produtos,
        { modelo_id: pc.id, assinatura: (await ip(c, pc.id)).assinatura }] });
      expect(cy).toMatchObject({ status: "ok", novos: 1, relidos: 0 });
      expect(cy.confirmados.map((x: any) => x.modelo_id)).toEqual([sc.id]);
      expect((await ip(c, sc.id)).estado).toBe("integrado");
      expect((await ip(c, pc.id)).estado).toBe("integravel");
      const ri = await gerarLer(c, [pc4.id]);
      expect(ri).toMatchObject({ acesso_id: null, produtos: [], fora: [{ modelo_id: pc4.id, motivo: "sem_custo" }] });
      expect((await ip(c, pc4.id)).estado).toBe("integrado");
      // quem vê custos (super): o valor = integracao_linhas.preco_custo
      await comoUsuario(c, U);
      const ru = await gerarLer(c, [pc2.id]);
      const i = (ru.chaves_colunas as string[]).indexOf("preco_custo");
      expect(i).toBeGreaterThanOrEqual(0);
      const custos = (await c.query(`SELECT preco_custo FROM public.integracao_linhas WHERE modelo_id = $1 ORDER BY ordem`, [pc2.id])).rows
        .map((x: any) => x.preco_custo);
      expect(custos[0]).not.toBeNull();
      expect(ru.produtos[0].linhas.map((l: any) => l.valores[i])).toEqual(custos);
      // custo perdido ENTRE as fases
      await comoUsuarioCom(c, U_Z, [["integracao", true, true], ["criacao_planejamento:custos", true, false]]);
      const rz = await gerarLer(c, [pc3.id]);
      expect(rz.produtos.map((p: any) => p.modelo_id)).toEqual([pc3.id]);
      await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1 AND pagina = 'criacao_planejamento:custos'`, [U_Z]);
      expect((await um<{ v: boolean }>(c, `SELECT public._pode_ver_custos() AS v`)).v).toBe(false);
      const cz = await gerarConf(c, rz.acesso_id, entregaDe(rz));
      expect(cz).toMatchObject({ status: "ok", confirmados: [], novos: 0, relidos: 0 });
      expect((await ip(c, pc3.id)).estado).toBe("integravel");
      expect(await logsIntegrado(c, pc3.id)).toHaveLength(0);
    });
  });

  it("8. reexportação de integrado: entra no arquivo com o integrado_em ORIGINAL; estado/rev/linhas não mudam; Log 'integrado' com reexportacao", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const r1 = await gerarLer(c, [m.id]);
      expect((await gerarConf(c, r1.acesso_id, entregaDe(r1))).novos).toBe(1);
      // o "original" fica 1 dia antes (dentro da txn o now() é o mesmo)
      await c.query(`UPDATE public.integracao_produtos SET integrado_em = integrado_em - interval '1 day' WHERE modelo_id = $1`, [m.id]);
      await c.query(`UPDATE public.integracao_linhas SET integrado_em = integrado_em - interval '1 day' WHERE modelo_id = $1`, [m.id]);
      const antes = await ip(c, m.id);
      const linhasAntes = (await c.query(`SELECT id, integrado_em FROM public.integracao_linhas WHERE modelo_id = $1 ORDER BY ordem`, [m.id])).rows;
      const r2 = await gerarLer(c, [m.id]);
      expect(r2.produtos.map((p: any) => [p.modelo_id, p.estado, p.integrado_em])).toEqual([[m.id, "integrado", antes.integrado_em_j]]);
      const cf = await gerarConf(c, r2.acesso_id, entregaDe(r2));
      expect(cf).toMatchObject({ status: "ok", novos: 0, relidos: 1 });
      expect(cf.confirmados).toEqual([{ modelo_id: m.id, integrado_em: antes.integrado_em_j }]);
      expect(await ip(c, m.id)).toEqual(antes);
      expect((await c.query(`SELECT id, integrado_em FROM public.integracao_linhas WHERE modelo_id = $1 ORDER BY ordem`, [m.id])).rows).toEqual(linhasAntes);
      const logs = await logsIntegrado(c, m.id);
      expect(logs).toHaveLength(2);
      // mesma txn = mesmo criado_em: acha cada registro pelo acesso_id
      expect(logs.find((l) => l.detalhe.acesso_id === r1.acesso_id)).toMatchObject({ usuario_id: U, detalhe: { manual: true, novo: true } });
      expect(logs.find((l) => l.detalhe.acesso_id === r2.acesso_id))
        .toEqual({ usuario_id: U, quem: expect.any(String), detalhe: { manual: true, acesso_id: r2.acesso_id, reexportacao: true } });
      expect(await acesso(c, r2.acesso_id)).toMatchObject({ status: "ok", produtos_entregues: 1, detalhe: { novos: 0, relidos: 1 } });
    });
  });

  it("9. limites: itens (0, >teto, repetido, NULL, 2D) = P0001; teto = menor entre 100 e o máximo por página (Ruling Q4); limite por minuto só das gerações manuais", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const a = await modeloInterno(c);
      await marcar(c, a.id);
      const nao = await modeloInterno(c);
      const n0 = await nManuais(c); // base: a cópia é compartilhada (a T3 deixa acessos manuais)
      await cfgLoja(c, "max_por_pagina = 500");
      const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
      expect(await falha(c, () => gerarLer(c, ids(101)))).toBe("P0001 gerar_json_itens: envie de 1 a 100 produtos");
      expect(await falha(c, () => gerarLer(c, ids(100)))).toBe("P0001 gerar_json_loja: produto nao encontrado nesta loja"); // 100 passa no teto
      await cfgLoja(c, "max_por_pagina = 2");
      expect(await falha(c, () => gerarLer(c, ids(3)))).toBe("P0001 gerar_json_itens: envie de 1 a 2 produtos");
      expect(await falha(c, () => gerarLer(c, []))).toBe("P0001 gerar_json_itens: envie de 1 a 2 produtos");
      expect(await falha(c, () => gerarLer(c, null))).toBe("P0001 gerar_json_itens: envie de 1 a 2 produtos");
      expect(await falha(c, () => gerarLer(c, [a.id, null]))).toBe("P0001 gerar_json_itens: envie de 1 a 2 produtos");
      expect(await falha(c, () => gerarLer(c, [a.id, a.id]))).toBe("P0001 gerar_json_itens: produto repetido");
      expect(await falha(c, () => um(c, `SELECT public.integracao_gerar_json_ler(ARRAY[ARRAY[$1::uuid]], $2::uuid)`, [a.id, T])))
        .toBe("P0001 gerar_json_itens: envie de 1 a 2 produtos");
      expect(await nManuais(c)).toBe(n0);
      // limite por minuto = (gerações manuais da loja nos últimos 60 s) + 1: sobra exatamente 1 vaga; geração sem elegível NÃO
      // conta (não reserva). Relativo ao que já existe na cópia compartilhada.
      const recentes = Number((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_acessos WHERE tenant_id = $1
        AND modo = 'manual' AND agregado IS NULL AND criado_em > now() - interval '60 seconds'`, [T])).n);
      await cfgLoja(c, `limite_por_minuto = ${recentes + 1}`);
      expect((await gerarLer(c, [nao.id])).acesso_id).toBeNull();
      const r = await gerarLer(c, [a.id]);
      expect(r.acesso_id).not.toBeNull();
      expect(r.pagina).toEqual({ limite: 1, maximo: 2 });
      expect(await falha(c, () => gerarLer(c, [a.id]))).toMatch(/^P0001 gerar_json_limite: aguarde \d+ s$/);
      // as gerações manuais NÃO consomem o limite da chave do ERP
      const k = await chave(c);
      expect((await lerLoja(c, k.chave)).status).toBe("ok");
    });
  });

  it("10. confirmar ignora id fora da reserva (segue integrável)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const a = await modeloInterno(c);
      const b = await modeloInterno(c);
      await marcar(c, a.id);
      await marcar(c, b.id);
      const r = await gerarLer(c, [a.id]);
      const cf = await gerarConf(c, r.acesso_id, { ...entregaDe(r), produtos: [...entregaDe(r).produtos,
        { modelo_id: b.id, assinatura: (await ip(c, b.id)).assinatura }] });
      expect(cf.confirmados.map((x: any) => x.modelo_id)).toEqual([a.id]);
      expect((await ip(c, b.id)).estado).toBe("integravel");
      expect((await acesso(c, r.acesso_id)).detalhe.confirmados).toEqual([a.id]);
      expect(await logsIntegrado(c, b.id)).toHaveLength(0);
    });
  });

  it("11. voltou entre as fases: não confirma, segue não integrável; acesso fecha ok com 0", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const r = await gerarLer(c, [m.id]);
      await c.query(`SELECT public.integracao_voltar(ARRAY[$1::uuid])`, [m.id]);
      const cf = await gerarConf(c, r.acesso_id, entregaDe(r));
      expect(cf).toMatchObject({ status: "ok", confirmados: [], novos: 0, relidos: 0 });
      expect((await ip(c, m.id)).estado).toBe("nao_integravel");
      expect(await acesso(c, r.acesso_id)).toMatchObject({ status: "ok", produtos_entregues: 0, linhas: 0 });
    });
  });

  it("12. entrega malformada = parametro_invalido (reserva continua); contadores de foto só número em faixa", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const r = await gerarLer(c, [m.id]);
      for (const ruim of [null, [], "x", { produtos: "x" }, { produtos: null }, { produtos: [1] },
        { produtos: [{ modelo_id: "nao-uuid" }] }, { produtos: [{ modelo_id: 5 }] }]) {
        expect(await gerarConf(c, r.acesso_id, ruim)).toEqual(PARAM_INVALIDO);
      }
      expect((await acesso(c, r.acesso_id)).status).toBe("reservado");
      const cf = await gerarConf(c, r.acesso_id, entregaDe(r, { fotos_descartadas: 2.7, fotos_ausentes: 1e12 }));
      expect(cf.novos).toBe(1);
      expect((await acesso(c, r.acesso_id)).detalhe).toMatchObject({ fotos_descartadas: 2, fotos_ausentes: 0 });
      const m2 = await modeloInterno(c);
      await marcar(c, m2.id);
      const r2 = await gerarLer(c, [m2.id]);
      await gerarConf(c, r2.acesso_id, entregaDe(r2, { fotos_descartadas: "3", fotos_ausentes: -1 }));
      expect((await acesso(c, r2.acesso_id)).detalhe).toMatchObject({ fotos_descartadas: 0, fotos_ausentes: 0 });
    });
  });

  it("13. migration: md5/ACL/DEFINER/CHECK, dependências intocadas, mensagens ASCII; reaplicar = idempotente; guarda recusa texto estranho", async () => {
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      for (const [f, m] of Object.entries(DEPS)) expect(await md5Vivo(c, f), f).toBe(m);
      await prepara(c);
      expect(await md5Vivo(c, FN_LER)).toBe(MD5.lerIda);
      expect(await md5Vivo(c, FN_CONF)).toBe(MD5.confIda);
      for (const fn of [FN_LER, FN_CONF]) {
        const acl = await um<{ anon: boolean; auth: boolean; pub: boolean; definer: boolean; sp: string[] }>(c, `
          SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                 EXISTS (SELECT 1 FROM aclexplode((SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure($1))) a
                          WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS pub,
                 (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure($1)) AS definer,
                 (SELECT p.proconfig FROM pg_proc p WHERE p.oid = to_regprocedure($1)) AS sp`, [fn]);
        expect(acl).toEqual({ anon: false, auth: true, pub: false, definer: true, sp: ["search_path=public"] });
        const msgs = (await c.query(`SELECT m[1] AS msg FROM regexp_matches(pg_get_functiondef(to_regprocedure($1)),
                                       'RAISE\\s+EXCEPTION\\s+''([^'']*)''', 'gi') AS m`, [fn])).rows.map((x: any) => x.msg);
        if (fn === FN_LER) expect(msgs.length).toBeGreaterThanOrEqual(5); // o confirmar não tem RAISE (parametro_invalido é retorno)
        for (const s of msgs) expect(/^[\x20-\x7E]*$/.test(s), s).toBe(true);
      }
      expect((await um<{ d: string }>(c, `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'integracao_acessos_modo_chk'`)).d)
        .toBe(CHK_DEPOIS);
      for (const [f, m] of Object.entries(DEPS)) expect(await md5Vivo(c, f), f).toBe(m);
      await aplica(c, MIG); // idempotente
      expect(await md5Vivo(c, FN_LER)).toBe(MD5.lerIda);
      expect(await md5Vivo(c, FN_CONF)).toBe(MD5.confIda);
      // guarda: texto estranho na função nova
      await c.query(`CREATE OR REPLACE FUNCTION public.integracao_gerar_json_ler(_modelo_ids uuid[], _loja uuid) RETURNS jsonb
                       LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`);
      expect(await falha(c, () => aplica(c, MIG))).toMatch(/^P0001 gerar_json: public\.integracao_gerar_json_ler ja existe com outro texto/);
    });
  });

  it("15. guarda recusa dependência com texto diferente e CHECK de modo inesperado (P0001 ASCII); o ramo 'mudou' fica sem teste (corrida entre 2 comandos)", async () => {
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      await c.query("SET LOCAL statement_timeout = '120s'");
      // dependência com texto diferente (mesmo comportamento, só um comentário a mais) — simulada na txn
      await c.query("SAVEPOINT gj_dep");
      const def = (await um<{ d: string }>(c, `SELECT pg_get_functiondef('public._integracao_colunas(text[])'::regprocedure) AS d`)).d;
      expect(def).toContain("SELECT jsonb_build_object(");
      await c.query(def.replace("SELECT jsonb_build_object(", "SELECT /* gj teste */ jsonb_build_object("));
      expect(await md5Vivo(c, "public._integracao_colunas(text[])")).not.toBe(DEPS["public._integracao_colunas(text[])"]);
      expect(await falha(c, () => aplica(c, MIG)))
        .toMatch(/^P0001 gerar_json: dependencia public\._integracao_colunas\(text\[\]\) com texto inesperado \(md5 [0-9a-f]{32}\) - refazer o plano$/);
      await c.query("ROLLBACK TO SAVEPOINT gj_dep");
      expect(await md5Vivo(c, "public._integracao_colunas(text[])")).toBe(DEPS["public._integracao_colunas(text[])"]);
      // CHECK de modo inesperado (NOT VALID: não depende das linhas que a cópia já tem)
      await c.query(`ALTER TABLE public.integracao_acessos DROP CONSTRAINT IF EXISTS integracao_acessos_modo_chk`);
      await c.query(`ALTER TABLE public.integracao_acessos ADD CONSTRAINT integracao_acessos_modo_chk
                       CHECK (modo IN ('normal', 'teste', 'manual', 'outro')) NOT VALID`);
      expect(await falha(c, () => aplica(c, MIG))).toMatch(/^P0001 gerar_json: CHECK integracao_acessos_modo_chk inesperado: /);
      // sem o CHECK (ausente) também recusa
      await c.query(`ALTER TABLE public.integracao_acessos DROP CONSTRAINT integracao_acessos_modo_chk`);
      expect(await falha(c, () => aplica(c, MIG))).toBe("P0001 gerar_json: CHECK integracao_acessos_modo_chk inesperado: ausente");
    });
  });

  it("14. volta: _down neutraliza (permissão antes, depois gerar_json_desligado) e a ida reaplica por cima; _down_drop exige o _down e a confirmação, apaga os acessos manuais, volta o CHECK e derruba as 2", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const m = await modeloInterno(c);
      await marcar(c, m.id);
      const r = await gerarLer(c, [m.id]); // 1 acesso manual
      expect(await falha(c, () => aplica(c, INV_DROP))).toMatch(/^P0001 gerar_json_drop: rode o _down antes/);
      await aplica(c, INV);
      expect(await md5Vivo(c, FN_LER)).toBe(MD5.lerNeutra);
      expect(await md5Vivo(c, FN_CONF)).toBe(MD5.confNeutra);
      expect(await falha(c, () => gerarLer(c, [m.id]))).toBe("P0001 gerar_json_desligado: recurso desligado");
      expect(await falha(c, () => gerarConf(c, r.acesso_id, entregaDe(r)))).toBe("P0001 gerar_json_desligado: recurso desligado");
      await comoUsuarioCom(c, U_VER, [["integracao", true, false]]);
      expect(await falha(c, () => gerarLer(c, [m.id]))).toBe(SEM_EDITAR);
      await comoUsuario(c, U);
      for (const fn of [FN_LER, FN_CONF]) {
        const acl = await um<{ anon: boolean; auth: boolean }>(c,
          `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth`, [fn]);
        expect(acl).toEqual({ anon: false, auth: true });
      }
      expect((await ip(c, m.id)).estado).toBe("integravel");
      await aplica(c, INV); // idempotente
      // reaplicar a ida por cima da volta parcial (neutra) volta ao texto da ida, sem o _down_drop
      await aplica(c, MIG);
      expect(await md5Vivo(c, FN_LER)).toBe(MD5.lerIda);
      expect(await md5Vivo(c, FN_CONF)).toBe(MD5.confIda);
      await aplica(c, INV);
      // _down_drop: com acesso manual e sem a confirmação = recusa
      expect(await nManuais(c)).toBeGreaterThan(0);
      expect(await falha(c, () => aplica(c, INV_DROP))).toMatch(/^P0001 gerar_json_drop: \d+ acesso\(s\) manual\(is\) no Log de acessos/);
      await c.query(`SET LOCAL app.confirmo_apagar_acessos_manuais = 'sim'`);
      const logsAntes = await logsIntegrado(c, m.id);
      await aplica(c, INV_DROP);
      expect(await md5Vivo(c, FN_LER)).toBeNull();
      expect(await md5Vivo(c, FN_CONF)).toBeNull();
      expect(await nManuais(c)).toBe(0);
      expect((await um<{ d: string }>(c, `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'integracao_acessos_modo_chk'`)).d)
        .toBe(CHK_ANTES);
      expect(await logsIntegrado(c, m.id)).toEqual(logsAntes); // não mexe no Log
      expect((await ip(c, m.id)).estado).toBe("integravel"); // nem em integracao_produtos
      await aplica(c, INV_DROP); // idempotente
      for (const [f, md] of Object.entries(DEPS)) expect(await md5Vivo(c, f), f).toBe(md);
      // a ida volta a aplicar por cima do estado de antes
      await aplica(c, MIG);
      expect(await md5Vivo(c, FN_LER)).toBe(MD5.lerIda);
      expect(await md5Vivo(c, FN_CONF)).toBe(MD5.confIda);
    });
  });
});
