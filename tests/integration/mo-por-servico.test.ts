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
