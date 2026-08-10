import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

describe.skipIf(!hasDb)("Produto Acabado — códigos automáticos", () => {
  it("REF não-acessório = 2G+1C+2S + 7 díg; acessório = 2G+3CAT; nº OC usa ACE p/ grupo Acessórios", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Feminino PATest') returning id`);
      const ga = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Acessórios PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido PATest') returning id`);
      const catB = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Bolsa PATest') returning id`);
      const s1 = await um<any>(c, `insert into subcategorias1_produto (tenant_id, nome, categoria_id) values ('${TENANT_TESTE}','Estampado PATest','${cat.id}') returning id`);
      const p1 = await um<any>(c, `insert into produtos_acabados (tenant_id, nome, grupo_id, categoria_id, subcategoria1_id)
        values ('${TENANT_TESTE}','Vestido X','${g.id}','${cat.id}','${s1.id}') returning ref`);
      expect(p1.ref).toMatch(/^FEVES\d{7}$/);
      const p2 = await um<any>(c, `insert into produtos_acabados (tenant_id, nome, grupo_id, categoria_id)
        values ('${TENANT_TESTE}','Bolsa Y','${ga.id}','${catB.id}') returning ref`);
      expect(p2.ref).toMatch(/^ACBOL\d{7}$/);
      const emp = await um<any>(c, `insert into empresas (tenant_id, nome_fantasia, tipo) values ('${TENANT_TESTE}','Bella Couros PATest','material') returning id`);
      const oc = await um<any>(c, `insert into ocs_p_acabado (tenant_id, nome_produto, grupo_id, categoria_id, empresa_id)
        values ('${TENANT_TESTE}','Bolsa Y','${ga.id}','${catB.id}','${emp.id}') returning numero`);
      expect(oc.numero).toMatch(/^BELACE-\d{5}$/);
    });
  });
  it("vínculo único: 2ª OC no mesmo produto dá P0001", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem2 PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Calça PATest') returning id`);
      const p = await um<any>(c, `insert into produtos_acabados (tenant_id, nome, grupo_id, categoria_id) values ('${TENANT_TESTE}','P','${g.id}','${cat.id}') returning id`);
      await c.query(`insert into ocs_p_acabado (tenant_id, nome_produto, produto_acabado_id) values ('${TENANT_TESTE}','P','${p.id}')`);
      await expect(c.query(`insert into ocs_p_acabado (tenant_id, nome_produto, produto_acabado_id) values ('${TENANT_TESTE}','P','${p.id}')`)).rejects.toThrow(/vinculada/);
    });
  });
});

