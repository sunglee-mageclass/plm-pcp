// Modularidade T1 — portões de MÓDULO nas RPCs (Partes 4, 5, 7, 9) + auxiliares _exige_modulos/_tenant_modulo_ligado.
// Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md §0 M1/M2 e §3 T1. Migration GERADA 20261103100000_mod_gates_rpcs
// (gerar-mod1.mjs). Cada caso em transação revertida (withTx) e SÓ na cópia local: a migration é aplicada DENTRO da txn
// (mod-helpers/mig-txn, nunca \i). Chamadas como o PAPEL do PostgREST (SET LOCAL ROLE authenticated) com JWT de usuário COMUM
// criado na txn (todas as páginas ver+editar). Módulo desligado SEM claims (MOD-1 ignora a mudança feita com JWT de não-super).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { aplicaMod, voltaMod, modViva, MOD_MIGS } from "./mod-helpers";
import {
  MOD_MD5,
  MOD1_MODULOS,
  MOD1_ACL,
  MOD1_AUX,
  MOD_MIG,
  MOD_DOWN,
  MOD_DOWN_DROP,
} from "./mod-1-dados";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
const SUPER = USER_TESTE;
const U_COMUM = "0d0e1000-0000-4000-8000-0000000000c1";
const U_COMUM_AVE = "0d0e1000-0000-4000-8000-0000000000c2";
const RAND = "00000000-0d0e-4000-8000-00000000dead";
const R = `'${RAND}'::uuid`;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

// Todas as chaves de página do catálogo (menos a Integração, que só o super concede).
const PAGINAS = [
  ...new Set(
    [
      ...readFileSync(ROOT + "src/lib/permissions-catalog.ts", "utf8").matchAll(
        /key: "([a-z0-9_:]+)"/g,
      ),
    ].map((m) => m[1]),
  ),
].filter((k) => !k.startsWith("integracao"));

