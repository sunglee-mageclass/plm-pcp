// Achados LEVES L8 — Comprados: custo, preço e insumo (migration 20261028200000_revenda_insumo_preco).
//   preço M1: insumo da revenda = Σ custo_previsto UMA vez (_pa_recomputar_precos_modelo e _salvar_produto_acabado_core /
//             insumos_total) — anti-drift TS × SQL (recomputeEtiqueta + totaisBom + precoAtacado/precoVarejo);
//   preço M2: editar o insumo do card espelho recalcula o preço (gatilho fn_preco_comprado_por_insumo); preço FIXO manda;
//             trava da Integração segura o preço de venda sem recusa; importado recalcula também;
//   preço B3: markup 0 = sem preço (NULL), igual ao importado;
//   sku #22:  a variante que sai leva a grade dela (modelo_grades) — a nova não herda;
//   P-207 A:  _salvar_produto_importado_core recusa etapa de mercadoria com % > 0 e cotação 0.
// Tudo em txn revertida (nada grava); SÓ na cópia local (54422). Cada teste falha contra o código de antes da L8.
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE, ehBancoLocal } from "./db";
import { md5OuSucessorI3 } from "./integracao-helpers";
import { totaisBom } from "@/components/planejamento/planejamento-detail/ficha/ficha-calc";
import {
  recomputeEtiqueta,
  type EtiquetaInfo,
} from "@/components/desenvolvimento/modelo-detail/types";
import { precoAtacado, precoVarejo } from "@/lib/preco-revenda";

const RODA = hasDb && ehBancoLocal();
const MD5: Record<string, string> = {
  "public._pa_recomputar_precos_modelo(uuid)": "3f0c4d88da8e23a61ff9e3dda7817be2",
  "public._salvar_produto_acabado_core(uuid,jsonb,jsonb)": "77076d81637354d530ee38a03e8f77e7",
  "public._salvar_produto_importado_core(uuid,jsonb,jsonb,jsonb)":
    "3bbdcb7fd2b1040881ba55c44d04eb17",
  "public._salvar_oc_importado_core(uuid,jsonb,jsonb,jsonb,integer)":
    "cd904901b87f15e21121b47aa1b34438",
  "public.fn_preco_comprado_por_insumo()": "ccd231e45d1e9a379b252e574c5cda5e",
};

type Revenda = { prod: string; modelo: string; dados: Record<string, unknown> };

/** Revenda nova da Loja Teste com card espelho: valor 100, sem desconto, markups 2 / 3, 1 variante (ordem 1). */
async function revenda(
  c: Client,
  variantes: unknown[] = [{ ordem: 1, peso: 1, qtd: 10 }],
): Promise<Revenda> {
  await comoUsuario(c);
  const g = await um<{ id: string }>(
    c,
    `insert into grupos_produto (tenant_id, nome) values ($1,'Fem L8 PATest') returning id`,
    [TENANT_TESTE],
  );
  const cat = await um<{ id: string }>(
    c,
    `insert into categorias_produto (tenant_id, nome) values ($1,'Vestido L8 PATest') returning id`,
    [TENANT_TESTE],
  );
  const dados = {
    nome: "Vestido L8",
    grupo_id: g.id,
    categoria_id: cat.id,
    qtd_total: 10,
    valor_unitario: 100,
    desconto_pct: 0,
    markup_atacado: 2,
    markup_varejo: 3,
    grade_proporcao: { P: 1 },
  };
  const prod = await um<{ id: string }>(
    c,
    `select salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`,
    [JSON.stringify(dados), JSON.stringify(variantes)],
  );
  const modelo = await um<{ id: string }>(c, `select criar_card_produto_acabado($1) as id`, [
    prod.id,
  ]);
  return { prod: prod.id, modelo: modelo.id, dados };
}
const salvar = (c: Client, r: Revenda, variantes: unknown[], extra: Record<string, unknown> = {}) =>
  c.query(`select salvar_produto_acabado($1, $2::jsonb, $3::jsonb)`, [
    r.prod,
    JSON.stringify({ ...r.dados, ...extra }),
    JSON.stringify(variantes),
  ]);
