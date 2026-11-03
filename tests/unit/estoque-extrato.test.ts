import { describe, it, expect } from "vitest";
import {
  ORIGEM_ROTULO,
  filtrarBucket,
  montarExtrato,
  movDeLinhaRpc,
  rotuloOrigem,
  textoReferencia,
  type MovEstoque,
} from "../../src/lib/estoque-extrato";

const FUSO = "America/Sao_Paulo";

let seq = 0;
/** movimento mínimo; defaults = bucket único, core coerente (sobrescreva por caso). */
function mov(p: Partial<MovEstoque>): MovEstoque {
  seq += 1;
  return {
    bucketVarianteId: "v1",
    bucketTamanho: null,
    bucketCorId: null,
    bucketCorNome: null,
    quando: "2026-09-10T15:00:00Z",
    quandoFonte: "registro",
    tipo: "entrada",
    origem: "oc",
    quantidade: 10,
    quem: null,
    refOc: null,
    refModelo: null,
    refId: `id-${seq}`,
    detalhe: null,
    coreRecebido: 0,
    coreBaixa: 0,
    coreFisico: 0,
    ...p,
  };
}

/** aplica o mesmo core (recebido/baixa/fisico) a todas as linhas. */
function comCore(movs: MovEstoque[], core: { recebido: number; baixa: number; fisico: number }): MovEstoque[] {
  return movs.map((m) => ({ ...m, coreRecebido: core.recebido, coreBaixa: core.baixa, coreFisico: core.fisico }));
}

describe("ORIGEM_ROTULO", () => {
  it("tem os 12 rótulos PT-BR (10 do plano + 2 da peça teste, R11)", () => {
    expect(ORIGEM_ROTULO).toEqual({
      oc: "Recebimento de OC",
      reposicao_troca: "Reposição de troca",
      rolo_entrada: "Rolo (entrada)",
      separacao_rolo: "Separação de rolo",
      corte: "Corte (Explosão)",
      ajuste: "Ajuste (- Metragem)",
      os: "Ordem de saída",
      explosao: "Envio à Explosão",
      explosao_ajuste: "Ajuste depois do envio",
      revenda: "Revenda (peças recebidas)",
      peca_teste: "Peça teste",
      peca_teste_estorno: "Peça teste (estorno)",
    });
  });

  it("R11: baixa e estorno da peça teste entram no extrato como linhas próprias e o saldo fecha com o físico", () => {
    expect(rotuloOrigem("peca_teste")).toBe("Peça teste");
    expect(rotuloOrigem("peca_teste_estorno")).toBe("Peça teste (estorno)");
    const movs = comCore(
      [
        mov({ refId: "e", quando: "2026-09-01T12:00:00Z", tipo: "entrada", origem: "oc", quantidade: 100 }),
        mov({ refId: "b", quando: "2026-09-02T12:00:00Z", tipo: "saida", origem: "peca_teste", quantidade: -6, refModelo: "VE00000123", detalhe: "VE00000123 · tentativa 1 · PL · saída 02/09/2026" }),
        mov({ refId: "x", quando: "2026-09-03T12:00:00Z", tipo: "entrada", origem: "peca_teste_estorno", quantidade: 6, refModelo: "VE00000123", detalhe: "estorno" }),
      ],
      { recebido: 100, baixa: 0, fisico: 100 },
    );
    const ext = montarExtrato(movs, { fuso: FUSO });
    expect(ext.linhas.map((l) => [l.origem, l.refModelo, l.saldo])).toEqual([
      ["oc", null, 100],
      ["peca_teste", "VE00000123", 94],
      ["peca_teste_estorno", "VE00000123", 100],
    ]);
    expect(ext.confere).toBe(true);
  });
});

