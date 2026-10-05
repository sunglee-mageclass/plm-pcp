// [camada C2] Textos APROVADOS das confirmações (P-263 A / P-262 A / P-265 A / P-267 A) — usados AS WRITTEN; marcadores
// preenchidos só com dado já à mão, e a versão SEM o dado quando ele falta. Fonte: .superpowers/sdd/2026-10-05-camada/c2-textos.md
import { describe, it, expect } from "vitest";
import {
  dataBr, tipoOcFrase,
  textoCancelarLancamento, textoDesmarcarCqPre, textoDesmarcarCqPos, textoDesmarcarDirecionamento,
  textoDesconfirmarColecaoOrcamento, textoDesconfirmarColecaoPV, textoDesmarcarPagoOc, textoDesmarcarPagoServico,
  textoCancelarRolo, textoReabrirRolo, textoAjustarQtdRolo, textoRecalcularParcelas,
  textoApagarTodosServicos, textoApagarTodosItensOc, textoReprovarPecaTeste,
} from "@/lib/confirmacoes-textos";

describe("[camada C2] textos aprovados — Seção 1 (desfazem)", () => {
  it("1.1 Cancelar lançamento", () => {
    const t = textoCancelarLancamento({ nome: "BLUSA", ref: "R1", dataLancamento: "2026-10-05" });
    expect(t.titulo).toBe("Cancelar o lançamento de “BLUSA”?");
    expect(t.descricao).toBe("O modelo R1 deixa de constar como lançado e sai da contagem de Lançados nos dashboards. A data de lançamento (05/10/2026) é mantida e dá para lançar de novo depois.");
    expect([t.confirmar, t.cancelar, t.destrutivo]).toEqual(["Cancelar lançamento", "Voltar", true]);
    // sem REF e sem data: versão sem o dado
    const s = textoCancelarLancamento({ nome: "", ref: null, dataLancamento: null });
    expect(s.titulo).toBe("Cancelar o lançamento deste modelo?");
    expect(s.descricao).toBe("O modelo deixa de constar como lançado e sai da contagem de Lançados nos dashboards. A data de lançamento é mantida e dá para lançar de novo depois.");
  });
  it("1.2 Desmarcar CQ Pré", () => {
    const t = textoDesmarcarCqPre({ nome: "BLUSA" });
    expect(t.titulo).toBe("Desmarcar a confirmação do CQ de “BLUSA”?");
    expect(t.descricao).toBe("O CQ volta para pendente e pode ser editado. Junto com ele, voltam para pendente o CQ Pós e o Direcionamento (se já estavam confirmados), e a Grade Real volta ao valor planejado. Se o modelo já estava lançado, deixa de estar lançado e a etapa Lançamento acende #Erro. Serviços e contas a pagar não são apagados.");
    expect([t.confirmar, t.cancelar, t.destrutivo]).toEqual(["Desmarcar CQ", "Cancelar", true]);
    expect(textoDesmarcarCqPre({}).titulo).toBe("Desmarcar a confirmação do CQ deste modelo?");
  });
  it("1.3 Desmarcar CQ Pós", () => {
    const t = textoDesmarcarCqPos({ nome: "BLUSA" });
    expect(t.titulo).toBe("Desmarcar a confirmação do CQ Pós de “BLUSA”?");
    expect(t.descricao).toBe("O CQ Pós volta para pendente e pode ser editado. O modelo deixa de estar liberado para Direcionamento e Lançar. Se o Direcionamento já estava separado ele volta para pendente, e se o modelo já estava lançado deixa de estar lançado (a etapa Lançamento acende #Erro). O CQ Pré não muda.");
    expect([t.confirmar, t.cancelar, t.destrutivo]).toEqual(["Desmarcar CQ Pós", "Cancelar", true]);
  });
  it("1.4 Desmarcar Direcionamento", () => {
    const t = textoDesmarcarDirecionamento({ nome: "BLUSA" });
    expect(t.titulo).toBe("Desmarcar o Direcionamento de “BLUSA”?");
    expect(t.descricao).toBe("O Direcionamento deixa de estar confirmado (separado) e volta para pendente, podendo ser editado de novo. As quantidades por loja já digitadas continuam salvas.");
    expect([t.confirmar, t.cancelar, t.destrutivo]).toEqual(["Desmarcar", "Cancelar", true]);
  });
  it("1.5 / 1.6 Desconfirmar coleção (orçamento e Poder de Venda)", () => {
    const a = textoDesconfirmarColecaoOrcamento({ nome: "Verão 27" });
    expect(a.titulo).toBe("Desconfirmar a coleção “Verão 27”?");
    expect(a.descricao).toBe("A coleção volta para rascunho e pode ser editada de novo. Os cards já criados no Planejamento continuam como estão.");
    const b = textoDesconfirmarColecaoPV({ nome: "Verão 27" });
    expect(b.titulo).toBe("Desconfirmar a coleção “Verão 27”?");
    expect(b.descricao).toBe("A coleção volta para rascunho e pode ser editada de novo. Os cards já criados no Planejamento continuam como estão; ao confirmar outra vez, os cards em branco são conferidos com o plano.");
    expect([a.confirmar, a.cancelar, a.destrutivo]).toEqual(["Desconfirmar", "Cancelar", true]);
    expect(textoDesconfirmarColecaoPV({ nome: "  " }).titulo).toBe("Desconfirmar esta coleção?");
  });
  it("1.7 Desmarcar pago — parcela de OC (com e sem o total de parcelas / nº da OC / data)", () => {
    const base = { numeroParcela: 2, valor: 150, tipoOc: "tecido", numeroOc: "OC-9", dataPagamento: "2026-10-03", formatarValor: (v: unknown) => `R$ ${v}` };
    const t = textoDesmarcarPagoOc({ ...base, totalParcelas: 3 });
    expect(t.titulo).toBe("Desmarcar o pagamento desta parcela?");
    expect(t.descricao).toBe("A parcela 2/3 de R$ 150 da OC de Tecido Nº OC-9 volta para “a pagar” e a data de pagamento (03/10/2026) é apagada. O comprovante continua anexado.");
    expect([t.confirmar, t.cancelar, t.destrutivo]).toEqual(["Desmarcar pagamento", "Cancelar", true]);
    // total não vem na linha da parcela => "parcela 2"
    expect(textoDesmarcarPagoOc(base).descricao).toBe("A parcela 2 de R$ 150 da OC de Tecido Nº OC-9 volta para “a pagar” e a data de pagamento (03/10/2026) é apagada. O comprovante continua anexado.");
    // sem nº da OC ("—") e sem data
    expect(textoDesmarcarPagoOc({ ...base, numeroOc: "—", dataPagamento: null }).descricao).toBe("A parcela 2 de R$ 150 da OC de Tecido volta para “a pagar” e a data de pagamento é apagada. O comprovante continua anexado.");
  });
  it("1.8 Desmarcar pago — parcela de Serviço", () => {
    const t = textoDesmarcarPagoServico({ numeroParcela: 1, servico: "Costura", ref: "R1", valor: 80, dataPagamento: "2026-10-03", formatarValor: (v) => `R$ ${v}` });
    expect(t.titulo).toBe("Desmarcar o pagamento deste serviço?");
    expect(t.descricao).toBe("A parcela 1 do serviço “Costura” (R1) de R$ 80 volta para “a pagar” e a data de pagamento (03/10/2026) é apagada. O valor pago registrado deixa de valer e a parcela volta a entrar no cálculo do saldo. O comprovante continua anexado.");
    expect(textoDesmarcarPagoServico({ numeroParcela: 1, servico: "Costura", valor: 80, formatarValor: (v) => `R$ ${v}` }).descricao)
      .toBe("A parcela 1 do serviço “Costura” de R$ 80 volta para “a pagar” e a data de pagamento é apagada. O valor pago registrado deixa de valer e a parcela volta a entrar no cálculo do saldo. O comprovante continua anexado.");
  });
  it("1.9 / 1.10 / 1.11 rolos", () => {
    const c = textoCancelarRolo({ codigo: "R-001", variante: "Azul", numeroOc: "OC-9" });
    expect(c.titulo).toBe("Cancelar este rolo?");
    expect(c.descricao).toBe("O rolo R-001 (Azul) da OC OC-9 sai do estoque e do consumo, e o valor da OC é recalculado. Dá para reverter reabrindo o rolo nesta mesma tela.");
    expect([c.confirmar, c.cancelar, c.destrutivo]).toEqual(["Cancelar rolo", "Voltar", true]);
    expect(textoCancelarRolo({}).descricao).toBe("O rolo sai do estoque e do consumo, e o valor da OC é recalculado. Dá para reverter reabrindo o rolo nesta mesma tela.");
    const r = textoReabrirRolo({ codigo: "R-001", variante: "Azul", numeroOc: "OC-9" });
    expect(r.titulo).toBe("Reabrir este rolo?");
    expect(r.descricao).toBe("O rolo R-001 (Azul) da OC OC-9 volta ao estoque e ao consumo, e o valor da OC é recalculado.");
    expect([r.confirmar, r.cancelar, r.destrutivo]).toEqual(["Reabrir rolo", "Cancelar", false]);
    const a = textoAjustarQtdRolo({ codigo: "R-001", qtdAtual: "10", qtdNova: 12.5, unidade: "m" });
    expect(a.titulo).toBe("Ajustar a quantidade do rolo?");
    expect(a.descricao).toBe("A quantidade do rolo R-001 muda de 10 para 12,5 m. O estoque do lote de origem e o valor da OC são recalculados.");
    expect([a.confirmar, a.cancelar, a.destrutivo]).toEqual(["Ajustar quantidade", "Cancelar", false]);
  });
  it("1.12 Recalcular parcelas", () => {
    const t = textoRecalcularParcelas({ tipoOc: "aviamento", numeroOc: "OC-3" });
    expect(t.titulo).toBe("Recalcular as parcelas desta OC?");
    expect(t.descricao).toBe("As parcelas pagas são preservadas e as demais são regeradas com os valores atuais da OC de Aviamento Nº OC-3. Datas de vencimento ajustadas à mão são mantidas.");
    expect([t.confirmar, t.cancelar, t.destrutivo]).toEqual(["Recalcular", "Cancelar", false]);
  });
});

