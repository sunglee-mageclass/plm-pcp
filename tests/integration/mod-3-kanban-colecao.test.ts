// Modularidade T3 — kanban sabe de módulo (P-254 A, Parte 8-banco) + coleção pelo id (Parte 12).
// Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md §0 M3/M4/M5/M10 e §5 T3. Migration GERADA
// 20261103120000_mod_kanban_colecao (gerar-mod3.mjs). Cada caso em transação revertida (withTx) e SÓ na cópia local: a migration é
// aplicada/desfeita DENTRO da txn (mod-helpers/mig-txn, nunca \i). Módulos mudados SEM claims (MOD-1); fixtures como postgres.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  hasDb,
  ehBancoLocal,
  withTx,
  um,
  semJwt,
  comoUsuario,
  TENANT_TESTE,
  USER_TESTE,
} from "./db";
import { aplicarArquivo } from "./mig-txn";
import { aplicaMod, voltaMod, modViva, MOD_MIGS } from "./mod-helpers";
import { voltaBkSePreciso } from "./bk-helpers";
import {
  MOD_MD5,
  MOD3_ACL,
  MOD3_AUX,
  MOD3_M5,
  MOD3_DEPS,
  MOD_MIG,
  MOD_DOWN,
  MOD_DOWN_DROP,
} from "./mod-3-dados";
import { MOD_DOWN as MOD1_DOWN, MOD_DOWN_DROP as MOD1_DOWN_DROP } from "./mod-1-dados";
import { MOD_DOWN as MOD2_DOWN } from "./mod-2-dados";
import { CONDICOES, CONDICAO_KEYS } from "../../src/lib/kanban-condicoes";
import { rotuloColecao } from "../../src/lib/colecao-rotulo";
import { dropUrgbSePreciso } from "./urgb-helpers"; // [urg r4b] _servicos_da_mo_criar cita _tenant_modulo_ligado: o _down_drop dela vem antes (LIFO)
import { dropUrgAExtratoSePreciso } from "./urg-a-helpers"; // [urg R3 T14] extrato 177000 cita _exige_modulos (LIFO)

const RODA = hasDb && ehBancoLocal();
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const T = TENANT_TESTE;
const AVE_RARA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979";
const ES = ["enviado_cad", "cad_preenchido", "enviado_para_pcp", "separar_enviar_preenchido"];
const PROD = [
  "servico_finalizado",
  "grade_cortada_lancada",
  "direcionamento_feito",
  "cq_confirmado",
  "cq_pos_confirmado",
  "cq_liberado",
];

type Mapa = Record<string, Record<string, boolean>>;
const md5 = async (c: Client, sig: string): Promise<string | null> =>
  (
    await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
      sig,
    ])
  ).m;

