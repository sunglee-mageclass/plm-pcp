/**
 * LEVES L5 (C1 L4) — fila do custo previsto: APAGAR o CAD e TROCAR o artigo da variante de tecido
 * (migration 20261027300000_custo_fila_cad_delete_variante.sql; plano .superpowers/sdd/2026-10-02-leves/plan.md §1 "C1 L4",
 * §2 L5). SÓ na cópia local (ehBancoLocal) com a release 8 (20261019300000) aplicada; txn revertida (withTx): NADA é gravado.
 * `imediato()` = SET CONSTRAINTS ALL IMMEDIATE + DEFERRED — simula o COMMIT para o gatilho adiado trg_custo_processar_fila
 * (mesmo padrão de custo-previsto-servidor.test.ts).
 *   (a) apagar o CAD de card enviado ao corte descongela: entra na fila e o custo alcança o cadastro de hoje no COMMIT
 *   (b) apagar CAD não cortado / UPDATE de cad sem reverter o corte: nada entra na fila
 *   (c) trocar variantes_tecido.artigo_id: entram os modelos que a usam (substituto e vínculo de OC); o cortado fica
 *   (d) UPDATE da variante sem trocar o artigo: nada entra na fila
 *   (e) loja: CAD/variante nunca enfileira modelo de outra loja
 *   (f) catálogo/ACL (#9) dos 2 gatilhos e das 2 funções novas
 * Os testes NÃO são pulados quando a L5 falta (só quando a release 8 falta): contra o banco sem a L5 eles FALHAM (provado no
 * relatório l5-report.md). Sem a release 8 na cópia local, um teste-sentinela falha em vez de tudo "passar" pulado.
 */
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, dbUrl, ehBancoLocal, TENANT_TESTE } from "./db";

const T = TENANT_TESTE;
const OUTRA_LOJA = "20c84a36-b7a0-4c26-ac59-52cb11e9d979"; // Ave Rara (existe na cópia)
const LOCAL = hasDb && ehBancoLocal();

async function release8Aplicada(): Promise<boolean> {
  if (!LOCAL) return false;
  const c = new Client({ connectionString: dbUrl()!, ssl: false });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT to_regprocedure('public._custo_enfileirar(uuid[],boolean)') IS NOT NULL
          AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_custo_processar_fila' AND tgenabled = 'O') AS ok`,
    );
    return r.rows[0].ok === true;
  } finally {
    await c.end();
  }
}
const PRONTO = LOCAL && (await release8Aplicada());

const FUNCOES = ["public.fn_custo_fila_cad_del()", "public.fn_custo_fila_variante_tecido()"];
const GATILHOS: { tabela: string; def: string }[] = [
  {
    tabela: "cad",
    def: "CREATE TRIGGER trg_custo_fila_del AFTER DELETE ON public.cad REFERENCING OLD TABLE AS antigas FOR EACH STATEMENT EXECUTE FUNCTION fn_custo_fila_cad_del()",
  },
  {
    tabela: "variantes_tecido",
    def: "CREATE TRIGGER trg_custo_fila_upd AFTER UPDATE OF artigo_id ON public.variantes_tecido FOR EACH ROW WHEN ((old.artigo_id IS DISTINCT FROM new.artigo_id)) EXECUTE FUNCTION fn_custo_fila_variante_tecido()",
  },
];

// ─────────────────────────────── helpers ───────────────────────────────
let seq = 0;
const suf = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const n = (v: unknown) => (v == null ? null : Number(v));

