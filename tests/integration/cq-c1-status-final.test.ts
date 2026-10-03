// Achados MÉDIOS — release R13 (CQ; só banco). Migration 20261023100000_cq_c1_status_final.sql.
//   prod #4  [C1] vale pelo STATUS FINAL: Salvar de um CQ já confirmado com Σ da Grade Real = 0 → recusa (mesma
//            mensagem P0001 em PT, que o mensagemErro mostra como veio).
//   P-192 A  PCP (salvar_terceirizados) que zera a Grade Real com o CQ confirmado → o salvar PASSA, o CQ volta a
//            PENDENTE (Pós confirmado volta junto, [M2]) + #Erro 'cq'.
//   prod #5  CQ deixa de estar liberado com Direcionamento 'separado' → 'pendente' + #Erro 'direcionamento', em
//            modelo lançado E não lançado (antes: só rebaixava `lancado`, e saía cedo se não lançado).
// Txn revertida (BEGIN…ROLLBACK): nada é gravado. Fixture ausente = FALHA (nunca passa calado).
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { Client as PgClient } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, dbUrl, ehBancoLocal } from "./db";
import { mensagemErro } from "@/lib/erro-mensagem";

const TAM = "38";
const MSG_C1 = "Conte ao menos uma peça no Recebimento antes de confirmar o Controle de Qualidade.";

type Setup = { cadId: string; modeloId: string; vnum: number; vid: string };

/** CAD "limpo" do tenant teste (tecido principal + variante, com modelo, sem serviço e sem CQ). Sem fixture → FALHA. */
async function cadLimpo(c: Client, pular = 0): Promise<Setup> {
  const cad = await um<
    { cad_id: string; modelo_id: string; vnum: number; vid: string } | undefined
  >(
    c,
    `select c.id as cad_id, c.modelo_id, ctv.ordem as vnum, ctv.variante_tecido_id as vid
       from cad c
       join cad_tecidos ct on ct.cad_id = c.id and ct.tipo='tecido' and ct.numero=1
       join cad_tecido_variantes ctv on ctv.cad_tecido_id = ct.id
      where c.tenant_id=$1 and c.modelo_id is not null
        and not exists (select 1 from producao_terceirizados pt where pt.cad_id=c.id)
        and not exists (select 1 from controle_qualidade q where q.cad_id=c.id)
        and not exists (select 1 from direcionamento d where d.cad_id=c.id)
        and not exists (select 1 from direcionamento_lojas dl where dl.cad_id=c.id)
      order by c.id, ctv.ordem
      offset $2 limit 1`,
    [TENANT_TESTE, pular],
  );
  if (!cad)
    throw new Error(
      "fixture ausente: nenhum CAD limpo (tecido principal + variante, sem servico/CQ) na Loja Teste",
    );
  return { cadId: cad.cad_id, modeloId: cad.modelo_id, vnum: cad.vnum, vid: cad.vid };
}

/** Cria (via salvar_terceirizados, como o PCP) o bloco-fonte de confecção destrinchado com a recebida dada. */
async function criarFonte(
  c: Client,
  s: Setup,
  recebida: number,
): Promise<{ catId: string; blocoId: string }> {
  const cat = await um<{ id: string }>(
    c,
    `insert into categorias_terceirizado (tenant_id, nome, ativo) values ($1,'Oficina Teste R13',true) returning id`,
    [TENANT_TESTE],
  );
  const blocos = JSON.stringify([
    {
      categoria_terceirizado_id: cat.id,
      ativo: true,
      detalhado: true,
      grade_detalhe: { [s.vid]: { [TAM]: { recebida } } },
    },
  ]);
  await c.query(`select salvar_terceirizados($1,$2::jsonb,null)`, [s.cadId, blocos]);
  const fonte = await um<{ f: string | null }>(c, `select _resolver_fonte_confeccao($1) f`, [
    s.cadId,
  ]);
  if (!fonte?.f)
    throw new Error(
      "fixture: o bloco criado nao virou bloco-fonte (_resolver_fonte_confeccao nulo)",
    );
  return { catId: cat.id, blocoId: fonte.f };
}

function payloadRecebido(s: Setup, n: number) {
  return {
    variantes: JSON.stringify([
      { variante_numero: s.vnum, etapa: "recebimento", grades: { [TAM]: n }, grade_total: n },
    ]),
    reais: JSON.stringify([{ variante_numero: s.vnum, grades: { [TAM]: n }, grade_total: n }]),
  };
}

async function confirmarCq(c: Client, s: Setup, n: number) {
  const p = payloadRecebido(s, n);
  const r = await um<{ r: { status: string } }>(
    c,
    `select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,true) r`,
    [s.cadId, p.variantes, p.reais],
  );
  expect(r.r.status).toBe("confirmado");
}

async function cqDe(c: Client, cadId: string) {
  return um<{
    status: string;
    status_pos: string | null;
    confirmado_at: string | null;
    confirmado_pos_at: string | null;
  }>(
    c,
    `select status, status_pos, confirmado_at, confirmado_pos_at from controle_qualidade where cad_id=$1`,
    [cadId],
  );
}

async function revisao(c: Client, modeloId: string) {
  const r = await um<{ rp: Record<string, boolean> | null; lancado: boolean }>(
    c,
    `select revisao_pendente rp, coalesce(lancado,false) lancado from modelos where id=$1`,
    [modeloId],
  );
  return { rp: r.rp ?? {}, lancado: r.lancado };
}

