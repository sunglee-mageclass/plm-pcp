import { describe, it, expect } from "vitest";
import { seloPorChaves, seloSecaoBom } from "@/components/planejamento/planejamento-detail/ficha/selos-bom";
import {
  dataBR, numerarSecoes, resumoColecao, seloCadSecao, seloObservacoes, seloProva, seloRelacionado, selosSecoesSheet,
  type EntradaSelosSheet, type SecaoSheetKey,
} from "@/components/planejamento/planejamento-detail/ficha/selos-secoes";

// F3.3 — numeração "N." e selos de TODAS as seções do Sheet unificado (adiados da F3.1, §7 T2), por MAPA PRÓPRIO
// (decisão travada 8 — o catálogo e `CondicaoSecao` não mudam). Regras do `reqBadge` e dos selos informativos do Dev.
describe("numerarSecoes", () => {
  it("1..N contínuo na ordem do mockup, pulando as ocultas", () => {
    const v = new Set<SecaoSheetKey>(["info", "colecao", "tecidos", "cad", "preco", "anexos", "relacionado"]);
    expect(numerarSecoes(v)).toEqual({ info: 1, colecao: 2, tecidos: 3, cad: 4, preco: 5, anexos: 6, relacionado: 7 });
  });
  it("Dialog 'Novo Modelo' (mockup gen_novo.py:13-20, R7): só '1. Informações' e '2. Coleção'; Tecidos/Mão de obra/Anexos sem número", () => {
    const v = new Set<SecaoSheetKey>(["info", "colecao", "tecidos_novo", "mao_obra", "anexos"]);
    expect(numerarSecoes(v, { dialogNovo: true })).toEqual({ info: 1, colecao: 2 });
  });
});

describe("seloPorChaves (selos-bom) — regra do reqBadge do Dev para qualquer lista", () => {
  it("sem requisito configurado ⇒ null; todos ok ⇒ 'ok'; falta 1 ⇒ 'falta x' com a condição", () => {
    expect(seloPorChaves(["modelista_definido"], new Set(), {})).toBeNull();
    expect(seloPorChaves(["modelista_definido"], new Set(["modelista_definido"]), { modelista_definido: true })).toEqual({ tone: "ok", texto: "ok" });
    const s = seloPorChaves(["modelista_definido", "data_piloto1"], new Set(["modelista_definido", "data_piloto1"]), { modelista_definido: true });
    expect(s?.texto).toBe("falta data de piloto i preenchida");
    expect(s?.condicaoUnica?.key).toBe("data_piloto1");
  });
  it("seloSecaoBom (F3.2) segue igual", () => {
    expect(seloSecaoBom("grade", new Set(["grade_preenchida"]), { grade_preenchida: true }, { nTecidos: 0, todosBlocosComArtigoTemVariante: true, nAviamentos: 0, nInsumos: 0, gradeTotalGeral: 0 })).toEqual({ tone: "ok", texto: "ok" });
  });
});

