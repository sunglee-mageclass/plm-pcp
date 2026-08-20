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

  // R3 (write-skew 1:1): enforce_unique_fk deve serializar por advisory lock. Sem ele, 2
  // inserts simultâneos do mesmo modelo_id/cad_id passavam o EXISTS e furavam a invariante.
  it("enforce_unique_fk mantém advisory lock por valor (anti write-skew 1:1 — R3)", async () => {
    await withTx(async (c) => {
      const r = await um<{ tem: boolean }>(
        c,
        `select position('pg_advisory_xact_lock' in pg_get_functiondef('public.enforce_unique_fk()'::regprocedure)) > 0 as tem`,
      );
      expect(r.tem).toBe(true);
    });
  });
});

// FF#2 (ago/2026): PCP "aviamentos enviados" POR VARIANTE. `aviamentos_enviados` deixa de ser
// um array de aviamento_id e passa a ser {aviamento_id, variante_aviamento_id} — 2 variantes do
// MESMO aviamento no BOM viram 2 seleções distintas. `salvar_terceirizados` grava o jsonb opaco.
describe.skipIf(!hasDb)("FF#2 — aviamentos_enviados por variante", () => {
  it("salvar_terceirizados persiste 2 variantes do mesmo aviamento (round-trip)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // cad SEM bloco de serviço (a RPC apaga os blocos ausentes do payload; guarda de parcela
      // paga não deve disparar) — mantém o teste isolado.
      const cad = await um<{ id: string } | undefined>(
        c,
        `select id from cad where tenant_id=$1
           and not exists (select 1 from producao_terceirizados pt where pt.cad_id=cad.id) limit 1`,
        [TENANT_TESTE],
      );
      if (!cad) return;
      const cat = await um<{ id: string } | undefined>(
        c, `select id from categorias_terceirizado where tenant_id=$1 limit 1`, [TENANT_TESTE],
      );
      if (!cat) return;

      const avi = "11111111-1111-1111-1111-111111111111";
      const vA = "22222222-2222-2222-2222-222222222222";
      const vB = "33333333-3333-3333-3333-333333333333";
      const bloco = {
        id: null, categoria_terceirizado_id: cat.id, interno: true, ativo: true,
        aviamentos_enviados: [
          { aviamento_id: avi, variante_aviamento_id: vA },
          { aviamento_id: avi, variante_aviamento_id: vB },
        ],
        tecidos_enviados: [], grade_detalhe: {}, detalhado: false,
      };
      await c.query(`select public.salvar_terceirizados($1,$2::jsonb,null,null)`, [cad.id, JSON.stringify([bloco])]);

      const row = await um<{ ae: any }>(
        c, `select aviamentos_enviados ae from producao_terceirizados where cad_id=$1 order by created_at desc limit 1`, [cad.id],
      );
      expect(Array.isArray(row.ae)).toBe(true);
      expect(row.ae.length).toBe(2);
      // 2 botões distintos do MESMO aviamento — variantes diferentes preservadas (sem dedup por aviamento).
      expect(row.ae).toContainEqual({ aviamento_id: avi, variante_aviamento_id: vA });
      expect(row.ae).toContainEqual({ aviamento_id: avi, variante_aviamento_id: vB });
    });
  });
});
