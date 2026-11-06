// F1 C (dono 06/nov): LIBERAR trocar/remover o vinculo de OC do modelo no card do Plan. Tecido.
// RPC nova plan_tecido_reescrever_vinculo_oc(_modelo_id, _oc_ids) + _plan_tecido_reescrever_vinculo_oc_core
// (migration 20261112100000). _oc_ids = CONJUNTO DESEJADO de OCs: remover uma = lista atual sem ela; vazio = limpa.
// Integracao em BEGIN...ROLLBACK (withTx); fixtures mexem em artigos/OCs/links na txn revertida -> so na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { randomUUID } from "node:crypto";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";

const RODA = hasDb && ehBancoLocal();
const CORE = "public._plan_tecido_reescrever_vinculo_oc_core(uuid,uuid,uuid[])";
const WRAP = "public.plan_tecido_reescrever_vinculo_oc(uuid,uuid[])";

async function ligarModulos(c: Client) {
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true}'::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true,"otb":true}'::jsonb`,
    [TENANT_TESTE],
  );
}

type Fix = { modeloId: string; art: string; v1: string; v2: string; oc1: string; oc2: string; oc3: string; i1: string; i2: string; i3: string };

/**
 * Modelo com tecido#1 = 2 cores (v1 grade 5, v2 grade 3; consumo 1, perda 0 -> precisa 5 m e 3 m).
 * OC1 e OC3 tem item da cor v1 (100 m cada); OC2 tem item da cor v2 (100 m). Vinculos iniciais NAO existem.
 */
async function fixture(c: Client, enviadoCad = false): Promise<Fix | undefined> {
  const av = await um<{ art: string; v1: string; v2: string } | undefined>(
    c,
    `select a.id art, (array_agg(v.id order by v.id))[1] v1, (array_agg(v.id order by v.id))[2] v2
       from artigos a join variantes_tecido v on v.artigo_id=a.id
      where a.tenant_id=$1 group by a.id having count(v.id)>=2 limit 1`,
    [TENANT_TESTE],
  );
  if (!av) return undefined;
  await c.query(`update artigos set unidade_medida='m' where id=$1`, [av.art]);
  const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-VINC','rascunho') returning id`, []);
  const mod = await um<{ id: string }>(
    c, `insert into modelos (tenant_id, colecao_id, nome, enviado_cad) values ($1,$2,'M-VINC',$3) returning id`,
    [TENANT_TESTE, col.id, enviadoCad],
  );
  const mt = await um<{ id: string }>(
    c, `insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) values ($1,$2,1,'tecido',1,0) returning id`,
    [mod.id, av.art],
  );
  await c.query(`insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador) values ($1,$2,1,1),($1,$3,2,1)`, [mt.id, av.v1, av.v2]);
  await c.query(`insert into modelo_grades (modelo_id, variante_numero, grades, grade_total) values ($1,1,'{"M":5}'::jsonb,5),($1,2,'{"M":3}'::jsonb,3)`, [mod.id]);
  const mkOc = async (nome: string, variante: string) => {
    const oc = await um<{ id: string }>(c, `insert into ocs_tecido (tenant_id, numero_pedido, status) values ($1,$2,'encomendado') returning id`, [TENANT_TESTE, nome]);
    const it = await um<{ id: string }>(
      c, `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, artigo_numero, variante_tecido_id, quantidade_pedida) values ($1,$2,1,$3,100) returning id`,
      [oc.id, av.art, variante],
    );
    return { oc: oc.id, it: it.id };
  };
  const o1 = await mkOc("ITEST-VINC-1", av.v1);
  const o2 = await mkOc("ITEST-VINC-2", av.v2);
  const o3 = await mkOc("ITEST-VINC-3", av.v1);
  return { modeloId: mod.id, ...av, oc1: o1.oc, oc2: o2.oc, oc3: o3.oc, i1: o1.it, i2: o2.it, i3: o3.it };
}