const precos = (c: Client, modelo: string) =>
  um<{ a: number | null; v: number | null }>(
    c,
    `select preco_atacado::float8 a, preco_venda::float8 v from modelos where id = $1`,
    [modelo],
  );
const pa = (c: Client, prod: string) =>
  um<{ ins: number; rev: number }>(
    c,
    `select insumos_total::float8 ins, rev from produtos_acabados where id = $1`,
    [prod],
  );

/** Linha de insumo como a ficha grava (recomputeEtiqueta): preço × consumo × (1 + perda). */
function linhaFicha(preco: number, consumo: number, perda = 0) {
  const info: EtiquetaInfo = {
    id: "e",
    nome: "x",
    formato_tamanho: "nenhum",
    preco,
    variantes: [],
  };
  return recomputeEtiqueta(
    { etiqueta_id: "e", cor_id: null, consumo, loss_percent: perda, custo_previsto: 0 },
    { e: info },
  );
}
async function insumo(c: Client, modelo: string, consumo: number, custo: number): Promise<string> {
  return (
    await um<{ id: string }>(
      c,
      `insert into modelo_etiquetas (tenant_id, modelo_id, numero, consumo, loss_percent, custo_previsto) values ($1,$2,1,$3,0,$4) returning id`,
      [TENANT_TESTE, modelo, consumo, custo],
    )
  ).id;
}

describe.skipIf(!RODA)("L8 — migration aplicada (cópia local)", () => {
  it("md5 de depois nas 3 + função do gatilho; sem EXECUTE para PUBLIC/anon/authenticated; 3 gatilhos ligados", async () => {
    await withTx(async (c) => {
      for (const [s, m] of Object.entries(MD5)) {
        const r = await um<{ m: string; p: boolean; a: boolean; u: boolean }>(
          c,
          `select md5(pg_get_functiondef(to_regprocedure($1))) m, has_function_privilege('public', to_regprocedure($1), 'EXECUTE') p,
                  has_function_privilege('anon', to_regprocedure($1), 'EXECUTE') a, has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE') u`,
          [s],
        );
        // Release I3a (20261030100000) redefine os 2 _salvar_produto_*_core POR CIMA desta (sucessor aceito)
        expect(md5OuSucessorI3(s, m), s).toContain(r.m);
        expect({ ...r, m: null }, s).toEqual({ m: null, p: false, a: false, u: false });
      }
      const t = await um<{ n: number }>(
        c,
        `select count(*)::int n from pg_trigger where tgrelid = 'public.modelo_etiquetas'::regclass and tgname like 'trg_preco_comprado_insumo_%' and tgenabled = 'O'`,
      );
      expect(t.n).toBe(3);
    });
  });
});

describe.skipIf(!RODA)(
  "L8 preço M1 — insumo da revenda conta UMA vez (anti-drift TS × SQL)",
  () => {
    it("consumo 2 e linha 0,20: insumos_total 0,20 (não 0,40) = totaisBom; preço = precoAtacado/precoVarejo da base", async () => {
      await withTx(async (c) => {
        const r = await revenda(c);
        const linha = linhaFicha(0.1, 2);
        expect(linha.custo_previsto).toBeCloseTo(0.2, 6);
        await insumo(c, r.modelo, linha.consumo, linha.custo_previsto);
        await salvar(c, r, [{ ordem: 1, peso: 1, qtd: 10 }]); // o save recalcula insumos_total e o preço
        const t = totaisBom({
          blocks: [],
          aviamentos: [],
          etiquetas: [linha],
          custosAdicionais: [],
          maoObra: 0,
        });
        expect(t.etiqueta).toBeCloseTo(0.2, 6);
        expect((await pa(c, r.prod)).ins).toBeCloseTo(t.etiqueta, 6); // antes da L8: 0,40
        const base = 100 + t.etiqueta;
        const p = await precos(c, r.modelo);
        expect(p.a).toBeCloseTo(precoAtacado(base, 2)!, 6); // 200,40 (antes: 200,80)
        expect(p.v).toBeCloseTo(precoVarejo(base, 3)!, 6); // 300,60
        // o custo previsto do Planejamento (R16, CTE pa) bate com a mesma base
        const k = await um<{ j: Record<string, { previsto: string | number }> }>(
          c,
          `select public._custo_unitario_modelos_core(array[$1::uuid]) j`,
          [r.modelo],
        );
        expect(Number(k.j[r.modelo].previsto)).toBeCloseTo(base, 6);
      });
    });
  },
);

