/**
 * Release A2 — API da Integração: parâmetro `loja` OBRIGATÓRIO (P-224 B+, dono 03/out). Plano
 * .superpowers/sdd/2026-10-03-api-objetos/plan.md. Migration 20261030130000 (função NOVA `_integracao_ler_loja` + CHECK de
 * integracao_acessos ampliado; `_integracao_ler` intocada) e os 2 inversos (_down neutraliza, _down_drop separado).
 * SÓ na cópia local (exigeBancoLocal); txn revertida (withTx): NADA é gravado. Funciona com a cópia NOS DOIS estados: sem a A2
 * (aplica o arquivo DENTRO da txn — sem BEGIN/COMMIT e sem as 2 travas SET LOCAL, NUNCA `\i`) ou com ela já aplicada
 * (idempotente: reaplicar só confere). O ALTER TABLE do CHECK pega AccessExclusive em integracao_acessos até o fim do teste.
 */
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { createHash } from "node:crypto";
import { hasDb, withTx, comoUsuario, um } from "./db";
import { exigeBancoLocal } from "./mig-txn";
import { LOCAL, MARCAS, T, U, aplica } from "./integracao-helpers";

const MIG = "supabase/migrations/20261030130000_integracao_api_loja_obrigatoria.sql";
const INV = "supabase/rollback/20261030130000_integracao_api_loja_obrigatoria_down.sql";
const INV_DROP = "supabase/rollback/20261030130000_integracao_api_loja_obrigatoria_down_drop.sql";
const FN = "public._integracao_ler_loja(text,uuid,boolean,text,integer,text,text)";
const LER = "public._integracao_ler(text,boolean,text,integer,text,text)";
const MD5_LER = "1ac58b343e992fefe0062dac512e11eb";
const MD5_DEPOIS = "d5bf36c5c1cefa550414e11db002efa7";
const MD5_NEUTRA = "ccfa5fa7d3867203259c5dcc8039ca31";
const OUTRA_LOJA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // outra loja (Ave Rara na cópia) — a chave é da Loja Teste

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
let seq = 0;
const ipNovo = (): string => `198.51.100.${(Date.now() + seq++) % 250}-a2-${seq}`; // único por chamada (sem colidir com outros testes)

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
  await aplica(c, MIG);
  await comoUsuario(c, U);
}
async function chave(c: Client, nome = "ERP A2"): Promise<{ id: string; chave: string; final: string }> {
  return (await um<{ r: any }>(c, `SELECT public.integracao_chave_criar($1) AS r`, [nome])).r;
}
type Op = { loja?: string | null; incluir?: boolean; cursor?: string | null; limite?: number | null; modo?: string | null; ip?: string };
async function lerLoja(c: Client, k: string, o: Op = {}): Promise<any> {
  return (await um<{ r: any }>(c, `SELECT public._integracao_ler_loja($1, $2::uuid, $3, $4, $5, $6, $7) AS r`,
    [sha(k), o.loja === undefined ? T : o.loja, o.incluir ?? false, o.cursor ?? null, o.limite ?? null,
      o.modo === undefined ? "normal" : o.modo, o.ip ?? "203.0.113.77"])).r;
}
async function acessos(c: Client, where: string, params: unknown[]): Promise<any[]> {
  return (await c.query(`SELECT * FROM public.integracao_acessos WHERE ${where} ORDER BY criado_em`, params)).rows;
}
async function falha(c: Client, fn: () => Promise<unknown>): Promise<string> {
  await c.query("SAVEPOINT a2_falha");
  try {
    await fn();
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT a2_falha");
    return `${e.code} ${e.message}`;
  }
  await c.query("RELEASE SAVEPOINT a2_falha");
  return "PASSOU";
}

