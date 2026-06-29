import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Fluxos de produção: enviar ao corte (atômico) e preservação da grade real do CQ.
// Tudo em txn revertida — o corte abaixo NÃO grava.
describe.skipIf(!hasDb)("RPC de produção — corte e grade real do CQ", () => {
  it("baixar_estoque_tecido_corte é atômico: marca enviado_corte e retorna o objeto de déficit", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string } | undefined>(
        c,
        `select id from cad where tenant_id = $1 and status_corte = 'pendente' limit 1`,
        [TENANT_TESTE],
      );
      if (!cad) return; // sem CAD pendente → não falha
      const r = await um<{ res: unknown }>(c, "select baixar_estoque_tecido_corte($1) as res", [cad.id]);
      // retorna um objeto jsonb (com o deficit[] por variante)
      expect(r.res).toBeTypeOf("object");
      expect(r.res).not.toBeNull();
      // e na MESMA transação o CAD já está 'enviado' (atômico — não é update + RPC separados)
      const after = await um<{ status_corte: string }>(c, "select status_corte from cad where id = $1", [cad.id]);
      expect(after.status_corte).toBe("enviado");
    });
  });

  it("CQ confirmado preserva a grade real (nenhum confirmado sem grade_total_real)", async () => {
    await withTx(async (c) => {
      const r = await um<{ n: string }>(
        c,
        `select count(*) as n
           from controle_qualidade cq
           join cad c2 on c2.id = cq.cad_id
           where cq.status = 'confirmado'
             and not exists (
               select 1 from cad_grades g where g.cad_id = c2.id and g.grade_total_real is not null
             )`,
      );
      expect(Number(r.n)).toBe(0);
    });
  });

  // R1 (write-skew): o corte deve serializar por tenant via advisory lock. Sem ele, 2
  // cortes simultâneos no mesmo lote liam o saldo cheio e baixavam a mais (estoque negativo).
  it("o corte mantém advisory lock por tenant (anti write-skew — invariante R1)", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c,
        `select position('pg_advisory_xact_lock' in pg_get_functiondef('public._baixar_estoque_tecido_corte_core(uuid)'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });
});