/** Executa e devolve o erro do Postgres (falha o teste se NÃO der erro). */
async function erroDe(p: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await p;
  } catch (e: unknown) {
    const pe = e as { code?: string; message?: string };
    return { code: String(pe.code), message: String(pe.message) };
  }
  throw new Error("esperava recusa, mas a chamada passou");
}

describe.skipIf(!hasDb)("R13 prod #4 — [C1] pelo status FINAL (_salvar_cq_core)", () => {
  it("com fonte: Salvar (sem Confirmar) de um CQ confirmado zerando o Recebimento → recusa P0001 com a mensagem em PT, legível pelo mensagemErro", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await cadLimpo(c);
      await criarFonte(c, s, 10);
      await confirmarCq(c, s, 10);
      const zero = payloadRecebido(s, 0);
      await c.query("savepoint a");
      const err = await erroDe(
        c.query(`select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,false)`, [
          s.cadId,
          zero.variantes,
          zero.reais,
        ]),
      );
      await c.query("rollback to savepoint a");
      expect(err.code).toBe("P0001");
      expect(err.message).toBe(MSG_C1);
      // a tela recebe {code,message} do PostgREST (P0001 = 400) e o mensagemErro mostra a própria mensagem
      expect(
        mensagemErro(
          { code: err.code, message: err.message, details: null, hint: null },
          "Erro ao salvar",
        ),
      ).toBe(MSG_C1);
      expect(MSG_C1.length).toBeLessThanOrEqual(120); // cabe no toast
      // nada mudou: CQ segue confirmado e a Grade Real segue 10
      expect((await cqDe(c, s.cadId)).status).toBe("confirmado");
      const real = await um<{ v: number }>(
        c,
        `select coalesce((grades_reais->>$2)::int,0) v from cad_grades where cad_id=$1 and variante_numero=$3`,
        [s.cadId, TAM, s.vnum],
      );
      expect(real.v).toBe(10);
    });
  });

  it("sem fonte: Salvar de um CQ confirmado com _reais Σ=0 → recusa; com Σ>0 passa e segue confirmado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await cadLimpo(c);
      expect(
        (await um<{ f: string | null }>(c, `select _resolver_fonte_confeccao($1) f`, [s.cadId])).f,
      ).toBeNull();
      await confirmarCq(c, s, 5);
      const zero = payloadRecebido(s, 0);
      await c.query("savepoint a");
      const err = await erroDe(
        c.query(`select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,false)`, [
          s.cadId,
          zero.variantes,
          zero.reais,
        ]),
      );
      await c.query("rollback to savepoint a");
      expect(err.code).toBe("P0001");
      expect(err.message).toBe(MSG_C1);
      const tres = payloadRecebido(s, 3);
      const r = await um<{ r: { status: string } }>(
        c,
        `select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,false) r`,
        [s.cadId, tres.variantes, tres.reais],
      );
      expect(r.r.status).toBe("confirmado");
    });
  });

  it("CQ NÃO confirmado: Salvar com Σ=0 continua livre (rascunho pendente)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await cadLimpo(c);
      const zero = payloadRecebido(s, 0);
      const r = await um<{ r: { status: string } }>(
        c,
        `select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,false) r`,
        [s.cadId, zero.variantes, zero.reais],
      );
      expect(r.r.status).toBe("pendente");
    });
  });
});

