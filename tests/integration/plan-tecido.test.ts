import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

async function ligarCriacao(c: any) {
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true}'::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true,"otb":true}'::jsonb`,
    [TENANT_TESTE],
  );
}

describe.skipIf(!hasDb)("plan_tecido — salvar + ler árvore", () => {
  it("salva a árvore e a releitura reflete tecido/variante/grade", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT','rascunho') returning id`, []);
      const av = await um<{ art: string; var: string } | undefined>(
        c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id where a.tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!av) return;
      const arvore = {
        subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
          slots: [{ modelo_id: null, slot_index: 0, nome: "M1", custo_simulado: null,
            custo_terceirizados_previsto: null, custos_adicionais: [], preco_venda: null,
            materiais: [{ artigo_id: av.art, tipo: "tecido", numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0,
              variantes: [{ variante_tecido_id: av.var, ordem: 1, multiplicador: 1, grades: { M: 42 }, grade_total: 42 }] }] }] }] }],
      };
      const planId = (await um<{ id: string }>(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)])).id;
      expect(planId).toBeTruthy();
      const arv = (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col.id])).a;
      expect(arv.subcolecoes[0].linhas[0].slots[0].materiais[0].variantes[0].grade_total).toBe(42);
      expect(Number(arv.subcolecoes[0].linhas[0].slots[0].materiais[0].consumo)).toBeCloseTo(1.4, 4);
    });
  });

  it("re-salvar é idempotente (substitui, não duplica)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT2','rascunho') returning id`, []);
      const arv1 = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [] }] };
      await um<{ id: string }>(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arv1)]);
      await um<{ id: string }>(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arv1)]);
      const n = await um<{ n: string }>(c, `select count(*) n from plan_tecido where colecao_id=$1`, [col.id]);
      expect(Number(n.n)).toBe(1);
    });
  });

  it("necessidade por tecido bate com consumo×grade após salvar+ler", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT3','rascunho') returning id`, []);
      const av = await um<{ art: string; var: string } | undefined>(
        c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id where a.tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!av) return;
      const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
        slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [
          { artigo_id: av.art, tipo: "tecido", numero: 1, consumo: 2, loss_percent: 0, ordem: 0,
            variantes: [{ variante_tecido_id: av.var, ordem: 1, multiplicador: 1, grades: {}, grade_total: 50 }] }] }] }] }] };
      await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)]);
      const arv = (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col.id])).a;
      const m = arv.subcolecoes[0].linhas[0].slots[0].materiais[0];
      expect(Number(m.consumo) * Number(m.variantes[0].grade_total) * Number(m.variantes[0].multiplicador)).toBe(100);
    });
  });
});
