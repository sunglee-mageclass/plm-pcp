// Blindagens de dados (sequela do incidente de 13/ago, PITR desligado):
//  1) Snapshots de recuperação do "antes" (plan_tecido_snapshots / modelo_bom_snapshots)
//  2) Guarda vazio-sobre-preenchido no "Aplicar ao modelo" (P0001 + hint até confirmar)
// Todos transacionais (BEGIN…ROLLBACK): nada é gravado.
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

async function ligarCriacao(c: any) {
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true}'::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true,"otb":true}'::jsonb`,
    [TENANT_TESTE],
  );
}

// Uma variante de tecido real da Loja Teste (art + variante) — sem ela, o teste se auto-pula.
async function artVar(c: any) {
  return um<{ art: string; var: string } | undefined>(
    c,
    `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id where a.tenant_id=$1 limit 1`,
    [TENANT_TESTE],
  );
}

function arvoreCom(art: string, vari: string, gradeTotal: number) {
  return {
    subcolecoes: [
      {
        subcolecao_id: null,
        ordem: 0,
        linhas: [
          {
            linha_id: null,
            categoria_id: null,
            ordem: 0,
            slots: [
              {
                modelo_id: null,
                slot_index: 0,
                nome: "M1",
                custo_simulado: null,
                custos_adicionais: [],
                materiais: [
                  {
                    artigo_id: art,
                    tipo: "tecido",
                    numero: 1,
                    consumo: 1.4,
                    loss_percent: 0,
                    ordem: 0,
                    variantes: [
                      { variante_tecido_id: vari, ordem: 1, multiplicador: 1, grades: { M: gradeTotal }, grade_total: gradeTotal },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

async function slotIdDaColecao(c: any, col: string): Promise<string | undefined> {
  const r = await um<{ id: string } | undefined>(
    c,
    `select sl.id from plan_tecido_slots sl
       join plan_tecido_linhas l on l.id = sl.linha_ref_id
       join plan_tecido_subcolecoes s on s.id = l.sub_id
       join plan_tecido pt on pt.id = s.plan_id
      where pt.colecao_id = $1 limit 1`,
    [col],
  );
  return r?.id;
}

async function capturarErro(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

describe.skipIf(!hasDb)("BLINDAGEM 1 — snapshots do plano", () => {
  it("1º save (antes vazio) não gera snapshot; 2º save grava o ESTADO ANTERIOR íntegro", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const av = await artVar(c);
      if (!av) return;
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-SNAP','rascunho') returning id`, []);
      const planId = (await um<{ id: string }>(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvoreCom(av.art, av.var, 42))])).id;

      // antes do 1º save o plano não existia → nenhum snapshot
      const n1 = await um<{ n: string }>(c, `select count(*) n from plan_tecido_snapshots where plan_id=$1`, [planId]);
      expect(Number(n1.n)).toBe(0);

      // 2º save (esvazia) → snapshot do ESTADO ANTERIOR (a árvore com grade 42)
      await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify({ subcolecoes: [] })]);
      const snap = await um<{ payload: any }>(c, `select payload from plan_tecido_snapshots where plan_id=$1 order by created_at desc limit 1`, [planId]);
      expect(snap).toBeTruthy();
      const g = snap.payload.arvore.subcolecoes[0].linhas[0].slots[0].materiais[0].variantes[0].grade_total;
      expect(Number(g)).toBe(42);
    });
  });

  it("retenção mantém no máximo 20 snapshots por plano", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const av = await artVar(c);
      if (!av) return;
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-RET','rascunho') returning id`, []);
      let planId = "";
      // 23 saves com árvore não-vazia → 22 snapshots inseridos ao longo do tempo, podados p/ 20
      for (let i = 0; i < 23; i++) {
        planId = (await um<{ id: string }>(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvoreCom(av.art, av.var, 10 + i))])).id;
      }
      const n = await um<{ n: string }>(c, `select count(*) n from plan_tecido_snapshots where plan_id=$1`, [planId]);
      expect(Number(n.n)).toBe(20);
    });
  });

  it("restauração: replay do payload->arvore reconstrói a árvore anterior", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const av = await artVar(c);
      if (!av) return;
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-REST','rascunho') returning id`, []);
      const planId = (await um<{ id: string }>(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvoreCom(av.art, av.var, 77))])).id;
      // esvazia → snapshot do antes (grade 77); árvore viva agora vazia
      await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify({ subcolecoes: [] })]);
      const vazio = (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col.id])).a;
      expect(vazio.subcolecoes.length).toBe(0);

      // RECEITA DE RESTAURAÇÃO: pega o payload->arvore do snapshot e re-salva
      const snap = await um<{ arv: any }>(c, `select payload->'arvore' arv from plan_tecido_snapshots where plan_id=$1 order by created_at desc limit 1`, [planId]);
      await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(snap.arv)]);

      const arv = (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col.id])).a;
      expect(Number(arv.subcolecoes[0].linhas[0].slots[0].materiais[0].variantes[0].grade_total)).toBe(77);
    });
  });
});