describe.skipIf(!RODA)("L8 preço M2 — editar o insumo recalcula o preço do comprado", () => {
  it("INSERT/UPDATE/DELETE em modelo_etiquetas move insumos_total e o preço na hora (sem salvar o produto)", async () => {
    await withTx(async (c) => {
      const r = await revenda(c);
      expect(await precos(c, r.modelo)).toEqual({ a: 200, v: 300 });
      const id = await insumo(c, r.modelo, 2, 0.2);
      expect((await pa(c, r.prod)).ins).toBeCloseTo(0.2, 6);
      expect(await precos(c, r.modelo)).toEqual({ a: 200.4, v: 300.6 }); // antes da L8: 200 / 300 (só no próximo save)
      await c.query(`update modelo_etiquetas set custo_previsto = 1.5 where id = $1`, [id]);
      expect(await precos(c, r.modelo)).toEqual({ a: 203, v: 304.5 });
      await c.query(`delete from modelo_etiquetas where id = $1`, [id]);
      expect((await pa(c, r.prod)).ins).toBe(0);
      expect(await precos(c, r.modelo)).toEqual({ a: 200, v: 300 });
    });
  });

  it("UPDATE que não muda custo_previsto (só consumo) não mexe em nada (nem no rev do produto)", async () => {
    await withTx(async (c) => {
      const r = await revenda(c);
      const id = await insumo(c, r.modelo, 2, 0.2);
      const antes = await pa(c, r.prod);
      await c.query(`update modelo_etiquetas set consumo = 3 where id = $1`, [id]);
      expect(await pa(c, r.prod)).toEqual(antes);
      expect(await precos(c, r.modelo)).toEqual({ a: 200.4, v: 300.6 });
    });
  });

  it("preço FIXO manda: atacado fixo 250 não anda com o insumo; o varejo (markup) anda", async () => {
    await withTx(async (c) => {
      const r = await revenda(c);
      await c.query(`select salvar_precos_fixo_produto_acabado($1, true, 250, false, null)`, [
        r.prod,
      ]);
      expect((await precos(c, r.modelo)).a).toBe(250);
      await insumo(c, r.modelo, 1, 10);
      expect(await precos(c, r.modelo)).toEqual({ a: 250, v: 330 }); // antes da L8: v ficava 300
    });
  });

  it("trava da Integração ('Preço de venda'): o preço de venda NÃO muda e nada é recusado; o atacado (livre) anda", async () => {
    await withTx(async (c) => {
      const r = await revenda(c);
      await c.query(
        `insert into public.integracao_produtos (tenant_id, modelo_id, estado, campos) values ($1, $2, 'integrado', array['preco_venda'])`,
        [TENANT_TESTE, r.modelo],
      );
      await insumo(c, r.modelo, 1, 10); // sem 42501
      const p = await precos(c, r.modelo);
      expect(p.v).toBe(300); // congelado
      expect(p.a).toBe(220); // antes da L8: 200 (nada recalculava)
    });
  });

  it("como usuário autenticado (RLS + sem EXECUTE nas internas): o gatilho roda (SECURITY DEFINER)", async () => {
    await withTx(async (c) => {
      const r = await revenda(c);
      await c.query(`set local role authenticated`);
      await insumo(c, r.modelo, 1, 10);
      await c.query(`reset role`);
      expect(await precos(c, r.modelo)).toEqual({ a: 220, v: 330 });
    });
  });

  it("importado: editar o insumo do card espelho recalcula o preço (preço velho no card volta ao do landed × markup)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<{ id: string }>(
        c,
        `insert into grupos_produto (tenant_id, nome) values ($1,'Fem L8 PITest') returning id`,
        [TENANT_TESTE],
      );
      const cat = await um<{ id: string }>(
        c,
        `insert into categorias_produto (tenant_id, nome) values ($1,'Blusa L8 PITest') returning id`,
        [TENANT_TESTE],
      );
      const dados = {
        nome: "Blusa L8 imp",
        grupo_id: g.id,
        categoria_id: cat.id,
        qtd_total: 10,
        valor_unitario_m1: 50,
        cotacao_ref: 5,
        cotacao_final: 5,
        peso_kg: 0,
        transporte_m2: 0,
        desconto_pct: 0,
        markup_atacado: 2,
        markup_varejo: 3,
      };
      const etapas = [
        {
          ordem: 1,
          rotulo: "Sinal",
          base: "mercadoria",
          percentual: 100,
          data_vencimento: null,
          cotacao: 5,
        },
      ];
      const pi = await um<{ id: string }>(
        c,
        `select salvar_produto_importado(null, $1::jsonb, $2::jsonb, $3::jsonb) as id`,
        [
          JSON.stringify(dados),
          JSON.stringify([{ ordem: 1, peso: 1, qtd: 10 }]),
          JSON.stringify(etapas),
        ],
      );
      const modelo = await um<{ id: string }>(c, `select criar_card_produto_importado($1) as id`, [
        pi.id,
      ]);
      const landed = Number(
        (await um<{ l: string }>(c, `select public._imp_custo_landed($1)::text l`, [pi.id])).l,
      );
      expect(landed).toBeCloseTo(50, 6); // 50 M1 ÷ 5 × 5
      await c.query(`update modelos set preco_atacado = 1, preco_venda = 1 where id = $1`, [
        modelo.id,
      ]);
      await insumo(c, modelo.id, 1, 10);
      expect(await precos(c, modelo.id)).toEqual({ a: 100, v: 150 }); // antes da L8: 1 / 1
    });
  });
});

