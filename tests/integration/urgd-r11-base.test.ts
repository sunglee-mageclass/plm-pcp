// Urgentes R11a/R11b (plan-r11 Task 1, migrations 20261103199000_urg_r11_mini_tabelas + 20261103199100_urg_r11_ledger_tecido): tabelas
// da mini explosão da Peça Teste (cabeçalho por tentativa + linhas), ledger NOVO de baixa de aviamento/insumo (só acréscimo, gatilho de
// imutabilidade) e o ledger do TECIDO com o vínculo da tentativa + origens peca_teste/peca_teste_estorno. Txn revertida; os blocos são
// aplicados DENTRO da txn por aplicaUrgd(c, "r11b") (pula o que já está vivo na cópia). Só na cópia local (DDL em txn contra produção
// trava o app — 23/set).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicaUrgd, voltaUrgd, urgdViva, URGD_BLOCOS } from "./urgd-helpers";
import { aplicarArquivo, semTransacao } from "./mig-txn";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RODA = hasDb && ehBancoLocal();
const A = URGD_BLOCOS.r11a;
const B = URGD_BLOCOS.r11b;
const T = TENANT_TESTE;
const MINI = "public.modelo_peca_teste_mini";
const LINHAS = "public.modelo_peca_teste_mini_linhas";
const EPB = "public.estoque_peca_teste_baixas";
const ETB = "public.estoque_tecido_baixas";
const IMUTAVEL = "public.fn_estoque_peca_teste_imutavel()";
const ACL_CORE = "{postgres=X/postgres,service_role=X/postgres}";
const ACL_TAB = "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}";
const ORI_ANTES =
  "CHECK ((origem = ANY (ARRAY['vinculo'::text, 'fifo'::text, 'separacao_rolo'::text, 'ajuste'::text])))";
const ORI_DEPOIS =
  "CHECK ((origem = ANY (ARRAY['vinculo'::text, 'fifo'::text, 'separacao_rolo'::text, 'ajuste'::text, 'peca_teste'::text, 'peca_teste_estorno'::text])))";

