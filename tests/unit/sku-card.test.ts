// Unit — `seloCodigos` (plano `2026-09-29-tamanho-em`, Tarefa 7): trocar o "Tamanho em" deixa linhas já geradas
// `divergente` (o `sku_previsto` mudou, mas o Regerar ainda não rodou) — a seção Códigos mostra "N a regerar"
// (tom info) quando isso é a única pendência (sem falta/conflito, que são mais graves e vencem antes). Não
// exercita a RPC/servidor: `MatrizSkus` é montada à mão, como as demais regras puras deste arquivo.
import { describe, it, expect } from "vitest";
import { seloCodigos, type EstadoSku, type LinhaSku, type MatrizSkus } from "@/components/planejamento/planejamento-detail/codigos/sku-card";

function linha(estado: EstadoSku, overrides: Partial<LinhaSku> = {}): LinhaSku {
  return {
    variante_key: "v1", variante_ordem: 1, cor_nome: "Marrom", apelido_nome: null,
    tamanho_key: "34|PPP", tamanho_ordem: 1,
    id: "id1", sku: "REF-MAR-34", manual: false, rev: 1,
    sku_previsto: "REF-MAR-P", faltas: [], avisos: [], conflito_com: null, estado,
    ...overrides,
  };
}

function matriz(linhas: LinhaSku[], overrides: Partial<MatrizSkus> = {}): MatrizSkus {
  return { status: "ok", tamanho_tipo: "letra", tamanho_tipo_card: "letra", linhas, faltas: [], avisos: [], ...overrides };
}

describe("seloCodigos", () => {
  it("prévia a gravar vence tudo (temPrevia=true), mesmo com matriz null", () => {
    expect(seloCodigos(null, true)).toEqual({ tone: "warn", texto: "prévia a gravar" });
  });

  it("sem matriz e sem prévia: undefined", () => {
    expect(seloCodigos(null, false)).toBeUndefined();
    expect(seloCodigos(undefined, false)).toBeUndefined();
  });

  it("1 linha divergente, sem falta/conflito: 'N a regerar' tom info", () => {
    const m = matriz([linha("divergente")]);
    expect(seloCodigos(m, false)).toEqual({ tone: "info", texto: "1 a regerar" });
  });

  it("N>1 linhas divergentes: plural '{N} a regerar'", () => {
    const m = matriz([linha("divergente"), linha("divergente"), linha("ok")]);
    expect(seloCodigos(m, false)).toEqual({ tone: "info", texto: "2 a regerar" });
  });

  it("falta vence divergente (falta é mais grave — âmbar)", () => {
    const m = matriz([
      linha("divergente"),
      linha("falta", { faltas: [{ atributo: "cor_base", id: null, nome: "Marrom" }] }),
    ]);
    const selo = seloCodigos(m, false);
    expect(selo?.tone).toBe("warn");
    expect(selo?.texto).toContain("sem sigla");
  });

  it("conflito vence divergente (conflito é mais grave — âmbar)", () => {
    const m = matriz([linha("divergente"), linha("conflito")]);
    const selo = seloCodigos(m, false);
    expect(selo?.tone).toBe("warn");
    expect(selo?.texto).toBe("1 em conflito");
  });

  it("pendente vence divergente (a gerar ainda não é 'regerar')", () => {
    const m = matriz([linha("divergente"), linha("pendente")]);
    const selo = seloCodigos(m, false);
    expect(selo?.tone).toBe("muted");
    expect(selo?.texto).toBe("1 a gerar");
  });

  it("sem divergente/falta/conflito/pendente: cai no selo 'ok' de sempre (não regride)", () => {
    const m = matriz([linha("ok")]);
    expect(seloCodigos(m, false)).toEqual({ tone: "ok", texto: "1 SKU" });
  });

  it("0 linhas: sem selo (seção vazia, seloDeSecao)", () => {
    const m = matriz([]);
    expect(seloCodigos(m, false)).toBeUndefined();
  });
});
