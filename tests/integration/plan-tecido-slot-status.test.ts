import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

async function ligarCriacao(c: any) {
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true}'::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true,"otb":true}'::jsonb`,
    [TENANT_TESTE],
  );
}

const slotDa = (arv: any) => arv.subcolecoes[0].linhas[0].slots[0];

describe.skipIf(!hasDb)("plan_tecido_slots.status (status na vaga, F2 C)", () => {
  it("vaga SEM card: salva 'reprovado' e a arvore devolve 'reprovado'", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT-ST1','rascunho') returning id`, []);
      const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
        slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], status: "reprovado", materiais: [] }] }] }] };
      await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)]);
      const arv = (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col.id])).a;
      expect(slotDa(arv).status).toBe("reprovado");
    });
  });

  it("vaga SEM card: sem a chave status -> default 'pendente' na coluna e na arvore", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT-ST0','rascunho') returning id`, []);
      const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
        slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] }] }] }] };
      await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)]);
      const arv = (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col.id])).a;
      expect(slotDa(arv).status).toBe("pendente");
    });
  });

  it("status invalido numa vaga SEM card -> P0001", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT-STX','rascunho') returning id`, []);
      const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
        slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], status: "aprovado", materiais: [] }] }] }] };
      await expect(
        um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)]),
      ).rejects.toThrow(/status invalido/);
    });
  });

  it("vaga COM card: a arvore devolve status NULL (deriva do card) e a coluna fica 'pendente' inerte (sem divergencia)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT-ST2','rascunho') returning id`, []);
      const mid = (await um<{ id: string }>(
        c,
        `insert into modelos (nome, colecao_id, tenant_id, status_planejamento) values ('CardR', $1, $2, 'reprovado') returning id`,
        [col.id, TENANT_TESTE],
      )).id;
      // vaga COM card manda status 'reprovado' de proposito -> tem de ser IGNORADO (a coluna vira 'pendente' inerte).
      const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
        slots: [{ modelo_id: mid, slot_index: 0, custos_adicionais: [], status: "reprovado", materiais: [] }] }] }] };
      await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)]);
      const arv = (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col.id])).a;
      expect(slotDa(arv).status).toBeNull(); // NAO vem da vaga; o front deriva do card
      // a coluna gravada na vaga com card e 'pendente' inerte (NUNCA dois status divergentes)
      const col2 = await um<{ status: string }>(c, `select status from plan_tecido_slots where modelo_id = $1`, [mid]);
      expect(col2.status).toBe("pendente");
    });
  });

  it("reprovar no card reflete na vaga: a arvore segue NULL; o front deriva do status_planejamento", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT-ST3','rascunho') returning id`, []);
      const mid = (await um<{ id: string }>(
        c,
        `insert into modelos (nome, colecao_id, tenant_id) values ('CardP', $1, $2) returning id`,
        [col.id, TENANT_TESTE],
      )).id;
      const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
        slots: [{ modelo_id: mid, slot_index: 0, custos_adicionais: [], materiais: [] }] }] }] };
      await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)]);
      // reprovar no Planejamento/kanban do Dev (fora do Plan. Tecido)
      await c.query(`update modelos set status_planejamento = 'reprovado' where id = $1`, [mid]);
      const arv = (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col.id])).a;
      // a arvore devolve NULL (a vaga com card nunca entrega status proprio); o status efetivo e derivado do modelo
      expect(slotDa(arv).status).toBeNull();
      const m = await um<{ sp: string }>(c, `select status_planejamento sp from modelos where id = $1`, [mid]);
      expect(m.sp).toBe("reprovado");
    });
  });
});
