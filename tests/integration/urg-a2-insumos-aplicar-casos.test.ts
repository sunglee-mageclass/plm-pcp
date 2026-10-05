// Urgentes R2 (T10 x T12) - anti-drift SQL x TS da leitura TOLERANTE da lista "Insumos padrao" que CRIA CARD: o helper do servidor
// public._insumos_padrao_aplicar (migration 20261103175000) contra a fixture COMPARTILHADA CASOS_APLICAR/CATALOGO_APLICAR
// (tests/fixtures/insumos-padrao-casos.ts), que o TS (normalizarInsumosPadraoParaCard) tambem roda. O SQL e a fonte da verdade.
// Txn revertida, so na copia local: cria o catalogo na Loja Teste (insumos/cores com os ids FIXOS da fixture + as variantes), grava
// cada `entrada` CRUA em tenant_config.insumos_padrao por UPDATE direto (sem a validacao do salvar_config_loja - como uma escrita
// direta do admin), cria um card interno e chama o helper como os criadores do servidor fazem (logo depois do INSERT do card);
// compara as linhas de modelo_etiquetas com `esperado` (o campo `orfaos` e so do TS).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, um, semJwt, ehBancoLocal, TENANT_TESTE } from "./db";
import { aplicaUrgA } from "./urg-a-helpers";
import { exigeBancoLocal } from "./mig-txn";
import { CASOS_APLICAR, CATALOGO_APLICAR, IP_IDS, type InsumoPadrao } from "../fixtures/insumos-padrao-casos";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;

/** Catalogo da fixture na Loja Teste; E_OUTRA/C_OUTRA noutra loja; E_INEXISTENTE nao existe em lugar nenhum. */
async function catalogo(c: Client): Promise<void> {
  await semJwt(c, async () => {
    const outra = (await um<{ id: string }>(c, "SELECT id FROM public.tenants WHERE id <> $1 ORDER BY id LIMIT 1", [T])).id;
    const cores = new Set(Object.values(CATALOGO_APLICAR).flat());
    for (const id of cores) {
      await c.query("INSERT INTO public.cores (id, tenant_id, nome) VALUES ($1, $2, $3)", [id, T, `URG-A2 aplicar cor ${id.slice(-4)}`]);
    }
    await c.query("INSERT INTO public.cores (id, tenant_id, nome) VALUES ($1, $2, 'URG-A2 aplicar cor outra')", [IP_IDS.C_OUTRA, outra]);
    for (const [etq, coresDoInsumo] of Object.entries(CATALOGO_APLICAR)) {
      await c.query("INSERT INTO public.etiquetas (id, tenant_id, nome, preco) VALUES ($1, $2, $3, 1)", [etq, T, `URG-A2 aplicar ${etq.slice(-6)}`]);
      for (const cor of coresDoInsumo) {
        await c.query("INSERT INTO public.variantes_etiqueta (tenant_id, etiqueta_id, cor_id, preco) VALUES ($1, $2, $3, 1)", [T, etq, cor]);
      }
    }
    await c.query("INSERT INTO public.etiquetas (id, tenant_id, nome) VALUES ($1, $2, 'URG-A2 aplicar outra')", [IP_IDS.E_OUTRA, outra]);
  });
}

describe.skipIf(!RODA)("urg R2 - _insumos_padrao_aplicar (SQL) confere com CASOS_APLICAR (fixture compartilhada com o TS)", () => {
  it(`os ${CASOS_APLICAR.length} casos: linhas gravadas em modelo_etiquetas = esperado (ordem, uuid minusculo, cor, consumo)`, async () => {
    await withTx(async (c) => {
      exigeBancoLocal();
      await c.query("SET LOCAL lock_timeout = '3s'");
      await c.query("SET LOCAL statement_timeout = '120s'");
      await aplicaUrgA(c, "175000");
      await catalogo(c);
      const divergentes: string[] = [];
      for (const caso of CASOS_APLICAR) {
        const obtido = await semJwt(c, async () => {
          // escrita CRUA (sem salvar_config_loja), como um UPDATE direto do admin da loja
          await c.query("UPDATE public.tenant_config SET insumos_padrao = $2::jsonb WHERE tenant_id = $1", [T, JSON.stringify(caso.entrada)]);
          const m = (await um<{ id: string }>(
            c,
            "INSERT INTO public.modelos (tenant_id, nome, origem) VALUES ($1, $2, 'interno') RETURNING id",
            [T, `URG-A2 aplicar ${caso.nome.slice(0, 40)}`],
          )).id;
          const n = (await um<{ n: number }>(c, "SELECT public._insumos_padrao_aplicar($1) AS n", [m])).n;
          const { rows } = await c.query(
            `SELECT etiqueta_id::text AS etiqueta_id, cor_id::text AS cor_id, consumo::float8 AS consumo, numero
               FROM public.modelo_etiquetas WHERE modelo_id = $1 ORDER BY numero`,
            [m],
          );
          expect(rows.map((r) => r.numero), caso.nome).toEqual(rows.map((_, i) => i + 1));
          expect(n, caso.nome).toBe(rows.length);
          return rows.map((r): InsumoPadrao => ({ etiqueta_id: r.etiqueta_id, cor_id: r.cor_id, consumo: r.consumo }));
        });
        if (JSON.stringify(obtido) !== JSON.stringify(caso.esperado)) {
          divergentes.push(`${caso.nome}\n  esperado ${JSON.stringify(caso.esperado)}\n  SQL      ${JSON.stringify(obtido)}`);
        }
      }
      expect(divergentes, divergentes.join("\n")).toEqual([]);
    });
  });
});
