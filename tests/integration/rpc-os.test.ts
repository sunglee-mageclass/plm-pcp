import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// M3: salvar_os / baixar_os / desmarcar_os atômicas. baixar_os TRAVA saldo (aviamento) no
// servidor via a fonte canônica _estoque_aviamento_core. Tudo em BEGIN…ROLLBACK.
describe.skipIf(!hasDb)("RPCs atômicas de Ordem de Saída", () => {
  it("aviamento: salvar cria; baixar trava acima do saldo; dentro baixa; desmarcar reverte", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!emp) return; // sem empresa → auto-pula

      const avi = (await um<{ id: string }>(
        c, `insert into aviamentos(tenant_id,codigo_nome,empresa_id) values ($1,'ITEST-OSRPC',$2) returning id`,
        [TENANT_TESTE, emp.id])).id;

      // dá saldo 10 ao aviamento (OC recebida)
      const oc = { numero_pedido: "X", empresa_id: emp.id, data_prevista_entrega: "2026-07-01",
        prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [], status: "recebido" };
      await c.query(`select public._salvar_oc_aviamento_core(null,$1::jsonb,$2::jsonb)`,
        [JSON.stringify(oc), JSON.stringify([{ id: null, aviamento_id: avi, quantidade_pedida: 10, quantidade_recebida: 10, cancelado: false }])]);

      // salvar_os (reserva 4) — atômico
      const os = (await um<{ id: string }>(
        c, `select public.salvar_os('aviamento', null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ responsavel: "t" }), JSON.stringify([{ itemId: avi, reserva: 4 }])])).id;
      const it = (await um<{ id: string }>(c, `select id from ordens_saida_aviamento_itens where ordem_saida_id=$1`, [os])).id;

      // baixar acima do saldo (12 > 10) → bloqueado (savepoint p/ não abortar a txn)
      await c.query("SAVEPOINT sp");
      await expect(
        c.query(`select public.baixar_os('aviamento',$1,$2::jsonb)`, [os, JSON.stringify({ [it]: 12 })]),
      ).rejects.toThrow(/acima do estoque/i);
      await c.query("ROLLBACK TO SAVEPOINT sp");

      // dentro do saldo (8) → baixa
      await c.query(`select public.baixar_os('aviamento',$1,$2::jsonb)`, [os, JSON.stringify({ [it]: 8 })]);
      const b = await um<{ baixado: boolean; baixa: string }>(
        c, `select o.baixado, i.baixa from ordens_saida_aviamento o
            join ordens_saida_aviamento_itens i on i.ordem_saida_id=o.id where o.id=$1`, [os]);
      expect(b.baixado).toBe(true);
      expect(Number(b.baixa)).toBe(8);

      // desmarcar → reverte
      await c.query(`select public.desmarcar_os('aviamento',$1)`, [os]);
      const d = await um<{ baixado: boolean; baixa: string }>(
        c, `select o.baixado, i.baixa from ordens_saida_aviamento o
            join ordens_saida_aviamento_itens i on i.ordem_saida_id=o.id where o.id=$1`, [os]);
      expect(d.baixado).toBe(false);
      expect(Number(d.baixa)).toBe(0);
    });
  });

  it("edição substitui itens atomicamente e bloqueia se a OS já está baixada", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!emp) return;
      const avi = (await um<{ id: string }>(
        c, `insert into aviamentos(tenant_id,codigo_nome,empresa_id) values ($1,'ITEST-OSED',$2) returning id`,
        [TENANT_TESTE, emp.id])).id;
      // saldo p/ conseguir baixar depois
      const oc = { numero_pedido: "X", empresa_id: emp.id, data_prevista_entrega: "2026-07-01",
        prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [], status: "recebido" };
      await c.query(`select public._salvar_oc_aviamento_core(null,$1::jsonb,$2::jsonb)`,
        [JSON.stringify(oc), JSON.stringify([{ id: null, aviamento_id: avi, quantidade_pedida: 10, quantidade_recebida: 10, cancelado: false }])]);
      const os = (await um<{ id: string }>(
        c, `select public.salvar_os('aviamento', null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ responsavel: "a" }), JSON.stringify([{ itemId: avi, reserva: 2 }])])).id;

      // edita reserva → 5 (substitui itens; 1 item só)
      await c.query(`select public.salvar_os('aviamento', $1, $2::jsonb, $3::jsonb)`,
        [os, JSON.stringify({ responsavel: "b" }), JSON.stringify([{ itemId: avi, reserva: 5 }])]);
      const r = await um<{ n: string; reserva: string; resp: string }>(
        c, `select (select count(*) from ordens_saida_aviamento_itens where ordem_saida_id=$1) n,
                   (select reserva from ordens_saida_aviamento_itens where ordem_saida_id=$1) reserva,
                   (select responsavel from ordens_saida_aviamento where id=$1) resp`, [os]);
      expect(Number(r.n)).toBe(1);
      expect(Number(r.reserva)).toBe(5);
      expect(r.resp).toBe("b");

      // baixa e tenta editar → bloqueado
      const it = (await um<{ id: string }>(c, `select id from ordens_saida_aviamento_itens where ordem_saida_id=$1`, [os])).id;
      await c.query(`select public.baixar_os('aviamento',$1,$2::jsonb)`, [os, JSON.stringify({ [it]: 1 })]);
      await c.query("SAVEPOINT sp2");
      await expect(
        c.query(`select public.salvar_os('aviamento', $1, $2::jsonb, $3::jsonb)`,
          [os, JSON.stringify({ responsavel: "c" }), JSON.stringify([{ itemId: avi, reserva: 9 }])]),
      ).rejects.toThrow(/baixada/i);
      await c.query("ROLLBACK TO SAVEPOINT sp2");
    });
  });

  // FF#3 (ago/2026): OS de aviamento POR VARIANTE. salvar_os grava variante_aviamento_id; a
  // trava de saldo do baixar_os passa a valer/debitar POR VARIANTE (antes somava por aviamento).
  it("aviamento por variante: grava a variante; baixa só ela; outra variante SEM saldo barra (trava por variante)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!emp) return;
      const cores = (await c.query(`select id from cores limit 2`)).rows as { id: string }[];
      if (cores.length < 2) return;

      const avi = (await um<{ id: string }>(
        c, `insert into aviamentos(tenant_id,codigo_nome,empresa_id) values ($1,'ITEST-OSVAR',$2) returning id`,
        [TENANT_TESTE, emp.id])).id;
      const vA = (await um<{ id: string }>(
        c, `insert into variantes_aviamento(tenant_id,aviamento_id,cor_id) values ($1,$2,$3) returning id`, [TENANT_TESTE, avi, cores[0].id])).id;
      const vB = (await um<{ id: string }>(
        c, `insert into variantes_aviamento(tenant_id,aviamento_id,cor_id) values ($1,$2,$3) returning id`, [TENANT_TESTE, avi, cores[1].id])).id;

      // saldo 10 SÓ na variante A (OC recebida na variante A) — B fica em 0.
      const oc = { numero_pedido: "X", empresa_id: emp.id, data_prevista_entrega: "2026-07-01",
        prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [], status: "recebido" };
      await c.query(`select public._salvar_oc_aviamento_core(null,$1::jsonb,$2::jsonb)`,
        [JSON.stringify(oc), JSON.stringify([{ id: null, aviamento_id: avi, variante_aviamento_id: vA, quantidade_pedida: 10, quantidade_recebida: 10, cancelado: false }])]);

      const fis = async (v: string) => Number((await um<{ f: string }>(
        c, `select coalesce(fisico,0) f from public._estoque_aviamento_core($1) where id=$2 and variante_id is not distinct from $3`, [TENANT_TESTE, avi, v]))?.f ?? 0);
      expect(await fis(vA)).toBe(10);
      expect(await fis(vB)).toBe(0);

      // salvar OS reservando a variante A → variante persistida no item.
      const os = (await um<{ id: string }>(c, `select public.salvar_os('aviamento',null,$1::jsonb,$2::jsonb) id`,
        [JSON.stringify({ responsavel: "t" }), JSON.stringify([{ itemId: avi, varianteId: vA, reserva: 4 }])])).id;
      const itA = await um<{ id: string; v: string }>(
        c, `select id, variante_aviamento_id v from ordens_saida_aviamento_itens where ordem_saida_id=$1`, [os]);
      expect(itA.v).toBe(vA);

      // baixar 4 (dentro do saldo de A) → SÓ a variante A cai (fisico A 10→6; B intacto).
      await c.query(`select public.baixar_os('aviamento',$1,$2::jsonb)`, [os, JSON.stringify({ [itA.id]: 4 })]);
      expect(await fis(vA)).toBe(6);
      expect(await fis(vB)).toBe(0);

      // NOVA OS na variante B (saldo 0): baixar 3 BARRA — trava POR VARIANTE. Antes (soma por
      // aviamento) liberava, pois o aviamento tinha 10 no total.
      const osB = (await um<{ id: string }>(c, `select public.salvar_os('aviamento',null,$1::jsonb,$2::jsonb) id`,
        [JSON.stringify({ responsavel: "t" }), JSON.stringify([{ itemId: avi, varianteId: vB, reserva: 3 }])])).id;
      const itB = (await um<{ id: string }>(c, `select id from ordens_saida_aviamento_itens where ordem_saida_id=$1`, [osB])).id;
      await c.query("SAVEPOINT spb");
      await expect(c.query(`select public.baixar_os('aviamento',$1,$2::jsonb)`, [osB, JSON.stringify({ [itB]: 3 })]))
        .rejects.toThrow(/acima do estoque/i);
      await c.query("ROLLBACK TO SAVEPOINT spb");
    });
  });

  // FF#3: legado sem-variante segue igual — aviamento sem nenhuma variante cadastrada, item sem
  // varianteId; a trava usa o bucket "Sem variante" (fisico = recebido) exatamente como antes.
  it("aviamento SEM variante: item sem varianteId baixa dentro do saldo e barra acima (legado intacto)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const emp = await um<{ id: string } | undefined>(c, `select id from empresas where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      if (!emp) return;
      const avi = (await um<{ id: string }>(
        c, `insert into aviamentos(tenant_id,codigo_nome,empresa_id) values ($1,'ITEST-OSLEG',$2) returning id`,
        [TENANT_TESTE, emp.id])).id;
      const oc = { numero_pedido: "X", empresa_id: emp.id, data_prevista_entrega: "2026-07-01",
        prazo_pagamento: "30", quantidade_prazos: 1, parcelas_recebimento: [], status: "recebido" };
      await c.query(`select public._salvar_oc_aviamento_core(null,$1::jsonb,$2::jsonb)`,
        [JSON.stringify(oc), JSON.stringify([{ id: null, aviamento_id: avi, quantidade_pedida: 10, quantidade_recebida: 10, cancelado: false }])]);
      const os = (await um<{ id: string }>(c, `select public.salvar_os('aviamento',null,$1::jsonb,$2::jsonb) id`,
        [JSON.stringify({ responsavel: "t" }), JSON.stringify([{ itemId: avi, reserva: 5 }])])).id;
      const it = (await um<{ id: string; v: string | null }>(c, `select id, variante_aviamento_id v from ordens_saida_aviamento_itens where ordem_saida_id=$1`, [os]));
      expect(it.v).toBeNull(); // sem variante = null
      await c.query("SAVEPOINT spl");
      await expect(c.query(`select public.baixar_os('aviamento',$1,$2::jsonb)`, [os, JSON.stringify({ [it.id]: 12 })]))
        .rejects.toThrow(/acima do estoque/i);
      await c.query("ROLLBACK TO SAVEPOINT spl");
      await c.query(`select public.baixar_os('aviamento',$1,$2::jsonb)`, [os, JSON.stringify({ [it.id]: 8 })]);
      expect(Number((await um<{ b: string }>(c, `select baixa b from ordens_saida_aviamento_itens where id=$1`, [it.id])).b)).toBe(8);
    });
  });

  it("tecido: baixar_os TRAVA saldo (acima do físico) e piso 0 (utilizado negativo → baixa 0)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const av = await um<{ art: string; var: string } | undefined>(
        c, `select a.id art, v.id var from variantes_tecido v join artigos a on a.id=v.artigo_id
            where a.tenant_id=$1 and coalesce(a.unidade_medida,'metro')<>'kg' limit 1`, [TENANT_TESTE]);
      if (!av) return;
      const fis = Number((await um<{ f: string }>(c,
        `select coalesce(fisico,0) f from public._estoque_tecido_core($1) where variante_tecido_id=$2`, [TENANT_TESTE, av.var]))?.f ?? 0);

      const os = (await um<{ id: string }>(c, `select public.salvar_os('tecido', null, $1::jsonb, $2::jsonb) id`,
        [JSON.stringify({ responsavel: "t" }), JSON.stringify([{ itemId: av.var, reserva: 5 }])])).id;
      const it = (await um<{ id: string }>(c, `select id from ordens_saida_tecido_itens where ordem_saida_id=$1`, [os])).id;

      // trava: baixar acima do físico → bloqueia (antes tecido não travava)
      await c.query("SAVEPOINT sp");
      await expect(c.query(`select public.baixar_os('tecido',$1,$2::jsonb)`, [os, JSON.stringify({ [it]: fis + 9999 })]))
        .rejects.toThrow(/acima do estoque/i);
      await c.query("ROLLBACK TO SAVEPOINT sp");

      // piso 0: utilizado negativo NÃO infla o estoque (grava 0, não -50)
      await c.query(`select public.baixar_os('tecido',$1,$2::jsonb)`, [os, JSON.stringify({ [it]: -50 })]);
      expect(Number((await um<{ b: string }>(c, `select baixa b from ordens_saida_tecido_itens where id=$1`, [it])).b)).toBe(0);
    });
  });
});
