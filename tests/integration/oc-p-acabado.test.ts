import { describe, it, expect } from "vitest";
import { hasDb, withTx, comoUsuario, um, TENANT_TESTE } from "./db";
import { ocPaSalvar, ocPaReceber } from "./oc-itens-helpers";

// R13 (OC por fornecedor com VARIOS produtos): estas OCs de 1 produto agora sao montadas/salvas/recebidas pelo contrato novo
// (`salvar_oc_p_acabado_itens` / `receber_item_oc_p_acabado`, via ./oc-itens-helpers) — o escritor antigo
// (`salvar_oc_p_acabado`/`receber_oc_p_acabado`) e RECUSADO de proposito (`versao_antiga`). A intencao dos testes e a mesma
// (recebimento, parcelas, preco congelado, sync com o produto...); o que muda e onde moram os dados: nome/valores/grade/NF no
// ITEM, fornecedor/datas/prazo no cabecalho.
//
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

describe.skipIf(!hasDb)("OC Produto Acabado — receber_item_oc_p_acabado (Task 3; contrato R13)", () => {
  it("receber sem produto vinculado à OC → P0001 'Crie o card'", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC sem vinculo PA3Test" });
      await expect(ocPaReceber(c, ocId)).rejects.toThrow(/Crie o card no Planejamento antes de receber/);
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
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC PA3Test-b", produto_acabado_id: prod.id });
      await expect(ocPaReceber(c, ocId)).rejects.toThrow(/Crie o card no Planejamento antes de receber/);
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
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC PA3Test-c", produto_acabado_id: produtoId }, grade);

      const gradeRecebimento = {
        "0": { P: { pedida: 10, recebida: 9, defeito: 1 }, M: { pedida: 10, recebida: 10, defeito: 0 } },
        "1": { P: { pedida: 10, recebida: 10, defeito: 2 }, M: { pedida: 10, recebida: 9, defeito: 0 } },
      };
      const resultado = await ocPaReceber(c, ocId, { data_entrega: "2026-08-10", nota_fiscal: "NF-PA3Test-c" }, gradeRecebimento);
      // var0: P 9-1=8, M 10-0=10 → 18; var1: P 10-2=8, M 9-0=9 → 17; total 35
      expect(Number(resultado.total_real)).toBe(35);

      // status do cabecalho e DERIVADO (recebido <=> todos os itens recebidos); a NF do recebimento mora no ITEM
      const ocRow = await um<{ status: string }>(c, `select status from ocs_p_acabado where id = $1`, [ocId]);
      expect(ocRow.status).toBe("recebido");
      const itRow = await um<{ status: string; nota_fiscal: string }>(c, `select status, nota_fiscal from ocs_p_acabado_itens where oc_id = $1`, [ocId]);
      expect(itRow.status).toBe("recebido");
      expect(itRow.nota_fiscal).toBe("NF-PA3Test-c");

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
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC PA3Test-d", produto_acabado_id: produtoId }, grade);
      const grade1 = { "0": { UN: { pedida: 10, recebida: 10, defeito: 0 } }, "1": { UN: { pedida: 10, recebida: 10, defeito: 0 } } };
      const r1 = await ocPaReceber(c, ocId, {}, grade1);

      // Confirma o CQ manualmente (fora do escopo desta RPC — só simula o estado).
      await c.query(`update controle_qualidade set status='confirmado', confirmado_at=now() where cad_id=$1`, [r1.cad_id]);

      // Recebimento corrigido (ex.: achou mais defeito depois) regrava grades_reais.
      const grade2 = { "0": { UN: { pedida: 10, recebida: 10, defeito: 3 } }, "1": { UN: { pedida: 10, recebida: 10, defeito: 0 } } };
      await ocPaReceber(c, ocId, {}, grade2);

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
      const ocId = await ocPaSalvar(
        c,
        null,
        { nome_produto: "OC parcelas PA3Test", qtd_total: 198, valor_unitario: 99, desconto_pct: 20, prazo_pagamento: "30/60/90" },
        { "0": { UN: { pedida: 198 } } },
      );
      const parcelas = await c.query(
        `select numero_parcela, valor, status from parcelas where oc_p_acabado_id = $1 order by numero_parcela`,
        [ocId],
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
      const ocId = await ocPaSalvar(
        c,
        null,
        { nome_produto: "OC prazo único PA3Test", qtd_total: 10, valor_unitario: 100, data_pedido: "2026-01-01" },
        { "0": { UN: { pedida: 10 } } },
      );
      const parcelas = await c.query(
        `select numero_parcela, valor, data_vencimento from parcelas where oc_p_acabado_id = $1 order by numero_parcela`,
        [ocId],
      );
      expect(parcelas.rows).toHaveLength(1);
      expect(Number(parcelas.rows[0].valor)).toBeCloseTo(1000, 2);
      expect(parcelas.rows[0].data_vencimento.toISOString().slice(0, 10)).toBe("2026-01-31");
    });
  });

  it("editar desconto regera as NÃO-pagas DESCONTANDO o que já foi pago (Σ TODAS as parcelas === novo total — fix round 1)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const ocId = await ocPaSalvar(
        c,
        null,
        { nome_produto: "OC regera PA3Test", qtd_total: 198, valor_unitario: 99, desconto_pct: 20, prazo_pagamento: "30/60/90" },
        { "0": { UN: { pedida: 198 } } },
      );
      await c.query(`update parcelas set status='pago', data_pagamento=current_date where oc_p_acabado_id=$1 and numero_parcela=1`, [ocId]);

      await ocPaSalvar(
        c,
        ocId,
        { nome_produto: "OC regera PA3Test", qtd_total: 198, valor_unitario: 99, desconto_pct: 10, prazo_pagamento: "30/60/90" },
        { "0": { UN: { pedida: 198 } } },
      );

      const parcelas = await c.query(
        `select numero_parcela, valor, status from parcelas where oc_p_acabado_id = $1 order by numero_parcela`,
        [ocId],
      );
      const ocRow = await um<{ valor_total_desconto: string }>(c, `select valor_total_desconto from ocs_p_acabado where id = $1`, [ocId]);

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
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC estoque PA3Test", produto_acabado_id: produtoId }, grade);
      const grade1 = {
        "0": { UN: { pedida: 15, recebida: 15, defeito: 0 } },
        "1": { UN: { pedida: 15, recebida: 15, defeito: 0 } },
      };
      const r = await ocPaReceber(c, ocId, {}, grade1);

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
      const ocId = await ocPaSalvar(
        c,
        null,
        { nome_produto: "OC excluir PA5Test-a", qtd_total: 10, valor_unitario: 50, prazo_pagamento: "30" },
        { "0": { UN: { pedida: 10 } } },
      );
      const antes = await c.query(`select count(*)::int as n from parcelas where oc_p_acabado_id = $1`, [ocId]);
      expect(antes.rows[0].n).toBeGreaterThan(0); // trigger gerou parcela(s) a_pagar

      await c.query(`select excluir_oc_p_acabado($1)`, [ocId]);

      const ocDepois = await c.query(`select id from ocs_p_acabado where id = $1`, [ocId]);
      expect(ocDepois.rows).toHaveLength(0);
      const itensDepois = await c.query(`select id from ocs_p_acabado_itens where oc_id = $1`, [ocId]);
      expect(itensDepois.rows).toHaveLength(0); // cascade dos itens (R13)
      const parcelasDepois = await c.query(`select id from parcelas where oc_p_acabado_id = $1`, [ocId]);
      expect(parcelasDepois.rows).toHaveLength(0); // cascade
    });
  });

  it("OC recebida (status='recebido') → P0001, não exclui", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      // OC recebida DE VERDADE (R13: o status do cabecalho e derivado do recebimento do item, nao se grava direto)
      const { produtoId } = await criarProdutoComCard(c, "PA5Test-b", 5);
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC excluir PA5Test-b", produto_acabado_id: produtoId });
      await ocPaReceber(c, ocId);
      expect((await um<{ status: string }>(c, `select status from ocs_p_acabado where id = $1`, [ocId])).status).toBe("recebido");

      await c.query("SAVEPOINT sp_excluir_recebida");
      await expect(c.query(`select excluir_oc_p_acabado($1)`, [ocId])).rejects.toThrow(/Ha produto recebido na OC/);
      await c.query("ROLLBACK TO SAVEPOINT sp_excluir_recebida");

      const aindaExiste = await c.query(`select id from ocs_p_acabado where id = $1`, [ocId]);
      expect(aindaExiste.rows).toHaveLength(1);
    });
  });

  it("OC com parcela paga → P0001, não exclui (mesmo status='encomendado')", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const ocId = await ocPaSalvar(
        c,
        null,
        { nome_produto: "OC excluir PA5Test-c", qtd_total: 10, valor_unitario: 50, prazo_pagamento: "30" },
        { "0": { UN: { pedida: 10 } } },
      );
      await c.query(
        `update parcelas set status = 'pago', data_pagamento = current_date where oc_p_acabado_id = $1 and numero_parcela = 1`,
        [ocId],
      );

      await c.query("SAVEPOINT sp_excluir_parcela_paga");
      await expect(c.query(`select excluir_oc_p_acabado($1)`, [ocId])).rejects.toThrow(/parcela paga/);
      await c.query("ROLLBACK TO SAVEPOINT sp_excluir_parcela_paga");

      const aindaExiste = await c.query(`select id from ocs_p_acabado where id = $1`, [ocId]);
      expect(aindaExiste.rows).toHaveLength(1);
    });
  });
});