async function reescrever(c: Client, f: Fix, ocs: string[]) {
  await c.query(`select ${CORE.replace("(uuid,uuid,uuid[])", "")}($1,$2,$3::uuid[])`, [TENANT_TESTE, f.modeloId, ocs]);
}

async function links(c: Client, modeloId: string) {
  const { rows } = await c.query(
    `select it.oc_tecido_id, l.variante_tecido_id, l.oc_tecido_item_id, l.quantidade_m::float qtd, l.prioridade
       from modelo_tecido_oc_links l join ocs_tecido_itens it on it.id = l.oc_tecido_item_id
      where l.modelo_id=$1 and l.tipo in ('tecido','forro') order by l.ordem, l.prioridade`,
    [modeloId],
  );
  return rows as { oc_tecido_id: string; variante_tecido_id: string; oc_tecido_item_id: string; qtd: number; prioridade: number }[];
}

describe.skipIf(!RODA)("plan_tecido_reescrever_vinculo_oc (F1 C)", () => {
  it("ACL: _core revogado de PUBLIC/anon/authenticated; wrapper so authenticated", async () => {
    await withTx(async (c) => {
      const r = await um<Record<string, boolean>>(
        c,
        `select has_function_privilege('authenticated','${WRAP}','execute') w_auth,
                has_function_privilege('anon','${WRAP}','execute') w_anon,
                has_function_privilege('public','${WRAP}','execute') w_pub,
                has_function_privilege('authenticated','${CORE}','execute') c_auth,
                has_function_privilege('anon','${CORE}','execute') c_anon,
                has_function_privilege('public','${CORE}','execute') c_pub`,
      );
      expect(r).toEqual({ w_auth: true, w_anon: false, w_pub: false, c_auth: false, c_anon: false, c_pub: false });
    });
  });

  it("trocar OC: reescreve modelo_tecido_oc_links para a OC nova e solta a antiga", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      await reescrever(c, f, [f.oc1]);
      let l = await links(c, f.modeloId);
      expect(l.every((r) => r.oc_tecido_id === f.oc1)).toBe(true);
      expect(l.find((r) => r.variante_tecido_id === f.v1)?.oc_tecido_item_id).toBe(f.i1);
      expect(l.find((r) => r.variante_tecido_id === f.v1)?.qtd).toBe(5);

      // TROCA: conjunto desejado = so OC3 (mesma cor v1). OC1 some, OC3 entra.
      await reescrever(c, f, [f.oc3]);
      l = await links(c, f.modeloId);
      expect(l).toHaveLength(1);
      expect(l[0].oc_tecido_item_id).toBe(f.i3);
      expect(l[0].variante_tecido_id).toBe(f.v1);
      expect(l[0].qtd).toBe(5);
    });
  });

  it("remover UMA OC (lista atual sem ela) mantem as outras", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      await reescrever(c, f, [f.oc1, f.oc2]); // cor v1 pela OC1, cor v2 pela OC2
      let l = await links(c, f.modeloId);
      expect(l.map((r) => r.oc_tecido_item_id).sort()).toEqual([f.i1, f.i2].sort());

      await reescrever(c, f, [f.oc1]); // X na OC2
      l = await links(c, f.modeloId);
      expect(l.map((r) => r.oc_tecido_item_id)).toEqual([f.i1]); // OC1 ficou, OC2 saiu (v2 sem vinculo)
      expect(l[0].qtd).toBe(5);
    });
  });

  it("adicionar OC (2 OCs cobrindo a mesma cor): reparte por quantidade e prioridade", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      // OC1 e OC3 tem 3 m cada -> nenhuma cobre sozinha os 5 m da cor v1: reparte 3 + 2 (ordem das OCs e do banco)
      await c.query(`update ocs_tecido_itens set quantidade_pedida=3 where id = any($1::uuid[])`, [[f.i1, f.i3]]);
      await reescrever(c, f, [f.oc1, f.oc3]);
      const l = (await links(c, f.modeloId)).filter((r) => r.variante_tecido_id === f.v1);
      expect(l).toHaveLength(2);
      expect(l.reduce((s, r) => s + r.qtd, 0)).toBe(5);
      expect(l.map((r) => r.prioridade)).toEqual([1, 2]);
    });
  });

  it("conjunto vazio limpa todos os vinculos tecido/forro (e so deles)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      await reescrever(c, f, [f.oc1, f.oc2]);
      expect((await links(c, f.modeloId)).length).toBe(2);
      await reescrever(c, f, []);
      expect((await links(c, f.modeloId)).length).toBe(0);
      // BOM do modelo intacto (so o vinculo sai)
      const n = await um<{ n: number }>(c, `select count(*)::int n from modelo_tecido_variantes mtv join modelo_tecidos mt on mt.id=mtv.modelo_tecido_id where mt.modelo_id=$1`, [f.modeloId]);
      expect(n.n).toBe(2);
    });
  });

  it("recalcula custo (fila) e reserva (disponivel da OC) ao vincular e ao remover", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      const disp = async () => {
        const r = await um<{ j: any[] }>(c, `select public.ocs_disponiveis_variante($1, null) j`, [f.v1]);
        return Number(r.j.find((e: any) => e.oc_tecido_item_id === f.i1)?.disponivel_m);
      };
      expect(await disp()).toBe(100);
      await c.query(`delete from custo_recalculo_fila where modelo_id=$1`, [f.modeloId]);
      await reescrever(c, f, [f.oc1]);
      expect(await disp()).toBe(95); // reserva de 5 m aparece
      const fila1 = await um<{ n: number }>(c, `select count(*)::int n from custo_recalculo_fila where modelo_id=$1`, [f.modeloId]);
      expect(fila1.n).toBe(1); // custo congelado do modelo entrou na fila de recalculo

      await c.query(`delete from custo_recalculo_fila where modelo_id=$1`, [f.modeloId]);
      await reescrever(c, f, []);
      expect(await disp()).toBe(100); // reserva liberada
      const fila2 = await um<{ n: number }>(c, `select count(*)::int n from custo_recalculo_fila where modelo_id=$1`, [f.modeloId]);
      expect(fila2.n).toBe(1);
    });
  });

  it("libera tambem apos o corte (enviado_cad = true): sem bloqueio", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c, true); if (!f) return;
      await reescrever(c, f, [f.oc1]);
      expect((await links(c, f.modeloId)).length).toBe(1);
      await reescrever(c, f, []);
      expect((await links(c, f.modeloId)).length).toBe(0);
    });
  });

  it("wrapper como usuario com permissao grava; OC de outra loja e ignorada", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      const alheia = await um<{ id: string } | undefined>(c, `select id from ocs_tecido where tenant_id <> $1 limit 1`, [TENANT_TESTE]);
      await c.query(`select ${WRAP.replace("(uuid,uuid[])", "")}($1,$2::uuid[])`, [f.modeloId, [f.oc1, ...(alheia ? [alheia.id] : [])]]);
      const l = await links(c, f.modeloId);
      expect(l.map((r) => r.oc_tecido_item_id)).toEqual([f.i1]);
    });
  });

  it("wrapper sincroniza o hint de OC do card: remover a OC NAO e desfeito pelo proximo aplicar", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      const slotId = randomUUID();
      const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
        slots: [{ id: slotId, modelo_id: f.modeloId, slot_index: 0, custos_adicionais: [],
          materiais: [{ artigo_id: f.art, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0,
            variantes: [{ variante_tecido_id: f.v1, ordem: 1, multiplicador: 1, grades: { M: 5 }, grade_total: 5 },
                        { variante_tecido_id: f.v2, ordem: 2, multiplicador: 1, grades: { M: 3 }, grade_total: 3 }] }] }] }] }] };
      const col = await um<{ colecao_id: string }>(c, `select colecao_id from modelos where id=$1`, [f.modeloId]);
      await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.colecao_id, JSON.stringify(arvore)]);
      // card com a OC1 escolhida no plano + aplicar (propaga o hint ao vinculo, como o auto-aplicar do save)
      await um(c, `select public.plan_tecido_set_slot_oc($1,$2,$3::uuid[]) n`, [col.colecao_id, slotId, [f.oc1]]);
      const mats = JSON.stringify([{ tipo: "tecido", numero: 1, artigo_id: f.art, consumo: 1, loss_percent: 0, variantes: [
        { variante_tecido_id: f.v1, ordem: 1, multiplicador: 1, grades: { M: 5 }, grade_total: 5 },
        { variante_tecido_id: f.v2, ordem: 2, multiplicador: 1, grades: { M: 3 }, grade_total: 3 }] }]);
      await um(c, `select public.plan_tecido_aplicar_ao_modelo($1,$2::jsonb,true) id`, [slotId, mats]);
      expect((await links(c, f.modeloId)).map((r) => r.oc_tecido_item_id)).toEqual([f.i1]);

      // X na unica OC (conjunto vazio) -> vinculo limpo E hint limpo
      await c.query(`select public.plan_tecido_reescrever_vinculo_oc($1,$2::uuid[])`, [f.modeloId, []]);
      expect((await links(c, f.modeloId)).length).toBe(0);
      const h = await um<{ n: number }>(c, `select count(*)::int n from plan_tecido_slot_oc where slot_id=$1`, [slotId]);
      expect(h.n).toBe(0);

      // o proximo auto-aplicar NAO re-vincula a OC removida
      await um(c, `select public.plan_tecido_aplicar_ao_modelo($1,$2::jsonb,true) id`, [slotId, mats]);
      expect((await links(c, f.modeloId)).length).toBe(0);

      // adicionar OC3 pelo wrapper -> hint = [OC3] e vinculo na OC3
      await c.query(`select public.plan_tecido_reescrever_vinculo_oc($1,$2::uuid[])`, [f.modeloId, [f.oc3]]);
      const h2 = await c.query(`select oc_tecido_id from plan_tecido_slot_oc where slot_id=$1`, [slotId]);
      expect(h2.rows.map((r: any) => r.oc_tecido_id)).toEqual([f.oc3]);
      expect((await links(c, f.modeloId)).map((r) => r.oc_tecido_item_id)).toEqual([f.i3]);
    });
  });

  it("portao: modelo de outra loja -> 42501 no _core; sem permissao de pagina -> 42501 no wrapper", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarModulos(c);
      const f = await fixture(c); if (!f) return;
      // _core com tenant que nao e o do modelo
      const outro = await um<{ id: string } | undefined>(c, `select id from tenants where id <> $1 limit 1`, [TENANT_TESTE]);
      if (outro) {
        let code: string | undefined;
        await c.query("SAVEPOINT sp1");
        try { await c.query(`select public._plan_tecido_reescrever_vinculo_oc_core($1,$2,$3::uuid[])`, [outro.id, f.modeloId, [f.oc1]]); }
        catch (e: any) { code = e.code; await c.query("ROLLBACK TO SAVEPOINT sp1"); }
        expect(code).toBe("42501");
      }
      // wrapper sem JWT (user_can_edit=false) -> sem_permissao_pagina
      await c.query("SELECT set_config('request.jwt.claims', '', true)");
      let code2: string | undefined; let msg = "";
      await c.query("SAVEPOINT sp2");
      try { await c.query(`select public.plan_tecido_reescrever_vinculo_oc($1,$2::uuid[])`, [f.modeloId, [f.oc1]]); }
      catch (e: any) { code2 = e.code; msg = e.message ?? ""; await c.query("ROLLBACK TO SAVEPOINT sp2"); }
      expect(code2).toBe("42501");
      expect(msg).toBeTruthy();
    });
  });
});
