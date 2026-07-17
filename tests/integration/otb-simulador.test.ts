import { describe, it, expect } from "vitest";
import { withTx, comoUsuario, um, hasDb, TENANT_TESTE, USER_TESTE } from "./db";

const ligarOtb = (c: any) =>
  c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":true}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);

describe.skipIf(!hasDb)("OTB Simulador — tabelas", () => {
  it("insere simulação e o tenant vem por trigger (RLS)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-SIM','rascunho') returning id`, []);
      const sim = await um<{ id: string; tenant_id: string }>(
        c, `insert into otb_simulacoes (colecao_id, nome) values ($1,'Cenário 1') returning id, tenant_id`, [col.id]);
      expect(sim.tenant_id).toBe(TENANT_TESTE);
      const un = await um<{ tenant_id: string }>(
        c, `insert into otb_simulacao_unidades (simulacao_id, subcolecao_id) values ($1, null) returning tenant_id`, [sim.id]);
      expect(un.tenant_id).toBe(TENANT_TESTE);
    });
  });
});

describe.skipIf(!hasDb)("OTB Simulador — salvar_simulacao", () => {
  it("cria a árvore e re-salva substituindo (delete-and-reinsert)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-SIM2','rascunho') returning id`, []);
      const arvore = [{ subcolecao_id: null, oc_tecido_item_id: null,
        linhas: [{ linha_id: null, prof_cor: 8, cores: 3, num_modelos: 2,
          modelos: [{ slot_index: 0, consumo: 1.2 }, { slot_index: 1, consumo: 1.5 }] }] }];
      const id = (await um<{ id: string }>(c, `select public.salvar_simulacao(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Cenário A" }), JSON.stringify(arvore)])).id;
      let chk = await um<{ un: string; ln: string; md: string }>(c,
        `select (select count(*) from otb_simulacao_unidades u where u.simulacao_id=$1)::text un,
                (select count(*) from otb_simulacao_linhas l join otb_simulacao_unidades u on u.id=l.unidade_id where u.simulacao_id=$1)::text ln,
                (select count(*) from otb_simulacao_modelos m join otb_simulacao_linhas l on l.id=m.linha_ref_id join otb_simulacao_unidades u on u.id=l.unidade_id where u.simulacao_id=$1)::text md`, [id]);
      expect(chk.un).toBe("1"); expect(chk.ln).toBe("1"); expect(chk.md).toBe("2");
      // re-salva com 1 modelo só → substitui
      const arvore2 = [{ subcolecao_id: null, oc_tecido_item_id: null,
        linhas: [{ linha_id: null, prof_cor: 8, cores: 3, num_modelos: 1, modelos: [{ slot_index: 0, consumo: 2 }] }] }];
      await c.query(`select public.salvar_simulacao($1, $2::jsonb, $3::jsonb)`,
        [id, JSON.stringify({ colecao_id: col.id, nome: "Cenário A2" }), JSON.stringify(arvore2)]);
      chk = await um<{ un: string; ln: string; md: string }>(c,
        `select (select count(*) from otb_simulacao_unidades u where u.simulacao_id=$1)::text un,
                (select count(*) from otb_simulacao_linhas l join otb_simulacao_unidades u on u.id=l.unidade_id where u.simulacao_id=$1)::text ln,
                (select count(*) from otb_simulacao_modelos m join otb_simulacao_linhas l on l.id=m.linha_ref_id join otb_simulacao_unidades u on u.id=l.unidade_id where u.simulacao_id=$1)::text md`, [id]);
      expect(chk.un).toBe("1"); expect(chk.ln).toBe("1"); expect(chk.md).toBe("1");
      const nome = await um<{ nome: string }>(c, `select nome from otb_simulacoes where id=$1`, [id]);
      expect(nome.nome).toBe("Cenário A2");
    });
  });

  it("bloqueia quando o módulo otb está desligado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // super_admin faz tenant_module_enabled retornar true incondicionalmente — removê-lo
      // do USUÁRIO QUE AGE (USER_TESTE, não um arbitrário) p/ o gate de módulo ser avaliado.
      await c.query(`delete from user_roles where user_id=$1 and role='super_admin'`, [USER_TESTE]);
      await c.query(`update tenant_config set modules = coalesce(modules,'{}'::jsonb) || '{"otb":false}'::jsonb where tenant_id=$1`, [TENANT_TESTE]);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome) values ('C-OFF') returning id`, []);
      await expect(c.query(`select public.salvar_simulacao(null, $1::jsonb, '[]'::jsonb)`,
        [JSON.stringify({ colecao_id: col.id, nome: "X" })])).rejects.toThrow();
    });
  });
});

describe.skipIf(!hasDb)("OTB Simulador — excluir_simulacao", () => {
  it("apaga a simulação e cascateia as filhas", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome) values ('C-DEL-SIM') returning id`, []);
      const id = (await um<{ id: string }>(c, `select public.salvar_simulacao(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Del" }),
         JSON.stringify([{ subcolecao_id: null, linhas: [{ prof_cor: 1, cores: 1, num_modelos: 1, modelos: [{ slot_index: 0, consumo: 1 }] }] }])])).id;
      await c.query(`select public.excluir_simulacao($1)`, [id]);
      const chk = await um<{ n: string; nun: string }>(c,
        `select (select count(*) from otb_simulacoes where id=$1)::text n,
                (select count(*) from otb_simulacao_unidades where simulacao_id=$1)::text nun`, [id]);
      expect(chk.n).toBe("0"); expect(chk.nun).toBe("0");
    });
  });
});