/** Estado "antes" da T3 nesta txn (T1/T2 seguem vivas): _down da T3 se ela estiver viva (auxiliares ficam). */
async function semT3(c: Client): Promise<void> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaMod(c, 2);
  if (await modViva(c, 3)) await aplicarArquivo(c, MOD_DOWN);
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
  expect(await modViva(c, 3)).toBe(false);
}
async function comT3(c: Client): Promise<void> {
  await aplicaMod(c, 3);
  expect(await modViva(c, 3)).toBe(true);
}
async function modulos(c: Client, t: string, mods: Record<string, boolean>): Promise<void> {
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || $2::jsonb WHERE tenant_id = $1`,
      [t, JSON.stringify(mods)],
    ),
  );
}
async function mapa(c: Client, t: string, ids?: string[]): Promise<Mapa> {
  const r = await um<{ j: Mapa }>(
    c,
    `SELECT public._avaliar_condicoes_kanban_core($1, coalesce($2::uuid[], (SELECT array_agg(id) FROM public.modelos WHERE tenant_id = $1))) AS j`,
    [t, ids ?? null],
  );
  return r.j ?? {};
}
/** Liga/desliga a chave como a RPC `kanban_definir_automatico` (GUC transação-local `app.kanban_chave='rpc'`). */
async function chave(c: Client, ligada: boolean): Promise<void> {
  await c.query(`SELECT set_config('app.kanban_chave', 'rpc', true)`);
  try {
    await c.query(`UPDATE public.tenant_config SET kanban_automatico = $2 WHERE tenant_id = $1`, [
      T,
      ligada,
    ]);
  } finally {
    await c.query(`SELECT set_config('app.kanban_chave', '', true)`);
  }
}
/** Board sintético da Loja Teste: Entrada (manual) · Etapa A {cq_liberado} · Etapa B {data_aprovacao}. Chave fica DESLIGADA. */
async function board(c: Client): Promise<void> {
  await chave(c, false);
  await semJwt(c, () =>
    c.query(
      `UPDATE public.tenant_config
          SET status_kanban = $2::jsonb, kanban_requisitos = $3::jsonb, kanban_requisitos_excecoes = '{}'::jsonb,
              revenda_kanban_colunas = '[]'::jsonb, revenda_kanban_requisitos = '{}'::jsonb
        WHERE tenant_id = $1`,
      [
        T,
        JSON.stringify(["Entrada", "Etapa A", "Etapa B"]),
        JSON.stringify({ etapa_a: ["cq_liberado"], etapa_b: ["data_aprovacao"] }),
      ],
    ),
  );
}
/** Card interno da Loja Teste já no Desenvolvimento, com Data de Aprovação e SEM CAD (cq_liberado = false). */
async function cardKanban(c: Client, status: string): Promise<string> {
  await c.query(`SELECT set_config('app.kanban_sistema', 'teste', true)`);
  try {
    return (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.modelos (tenant_id, nome, versao, ordem_criacao_enviada, status_desenvolvimento, data_aprovacao)
         VALUES ($1, 'Mod3 card', 1, true, $2, DATE '2026-10-01') RETURNING id`,
        [T, status],
      )
    ).id;
  } finally {
    await c.query(`SELECT set_config('app.kanban_sistema', '', true)`);
  }
}
const statusDe = async (c: Client, id: string) =>
  (
    await um<{ s: string }>(
      c,
      `SELECT status_desenvolvimento AS s FROM public.modelos WHERE id = $1`,
      [id],
    )
  ).s;
const alvo = async (c: Client, id: string) =>
  (
    await um<{ a: string | null }>(
      c,
      `SELECT alvo AS a FROM public._kanban_derivar_lote($1, ARRAY[$2]::uuid[], NULL)`,
      [T, id],
    )
  ).a;
const filaDaLoja = async (c: Client) =>
  Number(
    (
      await um<{ n: string }>(
        c,
        `SELECT count(*) AS n FROM public.kanban_recalculo_fila WHERE tenant_id = $1`,
        [T],
      )
    ).n,
  );
async function imediato(c: Client): Promise<void> {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}
/** salvar_loja como o super admin (PAPEL authenticated, como o PostgREST). */
async function salvarLoja(
  c: Client,
  mods: Record<string, unknown> | null,
  nome?: string,
): Promise<void> {
  const l = await um<{ nome: string; cnpj: string | null; contato: string | null }>(
    c,
    `SELECT nome, cnpj, contato FROM public.tenants WHERE id = $1`,
    [T],
  );
  await comoUsuario(c);
  await c.query("SET LOCAL ROLE authenticated");
  try {
    await c.query(`SELECT public.salvar_loja($1, $2, $3, $4, NULL, $5::jsonb)`, [
      T,
      nome ?? l.nome,
      l.cnpj,
      l.contato,
      mods === null ? null : JSON.stringify(mods),
    ]);
  } finally {
    await c.query("RESET ROLE");
  }
}
const modulosDe = async (c: Client) =>
  (
    await um<{ m: Record<string, boolean> }>(
      c,
      `SELECT modules AS m FROM public.tenant_config WHERE tenant_id = $1`,
      [T],
    )
  ).m;