describe("[camada C2] textos aprovados — Seções 3 e 4", () => {
  it("3 Apagar todos os serviços", () => {
    const t = textoApagarTodosServicos({ n: 3, nome: "BLUSA" });
    expect(t.titulo).toBe("Apagar todos os 3 serviços de “BLUSA”?");
    expect(t.descricao).toBe("Você removeu todos os serviços deste modelo. Ao salvar, os 3 serviços (datas, quantidades, valores e as contas a pagar ligadas a eles) serão apagados. Isso não pode ser desfeito.");
    expect([t.confirmar, t.cancelar, t.destrutivo]).toEqual(["Apagar todos", "Cancelar", true]);
    expect(textoApagarTodosServicos({ n: 3 }).titulo).toBe("Apagar todos os 3 serviços deste modelo?");
  });
  it("3 Apagar todos os itens da OC (tecido / aviamento / insumo)", () => {
    const t = textoApagarTodosItensOc({ familia: "tecido", n: 4, numeroOc: "OC-9" });
    expect(t.titulo).toBe("Apagar todos os 4 itens da OC OC-9?");
    expect(t.descricao).toBe("Você removeu todos os tecidos desta OC. Ao salvar, os 4 itens (quantidades, preços e conferência de CQ) serão apagados e o valor da OC fica zerado. A OC continua existindo, sem itens. Isso não pode ser desfeito.");
    expect(textoApagarTodosItensOc({ familia: "aviamento", n: 2, numeroOc: "OC-3" }).descricao)
      .toBe("Você removeu todos os aviamentos desta OC. Ao salvar, os 2 itens (quantidades e preços) serão apagados e o valor da OC fica zerado. A OC continua existindo, sem itens. Isso não pode ser desfeito.");
    expect(textoApagarTodosItensOc({ familia: "insumo", n: 2, numeroOc: "OC-4" }).descricao)
      .toBe("Você removeu todos os insumos desta OC. Ao salvar, os 2 itens serão apagados e o valor da OC fica zerado. A OC continua existindo, sem itens. Isso não pode ser desfeito.");
    expect(textoApagarTodosItensOc({ familia: "tecido", n: 4 }).titulo).toBe("Apagar todos os 4 itens desta OC?");
    // singular (adaptação mínima: "os 1 itens" não existe)
    expect(textoApagarTodosItensOc({ familia: "tecido", n: 1, numeroOc: "OC-9" }).titulo).toBe("Apagar o único item da OC OC-9?");
    expect(textoApagarTodosServicos({ n: 1, nome: "BLUSA" }).titulo).toBe("Apagar o único serviço de “BLUSA”?");
  });
  it("4 Reprovar peça-teste", () => {
    const t = textoReprovarPecaTeste({ nome: "BLUSA", ref: "R1", empresa: "Oficina X" });
    expect(t.titulo).toBe("Reprovar a peça-teste de “BLUSA”?");
    expect(t.descricao).toBe("O card R1 · Oficina X sai do quadro de Etapas. Para reabrir, abra o modelo em PCP › Serviços, vá em “PLs reprovadas na peça teste” e mude a Aprovação.");
    expect([t.confirmar, t.cancelar, t.destrutivo]).toEqual(["Reprovar", "Cancelar", true]);
    expect(textoReprovarPecaTeste({ nome: "BLUSA", ref: null, empresa: null }).descricao).toBe("O card sai do quadro de Etapas. Para reabrir, abra o modelo em PCP › Serviços, vá em “PLs reprovadas na peça teste” e mude a Aprovação.");
  });
  it("auxiliares", () => {
    expect(dataBr("2026-10-05T10:00:00Z")).toBe("05/10/2026");
    expect(dataBr("lixo")).toBeNull();
    expect(tipoOcFrase("p_acabado")).toBe("OC de Produto Acabado");
    expect(tipoOcFrase("etiqueta")).toBe("OC de Insumo");
  });
});
