import { describe, it, expect } from "vitest";
import {
  opcoesOrigem, motivoTrocaOrigem, espelhosDoCard, SEM_ESPELHOS, MOTIVO_EDICAO_PENDENTE, secoesFicha, SECOES_FICHA_INTERNO,
  requeridasPorOrigem, seloGradeComprado, desenvolvimentoCompleto, normalizarGradeComprado, gradeCompradoMudouNoServidor,
  gradesParaBomComprado, linhasGradeComprado,
} from "@/components/planejamento/planejamento-detail/comprado";

// F3.4 — produto COMPRADO (revenda/importado) no Sheet unificado do Planejamento. Decisões F3 #3 (Origem "Importado"),
// #4 (a grade cor × tamanho é a fonte única), #8 (seções pelo "Fluxo de Revenda"), D1 do plano F3.4 (troca de Origem) e as
// ressalvas R3 (nunca dois espelhos — invariante #13) e R7 (edição pendente) do G-plano F3.4.
describe("opcoesOrigem / motivoTrocaOrigem (D1 + R3/R7 do G-plano F3.4)", () => {
  const nenhum = { existe: false, temPedido: false };
  const base = { isEdit: true, salva: "interno", atual: "interno", piOn: true, temTecidos: false, espelhos: SEM_ESPELHOS, edicaoPendente: false };
  it("interno sem tecido: as 3 origens liberadas", () => {
    expect(opcoesOrigem(base).map((o) => [o.value, o.disabled])).toEqual([["interno", false], ["revenda", false], ["importado", false]]);
  });
  it("interno COM tecido no BOM: Revenda e Importado travados, com o motivo", () => {
    const out = opcoesOrigem({ ...base, temTecidos: true });
    expect(out.find((o) => o.value === "revenda")?.disabled).toBe(true);
    expect(out.find((o) => o.value === "importado")?.motivo).toMatch(/^Tire os tecidos/);
    expect(out.find((o) => o.value === "interno")?.disabled).toBe(false);
  });
  it("módulo Produto Importado desligado: 'Importado' não aparece; 'Revenda' segue como hoje (sem regressão)", () => {
    expect(opcoesOrigem({ ...base, piOn: false, espelhos: { acabado: nenhum, importado: null } }).map((o) => [o.value, o.disabled]))
      .toEqual([["interno", false], ["revenda", false]]);
  });
  it("R3 — card JÁ importado com o módulo desligado: a opção aparece (é a atual) e a SAÍDA trava (produto ilegível = indeterminado)", () => {
    const out = opcoesOrigem({ ...base, piOn: false, salva: "importado", atual: "importado", espelhos: { acabado: nenhum, importado: null } });
    expect(out.map((o) => o.value)).toEqual(["interno", "revenda", "importado"]);
    expect(out.find((o) => o.value === "importado")?.disabled).toBe(false);
    expect(out.find((o) => o.value === "revenda")?.motivo).toMatch(/desligado/);
    expect(out.find((o) => o.value === "interno")?.disabled).toBe(true);
  });
  it("R3 — Revenda → Importado com o módulo desligado: travada", () => {
    expect(motivoTrocaOrigem({ de: "revenda", para: "importado", piOn: false, temTecidos: false, espelhos: { acabado: nenhum, importado: null } }))
      .toMatch(/desligado/);
  });
  it("revenda com pedido (OC): a origem não muda mais (D1 (i))", () => {
    const out = opcoesOrigem({ ...base, salva: "revenda", atual: "revenda", espelhos: { acabado: { existe: true, temPedido: true }, importado: nenhum } });
    expect(out.find((o) => o.value === "interno")?.motivo).toMatch(/pedido \(OC\)/);
    expect(out.find((o) => o.value === "revenda")?.disabled).toBe(false);
  });
  it("R3 — revenda com produto e sem pedido: volta p/ interno, mas não vira importado (dois espelhos)", () => {
    const out = opcoesOrigem({ ...base, salva: "revenda", atual: "revenda", espelhos: { acabado: { existe: true, temPedido: false }, importado: nenhum } });
    expect(out.find((o) => o.value === "interno")?.disabled).toBe(false);
    expect(out.find((o) => o.value === "importado")?.motivo).toMatch(/Produto Acabado/);
  });
  it("R3 — interno que JÁ foi comprado (o produto segue vinculado na tela dele) não vira da OUTRA família; da mesma, pode", () => {
    const soPa = { acabado: { existe: true, temPedido: false }, importado: nenhum };
    expect(motivoTrocaOrigem({ de: "interno", para: "importado", piOn: true, temTecidos: false, espelhos: soPa })).toMatch(/Produto Acabado/);
    expect(motivoTrocaOrigem({ de: "interno", para: "revenda", piOn: true, temTecidos: false, espelhos: soPa })).toBeNull();
    const soPi = { acabado: nenhum, importado: { existe: true, temPedido: false } };
    expect(motivoTrocaOrigem({ de: "interno", para: "revenda", piOn: true, temTecidos: false, espelhos: soPi })).toMatch(/Produto Importado/);
    expect(motivoTrocaOrigem({ de: "interno", para: "importado", piOn: true, temTecidos: false, espelhos: soPi })).toBeNull();
  });
  it("R3 — com o módulo desligado, a Revenda de um card interno segue livre (lojas sem Produto Importado não regridem)", () => {
    expect(motivoTrocaOrigem({ de: "interno", para: "revenda", piOn: false, temTecidos: false, espelhos: { acabado: nenhum, importado: null } })).toBeNull();
  });
  it("espelhos ainda carregando (ou com erro): nenhuma troca no escuro", () => {
    expect(motivoTrocaOrigem({ de: "revenda", para: "interno", piOn: true, temTecidos: false, espelhos: null })).toMatch(/Conferindo/);
    expect(motivoTrocaOrigem({ de: "interno", para: "revenda", piOn: true, temTecidos: false, espelhos: null })).toMatch(/Conferindo/);
  });
  it("R7 — edição pendente (ficha tocada ou grade editada): a Origem não muda, em NENHUM sentido, até salvar ou descartar", () => {
    const out = opcoesOrigem({ ...base, salva: "interno", atual: "importado", edicaoPendente: true });
    expect(out.find((o) => o.value === "interno")?.motivo).toBe(MOTIVO_EDICAO_PENDENTE);
    expect(out.find((o) => o.value === "revenda")?.disabled).toBe(true);
    expect(out.find((o) => o.value === "importado")?.disabled).toBe(false); // o valor atual nunca trava
  });
  it("card novo (Dialog): sem regra de troca", () => {
    expect(opcoesOrigem({ ...base, isEdit: false, temTecidos: true, espelhos: null, edicaoPendente: true }).every((o) => !o.disabled)).toBe(true);
  });
});

