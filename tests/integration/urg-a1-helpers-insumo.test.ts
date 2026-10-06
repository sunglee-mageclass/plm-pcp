// Urgentes R1 T2 (plan-a, migration 20261103170000_urg_r1_insumo_tamanho_base): coluna etiquetas.tamanho_vinculado + 6 helpers SQL
// do "insumo vinculado a UM tamanho". Anti-drift SQL x TS: CADA caso de tests/fixtures/insumo-tamanho-casos.ts (a MESMA fixture do
// espelho src/lib/insumo-tamanho.ts) e reproduzido pelos helpers, com a grade gravada de verdade em modelo_grades e cad_grades.
// Txn revertida; o bloco e aplicado DENTRO da txn por aplicaUrgA(c, "170000") (pula se ja vivo na copia). So na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, um, ehBancoLocal, TENANT_TESTE } from "./db";
import {
  aplicaUrgA,
  voltaUrgASePreciso,
  dropUrgAExtratoSePreciso,
  zeraVinculosTamanhoNaTxn,
  URG_A_MIGS,
} from "./urg-a-helpers";
import { aplicarArquivo } from "./mig-txn";
import { CASOS_INSUMO_TAMANHO, type CasoInsumoTamanho } from "../fixtures/insumo-tamanho-casos";

const RODA = hasDb && ehBancoLocal();
const bloco = () => URG_A_MIGS.find((x) => x.id === "170000")?.b;

const PUROS = [
  "public._insumo_tamanho_efetivo(text,text,boolean)",
  "public._insumo_pecas(text,jsonb,numeric)",
  "public._insumo_fator_custo(text,jsonb,numeric)",
];
const LEITORES = [
  "public._insumo_tamanho_de(uuid)",
  "public._grade_mapa_modelo(uuid)",
  "public._grade_mapa_cad(uuid,boolean)",
];
const HELPERS = [...PUROS, ...LEITORES];

const round4 = (n: number) => Number(n.toFixed(4));

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}

/** Modelo + CAD de teste (como postgres, sem JWT) — a grade de cada caso e gravada neles. */
async function cenario(c: Client): Promise<{ modelo: string; cad: string }> {
  await aplicaUrgA(c, "170000");
  const sufixo = Math.random().toString(36).slice(2, 8);
  const modelo = (
    await um<{ id: string }>(c, "INSERT INTO modelos (tenant_id, nome) VALUES ($1, $2) RETURNING id", [
      TENANT_TESTE,
      `M URG-A1 ${sufixo}`,
    ])
  ).id;
  const cad = (
    await um<{ id: string }>(c, "INSERT INTO cad (tenant_id, modelo_id) VALUES ($1, $2) RETURNING id", [TENANT_TESTE, modelo])
  ).id;
  return { modelo, cad };
}

/** Grava a grade do caso em modelo_grades e cad_grades (planejada = real = a do caso). grades null -> jsonb 'null'. */
async function gravaGrade(c: Client, modelo: string, cad: string, linhas: CasoInsumoTamanho["linhas"]): Promise<void> {
  await c.query("DELETE FROM modelo_grades WHERE modelo_id = $1", [modelo]);
  await c.query("DELETE FROM cad_grades WHERE cad_id = $1", [cad]);
  let n = 0;
  for (const l of linhas) {
    n += 1;
    const g = JSON.stringify(l.grades); // null -> 'null' (jsonb escalar: NOT NULL passa, e o helper ignora nao-objeto)
    await c.query(
      "INSERT INTO modelo_grades (modelo_id, variante_numero, grades, grade_total) VALUES ($1, $2, $3::jsonb, $4)",
      [modelo, n, g, l.grade_total],
    );
    await c.query(
      `INSERT INTO cad_grades (cad_id, variante_numero, grades_planejadas, grade_total_planejada, grades_reais, grade_total_real)
       VALUES ($1, $2, $3::jsonb, $4, $3::jsonb, $4)`,
      [cad, n, g, l.grade_total],
    );
  }
}

