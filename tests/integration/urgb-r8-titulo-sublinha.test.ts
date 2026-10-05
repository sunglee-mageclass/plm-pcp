// Urgentes R8a (plan-b Task 4, migration 20261103190000_urg_r8_titulo_sublinha): título da sublinha (variante × tamanho) da
// Integração/API = o título EFETIVO do produto com a cor antes do último " | " (helper novo _integracao_titulo_sublinha; espelho
// TS tituloSublinha + anti-drift). O retrato passa a v=4; integracao_listar compara o título da sublinha só com retrato gravado
// v>=4 (Ruling 17); o modo teste da API (_integracao_exemplo) ganha o título da sublinha e o do produto NÃO muda (Ruling 16).
// Txn revertida; o bloco é aplicado DENTRO da txn por aplicaUrgb(c, "r8a") (pula o que já está vivo na cópia). Só na cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import { aplicaUrgb, urgbViva, URGB_MIGS, md5UrgbSucessor } from "./urgb-helpers";
import { aplicarArquivo } from "./mig-txn";
import {
  camposLoja,
  keywordsLoja,
  modeloInterno,
  padraoVivo,
  type Fixture,
} from "./integracao-helpers";
import { tituloSublinha } from "@/lib/integracao/titulo-sublinha";
import { CASOS_TITULO_SUBLINHA } from "../fixtures/titulo-sublinha-casos";

const BLOCO = URGB_MIGS.find((x) => x.id === "r8a")?.b;
const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const RETRATO = "public._integracao_retrato_core(uuid,text[],jsonb)";
const LISTAR = "public.integracao_listar(text,jsonb,integer,integer)";
const EXEMPLO = "public._integracao_exemplo(text[],integer)";
const HELPER = "public._integracao_titulo_sublinha(text,text,text,text)";
// tabela de fatos do plan-b (md5 vivo ANTES desta frente)
const ANTES: Record<string, string> = {
  [RETRATO]: "8a5275cf8c145f88e23c5158c22fdfc6",
  [LISTAR]: "d2d3c9c55b3a6ce8b42d1842cab415f6",
  [EXEMPLO]: "8882ce651fe5f13a44c60751692da40e",
};
const ACL_CORE = "{postgres=X/postgres,service_role=X/postgres}";
const ACL_WRAPPER = "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}";
const FORMATO = {
  partes: ["ref", "cor_base", "tamanho"],
  separadores: { "ref|cor_base": "-", "cor_base|tamanho": "-" },
};