describe.skipIf(!RODA)("L8 preço B3 — markup 0 = sem preço", () => {
  it("markup_atacado 0 (legado/escrita direta) → preco_atacado NULL (antes: 0,00); varejo segue", async () => {
    await withTx(async (c) => {
      const r = await revenda(c);
      await c.query(`update produtos_acabados set markup_atacado = 0 where id = $1`, [r.prod]);
      await c.query(`select public._pa_recomputar_precos_modelo($1)`, [r.prod]);
      expect(await precos(c, r.modelo)).toEqual({ a: null, v: 300 });
    });
  });
});

describe.skipIf(!RODA)("L8 sku #22 — a variante que sai leva a grade dela", () => {
  const grade = (c: Client, modelo: string) =>
    c
      .query(
        `select variante_numero n, grades from modelo_grades where modelo_id = $1 order by 1`,
        [modelo],
      )
      .then((x) => x.rows);
  async function comGrades(c: Client, r: Revenda, ns: number[]) {
    await c.query(`delete from modelo_grades where modelo_id = $1`, [r.modelo]);
    for (const n of ns)
      await c.query(
        `insert into modelo_grades (modelo_id, variante_numero, grades, grade_total) values ($1, $2, '{"P":10}', 10)`,
        [r.modelo, n],
      );
  }

  it("apagou a ÚLTIMA variante (save) e adicionou outra com a mesma ordem (save): a nova NÃO herda a grade", async () => {
    await withTx(async (c) => {
      const r = await revenda(c);
      await comGrades(c, r, [1]);
      await salvar(c, r, [], { qtd_total: 0 });
      expect(await grade(c, r.modelo)).toEqual([]); // antes da L8: a grade da 1 ficava
      await salvar(c, r, [{ ordem: 1, peso: 1, qtd: 10 }]);
      expect(await grade(c, r.modelo)).toEqual([]);
    });
  });

  it("no MESMO save: sai a 1, entra a 2 → some só a grade da 1; a de quem fica não muda", async () => {
    await withTx(async (c) => {
      const r = await revenda(c, [
        { ordem: 1, peso: 1, qtd: 5 },
        { ordem: 3, peso: 1, qtd: 5 },
      ]);
      await comGrades(c, r, [1, 3]);
      await salvar(c, r, [
        { ordem: 3, peso: 1, qtd: 5 },
        { ordem: 4, peso: 1, qtd: 5 },
      ]);
      expect(await grade(c, r.modelo)).toEqual([{ n: 3, grades: { P: 10 } }]);
    });
  });

  it("save sem mudar variantes não apaga grade nenhuma", async () => {
    await withTx(async (c) => {
      const r = await revenda(c);
      await comGrades(c, r, [1]);
      await salvar(c, r, [{ ordem: 1, peso: 1, qtd: 10 }]);
      expect(await grade(c, r.modelo)).toEqual([{ n: 1, grades: { P: 10 } }]);
    });
  });
});