/** Chamada barata de cada wrapper (ids inexistentes; o erro, se houver, é o de sempre da função). */
const CHAMADA: Record<string, string> = {
  "public.dashboard_colecao(date,date,text,uuid,uuid)":
    "select public.dashboard_colecao(null::date, null::date, null::text, null::uuid, null::uuid)",
  "public.dashboard_custos(date,date,text,uuid,uuid)":
    "select public.dashboard_custos(null::date, null::date, null::text, null::uuid, null::uuid)",
  "public.dashboard_estoque()": "select public.dashboard_estoque()",
  "public.dashboard_estoque_parado()": "select public.dashboard_estoque_parado()",
  "public.dashboard_financeiro(date,date)":
    "select public.dashboard_financeiro(null::date, null::date)",
  "public.dashboard_leadtime()": "select public.dashboard_leadtime()",
  "public.dashboard_leadtime_itens(uuid,text,text)":
    "select public.dashboard_leadtime_itens(null::uuid, null::text, null::text)",
  "public.dashboard_producao(date,date,text,uuid)":
    "select public.dashboard_producao(null::date, null::date, null::text, null::uuid)",
  "public.dashboard_producao_servicos(date,date,text,uuid,text)":
    "select public.dashboard_producao_servicos(null::date, null::date, null::text, null::uuid, null::text)",
  "public.ranking_servicos(uuid)": `select public.ranking_servicos(${R})`,
  "public.ranking_oficinas(uuid)": `select public.ranking_oficinas(${R})`,
  "public.baixar_estoque_tecido_corte(uuid,integer)": `select public.baixar_estoque_tecido_corte(${R}, null::integer)`,
  "public.salvar_explosao_metragem(uuid,jsonb,integer)": `select public.salvar_explosao_metragem(${R}, '[]'::jsonb, null::integer)`,
  "public.salvar_explosao_aviamento_separar(uuid,jsonb,integer)": `select public.salvar_explosao_aviamento_separar(${R}, '[]'::jsonb, null::integer)`,
  "public.salvar_explosao_etiqueta_enviar(uuid,jsonb,integer)": `select public.salvar_explosao_etiqueta_enviar(${R}, '[]'::jsonb, null::integer)`,
  "public.voltar_modelo_desenvolvimento(uuid)": `select public.voltar_modelo_desenvolvimento(${R})`,
  "public.reverter_corte_tecido(uuid)": `select public.reverter_corte_tecido(${R})`,
  "public.enviar_modelo_para_cad(uuid,text,text)": `select public.enviar_modelo_para_cad(${R}, null::text, null::text)`,
  "public.salvar_plan_tecido(uuid,jsonb,integer)": `select public.salvar_plan_tecido(${R}, '{}'::jsonb, null::integer)`,
  "public.plan_tecido_criar_card(uuid,jsonb)": `select public.plan_tecido_criar_card(${R}, '{}'::jsonb)`,
  "public.plan_tecido_criar_cards(uuid,jsonb)": `select public.plan_tecido_criar_cards(${R}, '[]'::jsonb)`,
  "public.plan_tecido_aplicar_ao_modelo(uuid,jsonb,boolean)": `select public.plan_tecido_aplicar_ao_modelo(${R}, '{}'::jsonb, false)`,
  "public.aplicar_plan_tecido_grade(uuid,jsonb)": `select public.aplicar_plan_tecido_grade(${R}, '{}'::jsonb)`,
  "public.plan_tecido_fazer_pedido(uuid,jsonb,uuid[])": `select public.plan_tecido_fazer_pedido(${R}, '{}'::jsonb, array[]::uuid[])`,
  "public.plan_tecido_desfazer_pedido(uuid)": `select public.plan_tecido_desfazer_pedido(${R})`,
  "public.plan_tecido_set_oc_aplicada(uuid,uuid[])": `select public.plan_tecido_set_oc_aplicada(${R}, array[]::uuid[])`,
  "public.plan_tecido_set_paleta(uuid,jsonb)": `select public.plan_tecido_set_paleta(${R}, '[]'::jsonb)`,
  "public.plan_tecido_set_pedido_fotos(uuid,text,text[])": `select public.plan_tecido_set_pedido_fotos(${R}, 'x', array[]::text[])`,
  "public.plan_tecido_set_referencia(uuid,text[])": `select public.plan_tecido_set_referencia(${R}, array[]::text[])`,
  "public.plan_tecido_set_slot_oc(uuid,uuid,uuid[])": `select public.plan_tecido_set_slot_oc(${R}, ${R}, array[]::uuid[])`,
  "public.replicar_cards_plan_tecido(uuid,uuid,uuid[],integer)": `select public.replicar_cards_plan_tecido(${R}, ${R}, array[]::uuid[], 1)`,
  "public.criar_card_produto_acabado(uuid)": `select public.criar_card_produto_acabado(${R})`,
  "public.criar_cards_produto_acabado(uuid[])": `select public.criar_cards_produto_acabado(array[${R}])`,
  "public.criar_card_produto_importado(uuid)": `select public.criar_card_produto_importado(${R})`,
  "public.criar_cards_produto_importado(uuid[])": `select public.criar_cards_produto_importado(array[${R}])`,
  "public.receber_oc_p_acabado(uuid,jsonb,jsonb)": `select public.receber_oc_p_acabado(${R}, '{}'::jsonb, '{}'::jsonb)`,
  "public.receber_oc_importado(uuid,jsonb,jsonb)": `select public.receber_oc_importado(${R}, '{}'::jsonb, '{}'::jsonb)`,
};
const DASHBOARDS = Object.keys(MOD1_MODULOS).filter((s) => MOD1_MODULOS[s].grupo === "P4");
const TODOS_MODULOS = [
  "cadastro",
  "entrada_saida",
  "criacao",
  "producao",
  "financeiro",
  "dashboard",
  "otb",
  "produto_acabado",
  "produto_importado",
];

type Linha = Record<string, unknown>;
type Res = { ok: true; rows: Linha[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `role` (PostgREST real) num SAVEPOINT; erro volta ao savepoint. */
async function como(c: Client, role: "authenticated" | null, sql: string): Promise<Res> {
  await c.query("SAVEPOINT mod1");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT mod1");
    return { ok: true, rows: r.rows };
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("ROLLBACK TO SAVEPOINT mod1");
    await c.query("RELEASE SAVEPOINT mod1");
    return { ok: false, code: String(er.code ?? ""), msg: String(er.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
const NEG = (mods: string[]) => `42501 modulo_desligado: ${mods.join(",")}`;
async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "",
  ]);
}
/** Usuário COMUM (role user) da loja `t` com TODAS as páginas ver+editar (como postgres, sem JWT). */
async function usuarioComum(c: Client, uid: string, t: string): Promise<void> {
  await semJwt(c, async () => {
    await c.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [uid, `${uid}@teste`],
    );
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'Mod1 comum', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [uid, t, `${uid}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [uid]);
    await c.query(
      `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
       SELECT $1, $2, p, true, true FROM unnest($3::text[]) p`,
      [uid, t, PAGINAS],
    );
  });
}
/** Liga/desliga módulos da loja SEM claims (MOD-1: com JWT de não-super a mudança seria ignorada). */
async function modulos(c: Client, t: string, mods: Record<string, boolean>): Promise<void> {
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || $2::jsonb WHERE tenant_id = $1`,
      [t, JSON.stringify(mods)],
    ),
  );
}
const todos = (v: boolean) => Object.fromEntries(TODOS_MODULOS.map((m) => [m, v]));
async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaMod(c, 1); // idempotente (cópia já com a T1, ou MOD_TXN=1: pula)
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await usuarioComum(c, U_COMUM, T);
  await modulos(c, T, todos(true));
}
async function md5(c: Client, sig: string): Promise<string | null> {
  return (
    await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
      sig,
    ])
  ).m;
}

