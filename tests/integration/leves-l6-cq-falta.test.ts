// Achados LEVES — release L6 (CQ, produção e completar falta). Migrations:
//   20261028100000_terceirizados_ativo_not_null   prod #11: producao_terceirizados.ativo NOT NULL
//   20261028110000_cq_pos_c1_voltar_reverter       R13 Pós [C1] pelo status final · prod #13 (Voltar CQ → Serviços repõe a
//                                                  Grade Real, zera o grade_detalhe, limpa direcionamento_confirmado_at) ·
//                                                  R13 N1 + R15a L2 (Reverter corte trava corte da loja → cad → CQ antes dos
//                                                  blocos) · reverter devolve tecido → completa a falta de OUTRO card
//   20261028120000_completar_falta_extensoes      "- Metragem" desfeito completa · B-R2 (artigo_id / rendimento) · B-R1
//                                                  (RPC reprocessar_faltas_corte, só admin, por loja)
// Txn revertida (BEGIN…ROLLBACK): nada é gravado. Fixture ausente = FALHA (nunca passa calado). Testes de 2 conexões: só
// na cópia local.
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, dbUrl, ehBancoLocal } from "./db";
import { mensagemErro } from "@/lib/erro-mensagem";

const TAM = "38";
const MSG_POS = "Conte ao menos uma peça no CQ Pós (acabamento) antes de confirmar.";
const AVE_RARA_NOME = "Ave Rara";

/** Executa e devolve o erro do Postgres (falha o teste se NÃO der erro). Usa SAVEPOINT para a txn seguir viva. */
async function erroDe(
  c: Client,
  sql: string,
  params: unknown[] = [],
): Promise<{ code: string; message: string }> {
  await c.query("SAVEPOINT l6_err");
  try {
    await c.query(sql, params);
  } catch (e: unknown) {
    await c.query("ROLLBACK TO SAVEPOINT l6_err");
    const pe = e as { code?: string; message?: string };
    return { code: String(pe.code), message: String(pe.message) };
  }
  await c.query("RELEASE SAVEPOINT l6_err");
  throw new Error(`esperava recusa, mas a chamada passou: ${sql}`);
}

// ─── CQ: helpers (mesmo padrão do cq-c1-status-final.test.ts) ──────────────────────────────────────────────────────────
type Setup = { cadId: string; modeloId: string; vnum: number; vid: string };

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