async function prepara(c: Client): Promise<void> {
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  await comoUsuario(c);
}
/** O COMMIT para o gatilho adiado do custo (e volta a adiar). */
async function imediato(c: Client): Promise<void> {
  await c.query("SET CONSTRAINTS ALL IMMEDIATE");
  await c.query("SET CONSTRAINTS ALL DEFERRED");
}
/** Dos ids pedidos, os que estão na fila (só os NOSSOS — nunca depende do que a cópia tem na fila). */
async function naFila(c: Client, ids: string[]): Promise<string[]> {
  const { rows } = await c.query(
    `SELECT modelo_id::text AS id FROM public.custo_recalculo_fila WHERE modelo_id = ANY ($1::uuid[]) ORDER BY 1`,
    [ids],
  );
  return rows.map((r) => r.id as string);
}
const ord = (xs: string[]) => [...xs].sort();
async function peca(c: Client, id: string): Promise<number | null> {
  return n(
    (
      await um<{ v: string | null }>(
        c,
        `SELECT custo_peca_previsto AS v FROM public.modelos WHERE id = $1`,
        [id],
      )
    ).v,
  );
}
async function custoLinha(
  c: Client,
  tabela: "modelo_tecidos" | "modelo_aviamentos",
  id: string,
): Promise<number | null> {
  return n(
    (
      await um<{ v: string | null }>(
        c,
        `SELECT custo_previsto AS v FROM public.${tabela} WHERE id = $1`,
        [id],
      )
    ).v,
  );
}
async function modelo(c: Client, tenant = T): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1, $2, 'interno') RETURNING id`,
      [tenant, `L5 CUSTO ${suf()}`],
    )
  ).id;
}
async function artigo(
  c: Client,
  preco: number,
  unidade: "metro" | "kg" = "metro",
  rendimento: number | null = null,
  tenant = T,
): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.artigos (tenant_id, nome, unidade_medida, preco, rendimento) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenant, `L5 art ${suf()}`, unidade, preco, rendimento],
    )
  ).id;
}
async function variante(c: Client, art: string, tenant = T): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.variantes_tecido (tenant_id, artigo_id, nome_variante) VALUES ($1, $2, $3) RETURNING id`,
      [tenant, art, `L5 var ${suf()}`],
    )
  ).id;
}
async function linhaTecido(c: Client, m: string, art: string, consumo = 1): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) VALUES ($1, $2, 1, 'tecido', $3, 0) RETURNING id`,
      [m, art, consumo],
    )
  ).id;
}
async function substituto(c: Client, linha: string, vt: string): Promise<void> {
  await c.query(
    `INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, 1)`,
    [linha, vt],
  );
}
async function ocItem(c: Client, art: string, vt: string, preco: number): Promise<string> {
  const oc = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.ocs_tecido (tenant_id, numero_pedido) VALUES ($1, $2) RETURNING id`,
      [T, `L5-OC-${suf()}`],
    )
  ).id;
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.ocs_tecido_itens (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida, preco, cancelado)
       VALUES ($1, $2, 1, $3, 100, $4, false) RETURNING id`,
      [oc, art, vt, preco],
    )
  ).id;
}
async function vincular(c: Client, m: string, vt: string, item: string): Promise<void> {
  await c.query(
    `INSERT INTO public.modelo_tecido_oc_links (tenant_id, modelo_id, tipo, numero, ordem, variante_tecido_id, oc_tecido_item_id, quantidade_m, prioridade)
     VALUES ($1, $2, 'tecido', 1, 1, $3, $4, 10, 1)`,
    [T, m, vt, item],
  );
}
async function aviamento(c: Client, preco: number): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.aviamentos (tenant_id, codigo_nome, preco) VALUES ($1, $2, $3) RETURNING id`,
      [T, `L5 avi ${suf()}`, preco],
    )
  ).id;
}
/** Card interno com UMA linha de aviamento (preço × consumo). */
async function cardAviamento(
  c: Client,
  avi: string,
  consumo: number,
): Promise<{ m: string; linha: string }> {
  const m = await modelo(c);
  const linha = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelo_aviamentos (modelo_id, aviamento_id, numero, consumo, loss_percent) VALUES ($1, $2, 1, $3, 0) RETURNING id`,
      [m, avi, consumo],
    )
  ).id;
  return { m, linha };
}
async function cad(c: Client, m: string, enviadoCorte: boolean, tenant = T): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.cad (tenant_id, modelo_id, enviado_corte) VALUES ($1, $2, $3) RETURNING id`,
      [tenant, m, enviadoCorte],
    )
  ).id;
}

// ─────────────────────────────── sentinela ───────────────────────────────
describe.runIf(LOCAL && !PRONTO)("L5 — pré-requisito", () => {
  it("a release 8 (fila do custo, 20261019300000) tem de estar aplicada na cópia local", () => {
    expect.fail(
      "custo_recalculo_fila/_custo_enfileirar ausentes: aplique a 20261019300000 antes da L5",
    );
  });
});

