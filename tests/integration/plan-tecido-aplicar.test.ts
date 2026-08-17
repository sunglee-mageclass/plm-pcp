import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Bug #9 (regra do dono): até "Enviado à Explosão" (modelos.enviado_cad) o card do Plan. Tecido pode
// alterar o BOM — o front auto-aplica no save via plan_tecido_aplicar_ao_modelo. A partir da Explosão,
// o card TRAVA (gate server-side em _plan_tecido_aplicar_ao_modelo_core, 20260817160000). Estes testes
// exercitam a RPC diretamente (o que o auto-aplicar chama, 1×/slot dirty pré-explosão).

async function ligarCriacao(c: any) {
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true}'::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true}'::jsonb`,
    [TENANT_TESTE],
  );
}

// artigo do tenant com >=2 variantes (cor "existente" v1 + cor "nova" v2)
async function artigo2Var(c: any) {
  return await um<{ art: string; v1: string; v2: string } | undefined>(
    c,
    `select a.id art, (array_agg(v.id order by v.id))[1] v1, (array_agg(v.id order by v.id))[2] v2
       from artigos a join variantes_tecido v on v.artigo_id=a.id
      where a.tenant_id=$1 group by a.id having count(v.id)>=2 limit 1`,
    [TENANT_TESTE],
  );
}

// cria um modelo com tecido#1 = art carregando SÓ a cor v1 (+ grade) e um slot de plano LIGADO a ele.
// Devolve { modeloId, slotId }. `enviadoCad` controla o estado pós/pré-explosão.
async function modeloComSlot(c: any, art: string, v1: string, enviadoCad: boolean) {
  const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-APL','rascunho') returning id`, []);
  const mod = await um<{ id: string }>(
    c, `insert into modelos (tenant_id, colecao_id, nome, enviado_cad) values ($1,$2,'M-APL',$3) returning id`,
    [TENANT_TESTE, col.id, enviadoCad],
  );
  const mt = await um<{ id: string }>(
    c, `insert into modelo_tecidos (modelo_id, artigo_id, numero, tipo, consumo, loss_percent) values ($1,$2,1,'tecido',1,0) returning id`,
    [mod.id, art],
  );
  await um(c, `insert into modelo_tecido_variantes (modelo_tecido_id, variante_tecido_id, ordem, multiplicador) values ($1,$2,1,1)`, [mt.id, v1]);
  await um(c, `insert into modelo_grades (modelo_id, variante_numero, grades, grade_total) values ($1,1,'{"M":5}'::jsonb,5)`, [mod.id]);

  const slotId = randomUUID();
  const arvore = {
    subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
      slots: [{ id: slotId, modelo_id: mod.id, slot_index: 0, custos_adicionais: [],
        materiais: [{ artigo_id: art, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: v1, ordem: 1, multiplicador: 1, grades: { M: 5 }, grade_total: 5 }] }] }] }] }],
  };
  await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)]);
  return { modeloId: mod.id, slotId };
}

const materiaisComCores = (art: string, vars: { id: string; grade: number }[]) => JSON.stringify([
  { tipo: "tecido", numero: 1, artigo_id: art, consumo: 1, loss_percent: 0,
    variantes: vars.map((v, i) => ({ variante_tecido_id: v.id, ordem: i + 1, multiplicador: 1, grades: { M: v.grade }, grade_total: v.grade })) },
]);

