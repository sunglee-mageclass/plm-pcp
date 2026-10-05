// Modularidade T5 — o `rev` do card sobe UMA vez por transação (Parte 14 / médios D-2).
// Plano: .superpowers/sdd/2026-10-04-modularidade/plan.md §12 T5 (+ Ruling R1). Migration GERADA 20261103200000_mod_rev_uma_vez
// (gerar-mod5.mjs): fn_colab_bump_modelo e fn_colab_bump_modelo_via_tecido só tocam a linha de `modelos` que AINDA não foi escrita
// por esta transação — `xmin` do card = xid de topo, OU (fix round 1, M1) = `xmin` da própria linha da filha (mesma
// SUBtransação: processador adiado do custo). Efeito: +1 por TRANSAÇÃO (o Salvar do Sheet é uma cadeia de transações — ver o
// relatório). Cada caso em transação revertida (withTx) e SÓ na cópia local: a migration (ou o inverso) é aplicada DENTRO da txn
// (mig-txn, nunca \i). O Salvar do BOM roda SEM savepoint em volta (num SAVEPOINT os DELETEs seguem 1 bump por linha — caso 5).
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, dbUrl, TENANT_TESTE, USER_TESTE } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { aplicaMod, modViva } from "./mod-helpers";
import { MOD_MD5, MOD5_ACL, MOD5_DEPS, MOD5_GATILHOS, MOD_MIG, MOD_DOWN } from "./mod-5-dados";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const BUMP = "public.fn_colab_bump_modelo()";
const VIA = "public.fn_colab_bump_modelo_via_tecido()";

async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : "",
  ]);
}
async function zeraTimeouts(c: Client): Promise<void> {
  await c.query("SET LOCAL transaction_timeout = 0");
  await c.query("SET LOCAL lock_timeout = '3s'");
}
async function aplica(c: Client, rel: string): Promise<void> {
  await aplicarArquivo(c, rel);
  await zeraTimeouts(c);
}
const md5Fn = async (c: Client, f: string) =>
  (
    await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [
      f,
    ])
  ).m;
/** Estado SEM a T5 nesta txn (cópia com ou sem a T5 aplicada). */
async function semT5(c: Client): Promise<void> {
  if (await modViva(c, 5)) await aplica(c, MOD_DOWN);
  expect(await md5Fn(c, BUMP)).toBe(MOD_MD5[BUMP].antes);
}
/** Estado COM a T5 nesta txn (aplica os blocos da frente que faltarem, na ordem). */
async function comT5(c: Client): Promise<void> {
  await aplicaMod(c, 5);
  expect(await md5Fn(c, BUMP)).toBe(MOD_MD5[BUMP].depois);
  expect(await md5Fn(c, VIA)).toBe(MOD_MD5[VIA].depois);
}

/** O maior BOM da Loja Teste (tecidos+variantes+aviamentos+grades+vínculos de OC), card interno. */
async function cardGrande(c: Client): Promise<{ id: string; linhas: number }> {
  return um(
    c,
    `SELECT m.id, (SELECT count(*) FROM modelo_tecidos t WHERE t.modelo_id = m.id)
        + (SELECT count(*) FROM modelo_tecido_variantes v JOIN modelo_tecidos t ON t.id = v.modelo_tecido_id WHERE t.modelo_id = m.id)
        + (SELECT count(*) FROM modelo_aviamentos a WHERE a.modelo_id = m.id)
        + (SELECT count(*) FROM modelo_grades g WHERE g.modelo_id = m.id)
        + (SELECT count(*) FROM modelo_tecido_oc_links l WHERE l.modelo_id = m.id) AS linhas
       FROM modelos m WHERE m.tenant_id = $1 AND m.origem = 'interno'
      ORDER BY linhas DESC, m.id LIMIT 1`,
    [T],
  ).then((r: { id: string; linhas: string }) => ({ id: r.id, linhas: Number(r.linhas) }));
}