function readSemTxn(rel: string): string {
  return semTransacao(readFileSync(ROOT + rel, "utf8"), rel);
}
async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
async function md5Gat(c: Client, tabela: string, nome: string): Promise<string | null> {
  const r = await c.query(
    `SELECT md5(pg_get_triggerdef(t.oid)) AS m FROM pg_trigger t
      WHERE t.tgrelid = to_regclass($1) AND t.tgname = $2 AND NOT t.tgisinternal AND t.tgenabled <> 'D'`,
    [tabela, nome],
  );
  return (r.rows[0]?.m as string | undefined) ?? null;
}
async function existe(c: Client, rel: string): Promise<boolean> {
  return (await um<{ ok: boolean }>(c, "SELECT to_regclass($1) IS NOT NULL AS ok", [rel])).ok;
}
async function constraint(c: Client, rel: string, nome: string): Promise<string | null> {
  const r = await c.query("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conrelid = to_regclass($1) AND conname = $2", [
    rel,
    nome,
  ]);
  return (r.rows[0]?.d as string | undefined) ?? null;
}
async function temColunaEtb(c: Client): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'estoque_tecido_baixas' AND column_name = 'peca_teste_tentativa_id'`,
  );
  return (r.rowCount ?? 0) > 0;
}
async function n(c: Client, sql: string, params: unknown[] = []): Promise<number> {
  return (await um<{ n: number }>(c, sql, params)).n;
}
/** Erro esperado DENTRO de um savepoint (a txn do teste segue usável). */
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string }> {
  await c.query("SAVEPOINT r11_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT r11_falha");
    return e as { code?: string; message: string };
  }
  await c.query("ROLLBACK TO SAVEPOINT r11_falha");
  throw new Error(`esperava erro e passou: ${sql.slice(0, 120)}`);
}
async function emSavepoint(c: Client, fn: () => Promise<void>): Promise<void> {
  await c.query("SAVEPOINT r11_alt");
  try {
    await fn();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT r11_alt");
  }
}
async function chave(c: Client, ligada: boolean): Promise<void> {
  await c.query("SELECT set_config('app.kanban_chave', 'rpc', true)");
  try {
    await c.query("UPDATE public.tenant_config SET kanban_automatico = $2 WHERE tenant_id = $1", [T, ligada]);
  } finally {
    await c.query("SELECT set_config('app.kanban_chave', '', true)");
  }
}
async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query("SELECT set_config('app.kanban_sistema', 'teste', true)");
  try {
    return await fn();
  } finally {
    await c.query("SELECT set_config('app.kanban_sistema', '', true)");
  }
}
async function naFila(c: Client, modelo: string): Promise<boolean> {
  return (await um<{ ok: boolean }>(c, "SELECT EXISTS (SELECT 1 FROM public.kanban_recalculo_fila WHERE modelo_id = $1) AS ok", [modelo]))
    .ok;
}
async function limpaFila(c: Client): Promise<void> {
  await c.query("DELETE FROM public.kanban_recalculo_fila WHERE tenant_id = $1", [T]);
}

type Cenario = { modelo: string; cat: string; tentativa: string; av: string; etq: string; item: string; variante: string };

/** Aplica r11a+r11b, entra como o usuário da Loja Teste e cria modelo + tipo de serviço + tentativa + aviamento + insumo novos. */
async function cenario(c: Client, modeloExistente?: string): Promise<Cenario> {
  await aplicaUrgd(c, "r11b");
  await comoUsuario(c);
  const suf = Math.random().toString(36).slice(2, 8);
  const modelo =
    modeloExistente ??
    (await comoSistema(c, async () =>
      (
        await um<{ id: string }>(
          c,
          `INSERT INTO public.modelos (tenant_id, nome, ordem_criacao_enviada, status_desenvolvimento)
           VALUES ($1, $2, true, 'entrada') RETURNING id`,
          [T, `M R11 ${suf}`],
        )
      ).id,
    ));
  const cat = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa, exige_peca_teste) VALUES ($1, $2, 'ate_costura', true) RETURNING id`,
      [T, `Serv R11 ${suf}`],
    )
  ).id;
  const tentativa = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelo_peca_teste_tentativas (tenant_id, modelo_id, categoria_terceirizado_id, numero, data_saida)
       VALUES ($1, $2, $3, 1, '2026-10-06') RETURNING id`,
      [T, modelo, cat],
    )
  ).id;
  const av = (await um<{ id: string }>(c, "INSERT INTO public.aviamentos (tenant_id, codigo_nome) VALUES ($1, $2) RETURNING id", [T, `Av R11 ${suf}`]))
    .id;
  const etq = (await um<{ id: string }>(c, "INSERT INTO public.etiquetas (tenant_id, nome) VALUES ($1, $2) RETURNING id", [T, `Etq R11 ${suf}`])).id;
  const it = await um<{ id: string; v: string }>(
    c,
    `SELECT i.id, i.variante_tecido_id AS v FROM public.ocs_tecido_itens i JOIN public.ocs_tecido o ON o.id = i.oc_tecido_id
      WHERE o.tenant_id = $1 AND i.variante_tecido_id IS NOT NULL ORDER BY i.id LIMIT 1`,
    [T],
  );
  return { modelo, cat, tentativa, av, etq, item: it.id, variante: it.v };
}
const SQL_MINI = `INSERT INTO public.modelo_peca_teste_mini (tentativa_id, tenant_id, modelo_id, tamanho) VALUES ($1, $2, $3, $4)`;
const SQL_LINHA = `INSERT INTO public.modelo_peca_teste_mini_linhas (tenant_id, tentativa_id, chave, familia, a_enviar) VALUES ($1, $2, $3, $4, $5) RETURNING id`;
const SQL_EPB = `INSERT INTO public.estoque_peca_teste_baixas
  (tenant_id, tentativa_id, modelo_id, familia, aviamento_id, etiqueta_id, tamanho, origem, quantidade, rotulo)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'M R11 . tentativa 1') RETURNING id`;
function epbAvi(s: Cenario, origem = "peca_teste", qtd = 2): unknown[] {
  return [T, s.tentativa, s.modelo, "aviamento", s.av, null, null, origem, qtd];
}
function epbIns(s: Cenario, origem = "peca_teste", qtd = 3): unknown[] {
  return [T, s.tentativa, s.modelo, "insumo", null, s.etq, "40|M", origem, qtd];
}
const SQL_ETB = `INSERT INTO public.estoque_tecido_baixas
  (tenant_id, variante_tecido_id, oc_tecido_item_id, quantidade, origem, peca_teste_tentativa_id, cad_id, rolo_id, motivo)
  VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 'M R11 . tentativa 1') RETURNING id`;
function etb(s: Cenario, origem: string, qtd: number, cad: string | null = null): unknown[] {
  return [T, s.variante, s.item, qtd, origem, origem.startsWith("peca_teste") ? s.tentativa : null, cad];
}

describe("urg R11a/R11b — contrato", () => {
  it("bloco r11a (gerado por mig/gerar-d.mjs) e r11b (à mão, URGD_ESTADO) em urgd-dados.ts", () => {
    expect(A, "bloco r11a em urgd-dados.ts").toBeDefined();
    expect(A!.URGD_SENTINELA).toBe(IMUTAVEL);
    expect(Object.keys(A!.URGD_NOVAS ?? {})).toEqual([IMUTAVEL]);
    expect(Object.keys(A!.URGD_NEUTRAS ?? {})).toEqual([IMUTAVEL]);
    expect(A!.URGD_TABELAS).toEqual([MINI, LINHAS, EPB]);
    expect(A!.URGD_GATILHOS).toHaveLength(7);
    expect(A!.URGD_GATILHOS!.every((g) => g.antes === null)).toBe(true);
    // nomes da fila FORA do prefixo trg_kanban_fila_% (o inverso da kanban-auto 3 conta 44)
    expect(A!.URGD_GATILHOS!.filter((g) => g.nome.startsWith("trg_kanban_fila_"))).toEqual([]);
    expect(A!.URGD_DROP_GUC).toBe("app.confirmo_apagar_baixas_peca_teste");
    expect(B, "bloco r11b em urgd-dados.ts").toBeDefined();
    expect(B!.URGD_ESTADO?.downNoop).toBe(true);
    expect(B!.URGD_COLUNAS).toEqual(["public.estoque_tecido_baixas.peca_teste_tentativa_id"]);
  });
});

describe.skipIf(!RODA)("urg R11a/R11b — mini explosão: tabelas + ledgers (199000/199100)", () => {
  it("1) estrutura: colunas, CHECKs, FKs (ações), índices, RLS sem policy, ACL sem anon/authenticated, fora do Realtime, gatilhos", async () => {
    await withTx(async (c) => {
      await aplicaUrgd(c, "r11b");
      expect(await urgdViva(c, "r11a")).toBe(true);
      expect(await urgdViva(c, "r11b")).toBe(true);
      for (const rel of [MINI, LINHAS, EPB]) {
        const nome = rel.replace("public.", "");
        const tb = await um<{ rls: boolean; acl: string; pol: number; rt: boolean }>(
          c,
          `SELECT c.relrowsecurity AS rls, c.relacl::text AS acl, (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS pol,
                  EXISTS (SELECT 1 FROM pg_publication_tables pt WHERE pt.pubname = 'supabase_realtime' AND pt.schemaname = 'public'
                            AND pt.tablename = $2) AS rt
             FROM pg_class c WHERE c.oid = to_regclass($1)`,
          [rel, nome],
        );
        expect(tb, rel).toEqual({ rls: true, acl: ACL_TAB, pol: 0, rt: false });
        for (const papel of ["anon", "authenticated"]) {
          const p = await um<{ ok: boolean }>(c, "SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS ok", [
            papel,
            rel,
          ]);
          expect(p.ok, `${papel} ${rel}`).toBe(false);
        }
        // toda tabela nova tem tenant_id NOT NULL (o laço dinâmico do _wipe_tenant_core apaga por tenant_id)
        expect(await n(c, `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1
                              AND column_name = 'tenant_id' AND is_nullable = 'NO'`, [nome]), rel).toBe(1);
      }
      // FKs e ações (a = NO ACTION, c = CASCADE, n = SET NULL)
      const fks = (
        await c.query(
          `SELECT k.conrelid::regclass::text AS t, a.attname AS col, k.confrelid::regclass::text AS ref, k.confdeltype AS del
             FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
            WHERE k.contype = 'f' AND k.conrelid IN (to_regclass($1), to_regclass($2), to_regclass($3)) ORDER BY 1, 2`,
          [MINI, LINHAS, EPB],
        )
      ).rows.map((r) => `${r.t}.${r.col}>${r.ref}:${r.del}`);
      expect(fks).toEqual(
        [
          "estoque_peca_teste_baixas.aviamento_id>aviamentos:a",
          "estoque_peca_teste_baixas.cor_id>cores:a",
          "estoque_peca_teste_baixas.etiqueta_id>etiquetas:a",
          "estoque_peca_teste_baixas.tenant_id>tenants:a",
          "estoque_peca_teste_baixas.tentativa_id>modelo_peca_teste_tentativas:n",
          "estoque_peca_teste_baixas.variante_aviamento_id>variantes_aviamento:a",
          "modelo_peca_teste_mini.modelo_id>modelos:c",
          "modelo_peca_teste_mini.tenant_id>tenants:a",
          "modelo_peca_teste_mini.tentativa_id>modelo_peca_teste_tentativas:c",
          "modelo_peca_teste_mini.variante_tecido_id>variantes_tecido:n",
          "modelo_peca_teste_mini_linhas.oc_tecido_item_id>ocs_tecido_itens:n",
          "modelo_peca_teste_mini_linhas.tenant_id>tenants:a",
          "modelo_peca_teste_mini_linhas.tentativa_id>modelo_peca_teste_mini:c",
          "modelo_peca_teste_mini_linhas.variante_aviamento_id>variantes_aviamento:n",
        ].sort(),
      );
      expect(await constraint(c, EPB, "epb_sinal")).toMatch(/peca_teste.*quantidade > .*peca_teste_estorno.*quantidade < /);
      expect(await constraint(c, EPB, "epb_forma")).toMatch(/familia = 'aviamento'.*familia = 'insumo'/);
      expect(await constraint(c, LINHAS, "mptml_chave_ux")).toBe("UNIQUE (tentativa_id, chave)");
      const idx = (
        await c.query(
          `SELECT i.indexrelid::regclass::text AS n FROM pg_index i WHERE i.indrelid IN (to_regclass($1), to_regclass($2), to_regclass($3))
            ORDER BY 1`,
          [MINI, LINHAS, EPB],
        )
      ).rows.map((r) => r.n);
      expect(idx).toEqual(
        [
          "epb_aviamento_idx", "epb_etiqueta_idx", "epb_tenant_familia_idx", "epb_tentativa_idx", "estoque_peca_teste_baixas_pkey",
          "modelo_peca_teste_mini_linhas_pkey", "modelo_peca_teste_mini_pkey", "mptm_modelo_idx", "mptm_tenant_idx", "mptml_chave_ux",
          "mptml_tenant_idx",
        ].sort(),
      );
      // gatilhos: md5 do pg_get_triggerdef gerado, habilitados
      for (const g of A!.URGD_GATILHOS!) expect(await md5Gat(c, g.tabela, g.nome), g.nome).toBe(g.depois);
      // função de imutabilidade: DEFINER, search_path, ACL só postgres/service_role (REVOKE dos 3)
      const f = await um<{ sd: boolean; cfg: string; acl: string; a: boolean; u: boolean }>(
        c,
        `SELECT p.prosecdef AS sd, array_to_string(p.proconfig, '|') AS cfg, p.proacl::text AS acl,
                has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u
           FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
        [IMUTAVEL],
      );
      expect(f).toEqual({ sd: true, cfg: "search_path=public", acl: ACL_CORE, a: false, u: false });
      expect(await md5Fn(c, IMUTAVEL)).toBe(A!.URGD_NOVAS![IMUTAVEL]);
      // 199100: coluna + FK SET NULL + os 2 CHECKs + índice parcial; ACL do ledger do tecido intacta
      expect(await temColunaEtb(c)).toBe(true);
      expect(await constraint(c, ETB, "estoque_tecido_baixas_origem_check")).toBe(ORI_DEPOIS);
      expect(await constraint(c, ETB, "etb_peca_teste_forma")).toMatch(/cad_id IS NULL\) AND \(rolo_id IS NULL/);
      expect(
        await n(c, `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = to_regclass($1) AND contype = 'f' AND confdeltype = 'n'
                      AND confrelid = 'public.modelo_peca_teste_tentativas'::regclass`, [ETB]),
      ).toBe(1);
      expect((await um<{ d: string }>(c, "SELECT pg_get_indexdef('public.etb_peca_teste_idx'::regclass) AS d")).d).toMatch(
        /\(peca_teste_tentativa_id\) WHERE \(peca_teste_tentativa_id IS NOT NULL\)/,
      );
      expect((await um<{ a: string }>(c, "SELECT relacl::text AS a FROM pg_class WHERE oid = to_regclass($1)", [ETB])).a).toBe(
        "{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}",
      );
    });
  });

  it("2) authenticated/anon NÃO leem nem gravam as 3 tabelas direto (42501): escrita só pelas RPCs", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const tentativas: [string, string, unknown[]][] = [
        [MINI, SQL_MINI, [s.tentativa, T, s.modelo, "40|M"]],
        [EPB, SQL_EPB, epbAvi(s)],
      ];
      for (const papel of ["authenticated", "anon"]) {
        for (const [rel, sql, params] of tentativas) {
          await c.query("SAVEPOINT r11_papel");
          await c.query(`SET LOCAL ROLE ${papel}`);
          let e: { code?: string } | null = null;
          try {
            await c.query(sql, params);
          } catch (x) {
            e = x as { code?: string };
          }
          await c.query("ROLLBACK TO SAVEPOINT r11_papel");
          expect(e?.code, `${papel} INSERT ${rel}`).toBe("42501");
        }
        for (const rel of [MINI, LINHAS, EPB]) {
          await c.query("SAVEPOINT r11_papel");
          await c.query(`SET LOCAL ROLE ${papel}`);
          let e: { code?: string } | null = null;
          try {
            await c.query(`SELECT count(*) FROM ${rel}`);
          } catch (x) {
            e = x as { code?: string };
          }
          await c.query("ROLLBACK TO SAVEPOINT r11_papel");
          expect(e?.code, `${papel} SELECT ${rel}`).toBe("42501");
        }
      }
      expect((await um<{ r: string }>(c, "SELECT current_user AS r")).r).toBe("postgres");
    });
  });

  it("3) CHECKs do ledger novo: sinal × origem e forma × família (23514); linhas da mini: família/faixas/unidade/chave única", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await c.query(SQL_EPB, epbAvi(s)); // baixa de aviamento, > 0
      await c.query(SQL_EPB, epbAvi(s, "peca_teste_estorno", -2)); // estorno < 0
      await c.query(SQL_EPB, epbIns(s)); // baixa de insumo com tamanho
      for (const [rot, p] of [
        ["baixa negativa", epbAvi(s, "peca_teste", -1)],
        ["baixa zero", epbAvi(s, "peca_teste", 0)],
        ["estorno positivo", epbAvi(s, "peca_teste_estorno", 1)],
        ["origem fora da lista", epbAvi(s, "ajuste", 1)],
        ["aviamento com etiqueta", [T, s.tentativa, s.modelo, "aviamento", s.av, s.etq, null, "peca_teste", 1]],
        ["aviamento com tamanho", [T, s.tentativa, s.modelo, "aviamento", s.av, null, "40|M", "peca_teste", 1]],
        ["aviamento sem aviamento", [T, s.tentativa, s.modelo, "aviamento", null, null, null, "peca_teste", 1]],
        ["insumo sem etiqueta", [T, s.tentativa, s.modelo, "insumo", null, null, null, "peca_teste", 1]],
        ["insumo com aviamento", [T, s.tentativa, s.modelo, "insumo", s.av, s.etq, null, "peca_teste", 1]],
        ["familia tecido", [T, s.tentativa, s.modelo, "tecido", s.av, null, null, "peca_teste", 1]],
      ] as [string, unknown[]][]) {
        expect((await falha(c, SQL_EPB, p)).code, rot).toBe("23514");
      }
      await c.query(SQL_MINI, [s.tentativa, T, s.modelo, "40|M"]);
      await c.query(SQL_LINHA, [T, s.tentativa, "a:x:1", "aviamento", 2]);
      expect((await falha(c, SQL_LINHA, [T, s.tentativa, "a:x:1", "aviamento", 1])).code, "chave repetida").toBe("23505");
      expect((await falha(c, SQL_LINHA, [T, s.tentativa, "t:1", "forro", 1])).code, "familia").toBe("23514");
      expect((await falha(c, SQL_LINHA, [T, s.tentativa, "t:2", "tecido", 100000])).code, "a_enviar > 99999").toBe("23514");
      expect((await falha(c, SQL_LINHA, [T, s.tentativa, "t:3", "tecido", -1])).code, "a_enviar < 0").toBe("23514");
      expect(
        (await falha(c, `UPDATE ${LINHAS} SET b_unidade = 'kg' WHERE tentativa_id = $1`, [s.tentativa])).code,
        "b_unidade",
      ).toBe("23514");
      expect((await falha(c, `UPDATE ${LINHAS} SET loss_percent = 101 WHERE tentativa_id = $1`, [s.tentativa])).code, "loss").toBe("23514");
      // linha sem cabeçalho = FK (só existe mini com dado)
      expect((await falha(c, SQL_LINHA, [T, s.modelo, "a:y:1", "aviamento", 1])).code, "linha sem mini").toBe("23503");
    });
  });

  it("4) ledger do tecido: peca_teste com cad_id / negativo e estorno positivo → 23514; origens antigas intactas; o corte não apaga a peça teste", async () => {
    await withTx(async (c) => {
      const cad = await um<{ id: string; modelo_id: string }>(
        c,
        "SELECT id, modelo_id FROM public.cad WHERE tenant_id = $1 AND modelo_id IS NOT NULL ORDER BY id LIMIT 1",
        [T],
      );
      const s = await cenario(c, cad.modelo_id);
      await c.query(SQL_ETB, etb(s, "peca_teste", 1.25));
      await c.query(SQL_ETB, etb(s, "peca_teste_estorno", -1.25));
      expect((await falha(c, SQL_ETB, etb(s, "peca_teste", 1, cad.id))).code, "peca_teste com cad_id").toBe("23514");
      expect((await falha(c, SQL_ETB, etb(s, "peca_teste", -1))).code, "peca_teste negativo").toBe("23514");
      expect((await falha(c, SQL_ETB, etb(s, "peca_teste", 0))).code, "peca_teste zero").toBe("23514");
      expect((await falha(c, SQL_ETB, etb(s, "peca_teste_estorno", 1))).code, "estorno positivo").toBe("23514");
      expect(
        (await falha(c, `INSERT INTO ${ETB} (tenant_id, variante_tecido_id, oc_tecido_item_id, quantidade, origem, rolo_id)
                          VALUES ($1, $2, $3, 1, 'peca_teste', (SELECT id FROM public.ocs_tecido WHERE tenant_id = $1 LIMIT 1))`,
          [T, s.variante, s.item])).code,
        "peca_teste com rolo_id",
      ).toBe("23514");
      expect((await falha(c, SQL_ETB, etb(s, "corte", 1))).code, "origem fora da lista").toBe("23514");
      // origens antigas seguem valendo (sem regra de sinal nova para elas)
      for (const o of ["vinculo", "fifo", "ajuste"]) await c.query(SQL_ETB, etb(s, o, 0.5, o === "ajuste" ? null : cad.id));
      // o reenvio ao corte faz DELETE ... WHERE cad_id = _cad_id: a linha de peça teste (cad_id NULL) do MESMO modelo fica
      const antes = await n(c, `SELECT count(*)::int AS n FROM ${ETB} WHERE peca_teste_tentativa_id = $1`, [s.tentativa]);
      expect(antes).toBe(2);
      await c.query("SELECT public._baixar_estoque_tecido_corte_core($1)", [cad.id]);
      expect(await n(c, `SELECT count(*)::int AS n FROM ${ETB} WHERE peca_teste_tentativa_id = $1`, [s.tentativa])).toBe(2);
      expect(await n(c, `SELECT count(*)::int AS n FROM ${ETB} WHERE cad_id = $1 AND origem IN ('vinculo', 'fifo') AND quantidade = 0.5`, [cad.id]))
        .toBe(0); // as do corte (cad_id) foram refeitas
    });
  });

  it("5) cascatas: apagar o modelo leva mini e linhas; tentativa_id vira NULL nos 2 ledgers e as baixas FICAM; item com baixa não se apaga (23503)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await c.query(SQL_MINI, [s.tentativa, T, s.modelo, "40|M"]);
      await c.query(SQL_LINHA, [T, s.tentativa, "a:x:1", "aviamento", 2]);
      const e1 = (await um<{ id: string }>(c, SQL_EPB, epbAvi(s))).id;
      const e2 = (await um<{ id: string }>(c, SQL_EPB, epbIns(s))).id;
      const t1 = (await um<{ id: string }>(c, SQL_ETB, etb(s, "peca_teste", 0.8))).id;
      // aviamento/insumo com baixa de peça teste não se apaga (NO ACTION)
      expect((await falha(c, "DELETE FROM public.aviamentos WHERE id = $1", [s.av])).code).toBe("23503");
      expect((await falha(c, "DELETE FROM public.etiquetas WHERE id = $1", [s.etq])).code).toBe("23503");
      await c.query("DELETE FROM public.modelos WHERE id = $1", [s.modelo]);
      expect(await n(c, `SELECT count(*)::int AS n FROM ${MINI} WHERE tentativa_id = $1`, [s.tentativa])).toBe(0);
      expect(await n(c, `SELECT count(*)::int AS n FROM ${LINHAS} WHERE tentativa_id = $1`, [s.tentativa])).toBe(0);
      const epb = (await c.query(`SELECT id, tentativa_id, modelo_id FROM ${EPB} WHERE id = ANY($1) ORDER BY id`, [[e1, e2]])).rows;
      expect(epb).toHaveLength(2);
      for (const r of epb) expect(r).toMatchObject({ tentativa_id: null, modelo_id: s.modelo }); // foto do card fica
      const tb = await um<{ t: string | null; o: string }>(c, `SELECT peca_teste_tentativa_id AS t, origem AS o FROM ${ETB} WHERE id = $1`, [t1]);
      expect(tb).toEqual({ t: null, o: "peca_teste" });
    });
  });

  it("6) imutável: UPDATE de quantidade/rótulo → P0001; DELETE sem a GUC → P0001; com a GUC passa; o SET NULL da FK passa", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const e1 = (await um<{ id: string }>(c, SQL_EPB, epbAvi(s))).id;
      const e2 = (await um<{ id: string }>(c, SQL_EPB, epbIns(s))).id;
      for (const set of ["quantidade = 5", "rotulo = 'outro'", "origem = 'peca_teste_estorno', quantidade = -2", "tentativa_id = tentativa_id"]) {
        const e = await falha(c, `UPDATE ${EPB} SET ${set} WHERE id = $1`, [e1]);
        expect(e.code, set).toBe("P0001");
        expect(e.message).toMatch(/^peca_teste_mini_baixa_imutavel: /);
      }
      // apagar a tentativa: a FK SET NULL é a ÚNICA mudança → passa
      await c.query("DELETE FROM public.modelo_peca_teste_tentativas WHERE id = $1", [s.tentativa]);
      expect(await n(c, `SELECT count(*)::int AS n FROM ${EPB} WHERE id = ANY($1) AND tentativa_id IS NULL`, [[e1, e2]])).toBe(2);
      // depois de NULL, voltar a apontar = mudança proibida
      expect((await falha(c, `UPDATE ${EPB} SET tentativa_id = $2 WHERE id = $1`, [e1, s.tentativa])).code).toBe("P0001");
      const d = await falha(c, `DELETE FROM ${EPB} WHERE id = $1`, [e1]);
      expect(d.code).toBe("P0001");
      expect(d.message).toMatch(/nao se apaga/);
      await c.query("SET LOCAL app.confirmo_apagar_baixas_peca_teste = 'sim'");
      await c.query(`DELETE FROM ${EPB} WHERE id = $1`, [e1]);
      await c.query("SET LOCAL app.confirmo_apagar_baixas_peca_teste = ''");
      expect(await n(c, `SELECT count(*)::int AS n FROM ${EPB} WHERE id = ANY($1)`, [[e1, e2]])).toBe(1);
    });
  });

  it("7) fila do kanban automático: INSERT/UPDATE/DELETE do cabeçalho enfileira o modelo; com app.kanban_sistema não", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await chave(c, true);
      await limpaFila(c);
      await c.query(SQL_MINI, [s.tentativa, T, s.modelo, "40|M"]);
      expect(await naFila(c, s.modelo), "INSERT").toBe(true);
      await limpaFila(c);
      await c.query(`UPDATE ${MINI} SET mesma_oc = false WHERE tentativa_id = $1`, [s.tentativa]);
      expect(await naFila(c, s.modelo), "UPDATE").toBe(true);
      await limpaFila(c);
      await c.query(`DELETE FROM ${MINI} WHERE tentativa_id = $1`, [s.tentativa]);
      expect(await naFila(c, s.modelo), "DELETE").toBe(true);
      await limpaFila(c);
      await c.query("SET LOCAL app.kanban_sistema = 'x'");
      await c.query(SQL_MINI, [s.tentativa, T, s.modelo, "40|M"]);
      await c.query(`UPDATE ${MINI} SET tamanho = '42|G' WHERE tentativa_id = $1`, [s.tentativa]);
      expect(await naFila(c, s.modelo), "com app.kanban_sistema").toBe(false);
      await c.query("SET LOCAL app.kanban_sistema = ''");
      // linhas e ledger NÃO enfileiram (só o cabeçalho tem fila)
      await limpaFila(c);
      await c.query(SQL_LINHA, [T, s.tentativa, "a:x:1", "aviamento", 2]);
      await c.query(SQL_EPB, epbAvi(s));
      expect(await naFila(c, s.modelo), "linhas/ledger").toBe(false);
    });
  });

  it("8) reset/excluir loja: o _wipe_tenant_core (replica) apaga as 3 tabelas da loja sem morder a imutabilidade", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await c.query(SQL_MINI, [s.tentativa, T, s.modelo, "40|M"]);
      await c.query(SQL_LINHA, [T, s.tentativa, "a:x:1", "aviamento", 2]);
      await c.query(SQL_EPB, epbAvi(s));
      await c.query(SQL_ETB, etb(s, "peca_teste", 0.8));
      const outra = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [T])).id;
      await emSavepoint(c, async () => {
        await c.query("SELECT public._wipe_tenant_core($1, false)", [T]);
        for (const rel of [MINI, LINHAS, EPB, ETB]) {
          expect(await n(c, `SELECT count(*)::int AS n FROM ${rel} WHERE tenant_id = $1`, [T]), rel).toBe(0);
        }
      });
      // a loja inteira ficou de volta (savepoint) e a outra loja não foi tocada
      expect(await n(c, `SELECT count(*)::int AS n FROM ${EPB} WHERE tenant_id = $1`, [T])).toBeGreaterThan(0);
      expect(outra).not.toBe(T);
    });
  });

  it("10) volta: _down 2× (função no neutro, tabelas/gatilhos/coluna ficam); ida 2× mesmos md5; _down_drop da 199100 e da 199000", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const e1 = (await um<{ id: string }>(c, SQL_EPB, epbAvi(s))).id;
      await voltaUrgd(c);
      expect(await urgdViva(c, "r11a")).toBe(false);
      expect(await urgdViva(c, "r11b")).toBe(true); // _down no-op documentado
      const conferVolta = async () => {
        expect(await md5Fn(c, IMUTAVEL)).toBe(A!.URGD_NEUTRAS![IMUTAVEL]);
        expect((await um<{ acl: string }>(c, "SELECT proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure($1)", [IMUTAVEL])).acl).toBe(
          ACL_CORE,
        );
        for (const rel of [MINI, LINHAS, EPB]) expect(await existe(c, rel), rel).toBe(true);
        for (const g of A!.URGD_GATILHOS!) expect(await md5Gat(c, g.tabela, g.nome), g.nome).toBe(g.depois);
        expect(await temColunaEtb(c)).toBe(true);
        expect(await constraint(c, ETB, "estoque_tecido_baixas_origem_check")).toBe(ORI_DEPOIS);
      };
      await conferVolta();
      // neutra: o ledger não trava mais (só postgres/service_role escrevem)
      await emSavepoint(c, async () => {
        await c.query(`UPDATE ${EPB} SET rotulo = 'x' WHERE id = $1`, [e1]);
      });
      await aplicarArquivo(c, A!.down); // 2× = no-op
      await aplicarArquivo(c, B!.down);
      await aplicarArquivo(c, B!.down);
      await conferVolta();
      // ida 2×: mesmos md5
      for (let i = 0; i < 2; i++) {
        await aplicarArquivo(c, A!.mig);
        await aplicarArquivo(c, B!.mig);
        expect(await urgdViva(c, "r11a")).toBe(true);
        expect(await md5Fn(c, IMUTAVEL)).toBe(A!.URGD_NOVAS![IMUTAVEL]);
        for (const g of A!.URGD_GATILHOS!) expect(await md5Gat(c, g.tabela, g.nome), g.nome).toBe(g.depois);
      }
      await c.query("SET LOCAL transaction_timeout = 0");
      expect((await falha(c, `UPDATE ${EPB} SET rotulo = 'x' WHERE id = $1`, [e1])).code).toBe("P0001"); // voltou a morder
      // _down_drop da 199100: RECUSA com linha de peça teste no ledger do tecido; sem ela devolve o CHECK antigo e tira a coluna
      const t1 = (await um<{ id: string }>(c, SQL_ETB, etb(s, "peca_teste", 0.8))).id;
      expect((await falha(c, readSemTxn(B!.drop!))).message).toMatch(/urg_r11b_down_drop: 1 linha\(s\) de peca teste/);
      await c.query(`DELETE FROM ${ETB} WHERE id = $1`, [t1]);
      // função citando a coluna nova (199200/199300 vivas) → recusa
      await c.query("CREATE FUNCTION public._r11_teste_cita() RETURNS int LANGUAGE sql AS $$ SELECT count(*)::int FROM public.estoque_tecido_baixas WHERE peca_teste_tentativa_id IS NULL $$");
      expect((await falha(c, readSemTxn(B!.drop!))).message).toMatch(/_r11_teste_cita/);
      await c.query("DROP FUNCTION public._r11_teste_cita()");
      await aplicarArquivo(c, B!.drop!);
      expect(await temColunaEtb(c)).toBe(false);
      expect(await constraint(c, ETB, "estoque_tecido_baixas_origem_check")).toBe(ORI_ANTES);
      expect(await constraint(c, ETB, "etb_peca_teste_forma")).toBeNull();
      expect(await existe(c, "public.etb_peca_teste_idx")).toBe(false);
      expect(await urgdViva(c, "r11b")).toBe(false);
      await aplicarArquivo(c, B!.drop!); // 2× = no-op
      // _down_drop da 199000: RECUSA sem a GUC e com a ida viva; com o _down rodado e a GUC, copia tudo p/ o backup e apaga
      await c.query("SET LOCAL app.confirmo_apagar_baixas_peca_teste = 'sim'");
      expect((await falha(c, readSemTxn(A!.drop!))).message).toMatch(/_down antes/);
      await aplicarArquivo(c, A!.down);
      await c.query("SET LOCAL app.confirmo_apagar_baixas_peca_teste = ''");
      expect((await falha(c, readSemTxn(A!.drop!))).message).toMatch(/confirmo_apagar_baixas_peca_teste/);
      await c.query("SET LOCAL app.confirmo_apagar_baixas_peca_teste = 'sim'");
      await c.query("CREATE FUNCTION public._r11_teste_cita2() RETURNS int LANGUAGE sql AS $$ SELECT count(*)::int FROM public.modelo_peca_teste_mini $$");
      expect((await falha(c, readSemTxn(A!.drop!))).message).toMatch(/_r11_teste_cita2/);
      await c.query("DROP FUNCTION public._r11_teste_cita2()");
      const nTab = await n(c, `SELECT ((SELECT count(*) FROM ${MINI}) + (SELECT count(*) FROM ${LINHAS}) + (SELECT count(*) FROM ${EPB}))::int AS n`);
      const antesBkp = (await existe(c, "public._bkp_r11_mini_drop")) ? await n(c, "SELECT count(*)::int AS n FROM public._bkp_r11_mini_drop") : 0;
      await aplicarArquivo(c, A!.drop!);
      for (const rel of [MINI, LINHAS, EPB]) expect(await existe(c, rel), rel).toBe(false);
      expect(await md5Fn(c, IMUTAVEL)).toBeNull();
      const bk = await um<{ n: number; rls: boolean; a: boolean; u: boolean }>(
        c,
        `SELECT (SELECT count(*)::int FROM public._bkp_r11_mini_drop) AS n,
                (SELECT relrowsecurity FROM pg_class WHERE oid = 'public._bkp_r11_mini_drop'::regclass) AS rls,
                has_table_privilege('anon', 'public._bkp_r11_mini_drop', 'SELECT') AS a,
                has_table_privilege('authenticated', 'public._bkp_r11_mini_drop', 'SELECT') AS u`,
      );
      expect(bk).toEqual({ n: antesBkp + nTab, rls: true, a: false, u: false });
      await aplicarArquivo(c, A!.drop!); // 2× = no-op
      // ida de novo recria tudo (vazio)
      await aplicaUrgd(c, "r11b");
      expect(await urgdViva(c, "r11a")).toBe(true);
      expect(await urgdViva(c, "r11b")).toBe(true);
      expect(await n(c, `SELECT count(*)::int AS n FROM ${EPB}`)).toBe(0);
    });
  });

  it("11) cadeia LIFO: voltaUrgcSePreciso tira a R11 primeiro; dropUrgcSePreciso roda os _down_drop da R11 antes dos da R9", async () => {
    await withTx(async (c) => {
      await aplicaUrgd(c, "r11b");
      const { voltaUrgcSePreciso, dropUrgcSePreciso, urgcViva, aplicaUrgc } = await import("./urgc-helpers");
      await voltaUrgcSePreciso(c);
      expect(await urgdViva(c, "r11a")).toBe(false);
      expect(await urgcViva(c, "r9a")).toBe(false);
      await aplicaUrgc(c);
      await aplicaUrgd(c);
      expect(await urgdViva(c, "r11a")).toBe(true);
      await dropUrgcSePreciso(c);
      for (const rel of [MINI, LINHAS, EPB, "public.modelo_peca_teste_tentativas"]) expect(await existe(c, rel), rel).toBe(false);
      expect(await temColunaEtb(c)).toBe(false);
    });
  });
});
