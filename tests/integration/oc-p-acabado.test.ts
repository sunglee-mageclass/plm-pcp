import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";

// Task 3/8 do plano produto-acabado-revenda: recebimento da OC (materializa o espelho
// de produção — cad/cad_grades/controle_qualidade), parcelas a pagar por prazo de
// pagamento e leitura da aba Estoque. Fixtures com sufixo " PA3Test" (padrão das
// Tasks 1/2, evita colidir com categorias/grupos reais do TENANT_TESTE).

async function criarProdutoComCard(
  c: any,
  nomeSufixo: string,
  qtdVariante = 20,
): Promise<{ produtoId: string; modeloId: string }> {
  const g = await um<{ id: string }>(
    c,
    `insert into grupos_produto (tenant_id, nome) values ($1,$2) returning id`,
    [TENANT_TESTE, `Fem ${nomeSufixo}`],
  );
  const cat = await um<{ id: string }>(
    c,
    `insert into categorias_produto (tenant_id, nome) values ($1,$2) returning id`,
    [TENANT_TESTE, `Vestido ${nomeSufixo}`],
  );
  const dados = {
    nome: `Vestido ${nomeSufixo}`,
    grupo_id: g.id,
    categoria_id: cat.id,
    qtd_total: qtdVariante * 2,
    grade_proporcao: { P: 1, M: 1 },
  };
  const variantes = [
    { ordem: 0, peso: 1, qtd: qtdVariante },
    { ordem: 1, peso: 1, qtd: qtdVariante },
  ];
  const prod = await um<{ id: string }>(c, `select salvar_produto_acabado(null, $1::jsonb, $2::jsonb) as id`, [
    JSON.stringify(dados),
    JSON.stringify(variantes),
  ]);
  const modelo = await um<{ id: string }>(c, `select criar_card_produto_acabado($1) as id`, [prod.id]);
  return { produtoId: prod.id, modeloId: modelo.id };
}