// ─────────────────────────────────────────── 1. "não se aplica" no avaliador ───────────────────────────────────────────
describe.skipIf(!RODA)(
  'mod T3 — condição de módulo desligado "não se aplica" (P-254 A, M3)',
  () => {
    it("todas as lojas da cópia: depois = antes, exceto o que não se aplica (= true) e colecao_preenchida pelo id (P12)", async () => {
      await withTx(async (c) => {
        await semT3(c);
        // todas as lojas da cópia (inclusive sem card, como a "Controle de Estoque": Criação/Produção desligadas)
        const lojas = (await c.query(`SELECT id AS t FROM public.tenants`)).rows.map(
          (r) => r.t as string,
        );
        expect(lojas.length).toBeGreaterThan(3);
        const antes: Record<string, Mapa> = {};
        for (const t of lojas) antes[t] = await mapa(c, t);
        await comT3(c);
        const soId = new Set(
          (
            await c.query(
              `SELECT id FROM public.modelos WHERE colecao_id IS NOT NULL AND coalesce(btrim(colecao), '') = ''`,
            )
          ).rows.map((r) => r.id as string),
        );
        expect(soId.size, "a cópia tem cards só com colecao_id").toBeGreaterThan(0);
        let comNa = 0;
        for (const t of lojas) {
          const na = (
            await um<{ j: Record<string, boolean> }>(c, `SELECT public._kanban_cond_na($1) AS j`, [
              t,
            ])
          ).j;
          if (Object.keys(na).length) comNa++;
          const depois = await mapa(c, t);
          expect(Object.keys(depois).sort(), t).toEqual(Object.keys(antes[t]).sort());
          for (const [id, cond] of Object.entries(antes[t])) {
            const esperado = { ...cond, ...na };
            if (soId.has(id)) esperado.colecao_preenchida = true;
            expect(depois[id], `${t} ${id}`).toEqual(esperado);
          }
        }
        // "Controle de Estoque" (Criação/Produção desligadas) é a loja da cópia com condições que não se aplicam
        expect(comNa).toBeGreaterThan(0);
      });
    });

    it("Loja Teste: tudo ligado = nenhum 'não se aplica'; Produção off → as 6 de Produção = true; E&S off → as 4 de Explosão = true", async () => {
      await withTx(async (c) => {
        await semT3(c);
        await modulos(c, T, { criacao: true, entrada_saida: true, producao: true });
        const antes = await mapa(c, T);
        await comT3(c);
        expect(await um(c, `SELECT public._kanban_cond_na($1) AS j`, [T])).toEqual({ j: {} });
        const soId = new Set(
          (
            await c.query(
              `SELECT id FROM public.modelos WHERE tenant_id = $1 AND colecao_id IS NOT NULL AND coalesce(btrim(colecao), '') = ''`,
              [T],
            )
          ).rows.map((r) => r.id as string),
        );
        const igual = (depois: Mapa, forcadas: string[]) => {
          for (const [id, cond] of Object.entries(antes)) {
            const esp: Record<string, boolean> = { ...cond };
            if (soId.has(id)) esp.colecao_preenchida = true;
            for (const k of forcadas) esp[k] = true;
            expect(depois[id], id).toEqual(esp);
          }
        };
        igual(await mapa(c, T), []);
        // a Loja Teste precisa ter card com alguma condição de Produção/Explosão FALSE, senão o teste não prova nada
        const algumFalso = (ks: string[]) =>
          Object.values(antes).some((m) => ks.some((k) => m[k] === false));
        expect(algumFalso(PROD) && algumFalso(ES)).toBe(true);

        await modulos(c, T, { producao: false });
        igual(await mapa(c, T), PROD);
        await modulos(c, T, { producao: true, entrada_saida: false });
        igual(await mapa(c, T), ES);
        await modulos(c, T, { entrada_saida: true, criacao: false });
        igual(await mapa(c, T), ES);
        await modulos(c, T, { criacao: true });
        igual(await mapa(c, T), []);
      });
    });

    it("a RPC avaliar_condicoes_kanban (a que a tela lê) devolve o mesmo 'não se aplica'", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '180s'");
        await comT3(c);
        await board(c);
        const id = await cardKanban(c, "etapa_b");
        await modulos(c, T, { producao: false });
        await comoUsuario(c);
        const r = await um<{ j: Record<string, boolean> }>(
          c,
          `SELECT public.avaliar_condicoes_kanban(ARRAY[$1::uuid]) -> $2 AS j`,
          [id, id],
        );
        for (const k of PROD) expect(r.j[k], k).toBe(true);
        await modulos(c, T, { producao: true });
        const r2 = await um<{ j: Record<string, boolean> }>(
          c,
          `SELECT public.avaliar_condicoes_kanban(ARRAY[$1::uuid]) -> $2 AS j`,
          [id, id],
        );
        expect(r2.j.cq_liberado).toBe(false);
      });
    });
  },
);

