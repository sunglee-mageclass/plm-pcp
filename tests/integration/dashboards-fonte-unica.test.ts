import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, USER_TESTE } from "./db";

// Achados MEDIOS R12 (Dashboards) — migration 20261022100000_dashboards_fonte_unica.
//   preço M3  custo do dashboard = custo_unitario_modelos (fonte única: revenda/importado pela compra/landed);
//   prod #2   "Lançado" = modelos.lancado sozinho; comprado lançado sai de Planejamento/Desenvolvimento;
//   prod #6   aprovadoNaoLancado (coluna "Aprovado" sem os lançados — Blusa Master sai);
//   prod #7   P-185 A (literal): a última coluna do quadro é o ponto de chegada e NUNCA conta tempo (aberto ou fechado).
// Tudo em txn revertida (nada grava). Sem fixture o teste FALHA alto (nunca passa vazio).

const MD5_DEPOIS: Record<string, string> = {
  "public._dashboard_custos_core(date,date,text,uuid,uuid)": "177263673f730f333b2870acd59e8859",
  "public._dashboard_colecao_core(date,date,text,uuid,uuid)": "5dbe4d89fcaf1c1b77860cb3a8e132c8",
  "public._dashboard_producao_core(date,date,text,uuid)": "17424a059ae47674e244701f5a0fbfe4",
  "public._dashboard_leadtime_core()": "520312bb84b32f35b63f056e93d51c54",
  "public._dashboard_leadtime_itens_core(uuid,text,text)": "e90d44175464c66e6576f0f8a4bea1dd",
};
// _custo_unitario_modelos_core: a R12 não mexe nela; a R16 (20261026200000, P-186 A + R12 INFO 6 + preço M1) troca
// d26c7c9a… → d4127722… (o inverso da R16 roda antes do da R12).
const MD5_INTOCADA = "d41277224a6a74192e2b50a12740ea9a";

/** Troca a loja ativa do usuário de teste (só na txn revertida). */
async function naLoja(c: Client, tenant: string) {
  await comoUsuario(c);
  await c.query("UPDATE public.users SET tenant_id = $1 WHERE id = $2", [tenant, USER_TESTE]);
}

async function rpc<T = any>(c: Client, sql: string, params: any[] = []): Promise<T> {
  return (await um<{ r: T }>(c, `select ${sql} r`, params)).r;
}

async function novoModelo(c: Client, campos: Record<string, any>): Promise<string> {
  const cols = ["tenant_id", "nome", ...Object.keys(campos)];
  const vals = [TENANT_TESTE, "ITEST-R12", ...Object.values(campos)];
  const ph = vals.map((_, i) => `$${i + 1}`).join(",");
  return (
    await um<{ id: string }>(
      c,
      `insert into modelos (${cols.join(",")}) values (${ph}) returning id`,
      vals,
    )
  ).id;
}