describe.skipIf(!hasDb || !LOCAL)("integracao — A2: loja obrigatória na API (_integracao_ler_loja)", () => {
  it("ida: função nova com o md5 aceito, ACL só service_role (inv. 9), _integracao_ler intocada, CHECK ampliado; reaplicar = idempotente", async () => {
    await withTx(async (c) => {
      expect(await md5Vivo(c, LER)).toBe(MD5_LER);
      await prepara(c);
      expect(await md5Vivo(c, FN)).toBe(MD5_DEPOIS);
      expect(await md5Vivo(c, LER)).toBe(MD5_LER);
      const acl = await um<{ anon: boolean; auth: boolean; svc: boolean; pub: boolean; definer: boolean; sp: string[] }>(c, `
        SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon, has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
               has_function_privilege('service_role', $1, 'EXECUTE') AS svc,
               EXISTS (SELECT 1 FROM aclexplode((SELECT p.proacl FROM pg_proc p WHERE p.oid = to_regprocedure($1))) a
                        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS pub,
               (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure($1)) AS definer,
               (SELECT p.proconfig FROM pg_proc p WHERE p.oid = to_regprocedure($1)) AS sp`, [FN]);
      expect(acl).toEqual({ anon: false, auth: false, svc: true, pub: false, definer: true, sp: ["search_path=public"] });
      const chk = (await um<{ d: string }>(c, `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'integracao_acessos_status_chk'`)).d;
      expect(chk).toContain("'loja_nao_autorizada'::text");
      expect(chk).toContain("'limite_excedido'::text");
      await aplica(c, MIG); // idempotente
      expect(await md5Vivo(c, FN)).toBe(MD5_DEPOIS);
    });
  });

  it("loja certa: delega a _integracao_ler tal qual (normal e teste); acesso 'reservado'/'teste' normal", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await chave(c);
      const r = await lerLoja(c, k.chave);
      expect(r.status).toBe("ok");
      expect(r.modo).toBe("normal");
      expect(r.loja.id).toBe(T);
      expect(r.chave_id).toBe(k.id);
      expect(Array.isArray(r.produtos)).toBe(true);
      expect((await acessos(c, "id = $1", [r.acesso_id]))[0].status).toBe("reservado");
      const t = await lerLoja(c, k.chave, { modo: "teste" });
      expect(t.status).toBe("ok");
      expect(t.modo).toBe("teste");
      expect(t.produtos[0].modelo_id).toBe("exemplo-0001");
      expect((await acessos(c, "id = $1", [t.acesso_id]))[0].status).toBe("teste");
      // uuid em MAIÚSCULAS é o mesmo uuid
      expect((await lerLoja(c, k.chave, { loja: T.toUpperCase() })).status).toBe("ok");
    });
  });

  it("loja errada: 'loja_nao_autorizada' (nada entregue), registrado no Log agregado por chave×minuto; não toca a chave", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await chave(c);
      const ip = ipNovo();
      const r = await lerLoja(c, k.chave, { loja: OUTRA_LOJA, ip });
      expect(r).toEqual({ status: "loja_nao_autorizada", tenant_id: T });
      const r2 = await lerLoja(c, k.chave, { loja: OUTRA_LOJA, ip, modo: "teste" });
      expect(r2.status).toBe("loja_nao_autorizada");
      const rows = await acessos(c, "chave_id = $1", [k.id]);
      expect(rows).toHaveLength(1); // agregado: as 2 chamadas no mesmo minuto viram 1 linha
      expect(rows[0]).toMatchObject({
        tenant_id: T, chave_id: k.id, status: "loja_nao_autorizada", agregado: `lna:${k.id}`, tentativas: 2, produtos_entregues: 0,
        modo: "normal", detalhe: { loja_pedida: OUTRA_LOJA },
      });
      expect(rows[0].ip.startsWith("198.51.100.")).toBe(true);
      // não registra uso da chave
      expect((await um<{ u: string | null }>(c, `SELECT ultimo_uso_em AS u FROM public.integracao_chaves WHERE id = $1`, [k.id])).u).toBeNull();
      // aparece no Log de acessos da tela (super admin, loja da chave)
      const lista = (await um<{ r: any[] }>(c, `SELECT public.integracao_acessos_listar(50) AS r`)).r;
      const item = lista.find((a) => a.id === rows[0].id);
      expect(item).toMatchObject({ status: "loja_nao_autorizada", chave: "ERP A2", final: k.final, tentativas: 2, ip: null });
    });
  });

  it("loja errada NÃO conta no bloqueio de IP nem consome o limite por minuto", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const lim = (await um<{ l: number }>(c, `SELECT (public._integracao_cfg($1)).limite_por_minuto AS l`, [T])).l;
      const limiar = (await um<{ n: number }>(c, `SELECT coalesce(min(bloqueio_tentativas), 10) AS n FROM public.integracao_config`)).n;
      const k = await chave(c);
      const ip = ipNovo();
      for (let i = 0; i < Math.max(lim, limiar) + 2; i++) {
        expect((await lerLoja(c, k.chave, { loja: OUTRA_LOJA, ip })).status).toBe("loja_nao_autorizada");
      }
      // limite por minuto intocado: nenhuma linha não-agregada da chave
      expect(await acessos(c, "chave_id = $1 AND agregado IS NULL", [k.id])).toHaveLength(0);
      // bloqueio de IP intocado: nada em 'inv:<ip>'; uma chave ERRADA desse IP ainda é só chave_invalida (não ip_bloqueado)
      expect(await acessos(c, "agregado = $1", [`inv:${ip}`])).toHaveLength(0);
      expect((await lerLoja(c, "wish_live_ERRADA", { loja: T, ip })).status).toBe("chave_invalida");
      // e a chave certa com a loja certa continua liberada
      expect((await lerLoja(c, k.chave, { ip })).status).toBe("ok");
    });
  });

  it("chave inválida/revogada: delega (chave_invalida, conta no bloqueio de IP) — com loja certa OU errada", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const ip = ipNovo();
      expect((await lerLoja(c, "wish_live_NAOEXISTE", { loja: OUTRA_LOJA, ip })).status).toBe("chave_invalida");
      expect((await lerLoja(c, "wish_live_NAOEXISTE", { loja: T, ip })).status).toBe("chave_invalida");
      const inv = await acessos(c, "agregado = $1", [`inv:${ip}`]);
      expect(inv).toHaveLength(1);
      expect(inv[0]).toMatchObject({ status: "chave_invalida", tentativas: 2, tenant_id: null });
      const k = await chave(c, "ERP Revogada");
      await c.query(`SELECT public.integracao_chave_revogar($1)`, [k.id]);
      expect((await lerLoja(c, k.chave, { loja: OUTRA_LOJA, ip })).status).toBe("chave_invalida");
    });
  });

  it("loja NULL ou modo inválido: parametro_invalido sem registrar nada; cursor inválido com loja certa segue a regra de hoje", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await chave(c);
      const antes = (await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_acessos`)).n;
      expect(await lerLoja(c, k.chave, { loja: null })).toEqual({ status: "parametro_invalido" });
      expect(await lerLoja(c, k.chave, { modo: "xpto" })).toEqual({ status: "parametro_invalido" });
      expect(await lerLoja(c, k.chave, { modo: null })).toEqual({ status: "parametro_invalido" });
      expect(await lerLoja(c, k.chave, { cursor: "!!!" })).toEqual({ status: "parametro_invalido" });
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_acessos`)).n).toBe(antes);
    });
  });

  it("guarda: função já existente com outro texto (nem a da ida nem a neutra do _down) => recusa (P0001 ASCII), nada muda", async () => {
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      // ausente ou presente: troca por um corpo estranho (CREATE OR REPLACE mantém a assinatura)
      await c.query(`CREATE OR REPLACE FUNCTION public._integracao_ler_loja(_chave_hash text, _loja uuid, _incluir_integrados boolean, _cursor text,
        _limite integer, _modo text, _ip text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`);
      const e = await falha(c, () => aplica(c, MIG));
      expect(e).toMatch(/^P0001 a2_loja: public\._integracao_ler_loja ja existe com outro texto/);
    });
  });

  it("volta: _down neutraliza (só delega — loja errada passa, como antes); _down_drop exige confirmação, apaga o status novo, volta o CHECK e a função some", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const k = await chave(c);
      expect((await lerLoja(c, k.chave, { loja: OUTRA_LOJA, ip: ipNovo() })).status).toBe("loja_nao_autorizada");
      await aplica(c, INV);
      expect(await md5Vivo(c, FN)).toBe(MD5_NEUTRA);
      expect((await lerLoja(c, k.chave, { loja: OUTRA_LOJA })).status).toBe("ok");
      expect(await md5Vivo(c, LER)).toBe(MD5_LER);
      await aplica(c, INV); // idempotente
      // fix round 1 (B1): reaplicar a ida por cima da volta parcial (função neutra) é aceito e volta ao texto da ida
      await aplica(c, MIG);
      expect(await md5Vivo(c, FN)).toBe(MD5_DEPOIS);
      expect((await lerLoja(c, k.chave, { loja: OUTRA_LOJA, ip: ipNovo() })).status).toBe("loja_nao_autorizada");
      await aplica(c, INV);
      expect(await md5Vivo(c, FN)).toBe(MD5_NEUTRA);
      const acl = await um<{ anon: boolean; auth: boolean; svc: boolean }>(c, `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
        has_function_privilege('authenticated', $1, 'EXECUTE') AS auth, has_function_privilege('service_role', $1, 'EXECUTE') AS svc`, [FN]);
      expect(acl).toEqual({ anon: false, auth: false, svc: true });
      // passo 2: com registro 'loja_nao_autorizada' exige confirmação
      expect(await falha(c, () => aplica(c, INV_DROP))).toMatch(/^P0001 a2_loja_volta_drop: \d+ registro\(s\) loja_nao_autorizada/);
      await c.query(`SET LOCAL app.confirmo_apagar_acessos_loja = 'sim'`);
      await aplica(c, INV_DROP);
      expect(await md5Vivo(c, FN)).toBeNull();
      expect((await um<{ n: string }>(c, `SELECT count(*) AS n FROM public.integracao_acessos WHERE status = 'loja_nao_autorizada'`)).n).toBe("0");
      const chk = (await um<{ d: string }>(c, `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'integracao_acessos_status_chk'`)).d;
      expect(chk).toBe("CHECK ((status = ANY (ARRAY['reservado'::text, 'ok'::text, 'teste'::text, 'chave_invalida'::text, 'loja_inativa'::text, 'ip_bloqueado'::text, 'limite_excedido'::text])))");
      await aplica(c, INV_DROP); // idempotente
      // e a ida volta a aplicar por cima do estado de antes
      await aplica(c, MIG);
      expect(await md5Vivo(c, FN)).toBe(MD5_DEPOIS);
    });
  });

  it("_down_drop sem o _down antes (função ainda com a checagem) => recusa", async () => {
    await withTx(async (c) => {
      await prepara(c);
      expect(await falha(c, () => aplica(c, INV_DROP))).toMatch(/^P0001 a2_loja_volta_drop: rode antes o _down/);
    });
  });
});
