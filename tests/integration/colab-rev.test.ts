import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("colab — rev bump (raiz + filhas)", () => {
  it("update na raiz incrementa rev; update em filha dá bump na raiz", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const art = await um<{ id: string }>(
        c, `insert into artigos (tenant_id, nome) values ($1, 'COLAB TESTE') returning id`, [TENANT_TESTE]);
      const oc = await um<{ id: string; rev: number }>(
        c, `insert into ocs_tecido (tenant_id, numero_pedido) values ($1, 'COLAB-REV') returning id, rev`, [TENANT_TESTE]);
      expect(oc.rev).toBe(1);
      // update direto na raiz → rev+1 (BEFORE UPDATE)
      const r1 = await um<{ rev: number }>(
        c, `update ocs_tecido set observacoes_entrega = 'x' where id = $1 returning rev`, [oc.id]);
      expect(r1.rev).toBe(2);
      // insert de FILHA → bump na raiz (AFTER trigger)
      await um(c, `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, quantidade_pedida) values ($1,$2,10) returning id`, [oc.id, art.id]);
      const r2 = await um<{ rev: number }>(c, `select rev from ocs_tecido where id = $1`, [oc.id]);
      expect(r2.rev).toBeGreaterThan(2);
      // rev é do SERVIDOR: tentar gravar rev manualmente não rebaixa
      const r3 = await um<{ rev: number }>(
        c, `update ocs_tecido set rev = 1 where id = $1 returning rev`, [oc.id]);
      expect(r3.rev).toBe(r2.rev + 1);
    });
  });

  it("publicação supabase_realtime contém as 3 raízes", async () => {
    await withTx(async (c) => {
      const rows = await um<{ n: string }>(
        c, `select count(*)::int as n from pg_publication_tables where pubname='supabase_realtime'
            and tablename in ('modelos','ocs_tecido','colecoes')`, []);
      expect(Number(rows.n)).toBe(3);
    });
  });

  it("audit ignora rev no diff — bump não gera entrada fantasma", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const art = await um<{ id: string }>(
        c, `insert into artigos (tenant_id, nome) values ($1, 'AUDIT TEST') returning id`, [TENANT_TESTE]);
      const oc = await um<{ id: string }>(
        c, `insert into ocs_tecido (tenant_id, numero_pedido) values ($1, 'AUDIT-REV') returning id`, [TENANT_TESTE]);

      // Conta linhas do audit_log após a criação da OC (a criação em si cria uma entrada)
      const auditAntes = await um<{ n: number }>(
        c, `select count(*)::int as n from audit_log where tenant_id = $1`, [TENANT_TESTE]);

      // Insere item — dispara bump na OC (UPDATE no-op que incrementa rev)
      await um(c, `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, quantidade_pedida) values ($1,$2,10) returning id`, [oc.id, art.id]);

      // Confere audit_log: nenhuma entrada NOVA de "Editou OC de Tecido" vinda só do rev
      // (o diff vazio por rev estar excluído faz fn_audit retornar NULL e não logar)
      const auditDepois = await um<{ n: number }>(
        c, `select count(*)::int as n from audit_log where tenant_id = $1`, [TENANT_TESTE]);

      // A única entrada esperada é a INSERT do ocs_tecido no próprio ato; o bump NÃO cria log
      expect(auditDepois.n).toBe(auditAntes.n);
    });
  });
});
