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

  it("protege card tocado só via campo do preenchimento em massa (linha_id) no shrink", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-OTB-LINHA','rascunho') returning id`, []);
      await c.query(`insert into colecao_semanas (colecao_id, semana, qtd_planejada) values ($1,'1',3)`, [col.id]);
      await c.query(`select public.otb_confirmar($1)`, [col.id]);
      // "toca" um card definindo SÓ a linha (como faz o preenchimento em massa)
      const linha = await um<{ id: string }>(c, `insert into linhas (nome) values ('L-OTB-TEST') returning id`, []);
      await c.query(`update modelos set linha_id=$2 where id = (select id from modelos where colecao_id=$1 and semana='1' limit 1)`, [col.id, linha.id]);
      // baixa alvo p/ 1 → só os 2 brancos podem sair; o de linha definida fica protegido
      await c.query(`update colecao_semanas set qtd_planejada=1 where colecao_id=$1 and semana='1'`, [col.id]);
      const r = await um<{ obj: any }>(c, `select public.otb_confirmar($1) as obj`, [col.id]);
      expect(r.obj.removidos).toBe(2);
      const kept = await um<{ n: string; linha: string | null }>(c, `select count(*)::text n, max(linha_id::text) linha from modelos where colecao_id=$1 and semana='1'`, [col.id]);
      expect(kept.n).toBe("1");
      expect(kept.linha).toBe(linha.id);
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

describe.skipIf(!hasDb)("OTB — importar coleções existentes", () => {
  it("cria coleção a partir do texto e liga os modelos", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      await c.query(`insert into modelos (nome, colecao, status_planejamento, versao) values ('M1','ImportTest','em_planejamento',1),('M2','ImportTest','em_planejamento',1)`);
      const r = await um<{ obj: any }>(c, `select public.otb_importar_colecoes() as obj`, []);
      expect(r.obj.importadas).toBeGreaterThanOrEqual(1);
      const linked = await um<{ n: string }>(c, `select count(*)::text n from modelos m join colecoes col on col.id=m.colecao_id where col.nome='ImportTest'`, []);
      expect(Number(linked.n)).toBeGreaterThanOrEqual(2);
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
      await expect(c.query(`select public.otb_importar_colecoes()`)).rejects.toThrow();
    });
  });
});

