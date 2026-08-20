import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// R2: salvar_oc_aviamento ATÔMICO. Antes o save eram 6-8 chamadas no cliente (janela de
// falha parcial). A RPC faz itens + OC + recálculo de parcelas numa só transação. Chama o
// _core (a conexão é postgres, ignora o REVOKE; comoUsuario fixa o JWT) p/ testar a lógica
// sem depender do módulo entrada_saida estar ligado. Tudo em BEGIN…ROLLBACK — nada grava.
describe.skipIf(!hasDb)("RPC salvar_oc_aviamento (atômico)", () => {
  it("insert de OC recebida cria itens + parcelas (por prazo) numa só chamada; edição recalcula", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(
        c, `select id from empresas where tenant_id = $1 limit 1`, [TENANT_TESTE],
      );
      const avi = await um<{ id: string; preco: string } | undefined>(
        c, `select id, coalesce(preco,0) as preco from aviamentos
            where tenant_id = $1 and coalesce(preco,0) > 0 limit 1`, [TENANT_TESTE],
      );
      if (!emp || !avi) return; // sem dado adequado → auto-pula, não falha
      const P = Number(avi.preco);

      const oc = {
        numero_pedido: "ITEST-R2", responsavel_nome: "t", empresa_id: emp.id, data_pedido: null,
        data_prevista_entrega: "2026-07-01", data_entrega: "2026-07-10",
        prazo_pagamento: "30/60", quantidade_prazos: 2, nf_url: null,
        parcelas_recebimento: [], status: "recebido",
      };
      const itens = [{ id: null, aviamento_id: avi.id, quantidade_pedida: 4, quantidade_recebida: 4, cancelado: false }];

      const ins = await um<{ id: string }>(
        c, `select public._salvar_oc_aviamento_core(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify(oc), JSON.stringify(itens)],
      );
      const ocId = ins.id;

      const r1 = await um<{ status: string; itens: string; np: string; tot: string }>(
        c, `select o.status,
                   (select count(*) from ocs_aviamento_itens where oc_aviamento_id = o.id) itens,
                   (select count(*) from parcelas where oc_aviamento_id = o.id) np,
                   (select coalesce(sum(valor),0) from parcelas where oc_aviamento_id = o.id) tot
              from ocs_aviamento o where o.id = $1`, [ocId],
      );
      expect(r1.status).toBe("recebido");
      expect(Number(r1.itens)).toBe(1);
      expect(Number(r1.np)).toBe(2); // prazo "30/60" → 2 parcelas
      expect(Number(r1.tot)).toBeCloseTo(4 * P, 2);

      // Edição: muda a quantidade do item (diff por id) e re-salva → parcelas recalculadas.
      const item = await um<{ id: string }>(c, `select id from ocs_aviamento_itens where oc_aviamento_id = $1 limit 1`, [ocId]);
      await um(
        c, `select public._salvar_oc_aviamento_core($1, $2::jsonb, $3::jsonb)`,
        [ocId, JSON.stringify(oc),
         JSON.stringify([{ id: item.id, aviamento_id: avi.id, quantidade_pedida: 2, quantidade_recebida: 2, cancelado: false }])],
      );
      const r2 = await um<{ itens: string; tot: string }>(
        c, `select (select count(*) from ocs_aviamento_itens where oc_aviamento_id = $1) itens,
                   (select coalesce(sum(valor),0) from parcelas where oc_aviamento_id = $1) tot`, [ocId],
      );
      expect(Number(r2.itens)).toBe(1);
      expect(Number(r2.tot)).toBeCloseTo(2 * P, 2);
    });
  });
});

// Item 4 da feature "Variantes de Aviamento": o item de OC guarda a variante COMPRADA
// (ocs_aviamento_itens.variante_aviamento_id). A RPC valida MEMBERSHIP (a variante tem de
// pertencer ao aviamento do MESMO item e à loja — espelha salvar_variantes_aviamento).
// Estoque segue por aviamento_id (não por variante) — não testado aqui, é intocado.
describe.skipIf(!hasDb)("RPC salvar_oc_aviamento — variante do item", () => {
  it("grava variante_aviamento_id; membership inválido/forjado rejeitado; item sem variante ok", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(
        c, `select id from empresas where tenant_id = $1 limit 1`, [TENANT_TESTE],
      );
      // Aviamento COM variante no tenant (backfill garante ao menos os que tinham cor).
      const avi = await um<{ aviamento_id: string; variante_id: string } | undefined>(
        c,
        `select va.aviamento_id, va.id as variante_id
           from variantes_aviamento va
           join aviamentos a on a.id = va.aviamento_id
          where va.tenant_id = $1 and a.tenant_id = $1
          limit 1`,
        [TENANT_TESTE],
      );
      if (!emp || !avi) return; // sem dado adequado → auto-pula, não falha

      // Casa o fornecedor da OC com o do aviamento p/ passar o guard A3 (fornecedor).
      const aviEmp = await um<{ empresa_id: string | null }>(
        c, `select empresa_id from aviamentos where id = $1`, [avi.aviamento_id],
      );
      const empId = aviEmp.empresa_id ?? emp.id;
      // numero_pedido é UNIQUE por loja — cada OC persistida usa um número distinto.
      const oc = (numero_pedido: string) => ({
        numero_pedido, responsavel_nome: "t", empresa_id: empId, data_pedido: null,
        data_prevista_entrega: "2026-07-01", data_entrega: null,
        prazo_pagamento: "30", quantidade_prazos: 1, nf_url: null,
        parcelas_recebimento: [], status: "encomendado",
      });
      const ocBase = oc("ITEST-VAR-bad"); // p/ os casos que RAISE antes do INSERT (não persiste)

      // 1) grava variante_aviamento_id
      const ins1 = await um<{ id: string }>(
        c, `select public._salvar_oc_aviamento_core(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify(oc("ITEST-VAR-1")), JSON.stringify(
          [{ id: null, aviamento_id: avi.aviamento_id, variante_aviamento_id: avi.variante_id, quantidade_pedida: 3, quantidade_recebida: null, cancelado: false }],
        )],
      );
      const g1 = await um<{ vid: string | null }>(
        c, `select variante_aviamento_id as vid from ocs_aviamento_itens where oc_aviamento_id = $1 limit 1`, [ins1.id],
      );
      expect(g1.vid).toBe(avi.variante_id);

      // 2) item SEM variante = ok (null persistido)
      const ins2 = await um<{ id: string }>(
        c, `select public._salvar_oc_aviamento_core(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify(oc("ITEST-VAR-2")), JSON.stringify(
          [{ id: null, aviamento_id: avi.aviamento_id, variante_aviamento_id: null, quantidade_pedida: 2, quantidade_recebida: null, cancelado: false }],
        )],
      );
      const g2 = await um<{ vid: string | null }>(
        c, `select variante_aviamento_id as vid from ocs_aviamento_itens where oc_aviamento_id = $1 limit 1`, [ins2.id],
      );
      expect(g2.vid).toBeNull();

      // 3) membership inválido: variante de OUTRO aviamento → RAISE (savepoint p/ não abortar a txn).
      const outra = await um<{ variante_id: string } | undefined>(
        c, `select id as variante_id from variantes_aviamento
             where tenant_id = $1 and aviamento_id <> $2 limit 1`, [TENANT_TESTE, avi.aviamento_id],
      );
      if (outra) {
        await c.query("SAVEPOINT sp_bad");
        await expect(
          c.query(`select public._salvar_oc_aviamento_core(null, $1::jsonb, $2::jsonb)`,
            [JSON.stringify(ocBase), JSON.stringify(
              [{ id: null, aviamento_id: avi.aviamento_id, variante_aviamento_id: outra.variante_id, quantidade_pedida: 1, quantidade_recebida: null, cancelado: false }],
            )]),
        ).rejects.toThrow(/Variante não pertence/);
        await c.query("ROLLBACK TO SAVEPOINT sp_bad");
      }

      // 3b) variante forjada (uuid inexistente) → RAISE.
      await c.query("SAVEPOINT sp_forged");
      await expect(
        c.query(`select public._salvar_oc_aviamento_core(null, $1::jsonb, $2::jsonb)`,
          [JSON.stringify(ocBase), JSON.stringify(
            [{ id: null, aviamento_id: avi.aviamento_id, variante_aviamento_id: "00000000-0000-0000-0000-0000000000aa", quantidade_pedida: 1, quantidade_recebida: null, cancelado: false }],
          )]),
      ).rejects.toThrow(/Variante não pertence/);
      await c.query("ROLLBACK TO SAVEPOINT sp_forged");
    });
  });
});