describe.skipIf(!RODA)("urg R1 T2 — helpers SQL do insumo por tamanho (170000)", () => {
  it("o bloco 170000 existe no repositorio (gerado por mig/gerar-a1.mjs)", () => {
    expect(bloco()).toBeTruthy();
  });

  it("anti-drift: TODO caso da fixture (efetivo, pecas, fator) pelos helpers SQL, grade lida de modelo_grades e cad_grades", async () => {
    await withTx(async (c) => {
      const { modelo, cad } = await cenario(c);
      let i = 0;
      for (const caso of CASOS_INSUMO_TAMANHO) {
        i += 1;
        await c.query("SAVEPOINT caso");
        // 1) efetivo: direto (formato como na fixture, inclusive null) e pelo leitor _insumo_tamanho_de (insumo gravado)
        const direto = (
          await um<{ e: string | null }>(
            c,
            `SELECT public._insumo_tamanho_efetivo($1, $2,
                      EXISTS (SELECT 1 FROM jsonb_array_elements($3::jsonb) v WHERE nullif(btrim(v->>'tamanho'), '') IS NOT NULL)) AS e`,
            [caso.info.tamanho_vinculado, caso.info.formato_tamanho, JSON.stringify(caso.info.variantes)],
          )
        ).e;
        expect(direto, `${caso.nome} (efetivo direto)`).toBe(caso.esperado.efetivo);

        const etq = (
          await um<{ id: string }>(
            c,
            `INSERT INTO etiquetas (tenant_id, nome, tamanho_vinculado, formato_tamanho)
             VALUES ($1, $2, $3, coalesce($4, 'ambos')) RETURNING id`,
            [TENANT_TESTE, `ETQ URG-A1 caso ${i} ${modelo.slice(0, 6)}`, caso.info.tamanho_vinculado, caso.info.formato_tamanho],
          )
        ).id;
        for (const v of caso.info.variantes) {
          await c.query("INSERT INTO variantes_etiqueta (tenant_id, etiqueta_id, tamanho) VALUES ($1, $2, $3)", [
            TENANT_TESTE,
            etq,
            v.tamanho,
          ]);
        }
        const efetivo = (await um<{ e: string | null }>(c, "SELECT public._insumo_tamanho_de($1) AS e", [etq])).e;
        expect(efetivo, `${caso.nome} (_insumo_tamanho_de)`).toBe(caso.esperado.efetivo);

        // 2) pecas/fator com o mapa e o total lidos da grade GRAVADA (modelo; CAD planejado; CAD real)
        await gravaGrade(c, modelo, cad, caso.linhas);
        const fontes = [
          {
            rotulo: "modelo",
            sql: `SELECT public._grade_mapa_modelo($1) AS mapa,
                         (SELECT coalesce(sum(grade_total), 0) FROM modelo_grades WHERE modelo_id = $1)::numeric AS total`,
            arg: modelo,
          },
          {
            rotulo: "cad planejado",
            sql: `SELECT public._grade_mapa_cad($1, false) AS mapa,
                         (SELECT coalesce(sum(grade_total_planejada), 0) FROM cad_grades WHERE cad_id = $1)::numeric AS total`,
            arg: cad,
          },
          {
            rotulo: "cad real",
            sql: `SELECT public._grade_mapa_cad($1, true) AS mapa,
                         (SELECT coalesce(sum(grade_total_real), 0) FROM cad_grades WHERE cad_id = $1)::numeric AS total`,
            arg: cad,
          },
        ];
        for (const f of fontes) {
          const r = await um<{ pecas: string; fator: string; f4: string }>(
            c,
            `WITH g AS (${f.sql})
             SELECT public._insumo_pecas($2, g.mapa, g.total)::text AS pecas,
                    public._insumo_fator_custo($2, g.mapa, g.total)::text AS fator,
                    round(public._insumo_fator_custo($2, g.mapa, g.total), 4)::text AS f4
               FROM g`,
            [f.arg, efetivo],
          );
          expect(Number(r.pecas), `${caso.nome} (pecas, ${f.rotulo})`).toBe(caso.esperado.pecas);
          expect(Number(r.f4), `${caso.nome} (fator 4 casas, ${f.rotulo})`).toBe(round4(caso.esperado.fator));
          if (!caso.fatorAproximado) expect(Number(r.fator), `${caso.nome} (fator exato, ${f.rotulo})`).toBe(caso.esperado.fator);
        }
        await c.query("ROLLBACK TO SAVEPOINT caso");
      }
    });
  });

  it("_grade_mapa_cad: _real usa grades_reais so na linha com grade_total_real; senao a planejada (por linha, somando)", async () => {
    await withTx(async (c) => {
      const { cad } = await cenario(c);
      await c.query(
        `INSERT INTO cad_grades (cad_id, variante_numero, grades_planejadas, grade_total_planejada, grades_reais, grade_total_real)
         VALUES ($1, 1, '{"40|M": 5, "38|P": 1}', 6, '{"40|M": 99}', NULL),
                ($1, 2, '{"40|M": 7}', 7, '{"40|M": 3, "42|G": "x"}', 3)`,
        [cad],
      );
      const real = (await um<{ m: Record<string, number> }>(c, "SELECT public._grade_mapa_cad($1, true) AS m", [cad])).m;
      const plan = (await um<{ m: Record<string, number> }>(c, "SELECT public._grade_mapa_cad($1, false) AS m", [cad])).m;
      expect(real).toEqual({ "40|M": 8, "38|P": 1 }); // linha 1 sem real -> planejada (5); linha 2 real (3); 'x' fora
      expect(plan).toEqual({ "40|M": 12, "38|P": 1 });
      const nada = (await um<{ m: unknown }>(c, "SELECT public._grade_mapa_cad(gen_random_uuid(), true) AS m")).m;
      expect(nada).toEqual({});
    });
  });

  it("leitores: id inexistente -> NULL / '{}'; _insumo_pecas e _insumo_fator_custo com NULLs", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "170000");
      const r = await um<{ de: string | null; mm: unknown; p1: string; p2: string; f1: string; f2: string; f3: string }>(
        c,
        `SELECT public._insumo_tamanho_de(gen_random_uuid()) AS de,
                public._grade_mapa_modelo(gen_random_uuid()) AS mm,
                public._insumo_pecas(NULL, NULL, NULL)::text AS p1,
                public._insumo_pecas('40|M', NULL, 10)::text AS p2,
                public._insumo_fator_custo('40|M', '{"40|M": 5}', NULL)::text AS f1,
                public._insumo_fator_custo(NULL, '{"40|M": 5}', 10)::text AS f2,
                public._insumo_fator_custo('40|M', '{"40|M": 5}', -2)::text AS f3`,
      );
      expect(r.de).toBeNull();
      expect(r.mm).toEqual({});
      expect(Number(r.p1)).toBe(0);
      expect(Number(r.p2)).toBe(0);
      expect(Number(r.f1)).toBe(1);
      expect(Number(r.f2)).toBe(1);
      expect(Number(r.f3)).toBe(1);
    });
  });

  it("ACL e forma: EXECUTE so do dono/service_role (nada p/ PUBLIC, anon, authenticated); search_path=public; INVOKER; volatilidade", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "170000");
      for (const sig of HELPERS) {
        const r = await um<{ anon: boolean; auth: boolean; pub: boolean; cfg: string; sd: boolean; vol: string }>(
          c,
          `SELECT has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                  EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0) AS pub,
                  coalesce(array_to_string(p.proconfig, '|'), '') AS cfg, p.prosecdef AS sd, p.provolatile::text AS vol
             FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
          [sig],
        );
        expect(r, sig).toBeTruthy();
        expect(r.anon, `${sig} anon`).toBe(false);
        expect(r.auth, `${sig} authenticated`).toBe(false);
        expect(r.pub, `${sig} PUBLIC`).toBe(false);
        expect(r.cfg, `${sig} search_path`).toBe("search_path=public");
        expect(r.sd, `${sig} SECURITY INVOKER`).toBe(false);
        expect(r.vol, `${sig} volatilidade`).toBe(PUROS.includes(sig) ? "i" : "s");
      }
    });
  });

  it("coluna etiquetas.tamanho_vinculado: text, nullable, sem default, sem CHECK; authenticated grava (grant de tabela), anon nao le", async () => {
    await withTx(async (c) => {
      await aplicaUrgA(c, "170000");
      const col = await um<{ t: string; n: string; d: string | null }>(
        c,
        `SELECT data_type AS t, is_nullable AS n, column_default AS d FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'etiquetas' AND column_name = 'tamanho_vinculado'`,
      );
      expect(col).toEqual({ t: "text", n: "YES", d: null });
      const chk = await um<{ n: string }>(
        c,
        `SELECT count(*)::text AS n FROM pg_constraint WHERE conrelid = 'public.etiquetas'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) ~ 'tamanho_vinculado'`,
      );
      expect(chk.n).toBe("0");
      const priv = await um<{ upd: boolean; ins: boolean; anon: boolean }>(
        c,
        `SELECT has_column_privilege('authenticated', 'public.etiquetas', 'tamanho_vinculado', 'UPDATE') AS upd,
                has_column_privilege('authenticated', 'public.etiquetas', 'tamanho_vinculado', 'INSERT') AS ins,
                has_column_privilege('anon', 'public.etiquetas', 'tamanho_vinculado', 'SELECT') AS anon`,
      );
      expect(priv).toEqual({ upd: true, ins: true, anon: false });
      const com = await um<{ c: string | null }>(
        c,
        "SELECT col_description('public.etiquetas'::regclass, (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.etiquetas'::regclass AND attname = 'tamanho_vinculado')) AS c",
      );
      expect(com.c ?? "").toMatch(/tamanho/i);
    });
  });

  it("re-aplicar o arquivo 2x na mesma txn nao falha e nao muda os md5; o _down e no-op (helpers e coluna ficam)", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgA(c, "170000");
      const antes = await Promise.all(HELPERS.map((s) => md5Fn(c, s)));
      for (const s of HELPERS) expect(antes[HELPERS.indexOf(s)], s).toBe(b!.NOVAS[s]);
      await aplicarArquivo(c, b!.mig);
      await aplicarArquivo(c, b!.mig);
      await c.query("SET LOCAL transaction_timeout = 0");
      const depois = await Promise.all(HELPERS.map((s) => md5Fn(c, s)));
      expect(depois).toEqual(antes);
      await aplicarArquivo(c, b!.down);
      await c.query("SET LOCAL transaction_timeout = 0");
      expect(await Promise.all(HELPERS.map((s) => md5Fn(c, s)))).toEqual(antes);
      const col = await um<{ n: string }>(
        c,
        "SELECT count(*)::text AS n FROM information_schema.columns WHERE table_name = 'etiquetas' AND column_name = 'tamanho_vinculado'",
      );
      expect(col.n).toBe("1");
    });
  });

  it("travas da ida (por DIFERENCA): so etiquetas (AccessExclusive do ADD COLUMN) e nada em auth/storage/realtime", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      // SEM aplicaUrgA antes: o ADD COLUMN IF NOT EXISTS pega a AccessExclusive mesmo com a coluna ja viva (copia aplicada)
      const LOCKS = `SELECT DISTINCT n.nspname || '.' || cl.relname AS rel, l.mode
                       FROM pg_locks l JOIN pg_class cl ON cl.oid = l.relation JOIN pg_namespace n ON n.oid = cl.relnamespace
                      WHERE l.pid = pg_backend_pid() AND l.locktype = 'relation' AND n.nspname NOT IN ('pg_catalog', 'pg_toast')`;
      const antes = new Set((await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`));
      await aplicarArquivo(c, b!.mig);
      await c.query("SET LOCAL transaction_timeout = 0");
      const novas = (await c.query(LOCKS)).rows.map((r) => `${r.rel}|${r.mode}`).filter((k) => !antes.has(k));
      expect(novas.some((k) => k === "public.etiquetas|AccessExclusiveLock")).toBe(true);
      expect(novas.filter((k) => /^(auth|storage|realtime)\./.test(k))).toEqual([]);
      // fora de etiquetas, so AccessShare (validacao do corpo SQL dos leitores: variantes_etiqueta, modelo_grades, cad_grades)
      expect(
        novas.filter((k) => !k.startsWith("public.etiquetas|") && !k.startsWith("information_schema.") && !k.endsWith("|AccessShareLock")),
      ).toEqual([]);
    });
  });

  it("_down_drop: recusa enquanto alguma funcao de public cita um helper; sem citacao, apaga os 6 e a coluna", async () => {
    const b = bloco();
    expect(b).toBeTruthy();
    await withTx(async (c) => {
      await zeraVinculosTamanhoNaTxn(c); // vinculo pre-existente na copia (QA) vira 'sem vinculo' so nesta txn
      await aplicaUrgA(c, "170000");
      await voltaUrgASePreciso(c); // LIFO: blocos por cima (urgb, 170500…) neutralizados antes
      // LIFO (urg R3 T14): o extrato da 177000 (so leitura, _down no-op) CITA _insumo_pecas/_insumo_tamanho_de/_grade_mapa_cad - o
      // _down_drop dele vem antes do desta 170000 (sem ele a recusa abaixo dispararia pelo extrato, nao pela funcao de teste)
      await dropUrgAExtratoSePreciso(c);
      await c.query(
        "CREATE FUNCTION public._urg_a1_teste_cita() RETURNS numeric LANGUAGE sql AS $$ SELECT public._insumo_pecas(NULL, NULL, 1) $$",
      );
      await expect(aplicarArquivo(c, b!.drop)).rejects.toThrow(/urg_r1_170000_down_drop/);
      await c.query("DROP FUNCTION public._urg_a1_teste_cita()");
      await aplicarArquivo(c, b!.drop);
      await c.query("SET LOCAL transaction_timeout = 0");
      for (const s of HELPERS) expect(await md5Fn(c, s), s).toBeNull();
      const col = await um<{ n: string }>(
        c,
        "SELECT count(*)::text AS n FROM information_schema.columns WHERE table_name = 'etiquetas' AND column_name = 'tamanho_vinculado'",
      );
      expect(col.n).toBe("0");
    });
  });
});
