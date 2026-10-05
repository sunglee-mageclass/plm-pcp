// Urgentes R4b (plan-b Task 2, migration 20261103181000_urg_r4_servicos_da_mo): o Enviar à Explosão cria, num CAD SEM nenhum bloco
// de Serviços, 1 bloco por linha de M.O. (tipo + fornecedor; preço = valor da M.O. APROVADA, senão sem preço) e o preço entra no bloco
// quando a linha é aprovada depois (só bloco ativo, externo, ligado à linha e ainda sem preço — NULL ou 0, Ruling 4). Txn revertida;
// o bloco é aplicado DENTRO da txn por aplicaUrgb(c, "r4b") (pula se já vivo na cópia). As RPCs rodam como o PAPEL authenticated
// com o JWT de um usuário comum (não super admin) com as páginas certas. Só na cópia local (DDL em txn contra produção trava o app).
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, withTx, um, semJwt, TENANT_TESTE, USER_TESTE, ehBancoLocal, dbUrl } from "./db";
import { aplicaUrgb, voltaUrgb, urgbViva, URGB_MIGS } from "./urgb-helpers";
import { aplicarArquivo } from "./mig-txn";
import { blocoDeLinha, blocoParaPayload } from "@/lib/servicos-payload";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const U = "0a0a0a0a-0000-4000-8000-0000000000b5"; // usuário comum da Loja Teste, nasce na txn
const CRIAR = "public._servicos_da_mo_criar(uuid,uuid)";
const PREENCHER = "public._servico_mo_preencher_preco(uuid)";
const ENVIAR_CORE = "public._enviar_modelo_para_cad_core(uuid,text,text)";
const APROVAR_CORE = "public._aprovar_servico_mo_core(uuid,uuid,boolean,text)";
const bloco = () => URGB_MIGS.find((x) => x.id === "r4b")?.b;

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
/** Roda `sql` como o papel authenticated (PostgREST real) num SAVEPOINT; erro volta ao savepoint e vira resultado. */
async function rpc(c: Client, sql: string, params: unknown[] = []): Promise<Res> {
  await c.query("SAVEPOINT r4b");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT r4b");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT r4b");
    await c.query("RELEASE SAVEPOINT r4b");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
const txt = (r: Res) => (r.ok ? "PASSOU" : `${r.code} ${r.msg}`);

async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}

async function jwt(c: Client, uid: string | null): Promise<void> {
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
}

/** Loja com Criação + E&S + Produção (+ Financeiro), kanban manual e envio a partir de 'aprovado'; usuário comum com as páginas. */
async function prepara(c: Client): Promise<void> {
  await aplicaUrgb(c, "r4b");
  await jwt(c, null);
  await c.query(
    `UPDATE public.tenant_config SET modules = modules || '{"criacao": true, "entrada_saida": true, "producao": true, "financeiro": true}'::jsonb
      WHERE tenant_id = $1`,
    [T],
  );
  await c.query("SELECT set_config('app.kanban_chave', 'rpc', true)");
  await c.query("UPDATE public.tenant_config SET kanban_automatico = false, explosao_envio_status = NULL WHERE tenant_id = $1", [T]);
  await c.query("SELECT set_config('app.kanban_chave', '', true)");
  await c.query("INSERT INTO auth.users (id, email) VALUES ($1, 'r4b@teste') ON CONFLICT (id) DO NOTHING", [U]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, 'r4b@teste', 'Usuario R4b')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [U, T],
  );
  await c.query("DELETE FROM public.user_permissions WHERE user_id = $1", [U]);
  await c.query(
    `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES
       ($1, $2, 'criacao_desenvolvimento', true, true), ($1, $2, 'criacao_planejamento', true, true),
       ($1, $2, 'criacao_planejamento:custos', true, false), ($1, $2, 'producao_servico_aprovacao', true, true),
       ($1, $2, 'producao_terceirizados', true, true), ($1, $2, 'financeiro_servicos', true, true)`,
    [U, T],
  );
}

type Cen = { m: string; catA: string; catB: string; forn: string; l1: string; l2: string; legado: string };

/** Modelo pronto para a Explosão + 2 serviços (A antes de B) + fornecedor F; M.O.: A 12,50 com F (APROVADA), B 8 sem fornecedor
 *  (pendente) e 1 linha "Geral (legado)" 3. Termina com o JWT do usuário comum. */
