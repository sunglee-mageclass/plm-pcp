// Edição rápida do card de Etapas PL × `salvar_terceirizados` (ESTADO COMPLETO por CAD) — bug de perda de dado (out/2026): a edição
// rápida mandava só o bloco do card, a RPC apagava os OUTROS serviços do CAD e zerava NF/peça-foto do que ficava. Aqui o payload
// montado por `montarPayloadEdicaoRapida` (o mesmo do sheet do PCP › Serviços) é mandado à RPC de verdade, numa transação
// REVERTIDA e SÓ na cópia local: nº de serviços, NF/peça-foto e o resto das colunas ficam iguais; só o campo editado muda.
// Contraste: o payload ANTIGO (1 bloco) apaga os outros e zera NF — prova que as asserções pegam a regressão.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, ehBancoLocal, withTx, comoUsuario, semJwt, um, TENANT_TESTE } from "./db";
import { montarPayloadEdicaoRapida } from "@/lib/servicos-payload";
import { camadaVazioViva } from "./camada-helpers";

const RODA = hasDb && ehBancoLocal();
const T = TENANT_TESTE;

type Linha = Record<string, unknown>;

/** Linhas do CAD como o PostgREST as devolve (`to_jsonb`: datas em texto, numeric em número, jsonb em objeto). */
async function linhasDoCad(c: Client, cad: string): Promise<Linha[]> {
  const { rows } = await c.query(
    `select to_jsonb(pt) j from producao_terceirizados pt where cad_id = $1 order by created_at, id`,
    [cad],
  );
  return rows.map((r) => r.j as Linha);
}

async function salvar(
  c: Client,
  cad: string,
  blocos: unknown,
  molde: string | null,
  revBase: unknown,
) {
  await c.query("SAVEPOINT rpc");
  try {
    await c.query(`select public.salvar_terceirizados($1, $2::jsonb, $3, $4::jsonb)`, [
      cad,
      JSON.stringify(blocos),
      molde,
      revBase === null ? null : JSON.stringify(revBase),
    ]);
    await c.query("RELEASE SAVEPOINT rpc");
    return { ok: true as const };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT rpc");
    await c.query("RELEASE SAVEPOINT rpc");
    const er = e as { code?: string; message?: string };
    return { ok: false as const, code: String(er.code ?? ""), msg: String(er.message ?? "") };
  }
}

