import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// CQ de Tecido entra no Salvar da OC (Task 1 da frente `cq-tecido-no-salvar-oc`): `salvar_oc_tecido` passa a aceitar
// `cq_ok` / `cq_alerta` / `cq_observacao` por item (modo OC) e `_cq_rolos` (modo rolo). Regra central: CHAVE PRESENTE
// grava, CHAVE AUSENTE MANTÉM (a aba desatualizada nunca desfaz o que os Alertas resolveram). Item NOVO sem chave nasce
// com o default da coluna. Chama o WRAPPER público `salvar_oc_tecido` (portão de módulo + página `entrada_oc_tecido`),
// como o usuário de teste (admin da Loja Teste). Tudo em BEGIN…ROLLBACK — nada grava.

type Sem = { art: string; vari: string; oc: string; itens: string[]; rolo?: string; roloItem?: string };

/** Semeia (como postgres, dentro da txn) 1 tecido + 1 OC RECEBIDA com `nItens` itens (cq default). */
async function semeiaOc(c: Client, tag: string, nItens = 1): Promise<Sem> {
  const art = (await um<{ id: string }>(c,
    `insert into artigos (tenant_id,nome,unidade_medida,rendimento) values ($1,$2,'m',1) returning id`,
    [TENANT_TESTE, `ITEST-CQ-${tag}`])).id;
  const vari = (await um<{ id: string }>(c,
    `insert into variantes_tecido (tenant_id,artigo_id,nome_variante) values ($1,$2,$3) returning id`,
    [TENANT_TESTE, art, `ITEST-CQ-${tag}`])).id;
  const oc = (await um<{ id: string }>(c,
    `insert into ocs_tecido (tenant_id,status,numero_pedido,data_pedido,data_entrega)
     values ($1,'recebido',$2,current_date,current_date) returning id`,
    [TENANT_TESTE, `ITEST-CQ-${tag}`])).id;
  const itens: string[] = [];
  for (let i = 1; i <= nItens; i++) {
    itens.push((await um<{ id: string }>(c,
      `insert into ocs_tecido_itens (oc_tecido_id,artigo_id,artigo_numero,variante_tecido_id,quantidade_pedida,quantidade_recebida)
       values ($1,$2,$3,$4,100,100) returning id`,
      [oc, art, i, vari])).id);
  }
  return { art, vari, oc, itens };
}

/** Semeia o ROLO (ocs_tecido is_rolo) cuja origem é `origemItem`, com 1 item de rolo. */
async function semeiaRolo(c: Client, s: Sem, origemItem: string, tag: string, tenant = TENANT_TESTE) {
  const rolo = (await um<{ id: string }>(c,
    `insert into ocs_tecido (tenant_id,status,numero_pedido,data_pedido,data_entrega,is_rolo,rolo_origem_item_id)
     values ($1,'recebido',$2,current_date,current_date,true,$3) returning id`,
    [tenant, `ITEST-CQ-ROLO-${tag}`, origemItem])).id;
  const roloItem = (await um<{ id: string }>(c,
    `insert into ocs_tecido_itens (oc_tecido_id,artigo_id,artigo_numero,variante_tecido_id,quantidade_pedida,quantidade_recebida)
     values ($1,$2,1,$3,50,50) returning id`,
    [rolo, s.art, s.vari])).id;
  return { rolo, roloItem };
}

/** Estado do CQ de um item. */
async function cq(c: Client, itemId: string) {
  return um<{ cq_ok: boolean; st: string; obs: string | null }>(c,
    `select cq_ok, cq_alerta_status::text st, cq_observacao obs from ocs_tecido_itens where id=$1`, [itemId]);
}

async function poeCq(c: Client, itemId: string, ok: boolean, st: string, obs: string | null) {
  await c.query(`update ocs_tecido_itens set cq_ok=$2, cq_alerta_status=$3::cq_alerta_status, cq_observacao=$4 where id=$1`,
    [itemId, ok, st, obs]);
}

const ocPayload = (tag: string) => ({
  numero_pedido: `ITEST-CQ-${tag}`, data_prevista_entrega: "2026-07-01", prazo_pagamento: null, quantidade_prazos: 1,
  parcelas_recebimento: [], valor_previsto_total: 0, valor_real_total: 0, status: "recebido",
});

/** Item do payload (estado completo da linha); `extra` traz as chaves cq_* que o caso quiser mandar. */
const itemPayload = (s: Sem, id: string | null, numero: number, extra: Record<string, unknown> = {}) => ({
  id, artigo_id: s.art, artigo_numero: numero, variante_tecido_id: s.vari,
  quantidade_pedida: 100, quantidade_recebida: 100, rendimento: null, cancelado: false, ...extra,
});