describe.skipIf(!hasDb)("OC Produto Acabado — receber_oc_p_acabado (Task 3)", () => {
  it("receber sem produto vinculado à OC → P0001 'Crie o card'", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string }>(
        c,
        `select salvar_oc_p_acabado(null, '{"nome_produto":"OC sem vinculo PA3Test"}'::jsonb, '{}'::jsonb) as id`,
      );
      await expect(c.query(`select receber_oc_p_acabado($1, '{}'::jsonb, '{}'::jsonb)`, [oc.id])).rejects.toThrow(
        /Crie o card no Planejamento antes de receber/,
      );
    });
  });

  it("receber com produto vinculado MAS sem card (modelo_id null) → P0001 'Crie o card'", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const g = await um<{ id: string }>(
        c,
        `insert into grupos_produto (tenant_id, nome) values ($1,'Fem PA3Test-b') returning id`,
        [TENANT_TESTE],
      );
      const cat = await um<{ id: string }>(
        c,
        `insert into categorias_produto (tenant_id, nome) values ($1,'Vestido PA3Test-b') returning id`,
        [TENANT_TESTE],
      );
      const prod = await um<{ id: string }>(
        c,
        `select salvar_produto_acabado(null, $1::jsonb, '[]'::jsonb) as id`,
        [JSON.stringify({ nome: "V PA3Test-b", grupo_id: g.id, categoria_id: cat.id })],
      );
      const oc = await um<{ id: string }>(
        c,
        `select salvar_oc_p_acabado(null, $1::jsonb, '{}'::jsonb) as id`,
        [JSON.stringify({ nome_produto: "OC PA3Test-b", produto_acabado_id: prod.id })],
      );
      await expect(c.query(`select receber_oc_p_acabado($1, '{}'::jsonb, '{}'::jsonb)`, [oc.id])).rejects.toThrow(
        /Crie o card no Planejamento antes de receber/,
      );
    });
  });

  it("fluxo completo (2 cores × 2 tamanhos): grades_reais = recebida−defeito por célula, grade_total_real correto, CQ nasce 'pendente'", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { produtoId, modeloId } = await criarProdutoComCard(c, "PA3Test-c", 20);

      const grade = {
        "0": { P: { pedida: 10 }, M: { pedida: 10 } },
        "1": { P: { pedida: 10 }, M: { pedida: 10 } },
      };
      const oc = await um<{ id: string }>(
        c,
        `select salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ nome_produto: "OC PA3Test-c", produto_acabado_id: produtoId }), JSON.stringify(grade)],
      );

      const gradeRecebimento = {
        "0": { P: { pedida: 10, recebida: 9, defeito: 1 }, M: { pedida: 10, recebida: 10, defeito: 0 } },
        "1": { P: { pedida: 10, recebida: 10, defeito: 2 }, M: { pedida: 10, recebida: 9, defeito: 0 } },
      };
      const resultado = await um<{ cad_id: string; total_real: string }>(
        c,
        `select (v->>'cad_id') as cad_id, (v->>'total_real') as total_real
           from (select receber_oc_p_acabado($1, $2::jsonb, $3::jsonb) as v) s`,
        [oc.id, JSON.stringify({ data_entrega: "2026-08-10", nota_fiscal: "NF-PA3Test-c" }), JSON.stringify(gradeRecebimento)],
      );
      // var0: P 9-1=8, M 10-0=10 → 18; var1: P 10-2=8, M 9-0=9 → 17; total 35
      expect(Number(resultado.total_real)).toBe(35);

      const ocRow = await um<{ status: string; nota_fiscal: string }>(c, `select status, nota_fiscal from ocs_p_acabado where id = $1`, [oc.id]);
      expect(ocRow.status).toBe("recebido");
      expect(ocRow.nota_fiscal).toBe("NF-PA3Test-c");

      const cadRow = await um<{ id: string }>(c, `select id from cad where modelo_id = $1`, [modeloId]);
      expect(cadRow.id).toBe(resultado.cad_id);

      const grades = await c.query(
        `select variante_numero, grades_planejadas, grades_reais, grade_total_planejada, grade_total_real
           from cad_grades where cad_id = $1 order by variante_numero`,
        [resultado.cad_id],
      );
      expect(grades.rows).toHaveLength(2);
      expect(grades.rows[0].grades_planejadas).toEqual({ P: 10, M: 10 });
      expect(grades.rows[0].grades_reais).toEqual({ P: 8, M: 10 });
      expect(Number(grades.rows[0].grade_total_planejada)).toBe(20);
      expect(Number(grades.rows[0].grade_total_real)).toBe(18);
      expect(grades.rows[1].grades_reais).toEqual({ P: 8, M: 9 });
      expect(Number(grades.rows[1].grade_total_real)).toBe(17);

      const cq = await um<{ status: string }>(c, `select status from controle_qualidade where cad_id = $1`, [resultado.cad_id]);
      expect(cq.status).toBe("pendente");
    });
  });

  it("re-receber (CQ já confirmado) REGRAVA grades_reais e NÃO toca o status confirmado", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { produtoId } = await criarProdutoComCard(c, "PA3Test-d", 10);
      const grade = { "0": { UN: { pedida: 10 } }, "1": { UN: { pedida: 10 } } };
      const oc = await um<{ id: string }>(
        c,
        `select salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ nome_produto: "OC PA3Test-d", produto_acabado_id: produtoId }), JSON.stringify(grade)],
      );
      const grade1 = { "0": { UN: { pedida: 10, recebida: 10, defeito: 0 } }, "1": { UN: { pedida: 10, recebida: 10, defeito: 0 } } };
      const r1 = await um<{ cad_id: string }>(
        c,
        `select (v->>'cad_id') as cad_id from (select receber_oc_p_acabado($1, '{}'::jsonb, $2::jsonb) as v) s`,
        [oc.id, JSON.stringify(grade1)],
      );

      // Confirma o CQ manualmente (fora do escopo desta RPC — só simula o estado).
      await c.query(`update controle_qualidade set status='confirmado', confirmado_at=now() where cad_id=$1`, [r1.cad_id]);

      // Recebimento corrigido (ex.: achou mais defeito depois) regrava grades_reais.
      const grade2 = { "0": { UN: { pedida: 10, recebida: 10, defeito: 3 } }, "1": { UN: { pedida: 10, recebida: 10, defeito: 0 } } };
      await c.query(`select receber_oc_p_acabado($1, '{}'::jsonb, $2::jsonb)`, [oc.id, JSON.stringify(grade2)]);

      const cq = await um<{ status: string }>(c, `select status from controle_qualidade where cad_id = $1`, [r1.cad_id]);
      expect(cq.status).toBe("confirmado"); // não foi tocado

      const g0 = await um<{ grade_total_real: number }>(
        c,
        `select grade_total_real from cad_grades where cad_id = $1 and variante_numero = 0`,
        [r1.cad_id],
      );
      expect(Number(g0.grade_total_real)).toBe(7); // 10-3, regravado
    });
  });
});

