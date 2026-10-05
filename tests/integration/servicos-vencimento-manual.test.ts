// Achados MÉDIOS R10, fin #6 (P-165 A + P-171 A; P-191 A): o vencimento de parcela de SERVIÇO acompanha a data
// calculada; o ajustado À MÃO (parcelas_servico.vencimento_manual) fica; a paga nunca muda. Migration 20261020110000.
// Integração em BEGIN…ROLLBACK (withTx): nada é gravado. Só roda na cópia local (ehBancoLocal).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { md5OuSucessorS2 } from "./seg-s2-helpers";

const RODA = hasDb && ehBancoLocal();
const MD5 = {
  // R16 RA1 (20261026100000, P-187 A: parcela complemento) trocou servicos_financeiro (da903333) e a RPC (4d6681d1)
  servicos_financeiro: "a06f4cc32646cc41ed249d91a68dcd51",
  gatilho: "3cbad67dc2f335929ffadb19d26b2019",
  rpc: "9ea5069e414c736bf3dc02c22405cbeb",
};
const RPC = "public.parcela_servico_voltar_vencimento_automatico(uuid)";

type Parc = { id: string; n: number; venc: string | null; status: string; manual: boolean };

async function bloco(
  c: Client,
  opts: { n?: number; prazo?: string | null; entregue?: string; enviado?: string } = {},
) {
  await comoUsuario(c);
  const m = await um<{ id: string }>(
    c,
    `insert into modelos (tenant_id, nome) values ($1,'M R10-FIN6') returning id`,
    [TENANT_TESTE],
  );
  const cad = await um<{ id: string }>(
    c,
    `insert into cad (tenant_id, modelo_id) values ($1,$2) returning id`,
    [TENANT_TESTE, m.id],
  );
  const cat = await um<{ id: string }>(
    c,
    `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1, $2, 'ate_costura') returning id`,
    [TENANT_TESTE, `Bordado R10-FIN6 ${m.id.slice(0, 8)}`],
  );
  let emp: string | null = null;
  if (opts.prazo !== undefined) {
    emp = (
      await um<{ id: string }>(
        c,
        `insert into empresas (tenant_id, nome_fantasia, tipo, prazo_pagamento) values ($1,'Emp R10-FIN6','servico',$2) returning id`,
        [TENANT_TESTE, opts.prazo],
      )
    ).id;
  }
  const pt = await um<{ id: string }>(
    c,
    `insert into producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, empresa_id, ativo, interno,
                                         preco_metro_unidade, quantidade_enviada, numero_parcelas, data_enviado, data_entregue)
     values ($1,$2,$3,$4,true,false,10,10,$5,$6,$7) returning id`,
    [cad.id, TENANT_TESTE, cat.id, emp, opts.n ?? 2, opts.enviado ?? "2026-09-01", opts.entregue ?? "2026-09-10"],
  );
  return { pt: pt.id, emp };
}
/** "Abrir a tela": servicos_financeiro() sincroniza as parcelas (gera/move) e devolve a lista. */
async function tela(c: Client) {
  await um(c, `select public.servicos_financeiro() as j`);
}
async function parcelas(c: Client, pt: string): Promise<Parc[]> {
  return (
    await c.query(
      `select id, numero_parcela n, to_char(data_vencimento,'YYYY-MM-DD') venc, status, vencimento_manual manual
         from parcelas_servico where producao_terceirizado_id = $1 order by numero_parcela`,
      [pt],
    )
  ).rows as Parc[];
}
async function ajustarAMao(c: Client, id: string, data: string | null) {
  await c.query(`update parcelas_servico set data_vencimento = $2 where id = $1`, [id, data]);
}
async function pagar(c: Client, id: string) {
  await c.query(
    `update parcelas_servico set status='pago', data_pagamento='2026-09-20' where id = $1`,
    [id],
  );
}
async function voltar(c: Client, id: string) {
  return (
    await um<{ r: { id: string; data_vencimento: string; vencimento_manual: boolean } }>(
      c,
      `select public.parcela_servico_voltar_vencimento_automatico($1) r`,
      [id],
    )
  ).r;
}