// Task 7/8 (front) Step 3 — Insumos/Explosão: `_estoque_etiqueta_core` calculava "baixa"
// só a partir de `cad_etiquetas` de um `cad` com `enviado_corte=true`, que um modelo
// revenda NUNCA seta (não passa pela Explosão/corte de tecido). Fix aditivo
// `baixa_revenda`: consumo de insumo revenda = modelo_etiquetas.consumo × peças
// recebidas (cad_grades.grade_total_real do cad-espelho de receber_item_oc_p_acabado).
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
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC PA7Test-etq", produto_acabado_id: produtoId }, grade);
      const gradeRecebimento = {
        "0": { P: { pedida: 10, recebida: 9, defeito: 1 }, M: { pedida: 10, recebida: 10, defeito: 0 } },
        "1": { P: { pedida: 10, recebida: 10, defeito: 2 }, M: { pedida: 10, recebida: 9, defeito: 0 } },
      };
      await ocPaReceber(c, ocId, {}, gradeRecebimento);

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

// Refino onda 2 (ago/2026), item 1 (nº do pedido editável) — SUBSTITUIDO pelo contrato da R13: o numero da OC e SEMPRE gerado
// pelo servidor (`_oc_numero_proximo`, com sigla do lote e advisory lock por loja) e "nao muda" depois (a tela mostra o campo
// desabilitado: "O número é gerado ao criar e não muda."). `salvar_oc_p_acabado_itens` NAO le `numero` do payload. Os 4 testes
// abaixo fixam o contrato novo (mesma intencao: o numero e estavel e nunca fica vazio), no lugar do "editavel" antigo.
describe.skipIf(!hasDb)("OC Produto Acabado — nº do pedido gerado e estável (R13; antes: editável)", () => {
  const NUM = /^[A-Z0-9]{3,}-\d{5}$/; // SIGLA-NNNNN (sigla de lote: fornecedor+G/C, ACE ou DIV)

  it("numero mandado no payload é IGNORADO na criação (o servidor gera o seu)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC numero custom R13", numero: "MEUNUM-001" });
      const row = await um<{ numero: string }>(c, `select numero from ocs_p_acabado where id = $1`, [ocId]);
      expect(row.numero).not.toBe("MEUNUM-001");
      expect(row.numero).toMatch(NUM);
    });
  });

  it("sem numero no payload a OC nasce com numero gerado (nunca vazio)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC numero auto R13" });
      const row = await um<{ numero: string | null }>(c, `select numero from ocs_p_acabado where id = $1`, [ocId]);
      expect(row.numero).toBeTruthy();
      expect(row.numero).toMatch(NUM);
    });
  });

  it("editar uma OC existente e mandar numero novo NÃO renomeia (numero fixo depois de criado)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC numero renomear R13" });
      const antes = (await um<{ numero: string }>(c, `select numero from ocs_p_acabado where id = $1`, [ocId])).numero;
      await ocPaSalvar(c, ocId, { nome_produto: "OC numero renomear R13", numero: "RENOMEADO-9" });
      const row = await um<{ numero: string }>(c, `select numero from ocs_p_acabado where id = $1`, [ocId]);
      expect(row.numero).toBe(antes);
      expect(row.numero).not.toBe("RENOMEADO-9");
    });
  });

  it("editar sem mandar numero PRESERVA o número atual", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC numero preservar R13" });
      const antes = (await um<{ numero: string }>(c, `select numero from ocs_p_acabado where id = $1`, [ocId])).numero;
      await ocPaSalvar(c, ocId, { nome_produto: "OC numero preservar R13 (editada)" });
      const row = await um<{ numero: string }>(c, `select numero from ocs_p_acabado where id = $1`, [ocId]);
      expect(row.numero).toBe(antes); // não some/reseta
    });
  });
});

