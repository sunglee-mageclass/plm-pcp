// Reforma da Peça Teste por TIPO — a VOLTA (Task 10): ida das 5 migrations + os 5 _down em ordem LIFO devolvem, byte a byte (md5), os 8 corpos de
// ANTES e a chave por linha; o _down_drop recusa enquanto houver _down por rodar e depois apaga o que a reforma criou. Txn revertida; só cópia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, um } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { DOWNS, aplicaReforma, exigePreReforma, prepara, tenta } from "./peca-teste-tipo-helpers";

const RODA = hasDb && ehBancoLocal();
const DOWN_DROP = "supabase/rollback/20261129120000_peca_teste_tipo_down_drop.sql";
const ANTES: Record<string, string> = {
  "public._peca_teste_aprovada(uuid,uuid,uuid)": "417fa9850a5a52204f62476818dc408c",
  "public._salvar_peca_teste_core(uuid,jsonb,jsonb)": "3e3b9db2d04dd176a4712898293f8545",
  "public._peca_teste_mini_aplicar(uuid,uuid,jsonb)": "e6c43399f0a5c20c17c6255477947d2d",
  "public.fn_peca_teste_trava_fornecedor()": "982769d4384a04d9a35d53db654667da",
  "public._peca_teste_trilhas_core(uuid,uuid)": "ef860a61e25750d2d12131062a23202d",
  "public._peca_teste_quadro_core(uuid)": "6e191644f2fb4acfea04e4ff76a6f5de",
  "public._peca_teste_status_lote_core(uuid,uuid[])": "fff007ebb8ce0dbffe39e8f09fd53643",
  "public._avaliar_condicoes_etapas_pl_core(uuid,uuid[])": "f1b0fb725bac26981bdfede204238e78",
};
const md5s = async (c: Client) =>
  Object.fromEntries(await Promise.all(Object.keys(ANTES).map(async (sig) => [sig, (await um<{ m: string }>(c, "SELECT md5(pg_get_functiondef($1::regprocedure)) AS m", [sig])).m])));
const novas = async (c: Client) =>
  (await um<{ n: string }>(c, `SELECT count(*) AS n FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('_peca_teste_aprovada_tipo', '_peca_teste_valida_fornecedor', '_peca_teste_fornecedores_tipo', 'fn_peca_teste_trava_fornecedor_tentativa')`)).n;

describe.skipIf(!RODA)("reforma por TIPO — a volta (Task 10)", () => {
  it("ida (5 migrations) e volta LIFO (5 _down): os 8 corpos voltam ao md5 de ANTES; a chave por linha volta; _down_drop recusa cedo e depois limpa", async (ctx) => {
    await withTx(async (c) => {
      await prepara(c, null);
      await exigePreReforma(c, ctx);
      const antes = await md5s(c);
      expect(antes).toEqual(ANTES); // a cópia local É o "antes" (senão este teste não prova nada)
      await aplicaReforma(c, "evalpl");
      const depois = await md5s(c);
      for (const sig of Object.keys(ANTES)) expect(depois[sig], sig).not.toBe(ANTES[sig]); // a ida mudou os 8
      // _down_drop com a ida viva: recusa
      const cedo = await tenta(c, () => aplicarArquivo(c, DOWN_DROP));
      expect(cedo?.message).toMatch(/reforma_pt_down_drop: /);
      for (const k of ["evalpl", "leitura", "salvar", "predicado", "dados"] as const) await aplicarArquivo(c, DOWNS[k]);
      expect(await md5s(c)).toEqual(ANTES);
      expect(await um(c, "SELECT 1 AS x FROM pg_indexes WHERE indexname = 'mpt_trilha_numero_ux'")).toMatchObject({ x: 1 });
      expect(await novas(c)).toBe("4"); // as 4 funções novas ficam inertes até o _down_drop
      await aplicarArquivo(c, DOWN_DROP);
      expect(await novas(c)).toBe("0");
      expect(await um(c, "SELECT 1 AS x FROM pg_trigger WHERE tgname = 'trg_peca_teste_trava_fornecedor_tentativa'")).toBeUndefined();
      for (const k of ["evalpl", "leitura", "salvar", "predicado", "dados"] as const) await aplicarArquivo(c, DOWNS[k]); // 2x = no-op
      expect(await md5s(c)).toEqual(ANTES);
    });
  });
});
