import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, USER_TESTE } from "./db";

// Achados LEVES L4 (Dashboards e OTB):
//   20261027200000_dashboards_funil_dev       prod #10  Desenvolvimento = ordem_criacao_enviada (inv. #11); comprado sem a
//                                                       ordem segue pelo status_planejamento; mesmo critério no kanbanDev;
//                                                       os 4 KPIs somam o total.
//   20261027210000_otb_realizado_sem_reprovado est #15  P-209 A: card reprovado (status_desenvolvimento) fora do Realizado
//                                                       do OTB; saindo de Reprovado volta a contar.
// Tudo em txn revertida (nada grava). Sem fixture o teste FALHA alto (nunca passa vazio).

const MD5_DEPOIS: Record<string, string> = {
  "public._dashboard_colecao_core(date,date,text,uuid,uuid)": "9435f724d61227a7014d95a95cf7fac5",
  "public._dashboard_producao_core(date,date,text,uuid)": "2662bae65ab7fb9c1c7cb012273481be",
  "public._otb_orcamento_core(uuid,uuid)": "33137a0e34808d098f084f3891a61913",
  "public._otb_colecao_totais(uuid)": "4e27b6098b2197ec5239118278341f12",
};

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
  const vals = [TENANT_TESTE, "ITEST-L4", ...Object.values(campos)];
  const ph = vals.map((_, i) => `$${i + 1}`).join(",");
  return (
    await um<{ id: string }>(
      c,
      `insert into modelos (${cols.join(",")}) values (${ph}) returning id`,
      vals,
    )
  ).id;
}

// Classificação esperada, calculada à parte (SQL independente da função):
//   ec   = enviado_cad, ou comprado com CAD (R12);  lanc = modelos.lancado (inv. #6);
//   dev  = ordem_criacao_enviada, ou comprado SEM a ordem com status_planejamento 'planejado' (L4 prod #10).
const ESPERADO_SQL = `
  with m as (
    select mo.id, mo.origem, mo.ordem_criacao_enviada oce, mo.status_planejamento sp,
           (coalesce(mo.enviado_cad,false) or (mo.origem in ('revenda','importado')
             and exists (select 1 from cad c where c.modelo_id = mo.id))) ec,
           coalesce(mo.lancado,false) lanc,
           (mo.ordem_criacao_enviada or (mo.origem in ('revenda','importado') and mo.status_planejamento is not distinct from 'planejado')) dev,
           (lower(coalesce(mo.status_desenvolvimento,'')) = 'reprovado'
             or lower(coalesce(mo.status_planejamento,'')) = 'reprovado') rep
      from modelos mo where mo.tenant_id = $1)
  select count(*)::int total,
         count(*) filter (where not ec and not lanc and not rep and not dev)::int planejamento,
         count(*) filter (where not ec and not lanc and not rep and dev)::int desenvolvimento,
         count(*) filter (where ec and not lanc and not rep)::int producao,
         count(*) filter (where lanc)::int lancados,
         count(*) filter (where rep and not lanc)::int reprovados,
         count(*) filter (where (ec or lanc or dev) and not (rep and not lanc))::int funil_dev,
         count(*) filter (where (ec or lanc) and not (rep and not lanc))::int funil_prod,
         count(*) filter (where dev)::int kanban_dev,
         count(*) filter (where oce and sp is distinct from 'planejado')::int oce_sp_nao_planejado,
         count(*) filter (where oce and sp is distinct from 'planejado' and not ec and not lanc and not rep)::int oce_sp_nao_planejado_dev,
         count(*) filter (where oce and sp is distinct from 'planejado' and rep and not lanc)::int oce_sp_nao_planejado_rep
    from m`;

// P-209 A + P-213 A: reprovado = status_desenvolvimento OU status_planejamento 'reprovado' (regra da Integração).
const NAO_REPROVADO = `not (lower(coalesce(m.status_desenvolvimento,'')) = 'reprovado'
                     or lower(coalesce(m.status_planejamento,'')) = 'reprovado')`;