describe.skipIf(!hasDb)(
  "R13 P-192 A — PCP zera a Grade Real com o CQ confirmado (salvar_terceirizados)",
  () => {
    it("o salvar PASSA; o CQ volta a pendente (Pós confirmado volta junto) + #Erro 'cq'; Grade Real = 0", async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        const s = await cadLimpo(c);
        const { catId, blocoId } = await criarFonte(c, s, 10);
        await confirmarCq(c, s, 10);
        // Pós confirmado (o [M2] diz que ele se apoia na Grade Real do Pré)
        await c.query(
          `update controle_qualidade set status_pos='confirmado', confirmado_pos_at=now() where cad_id=$1`,
          [s.cadId],
        );
        const antes = await revisao(c, s.modeloId);
        expect(antes.rp.cq ?? false).toBe(false);
        const blocos = JSON.stringify([
          {
            id: blocoId,
            categoria_terceirizado_id: catId,
            ativo: true,
            detalhado: true,
            grade_detalhe: { [s.vid]: { [TAM]: { recebida: 0 } } },
          },
        ]);
        await c.query(`select salvar_terceirizados($1,$2::jsonb,null)`, [s.cadId, blocos]); // NÃO recusa
        const real = await um<{ v: number }>(
          c,
          `select coalesce((grades_reais->>$2)::int,0) v from cad_grades where cad_id=$1 and variante_numero=$3`,
          [s.cadId, TAM, s.vnum],
        );
        expect(real.v).toBe(0);
        const cq = await cqDe(c, s.cadId);
        expect(cq.status).toBe("pendente");
        expect(cq.confirmado_at).toBeNull();
        expect(cq.status_pos).toBe("pendente");
        expect(cq.confirmado_pos_at).toBeNull();
        expect((await revisao(c, s.modeloId)).rp.cq).toBe(true);
        // recebida gravada no bloco (o PCP salvou de verdade)
        const blk = await um<{ q: number }>(
          c,
          `select quantidade_recebida q from producao_terceirizados where id=$1`,
          [blocoId],
        );
        expect(blk.q ?? 0).toBe(0);
      });
    });

    it("PCP reduz a recebida mas Σ>0: CQ segue confirmado e sem #Erro 'cq' (só a Grade Real acompanha)", async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        const s = await cadLimpo(c);
        const { catId, blocoId } = await criarFonte(c, s, 10);
        await confirmarCq(c, s, 10);
        const blocos = JSON.stringify([
          {
            id: blocoId,
            categoria_terceirizado_id: catId,
            ativo: true,
            detalhado: true,
            grade_detalhe: { [s.vid]: { [TAM]: { recebida: 4 } } },
          },
        ]);
        await c.query(`select salvar_terceirizados($1,$2::jsonb,null)`, [s.cadId, blocos]);
        expect((await cqDe(c, s.cadId)).status).toBe("confirmado");
        expect((await revisao(c, s.modeloId)).rp.cq ?? false).toBe(false);
        const real = await um<{ v: number }>(
          c,
          `select coalesce((grades_reais->>$2)::int,0) v from cad_grades where cad_id=$1 and variante_numero=$3`,
          [s.cadId, TAM, s.vnum],
        );
        expect(real.v).toBe(4);
      });
    });

    it("CQ NÃO confirmado: PCP zerar a recebida não mexe no CQ nem acende #Erro 'cq'", async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        const s = await cadLimpo(c);
        const { catId, blocoId } = await criarFonte(c, s, 10);
        const zero = payloadRecebido(s, 10);
        await c.query(`select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,false)`, [
          s.cadId,
          zero.variantes,
          zero.reais,
        ]);
        const blocos = JSON.stringify([
          {
            id: blocoId,
            categoria_terceirizado_id: catId,
            ativo: true,
            detalhado: true,
            grade_detalhe: { [s.vid]: { [TAM]: { recebida: 0 } } },
          },
        ]);
        await c.query(`select salvar_terceirizados($1,$2::jsonb,null)`, [s.cadId, blocos]);
        expect((await cqDe(c, s.cadId)).status).toBe("pendente");
        expect((await revisao(c, s.modeloId)).rp.cq ?? false).toBe(false);
      });
    });
  },
);

describe.skipIf(!hasDb)("R13 — Pós segue igual", () => {
  it("Salvar do Pré confirmado com Σ>0 não mexe no status_pos; salvar_cq_pos sem confirmar mantém o Pós confirmado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await cadLimpo(c);
      await confirmarCq(c, s, 5);
      await c.query(
        `update controle_qualidade set status_pos='confirmado', confirmado_pos_at=now() where cad_id=$1`,
        [s.cadId],
      );
      const p = payloadRecebido(s, 5);
      await c.query(`select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,false)`, [
        s.cadId,
        p.variantes,
        p.reais,
      ]);
      expect((await cqDe(c, s.cadId)).status_pos).toBe("confirmado");
      // (leves L6, "R13 Pós [C1]") o Salvar de um Pós confirmado agora exige Σ > 0 (o [C1] vale pelo status final;
      // com '[]' seria recusado — coberto em leves-l6-cq-falta.test.ts): salva com 1 peça num bloco do cad.
      const pt = await um<{ id: string }>(
        c,
        `insert into producao_terceirizados (cad_id, ativo) values ($1, true) returning id`,
        [s.cadId],
      );
      const itens = JSON.stringify([
        { producao_terceirizado_id: pt.id, variante_numero: s.vnum, etapa: "acabamento", grades: { [TAM]: 1 } },
      ]);
      const r = await um<{ r: { status_pos: string } }>(
        c,
        `select salvar_cq_pos($1,'{}'::jsonb,$2::jsonb,false) r`,
        [s.cadId, itens],
      );
      expect(r.r.status_pos).toBe("confirmado");
    });
  });

  it("as funções do Pós ficam INTOCADAS (md5)", async () => {
    await withTx(async (c) => {
      const { rows } = await c.query(
        `select s, md5(pg_get_functiondef(to_regprocedure(s))) m from unnest($1::text[]) s`,
        [
          [
            "public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean)",
            "public._desmarcar_cq_pos_core(uuid)",
            "public._desmarcar_cq_core(uuid)",
          ],
        ],
      );
      const m = Object.fromEntries(rows.map((r: { s: string; m: string }) => [r.s, r.m]));
      // b68afafc = texto de antes (intocado pela R13); 677a4272 = leves L6 ("R13 Pós [C1]", 20261028110000)
      expect(["b68afafc8dfa6b71e94876e4f6665f10", "677a4272cdb2232e06c953af7d073b33"]).toContain(
        m["public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean)"],
      );
      expect(m["public._desmarcar_cq_pos_core(uuid)"]).toBe("df41670f6a4be90c60430c051fc5ffe8");
      expect(m["public._desmarcar_cq_core(uuid)"]).toBe("47888f082026a4f87d0761427af28448");
    });
  });
});