describe.skipIf(!hasDb)("plan_tecido — aplicar ao modelo (auto-aplicar do save, bug #9)", () => {
  it("(a) PRÉ-explosão: cor nova no card → aplicar → BOM do modelo contém a cor (fim do 'reverteu')", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarCriacao(c);
      const av = await artigo2Var(c); if (!av) return;
      const { modeloId, slotId } = await modeloComSlot(c, av.art, av.v1, false);
      // "adiciona cor v2 no card": aplica o BOM com [v1, v2]
      await um(c, `select public.plan_tecido_aplicar_ao_modelo($1,$2::jsonb,false)`, [slotId, materiaisComCores(av.art, [{ id: av.v1, grade: 5 }, { id: av.v2, grade: 3 }])]);
      const cores = await c.query(
        `select mtv.variante_tecido_id from modelo_tecido_variantes mtv
           join modelo_tecidos mt on mt.id=mtv.modelo_tecido_id
          where mt.modelo_id=$1 and mt.tipo='tecido' order by mtv.ordem`, [modeloId]);
      const ids = cores.rows.map((r: any) => r.variante_tecido_id);
      expect(ids).toContain(av.v1);
      expect(ids).toContain(av.v2); // a cor NOVA persistiu no BOM vivo → o card deixa de reverter
      // grade da cor nova gravada
      const g = await um<{ grade_total: number }>(c, `select grade_total from modelo_grades where modelo_id=$1 and variante_numero=2`, [modeloId]);
      expect(Number(g.grade_total)).toBe(3);
    });
  });

  it("(b) PRÉ-explosão: esvaziar as cores → guarda vazio-sobre-preenchido (P0001, hint sobrescrita)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarCriacao(c);
      const av = await artigo2Var(c); if (!av) return;
      const { slotId } = await modeloComSlot(c, av.art, av.v1, false);
      // aplicar com payload VAZIO apagaria a cor v1 já cadastrada → deve BARRAR sem confirmação
      let code: string | undefined; let hint: string | undefined;
      try {
        await um(c, `select public.plan_tecido_aplicar_ao_modelo($1,'[]'::jsonb,false)`, [slotId]);
      } catch (e: any) { code = e.code; hint = e.hint; }
      expect(code).toBe("P0001");
      expect(hint).toBe("plan_tecido_sobrescrita");
    });
  });

  it("(b2) PRÉ-explosão: esvaziar COM _confirmar_sobrescrita=true → passa e limpa o BOM", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarCriacao(c);
      const av = await artigo2Var(c); if (!av) return;
      const { modeloId, slotId } = await modeloComSlot(c, av.art, av.v1, false);
      await um(c, `select public.plan_tecido_aplicar_ao_modelo($1,'[]'::jsonb,true)`, [slotId]);
      const n = await um<{ n: string }>(c, `select count(*) n from modelo_tecidos where modelo_id=$1 and tipo in ('tecido','forro')`, [modeloId]);
      expect(Number(n.n)).toBe(0);
    });
  });

  it("(c) PÓS-explosão (enviado_cad=true): aplicar é BLOQUEADO no servidor (42501)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarCriacao(c);
      const av = await artigo2Var(c); if (!av) return;
      const { modeloId, slotId } = await modeloComSlot(c, av.art, av.v1, true);
      let code: string | undefined; let msg = "";
      // SAVEPOINT: o RAISE aborta a subtransação; volto a ela p/ poder consultar o BOM depois.
      await c.query("SAVEPOINT sp_c");
      try {
        await um(c, `select public.plan_tecido_aplicar_ao_modelo($1,$2::jsonb,false)`, [slotId, materiaisComCores(av.art, [{ id: av.v1, grade: 5 }, { id: av.v2, grade: 3 }])]);
      } catch (e: any) { code = e.code; msg = e.message ?? ""; await c.query("ROLLBACK TO SAVEPOINT sp_c"); }
      expect(code).toBe("42501");
      expect(msg).toMatch(/Explos/i);
      // o BOM NÃO mudou (a cor nova NÃO entrou) — a trava é real, não cosmética
      const n = await um<{ n: string }>(c, `select count(*) n from modelo_tecido_variantes mtv join modelo_tecidos mt on mt.id=mtv.modelo_tecido_id where mt.modelo_id=$1 and mt.tipo='tecido'`, [modeloId]);
      expect(Number(n.n)).toBe(1); // só a cor original v1
    });
  });

  it("(d) slot de VAGA (sem modelo) → aplicar acusa 'não ligado a um modelo' (P0001)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); await ligarCriacao(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-VAGA','rascunho') returning id`, []);
      const slotId = randomUUID();
      const arvore = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
        slots: [{ id: slotId, modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [] }] }] }] };
      await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvore)]);
      let code: string | undefined;
      try { await um(c, `select public.plan_tecido_aplicar_ao_modelo($1,'[]'::jsonb,false)`, [slotId]); }
      catch (e: any) { code = e.code; }
      expect(code).toBe("P0001"); // "Este item não está ligado a um modelo. Crie o card antes de aplicar."
    });
  });
});
