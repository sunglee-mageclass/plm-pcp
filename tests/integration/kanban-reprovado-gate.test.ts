// Achados MÉDIOS — release R14, kanban #7 (P-190 A, dono 01/out). Migration 20261024100000_kanban_reprovado_nao_passa_gate.sql.
//   Reprovado é EXCEÇÃO à decisão 10: com a chave do Kanban automático LIGADA, card em 'reprovado' NUNCA revela a REF nem
//   passa no gate da Explosão (a posição DERIVADA não vale para ele) — SQL _kanban_status_gate / revela_ref do
//   _kanban_aplicar / kanban_previa_recalculo e TS statusParaGate (anti-drift pela fixture GATE_CASOS). Outras colunas
//   manuais seguem pela posição derivada.
// Txn revertida (BEGIN…ROLLBACK): nada é gravado. Reescreve a config da Loja Teste DENTRO da txn → só na CÓPIA LOCAL.
// Fixture ausente = FALHA (nunca passa calado).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { BOARD_GATE, GATE_CASOS, REQS_GATE } from "../fixtures/kanban-auto-casos";
import { statusParaGate, type Derivacao } from "../../src/lib/kanban-auto";

const LOCAL = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const HOJE = "2026-09-01";
const CAMPOS_COND = [
  "data_desenho_tecnico",
  "data_piloto1",
  "data_piloto2",
  "data_aprovacao",
] as const;

const MD5_DEPOIS = {
  "_kanban_status_gate(uuid,uuid,text)": "635c7bbad3a3db2779f68fd1c5c8a954",
  "_kanban_aplicar(uuid,uuid[],text,uuid)": "9c50c6700d5bedc22b53ee95466d43f4",
  "kanban_previa_recalculo(jsonb)": "1ed117822a5dc7b5a3f54559ba68b89b",
  "_kanban_derivar_lote(uuid,uuid[],jsonb)": "0755d9ad499379295ba24c7a669daa76",
} as const;

