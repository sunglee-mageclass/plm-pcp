import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, USER_TESTE } from "./db";

// #1: fonte única _estoque_tecido_core (consumida pela tela de Estoque e pelo dashboard).
// Cenário controlado (BEGIN…ROLLBACK): OC recebida 100 → físico 100; OS baixada 30 → 70;
// cancelar o item → recebido sai, físico clampa em 0 (a OS baixa fica). Trava a definição.
describe.skipIf(!hasDb)("estoque_tecido (fonte canônica)", () => {
  it("recebido − OS baixada, com clamp e exclusão de item cancelado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const av = await um<{ art: string; var: string } | undefined>(
        c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id
            where a.tenant_id=$1 and coalesce(a.unidade_medida,'metro')<>'kg' limit 1`, [TENANT_TESTE]);
      if (!emp || !av) return;

      const rec = async () => Number((await um<{ m: string }>(c,
        `select coalesce(recebido_m,0) m from public._estoque_tecido_core($1) where variante_tecido_id=$2`, [TENANT_TESTE, av.var]))?.m ?? 0);
      const bx = async () => Number((await um<{ m: string }>(c,
        `select coalesce(baixa,0) m from public._estoque_tecido_core($1) where variante_tecido_id=$2`, [TENANT_TESTE, av.var]))?.m ?? 0);
      const rec0 = await rec();
      const bx0 = await bx();

      const oc = { numero_pedido: "ITEST-ETEC", empresa_id: emp.id, data_prevista_entrega: "2026-07-01",
        prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [],
        valor_previsto_total: 100, valor_real_total: 100, status: "recebido" };
      const itens = [{ id: null, artigo_id: av.art, artigo_numero: 1, variante_tecido_id: av.var,
        quantidade_pedida: 100, quantidade_recebida: 100, rendimento: null, cancelado: false }];
      const ocId = (await um<{ id: string }>(c, `select public._salvar_oc_tecido_core(null,$1::jsonb,$2::jsonb) id`,
        [JSON.stringify(oc), JSON.stringify(itens)])).id;
      const itId = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id=$1`, [ocId])).id;

      expect(await rec()).toBe(rec0 + 100); // OC recebida soma 100 no recebido

      // OS baixada de 30 → +30 na baixa
      const os = (await um<{ id: string }>(c, `insert into ordens_saida_tecido(tenant_id, baixado) values ($1,true) returning id`, [TENANT_TESTE])).id;
      await c.query(`insert into ordens_saida_tecido_itens(tenant_id, ordem_saida_id, variante_tecido_id, reserva, baixa) values ($1,$2,$3,0,30)`, [TENANT_TESTE, os, av.var]);
      expect(await bx()).toBe(bx0 + 30); // OS baixada entra na baixa

      // cancelar o item → o recebido dele (100) sai
      await c.query(`update ocs_tecido_itens set cancelado=true where id=$1`, [itId]);
      expect(await rec()).toBe(rec0); // recebido volta ao baseline

      // físico nunca negativo (clamp)
      const fis = Number((await um<{ f: string }>(c, `select coalesce(fisico,0) f from public._estoque_tecido_core($1) where variante_tecido_id=$2`, [TENANT_TESTE, av.var]))?.f ?? 0);
      expect(fis).toBeGreaterThanOrEqual(0);
    });
  });
});

// ─── Achados MEDIOS R15a (migrations 20261025100000 + 20261025200000) ─────────────────────────────────────────────
// est #4: o item de ORIGEM de rolo deixou de ser excluído inteiro do core — a parte NÃO separada continua no físico; a
//         separação é transferência (sai do recebido da origem, não entra na baixa). Separar tudo = igual a antes.
// est #2: o painel "Estoque por OC" (detalhe_estoque_variante) usa a regra do core por item e a reserva do core REPARTIDA
//         pelos vínculos (prioridade, oc_tecido_item_id; teto quantidade_m; o último leva o resto); libera com
//         enviado_corte; reprovado não reserva. Σ das linhas ≤ core ("Reserva sem OC" = core − Σ ≥ 0).
// B1:     o picker de vínculo (ocs_disponiveis_variante) usa saldo_oc_item_m em OC recebida (MALHA BEGÔNIA 547 m).
// Fixture ausente = o teste FALHA (nunca passa vazio).

type CoreRow = { recebido_m: number; baixa: number; fisico: number; reservado: number; prev_receb_m: number };