describe("montarExtrato — ordem", () => {
  it("sem data PRIMEIRO, depois quando crescente", () => {
    const movs = [
      mov({ refId: "c", quando: "2026-09-12T10:00:00Z", quantidade: 1 }),
      mov({ refId: "sd", quando: null, quandoFonte: "sem_data", quantidade: 5 }),
      mov({ refId: "a", quando: "2026-09-01T10:00:00Z", quantidade: 2 }),
      mov({ refId: "b", quando: "2026-09-05T10:00:00Z", quantidade: 3 }),
    ];
    const r = montarExtrato(movs, { fuso: FUSO });
    expect(r.linhas.map((l) => l.refId)).toEqual(["sd", "a", "b", "c"]);
  });

  it("empate de horário: entrada antes de saída; depois refOc, refModelo", () => {
    const t = "2026-09-10T15:00:00Z";
    const movs = [
      mov({ refId: "s1", quando: t, tipo: "saida", quantidade: -2, refOc: "OC-1" }),
      mov({ refId: "e2", quando: t, tipo: "entrada", quantidade: 4, refOc: "OC-2" }),
      mov({ refId: "e1", quando: t, tipo: "entrada", quantidade: 4, refOc: "OC-1", refModelo: "B" }),
      mov({ refId: "e0", quando: t, tipo: "entrada", quantidade: 4, refOc: "OC-1", refModelo: "A" }),
    ];
    const r = montarExtrato(movs, { fuso: FUSO });
    expect(r.linhas.map((l) => l.refId)).toEqual(["e0", "e1", "e2", "s1"]);
  });

  it("empate total mantém a ordem de entrada (estável) e não muta o array recebido", () => {
    const t = "2026-09-10T15:00:00Z";
    const movs = [mov({ refId: "x", quando: t }), mov({ refId: "y", quando: t }), mov({ refId: "z", quando: t })];
    const copia = movs.map((m) => m.refId);
    const r = montarExtrato(movs, { fuso: FUSO });
    expect(r.linhas.map((l) => l.refId)).toEqual(["x", "y", "z"]);
    expect(movs.map((m) => m.refId)).toEqual(copia);
  });
});

