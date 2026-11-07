import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// F2 fix-linha-persist: escolher a Linha num card JA CRIADO move a lane; o Salvar tem de GRAVAR modelos.linha_id
// (senao o seed recoloca o card pela linha antiga ao recarregar) e a arvore tem de devolver 'linha_id' no slot.

async function ligarCriacao(c: any) {
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true}'::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true,"otb":true}'::jsonb`,
    [TENANT_TESTE],
  );
}

const arvoreCom = (linhaId: string | null, slot: Record<string, unknown>) => ({
  subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
    { linha_id: linhaId, categoria_id: null, ordem: 0, slots: [{ slot_index: 0, custos_adicionais: [], materiais: [], ...slot }] },
  ] }],
});

const salvar = (c: any, col: string, arv: unknown) =>
  um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col, JSON.stringify(arv)]);
const ler = async (c: any, col: string) => (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col])).a;
const linhaDoModelo = async (c: any, mid: string) =>
  (await um<{ l: string | null }>(c, `select linha_id l from modelos where id = $1`, [mid])).l;

async function cenario(c: any, tag: string) {
  await comoUsuario(c);
  await ligarCriacao(c);
  const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ($1,'rascunho') returning id`, [tag]);
  const velha = (await um<{ id: string }>(c, `insert into linhas (nome) values ($1) returning id`, [`${tag}-Estampado`])).id;
  const nova = (await um<{ id: string }>(c, `insert into linhas (nome) values ($1) returning id`, [`${tag}-Casual`])).id;
  const mid = (await um<{ id: string }>(
    c, `insert into modelos (nome, colecao_id, tenant_id, linha_id) values ('Card', $1, $2, $3) returning id`,
    [col.id, TENANT_TESTE, velha],
  )).id;
  return { col: col.id, velha, nova, mid };
}

describe.skipIf(!hasDb)("Plan. Tecido: Linha do card persiste em modelos.linha_id (F2 fix-linha-persist)", () => {
  it("card real muda de lane/linha: o Salvar grava modelos.linha_id e a arvore devolve a linha nova no slot", async () => {
    await withTx(async (c) => {
      const { col, nova, mid } = await cenario(c, "C-PT-LP1");
      await salvar(c, col, arvoreCom(nova, { modelo_id: mid }));
      expect(await linhaDoModelo(c, mid)).toBe(nova);
      const slot = (await ler(c, col)).subcolecoes[0].linhas[0].slots[0];
      expect(slot.linha_id).toBe(nova);
      expect(slot.modelo_id).toBe(mid);
    });
  });

  it("re-salvar sem mudanca e idempotente (nao mexe no modelo: sem UPDATE desnecessario)", async () => {
    await withTx(async (c) => {
      const { col, nova, mid } = await cenario(c, "C-PT-LP2");
      await salvar(c, col, arvoreCom(nova, { modelo_id: mid }));
      const antes = (await um<{ r: number }>(c, `select rev r from modelos where id = $1`, [mid])).r;
      await salvar(c, col, arvoreCom(nova, { modelo_id: mid }));
      const depois = (await um<{ r: number }>(c, `select rev r from modelos where id = $1`, [mid])).r;
      expect(depois).toBe(antes); // linha igual => o UPDATE filtrado nao toca a linha
      expect(await linhaDoModelo(c, mid)).toBe(nova);
    });
  });

  it("lane SEM linha (linha_id null) nao apaga a linha do card; a arvore devolve a do modelo", async () => {
    await withTx(async (c) => {
      const { col, velha, mid } = await cenario(c, "C-PT-LP3");
      await salvar(c, col, arvoreCom(null, { modelo_id: mid }));
      expect(await linhaDoModelo(c, mid)).toBe(velha);
      expect((await ler(c, col)).subcolecoes[0].linhas[0].slots[0].linha_id).toBe(velha);
    });
  });

  it("vaga SEM card nao grava modelo algum; a arvore devolve a linha da lane", async () => {
    await withTx(async (c) => {
      const { col, nova, mid, velha } = await cenario(c, "C-PT-LP4");
      await salvar(c, col, arvoreCom(nova, { modelo_id: null }));
      expect(await linhaDoModelo(c, mid)).toBe(velha); // o card existente na colecao ficou intocado
      expect((await ler(c, col)).subcolecoes[0].linhas[0].slots[0].linha_id).toBe(nova);
    });
  });

  it("modelo_id de OUTRA colecao/loja nao tem a linha gravada (filtro de IDOR como o tamanho_tipo)", async () => {
    await withTx(async (c) => {
      const { col, nova } = await cenario(c, "C-PT-LP5");
      const outra = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT-LP5-outra','rascunho') returning id`, []);
      const velhaOutra = (await um<{ id: string }>(c, `insert into linhas (nome) values ('LP5-x') returning id`, [])).id;
      const alheio = (await um<{ id: string }>(
        c, `insert into modelos (nome, colecao_id, tenant_id, linha_id) values ('Alheio', $1, $2, $3) returning id`,
        [outra.id, TENANT_TESTE, velhaOutra],
      )).id;
      await salvar(c, col, arvoreCom(nova, { modelo_id: alheio }));
      expect(await linhaDoModelo(c, alheio)).toBe(velhaOutra);
    });
  });

  it("linha de OUTRA loja no payload nao e gravada no modelo", async () => {
    await withTx(async (c) => {
      const { col, velha, mid } = await cenario(c, "C-PT-LP6");
      const outroTenant = await um<{ id: string }>(c, `select id from tenants where id <> $1 limit 1`, [TENANT_TESTE]);
      const estranha = (await um<{ id: string }>(
        c, `insert into linhas (nome, tenant_id) values ('LP6-alheia', $1) returning id`, [outroTenant.id],
      )).id;
      await salvar(c, col, arvoreCom(estranha, { modelo_id: mid }));
      expect(await linhaDoModelo(c, mid)).toBe(velha);
    });
  });

  it("S3d (trg_aaa_seg_pagina) nao barra o Salvar quando o chamador e o papel 'authenticated'", async () => {
    await withTx(async (c) => {
      const { col, nova, mid } = await cenario(c, "C-PT-LP7");
      await c.query(`set local role authenticated`);
      await salvar(c, col, arvoreCom(nova, { modelo_id: mid }));
      await c.query(`reset role`);
      expect(await linhaDoModelo(c, mid)).toBe(nova);
    });
  });
});