// ─────────────────────────────────────────── 2. derivação (chave ligada) ───────────────────────────────────────────
describe.skipIf(!RODA)("mod T3 — derivação do kanban automático", () => {
  it("Etapa A exige cq_liberado: sem Produção o card passa de A (alvo Etapa B); com Produção para antes de A", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      await comT3(c);
      await board(c);
      await chave(c, true);
      const id = await cardKanban(c, "entrada");
      await modulos(c, T, { producao: true });
      expect(await alvo(c, id)).toBe("entrada");
      await modulos(c, T, { producao: false });
      expect(await alvo(c, id)).toBe("etapa_b");
      // super admin com JWT NÃO muda a regra (M2: módulo da LOJA, sem atalho de super)
      await comoUsuario(c);
      await modulos(c, T, { producao: true });
      expect(await alvo(c, id)).toBe("entrada");
    });
  });
});

// ─────────────────────────────────────────── 3. salvar_loja re-enfileira (M4) ───────────────────────────────────────────
describe.skipIf(!RODA)(
  "mod T3 — salvar_loja re-enfileira o kanban da loja quando os módulos mudam (M4)",
  () => {
    it("módulos diferentes → fila da loja; no COMMIT o card anda (origem auto); voltar Produção → o card volta", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '180s'");
        await comT3(c);
        await board(c);
        await modulos(c, T, { producao: true });
        await chave(c, true);
        await imediato(c);
        const id = await cardKanban(c, "entrada");
        await c.query(`DELETE FROM public.kanban_recalculo_fila WHERE tenant_id = $1`, [T]);
        expect(await filaDaLoja(c)).toBe(0);
        const mods = await modulosDe(c);
        await salvarLoja(c, { ...mods, producao: false });
        expect((await modulosDe(c)).producao).toBe(false);
        const n = await filaDaLoja(c);
        expect(n).toBeGreaterThan(0);
        expect(
          (
            await um<{ n: string }>(
              c,
              `SELECT count(*) AS n FROM public.kanban_recalculo_fila WHERE modelo_id = $1`,
              [id],
            )
          ).n,
        ).toBe("1");
        await imediato(c); // simula o COMMIT: o processador adiado roda
        expect(await statusDe(c, id)).toBe("etapa_b");
        const hist = (
          await c.query(
            `SELECT status, origem FROM public.modelo_kanban_historico WHERE modelo_id = $1 ORDER BY entrou_at, created_at`,
            [id],
          )
        ).rows.map((r) => `${r.status}:${r.origem}`);
        expect(hist).toContain("etapa_b:auto");
        expect(await filaDaLoja(c)).toBe(0);
        // religar Produção pelo Gerenciar Lojas: o card volta sozinho (regra de entrada volta a valer)
        await salvarLoja(c, { ...mods, producao: true });
        expect(await filaDaLoja(c)).toBeGreaterThan(0);
        await imediato(c);
        expect(await statusDe(c, id)).toBe("entrada");
      });
    });

    it("só o nome (ou módulos iguais / NULL) → nenhuma linha; chave desligada → nenhuma linha", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '180s'");
        await comT3(c);
        await board(c);
        await chave(c, true);
        await imediato(c);
        await c.query(`DELETE FROM public.kanban_recalculo_fila WHERE tenant_id = $1`, [T]);
        const mods = await modulosDe(c);
        await salvarLoja(c, mods, "Loja Teste (mod3)");
        expect(await filaDaLoja(c)).toBe(0);
        await salvarLoja(c, null);
        expect(await filaDaLoja(c)).toBe(0);
        await chave(c, false);
        await salvarLoja(c, { ...mods, producao: !mods.producao });
        expect(await filaDaLoja(c)).toBe(0);
      });
    });

    it("sem a T3 (salvar_loja de antes) mudar módulos não enfileira (contraste)", async () => {
      await withTx(async (c) => {
        await semT3(c);
        await board(c);
        await chave(c, true);
        await imediato(c);
        await c.query(`DELETE FROM public.kanban_recalculo_fila WHERE tenant_id = $1`, [T]);
        const mods = await modulosDe(c);
        await salvarLoja(c, { ...mods, producao: !mods.producao });
        expect(await filaDaLoja(c)).toBe(0);
      });
    });
  },
);

