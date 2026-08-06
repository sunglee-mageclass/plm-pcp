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
