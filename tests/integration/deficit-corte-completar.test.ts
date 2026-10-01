import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, dbUrl, ehBancoLocal } from "./db";

// Achados MEDIOS R15a, P-203 A (dono 01/out) — migration 20261025300000_completar_deficit_corte.
// Quando um item de OC de tecido PASSA A CONTAR (OC vira 'recebido', recebida gravada num item de OC recebida, rolo
// criado…), o banco completa a baixa dos cad com "Faltou estoque" (cad.deficit_corte) naquela variante: baixa SÓ o
// déficit, corte mais antigo primeiro, respeitando modo_baixa_estoque (por_oc: vínculo do card primeiro, depois FIFO);
// o que não couber fica no déficit; déficit zerado → deficit_corte NULL. Os gatilhos são ADIADOS (rodam no COMMIT); o
// teste roda em BEGIN…ROLLBACK, então força a execução com SET CONSTRAINTS … IMMEDIATE.
// Fixture ausente = o teste FALHA (nunca passa vazio).

const AVE_RARA_NOME = "Ave Rara";

async function flush(c: Client) {
  await c.query(`SET CONSTRAINTS trg_deficit_corte_item_ins, trg_deficit_corte_item_upd, trg_deficit_corte_oc IMMEDIATE`);
}

async function preparar(c: Client, modo: "por_oc" | "automatico" = "por_oc", unidade: "metro" | "kg" = "metro", rendimento = 0) {
  await comoUsuario(c);
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"entrada_saida":true,"producao":true,"criacao":true}'::jsonb)
     on conflict (tenant_id) do update set modules = coalesce(tenant_config.modules,'{}'::jsonb) || '{"entrada_saida":true,"producao":true,"criacao":true}'::jsonb`,
    [TENANT_TESTE]);
  await c.query(`update tenant_config set modo_baixa_estoque=$2 where tenant_id=$1`, [TENANT_TESTE, modo]);
  const art = (await um<{ id: string }>(c,
    `insert into artigos (tenant_id,nome,unidade_medida,rendimento) values ($1,'ITEST-P203',$2,$3) returning id`,
    [TENANT_TESTE, unidade, rendimento || null])).id;
  const vari = (await um<{ id: string }>(c,
    `insert into variantes_tecido (tenant_id,artigo_id,nome_variante) values ($1,$2,'ITEST-P203') returning id`, [TENANT_TESTE, art])).id;
  return { art, vari };
}

async function novaOc(c: Client, status: "recebido" | "encomendado", numero: string, tenant = TENANT_TESTE, dataEntrega = "2026-09-01") {
  return (await um<{ id: string }>(c,
    `insert into ocs_tecido (tenant_id,status,numero_pedido,data_pedido,data_entrega) values ($1,$2,$3,$4::date,$4::date) returning id`,
    [tenant, status, numero, dataEntrega])).id;
}

async function novoItem(c: Client, oc: string, art: string, vari: string, pedida: number, recebida: number | null) {
  return (await um<{ id: string }>(c,
    `insert into ocs_tecido_itens (oc_tecido_id,artigo_id,variante_tecido_id,quantidade_pedida,quantidade_recebida) values ($1,$2,$3,$4,$5) returning id`,
    [oc, art, vari, pedida, recebida])).id;
}

/** modelo + CAD (tecido 1, ordem 1, metragem enviada) com data de envio fixa; opcionalmente vinculado a um item. */
async function cardComCad(c: Client, art: string, vari: string, metragem: number, dataEnvio: string, vinculo?: { item: string; q: number }) {
  const mod = (await um<{ id: string }>(c, `insert into modelos (tenant_id,nome) values ($1,'ITEST-P203-card') returning id`, [TENANT_TESTE])).id;
  const cad = (await um<{ id: string }>(c,
    `insert into cad (tenant_id,modelo_id,data_enviado_corte) values ($1,$2,$3::date) returning id`, [TENANT_TESTE, mod, dataEnvio])).id;
  const ct = (await um<{ id: string }>(c,
    `insert into cad_tecidos (cad_id,artigo_id,numero,tipo) values ($1,$2,1,'tecido') returning id`, [cad, art])).id;
  await c.query(`insert into cad_tecido_variantes (cad_tecido_id,variante_tecido_id,ordem,metragem_enviada) values ($1,$2,1,$3)`, [ct, vari, metragem]);
  if (vinculo) {
    await c.query(
      `insert into modelo_tecido_oc_links (tenant_id,modelo_id,tipo,numero,ordem,variante_tecido_id,oc_tecido_item_id,quantidade_m,prioridade)
       values ($1,$2,'tecido',1,1,$3,$4,$5,1)`, [TENANT_TESTE, mod, vari, vinculo.item, vinculo.q]);
  }
  return cad;
}

async function cortar(c: Client, cad: string) {
  return (await um<{ r: any }>(c, `select public._baixar_estoque_tecido_corte_core($1) r`, [cad])).r;
}

async function deficit(c: Client, cad: string): Promise<any[] | null> {
  return (await um<{ d: any }>(c, `select deficit_corte d from cad where id=$1`, [cad])).d;
}

async function baixasDoCad(c: Client, cad: string): Promise<{ total: number; n: number; origens: string[] }> {
  const r = await um<{ t: string; n: string; o: string[] }>(c,
    `select coalesce(sum(quantidade),0) t, count(*) n, coalesce(array_agg(distinct origem),'{}') o from estoque_tecido_baixas where cad_id=$1`, [cad]);
  return { total: Number(r.t), n: Number(r.n), origens: r.o };
}

describe.skipIf(!hasDb)("P-203 A — completar o 'Faltou estoque' do corte quando o tecido chega", () => {
  it("2 cards em déficit + OC chega com metade: o mais antigo completa, o outro fica em parte; idempotente; card sem déficit intocado", async () => {
    await withTx(async (c) => {
      const f = await preparar(c, "automatico");
      // card C (sem déficit): corta 30 de uma OC que tem 30
      const oc0 = await novaOc(c, "recebido", "ITEST-P203-0", TENANT_TESTE, "2026-01-01");
      await novoItem(c, oc0, f.art, f.vari, 30, 30);
      const cadC = await cardComCad(c, f.art, f.vari, 30, "2026-01-05");
      expect(Number((await cortar(c, cadC)).deficit_total)).toBe(0);
      const cBefore = await baixasDoCad(c, cadC);
      // A (mais antigo) e B: 100 cada, sem estoque → déficit 100 cada
      const cadA = await cardComCad(c, f.art, f.vari, 100, "2026-02-01");
      const cadB = await cardComCad(c, f.art, f.vari, 100, "2026-03-01");
      await cortar(c, cadB);
      await cortar(c, cadA);
      expect(Number((await deficit(c, cadA))![0].deficit)).toBe(100);
      expect(Number((await deficit(c, cadB))![0].deficit)).toBe(100);

      // chega uma OC com 150 (metade do que falta... 150 de 200): encomendada → recebida (status muda)
      const oc = await novaOc(c, "encomendado", "ITEST-P203-1");
      await novoItem(c, oc, f.art, f.vari, 150, 150);
      await flush(c);
      expect(Number((await deficit(c, cadA))![0].deficit)).toBe(100); // OC ainda encomendada: nada
      await c.query(`update ocs_tecido set status='recebido' where id=$1`, [oc]);
      await flush(c);

      expect(await deficit(c, cadA)).toBeNull();                       // o mais antigo completou (selo some)
      expect((await baixasDoCad(c, cadA)).total).toBe(100);
      const dB = await deficit(c, cadB);
      expect(dB).toHaveLength(1);
      expect(Number(dB![0].deficit)).toBe(50);                          // o outro completou em parte
      expect(Number(dB![0].baixada)).toBe(50);
      expect(Number(dB![0].enviada)).toBe(100);
      expect((await baixasDoCad(c, cadB)).total).toBe(50);
      expect((await baixasDoCad(c, cadB)).origens).toEqual(["fifo"]);
      expect(await baixasDoCad(c, cadC)).toEqual(cBefore);              // card sem déficit: nada muda
      expect(Number((await um<{ f: string }>(c, `select fisico f from public._estoque_tecido_core($1) where variante_tecido_id=$2`, [TENANT_TESTE, f.vari])).f)).toBe(0);

      // idempotente: rodar de novo (helper direto e novo evento no item) não baixa nada
      const n0 = Number((await um<{ n: string }>(c, `select count(*) n from estoque_tecido_baixas where variante_tecido_id=$1`, [f.vari])).n);
      const r = (await um<{ r: any }>(c, `select public._completar_deficit_corte_variante($1,$2) r`, [TENANT_TESTE, f.vari])).r;
      expect(r).toMatchObject({ cads: 0, metros: 0 });
      await c.query(`update ocs_tecido_itens set quantidade_recebida=quantidade_recebida where oc_tecido_id=$1`, [oc]);
      await flush(c);
      expect(Number((await um<{ n: string }>(c, `select count(*) n from estoque_tecido_baixas where variante_tecido_id=$1`, [f.vari])).n)).toBe(n0);

      // mais tecido chega (recebida alterada num item de OC já recebida) → B completa
      await c.query(`update ocs_tecido_itens set quantidade_recebida=200 where oc_tecido_id=$1`, [oc]);
      await flush(c);
      expect(await deficit(c, cadB)).toBeNull();
      expect((await baixasDoCad(c, cadB)).total).toBe(100);
    });
  });

  it("modo por_oc: receber a OC vinculada (salvar_oc_tecido) completa PRIMEIRO o card ligado a ela, mesmo mais novo", async () => {
    await withTx(async (c) => {
      const f = await preparar(c, "por_oc");
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!emp) throw new Error("fixture ausente: Loja Teste sem empresa");
      const ocPayload = (status: string) => ({ numero_pedido: "ITEST-P203-X", empresa_id: emp.id, data_prevista_entrega: "2026-09-01",
        data_entrega: "2026-09-01", prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [],
        valor_previsto_total: 0, valor_real_total: 0, status });
      const itens = [{ id: null, artigo_id: f.art, artigo_numero: 1, variante_tecido_id: f.vari, quantidade_pedida: 100,
        quantidade_recebida: null, rendimento: null, cancelado: false }];
      const ocX = (await um<{ id: string }>(c, `select public._salvar_oc_tecido_core(null,$1::jsonb,$2::jsonb) id`,
        [JSON.stringify(ocPayload("encomendado")), JSON.stringify(itens)])).id;
      const itX = (await um<{ id: string }>(c, `select id from ocs_tecido_itens where oc_tecido_id=$1`, [ocX])).id;

      const cadA = await cardComCad(c, f.art, f.vari, 100, "2026-02-01");                           // mais antigo, sem vínculo
      const cadB = await cardComCad(c, f.art, f.vari, 100, "2026-03-01", { item: itX, q: 0 });       // mais novo, vinculado à X
      await cortar(c, cadA);
      await cortar(c, cadB);
      expect(Number((await deficit(c, cadB))![0].deficit)).toBe(100);

      // receber X pelo caminho real (salvar_oc_tecido com status recebido, item com a recebida)
      await um(c, `select public._salvar_oc_tecido_core($1,$2::jsonb,$3::jsonb) id`,
        [ocX, JSON.stringify(ocPayload("recebido")), JSON.stringify([{ ...itens[0], id: itX, quantidade_recebida: 100 }])]);
      await flush(c);

      expect(await deficit(c, cadB)).toBeNull();
      expect(await baixasDoCad(c, cadB)).toMatchObject({ total: 100, origens: ["vinculo"] });
      expect(Number((await deficit(c, cadA))![0].deficit)).toBe(100); // o vínculo é reserva: o FIFO do mais antigo não leva
      expect((await baixasDoCad(c, cadA)).total).toBe(0);
    });
  });

  it("vínculo com teto quantidade_m: completa até o teto (menos o já baixado) e o resto vai por FIFO", async () => {
    await withTx(async (c) => {
      const f = await preparar(c, "por_oc");
      const ocV = await novaOc(c, "encomendado", "ITEST-P203-V", TENANT_TESTE, "2026-09-10");
      const itV = await novoItem(c, ocV, f.art, f.vari, 100, 100);
      const ocF = await novaOc(c, "recebido", "ITEST-P203-F", TENANT_TESTE, "2026-01-01");
      const itF = await novoItem(c, ocF, f.art, f.vari, 20, 20);
      const cad = await cardComCad(c, f.art, f.vari, 100, "2026-02-01", { item: itV, q: 60 });
      await cortar(c, cad); // vínculo sem saldo (encomendada) → FIFO leva os 20 da F; déficit 80
      expect(Number((await deficit(c, cad))![0].deficit)).toBe(80);
      await c.query(`update ocs_tecido set status='recebido' where id=$1`, [ocV]);
      await flush(c);
      // vínculo: até 60 da V; o resto (20) ficaria no FIFO, mas a V é vinculada (excluída do FIFO) e a F acabou → déficit 20
      const porItem = (await c.query(`select oc_tecido_item_id i, sum(quantidade) q, min(origem) o from estoque_tecido_baixas where cad_id=$1 group by 1`, [cad])).rows;
      expect(Number(porItem.find((r: any) => r.i === itV).q)).toBe(60);
      expect(Number(porItem.find((r: any) => r.i === itF).q)).toBe(20);
      expect(Number((await deficit(c, cad))![0].deficit)).toBe(20);
      // chega outra OC sem vínculo → FIFO completa os 20
      const ocG = await novaOc(c, "recebido", "ITEST-P203-G");
      await novoItem(c, ocG, f.art, f.vari, 50, 50);
      await flush(c);
      expect(await deficit(c, cad)).toBeNull();
    });
  });

  it("variante em kg: déficit em metros, OC em kg × rendimento", async () => {
    await withTx(async (c) => {
      const f = await preparar(c, "automatico", "kg", 3);
      const cad = await cardComCad(c, f.art, f.vari, 50, "2026-02-01");
      await cortar(c, cad);
      expect(Number((await deficit(c, cad))![0].deficit)).toBe(50);
      const oc = await novaOc(c, "recebido", "ITEST-P203-KG");
      await novoItem(c, oc, f.art, f.vari, 10, 10); // 10 kg × 3 = 30 m
      await flush(c);
      expect((await baixasDoCad(c, cad)).total).toBe(30);
      expect(Number((await deficit(c, cad))![0].deficit)).toBe(20);
    });
  });

  it("OC com rolos planejados ainda não separados não é fonte; o rolo criado completa", async () => {
    await withTx(async (c) => {
      const f = await preparar(c, "automatico");
      const cad = await cardComCad(c, f.art, f.vari, 40, "2026-02-01");
      await cortar(c, cad);
      const oc = await novaOc(c, "encomendado", "ITEST-P203-RP");
      const it = (await um<{ id: string }>(c,
        `insert into ocs_tecido_itens (oc_tecido_id,artigo_id,variante_tecido_id,quantidade_pedida,quantidade_recebida,rolos_planejados)
         values ($1,$2,$3,100,100,'[{"qtd":100}]'::jsonb) returning id`, [oc, f.art, f.vari])).id;
      await c.query(`update ocs_tecido set status='recebido' where id=$1`, [oc]);
      await flush(c);
      expect((await baixasDoCad(c, cad)).total).toBe(0); // gerar_rolos_recebimento ainda vai separar os 100
      await um(c, `select public._criar_rolo_core('ITEST-P203-R',$1::uuid,$2::jsonb,$3::uuid) id`,
        [f.art, JSON.stringify([{ variante_tecido_id: f.vari, metragem: 100 }]), it]);
      await flush(c);
      expect((await baixasDoCad(c, cad)).total).toBe(40);
      expect(await deficit(c, cad)).toBeNull();
    });
  });

  it("isolamento por loja: OC de outra loja não completa e o helper com outra loja não mexe", async () => {
    await withTx(async (c) => {
      const f = await preparar(c, "automatico");
      const outra = await um<{ id: string } | undefined>(c, `select id from tenants where nome=$1`, [AVE_RARA_NOME]);
      if (!outra) throw new Error("fixture ausente: loja Ave Rara");
      const cad = await cardComCad(c, f.art, f.vari, 70, "2026-02-01");
      await cortar(c, cad);
      // OC da OUTRA loja com item (legado mal-rotulado) apontando a variante da Loja Teste
      const ocO = await novaOc(c, "encomendado", "ITEST-P203-OUT", outra.id);
      await novoItem(c, ocO, f.art, f.vari, 500, 500);
      await c.query(`update ocs_tecido set status='recebido' where id=$1`, [ocO]);
      await flush(c);
      expect((await um<{ r: any }>(c, `select public._completar_deficit_corte_variante($1,$2) r`, [outra.id, f.vari])).r).toMatchObject({ cads: 0, metros: 0 });
      expect((await um<{ r: any }>(c, `select public._completar_deficit_corte_variante($1,$2) r`, [TENANT_TESTE, f.vari])).r).toMatchObject({ cads: 0, metros: 0 });
      expect((await baixasDoCad(c, cad)).total).toBe(0);
      expect(Number((await deficit(c, cad))![0].deficit)).toBe(70);
    });
  });

  it("ACL (inv. #9): helper e função do gatilho sem EXECUTE para PUBLIC/anon/authenticated; gatilhos adiados ligados", async () => {
    await withTx(async (c) => {
      const r = await um<any>(c, `select
        has_function_privilege('anon','public._completar_deficit_corte_variante(uuid,uuid)','EXECUTE') a1,
        has_function_privilege('authenticated','public._completar_deficit_corte_variante(uuid,uuid)','EXECUTE') a2,
        has_function_privilege('anon','public.fn_completar_deficit_corte()','EXECUTE') a3,
        has_function_privilege('authenticated','public.fn_completar_deficit_corte()','EXECUTE') a4,
        (select count(*) from pg_trigger where tgname in ('trg_deficit_corte_item_ins','trg_deficit_corte_item_upd','trg_deficit_corte_oc')
            and tgenabled='O' and tgdeferrable and tginitdeferred) n`);
      expect(r).toMatchObject({ a1: false, a2: false, a3: false, a4: false });
      expect(Number(r.n)).toBe(3);
    });
  });
});

// ─── Fix round 1 (G-MIGRATION R15a): M1, M2, L4, WARNING, reenvio ───────────────────────────────────────────────────
describe.skipIf(!hasDb)("P-203 A fix round 1 — robustez do completar", () => {
  it("M1: entrada malformada de deficit_corte (cad de OUTRA variante e do mesmo cad) não bloqueia; é mantida e contada", async () => {
    await withTx(async (c) => {
      const f = await preparar(c, "automatico");
      const outra = await preparar(c, "automatico"); // outra variante (outro artigo) da mesma loja
      // cad da OUTRA variante com entrada malformada (numero "1a")
      const cadRuim = await cardComCad(c, outra.art, outra.vari, 10, "2026-01-01");
      await c.query(`update cad set enviado_corte=true, deficit_corte=$2::jsonb where id=$1`,
        [cadRuim, JSON.stringify([{ tipo: "tecido", numero: "1a", ordem: 1, deficit: 10, baixada: 0, enviada: 10 }])]);
      // cad certo, com uma entrada boa e uma lixo (string)
      const cad = await cardComCad(c, f.art, f.vari, 60, "2026-02-01");
      await cortar(c, cad);
      await c.query(`update cad set deficit_corte = deficit_corte || '["lixo"]'::jsonb where id=$1`, [cad]);
      const oc = await novaOc(c, "recebido", "ITEST-P203-M1");
      await novoItem(c, oc, f.art, f.vari, 100, 100);
      const r = (await um<{ r: any }>(c, `select public._completar_deficit_corte_variante($1,$2) r`, [TENANT_TESTE, f.vari])).r;
      expect(r).toMatchObject({ cads: 1, malformadas: 1 }); // antes (round 0): erro 22P02 e nada completava na loja
      expect(Number(r.metros)).toBe(60);
      expect(await deficit(c, cad)).toEqual(["lixo"]);          // a entrada ruim fica como estava
      expect((await baixasDoCad(c, cad)).total).toBe(60);
      expect((await deficit(c, cadRuim))![0].numero).toBe("1a"); // a outra variante não é tocada
    });
  });

  it("completar e depois REENVIAR o corte: o corte refaz do zero, sem baixa a mais", async () => {
    await withTx(async (c) => {
      const f = await preparar(c, "automatico");
      const cad = await cardComCad(c, f.art, f.vari, 100, "2026-02-01");
      await cortar(c, cad);
      const oc = await novaOc(c, "recebido", "ITEST-P203-RE");
      const it = await novoItem(c, oc, f.art, f.vari, 70, 70);
      await flush(c);
      expect((await baixasDoCad(c, cad)).total).toBe(70);
      expect(Number((await deficit(c, cad))![0].deficit)).toBe(30);
      const rr = await cortar(c, cad); // reenvio
      expect(Number(rr.deficit_total)).toBe(30);
      expect((await baixasDoCad(c, cad)).total).toBe(70); // nunca passa da enviada nem duplica
      await c.query(`update ocs_tecido_itens set quantidade_recebida=100 where id=$1`, [it]);
      await flush(c);
      expect((await baixasDoCad(c, cad)).total).toBe(100);
      expect(await deficit(c, cad)).toBeNull();
    });
  });
});

// Testes com 2ª conexão / DDL em txn revertida: SÓ na cópia local (nunca DDL em txn de teste contra produção).
describe.skipIf(!hasDb || !ehBancoLocal())("P-203 A fix round 1 — sem espera no COMMIT e caminho do WARNING (cópia local)", () => {
  it("M2: trava da loja ocupada (corte em curso) → o COMMIT não espera; o próximo evento completa", async () => {
    const outro = new Client({ connectionString: dbUrl()!, ssl: false });
    await outro.connect();
    try {
      await withTx(async (c) => {
        // outra sessão segura a MESMA trava do corte da loja (um corte em curso) ANTES de tudo
        await outro.query(`select pg_advisory_lock(hashtext('corte_tenant:' || $1::text))`, [TENANT_TESTE]);
        const f = await preparar(c, "automatico");
        const cad = await cardComCad(c, f.art, f.vari, 50, "2026-02-01");
        // déficit gravado direto (cortar aqui esperaria a trava da outra sessão)
        await c.query(`update cad set enviado_corte=true, deficit_corte=$2::jsonb where id=$1`,
          [cad, JSON.stringify([{ tipo: "tecido", numero: 1, ordem: 1, deficit: 50, baixada: 0, enviada: 50, variante: "ITEST-P203" }])]);
        const oc = await novaOc(c, "recebido", "ITEST-P203-M2");
        const it = await novoItem(c, oc, f.art, f.vari, 80, 80);
        const t0 = Date.now();
        await flush(c);
        expect(Date.now() - t0).toBeLessThan(1500); // antes (round 0): pg_advisory_xact_lock esperava sem limite
        expect(Number((await deficit(c, cad))![0].deficit)).toBe(50);
        const r = (await um<{ r: any }>(c, `select public._completar_deficit_corte_variante($1,$2) r`, [TENANT_TESTE, f.vari])).r;
        expect(r).toMatchObject({ cads: 0, ocupado: true });
        await outro.query(`select pg_advisory_unlock(hashtext('corte_tenant:' || $1::text))`, [TENANT_TESTE]);
        await c.query(`update ocs_tecido_itens set quantidade_recebida=81 where id=$1`, [it]);
        await flush(c);
        expect(await deficit(c, cad)).toBeNull();
      });
    } finally {
      await outro.query(`select pg_advisory_unlock_all()`).catch(() => {});
      await outro.end();
    }
  });

  it("erro no helper (inclusive 57014/statement_timeout) vira WARNING e não derruba o comando; UPDATE sem mudança não dispara (L4)", async () => {
    await withTx(async (c) => {
      const avisos: string[] = [];
      c.on("notice", (n: any) => avisos.push(String(n.message)));
      const f = await preparar(c, "automatico");
      const oc = await novaOc(c, "recebido", "ITEST-P203-W");
      const it = await novoItem(c, oc, f.art, f.vari, 10, 10);
      await flush(c);
      // helper trocado (só nesta txn revertida) por um que falha
      await c.query(`create or replace function public._completar_deficit_corte_variante(_tenant uuid, _variante uuid)
        returns jsonb language plpgsql security definer set search_path to 'public' as $f$
        begin raise exception 'boom_teste'; end $f$`);
      // UPDATE sem mudança (o _salvar_oc_tecido_core regrava todos os itens): o gatilho NÃO dispara
      await c.query(`update ocs_tecido_itens set quantidade_recebida=quantidade_recebida, cancelado=cancelado where id=$1`, [it]);
      await flush(c);
      expect(avisos.filter((a) => a.includes("completar_deficit_corte"))).toEqual([]);
      // mudança de verdade: dispara, o erro vira WARNING e o comando segue
      await c.query(`update ocs_tecido_itens set quantidade_recebida=11 where id=$1`, [it]);
      await flush(c);
      expect(avisos.some((a) => a.includes("completar_deficit_corte") && a.includes("boom_teste"))).toBe(true);
      expect(Number((await um<{ q: string }>(c, `select quantidade_recebida q from ocs_tecido_itens where id=$1`, [it])).q)).toBe(11);
      // 57014: statement_timeout estourando DENTRO do helper (que o WHEN OTHERS não pega) também vira WARNING
      await c.query(`create or replace function public._completar_deficit_corte_variante(_tenant uuid, _variante uuid)
        returns jsonb language plpgsql security definer set search_path to 'public' as $f$
        begin perform pg_sleep(2); return '{}'::jsonb; end $f$`);
      // (depois do 1o SET CONSTRAINTS ... IMMEDIATE os gatilhos rodam no fim de cada comando - o UPDATE e o comando)
      await c.query(`set local statement_timeout = '300ms'`);
      const t0 = Date.now();
      await c.query(`update ocs_tecido_itens set quantidade_recebida=12 where id=$1`, [it]); // não lança
      expect(Date.now() - t0).toBeLessThan(1500);
      await c.query(`set local statement_timeout = 0`);
      expect(Number((await um<{ q: string }>(c, `select quantidade_recebida q from ocs_tecido_itens where id=$1`, [it])).q)).toBe(12);
      expect(avisos.some((a) => a.includes("completar_deficit_corte") && /57014|cancel/i.test(a))).toBe(true);
    });
  });
});
