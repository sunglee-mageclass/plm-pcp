import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("MO por serviço — Task 1: toggle ativo em categorias_terceirizado", () => {
  it("coluna ativo existe, NOT NULL default true", async () => {
    await withTx(async (c) => {
      const r = await um<{ is_nullable: string; column_default: string }>(
        c,
        `select is_nullable, column_default from information_schema.columns
          where table_name='categorias_terceirizado' and column_name='ativo'`,
      );
      expect(r.is_nullable).toBe("NO");
      expect(r.column_default).toMatch(/true/);
    });
  });

  it("categoria nova nasce ativa; desativar não a exclui", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cat = await um<{ id: string; ativo: boolean }>(
        c,
        `insert into categorias_terceirizado (tenant_id, nome, etapa)
         values ($1, 'Serviço Teste MO', 'ate_costura') returning id, ativo`,
        [TENANT_TESTE],
      );
      expect(cat.ativo).toBe(true);
      await c.query(`update categorias_terceirizado set ativo=false where id=$1`, [cat.id]);
      const still = await um<{ n: string }>(
        c, `select count(*) as n from categorias_terceirizado where id=$1`, [cat.id],
      );
      expect(Number(still.n)).toBe(1);
    });
  });
});

describe.skipIf(!hasDb)("MO por serviço — Task 2: tabela + backfill legado", () => {
  it("tabela existe com FK RESTRICT na categoria e índice parcial do legado", async () => {
    await withTx(async (c) => {
      const restrict = await um<{ n: string }>(
        c,
        `select count(*) as n from pg_constraint
          where conname='modelo_servico_mo_categoria_terceirizado_id_fkey' and confdeltype='r'`,
      );
      expect(Number(restrict.n)).toBe(1); // 'r' = RESTRICT
      const parcial = await um<{ n: string }>(
        c,
        `select count(*) as n from pg_indexes
          where tablename='modelo_servico_mo' and indexname='ux_msm_legado'`,
      );
      expect(Number(parcial.n)).toBe(1);
    });
  });

  it("índice parcial barra 2º legado (categoria NULL) no mesmo modelo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string }>(
        c, `insert into modelos (tenant_id, nome) values ($1,'M legado') returning id`, [TENANT_TESTE],
      );
      await c.query(
        `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor)
         values ($1,$2,NULL,10)`, [TENANT_TESTE, m.id],
      );
      await expect(
        c.query(`insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor)
                 values ($1,$2,NULL,20)`, [TENANT_TESTE, m.id]),
      ).rejects.toThrow(/duplicate key|ux_msm_legado/);
    });
  });

  it("FK RESTRICT impede excluir categoria com MO", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cat = await um<{ id: string }>(
        c, `insert into categorias_terceirizado (tenant_id, nome, etapa)
            values ($1,'Serv RESTRICT','ate_costura') returning id`, [TENANT_TESTE],
      );
      const m = await um<{ id: string }>(
        c, `insert into modelos (tenant_id, nome) values ($1,'M restrict') returning id`, [TENANT_TESTE],
      );
      await c.query(
        `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor)
         values ($1,$2,$3,5)`, [TENANT_TESTE, m.id, cat.id],
      );
      await expect(
        c.query(`delete from categorias_terceirizado where id=$1`, [cat.id]),
      ).rejects.toThrow(/violates foreign key|modelo_servico_mo/);
    });
  });
});

describe.skipIf(!hasDb)("MO por serviço — Task 3: rollup derivado do flag", () => {
  async function novoModeloComLinhas(c: any, aprovados: (boolean | null)[]) {
    const m = await um<{ id: string }>(
      c, `insert into modelos (tenant_id, nome) values ($1,'M rollup') returning id`, [TENANT_TESTE],
    );
    for (let i = 0; i < aprovados.length; i++) {
      const cat = await um<{ id: string }>(
        c, `insert into categorias_terceirizado (tenant_id, nome, etapa)
            values ($1,$2,'ate_costura') returning id`, [TENANT_TESTE, `Serv rollup ${i} ${m.id.slice(0,8)}`],
      );
      await c.query(
        `insert into modelo_servico_mo (tenant_id, modelo_id, categoria_terceirizado_id, valor, aprovado)
         values ($1,$2,$3,10,$4)`, [TENANT_TESTE, m.id, cat.id, aprovados[i]],
      );
    }
    return m.id;
  }
  async function flag(c: any, id: string) {
    const r = await um<{ f: boolean }>(c, `select custo_terceirizados_aprovado as f from modelos where id=$1`, [id]);
    return r.f;
  }

  it("sem linha → flag true (sem serviço = liberada)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, []);
      expect(await flag(c, id)).toBe(true);
    });
  });
  it("todas aprovadas → flag true", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [true, true]);
      expect(await flag(c, id)).toBe(true);
    });
  });
  it("uma pendente → flag false", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [true, null]);
      expect(await flag(c, id)).toBe(false);
    });
  });
  it("uma reprovada → flag false; ao aprovar todas → volta true", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [true, false]);
      expect(await flag(c, id)).toBe(false);
      await c.query(`update modelo_servico_mo set aprovado=true where modelo_id=$1`, [id]);
      expect(await flag(c, id)).toBe(true);
      await c.query(`delete from modelo_servico_mo where modelo_id=$1`, [id]);
      expect(await flag(c, id)).toBe(true); // sem serviço = liberada
    });
  });
  it("flag é à prova de adulteração: UPDATE direto é re-derivado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await novoModeloComLinhas(c, [null]); // pendente → derivado false
      await c.query(`update modelos set custo_terceirizados_aprovado=true where id=$1`, [id]);
      expect(await flag(c, id)).toBe(false); // trigger BEFORE UPDATE re-derivou
    });
  });
  it("custo_unitario.mao_obra_previsto passou a somar modelo_servico_mo.valor", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c, `select position('modelo_servico_mo' in
              pg_get_functiondef('public._custo_unitario_modelos_core(uuid[])'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });
  it("enforce_maodeobra_aprovacao foi aposentado (trigger não existe mais)", async () => {
    await withTx(async (c) => {
      const r = await um<{ n: string }>(
        c, `select count(*) as n from pg_trigger where tgname='trg_enforce_maodeobra_aprovacao'`,
      );
      expect(Number(r.n)).toBe(0);
    });
  });
});