describe.skipIf(!hasDb)("L4 — funil do Desenvolvimento e Realizado do OTB", () => {
  it("md5 de depois nas 4 funções; STABLE SECURITY DEFINER; internas sem EXECUTE (inv. #9); wrappers chamáveis", async () => {
    await withTx(async (c) => {
      for (const [sig, md5] of Object.entries(MD5_DEPOIS)) {
        const r = await um<{
          md5: string;
          vol: string;
          sd: boolean;
          anon: boolean;
          auth: boolean;
          pub: boolean;
        }>(
          c,
          `select md5(pg_get_functiondef(to_regprocedure($1))) md5, p.provolatile vol, p.prosecdef sd,
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
        expect(r.sd, sig).toBe(true);
        expect(r.anon || r.auth || r.pub, sig).toBe(false);
      }
      for (const w of [
        "public.dashboard_colecao(date,date,text,uuid,uuid)",
        "public.dashboard_producao(date,date,text,uuid)",
        "public.otb_orcamento(uuid)",
        "public.sidebar_badges()",
      ]) {
        const g = await um<{ a: boolean }>(
          c,
          `select has_function_privilege('authenticated',$1,'EXECUTE') a`,
          [w],
        );
        expect(g.a, w).toBe(true);
      }
    });
  });

  it("prod #10: em TODAS as lojas os KPIs batem com a classificação pela ordem_criacao_enviada e os 4 somam o total", async () => {
    await withTx(async (c) => {
      const lojas = (
        await c.query(
          `select t.id, t.nome from tenants t where exists (select 1 from modelos m where m.tenant_id = t.id) order by 2`,
        )
      ).rows as { id: string; nome: string }[];
      if (lojas.length === 0) throw new Error("fixture ausente: nenhuma loja com modelos");
      let oceSpNaoPlanejado = 0;
      let oceSpNaoPlanejadoDev = 0;
      let oceSpNaoPlanejadoRep = 0;
      let reprovadosTotal = 0;
      for (const loja of lojas) {
        await naLoja(c, loja.id);
        const e = await um<any>(c, ESPERADO_SQL, [loja.id]);
        const col = await rpc(c, `public._dashboard_colecao_core()`);
        const prod = await rpc(c, `public._dashboard_producao_core()`);
        const k = col.kpis;
        expect(k.total, `${loja.nome} total`).toBe(e.total);
        expect(
          k.planejamento + k.desenvolvimento + k.producao + k.lancados + k.reprovados,
          `${loja.nome} particao`,
        ).toBe(k.total);
        expect(k.planejamento, `${loja.nome} planejamento`).toBe(e.planejamento);
        expect(k.desenvolvimento, `${loja.nome} desenvolvimento`).toBe(e.desenvolvimento);
        expect(k.producao, `${loja.nome} producao`).toBe(e.producao);
        expect(k.lancados, `${loja.nome} lancados`).toBe(e.lancados);
        expect(k.reprovados, `${loja.nome} reprovados`).toBe(e.reprovados);
        const fun = (n: string) => Number((col.funnel as any[]).find((f) => f.name === n)?.value);
        expect(fun("Desenvolvimento"), `${loja.nome} funil Dev`).toBe(e.funil_dev);
        expect(fun("Produção"), `${loja.nome} funil Prod`).toBe(e.funil_prod);
        expect(fun("Reprovados"), `${loja.nome} funil Reprovados`).toBe(e.reprovados);
        // porLinha: a mesma partição por linha
        const pl = col.porLinha as any[];
        expect(
          pl.reduce((s, l) => s + Number(l.desenvolvimento), 0),
          `${loja.nome} porLinha dev`,
        ).toBe(e.desenvolvimento);
        expect(
          pl.reduce((s, l) => s + Number(l.planejamento), 0),
          `${loja.nome} porLinha plan`,
        ).toBe(e.planejamento);
        for (const l of pl)
          expect(
            Number(l.planejamento) +
              Number(l.desenvolvimento) +
              Number(l.producao) +
              Number(l.lancados) +
              Number(l.reprovados),
            `${loja.nome} ${l.nome}`,
          ).toBe(Number(l.total));
        // kanbanDev: mesmo conjunto (todo modelo do conjunto cai numa coluna — a 1ª quando o status não casa)
        const kb = (prod.kanbanDev as any[]).reduce((s, x) => s + Number(x.modelos), 0);
        expect(kb, `${loja.nome} kanbanDev`).toBe(e.kanban_dev);
        oceSpNaoPlanejado += e.oce_sp_nao_planejado;
        oceSpNaoPlanejadoDev += e.oce_sp_nao_planejado_dev;
        oceSpNaoPlanejadoRep += e.oce_sp_nao_planejado_rep;
        reprovadosTotal += e.reprovados;
      }
      // Âncora do plano (cópia): 15 modelos com a ordem enviada e status_planejamento <> 'planejado' (13 Ave Rara, 2
      // Loja Teste), nenhum em Produção/Lançados — todos contam em Desenvolvimento (antes: Planejamento).
      if (oceSpNaoPlanejado === 0)
        throw new Error("fixture ausente: nenhum modelo com oce e sp<>planejado");
      expect(oceSpNaoPlanejado).toBe(15);
      // P-215 A (round 3): dos 15, os 13 com status_planejamento 'reprovado' (Ave Rara) vão a "Reprovados"; os 2 da
      // Loja Teste ('em_planejamento') ficam em Desenvolvimento.
      expect(oceSpNaoPlanejadoDev).toBe(2);
      expect(oceSpNaoPlanejadoRep).toBe(13);
      expect(reprovadosTotal).toBe(14); // Ave Rara: 14 reprovados (Dev OU Planejamento), nenhum lançado
    });
  });

  it("prod #10: mutações na Loja Teste — a ordem manda no interno; comprado sem a ordem segue o status_planejamento", async () => {
    await withTx(async (c) => {
      await naLoja(c, TENANT_TESTE);
      const k = async () => (await rpc(c, `public._dashboard_colecao_core()`)).kpis;
      const kb = async () =>
        ((await rpc(c, `public._dashboard_producao_core()`)).kanbanDev as any[]).reduce(
          (s, x) => s + Number(x.modelos),
          0,
        );
      const k0 = await k();
      const kb0 = await kb();
      // 1) interno com a ordem e status_planejamento 'em_planejamento' → Desenvolvimento (antes: Planejamento) e no
      //    kanbanDev. (Com 'reprovado' iria a "Reprovados" — P-215 A, teste próprio abaixo.)
      await novoModelo(c, {
        origem: "interno",
        ordem_criacao_enviada: true,
        status_planejamento: "em_planejamento",
      });
      const k1 = await k();
      expect(k1.desenvolvimento).toBe(k0.desenvolvimento + 1);
      expect(k1.planejamento).toBe(k0.planejamento);
      expect(await kb()).toBe(kb0 + 1);
      // 2) interno 'planejado' SEM a ordem → Planejamento (antes: Desenvolvimento) e fora do kanbanDev
      await novoModelo(c, { origem: "interno", status_planejamento: "planejado" });
      const k2 = await k();
      expect(k2.planejamento).toBe(k1.planejamento + 1);
      expect(k2.desenvolvimento).toBe(k1.desenvolvimento);
      expect(await kb()).toBe(kb0 + 1);
      // 3) revenda 'planejado' sem a ordem → Desenvolvimento (como antes) e no kanbanDev
      await novoModelo(c, { origem: "revenda", status_planejamento: "planejado" });
      const k3 = await k();
      expect(k3.desenvolvimento).toBe(k2.desenvolvimento + 1);
      expect(await kb()).toBe(kb0 + 2);
      // 4) importado 'em_planejamento' sem a ordem → Planejamento (como antes)
      await novoModelo(c, { origem: "importado", status_planejamento: "em_planejamento" });
      const k4 = await k();
      expect(k4.planejamento).toBe(k3.planejamento + 1);
      expect(k4.desenvolvimento).toBe(k3.desenvolvimento);
      // 5) [fix round 2, M1] revenda com status_planejamento NULL e sem a ordem → Planejamento; a partição fecha
      //    (antes da correção a linha sumia dos 4 baldes: dev = NULL)
      const nulo = await novoModelo(c, { origem: "revenda" });
      await c.query(`update modelos set status_planejamento = null where id = $1`, [nulo]);
      const k5 = await k();
      expect(k5.total).toBe(k4.total + 1);
      expect(k5.planejamento).toBe(k4.planejamento + 1);
      expect(k5.desenvolvimento).toBe(k4.desenvolvimento);
      expect(await kb()).toBe(kb0 + 2);
      for (const x of [k0, k1, k2, k3, k4, k5])
        expect(x.planejamento + x.desenvolvimento + x.producao + x.lancados + x.reprovados).toBe(
          x.total,
        );
    });
  });

  it("P-209 A: Realizado do OTB sem reprovado em todas as coleções/subcoleções/nível 3; Resort 27 Novo perde os 7", async () => {
    await withTx(async (c) => {
      const lojas = (
        await c.query(`select distinct tenant_id id from colecoes where status = 'confirmada'`)
      ).rows as { id: string }[];
      if (lojas.length === 0) throw new Error("fixture ausente: nenhuma coleção confirmada");
      let comparados = 0;
      for (const loja of lojas) {
        const o = await rpc(c, `public._otb_orcamento_core($1::uuid, null)`, [loja.id]);
        for (const col of o.colecoes as any[]) {
          const e = await um<{ n: number }>(
            c,
            `select count(*)::int n from modelos m where m.tenant_id = $1 and m.colecao_id = $2
               and ${NAO_REPROVADO}`,
            [loja.id, col.colecao_id],
          );
          expect(col.realizado, `colecao ${col.nome}`).toBe(e.n);
          comparados++;
        }
        for (const s of o.subcolecoes as any[]) {
          const e = await um<{ n: number }>(
            c,
            `select count(*)::int n from modelos m where m.tenant_id = $1 and m.colecao_id = $2 and m.subcolecao = $3
               and ${NAO_REPROVADO}`,
            [loja.id, s.colecao_id, s.subcolecao],
          );
          expect(s.realizado, `sub ${s.subcolecao}`).toBe(e.n);
        }
        for (const n of o.niveis3 as any[]) {
          const e = await um<{ n: number }>(
            c,
            `select count(*)::int n from modelos m where m.tenant_id = $1 and m.colecao_id = $2 and m.subcolecao = $3
               and (case when $4 = 'linha' then m.linha_id = $5::uuid else m.categoria_principal_id = $5::uuid end)
               and ${NAO_REPROVADO}`,
            [loja.id, n.colecao_id, n.subcolecao, n.tipo3, n.ref_id],
          );
          expect(n.realizado, `n3 ${n.subcolecao}/${n.label}`).toBe(e.n);
        }
      }
      expect(comparados).toBeGreaterThan(0);
      // Âncora do plano: Ave Rara "Resort 27 Novo" — 242 cards; 7 reprovados no Dev + 3 só no Planejamento (P-213 A)
      // → Realizado 232
      const ancora = await um<
        { id: string; tenant_id: string; n: number; rep: number; rep_sp: number } | undefined
      >(
        c,
        `select c.id, c.tenant_id, count(m.*)::int n,
                count(*) filter (where lower(coalesce(m.status_desenvolvimento,'')) = 'reprovado')::int rep,
                count(*) filter (where lower(coalesce(m.status_planejamento,'')) = 'reprovado'
                                   and lower(coalesce(m.status_desenvolvimento,'')) <> 'reprovado')::int rep_sp
           from colecoes c join modelos m on m.colecao_id = c.id
          where c.nome = 'Resort 27 Novo' and c.status = 'confirmada' group by 1,2`,
      );
      if (!ancora) throw new Error("fixture ausente: coleção Resort 27 Novo (Ave Rara)");
      expect(ancora.rep).toBe(7);
      expect(ancora.rep_sp).toBe(3);
      const t = await um<{ realizado: number }>(
        c,
        `select realizado from public._otb_colecao_totais($1::uuid) where colecao_id = $2`,
        [ancora.tenant_id, ancora.id],
      );
      expect(t.realizado).toBe(ancora.n - 10);
    });
  });

  it("P-209 A: sair de Reprovado volta a contar; entrar em Reprovado sai (coleção, subcoleção e badge)", async () => {
    await withTx(async (c) => {
      const ancora = await um<{ id: string; tenant_id: string } | undefined>(
        c,
        `select c.id, c.tenant_id from colecoes c where c.nome = 'Resort 27 Novo' and c.status = 'confirmada'`,
      );
      if (!ancora) throw new Error("fixture ausente: coleção Resort 27 Novo (Ave Rara)");
      const rep = await um<{ id: string; subcolecao: string | null } | undefined>(
        c,
        `select id, subcolecao from modelos where colecao_id = $1 and lower(coalesce(status_desenvolvimento,'')) = 'reprovado'
          and lower(coalesce(status_planejamento,'')) <> 'reprovado'
          and subcolecao is not null order by id limit 1`,
        [ancora.id],
      );
      const vivo = await um<{ id: string; subcolecao: string | null } | undefined>(
        c,
        `select id, subcolecao from modelos m where colecao_id = $1 and ${NAO_REPROVADO}
          and subcolecao is not null order by id limit 1`,
        [ancora.id],
      );
      if (!rep || !vivo)
        throw new Error(
          "fixture ausente: reprovado e não reprovado com subcoleção no Resort 27 Novo",
        );
      const ler = async () => {
        const o = await rpc(c, `public._otb_orcamento_core($1::uuid, $2::uuid)`, [
          ancora.tenant_id,
          ancora.id,
        ]);
        const sub = (nome: string | null) =>
          Number((o.subcolecoes as any[]).find((s) => s.subcolecao === nome)?.realizado);
        return {
          col: Number(o.colecoes[0].realizado),
          subRep: sub(rep.subcolecao),
          subVivo: sub(vivo.subcolecao),
        };
      };
      // a guarda do kanban não é o assunto aqui: mudança de status como sistema (só na txn revertida)
      await c.query(`select set_config('app.kanban_sistema', 'itest-l4', true)`);
      const r0 = await ler();
      await c.query(`update modelos set status_desenvolvimento = 'em_modelagem' where id = $1`, [
        rep.id,
      ]);
      const r1 = await ler();
      expect(r1.col).toBe(r0.col + 1);
      expect(r1.subRep).toBe(r0.subRep + 1);
      await c.query(`update modelos set status_desenvolvimento = 'Reprovado' where id = $1`, [
        vivo.id,
      ]);
      const r2 = await ler();
      expect(r2.col).toBe(r1.col - 1);
      // sidebar_badges (divergência) lê _otb_colecao_totais: com mais 300 reprovados a coleção deixa de estourar
      await naLoja(c, ancora.tenant_id);
      const b0 = Number((await rpc(c, `public.sidebar_badges()`)).otb_divergencia);
      const tot = await um<{ total: number; realizado: number }>(
        c,
        `select total, realizado from public._otb_colecao_totais($1::uuid) where colecao_id = $2`,
        [ancora.tenant_id, ancora.id],
      );
      if (!(tot.realizado > tot.total))
        throw new Error("fixture inesperada: Resort 27 Novo não diverge na cópia");
      expect(b0).toBeGreaterThanOrEqual(1);
      await c.query(
        `update modelos set status_desenvolvimento = 'reprovado'
          where id in (select id from modelos m where colecao_id = $1 and ${NAO_REPROVADO}
                        order by id limit $2)`,
        [ancora.id, tot.realizado - tot.total],
      );
      const b1 = Number((await rpc(c, `public.sidebar_badges()`)).otb_divergencia);
      expect(b1).toBe(b0 - 1);
    });
  });
  it("P-213 A: reprovado SÓ no Planejamento sai do Realizado; volta a contar ao sair de Reprovado", async () => {
    await withTx(async (c) => {
      const alvo = await um<
        { id: string; tenant_id: string; colecao_id: string; subcolecao: string | null } | undefined
      >(
        c,
        `select m.id, m.tenant_id, m.colecao_id, m.subcolecao from modelos m join colecoes c on c.id = m.colecao_id
          where c.nome = 'Resort 27 Novo' and c.status = 'confirmada'
            and lower(coalesce(m.status_planejamento,'')) = 'reprovado'
            and lower(coalesce(m.status_desenvolvimento,'')) <> 'reprovado'
            and m.subcolecao is not null
          order by m.id limit 1`,
      );
      if (!alvo)
        throw new Error("fixture ausente: card reprovado só no Planejamento no Resort 27 Novo");
      const ler = async () => {
        const o = await rpc(c, `public._otb_orcamento_core($1::uuid, $2::uuid)`, [
          alvo.tenant_id,
          alvo.colecao_id,
        ]);
        const tot = await um<{ realizado: number }>(
          c,
          `select realizado from public._otb_colecao_totais($1::uuid) where colecao_id = $2`,
          [alvo.tenant_id, alvo.colecao_id],
        );
        return {
          col: Number(o.colecoes[0].realizado),
          tot: Number(tot.realizado),
          sub: Number(
            (o.subcolecoes as any[]).find((x) => x.subcolecao === alvo.subcolecao)?.realizado,
          ),
        };
      };
      const r0 = await ler();
      expect(r0.col).toBe(r0.tot);
      // sai de Reprovado (Planejamento) → volta a contar
      await c.query(`update modelos set status_planejamento = 'planejado' where id = $1`, [
        alvo.id,
      ]);
      const r1 = await ler();
      expect(r1.col).toBe(r0.col + 1);
      expect(r1.tot).toBe(r0.tot + 1);
      expect(r1.sub).toBe(r0.sub + 1);
      // entra em Reprovado de novo (só no Planejamento) → sai
      await c.query(`update modelos set status_planejamento = 'reprovado' where id = $1`, [
        alvo.id,
      ]);
      const r2 = await ler();
      expect(r2).toEqual(r0);
    });
  });
  it("P-215 A: reprovado (Dev OU Planejamento) vai a 'Reprovados'; sair de Reprovado volta ao balde; lançado fica Lançado", async () => {
    await withTx(async (c) => {
      await naLoja(c, TENANT_TESTE);
      await c.query(`select set_config('app.kanban_sistema', 'itest-l4', true)`);
      const ler = async () => {
        const col = await rpc(c, `public._dashboard_colecao_core()`);
        const prod = await rpc(c, `public._dashboard_producao_core()`);
        const kb = (prod.kanbanDev as any[]).reduce((s, x) => s + Number(x.modelos), 0);
        const kbRep = Number(
          (prod.kanbanDev as any[]).find((x) => x.key === "reprovado")?.modelos ?? 0,
        );
        const fun = (n: string) => Number((col.funnel as any[]).find((f) => f.name === n)?.value);
        return {
          k: col.kpis,
          kb,
          kbRep,
          funDev: fun("Desenvolvimento"),
          funRep: fun("Reprovados"),
        };
      };
      const soma = (k: any) =>
        k.planejamento + k.desenvolvimento + k.producao + k.lancados + k.reprovados;
      const r0 = await ler();
      expect(soma(r0.k)).toBe(r0.k.total);
      // 1) interno no Dev, reprovado SÓ no Planejamento → Reprovados (sai de Desenvolvimento e do funil Dev)
      const a = await novoModelo(c, {
        ordem_criacao_enviada: true,
        status_planejamento: "reprovado",
        status_desenvolvimento: "em_modelagem",
      });
      const r1 = await ler();
      expect(r1.k.reprovados).toBe(r0.k.reprovados + 1);
      expect(r1.k.desenvolvimento).toBe(r0.k.desenvolvimento);
      expect(r1.funDev).toBe(r0.funDev);
      expect(r1.funRep).toBe(r0.funRep + 1);
      expect(r1.kb).toBe(r0.kb + 1);
      expect(r1.kbRep).toBe(r0.kbRep + 1); // no gráfico, na coluna Reprovado
      // 2) reprovado SÓ no Dev → Reprovados
      const b = await novoModelo(c, {
        ordem_criacao_enviada: true,
        status_planejamento: "planejado",
        status_desenvolvimento: "reprovado",
      });
      const r2 = await ler();
      expect(r2.k.reprovados).toBe(r1.k.reprovados + 1);
      expect(r2.k.desenvolvimento).toBe(r1.k.desenvolvimento);
      // 3) sair de Reprovado volta ao balde (Desenvolvimento)
      await c.query(`update modelos set status_planejamento = 'planejado' where id = $1`, [a]);
      await c.query(`update modelos set status_desenvolvimento = 'em_modelagem' where id = $1`, [
        b,
      ]);
      const r3 = await ler();
      expect(r3.k.reprovados).toBe(r0.k.reprovados);
      expect(r3.k.desenvolvimento).toBe(r0.k.desenvolvimento + 2);
      expect(r3.funDev).toBe(r0.funDev + 2);
      expect(r3.kbRep).toBe(r0.kbRep);
      // 4) lançado + reprovado conta UMA vez, em Lançados
      await novoModelo(c, {
        ordem_criacao_enviada: true,
        status_planejamento: "reprovado",
        lancado: true,
      });
      const r4 = await ler();
      expect(r4.k.lancados).toBe(r3.k.lancados + 1);
      expect(r4.k.reprovados).toBe(r3.k.reprovados);
      for (const r of [r0, r1, r2, r3, r4]) expect(soma(r.k)).toBe(r.k.total);
    });
  });
  it("round 4 (B1): quadro SEM coluna Reprovado — reprovado no Planejamento com status Aprovado não conta em aprovadoNaoLancado", async () => {
    await withTx(async (c) => {
      await naLoja(c, TENANT_TESTE);
      // quadro da loja sem a coluna Reprovado (só na txn revertida)
      await c.query(
        `update tenant_config set status_kanban = (
           select jsonb_agg(elem) from jsonb_array_elements(status_kanban) elem
            where lower(elem #>> '{}') <> 'reprovado' and lower(coalesce(elem->>'key','')) <> 'reprovado')
          where tenant_id = $1`,
        [TENANT_TESTE],
      );
      const p0 = await rpc(c, `public._dashboard_producao_core()`);
      if ((p0.kanbanDev as any[]).some((x) => x.key === "reprovado"))
        throw new Error("fixture inesperada: o quadro ainda tem a coluna Reprovado");
      const colAp = (p: any) =>
        Number((p.kanbanDev as any[]).find((x) => x.key === "aprovado")?.modelos ?? 0);
      await novoModelo(c, {
        ordem_criacao_enviada: true,
        status_planejamento: "reprovado",
        status_desenvolvimento: "aprovado",
      });
      const p1 = await rpc(c, `public._dashboard_producao_core()`);
      expect(colAp(p1)).toBe(colAp(p0) + 1); // sem coluna Reprovado, fica na coluna dele
      expect(p1.aprovadoNaoLancado).toBe(p0.aprovadoNaoLancado); // mas não conta como "aprovado, não lançado"
      // e o balde Reprovados da coleção o conta uma vez só
      const k = (await rpc(c, `public._dashboard_colecao_core()`)).kpis;
      expect(k.planejamento + k.desenvolvimento + k.producao + k.lancados + k.reprovados).toBe(
        k.total,
      );
    });
  });
});