/** O BOM gravado do card `de`, no formato do salvar_modelo_bom (tecidos com variantes/multiplicadores/complementas/oc_links). */
async function payloadBom(
  c: Client,
  de: string,
): Promise<{ tec: string; avi: string; gra: string }> {
  return um(
    c,
    `SELECT
      coalesce((SELECT jsonb_agg(jsonb_build_object('artigo_id', t.artigo_id, 'numero', t.numero, 'tipo', t.tipo,
          'consumo', t.consumo, 'loss_percent', t.loss_percent, 'custo_previsto', t.custo_previsto,
          'variantes', (SELECT jsonb_agg(v.variante_tecido_id ORDER BY v.ordem) FROM modelo_tecido_variantes v WHERE v.modelo_tecido_id = t.id),
          'multiplicadores', (SELECT jsonb_agg(v.multiplicador ORDER BY v.ordem) FROM modelo_tecido_variantes v WHERE v.modelo_tecido_id = t.id),
          'complementas', (SELECT jsonb_agg(to_jsonb(v.complementa_variante_ids) ORDER BY v.ordem) FROM modelo_tecido_variantes v WHERE v.modelo_tecido_id = t.id),
          'oc_links', (SELECT jsonb_agg(jsonb_build_object('ordem', l.ordem, 'variante_tecido_id', l.variante_tecido_id,
              'oc_tecido_item_id', l.oc_tecido_item_id, 'quantidade_m', l.quantidade_m, 'prioridade', l.prioridade))
             FROM modelo_tecido_oc_links l WHERE l.modelo_id = t.modelo_id AND l.tipo = t.tipo AND l.numero = t.numero)
        ) ORDER BY t.numero, t.tipo) FROM modelo_tecidos t WHERE t.modelo_id = $1), '[]')::text AS tec,
      coalesce((SELECT jsonb_agg(jsonb_build_object('aviamento_id', a.aviamento_id, 'numero', a.numero, 'consumo', a.consumo,
          'loss_percent', a.loss_percent, 'custo_previsto', a.custo_previsto, 'variante_aviamento_id', a.variante_aviamento_id)
        ORDER BY a.numero) FROM modelo_aviamentos a WHERE a.modelo_id = $1), '[]')::text AS avi,
      coalesce((SELECT jsonb_agg(jsonb_build_object('variante_numero', g.variante_numero, 'grades', g.grades,
          'grade_total', g.grade_total) ORDER BY g.variante_numero) FROM modelo_grades g WHERE g.modelo_id = $1), '[]')::text AS gra`,
    [de],
  );
}

type Medida = { rev: number; audit: number; khist: number; kfila: boolean; cfila: boolean };
async function mede(c: Client, mod: string): Promise<Medida> {
  const r = await um<{ rev: number; audit: string; khist: string; kfila: boolean; cfila: boolean }>(
    c,
    `SELECT (SELECT rev FROM modelos WHERE id = $1) AS rev,
            (SELECT count(*) FROM audit_log) AS audit,
            (SELECT count(*) FROM modelo_kanban_historico WHERE modelo_id = $1) AS khist,
            EXISTS (SELECT 1 FROM kanban_recalculo_fila WHERE modelo_id = $1) AS kfila,
            EXISTS (SELECT 1 FROM custo_recalculo_fila WHERE modelo_id = $1) AS cfila`,
    [mod],
  );
  return {
    rev: r.rev,
    audit: Number(r.audit),
    khist: Number(r.khist),
    kfila: r.kfila,
    cfila: r.cfila,
  };
}

/**
 * Salvar do BOM como o cliente (PostgREST: papel authenticated + JWT do usuário da Loja Teste), SEM savepoint em volta (a escrita
 * fica no xid da transação, como no PostgREST real). `p` = BOM de outro card (ou do próprio).
 */