/** Cad da Loja Teste com 3 serviços (2 PL com NF/peça-foto + 1 interno) e observação do molde. Fixture como postgres, sem JWT. */
async function cadComServicos(
  c: Client,
): Promise<{ cad: string; a: string; b: string; i: string }> {
  return semJwt(c, async () => {
    const m = (
      await um<{ id: string }>(
        c,
        `insert into modelos (tenant_id, nome) values ($1, 'Etapas rapida') returning id`,
        [T],
      )
    ).id;
    const cad = (
      await um<{ id: string }>(
        c,
        `insert into cad (tenant_id, modelo_id, observacoes_molde) values ($1, $2, 'molde: 4 partes') returning id`,
        [T, m],
      )
    ).id;
    const cat = async (nome: string) =>
      (
        await um<{ id: string }>(
          c,
          `insert into categorias_terceirizado (tenant_id, nome) values ($1, $2) returning id`,
          [T, nome],
        )
      ).id;
    const emp =
      (
        await um<{ id: string } | undefined>(
          c,
          `select id from empresas where tenant_id = $1 order by id limit 1`,
          [T],
        )
      )?.id ?? null;
    const serv = async (v: Record<string, unknown>) =>
      (
        await um<{ id: string }>(
          c,
          `insert into producao_terceirizados (cad_id, tenant_id, ativo, categoria_terceirizado_id, interno, empresa_id, colaborador_id,
             preco_metro_unidade, quantidade_enviada, quantidade_recebida, quantidade_defeito, desconto_total, multa_total,
             numero_parcelas, data_enviado, data_prevista, observacao, aviamentos_enviados, tecidos_enviados,
             pt_data_saida, pt_data_entrada, pt_aprovacao, nf_saida, nf_entrada, peca_foto, peca_foto_data)
           values ($1, $2, true, $3, $4, $5, null, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, '[]', '[]',
                   $16, $17, $18, $19::jsonb, $20::jsonb, $21, $22)
           returning id`,
          [
            cad,
            T,
            v.cat,
            v.interno,
            v.interno ? null : emp,
            v.preco,
            v.env,
            v.rec,
            v.def,
            v.desc,
            v.multa,
            v.parc,
            v.data_env,
            v.data_prev,
            v.obs,
            v.pt_saida,
            v.pt_entrada,
            v.pt_aprov,
            JSON.stringify(v.nf_saida),
            JSON.stringify(v.nf_entrada),
            v.peca_foto,
            v.peca_foto_data,
          ],
        )
      ).id;
    const a = await serv({
      cat: await cat("Costura ER"),
      interno: false,
      preco: 12.5,
      env: 100,
      rec: 90,
      def: 2,
      desc: 10,
      multa: 3,
      parc: 2,
      data_env: "2026-10-01",
      data_prev: "2026-10-20",
      obs: "obs A",
      pt_saida: "2026-09-25",
      pt_entrada: null,
      pt_aprov: null,
      nf_saida: [{ url: "t/nf-saida-a.pdf", data: "2026-10-01" }],
      nf_entrada: [{ url: "t/nf-entrada-a.pdf", data: "2026-10-03" }],
      peca_foto: true,
      peca_foto_data: "2026-10-04",
    });
    const b = await serv({
      cat: await cat("Lavanderia ER"),
      interno: false,
      preco: 4,
      env: 30,
      rec: 0,
      def: 0,
      desc: 0,
      multa: 0,
      parc: 1,
      data_env: "2026-09-20",
      data_prev: null,
      obs: "obs B",
      pt_saida: "2026-09-20",
      pt_entrada: "2026-09-22",
      pt_aprov: "aprovado",
      nf_saida: [{ url: "t/nf-saida-b.pdf", data: "2026-09-21" }],
      nf_entrada: [{ url: "t/nf-entrada-b.pdf", data: "2026-09-23" }],
      peca_foto: true,
      peca_foto_data: "2026-09-30",
    });
    const i = await serv({
      cat: await cat("Oficina ER"),
      interno: true,
      preco: 0,
      env: 50,
      rec: 0,
      def: 0,
      desc: 0,
      multa: 0,
      parc: 1,
      data_env: "2026-10-02",
      data_prev: null,
      obs: "interno",
      pt_saida: null,
      pt_entrada: null,
      pt_aprov: null,
      nf_saida: [],
      nf_entrada: [],
      peca_foto: false,
      peca_foto_data: null,
    });
    return { cad, a, b, i };
  });
}

/** O payload que a edição rápida mandava ANTES do fix (1 bloco, sem nf_saida/nf_entrada/peca_foto/peca_foto_data). */
function payloadAntigo(r: Linha, campo: string, valor: string | null) {
  const k = [
    "id",
    "categoria_terceirizado_id",
    "interno",
    "empresa_id",
    "representante_id",
    "colaborador_id",
    "ativo",
    "preco_metro_unidade",
    "quantidade_enviada",
    "quantidade_recebida",
    "quantidade_defeito",
    "desconto_total",
    "multa_total",
    "numero_parcelas",
    "data_enviado",
    "data_prevista",
    "data_entregue",
    "observacao",
    "aviamentos_enviados",
    "tecidos_enviados",
    "detalhado",
    "grade_detalhe",
    "pt_data_saida",
    "pt_data_entrada",
    "pt_aprovacao",
  ];
  return {
    blocos: [{ ...Object.fromEntries(k.map((x) => [x, r[x]])), [campo]: valor }],
    revBase: { [r.id as string]: r.rev },
  };
}

const VOLATEIS = ["rev"]; // sobe 1 a cada UPDATE (fn_colab_touch_rev)
const semVolateis = (r: Linha) =>
  Object.fromEntries(Object.entries(r).filter(([k]) => !VOLATEIS.includes(k)));

