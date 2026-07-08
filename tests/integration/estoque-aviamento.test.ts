import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// M2: fonte ÚNICA `_estoque_aviamento_core` (consumida pela tela de Estoque, pelo dashboard
// e pela trava de saldo da OS). Antes havia 2 definições divergentes → números diferentes
// pro mesmo aviamento. Estes testes travam a DEFINIÇÃO num cenário controlado
// (BEGIN…ROLLBACK — nada grava): quem mexer na fórmula e regredir, quebra aqui.
describe.skipIf(!hasDb)("estoque_aviamento (fonte canônica)", () => {
  const mkAvi = async (c: any, emp: string, nome: string) =>
    (await um<{ id: string }>(
      c,
      `insert into aviamentos (tenant_id, codigo_nome, empresa_id) values ($1, $2, $3) returning id`,
      [TENANT_TESTE, nome, emp],
    )).id;

  const mkOc = async (
    c: any, emp: string, avi: string, status: string,
    pedida: number, recebida: number | null, cancelado: boolean,
  ) => {
    const oc = {
      // numero_pedido null: o teste cria várias OCs e o índice único (tenant, numero_pedido)
      // barra número repetido — o número não importa aqui.
      numero_pedido: null, empresa_id: emp, data_prevista_entrega: "2026-07-01",
      prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [], status,
    };
    const itens = [{ id: null, aviamento_id: avi, quantidade_pedida: pedida, quantidade_recebida: recebida, cancelado }];
    await c.query(`select public._salvar_oc_aviamento_core(null, $1::jsonb, $2::jsonb)`,
      [JSON.stringify(oc), JSON.stringify(itens)]);
  };

  const mkOsBaixada = async (c: any, avi: string, baixa: number) => {
    const os = await um<{ id: string }>(
      c, `insert into ordens_saida_aviamento (tenant_id, baixado) values ($1, true) returning id`, [TENANT_TESTE]);
    await c.query(
      `insert into ordens_saida_aviamento_itens (tenant_id, ordem_saida_id, aviamento_id, reserva, baixa)
       values ($1, $2, $3, 0, $4)`, [TENANT_TESTE, os.id, avi, baixa]);
  };

  const lerAvi = (c: any, avi: string) =>
    um<{ recebido: string; baixa: string; prev_receb: string; reservado: string; fisico: string; previsto: string }>(
      c, `select recebido, baixa, prev_receb, reservado, fisico, previsto
          from public._estoque_aviamento_core($1) where id = $2`, [TENANT_TESTE, avi]);

  it("recebido/baixa/prev/fisico batem: cancelado FORA, OS baixada CONTA na baixa", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id = $1 limit 1`, [TENANT_TESTE]);
      if (!emp) return; // sem empresa → auto-pula
      const avi = await mkAvi(c, emp.id, "ITEST-ESTOQUE");

      await mkOc(c, emp.id, avi, "recebido", 10, 10, false);    // recebido += 10
      await mkOc(c, emp.id, avi, "recebido", 5, 5, true);        // cancelado → ignorado (não conta)
      await mkOc(c, emp.id, avi, "encomendado", 4, null, false); // prev_receb += 4
      await mkOsBaixada(c, avi, 3);                              // baixa += 3

      const r = await lerAvi(c, avi);
      expect(Number(r.recebido)).toBe(10);
      expect(Number(r.prev_receb)).toBe(4);
      expect(Number(r.baixa)).toBe(3);
      expect(Number(r.fisico)).toBe(7);       // 10 − 3
      expect(Number(r.previsto)).toBe(11);    // fisico(7) + prev(4) − reservado(0)
    });
  });

  it("fisico nunca é negativo (clamp >=0) quando a baixa passa do recebido", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id = $1 limit 1`, [TENANT_TESTE]);
      if (!emp) return;
      const avi = await mkAvi(c, emp.id, "ITEST-NEG");
      await mkOc(c, emp.id, avi, "recebido", 5, 5, false); // recebido 5
      await mkOsBaixada(c, avi, 8);                         // baixa 8 (> recebido)
      const r = await lerAvi(c, avi);
      expect(Number(r.recebido)).toBe(5);
      expect(Number(r.baixa)).toBe(8);
      expect(Number(r.fisico)).toBe(0); // 5 − 8 = −3 → clamp 0 (C1)
    });
  });
});