async function salvar(
  c: Client,
  mod: string,
  p: { tec: string; avi: string; gra: string },
  revBase: number | null,
): Promise<void> {
  await jwt(c, USER_TESTE);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, USER_TESTE]);
  await c.query("SET LOCAL ROLE authenticated");
  await c.query("SELECT public.salvar_modelo_bom($1, $2::jsonb, $3::jsonb, $4::jsonb, $5)", [
    mod,
    p.tec,
    p.avi,
    p.gra,
    revBase,
  ]);
  await c.query("RESET ROLE");
}
/** Igual, mas dentro de um SAVEPOINT (erro volta ao savepoint e é devolvido). */
async function salvarSp(
  c: Client,
  mod: string,
  p: { tec: string; avi: string; gra: string },
  revBase: number | null,
): Promise<{ ok: true } | { ok: false; code: string; msg: string }> {
  await c.query("SAVEPOINT mod5");
  try {
    await salvar(c, mod, p, revBase);
    await c.query("RELEASE SAVEPOINT mod5");
    return { ok: true };
  } catch (e) {
    const er = e as { code?: string; message?: string };
    await c.query("ROLLBACK TO SAVEPOINT mod5");
    await c.query("RELEASE SAVEPOINT mod5");
    return { ok: false, code: String(er.code ?? ""), msg: String(er.message ?? "") };
  }
}
/** Processa no meio da txn o que o COMMIT processaria (gatilhos adiados do kanban e do custo). */
const commitSimulado = (c: Client) => c.query("SET CONSTRAINTS ALL IMMEDIATE");

