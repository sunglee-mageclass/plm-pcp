// F6 Fluxo 2 — requisitos CONFIGURAVEIS do "Enviar a Explosao" (tenant_config.explosao_requisitos).
// Task 1: coluna + salvar_config_loja (lista branca + CAS por coluna). Task 2: gate no _enviar_modelo_para_cad_core.
// Tudo em txn revertida (withTx = BEGIN…ROLLBACK) — nada e gravado; SO na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

const T = TENANT_TESTE;
const CHAMA = "SELECT public.salvar_config_loja($1::uuid, $2::jsonb, $3::jsonb, $4::boolean) AS r";

type Erro = { code?: string; message: string; detail?: string };
/** Roda a query num SAVEPOINT; devolve o erro (ou null) e deixa a txn usavel. */
async function tenta(c: Client, sql: string, params: any[] = []): Promise<{ erro: Erro | null; rows: any[] }> {
  await c.query("SAVEPOINT t_f6");
  try {
    const r = await c.query(sql, params);
    await c.query("RELEASE SAVEPOINT t_f6");
    return { erro: null, rows: r.rows };
  } catch (e: any) {
    await c.query("ROLLBACK TO SAVEPOINT t_f6");
    return { erro: { code: e.code, message: e.message, detail: e.detail }, rows: [] };
  }
}
async function salvar(c: Client, mud: object, base: object, chave: boolean | null = null) {
  return tenta(c, CHAMA, [T, JSON.stringify(mud), JSON.stringify(base), chave]);
}
async function lerReq(c: Client): Promise<any> {
  return (await um<{ r: any }>(c, `SELECT explosao_requisitos AS r FROM public.tenant_config WHERE tenant_id = $1`, [T])).r;
}

describe.skipIf(!hasDb || !ehBancoLocal())("F6 explosao_requisitos — salvar_config_loja", () => {
  it("grava uma lista de cond_keys via salvar_config_loja (CAS por coluna)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); // super admin da Loja Teste
      const base = await lerReq(c);
      const r = await salvar(c, { explosao_requisitos: ["peca_teste_aprovada", "grade_preenchida"] }, { explosao_requisitos: base });
      expect(r.erro).toBeNull();
      expect(await lerReq(c)).toEqual(["peca_teste_aprovada", "grade_preenchida"]);
    });
  });

  it("recusa valor nao-array (P0001)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const r = await salvar(c, { explosao_requisitos: "x" }, {});
      expect(r.erro?.code).toBe("P0001");
      expect(r.erro?.message).toMatch(/Formato inv|explosao_requisitos/);
    });
  });

  it("recusa valor null (P0001, nao pode ficar vazio)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const r = await salvar(c, { explosao_requisitos: null }, {});
      expect(r.erro?.code).toBe("P0001");
      expect(r.erro?.message).toMatch(/vazio|explosao_requisitos/);
    });
  });

  it("CAS por coluna: base velha -> P0409 conflito_versao (DETAIL explosao_requisitos)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const carregado = await lerReq(c); // o que a tela carregou
      // outra pessoa salvou depois da carga
      await c.query(`UPDATE public.tenant_config SET explosao_requisitos = '["cq_liberado"]'::jsonb WHERE tenant_id = $1`, [T]);
      const r = await salvar(c, { explosao_requisitos: ["linha_definida"] }, { explosao_requisitos: carregado });
      expect(r.erro?.code).toBe("P0409");
      expect(r.erro?.message).toBe("conflito_versao: config_loja");
      expect(r.erro?.detail).toBe("explosao_requisitos");
    });
  });
});
