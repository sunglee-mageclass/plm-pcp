// Achados MÉDIOS R16 — RA1 (P-187 A): saldo novo com TODAS as parcelas do prazo pagas vira a parcela "complemento"
// (nº n+1, vence junto com a última parcela do prazo; some se o saldo voltar a ≤ 0 e não estiver paga; paga fica).
// Migration 20261026100000_parcela_complemento. Integração em BEGIN…ROLLBACK (withTx): nada é gravado. Só na cópia
// local (as fixtures criam OCs/blocos pelas RPCs de sempre). Sem fixture o teste FALHA alto.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";

const RODA = hasDb && ehBancoLocal();

const MD5_DEPOIS: Record<string, string> = {
  "public._recalcular_parcelas_core(uuid,text)": "3dcb59e6958c89d2d06901c50af390d7",
  "public.gerar_parcelas_oc_p_acabado()": "99865f2335e0d2392a5bd42231c22dfd",
  "public.recalcular_parcelas_etiqueta(uuid)": "2127d43b976ab54a4490abae27fd4fd8",
  "public.parcela_voltar_vencimento_automatico(uuid)": "05f05e87411e9dcb6be9aeee9602cf70",
  "public._servico_parcelas_valores(uuid)": "913a2d324244a6a0b4bacb8fa94cb049",
  "public.servicos_financeiro()": "a06f4cc32646cc41ed249d91a68dcd51",
  "public.parcela_servico_voltar_vencimento_automatico(uuid)": "9ea5069e414c736bf3dc02c22405cbeb",
};

const COL = { tecido: "oc_tecido_id", etiqueta: "oc_etiqueta_id", p_acabado: "oc_p_acabado_id" } as const;
type Familia = keyof typeof COL;
type Parc = {
  id: string;
  n: number;
  valor: string;
  venc: string;
  status: string;
  manual: boolean;
  off: number | null;
};
type Fix = { emp: string; art: string; var: string; etqId: string; etqVar: string | null };

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
  const etq = await um<{ id: string; var: string | null } | undefined>(
    c,
    `select e.id, (select v.id from variantes_etiqueta v where v.etiqueta_id = e.id order by v.id limit 1) var
       from etiquetas e where e.tenant_id = $1 order by e.id limit 1`,
    [TENANT_TESTE],
  );
  if (!emp || !tec || !etq) throw new Error("Loja Teste sem fixture (empresa / tecido / insumo)");
  return { emp: emp.id, art: tec.art, var: tec.var, etqId: etq.id, etqVar: etq.var };
}

async function parcelas(c: Client, f: Familia, ocId: string): Promise<Parc[]> {
  const { rows } = await c.query(
    `select id, numero_parcela n, valor::numeric(14,2)::text valor, to_char(data_vencimento, 'YYYY-MM-DD') venc, status,
            vencimento_manual manual, dias_offset off
       from public.parcelas where ${COL[f]} = $1 order by numero_parcela`,
    [ocId],
  );
  return rows as Parc[];
}
const centavos = (ps: Parc[]) => ps.reduce((s, p) => s + Math.round(Number(p.valor) * 100), 0);
const resumo = (ps: Parc[]) => ps.map((p) => [p.n, Number(p.valor), p.status]);
async function pagarOc(c: Client, ids: string[]) {
  await c.query(
    `update public.parcelas set status = 'pago', data_pagamento = '2026-09-20' where id = any($1::uuid[])`,
    [ids],
  );
}

