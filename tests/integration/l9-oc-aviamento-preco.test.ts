// Achados LEVES — release L9 (respostas do dono de 01/out):
//   • P-206 A (fin #8): o item da OC de aviamento guarda o PREÇO DA COMPRA (`ocs_aviamento_itens.preco`), preenchido com o
//     cadastro; parcelas/valor da OC usam COALESCE(it.preco, aviamentos.preco, 0) — mudar o cadastro DEPOIS não mexe na OC.
//     Correção única SEPARADA congela o preço de hoje nos itens vazios (aviamento: todos; tecido: OCs recebidas).
//   • P-208 A (est #5): aviamento com 2+ cores exige a cor no item novo/editado (P0001 `oc_aviamento_cor_obrigatoria:`);
//     item antigo sem cor e não mexido não trava o save.
// Migrations 20261029100000_oc_aviamento_preco + 20261029110000_oc_preco_congelar_correcao_unica (e os inversos).
// Só na CÓPIA LOCAL, txn revertida (withTx): nada é gravado. Fixture ausente = FALHA (nunca passa calado).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { aplicarArquivo } from "./mig-txn";
import { mensagemErro } from "@/lib/erro-mensagem";

const RODA = hasDb && ehBancoLocal();
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const T = TENANT_TESTE;

const MD5_DEPOIS: Record<string, string> = {
  "public.gerar_parcelas_oc_aviamento()": "11f384d54071402055205fd2ad66f2c6",
  "public._recalcular_parcelas_core(uuid,text)": "cdd88638886087b9fd71a631be1035f1",
  "public._dashboard_financeiro_core(date,date)": "c6069728c11a900047531eb4e1f5e920",
  "public._salvar_oc_aviamento_core(uuid,jsonb,jsonb,integer)": "cd78ec5bb7e2570db19f41c84584bfcc",
};

type Fx = {
  emp: string;
  avi1: string;
  avi2: string;
  var2a: string;
  var2b: string;
  preco1: number;
  preco2: number;
};

/** Loja Teste: empresa + 2 aviamentos NOVOS (preço 2,50 com 1 cor; 4,00 com 2 cores) — criados na txn. */
async function prepara(c: Client): Promise<Fx> {
  await c.query("SET LOCAL lock_timeout = '3s'");
  await c.query("SET LOCAL statement_timeout = '120s'");
  await comoUsuario(c);
  const emp = await um<{ id: string } | undefined>(
    c,
    `select id from empresas where tenant_id = $1 order by id limit 1`,
    [T],
  );
  const cores = (
    await c.query(`select id from cores where tenant_id = $1 order by id limit 3`, [T])
  ).rows as { id: string }[];
  if (!emp || cores.length < 3) throw new Error("fixture ausente: empresa / 3 cores na Loja Teste");
  const avi = async (nome: string, preco: number) =>
    (
      await um<{ id: string }>(
        c,
        `insert into aviamentos (tenant_id, codigo_nome, empresa_id, preco) values ($1, $2, $3, $4) returning id`,
        [T, nome, emp.id, preco],
      )
    ).id;
  const varAvi = async (aviId: string, cor: string) =>
    (
      await um<{ id: string }>(
        c,
        `insert into variantes_aviamento (tenant_id, aviamento_id, cor_id) values ($1, $2, $3) returning id`,
        [T, aviId, cor],
      )
    ).id;
  const avi1 = await avi("L9 TESTE botao 1 cor", 2.5);
  await varAvi(avi1, cores[0].id);
  const avi2 = await avi("L9 TESTE franja 2 cores", 4);
  const var2a = await varAvi(avi2, cores[1].id);
  const var2b = await varAvi(avi2, cores[2].id);
  return { emp: emp.id, avi1, avi2, var2a, var2b, preco1: 2.5, preco2: 4 };
}