describe.skipIf(!hasDb)(
  "R13 prod #5 — CQ deixa de estar liberado → Direcionamento separado rebaixa",
  () => {
    /** Monta: CQ confirmado (sem fonte, Grade Real = planejada → desmarcar não muda a grade, isolando o gatilho do CQ)
     *  + Direcionamento 'separado' com linha no modelo NOVO (direcionamento_lojas) ou no LEGADO (direcionamento). */
    async function montarSeparado(
      c: Client,
      pular: number,
      lancado: boolean,
      tabela: "novo" | "legado",
    ): Promise<Setup> {
      const s = await cadLimpo(c, pular);
      await confirmarCq(c, s, 5);
      await c.query(
        `update cad_grades set grades_planejadas = grades_reais, grade_total_planejada = grade_total_real where cad_id=$1`,
        [s.cadId],
      );
      if (tabela === "novo") {
        const loja = await um<{ id: string } | undefined>(
          c,
          `select id from lojas_direcionamento where tenant_id=$1 order by ordem nulls last, id limit 1`,
          [TENANT_TESTE],
        );
        if (!loja) throw new Error("fixture ausente: nenhuma loja de direcionamento na Loja Teste");
        await c.query(
          `insert into direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades) values ($1,$2,$3,$4,$5::jsonb)`,
          [TENANT_TESTE, s.cadId, loja.id, s.vnum, JSON.stringify({ [TAM]: 5 })],
        );
      } else {
        await c.query(
          `insert into direcionamento (tenant_id, cad_id, variante_numero, ecommerce, ecommerce_total) values ($1,$2,$3,$4::jsonb,5)`,
          [TENANT_TESTE, s.cadId, s.vnum, JSON.stringify({ [TAM]: 5 })],
        );
      }
      await c.query(
        `update cad set direcionamento_status='separado', direcionamento_confirmado_at=now() where id=$1`,
        [s.cadId],
      );
      await c.query(
        `update modelos set lancado=$2, revisao_pendente = coalesce(revisao_pendente,'{}'::jsonb) - 'direcionamento' - 'lancamentos' where id=$1`,
        [s.modeloId, lancado],
      );
      const liberado = await um<{ l: boolean }>(c, `select _cq_liberado($1) l`, [s.cadId]);
      expect(liberado.l).toBe(true);
      return s;
    }

    for (const caso of [
      {
        nome: "modelo LANÇADO (direcionamento_lojas)",
        lancado: true,
        tabela: "novo" as const,
        pular: 0,
      },
      {
        nome: "modelo NÃO lançado (direcionamento_lojas)",
        lancado: false,
        tabela: "novo" as const,
        pular: 1,
      },
      {
        nome: "modelo NÃO lançado (direcionamento legado)",
        lancado: false,
        tabela: "legado" as const,
        pular: 2,
      },
    ]) {
      it(`desmarcar o Pré → direcionamento 'pendente' + #Erro 'direcionamento' — ${caso.nome}`, async () => {
        await withTx(async (c) => {
          await comoUsuario(c);
          const s = await montarSeparado(c, caso.pular, caso.lancado, caso.tabela);
          await c.query(`select desmarcar_cq($1)`, [s.cadId]);
          const cad = await um<{ st: string; at: string | null }>(
            c,
            `select direcionamento_status st, direcionamento_confirmado_at at from cad where id=$1`,
            [s.cadId],
          );
          expect(cad.st).toBe("pendente");
          expect(cad.at).toBeNull();
          const r = await revisao(c, s.modeloId);
          expect(r.rp.direcionamento).toBe(true);
          expect(r.lancado).toBe(false);
          expect(r.rp.lancamentos ?? false).toBe(caso.lancado); // lançado: segue rebaixando como antes
          // grade real não mudou → quem rebaixou foi o gatilho do CQ (não o da grade)
          const g = await um<{ igual: boolean }>(
            c,
            `select bool_and(grades_reais = grades_planejadas) igual from cad_grades where cad_id=$1`,
            [s.cadId],
          );
          expect(g.igual).toBe(true);
        });
      });
    }

    it("Pós ativo: desmarcar o Pós (Pré segue confirmado) também rebaixa o Direcionamento separado", async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        const s = await cadLimpo(c, 3);
        await confirmarCq(c, s, 5);
        const cat = await um<{ id: string }>(
          c,
          `insert into categorias_terceirizado (tenant_id, nome, ativo, etapa) values ($1,'Lavanderia Teste R13',true,'pos_costura') returning id`,
          [TENANT_TESTE],
        );
        await c.query(
          `insert into producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, ativo) values ($1,$2,$3,true)`,
          [s.cadId, TENANT_TESTE, cat.id],
        );
        await c.query(
          `update controle_qualidade set status_pos='confirmado', confirmado_pos_at=now() where cad_id=$1`,
          [s.cadId],
        );
        await c.query(
          `insert into direcionamento (tenant_id, cad_id, variante_numero) values ($1,$2,$3)`,
          [TENANT_TESTE, s.cadId, s.vnum],
        );
        await c.query(
          `update cad set direcionamento_status='separado', direcionamento_confirmado_at=now() where id=$1`,
          [s.cadId],
        );
        expect((await um<{ l: boolean }>(c, `select _cq_liberado($1) l`, [s.cadId])).l).toBe(true);
        await c.query(`select desmarcar_cq_pos($1)`, [s.cadId]);
        expect((await cqDe(c, s.cadId)).status).toBe("confirmado");
        expect(
          (
            await um<{ st: string }>(c, `select direcionamento_status st from cad where id=$1`, [
              s.cadId,
            ])
          ).st,
        ).toBe("pendente");
        expect((await revisao(c, s.modeloId)).rp.direcionamento).toBe(true);
      });
    });

    it("CQ segue liberado (Salvar do Pré confirmado com Σ>0): Direcionamento separado NÃO rebaixa", async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        const s = await montarSeparado(c, 0, false, "novo");
        const p = payloadRecebido(s, 5);
        await c.query(`select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,false)`, [
          s.cadId,
          p.variantes,
          p.reais,
        ]);
        expect(
          (
            await um<{ st: string }>(c, `select direcionamento_status st from cad where id=$1`, [
              s.cadId,
            ])
          ).st,
        ).toBe("separado");
        expect((await revisao(c, s.modeloId)).rp.direcionamento ?? false).toBe(false);
      });
    });
  },
);

