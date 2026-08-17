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

  it("DEDUP: variante repetida no mesmo material colapsa em 1 (mantém maior grade, não soma)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT-DUP','rascunho') returning id`, []);
      const av = await um<{ art: string; var: string } | undefined>(
        c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id where a.tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!av) return;
      // MESMA variante 2× no material (grades 30 e 60) — como o bug da Loja Teste
      const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
        slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [
          { artigo_id: av.art, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0, variantes: [
            { variante_tecido_id: av.var, ordem: 1, multiplicador: 1, grades: { P: 30 }, grade_total: 30 },
            { variante_tecido_id: av.var, ordem: 2, multiplicador: 1, grades: { P: 60 }, grade_total: 60 },
          ] }] }] }] }] };
      await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)]);
      // grava só 1 linha na tabela
      const n = await um<{ n: string }>(c,
        `select count(*) n from plan_tecido_variantes v
           join plan_tecido_materiais m on m.id=v.material_id
           join plan_tecido_slots s on s.id=m.slot_id
           join plan_tecido_linhas l on l.id=s.linha_ref_id
           join plan_tecido_subcolecoes sc on sc.id=l.sub_id
           join plan_tecido p on p.id=sc.plan_id
          where p.colecao_id=$1 and v.variante_tecido_id=$2`, [col.id, av.var]);
      expect(Number(n.n)).toBe(1);
      // e a releitura traz a de MAIOR grade (60), nunca a soma (90)
      const arv = (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col.id])).a;
      const vars = arv.subcolecoes[0].linhas[0].slots[0].materiais[0].variantes;
      expect(vars).toHaveLength(1);
      expect(vars[0].grade_total).toBe(60);
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