const ocPayload = (
  fx: Fx,
  numero: string,
  status: "encomendado" | "recebido",
  prazo = "30/60",
) => ({
  numero_pedido: numero,
  responsavel_nome: "t",
  empresa_id: fx.emp,
  data_pedido: "2026-09-01",
  data_prevista_entrega: "2026-09-10",
  data_entrega: status === "recebido" ? "2026-09-10" : null,
  data_nota_entrada: status === "recebido" ? "2026-09-10" : "",
  prazo_pagamento: prazo,
  quantidade_prazos: 2,
  nf_url: null,
  parcelas_recebimento: [],
  status,
});
type ItemP = Record<string, unknown>;
async function salvar(c: Client, ocId: string | null, oc: object, itens: ItemP[]): Promise<string> {
  const r = await um<{ id: string }>(
    c,
    `select public._salvar_oc_aviamento_core($1::uuid, $2::jsonb, $3::jsonb, null::integer) as id`,
    [ocId, JSON.stringify(oc), JSON.stringify(itens)],
  );
  return r.id;
}
async function itens(c: Client, ocId: string) {
  return (
    await c.query(
      `select id, aviamento_id, variante_aviamento_id, quantidade_pedida::float8 qp, quantidade_recebida::float8 qr, cancelado,
              preco::float8 preco
         from ocs_aviamento_itens where oc_aviamento_id = $1 order by created_at, id`,
      [ocId],
    )
  ).rows as {
    id: string;
    aviamento_id: string;
    variante_aviamento_id: string | null;
    qp: number;
    qr: number | null;
    cancelado: boolean;
    preco: number | null;
  }[];
}
async function parcelas(c: Client, ocId: string) {
  return (
    await c.query(
      `select id, numero_parcela n, valor::float8 valor, status from parcelas where oc_aviamento_id = $1 order by numero_parcela`,
      [ocId],
    )
  ).rows as { id: string; n: number; valor: number; status: string }[];
}
const soma = (ps: { valor: number }[]) =>
  Math.round(ps.reduce((s, p) => s + p.valor * 100, 0)) / 100;
async function erroDe(
  c: Client,
  fn: () => Promise<unknown>,
): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT l9_err");
  try {
    await fn();
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT l9_err");
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
  await c.query("RELEASE SAVEPOINT l9_err");
  throw new Error("esperava recusa, mas a chamada passou");
}