describe.skipIf(!RODA)(
  "edição rápida de Etapas PL × salvar_terceirizados (txn revertida, cópia local)",
  () => {
    it("payload novo: nº de serviços, NF/peça-foto e demais colunas intactos; só o campo editado muda", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '60s'");
        await comoUsuario(c); // super admin da Loja Teste
        const s = await cadComServicos(c);
        const antes = await linhasDoCad(c, s.cad);
        expect(antes).toHaveLength(3);
        const molde = (
          await um<{ o: string | null }>(c, `select observacoes_molde o from cad where id = $1`, [
            s.cad,
          ])
        ).o;

        for (const [campo, valor] of [
          ["pt_data_entrada", "2026-10-06"],
          ["pt_aprovacao", "aprovado"],
          ["data_enviado", "2026-10-07"],
          ["pt_data_saida", null],
        ] as const) {
          const base = await linhasDoCad(c, s.cad);
          const { _blocos, _rev_base } = montarPayloadEdicaoRapida({
            linhas: base,
            blocoId: s.a,
            campo,
            valor,
          });
          const r = await salvar(c, s.cad, _blocos, molde, _rev_base);
          expect(r, `${campo}`).toEqual({ ok: true });

          const depois = await linhasDoCad(c, s.cad);
          expect(
            depois.map((x) => x.id),
            campo,
          ).toEqual(base.map((x) => x.id)); // ninguém apagado, ninguém criado
          for (const d of depois) {
            const b0 = base.find((x) => x.id === d.id)!;
            const esperado =
              d.id === s.a ? { ...semVolateis(b0), [campo]: valor } : semVolateis(b0);
            expect(semVolateis(d), `${campo} ${d.id === s.a ? "card" : "outro"}`).toEqual(esperado);
          }
        }
        // NF/peça-foto do começo seguem iguais (o card só mudou campos de etapa)
        const fim = await linhasDoCad(c, s.cad);
        for (const k of ["nf_saida", "nf_entrada", "peca_foto", "peca_foto_data"])
          expect(
            fim.map((x) => x[k]),
            k,
          ).toEqual(antes.map((x) => x[k]));
        expect(
          (
            await um<{ o: string | null }>(c, `select observacoes_molde o from cad where id = $1`, [
              s.cad,
            ])
          ).o,
        ).toBe(molde);
      });
    });

    it("outra pessoa salvou no meio: P0409 e NADA é gravado (sem retry)", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '60s'");
        await comoUsuario(c);
        const s = await cadComServicos(c);
        const base = await linhasDoCad(c, s.cad);
        const { _blocos, _rev_base } = montarPayloadEdicaoRapida({
          linhas: base,
          blocoId: s.a,
          campo: "pt_aprovacao",
          valor: "reprovado",
        });
        // "outra pessoa" salva o serviço B depois da leitura (rev de B sobe)
        await semJwt(c, () =>
          c.query(`update producao_terceirizados set observacao = 'mudou' where id = $1`, [s.b]),
        );
        const meio = await linhasDoCad(c, s.cad);
        const r = await salvar(c, s.cad, _blocos, null, _rev_base);
        expect(r.ok).toBe(false);
        expect(r.ok ? "" : r.code).toBe("P0409");
        expect(await linhasDoCad(c, s.cad)).toEqual(meio);
      });
    });

    it("contraste (o bug): o payload ANTIGO de 1 bloco apaga os outros serviços e zera NF/peça-foto", async () => {
      await withTx(async (c) => {
        await c.query("SET LOCAL statement_timeout = '60s'");
        await comoUsuario(c);
        const s = await cadComServicos(c);
        const base = await linhasDoCad(c, s.cad);
        const a0 = base.find((x) => x.id === s.a)!;
        const { blocos, revBase } = payloadAntigo(a0, "pt_data_entrada", "2026-10-06");
        const r = await salvar(c, s.cad, blocos, "molde: 4 partes", revBase);
        // Camada C1 (follow-up I2) viva: o servidor confere o rev de todo bloco que vai APAGAR — o payload antigo (só 1 bloco no
        // _rev_base) passa a ser RECUSADO (P0409) e nada muda; o contraste do bug só existe sem ela.
        if (await camadaVazioViva(c)) {
          expect(r.ok ? "" : r.code).toBe("P0409");
          expect(await linhasDoCad(c, s.cad)).toEqual(base);
          return;
        }
        expect(r).toEqual({ ok: true });
        const depois = await linhasDoCad(c, s.cad);
        expect(depois).toHaveLength(1); // B e o interno foram APAGADOS
        expect(depois[0].nf_saida).toEqual([]); // e a NF do que ficou, zerada
        expect(depois[0].nf_entrada).toEqual([]);
        expect(depois[0].peca_foto).toBe(false);
        expect(depois[0].peca_foto_data).toBeNull();
      });
    });
  },
);