describe.skipIf(!hasDb)("Produto Acabado — RPCs de escrita (Task 2)", () => {
  it("_split_maior_resto: Σ ≡ total, maior resto com desempate por chave", async () => {
    await withTx(async (c) => {
      const r1 = await um<any>(c, `select _split_maior_resto(100, '{"38":1,"40":1,"42":1}'::jsonb) as g`);
      expect(r1.g).toEqual({ "38": 34, "40": 33, "42": 33 });
      const r2 = await um<any>(c, `select _split_maior_resto(100, '{"a":1,"b":1,"c":1}'::jsonb) as g`);
      const soma2 = Object.values(r2.g as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(soma2).toBe(100);
      const r3 = await um<any>(c, `select _split_maior_resto(198, '{"P":3,"B":2,"A":1}'::jsonb) as g`);
      expect(r3.g).toEqual({ P: 99, B: 66, A: 33 });
    });
  });

  it("_split_maior_resto: pesos todos 0 (degenerado) SEM perder Σ=total — split igualitário (fix round 1)", async () => {
    await withTx(async (c) => {
      const r1 = await um<any>(c, `select _split_maior_resto(10, '{"38":0,"40":0,"42":0}'::jsonb) as g`);
      expect(r1.g).toEqual({ "38": 4, "40": 3, "42": 3 });
      const soma1 = Object.values(r1.g as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(soma1).toBe(10);
      // pesos negativos também caem no ramo degenerado (Σ dos positivos = 0)
      const r2 = await um<any>(c, `select _split_maior_resto(10, '{"a":-1,"b":-2,"c":0}'::jsonb) as g`);
      const soma2 = Object.values(r2.g as Record<string, number>).reduce((a, b) => a + b, 0);
      expect(soma2).toBe(10);
      // chave com peso 0 ENTRE pesos positivos continua recebendo 0 (comportamento preservado)
      const r3 = await um<any>(c, `select _split_maior_resto(100, '{"38":1,"40":1,"42":0}'::jsonb) as g`);
      expect(r3.g).toEqual({ "38": 50, "40": 50, "42": 0 });
    });
  });

  it("salvar_produto_acabado sem grupo/categoria no create rejeita (P0001, pendência da Task 1)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await expect(
        c.query(`select salvar_produto_acabado(null, '{"nome":"Sem grupo PATest"}'::jsonb, '[]'::jsonb)`),
      ).rejects.toThrow(/Informe grupo e categoria/);
    });
  });

  it("salvar_produto_acabado: Σ variantes ≠ total rejeita (P0001)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem T2a PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido T2a PATest') returning id`);
      const dados = { nome: "Vestido T2a", grupo_id: g.id, categoria_id: cat.id, qtd_total: 100 };
      const variantes = [{ ordem: 0, peso: 3, qtd: 50 }]; // soma 50 ≠ 100
      await expect(
        c.query(`select salvar_produto_acabado(null, $1::jsonb, $2::jsonb)`, [JSON.stringify(dados), JSON.stringify(variantes)]),
      ).rejects.toThrow(/A soma das variantes/);
    });
  });

  it("salvar_produto_acabado redistribuir=true: 100 em 3 cores peso 3:1:1 → 60/20/20", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem T2b PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido T2b PATest') returning id`);
      const dados = { nome: "Vestido T2b", grupo_id: g.id, categoria_id: cat.id, qtd_total: 100, redistribuir: "true" };
      const variantes = [
        { ordem: 0, peso: 3, qtd: 0 },
        { ordem: 1, peso: 1, qtd: 0 },
        { ordem: 2, peso: 1, qtd: 0 },
      ];
      const p = await um<any>(c, `select salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [
        JSON.stringify(dados),
        JSON.stringify(variantes),
      ]);
      const rows = await c.query(`select ordem, qtd from produto_acabado_variantes where produto_acabado_id = $1 order by ordem`, [p.id]);
      expect(rows.rows.map((r: any) => Number(r.qtd))).toEqual([60, 20, 20]);
    });
  });

  it("salvar_produto_acabado redistribuir=true com pesos 0: Σ qtd = qtd_total (fix round 1 — não pode colapsar)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem T2b2 PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido T2b2 PATest') returning id`);
      const dados = { nome: "Vestido T2b2", grupo_id: g.id, categoria_id: cat.id, qtd_total: 100, redistribuir: "true" };
      const variantes = [
        { ordem: 0, peso: 0, qtd: 0 },
        { ordem: 1, peso: 0, qtd: 0 },
        { ordem: 2, peso: 0, qtd: 0 },
      ];
      const p = await um<any>(c, `select salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [
        JSON.stringify(dados),
        JSON.stringify(variantes),
      ]);
      const rows = await c.query(`select qtd from produto_acabado_variantes where produto_acabado_id = $1 order by ordem`, [p.id]);
      const soma = rows.rows.reduce((a: number, r: any) => a + Number(r.qtd), 0);
      expect(soma).toBe(100);
    });
  });

  it("criar_card_produto_acabado: cria modelo espelho (origem revenda, ref copiada) + modelo_grades com Σ = qtd da cor; 2ª chamada é P0001", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem T2c PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido T2c PATest') returning id`);
      const dados = {
        nome: "Vestido T2c",
        grupo_id: g.id,
        categoria_id: cat.id,
        qtd_total: 100,
        grade_proporcao: { "38": 1, "40": 1, "42": 1 },
      };
      const variantes = [
        { ordem: 0, peso: 3, qtd: 60 },
        { ordem: 1, peso: 1, qtd: 20 },
        { ordem: 2, peso: 1, qtd: 20 },
      ];
      const prod = await um<any>(c, `select salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [
        JSON.stringify(dados),
        JSON.stringify(variantes),
      ]);
      const produtoRef = await um<any>(c, `select ref from produtos_acabados where id = $1`, [prod.id]);

      const modelo = await um<any>(c, `select criar_card_produto_acabado($1) as id`, [prod.id]);
      const m = await um<any>(c, `select nome, origem, ref, categoria_principal_id from modelos where id = $1`, [modelo.id]);
      expect(m.origem).toBe("revenda");
      expect(m.ref).toBe(produtoRef.ref);
      expect(m.categoria_principal_id).toBe(cat.id);

      const grades = await c.query(`select variante_numero, grade_total from modelo_grades where modelo_id = $1 order by variante_numero`, [modelo.id]);
      expect(grades.rows.map((r: any) => Number(r.grade_total))).toEqual([60, 20, 20]);

      const vinculo = await um<any>(c, `select modelo_id from produtos_acabados where id = $1`, [prod.id]);
      expect(vinculo.modelo_id).toBe(modelo.id);

      await expect(c.query(`select criar_card_produto_acabado($1)`, [prod.id])).rejects.toThrow(/já tem card/);
    });
  });

  it("criar_card_produto_acabado (grupo Acessórios): modelo_grades grade única {UN: qtd}", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Acessórios T2d PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Bolsa T2d PATest') returning id`);
      const dados = { nome: "Bolsa T2d", grupo_id: g.id, categoria_id: cat.id, qtd_total: 10 };
      const variantes = [{ ordem: 0, peso: 1, qtd: 10 }];
      const prod = await um<any>(c, `select salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [
        JSON.stringify(dados),
        JSON.stringify(variantes),
      ]);
      const modelo = await um<any>(c, `select criar_card_produto_acabado($1) as id`, [prod.id]);
      const grade = await um<any>(c, `select grades, grade_total from modelo_grades where modelo_id = $1`, [modelo.id]);
      expect(grade.grades).toEqual({ UN: 10 });
      expect(Number(grade.grade_total)).toBe(10);
    });
  });

  it("criar_card_produto_acabado com grade_proporcao toda 0: grade_total = qtd da variante, não some (fix round 1)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem T2d2 PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido T2d2 PATest') returning id`);
      const dados = {
        nome: "Vestido T2d2",
        grupo_id: g.id,
        categoria_id: cat.id,
        qtd_total: 50,
        grade_proporcao: { "38": 0, "40": 0, "42": 0 },
      };
      const variantes = [{ ordem: 0, peso: 1, qtd: 50 }];
      const prod = await um<any>(c, `select salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [
        JSON.stringify(dados),
        JSON.stringify(variantes),
      ]);
      const modelo = await um<any>(c, `select criar_card_produto_acabado($1) as id`, [prod.id]);
      const grade = await um<any>(c, `select grades, grade_total from modelo_grades where modelo_id = $1`, [modelo.id]);
      expect(Number(grade.grade_total)).toBe(50);
      const soma = Object.values(grade.grades as Record<string, number>).reduce((a, b) => a + Number(b), 0);
      expect(soma).toBe(50);
    });
  });

  it("aplicar_produto_ao_modelo: sem espelho é P0001; com espelho re-empurra modelo_grades", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem T2e PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido T2e PATest') returning id`);
      const dados = { nome: "Vestido T2e", grupo_id: g.id, categoria_id: cat.id, qtd_total: 0, grade_proporcao: { UN: 1 } };
      const prod = await um<any>(c, `select salvar_produto_acabado(null, $1::jsonb, '[]'::jsonb) as id`, [JSON.stringify(dados)]);

      await c.query("SAVEPOINT sp_sem_espelho");
      await expect(c.query(`select aplicar_produto_ao_modelo($1)`, [prod.id])).rejects.toThrow(/não tem card/);
      await c.query("ROLLBACK TO SAVEPOINT sp_sem_espelho");

      const modelo = await um<any>(c, `select criar_card_produto_acabado($1) as id`, [prod.id]);

      // muda a qtd_total/variantes do produto e reaplica
      const dados2 = { nome: "Vestido T2e", grupo_id: g.id, categoria_id: cat.id, qtd_total: 30, grade_proporcao: { "U": 1 } };
      const variantes2 = [{ ordem: 0, peso: 1, qtd: 30 }];
      await c.query(`select salvar_produto_acabado($1, $2::jsonb, $3::jsonb)`, [prod.id, JSON.stringify(dados2), JSON.stringify(variantes2)]);
      await c.query(`select aplicar_produto_ao_modelo($1)`, [prod.id]);

      const grade = await um<any>(c, `select grade_total from modelo_grades where modelo_id = $1 and variante_numero = 0`, [modelo.id]);
      expect(Number(grade.grade_total)).toBe(30);
    });
  });

  it("vincular_oc_p_acabado: liga OC avulsa a produto; 2ª OC no mesmo produto falha", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem T2f PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido T2f PATest') returning id`);
      const dados = { nome: "Vestido T2f", grupo_id: g.id, categoria_id: cat.id };
      const prod = await um<any>(c, `select salvar_produto_acabado(null, $1::jsonb, '[]'::jsonb) as id`, [JSON.stringify(dados)]);

      const oc1 = await um<any>(c, `select salvar_oc_p_acabado(null, '{"nome_produto":"OC1 PATest"}'::jsonb, '{}'::jsonb) as id`);
      const oc2 = await um<any>(c, `select salvar_oc_p_acabado(null, '{"nome_produto":"OC2 PATest"}'::jsonb, '{}'::jsonb) as id`);

      await c.query(`select vincular_oc_p_acabado($1, $2)`, [oc1.id, prod.id]);
      const check = await um<any>(c, `select produto_acabado_id from ocs_p_acabado where id = $1`, [oc1.id]);
      expect(check.produto_acabado_id).toBe(prod.id);

      await c.query("SAVEPOINT sp_vinculo_duplo");
      await expect(c.query(`select vincular_oc_p_acabado($1, $2)`, [oc2.id, prod.id])).rejects.toThrow(/vinculada/);
      await c.query("ROLLBACK TO SAVEPOINT sp_vinculo_duplo");

      // desvincular (NULL) funciona
      await c.query(`select vincular_oc_p_acabado($1, null)`, [oc1.id]);
      const check2 = await um<any>(c, `select produto_acabado_id from ocs_p_acabado where id = $1`, [oc1.id]);
      expect(check2.produto_acabado_id).toBeNull();
    });
  });

  it("salvar_oc_p_acabado deriva bruto/total-com-desconto/unit-real (198×99−20% → 19.602/15.681,60/79,20)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const dados = { nome_produto: "OC T2g PATest", qtd_total: 198, valor_unitario: 99, desconto_pct: 20 };
      const grade = { "0": { UN: { pedida: 198 } } };
      const oc = await um<any>(c, `select salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`, [
        JSON.stringify(dados),
        JSON.stringify(grade),
      ]);
      const row = await um<any>(
        c,
        `select valor_bruto, valor_total_desconto, valor_unitario_real from ocs_p_acabado where id = $1`,
        [oc.id],
      );
      expect(Number(row.valor_bruto)).toBe(19602);
      expect(Number(row.valor_total_desconto)).toBe(15681.6);
      expect(Number(row.valor_unitario_real)).toBe(79.2);
    });
  });

  it("salvar_oc_p_acabado: célula negativa e Σ pedida ≠ qtd_total rejeitam (P0001)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await c.query("SAVEPOINT sp_neg");
      await expect(
        c.query(`select salvar_oc_p_acabado(null, '{"nome_produto":"OC neg PATest","qtd_total":10}'::jsonb, '{"0":{"P":{"pedida":-5}}}'::jsonb)`),
      ).rejects.toThrow(/negativas/);
      await c.query("ROLLBACK TO SAVEPOINT sp_neg");
      await expect(
        c.query(`select salvar_oc_p_acabado(null, '{"nome_produto":"OC soma PATest","qtd_total":100}'::jsonb, '{"0":{"P":{"pedida":40}}}'::jsonb)`),
      ).rejects.toThrow(/A soma da grade pedida/);
    });
  });
});