describe("montarExtrato — saldo corrente", () => {
  const base = comCore(
    [
      mov({ refId: "e1", quando: "2026-09-01T12:00:00Z", quantidade: 100 }),
      mov({ refId: "s1", quando: "2026-09-02T12:00:00Z", tipo: "saida", origem: "corte", quantidade: -30 }),
      mov({ refId: "e2", quando: "2026-09-03T12:00:00Z", quantidade: 50 }),
      mov({ refId: "s2", quando: "2026-09-04T12:00:00Z", tipo: "saida", origem: "ajuste", quantidade: -20 }),
    ],
    { recebido: 150, baixa: 50, fisico: 100 },
  );

  it("saldo linha a linha, saldoFinal, fisicoTela, confere", () => {
    const r = montarExtrato(base, { fuso: FUSO });
    expect(r.linhas.map((l) => l.saldo)).toEqual([100, 70, 120, 100]);
    expect(r.saldoFinal).toBe(100);
    expect(r.fisicoTela).toBe(100);
    expect(r.confere).toBe(true);
    expect(r.negativo).toBe(false);
    expect(r.saldoAnterior).toBeNull();
  });

  it("sem ponto flutuante: 0,1 + 0,2 fecha em 0,3", () => {
    const movs = comCore(
      [
        mov({ refId: "a", quando: "2026-09-01T12:00:00Z", quantidade: 0.1 }),
        mov({ refId: "b", quando: "2026-09-02T12:00:00Z", quantidade: 0.2 }),
      ],
      { recebido: 0.3, baixa: 0, fisico: 0.3 },
    );
    const r = montarExtrato(movs, { fuso: FUSO });
    expect(r.saldoFinal).toBe(0.3);
    expect(r.linhas[1].saldo).toBe(0.3);
    expect(r.confere).toBe(true);
  });

  it("não confere quando Σ difere do core (tolerância 0,005)", () => {
    const movs = comCore([mov({ quantidade: 10 })], { recebido: 10.01, baixa: 0, fisico: 10.01 });
    expect(montarExtrato(movs, { fuso: FUSO }).confere).toBe(false);
    const ok = comCore([mov({ quantidade: 10 })], { recebido: 10.004, baixa: 0, fisico: 10.004 });
    expect(montarExtrato(ok, { fuso: FUSO }).confere).toBe(true);
  });

  it("saldo negativo: negativo=true, saldoFinal fica negativo e fisicoTela vem do core (clampado)", () => {
    const movs = comCore(
      [
        mov({ refId: "e", quando: "2026-09-01T12:00:00Z", quantidade: 10 }),
        mov({ refId: "s", quando: "2026-09-02T12:00:00Z", tipo: "saida", origem: "corte", quantidade: -15 }),
      ],
      { recebido: 10, baixa: 15, fisico: 0 },
    );
    const r = montarExtrato(movs, { fuso: FUSO });
    expect(r.saldoFinal).toBe(-5);
    expect(r.negativo).toBe(true);
    expect(r.fisicoTela).toBe(0);
    expect(r.confere).toBe(true);
  });

  it("separação de rolo: 2 linhas na mesma variante somam 0", () => {
    const movs = comCore(
      [
        mov({ refId: "ent", quando: "2026-09-01T12:00:00Z", quantidade: 40 }),
        mov({ refId: "sep-", quando: "2026-09-02T12:00:00Z", tipo: "saida", origem: "separacao_rolo", quantidade: -10 }),
        mov({ refId: "sep+", quando: "2026-09-02T12:00:00Z", tipo: "entrada", origem: "rolo_entrada", quantidade: 10 }),
      ],
      { recebido: 50, baixa: 10, fisico: 40 },
    );
    const r = montarExtrato(movs, { fuso: FUSO });
    // empate: entrada antes de saída
    expect(r.linhas.map((l) => l.refId)).toEqual(["ent", "sep+", "sep-"]);
    expect(r.saldoFinal).toBe(40);
  });

  it("sem movimentos: tudo zero e confere", () => {
    const r = montarExtrato([], { fuso: FUSO });
    expect(r).toEqual({ linhas: [], saldoAnterior: null, saldoFinal: 0, fisicoTela: 0, confere: true, negativo: false });
  });

  it("aceita quantidade/core como string numérica (numeric do Postgres)", () => {
    const m = mov({ quantidade: "12.5" as unknown as number, coreRecebido: "12.5" as unknown as number, coreBaixa: "0" as unknown as number, coreFisico: "12.5" as unknown as number });
    const r = montarExtrato([m], { fuso: FUSO });
    expect(r.saldoFinal).toBe(12.5);
    expect(r.confere).toBe(true);
    expect(r.fisicoTela).toBe(12.5);
  });
});

