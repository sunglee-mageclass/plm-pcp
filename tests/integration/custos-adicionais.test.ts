import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Custos adicionais por modelo (Desenvolvimento > 6. Custos): linhas {descricao, valor} entram
// no custo REAL. custo_unitario_modelos, ramo confirmado, ganha + Σ(custos_adicionais).
describe.skipIf(!hasDb)("custo_unitario_modelos — custos_adicionais somam no real", () => {
  it("adicionar custos aumenta o 'real' pela soma (CAD confirmado)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string } | undefined>(c,
        `select modelo_id id from cad
          where tenant_id=$1 and enviado_corte
          order by data_enviado_corte desc nulls last limit 1`, [TENANT_TESTE]);
      if (!m) return; // sem modelo com CAD confirmado → auto-pula

      const realDe = async () => Number((await um<{ v: string }>(c,
        `select (public.custo_unitario_modelos(array[$1::uuid]) -> $2 ->> 'real')::numeric v`, [m.id, m.id])).v);

      await c.query(`update modelos set custos_adicionais='[]'::jsonb where id=$1`, [m.id]);
      const real0 = await realDe();

      await c.query(`update modelos set custos_adicionais=$2::jsonb where id=$1`,
        [m.id, JSON.stringify([{ descricao: "estampa", valor: 5 }, { descricao: "lavanderia", valor: 3 }])]);
      const real1 = await realDe();

      expect(real1 - real0).toBeCloseTo(8, 2);
    });
  });

  it("dashboard_custos: o 'real' também soma custos_adicionais (CAD confirmado)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string } | undefined>(c,
        `select modelo_id id from cad where tenant_id=$1 and enviado_corte
          order by data_enviado_corte desc nulls last limit 1`, [TENANT_TESTE]);
      if (!m) return;

      const realDe = async (): Promise<number | null> => {
        const rows = (await um<{ j: any }>(c,
          `select public._dashboard_custos_core(null,null,null,null,null) -> 'rows' j`)).j as any[];
        const row = (rows ?? []).find((r) => r.id === m.id);
        return row ? Number(row.real) : null;
      };

      await c.query(`update modelos set custos_adicionais='[]'::jsonb where id=$1`, [m.id]);
      const r0 = await realDe();
      await c.query(`update modelos set custos_adicionais=$2::jsonb where id=$1`,
        [m.id, JSON.stringify([{ descricao: "estampa", valor: 4 }])]);
      const r1 = await realDe();
      if (r0 == null || r1 == null) return; // fora do período/filtro → pula
      expect(r1 - r0).toBeCloseTo(4, 2);
    });
  });
});