// custo_unitario_modelos, ramo revenda (Task 4): modelo origem='revenda' COM produto
// vinculado lê a cadeia de valores do produto/OC em vez do caminho CAD/cad_conf normal.
describe.skipIf(!hasDb)("custo_unitario_modelos — ramo revenda (Task 4)", () => {
  it("modelo revenda + OC recebida → previsto/real batem com a cadeia de valores + insumos; sem OC recebida real=null", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Fem T4 PATest') returning id`);
      const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Vestido T4 PATest') returning id`);

      const dadosProduto = {
        nome: "Vestido T4",
        grupo_id: g.id,
        categoria_id: cat.id,
        qtd_total: 198,
        valor_unitario: 99,
        desconto_pct: 20,
        grade_proporcao: { UN: 1 },
      };
      const variantes = [{ ordem: 0, peso: 1, qtd: 198 }];
      const prod = await um<any>(c, `select salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [
        JSON.stringify(dadosProduto),
        JSON.stringify(variantes),
      ]);

      const modelo = await um<any>(c, `select criar_card_produto_acabado($1) as id`, [prod.id]);

      // insumos_por_peça = Σ (consumo × custo_previsto) = 2 × 1,5 = 3
      await c.query(
        `insert into modelo_etiquetas (tenant_id, modelo_id, consumo, custo_previsto) values ('${TENANT_TESTE}', $1, 2, 1.5)`,
        [modelo.id],
      );

      const custoDe = async () =>
        (await um<any>(c, `select custo_unitario_modelos(array[$1::uuid]) -> $1::text as v`, [modelo.id])).v;

      // Antes de existir OC vinculada: previsto já reflete o produto (79,20 + 3 insumos); sem OC, real=null/não-confirmado
      const antes = await custoDe();
      expect(Number(antes.previsto)).toBeCloseTo(82.2, 2);
      expect(antes.real).toBeNull();
      expect(antes.confirmado).toBe(false);

      const oc = await um<any>(
        c,
        `select salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`,
        [
          JSON.stringify({ nome_produto: "OC T4 PATest", produto_acabado_id: prod.id, qtd_total: 198, valor_unitario: 99, desconto_pct: 20 }),
          JSON.stringify({ "0": { UN: { pedida: 198 } } }),
        ],
      );

      // OC vinculada mas ainda 'encomendado' (não recebida): real continua null, previsto igual
      const encomendado = await custoDe();
      expect(Number(encomendado.previsto)).toBeCloseTo(82.2, 2);
      expect(encomendado.real).toBeNull();
      expect(encomendado.confirmado).toBe(false);

      await c.query(
        `select receber_oc_p_acabado($1::uuid, $2::jsonb, $3::jsonb)`,
        [
          oc.id,
          JSON.stringify({ data_entrega: new Date().toISOString().slice(0, 10), nota_fiscal: "NF-T4" }),
          JSON.stringify({ "0": { UN: { pedida: 198, recebida: 198, defeito: 0 } } }),
        ],
      );

      // Recebida (status='recebido'): real = valor_unitario_real (79,20) + insumos (3) = 82,20; confirmado=true
      const depois = await custoDe();
      expect(Number(depois.previsto)).toBeCloseTo(82.2, 2);
      expect(Number(depois.real)).toBeCloseTo(82.2, 2);
      expect(depois.confirmado).toBe(true);
    });
  });
});

describe.skipIf(!hasDb)("Produto Acabado — excluir_produto_acabado (Task 6 fix round 1)", () => {
  async function novoProduto(c: any, sufixo: string) {
    const g = await um<any>(c, `insert into grupos_produto (tenant_id, nome) values ('${TENANT_TESTE}','Grupo excluir ${sufixo}') returning id`);
    const cat = await um<any>(c, `insert into categorias_produto (tenant_id, nome) values ('${TENANT_TESTE}','Cat excluir ${sufixo}') returning id`);
    return um<any>(
      c,
      `select salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`,
      [
        JSON.stringify({ nome: `Produto excluir ${sufixo}`, grupo_id: g.id, categoria_id: cat.id, qtd_total: 10, valor_unitario: 50 }),
        JSON.stringify([{ ordem: 0, peso: 1, qtd: 10 }]),
      ],
    );
  }

  it("sem OC vinculada: apaga o produto; variantes somem via cascade", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const p = await novoProduto(c, "PA6Test-a");
      const variantesAntes = await c.query(`select id from produto_acabado_variantes where produto_acabado_id = $1`, [p.id]);
      expect(variantesAntes.rows.length).toBeGreaterThan(0);

      await c.query(`select excluir_produto_acabado($1)`, [p.id]);

      const depois = await c.query(`select id from produtos_acabados where id = $1`, [p.id]);
      expect(depois.rows).toHaveLength(0);
      const variantesDepois = await c.query(`select id from produto_acabado_variantes where produto_acabado_id = $1`, [p.id]);
      expect(variantesDepois.rows).toHaveLength(0); // cascade
    });
  });

  it("com OC vinculada (qualquer status) → P0001, não exclui", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const p = await novoProduto(c, "PA6Test-b");
      await c.query(`insert into ocs_p_acabado (tenant_id, nome_produto, produto_acabado_id) values ('${TENANT_TESTE}','OC excluir PA6Test-b','${p.id}')`);

      await c.query("SAVEPOINT sp_excluir_produto_com_oc");
      await expect(c.query(`select excluir_produto_acabado($1)`, [p.id])).rejects.toThrow(/Desvincule a OC/);
      await c.query("ROLLBACK TO SAVEPOINT sp_excluir_produto_com_oc");

      const aindaExiste = await c.query(`select id from produtos_acabados where id = $1`, [p.id]);
      expect(aindaExiste.rows).toHaveLength(1);
    });
  });

  it("com card espelho (modelo_id) mas sem OC: apaga o produto; o modelo NÃO é apagado (vira independente)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const p = await novoProduto(c, "PA6Test-c");
      const modelo = await um<any>(c, `select criar_card_produto_acabado($1) as id`, [p.id]);

      await c.query(`select excluir_produto_acabado($1)`, [p.id]);

      const produtoDepois = await c.query(`select id from produtos_acabados where id = $1`, [p.id]);
      expect(produtoDepois.rows).toHaveLength(0);
      const modeloDepois = await c.query(`select id from modelos where id = $1`, [modelo.id]);
      expect(modeloDepois.rows).toHaveLength(1); // não cai — vira modelo independente
    });
  });

  it("produto inexistente → erro (não encontrado)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      await expect(c.query(`select excluir_produto_acabado('00000000-0000-0000-0000-000000000000'::uuid)`)).rejects.toThrow(/não encontrado/);
    });
  });
});
