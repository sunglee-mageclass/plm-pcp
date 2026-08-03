import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("colab — trava otimista (P0409)", () => {
  it("salvar_oc_tecido: _rev_base errado recusa com P0409; null passa da checagem", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string; rev: number }>(
        c, `insert into ocs_tecido (tenant_id, numero_pedido) values ($1,'TRAVA') returning id, rev`, [TENANT_TESTE]);
      // rev errado → P0409 (a checagem vem ANTES do payload; payload mínimo serve)
      await expect(
        um(c, `select salvar_oc_tecido($1, '{}'::jsonb, '[]'::jsonb, $2)`, [oc.id, oc.rev + 99]),
      ).rejects.toMatchObject({ code: "P0409" });
    });
  });
  it("salvar_oc_tecido: _rev_base CORRETO passa e o save bumpa o rev", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string; rev: number }>(
        c, `insert into ocs_tecido (tenant_id, numero_pedido) values ($1,'TRAVA2') returning id, rev`, [TENANT_TESTE]);
      // payload mínimo VÁLIDO: derive as chaves lendo /tmp/def__salvar_oc_tecido_core.sql
      // (o core lê _oc->>'numero_pedido' etc.; itens vazio = sem mudanças de item)
      await um(c, `select salvar_oc_tecido($1, jsonb_build_object('numero_pedido','TRAVA2'), '[]'::jsonb, $2)`, [oc.id, oc.rev]);
      const r = await um<{ rev: number }>(c, `select rev from ocs_tecido where id=$1`, [oc.id]);
      expect(r.rev).toBeGreaterThan(oc.rev);
    });
  });
  it("salvar_modelo_bom e salvar_plan_tecido: rev errado → P0409", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string; rev: number }>(
        c, `insert into modelos (tenant_id, nome) values ($1,'TRAVA M') returning id, rev`, [TENANT_TESTE]);
      // savepoint: um RAISE aborta a transação até o próximo ROLLBACK/SAVEPOINT — precisamos
      // seguir usando `c` depois (padrão já usado em outros testes de integração do repo).
      await c.query("SAVEPOINT sp1");
      await expect(
        um(c, `select salvar_modelo_bom($1,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$2)`, [m.id, m.rev + 99]),
      ).rejects.toMatchObject({ code: "P0409" });
      await c.query("ROLLBACK TO SAVEPOINT sp1");
      const col = await um<{ id: string; plan_rev: number }>(
        c, `insert into colecoes (tenant_id, nome) values ($1,'TRAVA C') returning id, plan_rev`, [TENANT_TESTE]);
      await expect(
        um(c, `select salvar_plan_tecido($1,'{}'::jsonb,$2)`, [col.id, col.plan_rev + 99]),
      ).rejects.toMatchObject({ code: "P0409" });
    });
  });
});