describe("selosSecoesSheet", () => {
  const base: EntradaSelosSheet = {
    requeridas: new Set(), satisfeitas: null, podeVerCustos: true,
    infoCompleta: true, colecaoResumo: "Verão 2027 · Casual · lanç. 2 · mar/2027", desenvolvimentoCompleto: false,
    preco: { efetivo: 289.9, markup: 2.91 }, maoObra: { estado: "aprovada", total: 35 },
    anexos: { fotoModelo: true, fotoReferencia: true, desenho: true, croqui: true }, lancamento: { lancado: false, data: "2027-03-15" },
  };
  it("informativos (sem requisito da loja) — mockup gen_main.py", () => {
    const s = selosSecoesSheet(base);
    expect(s.info).toEqual({ tone: "ok", texto: "completa" });
    expect(s.colecao).toEqual({ tone: "muted", texto: "Verão 2027 · Casual · lanç. 2 · mar/2027" });
    expect(s.desenvolvimento).toEqual({ tone: "muted", texto: "faltam dados" });
    expect(s.preco?.texto).toMatch(/^Preço de venda R\$\s?289,90 · markup 2,91×$/);
    expect(s.mao_obra?.texto.startsWith("aprovada · ")).toBe(true);
    expect(s.anexos).toEqual({ tone: "ok", texto: "anexos ok" });
    expect(s.lancamento).toEqual({ tone: "muted", texto: "15/03/2027" });
  });
  it("requisito da loja numa seção vence o informativo (estado SALVO)", () => {
    const s = selosSecoesSheet({ ...base, requeridas: new Set(["data_piloto1"]), satisfeitas: { data_piloto1: false } });
    expect(s.desenvolvimento?.tone).toBe("warn");
    expect(s.desenvolvimento?.texto).toBe("falta data de piloto i preenchida");
  });
  it("condições ainda não carregadas ⇒ só o informativo (nunca 'falta' no escuro)", () => {
    expect(selosSecoesSheet({ ...base, requeridas: new Set(["data_piloto1"]), satisfeitas: null }).desenvolvimento).toEqual({ tone: "muted", texto: "faltam dados" });
  });
  it("invariante #12: sem ver custos, nada em R$ nos selos de Preço e Mão de obra", () => {
    const s = selosSecoesSheet({ ...base, podeVerCustos: false });
    expect(s.preco).toBeUndefined();
    expect(s.mao_obra).toEqual({ tone: "ok", texto: "aprovada" });
  });
  it("estados da mão de obra e do lançamento", () => {
    expect(selosSecoesSheet({ ...base, maoObra: { estado: "sem_servico", total: 0 } }).mao_obra).toEqual({ tone: "muted", texto: "sem serviço" });
    expect(selosSecoesSheet({ ...base, maoObra: { estado: "pendente", total: 10 } }).mao_obra).toEqual({ tone: "warn", texto: "pendente" });
    expect(selosSecoesSheet({ ...base, lancamento: { lancado: true, data: "2027-03-15" } }).lancamento).toEqual({ tone: "ok", texto: "lançado" });
  });
  // Decisão do dono (25/set): são 4 anexos totais (foto do modelo, foto de referência, desenho técnico,
  // croqui — a Ficha de Medida NÃO conta). Substitui a regra antiga de "texto do 1º anexo presente".
  it("anexos: contagem de 4 (0/1/2/4 presentes)", () => {
    expect(selosSecoesSheet({ ...base, anexos: { fotoModelo: false, fotoReferencia: false, desenho: false, croqui: false } }).anexos)
      .toEqual({ tone: "muted", texto: "vazio" });
    const umSo = selosSecoesSheet({ ...base, anexos: { fotoModelo: true, fotoReferencia: false, desenho: false, croqui: false } }).anexos;
    expect(umSo).toEqual({
      tone: "muted", texto: "1 de 4 anexos",
      title: "Tem: foto do modelo · Faltam: foto de referência, desenho técnico, croqui",
    });
    const dois = selosSecoesSheet({ ...base, anexos: { fotoModelo: false, fotoReferencia: true, desenho: true, croqui: false } }).anexos;
    expect(dois).toEqual({
      tone: "muted", texto: "2 de 4 anexos",
      title: "Tem: foto de referência, desenho técnico · Faltam: foto do modelo, croqui",
    });
    expect(selosSecoesSheet({ ...base, anexos: { fotoModelo: true, fotoReferencia: true, desenho: true, croqui: true } }).anexos)
      .toEqual({ tone: "ok", texto: "anexos ok" });
  });
});

describe("selos auxiliares", () => {
  it("CAD: vazio / antes da Ordem / falta X / ok; requisito cad_preenchido vence", () => {
    expect(seloCadSecao({ requeridas: new Set(), satisfeitas: null, linhas: 0, faltas: [], antesDaOrdem: false })).toEqual({ tone: "muted", texto: "vazio" });
    expect(seloCadSecao({ requeridas: new Set(), satisfeitas: null, linhas: 2, faltas: [], antesDaOrdem: true })).toEqual({ tone: "muted", texto: "após a Ordem de Criação" });
    expect(seloCadSecao({ requeridas: new Set(), satisfeitas: null, linhas: 2, faltas: ["metragem planejada"], antesDaOrdem: false }).texto).toBe("falta metragem planejada");
    expect(seloCadSecao({ requeridas: new Set(), satisfeitas: null, linhas: 2, faltas: [], antesDaOrdem: false })).toEqual({ tone: "ok", texto: "ok" });
    expect(seloCadSecao({ requeridas: new Set(["cad_preenchido"]), satisfeitas: { cad_preenchido: true }, linhas: 2, faltas: ["consumo"], antesDaOrdem: false })).toEqual({ tone: "ok", texto: "ok" });
  });
  it("Prova, Observações, Produto Relacionado", () => {
    expect(seloProva(0)).toEqual({ tone: "muted", texto: "sem ajustes" });
    expect(seloProva(2)).toEqual({ tone: "info", texto: "2 abertos" });
    expect(seloObservacoes(1)).toEqual({ tone: "muted", texto: "1 observação" });
    expect(seloObservacoes(0)).toEqual({ tone: "muted", texto: "nenhuma" });
    expect(seloRelacionado(false)).toEqual({ tone: "muted", texto: "nenhum" });
  });
  it("datas e resumo da coleção", () => {
    expect(dataBR("2027-03-15")).toBe("15/03/2027");
    expect(dataBR(null)).toBe("");
    expect(resumoColecao({ colecao: "Verão 2027", subcolecao: null, linha: "Casual", semana: "2", mes: "Março", ano: "2027" })).toBe("Verão 2027 · Casual · lanç. 2 · mar/2027");
    expect(resumoColecao({ colecao: null, subcolecao: null, linha: null, semana: null, mes: null, ano: null })).toBe("");
  });
});