async function cenario(c: Client, nome = "M R4b"): Promise<Cen> {
  await prepara(c);
  const suf = Math.random().toString(36).slice(2, 8);
  const m = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelos (tenant_id, nome, ordem_criacao_enviada, status_desenvolvimento, origem)
       VALUES ($1, $2, true, 'aprovado', 'interno') RETURNING id`,
      [T, `${nome} ${suf}`],
    )
  ).id;
  const cat = async (n: string, ordem: number) =>
    (
      await um<{ id: string }>(
        c,
        "INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa, ordem) VALUES ($1, $2, 'ate_costura', $3) RETURNING id",
        [T, `Serv R4b ${n} ${suf}`, ordem],
      )
    ).id;
  const catA = await cat("A", -20);
  const catB = await cat("B", -10);
  const forn = (
    await um<{ id: string }>(
      c,
      "INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, $2, 'servico') RETURNING id",
      [T, `Oficina R4b ${suf}`],
    )
  ).id;
  await jwt(c, U);
  expect(
    txt(
      await rpc(c, "SELECT public.salvar_modelo_servico_mo($1, $2::jsonb)", [
        m,
        JSON.stringify([
          { categoria_terceirizado_id: catA, valor: 12.5, empresa_id: forn },
          { categoria_terceirizado_id: catB, valor: 8 },
          { categoria_terceirizado_id: null, valor: 3 },
        ]),
      ]),
    ),
  ).toBe("PASSOU");
  const ls = (
    await c.query("SELECT id, categoria_terceirizado_id AS cat FROM public.modelo_servico_mo WHERE modelo_id = $1", [m])
  ).rows as { id: string; cat: string | null }[];
  const l1 = ls.find((l) => l.cat === catA)!.id;
  const l2 = ls.find((l) => l.cat === catB)!.id;
  const legado = ls.find((l) => l.cat === null)!.id;
  expect(txt(await rpc(c, "SELECT public.aprovar_servico_mo($1, $2, true, null)", [m, l1]))).toBe("PASSOU");
  await voltaAprovado(c, m);
  return { m, catA, catB, forn, l1, l2, legado };
}

/** Mexer na M.O. pode mover a etapa do card (regressão do kanban): devolve o card a 'aprovado' (preparação, sem JWT). */
async function voltaAprovado(c: Client, m: string): Promise<void> {
  await semJwt(c, () => c.query("UPDATE public.modelos SET status_desenvolvimento = 'aprovado' WHERE id = $1", [m]));
}

type Bloco = {
  id: string;
  cat: string;
  empresa_id: string | null;
  preco: string | null;
  mo_linha_id: string | null;
  interno: boolean;
  ativo: boolean;
  numero_parcelas: number;
  rev: number;
};
async function blocos(c: Client, cad: string): Promise<Bloco[]> {
  return (
    await c.query(
      `SELECT pt.id, pt.categoria_terceirizado_id AS cat, pt.empresa_id, pt.preco_metro_unidade::text AS preco, pt.mo_linha_id,
              pt.interno, pt.ativo, pt.numero_parcelas, pt.rev
         FROM public.producao_terceirizados pt
         LEFT JOIN public.categorias_terceirizado ct ON ct.id = pt.categoria_terceirizado_id
        WHERE pt.cad_id = $1 ORDER BY ct.ordem, pt.created_at, pt.id`,
      [cad],
    )
  ).rows as Bloco[];
}
async function enviar(c: Client, m: string): Promise<string> {
  const r = await rpc(c, "SELECT public.enviar_modelo_para_cad($1, NULL, NULL) AS cad", [m]);
  expect(txt(r)).toBe("PASSOU");
  return (r as { rows: any[] }).rows[0].cad as string;
}
async function aprovar(c: Client, m: string, linha: string, ok: boolean, motivo: string | null = null): Promise<void> {
  expect(txt(await rpc(c, "SELECT public.aprovar_servico_mo($1, $2, $3, $4)", [m, linha, ok, motivo]))).toBe("PASSOU");
}
/** Salvar do PCP › Serviços com o payload da TELA (blocoDeLinha → blocoParaPayload; sem mo_linha_id), rev de todos os blocos. */
async function salvarPcp(
  c: Client,
  cad: string,
  muda: (b: ReturnType<typeof blocoParaPayload>, linha: Record<string, unknown>) => object = (b) => b,
  extra: object[] = [],
) {
  const linhas = (
    await c.query("SELECT to_jsonb(pt) AS j FROM public.producao_terceirizados pt WHERE cad_id = $1 AND ativo ORDER BY created_at, id", [cad])
  ).rows.map((r) => r.j as Record<string, unknown>);
  const payload = [...linhas.map((l) => muda(blocoParaPayload(blocoDeLinha(l)), l)), ...extra];
  for (const p of payload) expect("mo_linha_id" in p).toBe(false);
  const revBase = { ...Object.fromEntries(linhas.map((l) => [l.id as string, Number(l.rev)])), _molde_tocado: false };
  return rpc(c, "SELECT public.salvar_terceirizados($1, $2::jsonb, NULL, $3::jsonb)", [cad, JSON.stringify(payload), JSON.stringify(revBase)]);
}

describe.skipIf(!RODA)("urg R4b — blocos de Serviços nascem da M.O. no Enviar à Explosão; preço entra ao aprovar", () => {
  it("bloco r4b existe e aplicado: md5 DEPOIS; coluna mo_linha_id uuid NULL com FK ON DELETE SET NULL + índice parcial; só o servidor grava", async () => {
    expect(bloco(), "bloco r4b em urgb-dados.ts + arquivo da migration").toBeTruthy();
    await withTx(async (c) => {
      await aplicaUrgb(c, "r4b");
      expect(await urgbViva(c, "r4b")).toBe(true);
      for (const [sig, m] of Object.entries(bloco()!.URGB_MD5)) expect(await md5Fn(c, sig), sig).toBe(m.depois);
      expect(
        await um(c, `SELECT data_type AS t, is_nullable AS n, column_default AS d FROM information_schema.columns
                      WHERE table_schema = 'public' AND table_name = 'producao_terceirizados' AND column_name = 'mo_linha_id'`),
      ).toEqual({ t: "uuid", n: "YES", d: null });
      const fk = await um<{ n: number }>(
        c,
        `SELECT count(*)::int AS n FROM pg_constraint k
          WHERE k.conrelid = 'public.producao_terceirizados'::regclass AND k.contype = 'f'
            AND k.confrelid = 'public.modelo_servico_mo'::regclass AND k.confdeltype = 'n'`,
      );
      expect(fk.n).toBe(1);
      const ix = await um<{ d: string }>(c, "SELECT pg_get_indexdef('public.producao_terceirizados_mo_linha_idx'::regclass) AS d");
      expect(ix.d).toMatch(/\(mo_linha_id\) WHERE \(mo_linha_id IS NOT NULL\)$/);
      expect(
        await um(c, `SELECT has_column_privilege('authenticated', 'public.producao_terceirizados', 'mo_linha_id', 'UPDATE') AS u,
                            has_column_privilege('authenticated', 'public.producao_terceirizados', 'mo_linha_id', 'INSERT') AS i,
                            has_column_privilege('anon', 'public.producao_terceirizados', 'mo_linha_id', 'SELECT') AS a`),
      ).toEqual({ u: false, i: false, a: false });
    });
  });

  it("1) CAD novo: EXATAMENTE 2 blocos (A: fornecedor F, preço 12.50; B: sem fornecedor, sem preço); legado não vira bloco; sem parcela", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const cad = await enviar(c, s.m);
      const bs = await blocos(c, cad);
      expect(bs.map(({ id: _i, ...b }) => b)).toEqual([
        { cat: s.catA, empresa_id: s.forn, preco: "12.50", mo_linha_id: s.l1, interno: false, ativo: true, numero_parcelas: 1, rev: 0 },
        { cat: s.catB, empresa_id: null, preco: null, mo_linha_id: s.l2, interno: false, ativo: true, numero_parcelas: 1, rev: 0 },
      ]);
      expect(await um(c, "SELECT enviado_cad AS e, coalesce(current_setting('app.explosao_sistema', true), '') AS g FROM public.modelos WHERE id = $1", [s.m]))
        .toEqual({ e: true, g: "" });
      // Financeiro: bloco sem envio/entrega não gera parcela (nem com preço NULL)
      expect(txt(await rpc(c, "SELECT public.servicos_financeiro()"))).toBe("PASSOU");
      expect(
        (await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.parcelas_servico WHERE producao_terceirizado_id = ANY($1::uuid[])", [bs.map((b) => b.id)])).n,
      ).toBe(0);
    });
  });

  it("1c) ordem: os blocos nascem com created_at crescente na ORDEM da M.O. (categoria.ordem, nome) — a do PCP (created_at, id)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      // 3 serviços salvos fora da ordem da M.O.: Z (ordem 30), X (ordem 10), Y (ordem 20)
      const suf = Math.random().toString(36).slice(2, 8);
      const cat = async (n: string, ordem: number) =>
        semJwt(c, async () =>
          (
            await um<{ id: string }>(
              c,
              "INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa, ordem) VALUES ($1, $2, 'ate_costura', $3) RETURNING id",
              [T, `Ordem R4b ${n} ${suf}`, ordem],
            )
          ).id,
        );
      const z = await cat("Z", 30), x = await cat("X", 10), y = await cat("Y", 20);
      const m = await semJwt(c, async () =>
        (
          await um<{ id: string }>(
            c,
            `INSERT INTO public.modelos (tenant_id, nome, ordem_criacao_enviada, status_desenvolvimento, origem)
             VALUES ($1, $2, true, 'aprovado', 'interno') RETURNING id`,
            [T, `M R4b ordem ${suf}`],
          )
        ).id,
      );
      for (const k of [z, x, y]) {
        // uma linha por Salvar (created_at das linhas também fora da ordem da M.O.)
        const atuais = (await c.query("SELECT id, categoria_terceirizado_id AS cat FROM modelo_servico_mo WHERE modelo_id = $1", [m])).rows;
        expect(
          txt(await rpc(c, "SELECT public.salvar_modelo_servico_mo($1, $2::jsonb)", [
            m,
            JSON.stringify([...atuais.map((l) => ({ id: l.id, categoria_terceirizado_id: l.cat, valor: 1 })), { categoria_terceirizado_id: k, valor: 1 }]),
          ])),
        ).toBe("PASSOU");
      }
      await voltaAprovado(c, m);
      const cad = await enviar(c, m);
      const r = (
        await c.query(
          "SELECT categoria_terceirizado_id AS cat, created_at FROM producao_terceirizados WHERE cad_id = $1 AND ativo ORDER BY created_at, id",
          [cad],
        )
      ).rows as { cat: string; created_at: Date }[];
      expect(r.map((b) => b.cat)).toEqual([x, y, z]);
      const us = (
        await c.query("SELECT (extract(epoch from created_at) * 1000000)::bigint AS us FROM producao_terceirizados WHERE cad_id = $1 ORDER BY created_at", [cad])
      ).rows.map((x) => Number(x.us));
      expect(us[1] - us[0]).toBe(1);
      expect(us[2] - us[1]).toBe(1);
      void s;
    });
  });

  it("1b) fornecedor da linha que deixou de ser de serviço (ou de OUTRA loja, gravado por fora) NÃO vai para o bloco (fornecedor vazio)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await semJwt(c, async () => {
        await c.query("UPDATE public.empresas SET tipo = 'material' WHERE id = $1", [s.forn]);
        const outra = (
          await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [T])
        ).id;
        const empOutra = (
          await um<{ id: string }>(
            c,
            "INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, 'Oficina outra loja R4b', 'servico') RETURNING id",
            [outra],
          )
        ).id;
        await c.query("UPDATE public.modelo_servico_mo SET empresa_id = $2 WHERE id = $1", [s.l2, empOutra]);
      });
      const cad = await enviar(c, s.m);
      const bs = await blocos(c, cad);
      expect(bs.map((b) => [b.cat, b.empresa_id, b.mo_linha_id])).toEqual([
        [s.catA, null, s.l1],
        [s.catB, null, s.l2],
      ]);
      expect(bs[0].preco).toBe("12.50"); // a linha A segue aprovada: o preço vem; só o fornecedor fica vazio
    });
  });

  it("2) caminho idempotente (CAD criado antes pelo Salvar do card): cria igual; custo unitário do card não muda", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const cad = await semJwt(c, async () =>
        (await um<{ id: string }>(c, "INSERT INTO public.cad (modelo_id, tenant_id) VALUES ($1, $2) RETURNING id", [s.m, T])).id,
      );
      const custo = async () =>
        (await um<{ j: any }>(c, "SELECT public._custo_unitario_modelos_core(ARRAY[$1]::uuid[]) AS j", [s.m])).j;
      const custoAntes = await custo();
      expect(await enviar(c, s.m)).toBe(cad);
      const bs = await blocos(c, cad);
      expect(bs.map((b) => [b.cat, b.empresa_id, b.preco, b.mo_linha_id])).toEqual([
        [s.catA, s.forn, "12.50", s.l1],
        [s.catB, null, null, s.l2],
      ]);
      expect(await custo()).toEqual(custoAntes); // bloco com qtd 0 não é "lançado": a M.O. prevista segue no custo (R16 M7)
    });
  });

  it("3) CAD que já tem 1 bloco (mesmo INATIVO): nada criado nem apagado; reenviar não muda nada; CAD de outro modelo = 0", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const cad = await semJwt(c, async () => {
        const id = (await um<{ id: string }>(c, "INSERT INTO public.cad (modelo_id, tenant_id) VALUES ($1, $2) RETURNING id", [s.m, T])).id;
        await c.query(
          "INSERT INTO public.producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, ativo) VALUES ($1, $2, $3, false)",
          [id, T, s.catB],
        );
        return id;
      });
      await enviar(c, s.m);
      const bs = await blocos(c, cad);
      expect(bs.map((b) => [b.cat, b.ativo, b.mo_linha_id])).toEqual([[s.catB, false, null]]);
      await voltaAprovado(c, s.m); // o envio regride a etapa (trg_kanban_regredir_modelos) — devolve para reenviar
      await enviar(c, s.m);
      expect(await blocos(c, cad)).toEqual(bs);

      // reenviar um card cujos blocos já nasceram da M.O. também não muda nada (rev igual)
      const s2 = await cenario(c, "M R4b reenvio");
      const cad2 = await enviar(c, s2.m);
      const antes = await blocos(c, cad2);
      expect(antes).toHaveLength(2);
      await voltaAprovado(c, s2.m);
      expect(await enviar(c, s2.m)).toBe(cad2);
      expect(await blocos(c, cad2)).toEqual(antes);
      // o helper só cria no CAD do PRÓPRIO modelo
      const s3 = await cenario(c, "M R4b outro");
      expect((await um<{ n: number }>(c, `SELECT ${CRIAR.replace("(uuid,uuid)", "")}($1, $2) AS n`, [s3.m, cad2])).n).toBe(0);
    });
  });

  it("4) loja SEM o módulo Produção: envio OK, nenhum bloco criado", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await semJwt(c, () =>
        c.query(`UPDATE public.tenant_config SET modules = modules || '{"producao": false}'::jsonb WHERE tenant_id = $1`, [T]),
      );
      const cad = await enviar(c, s.m);
      expect(await blocos(c, cad)).toEqual([]);
      expect((await um<{ e: boolean }>(c, "SELECT enviado_cad AS e FROM public.modelos WHERE id = $1", [s.m])).e).toBe(true);
    });
  });

  it("5) aprovar a linha 2 (valor 8): preço entra no bloco vazio (NULL ou 0) e o rev sobe 1; preço digitado, interno e inativo ficam", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const cad = await enviar(c, s.m);
      const [b1, b2] = await blocos(c, cad);
      await c.query("SAVEPOINT caso5");

      // 5a) NULL -> 8, rev +1; o bloco A (12.50, aprovado antes) não muda
      await aprovar(c, s.m, s.l2, true);
      let [x1, x2] = await blocos(c, cad);
      expect([x2.preco, x2.rev]).toEqual(["8.00", b2.rev + 1]);
      expect(x1).toEqual(b1);
      await c.query("ROLLBACK TO SAVEPOINT caso5");

      // 5b) preço 5 digitado no PCP: aprovar não sobrescreve
      expect(txt(await salvarPcp(c, cad, (p, l) => (l.mo_linha_id === s.l2 ? { ...p, preco_metro_unidade: 5 } : p)))).toBe("PASSOU");
      await aprovar(c, s.m, s.l2, true);
      [, x2] = await blocos(c, cad);
      expect(x2.preco).toBe("5.00");
      expect(x2.mo_linha_id).toBe(s.l2);
      await c.query("ROLLBACK TO SAVEPOINT caso5");

      // 5c) bloco virou INTERNO: não muda
      expect(txt(await salvarPcp(c, cad, (p, l) => (l.mo_linha_id === s.l2 ? { ...p, interno: true, empresa_id: null, preco_metro_unidade: 0 } : p)))).toBe("PASSOU");
      const revC = (await blocos(c, cad))[1].rev;
      await aprovar(c, s.m, s.l2, true);
      [, x2] = await blocos(c, cad);
      expect([x2.interno, x2.preco, x2.rev]).toEqual([true, "0.00", revC]);
      await c.query("ROLLBACK TO SAVEPOINT caso5");

      // 5d) bloco INATIVO: não muda
      expect(txt(await salvarPcp(c, cad, (p, l) => (l.mo_linha_id === s.l2 ? { ...p, ativo: false } : p)))).toBe("PASSOU");
      const revD = (await blocos(c, cad))[1].rev;
      await aprovar(c, s.m, s.l2, true);
      [, x2] = await blocos(c, cad);
      expect([x2.ativo, x2.preco, x2.rev]).toEqual([false, "0.00", revD]);
      await c.query("ROLLBACK TO SAVEPOINT caso5");

      // 5e) preço 0 (a tela converte NULL em 0 no 1º Salvar do PCP — Ruling 4): vira o valor, rev +1
      expect(txt(await salvarPcp(c, cad))).toBe("PASSOU");
      const y = (await blocos(c, cad))[1];
      expect(y.preco).toBe("0.00");
      await aprovar(c, s.m, s.l2, true);
      [, x2] = await blocos(c, cad);
      expect([x2.preco, x2.rev]).toEqual(["8.00", y.rev + 1]);
    });
  });

  it("6) reprovar não muda; aprovar linha com valor 0 não muda; re-aprovar M.O. alterada NÃO sobrescreve bloco com preço (Ruling 5)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const cad = await enviar(c, s.m);
      const antes = await blocos(c, cad);
      await aprovar(c, s.m, s.l2, false, "caro");
      expect(await blocos(c, cad)).toEqual(antes);
      // linha 2 com valor 0 (pendente) e aprovada: nada muda
      const salvarMo = (linhas: object[]) =>
        rpc(c, "SELECT public.salvar_modelo_servico_mo($1, $2::jsonb)", [s.m, JSON.stringify(linhas)]);
      expect(
        txt(await salvarMo([
          { id: s.l1, categoria_terceirizado_id: s.catA, valor: 12.5, empresa_id: s.forn },
          { id: s.l2, categoria_terceirizado_id: s.catB, valor: 0 },
          { id: s.legado, categoria_terceirizado_id: null, valor: 3 },
        ])),
      ).toBe("PASSOU");
      await aprovar(c, s.m, s.l2, true);
      expect(await blocos(c, cad)).toEqual(antes);
      // linha 1 muda de valor (volta a pendente) e é aprovada de novo: o bloco A já tem preço (12.50) e fica
      expect(
        txt(await salvarMo([
          { id: s.l1, categoria_terceirizado_id: s.catA, valor: 20, empresa_id: s.forn },
          { id: s.l2, categoria_terceirizado_id: s.catB, valor: 0 },
          { id: s.legado, categoria_terceirizado_id: null, valor: 3 },
        ])),
      ).toBe("PASSOU");
      await aprovar(c, s.m, s.l1, true);
      expect(await blocos(c, cad)).toEqual(antes);
    });
  });

  it("7) apagar a linha de M.O. (Salvar do card sem ela): o bloco fica, mo_linha_id vira NULL (rev sobe: o PCP aberto recebe P0409)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const cad = await enviar(c, s.m);
      const [b1, b2] = await blocos(c, cad);
      expect(
        txt(await rpc(c, "SELECT public.salvar_modelo_servico_mo($1, $2::jsonb)", [
          s.m,
          JSON.stringify([
            { id: s.l1, categoria_terceirizado_id: s.catA, valor: 12.5, empresa_id: s.forn },
            { id: s.legado, categoria_terceirizado_id: null, valor: 3 },
          ]),
        ])),
      ).toBe("PASSOU");
      const [x1, x2] = await blocos(c, cad);
      expect(x1).toEqual(b1);
      expect({ ...x2, rev: 0 }).toEqual({ ...b2, mo_linha_id: null, rev: 0 });
      expect(x2.rev).toBe(b2.rev + 1);
    });
  });

  it("8) salvar_terceirizados com o payload da tela (sem mo_linha_id) preserva o vínculo; bloco novo do PCP nasce sem vínculo", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const cad = await enviar(c, s.m);
      const extra = { ...blocoParaPayload(blocoDeLinha({ categoria_terceirizado_id: s.catB, interno: false, ativo: true })), id: null };
      expect(txt(await salvarPcp(c, cad, (p) => ({ ...p, observacao: "editado no PCP" }), [extra]))).toBe("PASSOU");
      const bs = await blocos(c, cad);
      expect(bs).toHaveLength(3);
      expect(bs.filter((b) => b.mo_linha_id).map((b) => b.mo_linha_id).sort()).toEqual([s.l1, s.l2].sort());
      expect(bs.filter((b) => !b.mo_linha_id)).toHaveLength(1);
    });
  });

  it("9) enviado_cad segue só com a GUC (PATCH = explosao_protegida); as 2 funções novas: DEFINER, search_path, sem EXECUTE p/ PUBLIC/anon/authenticated", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await enviar(c, s.m);
      expect(txt(await rpc(c, "UPDATE public.modelos SET enviado_cad = false WHERE id = $1", [s.m]))).toMatch(/^42501 explosao_protegida:/);
      await jwt(c, null);
      for (const sig of [CRIAR, PREENCHER]) {
        expect(
          await um(c, `SELECT p.prosecdef AS sd, coalesce(array_to_string(p.proconfig, '|'), '') AS cfg, coalesce(p.proacl::text, '') AS acl,
                              has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
                              has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth,
                              EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x WHERE x.grantee = 0) AS pub
                         FROM pg_proc p WHERE p.oid = to_regprocedure($1)`, [sig]),
          sig,
        ).toEqual({ sd: true, cfg: "search_path=public", acl: "{postgres=X/postgres,service_role=X/postgres}", anon: false, auth: false, pub: false });
      }
      // chamar direto como authenticated = 42501
      await jwt(c, U);
      expect(txt(await rpc(c, `SELECT public._servico_mo_preencher_preco($1)`, [s.l2]))).toMatch(/^42501 /);
    });
  });

  it("10) volta NEUTRA: chamadoras no texto de ANTES, as 2 novas e a coluna ficam (inertes); envio não cria; ida 2x = mesmos md5", async () => {
    await withTx(async (c) => {
      const B = bloco()!;
      await aplicaUrgb(c, "r4b");
      const novas = { [CRIAR]: await md5Fn(c, CRIAR), [PREENCHER]: await md5Fn(c, PREENCHER) };
      await voltaUrgb(c);
      expect(await urgbViva(c, "r4b")).toBe(false);
      for (const sig of [ENVIAR_CORE, APROVAR_CORE]) expect(await md5Fn(c, sig), sig).toBe(B.URGB_MD5[sig].antes);
      for (const [sig, m] of Object.entries(novas)) expect(await md5Fn(c, sig), sig).toBe(m);
      expect(
        (await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM information_schema.columns
                                      WHERE table_schema = 'public' AND table_name = 'producao_terceirizados' AND column_name = 'mo_linha_id'`)).n,
      ).toBe(1);
      await aplicarArquivo(c, B.down); // _down de novo = no-op
      // sem o bloco: envio não cria nada (as novas ficaram sem chamador)
      const s = await (async () => {
        // cenario() reaplica o bloco; aqui preparamos sem ele
        const r = await cenarioSemBloco(c);
        return r;
      })();
      const cad = await enviar(c, s.m);
      expect(await blocos(c, cad)).toEqual([]);
      // ida, ida de novo: mesmos md5
      await jwt(c, null);
      await aplicarArquivo(c, B.mig);
      const d1 = Object.fromEntries(await Promise.all([ENVIAR_CORE, APROVAR_CORE, CRIAR, PREENCHER].map(async (k) => [k, await md5Fn(c, k)])));
      await aplicarArquivo(c, B.mig);
      for (const [k, m] of Object.entries(d1)) expect(await md5Fn(c, k), k).toBe(m);
      for (const sig of [ENVIAR_CORE, APROVAR_CORE]) expect(d1[sig], sig).toBe(B.URGB_MD5[sig].depois);
    });
  });
});