async function r15Fixture(c: Client, unidade: "metro" | "kg" = "metro", rendimento = 0) {
  await comoUsuario(c);
  await c.query(`update tenant_config set modo_baixa_estoque='por_oc' where tenant_id=$1`, [TENANT_TESTE]);
  const art = (await um<{ id: string }>(
    c, `insert into artigos (tenant_id,nome,unidade_medida,rendimento) values ($1,'ITEST-R15A',$2,$3) returning id`,
    [TENANT_TESTE, unidade, rendimento || null])).id;
  const vari = (await um<{ id: string }>(
    c, `insert into variantes_tecido (tenant_id,artigo_id,nome_variante) values ($1,$2,'ITEST-R15A') returning id`,
    [TENANT_TESTE, art])).id;
  return { art, vari };
}

async function r15Oc(c: Client, status: "recebido" | "encomendado", numero: string) {
  return (await um<{ id: string }>(
    c, `insert into ocs_tecido (tenant_id,status,numero_pedido,data_pedido,data_entrega) values ($1,$2,$3,current_date,current_date) returning id`,
    [TENANT_TESTE, status, numero])).id;
}

async function r15Item(c: Client, oc: string, art: string, vari: string, pedida: number, recebida: number | null, substitui: string | null = null) {
  return (await um<{ id: string }>(
    c, `insert into ocs_tecido_itens (oc_tecido_id,artigo_id,variante_tecido_id,quantidade_pedida,quantidade_recebida,substitui_item_id)
        values ($1,$2,$3,$4,$5,$6) returning id`, [oc, art, vari, pedida, recebida, substitui])).id;
}

async function r15Core(c: Client, vari: string, tenant = TENANT_TESTE): Promise<CoreRow> {
  const r = await um<any>(c, `select * from public._estoque_tecido_core($1) where variante_tecido_id=$2`, [tenant, vari]);
  if (!r) throw new Error("variante fora do core");
  return { recebido_m: Number(r.recebido_m), baixa: Number(r.baixa), fisico: Number(r.fisico),
           reservado: Number(r.reservado), prev_receb_m: Number(r.prev_receb_m) };
}

async function r15Painel(c: Client, vari: string): Promise<any[]> {
  return (await um<{ j: any[] }>(c, `select public.detalhe_estoque_variante($1) j`, [vari])).j;
}

/** card (modelo) com demanda `metros` na variante (tecido 1, ordem 1, consumo 1, grade = metros). */
async function r15Card(c: Client, art: string, vari: string, metros: number, nome: string) {
  const mod = (await um<{ id: string }>(c, `insert into modelos (tenant_id,nome) values ($1,$2) returning id`, [TENANT_TESTE, nome])).id;
  const mt = (await um<{ id: string }>(
    c, `insert into modelo_tecidos (modelo_id,artigo_id,numero,tipo,consumo,loss_percent) values ($1,$2,1,'tecido',1,0) returning id`,
    [mod, art])).id;
  await c.query(`insert into modelo_tecido_variantes (modelo_tecido_id,variante_tecido_id,ordem) values ($1,$2,1)`, [mt, vari]);
  await c.query(`insert into modelo_grades (modelo_id,variante_numero,grades,grade_total) values ($1,1,'{}'::jsonb,$2)`, [mod, metros]);
  return mod;
}

async function r15Link(c: Client, mod: string, vari: string, item: string, q: number, prioridade: number) {
  await c.query(
    `insert into modelo_tecido_oc_links (tenant_id,modelo_id,tipo,numero,ordem,variante_tecido_id,oc_tecido_item_id,quantidade_m,prioridade)
     values ($1,$2,'tecido',1,1,$3,$4,$5,$6)`, [TENANT_TESTE, mod, vari, item, q, prioridade]);
}

const somaPainel = (rows: any[], k: string) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0);