// ─────────────────────────────────────────── 4. cascata (chave desligada) ───────────────────────────────────────────
describe.skipIf(!RODA)("mod T3 — cascata com a chave DESLIGADA (_kanban_regredir_modelo)", () => {
  it("card em Etapa B sem CQ: sem Produção não é rebaixado; com Produção volta para Etapa A", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      await comT3(c);
      await board(c);
      await modulos(c, T, { producao: false });
      const id = await cardKanban(c, "etapa_b");
      await c.query(`SELECT public._kanban_regredir_modelo($1)`, [id]);
      expect(await statusDe(c, id)).toBe("etapa_b");
      await modulos(c, T, { producao: true });
      await c.query(`SELECT public._kanban_regredir_modelo($1)`, [id]);
      expect(await statusDe(c, id)).toBe("etapa_a");
    });
  });
});

// ─────────────────────────────────────────── 5. colecao_preenchida (P12) ───────────────────────────────────────────
describe.skipIf(!RODA)("mod T3 — colecao_preenchida aceita a coleção do OTB (P12)", () => {
  it("colecao_id com texto vazio = true; texto sem id = true; sem os dois = false (antes da T3: só o texto)", async () => {
    await withTx(async (c) => {
      await semT3(c);
      const col = await um<{ id: string }>(
        c,
        `SELECT id FROM public.colecoes WHERE tenant_id = $1 LIMIT 1`,
        [T],
      );
      expect(col?.id, "a Loja Teste precisa de ≥1 coleção").toBeTruthy();
      const novo = async (colecao: string | null, colecaoId: string | null) =>
        (
          await um<{ id: string }>(
            c,
            `INSERT INTO public.modelos (tenant_id, nome, versao, colecao, colecao_id) VALUES ($1, 'Mod3 col', 1, $2, $3) RETURNING id`,
            [T, colecao, colecaoId],
          )
        ).id;
      const soId = await novo("", col.id);
      const soIdNull = await novo(null, col.id);
      const soTexto = await novo("Verão", null);
      const nada = await novo("  ", null);
      const ids = [soId, soIdNull, soTexto, nada];
      const ler = async () => {
        const m = await mapa(c, T, ids);
        return ids.map((i) => m[i].colecao_preenchida);
      };
      expect(await ler()).toEqual([false, false, true, false]);
      await comT3(c);
      expect(await ler()).toEqual([true, true, true, false]);
    });
  });
});

// ─────────────────────────────────────────── 6. Dashboards pelo rótulo (P12, M10) ───────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsonb livre dos _core de Dashboard
type J = Record<string, any>;
const CORES = {
  colecao: (p: string | null) =>
    [`SELECT public._dashboard_colecao_core(NULL, NULL, $1, NULL, NULL) AS j`, [p]] as const,
  custos: (p: string | null) =>
    [`SELECT public._dashboard_custos_core(NULL, NULL, $1, NULL, NULL) AS j`, [p]] as const,
  producao: (p: string | null) =>
    [`SELECT public._dashboard_producao_core(NULL, NULL, $1, NULL) AS j`, [p]] as const,
  servicos: (p: string | null) =>
    [
      `SELECT public._dashboard_producao_servicos_core(NULL, NULL, $1, NULL, NULL) AS j`,
      [p],
    ] as const,
};
type Core = keyof typeof CORES;
async function chama(c: Client, core: Core, p: string | null): Promise<J> {
  const [sql, params] = CORES[core](p);
  return (await um<{ j: J }>(c, sql, [...params])).j;
}
/** Chaves (caminho de topo / filtros.X) que podem mudar com p_colecao NULL: as listas e agrupamentos por coleção. */
const MUDAM_SEM_FILTRO: Record<Core, string[]> = {
  colecao: ["filtros.colecoes"],
  custos: ["filtros.colecoes", "rows", "chartData"],
  producao: ["filtros.colecoes", "porColecao"],
  servicos: [],
};
function semChaves(j: J, chaves: string[]): J {
  const o: J = JSON.parse(JSON.stringify(j));
  for (const k of chaves) {
    const [a, b] = k.split(".");
    if (b) delete o[a]?.[b];
    else delete o[a];
  }
  return o;
}

