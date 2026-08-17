import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import type { Client } from "pg";

// Item 14 — REF revelada a partir de etapa configurável (tenant_config.ref_exibir_status):
// gate `_ref_exibir_gate` + trigger `fn_modelo_ref_auto` (invariante #11 preservada no resto).
// Tudo em txn revertida (BEGIN…ROLLBACK) — nada é gravado.

const T = TENANT_TESTE;

async function setCfg(c: Client, v: string | null) {
  await c.query(`UPDATE public.tenant_config SET ref_exibir_status = $2 WHERE tenant_id = $1`, [T, v]);
}
async function gate(c: Client, status: string): Promise<boolean> {
  const r = await um<{ ok: boolean }>(c, `SELECT public._ref_exibir_gate($1, $2) AS ok`, [T, status]);
  return r.ok;
}
async function setStatus(c: Client, modeloId: string, status: string, clearRef = false) {
  if (clearRef) {
    await c.query(`UPDATE public.modelos SET ref = '', status_desenvolvimento = $2 WHERE id = $1`, [modeloId, status]);
  } else {
    await c.query(`UPDATE public.modelos SET status_desenvolvimento = $2 WHERE id = $1`, [modeloId, status]);
  }
}
async function lerRef(c: Client, modeloId: string) {
  return um<{ ref: string | null; ref_auto: string | null }>(
    c, `SELECT ref, ref_auto FROM public.modelos WHERE id = $1`, [modeloId],
  );
}
// Modelo da Loja Teste que passa pelo fluxo ref_auto (chegou em Dev + tem categoria → sigla ≠ '').
async function modeloComSigla(c: Client): Promise<string | null> {
  const m = await um<{ id: string }>(
    c,
    `SELECT id FROM public.modelos
      WHERE tenant_id = $1 AND coalesce(ordem_criacao_enviada,false) = true
        AND categoria_principal_id IS NOT NULL
      LIMIT 1`,
    [T],
  );
  return m?.id ?? null;
}

describe.skipIf(!hasDb)("Item 14 — REF configurável (_ref_exibir_gate + trigger)", () => {
  it("_ref_exibir_gate: ausente ⇒ só 'aprovado'; a-partir-da-etapa; órfã ⇒ fallback", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);

      await setCfg(c, null); // ausente ⇒ 'aprovado'
      expect(await gate(c, "aprovado")).toBe(true);
      expect(await gate(c, "em_modelagem")).toBe(false);

      await setCfg(c, "em_pilotagem"); // a partir da etapa
      expect(await gate(c, "em_modelagem")).toBe(false); // antes
      expect(await gate(c, "em_pilotagem")).toBe(true); // na etapa
      expect(await gate(c, "prova_roupa_1")).toBe(true); // posterior
      expect(await gate(c, "aprovado")).toBe(true); // posterior

      await setCfg(c, "nao_existe_xyz"); // órfã ⇒ fallback 'aprovado'
      expect(await gate(c, "aprovado")).toBe(true);
      expect(await gate(c, "em_modelagem")).toBe(false);
    });
  });

  it("trigger: revela ref (ref_auto → ref) ao ATINGIR a etapa configurada, não antes", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await modeloComSigla(c);
      if (!id) return; // sem modelo elegível na Loja Teste → auto-skip

      // Baseline: limpa ref, põe numa etapa PRÉ; o trigger gera ref_auto (sigla+num) mas NÃO revela.
      await c.query(`UPDATE public.modelos SET ref = '', ref_auto = '', status_desenvolvimento = 'em_modelagem' WHERE id = $1`, [id]);
      let row = await lerRef(c, id);
      expect(row.ref ?? "").toBe(""); // não revelado
      expect(row.ref_auto ?? "").toMatch(/^[A-Za-z]+[0-9]{8}$/); // shadow gerado

      // Config: revelar a partir de 'em_pilotagem'.
      await setCfg(c, "em_pilotagem");

      // Etapa ANTES → segue oculto.
      await setStatus(c, id, "corte_piloto_1");
      row = await lerRef(c, id);
      expect(row.ref ?? "").toBe("");

      // Etapa configurada → REVELA (ref = ref_auto).
      await setStatus(c, id, "em_pilotagem");
      row = await lerRef(c, id);
      expect(row.ref ?? "").not.toBe("");
      expect(row.ref).toBe(row.ref_auto);
    });
  });

  it("trigger: config AUSENTE ⇒ revela só em 'aprovado' (histórico)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await modeloComSigla(c);
      if (!id) return;

      await c.query(`UPDATE public.modelos SET ref = '', ref_auto = '', status_desenvolvimento = 'em_modelagem' WHERE id = $1`, [id]);
      await setCfg(c, null); // ausente ⇒ 'aprovado'

      // Posterior mas NÃO 'aprovado' → segue oculto.
      await setStatus(c, id, "prova_roupa_1", true);
      expect((await lerRef(c, id)).ref ?? "").toBe("");

      // 'aprovado' → revela.
      await setStatus(c, id, "aprovado", true);
      const row = await lerRef(c, id);
      expect(row.ref ?? "").not.toBe("");
      expect(row.ref).toBe(row.ref_auto);
    });
  });

  it("trigger: REF manual (fora do padrão) NUNCA é sobrescrita ao revelar", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await modeloComSigla(c);
      if (!id) return;

      await c.query(`UPDATE public.modelos SET ref = 'MINHA-REF-123', ref_auto = '', status_desenvolvimento = 'em_modelagem' WHERE id = $1`, [id]);
      await setCfg(c, "em_pilotagem");
      await setStatus(c, id, "em_pilotagem");
      expect((await lerRef(c, id)).ref).toBe("MINHA-REF-123"); // manual preservada
    });
  });
});
