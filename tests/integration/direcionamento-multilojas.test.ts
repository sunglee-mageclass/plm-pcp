import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Direcionamento multi-lojas — tudo em txn revertida (BEGIN…ROLLBACK): nada é gravado.
describe.skipIf(!hasDb)("Multi-lojas fase 1 — cadastro lojas_direcionamento", () => {
  it("todo tenant tem E-commerce (default, ordem 1) e Loja Física (ordem 2) semeadas", async () => {
    await withTx(async (c) => {
      const faltando = await um<{ n: string }>(
        c,
        `select count(*) as n from tenants t
          where not exists (select 1 from lojas_direcionamento l
                             where l.tenant_id = t.id and l.is_default and l.nome = 'E-commerce')
             or not exists (select 1 from lojas_direcionamento l
                             where l.tenant_id = t.id and l.nome = 'Loja Física')`,
      );
      expect(Number(faltando.n)).toBe(0);
      const seeds = await c.query(
        `select nome, ativo, is_default, ordem from lojas_direcionamento
          where tenant_id = $1 order by ordem`,
        [TENANT_TESTE],
      );
      expect(seeds.rows[0]).toMatchObject({ nome: "E-commerce", ativo: true, is_default: true, ordem: 1 });
      expect(seeds.rows[1]).toMatchObject({ nome: "Loja Física", ativo: true, is_default: false, ordem: 2 });
    });
  });

  it("_seed_tenant_defaults passou a semear lojas (loja nova/reset nasce com as 2)", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c,
        `select position('lojas_direcionamento' in pg_get_functiondef('public._seed_tenant_defaults(uuid)'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });

  it("UNIQUE (tenant_id, nome) barra loja duplicada", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await expect(
        c.query(`insert into lojas_direcionamento (tenant_id, nome) values ($1, 'E-commerce')`, [TENANT_TESTE]),
      ).rejects.toThrow(/duplicate key|lojas_direcionamento_tenant_nome/);
    });
  });

  it("índice único parcial barra um 2º default no mesmo tenant", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await expect(
        c.query(
          `insert into lojas_direcionamento (tenant_id, nome, is_default) values ($1, 'Outra Loja', true)`,
          [TENANT_TESTE],
        ),
      ).rejects.toThrow(/duplicate key|lojas_direcionamento_um_default/);
    });
  });
});

describe.skipIf(!hasDb)("Multi-lojas fase 2 — direcionamento_lojas + backfill + excluir", () => {
  it("backfill: linha E-commerce migrada é idêntica ao jsonb legado (e Loja Física idem)", async () => {
    await withTx(async (c) => {
      const leg = await um<{ cad_id: string; variante_numero: number; ecommerce: any; loja_fisica: any } | undefined>(
        c,
        `select cad_id, variante_numero, coalesce(ecommerce, '{}'::jsonb) as ecommerce,
                coalesce(loja_fisica, '{}'::jsonb) as loja_fisica
           from direcionamento limit 1`,
      );
      if (!leg) return; // sem legado → nada a migrar
      const ec = await um<{ grades: any }>(
        c,
        `select dl.grades from direcionamento_lojas dl
           join lojas_direcionamento l on l.id = dl.loja_id
          where dl.cad_id = $1 and dl.variante_numero = $2 and l.is_default`,
        [leg.cad_id, leg.variante_numero],
      );
      expect(ec.grades).toEqual(leg.ecommerce);
      const lf = await um<{ grades: any }>(
        c,
        `select dl.grades from direcionamento_lojas dl
           join lojas_direcionamento l on l.id = dl.loja_id
          where dl.cad_id = $1 and dl.variante_numero = $2 and l.nome = 'Loja Física'`,
        [leg.cad_id, leg.variante_numero],
      );
      expect(lf.grades).toEqual(leg.loja_fisica);
    });
  });

  it("trigger de rebaixe passou a olhar também direcionamento_lojas", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c,
        `select position('direcionamento_lojas' in pg_get_functiondef('public.fn_rebaixa_direcionamento_grade()'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });

  it("trigger de rebaixe: cad com direcionamento SÓ no modelo novo (sem linha legada) rebaixa 'separado'→'pendente' quando a grade real muda", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string }>(
        c,
        `insert into cad (tenant_id, direcionamento_status) values ($1, 'separado') returning id`,
        [TENANT_TESTE],
      );
      await c.query(
        `insert into cad_grades (cad_id, variante_numero, grades_planejadas, grades_reais)
         values ($1, 1, '{"P":10}'::jsonb, '{"P":5}'::jsonb)`,
        [cad.id],
      );
      const loja = await um<{ id: string }>(
        c,
        `select id from lojas_direcionamento where tenant_id = $1 and is_default limit 1`,
        [TENANT_TESTE],
      );
      await c.query(
        `insert into direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades)
         values ($1, $2, $3, 1, '{}'::jsonb)`,
        [TENANT_TESTE, cad.id, loja.id],
      );
      // sanidade: NENHUMA linha legada para este cad — prova que é o gate NOVO
      // (EXISTS direcionamento_lojas) que dispara o rebaixe, não o legado.
      const legado = await um<{ n: string }>(
        c, `select count(*) as n from direcionamento where cad_id = $1`, [cad.id],
      );
      expect(Number(legado.n)).toBe(0);

      // Muda a grade real (como o CQ faria ao confirmar/desmarcar) → dispara o trigger.
      await c.query(
        `update cad_grades set grades_reais = '{"P":7}'::jsonb where cad_id = $1 and variante_numero = 1`,
        [cad.id],
      );

      const status = await um<{ direcionamento_status: string }>(
        c, `select direcionamento_status from cad where id = $1`, [cad.id],
      );
      expect(status.direcionamento_status).toBe("pendente");
    });
  });

  it("excluir_loja_direcionamento: exige tenant_admin/super_admin no corpo (SECURITY DEFINER bypassa RLS, checagem tem que ser explícita)", async () => {
    await withTx(async (c) => {
      // Não dá pra simular um usuário NÃO-admin no harness: USER_TESTE (único usuário de
      // TENANT_TESTE) é super_admin (ver tests/integration/db.ts) — qualquer chamada dele
      // passa no gate de admin de qualquer forma. A negativa (RAISE p/ chamador sem
      // tenant_admin/super_admin) foi provada manualmente via psql — ver task-2-report.md.
      const r = await um<{ tem: boolean }>(
        c,
        `select position('is_tenant_admin' in pg_get_functiondef('public.excluir_loja_direcionamento(uuid)'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });

  it("excluir_loja_direcionamento: loja padrão dá RAISE", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const padrao = await um<{ id: string }>(
        c,
        `select id from lojas_direcionamento where tenant_id = $1 and is_default limit 1`,
        [TENANT_TESTE],
      );
      await expect(
        c.query(`select excluir_loja_direcionamento($1)`, [padrao.id]),
      ).rejects.toThrow(/padrão/);
    });
  });

  it("excluir_loja_direcionamento: loja com linhas de direcionamento dá RAISE", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string } | undefined>(
        c, `select id from cad where tenant_id = $1 limit 1`, [TENANT_TESTE],
      );
      if (!cad) return;
      const loja = await um<{ id: string }>(
        c,
        `insert into lojas_direcionamento (tenant_id, nome, ordem) values ($1, 'Atacado Teste', 9) returning id`,
        [TENANT_TESTE],
      );
      await c.query(
        `insert into direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades)
         values ($1, $2, $3, 1, '{}'::jsonb)`,
        [TENANT_TESTE, cad.id, loja.id],
      );
      await expect(
        c.query(`select excluir_loja_direcionamento($1)`, [loja.id]),
      ).rejects.toThrow(/linha\(s\) de direcionamento/);
    });
  });

  it("excluir_loja_direcionamento: loja livre (sem uso, não-default) é excluída", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const loja = await um<{ id: string }>(
        c,
        `insert into lojas_direcionamento (tenant_id, nome, ordem) values ($1, 'Outlet Teste', 8) returning id`,
        [TENANT_TESTE],
      );
      await c.query(`select excluir_loja_direcionamento($1)`, [loja.id]);
      const n = await um<{ n: string }>(
        c, `select count(*) as n from lojas_direcionamento where id = $1`, [loja.id],
      );
      expect(Number(n.n)).toBe(0);
    });
  });
});

describe.skipIf(!hasDb)("Multi-lojas fase 3 — RPC core v2", () => {
  // Fixture comum: 1 cad da Loja Teste com PELO MENOS 1 tamanho de grade real > 0
  // (grade toda zerada tornaria os testes de falta/sobra vácuos) + a loja default.
  async function fixture(c: any) {
    const cad = await um<{ id: string } | undefined>(
      c,
      `select c2.id from cad c2
        where c2.tenant_id = $1
          and exists (select 1 from cad_grades g
                        cross join lateral jsonb_each_text(coalesce(g.grades_reais, '{}'::jsonb)) t
                       where g.cad_id = c2.id and (t.value)::int > 0)
        limit 1`,
      [TENANT_TESTE],
    );
    if (!cad) return null;
    const loja = await um<{ id: string }>(
      c, `select id from lojas_direcionamento where tenant_id = $1 and is_default limit 1`, [TENANT_TESTE],
    );
    const grades = await c.query(
      `select variante_numero, coalesce(grades_reais, '{}'::jsonb) as g
         from cad_grades where cad_id = $1 order by variante_numero`,
      [cad.id],
    );
    return { cadId: cad.id, lojaId: loja.id, grades: grades.rows as { variante_numero: number; g: Record<string, number> }[] };
  }

  it("rascunho parcial grava (soma menor que a grade real é aceita)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixture(c);
      if (!f) return;
      const rows = [{ loja_id: f.lojaId, variante_numero: f.grades[0].variante_numero, grades: {} }];
      await c.query(`select salvar_direcionamento($1, $2::jsonb)`, [f.cadId, JSON.stringify(rows)]);
      const n = await um<{ n: string }>(
        c,
        `select count(*) as n from direcionamento_lojas where cad_id = $1 and loja_id = $2`,
        [f.cadId, f.lojaId],
      );
      expect(Number(n.n)).toBe(1);
    });
  });

  it("confirmar (core estrito) com soma exata passa e marca 'separado' na MESMA txn", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixture(c);
      if (!f) return;
      // Direciona TUDO pra loja default: Σ por tamanho = grade real em toda variante.
      const rows = f.grades.map((r) => ({ loja_id: f.lojaId, variante_numero: r.variante_numero, grades: r.g }));
      // Core direto (conexão postgres ignora ACL) — o gate de CQ do wrapper é testado à parte.
      await c.query(`select _salvar_direcionamento_core($1, $2::jsonb, true, true)`, [f.cadId, JSON.stringify(rows)]);
      const st = await um<{ s: string }>(c, `select direcionamento_status as s from cad where id = $1`, [f.cadId]);
      expect(st.s).toBe("separado");
    });
  });

  it("confirmar com FALTA num tamanho dá RAISE em PT com o tamanho e a diferença, código P0001 (não 23514 — senão erro-mensagem.ts engole o detalhe pela mensagem genérica)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixture(c);
      if (!f) return;
      // Só UM mismatch no payload inteiro (senão a ordem de iteração não-determinística do
      // core, entre variantes/tamanhos, poderia disparar o RAISE num tamanho diferente do
      // que o teste registrou).
      let tamFalta = "";
      let alterado = false;
      const rows = f.grades.map((r) => {
        const g = { ...r.g };
        if (!alterado) {
          const tam = Object.keys(g).find((t) => Number(g[t]) > 0);
          if (tam) {
            g[tam] = Number(g[tam]) - 1; // 1 peça a menos num tamanho com real > 0
            tamFalta = tam;
            alterado = true;
          }
        }
        return { loja_id: f.lojaId, variante_numero: r.variante_numero, grades: g };
      });
      if (!tamFalta) return;
      let erro: any;
      try {
        await c.query(`select _salvar_direcionamento_core($1, $2::jsonb, true, false)`, [f.cadId, JSON.stringify(rows)]);
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeDefined();
      expect(erro.code).toBe("P0001");
      expect(erro.message).toMatch(/Falta direcionar 1 peça\(s\)/);
      expect(erro.message).toContain(`no tamanho ${tamFalta}`);
    });
  });

  it("confirmar com SOBRA num tamanho dá RAISE em PT com o tamanho e a diferença, código P0001", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixture(c);
      if (!f) return;
      // Idem: só UM mismatch no payload inteiro, pro tamanho registrado ser o mesmo que o
      // core reporta (a ordem entre variantes/tamanhos no core não é garantida).
      let tamSobra = "";
      let alterado = false;
      const rows = f.grades.map((r) => {
        const g = { ...r.g };
        if (!alterado) {
          const tam = Object.keys(g)[0];
          if (tam) {
            g[tam] = Number(g[tam] ?? 0) + 1; // 1 peça a mais
            tamSobra = tam;
            alterado = true;
          }
        }
        return { loja_id: f.lojaId, variante_numero: r.variante_numero, grades: g };
      });
      if (!tamSobra) return;
      let erro: any;
      try {
        await c.query(`select _salvar_direcionamento_core($1, $2::jsonb, true, false)`, [f.cadId, JSON.stringify(rows)]);
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeDefined();
      expect(erro.code).toBe("P0001");
      expect(erro.message).toMatch(/a mais/);
      expect(erro.message).toContain(`no tamanho ${tamSobra}`);
    });
  });

  it("loja de OUTRO tenant no payload dá RAISE", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixture(c);
      if (!f) return;
      const outra = await um<{ id: string } | undefined>(
        c, `select id from lojas_direcionamento where tenant_id <> $1 limit 1`, [TENANT_TESTE],
      );
      if (!outra) return;
      const rows = [{ loja_id: outra.id, variante_numero: f.grades[0].variante_numero, grades: {} }];
      await expect(
        c.query(`select salvar_direcionamento($1, $2::jsonb)`, [f.cadId, JSON.stringify(rows)]),
      ).rejects.toThrow(/não encontrada nesta conta/);
    });
  });

  it("linha NOVA de loja desativada dá RAISE", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const f = await fixture(c);
      if (!f) return;
      const inativa = await um<{ id: string }>(
        c,
        `insert into lojas_direcionamento (tenant_id, nome, ativo, ordem) values ($1, 'Inativa Teste', false, 7) returning id`,
        [TENANT_TESTE],
      );
      const rows = [{ loja_id: inativa.id, variante_numero: f.grades[0].variante_numero, grades: {} }];
      await expect(
        c.query(`select salvar_direcionamento($1, $2::jsonb)`, [f.cadId, JSON.stringify(rows)]),
      ).rejects.toThrow(/desativada/);
    });
  });

  it("core tem EXECUTE revogado de anon e authenticated (invariante #9)", async () => {
    await withTx(async (c) => {
      const r = await um<{ a: boolean; b: boolean }>(
        c,
        `select has_function_privilege('anon', 'public._salvar_direcionamento_core(uuid,jsonb,boolean,boolean)', 'EXECUTE') as a,
                has_function_privilege('authenticated', 'public._salvar_direcionamento_core(uuid,jsonb,boolean,boolean)', 'EXECUTE') as b`,
      );
      expect(r.a).toBe(false);
      expect(r.b).toBe(false);
    });
  });

  it("confirmar_direcionamento mantém o gate de CQ no servidor (_cq_liberado)", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c,
        `select position('_cq_liberado' in pg_get_functiondef('public.confirmar_direcionamento(uuid,jsonb)'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });
});
