import { describe, it, expect } from "vitest";
import { seloPorChaves, seloSecaoBom } from "@/components/planejamento/planejamento-detail/ficha/selos-bom";
import {
  CONDICOES_SECAO_SHEET, dataBR, numerarSecoes, resumoColecao, seloCadSecao, seloObservacoes, seloProva, seloRelacionado, selosSecoesSheet,
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
    const v = new Set<SecaoSheetKey>(["info", "colecao", "tecidos_novo", "mao_obra_novo", "anexos"]);
    expect(numerarSecoes(v, { dialogNovo: true })).toEqual({ info: 1, colecao: 2 });
  });
  it("F3.6 — numeração final da spec §5.1 (1–15): Códigos = 4, Preço e Custos = 11, sem Mão de obra", () => {
    const v = new Set<SecaoSheetKey>([
      "info", "colecao", "desenvolvimento", "codigos", "prova", "tecidos", "aviamentos", "insumos", "grade", "cad",
      "preco", "anexos", "observacoes", "lancamento", "relacionado",
    ]);
    expect(numerarSecoes(v)).toEqual({
      info: 1, colecao: 2, desenvolvimento: 3, codigos: 4, prova: 5, tecidos: 6, aviamentos: 7, insumos: 8, grade: 9, cad: 10,
      preco: 11, anexos: 12, observacoes: 13, lancamento: 14, relacionado: 15,
    });
  });
  it("sem 'codigos' visível, tudo depois do 3 recua 1 (a numeração segue o que está na tela)", () => {
    const v = new Set<SecaoSheetKey>(["info", "colecao", "desenvolvimento", "prova", "preco", "relacionado"]);
    expect(numerarSecoes(v)).toEqual({ info: 1, colecao: 2, desenvolvimento: 3, prova: 4, preco: 5, relacionado: 6 });
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
  it("seloSecaoBom (F3.2) segue igual — requisito satisfeito numa seção NÃO vazia", () => {
    expect(seloSecaoBom("grade", new Set(["grade_preenchida"]), { grade_preenchida: true }, { nTecidos: 0, todosBlocosComArtigoTemVariante: true, nAviamentos: 0, nInsumos: 0, gradeTotalGeral: 5 })).toEqual({ tone: "ok", texto: "ok" });
  });
  it("seloSecaoBom — requisito satisfeito numa seção VAZIA (gradeTotalGeral===0) ⇒ sem selo (pedido do dono 25/set)", () => {
    expect(seloSecaoBom("grade", new Set(["grade_preenchida"]), { grade_preenchida: true }, { nTecidos: 0, todosBlocosComArtigoTemVariante: true, nAviamentos: 0, nInsumos: 0, gradeTotalGeral: 0 })).toBeUndefined();
  });
});

