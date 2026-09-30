// Contas certas A2 (fin #5): parcela de SERVIÇO paga guarda o valor pago (parcelas_servico.valor_pago) e as não pagas
// dividem o saldo. Migration 20261019210000. Integração em BEGIN…ROLLBACK (withTx): nada é gravado.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";

const RODA = hasDb && ehBancoLocal();
const MD5_SF = "daec320c497c283929b33b55303aba89";
// chaves de cada linha da saída de servicos_financeiro() — o formato NÃO muda (HomeLogado, Calendário e Lista)
const CHAVES = [
  "custo_bruto",
  "custo_liquido",
  "data_entrega",
  "data_pagamento",
  "data_vencimento",
  "desconto",
  "dias_offset",
  "empresa_cnpj",
  "empresa_nome",
  "is_oficina",
  "modelo_nome",
  "multa",
  "numero_parcela",
  "numero_parcelas",
  "comprovante_url",
  "parcela_id",
  "producao_terceirizado_id",
  "ref",
  "representante_cnpj",
  "representante_nome",
  "responsavel",
  "responsavel_cnpj",
  "servico",
  "status",
  "valor_parcela",
].sort();

type Linha = {
  parcela_id: string;
  numero_parcela: number;
  valor_parcela: number;
  status: string;
  [k: string]: unknown;
};

async function bloco(c: Client, opts: { preco?: number; qtd?: number; n?: number } = {}) {
  await comoUsuario(c);
  const m = await um<{ id: string }>(
    c,
    `insert into modelos (tenant_id, nome) values ($1,'M CC-A2') returning id`,
    [TENANT_TESTE],
  );
  const cad = await um<{ id: string }>(
    c,
    `insert into cad (tenant_id, modelo_id) values ($1,$2) returning id`,
    [TENANT_TESTE, m.id],
  );
  const cat = await um<{ id: string }>(
    c,
    `insert into categorias_terceirizado (tenant_id, nome, etapa) values ($1, $2, 'ate_costura') returning id`,
    [TENANT_TESTE, `Bordado CC-A2 ${m.id.slice(0, 8)}`],
  );
  const pt = await um<{ id: string }>(
    c,
    `insert into producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, ativo, interno, preco_metro_unidade,
                                         quantidade_enviada, numero_parcelas, data_enviado, data_entregue)
     values ($1,$2,$3,true,false,$4,$5,$6,'2026-09-01','2026-09-10') returning id`,
    [cad.id, TENANT_TESTE, cat.id, opts.preco ?? 10, opts.qtd ?? 10, opts.n ?? 3],
  );
  return pt.id;
}
async function tela(c: Client, pt: string): Promise<Linha[]> {
  const r = await um<{ j: Linha[] }>(c, `select public.servicos_financeiro() as j`);
  return (r.j ?? [])
    .filter((l) => l.producao_terceirizado_id === pt)
    .map((l) => ({ ...l, valor_parcela: Number(l.valor_parcela) }))
    .sort((a, b) => a.numero_parcela - b.numero_parcela);
}
const soma = (ls: Linha[]) => Math.round(ls.reduce((s, l) => s + l.valor_parcela, 0) * 100) / 100;
async function pagar(c: Client, pt: string, n: number) {
  await c.query(
    `update parcelas_servico set status='pago', data_pagamento='2026-09-20'
                  where producao_terceirizado_id=$1 and numero_parcela=$2`,
    [pt, n],
  );
}
async function valorPago(c: Client, pt: string, n: number): Promise<number | null> {
  const r = await um<{ v: string | null }>(
    c,
    `select valor_pago v from parcelas_servico where producao_terceirizado_id=$1 and numero_parcela=$2`,
    [pt, n],
  );
  return r.v == null ? null : Number(r.v);
}