describe("montarExtrato — filtros", () => {
  const movs = comCore(
    [
      mov({ refId: "sd", quando: null, quandoFonte: "sem_data", quantidade: 20 }),
      mov({ refId: "e1", quando: "2026-09-01T12:00:00Z", quantidade: 100 }),
      mov({ refId: "s1", quando: "2026-09-05T12:00:00Z", tipo: "saida", origem: "corte", quantidade: -30 }),
      mov({ refId: "s2", quando: "2026-09-10T12:00:00Z", tipo: "saida", origem: "ajuste", quantidade: -10 }),
      mov({ refId: "e2", quando: "2026-09-15T12:00:00Z", quantidade: 5 }),
    ],
    { recebido: 125, baixa: 40, fisico: 85 },
  );

  it("filtro de origem só esconde: saldo das linhas visíveis é o do extrato completo", () => {
    const r = montarExtrato(movs, { fuso: FUSO, origens: ["corte"] });
    expect(r.linhas).toHaveLength(1);
    expect(r.linhas[0].refId).toBe("s1");
    expect(r.linhas[0].saldo).toBe(90); // 20 + 100 - 30, não -30
    expect(r.saldoFinal).toBe(85);
    expect(r.confere).toBe(true);
  });

  it("origens vazio = sem filtro", () => {
    expect(montarExtrato(movs, { fuso: FUSO, origens: [] }).linhas).toHaveLength(5);
  });

  it("período: saldoAnterior = saldo antes do 'de' (sem data conta como anterior)", () => {
    const r = montarExtrato(movs, { fuso: FUSO, de: "2026-09-05", ate: "2026-09-10" });
    expect(r.saldoAnterior).toBe(120); // sem-data 20 + e1 100
    expect(r.linhas.map((l) => l.refId)).toEqual(["s1", "s2"]);
    expect(r.linhas.map((l) => l.saldo)).toEqual([90, 80]);
    expect(r.saldoFinal).toBe(85); // todas, não só o período
  });

  it("'ate' inclui o dia inteiro; só 'ate' => saldoAnterior null e sem-data fica visível", () => {
    const r = montarExtrato(movs, { fuso: FUSO, ate: "2026-09-05" });
    expect(r.saldoAnterior).toBeNull();
    expect(r.linhas.map((l) => l.refId)).toEqual(["sd", "e1", "s1"]);
  });

  it("com 'de', linha sem data é escondida (conta no saldo anterior)", () => {
    const r = montarExtrato(movs, { fuso: FUSO, de: "2026-09-01" });
    expect(r.linhas.map((l) => l.refId)).toEqual(["e1", "s1", "s2", "e2"]);
    expect(r.saldoAnterior).toBe(20);
  });

  it("período + origem juntos", () => {
    const r = montarExtrato(movs, { fuso: FUSO, de: "2026-09-02", origens: ["ajuste", "oc"] });
    expect(r.linhas.map((l) => l.refId)).toEqual(["s2", "e2"]);
    expect(r.linhas.map((l) => l.saldo)).toEqual([80, 85]);
    expect(r.saldoAnterior).toBe(120);
  });

  it("dia é calculado no fuso da loja: 01:30Z de 11/set é 10/set em São Paulo", () => {
    const m = comCore([mov({ refId: "t", quando: "2026-09-11T01:30:00Z", quantidade: 7 })], { recebido: 7, baixa: 0, fisico: 7 });
    expect(montarExtrato(m, { fuso: "America/Sao_Paulo", de: "2026-09-10", ate: "2026-09-10" }).linhas).toHaveLength(1);
    expect(montarExtrato(m, { fuso: "UTC", de: "2026-09-10", ate: "2026-09-10" }).linhas).toHaveLength(0);
    expect(montarExtrato(m, { fuso: "UTC", de: "2026-09-11", ate: "2026-09-11" }).linhas).toHaveLength(1);
  });

  it("de/ate como Date: usa o dia desse instante no fuso da loja", () => {
    const m = comCore([mov({ refId: "t", quando: "2026-09-10T15:00:00Z", quantidade: 7 })], { recebido: 7, baixa: 0, fisico: 7 });
    const de = new Date("2026-09-10T12:00:00Z");
    const ate = new Date("2026-09-10T20:00:00Z");
    expect(montarExtrato(m, { fuso: FUSO, de, ate }).linhas).toHaveLength(1);
    expect(montarExtrato(m, { fuso: FUSO, de: new Date("2026-09-11T12:00:00Z") }).linhas).toHaveLength(0);
  });
});

