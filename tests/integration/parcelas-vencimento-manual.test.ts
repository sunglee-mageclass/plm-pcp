// Contas certas A1 (fin #3, P-165 A + RA2): vencimento ajustado à mão sobrevive ao recálculo das parcelas.
// Migration 20261019200000 (coluna + 4 gatilhos; nenhuma regeradora reescrita). Integração em BEGIN…ROLLBACK (withTx):
// nada é gravado. Só roda na cópia local (as fixtures criam OCs pelas RPCs de sempre).
// `SET CONSTRAINTS ALL IMMEDIATE` = simula o COMMIT para o gatilho adiado de limpeza da guarda (precedente kanban-auto).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";

const RODA = hasDb && ehBancoLocal();
const COL = {
  tecido: "oc_tecido_id",
  aviamento: "oc_aviamento_id",
  etiqueta: "oc_etiqueta_id",
  p_acabado: "oc_p_acabado_id",
  p_importado: "oc_importado_id",
} as const;
type Familia = keyof typeof COL;
type Parc = { id: string; n: number; valor: string; venc: string; status: string; manual: boolean };
type Fix = {
  emp: string;
  art: string;
  var: string;
  aviId: string;
  aviEmp: string;
  etqId: string;
  etqVar: string | null;
};

async function prepara(c: Client): Promise<Fix> {
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  await comoUsuario(c);
  const emp = await um<{ id: string } | undefined>(
    c,
    `select id from empresas where tenant_id = $1 order by id limit 1`,
    [TENANT_TESTE],
  );
  const tec = await um<{ art: string; var: string } | undefined>(
    c,
    `select a.id art, v.id var from variantes_tecido v join artigos a on a.id = v.artigo_id where a.tenant_id = $1 order by v.id limit 1`,
    [TENANT_TESTE],
  );
  const avi = await um<{ id: string; emp: string } | undefined>(
    c,
    `select id, empresa_id emp from aviamentos where tenant_id = $1 and coalesce(preco,0) > 0 and empresa_id is not null order by id limit 1`,
    [TENANT_TESTE],
  );
  const etq = await um<{ id: string; var: string | null } | undefined>(
    c,
    `select e.id, (select v.id from variantes_etiqueta v where v.etiqueta_id = e.id order by v.id limit 1) var
          from etiquetas e where e.tenant_id = $1 order by e.id limit 1`,
    [TENANT_TESTE],
  );
  if (!emp || !tec || !avi || !etq)
    throw new Error("Loja Teste sem fixture (empresa / tecido / aviamento com preço / insumo)");
  return {
    emp: emp.id,
    art: tec.art,
    var: tec.var,
    aviId: avi.id,
    aviEmp: avi.emp,
    etqId: etq.id,
    etqVar: etq.var,
  };
}

async function parcelas(c: Client, f: Familia, ocId: string): Promise<Parc[]> {
  const { rows } = await c.query(
    `select id, numero_parcela n, valor::numeric(14,2)::text valor, to_char(data_vencimento, 'YYYY-MM-DD') venc, status,
            vencimento_manual manual
       from public.parcelas where ${COL[f]} = $1 order by numero_parcela`,
    [ocId],
  );
  return rows as Parc[];
}
const centavos = (ps: Parc[]) => ps.reduce((s, p) => s + Math.round(Number(p.valor) * 100), 0);
async function ajustarAMao(c: Client, id: string, data: string) {
  await c.query(`update public.parcelas set data_vencimento = $2 where id = $1`, [id, data]);
}
async function guardadas(c: Client, ocId: string) {
  return (
    await c.query(
      `select numero_parcela n, to_char(data_vencimento,'YYYY-MM-DD') d from public.parcelas_vencimento_guardado
                          where oc_id = $1 order by 1`,
      [ocId],
    )
  ).rows as { n: number; d: string }[];
}