describe.skipIf(!hasDb)("R13 — md5 + ACL (guarda da migration 20261023100000)", () => {
  it("as 3 funções estão no texto da R13, _aplicar_reais_do_grade_detalhe intocada, ACLs de hoje, gatilho ligado", async () => {
    await withTx(async (c) => {
      const esperado: Record<string, { md5: string; acl: string }> = {
        "public._salvar_cq_core(uuid,jsonb,jsonb,jsonb,boolean,jsonb)": {
          md5: "3e8dc987ed35806afbad8cece86562f0",
          acl: "{postgres=X/postgres,service_role=X/postgres}",
        },
        "public.salvar_terceirizados(uuid,jsonb,text,jsonb)": {
          md5: "e5a6f830516e463911529664a4940883",
          acl: "{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
        },
        "public.fn_rebaixa_lancado_cq()": {
          md5: "4aea9a4ec6083c8445ac86e92f88b049",
          acl: "{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}",
        },
        "public._aplicar_reais_do_grade_detalhe(uuid,uuid)": {
          md5: "00f804865d9ad71c41c37351dc06178c",
          acl: "{postgres=X/postgres,service_role=X/postgres}",
        },
        // fix round 1 (L2): chamada pelo gatilho; intocada
        "public._cq_liberado(uuid)": {
          md5: "55a5f7ad704a061087e0fc154d4605e7",
          acl: "{postgres=X/postgres,service_role=X/postgres}",
        },
      };
      for (const [sig, e] of Object.entries(esperado)) {
        const r = await um<{
          m: string | null;
          acl: string[] | null;
          anon: boolean;
          auth: boolean;
          pub: boolean;
        }>(
          c,
          `select md5(pg_get_functiondef(p.oid)) m,
                  array(select a::text from unnest(p.proacl) a) acl,
                  has_function_privilege('anon', p.oid, 'EXECUTE') anon,
                  has_function_privilege('authenticated', p.oid, 'EXECUTE') auth,
                  exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                           where x.grantee = 0 and x.privilege_type = 'EXECUTE') pub
             from pg_proc p where p.oid = to_regprocedure($1)`,
          [sig],
        );
        expect(r, `${sig} existe`).toBeDefined();
        expect(r.m, `${sig} md5`).toBe(e.md5);
        // ACL como CONJUNTO (a ordem dos aclitems difere entre a cópia e a produção; o conteúdo é o mesmo)
        const conj = (x: string) =>
          x
            .replace(/^\{|\}$/g, "")
            .split(",")
            .sort()
            .join(",");
        // Reforço de segurança S1 (20261031130000, ANON-2): funções de GATILHO DEFINER perderam o EXECUTE de PUBLIC/anon/authenticated
        const aclS1 = sig === "public.fn_rebaixa_lancado_cq()" ? "{postgres=X/postgres,service_role=X/postgres}" : null;
        expect([conj(e.acl), ...(aclS1 ? [conj(aclS1)] : [])], `${sig} acl`).toContain([...(r.acl ?? [])].sort().join(","));
        if (sig.startsWith("public._")) {
          expect(r.anon || r.auth || r.pub, `${sig} sem PUBLIC/anon/authenticated (inv. #9)`).toBe(
            false,
          );
        }
        if (sig.startsWith("public.salvar_terceirizados")) {
          expect(r.auth).toBe(true);
          expect(r.anon || r.pub).toBe(false);
        }
      }
      const t = await um<{ n: number }>(
        c,
        `select count(*)::int n from pg_trigger t
          where t.tgname='trg_rebaixa_lancado_cq' and t.tgrelid = to_regclass('public.controle_qualidade')
            and t.tgfoid = to_regprocedure('public.fn_rebaixa_lancado_cq()') and t.tgenabled='O'`,
      );
      expect(t.n).toBe(1);
    });
  });
});

// ───────────────────────── fix round 1 (G-MIGRATION L1/L2/L5) ─────────────────────────

/** CAD limpo com >= 2 variantes no tecido principal. Sem fixture → FALHA. */
async function cadDuasVariantes(
  c: Client,
): Promise<{ cadId: string; modeloId: string; v: { num: number; vid: string }[] }> {
  const r = await um<
    { cad_id: string; modelo_id: string; vs: { num: number; vid: string }[] } | undefined
  >(
    c,
    `select c.id as cad_id, c.modelo_id,
            jsonb_agg(jsonb_build_object('num', ctv.ordem, 'vid', ctv.variante_tecido_id) order by ctv.ordem) as vs
       from cad c
       join cad_tecidos ct on ct.cad_id = c.id and ct.tipo='tecido' and ct.numero=1
       join cad_tecido_variantes ctv on ctv.cad_tecido_id = ct.id
      where c.tenant_id=$1 and c.modelo_id is not null
        and not exists (select 1 from producao_terceirizados pt where pt.cad_id=c.id)
        and not exists (select 1 from controle_qualidade q where q.cad_id=c.id)
        and not exists (select 1 from direcionamento d where d.cad_id=c.id)
        and not exists (select 1 from direcionamento_lojas dl where dl.cad_id=c.id)
      group by c.id, c.modelo_id
     having count(distinct ctv.ordem) >= 2
      order by c.id limit 1`,
    [TENANT_TESTE],
  );
  if (!r)
    throw new Error(
      "fixture ausente: nenhum CAD limpo com >= 2 variantes no tecido principal (Loja Teste)",
    );
  return { cadId: r.cad_id, modeloId: r.modelo_id, v: r.vs.slice(0, 2) };
}