describe.skipIf(!hasDb)("R15a est #4 — item de origem de rolo no core (fonte única)", () => {
  it("separar PARTE de uma OC em rolo: a sobra da OC continua no físico (e o Recebido não conta 2x)", async () => {
    await withTx(async (c) => {
      const f = await r15Fixture(c);
      const oc = await r15Oc(c, "recebido", "ITEST-R15A-ORIG");
      const it = await r15Item(c, oc, f.art, f.vari, 100, 100);
      expect((await r15Core(c, f.vari)).fisico).toBe(100);

      const rolo = (await um<{ id: string }>(c, `select public._criar_rolo_core('ITEST-R15A-R1',$1::uuid,$2::jsonb,$3::uuid) id`,
        [f.art, JSON.stringify([{ variante_tecido_id: f.vari, metragem: 60 }]), it])).id;
      expect(rolo).toBeTruthy();
      const depois = await r15Core(c, f.vari);
      expect(depois.fisico).toBe(100);        // antes da R15a: 60 (a sobra de 40 da OC sumia)
      expect(depois.recebido_m).toBe(100);    // 40 que ficou na OC + 60 do rolo (sem contar a separação 2x)
      expect(depois.baixa).toBe(0);           // a separação não é baixa

      // corte/ajuste na SOBRA da OC de origem desconta do físico (antes: a baixa da origem era ignorada)
      await c.query(`insert into estoque_tecido_baixas (tenant_id,cad_id,oc_tecido_item_id,variante_tecido_id,quantidade,origem)
                     values ($1,null,$2,$3,10,'ajuste')`, [TENANT_TESTE, it, f.vari]);
      const aj = await r15Core(c, f.vari);
      expect(aj.fisico).toBe(90);
      expect(aj.baixa).toBe(10);

      // o painel mostra a linha da OC de origem (recebido − separação) e a do rolo; Σ = core
      const p = await r15Painel(c, f.vari);
      const orig = p.find((r) => r.oc_tecido_item_id === it);
      expect(orig).toBeTruthy();
      expect(Number(orig.recebido_m)).toBe(40);
      expect(Number(orig.baixado_m)).toBe(10);
      expect(somaPainel(p, "recebido_m")).toBe(aj.recebido_m);
      expect(somaPainel(p, "baixado_m")).toBe(aj.baixa);
    });
  });

  it("separar TUDO em rolo: igual a antes (físico = rolo; a origem zera)", async () => {
    await withTx(async (c) => {
      const f = await r15Fixture(c);
      const oc = await r15Oc(c, "recebido", "ITEST-R15A-TUDO");
      const it = await r15Item(c, oc, f.art, f.vari, 50, 50);
      await um(c, `select public._criar_rolo_core('ITEST-R15A-R2',$1::uuid,$2::jsonb,$3::uuid) id`,
        [f.art, JSON.stringify([{ variante_tecido_id: f.vari, metragem: 50 }]), it]);
      const r = await r15Core(c, f.vari);
      expect(r).toMatchObject({ fisico: 50, recebido_m: 50, baixa: 0, prev_receb_m: 0 });
      const orig = (await r15Painel(c, f.vari)).find((x) => x.oc_tecido_item_id === it);
      expect(Number(orig.recebido_m) - Number(orig.baixado_m)).toBe(0);
    });
  });

  it("cancelar o rolo devolve a metragem à OC de origem (antes: a origem seguia excluída e o físico ia a 0)", async () => {
    await withTx(async (c) => {
      const f = await r15Fixture(c);
      const oc = await r15Oc(c, "recebido", "ITEST-R15A-CANC");
      const it = await r15Item(c, oc, f.art, f.vari, 80, 80);
      const rolo = (await um<{ id: string }>(c, `select public._criar_rolo_core('ITEST-R15A-R3',$1::uuid,$2::jsonb,$3::uuid) id`,
        [f.art, JSON.stringify([{ variante_tecido_id: f.vari, metragem: 80 }]), it])).id;
      await c.query(`select public._cancelar_rolo_core($1)`, [rolo]);
      expect((await r15Core(c, f.vari)).fisico).toBe(80);
    });
  });
});

