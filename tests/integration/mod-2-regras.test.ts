// Modularidade T2 — Lançar sem Produção (P-252 A) + excluir coleção com cards (P-255 A).
// Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md §0 M2 e §4 T2. Migration GERADA 20261103110000_mod_lancar_colecao
// (gerar-mod2.mjs). Cada caso em transação revertida (withTx) e SÓ na cópia local: a migration é aplicada DENTRO da txn
// (mod-helpers/mig-txn, nunca \i). Chamadas como o PAPEL do PostgREST (SET LOCAL ROLE authenticated). Módulo desligado SEM
// claims (MOD-1 ignora a mudança feita com JWT de não-super). Fixtures semeadas como postgres, sem JWT, dentro da txn.
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, ehBancoLocal, withTx, um, semJwt, dbUrl, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { aplicaMod, voltaMod, modViva, MOD_MIGS } from "./mod-helpers";
import { MOD_MD5, MOD2_ACL, MOD2_DEPS, MOD_MIG, MOD_DOWN } from "./mod-2-dados";
import { MOD_DOWN as MOD1_DOWN, MOD_DOWN_DROP as MOD1_DOWN_DROP } from "./mod-1-dados";
import { dropUrgbSePreciso } from "./urgb-helpers"; // [urg r4b] _servicos_da_mo_criar cita _tenant_modulo_ligado: o _down_drop dela vem antes (LIFO)

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const SUPER = USER_TESTE;
const U_PLAN = "0d0e1000-0000-4000-8000-0000000000d1"; // usuário comum só com criacao_planejamento (ver+editar)
const U_OTB = "0d0e1000-0000-4000-8000-0000000000d2"; // usuário comum só com a página OTB (ver+editar) — Backend B5
const DATA = "2026-10-10";

type Linha = Record<string, unknown>;
type Res = { ok: true; rows: Linha[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel `role` (PostgREST real) num SAVEPOINT; erro volta ao savepoint (a txn segue usável). */
async function como(
  c: Client,
  role: "authenticated" | null,
  sql: string,
  params: unknown[] = [],
): Promise<Res> {
  await c.query("SAVEPOINT mod2");
  try {
    if (role) await c.query(`SET LOCAL ROLE ${role}`);
    const r = await c.query(sql, params);
    if (role) await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT mod2");
    return { ok: true, rows: r.rows };
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("ROLLBACK TO SAVEPOINT mod2");
    await c.query("RELEASE SAVEPOINT mod2");
    return { ok: false, code: String(er.code ?? ""), msg: String(er.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);
const CQ = "42501 Confirme o Controle de Qualidade antes de lançar.";
const MO = "42501 Aprove a mão de obra antes de lançar.";
const SEM_DATA = "42501 Informe a Data de Lançamento.";

async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "",
  ]);
}
/** Usuário COMUM (role user) da loja `t` com só as páginas dadas (ver+editar). */
async function usuarioComum(c: Client, uid: string, t: string, paginas: string[]): Promise<void> {
  await semJwt(c, async () => {
    await c.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [uid, `${uid}@teste`],
    );
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'Mod2 comum', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
      [uid, t, `${uid}@teste`],
    );
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [uid]);
    await c.query(
      `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar)
       SELECT $1, $2, p, true, true FROM unnest($3::text[]) p`,
      [uid, t, paginas],
    );
  });
}
/** Liga/desliga módulos da loja SEM claims (MOD-1). */
async function modulos(c: Client, t: string, mods: Record<string, boolean>): Promise<void> {
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || $2::jsonb WHERE tenant_id = $1`,
      [t, JSON.stringify(mods)],
    ),
  );
}
async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaMod(c, 2); // idempotente (cópia já com T1+T2, ou MOD_TXN=1: pula)
  expect(await modViva(c, 2)).toBe(true);
  await jwt(c, null);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, SUPER]);
  await usuarioComum(c, U_PLAN, T, ["criacao_planejamento"]);
  await modulos(c, T, { criacao: true, producao: true, otb: true });
}

/** Card de teste na loja (sem CAD; sem linha de M.O. = M.O. liberada). Opções: M.O. pendente, CAD com CQ. */
async function card(
  c: Client,
  o: {
    nome?: string;
    moPendente?: boolean;
    cq?: "pendente" | "confirmado";
    colecao?: string;
    statusPlan?: string;
  } = {},
): Promise<{ id: string; cad: string | null }> {
  return semJwt(c, async () => {
    const id = (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.modelos (tenant_id, nome, versao, status_planejamento, colecao_id)
         VALUES ($1, $2, 1, $3, $4) RETURNING id`,
        [T, o.nome ?? "Mod2 card", o.statusPlan ?? "em_planejamento", o.colecao ?? null],
      )
    ).id;
    if (o.moPendente) {
      await c.query(
        `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, valor, aprovado) VALUES ($1, $2, 10, NULL)`,
        [T, id],
      );
    }
    let cad: string | null = null;
    if (o.cq) {
      cad = (
        await um<{ id: string }>(
          c,
          `INSERT INTO public.cad (tenant_id, modelo_id) VALUES ($1, $2) RETURNING id`,
          [T, id],
        )
      ).id;
      await c.query(
        `INSERT INTO public.controle_qualidade (tenant_id, cad_id, status) VALUES ($1, $2, $3)`,
        [T, cad, o.cq],
      );
    }
    return { id, cad };
  });
}
const lancar = (c: Client, uid: string, id: string, data: string | null, send = true) =>
  jwt(c, uid).then(() =>
    como(c, "authenticated", `select public.lancar_modelo($1, $2::date, $3)`, [id, data, send]),
  );