describe("espelhosDoCard (R3 — invariante #13)", () => {
  it("lê cada família; pedido = alguma OC; importados null = INDETERMINADO (módulo desligado — a RLS esconde as linhas)", () => {
    expect(espelhosDoCard({ acabados: [{ ocs: [{ id: "o" }] }], importados: [] }))
      .toEqual({ acabado: { existe: true, temPedido: true }, importado: { existe: false, temPedido: false } });
    expect(espelhosDoCard({ acabados: [], importados: null }))
      .toEqual({ acabado: { existe: false, temPedido: false }, importado: null });
    expect(espelhosDoCard({ acabados: [{ ocs: null }], importados: [{ ocs: [] }] }))
      .toEqual({ acabado: { existe: true, temPedido: false }, importado: { existe: true, temPedido: false } });
  });
});

describe("secoesFicha (decisões F3 #4/#8)", () => {
  it("interno: tudo, com a grade por variante do Tecido 1 e sem a cor × tamanho", () => {
    expect(secoesFicha(false, () => false)).toEqual(SECOES_FICHA_INTERNO);
    expect(SECOES_FICHA_INTERNO.gradeTecido).toBe(true);
    expect(SECOES_FICHA_INTERNO.gradeComprado).toBe(false);
  });
  it("comprado: pelo Fluxo de Revenda (s2/s3/s3e/s-cad/s4); NUNCA a grade do Tecido 1", () => {
    const cv = (k: string) => ["s3", "s3e", "s4"].includes(k);
    expect(secoesFicha(true, cv)).toEqual({ tecidos: false, aviamentos: true, insumos: true, gradeTecido: false, cad: false, gradeComprado: true, equipe: false });
  });
  it("F3.4 acréscimo — equipe: comprado com s1 escondido ⇒ false", () => {
    expect(secoesFicha(true, () => false).equipe).toBe(false);
  });
  it("F3.4 acréscimo — equipe: comprado com s1 visível ⇒ true", () => {
    expect(secoesFicha(true, (k) => k === "s1").equipe).toBe(true);
  });
});

describe("requeridasPorOrigem", () => {
  it("comprado ignora as condições impossíveis p/ comprado (REVENDA_COND_NA); interno fica igual", () => {
    expect([...requeridasPorOrigem(true, new Set(["grade_preenchida", "tecido_com_variante", "cad_preenchido"]))]).toEqual(["grade_preenchida"]);
    expect([...requeridasPorOrigem(false, new Set(["tecido_com_variante"]))]).toEqual(["tecido_com_variante"]);
  });
});