describe.skipIf(!hasDb)("R15a est #2 — painel Estoque por OC = core repartido pelos vínculos", () => {
  it("reserva repartida pela prioridade/teto do vínculo; card sem vínculo vira 'Reserva sem OC'; Σ ≤ core", async () => {
    await withTx(async (c) => {
      const f = await r15Fixture(c);
      const ocA = await r15Oc(c, "encomendado", "ITEST-R15A-PA");
      const itA = await r15Item(c, ocA, f.art, f.vari, 200, null);
      const ocB = await r15Oc(c, "recebido", "ITEST-R15A-PB");
      const itB = await r15Item(c, ocB, f.art, f.vari, 300, 300);
      const m1 = await r15Card(c, f.art, f.vari, 100, "ITEST-R15A-M1");
      await r15Link(c, m1, f.vari, itB, 30, 1); // prioridade 1, teto 30
      await r15Link(c, m1, f.vari, itA, 0, 2);  // último: leva o resto (70)
      await r15Card(c, f.art, f.vari, 50, "ITEST-R15A-M2"); // sem vínculo

      const core = await r15Core(c, f.vari);
      expect(core.reservado).toBe(150);
      const p = await r15Painel(c, f.vari);
      const rB = p.find((r) => r.oc_tecido_item_id === itB);
      const rA = p.find((r) => r.oc_tecido_item_id === itA);
      expect(Number(rB.reservado_m)).toBe(30); // antes: 100 em CADA vínculo (Σ 200 > core 150)
      expect(Number(rA.reservado_m)).toBe(70);
      expect(core.reservado - somaPainel(p, "reservado_m")).toBe(50); // "Reserva sem OC" (front) = o card sem vínculo
      expect(somaPainel(p, "prev_receb_m")).toBe(core.prev_receb_m);
      expect(somaPainel(p, "recebido_m")).toBe(core.recebido_m);

      // libera com enviado_corte (mesmo sem baixa no ledger), como o core
      const cad = (await um<{ id: string }>(c, `insert into cad (tenant_id,modelo_id,enviado_corte) values ($1,$2,true) returning id`, [TENANT_TESTE, m1])).id;
      expect(cad).toBeTruthy();
      expect((await r15Core(c, f.vari)).reservado).toBe(50);
      expect(somaPainel(await r15Painel(c, f.vari), "reservado_m")).toBe(0);
    });
  });

  it("card REPROVADO não reserva no painel (como no core)", async () => {
    await withTx(async (c) => {
      const f = await r15Fixture(c);
      const oc = await r15Oc(c, "recebido", "ITEST-R15A-REP");
      const it = await r15Item(c, oc, f.art, f.vari, 100, 100);
      const m = await r15Card(c, f.art, f.vari, 40, "ITEST-R15A-REPR");
      await r15Link(c, m, f.vari, it, 0, 1);
      expect(somaPainel(await r15Painel(c, f.vari), "reservado_m")).toBe(40);
      await c.query(`update modelos set status_desenvolvimento='reprovado' where id=$1`, [m]);
      expect((await r15Core(c, f.vari)).reservado).toBe(0);
      expect(somaPainel(await r15Painel(c, f.vari), "reservado_m")).toBe(0); // antes: 40
    });
  });

  it("anti-drift em TODAS as variantes da cópia: Σ painel (recebido/baixa/a receber) = core e Σ reservado ≤ core (SUZY OFF WHITE)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const tenants = (await c.query(`select id, nome from tenants order by nome`)).rows as { id: string; nome: string }[];
      if (!tenants.length) throw new Error("fixture ausente: nenhuma loja");
      let n = 0;
      const ruins: string[] = [];
      let suzy: number | null = null;
      for (const t of tenants) {
        await c.query(`update users set tenant_id=$1 where id=$2`, [t.id, USER_TESTE]);
        const rows = (await c.query(
          `select c.variante_tecido_id vid, c.recebido_m, c.baixa, c.prev_receb_m, c.reservado,
                  (select coalesce(sum(oi.baixa),0) from ordens_saida_tecido_itens oi
                     join ordens_saida_tecido os on os.id=oi.ordem_saida_id and os.tenant_id=$1 and os.baixado
                    where oi.variante_tecido_id=c.variante_tecido_id) os_bx,
                  public.detalhe_estoque_variante(c.variante_tecido_id) j
             from public._estoque_tecido_core($1) c`, [t.id])).rows;
        for (const r of rows) {
          n++;
          const j = r.j as any[];
          const d = (a: number, b: number) => Math.abs(a - b) > 0.0001;
          const resP = somaPainel(j, "reservado_m");
          if (d(somaPainel(j, "recebido_m"), Number(r.recebido_m))) ruins.push(`${t.nome}:${r.vid} recebido`);
          if (d(somaPainel(j, "baixado_m") + Number(r.os_bx), Number(r.baixa))) ruins.push(`${t.nome}:${r.vid} baixa`);
          if (d(somaPainel(j, "prev_receb_m"), Number(r.prev_receb_m))) ruins.push(`${t.nome}:${r.vid} a receber`);
          if (resP > Number(r.reservado) + 0.0001) ruins.push(`${t.nome}:${r.vid} reserva painel ${resP} > core ${r.reservado}`);
          if (r.vid === "8fdbc875-1126-4e72-b163-d210f977b54a") suzy = Number(r.reservado) - resP;
        }
      }
      const total = Number((await um<{ n: string }>(c, `select count(*) n from variantes_tecido`)).n);
      expect(n).toBe(total);
      expect(n).toBeGreaterThan(0);
      expect(ruins).toEqual([]); // antes da R15a: 17 (Ave Rara) + 2 (Loja Teste) com reserva do painel > core
      if (suzy === null) throw new Error("fixture ausente: SUZY OFF WHITE (Ave Rara 8fdbc875) nao esta na copia");
      expect(suzy).toBeGreaterThanOrEqual(0); // "Reserva sem OC" ≥ 0 (antes: −3885)
    });
  });
});