/**
 * Fix round 1 — ordem de trava (2 conexões REAIS na cópia local, as duas revertidas). B imita o `salvar_terceirizados`: pega o
 * advisory do CAD (hashtext(cad_id)) e depois grava a linha do `cad` (observacoes_molde). A chama o envio no caminho "CAD já existia".
 * Ordem ANTIGA (texto da 1ª versão da r4b: UPDATE cad e só depois o advisory do helper) = 40P01; ordem NOVA (advisory antes) = B passa
 * e A termina depois que B solta.
 */
describe.skipIf(!RODA)("urg R4b — fix round 1: envio x Salvar do PCP no mesmo CAD (ordem de trava)", () => {
  const LINHA_LOCK = "    PERFORM pg_advisory_xact_lock(hashtext(v_cad_id::text));  -- [urg r4] mesma chave/ordem do salvar_terceirizados\n";
  const MD5_RODADA0 = "ada02368e68996e2d52337d68b42c2c4"; // _enviar_modelo_para_cad_core da 1ª versão (sem a linha acima)

  async function rodada(
    ordemAntiga: boolean,
  ): Promise<{ a: PromiseSettledResult<unknown>; b: PromiseSettledResult<unknown>; esperou: boolean }> {
    const a = new Client({ connectionString: dbUrl()!, ssl: false });
    const b = new Client({ connectionString: dbUrl()!, ssl: false });
    await a.connect();
    await b.connect();
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      for (const x of [a, b]) await x.query("SET LOCAL lock_timeout = '15s'");
      await aplicaUrgb(a, "r4b");
      await a.query("SET LOCAL lock_timeout = '15s'");
      if (ordemAntiga) {
        const def = (await um<{ d: string }>(a, "SELECT pg_get_functiondef($1::regprocedure) AS d", [ENVIAR_CORE])).d;
        expect(def.split(LINHA_LOCK).length - 1).toBe(1);
        const velho = def.replace(LINHA_LOCK, "");
        await a.query(velho);
        expect(await md5Fn(a, ENVIAR_CORE)).toBe(MD5_RODADA0);
      }
      // card existente da Loja Teste com CAD (dado da cópia, só lido; tudo revertido)
      const alvo = await um<{ m: string; cad: string } | undefined>(
        a,
        `SELECT m.id AS m, k.id AS cad FROM public.modelos m JOIN public.cad k ON k.modelo_id = m.id
          WHERE m.tenant_id = $1 AND lower(coalesce(m.status_planejamento, '')) <> 'reprovado' ORDER BY m.id LIMIT 1`,
        [T],
      );
      expect(alvo, "a Loja Teste da cópia precisa de 1 card com CAD").toBeTruthy();
      await a.query("SELECT set_config('app.kanban_chave', 'rpc', true)");
      await a.query("UPDATE public.tenant_config SET kanban_automatico = false, explosao_envio_status = NULL WHERE tenant_id = $1", [T]);
      await a.query("SELECT set_config('app.kanban_chave', '', true)");
      await a.query("UPDATE public.modelos SET status_desenvolvimento = 'aprovado', ordem_criacao_enviada = true WHERE id = $1", [alvo!.m]);
      await a.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USER_TESTE, role: "authenticated" })]);
      await a.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [T, USER_TESTE]);
      const apid = (await um<{ p: number }>(a, "SELECT pg_backend_pid() AS p")).p;

      await b.query("SELECT pg_advisory_xact_lock(hashtext($1::text))", [alvo!.cad]); // B = salvar_terceirizados (1º passo)
      const pa = a.query(`SELECT ${ENVIAR_CORE.replace("(uuid,text,text)", "")}($1) AS cad`, [alvo!.m]);
      pa.catch(() => {});
      // espera A ficar parado numa trava (o advisory que B segura)
      let esperou = false;
      for (let i = 0; i < 100 && !esperou; i++) {
        const w = await um<{ t: string | null }>(b, "SELECT wait_event_type AS t FROM pg_stat_activity WHERE pid = $1", [apid]);
        esperou = w.t === "Lock";
        if (esperou) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      // B = salvar_terceirizados (fim: grava observacoes_molde do cad)
      const pb = b.query("UPDATE public.cad SET observacoes_molde = observacoes_molde WHERE id = $1", [alvo!.cad]);
      pb.catch(() => {});
      const rb = await Promise.allSettled([pb]);
      await b.query("ROLLBACK").catch(() => {});
      const ra = await Promise.allSettled([pa]);
      return { a: ra[0], b: rb[0], esperou };
    } finally {
      await a.query("ROLLBACK").catch(() => {});
      await b.query("ROLLBACK").catch(() => {});
      await a.end();
      await b.end();
    }
  }
  const codigo = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? String((r.reason as { code?: string }).code) : "ok");

  it("ordem ANTIGA (1ª versão da r4b) = deadlock 40P01; ordem NOVA = o Salvar do PCP passa e o envio termina depois", async () => {
    const velho = await rodada(true);
    expect(velho.esperou).toBe(true);
    expect([codigo(velho.a), codigo(velho.b)]).toContain("40P01");
    const novo = await rodada(false);
    expect(novo.esperou).toBe(true); // A parou no advisory do CAD ANTES de tocar a linha do cad
    expect(codigo(novo.b)).toBe("ok");
    expect(codigo(novo.a)).toBe("ok");
  }, 60000);
});