describe.skipIf(!RODA)(
  "L8 P-207 A — servidor recusa etapa de mercadoria com % > 0 e cotação 0 (card e OC)",
  () => {
    async function categoria(c: Client) {
      await comoUsuario(c);
      const g = await um<{ id: string }>(
        c,
        `insert into grupos_produto (tenant_id, nome) values ($1,'Fem L8 P207') returning id`,
        [TENANT_TESTE],
      );
      const cat = await um<{ id: string }>(
        c,
        `insert into categorias_produto (tenant_id, nome) values ($1,'Blusa L8 P207') returning id`,
        [TENANT_TESTE],
      );
      return { grupo_id: g.id, categoria_id: cat.id };
    }
    async function salvarImp(c: Client, etapas: unknown[], valor = 10) {
      const dados = {
        nome: "Blusa P207",
        ...(await categoria(c)),
        cotacao_ref: 5,
        cotacao_final: 5,
        valor_unitario_m1: valor,
      };
      return c.query(
        `select salvar_produto_importado(null, $1::jsonb, '[]'::jsonb, $2::jsonb) as id`,
        [JSON.stringify(dados), JSON.stringify(etapas)],
      );
    }
    async function salvarOc(c: Client, etapas: unknown[], valor = 10) {
      const dados = {
        nome_produto: "OC P207",
        ...(await categoria(c)),
        cotacao_ref: 5,
        cotacao_final: 5,
        valor_unitario_m1: valor,
      };
      return c.query(`select salvar_oc_importado(null, $1::jsonb, '{}'::jsonb, $2::jsonb) as id`, [
        JSON.stringify(dados),
        JSON.stringify(etapas),
      ]);
    }
    const et = (o: Record<string, unknown>) => ({
      ordem: 1,
      rotulo: "Sinal",
      base: "mercadoria",
      percentual: 100,
      data_vencimento: null,
      cotacao: 5,
      ...o,
    });
    const recusa = {
      code: "P0001",
      message: expect.stringMatching(/^Informe a cotacao da etapa de mercadoria/),
    };
    const ruim = [
      et({ percentual: 30, cotacao: 0 }),
      et({ ordem: 2, rotulo: "Saldo", percentual: 70 }),
    ];

    for (const [onde, salvar] of [
      ["card", salvarImp],
      ["OC", salvarOc],
    ] as const) {
      it(`${onde}: mercadoria 30% com cotação 0 e compra COM valor → P0001 (antes da L8: aceitava)`, async () => {
        await withTx(async (c) => {
          await c.query("savepoint s");
          await expect(salvar(c, ruim)).rejects.toMatchObject(recusa);
          await c.query("rollback to savepoint s");
        });
      });

      it(`${onde}: Q2 — compra SEM valor (M1 = 0) salva mesmo com cotação 0 (rascunho só com nome)`, async () => {
        await withTx(async (c) => {
          const r = await salvar(c, ruim, 0);
          expect(r.rows[0].id).toBeTruthy();
        });
      });

      it(`${onde}: aceita mercadoria com cotação, mercadoria 0% sem cotação, frete com cotação 0 (identidade)`, async () => {
        await withTx(async (c) => {
          const r = await salvar(c, [
            et({ percentual: 100 }),
            et({ ordem: 2, rotulo: "Extra", percentual: 0, cotacao: 0 }),
            et({ ordem: 3, rotulo: "Frete", base: "frete", percentual: 100, cotacao: 0 }),
          ]);
          expect(r.rows[0].id).toBeTruthy();
        });
      });
    }

    it("card: produto sem etapas e sem valor (criado pelo Planejamento) salva o nome", async () => {
      await withTx(async (c) => {
        const r = await c.query(
          `select salvar_produto_importado(null, $1::jsonb, '[]'::jsonb, '[]'::jsonb) as id`,
          [JSON.stringify({ nome: "Só nome P207", ...(await categoria(c)) })],
        );
        expect(r.rows[0].id).toBeTruthy();
      });
    });
  },
);