// Refino onda 2 (ago/2026), item 4: preço congela ao receber (paridade com a decisão do dono p/ tecido). R13: o congelamento
// vale POR ITEM — o escritor (`_salvar_oc_p_acabado_itens_core`) rejeita (P0001 "Item recebido - desfaca o recebimento para
// alterar valores") mudanca de valor_unitario/desconto_pct/qtd_total/grade_detalhe (campo pedida) de um item JA RECEBIDO;
// NF/revisao/devolucao (campos de recebimento, do item) seguem editaveis pelo proprio recebimento; nome/categorias/fornecedor/
// datas/prazo continuam editaveis normalmente.
describe.skipIf(!hasDb)("OC Produto Acabado — preço congela ao receber (refino onda 2, item 4; por item na R13)", () => {
  const DADOS = (sufixo: string) => ({ nome_produto: `OC congela ${sufixo}`, qtd_total: 10, valor_unitario: 50, desconto_pct: 0, prazo_pagamento: "30" });
  const GRADE = { "0": { UN: { pedida: 10 } } };
  // OC recebida DE VERDADE: produto com card + receber_item_oc_p_acabado (R13: o status do item/cabecalho nao se grava direto)
  async function criarOcRecebida(c: any, sufixo: string) {
    const { produtoId } = await criarProdutoComCard(c, `Congela-${sufixo}`, 5);
    const ocId = await ocPaSalvar(c, null, { ...DADOS(sufixo), produto_acabado_id: produtoId }, GRADE);
    await ocPaReceber(c, ocId, { data_entrega: "2026-08-10", nota_fiscal: "NF-orig" }, { "0": { UN: { pedida: 10, recebida: 10, defeito: 0 } } });
    return { ocId, produtoId };
  }
  const RECUSA = /Item recebido/;

  it("editar valor_unitario numa OC recebida → P0001 'Item recebido'", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { ocId } = await criarOcRecebida(c, "Onda2-a");
      await c.query("SAVEPOINT sp_valor");
      await expect(ocPaSalvar(c, ocId, { valor_unitario: 99 })).rejects.toThrow(RECUSA);
      await c.query("ROLLBACK TO SAVEPOINT sp_valor");
    });
  });

  it("editar desconto_pct numa OC recebida → P0001", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { ocId } = await criarOcRecebida(c, "Onda2-b");
      await c.query("SAVEPOINT sp_desconto");
      await expect(ocPaSalvar(c, ocId, { desconto_pct: 15 })).rejects.toThrow(RECUSA);
      await c.query("ROLLBACK TO SAVEPOINT sp_desconto");
    });
  });

  it("editar qtd_total (+ grade pedida coerente) numa OC recebida → P0001", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { ocId } = await criarOcRecebida(c, "Onda2-c");
      await c.query("SAVEPOINT sp_qtd");
      await expect(ocPaSalvar(c, ocId, { qtd_total: 20 }, { "0": { UN: { pedida: 20, recebida: 10, defeito: 0 } } })).rejects.toThrow(RECUSA);
      await c.query("ROLLBACK TO SAVEPOINT sp_qtd");
    });
  });

  it("editar só a grade PEDIDA (qtd_total intacto) numa OC recebida → P0001", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { ocId } = await criarOcRecebida(c, "Onda2-d");
      await c.query("SAVEPOINT sp_grade");
      await expect(
        ocPaSalvar(c, ocId, {}, { "0": { UN: { pedida: 4, recebida: 4, defeito: 0 } }, "1": { UN: { pedida: 6, recebida: 6, defeito: 0 } } }),
      ).rejects.toThrow(RECUSA);
      await c.query("ROLLBACK TO SAVEPOINT sp_grade");
    });
  });

  it("reenviar os MESMOS valores (nenhuma mudança real) numa OC recebida → OK, não dispara o guard", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { ocId } = await criarOcRecebida(c, "Onda2-e");
      // Mesmos $/qtd/grade pedida — um Salvar comum sem tocar nisso não deve falhar.
      await ocPaSalvar(c, ocId, { nome_produto: "OC congela Onda2-e (renomeada)" });
      const row = await um<{ nome_produto: string }>(c, `select nome_produto from ocs_p_acabado_itens where oc_id = $1`, [ocId]);
      expect(row.nome_produto).toBe("OC congela Onda2-e (renomeada)"); // nome NÃO é congelado, só $/qtd
    });
  });

  it("editar NF/revisão/devolução (campos de recebimento) numa OC recebida → OK, guard não se aplica", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { ocId } = await criarOcRecebida(c, "Onda2-f");
      // R13: NF/revisao/devolucao sao do ITEM e so entram pelo recebimento do item (`item_*` em receber_item_oc_p_acabado) — o
      // re-receber de um item recebido (mesmos $/qtd/grade pedida) regrava esses campos sem acionar o congelamento.
      await ocPaReceber(c, ocId, { nota_fiscal: "NF-9988", revisao: "revisado ok", devolucao: "sem devolução", data_entrega: "2026-08-10" });
      const row = await um<{ nota_fiscal: string; revisao: string; devolucao: string; status: string }>(
        c,
        `select nota_fiscal, revisao, devolucao, status from ocs_p_acabado_itens where oc_id = $1`,
        [ocId],
      );
      expect(row.nota_fiscal).toBe("NF-9988");
      expect(row.revisao).toBe("revisado ok");
      expect(row.devolucao).toBe("sem devolução");
      expect(row.status).toBe("recebido");
    });
  });

  it("OC 'encomendado' (não recebida) aceita mudança normal de valor_unitario/qtd — guard só vale pra item 'recebido'", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const ocId = await ocPaSalvar(c, null, DADOS("Onda2-g"), GRADE);
      await ocPaSalvar(c, ocId, { qtd_total: 20, valor_unitario: 80 }, { "0": { UN: { pedida: 20 } } });
      const row = await um<{ qtd_total: number; valor_unitario: string }>(
        c,
        `select qtd_total, valor_unitario from ocs_p_acabado_itens where oc_id = $1`,
        [ocId],
      );
      expect(Number(row.qtd_total)).toBe(20);
      expect(Number(row.valor_unitario)).toBe(80);
      // e o cabecalho (derivado dos itens) acompanha
      const cab = await um<{ qtd_total: number; valor_bruto: string }>(c, `select qtd_total, valor_bruto from ocs_p_acabado where id = $1`, [ocId]);
      expect(Number(cab.qtd_total)).toBe(20);
      expect(Number(cab.valor_bruto)).toBe(1600);
    });
  });
});

