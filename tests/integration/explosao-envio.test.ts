import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import type { Client } from "pg";

// Envio à Explosão configurável por loja (tenant_config.explosao_envio_status):
// gate `_explosao_envio_gate` + enforcement no `_enviar_modelo_para_cad_core`.
// Tudo em txn revertida (BEGIN…ROLLBACK) — nada é gravado.

const T = TENANT_TESTE;

async function setCfg(c: Client, v: string | null) {
  await c.query(`UPDATE public.tenant_config SET explosao_envio_status = $2 WHERE tenant_id = $1`, [T, v]);
}
async function setStatus(c: Client, modeloId: string, status: string) {
  await c.query(`UPDATE public.modelos SET status_desenvolvimento = $2 WHERE id = $1`, [modeloId, status]);
}
async function gate(c: Client, status: string) {
  return um<{ ok: boolean; req_key: string; req_label: string }>(
    c,
    `SELECT ok, req_key, req_label FROM public._explosao_envio_gate($1, $2)`,
    [T, status],
  );
}
async function callCore(c: Client, modeloId: string) {
  return c.query(`SELECT public._enviar_modelo_para_cad_core($1) AS cad_id`, [modeloId]);
}
// Chama o core esperando um RAISE. Um erro dentro da txn a deixa "aborted" — o SAVEPOINT
// permite voltar a um estado sadio e continuar as próximas asserções na mesma txn.
async function callCoreExpectRaise(c: Client, modeloId: string): Promise<any> {
  await c.query("SAVEPOINT sp_raise");
  let erro: any;
  try {
    await callCore(c, modeloId);
  } catch (e) {
    erro = e;
  }
  await c.query("ROLLBACK TO SAVEPOINT sp_raise");
  await c.query("RELEASE SAVEPOINT sp_raise");
  return erro;
}
// Modelo da Loja Teste que JÁ tem CAD → o core cai no ramo idempotente (leve): só o
// gate importa p/ estes testes (bloquear/liberar), sem materializar CAD do zero.
async function modeloComCad(c: Client): Promise<string | null> {
  const m = await um<{ id: string }>(
    c,
    `SELECT m.id FROM public.modelos m JOIN public.cad k ON k.modelo_id = m.id WHERE m.tenant_id = $1 LIMIT 1`,
    [T],
  );
  return m?.id ?? null;
}

describe.skipIf(!hasDb)("Envio à Explosão configurável — gate + RPC", () => {
  it("_explosao_envio_gate: ausente ⇒ só 'aprovado'; a-partir-da-etapa; órfã ⇒ fallback", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);

      // Config AUSENTE ⇒ comportamento histórico ('aprovado').
      await setCfg(c, null);
      expect((await gate(c, "aprovado")).ok).toBe(true);
      expect((await gate(c, "em_modelagem")).ok).toBe(false);
      expect((await gate(c, "aprovado")).req_key).toBe("aprovado");

      // A partir de 'em_pilotagem' (na etapa OU posterior libera; antes bloqueia).
      await setCfg(c, "em_pilotagem");
      expect((await gate(c, "em_modelagem")).ok).toBe(false); // antes
      expect((await gate(c, "em_pilotagem")).ok).toBe(true); // na etapa
      expect((await gate(c, "prova_roupa_1")).ok).toBe(true); // posterior
      expect((await gate(c, "aprovado")).ok).toBe(true); // posterior
      expect((await gate(c, "em_modelagem")).req_key).toBe("em_pilotagem");
      expect((await gate(c, "em_modelagem")).req_label).toBe("Em Pilotagem");

      // Config ÓRFÃ (etapa fora do board) ⇒ fallback 'aprovado'.
      await setCfg(c, "nao_existe_xyz");
      const g = await gate(c, "aprovado");
      expect(g.ok).toBe(true);
      expect(g.req_key).toBe("aprovado");
      expect((await gate(c, "em_modelagem")).ok).toBe(false);
    });
  });

  it("RPC bloqueia com P0001 antes da etapa e libera na etapa (config ausente = 'aprovado')", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await modeloComCad(c);
      if (!id) return; // sem modelo com CAD na Loja Teste → auto-skip
      await setCfg(c, null);

      // ANTES ('em_modelagem') → P0001 em PT.
      await setStatus(c, id, "em_modelagem");
      const erro = await callCoreExpectRaise(c, id);
      expect(erro).toBeDefined();
      expect(erro.code).toBe("P0001");
      expect(erro.message).toMatch(/enviado à Explosão/);
      expect(erro.message).toContain("Aprovado"); // etapa exigida no texto

      // NA etapa ('aprovado') → passa (idempotente: retorna o cad_id).
      await setStatus(c, id, "aprovado");
      const r = await callCore(c, id);
      expect(r.rows[0].cad_id).toBeTruthy();
    });
  });

  it("RPC com config 'em_pilotagem': bloqueia etapa anterior, libera posterior", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await modeloComCad(c);
      if (!id) return;
      await setCfg(c, "em_pilotagem");

      // 'corte_piloto_1' é ANTES de 'em_pilotagem' no board da Loja Teste → P0001.
      await setStatus(c, id, "corte_piloto_1");
      const erro = await callCoreExpectRaise(c, id);
      expect(erro?.code).toBe("P0001");

      // 'prova_roupa_1' é POSTERIOR → passa.
      await setStatus(c, id, "prova_roupa_1");
      const r = await callCore(c, id);
      expect(r.rows[0].cad_id).toBeTruthy();
    });
  });
});