describe.skipIf(!hasDb)(
  "R13 fix round 1 — L5: P-192 em cadeia, multi-variante e Pós já pendente",
  () => {
    it("PCP zera com o modelo LANÇADO e Direcionamento separado → CQ pendente → lançado=false + #Erro lancamentos; Direcionamento pendente + #Erro", async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        const s = await cadLimpo(c);
        const { catId, blocoId } = await criarFonte(c, s, 10);
        await confirmarCq(c, s, 10);
        const loja = await um<{ id: string } | undefined>(
          c,
          `select id from lojas_direcionamento where tenant_id=$1 order by ordem nulls last, id limit 1`,
          [TENANT_TESTE],
        );
        if (!loja) throw new Error("fixture ausente: nenhuma loja de direcionamento na Loja Teste");
        await c.query(
          `insert into direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades) values ($1,$2,$3,$4,$5::jsonb)`,
          [TENANT_TESTE, s.cadId, loja.id, s.vnum, JSON.stringify({ [TAM]: 10 })],
        );
        await c.query(
          `update cad set direcionamento_status='separado', direcionamento_confirmado_at=now() where id=$1`,
          [s.cadId],
        );
        await c.query(
          `update modelos set lancado=true, revisao_pendente = coalesce(revisao_pendente,'{}'::jsonb) - 'direcionamento' - 'lancamentos' - 'cq' where id=$1`,
          [s.modeloId],
        );
        expect((await um<{ l: boolean }>(c, `select _cq_liberado($1) l`, [s.cadId])).l).toBe(true);
        const blocos = JSON.stringify([
          {
            id: blocoId,
            categoria_terceirizado_id: catId,
            ativo: true,
            detalhado: true,
            grade_detalhe: { [s.vid]: { [TAM]: { recebida: 0 } } },
          },
        ]);
        await c.query(`select salvar_terceirizados($1,$2::jsonb,null)`, [s.cadId, blocos]);
        expect((await cqDe(c, s.cadId)).status).toBe("pendente");
        const r = await revisao(c, s.modeloId);
        expect(r.lancado).toBe(false);
        expect(r.rp.cq).toBe(true);
        expect(r.rp.lancamentos).toBe(true);
        expect(r.rp.direcionamento).toBe(true);
        const cad = await um<{ st: string; at: string | null }>(
          c,
          `select direcionamento_status st, direcionamento_confirmado_at at from cad where id=$1`,
          [s.cadId],
        );
        expect(cad.st).toBe("pendente");
        expect(cad.at).toBeNull();
      });
    });

    it("2 variantes: zerar UMA (a outra > 0) mantém o CQ confirmado; zerar AS DUAS rebaixa", async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        const m = await cadDuasVariantes(c);
        const [a, b] = m.v;
        const cat = await um<{ id: string }>(
          c,
          `insert into categorias_terceirizado (tenant_id, nome, ativo) values ($1,'Oficina Teste R13 MV',true) returning id`,
          [TENANT_TESTE],
        );
        const gd = (ra: number, rb: number) => ({
          [a.vid]: { [TAM]: { recebida: ra } },
          [b.vid]: { [TAM]: { recebida: rb } },
        });
        await c.query(`select salvar_terceirizados($1,$2::jsonb,null)`, [
          m.cadId,
          JSON.stringify([
            {
              categoria_terceirizado_id: cat.id,
              ativo: true,
              detalhado: true,
              grade_detalhe: gd(4, 6),
            },
          ]),
        ]);
        const fonte = await um<{ f: string | null }>(c, `select _resolver_fonte_confeccao($1) f`, [
          m.cadId,
        ]);
        if (!fonte?.f) throw new Error("fixture: bloco nao virou fonte");
        const variantes = JSON.stringify([
          { variante_numero: a.num, etapa: "recebimento", grades: { [TAM]: 4 }, grade_total: 4 },
          { variante_numero: b.num, etapa: "recebimento", grades: { [TAM]: 6 }, grade_total: 6 },
        ]);
        const r1 = await um<{ r: { status: string } }>(
          c,
          `select salvar_cq($1,'{}'::jsonb,$2::jsonb,'[]'::jsonb,true) r`,
          [m.cadId, variantes],
        );
        expect(r1.r.status).toBe("confirmado");
        const bloco = (ra: number, rb: number) =>
          JSON.stringify([
            {
              id: fonte.f,
              categoria_terceirizado_id: cat.id,
              ativo: true,
              detalhado: true,
              grade_detalhe: gd(ra, rb),
            },
          ]);
        await c.query(`select salvar_terceirizados($1,$2::jsonb,null)`, [m.cadId, bloco(0, 6)]);
        expect((await cqDe(c, m.cadId)).status).toBe("confirmado");
        expect((await revisao(c, m.modeloId)).rp.cq ?? false).toBe(false);
        const reais = await um<{ t: number }>(
          c,
          `select coalesce(sum(grade_total_real),0)::int t from cad_grades where cad_id=$1 and variante_numero = any($2::int[])`,
          [m.cadId, [a.num, b.num]],
        );
        expect(reais.t).toBe(6);
        await c.query(`select salvar_terceirizados($1,$2::jsonb,null)`, [m.cadId, bloco(0, 0)]);
        expect((await cqDe(c, m.cadId)).status).toBe("pendente");
        expect((await revisao(c, m.modeloId)).rp.cq).toBe(true);
      });
    });

    it("Pós JÁ pendente: PCP zera → Pré vai a pendente, Pós continua pendente (confirmado_pos_at intocado) + #Erro 'cq'", async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        const s = await cadLimpo(c);
        const { catId, blocoId } = await criarFonte(c, s, 10);
        await confirmarCq(c, s, 10);
        await c.query(
          `update controle_qualidade set status_pos='pendente', confirmado_pos_at=null where cad_id=$1`,
          [s.cadId],
        );
        const blocos = JSON.stringify([
          {
            id: blocoId,
            categoria_terceirizado_id: catId,
            ativo: true,
            detalhado: true,
            grade_detalhe: { [s.vid]: { [TAM]: { recebida: 0 } } },
          },
        ]);
        await c.query(`select salvar_terceirizados($1,$2::jsonb,null)`, [s.cadId, blocos]);
        const cq = await cqDe(c, s.cadId);
        expect(cq.status).toBe("pendente");
        expect(cq.status_pos).toBe("pendente");
        expect(cq.confirmado_pos_at).toBeNull();
        expect((await revisao(c, s.modeloId)).rp.cq).toBe(true);
      });
    });
  },
);