// Refino ago/2026: "o valor unitário e desconto no card devem ser atualizados de acordo
// com a OC" (migração 20260812100000). R13: `_salvar_oc_p_acabado_itens_core` empurra valor_unitario/
// desconto_pct do ITEM pra `produtos_acabados` sempre que o item salvo TEM produto_acabado_id (criação
// OU edição); `_vincular_oc_p_acabado_core` faz o mesmo ao VINCULAR (não ao desvincular).
// qtd_total NÃO sincroniza (decisão registrada no cabeçalho da migração).
describe.skipIf(!hasDb)("OC Produto Acabado — sync valor_unitario/desconto_pct → produto (refino ago/2026)", () => {
  async function criarProduto(c: any, sufixo: string) {
    const g = await um<{ id: string }>(
      c,
      `insert into grupos_produto (tenant_id, nome) values ($1,$2) returning id`,
      [TENANT_TESTE, `Fem SyncOcPa ${sufixo}`],
    );
    const cat = await um<{ id: string }>(
      c,
      `insert into categorias_produto (tenant_id, nome) values ($1,$2) returning id`,
      [TENANT_TESTE, `Vestido SyncOcPa ${sufixo}`],
    );
    const prod = await um<{ id: string }>(
      c,
      `select salvar_produto_acabado(null, $1::jsonb, '[]'::jsonb) as id`,
      [JSON.stringify({ nome: `Vestido SyncOcPa ${sufixo}`, grupo_id: g.id, categoria_id: cat.id })],
    );
    return prod.id;
  }

  async function valoresProduto(c: any, prodId: string) {
    return um<{ valor_unitario: string; desconto_pct: string; qtd_total: number }>(
      c,
      `select valor_unitario, desconto_pct, qtd_total from produtos_acabados where id = $1`,
      [prodId],
    );
  }

  it("salvar_oc_p_acabado_itens: OC AVULSA (item sem produto_acabado_id) não toca em produto nenhum", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const prodId = await criarProduto(c, "Avulsa");
      await ocPaSalvar(c, null, { nome_produto: "OC avulsa SyncOcPaTest", valor_unitario: 123, desconto_pct: 50 }, {});
      const row = await valoresProduto(c, prodId);
      expect(Number(row.valor_unitario)).toBe(0);
      expect(Number(row.desconto_pct)).toBe(0);
    });
  });

  it("salvar_oc_p_acabado_itens: criar OC COM produto_acabado_id (no item) sincroniza valor/desconto na hora", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const prodId = await criarProduto(c, "Criacao");
      await ocPaSalvar(c, null, { nome_produto: "OC vinc criacao SyncOcPaTest", valor_unitario: 55.5, desconto_pct: 10, produto_acabado_id: prodId }, {});
      const row = await valoresProduto(c, prodId);
      expect(Number(row.valor_unitario)).toBe(55.5);
      expect(Number(row.desconto_pct)).toBe(10);
    });
  });

  it("salvar_oc_p_acabado_itens: EDITAR uma OC já vinculada re-sincroniza o produto (e qtd_total do produto fica intocado)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const prodId = await criarProduto(c, "Edicao");
      // qtd_total do PRODUTO é setado à parte, por conta própria (grade de variantes) —
      // nunca deve ser sobrescrito pelo sync.
      await c.query(`update produtos_acabados set qtd_total = 42 where id = $1`, [prodId]);

      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC vinc edicao SyncOcPaTest", valor_unitario: 10, desconto_pct: 0, produto_acabado_id: prodId }, {});
      // qtd_total do item muda (com grade pedida coerente, senão a validação do próprio item
      // rejeita) — o ponto do teste é que o qtd_total do PRODUTO não segue essa mudança.
      await ocPaSalvar(
        c,
        ocId,
        { nome_produto: "OC vinc edicao SyncOcPaTest", valor_unitario: 77.77, desconto_pct: 25, qtd_total: 999 },
        { "0": { UN: { pedida: 999 } } },
      );
      const row = await valoresProduto(c, prodId);
      expect(Number(row.valor_unitario)).toBe(77.77);
      expect(Number(row.desconto_pct)).toBe(25);
      expect(Number(row.qtd_total)).toBe(42); // NÃO sincroniza — segue o dado próprio do produto
    });
  });

  it("vincular_oc_p_acabado: VINCULAR uma OC existente empurra valor/desconto pro produto na hora", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const prodId = await criarProduto(c, "Vincular");
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC pre-vinculo SyncOcPaTest", valor_unitario: 33.33, desconto_pct: 5 }, {});
      const antes = await valoresProduto(c, prodId);
      expect(Number(antes.valor_unitario)).toBe(0);

      await c.query(`select vincular_oc_p_acabado($1, $2)`, [ocId, prodId]);
      const depois = await valoresProduto(c, prodId);
      expect(Number(depois.valor_unitario)).toBe(33.33);
      expect(Number(depois.desconto_pct)).toBe(5);
    });
  });

  it("vincular_oc_p_acabado: DESVINCULAR (produto_id null) não reseta os valores já herdados", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const prodId = await criarProduto(c, "Desvincular");
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC desvinculo SyncOcPaTest", valor_unitario: 20, desconto_pct: 8 }, {});
      await c.query(`select vincular_oc_p_acabado($1, $2)`, [ocId, prodId]);
      await c.query(`select vincular_oc_p_acabado($1, null)`, [ocId]);
      const row = await valoresProduto(c, prodId);
      expect(Number(row.valor_unitario)).toBe(20);
      expect(Number(row.desconto_pct)).toBe(8);
    });
  });
});

