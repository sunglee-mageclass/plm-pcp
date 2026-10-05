// [urg R5] Alertas de atraso de serviço / peça de foto — funções PURAS (hojeISO vem pronto do fuso da loja).
import { describe, it, expect } from "vitest";
import {
  atrasoPorData,
  atrasoServico,
  atrasoPecaFoto,
  atrasosDoProduto,
  piorAtraso,
  textoAtraso,
  type Atraso,
} from "@/lib/servico-atraso";

const HOJE = "2026-10-05";

describe("atrasoPorData", () => {
  it("prevista ontem, sem entregue: atrasado 1 dia", () => {
    const a = atrasoPorData("2026-10-04", null, HOJE);
    expect(a).toEqual({ estado: "atrasado", dias: 1 });
    expect(textoAtraso(a!, "servico")).toBe("Atrasado 1 dia");
  });
  it("prevista hoje: vence hoje (nao atrasado ate o dia seguinte)", () => {
    const a = atrasoPorData("2026-10-05", null, HOJE);
    expect(a).toEqual({ estado: "vence_hoje", dias: 0 });
    expect(textoAtraso(a!, "servico")).toBe("Vence hoje");
  });
  it("prevista amanha ou depois: sem alerta (nao mostra Faltam N dias)", () => {
    expect(atrasoPorData("2026-10-06", null, HOJE)).toBeNull();
    expect(atrasoPorData("2026-12-31", null, HOJE)).toBeNull();
  });
  it("entregue preenchida (mesmo depois da prevista): sem alerta", () => {
    expect(atrasoPorData("2026-10-01", "2026-10-04", HOJE)).toBeNull();
    expect(atrasoPorData("2026-10-05", "2026-10-05", HOJE)).toBeNull();
  });
  it("sem prevista: sem alerta", () => {
    expect(atrasoPorData(null, null, HOJE)).toBeNull();
    expect(atrasoPorData("", null, HOJE)).toBeNull();
  });
  it("entregue string vazia conta como nao entregue", () => {
    expect(atrasoPorData("2026-10-04", "", HOJE)).toEqual({ estado: "atrasado", dias: 1 });
  });
  it("a virada de dia vem de hojeISO (fuso da loja): mesma prevista, outro hoje", () => {
    expect(atrasoPorData("2026-10-05", null, "2026-10-05")?.estado).toBe("vence_hoje");
    expect(atrasoPorData("2026-10-05", null, "2026-10-06")).toEqual({
      estado: "atrasado",
      dias: 1,
    });
  });
  it("atraso atravessa mes", () => {
    expect(atrasoPorData("2026-09-30", null, HOJE)).toEqual({ estado: "atrasado", dias: 5 });
  });
});

describe("atrasoServico", () => {
  it("usa data_prevista / data_entregue", () => {
    expect(atrasoServico({ data_prevista: "2026-10-03", data_entregue: null }, HOJE)).toEqual({
      estado: "atrasado",
      dias: 2,
    });
    expect(
      atrasoServico({ data_prevista: "2026-10-03", data_entregue: "2026-10-04" }, HOJE),
    ).toBeNull();
  });
});

describe("atrasoPecaFoto", () => {
  const base = { peca_foto: true, peca_foto_previsao: "2026-10-02", peca_foto_data: null };
  it("marcada com previsao ha 3 dias e sem data entregue: atrasada 3 dias", () => {
    const a = atrasoPecaFoto(base, HOJE);
    expect(a).toEqual({ estado: "atrasado", dias: 3 });
    expect(textoAtraso(a!, "peca_foto")).toBe("Peça de foto atrasada 3 dias");
  });
  it("peca de foto desmarcada: sem alerta mesmo com previsao vencida", () => {
    expect(atrasoPecaFoto({ ...base, peca_foto: false }, HOJE)).toBeNull();
  });
  it("com data entregue: sem alerta", () => {
    expect(atrasoPecaFoto({ ...base, peca_foto_data: "2026-10-04" }, HOJE)).toBeNull();
  });
  it("sem previsao: sem alerta", () => {
    expect(atrasoPecaFoto({ ...base, peca_foto_previsao: null }, HOJE)).toBeNull();
  });
  it("previsao hoje: Peça de foto vence hoje", () => {
    const a = atrasoPecaFoto({ ...base, peca_foto_previsao: HOJE }, HOJE);
    expect(textoAtraso(a!, "peca_foto")).toBe("Peça de foto vence hoje");
  });
});

