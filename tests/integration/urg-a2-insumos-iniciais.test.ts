// Urgentes R2 T10 (plan-a Task 10 ampliada pela P-306 B; Rulings A10, A12, A14) - "Insumos padrao" da loja na CRIACAO do card
// interno (20261103175000):
//   - RPC NOVA salvar_insumos_iniciais(_modelo_id, _linhas): o cliente grava o BOM inicial de insumo logo depois do INSERT do card
//     ("+ Novo" e "Criar varios cards"); login -> modulo Criacao -> pagina Planejamento OU Desenvolvimento -> card da loja -> so
//     interno -> so sem insumos -> valida (<= 20; insumo/cor da loja; consumo 0..9999).
//   - helper NOVO _insumos_padrao_aplicar(_modelo_id): le tenant_config.insumos_padrao (pode estar CRUA - escrita direta do admin),
//     RE-VALIDA e grava; nunca derruba a criacao (WARNING + 0). Chamado pelos criadores do SERVIDOR: _plan_tecido_criar_card_core
//     (Plan. Tecido "Criar card" e "Criar cards") e importar_modelo_linha (Importar dados).
//   - INTOCADOS: otb_confirmar/_pv (nao criam card), Replicar, revenda/importado, simulador.
// Txn revertida; o bloco e aplicado DENTRO da txn por aplicaUrgA(c, "175000") (pula se ja vivo). So na copia local. Chamadas como o
// PAPEL do PostgREST (SET LOCAL ROLE authenticated) com JWT de usuario COMUM criado na txn e paginas explicitas.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { appendFileSync } from "node:fs";
import { hasDb, withTx, um, semJwt, ehBancoLocal, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicaUrgA, urgAViva, URG_A_MIGS } from "./urg-a-helpers";
import { aplicarArquivo, exigeBancoLocal } from "./mig-txn";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const RPC = "public.salvar_insumos_iniciais(uuid,jsonb)";
const HELPER = "public._insumos_padrao_aplicar(uuid)";
const PTC = "public._plan_tecido_criar_card_core(uuid,uuid,jsonb)";
const IMP = "public.importar_modelo_linha(jsonb,jsonb)";
const ANTES: Record<string, string> = {
  [PTC]: "fceac02c52bd0b29a33856dc9e0f9b11",
  [IMP]: "db0c3dcbd90ded80d210b96747e01cb1",
};
/** Criadores de card que P-306 B manda NAO tocar (copiam da origem / comprado / mortos / nao criam card). */
const INTOCADAS = [
  "public._replicar_cards_plan_tecido_core(uuid,uuid,uuid,uuid[],integer)",
  "public._replicar_produtos_acabados_core(uuid,uuid,uuid,uuid[])",
  "public._replicar_produtos_importados_core(uuid,uuid,uuid,uuid[])",
  "public._criar_card_produto_acabado_core(uuid)",
  "public._criar_card_produto_importado_core(uuid)",
  "public.criar_card_simulacao(uuid,uuid,text,uuid,uuid,uuid,jsonb,jsonb)",
  "public.otb_confirmar(uuid)",
  "public.otb_confirmar_pv(uuid)",
];
const U_PLAN = "a10e0000-0000-4000-8000-0000000000a1"; // so Planejamento
const U_DEV = "a10e0000-0000-4000-8000-0000000000a2"; // so Desenvolvimento
const U_NADA = "a10e0000-0000-4000-8000-0000000000a3"; // so Plan. Tecido (nem Planejamento nem Dev)
const U_IMP = "a10e0000-0000-4000-8000-0000000000a4"; // so Importar
const RAND = "00000000-a10e-4000-8000-00000000dead";

