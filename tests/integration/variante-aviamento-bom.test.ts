// Item 2 do fanout de Variantes de Aviamento: Desenvolvimento grava a variante
// escolhida do aviamento no BOM (modelo_aviamentos.variante_aviamento_id) e propaga
// ao CAD (cad_aviamentos.variante_aviamento_id). Valida também a guarda de membership
// (a variante tem de pertencer ao aviamento DA MESMA LINHA e à loja).
// Transacional (BEGIN…ROLLBACK): nada é gravado.
import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

async function ligarCriacao(c: any) {
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true}'::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true}'::jsonb`,
    [TENANT_TESTE],
  );
}

async function novoModelo(c: any): Promise<string> {
  return (await um<{ id: string }>(c, `insert into modelos (tenant_id, nome) values ($1,'M-AV-TEST') returning id`, [TENANT_TESTE])).id;
}

async function novoAviamento(c: any, nome: string): Promise<string> {
  return (await um<{ id: string }>(c, `insert into aviamentos (tenant_id, codigo_nome) values ($1,$2) returning id`, [TENANT_TESTE, nome])).id;
}

async function novaVariante(c: any, aviamentoId: string): Promise<string> {
  return (await um<{ id: string }>(c, `insert into variantes_aviamento (tenant_id, aviamento_id) values ($1,$2) returning id`, [TENANT_TESTE, aviamentoId])).id;
}

async function capturarErro(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

const aviPayload = (aviamentoId: string, varId: string | null) =>
  JSON.stringify([{ aviamento_id: aviamentoId, numero: 1, consumo: 1, loss_percent: 0, custo_previsto: 0, variante_aviamento_id: varId }]);

describe.skipIf(!hasDb)("Item 2 — variante de aviamento no BOM (salvar_modelo_bom)", () => {
  it("grava variante_aviamento_id na linha do modelo_aviamentos", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const modelo = await novoModelo(c);
      const avi = await novoAviamento(c, "AV-A");
      const vari = await novaVariante(c, avi);

      await um(c, `select public.salvar_modelo_bom($1, '[]'::jsonb, $2::jsonb, '[]'::jsonb)`, [modelo, aviPayload(avi, vari)]);

      const row = await um<{ aviamento_id: string; variante_aviamento_id: string }>(
        c, `select aviamento_id, variante_aviamento_id from modelo_aviamentos where modelo_id=$1`, [modelo],
      );
      expect(row.aviamento_id).toBe(avi);
      expect(row.variante_aviamento_id).toBe(vari);
    });
  });

  it("rejeita variante que pertence a OUTRO aviamento (42501)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const modelo = await novoModelo(c);
      const aviA = await novoAviamento(c, "AV-A");
      const aviB = await novoAviamento(c, "AV-B");
      const variB = await novaVariante(c, aviB); // pertence ao B

      const err = await capturarErro(() =>
        c.query(`select public.salvar_modelo_bom($1, '[]'::jsonb, $2::jsonb, '[]'::jsonb)`, [modelo, aviPayload(aviA, variB)]),
      );
      expect(err).toBeTruthy();
      expect(err.code).toBe("42501"); // RPC aborta atomicamente — nada é gravado
    });
  });

  it("rejeita variante de OUTRA loja (42501)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const modelo = await novoModelo(c);
      const avi = await novoAviamento(c, "AV-A");
      // variante forjada: id inexistente na loja
      const err = await capturarErro(() =>
        c.query(`select public.salvar_modelo_bom($1, '[]'::jsonb, $2::jsonb, '[]'::jsonb)`, [
          modelo, aviPayload(avi, "00000000-0000-0000-0000-0000000000ff"),
        ]),
      );
      expect(err).toBeTruthy();
      expect(err.code).toBe("42501");
    });
  });

  it("BOM SEM variante grava normalmente (variante_aviamento_id NULL)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const modelo = await novoModelo(c);
      const avi = await novoAviamento(c, "AV-A");

      await um(c, `select public.salvar_modelo_bom($1, '[]'::jsonb, $2::jsonb, '[]'::jsonb)`, [modelo, aviPayload(avi, null)]);

      const row = await um<{ variante_aviamento_id: string | null }>(
        c, `select variante_aviamento_id from modelo_aviamentos where modelo_id=$1`, [modelo],
      );
      expect(row.variante_aviamento_id).toBeNull();
    });
  });
});

describe.skipIf(!hasDb)("Item 2 — variante propaga ao CAD (salvar_cad_completo)", () => {
  const cadAviPayload = (aviamentoId: string, varId: string | null) =>
    JSON.stringify([{ aviamento_id: aviamentoId, numero: 1, consumo: 1, quantidade_enviar: 1, quantidade_separar: 1, variante_aviamento_id: varId }]);

  it("grava variante_aviamento_id em cad_aviamentos", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const modelo = await novoModelo(c);
      const avi = await novoAviamento(c, "AV-A");
      const vari = await novaVariante(c, avi);

      await um(c, `select public.salvar_cad_completo($1, '[]'::jsonb, '[]'::jsonb, $2::jsonb, '[]'::jsonb, '{}'::jsonb, null, null)`, [
        modelo, cadAviPayload(avi, vari),
      ]);

      const row = await um<{ variante_aviamento_id: string }>(
        c, `select ca.variante_aviamento_id from cad_aviamentos ca join cad on cad.id=ca.cad_id where cad.modelo_id=$1`, [modelo],
      );
      expect(row.variante_aviamento_id).toBe(vari);
    });
  });

  it("rejeita variante de outro aviamento no CAD (42501)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarCriacao(c);
      const modelo = await novoModelo(c);
      const aviA = await novoAviamento(c, "AV-A");
      const aviB = await novoAviamento(c, "AV-B");
      const variB = await novaVariante(c, aviB);

      const err = await capturarErro(() =>
        c.query(`select public.salvar_cad_completo($1, '[]'::jsonb, '[]'::jsonb, $2::jsonb, '[]'::jsonb, '{}'::jsonb, null, null)`, [
          modelo, cadAviPayload(aviA, variB),
        ]),
      );
      expect(err).toBeTruthy();
      expect(err.code).toBe("42501");
    });
  });
});