describe.skipIf(!hasDb)(
  "R13 fix round 1 — L2: bloco pós com ativo NULL conta como pós (mesmo predicado do _cq_liberado)",
  () => {
    it("desmarcar o Pós com bloco pós-costura de ativo NULL → Direcionamento separado vai a pendente + #Erro", async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        const s = await cadLimpo(c, 4);
        await confirmarCq(c, s, 5);
        const cat = await um<{ id: string }>(
          c,
          `insert into categorias_terceirizado (tenant_id, nome, ativo, etapa) values ($1,'Lavanderia Teste R13 NULL',true,'pos_costura') returning id`,
          [TENANT_TESTE],
        );
        // (leves L6, prod #11 — 20261028100000) com producao_terceirizados.ativo NOT NULL o caso "ativo NULL" deixou de
        // existir na origem: o insert é recusado (23502) e o cenário abaixo não se aplica mais.
        const notNull = await um<{ n: boolean }>(
          c,
          `select a.attnotnull n from pg_attribute a where a.attrelid='public.producao_terceirizados'::regclass and a.attname='ativo'`,
        );
        if (notNull.n) {
          await c.query("savepoint l6_nn");
          const err = await erroDe(
            c.query(
              `insert into producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, ativo) values ($1,$2,$3,NULL)`,
              [s.cadId, TENANT_TESTE, cat.id],
            ),
          );
          expect(err.code).toBe("23502");
          await c.query("rollback to savepoint l6_nn");
          return;
        }
        await c.query(
          `insert into producao_terceirizados (cad_id, tenant_id, categoria_terceirizado_id, ativo) values ($1,$2,$3,NULL)`,
          [s.cadId, TENANT_TESTE, cat.id],
        );
        await c.query(
          `update controle_qualidade set status_pos='confirmado', confirmado_pos_at=now() where cad_id=$1`,
          [s.cadId],
        );
        await c.query(
          `insert into direcionamento (tenant_id, cad_id, variante_numero) values ($1,$2,$3)`,
          [TENANT_TESTE, s.cadId, s.vnum],
        );
        await c.query(
          `update cad set direcionamento_status='separado', direcionamento_confirmado_at=now() where id=$1`,
          [s.cadId],
        );
        // pré-condição: o bloco de ativo NULL É contado pelo _cq_liberado (Pós exigido e confirmado → liberado)
        expect((await um<{ l: boolean }>(c, `select _cq_liberado($1) l`, [s.cadId])).l).toBe(true);
        await c.query(`select desmarcar_cq_pos($1)`, [s.cadId]);
        expect((await um<{ l: boolean }>(c, `select _cq_liberado($1) l`, [s.cadId])).l).toBe(false);
        expect(
          (
            await um<{ st: string }>(c, `select direcionamento_status st from cad where id=$1`, [
              s.cadId,
            ])
          ).st,
        ).toBe("pendente");
        expect((await revisao(c, s.modeloId)).rp.direcionamento).toBe(true);
      });
    });
  },
);