async function ocTecido(
  c: Client,
  fx: Fix,
  extra: Record<string, unknown> = {},
  id: string | null = null,
): Promise<string> {
  const oc = {
    numero_pedido: "CC-A1-TEC-90001",
    empresa_id: fx.emp,
    data_prevista_entrega: "2026-09-01",
    data_entrega: "2026-09-10",
    prazo_pagamento: "30/60/90",
    quantidade_prazos: 3,
    parcelas_recebimento: [],
    valor_previsto_total: 1000,
    valor_real_total: 1000,
    status: "recebido",
    ...extra,
  };
  const item = id
    ? await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id = $1`, [id])
    : null;
  const itens = [
    {
      id: item?.id ?? null,
      artigo_id: fx.art,
      artigo_numero: 1,
      variante_tecido_id: fx.var,
      quantidade_pedida: 100,
      quantidade_recebida: 100,
      rendimento: null,
      cancelado: false,
      preco: 10,
    },
  ];
  return (
    await um<{ id: string }>(
      c,
      `select public._salvar_oc_tecido_core($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
      [id, JSON.stringify(oc), JSON.stringify(itens)],
    )
  ).id;
}
async function ocAviamento(
  c: Client,
  fx: Fix,
  extra: Record<string, unknown> = {},
  id: string | null = null,
): Promise<string> {
  const oc = {
    numero_pedido: "CC-A1-AVI-90001",
    responsavel_nome: null,
    empresa_id: fx.aviEmp,
    representante_id: null,
    data_pedido: "2026-09-01",
    data_prevista_entrega: "2026-09-05",
    data_entrega: "2026-09-10",
    prazo_pagamento: "30/60/90",
    quantidade_prazos: 3,
    nf_url: null,
    parcelas_recebimento: [],
    status: "recebido",
    ...extra,
  };
  const itens = id
    ? (
        await c.query(
          `select id, aviamento_id, variante_aviamento_id, quantidade_pedida, quantidade_recebida, cancelado
                        from ocs_aviamento_itens where oc_aviamento_id = $1`,
          [id],
        )
      ).rows
    : [
        {
          id: null,
          aviamento_id: fx.aviId,
          variante_aviamento_id: null,
          quantidade_pedida: 100,
          quantidade_recebida: 100,
          cancelado: false,
        },
      ];
  return (
    await um<{ id: string }>(
      c,
      `select public._salvar_oc_aviamento_core($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
      [id, JSON.stringify(oc), JSON.stringify(itens)],
    )
  ).id;
}
async function ocInsumo(
  c: Client,
  fx: Fix,
  extra: Record<string, unknown> = {},
  id: string | null = null,
): Promise<string> {
  const oc = {
    numero_pedido: "CC-A1-INS-90001",
    responsavel_nome: null,
    empresa_id: fx.emp,
    representante_id: null,
    data_pedido: "2026-09-01",
    data_prevista_entrega: "2026-09-05",
    data_entrega: "2026-09-10",
    prazo_pagamento: "30/60",
    quantidade_prazos: 2,
    nf_url: null,
    nfs: [],
    parcelas_recebimento: [],
    status: "recebido",
    ...extra,
  };
  const itens = id
    ? (
        await c.query(
          `select id, etiqueta_id, variante_etiqueta_id, quantidade_pedida, quantidade_recebida, preco, cancelado
                        from ocs_etiqueta_itens where oc_etiqueta_id = $1`,
          [id],
        )
      ).rows
    : [
        {
          id: null,
          etiqueta_id: fx.etqId,
          variante_etiqueta_id: fx.etqVar,
          quantidade_pedida: 100,
          quantidade_recebida: 100,
          preco: 2.5,
          cancelado: false,
        },
      ];
  return (
    await um<{ id: string }>(
      c,
      `select public.salvar_oc_etiqueta($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
      [id, JSON.stringify(oc), JSON.stringify(itens)],
    )
  ).id;
}
async function ocPAcabado(
  c: Client,
  fx: Fix,
  extra: Record<string, unknown> = {},
  id: string | null = null,
): Promise<string> {
  const dados = {
    nome_produto: "CC-A1-PA",
    empresa_id: fx.emp,
    data_pedido: "2026-09-01",
    prazo_pagamento: "30/60/90",
    qtd_total: 10,
    valor_unitario: 100,
    desconto_pct: 0,
    grade_proporcao: {},
    variantes: [],
    ...extra,
  };
  const grade = { "1": { P: { pedida: 10, recebida: 0, defeito: 0 } } };
  return (
    await um<{ id: string }>(
      c,
      `select public._salvar_oc_p_acabado_core($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
      [id, JSON.stringify(dados), JSON.stringify(grade)],
    )
  ).id;
}

describe.skipIf(!RODA)(
  "contas certas A1 — vencimento ajustado à mão (parcelas.vencimento_manual)",
  () => {
    it("migration: coluna NOT NULL default false; gatilhos ligados; o cliente NÃO grava a coluna por UPDATE", async () => {
      await withTx(async (c) => {
        const col = await um<{ n: string; d: string }>(
          c,
          `select is_nullable n, column_default d from information_schema.columns
          where table_schema='public' and table_name='parcelas' and column_name='vencimento_manual'`,
        );
        expect(col).toEqual({ n: "NO", d: "false" });
        const g = await um<{ n: string }>(
          c,
          `select count(*) n from pg_trigger where tgenabled='O' and tgname in ('trg_parcela_vencimento_manual',
           'trg_parcela_vencimento_guarda','trg_parcela_vencimento_reaplica','trg_parcelas_vencimento_guardado_limpa')`,
        );
        expect(Number(g.n)).toBe(4);
        const p = await um<{ u: boolean; d: boolean; s: boolean }>(
          c,
          `select has_column_privilege('authenticated','public.parcelas','vencimento_manual','UPDATE') u,
                has_column_privilege('authenticated','public.parcelas','data_vencimento','UPDATE') d,
                has_table_privilege('authenticated','public.parcelas_vencimento_guardado','SELECT') s`,
        );
        expect(p).toEqual({ u: false, d: true, s: false });
        // de fato: como authenticated, UPDATE da coluna = permissão negada
        const fx = await prepara(c);
        const oc = await ocTecido(c, fx);
        const p1 = (await parcelas(c, "tecido", oc))[0];
        await c.query("SAVEPOINT sp");
        await c.query("SET LOCAL ROLE authenticated");
        await expect(
          c.query(`update public.parcelas set vencimento_manual = true where id = $1`, [p1.id]),
        ).rejects.toMatchObject({ code: "42501" });
        await c.query("ROLLBACK TO SAVEPOINT sp");
      });
    });

    it("UPDATE da data pela pessoa marca; só status não marca; paga não marca; GUC app.parcelas_sistema=on não marca", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await ocTecido(c, fx);
        const [p1, p2, p3] = await parcelas(c, "tecido", oc);
        expect([p1.manual, p2.manual, p3.manual]).toEqual([false, false, false]);
        await ajustarAMao(c, p2.id, "2026-12-25");
        await c.query(`update public.parcelas set status = 'a_pagar' where id = $1`, [p3.id]);
        await c.query(
          `update public.parcelas set status='pago', data_pagamento='2026-09-20', data_vencimento='2026-11-01' where id = $1`,
          [p1.id],
        );
        await c.query(`select set_config('app.parcelas_sistema','on', true)`);
        await ajustarAMao(c, p3.id, "2026-12-30");
        await c.query(`select set_config('app.parcelas_sistema','', true)`);
        const ps = await parcelas(c, "tecido", oc);
        expect(ps.map((p) => p.manual)).toEqual([false, true, false]);
      });
    });

    it("TECIDO recalcular_parcelas: a data manual fica, as outras recalculam, Σ = total − pagas; mudar a Nota: fica (P-165 A)", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await ocTecido(c, fx);
        const antes = await parcelas(c, "tecido", oc);
        await c.query(
          `update public.parcelas set status='pago', data_pagamento='2026-09-20' where id = $1`,
          [antes[0].id],
        );
        await ajustarAMao(c, antes[1].id, "2026-12-25");
        await c.query(`select public.recalcular_parcelas($1, 'tecido')`, [oc]);
        let ps = await parcelas(c, "tecido", oc);
        expect(ps.map((p) => p.n)).toEqual([1, 2, 3]);
        expect(ps[1]).toMatchObject({ venc: "2026-12-25", manual: true });
        expect(ps[2]).toMatchObject({ venc: antes[2].venc, manual: false });
        expect(centavos(ps)).toBe(100000);
        // Nota de Entrada muda → o calculado anda, a manual fica
        await c.query(
          `update public.ocs_tecido set data_nota_entrada = '2026-09-15' where id = $1`,
          [oc],
        );
        ps = await parcelas(c, "tecido", oc);
        expect(ps[1]).toMatchObject({ venc: "2026-12-25", manual: true });
        expect(ps[2].venc).toBe("2026-12-14"); // 15/09 + 90
        expect(centavos(ps)).toBe(100000);
        await c.query("SET CONSTRAINTS ALL IMMEDIATE"); // "COMMIT": nada sobra na guarda
        expect(await guardadas(c, oc)).toEqual([]);
      });
    });

    it("AVIAMENTO: o save da OC (recalcula) preserva a manual; prazo 3 → 2: a manual da nº 3 some (também da guarda no COMMIT)", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await ocAviamento(c, fx);
        const antes = await parcelas(c, "aviamento", oc);
        expect(antes.length).toBe(3);
        await ajustarAMao(c, antes[0].id, "2026-12-01");
        await ajustarAMao(c, antes[2].id, "2027-01-15");
        await ocAviamento(c, fx, {}, oc); // re-save = recalcula
        let ps = await parcelas(c, "aviamento", oc);
        expect(ps.map((p) => [p.n, p.venc, p.manual])).toEqual([
          [1, "2026-12-01", true],
          [2, antes[1].venc, false],
          [3, "2027-01-15", true],
        ]);
        // prazo encurta
        await ocAviamento(c, fx, { prazo_pagamento: "30/60", quantidade_prazos: 2 }, oc);
        ps = await parcelas(c, "aviamento", oc);
        expect(ps.map((p) => [p.n, p.venc, p.manual])).toEqual([
          [1, "2026-12-01", true],
          [2, antes[1].venc, false],
        ]);
        await c.query("SET CONSTRAINTS ALL IMMEDIATE");
        expect(await guardadas(c, oc)).toEqual([]); // a data da nº 3 não volta se o prazo crescer de novo
        await ocAviamento(c, fx, { prazo_pagamento: "30/60/90", quantidade_prazos: 3 }, oc);
        ps = await parcelas(c, "aviamento", oc);
        expect(ps[2].manual).toBe(false);
      });
    });

    it("P.ACABADO: save sem mudança (gatilho regera tudo) preserva a manual; Σ = total", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await ocPAcabado(c, fx);
        const antes = await parcelas(c, "p_acabado", oc);
        expect(antes.length).toBe(3);
        await ajustarAMao(c, antes[1].id, "2026-12-24");
        await ocPAcabado(c, fx, {}, oc);
        const ps = await parcelas(c, "p_acabado", oc);
        expect(ps[1]).toMatchObject({ venc: "2026-12-24", manual: true });
        expect(ps[0].manual).toBe(false);
        expect(centavos(ps)).toBe(centavos(antes));
      });
    });

    it("INSUMO (etiqueta): re-save da OC (recalcular_parcelas_etiqueta) preserva a manual", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await ocInsumo(c, fx);
        const antes = await parcelas(c, "etiqueta", oc);
        expect(antes.length).toBe(2);
        await ajustarAMao(c, antes[0].id, "2026-11-11");
        await ocInsumo(c, fx, {}, oc);
        await c.query(`select public.recalcular_parcelas_etiqueta($1)`, [oc]);
        const ps = await parcelas(c, "etiqueta", oc);
        expect(ps[0]).toMatchObject({ venc: "2026-11-11", manual: true });
        expect(ps[1].manual).toBe(false);
      });
    });

    it("IMPORTADO: _gerar_parcelas_importado reinsere as etapas e a manual fica (por nº)", async () => {
      await withTx(async (c) => {
        await prepara(c);
        const oc = await um<{ id: string } | undefined>(
          c,
          `select o.id from ocs_importado o where o.tenant_id = $1
            and exists (select 1 from parcelas p where p.oc_importado_id = o.id and p.status is distinct from 'pago' and p.data_pagamento is null)
          limit 1`,
          [TENANT_TESTE],
        );
        if (!oc)
          throw new Error("Loja Teste sem OC de importado com parcela aberta — conferir a cópia");
        const antes = await parcelas(c, "p_importado", oc.id);
        const alvo = antes.find((p) => p.status !== "pago")!;
        await ajustarAMao(c, alvo.id, "2027-02-02");
        await c.query(`select public._gerar_parcelas_importado($1)`, [oc.id]);
        const depois = await parcelas(c, "p_importado", oc.id);
        const mesma = depois.find((p) => p.n === alvo.n)!;
        expect(mesma).toMatchObject({ venc: "2027-02-02", manual: true });
        expect(centavos(depois)).toBe(centavos(antes));
      });
    });

    it("RA2 TECIDO: desmarcar recebimento guarda a data manual; re-receber a reaplica (mesmo depois do COMMIT)", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await ocTecido(c, fx);
        const antes = await parcelas(c, "tecido", oc);
        await ajustarAMao(c, antes[2].id, "2027-03-03");
        await c.query(`select public._desmarcar_recebimento_oc_core('tecido', $1)`, [oc]);
        expect(await parcelas(c, "tecido", oc)).toEqual([]);
        await c.query("SET CONSTRAINTS ALL IMMEDIATE"); // "COMMIT" do desmarcar: sem parcela aberta → a guarda FICA
        expect(await guardadas(c, oc)).toEqual([{ n: 3, d: "2027-03-03" }]);
        await c.query(`update public.ocs_tecido set status = 'recebido' where id = $1`, [oc]); // re-receber
        const ps = await parcelas(c, "tecido", oc);
        expect(ps.map((p) => [p.n, p.venc, p.manual])).toEqual([
          [1, antes[0].venc, false],
          [2, antes[1].venc, false],
          [3, "2027-03-03", true],
        ]);
        expect(await guardadas(c, oc)).toEqual([]); // consumida
        expect(centavos(ps)).toBe(100000);
      });
    });

    it("RA2 INSUMO: desmarcar_recebimento_oc_etiqueta + re-receber reaplicam a data manual", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await ocInsumo(c, fx);
        const antes = await parcelas(c, "etiqueta", oc);
        await ajustarAMao(c, antes[1].id, "2027-04-04");
        await c.query(`select public.desmarcar_recebimento_oc_etiqueta($1)`, [oc]);
        expect(await parcelas(c, "etiqueta", oc)).toEqual([]);
        await c.query(`update public.ocs_etiqueta set status = 'recebido' where id = $1`, [oc]);
        const ps = await parcelas(c, "etiqueta", oc);
        expect(ps[1]).toMatchObject({ venc: "2027-04-04", manual: true });
        expect(ps[0].manual).toBe(false);
      });
    });

    it("parcela PAGA nunca é mexida (nem guardada, nem regerada)", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await ocTecido(c, fx);
        const antes = await parcelas(c, "tecido", oc);
        await ajustarAMao(c, antes[0].id, "2026-10-01");
        await c.query(
          `update public.parcelas set status='pago', data_pagamento='2026-09-20' where id = $1`,
          [antes[0].id],
        );
        await c.query(`select public.recalcular_parcelas($1, 'tecido')`, [oc]);
        const ps = await parcelas(c, "tecido", oc);
        expect(ps[0]).toMatchObject({ id: antes[0].id, venc: "2026-10-01", status: "pago" });
        expect(await guardadas(c, oc)).toEqual([]);
      });
    });

    it("OC excluída: a guarda some no COMMIT", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await ocPAcabado(c, fx);
        const antes = await parcelas(c, "p_acabado", oc);
        await ajustarAMao(c, antes[0].id, "2026-12-12");
        await c.query(`delete from public.ocs_p_acabado where id = $1`, [oc]); // cascata apaga as parcelas
        expect((await guardadas(c, oc)).length).toBe(1);
        await c.query("SET CONSTRAINTS ALL IMMEDIATE");
        expect(await guardadas(c, oc)).toEqual([]);
      });
    });
  },
);

// ─────────────── fix round 1 (revisões): M3 anti-drift, L1 loja, P-171 A "voltar ao cálculo automático" ───────────────
describe.skipIf(!RODA)("contas certas A1 — fix round 1", () => {
  it("M3 anti-drift: nenhuma função faz UPDATE em parcelas (nem INSERT … ON CONFLICT DO UPDATE) sem ligar app.parcelas_sistema", async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select p.oid::regprocedure::text f
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and (p.prosrc ~* 'update\\s+(public\\.)?parcelas\\y'
                 or p.prosrc ~* 'insert\\s+into\\s+(public\\.)?parcelas\\y[^;]*on\\s+conflict[^;]*do\\s+update')
            and p.prosrc !~* 'set_config\\s*\\(\\s*''app\\.parcelas_sistema'''
          order by 1`,
      );
      expect(rows.map((r) => r.f)).toEqual([]);
      // R1a: citar a GUC num COMENTÁRIO não basta — controle negativo (função descartada no ROLLBACK)
      await c.query(`create function public._cc_drift_fake() returns void language plpgsql as $f$
        begin
          -- app.parcelas_sistema (so citada)
          update public.parcelas set data_vencimento = data_vencimento where false;
        end $f$`);
      const fake = await c.query(
        `select p.oid::regprocedure::text f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosrc ~* 'update\\s+(public\\.)?parcelas\\y'
            and p.prosrc !~* 'set_config\\s*\\(\\s*''app\\.parcelas_sistema'''`,
      );
      expect(fake.rows.map((r) => r.f)).toEqual(["_cc_drift_fake()"]);
      // e a única que faz UPDATE (P-171) liga a GUC de fato
      const v = await um<{ d: string }>(
        c,
        `select pg_get_functiondef('public.parcela_voltar_vencimento_automatico(uuid)'::regprocedure) d`,
      );
      expect(v.d).toMatch(
        /set_config\('app\.parcelas_sistema', 'on', true\);\s*UPDATE public\.parcelas/,
      );
    });
  });

  it("L1: parcela de OUTRA loja com a mesma OC/nº não consome a data guardada", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const oc = await ocTecido(c, fx);
      const antes = await parcelas(c, "tecido", oc);
      await ajustarAMao(c, antes[2].id, "2027-03-03");
      await c.query(`select public._desmarcar_recebimento_oc_core('tecido', $1)`, [oc]);
      const outra = await um<{ id: string }>(
        c,
        `select id from tenants where id <> $1 order by id limit 1`,
        [TENANT_TESTE],
      );
      await c.query(`select set_config('request.jwt.claims', '', true)`); // sem JWT: o set_tenant_id não troca a loja
      await c.query(
        `insert into parcelas (tenant_id, tipo_oc, oc_tecido_id, numero_parcela, valor, data_vencimento, status)
         values ($1, 'tecido', $2, 3, 1, '2026-01-01', 'a_pagar')`,
        [outra.id, oc],
      );
      const intrusa = await um<{ d: string; m: boolean }>(
        c,
        `select to_char(data_vencimento,'YYYY-MM-DD') d, vencimento_manual m from parcelas where oc_tecido_id = $1 and tenant_id = $2`,
        [oc, outra.id],
      );
      expect(intrusa).toEqual({ d: "2026-01-01", m: false });
      expect(await guardadas(c, oc)).toEqual([{ n: 3, d: "2027-03-03" }]);
    });
  });
});

