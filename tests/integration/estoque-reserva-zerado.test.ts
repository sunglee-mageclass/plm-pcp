import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Regressão da auditoria de reserva/baixa (jul/2026):
//
// (Q2) Zerar UM lote (item de OC recebido + estoque_zerado) NÃO pode colapsar a reserva
//   da variante inteira. Antes, qualquer item zerado zerava reservado; agora a reserva
//   (demanda de modelo/OS) é mantida e só o físico do lote zerado sai.
//
// (Q3) `estoque_tecido_por_artigo` deve reconciliar EXATAMENTE com o canônico
//   `_estoque_tecido_core` (a versão antiga ignorava estoque_zerado → +147 m fantasmas).
describe.skipIf(!hasDb)("estoque: reserva no lote zerado + consistência por-artigo", () => {
  it("zerar um lote mantém a reserva da variante (não colapsa)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);

      // variante que HOJE tem reserva > 0 (senão o cenário não é exercitável)
      const alvo = await um<{ var: string; art: string; reservado: string } | undefined>(
        c,
        `select e.variante_tecido_id var, e.artigo_id art, e.reservado
           from public._estoque_tecido_core($1) e
           join public.artigos a on a.id = e.artigo_id and coalesce(a.unidade_medida,'metro') <> 'kg'
          where e.reservado > 0
          limit 1`,
        [TENANT_TESTE],
      );
      if (!alvo) return; // sem reserva na Loja Teste → nada a provar

      const reservadoDe = async () =>
        Number(
          (
            await um<{ m: string }>(
              c,
              `select coalesce(reservado,0) m from public._estoque_tecido_core($1) where variante_tecido_id=$2`,
              [TENANT_TESTE, alvo.var],
            )
          )?.m ?? 0,
        );
      const fisicoDe = async () =>
        Number(
          (
            await um<{ m: string }>(
              c,
              `select coalesce(fisico,0) m from public._estoque_tecido_core($1) where variante_tecido_id=$2`,
              [TENANT_TESTE, alvo.var],
            )
          )?.m ?? 0,
        );

      const reservado0 = await reservadoDe();
      const fisico0 = await fisicoDe();
      expect(reservado0).toBeGreaterThan(0);

      // cria uma OC recebida com um item DESSA variante e marca o item como estoque_zerado
      const emp = await um<{ id: string }>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const oc = {
        numero_pedido: "ITEST-ZERO",
        empresa_id: emp.id,
        data_prevista_entrega: "2026-07-01",
        prazo_pagamento: "30",
        quantidade_prazos: 1,
        parcelas_recebimento: [],
        valor_previsto_total: 50,
        valor_real_total: 50,
        status: "recebido",
      };
      const itens = [
        {
          id: null,
          artigo_id: alvo.art,
          artigo_numero: 1,
          variante_tecido_id: alvo.var,
          quantidade_pedida: 50,
          quantidade_recebida: 50,
          rendimento: null,
          cancelado: false,
        },
      ];
      const ocId = (
        await um<{ id: string }>(c, `select public._salvar_oc_tecido_core(null,$1::jsonb,$2::jsonb) id`, [
          JSON.stringify(oc),
          JSON.stringify(itens),
        ])
      ).id;
      const itId = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id=$1`, [ocId])).id;
      await c.query(`update ocs_tecido_itens set estoque_zerado = true where id = $1`, [itId]);

      // reserva PRESERVADA (não colapsou p/ 0) e o lote zerado NÃO entrou no físico
      expect(await reservadoDe()).toBeCloseTo(reservado0, 4);
      expect(await fisicoDe()).toBeCloseTo(fisico0, 4);
    });
  });

  it("estoque_tecido_por_artigo reconcilia com o canônico (respeita estoque_zerado)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);

      const rpcTotal = Number(
        (
          await um<{ t: string }>(
            c,
            `select coalesce(sum((x->>'fisico_m')::numeric),0) t
               from jsonb_array_elements(public.estoque_tecido_por_artigo()) x`,
          )
        )?.t ?? 0,
      );
      const coreTotal = Number(
        (await um<{ t: string }>(c, `select coalesce(sum(fisico),0) t from public._estoque_tecido_core($1)`, [TENANT_TESTE]))?.t ?? 0,
      );

      expect(rpcTotal).toBeCloseTo(coreTotal, 4);
    });
  });
});
