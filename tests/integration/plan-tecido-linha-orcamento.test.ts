import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// F2 fix-linha-orcamento: na coleção ORCAMENTO as lanes sao por CATEGORIA (plan_tecido_linhas.linha_id = NULL). A "linha" do
// card e um atributo do SLOT (independente da lane). O Salvar tem de gravar modelos.linha_id vindo do SLOT; a arvore devolve a
// linha do modelo no slot; o card VIZINHO (outra lane) nao e afetado. Poder-de-venda (linha-persist) segue valendo.

async function ligarCriacao(c: any) {
  await c.query(
    `insert into tenant_config (tenant_id, modules) values ($1, '{"criacao":true,"otb":true}'::jsonb)
     on conflict (tenant_id) do update set modules = tenant_config.modules || '{"criacao":true,"otb":true}'::jsonb`,
    [TENANT_TESTE],
  );
}

const salvar = (c: any, col: string, arv: unknown) =>
  um(c, `select public.salvar_plan_tecido($1,$2::jsonb) id`, [col, JSON.stringify(arv)]);
const ler = async (c: any, col: string) => (await um<{ a: any }>(c, `select public.plan_tecido_arvore($1) a`, [col])).a;
const linhaDoModelo = async (c: any, mid: string) =>
  (await um<{ l: string | null }>(c, `select linha_id l from modelos where id = $1`, [mid])).l;

const slotDe = (slot_index: number, extra: Record<string, unknown>) => ({ slot_index, custos_adicionais: [], materiais: [], ...extra });

// Orcamento: 2 lanes por CATEGORIA (linha_id null), 1 card em cada.
const arvoreOrcamento = (catA: string, catB: string, a: Record<string, unknown>, b: Record<string, unknown>) => ({
  subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
    { linha_id: null, categoria_id: catA, ordem: 0, slots: [slotDe(0, a)] },
    { linha_id: null, categoria_id: catB, ordem: 1, slots: [slotDe(0, b)] },
  ] }],
});

