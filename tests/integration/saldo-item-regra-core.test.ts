import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Achados MEDIOS R11 (est #3, est #10, entregue_m da Situação por OC) — migration 20261021100000.
// O saldo por item de OC de tecido passa a seguir a MESMA regra da CTE `receb` de `_estoque_tecido_core` (inv. #4):
//   * só OC RECEBIDA e item NÃO cancelado têm saldo (OC encomendada / item cancelado → 0);
//   * recebido = quantidade_recebida, senão a pedida (0 se o item é reposição de troca); kg → m pelo rendimento;
//   * saldo = recebido − baixas do ledger DO PRÓPRIO item.
// Consumidores: saldo_oc_item_m (corte Fase 1/Fase 2, "- Metragem", criar rolo), rolo_supply da prévia do
// Plan. Tecido e o entregue_m da Situação por OC. Tudo em txn revertida (nada grava).

async function preparar(c: Client) {
  await comoUsuario(c);
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true,"entrada_saida":true}'::jsonb)
     on conflict (tenant_id) do update set modules = coalesce(tenant_config.modules,'{}'::jsonb) || '{"criacao":true,"otb":true,"entrada_saida":true}'::jsonb`,
    [TENANT_TESTE],
  );
  await c.query(`update tenant_config set modo_baixa_estoque='por_oc' where tenant_id=$1`, [TENANT_TESTE]);
  const art = await um<{ id: string } | undefined>(
    c, `select id from artigos where tenant_id=$1 and unidade_medida='metro' order by id limit 1`, [TENANT_TESTE]);
  // fix round 1 (B2): sem fixture o teste FALHA alto (nunca passa vazio)
  if (!art) throw new Error("fixture ausente: a Loja Teste nao tem artigo em metro");
  // variante NOVA (sem cor → fora dos índices únicos): isola o cenário do estoque real da loja
  const v = await um<{ id: string }>(
    c, `insert into variantes_tecido (tenant_id, artigo_id, nome_variante) values ($1,$2,'ITEST-R11') returning id`,
    [TENANT_TESTE, art.id]);
  return { art: art.id, vari: v.id };
}

async function novaOc(c: Client, status: "recebido" | "encomendado", numero: string) {
  return (await um<{ id: string }>(
    c, `insert into ocs_tecido (tenant_id,status,numero_pedido,data_pedido,data_entrega) values ($1,$2,$3,current_date,current_date) returning id`,
    [TENANT_TESTE, status, numero])).id;
}

async function novoItem(
  c: Client, oc: string, art: string, vari: string, pedida: number, recebida: number | null,
  extra: { cancelado?: boolean; substitui?: string } = {},
) {
  return (await um<{ id: string }>(
    c, `insert into ocs_tecido_itens (oc_tecido_id,artigo_id,variante_tecido_id,quantidade_pedida,quantidade_recebida,cancelado,substitui_item_id)
        values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [oc, art, vari, pedida, recebida, extra.cancelado ?? false, extra.substitui ?? null])).id;
}

async function saldo(c: Client, item: string): Promise<number> {
  return Number((await um<{ s: string }>(c, `select saldo_m s from public.saldo_oc_item_m($1)`, [item])).s);
}

/** modelo + CAD com 1 variante a cortar (tecido 1, ordem 1) e vínculo explícito ao item da OC. */
async function cadComVinculo(c: Client, art: string, vari: string, item: string, metragem: number) {
  const mod = (await um<{ id: string }>(c, `insert into modelos (tenant_id,nome) values ($1,'ITEST-R11-corte') returning id`, [TENANT_TESTE])).id;
  const cad = (await um<{ id: string }>(c, `insert into cad (tenant_id,modelo_id) values ($1,$2) returning id`, [TENANT_TESTE, mod])).id;
  const ct = (await um<{ id: string }>(c, `insert into cad_tecidos (cad_id,artigo_id,numero,tipo) values ($1,$2,1,'tecido') returning id`, [cad, art])).id;
  await c.query(`insert into cad_tecido_variantes (cad_tecido_id,variante_tecido_id,ordem,metragem_enviada) values ($1,$2,1,$3)`, [ct, vari, metragem]);
  await c.query(
    `insert into modelo_tecido_oc_links (tenant_id,modelo_id,tipo,numero,ordem,variante_tecido_id,oc_tecido_item_id,quantidade_m,prioridade)
     values ($1,$2,'tecido',1,1,$3,$4,0,1)`, [TENANT_TESTE, mod, vari, item]);
  return cad;
}