describe("piorAtraso", () => {
  const v: Atraso = { estado: "vence_hoje", dias: 0 };
  const a1: Atraso = { estado: "atrasado", dias: 1 };
  const a4: Atraso = { estado: "atrasado", dias: 4 };
  it("atrasado de mais dias > vence hoje > null", () => {
    expect(piorAtraso([null, v, a1, a4, null])).toEqual(a4);
    expect(piorAtraso([v, a1])).toEqual(a1);
    expect(piorAtraso([null, v])).toEqual(v);
    expect(piorAtraso([null, null])).toBeNull();
    expect(piorAtraso([])).toBeNull();
  });
});

describe("textoAtraso", () => {
  it("singular e plural nos dois tipos", () => {
    const a1: NonNullable<Atraso> = { estado: "atrasado", dias: 1 };
    const a2: NonNullable<Atraso> = { estado: "atrasado", dias: 2 };
    const v: NonNullable<Atraso> = { estado: "vence_hoje", dias: 0 };
    expect(textoAtraso(a1, "servico")).toBe("Atrasado 1 dia");
    expect(textoAtraso(a2, "servico")).toBe("Atrasado 2 dias");
    expect(textoAtraso(v, "servico")).toBe("Vence hoje");
    expect(textoAtraso(a1, "peca_foto")).toBe("Peça de foto atrasada 1 dia");
    expect(textoAtraso(a2, "peca_foto")).toBe("Peça de foto atrasada 2 dias");
    expect(textoAtraso(v, "peca_foto")).toBe("Peça de foto vence hoje");
  });
});

describe("atrasosDoProduto (lista do PCP: pior atraso por produto + title)", () => {
  const bloco = (o: Record<string, unknown>) => ({
    interno: false,
    nome: "Costura",
    data_prevista: null,
    data_entregue: null,
    peca_foto: false,
    peca_foto_previsao: null,
    peca_foto_data: null,
    ...o,
  });
  it("sem nenhum atraso: pior null e title vazio", () => {
    const r = atrasosDoProduto([bloco({ data_prevista: "2026-10-09" })], HOJE, true);
    expect(r.pior).toBeNull();
    expect(r.detalhes).toEqual([]);
  });
  it("pior = o de mais dias; detalhes na ordem dos blocos (servico e peca de foto)", () => {
    const r = atrasosDoProduto(
      [
        bloco({
          nome: "PL",
          data_prevista: "2026-10-03",
          peca_foto: true,
          peca_foto_previsao: "2026-10-04",
        }),
        bloco({ nome: "Lavanderia", data_prevista: HOJE }),
      ],
      HOJE,
      true,
    );
    expect(r.pior).toEqual({ estado: "atrasado", dias: 2 });
    expect(r.detalhes).toEqual([
      "PL — Atrasado 2 dias",
      "PL — Peça de foto atrasada 1 dia",
      "Lavanderia — Vence hoje",
    ]);
  });
  it("servico atrasado conta em bloco INTERNO; peca de foto so em bloco PL externo e com etapas_pl", () => {
    const interno = bloco({
      interno: true,
      nome: "Oficina",
      data_prevista: "2026-10-04",
      peca_foto: true,
      peca_foto_previsao: "2026-10-01",
    });
    expect(atrasosDoProduto([interno], HOJE, true).detalhes).toEqual(["Oficina — Atrasado 1 dia"]);
    const pl = bloco({ nome: "PL", peca_foto: true, peca_foto_previsao: "2026-10-01" });
    expect(atrasosDoProduto([pl], HOJE, false).pior).toBeNull(); // sem etapas_pl
    expect(atrasosDoProduto([pl], HOJE, true).detalhes).toEqual([
      "PL — Peça de foto atrasada 4 dias",
    ]);
    const costuraNaoPl = bloco({
      nome: "Costura",
      peca_foto: true,
      peca_foto_previsao: "2026-10-01",
    });
    expect(atrasosDoProduto([costuraNaoPl], HOJE, true).pior).toBeNull(); // categoria nao e PL
  });
});
