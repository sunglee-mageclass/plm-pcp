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
  it("cria a árvore com variantes e re-salva substituindo", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-SIM2','rascunho') returning id`, []);
      // OC com 2 itens (variantes)
      const oc = await um<{ id: string }>(c, `insert into ocs_tecido (numero_pedido, status) values ('OC-SIM','rascunho') returning id`, []);
      const art = await um<{ id: string }>(c, `insert into artigos (nome, unidade_medida, rendimento) values ('Art','metro',1) returning id`, []);
      const i1 = await um<{ id: string }>(c, `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, quantidade_pedida) values ($1,$2,500) returning id`, [oc.id, art.id]);
      const i2 = await um<{ id: string }>(c, `insert into ocs_tecido_itens (oc_tecido_id, artigo_id, quantidade_pedida) values ($1,$2,300) returning id`, [oc.id, art.id]);
      const arvore = [{ subcolecao_id: null, oc_tecido_id: oc.id, variantes: [{ oc_tecido_item_id: i1.id }, { oc_tecido_item_id: i2.id }],
        linhas: [{ linha_id: null, prof_cor: 8, cores: 2, num_modelos: 2, modelos: [{ slot_index: 0, consumo: 1.2 }, { slot_index: 1, consumo: 1.5 }] }] }];
      const id = (await um<{ id: string }>(c, `select public.salvar_simulacao(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Cenário A" }), JSON.stringify(arvore)])).id;
      const chk = await um<{ un: string; va: string; oc: string; md: string }>(c,
        `select (select count(*) from otb_simulacao_unidades u where u.simulacao_id=$1)::text un,
                (select count(*) from otb_simulacao_variantes v join otb_simulacao_unidades u on u.id=v.unidade_id where u.simulacao_id=$1)::text va,
                (select oc_tecido_id::text from otb_simulacao_unidades where simulacao_id=$1) oc,
                (select count(*) from otb_simulacao_modelos m join otb_simulacao_linhas l on l.id=m.linha_ref_id join otb_simulacao_unidades u on u.id=l.unidade_id where u.simulacao_id=$1)::text md`, [id]);
      expect(chk.un).toBe("1"); expect(chk.va).toBe("2"); expect(chk.oc).toBe(oc.id); expect(chk.md).toBe("2");
      // re-salva com 1 variante → substitui (cascade limpa variantes antigas)
      const arvore2 = [{ subcolecao_id: null, oc_tecido_id: oc.id, variantes: [{ oc_tecido_item_id: i1.id }],
        linhas: [{ linha_id: null, prof_cor: 8, cores: 1, num_modelos: 1, modelos: [{ slot_index: 0, consumo: 2 }] }] }];
      await c.query(`select public.salvar_simulacao($1, $2::jsonb, $3::jsonb)`, [id, JSON.stringify({ colecao_id: col.id, nome: "A2" }), JSON.stringify(arvore2)]);
      const chk2 = await um<{ va: string; md: string }>(c,
        `select (select count(*) from otb_simulacao_variantes v join otb_simulacao_unidades u on u.id=v.unidade_id where u.simulacao_id=$1)::text va,
                (select count(*) from otb_simulacao_modelos m join otb_simulacao_linhas l on l.id=m.linha_ref_id join otb_simulacao_unidades u on u.id=l.unidade_id where u.simulacao_id=$1)::text md`, [id]);
      expect(chk2.va).toBe("1"); expect(chk2.md).toBe("1");
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
         JSON.stringify([{ subcolecao_id: null, oc_tecido_id: null, variantes: [], linhas: [{ prof_cor: 1, cores: 1, num_modelos: 1, modelos: [{ slot_index: 0, consumo: 1 }] }] }])])).id;
      await c.query(`select public.excluir_simulacao($1)`, [id]);
      const chk = await um<{ n: string; nun: string }>(c,
        `select (select count(*) from otb_simulacoes where id=$1)::text n,
                (select count(*) from otb_simulacao_unidades where simulacao_id=$1)::text nun`, [id]);
      expect(chk.n).toBe("0"); expect(chk.nun).toBe("0");
    });
  });
});

describe.skipIf(!hasDb)("OTB Simulador — aplicar_simulacao (PV)", () => {
  it("grava prof/cores e distribui o nº de modelos nas semanas", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const linha = await um<{ id: string }>(c, `insert into linhas (nome) values ('L-SIM') returning id`, []);
      // coleção PV com 1 subcoleção (semanas 1..5) e 1 item de linha
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, tipo, status) values ('C-PV-SIM','poder_venda','rascunho') returning id`, []);
      const sub = await um<{ id: string }>(c, `insert into colecao_subcolecoes (colecao_id, nome, semanas) values ($1,'Sub', '{1,2,3,4,5}') returning id`, [col.id]);
      await c.query(`insert into colecao_pv_itens (colecao_id, subcolecao_id, linha_id, prof_cor, cores, qtd_semanas) values ($1,$2,$3, 4, 2, '{}'::jsonb)`, [col.id, sub.id, linha.id]);
      // simulação: mesma unidade/linha, prof 8 cores 3, 13 modelos
      const arvore = [{ subcolecao_id: sub.id, oc_tecido_id: null, variantes: [],
        linhas: [{ linha_id: linha.id, prof_cor: 8, cores: 3, num_modelos: 13, modelos: [] }] }];
      const simId = (await um<{ id: string }>(c, `select public.salvar_simulacao(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Cen" }), JSON.stringify(arvore)])).id;
      const unId = (await um<{ id: string }>(c, `select id from otb_simulacao_unidades where simulacao_id=$1`, [simId])).id;
      const r = await um<{ obj: any }>(c, `select public.aplicar_simulacao($1,$2) as obj`, [simId, unId]);
      expect(r.obj.aplicado).toBe(true);
      const it = await um<{ prof: number; cores: number; q: any }>(c,
        `select prof_cor prof, cores, qtd_semanas q from colecao_pv_itens where colecao_id=$1 and subcolecao_id=$2 and linha_id=$3`, [col.id, sub.id, linha.id]);
      expect(it.prof).toBe(8); expect(it.cores).toBe(3);
      // splitEven(13,5) = [3,3,3,2,2]
      expect(it.q).toEqual({ "1": 3, "2": 3, "3": 3, "4": 2, "5": 2 });
      // idempotente: reaplicar dá o mesmo
      await c.query(`select public.aplicar_simulacao($1,$2)`, [simId, unId]);
      const it2 = await um<{ q: any }>(c, `select qtd_semanas q from colecao_pv_itens where colecao_id=$1 and subcolecao_id=$2 and linha_id=$3`, [col.id, sub.id, linha.id]);
      expect(it2.q).toEqual({ "1": 3, "2": 3, "3": 3, "4": 2, "5": 2 });
    });
  });
});

describe.skipIf(!hasDb)("OTB Simulador — aplicar_simulacao (Orçamento)", () => {
  it("distribui o total nas semanas de colecao_semanas", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, tipo, status) values ('C-ORC-SIM','orcamento','rascunho') returning id`, []);
      const sub = await um<{ id: string }>(c, `insert into colecao_subcolecoes (colecao_id, nome, semanas) values ($1,'S','{1,2}') returning id`, [col.id]);
      await c.query(`insert into colecao_semanas (colecao_id, subcolecao_id, semana, qtd_planejada) values ($1,$2,'1',0),($1,$2,'2',0)`, [col.id, sub.id]);
      const arvore = [{ subcolecao_id: sub.id, oc_tecido_id: null, variantes: [], linhas: [{ linha_id: null, prof_cor: 1, cores: 1, num_modelos: 7, modelos: [] }] }];
      const simId = (await um<{ id: string }>(c, `select public.salvar_simulacao(null,$1::jsonb,$2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Cen" }), JSON.stringify(arvore)])).id;
      const unId = (await um<{ id: string }>(c, `select id from otb_simulacao_unidades where simulacao_id=$1`, [simId])).id;
      await c.query(`select public.aplicar_simulacao($1,$2)`, [simId, unId]);
      const sem = await um<{ s: string }>(c, `select string_agg(semana||':'||qtd_planejada, ',' order by semana) s from colecao_semanas where colecao_id=$1 and subcolecao_id=$2`, [col.id, sub.id]);
      expect(sem.s).toBe("1:4,2:3"); // splitEven(7,2)
    });
  });

  it("bloqueia se o novo total ficaria abaixo de Σ categorias da semana", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await ligarOtb(c);
      const cat = await um<{ id: string }>(c, `select id from categorias_produto where tenant_id=$1 limit 1`, [TENANT_TESTE]);
      const col = await um<{ id: string }>(c, `insert into colecoes (nome, tipo, status) values ('C-ORC-CAT','orcamento','rascunho') returning id`, []);
      const sub = await um<{ id: string }>(c, `insert into colecao_subcolecoes (colecao_id, nome, semanas) values ($1,'S','{1}') returning id`, [col.id]);
      await c.query(`insert into colecao_semanas (colecao_id, subcolecao_id, semana, qtd_planejada) values ($1,$2,'1',10)`, [col.id, sub.id]);
      await c.query(`insert into colecao_semana_categorias (colecao_id, subcolecao_id, semana, categoria_id, qtd) values ($1,$2,'1',$3,8)`, [col.id, sub.id, cat.id]);
      const arvore = [{ subcolecao_id: sub.id, oc_tecido_id: null, variantes: [], linhas: [{ linha_id: null, prof_cor: 1, cores: 1, num_modelos: 3, modelos: [] }] }];
      const simId = (await um<{ id: string }>(c, `select public.salvar_simulacao(null,$1::jsonb,$2::jsonb) as id`,
        [JSON.stringify({ colecao_id: col.id, nome: "Cen" }), JSON.stringify(arvore)])).id;
      const unId = (await um<{ id: string }>(c, `select id from otb_simulacao_unidades where simulacao_id=$1`, [simId])).id;
      await c.query(`savepoint sp1`);
      await expect(c.query(`select public.aplicar_simulacao($1,$2)`, [simId, unId])).rejects.toThrow(/Ajuste as categorias/);
      await c.query(`rollback to savepoint sp1`);
      const q = await um<{ q: string }>(c, `select qtd_planejada::text q from colecao_semanas where colecao_id=$1 and subcolecao_id=$2 and semana='1'`, [col.id, sub.id]);
      expect(q.q).toBe("10"); // inalterado
    });
  });
});