describe.skipIf(!hasDb)("BLINDAGEM 2 — guarda vazio-sobre-preenchido no Aplicar", () => {
  // Cria colecao + slot + card (modelo com BOM = 1 variante, grade). Devolve {col, slot, modelo}.
  async function comCard(c: any) {
    const av = await artVar(c);
    if (!av) return null;
    const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-APL','rascunho') returning id`, []);
    await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col.id, JSON.stringify(arvoreCom(av.art, av.var, 30))]);
    const slot = await slotIdDaColecao(c, col.id);
    if (!slot) return null;
    const materiais = [
      { artigo_id: av.art, tipo: "tecido", numero: 1, consumo: 1.4, loss_percent: 0, ordem: 0,
        variantes: [{ variante_tecido_id: av.var, ordem: 1, multiplicador: 1, grades: { M: 30 }, grade_total: 30 }] },
    ];
    const modelo = (await um<{ id: string }>(c, `select public.plan_tecido_criar_card($1,$2::jsonb) id`, [col.id, JSON.stringify({ slot_id: slot, nome: "M1", materiais })])).id;
    return { av, col, slot, modelo, materiais };
  }

  it("aplicar que esvaziaria as variantes → P0001 com hint 'plan_tecido_sobrescrita'", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const s = await comCard(c);
      if (!s) return;
      // modelo tem 1 variante hoje
      const cur = await um<{ n: string }>(c, `select count(*) n from modelo_tecido_variantes mtv join modelo_tecidos mt on mt.id=mtv.modelo_tecido_id where mt.modelo_id=$1`, [s.modelo]);
      expect(Number(cur.n)).toBe(1);

      const err = await capturarErro(() =>
        c.query(`select public.plan_tecido_aplicar_ao_modelo($1,$2::jsonb)`, [s.slot, JSON.stringify([])]),
      );
      expect(err).toBeTruthy();
      expect(err.code).toBe("P0001");
      expect(err.hint).toBe("plan_tecido_sobrescrita");
      expect(String(err.message)).toMatch(/apagaria/i);
    });
  });

  it("com _confirmar_sobrescrita=true → passa E grava snapshot do BOM anterior", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const s = await comCard(c);
      if (!s) return;
      // aplica vazio COM confirmação → sucesso (esvazia)
      await um(c, `select public.plan_tecido_aplicar_ao_modelo($1,$2::jsonb,true)`, [s.slot, JSON.stringify([])]);
      const cur = await um<{ n: string }>(c, `select count(*) n from modelo_tecido_variantes mtv join modelo_tecidos mt on mt.id=mtv.modelo_tecido_id where mt.modelo_id=$1`, [s.modelo]);
      expect(Number(cur.n)).toBe(0);
      // snapshot do BOM ANTERIOR (com a variante) existe
      const snap = await um<{ payload: any } | undefined>(c, `select payload from modelo_bom_snapshots where modelo_id=$1 and origem='aplicar' order by created_at desc limit 1`, [s.modelo]);
      expect(snap).toBeTruthy();
      const nVar = (snap!.payload.modelo_tecidos ?? []).reduce((acc: number, mt: any) => acc + (mt.variantes?.length ?? 0), 0);
      expect(nVar).toBeGreaterThanOrEqual(1);
    });
  });

  it("aplicar normal (mantém variante) → sem fricção, sem P0001", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const s = await comCard(c);
      if (!s) return;
      // reaplica os MESMOS materiais (ainda tem variante) → não deve levantar
      const err = await capturarErro(() =>
        c.query(`select public.plan_tecido_aplicar_ao_modelo($1,$2::jsonb)`, [s.slot, JSON.stringify(s.materiais)]),
      );
      expect(err).toBeNull();
      const cur = await um<{ n: string }>(c, `select count(*) n from modelo_tecido_variantes mtv join modelo_tecidos mt on mt.id=mtv.modelo_tecido_id where mt.modelo_id=$1`, [s.modelo]);
      expect(Number(cur.n)).toBe(1);
    });
  });
});
