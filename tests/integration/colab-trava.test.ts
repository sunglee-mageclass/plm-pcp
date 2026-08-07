import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, USER_TESTE } from "./db";

describe.skipIf(!hasDb)("colab — trava otimista (P0409)", () => {
  it("salvar_oc_tecido: _rev_base errado recusa com P0409; null passa da checagem", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string; rev: number }>(
        c, `insert into ocs_tecido (tenant_id, numero_pedido) values ($1,'TRAVA') returning id, rev`, [TENANT_TESTE]);
      // rev errado → P0409 (a checagem vem ANTES do payload; payload mínimo serve)
      await expect(
        um(c, `select salvar_oc_tecido($1, '{}'::jsonb, '[]'::jsonb, $2)`, [oc.id, oc.rev + 99]),
      ).rejects.toMatchObject({ code: "P0409" });
    });
  });
  it("salvar_oc_tecido: _rev_base CORRETO passa e o save bumpa o rev", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string; rev: number }>(
        c, `insert into ocs_tecido (tenant_id, numero_pedido) values ($1,'TRAVA2') returning id, rev`, [TENANT_TESTE]);
      // payload mínimo VÁLIDO: derive as chaves lendo /tmp/def__salvar_oc_tecido_core.sql
      // (o core lê _oc->>'numero_pedido' etc.; itens vazio = sem mudanças de item)
      await um(c, `select salvar_oc_tecido($1, jsonb_build_object('numero_pedido','TRAVA2'), '[]'::jsonb, $2)`, [oc.id, oc.rev]);
      const r = await um<{ rev: number }>(c, `select rev from ocs_tecido where id=$1`, [oc.id]);
      expect(r.rev).toBeGreaterThan(oc.rev);
    });
  });
  it("salvar_modelo_bom e salvar_plan_tecido: rev errado → P0409", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const m = await um<{ id: string; rev: number }>(
        c, `insert into modelos (tenant_id, nome) values ($1,'TRAVA M') returning id, rev`, [TENANT_TESTE]);
      // savepoint: um RAISE aborta a transação até o próximo ROLLBACK/SAVEPOINT — precisamos
      // seguir usando `c` depois (padrão já usado em outros testes de integração do repo).
      await c.query("SAVEPOINT sp1");
      await expect(
        um(c, `select salvar_modelo_bom($1,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$2)`, [m.id, m.rev + 99]),
      ).rejects.toMatchObject({ code: "P0409" });
      await c.query("ROLLBACK TO SAVEPOINT sp1");
      const col = await um<{ id: string; plan_rev: number }>(
        c, `insert into colecoes (tenant_id, nome) values ($1,'TRAVA C') returning id, plan_rev`, [TENANT_TESTE]);
      await expect(
        um(c, `select salvar_plan_tecido($1,'{}'::jsonb,$2)`, [col.id, col.plan_rev + 99]),
      ).rejects.toMatchObject({ code: "P0409" });
    });
  });

  // Fix round da revisão (item 1, IMPORTANT): o insert/upsert em plan_tecido (topo do
  // _salvar_plan_tecido_core) já dispara trg_colab_bump (Task 1) → 1 bump em plan_rev.
  // A linha extra de bump manual que a Task 2 tinha adicionado no fim da função somava um
  // 2º bump (1→3 em vez de 1→2 por chamada) — removida na migração de ajuste.
  it("salvar_plan_tecido: plan_rev incrementa em EXATAMENTE +1 por chamada (sem bump duplo)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const col = await um<{ id: string; plan_rev: number }>(
        c, `insert into colecoes (tenant_id, nome) values ($1,'TRAVA DELTA') returning id, plan_rev`, [TENANT_TESTE]);
      await um(c, `select salvar_plan_tecido($1,'{}'::jsonb)`, [col.id]);
      const r = await um<{ plan_rev: number }>(c, `select plan_rev from colecoes where id=$1`, [col.id]);
      expect(r.plan_rev).toBe(col.plan_rev + 1);
    });
  });

  // Fix round da revisão (item 2, Minor de segurança): a trava não pode vazar sinal de
  // existência de registro que o usuário não pode ver (outro tenant OU inexistente) — os
  // dois casos devem se comportar IGUAL: v_rev fica NULL → P0409 uniforme quando _rev_base
  // não é nulo. Aqui cobrimos o caso "inexistente" (uuid aleatório, não pertence a ninguém).
  it("salvar_oc_tecido: uuid inexistente + _rev_base não-nulo → P0409 (trava uniforme, sem sinal de existência)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query("SAVEPOINT sp1");
      await expect(
        um(c, `select salvar_oc_tecido(gen_random_uuid(), '{}'::jsonb, '[]'::jsonb, $1)`, [1]),
      ).rejects.toMatchObject({ code: "P0409" });
      await c.query("ROLLBACK TO SAVEPOINT sp1");
    });
  });

  // Onda final de review (item 1, IMPORTANT — IDOR pré-existente): a checagem de tenant de
  // _colecao_id só existia DENTRO do bloco da trava otimista (_rev_base not null). Com
  // _rev_base null, _salvar_plan_tecido_core nunca validava o tenant — qualquer autenticado
  // (com o módulo `criacao` ligado na PRÓPRIA loja) podia sobrescrever a árvore do Plan.
  // Tecido de OUTRA loja informando o id da coleção alheia. Fix: guarda incondicional no
  // topo da função (migração 20260803210000).
  it("salvar_plan_tecido: coleção de OUTRO tenant → rejeita (não P0409); não é 'super' que bypassa", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // super_admin faz o filtro `tenant_id = get_user_tenant_id() OR is_super_admin()` sempre
      // passar (bypass intencional) — removê-lo do USUÁRIO QUE AGE para o teste exercitar a
      // checagem de tenant de verdade (mesmo idiom usado em otb-simulador.test.ts).
      await c.query(`delete from user_roles where user_id=$1 and role='super_admin'`, [USER_TESTE]);
      await c.query("SAVEPOINT sp1");
      const outra = await um<{ id: string }>(
        c,
        `insert into colecoes (tenant_id, nome)
         values ((select id from tenants where nome='French' limit 1), 'IDOR T')
         returning id`,
      );
      await expect(
        um(c, `select salvar_plan_tecido($1, '{}'::jsonb)`, [outra.id]),
      ).rejects.toMatchObject({ code: "P0001", message: expect.stringContaining("sem permissão") });
      await c.query("ROLLBACK TO SAVEPOINT sp1");
    });
  });
});