describe("filtrarBucket", () => {
  const tecidoA = mov({ bucketVarianteId: "vA" });
  const tecidoB = mov({ bucketVarianteId: "vB" });

  it("tecido: pela variante", () => {
    expect(filtrarBucket([tecidoA, tecidoB], { varianteId: "vA" }, "tecido")).toEqual([tecidoA]);
  });

  it("aviamento: pela variante; 'Sem variante' (null/undefined) pega só bucket NULL", () => {
    const sem = mov({ bucketVarianteId: null });
    const movs = [tecidoA, sem, tecidoB];
    expect(filtrarBucket(movs, { varianteId: "vB" }, "aviamento")).toEqual([tecidoB]);
    expect(filtrarBucket(movs, { varianteId: null }, "aviamento")).toEqual([sem]);
    expect(filtrarBucket(movs, {}, "aviamento")).toEqual([sem]);
  });

  it("insumo: por tamanho + cor (ignora a variante)", () => {
    const pm = mov({ bucketTamanho: "M", bucketCorNome: "Preto", bucketVarianteId: "x" });
    const pg = mov({ bucketTamanho: "G", bucketCorNome: "Preto" });
    const bm = mov({ bucketTamanho: "M", bucketCorNome: "Branco" });
    const semTam = mov({ bucketTamanho: null, bucketCorNome: "Preto" });
    const semCor = mov({ bucketTamanho: "M", bucketCorNome: null });
    const movs = [pm, pg, bm, semTam, semCor];
    expect(filtrarBucket(movs, { tamanho: "M", corNome: "Preto", varianteId: "outra" }, "insumo")).toEqual([pm]);
    expect(filtrarBucket(movs, { tamanho: null, corNome: "Preto" }, "insumo")).toEqual([semTam]);
    expect(filtrarBucket(movs, { tamanho: "M" }, "insumo")).toEqual([semCor]);
  });

  it("insumo: cor vazia e null são o mesmo bucket", () => {
    const a = mov({ bucketTamanho: null, bucketCorNome: "" });
    expect(filtrarBucket([a], { tamanho: undefined, corNome: null }, "insumo")).toEqual([a]);
  });
});

describe("movDeLinhaRpc", () => {
  it("mapeia snake_case da RPC para camelCase, numeric string vira number", () => {
    const m = movDeLinhaRpc({
      bucket_variante_id: "v1",
      bucket_tamanho: "M",
      bucket_cor_id: "c1",
      bucket_cor_nome: "Preto",
      quando: "2026-09-10T15:00:00+00:00",
      quando_fonte: "registro",
      tipo: "saida",
      origem: "corte",
      quantidade: "-12.500",
      quem: "Ana",
      ref_oc: "OC-9",
      ref_modelo: "VES001",
      ref_id: "r1",
      detalhe: "x",
      core_recebido: "50",
      core_baixa: "12.5",
      core_fisico: "37.5",
    });
    expect(m).toEqual({
      bucketVarianteId: "v1",
      bucketTamanho: "M",
      bucketCorId: "c1",
      bucketCorNome: "Preto",
      quando: "2026-09-10T15:00:00+00:00",
      quandoFonte: "registro",
      tipo: "saida",
      origem: "corte",
      quantidade: -12.5,
      quem: "Ana",
      refOc: "OC-9",
      refModelo: "VES001",
      refId: "r1",
      detalhe: "x",
      coreRecebido: 50,
      coreBaixa: 12.5,
      coreFisico: 37.5,
    });
  });

  it("campos ausentes viram null", () => {
    const m = movDeLinhaRpc({ tipo: "entrada", origem: "oc", quantidade: 1, quando_fonte: "sem_data" });
    expect(m.quando).toBeNull();
    expect(m.bucketVarianteId).toBeNull();
    expect(m.quem).toBeNull();
    expect(m.coreRecebido).toBe(0);
  });
});