async function cenario(c: any, tag: string) {
  await comoUsuario(c);
  await ligarCriacao(c);
  const col = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ($1,'rascunho') returning id`, [tag]);
  const estampado = (await um<{ id: string }>(c, `insert into linhas (nome) values ($1) returning id`, [`${tag}-Estampado`])).id;
  const casual = (await um<{ id: string }>(c, `insert into linhas (nome) values ($1) returning id`, [`${tag}-Casual`])).id;
  const catA = (await um<{ id: string }>(c, `insert into categorias_produto (tenant_id, nome) values ($1,$2) returning id`, [TENANT_TESTE, `${tag}-Vestido`])).id;
  const catB = (await um<{ id: string }>(c, `insert into categorias_produto (tenant_id, nome) values ($1,$2) returning id`, [TENANT_TESTE, `${tag}-Saia`])).id;
  const mk = async (nome: string, linha: string | null) => (await um<{ id: string }>(
    c, `insert into modelos (nome, colecao_id, tenant_id, linha_id) values ($1, $2, $3, $4) returning id`,
    [nome, col.id, TENANT_TESTE, linha],
  )).id;
  const m1 = await mk("Card1", estampado);
  const m2 = await mk("Card2", estampado);
  return { col: col.id, estampado, casual, catA, catB, m1, m2 };
}

describe.skipIf(!hasDb)("Plan. Tecido: Linha do card no fluxo ORCAMENTO (F2 fix-linha-orcamento)", () => {
  it("lane de categoria (linha_id null): a linha vinda do SLOT e gravada em modelos.linha_id e a arvore a devolve", async () => {
    await withTx(async (c) => {
      const { col, casual, catA, catB, m1, m2 } = await cenario(c, "C-PT-LO1");
      await salvar(c, col, arvoreOrcamento(catA, catB, { modelo_id: m1, linha_id: casual }, { modelo_id: m2 }));
      expect(await linhaDoModelo(c, m1)).toBe(casual);
      const lanes = (await ler(c, col)).subcolecoes[0].linhas;
      expect(lanes[0].linha_id).toBeNull(); // a lane continua sendo de categoria
      expect(lanes[0].slots[0].linha_id).toBe(casual);
    });
  });

  it("o card VIZINHO (outra lane) nao e afetado", async () => {
    await withTx(async (c) => {
      const { col, estampado, casual, catA, catB, m1, m2 } = await cenario(c, "C-PT-LO2");
      await salvar(c, col, arvoreOrcamento(catA, catB, { modelo_id: m1, linha_id: casual }, { modelo_id: m2, linha_id: estampado }));
      expect(await linhaDoModelo(c, m2)).toBe(estampado);
      const lanes = (await ler(c, col)).subcolecoes[0].linhas;
      expect(lanes[1].slots[0].linha_id).toBe(estampado);
      expect(lanes[0].slots[0].linha_id).toBe(casual);
    });
  });

  it("slot sem linha_id no payload nao apaga a linha do card (nem a do vizinho)", async () => {
    await withTx(async (c) => {
      const { col, estampado, catA, catB, m1, m2 } = await cenario(c, "C-PT-LO3");
      await salvar(c, col, arvoreOrcamento(catA, catB, { modelo_id: m1 }, { modelo_id: m2, linha_id: null }));
      expect(await linhaDoModelo(c, m1)).toBe(estampado);
      expect(await linhaDoModelo(c, m2)).toBe(estampado);
    });
  });

  it("re-salvar sem mudanca e idempotente (nao toca o modelo)", async () => {
    await withTx(async (c) => {
      const { col, casual, catA, catB, m1, m2 } = await cenario(c, "C-PT-LO4");
      const arv = arvoreOrcamento(catA, catB, { modelo_id: m1, linha_id: casual }, { modelo_id: m2 });
      await salvar(c, col, arv);
      const antes = (await um<{ r: number }>(c, `select rev r from modelos where id = $1`, [m1])).r;
      await salvar(c, col, arv);
      const depois = (await um<{ r: number }>(c, `select rev r from modelos where id = $1`, [m1])).r;
      expect(depois).toBe(antes);
    });
  });

  it("linha de OUTRA loja no slot nao e gravada; modelo de OUTRA colecao nao e tocado (filtros de IDOR)", async () => {
    await withTx(async (c) => {
      const { col, estampado, casual, catA, catB, m1, m2 } = await cenario(c, "C-PT-LO5");
      const outroTenant = await um<{ id: string }>(c, `select id from tenants where id <> $1 limit 1`, [TENANT_TESTE]);
      const estranha = (await um<{ id: string }>(
        c, `insert into linhas (nome, tenant_id) values ('LO5-alheia', $1) returning id`, [outroTenant.id],
      )).id;
      const outra = await um<{ id: string }>(c, `insert into colecoes (nome, status) values ('C-PT-LO5-outra','rascunho') returning id`, []);
      const alheio = (await um<{ id: string }>(
        c, `insert into modelos (nome, colecao_id, tenant_id, linha_id) values ('Alheio', $1, $2, $3) returning id`,
        [outra.id, TENANT_TESTE, estampado],
      )).id;
      await salvar(c, col, arvoreOrcamento(catA, catB, { modelo_id: m1, linha_id: estranha }, { modelo_id: alheio, linha_id: casual }));
      expect(await linhaDoModelo(c, m1)).toBe(estampado);
      expect(await linhaDoModelo(c, alheio)).toBe(estampado);
      expect(m2).toBeTruthy();
    });
  });

  it("vaga SEM card no orcamento nao grava modelo algum", async () => {
    await withTx(async (c) => {
      const { col, estampado, casual, catA, catB, m1 } = await cenario(c, "C-PT-LO6");
      await salvar(c, col, arvoreOrcamento(catA, catB, { modelo_id: null, linha_id: casual }, { modelo_id: null }));
      expect(await linhaDoModelo(c, m1)).toBe(estampado);
    });
  });

  it("poder-de-venda: com a lane COM linha, a lane manda (slot com linha_id velho nao reverte o move)", async () => {
    await withTx(async (c) => {
      const { col, estampado, casual, m1 } = await cenario(c, "C-PT-LO7");
      const arv = { subcolecoes: [{ subcolecao_id: null, ordem: 0, linhas: [
        { linha_id: casual, categoria_id: null, ordem: 0, slots: [slotDe(0, { modelo_id: m1, linha_id: estampado })] },
      ] }] };
      await salvar(c, col, arv);
      expect(await linhaDoModelo(c, m1)).toBe(casual);
    });
  });
});