async function cortar(c: Client, cad: string) {
  return (await um<{ r: any }>(c, `select public.baixar_estoque_tecido_corte($1) r`, [cad])).r;
}

async function baixaNoItem(c: Client, item: string): Promise<number> {
  return Number((await um<{ m: string }>(c,
    `select coalesce(sum(quantidade),0) m from estoque_tecido_baixas where oc_tecido_item_id=$1`, [item])).m);
}

describe.skipIf(!hasDb)("R11 — saldo por item com a regra do core (saldo_oc_item_m)", () => {
  it("item recebido SEM quantidade numa OC recebida → saldo = pedida; o corte não dá déficit falso", async () => {
    await withTx(async (c) => {
      const f = await preparar(c);
      const oc = await novaOc(c, "recebido", "ITEST-R11-A");
      const it = await novoItem(c, oc, f.art, f.vari, 100, null);
      expect(await saldo(c, it)).toBe(100); // antes: 0 (COALESCE(recebida,0))
      const cad = await cadComVinculo(c, f.art, f.vari, it, 60);
      const r = await cortar(c, cad);
      expect(Number(r.deficit_total)).toBe(0); // antes: 60 de "Faltou estoque" falso
      expect(await baixaNoItem(c, it)).toBe(60);
      expect(await saldo(c, it)).toBe(40);
      const def = await um<{ d: any }>(c, `select deficit_corte d from cad where id=$1`, [cad]);
      expect(def.d).toBeNull();
    });
  });

  it("reposição de troca sem quantidade recebida → 0 (não usa a pedida)", async () => {
    await withTx(async (c) => {
      const f = await preparar(c);
      const oc = await novaOc(c, "recebido", "ITEST-R11-T");
      const orig = await novoItem(c, oc, f.art, f.vari, 100, 100, { cancelado: true });
      const rep = await novoItem(c, oc, f.art, f.vari, 100, null, { substitui: orig });
      expect(await saldo(c, rep)).toBe(0);
      await c.query(`update ocs_tecido_itens set quantidade_recebida=90 where id=$1`, [rep]);
      expect(await saldo(c, rep)).toBe(90);
    });
  });

  it("item CANCELADO → 0 (mesmo com recebida e baixa); o corte não baixa dele", async () => {
    await withTx(async (c) => {
      const f = await preparar(c);
      const oc = await novaOc(c, "recebido", "ITEST-R11-C");
      const it = await novoItem(c, oc, f.art, f.vari, 100, 100, { cancelado: true });
      expect(await saldo(c, it)).toBe(0); // antes: 100
      await c.query(
        `insert into estoque_tecido_baixas (tenant_id,oc_tecido_item_id,variante_tecido_id,quantidade,origem) values ($1,$2,$3,30,'ajuste')`,
        [TENANT_TESTE, it, f.vari]);
      expect(await saldo(c, it)).toBe(0); // antes: 70; nunca negativo por estar fora
      const cad = await cadComVinculo(c, f.art, f.vari, it, 60);
      const r = await cortar(c, cad);
      expect(Number(r.deficit_total)).toBe(60); // variante nova, sem outro estoque
      expect(await baixaNoItem(c, it)).toBe(30); // só a de ajuste de antes
    });
  });

  it("item de OC NÃO RECEBIDA (encomendada com recebida preenchida) → 0: corte Fase 1, '- Metragem', criar rolo e Situação não usam", async () => {
    await withTx(async (c) => {
      const f = await preparar(c);
      const oc = await novaOc(c, "encomendado", "ITEST-R11-E");
      const it = await novoItem(c, oc, f.art, f.vari, 100, 100);
      expect(await saldo(c, it)).toBe(0); // antes: 100

      // corte Fase 1 (vínculo explícito): não baixa da OC encomendada → déficit cheio
      const cad = await cadComVinculo(c, f.art, f.vari, it, 60);
      const r = await cortar(c, cad);
      expect(Number(r.deficit_total)).toBe(60);
      expect(await baixaNoItem(c, it)).toBe(0);

      // "- Metragem": recusa (0 m disponíveis)
      await c.query("savepoint sp1");
      await expect(c.query(`select public.remover_metragem_oc($1, 10, 'teste')`, [it])).rejects.toThrow(/dispon/);
      await c.query("rollback to savepoint sp1");

      // criar rolo separando dessa origem: recusa
      await c.query("savepoint sp2");
      await expect(c.query(`select public.criar_rolo('ITEST-R11-ROLO-E', $1, $2::jsonb, $3)`,
        [f.art, JSON.stringify([{ variante_tecido_id: f.vari, metragem: 10 }]), it])).rejects.toThrow(/dispon/);
      await c.query("rollback to savepoint sp2");

      // Situação por OC: entregue 0 (OC não recebida)
      const col = (await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('ITEST-R11-SIT-E','rascunho') returning id`)).id;
      await c.query(`insert into plan_tecido_ocs (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, col, oc]);
      const s = await um<{ p: string; e: string }>(c,
        `select pedida_m p, entregue_m e from public.plan_tecido_situacao_ocs($1) where oc_tecido_id=$2`, [col, oc]);
      expect(Number(s.p)).toBe(100);
      expect(Number(s.e)).toBe(0); // antes: 100

      // ao receber a OC, o saldo volta
      await c.query(`update ocs_tecido set status='recebido' where id=$1`, [oc]);
      expect(await saldo(c, it)).toBe(100);
    });
  });

  it("Situação por OC: entregue = pedida quando falta a recebida numa OC recebida (0 se troca)", async () => {
    await withTx(async (c) => {
      const f = await preparar(c);
      const col = (await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('ITEST-R11-SIT','rascunho') returning id`)).id;
      const oc = await novaOc(c, "recebido", "ITEST-R11-S");
      await novoItem(c, oc, f.art, f.vari, 80, null);
      await c.query(`insert into plan_tecido_ocs (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, col, oc]);
      const s = await um<{ p: string; e: string }>(c,
        `select pedida_m p, entregue_m e from public.plan_tecido_situacao_ocs($1) where oc_tecido_id=$2`, [col, oc]);
      expect(Number(s.p)).toBe(80);
      expect(Number(s.e)).toBe(80); // antes: 0

      // reposição de troca sem recebida → entregue 0
      const oc2 = await novaOc(c, "recebido", "ITEST-R11-S2");
      const orig = await novoItem(c, oc2, f.art, f.vari, 50, 50, { cancelado: true });
      await novoItem(c, oc2, f.art, f.vari, 50, null, { substitui: orig });
      await c.query(`insert into plan_tecido_ocs (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, col, oc2]);
      const s2 = await um<{ n: string; e: string }>(c,
        `select count(*) n, sum(entregue_m) e from public.plan_tecido_situacao_ocs($1) where oc_tecido_id=$2`, [col, oc2]);
      expect(Number(s2.n)).toBe(1); // o cancelado fica fora (como antes)
      expect(Number(s2.e)).toBe(0);
    });
  });
});

describe.skipIf(!hasDb)("R11 — artigo em kg (rendimento): saldo e Situação convertem para metros", () => {
  it("kg: recebida, senão pedida, × rendimento — em saldo_oc_item_m e no entregue_m da Situação", async () => {
    await withTx(async (c) => {
      const f = await preparar(c); // liga módulos + modo por_oc (a variante em metro não é usada aqui)
      expect(f.art).toBeTruthy();
      // artigo NOVO em kg com rendimento 3,5 m/kg (isola do cadastro real)
      const art = (await um<{ id: string }>(c,
        `insert into artigos (tenant_id,nome,unidade_medida,rendimento) values ($1,'ITEST-R11-KG','kg',3.5) returning id`, [TENANT_TESTE])).id;
      const vari = (await um<{ id: string }>(c,
        `insert into variantes_tecido (tenant_id,artigo_id,nome_variante) values ($1,$2,'ITEST-R11-KG') returning id`, [TENANT_TESTE, art])).id;
      const oc = await novaOc(c, "recebido", "ITEST-R11-KG");
      const semRec = await novoItem(c, oc, art, vari, 10, null); // 10 kg pedidos, recebida ausente
      const comRec = await novoItem(c, oc, art, vari, 10, 8);    // 8 kg recebidos
      expect(await saldo(c, semRec)).toBeCloseTo(35, 6); // 10 × 3,5 (antes: 0)
      expect(await saldo(c, comRec)).toBeCloseTo(28, 6); // 8 × 3,5
      await c.query(
        `insert into estoque_tecido_baixas (tenant_id,oc_tecido_item_id,variante_tecido_id,quantidade,origem) values ($1,$2,$3,7,'ajuste')`,
        [TENANT_TESTE, comRec, vari]);
      expect(await saldo(c, comRec)).toBeCloseTo(21, 6); // baixa do ledger já é em metros

      const col = (await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('ITEST-R11-KG','rascunho') returning id`)).id;
      await c.query(`insert into plan_tecido_ocs (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, col, oc]);
      const s = await um<{ p: string; e: string }>(c,
        `select sum(pedida_m) p, sum(entregue_m) e from public.plan_tecido_situacao_ocs($1) where oc_tecido_id=$2`, [col, oc]);
      expect(Number(s.p)).toBeCloseTo(70, 6); // (10 + 10) × 3,5
      expect(Number(s.e)).toBeCloseTo(63, 6); // (10 pedida + 8 recebida) × 3,5 (antes: 28)

      // OC em kg ainda ENCOMENDADA → saldo e entregue 0
      await c.query(`update ocs_tecido set status='encomendado' where id=$1`, [oc]);
      expect(await saldo(c, comRec)).toBe(0);
      const s2 = await um<{ e: string }>(c,
        `select sum(entregue_m) e from public.plan_tecido_situacao_ocs($1) where oc_tecido_id=$2`, [col, oc]);
      expect(Number(s2.e)).toBe(0);
    });
  });
});

describe.skipIf(!hasDb)("R11 — rolo: saldo do PRÓPRIO item (est #10)", () => {
  const ARVORE = (art: string, varId: string, grade = 100) => ({
    subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [{ linha_id: null, categoria_id: null, ordem: 0,
      slots: [{ modelo_id: null, slot_index: 0, custos_adicionais: [], materiais: [
        { artigo_id: art, tipo: "tecido", numero: 1, consumo: 1, loss_percent: 0, ordem: 0,
          variantes: [{ variante_tecido_id: varId, ordem: 1, multiplicador: 1, grades: { M: grade }, grade_total: grade }] }] }] }] }],
  });
  async function colComPlano(c: Client, nome: string, art: string, vari: string, grade = 100) {
    const col = (await um<{ id: string }>(c, `insert into colecoes (nome, status) values ($1,'rascunho') returning id`, [nome])).id;
    await um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col, JSON.stringify(ARVORE(art, vari, grade))]);
    return col;
  }
  async function slotDa(c: Client, col: string) {
    return (await um<{ id: string }>(c,
      `select sl.id from plan_tecido p join plan_tecido_subcolecoes s on s.plan_id=p.id join plan_tecido_linhas l on l.sub_id=s.id
         join plan_tecido_slots sl on sl.linha_ref_id=l.id where p.colecao_id=$1 limit 1`, [col])).id;
  }
  /** OC recebida com 1 item de 100 m (a origem do rolo). */
  async function origemERolo(c: Client, f: { art: string; vari: string }, numero: string) {
    const oc = await novaOc(c, "recebido", numero);
    const orig = await novoItem(c, oc, f.art, f.vari, 100, 100);
    return { oc, orig };
  }
  /** criar_rolo de 40 m a partir da origem; o rolo vai para um slot da coleção por hint (plan_tecido_slot_oc). */
  async function separarERoloNoSlot(c: Client, f: { art: string; vari: string }, col: string, orig: string, codigo: string) {
    const rolo = (await um<{ id: string }>(c, `select public.criar_rolo($1, $2, $3::jsonb, $4) id`,
      [codigo, f.art, JSON.stringify([{ variante_tecido_id: f.vari, metragem: 40 }]), orig])).id;
    await c.query(`insert into plan_tecido_slot_oc (tenant_id,colecao_id,slot_id,oc_tecido_id) values ($1,$2,$3,$4)`,
      [TENANT_TESTE, col, await slotDa(c, col), rolo]);
    return rolo;
  }
  async function deficitDe(c: Client, col: string, vari: string): Promise<number | null> {
    const previa = (await um<{ p: any }>(c, `select public.plan_tecido_previa_pedido($1) p`, [col])).p;
    const row = ((previa?.cobertura ?? []) as any[]).find((r) => r.variante_tecido_id === vari);
    return row ? Number(row.deficit_m) : null;
  }
  async function itemDoRolo(c: Client, rolo: string) {
    return (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id=$1`, [rolo])).id;
  }

  it("rolo SEPARADO cobre o próprio físico (não 0); a origem fica com recebido − separação", async () => {
    await withTx(async (c) => {
      const f = await preparar(c);
      const oc = await novaOc(c, "recebido", "ITEST-R11-ORIG");
      const orig = await novoItem(c, oc, f.art, f.vari, 100, 100);
      const rolo = (await um<{ id: string }>(c, `select public.criar_rolo('ITEST-R11-SEP', $1, $2::jsonb, $3) id`,
        [f.art, JSON.stringify([{ variante_tecido_id: f.vari, metragem: 40 }]), orig])).id;
      const itRolo = await itemDoRolo(c, rolo);
      expect(await saldo(c, itRolo)).toBe(40);
      expect(await saldo(c, orig)).toBe(60);

      const col = await colComPlano(c, "ITEST-R11-PREV-SEP", f.art, f.vari);
      await c.query(`insert into plan_tecido_oc_aplicada (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, col, rolo]);
      // nec 100 − saldo do rolo 40 = 60 (antes: pedida 40 − separacao_rolo 40 = 0 → déficit 100)
      expect(await deficitDe(c, col, f.vari)).toBe(60);
    });
  });

  it("rolo AVULSO desconta corte e ajuste do próprio item", async () => {
    await withTx(async (c) => {
      const f = await preparar(c);
      const rolo = (await um<{ id: string }>(c, `select public.criar_rolo('ITEST-R11-AVU', $1, $2::jsonb, null) id`,
        [f.art, JSON.stringify([{ variante_tecido_id: f.vari, metragem: 50 }])])).id;
      const itRolo = await itemDoRolo(c, rolo);
      expect(await saldo(c, itRolo)).toBe(50);
      await um(c, `select public.remover_metragem_oc($1, 10, 'ITEST ajuste')`, [itRolo]);
      const cad = await cadComVinculo(c, f.art, f.vari, itRolo, 15);
      const r = await cortar(c, cad);
      expect(Number(r.deficit_total)).toBe(0);
      expect(await saldo(c, itRolo)).toBe(25);

      const col = await colComPlano(c, "ITEST-R11-PREV-AVU", f.art, f.vari);
      await c.query(`insert into plan_tecido_ocs (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, col, rolo]);
      // nec 100 − saldo do rolo 25 = 75 (antes: pedida 50 sem descontar corte/ajuste → 50)
      expect(await deficitDe(c, col, f.vari)).toBe(75);
    });
  });

  // fix round 1 (M1 da G-MIGRATION): o rolo separado de uma OC que JÁ credita a coleção no supply não pode
  // creditar de novo (o supply conta a origem pela PEDIDA, que a separação não baixa). Necessidade 120.
  it("M1: OC PRÓPRIA de 100 m + rolo de 40 m separado dela no slot da MESMA coleção → déficit 20 (não 0)", async () => {
    await withTx(async (c) => {
      const f = await preparar(c);
      const col = await colComPlano(c, "ITEST-R11-M1-PROPRIA", f.art, f.vari, 120);
      const { oc, orig } = await origemERolo(c, f, "ITEST-R11-M1-P");
      await c.query(`insert into plan_tecido_ocs (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, col, oc]);
      expect(await deficitDe(c, col, f.vari)).toBe(20);
      await separarERoloNoSlot(c, f, col, orig, "ITEST-R11-M1-P-ROLO");
      expect(await deficitDe(c, col, f.vari)).toBe(20); // sem o fix: 0 (40 m contados 2×)
    });
  });

  it("M1: OC NÃO-PRÓPRIA com card (has_card) + rolo separado dela no slot da mesma coleção → déficit 20", async () => {
    await withTx(async (c) => {
      const f = await preparar(c);
      const col = await colComPlano(c, "ITEST-R11-M1-CARD", f.art, f.vari, 120);
      const { oc, orig } = await origemERolo(c, f, "ITEST-R11-M1-C");
      await c.query(`insert into plan_tecido_oc_aplicada (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, col, oc]);
      const mod = (await um<{ id: string }>(c, `insert into modelos (tenant_id,colecao_id,nome) values ($1,$2,'ITEST-R11-M1-card') returning id`, [TENANT_TESTE, col])).id;
      await c.query(`insert into modelo_tecido_oc_links (tenant_id,modelo_id,tipo,numero,ordem,variante_tecido_id,oc_tecido_item_id)
                     values ($1,$2,'tecido',1,1,$3,$4)`, [TENANT_TESTE, mod, f.vari, orig]);
      expect(await deficitDe(c, col, f.vari)).toBe(20); // OC órfã com card → pedida cheia 100
      await separarERoloNoSlot(c, f, col, orig, "ITEST-R11-M1-C-ROLO");
      expect(await deficitDe(c, col, f.vari)).toBe(20); // sem o fix: 0
    });
  });

  it("M1: rolo cuja OC de origem NÃO credita a coleção (fora dela, ou só 'aplicada' sem card) continua contando", async () => {
    await withTx(async (c) => {
      const f = await preparar(c);
      // (a) origem fora da coleção
      const colA = await colComPlano(c, "ITEST-R11-M1-FORA", f.art, f.vari, 120);
      const a = await origemERolo(c, f, "ITEST-R11-M1-F");
      await separarERoloNoSlot(c, f, colA, a.orig, "ITEST-R11-M1-F-ROLO");
      expect(await deficitDe(c, colA, f.vari)).toBe(80); // 120 − 40 do rolo
      // (b) origem só "aplicada" (acompanhamento, sem card) → não credita no supply → o rolo conta
      const colB = await colComPlano(c, "ITEST-R11-M1-APLIC", f.art, f.vari, 120);
      const b = await origemERolo(c, f, "ITEST-R11-M1-A");
      await c.query(`insert into plan_tecido_oc_aplicada (tenant_id,colecao_id,oc_tecido_id) values ($1,$2,$3)`, [TENANT_TESTE, colB, b.oc]);
      expect(await deficitDe(c, colB, f.vari)).toBe(120);
      await separarERoloNoSlot(c, f, colB, b.orig, "ITEST-R11-M1-A-ROLO");
      expect(await deficitDe(c, colB, f.vari)).toBe(80);
    });
  });
});

describe.skipIf(!hasDb)("R11 — equivalência com _estoque_tecido_core em TODOS os itens da cópia", () => {
  it("Σ saldo_oc_item_m por variante = recebido_m − baixa do ledger do core (TODOS os itens, inclusive a origem de rolo — R15a est #4)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c); // usuário de teste = super admin → saldo_oc_item_m enxerga todas as lojas
      const sa = await um<{ ok: boolean }>(c, `select public.is_super_admin() ok`);
      expect(sa.ok, "o usuario de teste precisa ser super admin para ver todas as lojas").toBe(true);
      // Diferenças DELIBERADAS (documentadas na migration e no relatório da R11):
      //  * item de ORIGEM de rolo: desde a R15a (est #4, 20261025100000) o core o conta (recebido − separação − baixas) →
      //    entra dos DOIS lados (antes da R15a ficava fora dos dois);
      //  * baixa de ordem de saída (os_baixa) é por variante no core, sem item → somada de volta ao lado do core;
      //  * o clamp >= 0 do core é no físico por variante; aqui comparamos recebido − baixa SEM clamp.
      const r = await um<{ n_var: string; n_dif: string; detalhe: any }>(c, `
        with por_item as (
          select oc.tenant_id, i.variante_tecido_id, s.saldo_m
            from ocs_tecido_itens i
            join ocs_tecido oc on oc.id = i.oc_tecido_id
            cross join lateral public.saldo_oc_item_m(i.id) s
           where i.variante_tecido_id is not null
        ),
        soma as (select tenant_id, variante_tecido_id, sum(saldo_m) m from por_item group by 1,2),
        os_bx as (
          select os.tenant_id, oi.variante_tecido_id, sum(coalesce(oi.baixa,0)) m
            from ordens_saida_tecido_itens oi join ordens_saida_tecido os on os.id = oi.ordem_saida_id and os.baixado
           where oi.variante_tecido_id is not null group by 1,2
        ),
        core as (
          select t.id tenant_id, e.variante_tecido_id, e.recebido_m - e.baixa + coalesce(ob.m,0) m
            from tenants t cross join lateral public._estoque_tecido_core(t.id) e
            left join os_bx ob on ob.tenant_id = t.id and ob.variante_tecido_id = e.variante_tecido_id
        ),
        cmp as (
          select coalesce(s.tenant_id, k.tenant_id) tenant_id, coalesce(s.variante_tecido_id, k.variante_tecido_id) v,
                 coalesce(s.m,0) item_m, coalesce(k.m,0) core_m
            from soma s full join core k on k.tenant_id = s.tenant_id and k.variante_tecido_id = s.variante_tecido_id
        )
        select count(*) n_var, count(*) filter (where item_m <> core_m) n_dif,
               jsonb_agg(jsonb_build_object('v', v, 'item', item_m, 'core', core_m)) filter (where item_m <> core_m) detalhe
          from cmp`);
      expect(Number(r.n_var)).toBeGreaterThan(0);
      expect(r.detalhe).toBeNull();
      expect(Number(r.n_dif)).toBe(0);

      // e todo item fora da regra (cancelado ou de OC não recebida) tem saldo exatamente 0
      const fora = await um<{ n: string; nz: string }>(c, `
        select count(*) n, count(*) filter (where s.saldo_m <> 0) nz
          from ocs_tecido_itens i join ocs_tecido oc on oc.id = i.oc_tecido_id
          cross join lateral public.saldo_oc_item_m(i.id) s
         where coalesce(i.cancelado,false) or oc.status is distinct from 'recebido'`);
      expect(Number(fora.nz)).toBe(0);
    });
  });

  it("guarda da R11: as 3 funções com o texto de depois e os 3 chamadores intocados", async () => {
    await withTx(async (c) => {
      const r = await c.query(`
        select v.s, md5(pg_get_functiondef(to_regprocedure(v.s))) = any(string_to_array(v.m, ',')) ok from (values
          ('public.saldo_oc_item_m(uuid)',                             '873789084182322f0b28b315d06b0dbc'),
          -- R11 depois OU R15b (20261025400000, P-198 A + fix1: so tira o card reprovado nao cortado do oc_link/comprometida_m;
          -- rolo_supply e entregue_m da R11 intactos)
          ('public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])', 'deefee4cadec3e5434aea0de970acc5f,b62ef170570b2444ad3f5727760cd411'),
          ('public._plan_tecido_situacao_ocs_core(uuid,uuid)',         '29d4953a5ea039b9d995db12c511c8ae,368bc7530510b934a0ca33e8efa69116'),
          ('public._baixar_estoque_tecido_corte_core(uuid)',           '2a6f0ef24da6f9e8b9c68f63e3863577'),
          ('public._remover_metragem_oc_core(uuid,numeric,text)',      '635774e13418a33af6880f16728575c5'),
          ('public._criar_rolo_core(text,uuid,jsonb,uuid,text,text)',  'ae0815c3f887ab909af6b5c83fdd6e27')) v(s,m)`);
      for (const row of r.rows) expect({ s: row.s, ok: row.ok }).toEqual({ s: row.s, ok: true });
      const acl = await um<{ a: boolean; b: boolean; d: boolean }>(c, `select
        has_function_privilege('anon','public.saldo_oc_item_m(uuid)','EXECUTE') a,
        has_function_privilege('authenticated','public._plan_tecido_previa_pedido_core(uuid,uuid,uuid[])','EXECUTE') b,
        has_function_privilege('authenticated','public._plan_tecido_situacao_ocs_core(uuid,uuid)','EXECUTE') d`);
      expect(acl).toEqual({ a: false, b: false, d: false });
    });
  });
});