// ─────────────────────────────── (a) apagar o CAD de card cortado ───────────────────────────────
describe.skipIf(!PRONTO)(
  "L5 (a) — apagar o CAD de card enviado ao corte DESCONGELA (P-169 A)",
  () => {
    it("o card entra na fila e, no COMMIT, o custo previsto alcança o preço de hoje; o outro cortado continua congelado", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const avi = await aviamento(c, 10);
        const a = await cardAviamento(c, avi, 2);
        const b = await cardAviamento(c, avi, 2);
        const cadA = await cad(c, a.m, true);
        await cad(c, b.m, true);
        await imediato(c);
        expect([await peca(c, a.m), await peca(c, b.m)]).toEqual([20, 20]);

        // preço de cadastro com os 2 cortados: congelados, ninguém entra na fila (release 8)
        await c.query(`UPDATE public.aviamentos SET preco = 15 WHERE id = $1`, [avi]);
        expect(await naFila(c, [a.m, b.m])).toEqual([]);
        await imediato(c);
        expect([await peca(c, a.m), await peca(c, b.m)]).toEqual([20, 20]);

        // apagar o CAD de A descongela A: entra na fila (com a loja do modelo) e recalcula no COMMIT
        await c.query(`DELETE FROM public.cad WHERE id = $1`, [cadA]);
        expect(await naFila(c, [a.m, b.m])).toEqual([a.m]);
        const linhaFila = await um<{ t: string; tent: number }>(
          c,
          `SELECT tenant_id::text AS t, tentativas AS tent FROM public.custo_recalculo_fila WHERE modelo_id = $1`,
          [a.m],
        );
        expect(linhaFila).toEqual({ t: T, tent: 0 });
        await imediato(c);
        expect(await naFila(c, [a.m, b.m])).toEqual([]);
        expect(await peca(c, a.m)).toBe(30);
        expect(await custoLinha(c, "modelo_aviamentos", a.linha)).toBe(30);
        // B continua congelado (CAD dele não foi apagado)
        expect(await peca(c, b.m)).toBe(20);
        expect(await custoLinha(c, "modelo_aviamentos", b.linha)).toBe(20);
      });
    });

    it("DELETE de vários CADs num comando só: todos os cortados entram, cada um uma vez", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const avi = await aviamento(c, 4);
        const x = await cardAviamento(c, avi, 1);
        const y = await cardAviamento(c, avi, 1);
        const cx = await cad(c, x.m, true);
        const cy = await cad(c, y.m, true);
        await imediato(c);
        await c.query(`UPDATE public.aviamentos SET preco = 6 WHERE id = $1`, [avi]);
        await imediato(c);
        expect([await peca(c, x.m), await peca(c, y.m)]).toEqual([4, 4]);
        await c.query(`DELETE FROM public.cad WHERE id = ANY ($1::uuid[])`, [[cx, cy]]);
        expect(await naFila(c, [x.m, y.m])).toEqual(ord([x.m, y.m]));
        await imediato(c);
        expect([await peca(c, x.m), await peca(c, y.m)]).toEqual([6, 6]);
      });
    });
  },
);

// ─────────────────────────────── (b) CAD sem efeito no congelado ───────────────────────────────
describe.skipIf(!PRONTO)("L5 (b) — CAD que não congelava nada não enfileira", () => {
  it("apagar CAD NÃO enviado ao corte não enfileira; UPDATE de cad que não reverte o corte também não", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const avi = await aviamento(c, 3);
      const livre = await cardAviamento(c, avi, 1);
      const cortado = await cardAviamento(c, avi, 1);
      const cadLivre = await cad(c, livre.m, false);
      const cadCortado = await cad(c, cortado.m, true);
      await imediato(c);
      expect(await naFila(c, [livre.m, cortado.m])).toEqual([]);

      await c.query(`DELETE FROM public.cad WHERE id = $1`, [cadLivre]);
      expect(await naFila(c, [livre.m, cortado.m])).toEqual([]);
      // UPDATE que mantém o corte (e o que liga o corte) não descongela nada
      await c.query(
        `UPDATE public.cad SET sem_acabamento = NOT coalesce(sem_acabamento, false) WHERE id = $1`,
        [cadCortado],
      );
      expect(await naFila(c, [livre.m, cortado.m])).toEqual([]);
    });
  });
});