async function salva(c: Client, s: Sem, tag: string, itens: unknown[], cqRolos: unknown = null, revBase: number | null = null) {
  return c.query(`select public.salvar_oc_tecido($1, $2::jsonb, $3::jsonb, $4, $5::jsonb)`,
    [s.oc, JSON.stringify(ocPayload(tag)), JSON.stringify(itens), revBase,
      cqRolos === null ? null : JSON.stringify(cqRolos)]);
}

describe.skipIf(!hasDb)("salvar_oc_tecido — CQ de Tecido no Salvar (modo OC)", () => {
  it("1. grava CQ: cq_ok=true, cq_alerta=true, cq_observacao='encolheu' -> ok / alertado / obs", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semeiaOc(c, "C1");
      await salva(c, s, "C1", [itemPayload(s, s.itens[0], 1, { cq_ok: true, cq_alerta: true, cq_observacao: "encolheu" })]);
      expect(await cq(c, s.itens[0])).toEqual({ cq_ok: true, st: "alertado", obs: "encolheu" });
    });
  });

  it("2. chave ausente MANTÉM: item ok/alertado/'x' + payload sem nenhuma chave cq_* -> os 3 valores permanecem", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semeiaOc(c, "C2");
      await poeCq(c, s.itens[0], true, "alertado", "x");
      await salva(c, s, "C2", [itemPayload(s, s.itens[0], 1)]); // aba desatualizada: sem cq_*
      expect(await cq(c, s.itens[0])).toEqual({ cq_ok: true, st: "alertado", obs: "x" });
    });
  });

  it("3. observação vazia: cq_observacao='' grava NULL", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semeiaOc(c, "C3");
      await poeCq(c, s.itens[0], false, "sem_alerta", "antiga");
      await salva(c, s, "C3", [itemPayload(s, s.itens[0], 1, { cq_observacao: "" })]);
      const r = await cq(c, s.itens[0]);
      expect(r.obs).toBeNull();
      expect(r.cq_ok).toBe(false); // chave ausente nos outros campos mantém
      expect(r.st).toBe("sem_alerta");
    });
  });

  it("4. desligar alerta: item 'alertado' + cq_alerta=false -> 'sem_alerta' (ok e obs mantidos)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semeiaOc(c, "C4");
      await poeCq(c, s.itens[0], true, "alertado", "obs");
      await salva(c, s, "C4", [itemPayload(s, s.itens[0], 1, { cq_alerta: false })]);
      expect(await cq(c, s.itens[0])).toEqual({ cq_ok: true, st: "sem_alerta", obs: "obs" });
    });
  });

  it("5. estado resolvido preservado: 'trocado' e 'cancelado' + payload SEM cq_alerta -> permanecem", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semeiaOc(c, "C5", 2);
      await poeCq(c, s.itens[0], true, "trocado", "t");
      await poeCq(c, s.itens[1], true, "cancelado", "c");
      // o payload pode mandar cq_ok/cq_observacao, mas NUNCA cq_alerta: o resolvido não é rebaixado
      await salva(c, s, "C5", [
        itemPayload(s, s.itens[0], 1, { cq_ok: true, cq_observacao: "t2" }),
        itemPayload(s, s.itens[1], 2),
      ]);
      expect(await cq(c, s.itens[0])).toEqual({ cq_ok: true, st: "trocado", obs: "t2" });
      expect(await cq(c, s.itens[1])).toEqual({ cq_ok: true, st: "cancelado", obs: "c" });
    });
  });

  it("6. item NOVO (sem id) sem chaves cq_* nasce com default e não herda de outro item", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semeiaOc(c, "C6");
      await poeCq(c, s.itens[0], true, "alertado", "do-outro");
      await salva(c, s, "C6", [itemPayload(s, s.itens[0], 1), itemPayload(s, null, 2)]);
      const novo = await um<{ id: string }>(c,
        `select id from ocs_tecido_itens where oc_tecido_id=$1 and id <> $2`, [s.oc, s.itens[0]]);
      expect(await cq(c, novo.id)).toEqual({ cq_ok: false, st: "sem_alerta", obs: null });
      expect(await cq(c, s.itens[0])).toEqual({ cq_ok: true, st: "alertado", obs: "do-outro" }); // o antigo intacto
    });
  });

  it("7. rev/P0409 intacto: _rev_base errado ainda dá P0409 e nada grava; _rev_base certo salva", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semeiaOc(c, "C7");
      const rev = (await um<{ rev: number }>(c, `select rev from ocs_tecido where id=$1`, [s.oc])).rev;

      await c.query("SAVEPOINT sp_rev");
      let err: any = null;
      try {
        await salva(c, s, "C7", [itemPayload(s, s.itens[0], 1, { cq_ok: true, cq_observacao: "nao-deve-gravar" })], null, rev + 999);
      } catch (e) {
        err = e;
      }
      await c.query("ROLLBACK TO SAVEPOINT sp_rev");
      expect(err).not.toBeNull();
      expect(err.code).toBe("P0409");
      expect(await cq(c, s.itens[0])).toEqual({ cq_ok: false, st: "sem_alerta", obs: null });

      // com o rev certo, o mesmo payload grava
      await salva(c, s, "C7", [itemPayload(s, s.itens[0], 1, { cq_ok: true, cq_observacao: "grava" })], null, rev);
      expect(await cq(c, s.itens[0])).toEqual({ cq_ok: true, st: "sem_alerta", obs: "grava" });
    });
  });
});