async function ocTecido(c: Client, fx: Fix): Promise<string> {
  const oc = {
    numero_pedido: "R16-RA1-TEC-90001",
    empresa_id: fx.emp,
    data_prevista_entrega: "2026-09-01",
    data_entrega: "2026-09-10",
    prazo_pagamento: "30/60/90",
    quantidade_prazos: 3,
    parcelas_recebimento: [],
    valor_previsto_total: 1000,
    valor_real_total: 1000,
    status: "recebido",
  };
  const itens = [
    {
      id: null,
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
      `select public._salvar_oc_tecido_core(null::uuid, $1::jsonb, $2::jsonb, null::int) as id`,
      [JSON.stringify(oc), JSON.stringify(itens)],
    )
  ).id;
}
/** Total novo da OC de tecido (o gatilho trg_recalc_parcelas_valor recalcula) + recalcular explícito (idempotente). */
async function totalTecido(c: Client, oc: string, total: number) {
  await c.query(`update public.ocs_tecido set valor_real_total = $2 where id = $1`, [oc, total]);
  await c.query(`select public.recalcular_parcelas($1, 'tecido')`, [oc]);
}
async function ocInsumo(c: Client, fx: Fix): Promise<string> {
  const oc = {
    numero_pedido: "R16-RA1-INS-90001",
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
  };
  const itens = [
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
      `select public.salvar_oc_etiqueta(null::uuid, $1::jsonb, $2::jsonb, null::int) as id`,
      [JSON.stringify(oc), JSON.stringify(itens)],
    )
  ).id;
}
async function ocPAcabado(c: Client, fx: Fix, qtd: number, id: string | null = null): Promise<string> {
  const dados = {
    nome_produto: "R16-RA1-PA",
    empresa_id: fx.emp,
    data_pedido: "2026-09-01",
    prazo_pagamento: "30/60/90",
    qtd_total: qtd,
    valor_unitario: 100,
    desconto_pct: 0,
    grade_proporcao: {},
    variantes: [],
  };
  const grade = { "1": { P: { pedida: qtd, recebida: 0, defeito: 0 } } };
  return (
    await um<{ id: string }>(
      c,
      `select public._salvar_oc_p_acabado_core($1::uuid, $2::jsonb, $3::jsonb, null::int) as id`,
      [id, JSON.stringify(dados), JSON.stringify(grade)],
    )
  ).id;
}
async function voltarOc(c: Client, id: string) {
  return (
    await um<{ r: { data_vencimento: string; vencimento_manual: boolean } }>(
      c,
      `select public.parcela_voltar_vencimento_automatico($1) r`,
      [id],
    )
  ).r;
}

// ───────────────────────────── serviço ─────────────────────────────
type ParcS = { id: string; n: number; venc: string | null; status: string; manual: boolean; vp: string | null };
async function bloco(c: Client, prazo: string) {
  await comoUsuario(c);
  const m = await um<{ id: string }>(
    c,
    `insert into modelos (tenant_id, nome) values ($1,'M R16-RA1') returning id`,
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
    [TENANT_TESTE, `Bordado R16-RA1 ${m.id.slice(0, 8)}`],
  );
  const emp = await um<{ id: string }>(
    c,
    `insert into empresas (tenant_id, nome_fantasia, tipo, prazo_pagamento) values ($1,'Emp R16-RA1','servico',$2) returning id`,
    [TENANT_TESTE, prazo],
  );
  const pt = await um<{ id: string }>(
    c,
    `insert into producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, empresa_id, ativo, interno,
                                         preco_metro_unidade, quantidade_enviada, numero_parcelas, data_enviado, data_entregue)
     values ($1,$2,$3,$4,true,false,10,10,2,'2026-09-01','2026-09-10') returning id`,
    [cad.id, TENANT_TESTE, cat.id, emp.id],
  );
  return pt.id;
}
/** "Abrir a tela": sincroniza as parcelas e devolve as linhas do bloco (como o Financeiro › Serviços). */
async function tela(c: Client, pt: string) {
  const r = await um<{ j: any[] }>(c, `select public.servicos_financeiro() as j`);
  return (r.j ?? [])
    .filter((l) => l.producao_terceirizado_id === pt)
    .map((l) => ({
      n: Number(l.numero_parcela),
      valor: Number(l.valor_parcela),
      status: l.status as string,
      venc: l.data_vencimento as string | null,
      de: Number(l.numero_parcelas),
    }))
    .sort((a, b) => a.n - b.n);
}
async function parcelasS(c: Client, pt: string): Promise<ParcS[]> {
  return (
    await c.query(
      `select id, numero_parcela n, to_char(data_vencimento,'YYYY-MM-DD') venc, status, vencimento_manual manual,
              valor_pago::text vp
         from parcelas_servico where producao_terceirizado_id = $1 order by numero_parcela`,
      [pt],
    )
  ).rows as ParcS[];
}
async function pagarS(c: Client, pt: string, n: number) {
  await c.query(
    `update parcelas_servico set status='pago', data_pagamento='2026-09-20'
      where producao_terceirizado_id=$1 and numero_parcela=$2`,
    [pt, n],
  );
}
async function multa(c: Client, pt: string, v: number) {
  await c.query(`update producao_terceirizados set multa_total = $2 where id = $1`, [pt, v]);
}