describe.skipIf(!RODA)(
  "L8 sku #22 (importado, fix round 1 M2) — a variante que sai leva a grade dela",
  () => {
    type Imp = { prod: string; modelo: string; dados: Record<string, unknown> };
    async function importado(c: Client, variantes: unknown[]): Promise<Imp> {
      await comoUsuario(c);
      const g = await um<{ id: string }>(
        c,
        `insert into grupos_produto (tenant_id, nome) values ($1,'Fem L8 PI22') returning id`,
        [TENANT_TESTE],
      );
      const cat = await um<{ id: string }>(
        c,
        `insert into categorias_produto (tenant_id, nome) values ($1,'Blusa L8 PI22') returning id`,
        [TENANT_TESTE],
      );
      const dados = {
        nome: "Blusa PI22",
        grupo_id: g.id,
        categoria_id: cat.id,
        qtd_total: 10,
        valor_unitario_m1: 0,
      };
      const p = await um<{ id: string }>(
        c,
        `select salvar_produto_importado(null, $1::jsonb, $2::jsonb, '[]'::jsonb) as id`,
        [JSON.stringify(dados), JSON.stringify(variantes)],
      );
      const m = await um<{ id: string }>(c, `select criar_card_produto_importado($1) as id`, [
        p.id,
      ]);
      return { prod: p.id, modelo: m.id, dados };
    }
    const salvarPi = (c: Client, r: Imp, variantes: unknown[]) =>
      c.query(`select salvar_produto_importado($1, $2::jsonb, $3::jsonb, '[]'::jsonb)`, [
        r.prod,
        JSON.stringify(r.dados),
        JSON.stringify(variantes),
      ]);
    const grade = (c: Client, modelo: string) =>
      c
        .query(
          `select variante_numero n, grades from modelo_grades where modelo_id = $1 order by 1`,
          [modelo],
        )
        .then((x) => x.rows);
    async function comGrades(c: Client, r: Imp, ns: number[]) {
      await c.query(`delete from modelo_grades where modelo_id = $1`, [r.modelo]);
      for (const n of ns)
        await c.query(
          `insert into modelo_grades (modelo_id, variante_numero, grades, grade_total) values ($1, $2, '{"P":10}', 10)`,
          [r.modelo, n],
        );
    }

    it("apagou a ÚLTIMA variante (save) e adicionou outra com a mesma ordem (save): a nova NÃO herda a grade", async () => {
      await withTx(async (c) => {
        const r = await importado(c, [{ ordem: 1, peso: 1, qtd: 10 }]);
        await comGrades(c, r, [1]);
        await salvarPi(c, r, []);
        expect(await grade(c, r.modelo)).toEqual([]); // antes do fix round 1: a grade da 1 ficava
        await salvarPi(c, r, [{ ordem: 1, peso: 1, qtd: 10 }]);
        expect(await grade(c, r.modelo)).toEqual([]);
      });
    });

    it("no MESMO save: sai a 1, entra a 4 → some só a grade da 1; a de quem fica não muda", async () => {
      await withTx(async (c) => {
        const r = await importado(c, [
          { ordem: 1, peso: 1, qtd: 5 },
          { ordem: 3, peso: 1, qtd: 5 },
        ]);
        await comGrades(c, r, [1, 3]);
        await salvarPi(c, r, [
          { ordem: 3, peso: 1, qtd: 5 },
          { ordem: 4, peso: 1, qtd: 5 },
        ]);
        expect(await grade(c, r.modelo)).toEqual([{ n: 3, grades: { P: 10 } }]);
      });
    });

    it("save sem mudar variantes não apaga grade nenhuma", async () => {
      await withTx(async (c) => {
        const r = await importado(c, [{ ordem: 1, peso: 1, qtd: 10 }]);
        await comGrades(c, r, [1]);
        await salvarPi(c, r, [{ ordem: 1, peso: 1, qtd: 10 }]);
        expect(await grade(c, r.modelo)).toEqual([{ n: 1, grades: { P: 10 } }]);
      });
    });
  },
);