describe.skipIf(!hasDb)("salvar_oc_tecido — _cq_rolos (modo rolo)", () => {
  it("8. grava o item de rolo existente (ok + obs 'furo'); chave ausente mantém; só toca o rolo pedido", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semeiaOc(c, "R8");
      const r = await semeiaRolo(c, s, s.itens[0], "R8");
      await poeCq(c, r.roloItem, false, "alertado", "antes");

      await salva(c, s, "R8", [itemPayload(s, s.itens[0], 1)], [{ item_id: r.roloItem, cq_ok: true, cq_observacao: "furo" }]);
      // cq_ok e obs gravados; cq_alerta ausente -> 'alertado' permanece
      expect(await cq(c, r.roloItem)).toEqual({ cq_ok: true, st: "alertado", obs: "furo" });

      // 2ª chamada: só cq_alerta=false -> ok e obs mantidos
      await salva(c, s, "R8", [itemPayload(s, s.itens[0], 1)], [{ item_id: r.roloItem, cq_alerta: false }]);
      expect(await cq(c, r.roloItem)).toEqual({ cq_ok: true, st: "sem_alerta", obs: "furo" });

      // o item da OC de origem não é afetado por _cq_rolos
      expect(await cq(c, s.itens[0])).toEqual({ cq_ok: false, st: "sem_alerta", obs: null });
    });
  });

  it("9. _cq_rolos NULL ou [] -> nenhum item de rolo muda", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const s = await semeiaOc(c, "R9");
      const r = await semeiaRolo(c, s, s.itens[0], "R9");
      await poeCq(c, r.roloItem, true, "alertado", "intacto");

      await salva(c, s, "R9", [itemPayload(s, s.itens[0], 1)], null);
      expect(await cq(c, r.roloItem)).toEqual({ cq_ok: true, st: "alertado", obs: "intacto" });

      await salva(c, s, "R9", [itemPayload(s, s.itens[0], 1)], []);
      expect(await cq(c, r.roloItem)).toEqual({ cq_ok: true, st: "alertado", obs: "intacto" });
    });
  });

  it("10. _cq_rolos com item de OUTRA OC / OUTRA loja / que não é de rolo -> NÃO grava (EXISTS não casa)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const a = await semeiaOc(c, "R10A");
      const b = await semeiaOc(c, "R10B"); // OUTRA OC da mesma loja, com rolo próprio
      const rb = await semeiaRolo(c, b, b.itens[0], "R10B");
      await poeCq(c, rb.roloItem, false, "sem_alerta", "b-original");

      // (a) rolo de OUTRA OC: a origem dele é item da OC B, não da A
      // (b) item da própria OC A (não é de rolo: ocs_tecido.is_rolo=false)
      // (c) rolo de OUTRA loja cuja origem É item da OC A (o tenant do rolo não casa)
      const outra = await um<{ id: string } | undefined>(c, `select id from tenants where id <> $1 limit 1`, [TENANT_TESTE]);
      let rc: { rolo: string; roloItem: string } | null = null;
      if (outra) {
        rc = await semeiaRolo(c, a, a.itens[0], "R10C", outra.id);
        await poeCq(c, rc.roloItem, false, "sem_alerta", "c-original");
      }

      const alvos: any[] = [
        { item_id: rb.roloItem, cq_ok: true, cq_alerta: true, cq_observacao: "invasao-b" },
        { item_id: a.itens[0], cq_ok: true, cq_alerta: true, cq_observacao: "invasao-a" },
      ];
      if (rc) alvos.push({ item_id: rc.roloItem, cq_ok: true, cq_alerta: true, cq_observacao: "invasao-c" });

      await salva(c, a, "R10A", [itemPayload(a, a.itens[0], 1)], alvos);

      expect(await cq(c, rb.roloItem)).toEqual({ cq_ok: false, st: "sem_alerta", obs: "b-original" });
      expect(await cq(c, a.itens[0])).toEqual({ cq_ok: false, st: "sem_alerta", obs: null });
      if (rc) expect(await cq(c, rc.roloItem)).toEqual({ cq_ok: false, st: "sem_alerta", obs: "c-original" });
    });
  });
});