async function estado(c: Client, id: string): Promise<{ l: boolean; d: string | null }> {
  return um(
    c,
    `SELECT lancado AS l, data_lancamento::text AS d FROM public.modelos WHERE id = $1`,
    [id],
  );
}

describe.skipIf(!RODA)(
  "mod T2 — Lançar sem Produção (P-252 A; M2: o módulo da LOJA, não de quem clica)",
  () => {
    it("Produção desligada (comum com criacao_planejamento): lança sem CQ com M.O. aprovada + data; sem M.O./sem data recusa; _send=false desfaz", async () => {
      await withTx(async (c) => {
        await prepara(c);
        await modulos(c, T, { producao: false });
        // card sem CAD, sem linha de M.O. (= aprovada) → lança
        const a = await card(c);
        expect(txt(await lancar(c, U_PLAN, a.id, DATA))).toBe("PASSOU");
        expect(await estado(c, a.id)).toEqual({ l: true, d: DATA });
        // _send=false desfaz igual a hoje (data fica)
        expect(txt(await lancar(c, U_PLAN, a.id, null, false))).toBe("PASSOU");
        expect(await estado(c, a.id)).toEqual({ l: false, d: DATA });
        // CAD com CQ PENDENTE também lança (o CQ não se aplica sem Produção)
        const b = await card(c, { cq: "pendente" });
        expect(txt(await lancar(c, U_PLAN, b.id, DATA))).toBe("PASSOU");
        expect((await estado(c, b.id)).l).toBe(true);
        // M.O. pendente → recusa (nada muda)
        const m = await card(c, { moPendente: true });
        expect(txt(await lancar(c, U_PLAN, m.id, DATA))).toBe(MO);
        expect((await estado(c, m.id)).l).toBe(false);
        // sem data → recusa
        const d = await card(c);
        expect(txt(await lancar(c, U_PLAN, d.id, null))).toBe(SEM_DATA);
        expect((await estado(c, d.id)).l).toBe(false);
      });
    });

    it("Produção ligada: igual a hoje (CQ primeiro; com CQ liberado lança)", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const semCad = await card(c, { moPendente: true });
        expect(txt(await lancar(c, U_PLAN, semCad.id, DATA))).toBe(CQ); // CQ é a 1ª exigência, como antes
        const pend = await card(c, { cq: "pendente" });
        expect(txt(await lancar(c, U_PLAN, pend.id, DATA))).toBe(CQ);
        expect((await estado(c, pend.id)).l).toBe(false);
        const ok = await card(c, { cq: "confirmado" });
        expect(txt(await lancar(c, U_PLAN, ok.id, DATA))).toBe("PASSOU");
        expect(await estado(c, ok.id)).toEqual({ l: true, d: DATA });
        const okMo = await card(c, { cq: "confirmado", moPendente: true });
        expect(txt(await lancar(c, U_PLAN, okMo.id, DATA))).toBe(MO);
        const okData = await card(c, { cq: "confirmado" });
        expect(txt(await lancar(c, U_PLAN, okData.id, null))).toBe(SEM_DATA);
      });
    });

    it("super admin: numa loja sem Produção lança sem CQ; numa loja com Produção o CQ segue exigido (não depende de quem clica)", async () => {
      await withTx(async (c) => {
        await prepara(c);
        await modulos(c, T, { producao: false });
        const a = await card(c);
        expect(txt(await lancar(c, SUPER, a.id, DATA))).toBe("PASSOU");
        expect(await estado(c, a.id)).toEqual({ l: true, d: DATA });
        // o atalho de super de tenant_module_enabled NÃO entra na regra (M2): mesmo com ele, a loja sem Produção não exige CQ…
        await jwt(c, SUPER);
        expect(
          (await um<{ v: boolean }>(c, "SELECT public.tenant_module_enabled('producao') AS v")).v,
        ).toBe(true);
        // …e com Produção na loja, o super também precisa do CQ
        await jwt(c, null);
        await modulos(c, T, { producao: true });
        const b = await card(c);
        expect(txt(await lancar(c, SUPER, b.id, DATA))).toBe(CQ);
        expect((await estado(c, b.id)).l).toBe(false);
      });
    });
  },
);