describe.skipIf(!RODA)(
  "mod T1 — portão de módulo nos 37 wrappers (usuário comum, como authenticated)",
  () => {
    it("anti-drift: os 37 wrappers do gerador têm chamada; grupos e módulos do plano", () => {
      expect(Object.keys(MOD_MD5).sort()).toEqual(Object.keys(CHAMADA).sort());
      expect(Object.keys(MOD_MD5).length).toBe(37);
      const porGrupo = (g: string) =>
        Object.values(MOD1_MODULOS).filter((x) => x.grupo === g).length;
      expect([porGrupo("P4"), porGrupo("P5"), porGrupo("P7"), porGrupo("P9")]).toEqual([
        11, 7, 13, 6,
      ]);
      expect(MOD1_MODULOS["public.dashboard_financeiro(date,date)"].modulos).toEqual([
        "dashboard",
        "financeiro",
      ]);
      expect(MOD1_MODULOS["public.receber_oc_p_acabado(uuid,jsonb,jsonb)"].modulos).toEqual([
        "criacao",
        "producao",
      ]);
      expect(MOD1_MODULOS["public.receber_oc_importado(uuid,jsonb,jsonb)"].modulos).toEqual([
        "criacao",
        "producao",
      ]);
      expect(PAGINAS.length).toBeGreaterThan(40);
    });

    it("módulo desligado → 42501 modulo_desligado: <chaves>; ligado → o portão passa (erro, se houver, é o de sempre)", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const falhas: string[] = [];
        for (const [sig, { modulos: mods }] of Object.entries(MOD1_MODULOS)) {
          // desliga TODOS os módulos que o wrapper passou a exigir (o resto ligado: os portões de antes passam)
          await jwt(c, null);
          await modulos(c, T, {
            ...todos(true),
            ...Object.fromEntries(mods.map((m) => [m, false])),
          });
          await jwt(c, U_COMUM);
          const r0 = txt(await como(c, "authenticated", CHAMADA[sig]));
          if (r0 !== NEG(mods)) falhas.push(`${sig} off: ${r0}`);
          // cada módulo sozinho desligado → só ele na mensagem
          if (mods.length > 1) {
            for (const m of mods) {
              await jwt(c, null);
              await modulos(c, T, { ...todos(true), [m]: false });
              await jwt(c, U_COMUM);
              const r = txt(await como(c, "authenticated", CHAMADA[sig]));
              if (r !== NEG([m])) falhas.push(`${sig} só ${m} off: ${r}`);
            }
          }
          await jwt(c, null);
          await modulos(c, T, todos(true));
          await jwt(c, U_COMUM);
          const r1 = txt(await como(c, "authenticated", CHAMADA[sig]));
          if (/modulo_desligado|sem_permissao_pagina|permission denied for function/.test(r1))
            falhas.push(`${sig} on: ${r1}`);
        }
        expect(falhas).toEqual([]);
      });
    });

    it("dashboard_financeiro: financeiro off + dashboard on → modulo_desligado: financeiro; os outros 10 passam", async () => {
      await withTx(async (c) => {
        await prepara(c);
        await modulos(c, T, { ...todos(true), financeiro: false });
        await jwt(c, U_COMUM);
        const falhas: string[] = [];
        for (const sig of DASHBOARDS) {
          const r = txt(await como(c, "authenticated", CHAMADA[sig]));
          const esperado = sig === "public.dashboard_financeiro(date,date)";
          if (esperado ? r !== NEG(["financeiro"]) : /modulo_desligado/.test(r))
            falhas.push(`${sig}: ${r}`);
        }
        expect(falhas).toEqual([]);
      });
    });

    it("super admin com os módulos desligados passa (atalho de tenant_module_enabled; M2)", async () => {
      await withTx(async (c) => {
        await prepara(c);
        await modulos(c, T, {
          ...todos(false),
          cadastro: true,
          produto_acabado: true,
          produto_importado: true,
        });
        await jwt(c, SUPER);
        const falhas: string[] = [];
        for (const sig of Object.keys(MOD1_MODULOS)) {
          const r = txt(await como(c, "authenticated", CHAMADA[sig]));
          if (/modulo_desligado/.test(r)) falhas.push(`${sig}: ${r}`);
        }
        expect(falhas).toEqual([]);
      });
    });

    it("igualdade de dado: com tudo ligado, os 11 Dashboards da Ave Rara (usuário comum) devolvem o MESMO jsonb antes e depois", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '300s'");
        await voltaMod(c); // estado de ANTES (a cópia pode já estar com a T1)
        expect(await modViva(c, 1)).toBe(false);
        await usuarioComum(c, U_COMUM_AVE, AVE_RARA);
        await modulos(c, AVE_RARA, {
          dashboard: true,
          financeiro: true,
          criacao: true,
          producao: true,
          entrada_saida: true,
        });
        const le = async () => {
          await jwt(c, U_COMUM_AVE);
          const out: Record<string, string> = {};
          for (const sig of DASHBOARDS) {
            const r = await como(c, "authenticated", CHAMADA[sig]);
            out[sig] = r.ok ? `PASSOU ${JSON.stringify(r.rows[0])}` : txt(r);
          }
          await jwt(c, null);
          return out;
        };
        const antes = await le();
        await aplicaMod(c, 1);
        expect(await modViva(c, 1)).toBe(true);
        const depois = await le();
        for (const sig of DASHBOARDS) {
          expect(antes[sig].startsWith("PASSOU"), `${sig}: ${antes[sig].slice(0, 200)}`).toBe(true);
          expect(depois[sig], sig).toBe(antes[sig]);
        }
      });
    });
  },
);

