// Salvar por card da revenda (C7, Task 2): prova no banco (cópia local, txn revertida) que as 2 RPCs de preço/markup da revenda
// gravam o que `payloadRevendaParaSalvar` (helper puro da Task 1) manda — exatamente a sequência que o bloco "revenda" do
// `mutationFn` de `usePlanejamentoSave` executa no Salvar (markups → fixos, só o grupo que mudou). NÃO exercita o React.
// Tudo em txn revertida; SÓ na cópia local (54422): `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54422/postgres`.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { payloadRevendaParaSalvar, type RevendaBase } from "@/lib/revenda-salvar";

const RODA = hasDb && ehBancoLocal();

/** Revenda nova da Loja Teste com card espelho: valor 100, markups 2 / 3, 1 variante. */
async function seedRevenda(c: Client): Promise<{ produtoId: string; modeloId: string }> {
  await comoUsuario(c);
  const g = await um<{ id: string }>(c, `insert into grupos_produto (tenant_id, nome) values ($1,'Fem SRNS PATest') returning id`, [TENANT_TESTE]);
  const cat = await um<{ id: string }>(c, `insert into categorias_produto (tenant_id, nome) values ($1,'Vestido SRNS PATest') returning id`, [TENANT_TESTE]);
  const dados = {
    nome: "Vestido SRNS", grupo_id: g.id, categoria_id: cat.id, qtd_total: 10, valor_unitario: 100, desconto_pct: 0,
    markup_atacado: 2, markup_varejo: 3, grade_proporcao: { P: 1 },
  };
  const prod = await um<{ id: string }>(c, `select salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [
    JSON.stringify(dados), JSON.stringify([{ ordem: 1, peso: 1, qtd: 10 }]),
  ]);
  const modelo = await um<{ id: string }>(c, `select criar_card_produto_acabado($1) as id`, [prod.id]);
  return { produtoId: prod.id, modeloId: modelo.id };
}

/** O que a tela tem como "base" no Salvar: markups do produto + preços do card (`modelos`). */
async function lerBaseRevenda(c: Client, produtoId: string, modeloId: string): Promise<RevendaBase> {
  const r = await um<{ ma: number | null; mv: number | null; pa: number | null; pv: number | null }>(
    c,
    `select p.markup_atacado::float8 ma, p.markup_varejo::float8 mv, m.preco_atacado::float8 pa, m.preco_venda::float8 pv
       from produtos_acabados p join modelos m on m.id = $2 where p.id = $1`,
    [produtoId, modeloId],
  );
  return { markup_atacado: r.ma, markup_varejo: r.mv, preco_atacado: r.pa, preco_venda: r.pv };
}

/** Mesma sequência do bloco "revenda" do mutationFn: só chama a RPC do grupo que não veio null. */
async function aplicarPayload(c: Client, produtoId: string, pay: ReturnType<typeof payloadRevendaParaSalvar>) {
  if (pay.markups) {
    await c.query(`select salvar_markups_produto_acabado($1, $2, $3)`, [produtoId, pay.markups.markup_atacado, pay.markups.markup_varejo]);
  }
  if (pay.fixos) {
    await c.query(`select salvar_precos_fixo_produto_acabado($1, $2, $3, $4, $5)`, [
      produtoId, pay.fixos.tocarAtacado, pay.fixos.precoAtacado, pay.fixos.tocarVarejo, pay.fixos.precoVarejo,
    ]);
  }
}

describe.skipIf(!RODA)("revenda grava pelo Salvar (via as 2 RPCs, payload do helper)", () => {
  it("markup atacado editado → produtos_acabados.markup_atacado muda, varejo intacto, modelos.preco_atacado recomputa", async () => {
    await withTx(async (c) => {
      const { produtoId, modeloId } = await seedRevenda(c);
      const base = await lerBaseRevenda(c, produtoId, modeloId);
      expect(base.markup_atacado).toBe(2);
      expect(base.markup_varejo).toBe(3);
      const p = payloadRevendaParaSalvar(
        base, { markupAtacado: 2.5, markupVarejo: base.markup_varejo, precoAtacadoFixo: base.preco_atacado, precoVarejoFixo: base.preco_venda },
        false, null, null,
      );
      expect(p.markups).not.toBeNull();
      expect(p.fixos).toBeNull();
      await aplicarPayload(c, produtoId, p);
      const depois = await lerBaseRevenda(c, produtoId, modeloId);
      expect(depois.markup_atacado).toBe(2.5);
      expect(depois.markup_varejo).toBe(3);
      expect(depois.preco_atacado).not.toBe(base.preco_atacado);
      expect(depois.preco_atacado).toBe(250); // 100 × 2,5
    });
  });

  it("nada mudou → payload sem markups/fixos → nenhuma RPC (estado intacto)", async () => {
    await withTx(async (c) => {
      const { produtoId, modeloId } = await seedRevenda(c);
      const base = await lerBaseRevenda(c, produtoId, modeloId);
      const p = payloadRevendaParaSalvar(
        base, { markupAtacado: base.markup_atacado, markupVarejo: base.markup_varejo, precoAtacadoFixo: base.preco_atacado, precoVarejoFixo: base.preco_venda },
        false, null, null,
      );
      expect(p).toEqual({ markups: null, fixos: null });
      await aplicarPayload(c, produtoId, p);
      expect(await lerBaseRevenda(c, produtoId, modeloId)).toEqual(base);
    });
  });

  it("preço fixo de atacado → grava o preço EXATO, limpa o markup do canal; varejo não tocado", async () => {
    await withTx(async (c) => {
      const { produtoId, modeloId } = await seedRevenda(c);
      const base = await lerBaseRevenda(c, produtoId, modeloId);
      const p = payloadRevendaParaSalvar(
        base, { markupAtacado: base.markup_atacado, markupVarejo: base.markup_varejo, precoAtacadoFixo: 321.37, precoVarejoFixo: base.preco_venda },
        false, null, null,
      );
      expect(p.fixos).toMatchObject({ tocarAtacado: true, precoAtacado: 321.37, tocarVarejo: false });
      await aplicarPayload(c, produtoId, p);
      const depois = await lerBaseRevenda(c, produtoId, modeloId);
      expect(depois.preco_atacado).toBe(321.37);
      expect(depois.markup_atacado).toBeNull();
      expect(depois.markup_varejo).toBe(3);
      expect(depois.preco_venda).toBe(base.preco_venda);
    });
  });

  it("varejo travado pela Integração → payload nunca toca o canal (markup do servidor reenviado, fixo varejo não tocado)", async () => {
    await withTx(async (c) => {
      const { produtoId, modeloId } = await seedRevenda(c);
      const base = await lerBaseRevenda(c, produtoId, modeloId);
      const p = payloadRevendaParaSalvar(
        base, { markupAtacado: 2.5, markupVarejo: 9, precoAtacadoFixo: base.preco_atacado, precoVarejoFixo: 999 },
        true, null, null,
      );
      expect(p.markups).toEqual({ markup_atacado: 2.5, markup_varejo: base.markup_varejo });
      expect(p.fixos).toMatchObject({ tocarVarejo: false, precoVarejo: null });
      await aplicarPayload(c, produtoId, p);
      const depois = await lerBaseRevenda(c, produtoId, modeloId);
      expect(depois.markup_atacado).toBe(2.5);
      expect(depois.markup_varejo).toBe(3);
      expect(depois.preco_venda).toBe(base.preco_venda);
    });
  });
});