const bloco = () => URG_A_MIGS.find((x) => x.id === "175000")?.b;

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `authenticated` (PostgREST real) num SAVEPOINT; erro volta ao savepoint. */
async function como(c: Client, sql: string, params: any[] = [], role: "authenticated" | "anon" | null = "authenticated"): Promise<Res> {
  await c.query("SAVEPOINT a10");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT a10");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT a10");
    await c.query("RELEASE SAVEPOINT a10");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
}
async function usuario(c: Client, uid: string, paginas: string[]): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'URG-A10', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [uid, T, `${uid}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [uid]);
    await c.query(
      `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
       SELECT $1, $2, p, true, true FROM unnest($3::text[]) p`,
      [uid, T, paginas],
    );
  });
}
async function modulos(c: Client, mods: Record<string, boolean>): Promise<void> {
  await semJwt(c, () =>
    c.query(`UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || $2::jsonb WHERE tenant_id = $1`, [T, JSON.stringify(mods)]),
  );
}
/** Grava a lista da loja CRUA (como o admin poderia, por UPDATE direto) - sem validacao. */
async function listaCrua(c: Client, lista: unknown, tenant = T): Promise<void> {
  await semJwt(c, () => c.query(`UPDATE public.tenant_config SET insumos_padrao = $2::jsonb WHERE tenant_id = $1`, [tenant, JSON.stringify(lista)]));
}
async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
async function aplica(c: Client, rel: string): Promise<void> {
  await aplicarArquivo(c, rel);
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}
type Linha = { e: string; c: string | null; n: number; q: number; l: number };
async function linhas(c: Client, modelo: string): Promise<Linha[]> {
  const { rows } = await c.query(
    `SELECT etiqueta_id::text AS e, cor_id::text AS c, numero AS n, consumo::float8 AS q, loss_percent::float8 AS l
       FROM public.modelo_etiquetas WHERE modelo_id = $1 ORDER BY numero, created_at`,
    [modelo],
  );
  return rows as Linha[];
}
async function imediato(c: Client): Promise<void> {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}

type Fx = {
  outra: string; E1: string; E2: string; E3: string; EOUT: string; C1: string; C2: string; COUT: string;
  muitos: string[]; col: string; colOutra: string; cat: string;
};
const id = async (c: Client, sql: string, p: unknown[] = []) => (await um<{ id: string }>(c, sql, p)).id;
/** Bloco vivo na txn + fixture (como postgres, sem JWT) + 4 usuarios comuns + modulos Criacao/OTB ligados. */
async function prepara(c: Client): Promise<Fx> {
  exigeBancoLocal();
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  await aplicaUrgA(c, "175000");
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  const outra = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [T])).id;
  const fx = await semJwt(c, async () => {
    const etq = (tenant: string, nome: string, preco: number | null) =>
      id(c, "INSERT INTO public.etiquetas (tenant_id, nome, preco) VALUES ($1, $2, $3) RETURNING id", [tenant, nome, preco]);
    const cor = (tenant: string, nome: string) => id(c, "INSERT INTO public.cores (tenant_id, nome) VALUES ($1, $2) RETURNING id", [tenant, nome]);
    const E1 = await etq(T, "URG-A10 E1", 2);
    const E2 = await etq(T, "URG-A10 E2", 3);
    const E3 = await etq(T, "URG-A10 E3 com cor", 1);
    const EOUT = await etq(outra, "URG-A10 E OUTRA", 1);
    const C1 = await cor(T, "URG-A10 C1");
    const C2 = await cor(T, "URG-A10 C2");
    const COUT = await cor(outra, "URG-A10 C OUTRA");
    await c.query("INSERT INTO public.variantes_etiqueta (tenant_id, etiqueta_id, cor_id, preco) VALUES ($1, $2, $3, 5)", [T, E3, C1]);
    const muitos: string[] = [];
    for (let i = 0; i < 25; i++) muitos.push(await etq(T, `URG-A10 M${String(i).padStart(2, "0")}`, 1));
    const col = await id(c, "INSERT INTO public.colecoes (tenant_id, nome, status) VALUES ($1, 'URG-A10 col', 'rascunho') RETURNING id", [T]);
    const colOutra = await id(c, "INSERT INTO public.colecoes (tenant_id, nome, status) VALUES ($1, 'URG-A10 col outra', 'rascunho') RETURNING id", [outra]);
    const cat = await id(c, "INSERT INTO public.categorias_produto (tenant_id, nome) VALUES ($1, 'URG-A10 cat') RETURNING id", [T]);
    return { outra, E1, E2, E3, EOUT, C1, C2, COUT, muitos, col, colOutra, cat };
  });
  await usuario(c, U_PLAN, ["criacao_planejamento"]);
  await usuario(c, U_DEV, ["criacao_desenvolvimento"]);
  await usuario(c, U_NADA, ["criacao_plan_tecido"]);
  await usuario(c, U_IMP, ["importar"]);
  await modulos(c, { criacao: true, otb: true });
  await listaCrua(c, []);
  return fx;
}
const card = (c: Client, origem = "interno", tenant = T) =>
  semJwt(c, () => id(c, "INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1, $2, $3) RETURNING id", [tenant, `URG-A10 card ${origem}`, origem]));
const CHAMA = "SELECT public.salvar_insumos_iniciais($1::uuid, $2::jsonb) AS n";
const salvar = (c: Client, modelo: string, l: unknown) => como(c, CHAMA, [modelo, JSON.stringify(l)]);

describe.skipIf(!RODA)("urg R2 T10 - insumos padrao na criacao do card interno (175000)", () => {
  it("bloco registrado e vivo na txn; ACL: RPC so authenticated/service_role; helper sem PUBLIC/anon/authenticated", async () => {
    expect(bloco(), "bloco 175000 ausente em urg-a-dados.ts (rode o gerar-a2.mjs 175000)").toBeTruthy();
    await withTx(async (c) => {
      await prepara(c);
      expect(await urgAViva(c, "175000")).toBe(true);
      const acl = async (sig: string) =>
        um<{ p: boolean; a: boolean; u: boolean; s: boolean; sd: boolean; cfg: string[] }>(
          c,
          `SELECT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0) AS p,
                  has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u,
                  has_function_privilege('service_role', p.oid, 'EXECUTE') AS s, p.prosecdef AS sd, p.proconfig AS cfg
             FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
          [sig],
        );
      expect(await acl(RPC)).toEqual({ p: false, a: false, u: true, s: true, sd: true, cfg: ["search_path=public"] });
      expect(await acl(HELPER)).toMatchObject({ p: false, a: false, u: false, sd: true, cfg: ["search_path=public"] });
      // anon e o cliente nao chamam o helper
      const m = await card(c);
      await jwt(c, U_PLAN);
      expect(txt(await como(c, "SELECT public._insumos_padrao_aplicar($1)", [m]))).toMatch(/^42501 permission denied for function/);
      expect(txt(await como(c, CHAMA, [m, "[]"], "anon"))).toMatch(/^42501 permission denied for function/);
    });
  });

  it("RPC: usuario SO Planejamento grava N linhas na ordem (numero, cor, consumo, perda 0); custo pela fila no COMMIT; 2a chamada recusa", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const m = await card(c);
      await jwt(c, U_PLAN);
      const r = await salvar(c, m, [
        { etiqueta_id: fx.E1, cor_id: null, consumo: 1.5, loss_percent: 10 }, // Perda % do Dialog (fix round 1)
        { etiqueta_id: fx.E3.toUpperCase(), cor_id: fx.C1, consumo: 2, loss_percent: null }, // null = 0
        { etiqueta_id: fx.E2, cor_id: "", consumo: 0, loss_percent: 99.99 },
        { etiqueta_id: fx.E1, consumo: 0.2525 }, // repetido e aceito (o editor permite; so a lista da loja barra par repetido); sem perda = 0
      ]);
      expect(txt(r)).toBe("PASSOU");
      expect(r.ok && r.rows[0].n).toBe(4);
      expect(await linhas(c, m)).toEqual([
        { e: fx.E1, c: null, n: 1, q: 1.5, l: 10 },
        { e: fx.E3, c: fx.C1, n: 2, q: 2, l: 0 },
        { e: fx.E2, c: null, n: 3, q: 0, l: 99.99 },
        { e: fx.E1, c: null, n: 4, q: 0.2525, l: 0 },
      ]);
      await imediato(c);
      const { rows } = await c.query(`SELECT numero, custo_previsto::float8 AS v FROM public.modelo_etiquetas WHERE modelo_id = $1 ORDER BY numero`, [m]);
      expect(rows.map((x) => x.v)).toEqual([3.3, 10, 0, 0.51]); // 2 x 1,5 x 1,1 ; 5 (variante da cor) x 2 ; 3 x 0 ; 2 x 0,2525 = 0,505 -> 0,51
      const r2 = await salvar(c, m, [{ etiqueta_id: fx.E2, consumo: 1 }]);
      expect(txt(r2)).toBe("P0001 insumos_iniciais_ja_existem: o card ja tem insumos");
      expect((await linhas(c, m)).length).toBe(4);
      // so Desenvolvimento tambem grava (OU); lista vazia = 0, nada gravado
      const m2 = await card(c);
      await jwt(c, U_DEV);
      expect(txt(await salvar(c, m2, [{ etiqueta_id: fx.E2, consumo: 3 }]))).toBe("PASSOU");
      const m3 = await card(c);
      const r3 = await salvar(c, m3, []);
      expect(r3.ok && r3.rows[0].n).toBe(0);
      expect(await linhas(c, m3)).toEqual([]);
    });
  });

  it("RPC: recusas - revenda, outra loja, sem pagina, Criacao desligada, sem login (nada gravado)", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const L = [{ etiqueta_id: fx.E1, consumo: 1 }];
      const rev = await card(c, "revenda");
      const imp = await card(c, "importado");
      const outraLoja = await card(c, "interno", fx.outra);
      const m = await card(c);
      await jwt(c, U_PLAN);
      expect(txt(await salvar(c, rev, L))).toBe("P0001 insumos_iniciais_so_interno: o card nao e interno");
      expect(txt(await salvar(c, imp, L))).toBe("P0001 insumos_iniciais_so_interno: o card nao e interno");
      expect(txt(await salvar(c, outraLoja, L))).toBe("P0001 nao_encontrado: modelo");
      expect(txt(await salvar(c, RAND, L))).toBe("P0001 nao_encontrado: modelo");
      await jwt(c, U_NADA);
      // sem oraculo: o portao vem antes da busca (id inexistente e sem permissao = o MESMO 42501)
      expect(txt(await salvar(c, m, L))).toBe("42501 sem_permissao_pagina: criacao_planejamento|criacao_desenvolvimento");
      expect(txt(await salvar(c, RAND, L))).toBe("42501 sem_permissao_pagina: criacao_planejamento|criacao_desenvolvimento");
      await modulos(c, { criacao: false });
      await jwt(c, U_PLAN);
      expect(txt(await salvar(c, m, L))).toBe("42501 modulo_desligado: criacao");
      await modulos(c, { criacao: true });
      await jwt(c, null);
      expect(txt(await salvar(c, m, L))).toBe("42501 nao_autenticado: login");
      for (const x of [rev, imp, outraLoja, m]) expect(await linhas(c, x)).toEqual([]);
    });
  });

  it("RPC: validacao da lista - P0001 insumos_iniciais_invalidos (1a falha decide, linha N 1-based), nada gravado", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const m = await card(c);
      await jwt(c, U_PLAN);
      const ok = { etiqueta_id: fx.E1, consumo: 1 };
      const casos: [unknown, string][] = [
        [{ x: 1 }, "precisa ser uma lista"],
        [null, "precisa ser uma lista"],
        [Array.from({ length: 21 }, (_, i) => ({ etiqueta_id: fx.muitos[i % 25], consumo: 1 })), "no maximo 20 linhas (veio 21)"],
        [[ok, "x"], "linha 2: formato invalido"],
        [[{ consumo: 1 }], "linha 1: insumo nao encontrado nesta loja"],
        [[{ etiqueta_id: 5, consumo: 1 }], "linha 1: insumo nao encontrado nesta loja"],
        [[{ etiqueta_id: "nao-uuid", consumo: 1 }], "linha 1: insumo nao encontrado nesta loja"],
        [[ok, { etiqueta_id: fx.EOUT, consumo: 1 }], "linha 2: insumo nao encontrado nesta loja"],
        [[{ etiqueta_id: RAND, consumo: 1 }], "linha 1: insumo nao encontrado nesta loja"],
        [[{ etiqueta_id: fx.E1, cor_id: fx.COUT, consumo: 1 }], "linha 1: cor nao encontrada nesta loja"],
        [[{ etiqueta_id: fx.E1, cor_id: "zz", consumo: 1 }], "linha 1: cor nao encontrada nesta loja"],
        [[{ etiqueta_id: fx.E1, cor_id: 7, consumo: 1 }], "linha 1: cor nao encontrada nesta loja"],
        [[{ etiqueta_id: fx.E1, consumo: "1" }], "linha 1: consumo precisa ser um numero de 0 a 9999"],
        [[{ etiqueta_id: fx.E1 }], "linha 1: consumo precisa ser um numero de 0 a 9999"],
        [[{ etiqueta_id: fx.E1, consumo: -0.1 }], "linha 1: consumo precisa ser um numero de 0 a 9999"],
        [[{ etiqueta_id: fx.E1, consumo: 10000 }], "linha 1: consumo precisa ser um numero de 0 a 9999"],
        [[{ etiqueta_id: fx.E1, consumo: 1.00001 }], "linha 1: consumo com no maximo 4 casas decimais"],
        [[ok, { etiqueta_id: fx.E1, consumo: 1, loss_percent: "5" }], "linha 2: perda precisa ser um numero de 0 a 100"],
        [[{ etiqueta_id: fx.E1, consumo: 1, loss_percent: true }], "linha 1: perda precisa ser um numero de 0 a 100"],
        [[{ etiqueta_id: fx.E1, consumo: 1, loss_percent: -0.01 }], "linha 1: perda precisa ser um numero de 0 a 100"],
        [[{ etiqueta_id: fx.E1, consumo: 1, loss_percent: 100.01 }], "linha 1: perda precisa ser um numero de 0 a 100"],
        [[{ etiqueta_id: fx.E1, consumo: 1, loss_percent: 1.234 }], "linha 1: perda com no maximo 2 casas decimais"],
      ];
      for (const [l, msg] of casos) expect(txt(await salvar(c, m, l)), JSON.stringify(l).slice(0, 80)).toBe(`P0001 insumos_iniciais_invalidos: ${msg}`);
      expect(await linhas(c, m)).toEqual([]);
      // 20 linhas = o limite (passa)
      const r = await salvar(c, m, fx.muitos.slice(0, 20).map((e, i) => ({ etiqueta_id: e, consumo: 9999, loss_percent: i === 0 ? 100 : 0 })));
      expect(r.ok && r.rows[0].n).toBe(20);
      expect((await linhas(c, m))[0]).toMatchObject({ q: 9999, l: 100 });
    });
  });

  it("helper: lista CRUA (escrita direta) re-validada - ignora o que nao serve, cor fora das variantes vira sem cor, par repetido fica o 1o, ate 20", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      await listaCrua(c, [
        "texto",
        { etiqueta_id: "nao-uuid", consumo: 1 },
        { etiqueta_id: RAND, consumo: 1 }, // apagado/inexistente
        { etiqueta_id: fx.EOUT, consumo: 1 }, // outra loja
        { etiqueta_id: fx.E1, consumo: "1" },
        { etiqueta_id: fx.E1, consumo: -1 },
        { etiqueta_id: fx.E1, consumo: 10000 },
        { etiqueta_id: fx.E1, consumo: null },
        { etiqueta_id: fx.E1, consumo: 1.23456 }, // mais de 4 casas (so por escrita crua; a Config recusa) -> ignora
        { etiqueta_id: fx.E1.toUpperCase(), cor_id: fx.COUT, consumo: 1.5 }, // cor de outra loja -> sem cor
        { etiqueta_id: fx.E3, cor_id: fx.C1, consumo: 2 },
        { etiqueta_id: fx.E3, cor_id: fx.C2, consumo: 4 }, // C2 nao e variante de E3 -> sem cor
        { etiqueta_id: fx.E1, consumo: 9 }, // (E1, sem cor) repetido -> ignora
        { etiqueta_id: fx.E2, cor_id: 5, consumo: 0 }, // cor de outro tipo -> sem cor
        { etiqueta_id: fx.E2, cor_id: "", consumo: 0 }, // repetido -> ignora
      ]);
      const m = await card(c);
      expect((await um<{ n: number }>(c, "SELECT public._insumos_padrao_aplicar($1) AS n", [m])).n).toBe(4);
      expect(await linhas(c, m)).toEqual([
        { e: fx.E1, c: null, n: 1, q: 1.5, l: 0 },
        { e: fx.E3, c: fx.C1, n: 2, q: 2, l: 0 },
        { e: fx.E3, c: null, n: 3, q: 4, l: 0 },
        { e: fx.E2, c: null, n: 4, q: 0, l: 0 },
      ]);
      // 2a chamada: o card ja tem insumos -> 0, nada muda
      expect((await um<{ n: number }>(c, "SELECT public._insumos_padrao_aplicar($1) AS n", [m])).n).toBe(0);
      expect((await linhas(c, m)).length).toBe(4);
      // ate 20 (os 20 primeiros VALIDOS, na ordem)
      await listaCrua(c, [{ etiqueta_id: RAND, consumo: 1 }, ...fx.muitos.map((e) => ({ etiqueta_id: e, consumo: 1 }))]);
      const m2 = await card(c);
      expect((await um<{ n: number }>(c, "SELECT public._insumos_padrao_aplicar($1) AS n", [m2])).n).toBe(20);
      expect((await linhas(c, m2)).map((x) => x.e)).toEqual(fx.muitos.slice(0, 20));
      // revenda/importado, card inexistente, lista que nao e array: 0
      for (const o of ["revenda", "importado"]) {
        const x = await card(c, o);
        expect((await um<{ n: number }>(c, "SELECT public._insumos_padrao_aplicar($1) AS n", [x])).n).toBe(0);
        expect(await linhas(c, x)).toEqual([]);
      }
      expect((await um<{ n: number }>(c, "SELECT public._insumos_padrao_aplicar($1) AS n", [RAND])).n).toBe(0);
      await listaCrua(c, { etiqueta_id: fx.E1, consumo: 1 });
      const m3 = await card(c);
      expect((await um<{ n: number }>(c, "SELECT public._insumos_padrao_aplicar($1) AS n", [m3])).n).toBe(0);
      // a lista de OUTRA loja nunca entra no card desta
      await listaCrua(c, []);
      await listaCrua(c, [{ etiqueta_id: fx.EOUT, consumo: 1 }], fx.outra);
      const m4 = await card(c);
      expect((await um<{ n: number }>(c, "SELECT public._insumos_padrao_aplicar($1) AS n", [m4])).n).toBe(0);
    });
  });

  it("Plan. Tecido: 'Criar card' e 'Criar cards' (usuario SO Plan. Tecido) nascem com a lista da loja; lista vazia = nada (como antes)", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      await jwt(c, U_NADA);
      const vazio = await como(c, "SELECT public.plan_tecido_criar_card($1, $2::jsonb) AS id", [fx.col, JSON.stringify({ nome: "PT vazio", materiais: [] })]);
      expect(txt(vazio)).toBe("PASSOU");
      expect(await linhas(c, (vazio as any).rows[0].id)).toEqual([]);
      await listaCrua(c, [{ etiqueta_id: fx.E1, cor_id: null, consumo: 1.5 }, { etiqueta_id: fx.E3, cor_id: fx.C1, consumo: 2 }]);
      const esperado = [
        { e: fx.E1, c: null, n: 1, q: 1.5, l: 0 },
        { e: fx.E3, c: fx.C1, n: 2, q: 2, l: 0 },
      ];
      const um1 = await como(c, "SELECT public.plan_tecido_criar_card($1, $2::jsonb) AS id", [fx.col, JSON.stringify({ nome: "PT 1", materiais: [] })]);
      expect(txt(um1)).toBe("PASSOU");
      expect(await linhas(c, (um1 as any).rows[0].id)).toEqual(esperado);
      const lote = await como(c, "SELECT public.plan_tecido_criar_cards($1, $2::jsonb) AS r", [
        fx.col,
        JSON.stringify([{ nome: "PT L1", materiais: [] }, { nome: "PT L2", materiais: [] }, { nome: "PT L3", materiais: [] }]),
      ]);
      expect(txt(lote)).toBe("PASSOU");
      const ids = ((lote as any).rows[0].r as { modelo_id: string }[]).map((x) => x.modelo_id);
      expect(ids.length).toBe(3);
      for (const x of ids) expect(await linhas(c, x)).toEqual(esperado);
      await imediato(c);
      const custo = await um<{ v: number }>(c, "SELECT sum(custo_previsto)::float8 AS v FROM public.modelo_etiquetas WHERE modelo_id = ANY ($1::uuid[])", [ids]);
      expect(custo.v).toBe(3 * (3 + 10));
    });
  });

  it("Importar dados: o card CRIADO nasce com a lista; 'inalterado' (ja existe) nao mexe", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      await listaCrua(c, [{ etiqueta_id: fx.E2, consumo: 3 }]);
      await jwt(c, U_IMP);
      const nome = `URG-A10 importado ${Date.now()}`;
      const r = await como(c, "SELECT public.importar_modelo_linha($1::jsonb, '[]'::jsonb) AS r", [JSON.stringify({ nome, categoria_principal_id: fx.cat })]);
      expect(txt(r)).toBe("PASSOU");
      const res = (r as any).rows[0].r as { modelo_id: string; acao: string };
      expect(res.acao).toBe("criado");
      expect(await linhas(c, res.modelo_id)).toEqual([{ e: fx.E2, c: null, n: 1, q: 3, l: 0 }]);
      await listaCrua(c, [{ etiqueta_id: fx.E1, consumo: 1 }]);
      const r2 = await como(c, "SELECT public.importar_modelo_linha($1::jsonb, '[]'::jsonb) AS r", [JSON.stringify({ nome, categoria_principal_id: fx.cat })]);
      expect(((r2 as any).rows[0].r as { acao: string }).acao).toBe("inalterado");
      expect(await linhas(c, res.modelo_id)).toEqual([{ e: fx.E2, c: null, n: 1, q: 3, l: 0 }]);
    });
  });

  it("nunca derruba a criacao: erro ao gravar os insumos vira WARNING (ASCII) e o card nasce sem eles", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      await listaCrua(c, [{ etiqueta_id: fx.E1, consumo: 1 }]);
      // falha simulada SO nesta txn (copia local): qualquer INSERT em modelo_etiquetas explode
      await c.query(`CREATE FUNCTION pg_temp.urg_a10_boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom ç'; END $$`);
      await c.query(`CREATE TRIGGER urg_a10_boom BEFORE INSERT ON public.modelo_etiquetas FOR EACH ROW EXECUTE FUNCTION pg_temp.urg_a10_boom()`);
      const avisos: string[] = [];
      const ouve = (n: any) => avisos.push(`${n.severity}: ${n.message}`);
      c.on("notice", ouve);
      try {
        await jwt(c, U_NADA);
        const r = await como(c, "SELECT public.plan_tecido_criar_card($1, $2::jsonb) AS id", [fx.col, JSON.stringify({ nome: "PT boom", materiais: [] })]);
        expect(txt(r)).toBe("PASSOU");
        const mid = (r as any).rows[0].id as string;
        expect((await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.modelos WHERE id = $1", [mid])).n).toBe(1);
        expect(await linhas(c, mid)).toEqual([]);
        const w = avisos.filter((a) => a.includes("insumos padrao nao aplicados"));
        expect(w.length).toBe(1);
        expect(w[0]).toMatch(/^WARNING: insumos padrao nao aplicados ao card [0-9a-f-]{36} \(SQLSTATE P0001\): boom \?$/);
        expect(/^[\x00-\x7f]*$/.test(w[0])).toBe(true);
      } finally {
        c.off("notice", ouve);
      }
    });
  });

  it("migration: ida idempotente (so catalogo); _down devolve os 2 textos de antes e neutraliza; _down_drop so com neutras; nao mexe nos criadores INTOCADOS", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const b = bloco()!;
      // estado sem a 175000 (LIFO dentro da txn), medindo os criadores intocados antes e depois da ida
      await aplica(c, b.down);
      await c.query("SET LOCAL check_function_bodies = on");
      for (const s of [PTC, IMP]) expect(await md5Fn(c, s), s).toBe(ANTES[s]);
      expect(await md5Fn(c, RPC)).toBe(b.NEUTRO![RPC]);
      expect(await md5Fn(c, HELPER)).toBe(b.NEUTRO![HELPER]);
      await listaCrua(c, [{ etiqueta_id: fx.E1, consumo: 1 }]);
      await jwt(c, U_PLAN);
      const m = await card(c);
      expect(txt(await salvar(c, m, [{ etiqueta_id: fx.E1, consumo: 1 }]))).toBe("P0001 funcao_desativada: salvar_insumos_iniciais");
      await jwt(c, U_NADA);
      const sem = await como(c, "SELECT public.plan_tecido_criar_card($1, $2::jsonb) AS id", [fx.col, JSON.stringify({ nome: "PT down", materiais: [] })]);
      expect(await linhas(c, (sem as any).rows[0].id)).toEqual([]); // com a volta, criar card nao traz a lista
      await jwt(c, null);
      await aplica(c, b.down); // idempotente
      await c.query("SET LOCAL check_function_bodies = on");
      const intocadas: Record<string, string | null> = {};
      for (const s of INTOCADAS) intocadas[s] = await md5Fn(c, s);
      // travas por DIFERENCA: a ida nao trava tabela nenhuma (so catalogo)
      const travas = async () =>
        (
          await c.query(
            `SELECT l.mode, coalesce(n.nspname || '.' || cl.relname, l.locktype) AS rel
               FROM pg_locks l LEFT JOIN pg_class cl ON cl.oid = l.relation LEFT JOIN pg_namespace n ON n.oid = cl.relnamespace
              WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation'`,
          )
        ).rows.map((r) => `${r.rel}:${r.mode}`);
      const antesT = new Set(await travas());
      await aplica(c, b.mig);
      const novas = (await travas()).filter((x) => !antesT.has(x));
      expect(novas.filter((x) => !/^pg_catalog\.|^pg_toast\./.test(x))).toEqual([]);
      for (const s of [PTC, IMP]) expect(await md5Fn(c, s), s).toBe(b.MD5[s].depois);
      expect(await md5Fn(c, RPC)).toBe(b.NOVAS[RPC]);
      expect(await md5Fn(c, HELPER)).toBe(b.NOVAS[HELPER]);
      for (const s of INTOCADAS) expect(await md5Fn(c, s), s).toBe(intocadas[s]);
      await aplica(c, b.mig); // idempotente
      expect(await md5Fn(c, RPC)).toBe(b.NOVAS[RPC]);
      // _down_drop: recusa com a ida viva; depois do _down apaga as 2; a ida recria
      await expect(aplica(c, b.drop)).rejects.toThrow(/nao esta no texto neutro/);
      await aplica(c, b.down);
      await c.query("SET LOCAL check_function_bodies = on");
      await aplica(c, b.drop);
      expect(await md5Fn(c, RPC)).toBeNull();
      expect(await md5Fn(c, HELPER)).toBeNull();
      await aplica(c, b.mig);
      expect(await md5Fn(c, RPC)).toBe(b.NOVAS[RPC]);
      expect(await md5Fn(c, PTC)).toBe(b.MD5[PTC].depois);
    });
  });

  it("guardas: a ida recusa (P0001) se outra frente mexeu num criador; o _down recusa se a funcao nova tem texto estranho", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const b = bloco()!;
      await aplica(c, b.down);
      await c.query("SET LOCAL check_function_bodies = on");
      const txtPtc = (await um<{ d: string }>(c, "SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [PTC])).d;
      await c.query(txtPtc.replace("AS $function$\n", "AS $function$\n-- outra frente\n"));
      await expect(aplica(c, b.mig)).rejects.toThrow(/urg_r2_175000: public\._plan_tecido_criar_card_core\(uuid,uuid,jsonb\) com texto inesperado/);
      expect(await md5Fn(c, RPC)).toBe(b.NEUTRO![RPC]); // nada mudou
      await c.query(txtPtc);
      await aplica(c, b.mig);
      await c.query(`CREATE OR REPLACE FUNCTION public._insumos_padrao_aplicar(_modelo_id uuid) RETURNS integer LANGUAGE plpgsql
                     SECURITY DEFINER SET search_path TO 'public' AS $f$ BEGIN RETURN 1; END $f$`);
      await expect(aplica(c, b.down)).rejects.toThrow(/urg_r2_175000_down: public\._insumos_padrao_aplicar\(uuid\) com texto inesperado/);
      expect(await md5Fn(c, PTC)).toBe(b.MD5[PTC].depois);
    });
  });

  it("> 64 cards num 'Criar cards' (1 transacao): o helper com lista vazia nao abre subtransacao; 70 vagas com lista vazia e com 20 insumos gravam certo", async () => {
    // [fix round 2 / LEVE-1 da revisao] as checagens so-leitura do helper vem ANTES do sub-bloco EXCEPTION: lista vazia (estado de
    // todas as lojas hoje) nao gasta subtransacao/XID nem trava o card. O cache de subxids por backend e de 64 (PGPROC_MAX_CACHED_SUBXIDS).
    const subxact = async (c: Client) => {
      await c.query("SELECT pg_stat_clear_snapshot()"); // o retrato das estatisticas e por transacao: limpa antes de ler
      return um<{ n: number; overflow: boolean }>(
        c,
        `SELECT s.subxact_count AS n, s.subxact_overflowed AS overflow
           FROM pg_stat_get_backend_idset() AS b(id), LATERAL pg_stat_get_backend_subxact(b.id) AS s
          WHERE pg_stat_get_backend_pid(b.id) = pg_backend_pid()`,
      );
    };
    const vagas = (k: string, n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ nome: `PT 70 ${k} ${i}`, materiais: [] })));
    const lote = async (c: Client, fx: Fx, k: string) => {
      const r = await como(c, "SELECT public.plan_tecido_criar_cards($1, $2::jsonb) AS r", [fx.col, vagas(k, 70)]);
      expect(txt(r)).toBe("PASSOU");
      return ((r as any).rows[0].r as { modelo_id: string }[]).map((x) => x.modelo_id);
    };
    // (a) o HELPER com lista vazia nao abre subtransacao. Os 70 cards nascem com os gatilhos DESLIGADOS (session_replication_role =
    // replica, so nesta txn): cada INSERT normal em modelos ja gasta 1 subxid PRE-EXISTENTE (sub-bloco EXCEPTION de um gatilho de
    // modelos - medido: 1 INSERT = 1 subxid; 65+ cards numa txn ja estouram o cache SEM esta migration) e esconderia a medida.
    // Antes do fix round 2 (FOR UPDATE dentro do sub-bloco): 70 chamadas = 64 / overflow; agora 0.
    await withTx(async (c) => {
      await prepara(c);
      const cards = await semJwt(c, async () => {
        await c.query("SET LOCAL session_replication_role = replica");
        const { rows } = await c.query(
          `INSERT INTO public.modelos (tenant_id, nome, origem) SELECT $1, 'URG-A10 subx ' || g, 'interno' FROM generate_series(1, 70) g
           RETURNING id::text AS id`,
          [T],
        );
        await c.query("SET LOCAL session_replication_role = origin");
        return rows.map((r) => r.id as string);
      });
      const antes = await subxact(c);
      const { rows } = await c.query("SELECT public._insumos_padrao_aplicar(x) AS n FROM unnest($1::uuid[]) AS x", [cards]);
      expect(rows.every((r) => r.n === 0)).toBe(true);
      const depois = await subxact(c);
      expect(depois, JSON.stringify({ antes, depois })).toEqual(antes);
      expect(depois.overflow).toBe(false);
    });
    // (b) 70 cards num "Criar cards" (1 transacao), lista vazia: tudo criado, nenhuma linha, nenhuma falha
    await withTx(async (c) => {
      const fx = await prepara(c);
      await jwt(c, U_NADA);
      const ids = await lote(c, fx, "vazia");
      expect(ids.length).toBe(70);
      const n = await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.modelo_etiquetas WHERE modelo_id = ANY ($1::uuid[])", [ids]);
      expect(n.n).toBe(0);
    });
    // (c) 70 vagas com lista de 20 insumos: 70 x 20 linhas certas, sem falha (aqui cada card gasta mais 1 subxid - o sub-bloco que
    // protege a criacao -, o que nao muda nada alem do que os gatilhos de modelos ja fazem)
    await withTx(async (c) => {
      const fx = await prepara(c);
      await listaCrua(c, fx.muitos.slice(0, 20).map((e, i) => ({ etiqueta_id: e, consumo: i + 1 })));
      await jwt(c, U_NADA);
      const ids = await lote(c, fx, "cheia");
      expect(ids.length).toBe(70);
      const { rows } = await c.query(
        `SELECT modelo_id::text AS m, count(*)::int AS n, min(numero) AS a, max(numero) AS z, sum(consumo)::float8 AS q
           FROM public.modelo_etiquetas WHERE modelo_id = ANY ($1::uuid[]) GROUP BY 1`,
        [ids],
      );
      expect(rows.length).toBe(70);
      for (const x of rows) expect(x, x.m).toMatchObject({ n: 20, a: 1, z: 20, q: 210 });
      await imediato(c); // a fila de custo dos 70 cards (o que o COMMIT faria) nao falha
    });
  });

  it("desempenho: 'Criar cards' do Plan. Tecido com 40 vagas e lista de 20 insumos fica no mesmo patamar (medido)", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      await jwt(c, U_NADA);
      const vagas = (k: string) => JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ nome: `PT perf ${k} ${i}`, materiais: [] })));
      const mede = async (k: string) => {
        const t0 = performance.now();
        const r = await como(c, "SELECT public.plan_tecido_criar_cards($1, $2::jsonb) AS r", [fx.col, vagas(k)]);
        const ms = performance.now() - t0;
        expect(txt(r)).toBe("PASSOU");
        return { ms, ids: ((r as any).rows[0].r as { modelo_id: string }[]).map((x) => x.modelo_id) };
      };
      await listaCrua(c, []);
      const sem = await mede("sem");
      await listaCrua(c, fx.muitos.slice(0, 20).map((e) => ({ etiqueta_id: e, consumo: 1 })));
      const com = await mede("com");
      const n = await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.modelo_etiquetas WHERE modelo_id = ANY ($1::uuid[])", [com.ids]);
      expect(n.n).toBe(40 * 20);
      const t0 = performance.now();
      await imediato(c); // a fila de custo dos 40 cards (o que o COMMIT faria)
      const fila = performance.now() - t0;
      const linha = `[urg-a10 perf] 40 cards: sem lista ${sem.ms.toFixed(0)} ms; com 20 insumos ${com.ms.toFixed(0)} ms; fila de custo no COMMIT ${fila.toFixed(0)} ms\n`;
      if (process.env.URG_A10_PERF_OUT) appendFileSync(process.env.URG_A10_PERF_OUT, linha); // medicao para o relatorio (opcional)
      expect(com.ms).toBeLessThan(15000);
    });
  });
});