describe.skipIf(!RODA)(
  "L9 — OC de aviamento: preço da compra (P-206 A) e cor obrigatória (P-208 A)",
  () => {
    it("migration aplicada: coluna preco numeric NULL; md5 de depois nas 4 funções; internos sem PUBLIC/anon/authenticated", async () => {
      await withTx(async (c) => {
        const col = await um<{ t: string; n: string; d: string | null } | undefined>(
          c,
          `select data_type t, is_nullable n, column_default d from information_schema.columns
          where table_schema = 'public' and table_name = 'ocs_aviamento_itens' and column_name = 'preco'`,
        );
        expect(col).toEqual({ t: "numeric", n: "YES", d: null });
        for (const [sig, md5] of Object.entries(MD5_DEPOIS)) {
          const r = await um<{ m: string; anon: boolean; auth: boolean; pub: boolean }>(
            c,
            `select md5(pg_get_functiondef(to_regprocedure($1))) m,
                  has_function_privilege('anon', $1, 'EXECUTE') anon,
                  has_function_privilege('authenticated', $1, 'EXECUTE') auth,
                  exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                          where p.oid = to_regprocedure($1) and x.grantee = 0 and x.privilege_type = 'EXECUTE') pub`,
            [sig],
          );
          expect(r.m, sig).toBe(md5);
          expect([r.anon, r.auth, r.pub], sig).toEqual([false, false, false]);
        }
      });
    });

    it("item NOVO nasce com o preço do cadastro (payload sem preço) ou com o digitado; preço negativo é recusado (P0001 ASCII)", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await salvar(c, null, ocPayload(fx, "L9-PREF-1", "encomendado"), [
          {
            id: null,
            aviamento_id: fx.avi1,
            quantidade_pedida: 10,
            quantidade_recebida: null,
            cancelado: false,
          },
          {
            id: null,
            aviamento_id: fx.avi1,
            quantidade_pedida: 5,
            quantidade_recebida: null,
            cancelado: false,
            preco: 1.75,
          },
          {
            id: null,
            aviamento_id: fx.avi1,
            quantidade_pedida: 2,
            quantidade_recebida: null,
            cancelado: false,
            preco: null,
          },
        ]);
        expect(
          (await itens(c, oc)).map((i) => [i.qp, i.preco]).sort((a, b) => a[0]! - b[0]!),
        ).toEqual([
          [2, 2.5],
          [5, 1.75],
          [10, 2.5],
        ]);
        const e = await erroDe(c, () =>
          salvar(c, null, ocPayload(fx, "L9-PREF-2", "encomendado"), [
            {
              id: null,
              aviamento_id: fx.avi1,
              quantidade_pedida: 1,
              quantidade_recebida: null,
              cancelado: false,
              preco: -1,
            },
          ]),
        );
        expect(e.code).toBe("P0001");
        expect(e.message.startsWith("oc_aviamento_preco_invalido:")).toBe(true);
        expect(/^[ -~]*$/.test(e.message)).toBe(true);
        expect(mensagemErro(e)).toBe("O preço do aviamento não pode ser negativo.");
      });
    });

    it("cadastro muda DEPOIS de receber → a OC (itens, parcelas, investido do dashboard) NÃO muda, nem no re-save da tela", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await salvar(c, null, ocPayload(fx, "L9-REC-1", "recebido"), [
          {
            id: null,
            aviamento_id: fx.avi1,
            quantidade_pedida: 100,
            quantidade_recebida: 100,
            cancelado: false,
            preco: 2.5,
          },
        ]);
        const antes = await parcelas(c, oc);
        expect(antes.length).toBe(2);
        expect(soma(antes)).toBe(250);
        const dashAntes = await um<{ v: number }>(
          c,
          `select (public._dashboard_financeiro_core(null, null)->>'investido')::float8 v`,
        );

        await c.query(`update aviamentos set preco = 9.99 where id = $1`, [fx.avi1]); // cadastro sobe
        await c.query(`select public._recalcular_parcelas_core($1, 'aviamento')`, [oc]);
        expect(soma(await parcelas(c, oc))).toBe(250);
        // re-save como a tela manda (preço do item presente) e como a tela ANTIGA mandava (sem a chave preco)
        const [it] = await itens(c, oc);
        await salvar(c, oc, ocPayload(fx, "L9-REC-1", "recebido"), [
          {
            id: it.id,
            aviamento_id: fx.avi1,
            quantidade_pedida: 100,
            quantidade_recebida: 100,
            cancelado: false,
            preco: it.preco,
          },
        ]);
        expect(soma(await parcelas(c, oc))).toBe(250);
        await salvar(c, oc, ocPayload(fx, "L9-REC-1", "recebido"), [
          {
            id: it.id,
            aviamento_id: fx.avi1,
            quantidade_pedida: 100,
            quantidade_recebida: 100,
            cancelado: false,
          },
        ]);
        expect((await itens(c, oc))[0].preco).toBe(2.5);
        expect(soma(await parcelas(c, oc))).toBe(250);
        const dashDepois = await um<{ v: number }>(
          c,
          `select (public._dashboard_financeiro_core(null, null)->>'investido')::float8 v`,
        );
        expect(dashDepois.v).toBeCloseTo(dashAntes.v, 2);

        // editar o PREÇO DA COMPRA numa OC recebida refaz as parcelas não pagas
        await salvar(c, oc, ocPayload(fx, "L9-REC-1", "recebido"), [
          {
            id: it.id,
            aviamento_id: fx.avi1,
            quantidade_pedida: 100,
            quantidade_recebida: 100,
            cancelado: false,
            preco: 3,
          },
        ]);
        expect(soma(await parcelas(c, oc))).toBe(300);
      });
    });

    it("preço NULL (legado) = preço do cadastro (parcelas e dashboard); trocar o aviamento sem a chave preco pega o cadastro do novo", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await salvar(c, null, ocPayload(fx, "L9-LEG-1", "recebido"), [
          {
            id: null,
            aviamento_id: fx.avi1,
            quantidade_pedida: 10,
            quantidade_recebida: 10,
            cancelado: false,
            preco: 1,
          },
        ]);
        expect(soma(await parcelas(c, oc))).toBe(10);
        const [it] = await itens(c, oc);
        await c.query(`update ocs_aviamento_itens set preco = null where id = $1`, [it.id]); // legado (o gatilho recalcula)
        expect(soma(await parcelas(c, oc))).toBe(25); // 10 × 2,50 do cadastro
        // tela antiga (sem a chave preco) trocando o aviamento → preço do cadastro do NOVO aviamento
        await salvar(c, oc, ocPayload(fx, "L9-LEG-1", "recebido"), [
          {
            id: it.id,
            aviamento_id: fx.avi2,
            variante_aviamento_id: fx.var2a,
            quantidade_pedida: 10,
            quantidade_recebida: 10,
            cancelado: false,
          },
        ]);
        expect((await itens(c, oc))[0].preco).toBe(4);
        expect(soma(await parcelas(c, oc))).toBe(40);
      });
    });

    it("cor obrigatória: 2+ cores sem cor → recusa (item novo); 1 cor, com cor ou cancelado → ok", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        // 1 cor sem cor: ok (legado atribui à única variante)
        await salvar(c, null, ocPayload(fx, "L9-COR-1", "encomendado"), [
          {
            id: null,
            aviamento_id: fx.avi1,
            quantidade_pedida: 1,
            quantidade_recebida: null,
            cancelado: false,
          },
        ]);
        // 2 cores COM cor: ok
        const ocOk = await salvar(c, null, ocPayload(fx, "L9-COR-2", "encomendado"), [
          {
            id: null,
            aviamento_id: fx.avi2,
            variante_aviamento_id: fx.var2b,
            quantidade_pedida: 1,
            quantidade_recebida: null,
            cancelado: false,
          },
        ]);
        expect((await itens(c, ocOk))[0].variante_aviamento_id).toBe(fx.var2b);
        // 2 cores SEM cor (item novo): recusa
        const e = await erroDe(c, () =>
          salvar(c, null, ocPayload(fx, "L9-COR-3", "encomendado"), [
            {
              id: null,
              aviamento_id: fx.avi2,
              quantidade_pedida: 1,
              quantidade_recebida: null,
              cancelado: false,
            },
          ]),
        );
        expect(e.code).toBe("P0001");
        expect(e.message).toBe("oc_aviamento_cor_obrigatoria: L9 TESTE franja 2 cores");
        expect(mensagemErro(e)).toBe(
          'Escolha a cor do aviamento "L9 TESTE franja 2 cores": ele tem 2 ou mais cores cadastradas e a cor é obrigatória no item novo ou editado.',
        );
        // cancelado não exige
        await salvar(c, null, ocPayload(fx, "L9-COR-5", "encomendado"), [
          {
            id: null,
            aviamento_id: fx.avi1,
            quantidade_pedida: 1,
            quantidade_recebida: null,
            cancelado: false,
          },
          {
            id: null,
            aviamento_id: fx.avi2,
            quantidade_pedida: 1,
            quantidade_recebida: null,
            cancelado: true,
          },
        ]);
      });
    });

    it("item LEGADO sem cor (2+ cores, como a FRANJA): save sem mexer nele passa; mexer nele (qtd/preço/cor apagada) é recusado", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await salvar(c, null, ocPayload(fx, "L9-LEGCOR-1", "encomendado"), [
          {
            id: null,
            aviamento_id: fx.avi1,
            quantidade_pedida: 3,
            quantidade_recebida: null,
            cancelado: false,
          },
          {
            id: null,
            aviamento_id: fx.avi2,
            variante_aviamento_id: fx.var2a,
            quantidade_pedida: 7,
            quantidade_recebida: null,
            cancelado: false,
          },
        ]);
        const its = await itens(c, oc);
        const i1 = its.find((i) => i.aviamento_id === fx.avi1)!;
        const i2 = its.find((i) => i.aviamento_id === fx.avi2)!;
        await c.query(
          `update ocs_aviamento_itens set variante_aviamento_id = null, preco = null where id = $1`,
          [i2.id],
        ); // legado
        const legado = {
          id: i2.id,
          aviamento_id: fx.avi2,
          variante_aviamento_id: null,
          quantidade_pedida: 7,
          quantidade_recebida: null,
          cancelado: false,
        };
        const outro = {
          id: i1.id,
          aviamento_id: fx.avi1,
          quantidade_pedida: 4,
          quantidade_recebida: null,
          cancelado: false,
          preco: i1.preco,
        };
        // mexe só no OUTRO item; o legado vai como veio (preço vazio, ou o do cadastro preenchido pela tela): passa
        await salvar(c, oc, ocPayload(fx, "L9-LEGCOR-1", "encomendado"), [
          outro,
          { ...legado, preco: null },
        ]);
        await salvar(c, oc, ocPayload(fx, "L9-LEGCOR-1", "encomendado"), [
          outro,
          { ...legado, preco: 4 },
        ]);
        // mexer no legado: recusa
        for (const mexido of [
          { ...legado, quantidade_pedida: 8 },
          { ...legado, preco: 3.5 },
          { ...legado, quantidade_recebida: 7 },
        ]) {
          const e = await erroDe(c, () =>
            salvar(c, oc, ocPayload(fx, "L9-LEGCOR-1", "encomendado"), [outro, mexido]),
          );
          expect(e.message.startsWith("oc_aviamento_cor_obrigatoria:")).toBe(true);
        }
        // apagar a cor de um item que tinha cor = edição → recusa
        await c.query(`update ocs_aviamento_itens set variante_aviamento_id = $2 where id = $1`, [
          i2.id,
          fx.var2b,
        ]);
        const e = await erroDe(c, () =>
          salvar(c, oc, ocPayload(fx, "L9-LEGCOR-1", "encomendado"), [outro, legado]),
        );
        expect(e.message.startsWith("oc_aviamento_cor_obrigatoria:")).toBe(true);
        // cancelar o legado sem cor: passa
        await c.query(`update ocs_aviamento_itens set variante_aviamento_id = null where id = $1`, [
          i2.id,
        ]);
        await salvar(c, oc, ocPayload(fx, "L9-LEGCOR-1", "encomendado"), [
          outro,
          { ...legado, cancelado: true },
        ]);
      });
    });

    it("R16 complemento segue com o preço GRAVADO: tudo pago + preço da compra sobe → parcela nº 3 com a diferença", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const oc = await salvar(c, null, ocPayload(fx, "L9-COMP-1", "recebido"), [
          {
            id: null,
            aviamento_id: fx.avi1,
            quantidade_pedida: 40,
            quantidade_recebida: 40,
            cancelado: false,
            preco: 2.5,
          },
        ]);
        const ps = await parcelas(c, oc);
        expect(ps.map((p) => p.valor)).toEqual([50, 50]);
        await c.query(
          `update parcelas set status = 'pago', data_pagamento = '2026-09-20' where id = any($1::uuid[])`,
          [ps.map((p) => p.id)],
        );
        await c.query(`update aviamentos set preco = 100 where id = $1`, [fx.avi1]); // cadastro NÃO conta
        const [it] = await itens(c, oc);
        await salvar(c, oc, ocPayload(fx, "L9-COMP-1", "recebido"), [
          {
            id: it.id,
            aviamento_id: fx.avi1,
            quantidade_pedida: 40,
            quantidade_recebida: 40,
            cancelado: false,
            preco: 3,
          },
        ]);
        const depois = await parcelas(c, oc);
        expect(depois.map((p) => [p.n, p.valor, p.status])).toEqual([
          [1, 50, "pago"],
          [2, 50, "pago"],
          [3, 20, "a_pagar"], // 40 × (3,00 − 2,50)
        ]);
      });
    });

    it("correção única: prévia = contagem da correção; congela; reaplicar = no-op; a volta devolve NULL (só o não editado); recongela", async () => {
      await withTx(async (c) => {
        const fx = await prepara(c);
        const PREVIA = readFileSync(ROOT + "supabase/consultas/l9_preco_previa.sql", "utf8");
        const previa = async () => um<{ avi_congelar: string; tec_congelar: string }>(c, PREVIA);
        // fixtures com preço vazio: OC de aviamento recebida + encomendada; item de tecido de OC recebida
        const ocR = await salvar(c, null, ocPayload(fx, "L9-FIX-R", "recebido"), [
          {
            id: null,
            aviamento_id: fx.avi1,
            quantidade_pedida: 10,
            quantidade_recebida: 10,
            cancelado: false,
            preco: 2.5,
          },
        ]);
        const ocE = await salvar(c, null, ocPayload(fx, "L9-FIX-E", "encomendado"), [
          {
            id: null,
            aviamento_id: fx.avi1,
            quantidade_pedida: 3,
            quantidade_recebida: null,
            cancelado: false,
          },
          {
            id: null,
            aviamento_id: fx.avi1,
            quantidade_pedida: 4,
            quantidade_recebida: null,
            cancelado: false,
          },
        ]);
        const ids = [...(await itens(c, ocR)), ...(await itens(c, ocE))].map((i) => i.id);
        await c.query(`update ocs_aviamento_itens set preco = null where id = any($1::uuid[])`, [
          ids,
        ]);
        const tec = await um<{ id: string; p: number } | undefined>(
          c,
          `select it.id, coalesce(vt.preco, a.preco)::float8 p from ocs_tecido_itens it join ocs_tecido o on o.id = it.oc_tecido_id
           left join artigos a on a.id = it.artigo_id left join variantes_tecido vt on vt.id = it.variante_tecido_id
          where o.status = 'recebido' and o.tenant_id = $1 and coalesce(vt.preco, a.preco) is not null order by it.id limit 1`,
          [T],
        );
        if (!tec)
          throw new Error("fixture ausente: item de OC de tecido recebida com preço no cadastro");
        await c.query(`update ocs_tecido_itens set preco = null where id = $1`, [tec.id]);
        await c.query(`update aviamentos set preco = 2.75 where id = $1`, [fx.avi1]); // "preço de hoje"
        await c.query(`select public._recalcular_parcelas_core($1, 'aviamento')`, [ocR]);
        expect(soma(await parcelas(c, ocR))).toBe(27.5); // legado (vazio) segue o cadastro no recálculo

        const p1 = await previa();
        expect(Number(p1.avi_congelar)).toBeGreaterThanOrEqual(3);
        expect(Number(p1.tec_congelar)).toBeGreaterThanOrEqual(1);
        // sem as contagens aprovadas: recusa; com contagem errada: recusa
        const semGuc = await erroDe(c, () =>
          aplicarArquivo(
            c,
            "supabase/migrations/20261029110000_oc_preco_congelar_correcao_unica.sql",
          ),
        );
        expect(semGuc.message).toContain("falta SET app.l9_esperado_avi");
        await c.query(
          `select set_config('app.l9_esperado_avi', $1, true), set_config('app.l9_esperado_tec', $2, true)`,
          [String(Number(p1.avi_congelar) + 1), p1.tec_congelar],
        );
        const errada = await erroDe(c, () =>
          aplicarArquivo(
            c,
            "supabase/migrations/20261029110000_oc_preco_congelar_correcao_unica.sql",
          ),
        );
        expect(errada.message).toContain("contagem diferente da previa");

        await c.query(
          `select set_config('app.l9_esperado_avi', $1, true), set_config('app.l9_esperado_tec', $2, true)`,
          [p1.avi_congelar, p1.tec_congelar],
        );
        await aplicarArquivo(
          c,
          "supabase/migrations/20261029110000_oc_preco_congelar_correcao_unica.sql",
        );
        const congelados = async () =>
          (
            await c.query(
              `select id, preco::float8 preco from ocs_aviamento_itens where id = any($1::uuid[]) order by id`,
              [ids],
            )
          ).rows;
        expect((await congelados()).map((r) => r.preco)).toEqual([2.75, 2.75, 2.75]);
        expect(
          (
            await um<{ p: number }>(
              c,
              `select preco::float8 p from ocs_tecido_itens where id = $1`,
              [tec.id],
            )
          ).p,
        ).toBe(tec.p);
        expect(soma(await parcelas(c, ocR))).toBe(27.5);
        const p2 = await previa();
        expect([Number(p2.avi_congelar), Number(p2.tec_congelar)]).toEqual([0, 0]);

        // idempotente: de novo = no-op (cadastro muda e o congelado NÃO acompanha)
        await c.query(`update aviamentos set preco = 5 where id = $1`, [fx.avi1]);
        await aplicarArquivo(
          c,
          "supabase/migrations/20261029110000_oc_preco_congelar_correcao_unica.sql",
        );
        expect((await congelados()).map((r) => r.preco)).toEqual([2.75, 2.75, 2.75]);
        expect(soma(await parcelas(c, ocR))).toBe(27.5);

        // preço editado depois da correção fica na volta
        const editado = ids[1];
        await c.query(`update ocs_aviamento_itens set preco = 1.11 where id = $1`, [editado]);
        await aplicarArquivo(
          c,
          "supabase/rollback/20261029110000_oc_preco_congelar_correcao_unica_down.sql",
        );
        const voltou = await congelados();
        expect(voltou.find((r) => r.id === editado)?.preco).toBe(1.11);
        expect(voltou.filter((r) => r.id !== editado).map((r) => r.preco)).toEqual([null, null]);
        expect(
          (
            await um<{ p: number | null }>(
              c,
              `select preco::float8 p from ocs_tecido_itens where id = $1`,
              [tec.id],
            )
          ).p,
        ).toBeNull();
        expect(soma(await parcelas(c, ocR))).toBe(50); // legado de novo (o gatilho do item recalcula): 10 × 5,00 do cadastro
        // volta de novo = no-op
        await aplicarArquivo(
          c,
          "supabase/rollback/20261029110000_oc_preco_congelar_correcao_unica_down.sql",
        );
        // recongela pelo preço de hoje
        const p3 = await previa();
        await c.query(
          `select set_config('app.l9_esperado_avi', $1, true), set_config('app.l9_esperado_tec', $2, true)`,
          [p3.avi_congelar, p3.tec_congelar],
        );
        await aplicarArquivo(
          c,
          "supabase/migrations/20261029110000_oc_preco_congelar_correcao_unica.sql",
        );
        expect((await congelados()).filter((r) => r.id !== editado).map((r) => r.preco)).toEqual([
          5, 5,
        ]);
      });
    });
  },
);