// Decisão do dono (25/set): seção sem NADA preenchido não mostra selo nenhum — exceto o aviso âmbar "falta …" de
// um requisito do kanban daquela seção (`seloDeSecao`, selos-bom.ts). Os `expect` marcados MUDOU abaixo antes
// esperavam um selo cinza ("faltam dados"/"vazio"/"sem serviço"/"sem data") para seção VAZIA; agora esperam
// `undefined`.
describe("selosSecoesSheet", () => {
  const base: EntradaSelosSheet = {
    requeridas: new Set(), satisfeitas: null, podeVerCustos: true,
    infoCompleta: true, infoVazia: false, colecaoResumo: "Verão 2027 · Casual · lanç. 2 · mar/2027",
    desenvolvimentoCompleto: false, desenvolvimentoVazia: true,
    preco: { efetivo: 289.9, markup: 2.91 }, maoObraAviso: null,
    anexos: { fotoModelo: true, fotoReferencia: true, desenho: true, croqui: true }, lancamento: { lancado: false, data: "2027-03-15" },
  };
  it("informativos (sem requisito da loja) — mockup gen_main.py", () => {
    const s = selosSecoesSheet(base);
    expect(s.info).toEqual({ tone: "ok", texto: "completa" });
    expect(s.colecao).toEqual({ tone: "muted", texto: "Verão 2027 · Casual · lanç. 2 · mar/2027" });
    // MUDOU: era { tone: "muted", texto: "faltam dados" } — `base.desenvolvimentoVazia=true` (nenhum campo da
    // equipe/cronograma preenchido) e sem requisito do kanban ⇒ sem selo.
    expect(s.desenvolvimento).toBeUndefined();
    expect(s.preco?.texto).toMatch(/^Preço de venda R\$\s?289,90 · markup 2,91×$/);
    expect(s.anexos).toEqual({ tone: "ok", texto: "anexos ok" });
    expect(s.lancamento).toEqual({ tone: "muted", texto: "15/03/2027" });
  });
  it("Desenvolvimento com dado preenchido mas incompleto (não vazio) → volta o informativo 'faltam dados'", () => {
    const s = selosSecoesSheet({ ...base, desenvolvimentoVazia: false });
    expect(s.desenvolvimento).toEqual({ tone: "muted", texto: "faltam dados" });
  });
  it("requisito da loja numa seção vazia NÃO satisfeito → mantém o aviso âmbar 'falta …'", () => {
    const s = selosSecoesSheet({ ...base, requeridas: new Set(["data_piloto1"]), satisfeitas: { data_piloto1: false } });
    expect(s.desenvolvimento?.tone).toBe("warn");
    expect(s.desenvolvimento?.texto).toBe("falta data de piloto i preenchida");
  });
  it("requisito da loja SATISFEITO numa seção vazia → sem selo (não é mais 'ok' vácuo — pedido do dono)", () => {
    const s = selosSecoesSheet({ ...base, requeridas: new Set(["data_piloto1"]), satisfeitas: { data_piloto1: true } });
    // MUDOU: era { tone: "ok", texto: "ok" } — o requisito vacuamente satisfeito numa seção sem NADA preenchido
    // não deve mais acender "ok".
    expect(s.desenvolvimento).toBeUndefined();
  });
  it("condições ainda não carregadas ⇒ seção vazia sem selo (nunca 'falta' no escuro)", () => {
    // MUDOU: era { tone: "muted", texto: "faltam dados" }.
    expect(selosSecoesSheet({ ...base, requeridas: new Set(["data_piloto1"]), satisfeitas: null }).desenvolvimento).toBeUndefined();
  });
  it("invariante #12: sem ver custos, nada em R$ no selo de Preço", () => {
    expect(selosSecoesSheet({ ...base, podeVerCustos: false }).preco).toBeUndefined();
  });
  it("estado do lançamento", () => {
    expect(selosSecoesSheet({ ...base, lancamento: { lancado: true, data: "2027-03-15" } }).lancamento).toEqual({ tone: "ok", texto: "lançado" });
  });
  it("lançamento vazio (não lançado e sem data) sem requisito ⇒ sem selo", () => {
    // MUDOU: era { tone: "muted", texto: "sem data" }.
    expect(selosSecoesSheet({ ...base, lancamento: { lancado: false, data: null } }).lancamento).toBeUndefined();
  });
  // Decisão do dono (25/set): são 4 anexos totais (foto do modelo, foto de referência, desenho técnico,
  // croqui — a Ficha de Medida NÃO conta). Substitui a regra antiga de "texto do 1º anexo presente".
  it("anexos: contagem de 4 (0/1/2/4 presentes)", () => {
    // MUDOU: era { tone: "muted", texto: "vazio" } — 0 de 4 anexos, sem requisito ⇒ sem selo.
    expect(selosSecoesSheet({ ...base, anexos: { fotoModelo: false, fotoReferencia: false, desenho: false, croqui: false } }).anexos)
      .toBeUndefined();
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
  it("anexos 0 de 4 com requisito do kanban NÃO satisfeito → mantém o aviso âmbar", () => {
    const s = selosSecoesSheet({
      ...base, anexos: { fotoModelo: false, fotoReferencia: false, desenho: false, croqui: false },
      requeridas: new Set(["anexo_croqui"]), satisfeitas: { anexo_croqui: false },
    });
    expect(s.anexos?.tone).toBe("warn");
  });
});

describe("selos auxiliares", () => {
  it("CAD: vazio (linhas===0) sem requisito ⇒ sem selo; com requisito NÃO satisfeito ⇒ aviso âmbar", () => {
    // MUDOU: era { tone: "muted", texto: "vazio" } — CAD vazio (linhas===0), sem requisito ⇒ sem selo.
    expect(seloCadSecao({ requeridas: new Set(), satisfeitas: null, linhas: 0, faltas: [], antesDaOrdem: false })).toBeUndefined();
    const s = seloCadSecao({ requeridas: new Set(["cad_preenchido"]), satisfeitas: { cad_preenchido: false }, linhas: 0, faltas: [], antesDaOrdem: false });
    expect(s?.tone).toBe("warn");
  });
  it("CAD não vazio: antes da Ordem / falta X / ok; requisito cad_preenchido vence", () => {
    expect(seloCadSecao({ requeridas: new Set(), satisfeitas: null, linhas: 2, faltas: [], antesDaOrdem: true })).toEqual({ tone: "muted", texto: "após a Ordem de Criação" });
    expect(seloCadSecao({ requeridas: new Set(), satisfeitas: null, linhas: 2, faltas: ["metragem planejada"], antesDaOrdem: false })?.texto).toBe("falta metragem planejada");
    expect(seloCadSecao({ requeridas: new Set(), satisfeitas: null, linhas: 2, faltas: [], antesDaOrdem: false })).toEqual({ tone: "ok", texto: "ok" });
    expect(seloCadSecao({ requeridas: new Set(["cad_preenchido"]), satisfeitas: { cad_preenchido: true }, linhas: 2, faltas: ["consumo"], antesDaOrdem: false })).toEqual({ tone: "ok", texto: "ok" });
  });
  it("Prova, Observações, Produto Relacionado — decisão do dono 25/set: vazio (0/sem conjunto) ⇒ sem selo (não têm requisito de kanban nessas seções)", () => {
    // MUDOU: era { tone: "muted", texto: "sem ajustes" }.
    expect(seloProva(0)).toBeUndefined();
    expect(seloProva(2)).toEqual({ tone: "info", texto: "2 abertos" });
    expect(seloObservacoes(1)).toEqual({ tone: "muted", texto: "1 observação" });
    // MUDOU: era { tone: "muted", texto: "nenhuma" }.
    expect(seloObservacoes(0)).toBeUndefined();
    // MUDOU: era { tone: "muted", texto: "nenhum" }.
    expect(seloRelacionado(false)).toBeUndefined();
  });
  it("datas e resumo da coleção", () => {
    expect(dataBR("2027-03-15")).toBe("15/03/2027");
    expect(dataBR(null)).toBe("");
    expect(resumoColecao({ colecao: "Verão 2027", subcolecao: null, linha: "Casual", semana: "2", mes: "Março", ano: "2027" })).toBe("Verão 2027 · Casual · lanç. 2 · mar/2027");
    expect(resumoColecao({ colecao: null, subcolecao: null, linha: null, semana: null, mes: null, ano: null })).toBe("");
  });
});

describe("selosSecoesSheet — F3.6: requisitos de Mão de obra no selo de Preço e Custos (Ruling R15)", () => {
  const base: EntradaSelosSheet = {
    requeridas: new Set(), satisfeitas: null, podeVerCustos: true,
    infoCompleta: true, infoVazia: false, colecaoResumo: "",
    desenvolvimentoCompleto: false, desenvolvimentoVazia: true,
    preco: { efetivo: 289.9, markup: 2.91 }, maoObraAviso: null,
    anexos: { fotoModelo: false, fotoReferencia: false, desenho: false, croqui: false }, lancamento: { lancado: false, data: null },
  };
  it("CONDICOES_SECAO_SHEET.preco = preço + as 3 chaves de MO; a chave mao_obra não existe mais", () => {
    expect(CONDICOES_SECAO_SHEET.preco).toEqual(["preco_venda_preenchido", "servico_aprovado", "servico_mo_decidido", "servico_mo_preenchido"]);
    expect(Object.keys(CONDICOES_SECAO_SHEET)).not.toContain("mao_obra");
  });
  it("preço preenchido + UMA condição de MO pendente ⇒ selo de Preço âmbar com a condição", () => {
    const s = selosSecoesSheet({
      ...base, requeridas: new Set(["preco_venda_preenchido", "servico_mo_decidido"]),
      satisfeitas: { preco_venda_preenchido: true, servico_mo_decidido: false },
    });
    expect(s.preco?.tone).toBe("warn");
    expect(s.preco?.condicaoUnica?.key).toBe("servico_mo_decidido");
  });
  it("preço vazio + requisito de MO NÃO satisfeito ⇒ mantém o âmbar; satisfeito ⇒ sem selo", () => {
    const vazio = { ...base, preco: { efetivo: 0, markup: 0 } };
    expect(selosSecoesSheet({ ...vazio, requeridas: new Set(["servico_aprovado"]), satisfeitas: { servico_aprovado: false } }).preco?.tone).toBe("warn");
    expect(selosSecoesSheet({ ...vazio, requeridas: new Set(["servico_aprovado"]), satisfeitas: { servico_aprovado: true } }).preco).toBeUndefined();
  });
  it("não existe mais selo 'mao_obra'", () => {
    expect(Object.keys(selosSecoesSheet(base))).not.toContain("mao_obra");
  });
  it("R15 (item 13) — MO pendente/reprovada com a seção FECHADA: âmbar no Preço mesmo SEM requisito (interno e comprado)", () => {
    expect(selosSecoesSheet({ ...base, maoObraAviso: "pendente" }).preco).toEqual({ tone: "warn", texto: "MO pendente" });
    expect(selosSecoesSheet({ ...base, maoObraAviso: "reprovada" }).preco).toEqual({ tone: "warn", texto: "MO reprovada" });
    // sem preço (seção 'vazia' de preço) o aviso de MO continua
    expect(selosSecoesSheet({ ...base, preco: { efetivo: 0, markup: 0 }, maoObraAviso: "pendente" }).preco?.texto).toBe("MO pendente");
    // requisito do kanban não satisfeito VENCE o aviso
    const s = selosSecoesSheet({
      ...base, maoObraAviso: "pendente", requeridas: new Set(["servico_aprovado"]), satisfeitas: { servico_aprovado: false },
    });
    expect(s.preco?.condicaoUnica?.key).toBe("servico_aprovado");
  });
  // RODADA DE CORREÇÃO 1 (I1) — um requisito do kanban CUMPRIDO não pode mais esconder o aviso de MO.
  it("(a) preco_venda_preenchido cumprido + MO pendente ⇒ aviso pendente", () => {
    const s = selosSecoesSheet({
      ...base, maoObraAviso: "pendente",
      requeridas: new Set(["preco_venda_preenchido"]), satisfeitas: { preco_venda_preenchido: true },
    });
    expect(s.preco).toEqual({ tone: "warn", texto: "MO pendente" });
  });
  it("(b) servico_mo_decidido cumprido + MO reprovada ⇒ aviso reprovada", () => {
    const s = selosSecoesSheet({
      ...base, maoObraAviso: "reprovada",
      requeridas: new Set(["servico_mo_decidido"]), satisfeitas: { servico_mo_decidido: true },
    });
    expect(s.preco).toEqual({ tone: "warn", texto: "MO reprovada" });
  });
  it("(c) requisito NÃO cumprido + MO pendente ⇒ o requisito (warn)", () => {
    const s = selosSecoesSheet({
      ...base, maoObraAviso: "pendente",
      requeridas: new Set(["preco_venda_preenchido"]), satisfeitas: { preco_venda_preenchido: false },
    });
    expect(s.preco?.tone).toBe("warn");
    expect(s.preco?.condicaoUnica?.key).toBe("preco_venda_preenchido");
  });
  it("(d) sem aviso de MO ⇒ o selo normal", () => {
    // sem requisito configurado nesta seção (`r("preco")` null): o selo normal é o informativo de preço.
    const s = selosSecoesSheet({ ...base, maoObraAviso: null });
    expect(s.preco?.texto).toMatch(/^Preço de venda/);
    expect(s.preco?.tone).not.toBe("warn");
  });
});