describe.skipIf(!RODA)("medios R10 fin #6 — parcelas_servico.vencimento_manual", () => {
  it("migration: coluna NOT NULL default false; 3 gatilhos ligados; textos e ACL", async () => {
    await withTx(async (c) => {
      const col = await um<{ n: string; d: string; t: string }>(
        c,
        `select is_nullable n, column_default d, data_type t from information_schema.columns
          where table_schema='public' and table_name='parcelas_servico' and column_name='vencimento_manual'`,
      );
      expect(col).toEqual({ n: "NO", d: "false", t: "boolean" });
      const { rows } = await c.query(
        `select tgname, tgenabled::text e from pg_trigger
          where tgrelid='public.parcelas_servico'::regclass and not tgisinternal order by 1`,
      );
      expect(rows).toEqual([
        { tgname: "audit_parcelas_servico", e: "O" },
        { tgname: "trg_servico_parcela_valor_pago", e: "O" },
        { tgname: "trg_servico_parcela_vencimento_manual", e: "O" },
      ]);
      const d = await um<{ def: string }>(
        c,
        `select pg_get_triggerdef(oid) def from pg_trigger where tgname='trg_servico_parcela_vencimento_manual'`,
      );
      expect(d.def).toBe(
        "CREATE TRIGGER trg_servico_parcela_vencimento_manual BEFORE INSERT OR UPDATE ON public.parcelas_servico FOR EACH ROW EXECUTE FUNCTION fn_servico_parcela_vencimento_manual()",
      );
      const r = await um<Record<string, unknown>>(
        c,
        `select md5(pg_get_functiondef('public.servicos_financeiro()'::regprocedure)) sf,
                md5(pg_get_functiondef('public.fn_servico_parcela_vencimento_manual()'::regprocedure)) g,
                md5(pg_get_functiondef('${RPC}'::regprocedure)) rpc,
                has_function_privilege('anon','public.fn_servico_parcela_vencimento_manual()','EXECUTE')
                  or has_function_privilege('authenticated','public.fn_servico_parcela_vencimento_manual()','EXECUTE') g_exec,
                has_function_privilege('anon','${RPC}','EXECUTE') rpc_anon,
                has_function_privilege('authenticated','${RPC}','EXECUTE') rpc_auth,
                (select prosecdef from pg_proc where oid = '${RPC}'::regprocedure) rpc_definer,
                has_function_privilege('anon','public.servicos_financeiro()','EXECUTE') sf_anon,
                has_function_privilege('authenticated','public.servicos_financeiro()','EXECUTE') sf_auth`,
      );
      // Reforço de segurança S2 (C6) redefine servicos_financeiro: aceita o sucessor
      expect(md5OuSucessorS2("public.servicos_financeiro()", MD5.servicos_financeiro)).toContain(r.sf);
      expect({ ...r, sf: MD5.servicos_financeiro }).toEqual({
        sf: MD5.servicos_financeiro,
        g: MD5.gatilho,
        rpc: MD5.rpc,
        g_exec: false,
        rpc_anon: false,
        rpc_auth: true,
        rpc_definer: true,
        sf_anon: false,
        sf_auth: true,
      });
    });
  });

  it("entrega muda: a parcela NÃO manual acompanha a data calculada (antes ficava parada)", async () => {
    await withTx(async (c) => {
      const { pt } = await bloco(c, { n: 2 });
      await tela(c);
      expect((await parcelas(c, pt)).map((p) => [p.venc, p.manual])).toEqual([
        ["2026-09-10", false],
        ["2026-09-10", false],
      ]);
      await c.query(`update producao_terceirizados set data_entregue = '2026-09-25' where id = $1`, [pt]);
      await tela(c);
      expect((await parcelas(c, pt)).map((p) => p.venc)).toEqual(["2026-09-25", "2026-09-25"]);
    });
  });

  it("prazo da empresa muda (30/60 → 15/45): as não manuais andam (base + dias[nº])", async () => {
    await withTx(async (c) => {
      const { pt, emp } = await bloco(c, { prazo: "30/60" });
      await tela(c);
      expect((await parcelas(c, pt)).map((p) => p.venc)).toEqual(["2026-10-10", "2026-11-09"]);
      await c.query(`update empresas set prazo_pagamento = '15, 45' where id = $1`, [emp]);
      await tela(c);
      expect((await parcelas(c, pt)).map((p) => p.venc)).toEqual(["2026-09-25", "2026-10-25"]);
    });
  });

  it("ajustada à mão: marca true e FICA quando a entrega muda; a outra acompanha", async () => {
    await withTx(async (c) => {
      const { pt } = await bloco(c, { n: 2 });
      await tela(c);
      const [p1] = await parcelas(c, pt);
      await ajustarAMao(c, p1.id, "2026-12-25");
      expect((await parcelas(c, pt)).map((p) => p.manual)).toEqual([true, false]);
      await c.query(`update producao_terceirizados set data_entregue = '2026-09-25' where id = $1`, [pt]);
      await tela(c);
      expect((await parcelas(c, pt)).map((p) => [p.venc, p.manual])).toEqual([
        ["2026-12-25", true],
        ["2026-09-25", false],
      ]);
    });
  });

  it("parcela PAGA nunca muda de data (nem marca), mesmo com a entrega mudando", async () => {
    await withTx(async (c) => {
      const { pt } = await bloco(c, { n: 2 });
      await tela(c);
      const [p1] = await parcelas(c, pt);
      await pagar(c, p1.id);
      // pagar + mudar a data no mesmo UPDATE não marca (não é ajuste de parcela em aberto)
      await c.query(`update parcelas_servico set data_vencimento = '2026-12-01' where id = $1`, [p1.id]);
      await c.query(`update producao_terceirizados set data_entregue = '2026-09-25' where id = $1`, [pt]);
      await tela(c);
      expect((await parcelas(c, pt)).map((p) => [p.venc, p.status, p.manual])).toEqual([
        ["2026-12-01", "pago", false],
        ["2026-09-25", "a_pagar", false],
      ]);
    });
  });

  it("o cliente manda vencimento_manual: ignorado no UPDATE (nos 2 sentidos) e no INSERT (nasce false)", async () => {
    await withTx(async (c) => {
      const { pt } = await bloco(c, { n: 2 });
      await tela(c);
      const [p1, p2] = await parcelas(c, pt);
      await ajustarAMao(c, p2.id, "2026-12-25"); // p2 manual
      // Reforço de segurança S2 (fin #11): o cliente só tem UPDATE em data_vencimento/status/data_pagamento/comprovante_url —
      // mandar vencimento_manual (ou INSERT) passa a ser RECUSADO (42501) em vez de ignorado; o estado fica igual.
      const s2 = !(await um<{ v: boolean }>(c,
        `select has_column_privilege('authenticated', 'public.parcelas_servico', 'vencimento_manual', 'UPDATE') v`)).v;
      if (s2) {
        for (const [sql, p] of [
          [`update parcelas_servico set vencimento_manual = true where id = $1`, [p1.id]],
          [`update parcelas_servico set vencimento_manual = false where id = $1`, [p2.id]],
          [`insert into parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento, vencimento_manual)
            values ($1,$2,3,'2027-01-01',true)`, [TENANT_TESTE, pt]],
        ] as [string, unknown[]][]) {
          await c.query("SAVEPOINT cli");
          await c.query("SET LOCAL ROLE authenticated");
          await expect(c.query(sql, p)).rejects.toMatchObject({ code: "42501" });
          await c.query("ROLLBACK TO SAVEPOINT cli");
        }
        expect((await parcelas(c, pt)).map((p) => [p.n, p.manual])).toEqual([
          [1, false],
          [2, true],
        ]);
        return;
      }
      // como o cliente (role authenticated + JWT da Loja Teste)
      await c.query("SAVEPOINT cli");
      await c.query("SET LOCAL ROLE authenticated");
      await c.query(`update parcelas_servico set vencimento_manual = true where id = $1`, [p1.id]);
      await c.query(`update parcelas_servico set vencimento_manual = false where id = $1`, [p2.id]);
      await c.query(
        `insert into parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento, vencimento_manual)
         values ($1,$2,3,'2027-01-01',true)`,
        [TENANT_TESTE, pt],
      );
      await c.query("RESET ROLE");
      expect((await parcelas(c, pt)).map((p) => [p.n, p.manual])).toEqual([
        [1, false],
        [2, true],
        [3, false],
      ]);
      await c.query("RELEASE SAVEPOINT cli");
    });
  });

  it("data APAGADA pela pessoa (null): não é ajuste — vencimento_manual=false e a próxima leitura preenche", async () => {
    await withTx(async (c) => {
      const { pt } = await bloco(c, { n: 1 });
      await tela(c);
      const [p1] = await parcelas(c, pt);
      await ajustarAMao(c, p1.id, "2026-12-25");
      await ajustarAMao(c, p1.id, null);
      expect((await parcelas(c, pt))[0]).toMatchObject({ venc: null, manual: false });
      await tela(c);
      expect((await parcelas(c, pt))[0]).toMatchObject({ venc: "2026-09-10", manual: false });
    });
  });

  it("servicos_financeiro restaura a GUC app.parcelas_servico_sistema (valor de antes, inclusive vazio)", async () => {
    await withTx(async (c) => {
      const { pt } = await bloco(c, { n: 2 });
      await c.query(`select set_config('app.parcelas_servico_sistema','x', true)`);
      await tela(c);
      await c.query(`update producao_terceirizados set data_entregue = '2026-09-25' where id = $1`, [pt]);
      await tela(c);
      const g = await um<{ v: string }>(c, `select current_setting('app.parcelas_servico_sistema', true) v`);
      expect(g.v).toBe("x");
      // com a GUC restaurada (≠ 'on'), um UPDATE da pessoa volta a marcar
      const [p1] = await parcelas(c, pt);
      await ajustarAMao(c, p1.id, "2026-12-31");
      expect((await parcelas(c, pt))[0].manual).toBe(true);
    });
  });

  it("anti-drift: nenhuma função faz UPDATE em parcelas_servico (nem INSERT … ON CONFLICT DO UPDATE) sem ligar a GUC", async () => {
    await withTx(async (c) => {
      const sql = `select p.oid::regprocedure::text f
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and (p.prosrc ~* 'update\\s+(public\\.)?parcelas_servico\\y'
                 or p.prosrc ~* 'insert\\s+into\\s+(public\\.)?parcelas_servico\\y[^;]*on\\s+conflict[^;]*do\\s+update')
            and p.prosrc !~* 'set_config\\s*\\(\\s*''app\\.parcelas_servico_sistema''\\s*,\\s*''on'''
          order by 1`;
      expect((await c.query(sql)).rows.map((r) => r.f)).toEqual([]);
      // controle negativo: citar a GUC num comentário não basta (função descartada no ROLLBACK)
      await c.query(`create function public._r10_drift_fake() returns void language plpgsql as $f$
        begin
          -- app.parcelas_servico_sistema (so citada)
          update public.parcelas_servico set data_vencimento = data_vencimento where false;
        end $f$`);
      expect((await c.query(sql)).rows.map((r) => r.f)).toEqual(["_r10_drift_fake()"]);
      // as 2 que fazem UPDATE ligam a GUC logo antes e RESTAURAM logo depois
      for (const f of ["public.servicos_financeiro()", RPC]) {
        const d = (await um<{ d: string }>(c, `select pg_get_functiondef('${f}'::regprocedure) d`)).d;
        expect(d).toMatch(
          /set_config\('app\.parcelas_servico_sistema', 'on', true\);\s*UPDATE (public\.)?parcelas_servico[^;]*;\s*PERFORM set_config\('app\.parcelas_servico_sistema', v_guc, true\);/,
        );
      }
    });
  });

  // T1 (backend, 05/out): a versão original deste caso lia as 4 parcelas REAIS da Loja Teste (9a77fc69, c575f73d, 0b040678, 53865b07), "paradas
  // numa data velha" ANTES da migration, e exigia que a 1ª abertura da tela as movesse. Isso é uma correção ÚNICA de dado: depois de aplicada
  // (e de alguém abrir a tela), as 4 já estão na data calculada ("expected '2026-08-05' not to be '2026-08-05'") e o teste nunca mais poderia
  // passar. A regra de P-191 A — parcela em aberto, NENHUMA marcada como manual, parada numa data velha, passa a acompanhar a data calculada
  // quando a tela sincroniza — é provada aqui com fixture PRÓPRIA na txn: 4 parcelas em 3 serviços (como eram: 2 de Corte + 1 de PL + 1 de
  // Oficina), geradas, depois a entrega muda SEM a tela aberta (= ficam paradas na data velha) e a abertura da tela as move.
  it("P-191 A: parcelas em aberto paradas numa data velha (nenhuma marcada) passam a acompanhar a data calculada", async () => {
    await withTx(async (c) => {
      const a = await bloco(c, { n: 2, entregue: "2026-08-05" }); // "Corte": 2 parcelas
      const b = await bloco(c, { n: 1, entregue: "2026-07-11" }); // "PL"
      const o = await bloco(c, { n: 1, entregue: "2026-08-06" }); // "Oficina"
      await tela(c);
      const ids = [a.pt, b.pt, o.pt];
      const lerTodas = async () =>
        (await c.query(
          `select id, to_char(data_vencimento,'YYYY-MM-DD') venc, vencimento_manual manual, producao_terceirizado_id pt, numero_parcela n
             from parcelas_servico where producao_terceirizado_id = any($1::uuid[]) order by pt, n`, [ids],
        )).rows as { id: string; venc: string; manual: boolean; pt: string; n: number }[];
      const antes = await lerTodas();
      expect(antes).toHaveLength(4);
      expect(antes.every((r) => r.manual === false)).toBe(true); // P-191 A: nenhuma marcada
      // a entrega muda sem a tela aberta → as parcelas ficam paradas na data velha
      await c.query(`update producao_terceirizados set data_entregue = '2026-09-25' where id = any($1::uuid[])`, [ids]);
      expect((await lerTodas()).map((r) => r.venc)).toEqual(antes.map((r) => r.venc));
      await tela(c);
      const depois = await lerTodas();
      // sem prazo na empresa: data calculada = entrega (flat)
      expect(depois.map((r) => [r.venc, r.manual])).toEqual(antes.map(() => ["2026-09-25", false]));
      for (const x of antes) expect(x.venc).not.toBe(depois.find((d) => d.id === x.id)!.venc); // e todas estavam paradas numa data velha
    });
  });
});