// Item 3 do refino (markups digitáveis, ago/2026): o sync Compra→Produto acima (custo
// mudando) agora também recomputa os preços derivados (markup_atacado/markup_varejo ×
// custo) do espelho — editar valor/desconto na OC, vincular uma OC ou receber recalculam
// automaticamente modelos.preco_atacado/preco_venda, sem precisar reabrir o card do
// produto pra "salvar de novo".
describe.skipIf(!hasDb)("OC Produto Acabado — recompute de preço via markup (item 3 do refino)", () => {
  // T1 (backend, 05/out): regra VIVA do varejo = base(custo) × markup_varejo, INDEPENDENTE do atacado (87d373cf, 16/set: "Varejo INDEPENDENTE do
  // atacado: preço_varejo = base × mk_varejo, não mais atacado × mk_varejo"; `_pa_recomputar_precos_modelo`, `src/lib/preco-revenda.ts`). Estes
  // testes (12/ago, fc988e60) esperavam atacado × mk_varejo; o atacado (custo × mk_atacado) segue igual.
  async function criarProdutoComMarkupECard(c: any, sufixo: string) {
    const g = await um<{ id: string }>(
      c,
      `insert into grupos_produto (tenant_id, nome) values ($1,$2) returning id`,
      [TENANT_TESTE, `Fem MkOc ${sufixo}`],
    );
    const cat = await um<{ id: string }>(
      c,
      `insert into categorias_produto (tenant_id, nome) values ($1,$2) returning id`,
      [TENANT_TESTE, `Vestido MkOc ${sufixo}`],
    );
    const dados = {
      nome: `Vestido MkOc ${sufixo}`, grupo_id: g.id, categoria_id: cat.id,
      markup_atacado: 2, markup_varejo: 1.5, grade_proporcao: { UN: 1 },
    };
    const prod = await um<{ id: string }>(c, `select salvar_produto_acabado(null, $1::jsonb, '[]'::jsonb) as id`, [JSON.stringify(dados)]);
    const modelo = await um<{ id: string }>(c, `select criar_card_produto_acabado($1) as id`, [prod.id]);
    return { produtoId: prod.id, modeloId: modelo.id };
  }

  it("criar OC vinculada (valor/desconto) já recomputa o preço do espelho (mesmo save que sincroniza compra→produto)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { produtoId, modeloId } = await criarProdutoComMarkupECard(c, "a");
      await ocPaSalvar(c, null, { nome_produto: "OC MkOc-a", valor_unitario: 100, desconto_pct: 0, produto_acabado_id: produtoId }, {});
      // custo = 100 + 0 insumos = 100; atacado = 100×2 = 200; varejo = 100×1.5 = 150
      const m = await um<{ preco_atacado: string; preco_venda: string }>(c, `select preco_atacado, preco_venda from modelos where id = $1`, [modeloId]);
      expect(Number(m.preco_atacado)).toBe(200);
      expect(Number(m.preco_venda)).toBe(150);
    });
  });

  it("editar valor_unitario/desconto de uma OC já vinculada RECALCULA o preço do espelho", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { produtoId, modeloId } = await criarProdutoComMarkupECard(c, "b");
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC MkOc-b", valor_unitario: 100, desconto_pct: 0, produto_acabado_id: produtoId }, {});
      const antes = await um<{ preco_atacado: string }>(c, `select preco_atacado from modelos where id = $1`, [modeloId]);
      expect(Number(antes.preco_atacado)).toBe(200);

      await ocPaSalvar(c, ocId, { nome_produto: "OC MkOc-b", valor_unitario: 60, desconto_pct: 50 }, {});
      // custo = 60×(1−50%) = 30; atacado = 30×2 = 60; varejo = 30×1.5 = 45
      const depois = await um<{ preco_atacado: string; preco_venda: string }>(c, `select preco_atacado, preco_venda from modelos where id = $1`, [modeloId]);
      expect(Number(depois.preco_atacado)).toBe(60);
      expect(Number(depois.preco_venda)).toBe(45);
    });
  });

  it("vincular_oc_p_acabado também recalcula o preço do espelho ao herdar valor/desconto da OC", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { produtoId, modeloId } = await criarProdutoComMarkupECard(c, "c");
      const ocId = await ocPaSalvar(c, null, { nome_produto: "OC MkOc-c avulsa", valor_unitario: 40, desconto_pct: 0 }, {});
      await c.query(`select vincular_oc_p_acabado($1, $2)`, [ocId, produtoId]);
      // custo = 40; atacado = 80; varejo = 40×1.5 = 60
      const m = await um<{ preco_atacado: string; preco_venda: string }>(c, `select preco_atacado, preco_venda from modelos where id = $1`, [modeloId]);
      expect(Number(m.preco_atacado)).toBe(80);
      expect(Number(m.preco_venda)).toBe(60);
    });
  });

  it("receber_item_oc_p_acabado também recomputa (defensivo — custo previsto não muda ao receber, mas o recompute roda)", async () => {
    await withTx(async (c) => {
      await comoUsuario(c);
      const { produtoId, modeloId } = await criarProdutoComMarkupECard(c, "d");
      const ocId = await ocPaSalvar(
        c,
        null,
        { nome_produto: "OC MkOc-d", valor_unitario: 50, desconto_pct: 0, produto_acabado_id: produtoId },
        { "0": { UN: { pedida: 10 } } },
      );
      await ocPaReceber(c, ocId, {}, { "0": { UN: { pedida: 10, recebida: 10, defeito: 0 } } });
      // custo = 50; atacado = 100; varejo = 50×1.5 = 75
      const m = await um<{ preco_atacado: string; preco_venda: string }>(c, `select preco_atacado, preco_venda from modelos where id = $1`, [modeloId]);
      expect(Number(m.preco_atacado)).toBe(100);
      expect(Number(m.preco_venda)).toBe(75);
    });
  });
});