describe.skipIf(!hasDb)("R12 — dashboards na fonte única", () => {
  it("md5 de depois nas 5 funções, _custo_unitario_modelos_core intocada, ACL inv. #9", async () => {
    await withTx(async (c) => {
      for (const [sig, md5] of Object.entries(MD5_DEPOIS)) {
        const r = await um<{
          md5: string;
          vol: string;
          anon: boolean;
          auth: boolean;
          pub: boolean;
        }>(
          c,
          `select md5(pg_get_functiondef(to_regprocedure($1))) md5, p.provolatile vol,
                  has_function_privilege('anon', $1, 'EXECUTE') anon,
                  has_function_privilege('authenticated', $1, 'EXECUTE') auth,
                  exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                          where x.grantee = 0 and x.privilege_type = 'EXECUTE') pub
             from pg_proc p where p.oid = to_regprocedure($1)`,
          [sig],
        );
        expect(r, sig).toBeTruthy();
        expect(r.md5, sig).toBe(md5);
        expect(r.vol, sig).toBe("s");
        expect(r.anon || r.auth || r.pub, sig).toBe(false);
      }
      const cu = await um<{ m: string }>(
        c,
        `select md5(pg_get_functiondef('public._custo_unitario_modelos_core(uuid[])'::regprocedure)) m`,
      );
      expect(cu.m).toBe(MD5_INTOCADA);
      // wrappers seguem chamáveis pela tela
      for (const w of [
        "public.dashboard_custos(date,date,text,uuid,uuid)",
        "public.dashboard_colecao(date,date,text,uuid,uuid)",
        "public.dashboard_producao(date,date,text,uuid)",
        "public.dashboard_leadtime()",
        "public.dashboard_leadtime_itens(uuid,text,text)",
      ]) {
        const g = await um<{ a: boolean; n: boolean }>(
          c,
          `select has_function_privilege('authenticated',$1,'EXECUTE') a, has_function_privilege('anon',$1,'EXECUTE') n`,
          [w],
        );
        expect(g.a, w).toBe(true);
        expect(g.n, w).toBe(false);
      }
    });
  });

  it("preço M3: custo do dashboard = custo_unitario_modelos em TODOS os modelos de TODAS as lojas", async () => {
    await withTx(async (c) => {
      const lojas = (
        await c.query(
          `select t.id, t.nome, count(m.id)::int n from tenants t join modelos m on m.tenant_id = t.id group by 1,2 order by 2`,
        )
      ).rows;
      if (lojas.length === 0) throw new Error("fixture ausente: nenhuma loja com modelos");
      let comparados = 0;
      const vistos = new Map<string, any>();
      for (const loja of lojas) {
        await naLoja(c, loja.id);
        const rows: any[] = (await rpc(c, `public._dashboard_custos_core()`))?.rows ?? [];
        expect(rows.length, `todos os modelos da ${loja.nome}`).toBe(loja.n);
        const ids = rows.map((r) => r.id);
        const cu = await rpc<Record<string, any>>(c, `public.custo_unitario_modelos($1::uuid[])`, [
          ids,
        ]);
        for (const r of rows) {
          const f = cu[r.id];
          expect(f, `${loja.nome} ${r.nome}`).toBeTruthy();
          expect(Number(r.previsto), `previsto ${loja.nome} ${r.nome}`).toBeCloseTo(
            Number(f.previsto),
            9,
          );
          expect(r.confirmado, `confirmado ${loja.nome} ${r.nome}`).toBe(f.confirmado);
          // real nulo na fonte (compra ainda não recebida) → o dashboard mostra o previsto (a tela esconde: não confirmado)
          const realEsperado = f.real == null ? Number(f.previsto) : Number(f.real);
          expect(Number(r.real), `real ${loja.nome} ${r.nome}`).toBeCloseTo(realEsperado, 9);
          if (r.confirmado) expect(f.real, `confirmado tem real ${r.nome}`).not.toBeNull();
          vistos.set(r.id, r);
          comparados++;
        }
      }
      expect(comparados).toBeGreaterThan(100);
      // âncoras do plano: revenda Vestido Teste 29,89 e importado QA T25 104,04 (Loja Teste)
      const ancoras = (
        await c.query(
          `select id, nome, origem from modelos where tenant_id = $1 and
           ((nome = 'Vestido Teste' and origem = 'revenda') or (nome = 'QA T25 importado' and origem = 'importado'))`,
          [TENANT_TESTE],
        )
      ).rows;
      if (ancoras.length !== 2)
        throw new Error("fixture ausente: Vestido Teste (revenda) e QA T25 importado");
      for (const a of ancoras) {
        const r = vistos.get(a.id);
        expect(r, a.nome).toBeTruthy();
        expect(Number(r.previsto), a.nome).toBeCloseTo(
          a.origem === "revenda" ? 29.891 : 104.0373,
          3,
        );
      }
    });
  });

  it("prod #2: comprado lançado conta como Lançado e sai de Planejamento/Desenvolvimento; comprado com CAD = Em Produção", async () => {
    await withTx(async (c) => {
      await naLoja(c, TENANT_TESTE);
      const k = async () => await rpc(c, `public._dashboard_colecao_core()`);
      const k0 = await k();
      // 1) revenda LANÇADA (sem enviado_cad, sem CAD — como os 59 comprados de hoje), planejada
      await novoModelo(c, { origem: "revenda", lancado: true, status_planejamento: "planejado" });
      const k1 = await k();
      expect(k1.kpis.total).toBe(k0.kpis.total + 1);
      expect(k1.kpis.lancados).toBe(k0.kpis.lancados + 1); // antes: 0 (exigia enviado_cad)
      expect(k1.kpis.planejamento).toBe(k0.kpis.planejamento);
      expect(k1.kpis.desenvolvimento).toBe(k0.kpis.desenvolvimento); // antes: +1
      expect(k1.kpis.producao).toBe(k0.kpis.producao);
      const fun = (x: any, n: string) => Number(x.funnel.find((f: any) => f.name === n)?.value);
      expect(fun(k1, "Lançados")).toBe(fun(k0, "Lançados") + 1);
      expect(fun(k1, "Produção")).toBe(fun(k0, "Produção") + 1); // funil monotônico: lançado passou da produção
      const semLinha = (x: any) =>
        x.porLinha.find((l: any) => l.linha_id == null) ?? { lancados: 0, desenvolvimento: 0 };
      expect(semLinha(k1).lancados).toBe(semLinha(k0).lancados + 1);
      expect(semLinha(k1).desenvolvimento).toBe(semLinha(k0).desenvolvimento);
      // 2) importado NÃO lançado com CAD (o receber materializa o CAD) → Em Produção
      const imp = await novoModelo(c, { origem: "importado", status_planejamento: "planejado" });
      await c.query(`insert into cad (tenant_id, modelo_id) values ($1,$2)`, [TENANT_TESTE, imp]);
      const k2 = await k();
      expect(k2.kpis.producao).toBe(k1.kpis.producao + 1); // antes: +0 (ia para Desenvolvimento)
      expect(k2.kpis.desenvolvimento).toBe(k1.kpis.desenvolvimento);
      // 3) interno com CAD mas SEM enviado_cad → continua fora de Produção (como antes)
      const int = await novoModelo(c, { origem: "interno", status_planejamento: "planejado" });
      await c.query(`insert into cad (tenant_id, modelo_id) values ($1,$2)`, [TENANT_TESTE, int]);
      const k3 = await k();
      expect(k3.kpis.producao).toBe(k2.kpis.producao);
      expect(k3.kpis.desenvolvimento).toBe(k2.kpis.desenvolvimento + 1);
      // 4) (fix round 2) revenda NÃO lançada e SEM CAD → fica em Desenvolvimento (planejada), não em Produção
      await novoModelo(c, { origem: "revenda", status_planejamento: "planejado" });
      const k4 = await k();
      expect(k4.kpis.desenvolvimento).toBe(k3.kpis.desenvolvimento + 1);
      expect(k4.kpis.producao).toBe(k3.kpis.producao);
      expect(k4.kpis.lancados).toBe(k3.kpis.lancados);
      // 5) (fix round 2) comprado LANÇADO e COM CAD → Lançados, não Produção
      const impLanc = await novoModelo(c, {
        origem: "importado",
        status_planejamento: "planejado",
        lancado: true,
      });
      await c.query(`insert into cad (tenant_id, modelo_id) values ($1,$2)`, [
        TENANT_TESTE,
        impLanc,
      ]);
      const k5 = await k();
      expect(k5.kpis.lancados).toBe(k4.kpis.lancados + 1);
      expect(k5.kpis.producao).toBe(k4.kpis.producao);
      expect(k5.kpis.desenvolvimento).toBe(k4.kpis.desenvolvimento);
      expect(fun(k5, "Produção")).toBe(fun(k4, "Produção") + 1); // funil: lançado passou da produção
      // invariante de partição: os 4 baldes somam o total
      for (const x of [k0, k1, k2, k3, k4, k5]) {
        expect(
          x.kpis.planejamento + x.kpis.desenvolvimento + x.kpis.producao + x.kpis.lancados,
        ).toBe(x.kpis.total);
      }
    });
  });

  it("prod #6: aprovadoNaoLancado exclui a Blusa Master (aprovada E lançada); o gráfico kanbanDev não muda", async () => {
    await withTx(async (c) => {
      await naLoja(c, TENANT_TESTE);
      const bm = await um<{ id: string } | undefined>(
        c,
        `select id from modelos where tenant_id=$1 and nome='Blusa Master' and lancado
              and status_desenvolvimento='aprovado' and status_planejamento='planejado'`,
        [TENANT_TESTE],
      );
      if (!bm) throw new Error("fixture ausente: Blusa Master (Loja Teste) aprovada e lançada");
      const p0 = await rpc(c, `public._dashboard_producao_core()`);
      const col = (p0.kanbanDev as any[]).find((k) => k.key === "aprovado");
      if (!col) throw new Error("fixture ausente: coluna 'aprovado' no quadro da Loja Teste");
      const lancAprov = Number(
        (
          await um<{ n: string }>(
            c,
            `select count(*) n from modelos where tenant_id=$1 and status_planejamento='planejado'
              and status_desenvolvimento='aprovado' and lancado`,
            [TENANT_TESTE],
          )
        ).n,
      );
      expect(lancAprov).toBeGreaterThanOrEqual(1);
      expect(typeof p0.aprovadoNaoLancado).toBe("number"); // antes: chave ausente
      expect(p0.aprovadoNaoLancado).toBe(Number(col.modelos) - lancAprov);
      // novo aprovado NÃO lançado entra; aprovado lançado não
      await novoModelo(c, { status_planejamento: "planejado", status_desenvolvimento: "aprovado" });
      await novoModelo(c, {
        status_planejamento: "planejado",
        status_desenvolvimento: "aprovado",
        lancado: true,
      });
      const p1 = await rpc(c, `public._dashboard_producao_core()`);
      expect(p1.aprovadoNaoLancado).toBe(p0.aprovadoNaoLancado + 1);
      expect(Number((p1.kanbanDev as any[]).find((k) => k.key === "aprovado").modelos)).toBe(
        Number(col.modelos) + 2,
      );
    });
  });

  it("prod #7 (P-185 A, literal): a última coluna do quadro NUNCA conta (aberto nem fechado); meio e status fora do quadro seguem", async () => {
    await withTx(async (c) => {
      await naLoja(c, TENANT_TESTE);
      const quadro = (
        await c.query(`select key, ord from public._kanban_status_rows($1) order by ord`, [
          TENANT_TESTE,
        ])
      ).rows as { key: string; ord: number }[];
      if (quadro.length < 2) throw new Error("fixture ausente: quadro da Loja Teste");
      const ult = quadro[quadro.length - 1].key;
      const meio = "em_modelagem";
      const fora = "r12_status_fora_do_quadro";
      if (!quadro.some((q) => q.key === meio))
        throw new Error("fixture ausente: em_modelagem no quadro");
      if (ult === meio) throw new Error("fixture inesperada: última coluna = em_modelagem");
      if (quadro.some((q) => q.key === fora))
        throw new Error("fixture inesperada: status de teste no quadro");
      await c.query(
        `update tenant_config set leadtime = jsonb_build_object('etapas', jsonb_build_array(
           jsonb_build_object('key','kanban:'||$2::text,'tipo','kanban','idealDias',5),
           jsonb_build_object('key','kanban:'||$3::text,'tipo','kanban','idealDias',5),
           jsonb_build_object('key','kanban:'||$4::text,'tipo','kanban','idealDias',5))) where tenant_id = $1`,
        [TENANT_TESTE, ult, meio, fora],
      );
      const etapa = (x: any, k: string) =>
        (x.etapas as any[]).find((e) => e.etapa === "kanban:" + k);
      const nDe = (x: any, k: string) => Number(etapa(x, k)?.nModelos ?? 0);
      const l0 = await rpc(c, `public._dashboard_leadtime_core()`);
      const hist = async (mod: string, passos: [string, number][]) => {
        await c.query(`delete from modelo_kanban_historico where modelo_id = $1`, [mod]);
        for (const [st, diasAtras] of passos) {
          await c.query(
            `insert into modelo_kanban_historico (tenant_id, modelo_id, status, entrou_at) values ($1,$2,$3, now() - ($4 || ' days')::interval)`,
            [TENANT_TESTE, mod, st, String(diasAtras)],
          );
        }
      };
      // M1: meio há 110d → última coluna há 100d e PARADO lá (trecho ABERTO na última: conta 0)
      const m1 = await novoModelo(c, {});
      await hist(m1, [
        [meio, 110],
        [ult, 100],
      ]);
      // M2: parado no MEIO há 50d (trecho aberto fora da última: continua contando até hoje)
      const m2 = await novoModelo(c, {});
      await hist(m2, [[meio, 50]]);
      // M3: passou pela última coluna e VOLTOU (trecho FECHADO de 10d na última: conta 0)
      const m3 = await novoModelo(c, {});
      await hist(m3, [
        [ult, 30],
        [meio, 20],
      ]);
      // M4: status ANTIGO fora do quadro atual (fechado 15d + aberto 25d noutro card): segue contando
      const m4 = await novoModelo(c, {});
      await hist(m4, [
        [fora, 60],
        [meio, 45],
      ]);
      const m5 = await novoModelo(c, {});
      await hist(m5, [[fora, 25]]);

      const itens: any[] = (await rpc(c, `public._dashboard_leadtime_itens_core()`)).itens;
      const dur = (id: string) => itens.find((i) => i.modelo_id === id)?.duracoes ?? {};
      // fechado no MEIO conta (fecha quando o card ENTRA na última)
      expect(Number(dur(m1)["kanban:" + meio])).toBeCloseTo(10, 0);
      expect(dur(m1)["kanban:" + ult]).toBeUndefined(); // antes: ~100 dias até now()
      expect(Number(dur(m2)["kanban:" + meio])).toBeCloseTo(50, 0);
      expect(dur(m3)["kanban:" + ult]).toBeUndefined(); // antes: 10 dias (fechado)
      expect(Number(dur(m3)["kanban:" + meio])).toBeCloseTo(20, 0);
      expect(Number(dur(m4)["kanban:" + fora])).toBeCloseTo(15, 0);
      expect(Number(dur(m4)["kanban:" + meio])).toBeCloseTo(45, 0);
      expect(Number(dur(m5)["kanban:" + fora])).toBeCloseTo(25, 0);

      const l1 = await rpc(c, `public._dashboard_leadtime_core()`);
      // a última coluna não ganha NENHUM trecho (antes: +2, M1 aberto e M3 fechado)
      expect(nDe(l1, ult)).toBe(nDe(l0, ult));
      // o meio ganha 4 trechos (M1 fechado, M2 aberto, M3 aberto, M4 aberto); o fora do quadro ganha 2
      expect(nDe(l1, meio)).toBe(nDe(l0, meio) + 4);
      expect(nDe(l1, fora)).toBe(nDe(l0, fora) + 2);
    });
  });

  it("prod #7 (fix round 2): card cujo ÚNICO histórico é a última coluna fica em leadtime_itens, sem etapas (quadro da loja)", async () => {
    await withTx(async (c) => {
      await naLoja(c, TENANT_TESTE);
      const ult = await um<{ key: string } | undefined>(
        c,
        `select key from public._kanban_status_rows($1) order by ord desc limit 1`,
        [TENANT_TESTE],
      );
      if (!ult) throw new Error("fixture ausente: quadro da Loja Teste");
      const m = await novoModelo(c, { colecao: "ITEST-R12-COL", subcolecao: "ITEST-R12-SUB" });
      await c.query(`delete from modelo_kanban_historico where modelo_id = $1`, [m]);
      await c.query(
        `insert into modelo_kanban_historico (tenant_id, modelo_id, status, entrou_at) values ($1,$2,$3, now() - interval '30 days')`,
        [TENANT_TESTE, m, ult.key],
      );
      const itens: any[] = (await rpc(c, `public._dashboard_leadtime_itens_core()`)).itens;
      const it = itens.find((i) => i.modelo_id === m);
      expect(it, "card só com a última coluna some da matriz").toBeTruthy(); // round 1: sumia
      expect(it.duracoes).toEqual({});
      // continua alimentando o filtro coleção/subcoleção da aba Desenvolvimento (dashboard.tsx monta a lista dos itens)
      expect(it.colecao).toBe("ITEST-R12-COL");
      expect(it.subcolecao).toBe("ITEST-R12-SUB");
      // card SEM histórico nenhum segue fora (mesmo conjunto de antes)
      const semHist = await novoModelo(c, {});
      await c.query(`delete from modelo_kanban_historico where modelo_id = $1`, [semHist]);
      const itens2: any[] = (await rpc(c, `public._dashboard_leadtime_itens_core()`)).itens;
      expect(itens2.some((i) => i.modelo_id === semHist)).toBe(false);
      expect(itens2.length).toBe(itens.length);
    });
  });

  it("prod #7 (fix round 2): loja SEM config de kanban → última coluna = 'aprovado' (default) e conta 0", async () => {
    await withTx(async (c) => {
      await naLoja(c, TENANT_TESTE);
      await c.query(`update tenant_config set status_kanban = null where tenant_id = $1`, [
        TENANT_TESTE,
      ]);
      const ult = await um<{ key: string }>(
        c,
        `select key from public._kanban_status_rows($1) order by ord desc limit 1`,
        [TENANT_TESTE],
      );
      expect(ult.key).toBe("aprovado");
      await c.query(
        `update tenant_config set leadtime = jsonb_build_object('etapas', jsonb_build_array(
           jsonb_build_object('key','kanban:aprovado','tipo','kanban','idealDias',5),
           jsonb_build_object('key','kanban:em_modelagem','tipo','kanban','idealDias',5))) where tenant_id = $1`,
        [TENANT_TESTE],
      );
      const hist = async (mod: string, passos: [string, number][]) => {
        await c.query(`delete from modelo_kanban_historico where modelo_id = $1`, [mod]);
        for (const [st, diasAtras] of passos) {
          await c.query(
            `insert into modelo_kanban_historico (tenant_id, modelo_id, status, entrou_at) values ($1,$2,$3, now() - ($4 || ' days')::interval)`,
            [TENANT_TESTE, mod, st, String(diasAtras)],
          );
        }
      };
      const a = await novoModelo(c, {});
      await hist(a, [
        ["em_modelagem", 20],
        ["aprovado", 10],
      ]); // aberto no default
      const b = await novoModelo(c, {});
      await hist(b, [
        ["aprovado", 40],
        ["em_modelagem", 30],
      ]); // fechado no default
      const itens: any[] = (await rpc(c, `public._dashboard_leadtime_itens_core()`)).itens;
      // nenhum item da loja tem a etapa da última coluna default
      expect(itens.filter((i) => i.duracoes && "kanban:aprovado" in i.duracoes)).toEqual([]);
      const dur = (id: string) => itens.find((i) => i.modelo_id === id)?.duracoes ?? {};
      expect(Number(dur(a)["kanban:em_modelagem"])).toBeCloseTo(10, 0);
      expect(Number(dur(b)["kanban:em_modelagem"])).toBeCloseTo(30, 0);
      const l = await rpc(c, `public._dashboard_leadtime_core()`);
      expect((l.etapas as any[]).find((e) => e.etapa === "kanban:aprovado")).toBeUndefined();
    });
  });
});