type Linha = {
  tipo: string;
  ordem: number;
  variante_key?: string;
  tamanho_key?: string;
  valores: Record<string, string | null>;
};
type Retrato = { v: number; campos: string[]; linhas: Linha[] };
type Exemplo = {
  produtos: { linhas: { tipo: string; valores: (string | string[] | null)[] }[] }[];
};

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (
    await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
      sig,
    ])
  ).m;
}
async function falha(
  c: Client,
  fn: () => Promise<unknown>,
): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT r8_falha");
  try {
    await fn();
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT r8_falha");
    const er = e as { code?: string; message?: string };
    return { code: String(er.code ?? ""), message: String(er.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT r8_falha");
  throw new Error("esperava erro");
}
async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '120s'");
  await aplicaUrgb(c, "r8a");
  await comoUsuario(c);
  await keywordsLoja(c, "k");
}
async function skuConfig(c: Client, cfg: unknown): Promise<void> {
  await c.query("UPDATE public.tenant_config SET sku_config = $2::jsonb WHERE tenant_id = $1", [
    T,
    JSON.stringify(cfg),
  ]);
}
async function retrato(c: Client, id: string, campos: readonly string[]): Promise<Retrato> {
  return (
    await um<{ r: Retrato }>(
      c,
      `SELECT public._integracao_retrato_core($1, $2::text[], (public._custo_unitario_modelos_core(ARRAY[$1::uuid]) -> $1::text)) -> 'retrato' AS r`,
      [id, campos],
    )
  ).r;
}
const variantes = (r: Retrato): Linha[] => r.linhas.filter((l) => l.tipo === "variante");
async function cores(c: Client, f: Fixture): Promise<{ base: string; apelido: string | null }> {
  return um(
    c,
    `SELECT (SELECT nome FROM public.cores WHERE id = $1) AS base, (SELECT nome FROM public.cores_apelido WHERE id = $2) AS apelido`,
    [f.corId, f.apelidoId],
  );
}
async function marcar(c: Client, id: string): Promise<void> {
  const a = (
    await um<{ r: { produtos: { assinatura: string }[] } }>(
      c,
      `SELECT public.integracao_previa(ARRAY[$1::uuid]) AS r`,
      [id],
    )
  ).r.produtos[0].assinatura;
  await c.query(
    `SELECT public.integracao_marcar(jsonb_build_array(jsonb_build_object('modelo_id', $1::uuid, 'assinatura', $2::text)))`,
    [id, a],
  );
}
async function gravado(c: Client, id: string): Promise<{ estado: string; retrato: Retrato }> {
  return um(c, `SELECT estado, retrato FROM public.integracao_produtos WHERE modelo_id = $1`, [id]);
}
async function difere(c: Client, f: Fixture): Promise<string[]> {
  const r = (
    await um<{ r: { produtos: { modelo_id: string; retrato_difere: string[] }[] } }>(
      c,
      `SELECT public.integracao_listar('todos', jsonb_build_object('busca', $1::text), 1, 500) AS r`,
      [f.ref],
    )
  ).r;
  const p = r.produtos.find((x) => x.modelo_id === f.id);
  expect(p, `produto ${f.ref} na lista`).toBeDefined();
  return p!.retrato_difere;
}

describe.skipIf(!RODA)(
  "urg R8a — título da sublinha = título do produto + cor (retrato v=4)",
  () => {
    it("estrutura: bloco r8a em urgb-dados.ts (3 redefinidas + helper novo), md5 ANTES = tabela de fatos; vivo após aplicar", async () => {
      expect(BLOCO, "bloco r8a em urgb-dados.ts").toBeDefined();
      expect(BLOCO!.mig).toBe("supabase/migrations/20261103190000_urg_r8_titulo_sublinha.sql");
      expect(BLOCO!.down).toBe("supabase/rollback/20261103190000_urg_r8_titulo_sublinha_down.sql");
      expect(BLOCO!.drop).toBe(
        "supabase/rollback/20261103190000_urg_r8_titulo_sublinha_down_drop.sql",
      );
      expect(BLOCO!.URGB_SENTINELA).toBe(RETRATO);
      expect(Object.keys(BLOCO!.URGB_MD5).sort()).toEqual(Object.keys(ANTES).sort());
      for (const [sig, a] of Object.entries(ANTES)) expect(BLOCO!.URGB_MD5[sig].antes, sig).toBe(a);
      expect(Object.keys(BLOCO!.URGB_NOVAS ?? {})).toEqual([HELPER]);
      expect(BLOCO!.URGB_ACL).toEqual({
        [RETRATO]: ACL_CORE,
        [LISTAR]: ACL_WRAPPER,
        [EXEMPLO]: ACL_CORE,
      });
      await withTx(async (c) => {
        await prepara(c);
        expect(await urgbViva(c, "r8a")).toBe(true);
        for (const sig of Object.keys(ANTES)) {
          expect(md5UrgbSucessor(sig, BLOCO!.URGB_MD5[sig].depois), sig).toContain(
            await md5Fn(c, sig),
          );
        }
        expect(await md5Fn(c, HELPER)).toBe(BLOCO!.URGB_NOVAS![HELPER]);
        // o pino antigo (I3b) segue aceito pela cadeia de sucessores (suítes antigas)
        expect(md5UrgbSucessor(RETRATO, ANTES[RETRATO])).toContain(await md5Fn(c, RETRATO));
      });
    });

    it("(a) anti-drift: a fixture inteira contra o SQL (_integracao_titulo_sublinha) — e o TS dá o mesmo", async () => {
      await withTx(async (c) => {
        await prepara(c);
        for (const k of CASOS_TITULO_SUBLINHA) {
          const v = (
            await um<{ v: string | null }>(
              c,
              `SELECT public._integracao_titulo_sublinha($1, $2, $3, $4) AS v`,
              [k.titulo, k.base, k.apelido, k.modo],
            )
          ).v;
          expect(v, JSON.stringify(k)).toBe(k.esperado);
          expect(tituloSublinha(k.titulo, k.base, k.apelido, k.modo), JSON.stringify(k)).toBe(v);
        }
      });
    });

    it("(b) retrato vivo: produto = título efetivo (digitado, automático v1, HERDADO v2+); cada sublinha = tituloSublinha(pai, cor, apelido, modo); v=4", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const campos = await padraoVivo(c);
        // digitado (com " | ")
        const dig = await modeloInterno(c);
        await c.query(
          `UPDATE public.modelos SET titulo_pagina = 'Vestido Suelen | Ave Rara' WHERE id = $1`,
          [dig.id],
        );
        // automático v1 (titulo_pagina NULL = Nome em Iniciais Maiúsculas + " | " + loja)
        const auto = await modeloInterno(c, { nome: "vestido suelen auto" });
        await c.query(`UPDATE public.modelos SET titulo_pagina = NULL WHERE id = $1`, [auto.id]);
        // HERDADO v2 (titulo_pagina NULL; anterior = o digitado)
        const v2 = await modeloInterno(c);
        await c.query(
          `UPDATE public.modelos SET titulo_pagina = NULL, modelo_base_id = $2, versao = 2 WHERE id = $1`,
          [v2.id, dig.id],
        );
        await c.query(`UPDATE public.modelos SET versao = 1 WHERE id = $1`, [dig.id]);
        for (const modo of ["cor_base", "cor_apelido"] as const) {
          await skuConfig(c, { ...FORMATO, cor_no_nome: modo });
          for (const [f, esperadoPai] of [
            [dig, "Vestido Suelen | Ave Rara"],
            [auto, "Vestido Suelen Auto | Loja Teste"],
            [v2, "Vestido Suelen | Ave Rara"],
          ] as const) {
            const r = await retrato(c, f.id, campos);
            expect(r.v).toBe(4);
            const pai = r.linhas[0].valores.titulo;
            expect(pai, `${modo} pai`).toBe(esperadoPai);
            const k = await cores(c, f);
            const vs = variantes(r);
            expect(vs.length).toBe(2);
            for (const l of vs) {
              const esperado = tituloSublinha(pai, k.base, k.apelido, modo);
              expect(l.valores.titulo, `${modo} ${f.ref}`).toBe(esperado);
              expect(esperado).toBe(
                pai!.includes(" | ")
                  ? pai!.replace(
                      / \| (?!.* \| )/,
                      ` ${modo === "cor_apelido" ? k.apelido : k.base} | `,
                    )
                  : `${pai} ${modo === "cor_apelido" ? k.apelido : k.base}`,
              );
            }
          }
        }
        // sem apelido no modo Apelido → a cor base
        const semAp = await modeloInterno(c, { semApelido: true });
        await c.query(
          `UPDATE public.modelos SET titulo_pagina = 'Saia Marola | Loja' WHERE id = $1`,
          [semAp.id],
        );
        const r = await retrato(c, semAp.id, campos);
        const k = await cores(c, semAp);
        for (const l of variantes(r)) expect(l.valores.titulo).toBe(`Saia Marola ${k.base} | Loja`);
        // o NOME da sublinha não muda (Ruling 23): nome do produto + cor + tamanho
        for (const l of variantes(r))
          expect(l.valores.nome).toMatch(new RegExp(` ${k.base} [PM]$`));
      });
    });

    it("(c) titulo NÃO marcado → a sublinha fica sem a chave (como hoje); o produto também", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const campos = (await padraoVivo(c)).filter((x) => x !== "titulo");
        const f = await modeloInterno(c);
        const r = await retrato(c, f.id, campos);
        expect(r.v).toBe(4);
        for (const l of r.linhas) expect(Object.keys(l.valores)).not.toContain("titulo");
      });
    });

    it("(d) integracao_marcar grava integracao_linhas.titulo das variantes = retrato; _integracao_valores entrega na ordem", async () => {
      await withTx(async (c) => {
        await prepara(c);
        await skuConfig(c, { ...FORMATO, cor_no_nome: "cor_apelido" });
        const campos = await padraoVivo(c);
        await camposLoja(c, campos);
        const f = await modeloInterno(c);
        await c.query(
          `UPDATE public.modelos SET titulo_pagina = 'Vestido Suelen | Ave Rara' WHERE id = $1`,
          [f.id],
        );
        await marcar(c, f.id);
        const g = await gravado(c, f.id);
        expect(g.estado).toBe("integravel");
        expect(g.retrato.v).toBe(4);
        const k = await cores(c, f);
        const esperado = `Vestido Suelen ${k.apelido} | Ave Rara`;
        expect(variantes(g.retrato).map((l) => l.valores.titulo)).toEqual([esperado, esperado]);
        const { rows } = await c.query(
          `SELECT il.tipo, il.titulo, public._integracao_valores(il, $2::text[], $2::text[]) AS v
           FROM public.integracao_linhas il WHERE il.modelo_id = $1 ORDER BY il.ordem`,
          [f.id, campos],
        );
        expect(rows.map((x) => [x.tipo, x.titulo])).toEqual([
          ["produto", "Vestido Suelen | Ave Rara"],
          ["variante", esperado],
          ["variante", esperado],
        ]);
        const iT = campos.indexOf("titulo");
        expect(rows.map((x) => x.v[iT])).toEqual(["Vestido Suelen | Ave Rara", esperado, esperado]);
      });
    });

    it("(e) integracao_listar: integrado com retrato v=3 (sublinhas herdaram o título) NÃO acende 'sublinhas'; integrável v=4 cuja cor mudou acende", async () => {
      await withTx(async (c) => {
        await prepara(c);
        // só título + REF/tamanho nas sublinhas: nome e cores fora (senão eles acenderiam o aviso sozinhos)
        const campos = (await padraoVivo(c)).filter(
          (x) => !["nome", "cor_base", "cor_apelido"].includes(x),
        );
        await camposLoja(c, campos);
        await skuConfig(c, FORMATO);
        // retrato v=3 = o texto de ANTES desta frente (volta só o r8a na txn; o helper fica)
        await aplicarArquivo(c, BLOCO!.down);
        const v3 = await modeloInterno(c);
        await marcar(c, v3.id);
        await c.query(
          `UPDATE public.integracao_produtos SET estado = 'integrado', integrado_em = now() WHERE modelo_id = $1`,
          [v3.id],
        );
        await aplicarArquivo(c, BLOCO!.mig);
        await c.query("SET LOCAL transaction_timeout = 0");
        await c.query("SET LOCAL lock_timeout = '3s'");
        const g3 = await gravado(c, v3.id);
        expect(g3.retrato.v).toBe(3);
        const pai3 = g3.retrato.linhas[0].valores.titulo;
        for (const l of variantes(g3.retrato)) expect(l.valores.titulo).toBe(pai3); // herdou do produto
        const v4 = await modeloInterno(c);
        await marcar(c, v4.id);
        expect((await gravado(c, v4.id)).retrato.v).toBe(4);
        // nada mudou ainda: nenhum aviso (o v=3 não compara o título da sublinha, que hoje SERIA diferente do gravado)
        expect(await difere(c, v3)).toEqual([]);
        expect(await difere(c, v4)).toEqual([]);
        // a cor da variante muda no cadastro (cor_base desmarcado: só o título da sublinha muda)
        for (const f of [v3, v4])
          await c.query(`UPDATE public.cores SET nome = nome || ' Novo' WHERE id = $1`, [f.corId]);
        expect(await difere(c, v3)).toEqual([]);
        expect(await difere(c, v4)).toEqual(["sublinhas"]);
      });
    });

    it("(f) _integracao_exemplo (modo teste): sublinha = '… - exemplo Cor Exemplo'; o produto de exemplo NÃO muda (Ruling 16)", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const campos = await padraoVivo(c);
        const r = (
          await um<{ r: Exemplo }>(c, `SELECT public._integracao_exemplo($1::text[], 1) AS r`, [
            campos,
          ])
        ).r;
        const iT = campos.indexOf("titulo");
        const iN = campos.indexOf("nome");
        expect(r.produtos.length).toBe(2);
        r.produtos.forEach((p, i) => {
          const n = i + 1;
          expect(p.linhas[0].tipo).toBe("produto");
          expect(p.linhas[0].valores[iT]).toBe(`Produto Exemplo ${n} - exemplo`);
          expect(p.linhas.slice(1).map((l) => l.valores[iT])).toEqual([
            `Produto Exemplo ${n} - exemplo Cor Exemplo`,
            `Produto Exemplo ${n} - exemplo Cor Exemplo`,
          ]);
          expect(p.linhas.slice(1).map((l) => l.valores[iN])).toEqual([
            `Produto Exemplo ${n} Cor Exemplo P`,
            `Produto Exemplo ${n} Cor Exemplo M`,
          ]);
        });
      });
    });

    it("(g) ACL do helper: IMMUTABLE, sem SECURITY DEFINER, search_path=public, só postgres/service_role (anon/authenticated sem EXECUTE)", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const p = await um<{
          acl: string;
          sd: boolean;
          vol: string;
          cfg: string;
          anon: boolean;
          auth: boolean;
          pub: boolean;
        }>(
          c,
          `SELECT coalesce(p.proacl::text, '') AS acl, p.prosecdef AS sd, p.provolatile AS vol,
                coalesce(array_to_string(p.proconfig, '|'), '') AS cfg,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0) AS pub
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
          [HELPER],
        );
        expect(p).toEqual({
          acl: ACL_CORE,
          sd: false,
          vol: "i",
          cfg: "search_path=public",
          anon: false,
          auth: false,
          pub: false,
        });
        // as 3 redefinidas mantêm a ACL/secdef de antes
        for (const [sig, acl] of Object.entries(BLOCO!.URGB_ACL)) {
          expect(
            (
              await um<{ a: string }>(
                c,
                `SELECT coalesce(proacl::text, '') AS a FROM pg_proc WHERE oid = to_regprocedure($1)`,
                [sig],
              )
            ).a,
            sig,
          ).toBe(acl);
        }
      });
    });

    it("(h) volta NEUTRA (3 textos de ANTES, helper FICA) + idempotência (ida 2×, volta 2×) + _down_drop só depois da volta", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const depois = Object.fromEntries(
          Object.keys(ANTES).map((s) => [s, BLOCO!.URGB_MD5[s].depois]),
        );
        const viva = async () =>
          Object.fromEntries(
            await Promise.all(Object.keys(ANTES).map(async (s) => [s, await md5Fn(c, s)])),
          );
        await aplicarArquivo(c, BLOCO!.mig); // ida de novo = no-op
        expect(await viva()).toEqual(depois);
        // _down_drop com a ida viva RECUSA (as 3 não estão no texto de ANTES)
        const e = await falha(c, () => aplicarArquivo(c, BLOCO!.drop));
        expect(e.code).toBe("P0001");
        expect(e.message).toMatch(/nao esta no texto de ANTES/);
        await aplicarArquivo(c, BLOCO!.down);
        expect(await viva()).toEqual(ANTES);
        expect(await md5Fn(c, HELPER)).toBe(BLOCO!.URGB_NOVAS![HELPER]); // o helper fica (inerte)
        await aplicarArquivo(c, BLOCO!.down); // volta de novo = no-op
        expect(await viva()).toEqual(ANTES);
        expect(await urgbViva(c, "r8a")).toBe(false);
        await aplicarArquivo(c, BLOCO!.drop);
        expect(await md5Fn(c, HELPER)).toBeNull();
        await aplicarArquivo(c, BLOCO!.mig); // ida recria o helper
        expect(await viva()).toEqual(depois);
        expect(await md5Fn(c, HELPER)).toBe(BLOCO!.URGB_NOVAS![HELPER]);
      });
    });
  },
);