describe.skipIf(!RODA)("medios R10 fin #6 — parcela_servico_voltar_vencimento_automatico (P-171 A)", () => {
  const SEM_PERM = "0a0a0a0a-0000-4000-8000-0000000000b6";

  it("volta à data calculada (prazo + entrega atuais), limpa a marca, auditado; restaura a GUC", async () => {
    await withTx(async (c) => {
      const { pt } = await bloco(c, { prazo: "30/60" });
      await tela(c);
      const [, p2] = await parcelas(c, pt);
      await ajustarAMao(c, p2.id, "2028-01-31");
      await c.query(`update producao_terceirizados set data_entregue = '2026-09-20' where id = $1`, [pt]);
      await tela(c);
      expect((await parcelas(c, pt))[1]).toMatchObject({ venc: "2028-01-31", manual: true });
      const r = await voltar(c, p2.id);
      expect(r).toEqual({ id: p2.id, data_vencimento: "2026-11-19", vencimento_manual: false }); // 20/09 + 60
      expect((await parcelas(c, pt))[1]).toMatchObject({ venc: "2026-11-19", manual: false });
      const a = await um<{ dados: Record<string, unknown>; u: string | null }>(
        c,
        `select dados, user_id u from audit_log
          where registro_id = $1 and dados -> 'vencimento_manual' ->> 'para' = 'false' limit 1`,
        [p2.id],
      );
      expect(a.dados).toMatchObject({ vencimento_manual: { de: true, para: false } });
      expect(a.u).not.toBeNull();
      const g = await um<{ v: string | null }>(c, `select current_setting('app.parcelas_servico_sistema', true) v`);
      expect(g.v ?? "").not.toBe("on");
      // depois de voltar, ela acompanha de novo
      await c.query(`update producao_terceirizados set data_entregue = '2026-09-30' where id = $1`, [pt]);
      await tela(c);
      expect((await parcelas(c, pt))[1].venc).toBe("2026-11-29");
    });
  });

  it("sem prazo: volta à data-base (flat, igual ao loop — não nº*30)", async () => {
    await withTx(async (c) => {
      const { pt } = await bloco(c, { n: 3 });
      await tela(c);
      const p3 = (await parcelas(c, pt))[2];
      await ajustarAMao(c, p3.id, "2028-01-31");
      expect((await voltar(c, p3.id)).data_vencimento).toBe("2026-09-10");
    });
  });

  it("parcela PAGA: P0001 parcela_paga; nada muda", async () => {
    await withTx(async (c) => {
      const { pt } = await bloco(c, { n: 1 });
      await tela(c);
      const [p1] = await parcelas(c, pt);
      await pagar(c, p1.id);
      await c.query("SAVEPOINT sp");
      await expect(voltar(c, p1.id)).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringMatching(/^parcela_paga:/),
      });
      await c.query("ROLLBACK TO SAVEPOINT sp");
      expect((await parcelas(c, pt))[0]).toMatchObject({ venc: "2026-09-10", status: "pago" });
    });
  });

  it("sem permissão de editar Serviços do Financeiro: 42501; sem JWT: 42501; parcela de outra loja: P0001", async () => {
    await withTx(async (c) => {
      const { pt } = await bloco(c, { n: 1 });
      await tela(c);
      const [p1] = await parcelas(c, pt);
      await ajustarAMao(c, p1.id, "2028-01-31");
      await c.query(
        `insert into auth.users (id, email) values ($1,'noperm-r10fin6@teste') on conflict (id) do nothing`,
        [SEM_PERM],
      );
      await c.query(
        `insert into public.users (id, tenant_id, email, nome) values ($1,$2,'noperm-r10fin6@teste','Sem Perm R10')
         on conflict (id) do update set tenant_id = excluded.tenant_id`,
        [SEM_PERM, TENANT_TESTE],
      );
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: SEM_PERM, role: "authenticated" }),
      ]);
      await c.query("SAVEPOINT a");
      await expect(voltar(c, p1.id)).rejects.toMatchObject({ code: "42501" });
      await c.query("ROLLBACK TO SAVEPOINT a");
      await c.query(`select set_config('request.jwt.claims', '', true)`);
      await c.query("SAVEPOINT b");
      await expect(voltar(c, p1.id)).rejects.toMatchObject({ code: "42501" });
      await c.query("ROLLBACK TO SAVEPOINT b");
      await comoUsuario(c);
      const outra = await um<{ id: string }>(
        c,
        `select id from tenants where id <> $1 order by id limit 1`,
        [TENANT_TESTE],
      );
      await c.query(`select set_config('app.parcelas_servico_sistema','on', true)`);
      await c.query(`update parcelas_servico set tenant_id = $2 where id = $1`, [p1.id, outra.id]);
      await c.query(`select set_config('app.parcelas_servico_sistema','', true)`);
      await c.query("SAVEPOINT c");
      await expect(voltar(c, p1.id)).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringMatching(/^parcela_nao_encontrada:/),
      });
      await c.query("ROLLBACK TO SAVEPOINT c");
      expect((await parcelas(c, pt))[0].manual).toBe(true);
    });
  });
});
