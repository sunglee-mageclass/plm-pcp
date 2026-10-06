// Urgentes R9a (plan-c Task 1, migration 20261103192000_urg_r9_peca_teste_base): base da Peça Teste — coluna
// categorias_terceirizado.exige_peca_teste, tabela modelo_peca_teste_tentativas (1 linha = 1 tentativa; RLS sem policy), trava de
// fornecedor na linha de M.O., fila do kanban automático e regressão do kanban manual. Txn revertida; o bloco é aplicado DENTRO da
// txn por aplicaUrgc(c, "r9a") (pula se já vivo na cópia). Só na cópia local (DDL em txn contra produção trava o app — 23/set).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, semJwt, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicaUrgc, voltaUrgc, urgcViva, URGC_BLOCOS } from "./urgc-helpers";
import { aplicarArquivo, semTransacao } from "./mig-txn";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const RODA = hasDb && ehBancoLocal();
const BLOCO = URGC_BLOCOS.r9a;
const T = TENANT_TESTE;
const TAB = "public.modelo_peca_teste_tentativas";
const TRAVA = "public.fn_peca_teste_trava_fornecedor()";
const REGREDIR = "public.fn_peca_teste_regredir()";
const GAT_ANTES = "35a23318e5e44ce6af558686b275115e"; // trg_kanban_fila_upd de categorias_terceirizado ANTES da r9a (tabela de fatos)
const ACL_CORE = "{postgres=X/postgres,service_role=X/postgres}";
const ACL_TAB = "{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}";
const HOJE = "2026-10-06";

