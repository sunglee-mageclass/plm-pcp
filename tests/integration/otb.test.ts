import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE, USER_TESTE } from "./db";

describe.skipIf(!hasDb)("OTB — coleções", () => {
  it("insere coleção e semana no tenant e lê de volta (RLS)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const col = await um<{ id: string; tenant_id: string; status: string }>(
        c,
        `insert into public.colecoes (nome, orcamento) values ($1, $2) returning id, tenant_id, status`,
        ["Verão Teste OTB", 100000],
      );
      expect(col.tenant_id).toBe(TENANT_TESTE);
      expect(col.status).toBe("rascunho");
      await c.query(
        `insert into public.colecao_semanas (colecao_id, semana, qtd_planejada) values ($1,'1',10)`,
        [col.id],
      );
      const wk = await um<{ n: string }>(c, `select count(*)::text n from public.colecao_semanas where colecao_id=$1`, [col.id]);
      expect(wk.n).toBe("1");
    });
  });
});

describe.skipIf(!hasDb)("OTB — otb_confirmar (geração/reconciliação)", () => {
  it("cria a qtd por semana; reconfirmar é idempotente; diminuir só apaga branco; não apaga preenchido", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // módulo otb ligado no tenant de teste (dentro da txn)
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-OTB-TEST','rascunho') returning id`, []);
      await c.query(`insert into colecao_semanas (colecao_id, semana, qtd_planejada) values ($1,'1',3)`, [col.id]);

      // 1) gera 3
      let r = await um<{ obj: any }>(c, `select public.otb_confirmar($1) as obj`, [col.id]);
      expect(r.obj.criados).toBe(3);
      let cnt = await um<{ n: string }>(c, `select count(*)::text n from modelos where colecao_id=$1 and semana='1'`, [col.id]);
      expect(cnt.n).toBe("3");

      // 2) idempotente: reconfirmar não cria/remove nada
      r = await um<{ obj: any }>(c, `select public.otb_confirmar($1) as obj`, [col.id]);
      expect(r.obj.criados).toBe(0); expect(r.obj.removidos).toBe(0); expect(r.obj.mantidos).toBe(0);

      // 3) preenche 1 card (toca), baixa alvo p/ 1 → remove só os brancos, mantém o preenchido
      // Postgres não tem UPDATE ... LIMIT; usar subselect:
      await c.query(`update modelos set nome='PREENCHIDO' where id = (select id from modelos where colecao_id=$1 and semana='1' and coalesce(nome,'')='' limit 1)`, [col.id]);
      await c.query(`update colecao_semanas set qtd_planejada=1 where colecao_id=$1 and semana='1'`, [col.id]);
      r = await um<{ obj: any }>(c, `select public.otb_confirmar($1) as obj`, [col.id]);
      // existiam 3, alvo 1, diff -2; brancos = 2 → remove 2, sobra o preenchido (mantidos reflete o excesso não-removível=0)
      expect(r.obj.removidos).toBe(2); expect(r.obj.mantidos).toBe(0);
      cnt = await um<{ n: string }>(c, `select count(*)::text n from modelos where colecao_id=$1 and semana='1'`, [col.id]);
      expect(cnt.n).toBe("1");
      const nome = await um<{ nome: string }>(c, `select nome from modelos where colecao_id=$1 and semana='1'`, [col.id]);
      expect(nome.nome).toBe("PREENCHIDO");
    });
  });

  it("bloqueia quando o módulo otb está desligado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // tenant_module_enabled retorna true para super_admin incondicionalmente;
      // temporariamente removemos o papel super_admin do usuário de teste (dentro da txn, revertido no ROLLBACK)
      // para que a verificação de módulo seja avaliada normalmente.
      await c.query(`delete from user_roles where user_id=$1 and role='super_admin'`, [USER_TESTE]);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":false}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome) values ('C-OTB-OFF') returning id`, []);
      await expect(c.query(`select public.otb_confirmar($1)`, [col.id])).rejects.toThrow();
    });
  });
});