describe.skipIf(!RODA)("mod T1 — auxiliares", () => {
  it("_tenant_modulo_ligado ≡ tenant_module_enabled para usuário comum (chave ligada, desligada e AUSENTE); difere do super (M2)", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const chaves = [...TODOS_MODULOS, "distribuicao", "etapas_pl", "chave_que_nao_existe"];
      const falhas: string[] = [];
      for (const estado of ["ligado", "desligado", "ausente"] as const) {
        await jwt(c, null);
        await semJwt(c, () =>
          c.query(
            `UPDATE public.tenant_config SET modules = CASE $2 WHEN 'ausente' THEN '{}'::jsonb
             ELSE (SELECT jsonb_object_agg(k, $2 = 'ligado') FROM unnest($3::text[]) k) END WHERE tenant_id = $1`,
            [T, estado, chaves],
          ),
        );
        for (const m of chaves) {
          const loja = (
            await um<{ v: boolean }>(c, "SELECT public._tenant_modulo_ligado($1, $2) AS v", [T, m])
          ).v;
          await jwt(c, U_COMUM);
          const jwtv = (
            await um<{ v: boolean }>(c, "SELECT public.tenant_module_enabled($1) AS v", [m])
          ).v;
          await jwt(c, null);
          if (loja !== jwtv) falhas.push(`${estado} ${m}: loja=${loja} jwt=${jwtv}`);
        }
      }
      // loja sem tenant_config = padrão (otb etc. desligados; clássicos ligados)
      const sem = "00000000-0d0e-4000-8000-0000000000ff";
      expect(
        (
          await um<{ v: boolean }>(c, "SELECT public._tenant_modulo_ligado($1, 'criacao') AS v", [
            sem,
          ])
        ).v,
      ).toBe(true);
      expect(
        (await um<{ v: boolean }>(c, "SELECT public._tenant_modulo_ligado($1, 'otb') AS v", [sem]))
          .v,
      ).toBe(false);
      // super admin: tenant_module_enabled fura (true); _tenant_modulo_ligado não (o módulo da LOJA)
      await modulos(c, T, { producao: false });
      await jwt(c, SUPER);
      expect(
        (await um<{ v: boolean }>(c, "SELECT public.tenant_module_enabled('producao') AS v")).v,
      ).toBe(true);
      expect(
        (
          await um<{ v: boolean }>(c, "SELECT public._tenant_modulo_ligado($1, 'producao') AS v", [
            T,
          ])
        ).v,
      ).toBe(false);
      expect(falhas).toEqual([]);
    });
  });

  it("_exige_modulos: ordem da mensagem = ordem dos argumentos; nada desligado = passa; authenticated executa; _tenant_modulo_ligado não", async () => {
    await withTx(async (c) => {
      await prepara(c);
      await modulos(c, T, { ...todos(true), producao: false, criacao: false });
      await jwt(c, U_COMUM);
      expect(
        txt(
          await como(
            c,
            "authenticated",
            "select public._exige_modulos('producao', 'dashboard', 'criacao')",
          ),
        ),
      ).toBe(NEG(["producao", "criacao"]));
      expect(
        txt(
          await como(c, "authenticated", "select public._exige_modulos('dashboard', 'financeiro')"),
        ),
      ).toBe("PASSOU");
      expect(
        txt(
          await como(
            c,
            "authenticated",
            `select public._tenant_modulo_ligado('${T}'::uuid, 'criacao')`,
          ),
        ),
      ).toMatch(/^42501 permission denied for function _tenant_modulo_ligado/);
    });
  });
});