describe.skipIf(!hasDb)("colab PCP/CQ — rev infra (T1)", () => {
  it("producao_terceirizados: UPDATE bumpa rev (BEFORE UPDATE); rev é do servidor", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string }>(
        c, `insert into cad (tenant_id) values ($1) returning id`, [TENANT_TESTE]);
      const pt = await um<{ id: string; rev: number }>(
        c, `insert into producao_terceirizados (cad_id, tenant_id, ativo) values ($1,$2,true) returning id, rev`,
        [cad.id, TENANT_TESTE]);
      const r1 = await um<{ rev: number }>(
        c, `update producao_terceirizados set observacao='x' where id=$1 returning rev`, [pt.id]);
      expect(r1.rev).toBe(pt.rev + 1);
      // rev é do SERVIDOR: gravar rev na mão não rebaixa
      const r2 = await um<{ rev: number }>(
        c, `update producao_terceirizados set rev=0 where id=$1 returning rev`, [pt.id]);
      expect(r2.rev).toBe(r1.rev + 1);
    });
  });
  it("controle_qualidade: UPDATE bumpa rev; insert de cq_variantes bumpa a raiz", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const cad = await um<{ id: string }>(
        c, `insert into cad (tenant_id) values ($1) returning id`, [TENANT_TESTE]);
      const cq = await um<{ id: string; rev: number }>(
        c, `insert into controle_qualidade (cad_id, tenant_id, status) values ($1,$2,'pendente') returning id, rev`,
        [cad.id, TENANT_TESTE]);
      const r1 = await um<{ rev: number }>(
        c, `update controle_qualidade set observacoes_cq='y' where id=$1 returning rev`, [cq.id]);
      expect(r1.rev).toBe(cq.rev + 1);
      await um(c, `insert into cq_variantes (controle_qualidade_id, variante_numero, etapa, grades, grade_total)
                   values ($1, 1, 'recebimento', '{}'::jsonb, 0)`, [cq.id]);
      const r2 = await um<{ rev: number }>(c, `select rev from controle_qualidade where id=$1`, [cq.id]);
      expect(r2.rev).toBeGreaterThan(r1.rev);
    });
  });
  it("publicação supabase_realtime contém producao_terceirizados e controle_qualidade", async () => {
    await withTx(async (c) => {
      const rows = await c.query(
        `select tablename from pg_publication_tables
          where pubname='supabase_realtime' and tablename in ('producao_terceirizados','controle_qualidade')`);
      expect(rows.rows.map((r: any) => r.tablename).sort())
        .toEqual(["controle_qualidade", "producao_terceirizados"]);
    });
  });
});