describe.skipIf(!RODA)(
  "contas certas A2 — parcelas_servico.valor_pago + servicos_financeiro",
  () => {
    it("migration: coluna, gatilho, helper e _servicos_financeiro com ACL certa", async () => {
      await withTx(async (c) => {
        const r = await um<{
          m: string;
          h1: boolean;
          h2: boolean;
          sa: boolean;
          sau: boolean;
          t: string;
        }>(
          c,
          `select md5(pg_get_functiondef('public.servicos_financeiro()'::regprocedure)) m,
                has_function_privilege('anon','public._servico_parcelas_valores(uuid)','EXECUTE') h1,
                has_function_privilege('authenticated','public._servico_parcelas_valores(uuid)','EXECUTE') h2,
                has_function_privilege('anon','public.servicos_financeiro()','EXECUTE') sa,
                has_function_privilege('authenticated','public.servicos_financeiro()','EXECUTE') sau,
                (select tgenabled::text from pg_trigger where tgname='trg_servico_parcela_valor_pago') t`,
        );
        expect(r).toEqual({ m: MD5_SF, h1: false, h2: false, sa: false, sau: true, t: "O" });
      });
    });

    it("sem pagamento: igual a antes (33,33 / 33,33 / 33,34) e o formato da saída não muda", async () => {
      await withTx(async (c) => {
        const pt = await bloco(c);
        const ls = await tela(c, pt);
        expect(ls.map((l) => l.valor_parcela)).toEqual([33.33, 33.33, 33.34]);
        expect(Object.keys(ls[0]).sort()).toEqual(CHAVES);
      });
    });

    it("pagar a nº1 de 3: valor_pago = 33,33 (1/3 do líquido); desfazer o pagamento: NULL e divisão normal", async () => {
      await withTx(async (c) => {
        const pt = await bloco(c);
        await tela(c, pt); // gera as parcelas
        await pagar(c, pt, 1);
        expect(await valorPago(c, pt, 1)).toBe(33.33);
        expect(await valorPago(c, pt, 2)).toBeNull();
        await c.query(
          `update parcelas_servico set status='a_pagar', data_pagamento=null
                      where producao_terceirizado_id=$1 and numero_parcela=1`,
          [pt],
        );
        expect(await valorPago(c, pt, 1)).toBeNull();
        expect((await tela(c, pt)).map((l) => l.valor_parcela)).toEqual([33.33, 33.33, 33.34]);
      });
    });

    it("multa +100 depois de pagar a nº1: a paga NÃO muda; as 2 não pagas dividem (líquido + 100 − pago)", async () => {
      await withTx(async (c) => {
        const pt = await bloco(c);
        await tela(c, pt);
        await pagar(c, pt, 1);
        await c.query(`update producao_terceirizados set multa_total = 100 where id = $1`, [pt]);
        const ls = await tela(c, pt);
        expect(ls.map((l) => l.valor_parcela)).toEqual([33.33, 83.34, 83.33]); // 166,67 em 2
        expect(soma(ls)).toBe(200);
        expect(await valorPago(c, pt, 1)).toBe(33.33);
      });
    });

    it("o cliente manda valor_pago no UPDATE: ignorado (paga mantém; não paga fica NULL)", async () => {
      await withTx(async (c) => {
        const pt = await bloco(c);
        await tela(c, pt);
        await pagar(c, pt, 1);
        await c.query(
          `update parcelas_servico set valor_pago = 999 where producao_terceirizado_id=$1`,
          [pt],
        );
        expect(await valorPago(c, pt, 1)).toBe(33.33);
        expect(await valorPago(c, pt, 2)).toBeNull();
      });
    });

    it("INSERT de parcela JÁ paga congela o valor na hora (RA3)", async () => {
      await withTx(async (c) => {
        const pt = await bloco(c);
        await c.query(
          `insert into parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento, status, data_pagamento, valor_pago)
                     values ($1,$2,1,'2026-10-10','pago','2026-09-20', 1)`,
          [TENANT_TESTE, pt],
        );
        expect(await valorPago(c, pt, 1)).toBe(33.33); // o 1 mandado é ignorado
        await c.query(
          `insert into parcelas_servico (tenant_id, producao_terceirizado_id, numero_parcela, data_vencimento, valor_pago)
                     values ($1,$2,2,'2026-11-10', 5)`,
          [TENANT_TESTE, pt],
        );
        expect(await valorPago(c, pt, 2)).toBeNull();
      });
    });

    it("bloco INATIVO (ou interno) com parcela paga: a paga continua na lista; as não pagas somem", async () => {
      await withTx(async (c) => {
        const pt = await bloco(c);
        await tela(c, pt);
        await pagar(c, pt, 1);
        await c.query(`update producao_terceirizados set ativo = false where id = $1`, [pt]);
        let ls = await tela(c, pt);
        expect(ls.map((l) => [l.numero_parcela, l.valor_parcela, l.status])).toEqual([
          [1, 33.33, "pago"],
        ]);
        await c.query(
          `update producao_terceirizados set ativo = true, interno = true where id = $1`,
          [pt],
        );
        ls = await tela(c, pt);
        expect(ls.map((l) => l.numero_parcela)).toEqual([1]);
      });
    });

    it("paga ACIMA de n_eff (prazo encurtou 3 → 2): Σ das parcelas = líquido (a paga leva o próprio valor, não 'o resto')", async () => {
      await withTx(async (c) => {
        const pt = await bloco(c);
        await tela(c, pt);
        await pagar(c, pt, 3);
        expect(await valorPago(c, pt, 3)).toBe(33.34);
        await c.query(`update producao_terceirizados set numero_parcelas = 2 where id = $1`, [pt]);
        const ls = await tela(c, pt);
        expect(ls.map((l) => [l.numero_parcela, l.valor_parcela])).toEqual([
          [1, 33.33],
          [2, 33.33],
          [3, 33.34],
        ]);
        expect(soma(ls)).toBe(100);
      });
    });

    it("todas pagas + multa: sem parcela 'complemento' (RA1 → MÉDIA); as pagas não mudam", async () => {
      await withTx(async (c) => {
        const pt = await bloco(c, { preco: 9, qtd: 192, n: 1 });
        await tela(c, pt);
        await pagar(c, pt, 1);
        expect(await valorPago(c, pt, 1)).toBe(1728);
        await c.query(`update producao_terceirizados set multa_total = 100 where id = $1`, [pt]);
        const ls = await tela(c, pt);
        expect(ls.map((l) => [l.numero_parcela, l.valor_parcela])).toEqual([[1, 1728]]);
      });
    });

    it("legado pago SEM valor_pago (correção única não rodou): cai na fórmula antiga", async () => {
      await withTx(async (c) => {
        const pt = await bloco(c);
        await tela(c, pt);
        await c.query(`select set_config('app.servico_valor_pago_correcao','on', true)`);
        await pagar(c, pt, 1); // com a GUC o gatilho não congela: simula a paga de antes da migration
        await c.query(`select set_config('app.servico_valor_pago_correcao','', true)`);
        expect(await valorPago(c, pt, 1)).toBeNull();
        await c.query(`update producao_terceirizados set multa_total = 30 where id = $1`, [pt]);
        const ls = await tela(c, pt);
        expect(ls[0].valor_parcela).toBe(43.33); // round(130/3) = fórmula antiga
        expect(soma(ls)).toBe(130);
      });
    });
  },
);