describe.skipIf(!hasDb)("OC Produto Acabado — parcelas por prazo de pagamento (Task 3)", () => {
  it("3 parcelas a_pagar somando o total (198×99−20% → 15.681,60 / 3 = 5.227,20)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string }>(
        c,
        `select salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`,
        [
          JSON.stringify({ nome_produto: "OC parcelas PA3Test", qtd_total: 198, valor_unitario: 99, desconto_pct: 20, prazo_pagamento: "30/60/90" }),
          JSON.stringify({ "0": { UN: { pedida: 198 } } }),
        ],
      );
      const parcelas = await c.query(
        `select numero_parcela, valor, status from parcelas where oc_p_acabado_id = $1 order by numero_parcela`,
        [oc.id],
      );
      expect(parcelas.rows).toHaveLength(3);
      expect(parcelas.rows.every((r: any) => r.status === "a_pagar")).toBe(true);
      const soma = parcelas.rows.reduce((acc: number, r: any) => acc + Number(r.valor), 0);
      expect(soma).toBeCloseTo(15681.6, 2);
      expect(Number(parcelas.rows[0].valor)).toBeCloseTo(5227.2, 2);
    });
  });

  it("prazo sem barra ('30', default) gera 1 parcela; vencimento = data_pedido + dias", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string }>(
        c,
        `select salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`,
        [
          JSON.stringify({ nome_produto: "OC prazo único PA3Test", qtd_total: 10, valor_unitario: 100, data_pedido: "2026-01-01" }),
          JSON.stringify({ "0": { UN: { pedida: 10 } } }),
        ],
      );
      const parcelas = await c.query(
        `select numero_parcela, valor, data_vencimento from parcelas where oc_p_acabado_id = $1 order by numero_parcela`,
        [oc.id],
      );
      expect(parcelas.rows).toHaveLength(1);
      expect(Number(parcelas.rows[0].valor)).toBeCloseTo(1000, 2);
      expect(parcelas.rows[0].data_vencimento.toISOString().slice(0, 10)).toBe("2026-01-31");
    });
  });

  it("editar desconto regera as NÃO-pagas DESCONTANDO o que já foi pago (Σ TODAS as parcelas === novo total — fix round 1)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string }>(
        c,
        `select salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`,
        [
          JSON.stringify({ nome_produto: "OC regera PA3Test", qtd_total: 198, valor_unitario: 99, desconto_pct: 20, prazo_pagamento: "30/60/90" }),
          JSON.stringify({ "0": { UN: { pedida: 198 } } }),
        ],
      );
      await c.query(`update parcelas set status='pago', data_pagamento=current_date where oc_p_acabado_id=$1 and numero_parcela=1`, [oc.id]);

      await c.query(`select salvar_oc_p_acabado($1, $2::jsonb, $3::jsonb)`, [
        oc.id,
        JSON.stringify({ nome_produto: "OC regera PA3Test", qtd_total: 198, valor_unitario: 99, desconto_pct: 10, prazo_pagamento: "30/60/90" }),
        JSON.stringify({ "0": { UN: { pedida: 198 } } }),
      ]);

      const parcelas = await c.query(
        `select numero_parcela, valor, status from parcelas where oc_p_acabado_id = $1 order by numero_parcela`,
        [oc.id],
      );
      const ocRow = await um<{ valor_total_desconto: string }>(c, `select valor_total_desconto from ocs_p_acabado where id = $1`, [oc.id]);

      expect(parcelas.rows).toHaveLength(3);
      expect(parcelas.rows[0].status).toBe("pago");
      expect(Number(parcelas.rows[0].valor)).toBeCloseTo(5227.2, 2); // valor ORIGINAL preservado
      expect(parcelas.rows[1].status).toBe("a_pagar");
      expect(parcelas.rows[2].status).toBe("a_pagar");
      // novo total 198*99*0.9 = 17.641,80; restante (total − pago) = 17.641,80 − 5.227,20 =
      // 12.414,60, dividido pelos 2 slots NÃO-pagos → 6.207,30 cada (cenário exato do review).
      expect(Number(parcelas.rows[1].valor)).toBeCloseTo(6207.3, 2);
      expect(Number(parcelas.rows[2].valor)).toBeCloseTo(6207.3, 2);

      expect(Number(ocRow.valor_total_desconto)).toBeCloseTo(17641.8, 2);
      const soma = parcelas.rows.reduce((acc: number, r: any) => acc + Number(r.valor), 0);
      expect(soma).toBeCloseTo(Number(ocRow.valor_total_desconto), 2); // Σ TODAS as parcelas === total novo
    });
  });
});