describe.skipIf(!hasDb)("R15a B1 — picker de vínculo (ocs_disponiveis_variante) com a regra do core", () => {
  it("MALHA BEGÔNIA (Ave Rara) recebida sem quantidade aparece com ~547 m disponíveis (menos vínculos)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const it = await um<{ item: string; vari: string; tenant: string } | undefined>(c,
        `select it.id item, it.variante_tecido_id vari, oc.tenant_id tenant
           from ocs_tecido_itens it join ocs_tecido oc on oc.id=it.oc_tecido_id join artigos a on a.id=it.artigo_id
           join tenants tn on tn.id=oc.tenant_id
          where tn.nome='Ave Rara' and a.nome ilike 'MALHA BEG%NIA' and oc.status='recebido'
            and it.quantidade_recebida is null and not coalesce(it.cancelado,false)
          order by it.quantidade_pedida desc limit 1`);
      if (!it) throw new Error("fixture ausente: MALHA BEGONIA recebida sem quantidade (Ave Rara)");
      await c.query(`update users set tenant_id=$1 where id=$2`, [it.tenant, USER_TESTE]);
      const lista = (await um<{ j: any[] }>(c, `select public.ocs_disponiveis_variante($1, null) j`, [it.vari])).j;
      const linha = lista.find((r) => r.oc_tecido_item_id === it.item);
      expect(linha).toBeTruthy();
      const saldo = Number((await um<{ s: string }>(c, `select saldo_m s from public.saldo_oc_item_m($1)`, [it.item])).s);
      const vinc = Number((await um<{ m: string }>(c,
        `select coalesce(sum(l.quantidade_m),0) m from modelo_tecido_oc_links l where l.oc_tecido_item_id=$1
            and not exists (select 1 from cad cd join estoque_tecido_baixas b on b.cad_id=cd.id where cd.modelo_id=l.modelo_id)`, [it.item])).m);
      expect(saldo).toBeGreaterThan(540); // 160,9 kg × 3,4
      expect(Number(linha.disponivel_m)).toBeCloseTo(saldo - vinc, 4); // antes: 0 − vínculos
      // toda linha de OC recebida = saldo_oc_item_m − vínculos de outros cards
      for (const r of lista.filter((x) => x.recebida)) {
        const s = Number((await um<{ s: string }>(c, `select saldo_m s from public.saldo_oc_item_m($1)`, [r.oc_tecido_item_id])).s);
        const v = Number((await um<{ m: string }>(c,
          `select coalesce(sum(l.quantidade_m),0) m from modelo_tecido_oc_links l where l.oc_tecido_item_id=$1
              and not exists (select 1 from cad cd join estoque_tecido_baixas b on b.cad_id=cd.id where cd.modelo_id=l.modelo_id)`,
          [r.oc_tecido_item_id])).m);
        expect(Number(r.disponivel_m)).toBeCloseTo(s - v, 4);
      }
    });
  });

  it("reposição de troca ainda não recebida: 0 disponível no picker (antes: a pedida)", async () => {
    await withTx(async (c) => {
      const f = await r15Fixture(c);
      const oc = await r15Oc(c, "recebido", "ITEST-R15A-TROCA");
      const orig = await r15Item(c, oc, f.art, f.vari, 70, 70);
      const rep = await r15Item(c, oc, f.art, f.vari, 40, null, orig);
      const lista = (await um<{ j: any[] }>(c, `select public.ocs_disponiveis_variante($1, null) j`, [f.vari])).j;
      expect(Number(lista.find((r) => r.oc_tecido_item_id === orig).disponivel_m)).toBe(70);
      expect(Number(lista.find((r) => r.oc_tecido_item_id === rep).disponivel_m)).toBe(0);
    });
  });
});