// Cobertura de OC na prévia do "Fazer pedido" — DECISÃO DO DONO ago/2026, OPÇÃO B:
// cobertura de OC aplicada NÃO-própria só sai quando há USO PLANEJADO REAL (card do Dev vinculado à
// OC OU hint de slot). A "aplicada" pura (só marcada no seletor) vira acompanhamento: supply 0.
// OC própria (Fazer pedido) e rolo (saldo) e usar_estoque INALTERADOS.
// nec da coleção = consumo(1) × grade_total(100) × mult(1) = 100 m; deficit = nec − supply − rolo
// (o estoque previsto NÃO entra no deficit — é info à parte).
describe.skipIf(!hasDb)("plan_tecido — cobertura de OC exige uso real (opção B)", () => {
  const ARVORE = (art: string, varId: string) => ({
    subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
      slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [
        { artigo_id: art, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: varId, ordem: 1, multiplicador: 1, grades: { M: 100 }, grade_total: 100 }] }] }] }] }],
  });

  async function metroVar(c: any) {
    return await um<{ art: string; var: string } | undefined>(
      c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id
          where a.tenant_id=$1 and a.unidade_medida='metro' order by v.id limit 1`, [TENANT_TESTE]);
  }
  async function novaColComPlano(c: any, nome: string, art: string, varId: string) {
    const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ($1,'rascunho') returning id`, [nome]);
    await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(ARVORE(art, varId))]);
    return col.id;
  }
  async function novaOc(c: any, isRolo: boolean, pedida: number, art: string, varId: string) {
    const oc = await um<{ id: string }>(c, `insert into ocs_tecido (tenant_id,is_rolo,status) values ($1,$2,$3) returning id`,
      [TENANT_TESTE, isRolo, isRolo ? "recebido" : "encomendado"]);
    const it = await um<{ id: string }>(c, `insert into ocs_tecido_itens (oc_tecido_id,artigo_id,variante_tecido_id,quantidade_pedida) values ($1,$2,$3,$4) returning id`,
      [oc.id, art, varId, pedida]);
    return { ocId: oc.id, itemId: it.id };
  }
  async function deficitDe(c: any, colId: string, varId: string): Promise<number | null> {
    const previa = (await um<{ p: any }>(c, `select public.plan_tecido_previa_pedido($1) p`, [colId])).p;
    const row = ((previa?.cobertura ?? []) as any[]).find((r) => r.variante_tecido_id === varId);
    return row ? Number(row.deficit_m) : null;
  }

  it("(a) OC aplicada ÓRFÃ sem card NÃO abate o 'a comprar' (era o bug)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarCriacao(c);
      const av = await metroVar(c); if (!av) return;
      const col = await novaColComPlano(c, "B-a-orfa", av.art, av.var);
      const { ocId } = await novaOc(c, false, 40, av.art, av.var);
      await um(c, `insert into plan_tecido_oc_aplicada (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, col, ocId]);
      // aplicada pura, sem card → supply 0 → deficit = nec cheia (100), NÃO cai
      expect(await deficitDe(c, col, av.var)).toBe(100);
    });
  });

  it("(b) MESMA OC + card do Dev vinculado a ela → cobre (a_comprar cai pelo pedido)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarCriacao(c);
      const av = await metroVar(c); if (!av) return;
      const col = await novaColComPlano(c, "B-b-card", av.art, av.var);
      const { ocId, itemId } = await novaOc(c, false, 40, av.art, av.var);
      await um(c, `insert into plan_tecido_oc_aplicada (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, col, ocId]);
      const mod = await um<{ id: string }>(c, `insert into modelos (tenant_id,colecao_id,nome) values ($1,$2,'B-b-modelo') returning id`, [TENANT_TESTE, col]);
      await um(c, `insert into modelo_tecido_oc_links (tenant_id,modelo_id,tipo,numero,ordem,variante_tecido_id,oc_tecido_item_id)
                   values ($1,$2,'tecido',1,1,$3,$4)`, [TENANT_TESTE, mod.id, av.var, itemId]);
      // card vinculado (has_card) → cobre pela pedida (órfã ⇒ pedida cheia 40) → deficit 100−40=60
      expect(await deficitDe(c, col, av.var)).toBe(60);
    });
  });

  it("(c) OC ÓWNED (Fazer pedido desta coleção) cobre pela pedida cheia — INALTERADO", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarCriacao(c);
      const av = await metroVar(c); if (!av) return;
      const col = await novaColComPlano(c, "B-c-owned", av.art, av.var);
      const { ocId } = await novaOc(c, false, 30, av.art, av.var);
      await um(c, `insert into plan_tecido_ocs (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, col, ocId]);
      // owned → pedida cheia 30 → deficit 100−30=70
      expect(await deficitDe(c, col, av.var)).toBe(70);
    });
  });

  it("(d) ROLO aplicado (sem card) abate pelo SALDO — INALTERADO", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarCriacao(c);
      const av = await metroVar(c); if (!av) return;
      const col = await novaColComPlano(c, "B-d-rolo", av.art, av.var);
      const { ocId } = await novaOc(c, true, 25, av.art, av.var);
      await um(c, `insert into plan_tecido_oc_aplicada (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, col, ocId]);
      // rolo credita saldo 25 mesmo sem card (rolo_supply não usa has_card) → deficit 100−25=75
      expect(await deficitDe(c, col, av.var)).toBe(75);
    });
  });

  it("(e) card usar_estoque fica FORA da necessidade — INALTERADO", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarCriacao(c);
      const av = await metroVar(c); if (!av) return;
      const col = await novaColComPlano(c, "B-e-estoque", av.art, av.var);
      // marca o slot como usar_estoque → sai da nec (variante some da cobertura → deficit null)
      await um(c, `update plan_tecido_slots s set usar_estoque=true
                   from plan_tecido_linhas l, plan_tecido_subcolecoes sc, plan_tecido p
                   where s.linha_ref_id=l.id and l.sub_id=sc.id and sc.plan_id=p.id and p.colecao_id=$1`, [col]);
      expect(await deficitDe(c, col, av.var)).toBeNull();
    });
  });
});
