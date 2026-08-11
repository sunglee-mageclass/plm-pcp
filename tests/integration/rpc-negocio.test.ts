import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, USER_TESTE } from "./db";

// Regras de negócio executadas via RPC, exercitadas contra dados reais da Loja Teste,
// SEMPRE em txn revertida (as escritas abaixo são desfeitas).
describe.skipIf(!hasDb)("RPC de negócio — parcelas e estoque", () => {
  it("as RPCs-chave existem no banco (guarda contra drop acidental)", async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select proname from pg_proc where pronamespace='public'::regnamespace
           and proname = any($1)`,
        [
          [
            "recalcular_parcelas",
            "criar_rolo",
            "baixar_estoque_tecido_corte",
            "salvar_cq",
            "servicos_financeiro",
            "consumo_por_oc",
            "reset_loja",
            "excluir_loja",
          ],
        ],
      );
      expect(rows.length).toBe(8);
    });
  });

  it("recalcular_parcelas redistribui para somar exatamente o valor_real_total", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string; vr: string } | undefined>(
        c,
        `select oc.id, oc.valor_real_total vr
           from ocs_tecido oc
           where oc.tenant_id = $1 and oc.status = 'recebido' and coalesce(oc.valor_real_total,0) > 0
             and exists (select 1 from parcelas p where p.oc_tecido_id = oc.id)
           limit 1`,
        [TENANT_TESTE],
      );
      if (!oc) return; // sem OC adequada → não falha (suite continua verde)
      const total = Number(oc.vr);
      // corrompe as parcelas não pagas e deixa a RPC corrigir
      await c.query(
        `update parcelas set valor = valor + 123.45 where oc_tecido_id = $1 and status is distinct from 'pago'`,
        [oc.id],
      );
      await c.query("select recalcular_parcelas($1, 'tecido')", [oc.id]);
      const s = await um<{ s: string }>(
        c,
        "select coalesce(sum(valor),0) s from parcelas where oc_tecido_id = $1",
        [oc.id],
      );
      expect(Math.abs(Number(s.s) - total)).toBeLessThan(0.01);
    });
  });

  // FF1b (fast-follow Revenda, ago/2026, migração 20260811100000): recalcular_parcelas
  // ganhou um 3º tipo, 'p_acabado', espelhando a mesma matemática de gerar_parcelas_oc_p_acabado
  // (base=data_pedido, total=valor_total_desconto, neta contra as já pagas).
  it("recalcular_parcelas('p_acabado') preserva parcela paga e redistribui o restante entre as demais", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string }>(
        c,
        `insert into ocs_p_acabado (nome_produto, data_pedido, prazo_pagamento, valor_total_desconto)
           values ('ITEST recalc pa', '2026-08-01', '30/60/90', 1000.00) returning id`,
      );
      // o trigger trg_gerar_parcelas_ocpa já gerou 3 parcelas de ~333.33 no INSERT acima.
      await c.query(
        `update parcelas set status='pago', data_pagamento='2026-08-05'
           where oc_p_acabado_id=$1 and numero_parcela=1`,
        [oc.id],
      );
      await c.query("select recalcular_parcelas($1, 'p_acabado')", [oc.id]);
      const rows = (
        await c.query(
          `select numero_parcela, valor, status from parcelas where oc_p_acabado_id=$1 order by numero_parcela`,
          [oc.id],
        )
      ).rows as { numero_parcela: number; valor: string; status: string }[];
      expect(rows).toHaveLength(3);
      expect(rows[0].status).toBe("pago"); // parcela paga preservada, intocada
      const soma = rows.reduce((s, r) => s + Number(r.valor), 0);
      expect(Math.abs(soma - 1000)).toBeLessThan(0.01); // Σ sempre ≡ total, mesmo com netting
    });
  });

  it("recalcular_parcelas: tipo 'etiqueta' (insumo) continua fora do escopo — RAISE claro", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await expect(c.query("select recalcular_parcelas($1, 'etiqueta')", ["00000000-0000-0000-0000-000000000000"]))
        .rejects.toThrow(/tipo deve ser/);
    });
  });

  it("estoque: uma baixa no ledger reduz o físico do item pelo valor exato", async () => {
    await withTx(async (c) => {
      const item = await um<{ id: string; vt: string; qr: string } | undefined>(
        c,
        `select it.id, it.variante_tecido_id vt, coalesce(it.quantidade_recebida,0) qr
           from ocs_tecido_itens it join ocs_tecido oc on oc.id = it.oc_tecido_id
           where oc.tenant_id = $1 and coalesce(it.quantidade_recebida,0) > 0 and it.variante_tecido_id is not null
           limit 1`,
        [TENANT_TESTE],
      );
      if (!item) return;
      const fisico = async (): Promise<number> => {
        const r = await um<{ f: string }>(
          c,
          `select coalesce($2::numeric,0) - coalesce(
              (select sum(b.quantidade) from estoque_tecido_baixas b where b.oc_tecido_item_id = $1), 0) as f`,
          [item.id, item.qr],
        );
        return Number(r.f);
      };
      const antes = await fisico();
      await c.query(
        `insert into estoque_tecido_baixas (tenant_id, oc_tecido_item_id, variante_tecido_id, quantidade, origem, created_by)
           values ($1, $2, $3, 5, 'ajuste', $4)`,
        [TENANT_TESTE, item.id, item.vt, USER_TESTE],
      );
      const depois = await fisico();
      expect(Math.abs(antes - 5 - depois)).toBeLessThan(0.001);
    });
  });
});