describe.skipIf(!RODA)(
  "mod T3 — Dashboards: coleção pelo rótulo (nome do OTB, senão o texto) — P12/M10",
  () => {
    it("pré-condição de M10: nenhum card com texto ≠ nome da coleção; rótulo SQL ≡ _integracao_extras ≡ rotuloColecao (TS)", async () => {
      await withTx(async (c) => {
        await comT3(c);
        const dif = await um<{ n: string }>(
          c,
          `SELECT count(*) AS n FROM public.modelos m JOIN public.colecoes co ON co.id = m.colecao_id AND co.tenant_id = m.tenant_id
          WHERE coalesce(btrim(m.colecao), '') <> '' AND m.colecao <> co.nome`,
        );
        expect(dif.n).toBe("0");
        const { rows } = await c.query(
          `SELECT m.id, m.colecao, co.nome AS colecao_nome,
                public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) AS rot,
                public._integracao_extras(m.id) ->> 'colecao' AS integ
           FROM public.modelos m LEFT JOIN public.colecoes co ON co.id = m.colecao_id AND co.tenant_id = m.tenant_id`,
        );
        expect(rows.length).toBeGreaterThan(100);
        for (const r of rows) {
          expect(r.rot, r.id).toBe(r.integ);
          expect(rotuloColecao({ colecao: r.colecao, colecaoNome: r.colecao_nome }), r.id).toBe(
            r.rot,
          );
        }
      });
    });

    it("Ave Rara: sem filtro só mudam listas/agrupamentos por coleção; filtro pelo nome traz os cards só-id; listas = rótulos", async () => {
      await withTx(async (c) => {
        await semT3(c);
        await comoUsuario(c);
        await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [
          AVE_RARA,
          USER_TESTE,
        ]);
        const colecoes = (
          await c.query(
            // a MESMA regra do rótulo, escrita à mão (a função ainda não existe no estado "antes" da cópia)
            `SELECT DISTINCT coalesce(co.nome::text, nullif(btrim(coalesce(m.colecao, '')), '')) AS r
             FROM public.modelos m LEFT JOIN public.colecoes co ON co.id = m.colecao_id AND co.tenant_id = m.tenant_id
            WHERE m.tenant_id = $1 ORDER BY 1`,
            [AVE_RARA],
          )
        ).rows
          .map((r) => r.r as string | null)
          .filter((r): r is string => r !== null);
        // coleções cujos cards são SÓ por id (o filtro pelo texto não as achava)
        const soId = (
          await c.query(
            `SELECT DISTINCT co.nome AS n FROM public.modelos m JOIN public.colecoes co ON co.id = m.colecao_id
            WHERE m.tenant_id = $1 AND coalesce(btrim(m.colecao), '') = ''`,
            [AVE_RARA],
          )
        ).rows.map((r) => r.n as string);
        expect(soId.length, "Ave Rara tem coleção com card só-id").toBeGreaterThan(0);
        const filtros: (string | null)[] = [null, ...colecoes];
        const antes: Record<string, J> = {};
        for (const core of Object.keys(CORES) as Core[])
          for (const p of filtros) antes[`${core}|${p}`] = await chama(c, core, p);
        await comT3(c);

        const contagem = async (p: string, porRotulo: boolean) =>
          Number(
            (
              await um<{ n: string }>(
                c,
                `SELECT count(*) AS n FROM public.modelos m WHERE m.tenant_id = $1 AND ${
                  porRotulo
                    ? "public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao)"
                    : "m.colecao"
                } = $2`,
                [AVE_RARA, p],
              )
            ).n,
          );
        for (const core of Object.keys(CORES) as Core[]) {
          for (const p of filtros) {
            const a = antes[`${core}|${p}`];
            const d = await chama(c, core, p);
            if (p === null) {
              expect(semChaves(d, MUDAM_SEM_FILTRO[core]), `${core} sem filtro`).toEqual(
                semChaves(a, MUDAM_SEM_FILTRO[core]),
              );
            } else if (!soId.includes(p)) {
              // coleção só com texto: os cards filtrados são os mesmos — só as listas de coleções mudam
              expect(semChaves(d, ["filtros.colecoes"]), `${core} ${p}`).toEqual(
                semChaves(a, ["filtros.colecoes"]),
              );
            }
            if (core !== "servicos" && d.filtros?.colecoes) {
              expect([...d.filtros.colecoes].sort(), `${core} lista`).toEqual([...colecoes].sort());
            }
          }
        }
        // o filtro pelo nome agora pega os cards só-id (KPIs total do Comercial & Coleção; linhas de Custos)
        for (const p of soId) {
          const nRot = await contagem(p, true);
          expect(nRot).toBeGreaterThan(await contagem(p, false));
          expect((await chama(c, "colecao", p)).kpis.total, p).toBe(nRot);
          expect((antes[`colecao|${p}`] as J).kpis.total, p).toBe(await contagem(p, false));
          expect((await chama(c, "custos", p)).rows.length, p).toBe(nRot);
        }
        // agrupamento da Produção sem filtro: só-id entram na coleção pelo nome (nenhum grupo vazio "")
        const pc = (await chama(c, "producao", null)).porColecao as {
          nome: string;
          modelos: number;
        }[];
        expect(pc.every((g) => g.nome !== "" && g.nome !== null)).toBe(true);
        const totalGrupos = pc.reduce((s, g) => s + Number(g.modelos), 0);
        expect(totalGrupos).toBe(
          Number(
            (
              await um<{ n: string }>(
                c,
                `SELECT count(*) AS n FROM public.modelos m WHERE m.tenant_id = $1
                 AND public._modelo_colecao_rotulo(m.tenant_id, m.colecao_id, m.colecao) IS NOT NULL`,
                [AVE_RARA],
              )
            ).n,
          ),
        );
      });
    });
  },
);