describe.skipIf(!RODA)("contas certas P-171 A — parcela_voltar_vencimento_automatico", () => {
  const SEM_PERM = "0a0a0a0a-0000-4000-8000-0000000000a1";

  async function voltar(c: Client, id: string) {
    return (
      await um<{ r: { data_vencimento: string; vencimento_manual: boolean } }>(
        c,
        `select public.parcela_voltar_vencimento_automatico($1) r`,
        [id],
      )
    ).r;
  }

  it("ACL: anon não executa; authenticated sim; DEFINER", async () => {
    await withTx(async (c) => {
      const r = await um<{ a: boolean; u: boolean; d: boolean }>(
        c,
        `select has_function_privilege('anon','public.parcela_voltar_vencimento_automatico(uuid)','EXECUTE') a,
                has_function_privilege('authenticated','public.parcela_voltar_vencimento_automatico(uuid)','EXECUTE') u,
                (select prosecdef from pg_proc where oid = 'public.parcela_voltar_vencimento_automatico(uuid)'::regprocedure) d`,
      );
      expect(r).toEqual({ a: false, u: true, d: true });
    });
  });

  it("5 famílias: a data ajustada volta EXATAMENTE à que a geradora calculou; marca limpa; valor intacto; auditado", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const casos: [Familia, string][] = [
        ["tecido", await ocTecido(c, fx)],
        ["aviamento", await ocAviamento(c, fx)],
        ["etiqueta", await ocInsumo(c, fx)],
        ["p_acabado", await ocPAcabado(c, fx)],
      ];
      const imp = await um<{ id: string } | undefined>(
        c,
        `select o.id from ocs_importado o where o.tenant_id = $1
            and exists (select 1 from parcelas p where p.oc_importado_id = o.id and p.status is distinct from 'pago' and p.data_pagamento is null)
          limit 1`,
        [TENANT_TESTE],
      );
      // R1c: as 5 famílias são obrigatórias (a cópia tem OC de importado com parcela aberta; sem ela o teste FALHA)
      if (!imp)
        throw new Error(
          "Cópia sem OC de importado com parcela aberta — o teste exige as 5 famílias",
        );
      casos.push(["p_importado", imp.id]);
      for (const [f, oc] of casos) {
        const orig = (await parcelas(c, f, oc)).find((p) => p.status !== "pago")!;
        await ajustarAMao(c, orig.id, "2028-01-31");
        const r = await voltar(c, orig.id);
        const agora = (await parcelas(c, f, oc)).find((p) => p.id === orig.id)!;
        expect([f, agora.venc, agora.manual, agora.valor]).toEqual([
          f,
          orig.venc,
          false,
          orig.valor,
        ]);
        expect(r.data_vencimento).toBe(orig.venc);
        const a = await um<{ dados: Record<string, unknown>; u: string | null }>(
          c,
          `select dados, user_id u from audit_log
            where registro_id = $1 and dados -> 'vencimento_manual' ->> 'para' = 'false' limit 1`,
          [orig.id],
        );
        expect(a.dados).toMatchObject({ vencimento_manual: { de: true, para: false } });
        expect(a.u).not.toBeNull(); // autor = quem clicou
      }
      expect(casos.map(([f]) => f)).toEqual([
        "tecido",
        "aviamento",
        "etiqueta",
        "p_acabado",
        "p_importado",
      ]);
    });
  });

  it("com a Nota de Entrada: recalcula pela Nota + prazo", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const oc = await ocTecido(c, fx);
      const p = (await parcelas(c, "tecido", oc))[1];
      await ajustarAMao(c, p.id, "2028-01-31");
      await c.query(`update ocs_tecido set data_nota_entrada = '2026-09-15' where id = $1`, [oc]);
      const nova = (await parcelas(c, "tecido", oc))[1]; // a Nota regera as parcelas (id novo), a manual ficou
      expect(nova).toMatchObject({ venc: "2028-01-31", manual: true });
      await voltar(c, nova.id);
      expect((await parcelas(c, "tecido", oc))[1]).toMatchObject({
        venc: "2026-11-14",
        manual: false,
      }); // 15/09 + 60
    });
  });

  it("parcela PAGA: P0001 parcela_paga; nada muda", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const oc = await ocTecido(c, fx);
      const p = (await parcelas(c, "tecido", oc))[0];
      await c.query(
        `update parcelas set status='pago', data_pagamento='2026-09-20' where id = $1`,
        [p.id],
      );
      await c.query("SAVEPOINT sp");
      await expect(voltar(c, p.id)).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringMatching(/^parcela_paga:/),
      });
      await c.query("ROLLBACK TO SAVEPOINT sp");
    });
  });

  it("sem permissão de editar o Financeiro: 42501; sem JWT: 42501; parcela de outra loja: P0001", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const oc = await ocTecido(c, fx);
      const p = (await parcelas(c, "tecido", oc))[0];
      await ajustarAMao(c, p.id, "2028-01-31");
      await c.query(
        `insert into auth.users (id, email) values ($1,'noperm-p171@teste') on conflict (id) do nothing`,
        [SEM_PERM],
      );
      await c.query(
        `insert into public.users (id, tenant_id, email, nome) values ($1,$2,'noperm-p171@teste','Sem Perm P171')
         on conflict (id) do update set tenant_id = excluded.tenant_id`,
        [SEM_PERM, TENANT_TESTE],
      );
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: SEM_PERM, role: "authenticated" }),
      ]);
      await c.query("SAVEPOINT a");
      await expect(voltar(c, p.id)).rejects.toMatchObject({ code: "42501" });
      await c.query("ROLLBACK TO SAVEPOINT a");
      await c.query(`select set_config('request.jwt.claims', '', true)`);
      await c.query("SAVEPOINT b");
      await expect(voltar(c, p.id)).rejects.toMatchObject({ code: "42501" });
      await c.query("ROLLBACK TO SAVEPOINT b");
      // outra loja: o usuário da Loja Teste olhando parcela de outra loja
      await comoUsuario(c);
      const outra = await um<{ id: string }>(
        c,
        `select id from tenants where id <> $1 order by id limit 1`,
        [TENANT_TESTE],
      );
      await c.query(`update parcelas set tenant_id = $2 where id = $1`, [p.id, outra.id]);
      await c.query("SAVEPOINT c");
      await expect(voltar(c, p.id)).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringMatching(/^parcela_nao_encontrada:/),
      });
      await c.query("ROLLBACK TO SAVEPOINT c");
      expect((await parcelas(c, "tecido", oc)).find((x) => x.id === p.id)?.manual).toBe(true);
    });
  });
});