describe.skipIf(!hasDb || !ehBancoLocal())(
  "R13 fix round 1 — L1: salvar_terceirizados trava o CQ ANTES dos blocos (só cópia local)",
  () => {
    it("com o CQ travado por outra transação, o PCP espera no CQ sem ter tocado o bloco (ordem CQ → bloco, igual às RPCs do CQ)", async () => {
      const a = new PgClient({ connectionString: dbUrl()!, ssl: false });
      const b = new PgClient({ connectionString: dbUrl()!, ssl: false });
      await a.connect();
      await b.connect();
      try {
        // fixture JÁ gravada (2 conexões não veem dado de txn alheia): cad da Loja Teste com CQ e >= 1 bloco
        const fx = await um<{ cad_id: string; blocos: unknown } | undefined>(
          a,
          `select q.cad_id,
                (select jsonb_agg(jsonb_build_object('id', pt.id, 'categoria_terceirizado_id', pt.categoria_terceirizado_id,
                         'ativo', coalesce(pt.ativo, true), 'detalhado', coalesce(pt.detalhado, false),
                         'grade_detalhe', coalesce(pt.grade_detalhe, '{}'::jsonb)))
                   from producao_terceirizados pt where pt.cad_id = q.cad_id) as blocos
           from controle_qualidade q
          where q.tenant_id = $1 and exists (select 1 from producao_terceirizados pt where pt.cad_id = q.cad_id)
          order by q.cad_id limit 1`,
          [TENANT_TESTE],
        );
        if (!fx)
          throw new Error("fixture ausente: nenhum cad da Loja Teste com CQ e bloco de servico");
        await a.query("BEGIN");
        await a.query(`select 1 from controle_qualidade where cad_id=$1 for update`, [fx.cad_id]);
        await b.query("BEGIN");
        await comoUsuario(b);
        await b.query("SET LOCAL lock_timeout = '2000ms'");
        const bPid = (await um<{ pid: number }>(b, `select pg_backend_pid() pid`)).pid;
        const pcp = b
          .query(`select salvar_terceirizados($1,$2::jsonb,null)`, [
            fx.cad_id,
            JSON.stringify(fx.blocos),
          ])
          .then(
            () => ({ ok: true as const, code: "" }),
            (e: { code?: string }) => ({ ok: false as const, code: String(e.code) }),
          );
        // espera o PCP ficar parado numa trava
        let esperando = false;
        for (let i = 0; i < 30 && !esperando; i++) {
          await new Promise((r) => setTimeout(r, 50));
          const w = await um<{ w: string | null }>(
            a,
            `select wait_event_type w from pg_stat_activity where pid=$1`,
            [bPid],
          );
          esperando = w?.w === "Lock";
        }
        expect(esperando, "o PCP devia estar esperando a trava do CQ").toBe(true);
        // enquanto espera, os blocos do cad estão LIVRES (o PCP ainda não tocou nenhum)
        await a.query(`select 1 from producao_terceirizados where cad_id=$1 for update nowait`, [
          fx.cad_id,
        ]);
        const res = await pcp;
        expect(res.ok).toBe(false);
        expect(res.code).toBe("55P03"); // lock_timeout no CQ
      } finally {
        await a.query("ROLLBACK").catch(() => undefined);
        await b.query("ROLLBACK").catch(() => undefined);
        await a.end();
        await b.end();
      }
    });
  },
);

describe.skipIf(!hasDb || !ehBancoLocal())(
  "R13 fix round 2 — N2: _salvar_cq_core SEM _rev_base trava o CQ ANTES do bloco-fonte (só cópia local)",
  () => {
    it("com o CQ travado por outra transação, salvar_cq(_rev_base NULL) espera no CQ sem ter tocado o bloco-fonte", async () => {
      const a = new PgClient({ connectionString: dbUrl()!, ssl: false });
      const b = new PgClient({ connectionString: dbUrl()!, ssl: false });
      await a.connect();
      await b.connect();
      try {
        // fixture JÁ gravada: cad da Loja Teste com CQ E bloco-fonte (sem fonte o texto antigo também
        // travaria o CQ antes de qualquer bloco — o teste não distinguiria)
        const fx = await um<{ cad_id: string; fonte: string } | undefined>(
          a,
          `select q.cad_id, _resolver_fonte_confeccao(q.cad_id) as fonte
             from controle_qualidade q
            where q.tenant_id = $1 and _resolver_fonte_confeccao(q.cad_id) is not null
            order by q.cad_id limit 1`,
          [TENANT_TESTE],
        );
        if (!fx) throw new Error("fixture ausente: nenhum cad da Loja Teste com CQ e bloco-fonte");
        await a.query("BEGIN");
        await a.query(`select 1 from controle_qualidade where cad_id=$1 for update`, [fx.cad_id]);
        await b.query("BEGIN");
        await comoUsuario(b);
        await b.query("SET LOCAL lock_timeout = '2000ms'");
        const bPid = (await um<{ pid: number }>(b, `select pg_backend_pid() pid`)).pid;
        const cq = b
          .query(`select salvar_cq($1,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,false,null)`, [fx.cad_id])
          .then(
            () => ({ ok: true as const, code: "" }),
            (e: { code?: string }) => ({ ok: false as const, code: String(e.code) }),
          );
        let esperando = false;
        for (let i = 0; i < 30 && !esperando; i++) {
          await new Promise((r) => setTimeout(r, 50));
          const w = await um<{ w: string | null }>(
            a,
            `select wait_event_type w from pg_stat_activity where pid=$1`,
            [bPid],
          );
          esperando = w?.w === "Lock";
        }
        expect(esperando, "o salvar_cq devia estar esperando a trava do CQ").toBe(true);
        // enquanto espera, o bloco-fonte está LIVRE (o salvar_cq ainda não o tocou)
        await a.query(`select 1 from producao_terceirizados where id=$1 for update nowait`, [
          fx.fonte,
        ]);
        const res = await cq;
        expect(res.ok).toBe(false);
        expect(res.code).toBe("55P03");
      } finally {
        await a.query("ROLLBACK").catch(() => undefined);
        await b.query("ROLLBACK").catch(() => undefined);
        await a.end();
        await b.end();
      }
    });
  },
);