// ─────────────────────────────────────────── 7. anti-drift ───────────────────────────────────────────
describe.skipIf(!RODA)(
  "mod T3 — anti-drift: _kanban_cond_modulos() ≡ `requer` do catálogo TS",
  () => {
    it("o mapa SQL é exatamente CONDICOES.filter(c => c.requer); toda chave existe no catálogo; o dado gerado bate", async () => {
      await withTx(async (c) => {
        await comT3(c);
        const sql = (
          await um<{ j: Record<string, string[]> }>(c, `SELECT public._kanban_cond_modulos() AS j`)
        ).j;
        const ts = Object.fromEntries(
          CONDICOES.filter((x) => x.requer).map((x) => [x.key, x.requer!]),
        );
        expect(sql).toEqual(ts);
        expect(MOD3_M5).toEqual(ts);
        for (const k of Object.keys(sql)) expect(CONDICAO_KEYS, k).toContain(k);
        expect(Object.keys(sql).sort()).toEqual([...ES, ...PROD].sort());
        expect(sql.lancado).toBeUndefined(); // P-252 A
      });
    });
  },
);

// ─────────────────────────────────────────── 8. migration ───────────────────────────────────────────
describe.skipIf(!RODA)(
  "mod T3 — migration (idempotente, _down neutro, _down_drop, guarda, pós-condições, LIFO)",
  () => {
    const confere = async (c: Client, qual: "antes" | "depois") => {
      for (const [sig, m] of Object.entries(MOD_MD5))
        expect(await md5(c, sig), `${sig} ${qual}`).toBe(m[qual]);
    };
    type Linha = Record<string, unknown>;
    const aclDe = (c: Client, sig: string) =>
      um<Linha>(
        c,
        `select coalesce(p.proacl::text,'') acl, p.prosecdef sd, p.proconfig cfg,
              has_function_privilege('anon', p.oid, 'EXECUTE') anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
              has_function_privilege('service_role', p.oid, 'EXECUTE') svc,
              exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0) pub
         from pg_proc p where p.oid = to_regprocedure($1)`,
        [sig],
      );

    it("ida 2×; ACL; _down_drop recusa com a ida viva; _down 2× → antes (auxiliares ficam); ida de novo; _down + _down_drop", async () => {
      await withTx(async (c) => {
        await semT3(c);
        await confere(c, "antes");
        for (const [sig, m] of Object.entries(MOD3_DEPS)) expect(await md5(c, sig), sig).toBe(m);
        await aplicarArquivo(c, MOD_MIG);
        await aplicarArquivo(c, MOD_MIG); // idempotente
        await confere(c, "depois");
        for (const [sig, m] of Object.entries(MOD3_AUX)) {
          expect(await md5(c, sig), sig).toBe(m);
          expect(await aclDe(c, sig), sig).toEqual({
            acl: "{postgres=X/postgres,service_role=X/postgres}",
            sd: true,
            cfg: ["search_path=public"],
            anon: false,
            auth: false,
            svc: true,
            pub: false,
          });
        }
        for (const [sig, acl] of Object.entries(MOD3_ACL)) {
          const r = await aclDe(c, sig);
          expect([r.acl, r.sd, r.cfg, r.anon, r.auth, r.pub], sig).toEqual([
            acl,
            true,
            ["search_path=public"],
            false,
            sig.startsWith("public.salvar_loja"), // só o wrapper do Gerenciar Lojas é chamável; os _core seguem internos
            false,
          ]);
        }
        await expect(aplicarArquivo(c, MOD_DOWN_DROP)).rejects.toThrow(
          /mod3_drop: rode o _down antes .*_avaliar_condicoes_kanban_core/,
        );
        await aplicarArquivo(c, MOD_DOWN);
        await aplicarArquivo(c, MOD_DOWN);
        await confere(c, "antes");
        for (const [sig, m] of Object.entries(MOD3_AUX))
          expect(await md5(c, sig), `${sig} fica`).toBe(m);
        await aplicarArquivo(c, MOD_MIG);
        await confere(c, "depois");
        await aplicarArquivo(c, MOD_DOWN);
        await aplicarArquivo(c, MOD_DOWN_DROP);
        for (const sig of Object.keys(MOD3_AUX))
          expect(await md5(c, sig), `${sig} apagado`).toBeNull();
        await confere(c, "antes");
        // e a ida recria tudo do zero
        await aplicarArquivo(c, MOD_MIG);
        await confere(c, "depois");
      });
    });

    it("guarda: função mexida por outra frente → a ida e o _down recusam e nada muda", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '180s'");
        await comT3(c);
        const def = (
          await um<{ d: string }>(
            c,
            `SELECT pg_get_functiondef('public.salvar_loja(uuid,text,text,text,text,jsonb)'::regprocedure) AS d`,
          )
        ).d;
        await c.query(def.replace("BEGIN\n", "BEGIN\n  -- outra frente\n"));
        const mexida = await md5(c, "public.salvar_loja(uuid,text,text,text,text,jsonb)");
        await expect(aplicarArquivo(c, MOD_MIG)).rejects.toThrow(
          /mod3_kanban_colecao: public\.salvar_loja.* com texto inesperado/,
        );
        await expect(aplicarArquivo(c, MOD_DOWN)).rejects.toThrow(
          /mod3_kanban_colecao_down: public\.salvar_loja.* com texto inesperado/,
        );
        expect(await md5(c, "public.salvar_loja(uuid,text,text,text,text,jsonb)")).toBe(mexida);
        const av = "public._avaliar_condicoes_kanban_core(uuid,uuid[])";
        expect(await md5(c, av)).toBe(MOD_MD5[av].depois);
      });
    });

    it("LIFO: com a T3 viva (mesmo depois do _down da T2 e da T1) o _down_drop da T1 recusa; depois do _down/_down_drop da T3, passa", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '180s'");
        await comT3(c);
        // LIFO: o Backend (por cima da Modularidade) sai antes dos _down antigos — a B3 (20261103147000) redefine
        // voltar_modelo_desenvolvimento, que o _down da T1 guarda por md5.
        await voltaBkSePreciso(c);
        await dropUrgbSePreciso(c);
        await dropUrgAExtratoSePreciso(c); // [urg R3 T14] o extrato (177000) cita _exige_modulos: o _down_drop dele vem antes (LIFO)
        await aplicarArquivo(c, MOD2_DOWN);
        await aplicarArquivo(c, MOD1_DOWN);
        await expect(aplicarArquivo(c, MOD1_DOWN_DROP)).rejects.toThrow(
          /mod1_drop: rode o _down antes .*_kanban_cond_na/,
        );
        await aplicarArquivo(c, MOD_DOWN);
        await aplicarArquivo(c, MOD_DOWN_DROP);
        await aplicarArquivo(c, MOD1_DOWN_DROP);
        expect(await md5(c, "public._tenant_modulo_ligado(uuid,text)")).toBeNull();
        await confere(c, "antes");
      });
    });

    it("voltaMod (cadeia S) desfaz a T3 junto (registro do bloco 3 em mod-helpers)", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '180s'");
        expect(MOD_MIGS.map((b) => b.n)).toContain(3);
        expect(existsSync(ROOT + MOD_MIG)).toBe(true);
        await comT3(c);
        await voltaMod(c);
        await confere(c, "antes");
        expect(await modViva(c, 3)).toBe(false);
      });
    });
  },
);
