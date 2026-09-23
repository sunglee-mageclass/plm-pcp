import { describe, it, expect } from "vitest";
import {
  rotuloConflitoPlan,
  limparCustoSim,
  invalidarAposAprovarMO,
  CAMPOS_DEV_DRAFT,
  textoOuNull,
  aplicarRegrasCamposDev,
  camposParaDuplicar,
} from "@/components/planejamento/planejamento-detail/helpers";
import { emptyDraft, type Draft } from "@/components/planejamento/modelo-shared";

// F3.0 (set/2026) — trava o comportamento dos helpers do detalhe do Planejamento, que saíram de
// dentro de PlanejamentoDetail.tsx. Nada aqui muda regra: é a foto do comportamento de hoje.

describe("rotuloConflitoPlan", () => {
  it("devolve o rótulo PT dos campos conhecidos do Draft", () => {
    expect(rotuloConflitoPlan("nome")).toBe("Nome do Modelo");
    expect(rotuloConflitoPlan("preco_venda")).toBe("Preço para venda");
    expect(rotuloConflitoPlan("custo_simulado")).toBe("Simulação de custo");
    expect(rotuloConflitoPlan("tecidos_planejados")).toBe("Tecido Planejado");
  });
  it("cai no próprio path quando não há rótulo", () => {
    expect(rotuloConflitoPlan("campo_inexistente")).toBe("campo_inexistente");
  });
});

describe("limparCustoSim", () => {
  it("null, undefined e objeto vazio viram null", () => {
    expect(limparCustoSim(null)).toBeNull();
    expect(limparCustoSim(undefined)).toBeNull();
    expect(limparCustoSim({})).toBeNull();
  });
  it("zero, negativo e não-número viram null (tudo null → null)", () => {
    expect(limparCustoSim({ consumo_tecido: 0, aviamento: -1, mao_obra: Number.NaN })).toBeNull();
  });
  it("mantém só valores > 0 e descarta preco_tecido_m", () => {
    expect(limparCustoSim({ consumo_tecido: 1.2, aviamento: 0, mao_obra: 10, preco_tecido_m: 30 }))
      .toEqual({ consumo_tecido: 1.2, aviamento: null, mao_obra: 10 });
  });
  it("aceita número em texto", () => {
    expect(limparCustoSim({ aviamento: "4.5" } as any))
      .toEqual({ consumo_tecido: null, aviamento: 4.5, mao_obra: null });
  });
});

describe("invalidarAposAprovarMO", () => {
  it("invalida exatamente estas 7 queryKeys, nesta ordem", () => {
    const chamadas: unknown[] = [];
    const qc = { invalidateQueries: (o: { queryKey: unknown }) => { chamadas.push(o.queryKey); } };
    invalidarAposAprovarMO(qc as any, "m1");
    expect(chamadas).toEqual([
      ["modelo", "m1"],
      ["mo-resumo", "m1"],
      ["plan-custo-unit", "m1"],
      ["modelos-planejamento"],
      ["mo-resumo-list"],
      ["modelo-mo-resumo"],
      ["modelos-desenvolvimento"],
    ]);
  });
});

// F3.1 — campos vindos do Desenvolvimento + Descrição do produto.
describe("rotuloConflitoPlan — campos da F3.1", () => {
  it("rótulos PT iguais aos do Dev e do mockup", () => {
    expect(rotuloConflitoPlan("ref")).toBe("REF");
    expect(rotuloConflitoPlan("modelista_id")).toBe("Modelista");
    expect(rotuloConflitoPlan("piloteiro1_id")).toBe("Piloteiro 1");
    expect(rotuloConflitoPlan("data_piloto3")).toBe("Data Piloto 3");
    expect(rotuloConflitoPlan("data_desenho_tecnico")).toBe("Data Desenho Técnico");
    expect(rotuloConflitoPlan("data_aprovacao")).toBe("Data Aprovação");
    expect(rotuloConflitoPlan("observacoes_tecnicas")).toBe("Observações Técnicas");
    expect(rotuloConflitoPlan("motivo_cancelamento")).toBe("Motivo do cancelamento");
    expect(rotuloConflitoPlan("ficha_medida_url")).toBe("Ficha de Medida");
    expect(rotuloConflitoPlan("descricao_produto")).toBe("Descrição do produto");
  });
});

describe("CAMPOS_DEV_DRAFT", () => {
  it("toda chave existe no Draft e a etapa NÃO está na lista", () => {
    const d = emptyDraft();
    for (const k of CAMPOS_DEV_DRAFT) expect(d).toHaveProperty(k);
    expect(CAMPOS_DEV_DRAFT).not.toContain("status_desenvolvimento" as never);
    expect(CAMPOS_DEV_DRAFT).toContain("observacoes_gerais");
  });
});