async function criarFonte(
  c: Client,
  s: Setup,
  recebida: number,
  defeito = 0,
): Promise<{ catId: string; blocoId: string }> {
  const cat = await um<{ id: string }>(
    c,
    `insert into categorias_terceirizado (tenant_id, nome, ativo) values ($1,'Oficina Teste L6',true) returning id`,
    [TENANT_TESTE],
  );
  const blocos = JSON.stringify([
    {
      categoria_terceirizado_id: cat.id,
      ativo: true,
      detalhado: true,
      grade_detalhe: { [s.vid]: { [TAM]: { cortada: 12, enviada: 11, recebida, defeito } } },
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

async function confirmarCq(c: Client, s: Setup, n: number) {
  const variantes = JSON.stringify([
    { variante_numero: s.vnum, etapa: "recebimento", grades: { [TAM]: n }, grade_total: n },
  ]);
  const reais = JSON.stringify([{ variante_numero: s.vnum, grades: { [TAM]: n }, grade_total: n }]);
  const r = await um<{ r: { status: string } }>(
    c,
    `select salvar_cq($1,'{}'::jsonb,$2::jsonb,$3::jsonb,true) r`,
    [s.cadId, variantes, reais],
  );
  expect(r.r.status).toBe("confirmado");
}

// ─── estoque/corte: helpers (mesmo padrão do deficit-corte-completar.test.ts) ───────────────────────────────────────────
/** gatilhos adiados da R15a (P-203) — rodam no COMMIT; a txn de teste força com SET CONSTRAINTS … IMMEDIATE */
async function flush(c: Client) {
  await c.query(
    `SET CONSTRAINTS trg_deficit_corte_item_ins, trg_deficit_corte_item_upd, trg_deficit_corte_oc IMMEDIATE`,
  );
}
/** + os 2 gatilhos adiados novos da L6 (B-R2) — não existem sem a 20261028120000 (o teste falha, não passa calado) */
async function flushL6(c: Client) {
  await flush(c);
  await c.query(
    `SET CONSTRAINTS trg_deficit_corte_item_artigo, trg_deficit_corte_artigo_rend IMMEDIATE`,
  );
}

async function preparar(
  c: Client,
  modo: "por_oc" | "automatico" = "automatico",
  unidade: "metro" | "kg" = "metro",
  rendimento = 0,
) {
  await comoUsuario(c);
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"entrada_saida":true,"producao":true,"criacao":true}'::jsonb)
     on conflict (tenant_id) do update set modules = coalesce(tenant_config.modules,'{}'::jsonb) || '{"entrada_saida":true,"producao":true,"criacao":true}'::jsonb`,
    [TENANT_TESTE],
  );
  await c.query(`update tenant_config set modo_baixa_estoque=$2 where tenant_id=$1`, [
    TENANT_TESTE,
    modo,
  ]);
  const art = (
    await um<{ id: string }>(
      c,
      `insert into artigos (tenant_id,nome,unidade_medida,rendimento) values ($1,'ITEST-L6',$2,$3) returning id`,
      [TENANT_TESTE, unidade, rendimento || null],
    )
  ).id;
  const vari = (
    await um<{ id: string }>(
      c,
      `insert into variantes_tecido (tenant_id,artigo_id,nome_variante) values ($1,$2,'ITEST-L6') returning id`,
      [TENANT_TESTE, art],
    )
  ).id;
  return { art, vari };
}

async function novaOc(
  c: Client,
  status: "recebido" | "encomendado",
  numero: string,
  tenant = TENANT_TESTE,
  dataEntrega = "2026-09-01",
) {
  return (
    await um<{ id: string }>(
      c,
      `insert into ocs_tecido (tenant_id,status,numero_pedido,data_pedido,data_entrega) values ($1,$2,$3,$4::date,$4::date) returning id`,
      [tenant, status, numero, dataEntrega],
    )
  ).id;
}

async function novoItem(
  c: Client,
  oc: string,
  art: string,
  vari: string,
  pedida: number,
  recebida: number | null,
) {
  return (
    await um<{ id: string }>(
      c,
      `insert into ocs_tecido_itens (oc_tecido_id,artigo_id,variante_tecido_id,quantidade_pedida,quantidade_recebida) values ($1,$2,$3,$4,$5) returning id`,
      [oc, art, vari, pedida, recebida],
    )
  ).id;
}

async function cardComCad(
  c: Client,
  art: string,
  vari: string,
  metragem: number,
  dataEnvio: string,
) {
  const mod = (
    await um<{ id: string }>(
      c,
      `insert into modelos (tenant_id,nome) values ($1,'ITEST-L6-card') returning id`,
      [TENANT_TESTE],
    )
  ).id;
  const cad = (
    await um<{ id: string }>(
      c,
      `insert into cad (tenant_id,modelo_id,data_enviado_corte) values ($1,$2,$3::date) returning id`,
      [TENANT_TESTE, mod, dataEnvio],
    )
  ).id;
  const ct = (
    await um<{ id: string }>(
      c,
      `insert into cad_tecidos (cad_id,artigo_id,numero,tipo) values ($1,$2,1,'tecido') returning id`,
      [cad, art],
    )
  ).id;
  await c.query(
    `insert into cad_tecido_variantes (cad_tecido_id,variante_tecido_id,ordem,metragem_enviada) values ($1,$2,1,$3)`,
    [ct, vari, metragem],
  );
  return cad;
}

async function cortar(c: Client, cad: string) {
  return (
    await um<{ r: { deficit_total: number } }>(
      c,
      `select public._baixar_estoque_tecido_corte_core($1) r`,
      [cad],
    )
  ).r;
}

async function deficit(c: Client, cad: string): Promise<Array<Record<string, unknown>> | null> {
  return (
    await um<{ d: Array<Record<string, unknown>> | null }>(
      c,
      `select deficit_corte d from cad where id=$1`,
      [cad],
    )
  ).d;
}

async function baixado(c: Client, cad: string): Promise<number> {
  return Number(
    (
      await um<{ t: string }>(
        c,
        `select coalesce(sum(quantidade),0) t from estoque_tecido_baixas where cad_id=$1`,
        [cad],
      )
    ).t,
  );
}

/** usuário de uma loja (admin da loja ou comum), com JWT na txn — padrão do config-loja-salvar.test.ts */
async function usuarioLoja(
  c: Client,
  uid: string,
  tenant: string,
  tenantAdmin: boolean,
): Promise<void> {
  await c.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
    uid,
    `${uid}@teste`,
  ]);
  await c.query(
    `INSERT INTO public.users (id, tenant_id, email, nome) VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET tenant_id = excluded.tenant_id`,
    [uid, tenant, `${uid}@teste`, `Teste L6 ${uid.slice(-2)}`],
  );
  if (tenantAdmin)
    await c.query(`INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'tenant_admin')`, [
      uid,
    ]);
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
}

// ═══ 20261028100000 — prod #11 ═════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!hasDb)("L6 prod #11 — producao_terceirizados.ativo NOT NULL", () => {
  it("a coluna é NOT NULL e gravar ativo NULL é recusado (23502)", async () => {
    await withTx(async (c) => {
      const col = await um<{ n: boolean }>(
        c,
        `select a.attnotnull n from pg_attribute a where a.attrelid='public.producao_terceirizados'::regclass and a.attname='ativo'`,
      );
      expect(col.n).toBe(true);
      // (fix round 1, L5) a ida grava o marcador que a volta exige (a volta só desfaz o NOT NULL que a L6 aplicou)
      const com = await um<{ d: string | null }>(
        c,
        `select col_description('public.producao_terceirizados'::regclass,
                (select attnum from pg_attribute where attrelid='public.producao_terceirizados'::regclass and attname='ativo')) d`,
      );
      expect(com.d ?? "").toMatch(/^leves_l6:not_null/);
      const bloco = await um<{ id: string } | undefined>(
        c,
        `select id from producao_terceirizados limit 1`,
      );
      if (!bloco) throw new Error("fixture ausente: nenhum bloco de servico na copia");
      const e = await erroDe(c, `update producao_terceirizados set ativo = null where id=$1`, [
        bloco.id,
      ]);
      expect(e.code).toBe("23502");
    });
  });
});

// ═══ 20261028110000 — R13 Pós [C1] ════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!hasDb)("L6 R13 Pós [C1] — vale pelo STATUS FINAL (_salvar_cq_pos_core)", () => {
  it("Salvar (sem Confirmar) de um Pós JÁ confirmado com Σ=0 → recusa P0001 com a mensagem de sempre; Σ>0 passa; Pós pendente com Σ=0 passa", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await cadLimpo(c);
      await confirmarCq(c, s, 5);
      const pt = (
        await um<{ id: string }>(
          c,
          `insert into producao_terceirizados (cad_id, ativo) values ($1, true) returning id`,
          [s.cadId],
        )
      ).id;
      const itens = (n: number) =>
        JSON.stringify([
          {
            producao_terceirizado_id: pt,
            variante_numero: s.vnum,
            etapa: "acabamento",
            grades: n > 0 ? { [TAM]: n } : {},
          },
        ]);

      // Pós pendente com Σ=0: Salvar livre (rascunho)
      const r0 = await um<{ r: { status_pos: string } }>(
        c,
        `select salvar_cq_pos($1,'{}'::jsonb,$2::jsonb,false) r`,
        [s.cadId, itens(0)],
      );
      expect(r0.r.status_pos).toBe("pendente");

      // confirma o Pós com 3 peças
      const r1 = await um<{ r: { status_pos: string } }>(
        c,
        `select salvar_cq_pos($1,'{}'::jsonb,$2::jsonb,true) r`,
        [s.cadId, itens(3)],
      );
      expect(r1.r.status_pos).toBe("confirmado");

      // Salvar (sem Confirmar) zerando: recusa (antes da L6 passava e deixava um Pós confirmado com 0 peças)
      const e = await erroDe(c, `select salvar_cq_pos($1,'{}'::jsonb,$2::jsonb,false)`, [
        s.cadId,
        itens(0),
      ]);
      expect(e.code).toBe("P0001");
      expect(e.message).toBe(MSG_POS);
      expect(mensagemErro({ code: e.code, message: e.message }, "x")).toBe(MSG_POS);
      // nada mudou: segue confirmado com as 3 peças
      const q = await um<{ st: string; t: string }>(
        c,
        `select cq.status_pos st, (select coalesce(sum(grade_total),0) from cq_pos_variantes v where v.controle_qualidade_id=cq.id) t
           from controle_qualidade cq where cq.cad_id=$1`,
        [s.cadId],
      );
      expect(q.st).toBe("confirmado");
      expect(Number(q.t)).toBe(3);

      // Salvar com Σ>0 mantém confirmado
      const r2 = await um<{ r: { status_pos: string } }>(
        c,
        `select salvar_cq_pos($1,'{}'::jsonb,$2::jsonb,false) r`,
        [s.cadId, itens(4)],
      );
      expect(r2.r.status_pos).toBe("confirmado");
    });
  });
});

// ═══ 20261028110000 — prod #13 ════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!hasDb)(
  "L6 prod #13 — Voltar o CQ para Serviços desfaz o recebimento por inteiro",
  () => {
    it("Grade Real volta à planejada, grade_detalhe com recebida/defeito 0 (cortada/enviada ficam), direcionamento_confirmado_at NULL — numa txn", async () => {
      await withTx(async (c) => {
        await comoUsuario(c);
        const s = await cadLimpo(c);
        const { blocoId } = await criarFonte(c, s, 10, 1);
        await confirmarCq(c, s, 9);
        // Grade Real derivada da fonte (10 − 1); a planejada vira 7 para a volta ser visível
        const real0 = await um<{ v: number }>(
          c,
          `select (grades_reais->>$2)::int v from cad_grades where cad_id=$1 and variante_numero=$3`,
          [s.cadId, TAM, s.vnum],
        );
        expect(real0.v).toBeGreaterThan(0);
        expect(real0.v).not.toBe(7);
        await c.query(
          `update cad_grades set grades_planejadas = jsonb_build_object($2::text, 7), grade_total_planejada = 7 where cad_id=$1 and variante_numero=$3`,
          [s.cadId, TAM, s.vnum],
        );
        await c.query(
          `update cad set direcionamento_status='separado', direcionamento_confirmado_at=now() where id=$1`,
          [s.cadId],
        );

        await c.query(`select voltar_cq_para_servico($1)`, [s.cadId]);

        const g = await um<{ r: Record<string, number>; t: number; p: Record<string, number> }>(
          c,
          `select grades_reais r, grade_total_real t, grades_planejadas p from cad_grades where cad_id=$1 and variante_numero=$2`,
          [s.cadId, s.vnum],
        );
        expect(g.r).toEqual(g.p);
        expect(g.r[TAM]).toBe(7);
        expect(Number(g.t)).toBe(7);
        const cel = await um<{
          gd: Record<string, Record<string, Record<string, number>>>;
          qr: number;
          qd: number;
        }>(
          c,
          `select grade_detalhe gd, quantidade_recebida qr, quantidade_defeito qd from producao_terceirizados where id=$1`,
          [blocoId],
        );
        expect(cel.gd[s.vid][TAM]).toMatchObject({
          cortada: 12,
          enviada: 11,
          recebida: 0,
          defeito: 0,
        });
        expect(Number(cel.qr)).toBe(0);
        expect(Number(cel.qd)).toBe(0);
        const cad = await um<{ st: string; at: string | null }>(
          c,
          `select direcionamento_status st, direcionamento_confirmado_at at from cad where id=$1`,
          [s.cadId],
        );
        expect(cad.st).toBe("pendente");
        expect(cad.at).toBeNull();
        expect(
          Number(
            (
              await um<{ n: string }>(
                c,
                `select count(*) n from controle_qualidade where cad_id=$1`,
                [s.cadId],
              )
            ).n,
          ),
        ).toBe(0);
        const m = await um<{ rp: Record<string, boolean> | null }>(
          c,
          `select revisao_pendente rp from modelos where id=$1`,
          [s.modeloId],
        );
        expect(m.rp?.direcionamento ?? false).toBe(false);
        expect(m.rp?.cq ?? false).toBe(false);
      });
    });
  },
);

// ═══ 20261028110000 — Reverter corte devolve tecido → completa a falta de OUTRO card ═════════════════════════════════
describe.skipIf(!hasDb)(
  "L6 — Reverter corte devolve o tecido mas NÃO completa a falta de outro card (fix round 1, M1); Reprocessar completa",
  () => {
    it("A (100 de 120, falta 20) e B (falta 60); reverter A → A sem baixa e sem falta; B SEGUE em falta; Reprocessar completa B", async () => {
      await withTx(async (c) => {
        const f = await preparar(c, "automatico");
        const oc = await novaOc(c, "recebido", "ITEST-L6-REV");
        await novoItem(c, oc, f.art, f.vari, 100, 100);
        await flush(c);
        const cadA = await cardComCad(c, f.art, f.vari, 120, "2026-02-01");
        const cadB = await cardComCad(c, f.art, f.vari, 60, "2026-03-01");
        await cortar(c, cadA);
        await cortar(c, cadB);
        expect(await baixado(c, cadA)).toBe(100);
        expect(Number((await deficit(c, cadA))![0].deficit)).toBe(20);
        expect(Number((await deficit(c, cadB))![0].deficit)).toBe(60);

        await c.query(`select public._reverter_corte_tecido_core($1)`, [cadA]);

        expect(await baixado(c, cadA)).toBe(0);
        const a = await um<{ e: boolean; d: unknown }>(
          c,
          `select enviado_corte e, deficit_corte d from cad where id=$1`,
          [cadA],
        );
        expect(a.e).toBe(false);
        expect(a.d).toBeNull(); // o "Faltou estoque" do corte desfeito não sobra
        // M1: voltar → corrigir → reenviar não entrega o tecido do card a cortes mais antigos
        expect(Number((await deficit(c, cadB))![0].deficit)).toBe(60);
        expect(await baixado(c, cadB)).toBe(0);
        // completar é explícito: Reprocessar faltas
        const r = (
          await um<{ r: Record<string, number> }>(
            c,
            `select public.reprocessar_faltas_corte($1) r`,
            [f.vari],
          )
        ).r;
        expect(r).toMatchObject({ cads: 1 });
        expect(await deficit(c, cadB)).toBeNull();
        expect(await baixado(c, cadB)).toBe(60);
      });
    });

    it("reverter limpa direcionamento_confirmado_at", async () => {
      await withTx(async (c) => {
        const f = await preparar(c, "automatico");
        const cad = await cardComCad(c, f.art, f.vari, 10, "2026-02-01");
        await cortar(c, cad);
        await c.query(
          `update cad set direcionamento_status='separado', direcionamento_confirmado_at=now() where id=$1`,
          [cad],
        );
        await c.query(`select public._reverter_corte_tecido_core($1)`, [cad]);
        const r = await um<{ at: string | null }>(
          c,
          `select direcionamento_confirmado_at at from cad where id=$1`,
          [cad],
        );
        expect(r.at).toBeNull();
      });
    });
  },
);

// ═══ 20261028120000 — "- Metragem" desfeito completa ══════════════════════════════════════════════════════════════════
describe.skipIf(!hasDb)(
  "L6 — desfazer '- Metragem' devolve o tecido e completa a falta do corte",
  () => {
    it("OC 100, '- Metragem' 60, corte 100 (falta 60); desfazer o ajuste → falta completa", async () => {
      await withTx(async (c) => {
        const f = await preparar(c, "automatico");
        const oc = await novaOc(c, "recebido", "ITEST-L6-AJ");
        const it = await novoItem(c, oc, f.art, f.vari, 100, 100);
        await flush(c);
        const aj = (
          await um<{ id: string }>(
            c,
            `select public._remover_metragem_oc_core($1, 60, 'teste L6') id`,
            [it],
          )
        ).id;
        const cad = await cardComCad(c, f.art, f.vari, 100, "2026-02-01");
        await cortar(c, cad);
        expect(await baixado(c, cad)).toBe(40);
        expect(Number((await deficit(c, cad))![0].deficit)).toBe(60);

        await c.query(`select public._reverter_ajuste_estoque_core($1)`, [aj]);

        expect(
          Number(
            (
              await um<{ n: string }>(
                c,
                `select count(*) n from estoque_tecido_baixas where id=$1`,
                [aj],
              )
            ).n,
          ),
        ).toBe(0);
        expect(await deficit(c, cad)).toBeNull();
        expect(await baixado(c, cad)).toBe(100);
      });
    });
  },
);

// ═══ 20261028120000 — B-R2 ════════════════════════════════════════════════════════════════════════════════════════════
describe.skipIf(!hasDb)(
  "L6 B-R2 — trocar o artigo do item ou o rendimento do artigo completa a falta",
  () => {
    it("item muda de artigo (kg sem rendimento → metro): o saldo aparece e a falta completa", async () => {
      await withTx(async (c) => {
        const f = await preparar(c, "automatico", "kg", 0); // kg sem rendimento: 10 kg × 0 = 0 m
        const artM = (
          await um<{ id: string }>(
            c,
            `insert into artigos (tenant_id,nome,unidade_medida) values ($1,'ITEST-L6-M','metro') returning id`,
            [TENANT_TESTE],
          )
        ).id;
        const cad = await cardComCad(c, f.art, f.vari, 30, "2026-02-01");
        await cortar(c, cad);
        const oc = await novaOc(c, "recebido", "ITEST-L6-ART");
        const it = await novoItem(c, oc, f.art, f.vari, 10, 10);
        await flushL6(c);
        expect(Number((await deficit(c, cad))![0].deficit)).toBe(30); // nada a completar (0 m)
        await c.query(`update ocs_tecido_itens set artigo_id=$2 where id=$1`, [it, artM]);
        await flushL6(c);
        expect(await baixado(c, cad)).toBe(10);
        expect(Number((await deficit(c, cad))![0].deficit)).toBe(20);
      });
    });

    it("rendimento do artigo muda (0 → 3): 10 kg viram 30 m e a falta completa; sem mudança não dispara", async () => {
      await withTx(async (c) => {
        const avisos: string[] = [];
        c.on("notice", (n: { message?: string }) => avisos.push(String(n.message)));
        const f = await preparar(c, "automatico", "kg", 0);
        const cad = await cardComCad(c, f.art, f.vari, 30, "2026-02-01");
        await cortar(c, cad);
        const oc = await novaOc(c, "recebido", "ITEST-L6-REND");
        await novoItem(c, oc, f.art, f.vari, 10, 10);
        await flushL6(c);
        expect(Number((await deficit(c, cad))![0].deficit)).toBe(30);
        await c.query(
          `update artigos set rendimento=rendimento, unidade_medida=unidade_medida where id=$1`,
          [f.art],
        );
        await flushL6(c);
        expect(Number((await deficit(c, cad))![0].deficit)).toBe(30);
        await c.query(`update artigos set rendimento=3 where id=$1`, [f.art]);
        await flushL6(c);
        expect(await deficit(c, cad)).toBeNull();
        expect(await baixado(c, cad)).toBe(30);
        expect(avisos.filter((a) => a.includes("completar_deficit_corte"))).toEqual([]);
      });
    });
  },
);

// ═══ 20261028120000 — B-R1 reprocessar_faltas_corte ═══════════════════════════════════════════════════════════════════
describe.skipIf(!hasDb)("L6 B-R1 — reprocessar_faltas_corte (só admin, por loja)", () => {
  it("completa uma falta que os gatilhos não completaram (evento ainda não processado) e devolve as contagens", async () => {
    await withTx(async (c) => {
      const f = await preparar(c, "automatico");
      const cad = await cardComCad(c, f.art, f.vari, 50, "2026-02-01");
      await cortar(c, cad);
      const oc = await novaOc(c, "recebido", "ITEST-L6-RP");
      await novoItem(c, oc, f.art, f.vari, 80, 80); // gatilho adiado da R15a NÃO roda (sem COMMIT/flush) = "pulado"
      expect(Number((await deficit(c, cad))![0].deficit)).toBe(50);
      const r = (
        await um<{ r: Record<string, number> }>(c, `select public.reprocessar_faltas_corte($1) r`, [
          f.vari,
        ])
      ).r;
      expect(r).toMatchObject({
        variantes: 1,
        processadas: 1,
        cads: 1,
        malformadas: 0,
        adiadas: 0,
        erros: 0,
        cads_com_falta: 0,
      });
      expect(Number(r.metros)).toBe(50);
      expect(await deficit(c, cad)).toBeNull();
      expect(await baixado(c, cad)).toBe(50);
      // idempotente
      const r2 = (
        await um<{ r: Record<string, number> }>(c, `select public.reprocessar_faltas_corte($1) r`, [
          f.vari,
        ])
      ).r;
      expect(r2).toMatchObject({ variantes: 0, cads: 0, cads_com_falta: 0 });
    });
  });

  it("todas as variantes da loja (_variante NULL): completa a do teste", async () => {
    await withTx(async (c) => {
      const f = await preparar(c, "automatico");
      const cad = await cardComCad(c, f.art, f.vari, 20, "2026-02-01");
      await cortar(c, cad);
      const oc = await novaOc(c, "recebido", "ITEST-L6-RPALL");
      await novoItem(c, oc, f.art, f.vari, 20, 20);
      const r = (
        await um<{ r: Record<string, number> }>(c, `select public.reprocessar_faltas_corte() r`)
      ).r;
      expect(r.variantes).toBeGreaterThanOrEqual(1);
      expect(r.cads).toBeGreaterThanOrEqual(1);
      expect(await deficit(c, cad)).toBeNull();
    });
  });

  it("usuário comum da loja → 42501; admin da loja → passa", async () => {
    await withTx(async (c) => {
      const f = await preparar(c, "automatico");
      const cad = await cardComCad(c, f.art, f.vari, 20, "2026-02-01");
      await cortar(c, cad);
      const oc = await novaOc(c, "recebido", "ITEST-L6-RPADM");
      await novoItem(c, oc, f.art, f.vari, 20, 20);
      await usuarioLoja(c, "11111111-1111-4111-8111-0000000006a1", TENANT_TESTE, false);
      const e = await erroDe(c, `select public.reprocessar_faltas_corte($1)`, [f.vari]);
      expect(e.code).toBe("42501");
      expect(await deficit(c, cad)).not.toBeNull();
      await usuarioLoja(c, "11111111-1111-4111-8111-0000000006a2", TENANT_TESTE, true);
      const r = (
        await um<{ r: Record<string, number> }>(c, `select public.reprocessar_faltas_corte($1) r`, [
          f.vari,
        ])
      ).r;
      expect(r.cads).toBe(1);
      expect(await deficit(c, cad)).toBeNull();
    });
  });

  // (fix round 1, L8) faz upsert em tenant_config de uma loja REAL (Ave Rara) dentro da txn: só na cópia local
  it.skipIf(!ehBancoLocal())(
    "isolamento por loja: admin de OUTRA loja não alcança a variante nem os cortes da Loja Teste",
    async () => {
      await withTx(async (c) => {
        const f = await preparar(c, "automatico");
        const outra = await um<{ id: string } | undefined>(
          c,
          `select id from tenants where nome=$1`,
          [AVE_RARA_NOME],
        );
        if (!outra) throw new Error("fixture ausente: loja Ave Rara");
        await c.query(
          `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true}'::jsonb)
         on conflict (tenant_id) do update set modules = coalesce(tenant_config.modules,'{}'::jsonb) || '{"criacao":true}'::jsonb`,
          [outra.id],
        );
        const cad = await cardComCad(c, f.art, f.vari, 20, "2026-02-01");
        await cortar(c, cad);
        const oc = await novaOc(c, "recebido", "ITEST-L6-RPISO");
        await novoItem(c, oc, f.art, f.vari, 20, 20);
        await usuarioLoja(c, "11111111-1111-4111-8111-0000000006a3", outra.id, true);
        const e = await erroDe(c, `select public.reprocessar_faltas_corte($1)`, [f.vari]);
        expect(e.code).toBe("P0001");
        expect(e.message).toBe("Variante de tecido não encontrada nesta loja.");
        await um(c, `select public.reprocessar_faltas_corte() r`);
        expect(Number((await deficit(c, cad))![0].deficit)).toBe(20); // a falta da Loja Teste não foi tocada
        expect(await baixado(c, cad)).toBe(0);
      });
    },
  );

  it("ACL: reprocessar_faltas_corte só authenticated (sem anon/PUBLIC); função de gatilho e _cores sem EXECUTE", async () => {
    await withTx(async (c) => {
      const r = await um<Record<string, boolean>>(
        c,
        `select
          has_function_privilege('authenticated','public.reprocessar_faltas_corte(uuid)','EXECUTE') rpc_auth,
          has_function_privilege('anon','public.reprocessar_faltas_corte(uuid)','EXECUTE') rpc_anon,
          exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   where p.oid='public.reprocessar_faltas_corte(uuid)'::regprocedure and x.grantee=0 and x.privilege_type='EXECUTE') rpc_public,
          has_function_privilege('authenticated','public.fn_completar_deficit_corte_artigo()','EXECUTE') trg_auth,
          has_function_privilege('anon','public.fn_completar_deficit_corte_artigo()','EXECUTE') trg_anon,
          has_function_privilege('authenticated','public._reverter_ajuste_estoque_core(uuid)','EXECUTE') aj_auth,
          has_function_privilege('authenticated','public._reverter_corte_tecido_core(uuid)','EXECUTE') rv_auth,
          has_function_privilege('authenticated','public._voltar_cq_para_servico_core(uuid)','EXECUTE') vt_auth,
          has_function_privilege('authenticated','public._salvar_cq_pos_core(uuid,jsonb,jsonb,boolean)','EXECUTE') pos_auth,
          (select count(*) from pg_trigger where tgname in ('trg_deficit_corte_item_artigo','trg_deficit_corte_artigo_rend')
              and tgenabled='O' and tgdeferrable and tginitdeferred) = 2 gatilhos`,
      );
      expect(r).toEqual({
        rpc_auth: true,
        rpc_anon: false,
        rpc_public: false,
        trg_auth: false,
        trg_anon: false,
        aj_auth: false,
        rv_auth: false,
        vt_auth: false,
        pos_auth: false,
        gatilhos: true,
      });
    });
  });
});

// ═══ 20261028110000 — ordem das travas do Reverter corte (2 conexões; só cópia local) ═════════════════════════════════
/** cad JÁ gravado da Loja Teste com CQ e bloco e sem parcela paga (2 conexões não veem dado de txn alheia). */
async function fixtureCadCqBloco(c: Client): Promise<string> {
  const fx = await um<{ cad_id: string } | undefined>(
    c,
    `select q.cad_id from controle_qualidade q
      where q.tenant_id=$1 and exists (select 1 from producao_terceirizados pt where pt.cad_id=q.cad_id)
        and not exists (select 1 from parcelas_servico ps join producao_terceirizados pt on pt.id=ps.producao_terceirizado_id
                         where pt.cad_id=q.cad_id and ps.status='pago')
      order by q.cad_id limit 1`,
    [TENANT_TESTE],
  );
  if (!fx)
    throw new Error(
      "fixture ausente: nenhum cad da Loja Teste com CQ, bloco de servico e sem parcela paga",
    );
  return fx.cad_id;
}

async function esperarTrava(
  a: Client,
  pid: number,
): Promise<{ tipo: string | null; evento: string | null }> {
  let w: { tipo: string | null; evento: string | null } = { tipo: null, evento: null };
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 50));
    w = await um<{ tipo: string | null; evento: string | null }>(
      a,
      `select wait_event_type tipo, wait_event evento from pg_stat_activity where pid=$1`,
      [pid],
    );
    if (w.tipo === "Lock") break;
  }
  return w;
}

describe.skipIf(!hasDb || !ehBancoLocal())(
  "L6 R13 N1 + R15a L2 — Reverter corte trava corte da loja → cad → CQ ANTES dos blocos (só cópia local)",
  () => {
    it("com o CQ travado por outra transação, o Reverter já segura a trava do corte da loja e espera no CQ sem ter tocado bloco nem baixa", async () => {
      const a = new Client({ connectionString: dbUrl()!, ssl: false });
      const b = new Client({ connectionString: dbUrl()!, ssl: false });
      await a.connect();
      await b.connect();
      try {
        const cadId = await fixtureCadCqBloco(a);
        await a.query("BEGIN");
        await a.query(`select 1 from controle_qualidade where cad_id=$1 for update`, [cadId]);
        await b.query("BEGIN");
        await comoUsuario(b);
        await b.query("SET LOCAL lock_timeout = '2000ms'");
        const bPid = (await um<{ pid: number }>(b, `select pg_backend_pid() pid`)).pid;
        const rev = b.query(`select public._reverter_corte_tecido_core($1)`, [cadId]).then(
          () => ({ ok: true as const, code: "" }),
          (e: { code?: string }) => ({ ok: false as const, code: String(e.code) }),
        );
        const w = await esperarTrava(a, bPid);
        expect(w.tipo, "o Reverter devia estar esperando a trava do CQ").toBe("Lock");
        expect(w.evento).not.toBe("advisory"); // parado na LINHA do CQ (tuple/transactionid), já depois das travas advisory
        // já segura a trava do corte da loja (R15a L2)…
        const livre = await um<{ ok: boolean }>(
          a,
          `select pg_try_advisory_xact_lock(hashtext('corte_tenant:' || $1::text)) ok`,
          [TENANT_TESTE],
        );
        expect(livre.ok).toBe(false);
        // …e não tocou nenhum bloco nem baixa (R13 N1: CQ antes dos blocos)
        await a.query(`select 1 from producao_terceirizados where cad_id=$1 for update nowait`, [
          cadId,
        ]);
        await a.query(`select 1 from estoque_tecido_baixas where cad_id=$1 for update nowait`, [
          cadId,
        ]);
        const res = await rev;
        expect(res.ok).toBe(false);
        expect(res.code).toBe("55P03");
      } finally {
        await a.query("ROLLBACK").catch(() => undefined);
        await b.query("ROLLBACK").catch(() => undefined);
        await a.end();
        await b.end();
      }
    });

    it("PCP salvando (advisory do cad + CQ + blocos) × Reverter: o Reverter espera na trava do cad sem segurar nada que o PCP use; sem 40P01", async () => {
      const a = new Client({ connectionString: dbUrl()!, ssl: false });
      const b = new Client({ connectionString: dbUrl()!, ssl: false });
      await a.connect();
      await b.connect();
      try {
        const cadId = await fixtureCadCqBloco(a);
        // A = o PCP no meio do salvar_terceirizados: advisory do cad → CQ → blocos
        await a.query("BEGIN");
        await a.query(`select pg_advisory_xact_lock(hashtext($1::text))`, [cadId]);
        await a.query(`select 1 from controle_qualidade where cad_id=$1 for update`, [cadId]);
        await a.query(`select 1 from producao_terceirizados where cad_id=$1 for update`, [cadId]);
        await b.query("BEGIN");
        await comoUsuario(b);
        await b.query("SET LOCAL lock_timeout = '5000ms'");
        const bPid = (await um<{ pid: number }>(b, `select pg_backend_pid() pid`)).pid;
        const rev = b.query(`select public._reverter_corte_tecido_core($1)`, [cadId]).then(
          () => ({ ok: true as const, code: "" }),
          (e: { code?: string }) => ({ ok: false as const, code: String(e.code) }),
        );
        const w = await esperarTrava(a, bPid);
        expect(w.tipo).toBe("Lock");
        expect(w.evento).toBe("advisory"); // parado na trava do cad, ANTES de qualquer linha
        // os próximos passos do PCP (cad_grades e cad) não esbarram no Reverter
        await a.query(`select 1 from cad_grades where cad_id=$1 for update nowait`, [cadId]);
        await a.query(`select 1 from cad where id=$1 for update nowait`, [cadId]);
        await a.query("ROLLBACK"); // o PCP termina → o Reverter segue sozinho
        const res = await rev;
        expect(res.code).not.toBe("40P01");
        expect(res).toEqual({ ok: true, code: "" });
      } finally {
        await a.query("ROLLBACK").catch(() => undefined);
        await b.query("ROLLBACK").catch(() => undefined);
        await a.end();
        await b.end();
      }
    });
  },
);

// ═══ fix round 1, L1 — "- Metragem" desfeito com o corte da loja ocupado: WARNING (só cópia local, 2ª conexão) ══════
describe.skipIf(!hasDb || !ehBancoLocal())(
  "L6 fix round 1 L1 — '- Metragem' desfeito com a trava do corte ocupada avisa (WARNING)",
  () => {
    it("outra sessão segura a trava do corte da loja → o ajuste é desfeito, a falta fica e sai WARNING 'nao completada agora'", async () => {
      const outro = new Client({ connectionString: dbUrl()!, ssl: false });
      await outro.connect();
      try {
        await withTx(async (c) => {
          const avisos: string[] = [];
          c.on("notice", (n: { message?: string }) => avisos.push(String(n.message)));
          // outra sessão = um corte da loja em curso (trava pega ANTES de tudo)
          await outro.query(`select pg_advisory_lock(hashtext('corte_tenant:' || $1::text))`, [
            TENANT_TESTE,
          ]);
          const f = await preparar(c, "automatico");
          const oc = await novaOc(c, "recebido", "ITEST-L6-AJW");
          const it = await novoItem(c, oc, f.art, f.vari, 100, 100);
          const aj = (
            await um<{ id: string }>(
              c,
              `select public._remover_metragem_oc_core($1, 60, 'teste L6') id`,
              [it],
            )
          ).id;
          const cad = await cardComCad(c, f.art, f.vari, 100, "2026-02-01");
          // déficit gravado direto: cortar aqui pegaria a trava do corte da loja NESTA txn (esperaria a outra sessão)
          await c.query(`update cad set enviado_corte=true, deficit_corte=$2::jsonb where id=$1`, [
            cad,
            JSON.stringify([
              { tipo: "tecido", numero: 1, ordem: 1, deficit: 60, baixada: 40, enviada: 100 },
            ]),
          ]);
          await c.query(`select public._reverter_ajuste_estoque_core($1)`, [aj]);
          expect(
            Number(
              (
                await um<{ n: string }>(
                  c,
                  `select count(*) n from estoque_tecido_baixas where id=$1`,
                  [aj],
                )
              ).n,
            ),
          ).toBe(0);
          expect(Number((await deficit(c, cad))![0].deficit)).toBe(60);
          expect(
            avisos.some((a) => a.includes("reverter_ajuste") && a.includes("nao completada agora")),
          ).toBe(true);
        });
      } finally {
        await outro.query(`select pg_advisory_unlock_all()`).catch(() => {});
        await outro.end();
      }
    });
  },
);