/** Igual a `cenario`, mas com a r4b FORA (para provar a volta): mesma preparação, sem aplicaUrgb. */
async function cenarioSemBloco(c: Client): Promise<{ m: string }> {
  await jwt(c, null);
  const m = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelos (tenant_id, nome, ordem_criacao_enviada, status_desenvolvimento, origem)
       VALUES ($1, 'M R4b volta', true, 'aprovado', 'interno') RETURNING id`,
      [T],
    )
  ).id;
  const cat = (
    await um<{ id: string }>(
      c,
      "INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa) VALUES ($1, $2, 'ate_costura') RETURNING id",
      [T, `Serv R4b volta ${Math.random().toString(36).slice(2, 8)}`],
    )
  ).id;
  await c.query("SELECT set_config('app.kanban_chave', 'rpc', true)");
  await c.query("UPDATE public.tenant_config SET kanban_automatico = false, explosao_envio_status = NULL WHERE tenant_id = $1", [T]);
  await c.query("SELECT set_config('app.kanban_chave', '', true)");
  await c.query(
    `UPDATE public.tenant_config SET modules = modules || '{"criacao": true, "entrada_saida": true, "producao": true}'::jsonb WHERE tenant_id = $1`,
    [T],
  );
  await c.query("INSERT INTO auth.users (id, email) VALUES ($1, 'r4b@teste') ON CONFLICT (id) DO NOTHING", [U]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, 'r4b@teste', 'Usuario R4b')
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [U, T],
  );
  await c.query("DELETE FROM public.user_permissions WHERE user_id = $1", [U]);
  await c.query(
    `INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES
       ($1, $2, 'criacao_desenvolvimento', true, true), ($1, $2, 'criacao_planejamento', true, true),
       ($1, $2, 'criacao_planejamento:custos', true, false), ($1, $2, 'producao_servico_aprovacao', true, true)`,
    [U, T],
  );
  await jwt(c, U);
  expect(
    txt(await rpc(c, "SELECT public.salvar_modelo_servico_mo($1, $2::jsonb)", [m, JSON.stringify([{ categoria_terceirizado_id: cat, valor: 9 }])])),
  ).toBe("PASSOU");
  await voltaAprovado(c, m);
  return { m };
}
