// Achados MÉDIOS R10, carona fin #9 (migration 20261020120000): parser ÚNICO de prazo na OC de Produto Acabado.
// gerar_parcelas_oc_p_acabado separava o prazo SÓ por "/" (string_to_array); agora separa por qualquer caractere não
// numérico (regexp '[^0-9]+'), como as outras OCs e servicos_financeiro. parcela_voltar_vencimento_automatico (ramo
// p_acabado) espelha a geradora e recebe o mesmo parser. Integração em BEGIN…ROLLBACK; só na cópia local.
// O espelho TS (contarParcelasPrazo, oc-p-acabado/shared.ts) é da tarefa do front da R10.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";

const RODA = hasDb && ehBancoLocal();

async function ocPA(c: Client, prazo: string | null): Promise<string> {
  await comoUsuario(c);
  const emp = await um<{ id: string }>(
    c,
    `select id from empresas where tenant_id = $1 order by id limit 1`,
    [TENANT_TESTE],
  );
  const dados = {
    nome_produto: "R10-FIN9-PA",
    empresa_id: emp.id,
    data_pedido: "2026-09-01",
    prazo_pagamento: prazo,
    qtd_total: 10,
    valor_unitario: 100,
    desconto_pct: 0,
    grade_proporcao: {},
    variantes: [],
  };
  const grade = { "1": { P: { pedida: 10, recebida: 0, defeito: 0 } } };
  return (
    await um<{ id: string }>(
      c,
      `select public._salvar_oc_p_acabado_core(null::uuid, $1::jsonb, $2::jsonb, null::int) as id`,
      [JSON.stringify(dados), JSON.stringify(grade)],
    )
  ).id;
}
async function parcelas(c: Client, oc: string) {
  return (
    await c.query(
      `select id, numero_parcela n, to_char(data_vencimento,'YYYY-MM-DD') venc, valor::numeric(14,2)::text valor
         from parcelas where oc_p_acabado_id = $1 order by numero_parcela`,
      [oc],
    )
  ).rows as { id: string; n: number; venc: string; valor: string }[];
}

describe.skipIf(!RODA)("medios R10 fin #9 — prazo da OC P. Acabado com o parser único", () => {
  it("migration: textos da 20261020120000; ACL de parcela_voltar_vencimento_automatico intacta", async () => {
    await withTx(async (c) => {
      const r = await um<Record<string, unknown>>(
        c,
        `select md5(pg_get_functiondef('public.gerar_parcelas_oc_p_acabado()'::regprocedure)) g,
                md5(pg_get_functiondef('public.parcela_voltar_vencimento_automatico(uuid)'::regprocedure)) v,
                has_function_privilege('anon','public.parcela_voltar_vencimento_automatico(uuid)','EXECUTE') va,
                has_function_privilege('authenticated','public.parcela_voltar_vencimento_automatico(uuid)','EXECUTE') vu`,
      );
      expect(r).toEqual({
        // R16 RA1 (20261026100000, P-187 A) trocou os 2 textos de novo (parcela complemento): 4b90865a/ef80c3c8 → abaixo
        g: "bb1519aaaa70259aaa222be67045377b",
        v: "05f05e87411e9dcb6be9aeee9602cf70",
        va: false,
        vu: true,
      });
    });
  });

  const casos: [string | null, string[]][] = [
    ["30/60/90", ["2026-10-01", "2026-10-31", "2026-11-30"]], // igual a antes
    ["30, 60, 90", ["2026-10-01", "2026-10-31", "2026-11-30"]], // antes: 1 parcela (só o "30")
    ["30-60", ["2026-10-01", "2026-10-31"]], // antes: 1 parcela de 30 (fallback)
    ["30 60", ["2026-10-01", "2026-10-31"]],
    [" 45", ["2026-10-16"]], // antes: " 45" falhava o regex -> fallback 30
    ["0", ["2026-09-01"]], // à vista
    ["", ["2026-10-01"]], // nenhum número -> [30] (fallback de sempre)
    ["a vista", ["2026-10-01"]],
    [null, ["2026-10-01"]], // NULL -> '30'
  ];
  for (const [prazo, vencs] of casos) {
    it(`prazo ${JSON.stringify(prazo)} -> ${vencs.length} parcela(s) em ${vencs.join(", ")}; Σ = total`, async () => {
      await withTx(async (c) => {
        const oc = await ocPA(c, prazo);
        const ps = await parcelas(c, oc);
        expect(ps.map((p) => p.venc)).toEqual(vencs);
        expect(ps.reduce((s, p) => s + Math.round(Number(p.valor) * 100), 0)).toBe(100000); // 10 × 100,00
      });
    });
  }

  it("'Voltar ao cálculo automático' (P-171 A) devolve a MESMA data da geradora com '30, 60'", async () => {
    await withTx(async (c) => {
      const oc = await ocPA(c, "30, 60");
      const [, p2] = await parcelas(c, oc);
      expect(p2.venc).toBe("2026-10-31");
      await c.query(`update parcelas set data_vencimento = '2028-01-31' where id = $1`, [p2.id]);
      const r = await um<{ r: { data_vencimento: string } }>(
        c,
        `select public.parcela_voltar_vencimento_automatico($1) r`,
        [p2.id],
      );
      expect(r.r.data_vencimento).toBe("2026-10-31");
    });
  });
});
