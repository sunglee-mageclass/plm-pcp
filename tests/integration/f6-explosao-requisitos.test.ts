// F6 Fluxo 2 — requisitos CONFIGURAVEIS do "Enviar a Explosao" (tenant_config.explosao_requisitos).
// Task 1: coluna + salvar_config_loja (lista branca + CAS por coluna). Task 2: gate no _enviar_modelo_para_cad_core.
// Tudo em txn revertida (withTx = BEGIN…ROLLBACK) — nada e gravado; SO na copia local.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import { kanbanChaveDesligada } from "./loja-fixture";

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

// ─────────────────────── Task 2: gate no _enviar_modelo_para_cad_core ───────────────────────
// Modelo da Loja Teste que JA tem CAD -> o core cai no ramo idempotente (so o gate F6 importa).
// kanbanChaveDesligada: com a chave ligada o status e DERIVADO e o setStatus nao moveria o card.
async function modeloAptoExplosao(c: Client): Promise<string | null> {
  const m = await um<{ id: string }>(
    c,
    `SELECT m.id FROM public.modelos m JOIN public.cad k ON k.modelo_id = m.id WHERE m.tenant_id = $1 LIMIT 1`,
    [T],
  );
  if (!m?.id) return null;
  await kanbanChaveDesligada(c);
  await c.query(`UPDATE public.tenant_config SET explosao_envio_status = NULL WHERE tenant_id = $1`, [T]); // gate de etapa = 'aprovado'
  await c.query(`UPDATE public.modelos SET status_desenvolvimento = 'aprovado', status_planejamento = NULL WHERE id = $1`, [m.id]); // passa o gate de etapa
  return m.id;
}
async function setReqs(c: Client, keys: string[]) {
  await c.query(`UPDATE public.tenant_config SET explosao_requisitos = $2::jsonb WHERE tenant_id = $1`, [T, JSON.stringify(keys)]);
}
async function callCore(c: Client, modeloId: string) {
  return c.query(`SELECT public._enviar_modelo_para_cad_core($1, null, null) AS cad_id`, [modeloId]);
}
async function callCoreExpectRaise(c: Client, modeloId: string): Promise<Erro | undefined> {
  await c.query("SAVEPOINT sp_f6_gate");
  let erro: Erro | undefined;
  try {
    await callCore(c, modeloId);
  } catch (e: any) {
    erro = { code: e.code, message: e.message };
  }
  await c.query("ROLLBACK TO SAVEPOINT sp_f6_gate");
  await c.query("RELEASE SAVEPOINT sp_f6_gate");
  return erro;
}

describe.skipIf(!hasDb || !ehBancoLocal())("F6 explosao_requisitos — gate no _enviar_modelo_para_cad_core", () => {
  it("OPT-IN: lista vazia NAO recusa (comportamento de hoje)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await modeloAptoExplosao(c);
      if (!id) return;
      await setReqs(c, []);
      const r = await callCore(c, id);
      expect(r.rows[0].cad_id).toBeTruthy();
    });
  });

  it("recusa (P0001, prefixo ASCII) quando uma cond configurada NAO esta satisfeita", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await modeloAptoExplosao(c);
      if (!id) return;
      // 'linha_definida' = false no modelo com CAD da Loja Teste -> recusa
      await setReqs(c, ["linha_definida"]);
      const erro = await callCoreExpectRaise(c, id);
      expect(erro?.code).toBe("P0001");
      expect(String(erro?.message)).toMatch(/^explosao_requisito_faltando:/);
      expect(String(erro?.message)).toContain("linha_definida");
    });
  });

  it("passa quando a cond configurada ESTA satisfeita", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await modeloAptoExplosao(c);
      if (!id) return;
      // 'categoria_definida' = true no fixture apto
      await setReqs(c, ["categoria_definida"]);
      const r = await callCore(c, id);
      expect(r.rows[0].cad_id).toBeTruthy();
    });
  });

  it("junta as faltantes em ordem (ASCII, separadas por virgula)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await modeloAptoExplosao(c);
      if (!id) return;
      await setReqs(c, ["linha_definida", "data_piloto1"]); // ambas false; ordenadas: data_piloto1,linha_definida
      const erro = await callCoreExpectRaise(c, id);
      expect(erro?.code).toBe("P0001");
      expect(String(erro?.message)).toBe("explosao_requisito_faltando: data_piloto1,linha_definida");
    });
  });

  it("cond de modulo DESLIGADO nao bloqueia (conta como satisfeita)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const id = await modeloAptoExplosao(c);
      if (!id) return;
      // cq_liberado exige o modulo producao; desligar producao (explicito false) -> _kanban_cond_na devolve true -> nao bloqueia
      await c.query(`UPDATE public.tenant_config SET modules = modules || '{"producao": false}'::jsonb WHERE tenant_id = $1`, [T]);
      await setReqs(c, ["cq_liberado"]);
      const r = await callCore(c, id);
      expect(r.rows[0].cad_id).toBeTruthy();
    });
  });
});