describe("seloGradeComprado", () => {
  it("requisito grade_preenchida vence; sem requisito ⇒ informativo", () => {
    expect(seloGradeComprado({ requeridas: new Set(["grade_preenchida"]), satisfeitas: { grade_preenchida: true }, totalGeral: 0, nVariantes: 2 })).toEqual({ tone: "ok", texto: "ok" });
    expect(seloGradeComprado({ requeridas: new Set(["grade_preenchida"]), satisfeitas: { grade_preenchida: false }, totalGeral: 0, nVariantes: 2 }).tone).toBe("warn");
    expect(seloGradeComprado({ requeridas: new Set(), satisfeitas: null, totalGeral: 150, nVariantes: 2 })).toEqual({ tone: "ok", texto: "150,00 peças" });
    expect(seloGradeComprado({ requeridas: new Set(), satisfeitas: null, totalGeral: 1, nVariantes: 1 })).toEqual({ tone: "ok", texto: "1,00 peça" });
    // F3.4 acréscimo (fix Lote A) — milhar formatado (o motivo do fix: "1.500 peças", não "1500 peças").
    expect(seloGradeComprado({ requeridas: new Set(), satisfeitas: null, totalGeral: 1500, nVariantes: 2 })).toEqual({ tone: "ok", texto: "1.500,00 peças" });
    expect(seloGradeComprado({ requeridas: new Set(), satisfeitas: null, totalGeral: 0, nVariantes: 2 })).toEqual({ tone: "warn", texto: "falta preencher" });
    expect(seloGradeComprado({ requeridas: new Set(), satisfeitas: null, totalGeral: 0, nVariantes: 0 })).toEqual({ tone: "muted", texto: "sem variantes" });
  });
  it("condições ainda não carregadas ⇒ só o informativo (nunca 'falta' no escuro)", () => {
    expect(seloGradeComprado({ requeridas: new Set(["grade_preenchida"]), satisfeitas: null, totalGeral: 10, nVariantes: 1 })).toEqual({ tone: "ok", texto: "10,00 peças" });
  });
});

describe("desenvolvimentoCompleto", () => {
  it("exige só o que está visível (interno = tudo, o mesmo de antes)", () => {
    const d = { modelista_id: null, piloteiro1_id: null, data_piloto1: "", data_desenho_tecnico: "" };
    expect(desenvolvimentoCompleto(d, () => true)).toBe(false);
    expect(desenvolvimentoCompleto(d, () => false)).toBe(true);
    expect(desenvolvimentoCompleto({ modelista_id: "m", piloteiro1_id: "p", data_piloto1: "2026-09-01", data_desenho_tecnico: "2026-09-01" }, () => true)).toBe(true);
  });
});

describe("grade cor × tamanho do comprado — o que o salvar_modelo_bom recebe (ele APAGA todas)", () => {
  const servidor = [{ variante_numero: 1, grades: { "38|P": 34, "40|M": 33 }, grade_total: 67 }];
  it("editada ⇒ o rascunho; não editada ⇒ o do SERVIDOR (o rascunho é semeado 1× e pode estar velho)", () => {
    const rascunho = [{ variante_numero: 1, grades: { "38|P": 40, "40|M": 33 }, grade_total: 73 }];
    expect(gradesParaBomComprado({ editada: true, rascunho, servidor })).toEqual(rascunho);
    expect(gradesParaBomComprado({ editada: false, rascunho, servidor })).toEqual(servidor);
  });
  it("normalizar ignora linha/célula zerada e a ordem das chaves", () => {
    expect(normalizarGradeComprado({ 2: { "40|M": 1, "38|P": 0 }, 1: { "38|P": 2 }, 3: { "38|P": 0 } }))
      .toBe(normalizarGradeComprado({ 1: { "38|P": 2 }, 2: { "40|M": 1 } }));
  });
  it("mudou no servidor? baseline semeado × linhas atuais (JSON inválido ⇒ mudou)", () => {
    const baseJson = JSON.stringify({ 1: { "38|P": 34, "40|M": 33 } });
    expect(gradeCompradoMudouNoServidor(baseJson, servidor)).toBe(false);
    expect(gradeCompradoMudouNoServidor(baseJson, [{ variante_numero: 1, grades: { "38|P": 35, "40|M": 33 }, grade_total: 68 }])).toBe(true);
    expect(gradeCompradoMudouNoServidor("não é json", servidor)).toBe(true);
  });
  it("F3.4 acréscimo (fix Lote A) — baseline SINTATICAMENTE válido mas não-objeto ⇒ mudou (conservador)", () => {
    expect(gradeCompradoMudouNoServidor("null", servidor)).toBe(true);
    expect(gradeCompradoMudouNoServidor("42", servidor)).toBe(true);
    expect(gradeCompradoMudouNoServidor('"texto"', servidor)).toBe(true);
    expect(gradeCompradoMudouNoServidor("[1,2,3]", servidor)).toBe(true);
  });
  it("linhas: total = soma das células (mesma conta do antigo buildLinhasGradeRevenda)", () => {
    expect(linhasGradeComprado({ 1: { "38|P": 2, "40|M": 3 } })).toEqual([{ variante_numero: 1, grades: { "38|P": 2, "40|M": 3 }, grade_total: 5 }]);
  });
});