describe("textoOuNull", () => {
  it("vazio/só-espaço/null/undefined → null; texto passa como está", () => {
    expect(textoOuNull("")).toBeNull();
    expect(textoOuNull("   ")).toBeNull();
    expect(textoOuNull(null)).toBeNull();
    expect(textoOuNull(undefined)).toBeNull();
    expect(textoOuNull(" a b ")).toBe(" a b ");
  });
});

describe("aplicarRegrasCamposDev", () => {
  const base = (): Draft => ({
    ...emptyDraft(), nome: "M", ref: " QA1234 ", modelista_id: "m1", data_piloto1: "2026-09-12", data_piloto2: "",
    observacoes_tecnicas: "", motivo_cancelamento: "Motivo", observacoes_gerais: "", ficha_medida_url: "",
  });
  it("com permissão: vazios viram NULL (data vazia daria 22007) e os preenchidos passam", () => {
    const d = base();
    const p = aplicarRegrasCamposDev({ ...d }, d, { podeEditarDev: true, refEditavel: false });
    expect(p.modelista_id).toBe("m1");
    expect(p.piloteiro1_id).toBeNull();
    expect(p.data_piloto1).toBe("2026-09-12");
    expect(p.data_piloto2).toBeNull();
    expect(p.data_desenho_tecnico).toBeNull();
    expect(p.observacoes_tecnicas).toBeNull();
    expect(p.observacoes_gerais).toBeNull();
    expect(p.ficha_medida_url).toBeNull();
    expect(p.motivo_cancelamento).toBe("Motivo"); // nunca apagado por causa da etapa (dono, 23/set)
  });
  it("sem permissão de editar o Dev: nenhum campo do Dev (nem a REF) vai no payload", () => {
    const d = base();
    const p = aplicarRegrasCamposDev({ ...d }, d, { podeEditarDev: false, refEditavel: true });
    for (const k of CAMPOS_DEV_DRAFT) expect(p).not.toHaveProperty(k);
    expect(p).not.toHaveProperty("ref");
    expect(p.nome).toBe("M");
  });
  it("REF só vai quando editável (aparada); vazia vira NULL", () => {
    const d = base();
    expect(aplicarRegrasCamposDev({ ...d }, d, { podeEditarDev: true, refEditavel: true }).ref).toBe("QA1234");
    expect(aplicarRegrasCamposDev({ ...d }, d, { podeEditarDev: true, refEditavel: false })).not.toHaveProperty("ref");
    const v = { ...d, ref: "   " };
    expect(aplicarRegrasCamposDev({ ...v }, v, { podeEditarDev: true, refEditavel: true }).ref).toBeNull();
  });
  it("nunca põe a etapa no payload e não muta a entrada", () => {
    const d = base();
    const entrada: Record<string, unknown> = { ...d };
    const p = aplicarRegrasCamposDev(entrada, d, { podeEditarDev: false, refEditavel: false });
    expect(p).not.toHaveProperty("status_desenvolvimento");
    expect(entrada).toHaveProperty("modelista_id");
    expect(entrada).toHaveProperty("ref");
  });
});

describe("camposParaDuplicar (decisão F3 #9)", () => {
  it("leva Planejamento + tecidos + Obs. Gerais + Descrição; tira REF/versão/base e o resto do Dev", () => {
    const d: Draft = {
      ...emptyDraft(), nome: "M", ref: "QA1", versao: 3, modelo_base_id: "b", tecidos_planejados: ["a1"],
      observacoes_gerais: "og", descricao_produto: "desc", modelista_id: "m1", data_piloto1: "2026-09-12",
      motivo_cancelamento: "x", ficha_medida_url: "f.pdf", observacoes_tecnicas: "ot",
    };
    const p = camposParaDuplicar(d);
    expect(p.nome).toBe("M");
    expect(p.tecidos_planejados).toEqual(["a1"]);
    expect(p.observacoes_gerais).toBe("og");
    expect(p.descricao_produto).toBe("desc");
    for (const k of [
      "ref", "versao", "modelo_base_id", "modelista_id", "piloteiro1_id", "piloteiro2_id", "piloteiro3_id",
      "data_piloto1", "data_piloto2", "data_piloto3", "data_desenho_tecnico", "data_aprovacao",
      "observacoes_tecnicas", "motivo_cancelamento", "ficha_medida_url",
    ]) expect(p).not.toHaveProperty(k);
  });
  it("Descrição só-espaço vira NULL na cópia", () => {
    expect(camposParaDuplicar({ ...emptyDraft(), descricao_produto: "  " }).descricao_produto).toBeNull();
  });
});