/** Texto de um arquivo SEM o BEGIN/COMMIT (para `falha`, que roda dentro de savepoint). */
function readSemTxn(rel: string): string {
  return semTransacao(readFileSync(ROOT + rel, "utf8"), rel);
}
async function md5Fn(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}
async function md5Gat(c: Client, tabela: string, nome: string): Promise<string | null> {
  const r = await c.query(
    `SELECT md5(pg_get_triggerdef(t.oid)) AS m FROM pg_trigger t
      WHERE t.tgrelid = to_regclass($1) AND t.tgname = $2 AND NOT t.tgisinternal`,
    [tabela, nome],
  );
  return (r.rows[0]?.m as string | undefined) ?? null;
}
async function existe(c: Client, rel: string): Promise<boolean> {
  return (await um<{ ok: boolean }>(c, "SELECT to_regclass($1) IS NOT NULL AS ok", [rel])).ok;
}
async function temColuna(c: Client): Promise<boolean> {
  const r = await c.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'categorias_terceirizado' AND column_name = 'exige_peca_teste'`,
  );
  return (r.rowCount ?? 0) > 0;
}
async function outraLoja(c: Client): Promise<string> {
  return (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [T])).id;
}
/** Erro esperado DENTRO de um savepoint (a txn do teste segue usável). */
async function falha(c: Client, sql: string, params: unknown[] = []): Promise<{ code?: string; message: string }> {
  await c.query("SAVEPOINT r9a_falha");
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT r9a_falha");
    return e as { code?: string; message: string };
  }
  await c.query("ROLLBACK TO SAVEPOINT r9a_falha");
  throw new Error(`esperava erro e passou: ${sql}`);
}
/** Roda `fn` num savepoint e desfaz no fim (cenários alternativos no mesmo teste). */
async function emSavepoint(c: Client, fn: () => Promise<void>): Promise<void> {
  await c.query("SAVEPOINT r9a_alt");
  try {
    await fn();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT r9a_alt");
  }
}
/** Chave do kanban automático da Loja Teste pelo caminho da RPC (GUC app.kanban_chave='rpc'; sem ela o gatilho mantém o valor). */
async function chave(c: Client, ligada: boolean): Promise<void> {
  await c.query("SELECT set_config('app.kanban_chave', 'rpc', true)");
  try {
    await c.query("UPDATE public.tenant_config SET kanban_automatico = $2 WHERE tenant_id = $1", [T, ligada]);
  } finally {
    await c.query("SELECT set_config('app.kanban_chave', '', true)");
  }
}
/** Escrita de PREPARAÇÃO que não deve acionar enfileirador/guarda do kanban. */
async function comoSistema<R>(c: Client, fn: () => Promise<R>): Promise<R> {
  await c.query("SELECT set_config('app.kanban_sistema', 'teste', true)");
  try {
    return await fn();
  } finally {
    await c.query("SELECT set_config('app.kanban_sistema', '', true)");
  }
}

type Cenario = {
  modelo: string;
  catPT: string;
  catSem: string;
  forn1: string;
  forn2: string;
  fornOutra: string;
  linha: string;
};

/** Aplica o bloco, entra como o usuário da Loja Teste e cria modelo (Ordem enviada) + 2 tipos de serviço + 3 fornecedores + 1 linha de M.O. */
async function cenario(c: Client, campos: Record<string, unknown> = {}): Promise<Cenario> {
  await aplicaUrgc(c, "r9a");
  await comoUsuario(c);
  const suf = Math.random().toString(36).slice(2, 8);
  const base = await um<{ c: string | null; s: string | null }>(
    c,
    `SELECT categoria_principal_id AS c, subcategoria1_id AS s FROM public.modelos
      WHERE tenant_id = $1 AND categoria_principal_id IS NOT NULL AND subcategoria1_id IS NOT NULL ORDER BY id LIMIT 1`,
    [T],
  );
  const cols: Record<string, unknown> = {
    tenant_id: T,
    nome: `M R9a ${suf}`,
    ordem_criacao_enviada: true,
    status_desenvolvimento: "entrada",
    categoria_principal_id: base?.c ?? null,
    subcategoria1_id: base?.s ?? null,
    ...campos,
  };
  const nomes = Object.keys(cols);
  const modelo = await comoSistema(c, async () =>
    (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.modelos (${nomes.join(", ")}) VALUES (${nomes.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
        Object.values(cols),
      )
    ).id,
  );
  const cat = async (n: string, exige: boolean) =>
    (
      await um<{ id: string }>(
        c,
        `INSERT INTO public.categorias_terceirizado (tenant_id, nome, etapa, exige_peca_teste)
         VALUES ($1, $2, 'ate_costura', $3) RETURNING id`,
        [T, `Serv R9a ${n} ${suf}`, exige],
      )
    ).id;
  const emp = async (tenant: string, nome: string) =>
    semJwt(c, async () =>
      (
        await um<{ id: string }>(
          c,
          "INSERT INTO public.empresas (tenant_id, nome_fantasia, tipo) VALUES ($1, $2, 'servico') RETURNING id",
          [tenant, `${nome} ${suf}`],
        )
      ).id,
    );
  const catPT = await cat("pt", true);
  const catSem = await cat("sem", false);
  const forn1 = await emp(T, "Oficina R9a 1");
  const forn2 = await emp(T, "Oficina R9a 2");
  const fornOutra = await emp(await outraLoja(c), "Oficina Outra Loja R9a");
  const linha = (
    await um<{ id: string }>(
      c,
      `INSERT INTO public.modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, empresa_id)
       VALUES ($1, $2, $3, 10, $4) RETURNING id`,
      [T, modelo, catPT, forn1],
    )
  ).id;
  return { modelo, catPT, catSem, forn1, forn2, fornOutra, linha };
}

type Tentativa = {
  numero?: number;
  empresa_id?: string | null;
  data_saida?: string | null;
  data_entrada?: string | null;
  aprovacao?: string | null;
  mo_linha_id?: string | null;
  categoria_terceirizado_id?: string;
};
const SQL_INS = `INSERT INTO public.modelo_peca_teste_tentativas
  (tenant_id, modelo_id, mo_linha_id, categoria_terceirizado_id, numero, empresa_id, data_saida, data_entrada, aprovacao)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, rev`;
function paramsIns(s: Cenario, t: Tentativa = {}): unknown[] {
  return [
    T,
    s.modelo,
    t.mo_linha_id === undefined ? s.linha : t.mo_linha_id,
    t.categoria_terceirizado_id ?? s.catPT,
    t.numero ?? 1,
    t.empresa_id === undefined ? s.forn1 : t.empresa_id,
    t.data_saida ?? null,
    t.data_entrada ?? null,
    t.aprovacao ?? null,
  ];
}
async function tentativa(c: Client, s: Cenario, t: Tentativa = {}): Promise<{ id: string; rev: number }> {
  return um<{ id: string; rev: number }>(c, SQL_INS, paramsIns(s, t));
}
const APROVADA: Tentativa = { data_saida: "2026-10-01", data_entrada: "2026-10-03", aprovacao: "aprovado" };

async function naFila(c: Client, modelo: string): Promise<boolean> {
  return (await um<{ ok: boolean }>(c, "SELECT EXISTS (SELECT 1 FROM public.kanban_recalculo_fila WHERE modelo_id = $1) AS ok", [modelo]))
    .ok;
}
async function limpaFila(c: Client): Promise<void> {
  await c.query("DELETE FROM public.kanban_recalculo_fila WHERE tenant_id = $1", [T]);
}
async function trocaFornecedor(c: Client, linha: string, emp: string): Promise<void> {
  await c.query("UPDATE public.modelo_servico_mo SET empresa_id = $2 WHERE id = $1", [linha, emp]);
}

describe("urg R9a — contrato do gerador", () => {
  it("bloco r9a em urgc-dados.ts (gerado por mig/gerar-c.mjs)", () => {
    expect(BLOCO, "bloco r9a em urgc-dados.ts").toBeDefined();
    expect(BLOCO!.URGC_SENTINELA).toBe(TRAVA);
    expect(Object.keys(BLOCO!.URGC_NOVAS ?? {}).sort()).toEqual([REGREDIR, TRAVA].sort());
    expect(Object.keys(BLOCO!.URGC_NEUTRAS ?? {}).sort()).toEqual([REGREDIR, TRAVA].sort());
    expect(BLOCO!.URGC_GATILHOS).toHaveLength(9);
    const red = BLOCO!.URGC_GATILHOS!.filter((g) => g.antes !== null);
    expect(red).toEqual([
      { tabela: "public.categorias_terceirizado", nome: "trg_kanban_fila_upd", antes: GAT_ANTES, depois: expect.any(String) },
    ]);
    expect(BLOCO!.URGC_TABELAS).toEqual([TAB]);
    expect(BLOCO!.URGC_COLUNAS).toEqual(["public.categorias_terceirizado.exige_peca_teste"]);
    expect(BLOCO!.URGC_DROP_GUC).toBe("app.confirmo_apagar_peca_teste");
  });
});

describe.skipIf(!RODA)("urg R9a — base da Peça Teste (20261103192000)", () => {
  it("estrutura: coluna, tabela (FKs/CHECK/índices), RLS sem policy, ACL sem anon/authenticated, 9 gatilhos, 2 funções DEFINER", async () => {
    await withTx(async (c) => {
      await aplicaUrgc(c, "r9a");
      expect(await urgcViva(c, "r9a")).toBe(true);
      // coluna nova
      const col = await um<{ t: string; n: string; d: string | null }>(
        c,
        `SELECT data_type AS t, is_nullable AS n, column_default AS d FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'categorias_terceirizado' AND column_name = 'exige_peca_teste'`,
      );
      expect(col).toEqual({ t: "boolean", n: "NO", d: "false" });
      // tabela: RLS ligada, 0 policies, ACL exata, fora do Realtime
      const tb = await um<{ rls: boolean; acl: string; pol: number; rt: boolean }>(
        c,
        `SELECT c.relrowsecurity AS rls, c.relacl::text AS acl,
                (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS pol,
                EXISTS (SELECT 1 FROM pg_publication_tables pt WHERE pt.pubname = 'supabase_realtime'
                          AND pt.schemaname = 'public' AND pt.tablename = 'modelo_peca_teste_tentativas') AS rt
           FROM pg_class c WHERE c.oid = to_regclass($1)`,
        [TAB],
      );
      expect(tb).toEqual({ rls: true, acl: ACL_TAB, pol: 0, rt: false });
      for (const papel of ["anon", "authenticated"]) {
        const p = await um<{ ok: boolean }>(
          c,
          "SELECT has_table_privilege($1, $2, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS ok",
          [papel, TAB],
        );
        expect(p.ok, papel).toBe(false);
      }
      // FKs: modelo CASCADE, linha de M.O. SET NULL, tipo RESTRICT, fornecedor e loja NO ACTION
      const fks = (
        await c.query(
          `SELECT a.attname AS col, k.confrelid::regclass::text AS ref, k.confdeltype AS del
             FROM pg_constraint k JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
            WHERE k.conrelid = to_regclass($1) AND k.contype = 'f' ORDER BY a.attname`,
          [TAB],
        )
      ).rows;
      expect(fks).toEqual([
        { col: "categoria_terceirizado_id", ref: "categorias_terceirizado", del: "r" },
        { col: "empresa_id", ref: "empresas", del: "a" },
        { col: "mo_linha_id", ref: "modelo_servico_mo", del: "n" },
        { col: "modelo_id", ref: "modelos", del: "c" },
        { col: "tenant_id", ref: "tenants", del: "a" },
      ]);
      const checks = (
        await c.query(
          `SELECT pg_get_constraintdef(k.oid) AS d FROM pg_constraint k WHERE k.conrelid = to_regclass($1) AND k.contype = 'c'
            ORDER BY k.conname`,
          [TAB],
        )
      ).rows.map((r) => r.d as string);
      expect(checks.some((d) => /aprovacao IS NULL\) OR \(\(data_saida IS NOT NULL\) AND \(data_entrada IS NOT NULL\)/.test(d))).toBe(true);
      expect(checks.some((d) => /numero >= 1/.test(d))).toBe(true);
      expect(checks.some((d) => /'aprovado'::text, 'reprovado'::text/.test(d))).toBe(true);
      expect(checks.some((d) => /'card'::text, 'legado'::text/.test(d))).toBe(true);
      const idx = (
        await c.query("SELECT indexname AS n, indexdef AS d FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'modelo_peca_teste_tentativas' ORDER BY 1")
      ).rows as { n: string; d: string }[];
      expect(idx.map((i) => i.n)).toEqual([
        "modelo_peca_teste_tentativas_pkey",
        "mpt_legado_ux",
        "mpt_modelo_idx",
        "mpt_tenant_idx",
        "mpt_trilha_numero_ux",
      ]);
      expect(idx.find((i) => i.n === "mpt_trilha_numero_ux")!.d).toMatch(
        /UNIQUE INDEX .* \(mo_linha_id, categoria_terceirizado_id, numero\) WHERE \(mo_linha_id IS NOT NULL\)/,
      );
      // 9 gatilhos com o triggerdef gerado (o redefinido: md5 DEPOIS)
      for (const g of BLOCO!.URGC_GATILHOS!) expect(await md5Gat(c, g.tabela, g.nome), g.nome).toBe(g.depois);
      expect(await md5Gat(c, "public.categorias_terceirizado", "trg_kanban_fila_upd")).not.toBe(GAT_ANTES);
      // 2 funções novas: DEPOIS, DEFINER, search_path=public, ACL só postgres/service_role
      for (const [sig, m] of Object.entries(BLOCO!.URGC_NOVAS!)) {
        expect(await md5Fn(c, sig), sig).toBe(m);
        const f = await um<{ sd: boolean; cfg: string; acl: string; a: boolean; u: boolean }>(
          c,
          `SELECT p.prosecdef AS sd, array_to_string(p.proconfig, '|') AS cfg, p.proacl::text AS acl,
                  has_function_privilege('anon', p.oid, 'EXECUTE') AS a, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS u
             FROM pg_proc p WHERE p.oid = to_regprocedure($1)`,
          [sig],
        );
        expect(f, sig).toEqual({ sd: true, cfg: "search_path=public", acl: ACL_CORE, a: false, u: false });
      }
    });
  });

  it("1) authenticated/anon NÃO leem nem gravam a tabela direto (42501): escrita só pelas RPCs", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      for (const papel of ["authenticated", "anon"]) {
        await c.query("SAVEPOINT r9a_papel");
        await c.query(`SET LOCAL ROLE ${papel}`);
        await c.query("SAVEPOINT r9a_dentro");
        let e: { code?: string } | null = null;
        try {
          await c.query(SQL_INS, paramsIns(s));
        } catch (x) {
          e = x as { code?: string };
        }
        await c.query("ROLLBACK TO SAVEPOINT r9a_dentro");
        expect(e?.code, `${papel} INSERT`).toBe("42501");
        let e2: { code?: string } | null = null;
        try {
          await c.query(`SELECT count(*) FROM ${TAB}`);
        } catch (x) {
          e2 = x as { code?: string };
        }
        await c.query("ROLLBACK TO SAVEPOINT r9a_papel");
        expect(e2?.code, `${papel} SELECT`).toBe("42501");
      }
      expect((await um<{ r: string }>(c, "SELECT current_user AS r")).r).toBe("postgres");
    });
  });

  it("2) CHECK: decisão exige as 2 datas (23514); numero >= 1; aprovacao/origem fora da lista", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      expect((await falha(c, SQL_INS, paramsIns(s, { data_saida: HOJE, aprovacao: "aprovado" }))).code).toBe("23514");
      expect((await falha(c, SQL_INS, paramsIns(s, { data_entrada: HOJE, aprovacao: "reprovado" }))).code).toBe("23514");
      expect((await falha(c, SQL_INS, paramsIns(s, { numero: 0 }))).code).toBe("23514");
      expect((await falha(c, SQL_INS, paramsIns(s, { aprovacao: "talvez" }))).code).toBe("23514");
      // sem decisão, datas soltas passam; com as 2 datas a decisão passa
      await tentativa(c, s, { data_saida: HOJE });
      await tentativa(c, s, { numero: 2, ...APROVADA });
    });
  });

  it("3) UNIQUE (linha de M.O., tipo, numero) → 23505; mesma numeração em outra linha/tipo passa", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await tentativa(c, s);
      expect((await falha(c, SQL_INS, paramsIns(s))).code).toBe("23505");
      await tentativa(c, s, { categoria_terceirizado_id: s.catSem }); // outro tipo, mesma linha
      await tentativa(c, s, { mo_linha_id: null }); // sem linha (histórico de linha apagada) não entra no índice
      await tentativa(c, s, { mo_linha_id: null });
    });
  });

  it("4) apagar a linha de M.O. → tentativa fica com mo_linha_id NULL; apagar o modelo → tentativas somem (CASCADE)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const t1 = await tentativa(c, s, APROVADA);
      await c.query("DELETE FROM public.modelo_servico_mo WHERE id = $1", [s.linha]);
      const r = await um<{ l: string | null; rev: number }>(c, `SELECT mo_linha_id AS l, rev FROM ${TAB} WHERE id = $1`, [t1.id]);
      expect(r).toEqual({ l: null, rev: t1.rev + 1 });
      // a tentativa aprovada apagada pelo CASCADE do modelo passa pelo gatilho de regressão (modelo sumiu = sai cedo)
      await c.query("DELETE FROM public.modelos WHERE id = $1", [s.modelo]);
      expect((await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM ${TAB} WHERE modelo_id = $1`, [s.modelo])).n).toBe(0);
    });
  });

  it("4b) tipo de serviço com tentativa não pode ser apagado (RESTRICT, 23503)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await tentativa(c, s, { mo_linha_id: null });
      await c.query("DELETE FROM public.modelo_servico_mo WHERE id = $1", [s.linha]);
      expect((await falha(c, "DELETE FROM public.categorias_terceirizado WHERE id = $1", [s.catPT])).code).toBe("23503");
    });
  });

  it("5) fornecedor de OUTRA loja → recusado pelo enforce_empresa_tenant (INSERT e UPDATE)", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const e = await falha(c, SQL_INS, paramsIns(s, { empresa_id: s.fornOutra }));
      expect(e.message).toMatch(/Empresa de outra loja/);
      const t = await tentativa(c, s);
      const e2 = await falha(c, `UPDATE ${TAB} SET empresa_id = $2 WHERE id = $1`, [t.id, s.fornOutra]);
      expect(e2.message).toMatch(/Empresa de outra loja/);
    });
  });

  it("6) UPDATE sobe rev + 1 (trg_colab_rev); auditoria registra a tentativa", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const t = await tentativa(c, s);
      expect(t.rev).toBe(0);
      await c.query(`UPDATE ${TAB} SET data_saida = $2 WHERE id = $1`, [t.id, HOJE]);
      expect((await um<{ rev: number }>(c, `SELECT rev FROM ${TAB} WHERE id = $1`, [t.id])).rev).toBe(1);
      await c.query(`UPDATE ${TAB} SET data_entrada = $2 WHERE id = $1`, [t.id, HOJE]);
      expect((await um<{ rev: number }>(c, `SELECT rev FROM ${TAB} WHERE id = $1`, [t.id])).rev).toBe(2);
      const au = await um<{ n: number }>(
        c,
        "SELECT count(*)::int AS n FROM public.audit_log WHERE tabela = 'modelo_peca_teste_tentativas' AND registro_id = $1",
        [t.id],
      );
      expect(au.n).toBe(3); // criar + 2 editar
    });
  });

  it("7) trava de fornecedor: tentativa ATUAL aprovada + tipo exigindo → P0001; switch desligado, atual reprovada ou virtual → passa", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const t1 = await tentativa(c, s, APROVADA);
      const e = await falha(c, "UPDATE public.modelo_servico_mo SET empresa_id = $2 WHERE id = $1", [s.linha, s.forn2]);
      expect([e.code, e.message]).toEqual(["P0001", "peca_teste_fornecedor_travado: peca teste aprovada trava o fornecedor"]);
      // mesmo valor = WHEN falso (não dispara)
      await c.query("UPDATE public.modelo_servico_mo SET empresa_id = $2 WHERE id = $1", [s.linha, s.forn1]);
      // switch DESLIGADO: trilha escondida, nada travado
      await emSavepoint(c, async () => {
        await c.query("UPDATE public.categorias_terceirizado SET exige_peca_teste = false WHERE id = $1", [s.catPT]);
        await trocaFornecedor(c, s.linha, s.forn2);
      });
      // atual REPROVADA (a próxima é virtual): passa
      await emSavepoint(c, async () => {
        await c.query(`UPDATE ${TAB} SET aprovacao = 'reprovado' WHERE id = $1`, [t1.id]);
        await trocaFornecedor(c, s.linha, s.forn2);
      });
      // 1ª reprovada + 2ª aprovada: a ATUAL (maior numero) é a aprovada → trava
      await emSavepoint(c, async () => {
        await c.query(`UPDATE ${TAB} SET aprovacao = 'reprovado' WHERE id = $1`, [t1.id]);
        await tentativa(c, s, { numero: 2, ...APROVADA });
        const e3 = await falha(c, "UPDATE public.modelo_servico_mo SET empresa_id = $2 WHERE id = $1", [s.linha, s.forn2]);
        expect(e3.code).toBe("P0001");
      });
      // aprovação DESFEITA (vazio) destrava
      await emSavepoint(c, async () => {
        await c.query(`UPDATE ${TAB} SET aprovacao = NULL WHERE id = $1`, [t1.id]);
        await trocaFornecedor(c, s.linha, s.forn2);
      });
      // virtual (nenhuma tentativa na trilha): passa
      await emSavepoint(c, async () => {
        await c.query(`DELETE FROM ${TAB} WHERE id = $1`, [t1.id]);
        await trocaFornecedor(c, s.linha, s.forn2);
      });
      // tentativa aprovada de OUTRO tipo (a linha mudou de tipo = trilha nova) não trava a linha
      await emSavepoint(c, async () => {
        await c.query(`UPDATE ${TAB} SET categoria_terceirizado_id = $2 WHERE id = $1`, [t1.id, s.catSem]);
        await trocaFornecedor(c, s.linha, s.forn2);
      });
    });
  });

  it("8) fila do kanban automático: INSERT/UPDATE/DELETE de tentativa enfileira o modelo; com app.kanban_sistema não enfileira", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await chave(c, true);
      await limpaFila(c);
      const t = await tentativa(c, s);
      expect(await naFila(c, s.modelo), "INSERT").toBe(true);
      await limpaFila(c);
      await c.query(`UPDATE ${TAB} SET data_saida = $2 WHERE id = $1`, [t.id, HOJE]);
      expect(await naFila(c, s.modelo), "UPDATE").toBe(true);
      await limpaFila(c);
      await c.query(`DELETE FROM ${TAB} WHERE id = $1`, [t.id]);
      expect(await naFila(c, s.modelo), "DELETE").toBe(true);
      await limpaFila(c);
      await c.query("SET LOCAL app.kanban_sistema = 'x'");
      await tentativa(c, s, { numero: 2 });
      expect(await naFila(c, s.modelo), "com app.kanban_sistema").toBe(false);
      await c.query("SET LOCAL app.kanban_sistema = ''");
      // chave DESLIGADA: não enfileira
      await chave(c, false);
      await limpaFila(c);
      await tentativa(c, s, { numero: 3 });
      expect(await naFila(c, s.modelo), "chave desligada").toBe(false);
    });
  });

  it("9) mudar exige_peca_teste de um tipo enfileira a loja (kanban automático); mudar só valor_padrao NÃO", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await chave(c, true);
      await limpaFila(c);
      await c.query("UPDATE public.categorias_terceirizado SET exige_peca_teste = false WHERE id = $1", [s.catPT]);
      expect(await naFila(c, s.modelo)).toBe(true);
      await limpaFila(c);
      await c.query("UPDATE public.categorias_terceirizado SET valor_padrao = coalesce(valor_padrao, 0) + 1 WHERE id = $1", [s.catPT]);
      expect((await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public.kanban_recalculo_fila WHERE tenant_id = $1", [T])).n).toBe(0);
      // as 3 de antes seguem enfileirando (o WHEN só ganhou a coluna nova)
      await c.query("UPDATE public.categorias_terceirizado SET nome = nome || ' x' WHERE id = $1", [s.catPT]);
      expect(await naFila(c, s.modelo)).toBe(true);
    });
  });

  it("10) kanban MANUAL: desfazer/reprovar/apagar tentativa APROVADA regride o card (_kanban_regredir_modelo); não aprovada antes = nada", async () => {
    await withTx(async (c) => {
      const s = await cenario(c, { data_desenho_tecnico: HOJE, data_aprovacao: HOJE });
      await chave(c, false);
      await c.query(
        `UPDATE public.tenant_config
            SET status_kanban = $2::jsonb, kanban_requisitos = $3::jsonb, kanban_requisitos_excecoes = '{}'::jsonb
          WHERE tenant_id = $1`,
        [
          T,
          JSON.stringify(["Entrada", "Etapa A", "Etapa B", "Stand By", "Etapa C", "Reprovado", "Aprovado"]),
          JSON.stringify({ etapa_a: ["data_desenho_tecnico"], etapa_c: ["servico_aprovado"], aprovado: ["data_aprovacao"] }),
        ],
      );
      // a linha de M.O. do cenário está PENDENTE → servico_aprovado falha em etapa_c; o card é posto à frente (manual = a pessoa decide)
      const poe = async () =>
        c.query("UPDATE public.modelos SET status_desenvolvimento = 'aprovado', revisao_pendente = '{}'::jsonb WHERE id = $1", [s.modelo]);
      const status = async () =>
        um<{ s: string; e: boolean }>(
          c,
          "SELECT status_desenvolvimento AS s, coalesce((revisao_pendente ->> 'kanban')::boolean, false) AS e FROM public.modelos WHERE id = $1",
          [s.modelo],
        );
      await poe();
      const t = await tentativa(c, s, APROVADA);
      expect(await status()).toEqual({ s: "aprovado", e: false }); // INSERT não regride
      // desfazer (aprovado → vazio)
      await emSavepoint(c, async () => {
        await c.query(`UPDATE ${TAB} SET aprovacao = NULL WHERE id = $1`, [t.id]);
        expect(await status()).toEqual({ s: "etapa_c", e: true });
      });
      // reprovar (aprovado → reprovado)
      await emSavepoint(c, async () => {
        await c.query(`UPDATE ${TAB} SET aprovacao = 'reprovado' WHERE id = $1`, [t.id]);
        expect(await status()).toEqual({ s: "etapa_c", e: true });
      });
      // apagar a aprovada
      await emSavepoint(c, async () => {
        await c.query(`DELETE FROM ${TAB} WHERE id = $1`, [t.id]);
        expect(await status()).toEqual({ s: "etapa_c", e: true });
      });
      // mudar só a data da aprovada (aprovacao igual): nada
      await c.query(`UPDATE ${TAB} SET data_entrada = '2026-10-04' WHERE id = $1`, [t.id]);
      expect(await status()).toEqual({ s: "aprovado", e: false });
      // tentativa NÃO aprovada antes: decidir/desfazer/apagar não regride
      const t2 = await tentativa(c, s, { numero: 2, data_saida: HOJE });
      await c.query(`UPDATE ${TAB} SET data_entrada = $2, aprovacao = 'reprovado' WHERE id = $1`, [t2.id, HOJE]);
      await c.query(`UPDATE ${TAB} SET aprovacao = NULL WHERE id = $1`, [t2.id]);
      await c.query(`DELETE FROM ${TAB} WHERE id = $1`, [t2.id]);
      expect(await status()).toEqual({ s: "aprovado", e: false });
    });
  });

  it("11) volta: _down NEUTRO (gatilho volta a 35a23318, funções no texto neutro, tabela/coluna ficam); _down 2× no-op; ida 2× mesmos md5", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      const t = await tentativa(c, s, APROVADA);
      await voltaUrgc(c);
      expect(await urgcViva(c, "r9a")).toBe(false);
      const conferVolta = async () => {
        expect(await md5Gat(c, "public.categorias_terceirizado", "trg_kanban_fila_upd")).toBe(GAT_ANTES);
        for (const [sig, m] of Object.entries(BLOCO!.URGC_NEUTRAS!)) {
          expect(await md5Fn(c, sig), sig).toBe(m);
          expect((await um<{ acl: string }>(c, "SELECT proacl::text AS acl FROM pg_proc WHERE oid = to_regprocedure($1)", [sig])).acl).toBe(ACL_CORE);
        }
        expect(await existe(c, TAB)).toBe(true);
        expect(await temColuna(c)).toBe(true);
        // os gatilhos da tabela nova e a trava FICAM (inertes)
        for (const g of BLOCO!.URGC_GATILHOS!.filter((x) => x.antes === null)) expect(await md5Gat(c, g.tabela, g.nome), g.nome).toBe(g.depois);
      };
      await conferVolta();
      // inerte: a aprovada não trava mais o fornecedor; o dado ficou
      await trocaFornecedor(c, s.linha, s.forn2);
      expect((await um<{ a: string }>(c, `SELECT aprovacao AS a FROM ${TAB} WHERE id = $1`, [t.id])).a).toBe("aprovado");
      await aplicarArquivo(c, BLOCO!.down); // 2× = no-op
      await conferVolta();
      // ida 2×: mesmos md5
      for (let i = 0; i < 2; i++) {
        await aplicarArquivo(c, BLOCO!.mig);
        expect(await urgcViva(c, "r9a")).toBe(true);
        for (const [sig, m] of Object.entries(BLOCO!.URGC_NOVAS!)) expect(await md5Fn(c, sig), sig).toBe(m);
        for (const g of BLOCO!.URGC_GATILHOS!) expect(await md5Gat(c, g.tabela, g.nome), g.nome).toBe(g.depois);
      }
      await c.query("SET LOCAL transaction_timeout = 0");
      const e = await falha(c, "UPDATE public.modelo_servico_mo SET empresa_id = $2 WHERE id = $1", [s.linha, s.forn1]);
      expect(e.code).toBe("P0001"); // a trava voltou a morder
    });
  });

  it("13) cadeia LIFO: voltaCamadaSePreciso tira urgb e a R9 (a R9 primeiro); dropUrgbSePreciso roda o _down_drop da R9", async () => {
    await withTx(async (c) => {
      await aplicaUrgc(c, "r9a");
      expect(await urgcViva(c, "r9a")).toBe(true);
      const { voltaCamadaSePreciso, aplicaCamada } = await import("./camada-helpers");
      const { aplicaUrgA } = await import("./urg-a-helpers");
      const { urgbViva, URGB_MIGS, dropUrgbSePreciso, aplicaUrgb } = await import("./urgb-helpers");
      await voltaCamadaSePreciso(c);
      expect(await urgcViva(c, "r9a")).toBe(false);
      for (const { id } of URGB_MIGS) expect(await urgbViva(c, id), id).toBe(false);
      expect(await md5Gat(c, "public.categorias_terceirizado", "trg_kanban_fila_upd")).toBe(GAT_ANTES);
      // de volta (Camada -> plan-a -> plan-b -> R9) e o LIFO dos drops: o _down_drop da R9 sai antes dos do plan-b
      await aplicaCamada(c);
      await aplicaUrgA(c);
      await aplicaUrgb(c);
      await aplicaUrgc(c);
      expect(await urgcViva(c, "r9a")).toBe(true);
      await dropUrgbSePreciso(c);
      expect(await existe(c, TAB)).toBe(false);
      expect(await temColuna(c)).toBe(false);
      expect(await md5Fn(c, TRAVA)).toBeNull();
    });
  });

  it("12) _down_drop: recusa sem a GUC, recusa com a ida viva e com função citando a tabela; com tudo certo copia p/ o backup e apaga", async () => {
    await withTx(async (c) => {
      const s = await cenario(c);
      await tentativa(c, s, APROVADA);
      await tentativa(c, s, { categoria_terceirizado_id: s.catSem });
      const nTab = (await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM ${TAB}`)).n;
      // ida viva (sem o _down): recusa
      await c.query("SET LOCAL app.confirmo_apagar_peca_teste = 'sim'");
      expect((await falha(c, readSemTxn(BLOCO!.drop))).message).toMatch(/_down antes/);
      await voltaUrgc(c);
      await c.query("SET LOCAL app.confirmo_apagar_peca_teste = ''");
      expect((await falha(c, readSemTxn(BLOCO!.drop))).message).toMatch(/confirmo_apagar_peca_teste/);
      await c.query("SET LOCAL app.confirmo_apagar_peca_teste = 'sim'");
      // uma função de public (fora as 2 de gatilho) que cite a tabela = 193000/194000 vivas → recusa
      await c.query(
        "CREATE FUNCTION public._r9a_teste_cita() RETURNS int LANGUAGE sql AS $$ SELECT count(*)::int FROM public.modelo_peca_teste_tentativas $$",
      );
      expect((await falha(c, readSemTxn(BLOCO!.drop))).message).toMatch(/_r9a_teste_cita/);
      await c.query("DROP FUNCTION public._r9a_teste_cita()");
      const antesBkp = (await existe(c, "public._bkp_r9_tentativas_drop"))
        ? (await um<{ n: number }>(c, "SELECT count(*)::int AS n FROM public._bkp_r9_tentativas_drop")).n
        : 0;
      await aplicarArquivo(c, BLOCO!.drop);
      expect(await existe(c, TAB)).toBe(false);
      expect(await temColuna(c)).toBe(false);
      for (const sig of Object.keys(BLOCO!.URGC_NOVAS!)) expect(await md5Fn(c, sig), sig).toBeNull();
      expect(await md5Gat(c, "public.modelo_servico_mo", "trg_peca_teste_trava_fornecedor")).toBeNull();
      expect(await md5Gat(c, "public.categorias_terceirizado", "trg_kanban_fila_upd")).toBe(GAT_ANTES);
      const bk = await um<{ n: number; rls: boolean; a: boolean; u: boolean }>(
        c,
        `SELECT (SELECT count(*)::int FROM public._bkp_r9_tentativas_drop) AS n,
                (SELECT relrowsecurity FROM pg_class WHERE oid = 'public._bkp_r9_tentativas_drop'::regclass) AS rls,
                has_table_privilege('anon', 'public._bkp_r9_tentativas_drop', 'SELECT') AS a,
                has_table_privilege('authenticated', 'public._bkp_r9_tentativas_drop', 'SELECT') AS u`,
      );
      expect(bk).toEqual({ n: antesBkp + nTab, rls: true, a: false, u: false });
      // drop 2× = no-op; ida de novo recria tudo (tabela vazia)
      await aplicarArquivo(c, BLOCO!.drop);
      await aplicaUrgc(c, "r9a");
      expect(await urgcViva(c, "r9a")).toBe(true);
      expect((await um<{ n: number }>(c, `SELECT count(*)::int AS n FROM ${TAB}`)).n).toBe(0);
    });
  });
});
