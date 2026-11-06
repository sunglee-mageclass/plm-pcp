// F1 D (dono 06/nov): "Fazer pedido" no Plan. Tecido cria a OC JA VINCULADA (modelo_tecido_oc_links) a todos os modelos que
// usam o tecido (migration 20261113100000). Cobre pedido da COLECAO INTEIRA (_slot_ids NULL) e por SELECAO, o caso ADITIVO
// (nao apaga vinculos de OCs anteriores), idempotencia, modelo lancado (pulado com o bloqueio ligado), reprovado e a guarda de JWT.
// Integracao em BEGIN...ROLLBACK (withTx); fixtures mexem em artigos/OCs/links na txn revertida -> so na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { hasDb, withTx, comoUsuario, semUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";

const RODA = hasDb && ehBancoLocal();
const CORE_PED = "public._plan_tecido_fazer_pedido_core(uuid,uuid,jsonb,uuid[])";
const CORE_VINC = "public._plan_tecido_reescrever_vinculo_oc_core";

async function ligarModulos(c: Client) {
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true}'::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true,"otb":true}'::jsonb`,
    [TENANT_TESTE],
  );
}

type Fix = { col: string; art: string; v1: string; emp: string; m1: string; m2: string; s1: string; s2: string };

/**
 * Colecao com 2 modelos (M1, M2) no MESMO tecido (artigo A, cor v1; consumo 1, perda 0, grade 5 -> cada um precisa de 5 m),
 * cada um com seu slot de plano na mesma linha. Nenhum vinculo de OC existe.
 */
async function fixture(c: Client): Promise<Fix | undefined> {
  const av = await um<{ art: string; v1: string } | undefined>(
    c,
    `select a.id art, (array_agg(v.id order by v.id))[1] v1
       from artigos a join variantes_tecido v on v.artigo_id=a.id
      where a.tenant_id=$1 group by a.id having count(v.id)>=1 limit 1`,
    [TENANT_TESTE],
  );
  const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
  if (!av || !emp) return undefined;
  await c.query(`update artigos set unidade_medida='m' where id=$1`, [av.art]);
  const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PEDV','rascunho') returning id`, []);
  const mk = async (nome: string) => {
    const mod = await um<{ id: string }>(
      c, `insert into modelos (tenant_id, colecao_id, nome) values ($1,$2,$3) returning id`, [TENANT_TESTE, col.id, nome],
    );
    const mt = await um<{ id: string }>(
      c, `insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) values ($1,$2,1,'tecido',1,0) returning id`,
      [mod.id, av.art],
    );
    await c.query(`insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador) values ($1,$2,1,1)`, [mt.id, av.v1]);
    await c.query(`insert into modelo_grades (modelo_id, variante_numero, grades, grade_total) values ($1,1,'{"M":5}'::jsonb,5)`, [mod.id]);
    return mod.id;
  };
  const m1 = await mk("M-PEDV-1");
  const m2 = await mk("M-PEDV-2");
  const s1 = randomUUID();
  const s2 = randomUUID();
  const slot = (id: string, modeloId: string, idx: number) => ({
    id, modelo_id: modeloId, slot_index: idx, custos_adicionais: [],
    materiais: [{ artigo_id: av.art, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0,
      variantes: [{ variante_tecido_id: av.v1, ordem: 1, multiplicador: 1, grades: { M: 5 }, grade_total: 5 }] }],
  });
  const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
    slots: [slot(s1, m1, 0), slot(s2, m2, 1)] }] }] };
  await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)]);
  return { col: col.id, ...av, emp: emp.id, m1, m2, s1, s2 };
}

function pedido(f: Fix, qtd = 100) {
  return JSON.stringify([{
    empresa_id: f.emp,
    itens: [{ artigo_id: f.art, variante_tecido_id: f.v1, quantidade_pedida: qtd, preco: 10 }],
  }]);
}

/** Roda o pedido (core, sob o JWT do usuario ja setado) e devolve o id da OC criada. */
async function fazerPedido(c: Client, f: Fix, slotIds: string[] | null, qtd = 100): Promise<string> {
  const r = await um<{ j: { criadas: number; ocs: string[] } }>(
    c, `select ${CORE_PED.replace("(uuid,uuid,jsonb,uuid[])", "")}($1,$2,$3::jsonb,$4::uuid[]) as j`,
    [TENANT_TESTE, f.col, pedido(f, qtd), slotIds],
  );
  expect(r.j.criadas).toBe(1);
  return r.j.ocs[0];
}