// ─────────────────────────────── (c) trocar o artigo da variante ───────────────────────────────
describe.skipIf(!PRONTO)(
  "L5 (c) — trocar o ARTIGO da variante de tecido recalcula quem a usa",
  () => {
    it("substituto e vínculo de OC entram na fila e recalculam com o artigo novo; o cortado e quem não usa a variante ficam", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const artA = await artigo(c, 10);
        const artB = await artigo(c, 30, "kg", 2); // kg: preço por metro = 30 ÷ 2 = 15; o da OC vinculada = 8 ÷ 2 = 4
        const artLinha = await artigo(c, 1);
        const vt = await variante(c, artA);

        // substituto: preço da linha = MAX dos artigos das variantes = 10
        const mSub = await modelo(c);
        const lSub = await linhaTecido(c, mSub, artLinha);
        await substituto(c, lSub, vt);
        // vínculo de OC: preço congelado = 8 (artigo A em metro); com B (kg, rendimento 2) = 4
        const mOc = await modelo(c);
        const lOc = await linhaTecido(c, mOc, artLinha);
        await vincular(c, mOc, vt, await ocItem(c, artA, vt, 8));
        // cortado com o mesmo substituto: congelado (mudança de cadastro, P-169 A)
        const mCut = await modelo(c);
        const lCut = await linhaTecido(c, mCut, artLinha);
        await substituto(c, lCut, vt);
        await cad(c, mCut, true);
        // não usa a variante
        const mFora = await modelo(c);
        await linhaTecido(c, mFora, artLinha);
        await imediato(c);
        expect([
          await peca(c, mSub),
          await peca(c, mOc),
          await peca(c, mCut),
          await peca(c, mFora),
        ]).toEqual([10, 8, 10, 1]);

        await c.query(`UPDATE public.variantes_tecido SET artigo_id = $2 WHERE id = $1`, [
          vt,
          artB,
        ]);
        expect(await naFila(c, [mSub, mOc, mCut, mFora])).toEqual(ord([mSub, mOc]));
        await imediato(c);
        expect(await naFila(c, [mSub, mOc, mCut, mFora])).toEqual([]);
        expect([
          await peca(c, mSub),
          await peca(c, mOc),
          await peca(c, mCut),
          await peca(c, mFora),
        ]).toEqual([15, 4, 10, 1]);
        expect([
          await custoLinha(c, "modelo_tecidos", lSub),
          await custoLinha(c, "modelo_tecidos", lOc),
          await custoLinha(c, "modelo_tecidos", lCut),
        ]).toEqual([15, 4, 10]);
      });
    });

    it("UPDATE de várias variantes num comando: cada modelo entra uma vez", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const artA = await artigo(c, 2);
        const artB = await artigo(c, 7);
        const artLinha = await artigo(c, 1);
        const v1 = await variante(c, artA);
        const v2 = await variante(c, artA);
        const m = await modelo(c);
        const l = await linhaTecido(c, m, artLinha);
        await substituto(c, l, v1);
        await c.query(
          `INSERT INTO public.modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem) VALUES ($1, $2, 2)`,
          [l, v2],
        );
        await imediato(c);
        expect(await peca(c, m)).toBe(2);
        await c.query(
          `UPDATE public.variantes_tecido SET artigo_id = $2 WHERE id = ANY ($1::uuid[])`,
          [[v1, v2], artB],
        );
        const { rows } = await c.query(
          `SELECT count(*)::int AS n FROM public.custo_recalculo_fila WHERE modelo_id = $1`,
          [m],
        );
        expect(rows[0].n).toBe(1);
        await imediato(c);
        expect(await peca(c, m)).toBe(7);
      });
    });
  },
);

// ─────────────────────────────── (d) UPDATE da variante sem trocar o artigo ───────────────────────────────
describe.skipIf(!PRONTO)("L5 (d) — UPDATE da variante que não troca o artigo não enfileira", () => {
  it("nome/código/endereço e artigo_id igual ao de antes: nada entra na fila", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const artA = await artigo(c, 10);
      const vt = await variante(c, artA);
      const m = await modelo(c);
      await substituto(c, await linhaTecido(c, m, await artigo(c, 1)), vt);
      await imediato(c);
      expect(await naFila(c, [m])).toEqual([]);
      await c.query(
        `UPDATE public.variantes_tecido SET nome_variante = $2, codigo_variante = 'L5', rua = 'R1' WHERE id = $1`,
        [vt, `L5 renomeada ${suf()}`],
      );
      expect(await naFila(c, [m])).toEqual([]);
      await c.query(`UPDATE public.variantes_tecido SET artigo_id = artigo_id WHERE id = $1`, [vt]);
      expect(await naFila(c, [m])).toEqual([]);
    });
  });
});

