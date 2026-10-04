// Reforço de segurança — sub-release S6 ("OCs: recebida só volta pelo Desmarcar", P-236 = D7 A; plan.md §S6 + item S4 do §1).
// O Salvar das OCs de Tecido, Aviamento e Insumo NUNCA faz uma OC recebida voltar a encomendada: só o "Desmarcar recebimento".
// Migration aplicada DENTRO da transação de cada teste (mig-txn: sem BEGIN/COMMIT, nunca \i) e revertida no fim. SÓ na cópia local.
// As RPCs rodam DE VERDADE como o papel `authenticated` (SET LOCAL ROLE) com o JWT de 2 usuários COMUNS ("aba A" e "aba B").
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE } from "./db";
import { aplicaS6, voltaS6, s6Viva, S6_MIG } from "./seg-s6-helpers";
import { S6_MD5 } from "./seg-s6-dados";
import { aplicarArquivo } from "./mig-txn";
import { mensagemErro } from "@/lib/erro-mensagem";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;
const U_A = "5e9a0056-0000-4000-8000-0000000000a6";
const U_B = "5e9a0056-0000-4000-8000-0000000000b6";
const PREFIXO = "oc_recebida_so_desmarcar:";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

type Res = { ok: true; rows: any[] } | { ok: false; code: string; msg: string };
async function como(c: Client, uid: string, sql: string, params: any[] = []): Promise<Res> {
  await c.query("SAVEPOINT s6x");
  try {
    await c.query("SELECT set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    await c.query("SET LOCAL ROLE authenticated");
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT s6x");
    return { ok: true, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT s6x");
    await c.query("RELEASE SAVEPOINT s6x");
    return { ok: false, code: String(e.code ?? ""), msg: String(e.message ?? "") };
  }
}
async function ok(c: Client, uid: string, sql: string, params: any[] = []): Promise<any[]> {
  const r = await como(c, uid, sql, params);
  if (!r.ok) throw new Error(`esperava passar: ${sql}\n→ ${r.code} ${r.msg}`);
  return r.rows;
}
async function usuario(c: Client, uid: string, paginas: string[]): Promise<void> {
  await semJwt(c, async () => {
    await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [uid, `${uid}@teste`]);
    await c.query(
      `INSERT INTO public.users (id, tenant_id, email, nome, role) VALUES ($1, $2, $3, 'S6 comum', 'user')
       ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`, [uid, T, `${uid}@teste`]);
    await c.query(`DELETE FROM public.user_permissions WHERE user_id = $1`, [uid]);
    for (const p of paginas) {
      await c.query(`INSERT INTO public.user_permissions (user_id, tenant_id, pagina, pode_ver, pode_editar) VALUES ($1, $2, $3, true, true)`,
        [uid, T, p]);
    }
  });
}
async function prepara(c: Client): Promise<Fx> {
  await c.query("SET LOCAL statement_timeout = '180s'");
  await aplicaS6(c); // idempotente (S6_TXN=1 já aplicou: a guarda aceita o "depois")
  await semJwt(c, () => c.query(
    `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || '{"entrada_saida": true, "financeiro": true}'::jsonb
      WHERE tenant_id = $1`, [T]));
  const pags = ["entrada_oc_tecido", "entrada_oc_aviamento", "entrada_oc_insumo"];
  await usuario(c, U_A, pags);
  await usuario(c, U_B, pags);
  return fixtures(c);
}

type Fx = { emp: string; art: string; vari: string; aviId: string; aviEmp: string; etqId: string; etqVar: string | null };
async function fixtures(c: Client): Promise<Fx> {
  return semJwt(c, async () => {
    const emp = await um<{ id: string }>(c, `select id from empresas where tenant_id = $1 order by id limit 1`, [T]);
    const art = (await um<{ id: string }>(c,
      `insert into artigos (tenant_id, nome, unidade_medida, preco) values ($1, 'ITEST S6 tecido', 'metro', 10) returning id`, [T])).id;
    const vari = (await um<{ id: string }>(c,
      `insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1, $2, 'ITEST-S6 A') returning id`, [T, art])).id;
    const avi = await um<{ id: string; emp: string }>(c,
      `select id, empresa_id emp from aviamentos where tenant_id = $1 and coalesce(preco,0) > 0 and empresa_id is not null
          and (select count(*) from variantes_aviamento v where v.aviamento_id = aviamentos.id) <= 1 order by id limit 1`, [T]);
    const etq = await um<{ id: string; var: string | null }>(c,
      `select e.id, (select v.id from variantes_etiqueta v where v.etiqueta_id = e.id order by v.id limit 1) var
         from etiquetas e where e.tenant_id = $1 order by e.id limit 1`, [T]);
    if (!emp || !avi || !etq) throw new Error("Loja Teste sem fixture (empresa / aviamento com preço / insumo)");
    return { emp: emp.id, art, vari, aviId: avi.id, aviEmp: avi.emp, etqId: etq.id, etqVar: etq.var };
  });
}

/** Uma família de OC: como montar cabeçalho/itens e como ler/desmarcar. */
type Familia = {
  nome: string;
  tabela: string;
  fkParcela: string;
  nParcelas: number;
  oc: (fx: Fx, status: string) => Record<string, unknown>;
  itens: (fx: Fx, status: string, ids: (string | null)[]) => Record<string, unknown>[];
  tabelaItens: string;
  fkItem: string;
  salvar: string; // $1 id, $2 oc, $3 itens, $4 rev
  desmarcar: string; // $1 id
};
const FAMILIAS: Familia[] = [
  {
    nome: "Tecido", tabela: "ocs_tecido", fkParcela: "oc_tecido_id", nParcelas: 3, tabelaItens: "ocs_tecido_itens", fkItem: "oc_tecido_id",
    oc: (fx, status) => ({
      numero_pedido: "ITEST-S6-TEC", empresa_id: fx.emp, data_pedido: "2026-09-01", data_prevista_entrega: "2026-09-05",
      data_entrega: status === "recebido" ? "2026-09-10" : null, prazo_pagamento: "30/60/90", quantidade_prazos: 3, parcelas_recebimento: [],
      valor_previsto_total: 1000, valor_real_total: 1000, status,
    }),
    itens: (fx, status, ids) => [{
      id: ids[0] ?? null, artigo_id: fx.art, artigo_numero: 1, variante_tecido_id: fx.vari, quantidade_pedida: 100,
      quantidade_recebida: status === "recebido" ? 100 : null, rendimento: null, cancelado: false, preco: 10,
    }],
    salvar: `select public.salvar_oc_tecido($1, $2::jsonb, $3::jsonb, $4::int) as id`,
    desmarcar: `select public.desmarcar_recebimento_oc('tecido', $1)`,
  },
  {
    nome: "Aviamento", tabela: "ocs_aviamento", fkParcela: "oc_aviamento_id", nParcelas: 3, tabelaItens: "ocs_aviamento_itens",
    fkItem: "oc_aviamento_id",
    oc: (fx, status) => ({
      numero_pedido: "ITEST-S6-AVI", responsavel_nome: null, empresa_id: fx.aviEmp, representante_id: null, data_pedido: "2026-09-01",
      data_prevista_entrega: "2026-09-05", data_entrega: status === "recebido" ? "2026-09-10" : null, prazo_pagamento: "30/60/90",
      quantidade_prazos: 3, nf_url: null, parcelas_recebimento: [], status,
    }),
    itens: (fx, status, ids) => [{
      id: ids[0] ?? null, aviamento_id: fx.aviId, variante_aviamento_id: null, quantidade_pedida: 100,
      quantidade_recebida: status === "recebido" ? 100 : null, cancelado: false,
    }],
    salvar: `select public.salvar_oc_aviamento($1, $2::jsonb, $3::jsonb, $4::int) as id`,
    desmarcar: `select public.desmarcar_recebimento_oc('aviamento', $1)`,
  },
  {
    nome: "Insumo", tabela: "ocs_etiqueta", fkParcela: "oc_etiqueta_id", nParcelas: 2, tabelaItens: "ocs_etiqueta_itens", fkItem: "oc_etiqueta_id",
    oc: (fx, status) => ({
      numero_pedido: "ITEST-S6-INS", responsavel_nome: null, empresa_id: fx.emp, representante_id: null, data_pedido: "2026-09-01",
      data_prevista_entrega: "2026-09-05", data_entrega: status === "recebido" ? "2026-09-10" : null, prazo_pagamento: "30/60",
      quantidade_prazos: 2, nf_url: null, nfs: [], parcelas_recebimento: [], status,
    }),
    itens: (fx, status, ids) => [{
      id: ids[0] ?? null, etiqueta_id: fx.etqId, variante_etiqueta_id: fx.etqVar, quantidade_pedida: 100,
      quantidade_recebida: status === "recebido" ? 100 : null, preco: 2.5, cancelado: false,
    }],
    salvar: `select public.salvar_oc_etiqueta($1, $2::jsonb, $3::jsonb, $4::int) as id`,
    desmarcar: `select public.desmarcar_recebimento_oc_etiqueta($1)`,
  },
];

async function md5(c: Client, sig: string): Promise<string | null> {
  return (await um<{ m: string | null }>(c, "SELECT md5(pg_get_functiondef(to_regprocedure($1))) AS m", [sig])).m;
}

// ─────────────────────────────────────────── md5, EXECUTE, idempotência, volta, trava ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S6 — md5, EXECUTE, idempotência, volta (LIFO) e trava", () => {
  it("ida = DEPOIS; reaplicar não muda; volta = ANTES; ida de novo = DEPOIS; EXECUTE igual ao de antes", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      const confere = async (lado: "antes" | "depois") => {
        for (const [sig, m] of Object.entries(S6_MD5)) {
          expect(await md5(c, sig), `${sig} ${lado}`).toBe(m[lado]);
          const p = await um<{ anon: boolean; auth: boolean }>(c,
            `select has_function_privilege('anon', $1, 'EXECUTE') anon, has_function_privilege('authenticated', $1, 'EXECUTE') auth`, [sig]);
          expect(p.anon, sig).toBe(false);
          expect(p.auth, sig).toBe(!sig.startsWith("public._")); // _core sem EXECUTE (inv. 9); wrapper salvar_oc_etiqueta com
        }
      };
      await aplicaS6(c);
      expect(await s6Viva(c)).toBe(true);
      await confere("depois");
      await aplicarArquivo(c, S6_MIG); // idempotente
      await confere("depois");
      await voltaS6(c);
      expect(await s6Viva(c)).toBe(false);
      await confere("antes");
      await aplicaS6(c);
      await confere("depois");
    });
  });

  it("guarda: texto inesperado numa das 5 funções = a ida RECUSA (P0001) sem mudar nada", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      await aplicaS6(c);
      await voltaS6(c);
      // estraga um texto (comentário a mais) e a ida tem de recusar
      const def = (await um<{ d: string }>(c, "select pg_get_functiondef('public._salvar_oc_aviamento_core(uuid,jsonb,jsonb)'::regprocedure) d")).d;
      await c.query(def.replace("BEGIN\n", "BEGIN\n  -- outra frente\n"));
      await c.query("SAVEPOINT g");
      let erro = "";
      try {
        await aplicarArquivo(c, S6_MIG);
      } catch (e: any) {
        erro = `${e.code} ${e.message}`;
      }
      await c.query("ROLLBACK TO SAVEPOINT g");
      expect(erro).toMatch(/^P0001 s6_oc_status: public\._salvar_oc_aviamento_core\(uuid,jsonb,jsonb\) com texto inesperado/);
      expect(await md5(c, "public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)")).toBe(S6_MD5["public._salvar_oc_tecido_core(uuid,jsonb,jsonb,integer)"].antes);
    });
  });

  it("trava: a ida só toca o catálogo — nenhuma trava nova em tabela de public/auth/storage/realtime", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      await aplicaS6(c);
      await voltaS6(c); // a cadeia S3a..S5 já viva; mede só o arquivo da S6
      const travas = async () => (await c.query(
        `select n.nspname || '.' || cl.relname || ':' || l.mode t
           from pg_locks l join pg_class cl on cl.oid = l.relation join pg_namespace n on n.oid = cl.relnamespace
          where l.pid = pg_backend_pid() and l.locktype = 'relation' and n.nspname in ('public', 'auth', 'storage', 'realtime')`,
      )).rows.map((r) => r.t as string);
      const antes = new Set(await travas());
      await aplicarArquivo(c, S6_MIG);
      const novas = (await travas()).filter((t) => !antes.has(t));
      expect(novas).toEqual([]);
      // e, no texto: fora dos corpos de função, só guarda/pós-condição (DO), CREATE OR REPLACE FUNCTION e NOTIFY
      const fora = readFileSync(join(ROOT, S6_MIG), "utf8").replace(/\$function\$[\s\S]*?\$function\$/g, "")
        .replace(/\$(guarda|pos)\$[\s\S]*?\$\1\$/g, "").replace(/^--.*$/gm, "");
      expect(fora).not.toMatch(/\b(LOCK|ALTER|GRANT|REVOKE|DROP|TRIGGER|POLICY|INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    });
  });

  it("as sobrecargas de 3 argumentos (mortas: chamada ambígua) também levam a checagem", async () => {
    await withTx(async (c) => {
      await c.query("SET LOCAL statement_timeout = '180s'");
      await aplicaS6(c);
      for (const sig of ["public._salvar_oc_aviamento_core(uuid,jsonb,jsonb)", "public.salvar_oc_etiqueta(uuid,jsonb,jsonb)"]) {
        const d = (await um<{ d: string }>(c, "select pg_get_functiondef($1::regprocedure) d", [sig])).d;
        expect(d, sig).toContain("RAISE EXCEPTION 'oc_recebida_so_desmarcar: ");
        expect(d, sig).toMatch(/WHERE o\.id = v_oc_id FOR UPDATE\) = 'recebido'/);
      }
      // a wrapper de 3 args do aviamento chama o _core ambíguo: hoje sempre falha (42725) — documentado no relatório (backlog)
      const r = await c.query(`select count(*)::int n from pg_proc where oid = 'public.salvar_oc_aviamento(uuid,jsonb,jsonb)'::regprocedure`);
      expect(r.rows[0].n).toBe(1);
    });
  });
});