describe.skipIf(!RODA)(
  "mod T1 — migration (idempotente, _down neutro, _down_drop, pós-condições)",
  () => {
    it("ida 2×; _down → md5 de antes; ida de novo → depois; _down_drop recusa com a ida viva e derruba os 2 depois do _down", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '180s'");
        await voltaMod(c);
        const confere = async (qual: "antes" | "depois") => {
          for (const [sig, m] of Object.entries(MOD_MD5))
            expect(await md5(c, sig), `${sig} ${qual}`).toBe(m[qual]);
        };
        await confere("antes");
        await aplicarArquivo(c, MOD_MIG);
        await aplicarArquivo(c, MOD_MIG); // idempotente
        await confere("depois");
        for (const [sig, m] of Object.entries(MOD1_AUX)) expect(await md5(c, sig), sig).toBe(m);
        // pós-condições de ACL (as mesmas do $pos$, conferidas por fora)
        for (const [sig, { acl, definer }] of Object.entries(MOD1_ACL)) {
          const r = await um<Linha>(
            c,
            `select coalesce(p.proacl::text,'') acl, p.prosecdef sd, p.proconfig cfg,
            has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth
          from pg_proc p where p.oid = to_regprocedure($1)`,
            [sig],
          );
          expect([r.acl, r.sd, r.cfg, r.anon, r.auth], sig).toEqual([
            acl,
            definer,
            ["search_path=public"],
            false,
            true,
          ]);
        }
        const aux = async (sig: string) =>
          um<Linha>(
            c,
            `select p.prosecdef sd, p.proconfig cfg,
          has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
          has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
          exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0) pub
        from pg_proc p where p.oid = to_regprocedure($1)`,
            [sig],
          );
        expect(await aux("public._exige_modulos(text[])")).toEqual({
          sd: true,
          cfg: ["search_path=public"],
          anon: false,
          auth: true,
          svc: true,
          pub: false,
        });
        expect(await aux("public._tenant_modulo_ligado(uuid,text)")).toEqual({
          sd: true,
          cfg: ["search_path=public"],
          anon: false,
          auth: false,
          svc: true,
          pub: false,
        });
        // _down_drop recusa enquanto a ida está viva (SAVEPOINT do harness: a txn segue usável)
        await expect(aplicarArquivo(c, MOD_DOWN_DROP)).rejects.toThrow(
          /mod1_drop: rode o _down antes/,
        );
        // _down neutro → antes (auxiliares ficam); de novo (idempotente)
        await aplicarArquivo(c, MOD_DOWN);
        await aplicarArquivo(c, MOD_DOWN);
        await confere("antes");
        for (const sig of Object.keys(MOD1_AUX))
          expect(await md5(c, sig), `${sig} fica`).toBe(MOD1_AUX[sig]);
        // ida de novo → depois
        await aplicarArquivo(c, MOD_MIG);
        await confere("depois");
        // volta tudo e derruba os auxiliares (blocos mais novos que criem quem os cite saem antes pelo _down_drop deles)
        await voltaMod(c);
        for (const b of [...MOD_MIGS].reverse()) {
          if (b.n === 1 || b.n === 4) continue;
          const drop = b.downs[0]?.replace(/_down\.sql$/, "_down_drop.sql");
          if (drop && existsSync(ROOT + drop)) await aplicarArquivo(c, drop);
        }
        await aplicarArquivo(c, MOD_DOWN_DROP);
        for (const sig of Object.keys(MOD1_AUX))
          expect(await md5(c, sig), `${sig} apagado`).toBeNull();
        await confere("antes");
      });
    });
  },
);