describe.skipIf(!hasDb)("OTB — otb_salvar_colecao (persistência atômica)", () => {
  it("cria com subcoleções (semanas+categorias) e re-salva removendo uma sub", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const cat = await um<{ id: string }>(c, `select id from categorias_produto where tenant_id=$1 limit 1`, [TENANT_TESTE]);

      // CRIA: 2 subcoleções (SubA: sem1=10,sem2=5 + cat sem1=4 ; SubB: sem3=7)
      const p1 = {
        nome: "C-SALVAR",
        subs: [
          { nome: "SubA", weeks: { "1": 10, "2": 5 }, cats: { "1": { [cat.id]: 4 } } },
          { nome: "SubB", weeks: { "3": 7 }, cats: {} },
        ],
      };
      const created = await um<{ id: string }>(c, `select public.otb_salvar_colecao($1::jsonb) as id`, [JSON.stringify(p1)]);
      const chk = await um<{ n_sub: string; n_sem: string; n_cat: string; tenant: string }>(
        c,
        `select (select count(*) from colecao_subcolecoes where colecao_id=$1)::text n_sub,
                (select count(*) from colecao_semanas where colecao_id=$1)::text n_sem,
                (select count(*) from colecao_semana_categorias where colecao_id=$1)::text n_cat,
                (select tenant_id::text from colecao_semanas where colecao_id=$1 limit 1) tenant`,
        [created.id],
      );
      expect(chk.n_sub).toBe("2");
      expect(chk.n_sem).toBe("3");
      expect(chk.n_cat).toBe("1");
      expect(chk.tenant).toBe(TENANT_TESTE); // tenant vem por trigger

      // RE-SALVA: mantém só SubA renomeada (sem1=20) → remove SubB + regrava semanas
      const suba = await um<{ id: string }>(c, `select id from colecao_subcolecoes where colecao_id=$1 and nome='SubA'`, [created.id]);
      const p2 = { id: created.id, nome: "C-SALVAR-2", subs: [{ id: suba.id, nome: "SubA2", weeks: { "1": 20 }, cats: {} }] };
      await c.query(`select public.otb_salvar_colecao($1::jsonb)`, [JSON.stringify(p2)]);
      const chk2 = await um<{ n_sub: string; nome: string; sem: string; n_cat: string }>(
        c,
        `select (select count(*) from colecao_subcolecoes where colecao_id=$1)::text n_sub,
                (select nome from colecao_subcolecoes where id=$2) nome,
                (select string_agg(semana||':'||qtd_planejada,',') from colecao_semanas where colecao_id=$1) sem,
                (select count(*) from colecao_semana_categorias where colecao_id=$1)::text n_cat`,
        [created.id, suba.id],
      );
      expect(chk2.n_sub).toBe("1"); // SubB removida
      expect(chk2.nome).toBe("SubA2");
      expect(chk2.sem).toBe("1:20");
      expect(chk2.n_cat).toBe("0"); // cats regravadas (SubA agora sem distribuição)
    });
  });

  it("caminho sem subcoleções grava no nível coleção", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const cat = await um<{ id: string }>(c, `select id from categorias_produto where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const p = { nome: "C-SIMPLES", weeks: { "1": 8, "2": 3 }, weekCats: { "1": { [cat.id]: 2 } } };
      const created = await um<{ id: string }>(c, `select public.otb_salvar_colecao($1::jsonb) as id`, [JSON.stringify(p)]);
      const chk = await um<{ n_sub: string; n_sem: string; n_cat: string }>(
        c,
        `select (select count(*) from colecao_subcolecoes where colecao_id=$1)::text n_sub,
                (select count(*) from colecao_semanas where colecao_id=$1 and subcolecao_id is null)::text n_sem,
                (select count(*) from colecao_semana_categorias where colecao_id=$1)::text n_cat`,
        [created.id],
      );
      expect(chk.n_sub).toBe("0");
      expect(chk.n_sem).toBe("2");
      expect(chk.n_cat).toBe("1");
    });
  });

  it("bloqueia quando o módulo otb está desligado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`delete from user_roles where user_id=$1 and role='super_admin'`, [USER_TESTE]);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":false}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      await expect(c.query(`select public.otb_salvar_colecao($1::jsonb)`, [JSON.stringify({ nome: "X" })])).rejects.toThrow();
    });
  });

  it("atribuição adiada: salva sub nova + atribui card no mesmo Save, sem contar 2×", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-ASG','rascunho') returning id`, []);
      const card = await um<{ id: string }>(c, `insert into modelos (colecao_id, nome, status_planejamento, versao) values ($1,'Card','em_planejamento',1) returning id`, [col.id]);
      // Save: subcoleção NOVA "Praia" (semana 3, qtd=1 = editor somou +1) + atribuição do card
      await c.query(`select public.otb_salvar_colecao($1::jsonb)`, [JSON.stringify({
        id: col.id, nome: "C-ASG",
        subs: [{ nome: "Praia", weeks: { "3": 1 }, cats: {}, meta: {} }],
        assignments: [{ modelo_id: card.id, sub_nome: "Praia", semana: "3" }],
      })]);
      const m = await um<{ sub: string; sem: string }>(c, `select subcolecao sub, semana sem from modelos where id=$1`, [card.id]);
      expect(m.sub).toBe("Praia");
      expect(m.sem).toBe("3");
      const q = await um<{ q: string }>(
        c,
        `select cs.qtd_planejada::text q from colecao_semanas cs join colecao_subcolecoes sc on sc.id=cs.subcolecao_id
         where cs.colecao_id=$1 and sc.nome='Praia' and cs.semana='3'`,
        [col.id],
      );
      expect(q.q).toBe("1"); // 1 card, não 2 (trava GUC evitou o gatilho re-incrementar)
    });
  });
});

describe.skipIf(!hasDb)("OTB — otb_excluir_colecao", () => {
  it("exclui a coleção + modelos em planejamento/reprovado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const a = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-DEL-A','confirmada') returning id`, []);
      await c.query(`insert into colecao_semanas (colecao_id, semana, qtd_planejada) values ($1,'1',0)`, [a.id]);
      await c.query(`insert into modelos (colecao_id, nome, status_planejamento, versao) values ($1,'M1','em_planejamento',1),($1,'M2','reprovado',1)`, [a.id]);
      await c.query(`select public.otb_excluir_colecao($1)`, [a.id]);
      const col = await um<{ n: string }>(c, `select count(*)::text n from colecoes where id=$1`, [a.id]);
      expect(col.n).toBe("0");
      const mod = await um<{ n: string }>(c, `select count(*)::text n from modelos where colecao_id=$1`, [a.id]);
      expect(mod.n).toBe("0");
    });
  });

  it("bloqueia se houver modelo em status planejado (não exclui nada)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const b = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-DEL-B','confirmada') returning id`, []);
      await c.query(`insert into modelos (colecao_id, nome, status_planejamento, versao) values ($1,'M3','planejado',1)`, [b.id]);
      await c.query(`savepoint sp1`);
      await expect(c.query(`select public.otb_excluir_colecao($1)`, [b.id])).rejects.toThrow();
      await c.query(`rollback to savepoint sp1`);
      const col = await um<{ n: string }>(c, `select count(*)::text n from colecoes where id=$1`, [b.id]);
      expect(col.n).toBe("1");
    });
  });
});
