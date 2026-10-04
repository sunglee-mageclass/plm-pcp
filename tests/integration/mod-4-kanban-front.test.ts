// Modularidade F4 — anti-drift TS×SQL do "não se aplica" do kanban (P-254 A, Parte 8a).
// `condicoesForaDoModulo(modules)` (src/lib/kanban-condicoes.ts, usado pela Config da Loja) tem de listar EXATAMENTE as chaves que o
// servidor devolve como `true` por módulo desligado (`_kanban_cond_na(loja)`, T3). Só LEITURA + UPDATE de `tenant_config.modules`
// dentro de transação revertida (sem claims, MOD-1), SÓ na cópia local. A T3 é aplicada/mantida DENTRO da txn pelo mod-helpers.
import { describe, it, expect } from "vitest";
import { hasDb, ehBancoLocal, withTx, um, semJwt, TENANT_TESTE } from "./db";
import { aplicaMod, modViva } from "./mod-helpers";
import { condicoesForaDoModulo } from "../../src/lib/kanban-condicoes";
import { resolverModulos } from "../../src/hooks/useTenantModules";

const RODA = hasDb && ehBancoLocal();

async function naDoServidor(c: Parameters<typeof um>[0], t: string): Promise<string[]> {
  const j = (
    await um<{ j: Record<string, boolean> }>(c, `SELECT public._kanban_cond_na($1) AS j`, [t])
  ).j;
  return Object.entries(j)
    .filter(([, v]) => v === true)
    .map(([k]) => k)
    .sort();
}
async function modulosDaLoja(c: Parameters<typeof um>[0], t: string) {
  const r = await um<{ m: Record<string, boolean> | null }>(
    c,
    `SELECT modules AS m FROM public.tenant_config WHERE tenant_id = $1`,
    [t],
  );
  return resolverModulos(r?.m ?? null);
}

describe.skipIf(!RODA)("mod F4 — condicoesForaDoModulo (TS) = _kanban_cond_na (SQL)", () => {
  it("todas as lojas da cópia (módulos reais de cada uma)", async () => {
    await withTx(async (c) => {
      if (!(await modViva(c, 3))) await aplicaMod(c, 3); // cópia já com a T3 = sem DDL nenhum
      const lojas = (await c.query(`SELECT id AS t FROM public.tenants`)).rows.map(
        (r) => r.t as string,
      );
      expect(lojas.length).toBeGreaterThan(3);
      for (const t of lojas) {
        const ts = [...condicoesForaDoModulo(await modulosDaLoja(c, t)).keys()].sort();
        expect(ts, t).toEqual(await naDoServidor(c, t));
      }
    });
  });

  it("Loja Teste: as 8 combinações de Criação / Entrada e Saída / Produção; chave ausente = ligado nos dois lados", async () => {
    await withTx(async (c) => {
      if (!(await modViva(c, 3))) await aplicaMod(c, 3); // cópia já com a T3 = sem DDL nenhum
      const t = TENANT_TESTE;
      let vistas = 0;
      for (const criacao of [true, false]) {
        for (const es of [true, false]) {
          for (const producao of [true, false]) {
            await semJwt(c, () =>
              c.query(
                `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) || $2::jsonb WHERE tenant_id = $1`,
                [t, JSON.stringify({ criacao, entrada_saida: es, producao })],
              ),
            );
            const ts = condicoesForaDoModulo(await modulosDaLoja(c, t));
            expect([...ts.keys()].sort(), JSON.stringify({ criacao, es, producao })).toEqual(
              await naDoServidor(c, t),
            );
            vistas += ts.size;
          }
        }
      }
      expect(vistas, "alguma combinação tira condições (não passa vazio)").toBeGreaterThan(0);
      // chave ausente (e `null`) = padrão ligado nos dois lados (só `false` explícito desliga)
      await semJwt(c, () =>
        c.query(
          `UPDATE public.tenant_config SET modules = coalesce(modules, '{}'::jsonb) - 'producao' - 'entrada_saida' - 'criacao' WHERE tenant_id = $1`,
          [t],
        ),
      );
      const raw = (
        await um<{ m: Record<string, boolean> }>(
          c,
          `SELECT modules AS m FROM public.tenant_config WHERE tenant_id = $1`,
          [t],
        )
      ).m;
      expect(condicoesForaDoModulo(raw).size).toBe(0);
      expect(await naDoServidor(c, t)).toEqual([]);
    });
  });
});