type Contagem = { col: number; mod: number; pt: number };
async function conta(c: Client, colecoes: string[]): Promise<Contagem> {
  return um(
    c,
    `SELECT (SELECT count(*) FROM public.colecoes WHERE id = ANY($1::uuid[]))::int AS col,
            (SELECT count(*) FROM public.modelos WHERE colecao_id = ANY($1::uuid[]))::int AS mod,
            (SELECT count(*) FROM public.plan_tecido WHERE colecao_id = ANY($1::uuid[]))::int AS pt`,
    [colecoes],
  );
}
async function colecao(c: Client, nome: string, comPlano = true): Promise<string> {
  return semJwt(c, async () => {
    const id = (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.colecoes (tenant_id, nome, status) VALUES ($1, $2, 'confirmada') RETURNING id`,
        [T, nome],
      )
    ).id;
    if (comPlano)
      await c.query(`INSERT INTO public.plan_tecido (tenant_id, colecao_id) VALUES ($1, $2)`, [
        T,
        id,
      ]);
    return id;
  });
}
const excluir = (c: Client, uid: string, col: string) =>
  jwt(c, uid).then(() => como(c, "authenticated", `select public.otb_excluir_colecao($1)`, [col]));

describe.skipIf(!RODA)("mod T2 — excluir coleção com cards é recusado (P-255 A)", () => {
  it("coleção com 1 card (Reprovado, com CAD, em planejamento) ou N cards → P0001 colecao_com_cards: N, nada apagado; sem cards → apaga com o plano de tecido", async () => {
    await withTx(async (c) => {
      await prepara(c);
      // Backend B5 (P-258 A, 20261103148000): excluir coleção exige EDITAR a página OTB (é a tela que exclui) — usuário comum do OTB
      await usuarioComum(c, U_OTB, T, ["otb"]);
      const casos: { nome: string; montar: (col: string) => Promise<unknown>; n: number }[] = [
        {
          nome: "reprovado",
          montar: (col) => card(c, { colecao: col, statusPlan: "reprovado" }),
          n: 1,
        },
        // card com CAD: antes da T2 dava o erro CRU de FK (cad_modelo_id_fkey) ao apagar o card
        { nome: "com CAD", montar: (col) => card(c, { colecao: col, cq: "confirmado" }), n: 1 },
        {
          nome: "3 cards",
          montar: async (col) => {
            await card(c, { colecao: col, statusPlan: "em_planejamento" });
            await card(c, { colecao: col, statusPlan: "planejado" });
            await card(c, { colecao: col, statusPlan: "reprovado" });
          },
          n: 3,
        },
      ];
      for (const caso of casos) {
        const col = await colecao(c, `Mod2 ${caso.nome}`);
        await caso.montar(col);
        const antes = await conta(c, [col]);
        expect(antes, caso.nome).toEqual({ col: 1, mod: caso.n, pt: 1 });
        expect(txt(await excluir(c, U_OTB, col)), caso.nome).toBe(
          `P0001 colecao_com_cards: ${caso.n}`,
        );
        await jwt(c, null);
        expect(await conta(c, [col]), `${caso.nome}: nada apagado`).toEqual(antes);
      }
      // sem cards: apaga a coleção e o plano de tecido dela (como antes)
      const vazia = await colecao(c, "Mod2 vazia");
      expect(await conta(c, [vazia])).toEqual({ col: 1, mod: 0, pt: 1 });
      expect(txt(await excluir(c, U_OTB, vazia))).toBe("PASSOU");
      await jwt(c, null);
      expect(await conta(c, [vazia])).toEqual({ col: 0, mod: 0, pt: 0 });
    });
  });

  // Fix "corrida" (ruling do controlador sobre P-255 A): a linha da coleção é travada (FOR UPDATE) ANTES de contar os cards.
  // Outra sessão com um card EM VOO apontando para a coleção (INSERT não commitado = FOR KEY SHARE na coleção pela FK) faz a
  // exclusão ESPERAR já no PERFORM ... FOR UPDATE (antes da contagem) — aqui medido com lock_timeout curto (55P03). Nada é gravado:
  // a outra sessão faz ROLLBACK; a coleção usada é uma coleção REAL vazia da cópia (só lida, nunca alterada fora de txn revertida).
  it("corrida: card em voo noutra sessão faz a exclusão esperar no FOR UPDATE da coleção (antes de contar); o texto não apaga card", async () => {
    const def = await (async () => {
      let d = "";
      await withTx(async (c) => {
        await prepara(c);
        d = (
          await um<{ d: string }>(
            c,
            "SELECT pg_get_functiondef('public.otb_excluir_colecao(uuid)'::regprocedure) AS d",
          )
        ).d;
      });
      return d;
    })();
    expect(def).toMatch(
      /perform 1 from colecoes where id = _colecao_id and tenant_id = v_tenant for update;[\s\S]*select count\(\*\) into v_planejados/,
    );
    expect(def).not.toMatch(/^\s*delete from modelos/m);

    const url = dbUrl();
    if (!url) throw new Error("sem DATABASE_URL");
    const outra = new Client({ connectionString: url });
    await outra.connect();
    try {
      await withTx(async (c) => {
        await prepara(c);
        const alvo = await um<{ id: string; tenant_id: string } | undefined>(
          c,
          `SELECT c.id, c.tenant_id FROM public.colecoes c
            WHERE NOT EXISTS (SELECT 1 FROM public.modelos m WHERE m.colecao_id = c.id) ORDER BY c.id LIMIT 1`,
        );
        expect(alvo, "a cópia precisa de 1 coleção real sem cards").toBeTruthy();
        // outra sessão: card NOVO apontando para a coleção, SEM commit (só ROLLBACK no fim)
        await outra.query("BEGIN");
        await outra.query("SET LOCAL lock_timeout = '5s'");
        await outra.query(
          `INSERT INTO public.modelos (tenant_id, nome, versao, status_planejamento, colecao_id)
           VALUES ($1, 'Mod2 corrida', 1, 'em_planejamento', $2)`,
          [alvo!.tenant_id, alvo!.id],
        );
        await jwt(c, null);
        await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [
          alvo!.tenant_id,
          SUPER,
        ]);
        await jwt(c, SUPER);
        await c.query("SAVEPOINT corrida");
        await c.query("SET LOCAL lock_timeout = '400ms'");
        let erro: { code?: string; where?: string } | null = null;
        try {
          await c.query("SELECT public.otb_excluir_colecao($1)", [alvo!.id]);
        } catch (e) {
          erro = e as { code?: string; where?: string };
        }
        await c.query("ROLLBACK TO SAVEPOINT corrida");
        await c.query("SET LOCAL lock_timeout = '3s'");
        expect(erro?.code, "a exclusão tem de esperar o card em voo").toBe("55P03");
        expect(erro?.where ?? "").toMatch(/otb_excluir_colecao\(uuid\) line \d+ at PERFORM/);
        await jwt(c, null);
      });
    } finally {
      await outra.query("ROLLBACK").catch(() => undefined);
      await outra.end();
    }
  });

  it("as coleções REAIS da cópia que têm cards (todas as lojas): recusa com o nº exato de cards; nada apagado", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const { rows } = await c.query<{ id: string; tenant_id: string; n: number }>(
        `SELECT c.id, c.tenant_id, count(m.id)::int AS n
           FROM public.colecoes c JOIN public.modelos m ON m.colecao_id = c.id AND m.tenant_id = c.tenant_id
          GROUP BY c.id, c.tenant_id ORDER BY c.tenant_id, c.id`,
      );
      expect(rows.length).toBeGreaterThan(0);
      const ids = rows.map((r) => r.id);
      const antes = await conta(c, ids);
      const falhas: string[] = [];
      for (const r of rows) {
        // super admin "entra" na loja da coleção (users.tenant_id, como o seletor de loja; txn revertida)
        await jwt(c, null);
        await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [r.tenant_id, SUPER]);
        const res = txt(await excluir(c, SUPER, r.id));
        if (res !== `P0001 colecao_com_cards: ${r.n}`)
          falhas.push(`${r.tenant_id}/${r.id}: ${res}`);
      }
      await jwt(c, null);
      expect(falhas).toEqual([]);
      expect(await conta(c, ids)).toEqual(antes);
    });
  });
});

describe.skipIf(!RODA)(
  "mod T2 — migration (idempotente, _down neutro, guarda, pós-condições)",
  () => {
    async function md5(c: Client, sig: string): Promise<string | null> {
      return (
        await um<{ m: string | null }>(
          c,
          "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m",
          [sig],
        )
      ).m;
    }
    const confere = async (c: Client, qual: "antes" | "depois") => {
      for (const [sig, m] of Object.entries(MOD_MD5))
        expect(await md5(c, sig), `${sig} ${qual}`).toBe(m[qual]);
    };
    const confereAcl = async (c: Client) => {
      for (const [sig, acl] of Object.entries(MOD2_ACL)) {
        const r = await um<Linha>(
          c,
          `select coalesce(p.proacl::text,'') acl, p.prosecdef sd, p.proconfig cfg,
                has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth
           from pg_proc p where p.oid = to_regprocedure($1)`,
          [sig],
        );
        expect([r.acl, r.sd, r.cfg, r.anon, r.auth], sig).toEqual([
          acl,
          true,
          ["search_path=public"],
          false,
          true,
        ]);
      }
    };

    it("ida 2× → depois; _down 2× → antes; ida de novo → depois; ACL igual; dependências conferidas", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '180s'");
        await voltaMod(c);
        await aplicaMod(c, 1); // T1 viva, T2 não
        expect(await modViva(c, 2)).toBe(false);
        await confere(c, "antes");
        for (const [sig, m] of Object.entries(MOD2_DEPS))
          expect(await md5(c, sig), `dep ${sig}`).toBe(m);
        await aplicarArquivo(c, MOD_MIG);
        await aplicarArquivo(c, MOD_MIG); // idempotente
        await confere(c, "depois");
        await confereAcl(c);
        expect(await modViva(c, 2)).toBe(true);
        await aplicarArquivo(c, MOD_DOWN);
        await aplicarArquivo(c, MOD_DOWN); // idempotente
        await confere(c, "antes");
        await confereAcl(c);
        expect(await modViva(c, 2)).toBe(false);
        await aplicarArquivo(c, MOD_MIG);
        await confere(c, "depois");
      });
    });

    it("guarda: função com texto inesperado → a ida e o _down recusam (P0001), nada muda", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '180s'");
        await aplicaMod(c, 2);
        // outra frente mexeu em otb_excluir_colecao (só um comentário a mais)
        const def = (
          await um<{ d: string }>(
            c,
            "SELECT pg_get_functiondef('public.otb_excluir_colecao(uuid)'::regprocedure) AS d",
          )
        ).d;
        await c.query(def.replace("begin\n", "begin\n  -- outra frente\n"));
        const mexida = await md5(c, "public.otb_excluir_colecao(uuid)");
        await expect(aplicarArquivo(c, MOD_MIG)).rejects.toThrow(
          /mod2_lancar_colecao: public\.otb_excluir_colecao\(uuid\) com texto inesperado/,
        );
        await expect(aplicarArquivo(c, MOD_DOWN)).rejects.toThrow(
          /mod2_lancar_colecao_down: public\.otb_excluir_colecao\(uuid\) com texto inesperado/,
        );
        expect(await md5(c, "public.otb_excluir_colecao(uuid)")).toBe(mexida);
        expect(await md5(c, "public.lancar_modelo(uuid,date,boolean)")).toBe(
          MOD_MD5["public.lancar_modelo(uuid,date,boolean)"].depois,
        );
      });
    });

    it("LIFO: com a T2 viva, o _down_drop da T1 recusa (lancar_modelo cita _tenant_modulo_ligado); depois do _down da T2, passa", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '180s'");
        // [modularidade T3] blocos MAIS NOVOS que a T2 (T3: _kanban_cond_na também cita _tenant_modulo_ligado) saem antes,
        // pelo _down e pelo _down_drop deles (LIFO) — senão o _down_drop da T1 recusaria por causa deles, não da T2.
        await voltaMod(c);
        await dropUrgbSePreciso(c);
        const raiz = fileURLToPath(new URL("../../", import.meta.url));
        for (const b of [...MOD_MIGS].reverse()) {
          if (b.n <= 2 || b.n === 4) continue;
          const drop = b.downs[0]?.replace(/_down\.sql$/, "_down_drop.sql");
          if (drop && existsSync(raiz + drop)) await aplicarArquivo(c, drop);
        }
        await aplicaMod(c, 2);
        await aplicarArquivo(c, MOD1_DOWN); // T1 volta (37 wrappers), auxiliares ficam
        await expect(aplicarArquivo(c, MOD1_DOWN_DROP)).rejects.toThrow(
          /mod1_drop: rode o _down antes .*lancar_modelo/,
        );
        await aplicarArquivo(c, MOD_DOWN);
        await aplicarArquivo(c, MOD1_DOWN_DROP);
        expect(await md5(c, "public._tenant_modulo_ligado(uuid,text)")).toBeNull();
        await confere(c, "antes");
      });
    });
  },
);