// ─────────────────────────────────────────── 2 abas, como `authenticated` ───────────────────────────────────────────
describe.skipIf(!RODA)("seg S6 — 2 abas: A abre encomendada, B recebe, A salva → recusa sem regredir; Desmarcar segue", () => {
  for (const f of FAMILIAS) {
    it(`OC ${f.nome}`, async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const status = async () => (await um<{ s: string; rev: number }>(c, `select status s, rev from ${f.tabela} where id = $1`, [oc])).s;
        const rev = async () => (await um<{ rev: number }>(c, `select rev from ${f.tabela} where id = $1`, [oc])).rev;
        const parcelas = async () => (await c.query(
          `select id, numero_parcela n, valor::text v, to_char(data_vencimento, 'YYYY-MM-DD') d from parcelas where ${f.fkParcela} = $1
            order by numero_parcela`, [oc])).rows;
        const itemIds = async () => (await c.query(`select id from ${f.tabelaItens} where ${f.fkItem} = $1 order by id`, [oc])).rows.map((r) => r.id);

        // A cria (encomendada) e "abre" a OC: guarda o rev e o id do item
        const oc = (await ok(c, U_A, f.salvar, [null, JSON.stringify(f.oc(fx, "encomendado")), JSON.stringify(f.itens(fx, "encomendado", [])), null]))[0].id as string;
        const revA = await rev();
        const ids = await itemIds();
        // B recebe (pela mesma RPC, com o rev atual)
        await ok(c, U_B, f.salvar, [oc, JSON.stringify(f.oc(fx, "recebido")), JSON.stringify(f.itens(fx, "recebido", ids)), revA]);
        expect(await status()).toBe("recebido");
        const parc0 = await parcelas();
        expect(parc0.length).toBe(f.nParcelas);

        // A salva com o rev velho → P0409 (merge da tela; o status passa a vir do servidor)
        const r1 = await como(c, U_A, f.salvar, [oc, JSON.stringify(f.oc(fx, "encomendado")), JSON.stringify(f.itens(fx, "encomendado", ids)), revA]);
        expect(r1.ok ? "PASSOU" : r1.code).toBe("P0409");
        // A salva de novo com o rev novo MAS o status velho (tela sem o fix) → recusa P0001 ASCII; nada muda
        const r2 = await como(c, U_A, f.salvar, [oc, JSON.stringify(f.oc(fx, "encomendado")), JSON.stringify(f.itens(fx, "encomendado", ids)), await rev()]);
        expect(r2.ok ? "PASSOU" : `${r2.code} ${r2.msg}`).toBe(
          `P0001 ${PREFIXO} OC recebida so volta a encomendada pelo Desmarcar recebimento`);
        expect(mensagemErro(r2.ok ? null : { code: r2.code, message: r2.msg }, "x")).toMatch(/^Esta OC já foi recebida .*"Desmarcar recebimento"/);
        // sem rev (_rev_base null = bypass da trava otimista; caminho das abas antigas): também recusa
        const r3 = await como(c, U_A, f.salvar, [oc, JSON.stringify(f.oc(fx, "encomendado")), JSON.stringify(f.itens(fx, "encomendado", ids)), null]);
        expect(r3.ok ? "PASSOU" : r3.code).toBe("P0001");
        // status sem "status" no payload = 'encomendado' (COALESCE) → também recusa
        const semStatus = { ...f.oc(fx, "recebido") } as Record<string, unknown>;
        delete semStatus.status;
        const r4 = await como(c, U_A, f.salvar, [oc, JSON.stringify(semStatus), JSON.stringify(f.itens(fx, "recebido", ids)), null]);
        expect(r4.ok ? "PASSOU" : r4.code).toBe("P0001");
        expect(await status()).toBe("recebido");
        expect(await parcelas()).toEqual(parc0); // parcelas intactas (mesmos ids, valores e datas)
        expect(await itemIds()).toEqual(ids);

        // A salva a OC recebida COMO recebida (o que a tela com o fix manda): passa, parcelas intactas
        await ok(c, U_A, f.salvar, [oc, JSON.stringify(f.oc(fx, "recebido")), JSON.stringify(f.itens(fx, "recebido", ids)), await rev()]);
        expect(await status()).toBe("recebido");
        expect((await parcelas()).map((p) => [p.n, p.v, p.d])).toEqual(parc0.map((p) => [p.n, p.v, p.d]));

        // Desmarcar recebimento continua funcionando → encomendada (parcelas não pagas saem); depois o Salvar como encomendada passa
        await ok(c, U_A, f.desmarcar, [oc]);
        expect(await status()).toBe("encomendado");
        expect((await parcelas()).length).toBe(0);
        await ok(c, U_A, f.salvar, [oc, JSON.stringify(f.oc(fx, "encomendado")), JSON.stringify(f.itens(fx, "encomendado", ids)), await rev()]);
        expect(await status()).toBe("encomendado");
        // e receber de novo pelo Salvar (encomendada → recebida não é regressão)
        await ok(c, U_B, f.salvar, [oc, JSON.stringify(f.oc(fx, "recebido")), JSON.stringify(f.itens(fx, "recebido", ids)), null]);
        expect(await status()).toBe("recebido");
        expect((await parcelas()).length).toBe(f.nParcelas);
      });
    });
  }

  it("OC nova nasce recebida pelo Salvar (INSERT não é regressão) e OC de outra loja segue 'não encontrada'", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const f = FAMILIAS[1];
      const oc = (await ok(c, U_A, f.salvar, [null, JSON.stringify(f.oc(fx, "recebido")), JSON.stringify(f.itens(fx, "recebido", [])), null]))[0].id as string;
      expect((await um<{ s: string }>(c, `select status s from ocs_aviamento where id = $1`, [oc])).s).toBe("recebido");
      const r = await como(c, U_A, f.salvar, ["00000000-5e9a-4056-8000-00000000dead", JSON.stringify(f.oc(fx, "encomendado")), "[]", null]);
      expect(r.ok ? "PASSOU" : `${r.code} ${r.msg}`).toMatch(/OC não encontrada ou sem permissão/);
    });
  });
});