/** modelo -> [{ oc, qtd }] (so tecido/forro). */
async function links(c: Client, modeloId: string) {
  const { rows } = await c.query(
    `select it.oc_tecido_id oc, l.oc_tecido_item_id item, l.variante_tecido_id v, l.ordem, l.quantidade_m::float qtd
       from modelo_tecido_oc_links l join ocs_tecido_itens it on it.id = l.oc_tecido_item_id
      where l.modelo_id=$1 and l.tipo in ('tecido','forro') order by l.ordem, l.prioridade`,
    [modeloId],
  );
  return rows as { oc: string; item: string; v: string; ordem: number; qtd: number }[];
}

describe.skipIf(!RODA)("plan_tecido_fazer_pedido_core vincula a OC criada aos modelos do tecido (F1 D)", () => {
  it("F1 D: pedido da colecao inteira (sem _slot_ids) vincula TODOS os modelos do tecido", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      const oc = await fazerPedido(c, f, null);
      for (const m of [f.m1, f.m2]) {
        const l = await links(c, m);
        expect(l).toHaveLength(1);
        expect(l[0].oc).toBe(oc);
        expect(l[0].v).toBe(f.v1);
        expect(l[0].qtd).toBe(5); // 100 m na OC cobrem os 5 m de cada modelo (reserva por vinculo)
      }
      // colecao inteira nao grava o hint por slot (comportamento de hoje preservado)
      const h = await um<{ n: string }>(c, `select count(*) n from plan_tecido_slot_oc where colecao_id=$1`, [f.col]);
      expect(Number(h.n)).toBe(0);
    });
  });

  it("F1 D: pedido por selecao vincula so os modelos dos slots selecionados", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      const oc = await fazerPedido(c, f, [f.s1]);
      const l1 = await links(c, f.m1);
      expect(l1.map((r) => r.oc)).toEqual([oc]);
      expect(await links(c, f.m2)).toHaveLength(0); // M2 nao foi selecionado
    });
  });

  it("F1 D: e ADITIVO - nao apaga nem reordena o vinculo de OC anterior; re-pedido nao duplica nem reserva alem da necessidade", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      // OC anterior (3 m) ja vinculada ao M1 -> nao cobre os 5 m sozinha
      const oldOc = await um<{ id: string }>(c, `insert into ocs_tecido (tenant_id, numero_pedido, status) values ($1,'ITEST-PEDV-OLD','encomendado') returning id`, [TENANT_TESTE]);
      await c.query(
        `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida) values ($1,$2,1,$3,3)`,
        [oldOc.id, f.art, f.v1],
      );
      await c.query(`select ${CORE_VINC}($1,$2,$3::uuid[])`, [TENANT_TESTE, f.m1, [oldOc.id]]);
      const antes = await links(c, f.m1);
      expect(antes).toHaveLength(1);
      expect(antes[0].oc).toBe(oldOc.id);
      expect(antes[0].qtd).toBe(3);

      const oc2 = await fazerPedido(c, f, null);
      let l = await links(c, f.m1);
      // a anterior segue EXATAMENTE como estava (item e quantidade), e a nova leva so o que faltava (5 - 3 = 2)
      const velha = l.find((r) => r.oc === oldOc.id);
      expect(velha).toEqual(antes[0]);
      const nova = l.find((r) => r.oc === oc2);
      expect(nova?.qtd).toBe(2);
      expect(l.reduce((s, r) => s + r.qtd, 0)).toBe(5);

      // re-pedido (OC nova): a necessidade ja esta coberta -> nada novo p/ M1, nada duplicado, anteriores intactas
      await fazerPedido(c, f, null);
      l = await links(c, f.m1);
      expect(l).toHaveLength(2);
      expect(l.find((r) => r.oc === oldOc.id)).toEqual(antes[0]);
      expect(l.find((r) => r.oc === oc2)?.qtd).toBe(2);
      expect(new Set(l.map((r) => `${r.v}|${r.item}`)).size).toBe(l.length);
      // M2 nunca reserva alem da necessidade (5 m) apesar de 2 pedidos
      const l2 = await links(c, f.m2);
      expect(l2.reduce((s, r) => s + r.qtd, 0)).toBe(5);
      expect(new Set(l2.map((r) => `${r.v}|${r.item}`)).size).toBe(l2.length);
    });
  });

  it("F1 D: modelo LANCADO com o bloqueio ligado e pulado (pedido nao aborta); desligado, e vinculado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      await c.query(`update modelos set lancado=true where id=$1`, [f.m2]);
      await c.query(`update tenant_config set plan_tecido_oc_bloqueia_lancado=true where tenant_id=$1`, [TENANT_TESTE]);
      const oc = await fazerPedido(c, f, null); // nao levanta 42501
      expect((await links(c, f.m1)).map((r) => r.oc)).toEqual([oc]);
      expect(await links(c, f.m2)).toHaveLength(0); // lancado + bloqueio ligado -> pulado

      await c.query(`update tenant_config set plan_tecido_oc_bloqueia_lancado=false where tenant_id=$1`, [TENANT_TESTE]);
      const oc2 = await fazerPedido(c, f, null);
      expect((await links(c, f.m2)).map((r) => r.oc)).toContain(oc2); // bloqueio desligado -> vincula o lancado tambem
    });
  });

  it("F1 D: modelo REPROVADO nao e vinculado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      await c.query(`update modelos set status_planejamento='reprovado' where id=$1`, [f.m2]);
      const oc = await fazerPedido(c, f, null);
      expect((await links(c, f.m1)).map((r) => r.oc)).toEqual([oc]);
      expect(await links(c, f.m2)).toHaveLength(0);
    });
  });

  it("F1 D: so vincula modelos cujo BOM tem cor que a OC cobre (outra cor do mesmo artigo nao vincula)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      const outra = await um<{ id: string } | undefined>(
        c, `select id from variantes_tecido where artigo_id=$1 and id<>$2 limit 1`, [f.art, f.v1],
      );
      if (!outra) return;
      const r = await um<{ j: { ocs: string[] } }>(
        c, `select public._plan_tecido_fazer_pedido_core($1,$2,$3::jsonb,null) as j`,
        [TENANT_TESTE, f.col, JSON.stringify([{ empresa_id: f.emp, itens: [{ artigo_id: f.art, variante_tecido_id: outra.id, quantidade_pedida: 50, preco: 1 }] }])],
      );
      expect(r.j.ocs).toHaveLength(1);
      expect(await links(c, f.m1)).toHaveLength(0);
      expect(await links(c, f.m2)).toHaveLength(0);
    });
  });

  it("F1 D: sem JWT o pedido NEM cria a OC (_salvar_oc_tecido_core exige auth) - a guarda de tenant do bloco nunca ve job sem claims", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      const oc1 = await fazerPedido(c, f, null);
      const antes = await links(c, f.m1);
      expect(antes.map((r) => r.oc)).toEqual([oc1]);
      await semUsuario(c);
      await c.query("SAVEPOINT sp_nojwt");
      let msg = "";
      try {
        await c.query(`select public._plan_tecido_fazer_pedido_core($1,$2,$3::jsonb,null)`, [TENANT_TESTE, f.col, pedido(f)]);
      } catch (e: any) { msg = e.message ?? ""; await c.query("ROLLBACK TO SAVEPOINT sp_nojwt"); }
      expect(msg).toMatch(/autenticado/i);
      expect(await links(c, f.m1)).toEqual(antes); // vinculo anterior intacto
    });
  });

  it("F1 D: ACL do _core de pedido intacta (authenticated/anon sem EXECUTE); wrapper segue authenticated", async () => {
    await withTx(async (c) => {
      const r = await um<Record<string, boolean>>(
        c,
        `select has_function_privilege('authenticated','public.plan_tecido_fazer_pedido(uuid,jsonb,uuid[])','execute') w,
                has_function_privilege('anon','${CORE_PED}','execute') c_anon,
                has_function_privilege('authenticated','${CORE_PED}','execute') c_auth`,
      );
      expect(r).toEqual({ w: true, c_anon: false, c_auth: false });
    });
  });
});