describe.skipIf(!hasDb)("OC Produto Acabado — estoque_p_acabado (Task 3)", () => {
  it("em_maos = real − direcionado após inserir linha em direcionamento_lojas; variante não-direcionada mantém em_maos = real", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { produtoId } = await criarProdutoComCard(c, "PA3Test-estoque", 15);
      const grade = { "0": { UN: { pedida: 15 } }, "1": { UN: { pedida: 15 } } };
      const oc = await um<{ id: string }>(
        c,
        `select salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ nome_produto: "OC estoque PA3Test", produto_acabado_id: produtoId }), JSON.stringify(grade)],
      );
      const grade1 = {
        "0": { UN: { pedida: 15, recebida: 15, defeito: 0 } },
        "1": { UN: { pedida: 15, recebida: 15, defeito: 0 } },
      };
      const r = await um<{ cad_id: string }>(
        c,
        `select (v->>'cad_id') as cad_id from (select receber_oc_p_acabado($1, '{}'::jsonb, $2::jsonb) as v) s`,
        [oc.id, JSON.stringify(grade1)],
      );

      const antes = await um<{ e: any }>(c, `select estoque_p_acabado() as e`);
      expect(antes.e[produtoId]["0"]).toEqual({ real: 15, direcionado: 0, em_maos: 15 });
      expect(antes.e[produtoId]["1"]).toEqual({ real: 15, direcionado: 0, em_maos: 15 });

      const loja = await um<{ id: string }>(
        c,
        `insert into lojas_direcionamento (tenant_id, nome) values ($1,'Loja PA3Test') returning id`,
        [TENANT_TESTE],
      );
      await c.query(
        `insert into direcionamento_lojas (tenant_id, cad_id, loja_id, variante_numero, grades)
         values ($1,$2,$3,0,'{"UN":6}'::jsonb)`,
        [TENANT_TESTE, r.cad_id, loja.id],
      );

      const depois = await um<{ e: any }>(c, `select estoque_p_acabado() as e`);
      expect(depois.e[produtoId]["0"]).toEqual({ real: 15, direcionado: 6, em_maos: 9 });
      expect(depois.e[produtoId]["1"]).toEqual({ real: 15, direcionado: 0, em_maos: 15 }); // não-direcionada, intocada
    });
  });

  // Módulo desligado (produto_acabado=false): não dá pra exercitar o RAISE do wrapper
  // com os fixtures atuais — USER_TESTE é super_admin, e tenant_module_enabled() deixa
  // is_super_admin() furar o gate (mesma limitação já documentada no report da Task 2
  // e em tests/integration/seguranca.test.ts:4-7, "No banco atual TODO usuário é
  // super_admin"). Consistente com o resto da suíte: nenhum teste de módulo-off para
  // as RPCs de Produto Acabado.
});

// Task 5 fix round 1 (review): o front tinha um .delete() cru na tabela — RPC nova
// excluir_oc_p_acabado (migration 20260807180000) espelha excluir_oc_tecido/
// _excluir_oc_tecido_core (P0001 se recebida ou com parcela paga; senão DELETE, o
// cascade de parcelas.oc_p_acabado_id limpa as não-pagas sozinho).
describe.skipIf(!hasDb)("OC Produto Acabado — excluir_oc_p_acabado (Task 5 fix round 1)", () => {
  it("exclui OC encomendada sem parcela paga; cascade limpa as parcelas (não-pagas) junto", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string }>(
        c,
        `select salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`,
        [
          JSON.stringify({ nome_produto: "OC excluir PA5Test-a", qtd_total: 10, valor_unitario: 50, prazo_pagamento: "30" }),
          JSON.stringify({ "0": { UN: { pedida: 10 } } }),
        ],
      );
      const antes = await c.query(`select count(*)::int as n from parcelas where oc_p_acabado_id = $1`, [oc.id]);
      expect(antes.rows[0].n).toBeGreaterThan(0); // trigger gerou parcela(s) a_pagar

      await c.query(`select excluir_oc_p_acabado($1)`, [oc.id]);

      const ocDepois = await c.query(`select id from ocs_p_acabado where id = $1`, [oc.id]);
      expect(ocDepois.rows).toHaveLength(0);
      const parcelasDepois = await c.query(`select id from parcelas where oc_p_acabado_id = $1`, [oc.id]);
      expect(parcelasDepois.rows).toHaveLength(0); // cascade
    });
  });

  it("OC recebida (status='recebido') → P0001, não exclui", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string }>(
        c,
        `select salvar_oc_p_acabado(null, '{"nome_produto":"OC excluir PA5Test-b"}'::jsonb, '{}'::jsonb) as id`,
      );
      await c.query(`update ocs_p_acabado set status = 'recebido' where id = $1`, [oc.id]);

      await c.query("SAVEPOINT sp_excluir_recebida");
      await expect(c.query(`select excluir_oc_p_acabado($1)`, [oc.id])).rejects.toThrow(/já recebida/);
      await c.query("ROLLBACK TO SAVEPOINT sp_excluir_recebida");

      const aindaExiste = await c.query(`select id from ocs_p_acabado where id = $1`, [oc.id]);
      expect(aindaExiste.rows).toHaveLength(1);
    });
  });

  it("OC com parcela paga → P0001, não exclui (mesmo status='encomendado')", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const oc = await um<{ id: string }>(
        c,
        `select salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`,
        [
          JSON.stringify({ nome_produto: "OC excluir PA5Test-c", qtd_total: 10, valor_unitario: 50, prazo_pagamento: "30" }),
          JSON.stringify({ "0": { UN: { pedida: 10 } } }),
        ],
      );
      await c.query(
        `update parcelas set status = 'pago', data_pagamento = current_date where oc_p_acabado_id = $1 and numero_parcela = 1`,
        [oc.id],
      );

      await c.query("SAVEPOINT sp_excluir_parcela_paga");
      await expect(c.query(`select excluir_oc_p_acabado($1)`, [oc.id])).rejects.toThrow(/parcela paga/);
      await c.query("ROLLBACK TO SAVEPOINT sp_excluir_parcela_paga");

      const aindaExiste = await c.query(`select id from ocs_p_acabado where id = $1`, [oc.id]);
      expect(aindaExiste.rows).toHaveLength(1);
    });
  });
});

// Task 7/8 (front) Step 3 — Insumos/Explosão: `_estoque_etiqueta_core` calculava "baixa"
// só a partir de `cad_etiquetas` de um `cad` com `enviado_corte=true`, que um modelo
// revenda NUNCA seta (não passa pela Explosão/corte de tecido). Fix aditivo
// `baixa_revenda`: consumo de insumo revenda = modelo_etiquetas.consumo × peças
// recebidas (cad_grades.grade_total_real do cad-espelho de receber_oc_p_acabado).
describe.skipIf(!hasDb)("estoque_etiqueta — ramo revenda (Task 7 fix)", () => {
  it("consumo de insumo revenda entra na 'baixa' via peças recebidas, sem depender de enviado_corte", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { produtoId, modeloId } = await criarProdutoComCard(c, "PA7Test-etq", 20);

      const etq = await um<{ id: string }>(c, `insert into etiquetas (nome) values ('Etiqueta PA7Test') returning id`);
      await c.query(
        `insert into modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, consumo, custo_previsto) values ($1,$2,$3,2,1.5)`,
        [TENANT_TESTE, modeloId, etq.id],
      );

      // Antes de receber a OC (sem cad ainda) — nenhuma linha de baixa pra essa etiqueta.
      const antes = await c.query(`select * from estoque_etiqueta() where etiqueta_id = $1`, [etq.id]);
      expect(antes.rows).toHaveLength(0);

      const grade = {
        "0": { P: { pedida: 10 }, M: { pedida: 10 } },
        "1": { P: { pedida: 10 }, M: { pedida: 10 } },
      };
      const oc = await um<{ id: string }>(
        c,
        `select salvar_oc_p_acabado(null, $1::jsonb, $2::jsonb) as id`,
        [JSON.stringify({ nome_produto: "OC PA7Test-etq", produto_acabado_id: produtoId }), JSON.stringify(grade)],
      );
      const gradeRecebimento = {
        "0": { P: { pedida: 10, recebida: 9, defeito: 1 }, M: { pedida: 10, recebida: 10, defeito: 0 } },
        "1": { P: { pedida: 10, recebida: 10, defeito: 2 }, M: { pedida: 10, recebida: 9, defeito: 0 } },
      };
      await c.query(`select receber_oc_p_acabado($1, '{}'::jsonb, $2::jsonb)`, [oc.id, JSON.stringify(gradeRecebimento)]);

      // Peças recebidas: var0 8+10=18, var1 8+9=17 → total 35. Consumo 2/peça → baixa = 70.
      const depois = await um<{ baixa: string; fisico: string; tamanho: string | null }>(
        c,
        `select baixa, fisico, tamanho from estoque_etiqueta() where etiqueta_id = $1`,
        [etq.id],
      );
      expect(Number(depois.baixa)).toBe(70);
      expect(depois.tamanho).toBeNull();
      expect(Number(depois.fisico)).toBe(0); // sem recebimento de OC insumo — greatest(0, 0-70)

      // Modelo NÃO-revenda com o mesmo etiqueta_id não deve ganhar consumo nenhum
      // (a nova CTE filtra origem='revenda' — sem efeito nos modelos manufaturados).
      const outroModelo = await um<{ id: string }>(
        c,
        `insert into modelos (tenant_id, nome, origem) values ($1,'Manufaturado PA7Test-etq','interno') returning id`,
        [TENANT_TESTE],
      );
      await c.query(
        `insert into modelo_etiquetas (tenant_id, modelo_id, etiqueta_id, consumo, custo_previsto) values ($1,$2,$3,5,1)`,
        [TENANT_TESTE, outroModelo.id, etq.id],
      );
      const depoisOutro = await um<{ baixa: string }>(
        c,
        `select baixa from estoque_etiqueta() where etiqueta_id = $1`,
        [etq.id],
      );
      expect(Number(depoisOutro.baixa)).toBe(70); // sem mudança — modelo interno sem cad/enviado_corte não soma
    });
  });
});