async function chave(c: Client, ligada: boolean) {
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
/** Board sintético da Loja Teste NA TXN: 'reprovado' DEPOIS de etapa_c (a etapa da REF e da Explosão). */
async function configurarBoard(c: Client) {
  await chave(c, false);
  const r = await c.query(
    `UPDATE public.tenant_config
        SET status_kanban = $2::jsonb, kanban_requisitos = $3::jsonb, kanban_requisitos_excecoes = '{}'::jsonb,
            revenda_kanban_colunas = '[]'::jsonb, revenda_kanban_requisitos = '{}'::jsonb,
            ref_exibir_status = 'etapa_c', explosao_envio_status = 'etapa_c'
      WHERE tenant_id = $1`,
    [T, JSON.stringify(BOARD_GATE), JSON.stringify(REQS_GATE)],
  );
  if (r.rowCount !== 1) throw new Error("fixture ausente: tenant_config da Loja Teste");
}
async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query(`SELECT set_config('app.kanban_sistema', 'teste', true)`);
  try {
    return await fn();
  } finally {
    await c.query(`SELECT set_config('app.kanban_sistema', '', true)`);
  }
}
async function novoModelo(c: Client, campos: Record<string, unknown> = {}): Promise<string> {
  const base = await um<{ c: string | null; s: string | null } | undefined>(
    c,
    `SELECT categoria_principal_id AS c, subcategoria1_id AS s FROM public.modelos
      WHERE tenant_id = $1 AND categoria_principal_id IS NOT NULL AND subcategoria1_id IS NOT NULL LIMIT 1`,
    [T],
  );
  if (!base?.c || !base?.s)
    throw new Error("fixture ausente: modelo com categoria+subcategoria na Loja Teste");
  const cols: Record<string, unknown> = {
    tenant_id: T,
    nome: "R14 reprovado gate",
    ordem_criacao_enviada: true,
    status_desenvolvimento: "entrada",
    categoria_principal_id: base.c,
    subcategoria1_id: base.s,
    ...campos,
  };
  const nomes = Object.keys(cols);
  const r = await um<{ id: string }>(
    c,
    `INSERT INTO public.modelos (${nomes.join(", ")}) VALUES (${nomes.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    Object.values(cols),
  );
  return r.id;
}
async function setar(c: Client, id: string, campos: Record<string, unknown>) {
  const nomes = Object.keys(campos);
  await c.query(
    `UPDATE public.modelos SET ${nomes.map((n, i) => `${n} = $${i + 2}`).join(", ")} WHERE id = $1`,
    [id, ...Object.values(campos)],
  );
}
async function lerModelo(c: Client, id: string) {
  return um<{ status: string | null; ref: string | null; ref_auto: string | null }>(
    c,
    `SELECT status_desenvolvimento AS status, ref, ref_auto FROM public.modelos WHERE id = $1`,
    [id],
  );
}
/** Simula o COMMIT p/ o constraint trigger adiado (fila do motor) e volta ao modo adiado. */
async function imediato(c: Client) {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}
async function gate(c: Client, M: string, status: string): Promise<string | null> {
  return (
    await um<{ g: string | null }>(c, `SELECT public._kanban_status_gate($1, $2, $3) AS g`, [
      T,
      M,
      status,
    ])
  ).g;
}
/** Card com as condições dadas, REF escondida (ref = '' com ref_auto), já fixado no status pedido SEM passar pelo motor. */
async function cardFixado(
  c: Client,
  cond: Record<string, boolean>,
  status: string,
): Promise<string> {
  const campos: Record<string, unknown> = {};
  for (const k of CAMPOS_COND) if (cond[k]) campos[k] = HOJE;
  const M = await comoSistema(c, () => novoModelo(c, campos));
  await comoSistema(c, () =>
    c.query(`UPDATE public.modelos SET status_desenvolvimento = $2 WHERE id = $1`, [M, status]),
  );
  // 2º UPDATE só de ref: fn_modelo_ref_auto não age (nada relevante mudou) → a REF fica escondida
  await comoSistema(c, () => c.query(`UPDATE public.modelos SET ref = '' WHERE id = $1`, [M]));
  const m = await lerModelo(c, M);
  if ((m.ref ?? "") !== "" || (m.ref_auto ?? "") === "")
    throw new Error("fixture: card de teste sem ref_auto ou com REF já revelada");
  return M;
}
async function erroDe(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e: unknown) {
    const pe = e as { code?: string; message?: string };
    return { code: String(pe.code), message: String(pe.message) };
  }
  throw new Error("esperava recusa, mas a chamada passou");
}

describe.skipIf(!hasDb)("R14 kanban #7 — md5 e ACL (20261024100000)", () => {
  it("as 3 funções estão com o texto da migration e _kanban_derivar_lote intocada", async () => {
    await withTx(async (c) => {
      for (const [sig, md5] of Object.entries(MD5_DEPOIS)) {
        const r = await um<{ m: string | null }>(
          c,
          `SELECT CASE WHEN to_regprocedure($1) IS NULL THEN NULL ELSE md5(pg_get_functiondef(to_regprocedure($1))) END AS m`,
          ["public." + sig],
        );
        expect(r.m, sig).toBe(md5);
      }
    });
  });
  it("inv. #9: internos sem EXECUTE p/ PUBLIC/anon/authenticated; a prévia com authenticated e sem anon/PUBLIC", async () => {
    await withTx(async (c) => {
      for (const sig of [
        "_kanban_status_gate(uuid,uuid,text)",
        "_kanban_aplicar(uuid,uuid[],text,uuid)",
        "_kanban_derivar_lote(uuid,uuid[],jsonb)",
      ]) {
        const r = await um<{ a: boolean; u: boolean; p: boolean }>(
          c,
          `SELECT has_function_privilege('anon', $1::regprocedure, 'EXECUTE') a,
                  has_function_privilege('authenticated', $1::regprocedure, 'EXECUTE') u,
                  EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                           WHERE p.oid = $1::regprocedure AND x.grantee = 0 AND x.privilege_type = 'EXECUTE') p`,
          ["public." + sig],
        );
        expect([r.a, r.u, r.p], sig).toEqual([false, false, false]);
      }
      const p = await um<{ a: boolean; u: boolean; pub: boolean }>(
        c,
        `SELECT has_function_privilege('anon', 'public.kanban_previa_recalculo(jsonb)'::regprocedure, 'EXECUTE') a,
                has_function_privilege('authenticated', 'public.kanban_previa_recalculo(jsonb)'::regprocedure, 'EXECUTE') u,
                EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x
                         WHERE p.oid = 'public.kanban_previa_recalculo(jsonb)'::regprocedure AND x.grantee = 0
                           AND x.privilege_type = 'EXECUTE') pub`,
      );
      expect([p.a, p.u, p.pub]).toEqual([false, true, false]);
    });
  });
});

describe.skipIf(!LOCAL)(
  "R14 kanban #7 — anti-drift GATE_CASOS: SQL _kanban_status_gate × TS statusParaGate",
  () => {
    it("fixture não está vazia (anti-calado)", () => {
      expect(GATE_CASOS.length).toBeGreaterThanOrEqual(7);
    });
    for (const g of GATE_CASOS) {
      it(g.nome, async () => {
        await withTx(async (c) => {
          await c.query("SET LOCAL lock_timeout = '3s'");
          await configurarBoard(c);
          const M = await cardFixado(c, g.cond, g.status);
          await chave(c, g.ligado);
          const sql = await gate(c, M, g.status);
          // a derivação vem do SQL (mesma que o card recebe na tela); o TS decide o gate em cima dela
          const d = await um<{
            derivavel: boolean;
            entrada: string | null;
            alvo: string | null;
            resultado: string | null;
            fixado: boolean;
            primeira_falha: string | null;
            faltando: string[];
          }>(
            c,
            `SELECT derivavel, entrada, alvo, resultado, fixado, primeira_falha, faltando FROM public._kanban_derivar_lote($1, ARRAY[$2]::uuid[])`,
            [T, M],
          );
          const der: Derivacao = {
            derivavel: d.derivavel,
            entrada: d.entrada,
            alvo: d.alvo,
            resultado: d.resultado,
            fixado: d.fixado,
            primeiraFalha: d.primeira_falha,
            faltando: d.faltando,
          };
          expect(sql).toBe(g.esperado);
          expect(statusParaGate(g.ligado, der, g.status)).toBe(sql);
        });
      });
    }
  },
);

describe.skipIf(!LOCAL)(
  "R14 kanban #7 — reprovado fixado com a posição derivada ≥ etapa (chave ligada)",
  () => {
    it("motor (_kanban_aplicar no COMMIT) NÃO revela a REF e a Explosão é RECUSADA; stand_by na mesma situação revela e libera (controle)", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await comoUsuario(c);
        await configurarBoard(c);
        const tudoAteC = { data_desenho_tecnico: true, data_piloto1: true, data_piloto2: true };
        const R = await cardFixado(c, tudoAteC, "reprovado");
        const S = await cardFixado(c, tudoAteC, "stand_by");
        await chave(c, true);
        // o motor (o mesmo _kanban_aplicar que a fila roda no COMMIT)
        await um(c, `SELECT public._kanban_aplicar($1, ARRAY[$2, $3]::uuid[], 'auto') AS n`, [
          T,
          R,
          S,
        ]);
        const r = await lerModelo(c, R);
        const s = await lerModelo(c, S);
        expect(r.status).toBe("reprovado"); // continua fixado
        expect(r.ref ?? "").toBe(""); // P-190 A: nunca revela
        expect(s.status).toBe("stand_by");
        expect(s.ref).toBe(s.ref_auto); // controle: outra manual segue a posição derivada (decisão 10)
        await c.query("SAVEPOINT sp");
        const err = await erroDe(c.query(`SELECT public.enviar_modelo_para_cad($1)`, [R]));
        expect(err.code).toBe("P0001");
        expect(err.message).toMatch(/Etapa C/);
        await c.query("ROLLBACK TO SAVEPOINT sp");
        expect(
          (await um<{ id: string }>(c, `SELECT public.enviar_modelo_para_cad($1) AS id`, [S])).id,
        ).toBeTruthy();
      });
    });

    it("Mover para 'reprovado' à mão (fn_modelo_ref_auto) com a posição derivada = aprovado não revela; 1 UPDATE que fixa em reprovado e limpa um campo também não (risco 4 fechado p/ reprovado)", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await configurarBoard(c);
        // chave ligada ANTES dos cards (ligar com o card na entrada já o moveria e revelaria pela posição derivada);
        // os cards nascem pelo GUC de sistema (sem motor) e a REF é escondida à mão
        await chave(c, true);
        const A = await cardFixado(
          c,
          {
            data_desenho_tecnico: true,
            data_piloto1: true,
            data_piloto2: true,
            data_aprovacao: true,
          },
          "entrada",
        );
        const B = await cardFixado(
          c,
          { data_desenho_tecnico: true, data_piloto1: true, data_piloto2: true },
          "entrada",
        );
        await setar(c, A, { status_desenvolvimento: "reprovado" });
        await setar(c, B, { status_desenvolvimento: "reprovado", data_piloto2: null });
        expect((await lerModelo(c, A)).ref ?? "").toBe("");
        expect((await lerModelo(c, B)).ref ?? "").toBe("");
        await imediato(c);
        const a = await lerModelo(c, A);
        expect([a.status, a.ref ?? ""]).toEqual(["reprovado", ""]);
        expect((await lerModelo(c, B)).ref ?? "").toBe("");
        // saindo de Reprovado o card volta a seguir a posição derivada (P-190 A só vale enquanto está em reprovado)
        await setar(c, A, { status_desenvolvimento: "stand_by" });
        await imediato(c);
        const a2 = await lerModelo(c, A);
        expect(a2.status).toBe("stand_by");
        expect(a2.ref).toBe(a2.ref_auto);
      });
    });

    it("chave DESLIGADA: nada muda — o gate segue o status gravado ('reprovado' depois de etapa_c passa, como antes)", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await comoUsuario(c);
        await configurarBoard(c);
        const R = await cardFixado(c, {}, "reprovado");
        expect(await gate(c, R, "reprovado")).toBe("reprovado");
        expect(
          (
            await um<{ ok: boolean }>(
              c,
              `SELECT public._ref_exibir_gate($1, public._kanban_status_gate($1, $2, 'reprovado')) AS ok`,
              [T, R],
            )
          ).ok,
        ).toBe(true);
      });
    });
  },
);

describe.skipIf(!LOCAL)(
  "R14 kanban #7 — prévia (kanban_previa_recalculo) não lista REF de reprovado",
  () => {
    it("ligar a chave: refs_reveladas tem o stand_by (controle) e NÃO tem o reprovado; revelam_ref conta igual", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL lock_timeout = '3s'");
        await comoUsuario(c);
        await configurarBoard(c);
        const tudoAteC = { data_desenho_tecnico: true, data_piloto1: true, data_piloto2: true };
        const R = await cardFixado(c, tudoAteC, "reprovado");
        const S = await cardFixado(c, tudoAteC, "stand_by");
        const p = await um<{
          p: {
            revelam_ref: number;
            refs_reveladas: { modelo_id: string }[];
            cards_fixados: { modelo_id: string }[];
          };
        }>(c, `SELECT public.kanban_previa_recalculo('{"kanban_automatico": true}'::jsonb) AS p`);
        const ids = p.p.refs_reveladas.map((x) => x.modelo_id);
        const fixados = p.p.cards_fixados.map((x) => x.modelo_id);
        expect(fixados).toEqual(expect.arrayContaining([R, S])); // os dois estão na prévia (fixados)
        expect(ids).toContain(S);
        expect(ids).not.toContain(R);
        expect(p.p.revelam_ref).toBe(ids.length);
      });
    });
  },
);