describe.skipIf(!RODA)("R16 RA1 — parcela complemento (P-187 A)", () => {
  it("migration aplicada: md5 de depois nas 7 funções; ACL (internos sem anon/authenticated; RPCs só authenticated)", async () => {
    await withTx(async (c) => {
      for (const [sig, md5] of Object.entries(MD5_DEPOIS)) {
        const r = await um<{ m: string; anon: boolean; auth: boolean; pub: boolean }>(
          c,
          `select md5(pg_get_functiondef(to_regprocedure($1))) m,
                  has_function_privilege('anon', $1, 'EXECUTE') anon,
                  has_function_privilege('authenticated', $1, 'EXECUTE') auth,
                  exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                          where p.oid = to_regprocedure($1) and x.grantee = 0 and x.privilege_type = 'EXECUTE') pub`,
          [sig],
        );
        expect(r.m, sig).toBe(md5);
        if (sig.includes("._")) expect([r.anon, r.auth, r.pub], sig).toEqual([false, false, false]);
        if (/servicos_financeiro|voltar_vencimento/.test(sig))
          expect([r.anon, r.auth, r.pub], sig).toEqual([false, true, false]);
      }
    });
  });

  it("TECIDO: tudo pago + total sobe → complemento nº 4 com a diferença, vencendo com a nº 3; Σ = total", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const oc = await ocTecido(c, fx);
      const p = await parcelas(c, "tecido", oc);
      expect(p.map((x) => x.venc)).toEqual(["2026-10-10", "2026-11-09", "2026-12-09"]);
      await pagarOc(c, p.map((x) => x.id));
      await totalTecido(c, oc, 1200);
      const ps = await parcelas(c, "tecido", oc);
      expect(resumo(ps)).toEqual([
        [1, 333.33, "pago"],
        [2, 333.33, "pago"],
        [3, 333.34, "pago"],
        [4, 200, "a_pagar"],
      ]);
      expect(ps[3]).toMatchObject({ venc: "2026-12-09", manual: false, off: 90 });
      expect(centavos(ps)).toBe(120000);
    });
  });

  it("TECIDO: saldo volta a ≤ 0 → complemento NÃO pago some; volta a subir → renasce com o mesmo nº", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const oc = await ocTecido(c, fx);
      await pagarOc(c, (await parcelas(c, "tecido", oc)).map((x) => x.id));
      await totalTecido(c, oc, 1200);
      expect((await parcelas(c, "tecido", oc)).map((x) => x.n)).toEqual([1, 2, 3, 4]);
      await totalTecido(c, oc, 1000);
      expect((await parcelas(c, "tecido", oc)).map((x) => x.n)).toEqual([1, 2, 3]);
      await totalTecido(c, oc, 900); // pago > total: nada negativo
      expect((await parcelas(c, "tecido", oc)).map((x) => x.n)).toEqual([1, 2, 3]);
      await totalTecido(c, oc, 1150);
      expect(resumo(await parcelas(c, "tecido", oc)).slice(3)).toEqual([[4, 150, "a_pagar"]]);
    });
  });

  it("TECIDO: complemento PAGO fica; novo aumento → nº 5 com a nova diferença", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const oc = await ocTecido(c, fx);
      await pagarOc(c, (await parcelas(c, "tecido", oc)).map((x) => x.id));
      await totalTecido(c, oc, 1200);
      const p4 = (await parcelas(c, "tecido", oc))[3];
      await pagarOc(c, [p4.id]);
      await totalTecido(c, oc, 1300);
      let ps = await parcelas(c, "tecido", oc);
      expect(resumo(ps).slice(3)).toEqual([
        [4, 200, "pago"],
        [5, 100, "a_pagar"],
      ]);
      expect(ps[4].venc).toBe("2026-12-09");
      expect(centavos(ps)).toBe(130000);
      // total cai abaixo do pago: o 5 (não pago) some, o 4 (pago) fica
      await totalTecido(c, oc, 1000);
      ps = await parcelas(c, "tecido", oc);
      expect(resumo(ps).slice(3)).toEqual([[4, 200, "pago"]]);
    });
  });

  it("TECIDO: com parcela do prazo em aberto NÃO há complemento (a diferença vai para as abertas, como antes)", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const oc = await ocTecido(c, fx);
      const p = await parcelas(c, "tecido", oc);
      await pagarOc(c, [p[0].id, p[1].id]);
      await totalTecido(c, oc, 1200);
      const ps = await parcelas(c, "tecido", oc);
      expect(resumo(ps)).toEqual([
        [1, 333.33, "pago"],
        [2, 333.33, "pago"],
        [3, 533.34, "a_pagar"],
      ]);
    });
  });

  it("TECIDO: data do complemento ajustada À MÃO fica no recálculo (guarda/reaplica por nº); 'Voltar ao automático' = data da nº 3", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const oc = await ocTecido(c, fx);
      await pagarOc(c, (await parcelas(c, "tecido", oc)).map((x) => x.id));
      await totalTecido(c, oc, 1200);
      const p4 = (await parcelas(c, "tecido", oc))[3];
      await c.query(`update public.parcelas set data_vencimento = '2027-01-15' where id = $1`, [p4.id]);
      await totalTecido(c, oc, 1250);
      let q4 = (await parcelas(c, "tecido", oc))[3];
      expect(q4).toMatchObject({ n: 4, venc: "2027-01-15", manual: true, valor: "250.00" });
      const r = await voltarOc(c, q4.id);
      expect(r).toMatchObject({ data_vencimento: "2026-12-09", vencimento_manual: false });
      await totalTecido(c, oc, 1250);
      q4 = (await parcelas(c, "tecido", oc))[3];
      expect(q4).toMatchObject({ n: 4, venc: "2026-12-09", manual: false });
    });
  });

  it("P. ACABADO (gatilho de TODO save): complemento nasce no save que sobe o total e sobrevive a re-save; some ao voltar", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const oc = await ocPAcabado(c, fx, 10);
      const p = await parcelas(c, "p_acabado", oc);
      expect(p.map((x) => x.venc)).toEqual(["2026-10-01", "2026-10-31", "2026-11-30"]);
      await pagarOc(c, p.map((x) => x.id));
      await ocPAcabado(c, fx, 12, oc);
      let ps = await parcelas(c, "p_acabado", oc);
      expect(resumo(ps).slice(3)).toEqual([[4, 200, "a_pagar"]]);
      expect(ps[3].venc).toBe("2026-11-30");
      // recalcular_parcelas (core) e o gatilho dão o MESMO complemento
      await c.query(`select public.recalcular_parcelas($1, 'p_acabado')`, [oc]);
      ps = await parcelas(c, "p_acabado", oc);
      expect(resumo(ps).slice(3)).toEqual([[4, 200, "a_pagar"]]);
      expect(ps[3].venc).toBe("2026-11-30");
      expect((await voltarOc(c, ps[3].id)).data_vencimento).toBe("2026-11-30");
      await ocPAcabado(c, fx, 10, oc);
      expect((await parcelas(c, "p_acabado", oc)).map((x) => x.n)).toEqual([1, 2, 3]);
    });
  });

  it("INSUMO (recalcular_parcelas_etiqueta): complemento nº 3 vencendo com a nº 2", async () => {
    await withTx(async (c) => {
      const fx = await prepara(c);
      const oc = await ocInsumo(c, fx);
      const p = await parcelas(c, "etiqueta", oc);
      expect(p.map((x) => x.venc)).toEqual(["2026-10-10", "2026-11-09"]);
      await pagarOc(c, p.map((x) => x.id));
      await c.query(`update ocs_etiqueta_itens set quantidade_recebida = 120 where oc_etiqueta_id = $1`, [oc]);
      await c.query(`select public.recalcular_parcelas_etiqueta($1)`, [oc]);
      const ps = await parcelas(c, "etiqueta", oc);
      expect(resumo(ps)).toEqual([
        [1, 125, "pago"],
        [2, 125, "pago"],
        [3, 50, "a_pagar"],
      ]);
      expect(ps[2].venc).toBe("2026-11-09");
      expect((await voltarOc(c, ps[2].id)).data_vencimento).toBe("2026-11-09");
    });
  });

  it("SERVIÇO: tudo pago + multa → complemento nº 3 (aparece na tela 3/2), vence com a nº 2; multa zera → some", async () => {
    await withTx(async (c) => {
      const pt = await bloco(c, "30/60");
      expect((await tela(c, pt)).map((l) => [l.n, l.valor, l.venc])).toEqual([
        [1, 50, "2026-10-10"],
        [2, 50, "2026-11-09"],
      ]);
      await pagarS(c, pt, 1);
      await pagarS(c, pt, 2);
      await multa(c, pt, 20);
      let ls = await tela(c, pt);
      expect(ls.map((l) => [l.n, l.valor, l.status, l.venc, l.de])).toEqual([
        [1, 50, "pago", "2026-10-10", 2],
        [2, 50, "pago", "2026-11-09", 2],
        [3, 20, "a_pagar", "2026-11-09", 2],
      ]);
      const v = (
        await c.query(`select numero_parcela n, valor::numeric(14,2)::text v from public._servico_parcelas_valores($1) order by 1`, [pt])
      ).rows;
      expect(v).toEqual([
        { n: 1, v: "50.00" },
        { n: 2, v: "50.00" },
        { n: 3, v: "20.00" },
      ]);
      await multa(c, pt, 0);
      ls = await tela(c, pt);
      expect(ls.map((l) => l.n)).toEqual([1, 2]);
      expect((await parcelasS(c, pt)).map((p) => p.n)).toEqual([1, 2]);
    });
  });

  it("SERVIÇO: complemento PAGO congela o valor (valor_pago); nova multa → nº 4 com a nova diferença", async () => {
    await withTx(async (c) => {
      const pt = await bloco(c, "30/60");
      await tela(c, pt);
      await pagarS(c, pt, 1);
      await pagarS(c, pt, 2);
      await multa(c, pt, 20);
      await tela(c, pt);
      await pagarS(c, pt, 3);
      expect((await parcelasS(c, pt))[2]).toMatchObject({ n: 3, status: "pago", vp: "20.00" });
      await multa(c, pt, 30);
      const ls = await tela(c, pt);
      expect(ls.map((l) => [l.n, l.valor, l.status])).toEqual([
        [1, 50, "pago"],
        [2, 50, "pago"],
        [3, 20, "pago"],
        [4, 10, "a_pagar"],
      ]);
      expect(ls.reduce((s, l) => s + l.valor, 0)).toBe(130);
    });
  });

  it("SERVIÇO: data do complemento ajustada À MÃO fica quando a entrega muda; 'Voltar ao automático' = data da nº 2", async () => {
    await withTx(async (c) => {
      const pt = await bloco(c, "30/60");
      await tela(c, pt);
      await pagarS(c, pt, 1);
      await pagarS(c, pt, 2);
      await multa(c, pt, 20);
      await tela(c, pt);
      const p3 = (await parcelasS(c, pt))[2];
      await c.query(`update parcelas_servico set data_vencimento = '2027-02-01' where id = $1`, [p3.id]);
      await c.query(`update producao_terceirizados set data_entregue = '2026-09-20' where id = $1`, [pt]);
      await tela(c, pt);
      expect((await parcelasS(c, pt))[2]).toMatchObject({ n: 3, venc: "2027-02-01", manual: true });
      const r = (
        await um<{ r: { data_vencimento: string; vencimento_manual: boolean } }>(
          c,
          `select public.parcela_servico_voltar_vencimento_automatico($1) r`,
          [p3.id],
        )
      ).r;
      expect(r).toMatchObject({ data_vencimento: "2026-11-19", vencimento_manual: false });
      // não manual: acompanha a entrega na próxima leitura
      await c.query(`update producao_terceirizados set data_entregue = '2026-09-25' where id = $1`, [pt]);
      await tela(c, pt);
      expect((await parcelasS(c, pt))[2]).toMatchObject({ n: 3, venc: "2026-11-24", manual: false });
    });
  });

  it("SERVIÇO: prazo cresce (30/60 → 30/60/90) com o complemento em aberto → vira a nº 3 do prazo (sem duplicar)", async () => {
    await withTx(async (c) => {
      const pt = await bloco(c, "30/60");
      await tela(c, pt);
      await pagarS(c, pt, 1);
      await pagarS(c, pt, 2);
      await multa(c, pt, 20);
      await tela(c, pt);
      await c.query(
        `update empresas set prazo_pagamento = '30/60/90'
          where id = (select empresa_id from producao_terceirizados where id = $1)`,
        [pt],
      );
      const ls = await tela(c, pt);
      expect(ls.map((l) => [l.n, l.valor, l.status, l.venc, l.de])).toEqual([
        [1, 50, "pago", "2026-10-10", 3],
        [2, 50, "pago", "2026-11-09", 3],
        [3, 20, "a_pagar", "2026-12-09", 3],
      ]);
    });
  });
});