describe.skipIf(!RODA)("mod T5 — rev sobe uma vez por transação (Parte 14)", () => {
  it("medição: Salvar do maior BOM da Loja Teste — antes da T5 sobe 1 por linha (N registrado); com a T5, +1 exato (no COMMIT no máx. +2); auditoria/histórico/filas iguais", async () => {
    let card = "",
      linhas = 0;
    const antes: { salvar?: Medida; commit?: Medida; base?: Medida } = {};
    const depois: { salvar?: Medida; commit?: Medida; base?: Medida } = {};
    await withTx(async (c) => {
      await semT5(c);
      ({ id: card, linhas } = await cardGrande(c));
      expect(linhas).toBeGreaterThanOrEqual(20);
      const p = await payloadBom(c, card);
      antes.base = await mede(c, card);
      await salvar(c, card, p, antes.base.rev);
      antes.salvar = await mede(c, card);
      await commitSimulado(c);
      antes.commit = await mede(c, card);
    });
    await withTx(async (c) => {
      await comT5(c);
      const p = await payloadBom(c, card);
      depois.base = await mede(c, card);
      await salvar(c, card, p, depois.base.rev); // _rev_base = rev atual: o FOR UPDATE da trava NÃO muda o xmin → o bump acontece
      depois.salvar = await mede(c, card);
      await commitSimulado(c);
      depois.commit = await mede(c, card);
    });
    const nAntes = antes.salvar!.rev - antes.base!.rev;
    const nDepois = depois.salvar!.rev - depois.base!.rev;
    // Registro para o relatório (t5-report.md).
    console.log(
      `[mod T5] card ${card} (${linhas} linhas de BOM): antes da T5 +${nAntes} no Salvar, +${antes.commit!.rev - antes.base!.rev} após o COMMIT; com a T5 +${nDepois} e +${depois.commit!.rev - depois.base!.rev}`,
    );
    expect(depois.base!.rev).toBe(antes.base!.rev); // as 2 txns partem do mesmo estado gravado
    expect(nAntes).toBeGreaterThanOrEqual(linhas); // 1 bump por linha apagada + 1 por linha inserida
    expect(nDepois).toBe(1);
    expect(depois.commit!.rev - depois.base!.rev).toBeGreaterThanOrEqual(1);
    expect(depois.commit!.rev - depois.base!.rev).toBeLessThanOrEqual(2);
    expect(depois.commit!.rev - depois.salvar!.rev).toBe(antes.commit!.rev - antes.salvar!.rev); // o COMMIT soma o mesmo nos 2
    // auditoria e histórico: só podem cair, nunca subir; as filas continuam recebendo o card (nada some)
    expect(depois.salvar!.audit - depois.base!.audit).toBeLessThanOrEqual(
      antes.salvar!.audit - antes.base!.audit,
    );
    expect(depois.commit!.audit - depois.base!.audit).toBeLessThanOrEqual(
      antes.commit!.audit - antes.base!.audit,
    );
    expect(depois.commit!.khist - depois.base!.khist).toBeLessThanOrEqual(
      antes.commit!.khist - antes.base!.khist,
    );
    expect(depois.salvar!.kfila).toBe(antes.salvar!.kfila);
    expect(depois.salvar!.cfila).toBe(antes.salvar!.cfila);
    expect(depois.salvar!.cfila).toBe(true); // card interno: a ficha mudou → custo na fila
    expect(depois.commit!.kfila).toBe(false); // processado no COMMIT
    expect(depois.commit!.cfila).toBe(false);
  });

  it("card NOVO + BOM na mesma transação: sem bump extra (rev do INSERT) e sem erro; sem a T5 subiria 1 por linha", async () => {
    const roda = async (comA5: boolean) => {
      let r = { insert: 0, salvar: 0 };
      await withTx(async (c) => {
        if (comA5) await comT5(c);
        else await semT5(c);
        const { id: grande } = await cardGrande(c);
        const p = await payloadBom(c, grande);
        const novo = await semJwt(c, () =>
          um<{ id: string; rev: number }>(
            c,
            `INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1, 'MOD5 NOVO', 'interno') RETURNING id, rev`,
            [T],
          ),
        );
        await salvar(c, novo.id, p, novo.rev);
        const depois = await um<{ rev: number; n: string }>(
          c,
          `SELECT m.rev, (SELECT count(*) FROM modelo_tecidos t WHERE t.modelo_id = m.id) AS n FROM modelos m WHERE m.id = $1`,
          [novo.id],
        );
        expect(Number(depois.n)).toBeGreaterThan(0);
        r = { insert: novo.rev, salvar: depois.rev };
      });
      return r;
    };
    const com = await roda(true);
    expect(com.salvar).toBe(com.insert);
    const sem = await roda(false);
    expect(sem.salvar - sem.insert).toBeGreaterThan(10);
  });

  it("2 Salvar: na MESMA transação +1 no total (a 2ª com a base nova passa); em transações separadas +1 cada (cada uma parte do gravado)", async () => {
    let base0 = 0,
      card = "";
    await withTx(async (c) => {
      await comT5(c);
      ({ id: card } = await cardGrande(c));
      const p = await payloadBom(c, card);
      base0 = (await mede(c, card)).rev;
      await salvar(c, card, p, base0);
      expect((await mede(c, card)).rev).toBe(base0 + 1);
      await salvar(c, card, p, base0 + 1); // base = o rev que a tela recebeu do 1º Salvar
      expect((await mede(c, card)).rev).toBe(base0 + 1);
      // uma filha solta (Observações) na mesma txn: nada a mais
      await semJwt(c, () =>
        c.query(
          `INSERT INTO public.modelo_observacoes (tenant_id, modelo_id, descricao, observacao) VALUES ($1, $2, 'MOD5', 'MOD5')`,
          [T, card],
        ),
      );
      expect((await mede(c, card)).rev).toBe(base0 + 1);
    });
    // 2ª transação (independente): parte do mesmo rev gravado e sobe +1 de novo — o mesmo que a 2ª de duas transações seguidas,
    // cujo ponto de partida é uma linha escrita por OUTRA transação (xmin já confirmado ≠ xid atual).
    await withTx(async (c) => {
      await comT5(c);
      const p = await payloadBom(c, card);
      expect((await mede(c, card)).rev).toBe(base0);
      await salvar(c, card, p, base0);
      expect((await mede(c, card)).rev).toBe(base0 + 1);
    });
    // Uma filha só (sem Salvar do BOM), noutra transação: +1 (o canal Realtime das telas recebe o UPDATE do card).
    await withTx(async (c) => {
      await comT5(c);
      const r0 = (await mede(c, card)).rev;
      await c.query(
        `UPDATE public.modelo_grades SET grade_total = grade_total WHERE modelo_id = $1`,
        [card],
      );
      expect((await mede(c, card)).rev).toBe(r0 + 1);
      await c.query(`UPDATE public.modelo_aviamentos SET consumo = consumo WHERE modelo_id = $1`, [
        card,
      ]);
      expect((await mede(c, card)).rev).toBe(r0 + 1);
    });
  });

  it("P0409 continua: com a T5, _rev_base velho (antes ou depois de um Salvar na mesma txn) recusa com conflito_versao; nada gravado", async () => {
    await withTx(async (c) => {
      await comT5(c);
      const { id: card } = await cardGrande(c);
      const p = await payloadBom(c, card);
      const r0 = (await mede(c, card)).rev;
      // base velha logo de cara (outra pessoa já salvou)
      const velho = await salvarSp(c, card, p, r0 - 1);
      expect(velho).toMatchObject({ ok: false, code: "P0409" });
      expect((velho as { msg: string }).msg).toMatch(/^conflito_versao: /);
      expect((await mede(c, card)).rev).toBe(r0);
      // Salvar de A (r0 → r0+1); B com a base de antes (r0) → P0409
      expect(await salvarSp(c, card, p, r0)).toEqual({ ok: true });
      const r1 = (await mede(c, card)).rev;
      expect(r1).toBeGreaterThan(r0);
      const b = await salvarSp(c, card, p, r0);
      expect(b).toMatchObject({ ok: false, code: "P0409" });
      expect((await mede(c, card)).rev).toBe(r1);
      // _rev_base nulo (sem trava) segue gravando
      expect(await salvarSp(c, card, p, null)).toEqual({ ok: true });
    });
  });

  it("P0409 FORA de savepoint no caminho pulado (M2): card já gravado nesta txn → o Salvar com a base nova passa sem bump extra; base velha recusa", async () => {
    await withTx(async (c) => {
      await comT5(c);
      const { id: card } = await cardGrande(c);
      const p = await payloadBom(c, card);
      const r0 = (await mede(c, card)).rev;
      // 1) o cabeçalho do card é gravado no NÍVEL DE TOPO (como o UPDATE .eq("rev") do Sheet): rev r0+1, xmin = xid de topo
      await c.query("UPDATE public.modelos SET nome = nome WHERE id = $1", [card]);
      expect((await mede(c, card)).rev).toBe(r0 + 1);
      // 2) Salvar do BOM no topo com a base nova: TODOS os bumps das filhas são pulados (caminho da T5) e nada a mais sobe
      await salvar(c, card, p, r0 + 1);
      expect((await mede(c, card)).rev).toBe(r0 + 1);
      // 3) quem ainda tem a base velha (r0) é recusado mesmo assim
      const velho = await salvarSp(c, card, p, r0);
      expect(velho).toMatchObject({ ok: false, code: "P0409" });
      expect((velho as { msg: string }).msg).toMatch(/^conflito_versao: /);
      expect((await mede(c, card)).rev).toBe(r0 + 1);
    });
  });

  it("processador adiado do custo (M1): preço de catálogo muda → cada card afetado sobe +1 (antes da T5/fix: +1 + 1 por linha do BOM regravada)", async () => {
    const roda = async (comA5: boolean) => {
      const out: { card: string; delta: number; linhas: number }[] = [];
      await withTx(async (c) => {
        if (comA5) await comT5(c);
        else await semT5(c);
        // artigo mais usado em cards INTERNOS não cortados da Loja Teste (corte congela o preço — P-169 A)
        const a = await um<{ artigo_id: string }>(
          c,
          `SELECT t.artigo_id FROM modelo_tecidos t JOIN modelos m ON m.id = t.modelo_id
            WHERE m.tenant_id = $1 AND m.origem = 'interno'
              AND NOT EXISTS (SELECT 1 FROM cad WHERE cad.modelo_id = m.id AND cad.enviado_corte)
            GROUP BY 1 ORDER BY count(DISTINCT t.modelo_id) DESC, 1 LIMIT 1`,
          [T],
        );
        const antes = (
          await c.query(
            `SELECT m.id, m.rev, (SELECT jsonb_object_agg(t.id, t.custo_previsto) FROM modelo_tecidos t WHERE t.modelo_id = m.id) AS l
             FROM modelos m WHERE m.id IN (SELECT modelo_id FROM modelo_tecidos WHERE artigo_id = $1) AND m.origem = 'interno'`,
            [a.artigo_id],
          )
        ).rows as { id: string; rev: number; l: Record<string, string> }[];
        await semJwt(c, () =>
          c.query("UPDATE public.artigos SET preco = coalesce(preco, 0) + 1 WHERE id = $1", [
            a.artigo_id,
          ]),
        );
        await commitSimulado(c);
        for (const m of antes) {
          const d = await um<{ rev: number; l: Record<string, string> }>(
            c,
            `SELECT m.rev, (SELECT jsonb_object_agg(t.id, t.custo_previsto) FROM modelo_tecidos t WHERE t.modelo_id = m.id) AS l
               FROM modelos m WHERE m.id = $1`,
            [m.id],
          );
          const linhas = Object.keys(m.l ?? {}).filter(
            (k) => String(m.l[k]) !== String(d.l?.[k]),
          ).length;
          out.push({ card: m.id, delta: d.rev - m.rev, linhas });
        }
      });
      return out;
    };
    const com = await roda(true);
    const sem = await roda(false);
    const mudaram = com.filter((x) => x.linhas > 0);
    console.log(
      `[mod T5] preço de catálogo: ${JSON.stringify({ com: mudaram, sem: sem.filter((x) => x.linhas > 0) })}`,
    );
    expect(mudaram.length).toBeGreaterThan(0); // o caso existe na cópia
    for (const x of mudaram) expect(x.delta).toBe(1);
    for (const x of com.filter((y) => y.linhas === 0)) expect(x.delta).toBe(0); // card sem mudança não sobe (IS DISTINCT FROM)
    for (const x of sem.filter((y) => y.linhas > 0)) expect(x.delta).toBe(1 + x.linhas); // o de antes: +1 do card + 1 por linha
  });

  it("subtransação (SAVEPOINT/bloco EXCEPTION): INSERT/UPDATE de filha não sobe de novo; DELETE segue 1 por linha — nunca pior que antes da T5", async () => {
    let semA5 = 0,
      comA5 = 0;
    for (const com of [false, true]) {
      await withTx(async (c) => {
        if (com) await comT5(c);
        else await semT5(c);
        const { id: card } = await cardGrande(c);
        const p = await payloadBom(c, card);
        const r0 = (await mede(c, card)).rev;
        expect(await salvarSp(c, card, p, r0)).toEqual({ ok: true });
        const d = (await mede(c, card)).rev - r0;
        if (com) comA5 = d;
        else semA5 = d;
      });
    }
    console.log(`[mod T5] Salvar dentro de SAVEPOINT: sem a T5 +${semA5}, com a T5 +${comA5}`);
    expect(comA5).toBeGreaterThanOrEqual(1);
    expect(comA5).toBeLessThan(semA5); // os INSERTs da subtransação não sobem mais (xmin do card = xmin da linha)
  });

  it("auditoria (anti-drift): dos gatilhos de modelos que disparam num UPDATE SET id = id, só fn_modelo_ref_auto alcança as filhas — e só quando v_relevante (o bump não muda coluna)", async () => {
    await withTx(async (c) => {
      const FILHAS = [
        "modelo_aviamentos",
        "modelo_etiquetas",
        "modelo_grades",
        "modelo_observacoes",
        "modelo_prova_comentarios",
        "modelo_tecido_oc_links",
        "modelo_tecidos",
        "modelo_tecido_variantes",
      ];
      const fns = (
        await c.query(
          `SELECT proname, string_agg(prosrc, E'\n') AS src FROM pg_proc WHERE pronamespace = 'public'::regnamespace GROUP BY proname`,
        )
      ).rows as { proname: string; src: string }[];
      const src = new Map(fns.map((r) => [r.proname, r.src.replace(/--[^\n]*/g, "")]));
      const nomes = [...src.keys()];
      const esc = (s: string) => s.replace(/[$]/g, "\\$");
      const fecho = (raiz: string) => {
        const visto = new Set<string>(),
          fila = [raiz],
          filhas = new Set<string>();
        while (fila.length) {
          const f = fila.shift()!;
          if (visto.has(f)) continue;
          visto.add(f);
          const s = src.get(f) ?? "";
          for (const t of FILHAS) if (new RegExp(`\\b${t}\\b`).test(s)) filhas.add(`${f}->${t}`);
          for (const n of nomes)
            if (!visto.has(n) && new RegExp(`\\b${esc(n)}\\s*\\(`).test(s)) fila.push(n);
        }
        return [...filhas].sort();
      };
      // gatilhos de UPDATE em modelos SEM lista de colunas (UPDATE OF col não dispara no SET id = id) e SEM WHEN (os WHEN de hoje
      // só olham colunas de valor; um WHEN que dispare pode ser alcançado se um BEFORE mudar a coluna — fn_modelo_mo_flag_derivada
      // muda custo_terceirizados_aprovado: trg_kanban_fila_upd só enfileira, conferido abaixo).
      const g = (
        await c.query(
          `SELECT t.tgname, p.proname, pg_get_triggerdef(t.oid) AS d, t.tgattr::text AS cols
           FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgrelid = 'public.modelos'::regclass AND NOT t.tgisinternal AND (t.tgtype & 16) = 16 ORDER BY 1`,
        )
      ).rows as { tgname: string; proname: string; d: string; cols: string }[];
      const disparam = g
        .filter((x) => x.cols.trim() === "" && !/ WHEN /.test(x.d))
        .map((x) => x.proname)
        .sort();
      expect(disparam).toEqual([
        "fn_audit",
        "fn_colab_touch_rev",
        "fn_integracao_trava_modelos",
        "fn_modelo_markup_congela",
        "fn_modelo_mo_flag_derivada",
        "fn_modelo_preco_venda_gate",
        "fn_modelo_ref_auto",
        "fn_seg_pagina_modelos",
      ]);
      const alcancam = Object.fromEntries(
        disparam.map((f) => [f, fecho(f)]).filter(([, h]) => (h as string[]).length),
      );
      expect(Object.keys(alcancam)).toEqual(["fn_modelo_ref_auto"]); // via _kanban_status_gate → _avaliar_condicoes_kanban_core
      // os de WHEN que podem disparar no bump (um BEFORE acima mudou a coluna) não leem filhas
      const comWhen = g
        .filter((x) => x.cols.trim() === "" && / WHEN /.test(x.d))
        .map((x) => x.proname);
      for (const f of comWhen) expect(fecho(f)).toEqual([]);
      // fn_modelo_ref_auto só calcula a posição quando v_relevante: INSERT, ordem/categoria/sub1/status mudou, ou ref_auto vazio.
      // O bump não muda coluna → só o caso "ref_auto vazio", decidido no 1º UPDATE do card na transação (com ou sem a T5): ou a
      // sigla existe e ref_auto é gravado ali (os UPDATEs seguintes saem cedo), ou não existe e nada é gravado em nenhum deles.
      const ref = src.get("fn_modelo_ref_auto")!;
      const iRel = ref.indexOf("IF NOT v_relevante THEN RETURN NEW; END IF;");
      expect(iRel).toBeGreaterThan(0);
      expect(ref.indexOf("_kanban_status_gate")).toBeGreaterThan(iRel);
      expect(ref).toMatch(/OR \(coalesce\(NEW\.ref_auto,''\) = ''\);/);
      // fn_modelo_mo_flag_derivada lê só modelo_servico_mo (não é filha com bump; o rollup dela grava o card direto)
      expect(src.get("_mo_liberada")).toMatch(/modelo_servico_mo/);
    });
  });

  it("migration: guarda/pós (md5, ACL interna, deps, gatilhos), ida 2× / _down 2× / ida; só catálogo nas travas (2ª sessão lendo pg_locks)", async () => {
    await withTx(async (c) => {
      await semT5(c);
      const pid = (await um<{ p: number }>(c, "SELECT pg_backend_pid() AS p")).p;
      await aplica(c, MOD_MIG);
      // travas desta txn vistas de FORA (2ª sessão)
      const b = new Client({ connectionString: dbUrl()!, ssl: false });
      await b.connect();
      let travas: { rel: string | null; nsp: string | null; mode: string; locktype: string }[] = [];
      try {
        travas = (
          await b.query(
            `SELECT c.relname AS rel, n.nspname AS nsp, l.mode, l.locktype
             FROM pg_locks l LEFT JOIN pg_class c ON c.oid = l.relation LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE l.pid = $1 AND l.granted`,
            [pid],
          )
        ).rows;
      } finally {
        await b.end();
      }
      console.log(
        `[mod T5] travas da ida (txn revertida): ${JSON.stringify(travas.filter((t) => t.locktype !== "virtualxid" && t.locktype !== "transactionid"))}`,
      );
      const rel = travas.filter((t) => t.locktype === "relation");
      expect(
        rel.filter((t) =>
          /^(auth|storage|realtime|supabase_functions|graphql|vault)$/.test(t.nsp ?? ""),
        ),
      ).toEqual([]);
      // nenhuma tabela de dados travada além de AccessShare (catálogos pg_* só leitura/escrita de catálogo)
      expect(rel.filter((t) => t.nsp === "public" && t.mode !== "AccessShareLock")).toEqual([]);
      expect(rel.filter((t) => t.mode === "AccessExclusiveLock")).toEqual([]);
      for (const f of [BUMP, VIA]) {
        expect(await md5Fn(c, f)).toBe(MOD_MD5[f].depois);
        const p = await um<{
          acl: string;
          sd: boolean;
          cfg: string[];
          anon: boolean;
          auth: boolean;
        }>(
          c,
          `SELECT coalesce(proacl::text, '') AS acl, prosecdef AS sd, proconfig AS cfg,
                  has_function_privilege('anon', oid, 'EXECUTE') AS anon, has_function_privilege('authenticated', oid, 'EXECUTE') AS auth
             FROM pg_proc WHERE oid = to_regprocedure($1)`,
          [f],
        );
        expect(p).toEqual({
          acl: MOD5_ACL[f],
          sd: true,
          cfg: ["search_path=public"],
          anon: false,
          auth: false,
        });
      }
      for (const [s, m] of Object.entries(MOD5_DEPS)) expect(await md5Fn(c, s)).toBe(m);
      for (const [f, ts] of Object.entries(MOD5_GATILHOS)) {
        const r = (
          await c.query(
            `SELECT c.relname AS t FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid
            WHERE NOT g.tgisinternal AND g.tgfoid = to_regprocedure($1) ORDER BY 1`,
            [f],
          )
        ).rows.map((x: { t: string }) => x.t);
        expect(r).toEqual(ts);
      }
      await aplica(c, MOD_MIG); // idempotente
      await aplica(c, MOD_DOWN);
      for (const f of [BUMP, VIA]) expect(await md5Fn(c, f)).toBe(MOD_MD5[f].antes);
      await aplica(c, MOD_DOWN); // idempotente
      await aplica(c, MOD_MIG);
      for (const f of [BUMP, VIA]) expect(await md5Fn(c, f)).toBe(MOD_MD5[f].depois);
    });
  });

  it("guarda: função com texto inesperado → ida e _down recusam (P0001); dependência mexida → a ida recusa; nada muda", async () => {
    const tenta = async (c: Client, rel: string) => {
      try {
        await aplicarArquivo(c, rel);
        await zeraTimeouts(c);
        return "PASSOU";
      } catch (e) {
        const er = e as { code?: string; message?: string };
        return `${er.code} ${er.message}`;
      }
    };
    await withTx(async (c) => {
      await semT5(c);
      await c.query(`CREATE OR REPLACE FUNCTION public.fn_colab_bump_modelo_via_tecido() RETURNS trigger LANGUAGE plpgsql
        SECURITY DEFINER SET search_path TO 'public' AS $f$ begin return coalesce(new, old); end $f$`);
      expect(await tenta(c, MOD_MIG)).toMatch(
        /^P0001 mod5_rev_uma_vez: public\.fn_colab_bump_modelo_via_tecido\(\) com texto inesperado/,
      );
      expect(await tenta(c, MOD_DOWN)).toMatch(
        /^P0001 mod5_rev_uma_vez_down: public\.fn_colab_bump_modelo_via_tecido\(\)/,
      );
      expect(await md5Fn(c, BUMP)).toBe(MOD_MD5[BUMP].antes); // nada mudou
    });
    await withTx(async (c) => {
      await semT5(c);
      await c.query(`CREATE OR REPLACE FUNCTION public.fn_colab_touch_rev() RETURNS trigger LANGUAGE plpgsql
        AS $f$ begin new.rev := old.rev + 2; return new; end $f$`);
      expect(await tenta(c, MOD_MIG)).toMatch(
        /^P0001 mod5_rev_uma_vez: dependencia public\.fn_colab_touch_rev\(\)/,
      );
      expect(await md5Fn(c, BUMP)).toBe(MOD_MD5[BUMP].antes);
      expect(await md5Fn(c, VIA)).toBe(MOD_MD5[VIA].antes);
    });
  });
});