// ─────────────────────────────── (e) loja ───────────────────────────────
describe.skipIf(!PRONTO)("L5 (e) — loja: nunca enfileira modelo de outra loja", () => {
  it("variante da loja trocando de artigo não põe na fila o modelo de OUTRA loja que a referencia", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const artA = await artigo(c, 10);
      const artB = await artigo(c, 20);
      const vt = await variante(c, artA);
      const meu = await modelo(c);
      await substituto(c, await linhaTecido(c, meu, await artigo(c, 1)), vt);
      const alheio = await modelo(c, OUTRA_LOJA);
      await substituto(
        c,
        await linhaTecido(c, alheio, await artigo(c, 1, "metro", null, OUTRA_LOJA)),
        vt,
      );
      await imediato(c);
      await c.query(`UPDATE public.variantes_tecido SET artigo_id = $2 WHERE id = $1`, [vt, artB]);
      expect(await naFila(c, [meu, alheio])).toEqual([meu]);
    });
  });

  it("CAD cortado com loja diferente da do modelo: apagar não enfileira o modelo; o da mesma loja sim", async () => {
    await withTx(async (c) => {
      await prepara(c);
      const avi = await aviamento(c, 5);
      const meu = await cardAviamento(c, avi, 1);
      const outro = await cardAviamento(c, avi, 1);
      const cadAlheio = await cad(c, outro.m, true, OUTRA_LOJA);
      const cadMeu = await cad(c, meu.m, true);
      await imediato(c);
      await c.query(`DELETE FROM public.cad WHERE id = ANY ($1::uuid[])`, [[cadAlheio, cadMeu]]);
      expect(await naFila(c, [meu.m, outro.m])).toEqual([meu.m]);
    });
  });
});

// ─────────────────────────────── (f) catálogo / ACL ───────────────────────────────
describe.skipIf(!PRONTO)("L5 (f) — catálogo e ACL (#9)", () => {
  it("as 2 funções novas: SECURITY DEFINER, search_path fixo, sem EXECUTE para PUBLIC/anon/authenticated", async () => {
    await withTx(async (c) => {
      for (const f of FUNCOES) {
        const d = await um<{
          existe: boolean;
          definer: boolean | null;
          cfg: string | null;
          publico: boolean | null;
        }>(
          c,
          `SELECT to_regprocedure($1) IS NOT NULL AS existe,
                  (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure($1)) AS definer,
                  (SELECT array_to_string(proconfig, ',') FROM pg_proc WHERE oid = to_regprocedure($1)) AS cfg,
                  (SELECT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                   WHERE x.grantee = 0 AND x.privilege_type = 'EXECUTE')
                     FROM pg_proc p WHERE p.oid = to_regprocedure($1)) AS publico`,
          [f],
        );
        expect({ f, ...d }).toEqual({
          f,
          existe: true,
          definer: true,
          cfg: "search_path=public",
          publico: false,
        });
        for (const papel of ["anon", "authenticated"]) {
          const r = await um<{ p: boolean }>(
            c,
            `SELECT has_function_privilege($1, $2, 'EXECUTE') AS p`,
            [papel, f],
          );
          expect({ f, papel, pode: r.p }).toEqual({ f, papel, pode: false });
        }
      }
    });
  });

  it("os 2 gatilhos: definição exata e ligados", async () => {
    await withTx(async (c) => {
      for (const g of GATILHOS) {
        const { rows } = await c.query(
          `SELECT pg_get_triggerdef(t.oid) AS def, t.tgenabled AS en FROM pg_trigger t
            WHERE t.tgrelid = to_regclass('public.' || $1) AND pg_get_triggerdef(t.oid) LIKE '%fn_custo_fila_%' AND NOT t.tgisinternal
              AND t.tgfoid IN (SELECT to_regprocedure(f) FROM unnest($2::text[]) f)`,
          [g.tabela, FUNCOES],
        );
        expect(rows).toEqual([{ def: g.def, en: "O" }]);
      }
    });
  });
});