describe("montarExtrato — busca por texto (R10)", () => {
  const base = () =>
    comCore(
      [
        mov({ refId: "a", quando: "2026-09-01T12:00:00Z", origem: "oc", quantidade: 100, refOc: "123", refModelo: null }),
        mov({ refId: "b", quando: "2026-09-02T12:00:00Z", tipo: "saida", origem: "corte", quantidade: -30, refModelo: "VE00000123 - Vestido Açaí" }),
        mov({ refId: "c", quando: "2026-09-03T12:00:00Z", tipo: "saida", origem: "os", quantidade: -10, refOc: "OS 12" }),
        mov({ refId: "d", quando: "2026-09-04T12:00:00Z", origem: "rolo_entrada", quantidade: 5, refOc: "R-77" }),
      ],
      { recebido: 105, baixa: 40, fisico: 65 },
    );
  const ids = (b?: string) => montarExtrato(base(), { fuso: FUSO, busca: b }).linhas.map((l) => l.refId);

  it("vazia/ausente/só espaços = todas as linhas (comportamento de antes)", () => {
    expect(ids(undefined)).toEqual(["a", "b", "c", "d"]);
    expect(ids("")).toEqual(["a", "b", "c", "d"]);
    expect(ids("   ")).toEqual(["a", "b", "c", "d"]);
  });

  it("casa por REF do modelo", () => {
    expect(ids("VE00000123")).toEqual(["b"]);
  });

  it("casa por nome do modelo (substring)", () => {
    expect(ids("vestido")).toEqual(["b"]);
  });

  it("casa por nº de OC (cru e com o prefixo exibido), OS e rolo", () => {
    expect(ids("123").sort()).toEqual(["a", "b"]); // OC 123 e o REF ...123
    expect(ids("OC 123")).toEqual(["a"]);
    expect(ids("os 12")).toEqual(["c"]);
    expect(ids("Rolo R-77")).toEqual(["d"]);
  });

  it("ignora acento e maiúsculas, nos dois lados", () => {
    expect(ids("ACAI")).toEqual(["b"]);
    expect(ids("açaí")).toEqual(["b"]);
    expect(ids("  VESTIDO AÇAÍ ")).toEqual(["b"]);
  });

  it("sem resultado = nenhuma linha", () => {
    expect(ids("zzz")).toEqual([]);
  });

  it("a busca NÃO muda saldo final, rodapé (confere/físico) nem o saldo corrente das linhas que ficam", () => {
    const todos = montarExtrato(base(), { fuso: FUSO });
    for (const b of ["vestido", "123", "zzz", "os 12"]) {
      const e = montarExtrato(base(), { fuso: FUSO, busca: b });
      expect(e.saldoFinal).toBe(todos.saldoFinal);
      expect(e.saldoFinal).toBe(65);
      expect(e.confere).toBe(todos.confere);
      expect(e.fisicoTela).toBe(todos.fisicoTela);
      expect(e.negativo).toBe(todos.negativo);
      for (const l of e.linhas) expect(l.saldo).toBe(todos.linhas.find((t) => t.refId === l.refId)!.saldo);
    }
    // o saldo da linha "b" é o corrente de TODO o histórico (100 − 30), não o de um subconjunto
    expect(montarExtrato(base(), { fuso: FUSO, busca: "vestido" }).linhas[0].saldo).toBe(70);
  });

  it("com período: saldoAnterior (e o resto) idêntico com ou sem busca; combina com origem", () => {
    const sem = montarExtrato(base(), { fuso: FUSO, de: "2026-09-03" });
    const com = montarExtrato(base(), { fuso: FUSO, de: "2026-09-03", busca: "rolo" });
    expect(com.saldoAnterior).toBe(sem.saldoAnterior);
    expect(com.saldoAnterior).toBe(70);
    expect(com.saldoFinal).toBe(sem.saldoFinal);
    expect(com.linhas.map((l) => l.refId)).toEqual(["d"]);
    const comOrigem = montarExtrato(base(), { fuso: FUSO, busca: "123", origens: ["corte"] });
    expect(comOrigem.linhas.map((l) => l.refId)).toEqual(["b"]);
    expect(comOrigem.saldoFinal).toBe(65);
  });

  it("textoReferencia: OC/OS/rolo + modelo + detalhe (o mesmo texto da coluna Referência)", () => {
    expect(textoReferencia({ refOc: "123", origem: "oc", refModelo: "M1", detalhe: "x" })).toBe("OC 123 · M1 · x");
    expect(textoReferencia({ refOc: "OS 12", origem: "os", refModelo: null, detalhe: null })).toBe("OS 12");
    expect(textoReferencia({ refOc: "R-1", origem: "rolo_entrada", refModelo: null, detalhe: null })).toBe("Rolo R-1");
    expect(textoReferencia({ refOc: null, origem: "corte", refModelo: null, detalhe: null })).toBe("");
  });
});
